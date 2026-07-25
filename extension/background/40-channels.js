async function refreshMain(customSet, channelSetting) {
    const now = Date.now()
    const dueId = Object.keys(channelSetting).filter(id => {
        const pref = channelSetting[id]
        if (!pref || !pref.alwaysMain) return false
        return !pref.mainRefreshedAt || now - pref.mainRefreshedAt > MAIN_SET_REFRESH_MS
    })
    if (!dueId.length) return customSet

    const refreshed = await settleLimited(dueId, EMOTE_FETCH_CONCURRENCY, async channelId => {
        const user = await getUser(channelId)
        const mainId = user ? activeId(user) : null
        if (!mainId) return null
        const info = await getSet(mainId)
        return info ? { channelId, user, info } : null
    })

    let changed = false
    for (const result of refreshed) {
        if (result.status !== "fulfilled" || !result.value) continue
        const { channelId, user, info } = result.value
        const pref = channelSetting[channelId] || {}
        const targetId = pref.knownActiveSetId || info.id
        let updated = false
        let channelName = user.display_name || user.username || channelId
        customSet = customSet.map(set => {
            if (set.channelId !== channelId) return set
            channelName = set.channelName || channelName
            if (!updated && (set.id === targetId || set.id === info.id)) {
                updated = true
                return {
                    ...set,
                    id: info.id,
                    setName: info.name,
                    count: info.count,
                    preview: info.preview,
                    enabled: true
                }
            }
            return { ...set, enabled: false }
        })
        if (!updated) customSet.push({
            id: info.id,
            setName: info.name,
            count: info.count,
            preview: info.preview,
            channelId,
            channelName,
            enabled: true
        })
        channelSetting[channelId] = {
            ...pref,
            knownActiveSetId: info.id,
            mainRefreshedAt: now
        }
        changed = true
    }

    if (changed) await ext.storage.local.set({
        customSets: customSet,
        channelSettings: channelSetting
    })
    return customSet
}
