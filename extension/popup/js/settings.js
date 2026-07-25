caseSensitiveInput.addEventListener("change", async () => {
    draft.caseSensitive = caseSensitiveInput.checked
    syncDraftGlobals()
    renderNotice()
    renderEmoteBrowser()
    caseSensitiveStatusEl.textContent = caseSensitive
        ? "Exact letter case enabled!"
        : "Emote names now ignore letter case!"
    updateSaveBar()
})

matchPrioritySelect.addEventListener("change", () => {
    draft.matchPriority = cleanMatchPriority(matchPrioritySelect.value)
    syncDraftGlobals()
    renderNotice()
    renderEmoteBrowser()
    matchPriorityStatusEl.textContent = matchPriority === "case"
        ? "Closest letter case will win first!"
        : "Channel order will win first!"
    updateSaveBar()
})

siteRenderModeSelect.addEventListener("change", async () => {
    if (!hostname) return
    const selected = siteRenderModeSelect.value
    const { siteRenderModes: stored = {} } = await ext.storage.local.get("siteRenderModes")
    const next = stored && typeof stored === "object" ? { ...stored } : {}
    if (selected === "inherit") delete next[hostname]
    else next[hostname] = cleanRenderMode(selected)
    siteRenderModes = next
    await ext.storage.local.set({ siteRenderModes: next })
    siteRenderModeStatusEl.textContent = selected === "inherit"
        ? "Following the default performance mode"
        : `${cleanRenderMode(selected)} mode applies only to ${hostname}`
    renderSettingsData()
})

renderModeSelect.addEventListener("change", () => {
    draft.renderMode = cleanRenderMode(renderModeSelect.value)
    syncDraftGlobals()
    renderModeStatusEl.textContent = renderMode === "light"
        ? "Lighter page rendering is enabled!"
        : renderMode === "full"
            ? "Full page scanning is enabled!"
            : "Balanced page rendering is enabled!"
    updateSaveBar()
})

autoCheckUpdatesInput.addEventListener("change", async () => {
    await ext.storage.local.set({ autoCheckUpdates: autoCheckUpdatesInput.checked })
    updateCheckStatusEl.textContent = autoCheckUpdatesInput.checked
        ? "Automatic update checks enabled!"
        : "Automatic checks disabled, manual checks still work"
})

updateCheckIntervalSelect.addEventListener("change", async () => {
    const hours = Number(updateCheckIntervalSelect.value)
    if (![24, 168, 720].includes(hours)) return
    await ext.storage.local.set({ updateCheckIntervalHours: hours })
    updateCheckStatusEl.textContent = "Update interval saved!"
})

checkUpdateNowBtn.addEventListener("click", async () => {
    checkUpdateNowBtn.disabled = true
    checkUpdateNowBtn.textContent = "Checking..."
    updateCheckStatusEl.textContent = ""
    updateCheckStatusEl.classList.remove("error")
    try {
        const result = await ext.runtime.sendMessage({ type: "CHECK_FOR_UPDATE", force: true })
        if (!result || result.error) throw new Error((result && result.error) || "Update check failed")
        const info = result.updateInfo
        updateCheckStatusEl.textContent = info && info.updateAvailable
            ? `Version ${info.latestVersion} is available!`
            : "You are up to date!"
        const { lastCheck } = await ext.storage.local.get("lastCheck")
        renderLastChecked(lastCheck)
        await checkBanner()
    } catch (err) {
        updateCheckStatusEl.textContent = errorText(err)
        updateCheckStatusEl.classList.add("error")
    } finally {
        checkUpdateNowBtn.disabled = false
        checkUpdateNowBtn.textContent = "Check for update now"
    }
})

const backupKeys = [
    "enabled", "disabledSites", "enabledUnsupportedSites",
    "customSets", "channelSettings", "emoteSize",
    "excludedEmote", "caseSensitive", "matchPriority",
    "renderMode", "siteRenderModes", "autoCheckUpdates", "updateCheckIntervalHours"
]

exportSettingsBtn.addEventListener("click", async () => {
    settingsStatusEl.classList.remove("error")
    const settings = await ext.storage.local.get(backupKeys)
    const payload = {
        format: "7tv-anywhere-settings",
        schemaVersion: 2,
        extensionVersion: ext.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        settings
    }
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `7tv-anywhere-settings-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    settingsStatusEl.textContent = isDirty()
        ? "Saved settings exported! Your current draft was not included"
        : "Settings exported!"
})

importSettingsBtn.addEventListener("click", async () => {
    settingsStatusEl.classList.remove("error")
    const url = ext.runtime.getURL("popup/import.html")
    try {
        await ext.tabs.create({ url })
        settingsStatusEl.textContent = "Opened the settings importer in a new tab"
    } catch {
        window.open(url, "_blank", "noopener")
    }
})

forceReinitializeBtn.addEventListener("click", () => showConfirm({
    title: "Force reinitialize?",
    body: "This removes saved channels and cached emotes, then rebuilds the default setup. Export your settings first if you may need them",
    actionLabel: "Reinitialize",
    danger: true,
    onAction: async () => {
        forceReinitializeBtn.disabled = true
        forceReinitializeBtn.textContent = "Reinitializing..."
        siteRulesStatusEl.classList.remove("error")
        try {
            const result = await ext.runtime.sendMessage({ type: "FORCE_REINITIALIZE" })
            if (!result || !result.success) throw new Error((result && result.error) || "Reinitialization failed")
            location.reload()
        } catch (err) {
            siteRulesStatusEl.textContent = errorText(err)
            siteRulesStatusEl.classList.add("error")
            forceReinitializeBtn.disabled = false
            forceReinitializeBtn.textContent = "Force reinitialize"
        }
    }
}))

refreshSiteRulesBtn.addEventListener("click", async () => {
    refreshSiteRulesBtn.disabled = true
    refreshSiteRulesBtn.textContent = "Refreshing..."
    siteRulesStatusEl.textContent = ""
    siteRulesStatusEl.classList.remove("error")
    try {
        const result = await ext.runtime.sendMessage({ type: "REFRESH_SITE_RULES" })
        if (!result || !result.success) throw new Error((result && result.error) || "Refresh failed")
        siteRuleCount = result.count
        siteRulesCachedAt = result.cachedAt || Date.now()
        if (currentTabUrl) {
            const verdict = await getVerdict(currentTabUrl)
            isUnsupportedSite = verdict.unsupported
            siteNote = verdict.note
            siteRuleFlag = verdict.flag
            renderNotice()
        }
        renderSettingsData()
        siteRulesStatusEl.textContent = `Refreshed ${result.count} compatibility rule${result.count === 1 ? "" : "s"}!`
    } catch (err) {
        siteRulesStatusEl.textContent = errorText(err)
        siteRulesStatusEl.classList.add("error")
    } finally {
        refreshSiteRulesBtn.disabled = false
        refreshSiteRulesBtn.textContent = "Refresh site rules"
    }
})

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !confirmOverlay.hidden) closeConfirm()
})
