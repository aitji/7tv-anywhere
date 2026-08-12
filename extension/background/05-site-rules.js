const CFG_URL = "https://cdn.jsdelivr.net/gh/aitji/7tv-anywhere@main/sites.jsonc"
const CFG_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FALLBACK_CFG = Object.freeze({
    commonChannel: Object.freeze({
        vedal987: "85498365",
        vedal987_jp: "1106354825",
        secretneuroaccount: "923597407"
    }),
    siteRules: Object.freeze([{
        "flag": "support",
        "pattern": "https://example.com",
        "note": "hi..? this is awkward... the request to jsDelivr (GitHub) failed. did you install the extension and then cut the internet cable?"
    }])
})
const LOCAL_CFG = Object.freeze({ commonChannel: FALLBACK_CFG.commonChannel, siteRules: Object.freeze([]) })

let cfgCache = null
let siteruleSource = null
let siteRule = []
const siteCache = new Map()

async function getCfg(force = false) {
    const { maintainerGuidance = true, siteCfg, siteCfgAt } = await ext.storage.local.get(["maintainerGuidance", "siteCfg", "siteCfgAt"])
    if (!maintainerGuidance) return setCfgCache(LOCAL_CFG)
    if (cfgCache && !force) return cfgCache

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

    const pathname = clsPath(parsed.pathname)
    const target = {
        original: urlStr,
        hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
        pathname,
        key: `${parsed.protocol}//${parsed.host}${pathname}`,
        rootlessKey: `${parsed.protocol}//${parsed.host}${pathname === "/" ? "" : pathname}`
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

    if (siteCache.size >= 256) siteCache.delete(siteCache.keys().next().value)
    siteCache.set(cacheKey, verdict)
    return verdict
}
