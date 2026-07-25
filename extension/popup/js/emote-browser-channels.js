function renderChannelBrowser() {
    const allChannels = browserChannels()
    const query = String(browserSearchInput.value || "").trim().toLowerCase()
    const channels = allChannels.filter(channel => !query
        || channel.channelName.toLowerCase().includes(query)
        || channel.sets.some(set => set.setName.toLowerCase().includes(query))
    )

    browserSummaryEl.textContent = `${allChannels.length} channel${channels.length === 1 ? "" : "s"}`
    browserEmptyEl.hidden = allChannels.length > 0
    browserEmptyEl.textContent = allChannels.length
        ? "No channels or sets match that search"
        : "No channels are configured yet"

    browserVirtualList.mount(channels, makeChannelBrowserCard, channel => 118 + channel.sets.length * 34, {
        key: channel => `channel:${channel.channelId}`,
        version: channel => `${channel.emotes.filter(emote => isEmoteExcluded(emote)).length}|${channel.sets.map(set => `${set.setId}:${set.loadedCount}:${set.enabled}`).join("|")}`
    })
}

function makeChannelBrowserCard(channel) {
    const card = document.createElement("article")
    card.className = "card browser-channel-card"

    const top = document.createElement("div")
    top.className = "browser-channel-head"

    const preview = document.createElement("div")
    preview.className = "browser-channel-preview"
    for (const emote of channel.emotes.slice(0, 4)) {
        const img = document.createElement("img")
        img.src = emote.url
        img.alt = ""
        img.loading = "lazy"
        preview.appendChild(img)
    }
    top.appendChild(preview)

    const copy = document.createElement("div")
    copy.className = "browser-channel-copy"
    const name = document.createElement("strong")
    name.textContent = channel.channelName
    name.title = channel.channelName
    copy.appendChild(name)

    const uniqueNames = new Set(channel.emotes.map(emote => String(emote.name).toLowerCase())).size
    const blocked = channel.emotes.filter(emote => isEmoteExcluded(emote)).length
    const meta = document.createElement("span")
    meta.textContent = `${uniqueNames} loaded emote${uniqueNames === 1 ? "" : "s"} · ${channel.sets.length} set${channel.sets.length === 1 ? "" : "s"} · ${blocked} blocked`
    copy.appendChild(meta)
    top.appendChild(copy)
    card.appendChild(top)

    if (channel.sets.length) {
        const setList = document.createElement("div")
        setList.className = "browser-set-links"
        for (const set of channel.sets) {
            const button = document.createElement("button")
            button.className = "browser-set-link"
            button.type = "button"
            button.title = `Browse emotes from ${set.setName}`

            const setName = document.createElement("span")
            setName.textContent = set.setName
            button.appendChild(setName)

            const count = document.createElement("small")
            count.textContent = set.loadedCount
                ? `${set.loadedCount} loaded`
                : set.enabled ? "Not loaded" : "Disabled"
            button.appendChild(count)

            button.addEventListener("click", () => openBrowserSet(channel.channelId, set.setId))
            setList.appendChild(button)
        }
        card.appendChild(setList)
    }

    const actions = document.createElement("div")
    actions.className = "browser-channel-actions"

    const view = document.createElement("button")
    view.className = "btn-primary"
    view.type = "button"
    view.textContent = "Browse all emotes"
    view.addEventListener("click", () => openBrowserChannel(channel.channelId))
    actions.appendChild(view)

    if (channel.channelId !== "global" && draft.customSets.some(set => set.channelId === channel.channelId)) {
        const manage = document.createElement("button")
        manage.className = "btn-secondary"
        manage.type = "button"
        manage.textContent = "Manage channel"
        manage.addEventListener("click", () => {
            selectPopupTab("emotes")
            openManageView(channel.channelId)
        })
        actions.appendChild(manage)
    }

    if (actions.childElementCount === 1) actions.classList.add("single")
    card.appendChild(actions)
    return card
}
