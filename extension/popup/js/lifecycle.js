async function init() {
    const appStatePromise = ext.runtime.sendMessage({ type: "GET_APP_STATE" }).catch(() => ({}))
    const tabInfo = await getTabInfo()
    currentTabUrl = tabInfo.url
    hostname = tabInfo.hostname
    if (hostname) siteLabel.textContent = hostname
    else {
        toggleSiteBtn.disabled = true
        siteLabel.textContent = "this site"
    }
    const verdict = tabInfo.url
        ? await getVerdict(tabInfo.url)
        : { unsupported: false, note: null, flag: null, ruleCount: 0 }
    isUnsupportedSite = verdict.unsupported
    siteNote = verdict.note
    siteRuleFlag = verdict.flag
    renderNotice()

    const appState = await appStatePromise
    const {
        enabled = true,
        disabledSites = [],
        enabledUnsupportedSites = [],
        customSets: storedSets = [],
        channelSettings: storedChannelSettings = {},
        emoteSize = 2,
        emoteSet = [],
        excludedEmote: storedExcluded = [],
        caseSensitive: storedCaseSensitive = false,
        lastReWarn = null,
        pendingDraft = appState.pendingDraft,
        initStatus = appState.initStatus,
        emoteLoadStatus = appState.emoteLoadStatus,
        channelOperation = appState.channelOperation,
        autoCheckUpdates = appState.autoCheckUpdates ?? true,
        updateCheckIntervalHours = appState.updateCheckIntervalHours || 168,
        lastCheck = appState.lastCheck || null,
        siteCfg: storedSiteCfg = null,
        siteCfgAt = null
    } = await ext.storage.local.get([
        "enabled", "disabledSites", "enabledUnsupportedSites", "customSets", "channelSettings",
        "emoteSize", "emoteSet", "excludedEmote", "caseSensitive", "lastReWarn", "pendingDraft",
        "initStatus", "emoteLoadStatus", "channelOperation", "autoCheckUpdates",
        "updateCheckIntervalHours", "lastCheck", "siteCfg", "siteCfgAt"
    ])

    setSwitch(toggleEnabledBtn, enabled)
    const siteOn = hostname
        ? (isUnsupportedSite ? enabledUnsupportedSites.includes(hostname) : !disabledSites.includes(hostname))
        : true
    setSwitch(toggleSiteBtn, siteOn)

    const migrated = migrateSet(storedSets)
    saved = { customSets: migrated, channelSettings: storedChannelSettings || {} }
    savedSerialized = serializeComparableState(saved)
    draft = validDraft(pendingDraft)
        ? {
            customSets: migrateSet(pendingDraft.customSets),
            channelSettings: pendingDraft.channelSettings || {}
        }
        : cloneState(saved)
    lastPersistedDraft = JSON.stringify(draft)
    channelOperationState = channelOperation || null

    emoteSizeInput.value = emoteSize
    emoteSizeValue.textContent = `${emoteSize}x`

    const loadedEmotes = Array.isArray(emoteSet) ? emoteSet : []
    setCount(loadedEmotes.length)
    setPopupEmote(loadedEmotes)
    excludedEmote = Array.isArray(storedExcluded) ? storedExcluded : []
    caseSensitive = storedCaseSensitive === true
    caseSensitiveInput.checked = caseSensitive
    siteRuleCount = Array.isArray(storedSiteCfg && storedSiteCfg.siteRules)
        ? storedSiteCfg.siteRules.length
        : verdict.ruleCount
    siteRulesCachedAt = siteCfgAt || null
    autoCheckUpdatesInput.checked = autoCheckUpdates !== false
    updateCheckIntervalSelect.value = ["24", "168", "720"].includes(String(updateCheckIntervalHours))
        ? String(updateCheckIntervalHours)
        : "168"
    renderLastChecked(lastCheck)

    if (lastReWarn) reloadWarningEl.textContent = lastReWarn
    popupReady = true
    renderHome()
    renderExcluded()
    renderSettingsData()
    refreshStorageUsage()
    updateSaveBar()
    renderActivity(initStatus, emoteLoadStatus, channelOperation)
    checkBanner()
    reEmoteCount()
}

function renderActivity(initStatus, emoteLoadStatus, channelOperation) {
    if (initStatus !== undefined) initStatusState = initStatus
    if (emoteLoadStatus !== undefined) emoteLoadStatusState = emoteLoadStatus
    if (channelOperation !== undefined) channelOperationState = channelOperation
    renderNotice()
    renderChannelStatus()
    updateSaveBar()
}

function renderLastChecked(timestamp) {
    updateLastCheckedEl.textContent = timestamp
        ? `Checked ${new Date(timestamp).toLocaleDateString()}`
        : "Never checked"
}

function renderSettingsData() {
    const channelCount = new Set(draft.customSets.map(set => set.channelId)).size
    dataVersionEl.textContent = ext.runtime.getManifest().version
    dataEmotesEl.textContent = `${emoteByName.size} emotes`
    dataChannelsEl.textContent = `${channelCount} channel${channelCount === 1 ? "" : "s"} · ${draft.customSets.length} set${draft.customSets.length === 1 ? "" : "s"}`
    dataDraftEl.textContent = isDirty() ? "Unsaved changes" : "No pending changes"

    const cached = siteRulesCachedAt
        ? `updated ${new Date(siteRulesCachedAt).toLocaleString()}`
        : "not downloaded yet"
    const current = siteRuleFlag === "not_support"
        ? "current site disabled by default"
        : siteRuleFlag === "support"
            ? "current site has a supported-site rule"
            : "current site has no special rule"
    siteRulesSummaryEl.textContent = `${siteRuleCount} rule${siteRuleCount === 1 ? "" : "s"} · ${cached} · ${current}`
}

async function refreshStorageUsage() {
    if (typeof ext.storage.local.getBytesInUse !== "function") {
        dataStorageEl.textContent = "Unavailable"
        return
    }
    try {
        const bytes = await ext.storage.local.getBytesInUse(null)
        dataStorageEl.textContent = bytes < 1024
            ? `${bytes} B`
            : bytes < 1024 * 1024
                ? `${(bytes / 1024).toFixed(1)} KB`
                : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    } catch {
        dataStorageEl.textContent = "Unavailable"
    }
}

let storageUsageTimer = null
function queueStorageUsageRefresh() {
    clearTimeout(storageUsageTimer)
    storageUsageTimer = setTimeout(refreshStorageUsage, 500)
}

let storageSyncTimer = null
function queueStorageStateSync() {
    clearTimeout(storageSyncTimer)
    storageSyncTimer = setTimeout(async () => {
        const state = await ext.storage.local.get([
            "customSets", "channelSettings", "pendingDraft"
        ])
        saved = {
            customSets: migrateSet(state.customSets || []),
            channelSettings: state.channelSettings || {}
        }
        savedSerialized = serializeComparableState(saved)
        draft = validDraft(state.pendingDraft)
            ? {
                customSets: migrateSet(state.pendingDraft.customSets),
                channelSettings: state.pendingDraft.channelSettings || {}
            }
            : cloneState(saved)
        lastPersistedDraft = JSON.stringify(draft)
        if (currentChannelId && !draft.customSets.some(s => s.channelId === currentChannelId))
            closeManageView()
        else if (currentChannelId) renderManageView()
        renderHome()
        renderSettingsData()
        updateSaveBar()
    }, 0)
}

ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    queueStorageUsageRefresh()
    if (changes.customSets || changes.channelSettings || changes.pendingDraft)
        queueStorageStateSync()

    if (changes.initStatus || changes.emoteLoadStatus || changes.channelOperation) {
        if (changes.channelOperation)
            channelOperationState = changes.channelOperation.newValue || null
        const getValue = (key) => changes[key] && changes[key].newValue
        renderActivity(
            getValue("initStatus"),
            getValue("emoteLoadStatus"),
            getValue("channelOperation")
        )
    }

    if (changes.emoteSet && Array.isArray(changes.emoteSet.newValue)) {
        const emotes = changes.emoteSet.newValue
        setCount(emotes.length)
        setPopupEmote(emotes)
        renderExcluded()
        renderNotice()
        renderSettingsData()
    }
    if (changes.lastCheck) renderLastChecked(changes.lastCheck.newValue)
    if (changes.lastReWarn) reloadWarningEl.textContent = changes.lastReWarn.newValue || ""
    if (changes.siteCfg) {
        const cfg = changes.siteCfg.newValue
        siteRuleCount = Array.isArray(cfg && cfg.siteRules) ? cfg.siteRules.length : 0
    }
    if (changes.siteCfgAt) siteRulesCachedAt = changes.siteCfgAt.newValue || null
    if (changes.siteCfg || changes.siteCfgAt) renderSettingsData()
})

async function reEmoteCount() {
    try {
        const { emotes } = await ext.runtime.sendMessage({ type: "GET_EMOTES" })
        if (!emotes) return

        setCount(emotes.length)
        setPopupEmote(emotes)
        renderExcluded()
        renderNotice()
        renderSettingsData()
    } catch { }
}

const migrateSet = (stored) => (Array.isArray(stored) ? stored : []).map(s => {
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
        return {
            unsupported: !!(res && res.unsupported),
            note: (res && res.note) || null,
            flag: (res && res.flag) || null,
            ruleCount: Number(res && res.ruleCount) || 0
        }
    } catch { return { unsupported: false, note: null, flag: null, ruleCount: 0 } }
}
