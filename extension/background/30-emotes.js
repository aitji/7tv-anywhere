async function getEmote() {
    const {
        emoteSet,
        getEmoteAt,
        emoteSetSize,
        emoteSize,
        emoteSetPartial,
        emoteSetKey,
        customSets: customSet = []
    } = await ext.storage.local.get([
        "emoteSet", "getEmoteAt", "emoteSetSize", "emoteSize",
        "emoteSetPartial", "emoteSetKey", "customSets"
    ])
    const size = emoteSetSize === clamp(emoteSize)
    const key = cacheKey(customSet)
    const keyOk = emoteSetKey === key
    const ttl = emoteSetPartial ? PARTIAL_RETRY_MS : CACHE_TTL_MS
    const fresh = emoteSet && emoteSet.length && getEmoteAt && (Date.now() - getEmoteAt < ttl) && size && keyOk

    if (fresh) return emoteSet
    const res = await reloadEmote()
    return res.emotes
}

function cacheKey(customSet) {
    const id = customSet.filter(s => s.enabled !== false).map(s => s.id)
    return JSON.stringify([EMOTE_CACHE_VERSION, "global", ...id])
}

let emoteFly = null
async function reloadEmote() {
    if (emoteFly) return emoteFly
    emoteFly = (async () => {
        await setEmoteLoadStatus("loading", "Loading emotes...")
        try {
            const res = await loadEmote()
            await setEmoteLoadStatus("ready", `Loaded ${res.emotes.length} emotes!`, {
                count: res.emotes.length,
                finishedAt: Date.now(),
                warning: res.warning || null
            })
            return res
        } catch (err) {
            await setEmoteLoadStatus("error", "Emotes could not be loaded...", {
                error: String(err),
                finishedAt: Date.now()
            })
            throw err
        }
    })()

    try { return await emoteFly }
    finally { emoteFly = null }
}

async function getSetData(id, retry = false) {
    try {
        const res = await fetchWithTimeout(`${SEVEN_TV_API}/emote-sets/${id}`)
        if (!res.ok) throw new Error(`emote-sets/${id}: HTTP ${res.status}`)
        return await res.json()
    } catch (err) {
        if (retry) throw err
        await new Promise(resolve => setTimeout(resolve, 400))
        return getSetData(id, true)
    }
}

async function loadEmote() {
    let {
        customSets: customSet = [],
        emoteSize,
        channelSettings: channelSetting = {}
    } = await ext.storage.local.get(["customSets", "emoteSize", "channelSettings"])
    const size = clamp(emoteSize)
    customSet = await refreshMain(customSet, channelSetting)

    const enabledSet = customSet.filter(s => s.enabled !== false)
    const id = ["global", ...enabledSet.map(s => s.id)]

    const task = await Promise.allSettled(id.map(setId => getSetData(setId)))

    const byName = new Map()
    let anyOk = false
    const fail = []
    task.forEach((item, index) => {
        if (item.status !== "fulfilled") {
            if (index > 0) fail.push(labelSet(enabledSet[index - 1]) || id[index])
            return
        }

        anyOk = true
        const source = index > 0 ? enabledSet[index - 1] : null
        const channelName = source ? source.channelName : null
        for (const emote of item.value.emotes || []) {
            if (!emote || !emote.name || !emote.data || !emote.data.host || !emote.data.host.url) continue
            byName.set(emote.name, {
                name: emote.name,
                id: emote.id,
                url: `https:${emote.data.host.url}/${clamp(size)}x.webp`,
                channelName,
                priority: index
            })
        }
    })

    if (!anyOk) throw new Error("Could not reach 7TV, check your connection and try again...")
    const emote = Array.from(byName.values())

    const channelCount = new Map()
    for (const set of enabledSet)
        channelCount.set(set.channelId, (channelCount.get(set.channelId) || 0) + 1)
    const overlap = Array.from(channelCount.entries())
        .filter(([, count]) => count > 1)
        .map(([channelId]) => (customSet.find(s => s.channelId === channelId) || {}).channelName || channelId)

    const warn = []
    if (fail.length) warn.push(`Couldn't load ${fail.join(", ")}; the set may no longer be public...`)
    if (overlap.length)
        warn.push(`Multiple sets are enabled for ${overlap.join(", ")}, so emotes with the same name may override each other...`)
    const warning = warn.length ? warn.join(" ") : null

    const partial = fail.length > 0
    await ext.storage.local.set({
        emoteSet: emote,
        getEmoteAt: Date.now(),
        emoteSetSize: size,
        emoteSetPartial: partial,
        emoteSetKey: cacheKey(customSet),
        lastReWarn: warning
    })

    if (partial) ext.alarms?.create(PARTIAL_RETRY_ALARM, { delayInMinutes: PARTIAL_RETRY_MS / 60000 })
    else ext.alarms?.clear(PARTIAL_RETRY_ALARM)

    try { // notify
        const tab = await ext.tabs.query({})
        await Promise.allSettled(tab.map(item =>
            ext.tabs.sendMessage(item.id, { type: "EMOTES_UPDATED" }).catch(() => { })
        ))
    } catch { }
    return { emotes: emote, warning }
}


function labelSet(set) {
    if (!set) return null
    return set.setName ? `${set.channelName || ""} \u2013 ${set.setName}`.replace(/^ \u2013 /, "") : set.label
}
