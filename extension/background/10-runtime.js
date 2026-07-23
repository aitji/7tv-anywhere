const badgeWork = new Map()
let badgeId = 0
let badgeRev = 0

function startBadgeWork(kind = "fetch") {
    const id = ++badgeId
    badgeWork.set(id, kind)
    syncBadge().catch(() => { })
    return () => {
        badgeWork.delete(id)
        syncBadge().catch(() => { })
    }
}

async function syncBadge() {
    if (!ext.action) return
    const rev = ++badgeRev
    const {
        pendingDraft,
        initStatus,
        emoteLoadStatus,
        channelOperation,
        updateInfo
    } = await ext.storage.local.get([
        "pendingDraft", "initStatus", "emoteLoadStatus",
        "channelOperation", "updateInfo"
    ])
    if (rev !== badgeRev) return

    const work = [...badgeWork.values()]
    const loading = [initStatus, emoteLoadStatus, channelOperation]
        .some(status => status && ["resolving", "resolving-default", "loading-emotes", "loading"].includes(status.phase))
    const failed = [initStatus, emoteLoadStatus, channelOperation]
        .some(status => status && status.phase === "error")

    let text = ""
    let color = "#676c7d"
    let title = "7TV Anywhere"
    // —
    if (work.includes("save")) {
        text = "…"
        color = "#8b5cf6"
        title += " — Saving changes"
    } else if (work.includes("fetch") || loading) {
        text = "…"
        color = "#58a6ff"
        title += " — Fetching data"
    } else if (failed) {
        text = "!"
        color = "#f56565"
        title += " — Something needs attention"
    } else if (validDraft(pendingDraft)) {
        text = "?"
        color = "#f0b429"
        title += " — Unsaved changes"
    } else if (updateInfo && updateInfo.updateAvailable) {
        text = "↑"
        color = "#3ecf8e"
        title += ` — Update v${updateInfo.latestVersion} available`
    }

    await Promise.all([
        ext.action.setBadgeText({ text }),
        ext.action.setBadgeBackgroundColor({ color }),
        ext.action.setTitle({ title })
    ])
}

ext.storage.onChanged.addListener((change, area) => {
    if (area !== "local") return
    const key = [
        "pendingDraft", "initStatus", "emoteLoadStatus",
        "channelOperation", "updateInfo"
    ]
    if (key.some(name => change[name])) syncBadge().catch(() => { })
})

ext.runtime.onInstalled.addListener(() => {
    initialize().catch(() => { })
    checkUpdate(false).catch(() => { })
    getCfg().catch(() => { })
    syncBadge().catch(() => { })
})
ext.runtime.onStartup?.addListener(() => {
    initialize().catch(() => { })
    checkUpdate(false).catch(() => { })
    getCfg().catch(() => { })
    syncBadge().catch(() => { })
})
ext.alarms?.onAlarm.addListener(e =>
    (e.name === PARTIAL_RETRY_ALARM) && reloadEmote().catch(() => { })
)

// "weekly" extension update
async function checkUpdate(force) {
    const {
        lastCheck,
        updateInfo,
        autoCheckUpdates = true,
        updateCheckIntervalHours = DEFAULT_UPDATE_CHECK_INTERVAL_HOURS
    } = await ext.storage.local.get([
        "lastCheck", "updateInfo", "autoCheckUpdates", "updateCheckIntervalHours"
    ])
    const cronHour = [24, 168, 720].includes(Number(updateCheckIntervalHours))
        ? Number(updateCheckIntervalHours)
        : DEFAULT_UPDATE_CHECK_INTERVAL_HOURS
    if (!force && !autoCheckUpdates) return { checked: false, updateInfo: updateInfo || null }
    const due = force || !lastCheck || Date.now() - lastCheck > cronHour * 60 * 60 * 1000
    if (!due) return { checked: false, updateInfo: updateInfo || null }

    try {
        const res = await fetchWithTimeout(`${MANIFEST_URL}?_=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`)
        const gitManifest = await res.json()
        const iManifest = ext.runtime.getManifest().version
        const lastVer = gitManifest.version
        const isNewer = checkVer(lastVer, iManifest) > 0

        const info = { latestVersion: lastVer, currentVersion: iManifest, updateAvailable: isNewer, checkedAt: Date.now() }
        await ext.storage.local.set({ lastCheck: Date.now(), updateInfo: info })

        await syncBadge()

        return { checked: true, updateInfo: info }
    } catch (err) {
        await ext.storage.local.set({ lastCheck: Date.now() })
        return { checked: true, error: errorText(err), updateInfo: updateInfo || null }
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
        case "GET_APP_STATE":
            initialize().catch(() => { })
            reStaleOp()
                .then(() => ext.storage.local.get([
                    "initStatus", "emoteLoadStatus", "channelOperation", "pendingDraft",
                    "autoCheckUpdates", "updateCheckIntervalHours", "lastCheck", "updateInfo"
                ]))
                .then(sendRes)
                .catch(err => sendRes({ error: errorText(err) }))
            return true

        case "GET_EMOTES": initialize()
            .then(() => getEmote())
            .then(emotes => sendRes({ emotes }))
            .catch(err => sendRes({ emotes: [], error: errorText(err) }))
            return true

        case "RELOAD_EMOTES": reloadEmote()
            .then(result => sendRes({ success: true, emotes: result.emotes, warning: result.warning }))
            .catch(err => sendRes({ success: false, error: errorText(err) }))
            return true

        case "GET_SUGGESTIONS": getSugg(msg.query || "").then(suggestions => sendRes({ suggestions }))
            return true

        case "ADD_CHANNEL_TO_DRAFT": addChannel(msg.query || "")
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: errorText(err) }))
            return true

        case "RESOLVE_CHANNEL": resChannel(msg.query || "")
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: errorText(err) }))
            return true

        case "SAVE_DRAFT": saveDraft(msg.draft)
            .then(result => sendRes(result))
            .catch(err => sendRes({ success: false, error: errorText(err) }))
            return true

        case "DISCARD_DRAFT": discardDraft()
            .then(() => sendRes({ success: true }))
            .catch(err => sendRes({ success: false, error: errorText(err) }))
            return true

        case "REFRESH_CHANNEL": getUser(msg.channelId)
            .then(user => (user ? channelRes(user) : { error: "Channel not found..." }))
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: errorText(err) }))
            return true

        case "CHECK_FOR_UPDATE": checkUpdate(!!msg.force)
            .then(result => sendRes(result))
            .catch(err => sendRes({ error: errorText(err) }))
            return true

        case "IS_SITE_UNSUPPORTED": getCfg()
            .then(({ siteRules }) => sendRes({
                ...siteVerdict(msg.url || "", siteRules),
                ruleCount: siteRules.length
            }))
            .catch(err => sendRes({ unsupported: false, note: null, error: errorText(err) }))
            return true

        case "REFRESH_SITE_RULES": getCfg(true)
            .then(async ({ siteRules }) => {
                const { siteCfgAt = null } = await ext.storage.local.get("siteCfgAt")
                sendRes({ success: true, count: siteRules.length, cachedAt: siteCfgAt })
            })
            .catch(err => sendRes({ success: false, error: errorText(err) }))
            return true

        default: return false
    }
})

syncBadge().catch(() => { })
