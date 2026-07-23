async function refreshMain(customSet, channelSetting) {
    const now = Date.now()
    const dueId = Object.keys(channelSetting).filter(id => {
        const pref = channelSetting[id]
        if (!pref || !pref.alwaysMain) return false
        return !pref.mainRefreshedAt || now - pref.mainRefreshedAt > MAIN_SET_REFRESH_MS
    })
    if (!dueId.length) return customSet

    let changed = false
    for (const channelId of dueId) try {
        const user = await getUser(channelId)
        const mainId = user ? activeId(user) : null
        if (!mainId) continue
        const info = await getSet(mainId)
        if (!info) continue

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
    } catch { }

    if (changed) await ext.storage.local.set({
        customSets: customSet,
        channelSettings: channelSetting
    })
    return customSet
}
