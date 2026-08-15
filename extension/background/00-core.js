/** @type {typeof chrome} */
const ext = typeof browser === "undefined" ? chrome : browser

// nerd config
const SEVEN_TV_API = "https://7tv.io/v3"
const THIRD_PARTY_API = "https://decapi.me"

const CACHE_TTL_MS = 60 * 60 * 1000
const EMOTE_CACHE_VERSION = 4
const PARTIAL_RETRY_MS = 2 * 60 * 1000
const PREVIEW_EMOTE_COUNT = 6
const MAX_SUGGESTIONS = 25
const MAIN_SET_REFRESH_MS = 24 * 60 * 60 * 1000
const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 7 * 24
const FETCH_TIMEOUT_MS = 12 * 1000
const DEFAULT_EXCLUDED_EMOTE = Object.freeze(["1", "0", "TO"])
const DEFAULT_MATCH_PRIORITY = "channel"
const DEFAULT_RENDER_MODE = "balanced"
const DEFAULT_HOVER_TEMPLATE = "{original} ({emote}@{channel})"
const EMOTE_FETCH_CONCURRENCY = 4

const MANIFEST_URL = "https://cdn.jsdelivr.net/gh/aitji/7tv-anywhere@main/extension/manifest.json"
const PARTIAL_RETRY_ALARM = "ea-partial-retry"
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

let isInitFly = null
let isInitChannelFly = null
let queueDraft = Promise.resolve()

const cloneState = (state) => JSON.parse(JSON.stringify(state))
function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, canonicalize(value[key])])
    )
}
const validDraft = value => value && Array.isArray(value.customSets) && value.channelSettings
    && typeof value.channelSettings === "object"
    && !Array.isArray(value.channelSettings)
function cleanExcludedEmote(value) {
    if (!Array.isArray(value)) return []
    const out = []
    const seen = new Set()
    for (const item of value) {
        const name = typeof item === "string"
            ? item.trim()
            : item && typeof item.name === "string"
                ? item.name.trim()
                : ""
        if (!name) continue
        const channelId = item && typeof item === "object" && typeof item.channelId === "string"
            ? item.channelId.trim()
            : ""
        const key = `${channelId || "*"}\0${name}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(channelId ? { name, channelId } : name)
    }
    return out
}
const emoteSourceId = emote => String(emote && emote.channelId
    ? emote.channelId
    : emote && emote.channelName ? `legacy:${emote.channelName}` : "global")
function makeExclusionMatcher(excluded, matchCase = false) {
    const global = new Set()
    const bySource = new Set()
    for (const item of cleanExcludedEmote(excluded)) {
        const name = typeof item === "string" ? item : item.name
        const key = matchCase ? name : name.toLowerCase()
        if (typeof item === "string") global.add(key)
        else bySource.add(`${item.channelId}\0${key}`)
    }
    return emote => {
        const name = String(emote && emote.name || "")
        const key = matchCase ? name : name.toLowerCase()
        return global.has(key) || bySource.has(`${emoteSourceId(emote)}\0${key}`)
    }
}
function isEmoteExcluded(emote, excluded, matchCase = false) {
    return makeExclusionMatcher(excluded, matchCase)(emote)
}
const cleanMatchPriority = (value) => value === "case" ? "case" : DEFAULT_MATCH_PRIORITY
const cleanRenderMode = (value) => ["light", "balanced", "full"].includes(value) ? value : DEFAULT_RENDER_MODE
const cleanHoverStyle = value => value === "title" ? "title" : "card"
const cleanHoverLayout = value => ["right", "left", "top", "hidden"].includes(value) ? value : "right"
const cleanHoverTemplate = value => String(value || DEFAULT_HOVER_TEMPLATE).trim().slice(0, 400) || DEFAULT_HOVER_TEMPLATE
const cleanHoverDelay = value => Math.max(0, Math.min(1500, Number(value) || 0))
function fillDraft(value, fallback = {}) {
    const src = validDraft(value) ? value : {}
    return {
        customSets: cloneState(src.customSets || fallback.customSets || []),
        channelSettings: cloneState(src.channelSettings || fallback.channelSettings || {}),
        excludedEmote: cleanExcludedEmote(Array.isArray(src.excludedEmote)
            ? src.excludedEmote : fallback.excludedEmote || []),
        emoteSize: clamp(src.emoteSize || fallback.emoteSize),
        caseSensitive: src.caseSensitive === undefined ? fallback.caseSensitive === true : src.caseSensitive === true,
        matchPriority: cleanMatchPriority(src.matchPriority || fallback.matchPriority),
        renderMode: cleanRenderMode(src.renderMode || fallback.renderMode),
        zeroWidthEmote: src.zeroWidthEmote === undefined ? fallback.zeroWidthEmote !== false : src.zeroWidthEmote !== false,
        zeroWidthText: src.zeroWidthText === undefined ? fallback.zeroWidthText === true : src.zeroWidthText === true,
        emoteHoverStyle: cleanHoverStyle(src.emoteHoverStyle || fallback.emoteHoverStyle),
        emoteHoverLayout: cleanHoverLayout(src.emoteHoverLayout || fallback.emoteHoverLayout),
        emoteHoverTemplate: cleanHoverTemplate(src.emoteHoverTemplate || fallback.emoteHoverTemplate),
        emoteHoverDelay: cleanHoverDelay(src.emoteHoverDelay ?? fallback.emoteHoverDelay ?? 350)
    }
}
function comparableDraft(state) {
    const customSets = (state.customSets || []).map(set => ({ ...set, enabled: set.enabled !== false }))
    const channelSettings = {}
    for (const [channelId, pref] of Object.entries(state.channelSettings || {})) {
        const clean = { ...(pref || {}) }
        delete clean.lastEnabledSetIds
        if (clean.alwaysMain !== true) delete clean.alwaysMain
        if (Object.keys(clean).length) channelSettings[channelId] = clean
    }
    return JSON.stringify(canonicalize({
        caseSensitive: state.caseSensitive === true,
        channelSettings,
        customSets,
        excludedEmote: cleanExcludedEmote(state.excludedEmote),
        emoteSize: clamp(state.emoteSize),
        matchPriority: cleanMatchPriority(state.matchPriority),
        renderMode: cleanRenderMode(state.renderMode),
        zeroWidthEmote: state.zeroWidthEmote !== false,
        zeroWidthText: state.zeroWidthText === true,
        emoteHoverStyle: cleanHoverStyle(state.emoteHoverStyle),
        emoteHoverLayout: cleanHoverLayout(state.emoteHoverLayout),
        emoteHoverTemplate: cleanHoverTemplate(state.emoteHoverTemplate),
        emoteHoverDelay: cleanHoverDelay(state.emoteHoverDelay)
    }))
}
const hasDraftChanges = (pending, saved) => validDraft(pending)
    && comparableDraft(fillDraft(pending, saved)) !== comparableDraft(fillDraft(saved))
const errorText = (value, fallback = "Something went wrong") => `${(value instanceof Error
    ? value.message : String(value || fallback)).replace(/^Error:\s*/i, "")
    .replace(/[.!?…\s]+$/, "").trim() || fallback}...`

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
        "excludedEmote", "caseSensitive", "matchPriority", "renderMode", "zeroWidthEmote", "zeroWidthText",
        "emoteHoverStyle", "emoteHoverLayout", "emoteHoverTemplate", "emoteHoverDelay", "maintainerGuidance",
        "pickerEnabled", "pickerLayout",
        "initStatus", "isInitDone"
    ])

    const defaults = {}
    if (state.enabled === undefined) defaults.enabled = true
    if (state.excludedEmote === undefined) defaults.excludedEmote = [...DEFAULT_EXCLUDED_EMOTE]
    if (state.caseSensitive === undefined) defaults.caseSensitive = false
    if (state.matchPriority === undefined) defaults.matchPriority = DEFAULT_MATCH_PRIORITY
    if (state.renderMode === undefined) defaults.renderMode = DEFAULT_RENDER_MODE
    for (const [key, value] of Object.entries({ zeroWidthEmote: true, zeroWidthText: false, emoteHoverStyle: "card", emoteHoverLayout: "right", emoteHoverTemplate: DEFAULT_HOVER_TEMPLATE, emoteHoverDelay: 350, maintainerGuidance: true, pickerEnabled: true, pickerLayout: "tabs" }))
        if (state[key] === undefined) defaults[key] = value

    const hasConfiguredSets = Array.isArray(state.customSets) && state.customSets.length > 0
    const retrySetup = state.isInitDone === false
        && state.initStatus
        && state.initStatus.phase === "error"
        && !hasConfiguredSets

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

        const latest = await ext.storage.local.get(["customSets", "isInitDone", "pendingDraft"])
        const configuredWhileResolving = Array.isArray(latest.customSets) && latest.customSets.length > 0
        const draftedWhileResolving = validDraft(latest.pendingDraft) && latest.pendingDraft.customSets.length > 0
        if ((latest.isInitDone === true && latest.customSets !== undefined) || configuredWhileResolving || draftedWhileResolving) {
            if (configuredWhileResolving) await ext.storage.local.set({ isInitDone: true })
            return await setInitStatus("ready", "Ready!", { finishedAt: Date.now() })
        }

        if (result.type === "channel" && result.sets.length) {
            await ext.storage.local.set({
                customSets: result.sets.map(s => ({
                    id: s.id,
                    setName: s.name,
                    count: s.count,
                    preview: s.preview,
                    channelId: result.channel.id,
                    channelName: result.channel.name,
                    channelAvatarUrl: result.channel.avatarUrl || "",
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
        const latest = await ext.storage.local.get(["customSets", "channelSettings", "isInitDone"])
        const configured = Array.isArray(latest.customSets) && latest.customSets.length > 0
        if (configured || latest.isInitDone === true) {
            await ext.storage.local.set({ isInitDone: true })
            await setInitStatus("ready", "Ready!", {
                warning: errorText(err, "Default setup could not finish"),
                finishedAt: Date.now()
            })
            return
        }

        await ext.storage.local.set({
            customSets: Array.isArray(latest.customSets) ? latest.customSets : [],
            channelSettings: latest.channelSettings && typeof latest.channelSettings === "object"
                ? latest.channelSettings
                : {},
            isInitDone: false
        })
        await setInitStatus(
            "error",
            "Setup could not finish, check your connection then reload emotes...",
            { error: String(err), finishedAt: Date.now() }
        )
    }
}

async function forceReinitialize() {
    if (isInitFly) await isInitFly.catch(() => { })
    await ext.storage.local.remove([
        "customSets", "channelSettings", "pendingDraft", "channelOperation",
        "emoteSet", "getEmoteAt", "emoteSetSize", "emoteSetPartial", "emoteSetKey",
        "lastReWarn", "emoteLoadStatus", "initStatus", "isInitDone"
    ])
    await initialize()
    return { success: true }
}
