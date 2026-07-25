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
const panelExcluded = $("panel-excluded")
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

const excludeInput = $("exclude-input")
const excludeAddBtn = $("exclude-add")
const excludeHint = $("exclude-hint")
const excludeSearchResultsEl = $("exclude-search-results")
const excludedListEl = $("excluded-list")
const excludedEmptyEl = $("excluded-empty")

const autoCheckUpdatesInput = $("auto-check-updates")
const caseSensitiveInput = $("case-sensitive")
const caseSensitiveStatusEl = $("case-sensitive-status")
const matchPrioritySelect = $("match-priority")
const matchPriorityStatusEl = $("match-priority-status")
const renderModeSelect = $("render-mode")
const renderModeStatusEl = $("render-mode-status")
const updateCheckIntervalSelect = $("update-check-interval")
const updateLastCheckedEl = $("update-last-checked")
const checkUpdateNowBtn = $("check-update-now")
const updateCheckStatusEl = $("update-check-status")
const exportSettingsBtn = $("export-settings")
const importSettingsBtn = $("import-settings")
const importSettingsFile = $("import-settings-file")
const settingsStatusEl = $("settings-status")
const refreshSiteRulesBtn = $("refresh-site-rules")
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
let excludeSearchTimer = null

const cleanMatchPriority = (value) => value === "case" ? "case" : "channel"
const cleanRenderMode = (value) => ["light", "balanced", "full"].includes(value) ? value : "balanced"
const cleanEmoteSize = (value) => [1, 2, 3, 4].includes(Number(value)) ? Number(value) : 2
function fillDraft(value, fallback = {}) {
    const src = value && Array.isArray(value.customSets) && value.channelSettings
        && typeof value.channelSettings === "object" && !Array.isArray(value.channelSettings)
        ? value
        : {}
    return {
        customSets: cloneState(src.customSets || fallback.customSets || []),
        channelSettings: cloneState(src.channelSettings || fallback.channelSettings || {}),
        excludedEmote: Array.from(new Set(
            (Array.isArray(src.excludedEmote) ? src.excludedEmote : fallback.excludedEmote || [])
                .filter(name => typeof name === "string")
        )),
        emoteSize: cleanEmoteSize(src.emoteSize || fallback.emoteSize),
        caseSensitive: src.caseSensitive === undefined
            ? fallback.caseSensitive === true
            : src.caseSensitive === true,
        matchPriority: cleanMatchPriority(src.matchPriority || fallback.matchPriority),
        renderMode: cleanRenderMode(src.renderMode || fallback.renderMode)
    }
}

function syncDraftGlobals() {
    excludedEmote = Array.isArray(draft.excludedEmote) ? draft.excludedEmote : []
    caseSensitive = draft.caseSensitive === true
    matchPriority = cleanMatchPriority(draft.matchPriority)
    renderMode = cleanRenderMode(draft.renderMode)
    emoteSizeInput.value = cleanEmoteSize(draft.emoteSize)
    emoteSizeValue.textContent = `${emoteSizeInput.value}x`
    caseSensitiveInput.checked = caseSensitive
    matchPrioritySelect.value = matchPriority
    renderModeSelect.value = renderMode
}

function setPopupEmote(emote) {
    emoteByName = new Map(emote.map(item => [item.name, item]))
    emoteByLowerName = new Map()
    for (const item of emote) {
        const name = item.name.toLowerCase()
        const variant = emoteByLowerName.get(name) || []
        variant.push(item)
        emoteByLowerName.set(name, variant)
    }
}

function findPopupEmote(name) {
    const isExcluded = excludedEmote.some(item =>
        caseSensitive ? item === name : String(item).toLowerCase() === String(name).toLowerCase()
    )
    if (isExcluded) return null
    if (caseSensitive) return emoteByName.get(name)
    const variant = emoteByLowerName.get(String(name).toLowerCase())
    if (!variant || !variant.length) return null
    return variant.reduce((best, item) => {
        const score = caseFit(name, item.name)
        const bestScore = caseFit(name, best.name)
        const itemPriority = item.priority || 0
        const bestPriority = best.priority || 0
        return matchPriority === "case"
            ? (score > bestScore || (score === bestScore && itemPriority > bestPriority))
            : (itemPriority > bestPriority || (itemPriority === bestPriority && score > bestScore))
            ? item
            : best
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
