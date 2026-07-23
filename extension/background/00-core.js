/** @type {typeof chrome} */
const ext = typeof browser === "undefined" ? chrome : browser

// nerd config
const SEVEN_TV_API = "https://7tv.io/v3"
const THIRD_PARTY_API = "https://decapi.me"

const CACHE_TTL_MS = 60 * 60 * 1000
const EMOTE_CACHE_VERSION = 2
const PARTIAL_RETRY_MS = 2 * 60 * 1000
const PREVIEW_EMOTE_COUNT = 6
const MAX_SUGGESTIONS = 25
const MAIN_SET_REFRESH_MS = 24 * 60 * 60 * 1000
const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 7 * 24
const FETCH_TIMEOUT_MS = 12 * 1000

const MANIFEST_URL = "https://cdn.jsdelivr.net/gh/aitji/7tv-anywhere@main/extension/manifest.json"
const CFG_URL = "https://cdn.jsdelivr.net/gh/aitji/7tv-anywhere@main/sites.jsonc"
const CFG_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PARTIAL_RETRY_ALARM = "ea-partial-retry"

const FALLBACK_CFG = Object.freeze({
    commonChannel: Object.freeze({
        vedal987: "85498365",
        vedal987_jp: "1106354825",
        secretneuroaccount: "923597407",
        camila: "469632185",
        kokonuts: "583268137",
        cerbervt: "852880224",
        minikomew: "1004060561",
        filian: "198633200",
        ellie_minibot: "825937345",
        dougdoug: "31507411"
    }),
    siteRules: Object.freeze([{
        "flag": "support",
        "pattern": "https://example.com",
        "note": "hi..? this is awkward... the request to jsDelivr (GitHub) failed. did you install the extension and then cut the internet cable?"
    }])
})

async function fetchWithTimeout(url, options = {}) {
    const done = startBadgeWork("fetch")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } catch (err) {
        if (err && err.name === "AbortError")
            throw new Error(`request timed out after ${FETCH_TIMEOUT_MS / 1000}s...`)
        throw err
    } finally {
        clearTimeout(timeout)
        done()
    }
}

let cfgCache = null
let siteruleSource = null
let siteRule = []
const siteCache = new Map()
let isInitFly = null
let isInitChannelFly = null
let queueDraft = Promise.resolve()

const cloneState = (state) => JSON.parse(JSON.stringify(state))
const validDraft = (value) => value
    && Array.isArray(value.customSets)
    && value.channelSettings
    && typeof value.channelSettings === "object"
    && !Array.isArray(value.channelSettings)
const errorText = (value, fallback = "Something went wrong") => {
    const raw = value instanceof Error ? value.message : String(value || fallback)
    const text = raw.replace(/^Error:\s*/i, "").replace(/[.!?…\s]+$/, "").trim()
    return `${text || fallback}...`
}

async function setInitStatus(phase, message, extra = {}) {
    const { initStatus: previous } = await ext.storage.local.get("initStatus")
    const initStatus = {
        phase, message,
        startedAt: previous && previous.startedAt ? previous.startedAt : Date.now(),
        updatedAt: Date.now(),
        ...extra
    }
    await ext.storage.local.set({ initStatus })
    return initStatus
}

async function setEmoteLoadStatus(phase, message, extra = {}) {
    const emoteLoadStatus = { phase, message, updatedAt: Date.now(), ...extra }
    await ext.storage.local.set({ emoteLoadStatus })
    return emoteLoadStatus
}

function initialize() {
    if (isInitFly) return isInitFly
    isInitFly = doInit()
    return isInitFly.finally(() => { isInitFly = null })
}

async function doInit() {
    const state = await ext.storage.local.get([
        "enabled", "customSets", "channelSettings",
        "excludedEmote", "caseSensitive", "initStatus", "isInitDone"
    ])

    const defaults = {}
    if (state.enabled === undefined) defaults.enabled = true
    if (state.excludedEmote === undefined) defaults.excludedEmote = ["1", "0", "TO"]
    if (state.caseSensitive === undefined) defaults.caseSensitive = false

    const retrySetup = state.isInitDone === false
        && state.initStatus
        && state.initStatus.phase === "error"

    if (state.customSets !== undefined && !retrySetup) {
        defaults.isInitDone = true
        if (Object.keys(defaults).length) await ext.storage.local.set(defaults)
        if (!state.initStatus || state.initStatus.phase !== "ready") await setInitStatus("ready", "Ready!", {
            finishedAt: Date.now()
        })
        return
    }

    await ext.storage.local.set({ ...defaults, isInitDone: false })
    await setInitStatus("resolving-default", "Finding the default channel...")

    try {
        const result = await resChannel("vedal987")
        if (!result || result.error)
            throw new Error((result && result.error) || "Default channel lookup failed")

        const latest = await ext.storage.local.get(["customSets", "isInitDone"])
        if (latest.isInitDone === true && latest.customSets !== undefined)
            return await setInitStatus("ready", "Ready!", { finishedAt: Date.now() })

        if (result.type === "channel" && result.sets.length) {
            await ext.storage.local.set({
                customSets: result.sets.map(s => ({
                    id: s.id,
                    setName: s.name,
                    count: s.count,
                    preview: s.preview,
                    channelId: result.channel.id,
                    channelName: result.channel.name,
                    enabled: s.id === result.activeSetId
                })),
                channelSettings: {
                    [result.channel.id]: {
                        alwaysMain: true,
                        knownActiveSetId: result.activeSetId
                    }
                },
                isInitDone: true
            })
        } else if (result.type === "set") {
            await ext.storage.local.set({
                customSets: [{
                    id: result.set.id,
                    setName: result.set.name,
                    count: result.set.count,
                    preview: result.set.preview,
                    channelId: result.set.id,
                    channelName: result.set.name,
                    enabled: true
                }],
                channelSettings: {},
                isInitDone: true
            })
        } else await ext.storage.local.set({
            customSets: [],
            channelSettings: {},
            isInitDone: true
        })

        await setInitStatus("ready", "Setup complete!", { finishedAt: Date.now() })
        reloadEmote().catch(() => { })
    } catch (err) {
        await ext.storage.local.set({
            customSets: [],
            channelSettings: {},
            isInitDone: false
        })
        await setInitStatus(
            "error",
            "Setup could not finish, check your connection then reload emotes...",
            { error: String(err), finishedAt: Date.now() }
        )
    }
}
async function getCfg(force = false) {
    if (cfgCache && !force) return cfgCache

    const { siteCfg, siteCfgAt } = await ext.storage.local.get(["siteCfg", "siteCfgAt"])
    const stale = force || !siteCfgAt || Date.now() - siteCfgAt > CFG_TTL_MS
    if (!stale && siteCfg) return setCfgCache(siteCfg)

    try {
        const res = await fetchWithTimeout(`${CFG_URL}?_=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`sites.jsonc fetch failed: HTTP ${res.status}...`)
        const raw = await res.text()
        const parsed = JSON.parse(clsComment(raw))

        const data = {
            commonChannel: (parsed && typeof parsed.commonChannel === "object" && parsed.commonChannel) || {},
            siteRules: Array.isArray(parsed && parsed.siteRules) ? parsed.siteRules : []
        }

        await ext.storage.local.set({ siteCfg: data, siteCfgAt: Date.now() })
        return setCfgCache(data)
    } catch {
        if (siteCfg) return setCfgCache(siteCfg)
        return setCfgCache(FALLBACK_CFG)
    }
}

function setCfgCache(cfg) {
    cfgCache = cfg
    compileSiteRule(cfg.siteRules)
    return cfg
}

function clsComment(text) {
    let out = ""
    let inString = false
    let inLine = false
    let inBlock = false
    let esc = false

    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        const next = text[i + 1]

        if (inLine) {
            if (ch === "\n") { inLine = false; out += ch }
            continue
        }
        if (inBlock) {
            if (ch === "*" && next === "/") { inBlock = false; i++ }
            continue
        }
        if (inString) {
            out += ch
            if (esc) esc = false
            else if (ch === "\\") esc = true
            else if (ch === "\"") inString = false
            continue
        }

        if (ch === "\"") { inString = true; out += ch; continue }
        if (ch === "/" && next === "/") { inLine = true; i++; continue }
        if (ch === "/" && next === "*") { inBlock = true; i++; continue }
        out += ch
    }

    return out
}

function toRegex(pattern) {
    const esc = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    return new RegExp(`^${esc}$`, "i")
}

function clsPath(pathname) {
    const path = String(pathname || "/").replace(/\/+$/, "")
    return path || "/"
}

function compileSiteRule(siteRules) {
    if (siteruleSource === siteRules) return
    siteruleSource = siteRules
    siteRule = []
    siteCache.clear()

    for (const [index, rule] of (siteRules || []).entries()) {
        if (!rule || !["support", "not_support"].includes(rule.flag)) continue

        const isHostRule = Object.prototype.hasOwnProperty.call(rule, "host") || Array.isArray(rule.pattern)
        if (!isHostRule) {
            if (!rule.pattern) continue
            try {
                const regex = toRegex(rule.pattern)
                siteRule.push({
                    rule, index,
                    match: ({ key, rootlessKey, original }) => regex.test(key) || regex.test(rootlessKey) || regex.test(original)
                        ? String(rule.pattern).replace(/\*/g, "").length
                        : -1
                })
            } catch { }
            continue
        }

        const host = String(rule.host || "").trim().toLowerCase().replace(/\.$/, "")
        const isSubdomain = rule.subdomain === true
        const patterns = Array.isArray(rule.pattern) && rule.pattern.length
            ? rule.pattern
            : [rule.pattern || "*"]

        for (const raw of patterns) {
            const pattern = String(raw || "*").trim() || "*"
            const clsPattern = pattern === "*"
                ? "*"
                : clsPath(pattern.startsWith("/") ? pattern : `/${pattern}`)

            let pathRegex
            try { pathRegex = toRegex(clsPattern) } catch { continue }
            const baseScore = host.length * 10 + clsPattern.replace(/\*/g, "").length

            siteRule.push({
                rule, index,
                match: ({ hostname, pathname }) => {
                    const exactHost = !host || hostname === host
                    const childHost = isSubdomain && !!host && hostname.endsWith(`.${host}`)
                    if (!exactHost && !childHost) return -1
                    if (!pathRegex.test(pathname)) return -1
                    return baseScore + (exactHost ? 5 : 0)
                }
            })
        }
    }
}

function siteVerdict(urlStr, siteRules) {
    compileSiteRule(siteRules)
    let parsed
    try { parsed = new URL(urlStr) }
    catch { return { unsupported: false, note: null, flag: null } }

    const target = {
        original: urlStr,
        hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
        pathname: clsPath(parsed.pathname),
        key: `${parsed.protocol}//${parsed.host}${clsPath(parsed.pathname)}`,
        rootlessKey: `${parsed.protocol}//${parsed.host}${clsPath(parsed.pathname) === "/" ? "" : clsPath(parsed.pathname)}`
    }
    const cacheKey = target.key
    const cached = siteCache.get(cacheKey)
    if (cached) return cached

    let best = null
    for (const entry of siteRule) {
        const score = entry.match(target)
        if (score < 0) continue
        if (!best || score > best.score || (score === best.score && entry.index < best.index))
            best = { rule: entry.rule, score, index: entry.index }
    }

    const verdict = best
        ? {
            unsupported: best.rule.flag === "not_support",
            note: best.rule.note || null,
            flag: best.rule.flag
        }
        : { unsupported: false, note: null, flag: null }

    if (siteCache.size >= 256)
        siteCache.delete(siteCache.keys().next().value)
    siteCache.set(cacheKey, verdict)
    return verdict
}
