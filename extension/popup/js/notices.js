function renderNotice() {
    const entries = []

    if (initStatusState && initStatusState.phase !== "ready") {
        entries.push({
            message: initStatusState.message,
            kind: initStatusState.phase === "error" ? "error" : "info",
            loading: ["resolving", "resolving-default", "loading-emotes", "loading"].includes(initStatusState.phase)
        })
    }
    if (emoteLoadStatusState && ["loading", "error"].includes(emoteLoadStatusState.phase)) {
        entries.push({
            message: emoteLoadStatusState.message,
            kind: emoteLoadStatusState.phase === "error" ? "error" : "info",
            loading: emoteLoadStatusState.phase === "loading"
        })
    }
    if (isUnsupportedSite) {
        entries.push({
            message: "The maintainer disables this page by default, but you can still enable it; some features may not work as expected",
            kind: "warning"
        })
        if (siteNote) entries.push({
            message: `${siteNote}`,
            kind: "warning",
            emotes: true
        })
    } else if (siteNote) {
        entries.push({
            message: "The maintainer left a note for this page; it should work, but you can still disable it if needed",
            kind: "info"
        })
        entries.push({
            message: `${siteNote}`,
            kind: "info",
            emotes: true
        })
    }
    if (updateNoticeState) {
        entries.push({
            message: `Update available: v${updateNoticeState.latestVersion} (you're on v${updateNoticeState.currentVersion})!`,
            kind: "warning",
            link: "https://github.com/aitji/7tv-anywhere/releases"
        })
    }

    const uniqueEntries = entries.filter((entry, index) =>
        entry.message && entries.findIndex(other => other.message === entry.message) === index
    )
    noticeText.replaceChildren(...uniqueEntries.map(renderNoticeRow))
    noticeBanner.classList.toggle("hidden", !uniqueEntries.length)
}

function renderNoticeRow(entry) {
    const row = document.createElement("span")
    row.className = `notice-row is-${entry.kind}`

    if (entry.loading) {
        const spinner = document.createElement("span")
        spinner.className = "status-spinner"
        spinner.setAttribute("aria-hidden", "true")
        row.appendChild(spinner)
    } else row.appendChild(createNoticeIcon(entry.kind))

    const line = document.createElement("span")
    line.className = "notice-line"
    if (entry.emotes) appendNoticeText(line, entry.message)
    else line.textContent = entry.message
    row.appendChild(line)

    if (entry.link) {
        const link = document.createElement("a")
        link.href = entry.link
        link.target = "_blank"
        link.rel = "noopener"
        link.textContent = "View"
        row.appendChild(link)
    }
    return row
}

function createNoticeIcon(kind) {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.classList.add("icon")
    svg.setAttribute("viewBox", "0 0 16 16")
    svg.setAttribute("fill", "none")
    svg.setAttribute("aria-hidden", "true")

    const addPath = (d, extra = {}) => {
        const path = document.createElementNS(SVG_NS, "path")
        path.setAttribute("d", d)
        path.setAttribute("stroke", "currentColor")
        path.setAttribute("stroke-width", "1.25")
        path.setAttribute("stroke-linecap", "round")
        for (const [name, value] of Object.entries(extra)) path.setAttribute(name, value)
        svg.appendChild(path)
    }

    if (kind === "warning") {
        addPath("M8 1.5 14.5 13h-13L8 1.5Z", { "stroke-linejoin": "round" })
        addPath("M8 6.25v3.25M8 11.75h.01")
    } else if (kind === "error") {
        addPath("M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5Z")
        addPath("m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5")
    } else {
        addPath("M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5Z")
        addPath("M8 7.25v4M8 5.1h.01")
    }
    return svg
}

function appendNoticeText(container, text) {
    const token = /:?([A-Za-z0-9_]+):?/g
    let match
    let lastIndex = 0
    while ((match = token.exec(text)) !== null) {
        const emote = findPopupEmote(match[1])
        if (!emote) continue
        if (match.index > lastIndex)
            container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
        const img = document.createElement("img")
        img.className = "notice-emote"
        img.src = emote.url
        img.alt = emote.name
        img.title = emote.channelName ? `${emote.name} (${emote.channelName})` : emote.name
        img.loading = "lazy"
        const originalText = match[0]
        img.addEventListener("error", () => {
            if (img.isConnected) img.replaceWith(document.createTextNode(originalText))
        })
        container.appendChild(img)
        lastIndex = token.lastIndex
    }
    if (lastIndex < text.length)
        container.appendChild(document.createTextNode(text.slice(lastIndex)))
}

function renderChannelStatus() {
    clearTimeout(channelStatusHideTimer)
    const status = channelOperationState
    const now = Date.now()
    const maxAge = status && status.phase === "done"
        ? 60 * 1000
        : status && status.phase === "error"
            ? 10 * 60 * 1000
            : null
    const remaining = maxAge === null
        ? null
        : maxAge - (now - (status.updatedAt || now))
    const visible = !!status && (remaining === null || remaining > 0)
    const busy = visible && status.phase === "resolving"

    channelStatus.classList.toggle("hidden", !visible)
    channelStatus.classList.toggle("is-error", visible && status.phase === "error")
    channelStatus.classList.toggle("is-done", visible && status.phase === "done")
    channelStatusSpinner.hidden = !busy
    findHint.textContent = visible ? status.message || "" : ""
    channelQueryInput.disabled = busy
    findSetsBtn.disabled = busy
    findSetsBtn.textContent = busy ? "Working..." : "Find"

    if (visible && remaining !== null)
        channelStatusHideTimer = setTimeout(() => {
            channelOperationState = null
            renderChannelStatus()
            updateSaveBar()
        }, remaining + 20)
}
