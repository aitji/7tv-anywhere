/** @type {typeof chrome} */
const ext = typeof browser === "undefined" ? chrome : browser

// element
const $ = (id) => document.getElementById(id)
const toggleEnabledBtn = $("toggle-enabled")
const toggleSiteBtn = $("toggle-site")
const siteLabel = $("site-label")

const noticeBanner = $("notice-banner")
const noticeText = $("notice-text")

const tabBtns = document.querySelectorAll(".tab-btn")
const panelEmotes = $("panel-emotes")
const panelBrowser = $("panel-browser")
const panelSettings = $("panel-settings")

const viewHome = $("view-home")
const viewManage = $("view-manage")

const channelQueryInput = $("channel-query")
const findSetsBtn = $("find-sets")
const channelStatus = $("channel-status")
const channelStatusSpinner = $("channel-status-spinner")
const findHint = $("find-hint")

const channelsSummaryEl = $("channels-summary")
const channelCardsEl = $("channel-cards")
const channelsEmptyEl = $("channels-empty")

const emoteSizeInput = $("emote-size")
const emoteSizeValue = $("emote-size-value")
const emoteSizeStatusEl = $("emote-size-status")
const reloadBtn = $("reload-emotes")
const emoteCountEl = $("emote-count")
const reloadWarningEl = $("reload-warning")

const backBtn = $("back-btn")
const manageChannelTitle = $("manage-channel-title")
const manageChannelSummary = $("manage-channel-summary")
const manageChannelStatus = $("manage-channel-status")
const hardReloadChannelBtn = $("hard-reload-channel")
const alwaysMainToggle = $("always-main-toggle")
const alwaysMainActive = $("always-main-active")
const refreshMainNowBtn = $("refresh-main-now")
const manageOverlapWarning = $("manage-overlap-warning")
const manageSetListEl = $("manage-set-list")

const saveBtn = $("save-btn")
const discardBtn = $("discard-btn")
const saveHintEl = $("save-hint")

const confirmOverlay = $("confirm-overlay")
const confirmTitle = $("confirm-title")
const confirmBody = $("confirm-body")
const confirmActionBtn = $("confirm-action")
const confirmCancelBtn = $("confirm-cancel")

const browserModeEmotesBtn = $("browser-mode-emotes")
const browserModeChannelsBtn = $("browser-mode-channels")
const browserIntroEl = $("browser-intro")
const browserSearchInput = $("browser-search")
const browserEmoteFiltersEl = $("browser-emote-filters")
const browserChannelFilter = $("browser-channel-filter")
const browserSetFilter = $("browser-set-filter")
const browserBlockedOnlyInput = $("browser-blocked-only")
const browserSummaryEl = $("browser-summary")
const browserSetPreviewEl = $("browser-set-preview")
const browserSetPreviewTitleEl = $("browser-set-preview-title")
const browserSetPreviewCopyEl = $("browser-set-preview-copy")
const browserSetPreviewActionBtn = $("browser-set-preview-action")
const browserListEl = $("browser-list")
const browserEmptyEl = $("browser-empty")
const browserSetOverlay = $("browser-set-overlay")
const browserSetOverlayChannelEl = $("browser-set-overlay-channel")
const browserSetOverlayWarningEl = $("browser-set-overlay-warning")
const browserSetOverlayListEl = $("browser-set-overlay-list")
const browserSetOverlayApplyBtn = $("browser-set-overlay-apply")
const browserSetOverlayDiscardBtn = $("browser-set-overlay-discard")

const autoCheckUpdatesInput = $("auto-check-updates")
const caseSensitiveInput = $("case-sensitive")
const caseSensitiveStatusEl = $("case-sensitive-status")
const matchPrioritySelect = $("match-priority")
const matchPriorityStatusEl = $("match-priority-status")
const renderModeSelect = $("render-mode")
const renderModeStatusEl = $("render-mode-status")
const siteRenderModeSelect = $("site-render-mode")
const siteRenderModeStatusEl = $("site-render-mode-status")
const updateCheckIntervalSelect = $("update-check-interval")
const updateLastCheckedEl = $("update-last-checked")
const checkUpdateNowBtn = $("check-update-now")
const updateCheckStatusEl = $("update-check-status")
const exportSettingsBtn = $("export-settings")
const importSettingsBtn = $("import-settings")
const settingsStatusEl = $("settings-status")
const refreshSiteRulesBtn = $("refresh-site-rules")
const forceReinitializeBtn = $("force-reinitialize")
const siteRulesSummaryEl = $("site-rules-summary")
const siteRulesStatusEl = $("site-rules-status")
const dataVersionEl = $("data-version")
const dataEmotesEl = $("data-emotes")
const dataChannelsEl = $("data-channels")
const dataExcludedEl = $("data-excluded")
const dataMatchingEl = $("data-matching")
const dataPerformanceEl = $("data-performance")
const dataDraftEl = $("data-draft")
const dataStorageEl = $("data-storage")

let hostname = null
let currentTabUrl = null
let isUnsupportedSite = false
let siteNote = null
let siteRuleFlag = null
let siteRuleCount = 0
let siteRulesCachedAt = null
let draft = { customSets: [], channelSettings: {} }
let saved = { customSets: [], channelSettings: {} }

const draftChannelSets = channelId => draft.customSets.filter(set => set.channelId === channelId)
let savedSerialized = JSON.stringify({
    caseSensitive: false,
    channelSettings: {},
    customSets: [],
    excludedEmote: [],
    emoteSize: 2,
    matchPriority: "channel",
    renderMode: "balanced"
})
let currentChannelId = null
let popupReady = false
let lastPersistedDraft = ""
let channelOperationState = null
let initStatusState = null
let emoteLoadStatusState = null
let updateNoticeState = null
let confirmAction = null
let channelStatusHideTimer = null

let excludedEmote = []
let emoteByName = new Map()
let emoteByLowerName = new Map()
let caseSensitive = false
let matchPriority = "channel"
let renderMode = "balanced"
let siteRenderModes = {}
let loadedEmoteList = []
let browserMode = "channels"
let browserPreviewBySet = new Map()
let browserPreviewLoading = new Set()
let browserPreviewError = new Map()
let browserSetSelection = null
let exclusionMatcher = () => false

const cleanMatchPriority = (value) => value === "case" ? "case" : "channel"
const cleanRenderMode = (value) => ["light", "balanced", "full"].includes(value) ? value : "balanced"
const cleanEmoteSize = (value) => [1, 2, 3, 4].includes(Number(value)) ? Number(value) : 2
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
const emoteSourceId = emote => String(
    emote && emote.channelId
        ? emote.channelId
        : emote && emote.channelName
            ? `legacy:${emote.channelName}`
            : "global"
)
const sameEmoteName = (left, right, matchCase = false) => matchCase
    ? String(left) === String(right)
    : String(left).toLowerCase() === String(right).toLowerCase()
function makeExclusionMatcher(rules, matchCase = false) {
    const global = new Set()
    const bySource = new Set()
    for (const item of cleanExcludedEmote(rules)) {
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
function isEmoteExcluded(emote, rules = excludedEmote, matchCase = caseSensitive) {
    if (rules === excludedEmote && matchCase === caseSensitive) return exclusionMatcher(emote)
    return makeExclusionMatcher(rules, matchCase)(emote)
}
function fillDraft(value, fallback = {}) {
    const src = value && Array.isArray(value.customSets) && value.channelSettings
        && typeof value.channelSettings === "object" && !Array.isArray(value.channelSettings)
        ? value
        : {}
    return {
        customSets: cloneState(src.customSets || fallback.customSets || []),
        channelSettings: cloneState(src.channelSettings || fallback.channelSettings || {}),
        excludedEmote: cleanExcludedEmote(
            Array.isArray(src.excludedEmote) ? src.excludedEmote : fallback.excludedEmote || []
        ),
        emoteSize: cleanEmoteSize(src.emoteSize || fallback.emoteSize),
        caseSensitive: src.caseSensitive === undefined
            ? fallback.caseSensitive === true
            : src.caseSensitive === true,
        matchPriority: cleanMatchPriority(src.matchPriority || fallback.matchPriority),
        renderMode: cleanRenderMode(src.renderMode || fallback.renderMode)
    }
}

function syncDraftGlobals() {
    excludedEmote = cleanExcludedEmote(draft.excludedEmote)
    draft.excludedEmote = excludedEmote
    caseSensitive = draft.caseSensitive === true
    exclusionMatcher = makeExclusionMatcher(excludedEmote, caseSensitive)
    matchPriority = cleanMatchPriority(draft.matchPriority)
    renderMode = cleanRenderMode(draft.renderMode)
    emoteSizeInput.value = cleanEmoteSize(draft.emoteSize)
    emoteSizeValue.textContent = `${emoteSizeInput.value}x`
    caseSensitiveInput.checked = caseSensitive
    matchPrioritySelect.value = matchPriority
    renderModeSelect.value = renderMode
}

function setPopupEmote(emote) {
    loadedEmoteList = (Array.isArray(emote) ? emote : []).map(item => {
        if (item && item.channelId) return item
        const channelName = item && item.channelName ? item.channelName : "Global 7TV"
        const source = item && item.channelName
            ? draft.customSets.find(set => set.channelName === item.channelName)
            : null
        return {
            ...item,
            channelId: source ? source.channelId : item && item.channelName ? `legacy:${item.channelName}` : "global",
            channelName,
            setId: item && item.setId || source && source.id || "global",
            setName: item && item.setName || source && source.setName || channelName
        }
    })
    emoteByName = new Map()
    emoteByLowerName = new Map()
    for (const item of loadedEmoteList) {
        emoteByName.set(`${emoteSourceId(item)}\0${item.name}`, item)
        const name = String(item.name).toLowerCase()
        const variant = emoteByLowerName.get(name) || []
        variant.push(item)
        emoteByLowerName.set(name, variant)
    }
    if (popupReady && typeof renderEmoteBrowser === "function") renderEmoteBrowser(true)
}

function findPopupEmote(name) {
    const variants = emoteByLowerName.get(String(name).toLowerCase()) || []
    const variant = variants.filter(item =>
        (!caseSensitive || item.name === name) && !isEmoteExcluded(item)
    )
    if (!variant.length) return null
    return variant.reduce((best, item) => {
        const score = caseFit(name, item.name)
        const bestScore = caseFit(name, best.name)
        const itemPriority = item.priority || 0
        const bestPriority = best.priority || 0
        const better = matchPriority === "case"
            ? score > bestScore || (score === bestScore && itemPriority > bestPriority)
            : itemPriority > bestPriority || (itemPriority === bestPriority && score > bestScore)
        return better ? item : best
    })
}

function caseFit(input, name) {
    let score = 0
    for (let i = 0; i < Math.min(input.length, name.length); i++)
        if (input[i] === name[i]) score++
    return score
}

// svg thing
const SVG_NS = "http://www.w3.org/2000/svg"
const clone = (el) => [...el.childNodes].map(node => node.cloneNode(true))
const errorText = (value, fallback = "Something went wrong") => {
    const raw = value instanceof Error ? value.message : String(value || fallback)
    const text = raw.replace(/^Error:\s*/i, "").replace(/[.!?…\s]+$/, "").trim()
    return `${text || fallback}...`
}
function makeIcon(type) {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.classList.add("icon")
    svg.setAttribute("viewBox", "0 0 16 16")
    svg.setAttribute("aria-hidden", "true")

    if (type === "remove") {
        svg.setAttribute("fill", "none")
        const path = document.createElementNS(SVG_NS, "path")
        path.setAttribute("d", "M3.7 3.7 12.3 12.3M12.3 3.7 3.7 12.3")
        path.setAttribute("stroke", "currentColor")
        path.setAttribute("stroke-width", "1.4")
        path.setAttribute("stroke-linecap", "round")
        svg.appendChild(path)
        return svg
    }

    svg.setAttribute("fill", "currentColor")
    if (type === "star") {
        svg.classList.add("star-icon")
        const path = document.createElementNS(SVG_NS, "path")
        path.setAttribute("d", "M8 1.5l1.9 4.2 4.6.5-3.4 3.1.9 4.6L8 11.6l-4 2.3.9-4.6-3.4-3.1 4.6-.5L8 1.5z")
        svg.appendChild(path)
        return svg
    }

    for (const x of [5, 10]) for (const y of [4, 8, 12]) {
        const circle = document.createElementNS(SVG_NS, "circle")
        circle.setAttribute("cx", String(x))
        circle.setAttribute("cy", String(y))
        circle.setAttribute("r", "1.1")
        svg.appendChild(circle)
    }
    return svg
}
