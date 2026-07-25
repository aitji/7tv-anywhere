async function loadBrowserSetPreview(set) {
    const key = previewCacheKey(set.channelId, set.setId)
    if (browserPreviewBySet.has(key) || browserPreviewLoading.has(key)) return

    browserPreviewLoading.add(key)
    browserPreviewError.delete(key)
    renderLoadedEmotes()

    try {
        const result = await ext.runtime.sendMessage({ type: "GET_SET_EMOTES", setId: set.setId })
        if (!result || result.error || !Array.isArray(result.emotes))
            throw new Error(result && result.error || "Could not preview this set")
        browserPreviewBySet.set(key, result.emotes.map(emote => ({
            ...emote,
            channelId: set.channelId,
            channelName: set.channelName,
            setId: set.setId,
            setName: result.setName || set.setName,
            previewOnly: true,
            priority: 0
        })))
    } catch (err) {
        browserPreviewError.set(key, errorText(err, "Could not preview this set"))
    } finally {
        browserPreviewLoading.delete(key)
        const selected = selectedBrowserSet()
        if (selected && selected.channelId === set.channelId && selected.setId === set.setId)
            renderLoadedEmotes()
    }
}

function updateBrowserSetPreview(set, previewing) {
    if (!set || !previewing) {
        browserSetPreviewEl.hidden = true
        browserSetPreviewCopyEl.hidden = true
        return
    }

    const key = previewCacheKey(set.channelId, set.setId)
    const loading = browserPreviewLoading.has(key)
    const error = browserPreviewError.get(key)
    browserSetPreviewEl.hidden = false
    browserSetPreviewCopyEl.hidden = false
    browserSetPreviewTitleEl.textContent = loading
        ? `Loading ${set.setName} preview...`
        : error ? `Could not preview ${set.setName}` : `Previewing ${set.setName}`
    browserSetPreviewCopyEl.textContent = error
        ? error
        : set.enabled
            ? "This set is enabled in your draft but is not loaded yet. Save changes to apply it."
            : "Preview emotes are read-only. Enable this set to use or block its emotes."
    browserSetPreviewActionBtn.disabled = loading || set.enabled
    browserSetPreviewActionBtn.textContent = loading
        ? "Loading..."
        : error ? "Retry preview" : set.enabled ? "Enabled in draft" : "Enable set"

    if (error) browserSetPreviewActionBtn.disabled = false
}

function renderLoadedEmotes() {
    const query = String(browserSearchInput.value || "").trim().toLowerCase()
    const channelId = browserChannelFilter.value || "all"
    const setId = browserSetFilter.value || "all"
    const blockedOnly = browserBlockedOnlyInput.checked
    const selectedSet = selectedBrowserSet()
    const loadedForSet = selectedSet
        ? loadedEmoteList.some(emote => emoteSourceId(emote) === selectedSet.channelId && String(emote.setId || "unknown") === selectedSet.setId)
        : false
    const previewing = !!selectedSet && !loadedForSet
    const previewKey = selectedSet && previewCacheKey(selectedSet.channelId, selectedSet.setId)
    const sourceEmotes = previewing
        ? browserPreviewBySet.get(previewKey) || []
        : loadedEmoteList
    const groups = new Map()

    updateBrowserSetPreview(selectedSet, previewing)
    if (previewing && !browserPreviewBySet.has(previewKey) && !browserPreviewLoading.has(previewKey) && !browserPreviewError.has(previewKey))
        loadBrowserSetPreview(selectedSet)

    for (const emote of sourceEmotes) {
        if (channelId !== "all" && emoteSourceId(emote) !== channelId) continue
        if (setId !== "all" && String(emote.setId || "unknown") !== setId) continue
        if (blockedOnly && emote.previewOnly) continue
        if (query && !String(emote.name).toLowerCase().includes(query)
            && !String(emote.channelName || "Global 7TV").toLowerCase().includes(query)
            && !String(emote.setName || "").toLowerCase().includes(query)) continue

        const key = String(emote.name).toLowerCase()
        const group = groups.get(key) || []
        group.push(emote)
        groups.set(key, group)
    }

    const matches = Array.from(groups.entries())
        .filter(([, variants]) => !blockedOnly || variants.some(emote => isEmoteExcluded(emote)))
        .sort(([left], [right]) => left.localeCompare(right))

    const sourceCount = matches.reduce((count, [, variants]) => count + variants.length, 0)
    browserSummaryEl.textContent = previewing
        ? `${matches.length} preview emote${matches.length === 1 ? "" : "s"} · read-only`
        : `${matches.length} name${matches.length === 1 ? "" : "s"} · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
    browserEmptyEl.hidden = matches.length > 0 || browserPreviewLoading.has(previewKey)
    browserEmptyEl.textContent = blockedOnly
        ? "No blocked emotes match these filters"
        : previewing
            ? browserPreviewError.get(previewKey) || "No emotes in this set"
            : "No emotes match these filters"

    browserVirtualList.mount(matches, ([, variants]) => makeEmoteGroup(variants), ([, variants]) =>
        variants.length === 1 ? 52 : 48 + variants.length * 51, {
        key: ([key]) => key,
        version: ([, variants]) => variants.map(emote => `${emoteSourceId(emote)}:${emote.setId}:${emote.id}:${!!emote.previewOnly}`).join("|"),
        patch: (node, [, variants]) => syncEmoteGroupState(node, variants)
    })
}

function sortEmoteVariants(sourceVariants) {
    return sourceVariants.slice().sort((left, right) =>
        (right.priority || 0) - (left.priority || 0)
            || String(left.channelName || "").localeCompare(String(right.channelName || ""))
    )
}

function makeEmoteGroup(sourceVariants) {
    const variants = sortEmoteVariants(sourceVariants)
    if (variants.length === 1) {
        const card = makeEmoteSourceRow(variants[0], variants, true, "article")
        card.classList.add("card", "emote-single-card")
        syncEmoteGroupState(card, variants)
        return card
    }

    const group = document.createElement("article")
    group.className = "card emote-source-group"
    group._variants = variants

    const header = document.createElement("div")
    header.className = "emote-group-head"

    const copy = document.createElement("div")
    copy.className = "emote-browser-copy"
    const name = document.createElement("strong")
    name.textContent = variants[0].name
    name.title = variants[0].name
    copy.appendChild(name)
    const source = document.createElement("span")
    const sourceCount = new Set(variants.map(emoteSourceId)).size
    source.textContent = `Same name in ${sourceCount} channel${sourceCount === 1 ? "" : "s"}`
    copy.appendChild(source)
    header.appendChild(copy)

    if (!variants.some(emote => emote.previewOnly)) {
        const allBtn = document.createElement("button")
        allBtn.className = "btn-secondary emote-group-action"
        allBtn.type = "button"
        allBtn.dataset.groupAction = "true"
        allBtn.addEventListener("click", () => {
            const current = group._variants || variants
            const allBlocked = current.every(emote => isEmoteExcluded(emote))
            setGroupBlocked(current, !allBlocked)
        })
        header.appendChild(allBtn)
    }
    group.appendChild(header)

    const sourceList = document.createElement("div")
    sourceList.className = "emote-source-list"
    for (const emote of variants) sourceList.appendChild(makeEmoteSourceRow(emote, variants, false))
    group.appendChild(sourceList)
    syncEmoteGroupState(group, variants)
    return group
}

function makeEmoteSourceRow(emote, groupVariants, showName, tagName = "div") {
    const row = document.createElement(tagName)
    row.className = "emote-source-row"
    row._emote = emote
    row._groupVariants = groupVariants

    const img = document.createElement("img")
    img.className = "emote-source-thumb"
    img.src = emote.url
    img.alt = showName ? emote.name : ""
    img.loading = "lazy"
    row.appendChild(img)

    const copy = document.createElement("div")
    copy.className = "emote-source-copy"
    const primary = document.createElement("strong")
    primary.textContent = showName ? emote.name : emote.channelName || "Global 7TV"
    primary.title = primary.textContent
    copy.appendChild(primary)
    const secondary = document.createElement("span")
    secondary.textContent = showName
        ? `${emote.channelName || "Global 7TV"} · ${emote.setName || "Unknown set"}`
        : emote.setName || "Unknown set"
    secondary.title = secondary.textContent
    copy.appendChild(secondary)
    row.appendChild(copy)

    const status = document.createElement("span")
    status.className = "emote-source-status"
    status.dataset.sourceStatus = "true"
    row.appendChild(status)

    if (!emote.previewOnly) {
        const action = document.createElement("button")
        action.className = "btn-secondary emote-source-action"
        action.type = "button"
        action.dataset.sourceAction = "true"
        action.addEventListener("click", () => setSourceBlocked(emote, !isEmoteExcluded(emote)))
        row.appendChild(action)
    }
    return row
}

function syncEmoteGroupState(group, sourceVariants) {
    const variants = sortEmoteVariants(sourceVariants)
    group._variants = variants
    const rows = group.matches(".emote-source-row")
        ? [group]
        : [...group.querySelectorAll(".emote-source-row")]
    rows.forEach((row, index) => {
        const emote = variants[index] || row._emote
        if (!emote) return
        row._emote = emote
        row._groupVariants = variants
        const blocked = !emote.previewOnly && isEmoteExcluded(emote)
        row.classList.toggle("is-blocked", blocked)
        row.classList.toggle("is-preview", !!emote.previewOnly)

        const status = row.querySelector("[data-source-status]")
        status.className = `emote-source-status ${emote.previewOnly ? "preview" : blocked ? "blocked" : "active"}`
        status.textContent = emote.previewOnly ? "Preview" : blocked ? "Blocked" : "Active"

        const action = row.querySelector("[data-source-action]")
        if (!action) return
        action.textContent = blocked ? "Restore" : "Block"
        action.title = blocked
            ? `Allow ${emote.name} from ${emote.channelName || "Global 7TV"}`
            : variants.length > 1
                ? `Block only ${emote.channelName || "Global 7TV"}'s copy`
                : `Block ${emote.name} from ${emote.channelName || "Global 7TV"}`
    })

    const allBtn = group.querySelector("[data-group-action]")
    if (allBtn) {
        const allBlocked = variants.every(emote => isEmoteExcluded(emote))
        allBtn.textContent = allBlocked ? "Restore all" : "Block all"
        allBtn.title = allBlocked
            ? "Restore every loaded channel copy of this name"
            : "Block this name in every channel shown here"
    }
}

function setSourceBlocked(emote, blocked) {
    let rules = cleanExcludedEmote(draft.excludedEmote)
    const sourceId = emoteSourceId(emote)
    const hasGlobal = rules.some(item => typeof item === "string" && sameEmoteName(item, emote.name, caseSensitive))

    rules = rules.filter(item => {
        const name = typeof item === "string" ? item : item.name
        if (!sameEmoteName(name, emote.name, caseSensitive)) return true
        if (typeof item === "string") return !hasGlobal
        return item.channelId !== sourceId
    })

    if (blocked) rules.push({ name: emote.name, channelId: sourceId })
    else if (hasGlobal) {
        for (const other of loadedEmoteList) {
            if (!sameEmoteName(other.name, emote.name, caseSensitive)) continue
            if (emoteSourceId(other) === sourceId) continue
            rules.push({ name: other.name, channelId: emoteSourceId(other) })
        }
    }

    commitBrowserExclusions(rules, String(emote.name).toLowerCase())
}

function setGroupBlocked(variants, blocked) {
    const names = new Set(variants.map(emote => String(emote.name).toLowerCase()))
    const sources = new Set(variants.map(emote => `${emoteSourceId(emote)}\x00${String(emote.name).toLowerCase()}`))
    let rules = cleanExcludedEmote(draft.excludedEmote).filter(item => {
        const name = typeof item === "string" ? item : item.name
        const key = String(name).toLowerCase()
        if (!names.has(key)) return true
        if (typeof item === "string") return false
        return !sources.has(`${item.channelId}\x00${key}`)
    })

    if (blocked) {
        for (const emote of variants) rules.push({ name: emote.name, channelId: emoteSourceId(emote) })
    }
    commitBrowserExclusions(rules, [...names])
}

function commitBrowserExclusions(rules, keys) {
    draft.excludedEmote = cleanExcludedEmote(rules)
    syncDraftGlobals()
    if (browserBlockedOnlyInput.checked) renderLoadedEmotes()
    else browserVirtualList.refresh(keys)
    renderNotice()
    updateSaveBar()
}
