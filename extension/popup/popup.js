/** @type {typeof chrome} */
const ext = typeof browser === "undefined" ? chrome : browser

// svg
const REMOVE_ICON = `<svg class="icon" viewBox="0 0 16 16" fill="none"><path d="M3.7 3.7 12.3 12.3M12.3 3.7 3.7 12.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
const STAR_ICON = `<svg class="icon star-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l1.9 4.2 4.6.5-3.4 3.1.9 4.6L8 11.6l-4 2.3.9-4.6-3.4-3.1 4.6-.5L8 1.5z"/></svg>`
const DRAG_ICON = `<svg class="icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="1.1"/><circle cx="5" cy="8" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="10" cy="12" r="1.1"/></svg>`

// element
const $ = (id) => document.getElementById(id)
const toggleEnabledBtn = $("toggle-enabled")
const toggleSiteBtn = $("toggle-site")
const siteLabel = $("site-label")

const updateBanner = $("update-banner")
const updateBannerText = $("update-banner-text")
const updateBannerLink = $("update-banner-link")

const unsupportedBanner = $("unsupported-banner")
const unsupportedBannerNote = $("unsupported-banner-note")
const siteNoteBanner = $("site-note-banner")
const siteNoteText = $("site-note-text")

const tabBtns = document.querySelectorAll(".tab-btn")
const panelEmotes = $("panel-emotes")
const panelExcluded = $("panel-excluded")

const viewHome = $("view-home")
const viewManage = $("view-manage")

const channelQueryInput = $("channel-query")
const findSetsBtn = $("find-sets")
const findHint = $("find-hint")

const channelsSummaryEl = $("channels-summary")
const channelCardsEl = $("channel-cards")
const channelsEmptyEl = $("channels-empty")

const emoteSizeInput = $("emote-size")
const emoteSizeValue = $("emote-size-value")
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
const saveHintEl = $("save-hint")

const confirmOverlay = $("confirm-overlay")
const confirmSaveBtn = $("confirm-save")
const confirmDiscardBtn = $("confirm-discard")
const confirmCancelBtn = $("confirm-cancel")

const excludeInput = $("exclude-input")
const excludeAddBtn = $("exclude-add")
const excludeHint = $("exclude-hint")
const excludeSearchResultsEl = $("exclude-search-results")
const excludedListEl = $("excluded-list")
const excludedEmptyEl = $("excluded-empty")

let hostname = null
let isUnsupportedSite = false
let siteNote = null
let draft = { customSets: [], channelSettings: {} }
let saved = { customSets: [], channelSettings: {} }
let currentChannelId = null

let excludedEmote = []
let emoteByName = new Map()
let excludeSearchTimer = null

init()
async function init() {
    const tabInfo = await getTabInfo()
    hostname = tabInfo.hostname
    if (hostname) siteLabel.textContent = hostname
    else {
        toggleSiteBtn.disabled = true
        siteLabel.textContent = "this site"
    }
    const verdict = tabInfo.url ? await getVerdict(tabInfo.url) : { unsupported: false, note: null }
    isUnsupportedSite = verdict.unsupported
    siteNote = verdict.note
    renderBanners()

    const {
        enabled = true,
        disabledSites = [],
        enabledUnsupportedSites = [],
        customSets: storedSets = [],
        channelSettings: storedChannelSettings = {},
        emoteSize = 2,
        emoteSet = [],
        excludedEmote: storedExcluded = [],
        lastReWarn = null
    } = await ext.storage.local.get([
        "enabled", "disabledSites", "enabledUnsupportedSites", "customSets", "channelSettings",
        "emoteSize", "emoteSet", "excludedEmote", "lastReWarn"
    ])

    setSwitch(toggleEnabledBtn, enabled)
    const siteOn = hostname
        ? (isUnsupportedSite ? enabledUnsupportedSites.includes(hostname) : !disabledSites.includes(hostname))
        : true
    setSwitch(toggleSiteBtn, siteOn)

    const migrated = migrateSet(storedSets)
    saved = { customSets: migrated, channelSettings: storedChannelSettings || {} }
    draft = cloneState(saved)

    emoteSizeInput.value = emoteSize
    emoteSizeValue.textContent = `${emoteSize}x`

    setCount(emoteSet.length)
    emoteByName = new Map((emoteSet || []).map(e => [e.name, e]))
    excludedEmote = storedExcluded

    if (lastReWarn) reloadWarningEl.textContent = lastReWarn
    renderHome()
    renderExcluded()
    updateSaveBar()
    checkBanner()
    reEmoteCount()
}

async function reEmoteCount() {
    try {
        const { emotes } = await ext.runtime.sendMessage({ type: "GET_EMOTES" })
        if (!emotes) return

        setCount(emotes.length)
        emoteByName = new Map(emotes.map(e => [e.name, e]))
        renderExcluded()

        const { lastReWarn = null } = await ext.storage.local.get("lastReWarn")
        reloadWarningEl.textContent = lastReWarn || ""
    } catch { }
}

// helpers
function safeHTML(v = '') {
    const el = document.createElement("span")
    el.textContent = String(v ?? '')
    el.remove()
    return el.innerHTML ?? ''
}

const migrateSet = (stored) => stored.map(s => {
    if (s.channelId) return s
    const [channelName, setName] = (s.label || "").split(" \u2013 ").length === 2
        ? s.label.split(" \u2013 ")
        : [s.label || s.id, s.label || s.id]

    return {
        id: s.id,
        setName: setName || s.label || s.id,
        count: null,
        preview: [],
        channelId: channelName || s.id,
        channelName: channelName || s.id,
        enabled: true
    }
})

async function getTabInfo() {
    try {
        const [tab] = await ext.tabs.query({ active: true, currentWindow: true })
        if (!tab || !tab.url) return { hostname: null, url: null }
        return { hostname: new URL(tab.url).hostname || null, url: tab.url }
    } catch { return { hostname: null, url: null } }
}

async function getVerdict(url) {
    try {
        const res = await ext.runtime.sendMessage({ type: "IS_SITE_UNSUPPORTED", url })
        return { unsupported: !!(res && res.unsupported), note: (res && res.note) || null }
    } catch { return { unsupported: false, note: null } }
}

function renderBanners() {
    unsupportedBanner.classList.toggle("hidden", !isUnsupportedSite)
    const showNote = isUnsupportedSite && !!siteNote
    unsupportedBannerNote.classList.toggle("hidden", !showNote)
    if (showNote) unsupportedBannerNote.textContent = `Maintainer note: ${siteNote}`

    const showSiteNote = !isUnsupportedSite && !!siteNote
    siteNoteBanner.classList.toggle("hidden", !showSiteNote)
    if (showSiteNote) siteNoteText.textContent = siteNote
}

const cloneState = (state) => JSON.parse(JSON.stringify(state))
const setSwitch = (btn, on) => btn.setAttribute("aria-checked", on ? "true" : "false")
const isOn = (btn) => btn.getAttribute("aria-checked") === "true"
const setCount = (count) => emoteCountEl.textContent = count ? `${count} emotes loaded` : ""



tabBtns.forEach(btn => btn.addEventListener("click", () => {
    tabBtns.forEach(b => {
        b.classList.toggle("is-active", b === btn)
        b.setAttribute("aria-selected", b === btn ? "true" : "false")
    })

    const isEmote = btn.dataset.tab === "emotes"
    panelEmotes.hidden = !isEmote
    panelExcluded.hidden = isEmote
}))

toggleEnabledBtn.addEventListener("click", async () => {
    const next = !isOn(toggleEnabledBtn)
    setSwitch(toggleEnabledBtn, next)
    await ext.storage.local.set({ enabled: next })
})

toggleSiteBtn.addEventListener("click", async () => {
    if (!hostname) return
    const next = !isOn(toggleSiteBtn)
    setSwitch(toggleSiteBtn, next)

    if (isUnsupportedSite) {
        const { enabledUnsupportedSites = [] } = await ext.storage.local.get("enabledUnsupportedSites")
        const updated = next
            ? Array.from(new Set([...enabledUnsupportedSites, hostname]))
            : enabledUnsupportedSites.filter(h => h !== hostname)

        await ext.storage.local.set({ enabledUnsupportedSites: updated })
        return
    }

    const { disabledSites = [] } = await ext.storage.local.get("disabledSites")
    const updated = next
        ? disabledSites.filter(h => h !== hostname)
        : Array.from(new Set([...disabledSites, hostname]))

    await ext.storage.local.set({ disabledSites: updated })
})

async function checkBanner() {
    let hid = true
    try {
        const result = await ext.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" })
        const info = result && result.updateInfo
        if (info && info.updateAvailable) {
            updateBannerText.textContent = `Update available: v${info.latestVersion} (you're on v${info.currentVersion}).`
            updateBannerLink.href = "https://github.com/aitji/7tv-anywhere/releases"
            hid = false
        }
    } catch { }

    if (hid) updateBanner.classList.add(['hidden'])
    else updateBanner.classList.remove(['hidden'])
}

findSetsBtn.addEventListener("click", findChannel)
channelQueryInput.addEventListener("keydown", e => (e.key === "Enter") && findChannel())

async function findChannel() {
    const query = channelQueryInput.value.trim()
    findHint.textContent = ""
    findHint.classList.remove("error")

    if (!query) return
    findSetsBtn.textContent = "..."
    findSetsBtn.disabled = true

    const res = await ext.runtime.sendMessage({ type: "RESOLVE_CHANNEL", query })
    findSetsBtn.textContent = "Find"
    findSetsBtn.disabled = false

    if (!res || res.error) {
        findHint.textContent = (res && res.error) || "Something went wrong."
        findHint.classList.add("error")
        return
    }

    if (res.type === "set") {
        const alrAdd = draft.customSets.some(s => s.id === res.set.id)
        addSetDraft([{
            id: res.set.id,
            setName: res.set.name,
            count: res.set.count,
            preview: res.set.preview || [],
            channelId: res.set.id,
            channelName: res.set.name,
            enabled: true
        }])
        channelQueryInput.value = ""
        findHint.textContent = alrAdd
            ? `"${res.set.name}" is already in your draft.`
            : `Added "${res.set.name}" to your draft. click Save to apply.`
        return
    }

    if (!res.sets.length)
        return findHint.textContent = `${res.channel.name} doesn't have any public emote sets.`

    const alrTrack = new Set(draft.customSets.filter(s => s.channelId === res.channel.id).map(s => s.id))
    const newEntries = res.sets
        .filter(set => !alrTrack.has(set.id))
        .map(set => ({
            id: set.id,
            setName: set.name,
            count: set.count,
            preview: set.preview || [],
            channelId: res.channel.id,
            channelName: res.channel.name,
            enabled: set.id === res.activeSetId
        }))

    draft.channelSettings[res.channel.id] = {
        alwaysMain: true,
        ...(draft.channelSettings[res.channel.id] || {}),
        knownActiveSetId: res.activeSetId
    }

    const activeSet = res.sets.find(s => s.id === res.activeSetId)
    if (!newEntries.length) {
        findHint.textContent = `${res.channel.name} is already fully tracked, open Manage to change what's enabled.`
        renderHome()
        updateSaveBar()
    } else {
        addSetDraft(newEntries)
        channelQueryInput.value = ""
        findHint.textContent = activeSet
            ? `Added ${res.channel.name}'s ${newEntries.length} set${newEntries.length === 1 ? "" : "s"}. only "${activeSet.name}" is enabled by default. Open Manage to pick different ones. Click Save to apply.`
            : `Added ${res.channel.name}'s ${newEntries.length} set${newEntries.length === 1 ? "" : "s"} (all start disabled, open Manage to enable one). Click Save to apply.`
    }
}

const addSetDraft = (entries) => {
    for (const entry of entries)
        if (!draft.customSets.some(s => s.id === entry.id))
            draft.customSets.push(entry)

    renderHome()
    updateSaveBar()
}

const groupByChannel = (customSets) => {
    const map = new Map()
    for (const set of customSets) {
        if (!map.has(set.channelId)) map.set(set.channelId, { channelId: set.channelId, channelName: set.channelName, sets: [] })
        map.get(set.channelId).sets.push(set)
    }

    return Array.from(map.values())
}

const sumEmotes = (sets) => sets.filter(s => s.enabled !== false).reduce((total, s) => total + (s.count || 0), 0)
function renderHome() {
    const C = groupByChannel(draft.customSets).reverse()
    const activeC = C.filter(c => c.sets.some(s => s.enabled !== false))

    channelsEmptyEl.style.display = C.length ? "none" : "block"
    channelsSummaryEl.textContent = C.length
        ? `${activeC.length}/${C.length} active ~${sumEmotes(draft.customSets)} emotes`
        : ""

    channelCardsEl.innerHTML = ""
    C.forEach((c, i) => channelCardsEl.appendChild(renderCCard(c, i)))
}


function makeSwitch(on, { small = false, disabled = false, title = "" } = {}) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "switch" + (small ? " switch-sm" : "") + (disabled ? " switch-disabled" : "")
    btn.setAttribute("role", "switch")
    btn.setAttribute("aria-checked", on ? "true" : "false")
    if (title) btn.title = title
    btn.disabled = disabled
    btn.innerHTML = '<span class="switch-knob"></span>'
    return btn
}

function renderCCard(channel, index) {
    const enabledSet = channel.sets.filter(s => s.enabled !== false)
    const channelOn = enabledSet.length > 0
    const alwayMain = !!(draft.channelSettings[channel.channelId] || {}).alwaysMain

    const card = document.createElement("div")
    card.className = "card card-draggable" + (alwayMain ? " is-main-set" : "")
    card.draggable = true
    card.dataset.channelId = channel.channelId

    card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", channel.channelId)
    })
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging")
        commitOrderDOM()
    })

    const top = document.createElement("div")
    top.className = "card-top"

    const dragHandle = document.createElement("span")
    dragHandle.className = "drag-handle"
    dragHandle.innerHTML = DRAG_ICON
    dragHandle.title = "Drag to reorder priority"
    top.appendChild(dragHandle)

    const prioBadge = document.createElement("span")
    prioBadge.className = "priority-badge"
    prioBadge.textContent = index + 1
    prioBadge.title = "Priority order, channels higher in the list win when emote names collide"
    top.appendChild(prioBadge)

    const name = document.createElement("span")
    name.className = "card-name"
    name.innerHTML = (alwayMain ? STAR_ICON : "") + `<span class="card-name-text"></span>`
    name.querySelector("span").textContent = channel.channelName
    name.querySelector("span").title = channel.channelName
    top.appendChild(name)

    const removeBtn = document.createElement("button")
    removeBtn.className = "card-icon-btn"
    removeBtn.innerHTML = REMOVE_ICON
    removeBtn.title = "Remove this channel and all of its sets"
    removeBtn.addEventListener("click", () => {
        draft.customSets = draft.customSets.filter(s => s.channelId !== channel.channelId)
        delete draft.channelSettings[channel.channelId]
        renderHome()
        updateSaveBar()
    })
    top.appendChild(removeBtn)
    card.appendChild(top)

    const sub = document.createElement("div")
    sub.className = "card-sub"
    sub.textContent = alwayMain
        ? "Always following the channel's current main set"
        : `${enabledSet.length}/${channel.sets.length} active sets · ~${sumEmotes(channel.sets)} emotes`
    card.appendChild(sub)

    const previewEmote = dedupePreview(enabledSet.flatMap(s => s.preview || []))
    if (previewEmote.length) {
        const strip = document.createElement("div")
        strip.className = "preview-strip"
        previewEmote.slice(0, 20).forEach(e => {
            const img = document.createElement("img")
            img.src = e.url
            img.alt = e.name
            img.title = e.name
            img.loading = "lazy"
            strip.appendChild(img)
        })
        card.appendChild(strip)
    }

    const bottom = document.createElement("div")
    bottom.className = "card-bottom"

    const status = document.createElement("span")
    status.className = "card-status " + (channelOn ? "on" : "off")
    status.textContent = channelOn ? "Enabled" : "Disabled"
    bottom.appendChild(status)

    const action = document.createElement("div")
    action.className = "card-actions"

    const quickToggle = makeSwitch(channelOn, { title: channelOn ? "Disable all sets for this channel" : "Re-enable this channel's previous sets" })
    quickToggle.addEventListener("click", () => {
        const pref = draft.channelSettings[channel.channelId] || {}

        if (channelOn) {
            draft.channelSettings[channel.channelId] = {
                ...pref,
                lastEnabledSetIds: channel.sets.filter(s => s.enabled !== false).map(s => s.id)
            }
            channel.sets.forEach(s => { s.enabled = false })
        } else {
            const remembered = pref.lastEnabledSetIds
            if (remembered && remembered.length) channel.sets.forEach(s => { s.enabled = remembered.includes(s.id) })
            else channel.sets.forEach(s => { s.enabled = true })
        }

        renderHome()
        updateSaveBar()
    })
    action.appendChild(quickToggle)

    const manageBtn = document.createElement("button")
    manageBtn.className = "btn-secondary"
    manageBtn.textContent = "Manage"
    manageBtn.addEventListener("click", () => openManageView(channel.channelId))
    action.appendChild(manageBtn)

    bottom.appendChild(action)
    card.appendChild(bottom)

    return card
}

channelCardsEl.addEventListener("dragover", (e) => {
    const drag = channelCardsEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterEl = getDragEl(channelCardsEl, e.clientY)
    if (afterEl == null) channelCardsEl.appendChild(drag)
    else channelCardsEl.insertBefore(drag, afterEl)
})

function getDragEl(container, y) {
    const cards = [...container.querySelectorAll(".card-draggable:not(.dragging)")]
    return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) return { offset, element: child }

        return closest
    }, { offset: Number.NEGATIVE_INFINITY }).element
}

function commitOrderDOM() {
    const visualId = [...channelCardsEl.querySelectorAll(".card-draggable")].map(el => el.dataset.channelId)
    if (!visualId.length) return

    const channelId = new Map(groupByChannel(draft.customSets).map(c => [c.channelId, c]))
    draft.customSets = visualId
        .slice()
        .reverse()
        .flatMap(id => (channelId.get(id) || { sets: [] }).sets)

    renderHome()
    updateSaveBar()
}

function dedupePreview(previews) {
    const seen = new Set()
    const out = []
    for (const p of previews) {
        if (!p || !p.url || seen.has(p.name)) continue
        seen.add(p.name)
        out.push(p)
    }
    return out
}


const openManageView = (id) => {
    currentChannelId = id
    viewHome.hidden = true
    viewManage.hidden = false
    renderManageView()
}

const closeManageView = () => {
    currentChannelId = null
    viewManage.hidden = true
    viewHome.hidden = false
    renderHome()
}

backBtn.addEventListener("click", () => confirmDirty(closeManageView))
function confirmDirty(proceed) {
    if (!isDirty()) return proceed()

    confirmOverlay.hidden = false
    const cleanup = () => {
        confirmOverlay.hidden = true
        confirmSaveBtn.removeEventListener("click", onSave)
        confirmDiscardBtn.removeEventListener("click", onDiscard)
        confirmCancelBtn.removeEventListener("click", onCancel)
    }

    const onCancel = () => cleanup()
    const onSave = async () => {
        cleanup()
        await saveDraft()
        proceed()
    }
    const onDiscard = () => {
        cleanup()
        draft = cloneState(saved)
        updateSaveBar()
        proceed()
    }

    confirmSaveBtn.addEventListener("click", onSave)
    confirmDiscardBtn.addEventListener("click", onDiscard)
    confirmCancelBtn.addEventListener("click", onCancel)
}

window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return
    e.preventDefault()
    e.returnValue = ""
})

const asChannelSet = () => draft.customSets.filter(s => s.channelId === currentChannelId)
function renderManageView() {
    const set = asChannelSet().slice().reverse()
    if (!set.length) return closeManageView()

    const name = set[0].channelName
    const enabled = set.filter(s => s.enabled !== false)
    const pref = draft.channelSettings[currentChannelId] || {}

    manageChannelTitle.textContent = name
    manageChannelSummary.textContent = `${enabled.length}/${set.length} active sets ~${sumEmotes(set)} emotes`
    manageChannelStatus.textContent = ""
    alwaysMainToggle.checked = !!pref.alwaysMain

    manageOverlapWarning.hidden = pref.alwaysMain || enabled.length <= 1
    if (!manageOverlapWarning.hidden) manageOverlapWarning.textContent = "More than one set is enabled here, emotes that share a name between them will override each other, so results may vary depending on load order."

    const activeSet = pref.knownActiveSetId && set.find(s => s.id === pref.knownActiveSetId)
    if (activeSet) {
        alwaysMainActive.hidden = false
        alwaysMainActive.textContent = pref.alwaysMain
            ? `Following ${name}'s current main set: "${activeSet.setName}".`
            : `${name}'s current main set on 7TV is "${activeSet.setName}".`
    } else alwaysMainActive.hidden = true

    manageSetListEl.innerHTML = ""
    set.forEach((set, index) => manageSetListEl.appendChild(renderSetCard(set, pref, index)))
}

function renderSetCard(set, pref, index) {
    const willActive = pref.knownActiveSetId && set.id === pref.knownActiveSetId
    const locked = !!pref.alwaysMain

    const card = document.createElement("div")
    card.className = "card card-draggable" + (willActive ? " is-main-set" : "")
    card.draggable = true
    card.dataset.setId = set.id

    card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", set.id)
    })
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging")
        commitOrderDOM()
    })

    const top = document.createElement("div")
    top.className = "card-top"

    const dragHandle = document.createElement("span")
    dragHandle.className = "drag-handle"
    dragHandle.innerHTML = DRAG_ICON
    dragHandle.title = "Drag to reorder priority"
    top.appendChild(dragHandle)

    const prioBadge = document.createElement("span")
    prioBadge.className = "priority-badge"
    prioBadge.textContent = index + 1
    prioBadge.title = "Priority order, sets higher in the list win when emote names collide"
    top.appendChild(prioBadge)

    const name = document.createElement("span")
    name.className = "card-name"
    name.innerHTML = (willActive ? STAR_ICON : "") + '<span class="card-name-text"></span>'
    name.querySelector("span").textContent = set.setName
    name.querySelector("span").title = set.setName
    top.appendChild(name)

    const removeBtn = document.createElement("button")
    removeBtn.className = "card-icon-btn"
    removeBtn.innerHTML = REMOVE_ICON
    removeBtn.title = "Remove this set"
    removeBtn.addEventListener("click", () => {
        draft.customSets = draft.customSets.filter(s => s !== set)
        renderManageView()
        updateSaveBar()
    })
    top.appendChild(removeBtn)
    card.appendChild(top)

    const sub = document.createElement("div")
    sub.className = "card-sub"
    sub.textContent = willActive
        ? `${set.count ?? "?"} emotes · currently active on the channel`
        : `${set.count ?? "?"} emotes`
    card.appendChild(sub)

    if (set.preview && set.preview.length) {
        const strip = document.createElement("div")
        strip.className = "preview-strip"
        set.preview.slice(0, 8).forEach(e => {
            const img = document.createElement("img")
            img.src = e.url
            img.alt = e.name
            img.title = e.name
            img.loading = "lazy"
            strip.appendChild(img)
        })
        card.appendChild(strip)
    }

    const bottom = document.createElement("div")
    bottom.className = "card-bottom"

    const on = set.enabled !== false
    const status = document.createElement("span")
    status.className = "card-status " + (on ? "on" : "off")
    status.textContent = locked ? (on ? "Enabled (following main)" : "Disabled") : (on ? "Enabled" : "Disabled")
    bottom.appendChild(status)

    const toggle = makeSwitch(on, {
        disabled: locked,
        title: locked ? 'Turn off "Always use main channel emote set" to control sets individually' : ''
    })

    if (!locked) toggle.addEventListener("click", () => {
        set.enabled = !on
        renderManageView()
        updateSaveBar()
    })
    bottom.appendChild(toggle)
    card.appendChild(bottom)

    return card
}

manageSetListEl.addEventListener("dragover", (e) => {
    const drag = manageSetListEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterElement = getDragEl(manageSetListEl, e.clientY)
    if (afterElement == null) manageSetListEl.appendChild(drag)
    else manageSetListEl.insertBefore(drag, afterElement)
})

function commitOrderDOM() {
    const visual = [...manageSetListEl.querySelectorAll(".card-draggable")].map(el => el.dataset.setId)
    if (!visual.length) return

    const byId = new Map(draft.customSets.filter(s => s.channelId === currentChannelId).map(s => [s.id, s]))
    const orderChannel = visual.slice().reverse().map(id => byId.get(id)).filter(Boolean)

    let i = 0
    draft.customSets = draft.customSets.map(s => s.channelId === currentChannelId ? orderChannel[i++] : s)

    renderManageView()
    updateSaveBar()
}

alwaysMainToggle.addEventListener("change", () => {
    const sets = asChannelSet()
    if (!sets.length) return

    const pref = draft.channelSettings[currentChannelId] || {}
    if (alwaysMainToggle.checked) {
        const mainId = pref.knownActiveSetId || sets[0].id
        sets.forEach(s => { s.enabled = s.id === mainId })
        draft.channelSettings[currentChannelId] = { ...pref, alwaysMain: true }
    } else draft.channelSettings[currentChannelId] = { ...pref, alwaysMain: false }

    renderManageView()
    updateSaveBar()
})

refreshMainNowBtn.addEventListener("click", async () => {
    refreshMainNowBtn.disabled = true
    const originalHtml = refreshMainNowBtn.innerHTML
    refreshMainNowBtn.textContent = "Refreshing..."
    const result = await ext.runtime.sendMessage({ type: "REFRESH_CHANNEL", channelId: currentChannelId })
    refreshMainNowBtn.innerHTML = originalHtml
    refreshMainNowBtn.disabled = false

    if (!result || result.error || result.type !== "channel")
        return manageChannelStatus.textContent = (result && result.error) || "Couldn't refresh this channel."

    applyActiveSetInfo(result)
    manageChannelStatus.textContent = "Refreshed."
    renderManageView()
    updateSaveBar()
})

function applyActiveSetInfo(result) {
    const pref = draft.channelSettings[currentChannelId] || {}
    const activeSet = result.sets.find(s => s.id === result.activeSetId)
    let sets = asChannelSet()

    if (activeSet && !sets.some(s => s.id === activeSet.id)) {
        draft.customSets.push({
            id: activeSet.id,
            setName: activeSet.name,
            count: activeSet.count,
            preview: activeSet.preview || [],
            channelId: result.channel.id,
            channelName: result.channel.name,
            enabled: !!pref.alwaysMain
        })
        sets = asChannelSet()
    }

    if (pref.alwaysMain && result.activeSetId) sets.forEach(s => { s.enabled = s.id === result.activeSetId })
    draft.channelSettings[currentChannelId] = {
        ...pref,
        knownActiveSetId: result.activeSetId,
        mainRefreshedAt: Date.now()
    }
}

hardReloadChannelBtn.addEventListener("click", async () => {
    hardReloadChannelBtn.classList.add("spinning")
    hardReloadChannelBtn.disabled = true

    const result = await ext.runtime.sendMessage({ type: "REFRESH_CHANNEL", channelId: currentChannelId })
    hardReloadChannelBtn.classList.remove("spinning")
    hardReloadChannelBtn.disabled = false

    if (!result || result.error || result.type !== "channel") return manageChannelStatus.textContent = (result && result.error) || "Couldn't reach 7TV."

    const byId = new Map(result.sets.map(s => [s.id, s]))
    let changedCount = 0
    draft.customSets.forEach(s => {
        if (s.channelId !== currentChannelId) return
        const fresh = byId.get(s.id)
        if (!fresh) return
        s.setName = fresh.name
        s.count = fresh.count
        s.preview = fresh.preview || []
        changedCount++
    })

    applyActiveSetInfo(result)
    manageChannelStatus.textContent = `Reloaded from 7TV (${changedCount} set${changedCount === 1 ? "" : "s"} refreshed)`
    renderManageView()
    updateSaveBar()
})

const isDirty = () => JSON.stringify(draft) !== JSON.stringify(saved)
function updateSaveBar() {
    const dirty = isDirty()
    saveBtn.disabled = !dirty
    saveHintEl.textContent = dirty
        ? "You have unsaved changes. click Save to apply them and reload emotes."
        : "Nothing to save yet."
}

async function saveDraft() {
    saveBtn.disabled = true
    saveBtn.textContent = "Saving..."

    await ext.storage.local.set({ customSets: draft.customSets, channelSettings: draft.channelSettings })
    saved = cloneState(draft)

    saveBtn.textContent = "Save changes"
    updateSaveBar()
    await triggerReload()
}

saveBtn.addEventListener("click", saveDraft)
emoteSizeInput.addEventListener("input", () => emoteSizeValue.textContent = `${emoteSizeInput.value}x`)
reloadBtn.addEventListener("click", async () => { await triggerReload() })
emoteSizeInput.addEventListener("change", async () => {
    await ext.storage.local.set({ emoteSize: parseInt(emoteSizeInput.value, 10) })
    await triggerReload()
})

async function triggerReload() {
    const ogHTML = reloadBtn.innerHTML
    reloadBtn.textContent = "Reloading..."
    reloadBtn.disabled = true
    reloadWarningEl.textContent = ""

    try {
        const res = await ext.runtime.sendMessage({ type: "RELOAD_EMOTES" })
        if (res && res.success) {
            const emotes = res.emotes || []
            setCount(emotes.length)
            emoteByName = new Map(emotes.map(e => [e.name, e]))
            renderExcluded()
            if (res.warning) reloadWarningEl.textContent = res.warning
        } else reloadWarningEl.textContent = (res && res.error) || "Something went wrong."
    } catch { reloadWarningEl.textContent = "Something went wrong." }

    reloadBtn.innerHTML = ogHTML
    reloadBtn.disabled = false
}

function renderExcluded() {
    excludedListEl.innerHTML = ""
    excludedEmptyEl.style.display = excludedEmote.length ? "none" : "block"
    excludedEmote.forEach(name => {
        const emote = emoteByName.get(name)

        const row = document.createElement("div")
        row.className = "card excluded-row card-draggable"
        row.draggable = true
        row.dataset.emoteName = name

        row.addEventListener("dragstart", (e) => {
            row.classList.add("dragging")
            e.dataTransfer.effectAllowed = "move"
            e.dataTransfer.setData("text/plain", name)
        })
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging")
            commitExcludDOM()
        })

        const dragHandle = document.createElement("span")
        dragHandle.className = "drag-handle"
        dragHandle.innerHTML = DRAG_ICON
        dragHandle.title = "Drag to reorder"
        row.appendChild(dragHandle)

        if (emote) {
            const img = document.createElement("img")
            img.className = "excluded-thumb"
            img.src = emote.url
            img.alt = name
            row.appendChild(img)
        } else {
            const placeholder = document.createElement("div")
            placeholder.className = "excluded-thumb no-thumb"
            placeholder.textContent = "?"
            placeholder.title = "Not found in your currently loaded emotes"
            row.appendChild(placeholder)
        }

        const label = document.createElement("span")
        label.className = "card-name"
        const labelText = document.createElement("span")
        labelText.className = "card-name-text"
        labelText.textContent = name
        labelText.title = name
        label.appendChild(labelText)
        row.appendChild(label)

        const removeBtn = document.createElement("button")
        removeBtn.className = "card-icon-btn"
        removeBtn.innerHTML = REMOVE_ICON
        removeBtn.title = "Remove from excluded list"
        removeBtn.addEventListener("click", () => removeExcluded(name))
        row.appendChild(removeBtn)

        excludedListEl.appendChild(row)
    })
}

excludedListEl.addEventListener("dragover", (e) => {
    const drag = excludedListEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterEl = getDragEl(excludedListEl, e.clientY)
    if (afterEl == null) excludedListEl.appendChild(drag)
    else excludedListEl.insertBefore(drag, afterEl)
})

async function commitExcludDOM() {
    const visual = [...excludedListEl.querySelectorAll(".card-draggable")].map(el => el.dataset.emoteName)
    if (!visual.length) return
    excludedEmote = visual
    await ext.storage.local.set({ excludedEmote })
}

async function removeExcluded(name) {
    excludedEmote = excludedEmote.filter(n => n !== name)
    await ext.storage.local.set({ excludedEmote })
    renderExcluded()
}

async function addExcludedName(name, keepSearch = false) {
    excludeHint.textContent = ""
    excludeHint.classList.remove("error")

    if (!name) return
    if (excludedEmote.includes(name)) {
        excludeHint.textContent = "Already excluded."
        excludeHint.classList.add("error")
        return
    }

    excludedEmote.push(name)
    await ext.storage.local.set({ excludedEmote })
    if (!keepSearch) {
        excludeInput.value = ""
        excludeSearchResultsEl.innerHTML = ""
    } else {
        const query = excludeInput.value.trim()
        if (query) runExSearch(query)
    }

    renderExcluded()

    if (!emoteByName.has(name)) excludeHint.textContent = `Saved. "${name}" wasn't found in your currently loaded emotes. double check spelling/case if that's unexpected.`
}

excludeInput.addEventListener("input", () => {
    clearTimeout(excludeSearchTimer)
    const query = excludeInput.value.trim()
    if (!query) return excludeSearchResultsEl.innerHTML = ""

    excludeSearchTimer = setTimeout(() => runExSearch(query), 100)
})

async function runExSearch(query) {
    const res = await ext.runtime.sendMessage({ type: "GET_SUGGESTIONS", query })
    const sugg = (res && res.suggestions) || []

    excludeSearchResultsEl.innerHTML = ""
    sugg.slice(0, 8).forEach(emote => {
        const row = document.createElement("div")
        row.className = "search-result"

        const img = document.createElement("img")
        img.src = emote.url
        img.alt = emote.name
        row.appendChild(img)

        const name = document.createElement("span")
        name.className = "search-result-name"
        name.textContent = emote.name
        name.title = emote.name
        row.appendChild(name)

        row.addEventListener("click", (e) => addExcludedName(emote.name, e.shiftKey))
        excludeSearchResultsEl.appendChild(row)
    })
}

excludeAddBtn.addEventListener("click", (e) => addExcludedName(excludeInput.value.trim(), e.shiftKey))
excludeInput.addEventListener("keydown", e => (e.key === "Enter") && addExcludedName(excludeInput.value.trim(), e.shiftKey))
