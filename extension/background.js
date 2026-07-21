/** @type {typeof chrome} */
const ext = typeof browser === "undefined" ? chrome : browser

// nerd config
const SEVEN_TV_API = "https://7tv.io/v3"
const THIRD_PARTY_API = "https://decapi.me"
const CACHE_TTL_MS = 60 * 60 * 1000
const PARTIAL_RETRY_MS = 2 * 60 * 1000
const PREVIEW_EMOTE_COUNT = 6
const MAX_SUGGESTIONS = 25
const MAIN_SET_REFRESH_MS = 24 * 60 * 60 * 1000
const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

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

let cfgCache = null
async function getCfg(force = false) {
    if (cfgCache && !force) return cfgCache

    const { siteCfg, siteCfgAt } = await ext.storage.local.get(["siteCfg", "siteCfgAt"])
    const stale = force || !siteCfgAt || Date.now() - siteCfgAt > CFG_TTL_MS

    if (!stale && siteCfg) {
        cfgCache = siteCfg
        return siteCfg
    }

    try {
        const res = await fetch(`${CFG_URL}?_=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`sites.jsonc fetch failed: HTTP ${res.status}`)
        const raw = await res.text()
        const parsed = JSON.parse(stripComments(raw))

        const normalized = {
            commonChannel: (parsed && typeof parsed.commonChannel === "object" && parsed.commonChannel) || {},
            siteRules: Array.isArray(parsed && parsed.siteRules) ? parsed.siteRules : []
        }

        cfgCache = normalized
        await ext.storage.local.set({ siteCfg: normalized, siteCfgAt: Date.now() })
        return normalized
    } catch {
        if (siteCfg) {
            cfgCache = siteCfg
            return siteCfg
        }
        cfgCache = FALLBACK_CFG
        return FALLBACK_CFG
    }
}

function stripComments(text) {
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
    const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    return new RegExp(`^${escaped}$`, "i")
}

function siteVerdict(urlStr, siteRules) {
    let key = urlStr
    try {
        const u = new URL(urlStr)
        key = `${u.protocol}//${u.host}${u.pathname}`
    } catch { }

    let sup = null
    let nsup = null

    for (const rule of siteRules || []) {
        if (!rule || !rule.pattern) continue

        let re
        try { re = toRegex(rule.pattern) } catch { continue }
        if (!re.test(key) && !re.test(urlStr)) continue

        if (rule.flag === "support" && !sup) sup = rule
        else if (rule.flag === "not_support" && !nsup) nsup = rule
    }

    if (sup) return { unsupported: false, note: sup.note || null }
    if (nsup) return { unsupported: true, note: nsup.note || null }
    return { unsupported: false, note: null }
}

ext.runtime.onInstalled.addListener(async () => {
    const { enabled, customSets, excludedEmote } = await ext.storage.local.get(["enabled", "customSets", "excludedEmote"])
    if (enabled === undefined) await ext.storage.local.set({ enabled: true })
    if (excludedEmote === undefined) await ext.storage.local.set({ excludedEmote: ["1", "0"] })
    const cls = async () => await ext.storage.local.set({ customSets: [] })

    if (customSets === undefined) {
        // default channel
        try {
            const result = await resChannel("vedal987")
            if (result.type === "channel" && result.sets.length) await ext.storage.local.set({
                customSets: result.sets.map(s => ({
                    id: s.id,
                    setName: s.name,
                    count: s.count,
                    preview: s.preview,
                    channelId: result.channel.id,
                    channelName: result.channel.name,
                    enabled: s.id === result.activeSetId
                })),
                channelSettings: { [result.channel.id]: { alwaysMain: true, knownActiveSetId: result.activeSetId } }
            })

            else if (result.type === "set") await ext.storage.local.set({
                customSets: [{
                    id: result.set.id,
                    setName: result.set.name,
                    count: result.set.count,
                    preview: result.set.preview,
                    channelId: result.set.id,
                    channelName: result.set.name,
                    enabled: true
                }]
            })

            else await cls()
        } catch { await cls() }
    }

    checkUpdate(false).catch(() => { })
    getCfg().catch(() => { })
})

ext.runtime.onStartup?.addListener(() => {
    checkUpdate(false).catch(() => { })
    getCfg().catch(() => { })
})
ext.alarms?.onAlarm.addListener(e => (e.name === PARTIAL_RETRY_ALARM) && reloadEmote().catch(() => { }))

// "weekly" extension update
async function checkUpdate(force) {
    const { lastCheck, updateInfo } = await ext.storage.local.get(["lastCheck", "updateInfo"])
    const due = force || !lastCheck || Date.now() - lastCheck > UPDATE_CHECK_INTERVAL_MS
    if (!due) return { checked: false, updateInfo: updateInfo || null }

    try {
        const res = await fetch(`${MANIFEST_URL}?_=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`)
        const gitManifest = await res.json()
        const iManifest = ext.runtime.getManifest().version
        const lastVer = gitManifest.version
        const isNewer = checkVer(lastVer, iManifest) > 0

        const info = { latestVersion: lastVer, currentVersion: iManifest, updateAvailable: isNewer, checkedAt: Date.now() }
        await ext.storage.local.set({ lastCheck: Date.now(), updateInfo: info })

        if (isNewer) {
            ext.action.setBadgeText({ text: "\u2191" }).catch(() => { })
            ext.action.setBadgeBackgroundColor({ color: "#3fb950" }).catch(() => { })
        } else ext.action.setBadgeText({ text: "" }).catch(() => { })

        return { checked: true, updateInfo: info }
    } catch (err) {
        await ext.storage.local.set({ lastCheck: Date.now() })
        return { checked: true, error: String(err), updateInfo: updateInfo || null }
    }
}

function checkVer(a, b) {
    const pa = String(a || "0").split(".").map(n => parseInt(n, 10) || 0)
    const pb = String(b || "0").split(".").map(n => parseInt(n, 10) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0)
        if (diff !== 0) return diff > 0 ? 1 : -1
    }
    return 0
}

ext.runtime.onMessage.addListener((msg, _sender, sendRes) => {
    switch (msg && msg.type) {
        case "GET_EMOTES": getEmote().then(emotes => sendRes({ emotes })).catch(err => sendRes({ emotes: [], error: String(err) }))
            return true

        case "RELOAD_EMOTES": reloadEmote()
            .then(result => sendRes({ success: true, emotes: result.emotes, warning: result.warning }))
            .catch(err => sendRes({ success: false, error: String(err) }))
            return true

        case "GET_SUGGESTIONS": getSugg(msg.query || "").then(suggestions => sendRes({ suggestions }))
            return true

        case "RESOLVE_CHANNEL": resChannel(msg.query || "")
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: String(err) }))
            return true

        case "REFRESH_CHANNEL": fetchUser(msg.channelId)
            .then(user => (user ? buildChannelRes(user) : { error: "Channel not found." }))
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: String(err) }))
            return true

        case "CHECK_FOR_UPDATE": checkUpdate(!!msg.force)
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: String(err) }))
            return true

        case "IS_SITE_UNSUPPORTED": getCfg()
            .then(({ siteRules }) => sendRes(siteVerdict(msg.url || "", siteRules)))
            .catch(err => sendRes({ unsupported: false, note: null, error: String(err) }))
            return true

        default: return false
    }
})

async function getEmote() {
    const { emoteSet, getEmoteAt, emoteSetSize, emoteSize, emoteSetPartial, emoteSetKey } = await ext.storage.local.get(["emoteSet", "getEmoteAt", "emoteSetSize", "emoteSize", "emoteSetPartial", "emoteSetKey"])
    const size = emoteSetSize === clamp(emoteSize)
    const keys = await computeKey()
    const isMatches = emoteSetKey === keys
    const ttl = emoteSetPartial ? PARTIAL_RETRY_MS : CACHE_TTL_MS
    const fresh = emoteSet && emoteSet.length && getEmoteAt && (Date.now() - getEmoteAt < ttl) && size && isMatches

    if (fresh) return emoteSet
    const result = await reloadEmote()
    return result.emotes
}

async function computeKey() {
    const { customSets = [] } = await ext.storage.local.get(["customSets"])
    const enabledIds = customSets.filter(s => s.enabled !== false).map(s => s.id)
    return JSON.stringify(["global", ...enabledIds])
}

let reloadInFlight = null
async function reloadEmote() {
    if (reloadInFlight) return reloadInFlight
    reloadInFlight = doReloadEmotes()

    try { return await reloadInFlight }
    finally { reloadInFlight = null }
}

async function getEmoteJson(id, isRetry = false) {
    try {
        const res = await fetch(`${SEVEN_TV_API}/emote-sets/${id}`)
        if (!res.ok) throw new Error(`emote-sets/${id}: HTTP ${res.status}`)
        return await res.json()
    } catch (err) {
        if (isRetry) throw err
        await new Promise(resolve => setTimeout(resolve, 400))
        return getEmoteJson(id, true)
    }
}

async function doReloadEmotes() {
    let { customSets = [], emoteSize, channelSettings = {} } = await ext.storage.local.get(["customSets", "emoteSize", "channelSettings"])
    const size = clamp(emoteSize)
    customSets = await reAlwayChannel(customSets, channelSettings)

    const setEnabled = customSets.filter(s => s.enabled !== false)
    const setId = ["global", ...setEnabled.map(s => s.id)]

    const res = await Promise.allSettled(setId.map(id => getEmoteJson(id)))

    const byName = new Map()
    let anyOk = false
    const failLabel = []
    res.forEach((result, index) => {
        if (result.status !== "fulfilled") {
            if (index > 0) failLabel.push(setLabel(setEnabled[index - 1]) || setId[index])
            return
        }

        anyOk = true
        const sourceSet = index > 0 ? setEnabled[index - 1] : null
        const channelName = sourceSet ? sourceSet.channelName : null
        for (const emote of result.value.emotes || []) {
            if (!emote || !emote.name || !emote.data || !emote.data.host || !emote.data.host.url) continue
            byName.set(emote.name, {
                name: emote.name,
                id: emote.id,
                url: `https:${emote.data.host.url}/${clamp(size)}x.webp`,
                channelName
            })
        }
    })

    if (!anyOk) throw new Error("Could not reach 7TV. (Check your connection and try again)?")
    const emoteSet = Array.from(byName.values())

    const eChannelMap = new Map()
    for (const s of setEnabled) eChannelMap.set(s.channelId, (eChannelMap.get(s.channelId) || 0) + 1)
    const overlap = Array.from(eChannelMap.entries())
        .filter(([, count]) => count > 1)
        .map(([channelId]) => (customSets.find(s => s.channelId === channelId) || {}).channelName || channelId)

    const warnings = []
    if (failLabel.length) warnings.push(`Couldn't load: ${failLabel.join(", ")} (no longer public?)`)
    if (overlap.length) warnings.push(`Multiple sets enabled at once for ${overlap.join(", ")}, some emotes may get overridden if the same name exists in more than one set.`)
    const warning = warnings.length ? warnings.join(" ") : null

    const partial = failLabel.length > 0
    await ext.storage.local.set({
        emoteSet,
        getEmoteAt: Date.now(),
        emoteSetSize: size,
        emoteSetPartial: partial,
        emoteSetKey: JSON.stringify(setId),
        lastReWarn: warning
    })

    if (partial) ext.alarms?.create(PARTIAL_RETRY_ALARM, { delayInMinutes: PARTIAL_RETRY_MS / 60000 })
    else ext.alarms?.clear(PARTIAL_RETRY_ALARM)

    try { // notify
        const tabs = await ext.tabs.query({})
        await Promise.allSettled(tabs.map(tab => ext.tabs.sendMessage(tab.id, { type: "EMOTES_UPDATED" }).catch(() => { })))
    } catch { }
    return { emotes: emoteSet, warning }
}


function setLabel(set) {
    if (!set) return null
    return set.setName ? `${set.channelName || ""} \u2013 ${set.setName}`.replace(/^ \u2013 /, "") : set.label
}

// daily check for always main
async function reAlwayChannel(customSets, channelSetting) {
    const now = Date.now()
    const dueChannelId = Object.keys(channelSetting).filter(id => {
        const pref = channelSetting[id]
        if (!pref || !pref.alwaysMain) return false
        return !pref.mainRefreshedAt || now - pref.mainRefreshedAt > MAIN_SET_REFRESH_MS
    })
    if (!dueChannelId.length) return customSets

    let changed = false
    for (const channelId of dueChannelId) try {
        const user = await fetchUser(channelId)
        const activeId = user ? getActiveId(user) : null
        if (activeId) {
            const info = await getSetInfo(activeId)
            if (info) {
                const pref = channelSetting[channelId] || {}
                const targetId = pref.knownActiveSetId || info.id
                let updatedOne = false
                customSets = customSets.map(s => {
                    if (updatedOne || s.channelId !== channelId || s.id !== targetId) return s
                    updatedOne = true
                    changed = true
                    return { ...s, id: info.id, setName: info.name, count: info.count, preview: info.preview }
                })
            }
        }

        channelSetting[channelId] = { ...channelSetting[channelId], mainRefreshedAt: now }
        changed = true
    } catch { }

    if (changed) await ext.storage.local.set({ customSets, channelSettings: channelSetting })
    return customSets
}

async function getSugg(query) {
    const [emotes, { excludedEmote = [] }] = await Promise.all([
        getEmote(),
        ext.storage.local.get("excludedEmote")
    ])

    const excluded = new Set(excludedEmote)
    const nQuery = normalize(query)

    const scored = []
    for (const emote of emotes) {
        if (excluded.has(emote.name)) continue
        const score = fuzzy(nQuery, normalize(emote.name))
        if (score > 0) scored.push({ ...emote, score })
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, MAX_SUGGESTIONS)
}

// helpers
const normalize = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "")
const clamp = (size) => {
    const n = Number(size)
    if (!Number.isInteger(n) || n < 1 || n > 4) return 2
    return n
}
const fuzzy = (query, text) => {
    if (!query) return 0
    if (text.includes(query)) return 100 + (100 - text.indexOf(query))

    let score = 0
    let qIndex = 0
    let lastIndex = -1

    for (let i = 0; i < text.length && qIndex < query.length; i++) {
        if (text[i] === query[qIndex]) {
            score += 10
            if (lastIndex === i - 1) score += 5
            if (qIndex === 0 && i === 0) score += 20
            lastIndex = i
            qIndex++
        }
    }

    return qIndex === query.length ? score : 0
}

const extractId = (raw) => {
    const t = String(raw || "").trim()
    if (!t) return null

    const url = t.match(/(?:emote-sets|users)\/([A-Za-z0-9]+)/)
    if (url) return url[1]

    if (/^[A-Za-z0-9_]+$/.test(t)) return t
    return null
}

async function resChannel(rQuery) {
    const id = extractId(rQuery)
    if (!id) return { error: `Couldn't parse "${rQuery}"` }

    if (/^\d+$/.test(id)) {
        const userId = await fetchUser(id)
        return userId
            ? buildChannelRes(userId)
            : { error: `Couldn't find "${rQuery}" as a Twitch user` }
    }

    const is7tvId = id.length === 24
    if (is7tvId) {
        const set = await getSetInfo(id)
        if (set) return { type: "set", set }
    }

    const twitch = await getUserTwitch(id)
    if (twitch) return buildChannelRes(twitch)

    const userId = await fetchUser(id)
    if (userId) return buildChannelRes(userId)

    if (!is7tvId) {
        const set = await getSetInfo(id)
        if (set) return { type: "set", set }
    }

    return { error: `Couldn't find "${rQuery}" as a set, channel, or Twitch username` }
}

async function buildChannelRes(user) {
    const ownSet = user.emote_sets || []
    const sets = (await Promise.all(ownSet.map(s => getSetInfo(s.id)))).filter(Boolean)

    return {
        type: "channel",
        channel: { id: user.id, name: user.display_name || user.username || user.id },
        sets,
        activeSetId: getActiveId(user)
    }
}

function getActiveId(user) {
    if (!user) return null
    if (user.active_emote_set_id) return user.active_emote_set_id

    const connect = user.connections || []
    const twitchC = connect.find(c => c.platform === "TWITCH") || connect[0]
    if (twitchC) return twitchC.emote_set_id || (twitchC.emote_set && twitchC.emote_set.id) || null
    return null
}

async function getSetInfo(id) {
    try {
        const res = await fetch(`${SEVEN_TV_API}/emote-sets/${id}`)
        if (!res.ok) return null

        const data = await res.json()
        const emotes = data.emotes || []
        const preview = emotes
            .slice(0, PREVIEW_EMOTE_COUNT)
            .filter(e => e && e.data && e.data.host && e.data.host.url)
            .map(e => ({ name: e.name, url: `https:${e.data.host.url}/1x.webp` }))
        return { id: data.id, name: data.name || data.id, count: emotes.length, preview }
    } catch { return null }
}

async function fetchUser(id) {
    try {
        const res = await fetch(`${SEVEN_TV_API}/users/${id}`)
        if (!res.ok) return null
        return await res.json()
    } catch { return null }
}

// username -> id
async function getUserTwitch(username) {
    try {
        const { commonChannel } = await getCfg()
        let twitchId = (commonChannel && commonChannel[username]) || null
        if (!twitchId) {
            const idRes = await fetch(`${THIRD_PARTY_API}/twitch/id/${encodeURIComponent(username)}`)
            if (!idRes.ok) return null
            twitchId = (await idRes.text()).trim()
        }

        if (!twitchId) return null
        if (!/^\d+$/.test(twitchId)) return null

        const cRes = await fetch(`${SEVEN_TV_API}/users/twitch/${twitchId}`)
        if (!cRes.ok) return null
        const connect = await cRes.json()

        const activeId = (connect.emote_set && connect.emote_set.id) || connect.emote_set_id || null
        if (connect.user) return { ...connect.user, active_emote_set_id: activeId }

        return {
            id: connect.id,
            username: connect.username,
            display_name: connect.display_name,
            emote_sets: connect.emote_set ? [connect.emote_set] : [],
            active_emote_set_id: activeId
        }
    } catch { return null }
}
