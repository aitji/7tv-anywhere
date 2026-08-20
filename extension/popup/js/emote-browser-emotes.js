const SOURCE_TWITCH_ICON = "M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2 3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z"
const SOURCE_SEVEN_ICON = [
    "m20.7465 5.48825 1.2334-2.1508.6661-1.1372L21.4125.04944V0h-6.5866l2.4669 4.3016.6908 1.18665h2.7629Z",
    "m7.15395 19.9258 7.40065-12.9048.9127-1.5822-2.4669-4.3016L12.3097.02476H1.8995L.66606 2.17556 0 3.31276l1.23344 2.1508v.04945H9.12745L2.96025 16.267l-.8634 1.5328 1.23344 2.1508V20h3.82366",
    "M17.4655 19.9257h3.7743l4.9338-8.6032.8634-1.4833-1.2334-2.1508v-.04941h-3.799l-2.4669 4.30161-.1727.3214-2.4669-4.30162-.1726-.32139-2.4669 4.30161-.6907 1.1866 3.7003 6.4524.1973.3461Z"
]
const SOURCE_OVERLAY_ICON = "m10.05 110.42 112 64a12 12 0 0 0 11.9 0l112-64a12 12 0 0 0 0-20.84l-112-64a12 12 0 0 0-11.9 0l-112 64a12 12 0 0 0 0 20.84ZM128 49.82 215.81 100 128 150.18 40.19 100Zm122.42 92.23A12 12 0 0 1 246 158.42l-112 64a12 12 0 0 1-11.9 0l-112-64A12 12 0 1 1 22 137.58l106 60.6 106-60.6a12 12 0 0 1 16.42 4.47Z"

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

function emoteProvider(emote) {
    return emote && emote.provider === "twitch" ? "Twitch" : "7TV"
}

function makeSourceSvg(viewBox, paths, className, title) {
    const icon = document.createElement("span")
    icon.className = className
    icon.title = title
    icon.setAttribute("aria-label", title)
    icon.setAttribute("role", "img")
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", viewBox)
    svg.setAttribute("fill", "currentColor")
    svg.setAttribute("aria-hidden", "true")
    for (const d of Array.isArray(paths) ? paths : [paths]) {
        const path = document.createElementNS(SVG_NS, "path")
        path.setAttribute("d", d)
        svg.appendChild(path)
    }
    icon.appendChild(svg)
    return icon
}

const makeProviderIcon = emote => emoteProvider(emote) === "Twitch"
    ? makeSourceSvg("0 0 24 24", SOURCE_TWITCH_ICON, "emote-source-provider twitch", "Twitch")
    : makeSourceSvg("0 0 28 20", SOURCE_SEVEN_ICON, "emote-source-provider", "7TV")
const makeOverlayIcon = () => makeSourceSvg("0 0 256 256", SOURCE_OVERLAY_ICON, "emote-source-overlay", "Overlaying")

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

function fuzzyBrowserScore(value, query, offset) {
    const text = String(value || "").toLowerCase()
    if (!text || !query) return Infinity
    if (text === query) return offset
    if (text.startsWith(query)) return offset + 1
    const wordStart = text.split(/[^a-z0-9_]+/).some(word => word.startsWith(query))
    if (wordStart) return offset + 2
    if (text.includes(query)) return offset + 3
    if (query.length < 3) return Infinity
    let index = 0
    for (let i = 0; i < text.length && index < query.length; i++)
        if (text[i] === query[index]) index++
    return index === query.length ? offset + 4 : Infinity
}

function browserEmoteSearchScore(emote, query) {
    if (!query) return 0
    const name = fuzzyBrowserScore(emote.name, query, 0)
    if (Number.isFinite(name) || query.length < 2) return name
    return Math.min(
        fuzzyBrowserScore(emote.channelName || "Global 7TV", query, 10),
        fuzzyBrowserScore(emote.setName, query, 20)
    )
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
    const scoreByGroup = new Map()

    updateBrowserSetPreview(selectedSet, previewing)
    if (previewing && !browserPreviewBySet.has(previewKey) && !browserPreviewLoading.has(previewKey) && !browserPreviewError.has(previewKey))
        loadBrowserSetPreview(selectedSet)

    for (const emote of sourceEmotes) {
        if (channelId !== "all" && emoteSourceId(emote) !== channelId) continue
        if (setId !== "all" && String(emote.setId || "unknown") !== setId) continue
        if (blockedOnly && emote.previewOnly) continue
        const score = browserEmoteSearchScore(emote, query)
        if (!Number.isFinite(score)) continue

        const key = String(emote.name).toLowerCase()
        const group = groups.get(key) || []
        group.push(emote)
        groups.set(key, group)
        scoreByGroup.set(key, Math.min(scoreByGroup.get(key) ?? Infinity, score))
    }

    const matches = Array.from(groups.entries())
        .filter(([, variants]) => !blockedOnly || variants.some(emote => isEmoteExcluded(emote)))
        .sort(([left], [right]) => scoreByGroup.get(left) - scoreByGroup.get(right)
            || left.localeCompare(right))

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
        version: ([, variants]) => variants.map(emote => `${emoteSourceId(emote)}:${emote.setId}:${emote.id}:${emote.provider}:${!!emote.zeroWidth}:${!!emote.previewOnly}`).join("|"),
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

    const media = document.createElement("span")
    media.className = "emote-source-media"
    const img = document.createElement("img")
    img.className = "emote-source-thumb"
    img.referrerPolicy = "no-referrer"
    img.src = emote.url
    img.alt = showName ? emote.name : ""
    img.title = `${emote.name} (${emote.channelName || "Global 7TV"})`
    img.loading = "lazy"
    media.appendChild(img)
    media.appendChild(makeProviderIcon(emote))
    if (emote.zeroWidth) media.appendChild(makeOverlayIcon())
    row.appendChild(media)

    const copy = document.createElement("div")
    copy.className = "emote-source-copy"
    const primary = document.createElement("strong")
    primary.textContent = showName ? emote.name : emote.channelName || "Global 7TV"
    primary.title = primary.textContent
    copy.appendChild(primary)
    const secondary = document.createElement("span")
    const provider = emoteProvider(emote)
    secondary.textContent = showName
        ? `${emote.channelName || "Global 7TV"} · ${emote.setName || "Unknown set"} · ${provider}${emote.zeroWidth ? " · Overlaying" : ""}`
        : `${emote.setName || "Unknown set"} · ${provider}${emote.zeroWidth ? " · Overlaying" : ""}`
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
