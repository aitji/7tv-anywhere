caseSensitiveInput.addEventListener("change", async () => {
    caseSensitive = caseSensitiveInput.checked
    await ext.storage.local.set({ caseSensitive })
    renderNotice()
    caseSensitiveStatusEl.textContent = caseSensitive
        ? "Exact letter case enabled!"
        : "Emote names now ignore letter case!"
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
    "enabled", "disabledSites", "enabledUnsupportedSites", "customSets", "channelSettings",
    "emoteSize", "excludedEmote", "caseSensitive", "autoCheckUpdates", "updateCheckIntervalHours"
]

exportSettingsBtn.addEventListener("click", async () => {
    settingsStatusEl.classList.remove("error")
    const settings = await ext.storage.local.get(backupKeys)
    const payload = {
        format: "7tv-anywhere-settings",
        schemaVersion: 1,
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

importSettingsBtn.addEventListener("click", () => importSettingsFile.click())
importSettingsFile.addEventListener("change", async () => {
    const [file] = importSettingsFile.files || []
    importSettingsFile.value = ""
    if (!file) return
    if (file.size > 1024 * 1024) {
        settingsStatusEl.textContent = "That file is too large to be a settings backup..."
        settingsStatusEl.classList.add("error")
        return
    }

    try {
        const parsed = JSON.parse(await file.text())
        const imported = validateImportedSettings(parsed)
        showConfirm({
            title: "Import settings?",
            body: "This replaces your saved channels, exclusions, site preferences, and update settings; your current draft will be discarded",
            actionLabel: "Import settings",
            onAction: async () => {
                await ext.storage.local.set(imported)
                await ext.storage.local.remove("pendingDraft")
                settingsStatusEl.classList.remove("error")
                settingsStatusEl.textContent = "Imported! Reloading emotes..."
                setSwitch(toggleEnabledBtn, imported.enabled !== false)
                emoteSizeInput.value = imported.emoteSize || 2
                emoteSizeValue.textContent = `${emoteSizeInput.value}x`
                excludedEmote = imported.excludedEmote || []
                caseSensitive = imported.caseSensitive === true
                caseSensitiveInput.checked = caseSensitive
                autoCheckUpdatesInput.checked = imported.autoCheckUpdates !== false
                updateCheckIntervalSelect.value = String(imported.updateCheckIntervalHours || 168)
                await triggerReload()
                settingsStatusEl.textContent = "Settings imported!"
            }
        })
    } catch (err) {
        settingsStatusEl.textContent = errorText(err, "Import failed")
        settingsStatusEl.classList.add("error")
    }
})

function validateImportedSettings(parsed) {
    if (!parsed || typeof parsed !== "object") throw new Error("Not a JSON settings object")
    if (parsed.format && parsed.format !== "7tv-anywhere-settings")
        throw new Error("This backup belongs to another application")
    const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed

    const customSets = settings.customSets
    if (!Array.isArray(customSets)
        || !customSets.every(set => set && typeof set.id === "string" && typeof set.channelId === "string"))
        throw new Error("Invalid channel/set list")
    if (!settings.channelSettings || typeof settings.channelSettings !== "object"
        || Array.isArray(settings.channelSettings))
        throw new Error("Invalid channel settings")
    if (!Array.isArray(settings.excludedEmote)
        || !settings.excludedEmote.every(name => typeof name === "string"))
        throw new Error("Invalid excluded-emote list")

    const emoteSize = Number(settings.emoteSize)
    const interval = Number(settings.updateCheckIntervalHours || 168)
    if (![1, 2, 3, 4].includes(emoteSize)) throw new Error("Invalid emote size")
    if (![24, 168, 720].includes(interval)) throw new Error("Invalid update interval")

    return {
        enabled: settings.enabled !== false,
        disabledSites: Array.isArray(settings.disabledSites) ? settings.disabledSites.filter(v => typeof v === "string") : [],
        enabledUnsupportedSites: Array.isArray(settings.enabledUnsupportedSites)
            ? settings.enabledUnsupportedSites.filter(v => typeof v === "string")
            : [],
        customSets: cloneState(customSets),
        channelSettings: cloneState(settings.channelSettings),
        emoteSize,
        excludedEmote: Array.from(new Set(settings.excludedEmote)),
        caseSensitive: settings.caseSensitive === true,
        autoCheckUpdates: settings.autoCheckUpdates !== false,
        updateCheckIntervalHours: interval,
        isInitDone: true
    }
}

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
