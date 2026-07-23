const cloneState = (state) => JSON.parse(JSON.stringify(state))
const validDraft = (state) => state
    && Array.isArray(state.customSets)
    && state.channelSettings
    && typeof state.channelSettings === "object"
    && !Array.isArray(state.channelSettings)
const setSwitch = (btn, on) => btn.setAttribute("aria-checked", on ? "true" : "false")
const isOn = (btn) => btn.getAttribute("aria-checked") === "true"
const setCount = (count) => {
    emoteCountEl.textContent = Number.isFinite(Number(count)) ? `${Number(count)} emotes loaded` : ""
}



tabBtns.forEach(btn => btn.addEventListener("click", () => {
    tabBtns.forEach(b => {
        b.classList.toggle("is-active", b === btn)
        b.setAttribute("aria-selected", b === btn ? "true" : "false")
    })

    const tab = btn.dataset.tab
    panelEmotes.hidden = tab !== "emotes"
    panelExcluded.hidden = tab !== "excluded"
    panelSettings.hidden = tab !== "settings"
}))

toggleEnabledBtn.addEventListener("click", async () => {
    const next = !isOn(toggleEnabledBtn)
    setSwitch(toggleEnabledBtn, next)
    await ext.storage.local.set({ enabled: next })
})

toggleSiteBtn.addEventListener("click", async () => {
    if (!hostname) return
    const next = !isOn(toggleSiteBtn)
    setSwitch(toggleSiteBtn, next)

    if (isUnsupportedSite) {
        const { enabledUnsupportedSites = [] } = await ext.storage.local.get("enabledUnsupportedSites")
        const updated = next
            ? Array.from(new Set([...enabledUnsupportedSites, hostname]))
            : enabledUnsupportedSites.filter(h => h !== hostname)

        await ext.storage.local.set({ enabledUnsupportedSites: updated })
        return
    }

    const { disabledSites = [] } = await ext.storage.local.get("disabledSites")
    const updated = next
        ? disabledSites.filter(h => h !== hostname)
        : Array.from(new Set([...disabledSites, hostname]))

    await ext.storage.local.set({ disabledSites: updated })
})

async function checkBanner() {
    updateNoticeState = null
    try {
        const result = await ext.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" })
        const info = result && result.updateInfo
        if (info && info.updateAvailable) updateNoticeState = info
    } catch { }
    renderNotice()
}

