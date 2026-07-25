function replaceSelectOptions(select, options, selected) {
    const signature = options.map(option => `${option.value}\x00${option.label}`).join("\x01")
    if (select.dataset.optionSignature !== signature) {
        const fragment = document.createDocumentFragment()
        for (const item of options) {
            const option = document.createElement("option")
            option.value = item.value
            option.textContent = item.label
            fragment.appendChild(option)
        }
        select.replaceChildren(fragment)
        select.dataset.optionSignature = signature
    }
    select.value = options.some(option => option.value === selected) ? selected : options[0]?.value || ""
}

function syncBrowserChannelFilter(preferred) {
    const selected = preferred || browserChannelFilter.value || "all"
    const channels = browserChannels()
    replaceSelectOptions(browserChannelFilter, [
        { value: "all", label: "All channels" },
        ...channels.map(item => ({ value: item.channelId, label: item.channelName }))
    ], selected)
}

function syncBrowserSetFilter(channelId = browserChannelFilter.value || "all", preferred) {
    const selected = preferred || browserSetFilter.value || "all"
    const sets = channelId === "all" ? [] : browserSets(channelId)
    replaceSelectOptions(browserSetFilter, [
        {
            value: "all",
            label: channelId === "all" ? "Choose a channel first" : "All sets"
        },
        ...sets.map(set => ({
            value: set.setId,
            label: set.loadedCount
                ? `${set.setName} (${set.loadedCount})`
                : `${set.setName} (${set.enabled ? "not loaded" : "disabled"})`
        }))
    ], selected)
    browserSetFilter.disabled = channelId === "all"
}

function browserSets(channelId) {
    const map = new Map()

    draftChannelSets(channelId).forEach((set, order) => {
        map.set(set.id, {
            setId: set.id,
            setName: set.setName || set.id,
            channelId: set.channelId,
            channelName: set.channelName || set.channelId,
            count: set.count,
            loadedCount: 0,
            enabled: set.enabled !== false,
            order,
            draftSet: set
        })
    })

    for (const emote of loadedEmoteList) {
        if (emoteSourceId(emote) !== channelId) continue
        const setId = String(emote.setId || "unknown")
        const entry = map.get(setId) || {
            setId,
            setName: emote.setName || setId,
            channelId,
            channelName: emote.channelName || channelId,
            count: null,
            loadedCount: 0,
            enabled: true,
            order: Number.MAX_SAFE_INTEGER,
            draftSet: null
        }
        entry.loadedCount += 1
        map.set(setId, entry)
    }

    return Array.from(map.values()).sort((left, right) => {
        if (!!left.draftSet !== !!right.draftSet) return left.draftSet ? -1 : 1
        if (left.draftSet && right.draftSet && left.order !== right.order) return left.order - right.order
        return left.setName.localeCompare(right.setName)
    })
}

function browserChannels() {
    const map = new Map()

    draft.customSets.forEach((set, order) => {
        const entry = map.get(set.channelId) || {
            channelId: set.channelId,
            channelName: set.channelName || set.channelId,
            emotes: [],
            sets: [],
            order
        }
        entry.order = Math.min(entry.order, order)
        map.set(set.channelId, entry)
    })

    for (const emote of loadedEmoteList) {
        const channelId = emoteSourceId(emote)
        const entry = map.get(channelId) || {
            channelId,
            channelName: emote.channelName || (channelId === "global" ? "Global 7TV" : channelId),
            emotes: [],
            sets: [],
            order: Number.MAX_SAFE_INTEGER
        }
        entry.emotes.push(emote)
        map.set(channelId, entry)
    }

    for (const entry of map.values()) entry.sets = browserSets(entry.channelId)

    return Array.from(map.values()).sort((left, right) =>
        left.order - right.order || left.channelName.localeCompare(right.channelName)
    )
}

function selectedBrowserSet() {
    const channelId = browserChannelFilter.value || "all"
    const setId = browserSetFilter.value || "all"
    if (channelId === "all" || setId === "all") return null
    return browserSets(channelId).find(set => set.setId === setId) || null
}

function previewCacheKey(channelId, setId) {
    return `${channelId}\x00${setId}`
}
