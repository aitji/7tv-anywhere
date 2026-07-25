const EMOTE_STATE_KEYS = Object.freeze([
    "emoteSet", "getEmoteAt", "emoteSetSize", "emoteSize",
    "emoteSetPartial", "emoteSetKey", "customSets", "channelSettings", "lastReWarn"
])
let emoteStateCache = null

async function readEmoteState() {
    if (emoteStateCache) return emoteStateCache
    emoteStateCache = await ext.storage.local.get(EMOTE_STATE_KEYS)
    return emoteStateCache
}

function patchEmoteState(values) {
    if (!emoteStateCache) return
    Object.assign(emoteStateCache, values)
}

ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !emoteStateCache) return
    for (const key of EMOTE_STATE_KEYS) {
        if (!(key in changes)) continue
        if (changes[key].newValue === undefined) delete emoteStateCache[key]
        else emoteStateCache[key] = changes[key].newValue
    }
})

async function getEmote() {
    const state = await readEmoteState()
    const {
        emoteSet,
        getEmoteAt,
        emoteSetSize,
        emoteSize,
        emoteSetPartial,
        emoteSetKey,
        customSets: customSet = []
    } = state
    const size = emoteSetSize === clamp(emoteSize)
    const key = cacheKey(customSet)
    const keyOk = emoteSetKey === key
    const ttl = emoteSetPartial ? PARTIAL_RETRY_MS : CACHE_TTL_MS
    const fresh = Array.isArray(emoteSet) && emoteSet.length && getEmoteAt
        && Date.now() - getEmoteAt < ttl && size && keyOk

    if (fresh) return emoteSet
    try {
        const res = await reloadEmote()
        return res.emotes
    } catch (err) {
        const canFallback = Array.isArray(emoteSet) && emoteSet.length && size && keyOk
        if (!canFallback) throw err

        const warning = `Using cached emotes because refresh failed: ${errorText(err)}`
        await setEmoteLoadStatus("ready", `Using ${emoteSet.length} cached emotes`, {
            count: emoteSet.length,
            warning,
            stale: true,
            finishedAt: Date.now()
        })
        return emoteSet
    }
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

const setPreviewCache = new Map()
async function getSetEmotes(id) {
    if (!id || !/^[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid emote set ID")
    const state = await readEmoteState()
    const size = clamp(state.emoteSize)
    const cached = setPreviewCache.get(id)
    if (cached && cached.size === size && Date.now() - cached.at < 10 * 60 * 1000)
        return cached.value

    const data = await getSetData(id)
    const emotes = (data.emotes || [])
        .filter(emote => emote && emote.name && emote.data && emote.data.host && emote.data.host.url)
        .map(emote => ({
            name: emote.name,
            id: emote.id,
            url: `https:${emote.data.host.url}/${size}x.webp`
        }))
    const value = {
        setId: data.id || id,
        setName: data.name || id,
        count: emotes.length,
        emotes
    }
    setPreviewCache.set(id, { at: Date.now(), size, value })
    return value
}

async function loadEmote() {
    const state = await readEmoteState()
    let customSet = Array.isArray(state.customSets) ? state.customSets : []
    const size = clamp(state.emoteSize)
    const channelSetting = state.channelSettings && typeof state.channelSettings === "object"
        ? state.channelSettings
        : {}
    customSet = await refreshMain(customSet, channelSetting)
    patchEmoteState({ customSets: customSet, channelSettings: channelSetting })

    const enabledSet = customSet.filter(s => s.enabled !== false)
    const id = ["global", ...enabledSet.map(s => s.id)]
    const task = await settleLimited(id, EMOTE_FETCH_CONCURRENCY, setId => getSetData(setId))

    const bySourceName = new Map()
    let anyOk = false
    const fail = []
    task.forEach((item, index) => {
        if (item.status !== "fulfilled") {
            if (index > 0) fail.push(labelSet(enabledSet[index - 1]) || id[index])
            return
        }

        anyOk = true
        const source = index > 0 ? enabledSet[index - 1] : null
        const channelId = source ? source.channelId : "global"
        const channelName = source ? source.channelName : "Global 7TV"
        const setId = source ? source.id : "global"
        const setName = source ? source.setName : "Global 7TV"
        for (const emote of item.value.emotes || []) {
            if (!emote || !emote.name || !emote.data || !emote.data.host || !emote.data.host.url) continue
            const sourceKey = `${channelId}\0${emote.name}`
            if (bySourceName.has(sourceKey)) continue
            bySourceName.set(sourceKey, {
                name: emote.name,
                id: emote.id,
                url: `https:${emote.data.host.url}/${clamp(size)}x.webp`,
                channelId,
                channelName,
                setId,
                setName,
                priority: index
            })
        }
    })

    if (!anyOk) throw new Error("Could not reach 7TV, check your connection and try again...")
    const emote = Array.from(bySourceName.values())

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
    const nextState = {
        emoteSet: emote,
        getEmoteAt: Date.now(),
        emoteSetSize: size,
        emoteSetPartial: partial,
        emoteSetKey: cacheKey(customSet),
        lastReWarn: warning
    }
    await ext.storage.local.set(nextState)
    patchEmoteState(nextState)

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
    return set.setName ? `${set.channelName || ""} – ${set.setName}`.replace(/^ – /, "") : set.label
}

async function settleLimited(items, limit, worker) {
    const out = Array(items.length)
    let next = 0
    const count = Math.max(1, Math.min(limit || 1, items.length || 1))
    await Promise.all(Array.from({ length: count }, async () => {
        while (next < items.length) {
            const index = next++
            try {
                out[index] = { status: "fulfilled", value: await worker(items[index], index) }
            } catch (reason) {
                out[index] = { status: "rejected", reason }
            }
        }
    }))
    return out
}
