const browserVirtualList = createBrowserVirtualList(browserListEl)
let browserRenderFrame = 0
let browserRenderTimer = 0

browserModeEmotesBtn.addEventListener("click", showAllBrowserEmotes)
browserModeChannelsBtn.addEventListener("click", showBrowserChannels)
browserSearchInput.addEventListener("input", scheduleBrowserRender)
browserChannelFilter.addEventListener("change", () => {
    browserSetFilter.value = "all"
    syncBrowserSetFilter()
    renderEmoteBrowser(false)
})
browserSetFilter.addEventListener("change", () => renderEmoteBrowser(false))
browserBlockedOnlyInput.addEventListener("change", () => renderEmoteBrowser(false))
browserSetPreviewActionBtn.addEventListener("click", requestEnableBrowserSet)
browserSetOverlayDiscardBtn.addEventListener("click", closeBrowserSetSelection)
browserSetOverlayApplyBtn.addEventListener("click", applyBrowserSetSelection)
browserSetOverlay.addEventListener("click", event => {
    if (event.target === browserSetOverlay) closeBrowserSetSelection()
})

function scheduleBrowserRender() {
    if (browserRenderTimer) clearTimeout(browserRenderTimer)
    browserRenderTimer = setTimeout(() => {
        browserRenderTimer = 0
        if (browserRenderFrame) cancelAnimationFrame(browserRenderFrame)
        browserRenderFrame = requestAnimationFrame(() => {
            browserRenderFrame = 0
            renderEmoteBrowser(false)
        })
    }, 45)
}

function showBrowserChannels() {
    browserMode = "channels"
    browserSearchInput.value = ""
    browserChannelFilter.value = "all"
    browserSetFilter.value = "all"
    renderEmoteBrowser()
}

function showAllBrowserEmotes() {
    browserMode = "emotes"
    browserSearchInput.value = ""
    browserChannelFilter.value = "all"
    browserSetFilter.value = "all"
    renderEmoteBrowser()
}

function openBrowserChannel(channelId) {
    openBrowserSet(channelId, "all")
}

function openBrowserSet(channelId, setId) {
    browserMode = "emotes"
    browserSearchInput.value = ""
    syncBrowserChannelFilter(channelId)
    syncBrowserSetFilter(channelId, setId)
    selectPopupTab("browser")
}

function renderEmoteBrowser(syncFilters = true) {
    if (!browserListEl) return

    if (syncFilters) {
        syncBrowserChannelFilter()
        syncBrowserSetFilter()
    }
    applyBrowserModeUi()

    if (browserMode === "channels") renderChannelBrowser()
    else renderLoadedEmotes()
}

function applyBrowserModeUi() {
    const emoteMode = browserMode === "emotes"
    browserModeEmotesBtn.classList.toggle("is-active", emoteMode)
    browserModeChannelsBtn.classList.toggle("is-active", !emoteMode)
    browserModeEmotesBtn.setAttribute("aria-selected", emoteMode ? "true" : "false")
    browserModeChannelsBtn.setAttribute("aria-selected", emoteMode ? "false" : "true")
    browserEmoteFiltersEl.hidden = !emoteMode
    if (!emoteMode) browserSetPreviewEl.hidden = true

    if (!emoteMode) {
        browserIntroEl.textContent = "Choose a channel, then browse all loaded emotes or open one set"
        browserSearchInput.placeholder = "Search channels or set names..."
        return
    }

    browserSearchInput.placeholder = "Search emote names..."
    const channelId = browserChannelFilter.value || "all"
    const setId = browserSetFilter.value || "all"
    const channel = browserChannels().find(item => item.channelId === channelId)
    const set = channel && channel.sets.find(item => item.setId === setId)

    if (!channel)
        return browserIntroEl.textContent = "Browse every loaded emote, or narrow the list by channel"
    browserIntroEl.textContent = "Control which channel copy is active when emote names overlap"
}
