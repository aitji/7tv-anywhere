function requestEnableBrowserSet() {
    const set = selectedBrowserSet()
    if (!set) return
    const key = previewCacheKey(set.channelId, set.setId)
    if (browserPreviewError.has(key)) {
        browserPreviewError.delete(key)
        loadBrowserSetPreview(set)
        return
    }
    if (set.enabled) return

    const pref = draft.channelSettings[set.channelId] || {}
    if (pref.alwaysMain) {
        showConfirm({
            title: "Stop following the main set?",
            body: `To enable "${set.setName}" manually, 7TV Anywhere must turn off automatic main-set following for ${set.channelName}`,
            actionLabel: "Choose sets",
            onAction: () => openBrowserSetSelection(set.channelId, set.setId, true)
        })
        return
    }
    openBrowserSetSelection(set.channelId, set.setId, false)
}

function openBrowserSetSelection(channelId, focusedSetId, turnOffAlwaysMain) {
    const sets = draftChannelSets(channelId)
    if (!sets.length) return

    browserSetSelection = { channelId, focusedSetId, turnOffAlwaysMain }
    browserSetOverlayChannelEl.textContent = `${sets[0].channelName}: choose which sets should be enabled`
    browserSetOverlayListEl.replaceChildren()

    for (const set of sets) {
        const label = document.createElement("label")
        label.className = `browser-set-choice${set.id === focusedSetId ? " is-focused" : ""}`

        const input = document.createElement("input")
        input.type = "checkbox"
        input.value = set.id
        input.checked = set.enabled !== false || set.id === focusedSetId
        input.addEventListener("change", updateBrowserSetSelectionWarning)
        label.appendChild(input)

        const copy = document.createElement("span")
        copy.className = "browser-set-choice-copy"
        const name = document.createElement("span")
        name.className = "browser-set-choice-name"
        const pref = draft.channelSettings[channelId] || {}
        if (pref.knownActiveSetId === set.id) name.appendChild(makeIcon("star"))
        const nameText = document.createElement("span")
        nameText.textContent = set.setName
        name.appendChild(nameText)
        copy.appendChild(name)

        const meta = document.createElement("span")
        meta.className = "browser-set-choice-meta"
        meta.textContent = `${set.count ?? "?"} emote${set.count === 1 ? "" : "s"}`
        copy.appendChild(meta)

        if (pref.knownActiveSetId === set.id) {
            const active = document.createElement("span")
            active.className = "browser-set-choice-active"
            active.textContent = "currently active on the channel"
            copy.appendChild(active)
        }

        label.appendChild(copy)
        browserSetOverlayListEl.appendChild(label)
    }

    updateBrowserSetSelectionWarning()
    browserSetOverlay.hidden = false
    browserSetOverlayListEl.querySelector(`input[value="${focusedSetId}"]`)?.focus()
}

function updateBrowserSetSelectionWarning() {
    const enabled = browserSetOverlayListEl.querySelectorAll('input[type="checkbox"]:checked').length
    browserSetOverlayWarningEl.textContent = enabled > 1
        ? "More than one set is enabled here, so emotes sharing a name may override each other. You can apply this change, but some names may overlap."
        : ""
}

function closeBrowserSetSelection() {
    browserSetOverlay.hidden = true
    browserSetSelection = null
}

function applyBrowserSetSelection() {
    if (!browserSetSelection) return
    const { channelId, turnOffAlwaysMain } = browserSetSelection
    const enabledIds = new Set([...browserSetOverlayListEl.querySelectorAll('input[type="checkbox"]:checked')]
        .map(input => input.value))

    for (const set of draft.customSets) {
        if (set.channelId === channelId) set.enabled = enabledIds.has(set.id)
    }
    if (turnOffAlwaysMain) {
        const pref = draft.channelSettings[channelId] || {}
        draft.channelSettings[channelId] = { ...pref, alwaysMain: false }
    }

    closeBrowserSetSelection()
    syncBrowserSetFilter(channelId, browserSetFilter.value)
    renderEmoteBrowser(false)
    renderHome()
    if (currentChannelId === channelId) renderManageView()
    updateSaveBar()
}
