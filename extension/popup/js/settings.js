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

zeroWidthEmoteInput.addEventListener("change", () => {
    draft.zeroWidthEmote = zeroWidthEmoteInput.checked
    syncDraftGlobals()
    zeroWidthEmoteStatusEl.textContent = zeroWidthEmoteInput.checked
        ? "Overlay stacking added to your draft"
        : "Side-by-side overlays added to your draft"
    updateSaveBar()
})

zeroWidthTextInput.addEventListener("change", () => {
    draft.zeroWidthText = zeroWidthTextInput.checked
    syncDraftGlobals()
    zeroWidthTextStatusEl.textContent = zeroWidthTextInput.checked
        ? "Text overlays added to your draft"
        : "Normal-width standalone overlays added to your draft"
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
        : `${cleanRenderMode(selected)} changes page scanning only on ${hostname}; downloads and other features stay unchanged`
    renderSettingsData()
})

function setRenderModeDraft(value) {
    draft.renderMode = cleanRenderMode(value)
    syncDraftGlobals()
    renderModeStatusEl.textContent = renderMode === "light"
        ? "Light scans new text only and skips shadow-root/current-page scans. Emotes, overlays, hover, and update checks stay unchanged"
        : renderMode === "full"
            ? "Full scans more page content with higher CPU use. Emote data and other features stay unchanged"
            : "Balanced scans current content and common open components. Emote data and other features stay unchanged"
    updateSaveBar()
}

renderModeSelect.addEventListener("change", () => {
    const selected = cleanRenderMode(renderModeSelect.value)
    if (selected !== "light" || !maintainerGuidance) return setRenderModeDraft(selected)
    renderModeSelect.value = renderMode
    showConfirm({
        title: "Use Light mode?",
        body: "Light prioritizes new text and skips current-page and shadow-root scans. It also turns off maintainer compatibility downloads. Emote downloads, overlays, hover details, and update checks do not change.",
        actionLabel: "Use Light mode",
        onAction: async () => {
            await setMaintainerGuidance(false)
            setRenderModeDraft("light")
        }
    })
})

emoteHoverStyleSelect.addEventListener("change", () => {
    const style = cleanHoverStyle(emoteHoverStyleSelect.value)
    draft.emoteHoverStyle = style
    emoteHoverStyleSelect.value = style
    emoteHoverStatusEl.textContent = style === "card"
        ? `Card added to draft: ${formatHoverSample(emoteHoverTemplateInput.value)}`
        : `Tooltip added to draft: ${formatHoverSample(emoteHoverTemplateInput.value)}`
    updateSaveBar()
})

emoteHoverLayoutSelect.addEventListener("change", () => {
    const layout = cleanHoverLayout(emoteHoverLayoutSelect.value)
    draft.emoteHoverLayout = layout
    emoteHoverLayoutSelect.value = layout
    emoteHoverStatusEl.textContent = `${emoteHoverLayoutSelect.selectedOptions[0].textContent} added to your draft`
    updateSaveBar()
})

emoteHoverTemplateInput.addEventListener("input", () => {
    emoteHoverStatusEl.textContent = `Preview: ${formatHoverSample(emoteHoverTemplateInput.value)}`
})
emoteHoverTemplateInput.addEventListener("change", () => {
    const template = cleanHoverTemplate(emoteHoverTemplateInput.value)
    draft.emoteHoverTemplate = template
    emoteHoverTemplateInput.value = template
    emoteHoverStatusEl.textContent = `Added to draft: ${formatHoverSample(template)}`
    updateSaveBar()
})

emoteHoverDelayInput.addEventListener("input", () => {
    emoteHoverDelayValue.textContent = `${emoteHoverDelayInput.value} ms`
})
emoteHoverDelayInput.addEventListener("change", () => {
    const delay = cleanHoverDelay(emoteHoverDelayInput.value)
    draft.emoteHoverDelay = delay
    emoteHoverDelayInput.value = delay
    emoteHoverDelayValue.textContent = `${delay} ms`
    emoteHoverStatusEl.textContent = `${delay} ms hover delay added to your draft`
    updateSaveBar()
})

autoCheckUpdatesInput.addEventListener("change", async () => {
    await ext.storage.local.set({ autoCheckUpdates: autoCheckUpdatesInput.checked })
    updateCheckStatusEl.textContent = autoCheckUpdatesInput.checked
        ? "Automatic update checks enabled!"
        : "Automatic checks disabled, manual checks still work"
})

async function setMaintainerGuidance(enabled) {
    const previous = maintainerGuidance
    try {
        await ext.storage.local.set({ maintainerGuidance: enabled })
        maintainerGuidance = enabled
        maintainerGuidanceInput.checked = enabled
        refreshSiteRulesBtn.disabled = !enabled
        if (!enabled) {
            await ext.storage.local.remove(["siteCfg", "siteCfgAt"])
            siteRuleCount = 0
            siteRulesCachedAt = null
            isUnsupportedSite = false
            siteNote = null
            siteRuleFlag = null
            siteRulesStatusEl.textContent = "Disabled. No maintainer compatibility request will run"
        } else {
            const verdict = currentTabUrl ? await getVerdict(currentTabUrl) : null
            isUnsupportedSite = !!(verdict && verdict.unsupported)
            siteNote = verdict && verdict.note || null
            siteRuleFlag = verdict && verdict.flag || null
            siteRuleCount = Number(verdict && verdict.ruleCount) || 0
            siteRulesStatusEl.textContent = "Maintainer guidance enabled"
        }
        renderNotice()
        renderSettingsData()
    } catch (err) {
        maintainerGuidance = previous
        maintainerGuidanceInput.checked = previous
        refreshSiteRulesBtn.disabled = !previous
        throw err
    }
}

maintainerGuidanceInput.addEventListener("change", () => {
    setMaintainerGuidance(maintainerGuidanceInput.checked).catch(err => {
        maintainerGuidanceInput.checked = maintainerGuidance
        siteRulesStatusEl.textContent = errorText(err)
        siteRulesStatusEl.classList.add("error")
    })
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
    "renderMode", "siteRenderModes", "zeroWidthEmote", "zeroWidthText",
    "emoteHoverStyle", "emoteHoverLayout", "emoteHoverTemplate", "emoteHoverDelay",
    "autoCheckUpdates", "updateCheckIntervalHours", "maintainerGuidance"
]

exportSettingsBtn.addEventListener("click", async () => {
    settingsStatusEl.classList.remove("error")
    const settings = await ext.storage.local.get(backupKeys)
    const payload = {
        format: "7tv-anywhere-settings",
        schemaVersion: 5,
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
    if (!maintainerGuidance) return
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
