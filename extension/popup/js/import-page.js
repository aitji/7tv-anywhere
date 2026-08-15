(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser
    const fileInput = document.getElementById("import-file")
    const applyBtn = document.getElementById("import-apply")
    const closeBtn = document.getElementById("import-close")
    const summary = document.getElementById("import-summary")
    const status = document.getElementById("import-status")
    let imported = null

    const clone = value => JSON.parse(JSON.stringify(value))
    const cleanPriority = value => value === "case" ? "case" : "channel"
    const cleanMode = value => ["light", "balanced", "full"].includes(value) ? value : "balanced"
    const cleanHoverStyle = value => value === "title" ? "title" : "card"
    const cleanHoverTemplate = value => String(value || "{original} ({emote}@{channel})").trim().slice(0, 400)
        || "{original} ({emote}@{channel})"
    const cleanHoverDelay = value => Math.max(0, Math.min(1500, Number(value) || 0))
    const cleanExcluded = value => {
        if (!Array.isArray(value)) throw new Error("Invalid blocked-emote list")
        const out = []
        const seen = new Set()
        for (const item of value) {
            const name = typeof item === "string"
                ? item.trim()
                : item && typeof item.name === "string"
                    ? item.name.trim()
                    : ""
            if (!name) throw new Error("Invalid blocked-emote rule")
            const channelId = item && typeof item === "object" && typeof item.channelId === "string"
                ? item.channelId.trim()
                : ""
            if (item && typeof item === "object" && !channelId)
                throw new Error("Invalid channel-specific blocked-emote rule")
            const key = `${channelId || "*"}\0${name}`
            if (seen.has(key)) continue
            seen.add(key)
            out.push(channelId ? { name, channelId } : name)
        }
        return out
    }
    const fail = message => {
        imported = null
        applyBtn.disabled = true
        status.textContent = String(message || "Import failed")
        status.classList.add("error")
    }

    fileInput.addEventListener("change", async () => {
        status.textContent = ""
        status.classList.remove("error")
        imported = null
        applyBtn.disabled = true
        const [file] = fileInput.files || []
        if (!file) return
        if (file.size > 1024 * 1024) return fail("That file is too large to be a settings backup...")

        try {
            imported = validate(JSON.parse(await file.text()))
            const channels = new Set(imported.customSets.map(set => set.channelId)).size
            summary.textContent = `${file.name} · ${channels} channel${channels === 1 ? "" : "s"} · ${imported.customSets.length} set${imported.customSets.length === 1 ? "" : "s"}`
            applyBtn.disabled = false
            status.textContent = "Backup is valid and ready to import"
        } catch (err) {
            summary.textContent = file.name
            fail(err instanceof Error ? err.message : err)
        }
    })

    applyBtn.addEventListener("click", async () => {
        if (!imported) return
        applyBtn.disabled = true
        fileInput.disabled = true
        status.classList.remove("error")
        status.textContent = "Importing settings and reloading emotes..."
        try {
            const requestedOrigins = imported.siteAccessDefault
                ? ["<all_urls>"]
                : imported.enabledSites.map(host => `*://${host}/*`)
            const granted = !requestedOrigins.length || !ext.permissions?.request
                ? true
                : await ext.permissions.request({ origins: requestedOrigins })
            if (!granted) {
                imported.siteAccessDefault = false
                imported.enabledSites = []
            }
            await ext.storage.local.set({
                ...imported,
                initStatus: {
                    phase: "ready",
                    message: "Ready!",
                    startedAt: Date.now(),
                    updatedAt: Date.now(),
                    finishedAt: Date.now()
                }
            })
            await ext.storage.local.remove(["pendingDraft", "channelOperation"])
            const result = await ext.runtime.sendMessage({ type: "RELOAD_EMOTES" })
            if (!result || !result.success)
                throw new Error((result && result.error) || "Settings imported, but emotes could not be reloaded")
            status.textContent = `Settings imported! Loaded ${(result.emotes || []).length} emotes`
            summary.textContent = "Import complete. You can close this tab."
        } catch (err) {
            status.textContent = err instanceof Error ? err.message : String(err)
            status.classList.add("error")
            applyBtn.disabled = false
            fileInput.disabled = false
        }
    })

    closeBtn.addEventListener("click", async () => {
        try {
            const tab = await ext.tabs.getCurrent()
            if (tab && tab.id !== undefined) return await ext.tabs.remove(tab.id)
        } catch { }
        window.close()
    })

    function validate(parsed) {
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
        const excludedEmote = cleanExcluded(settings.excludedEmote)

        const emoteSize = Number(settings.emoteSize)
        const interval = Number(settings.updateCheckIntervalHours || 168)
        if (![1, 2, 3, 4].includes(emoteSize)) throw new Error("Invalid emote size")
        if (![24, 168, 720].includes(interval)) throw new Error("Invalid update interval")

        return {
            enabled: settings.enabled !== false,
            siteAccessDefault: settings.siteAccessDefault === true,
            enabledSites: Array.isArray(settings.enabledSites)
                ? settings.enabledSites.filter(v => typeof v === "string" && /^[a-z0-9.-]+$/i.test(v))
                : [],
            disabledSites: Array.isArray(settings.disabledSites) ? settings.disabledSites.filter(v => typeof v === "string") : [],
            enabledUnsupportedSites: Array.isArray(settings.enabledUnsupportedSites)
                ? settings.enabledUnsupportedSites.filter(v => typeof v === "string")
                : [],
            customSets: clone(customSets),
            channelSettings: clone(settings.channelSettings),
            emoteSize,
            excludedEmote,
            caseSensitive: settings.caseSensitive === true,
            matchPriority: cleanPriority(settings.matchPriority),
            renderMode: cleanMode(settings.renderMode),
            zeroWidthEmote: settings.zeroWidthEmote !== false,
            zeroWidthText: settings.zeroWidthText === true,
            emoteHoverStyle: cleanHoverStyle(settings.emoteHoverStyle),
            emoteHoverLayout: ["right", "left", "top", "hidden"].includes(settings.emoteHoverLayout)
                ? settings.emoteHoverLayout
                : "right",
            emoteHoverTemplate: cleanHoverTemplate(settings.emoteHoverTemplate),
            emoteHoverDelay: settings.emoteHoverDelay === undefined ? 350 : cleanHoverDelay(settings.emoteHoverDelay),
            pickerEnabled: settings.pickerEnabled !== false,
            pickerLayout: settings.pickerLayout === "sidebar" ? "sidebar" : "tabs",
            pickerFavorites: Array.isArray(settings.pickerFavorites)
                ? settings.pickerFavorites.filter(value => typeof value === "string").slice(0, 500)
                : [],
            pickerUsage: settings.pickerUsage && typeof settings.pickerUsage === "object"
                && !Array.isArray(settings.pickerUsage) ? clone(settings.pickerUsage) : {},
            pickerTriggerPositions: Object.fromEntries(Object.entries(
                settings.pickerTriggerPositions && typeof settings.pickerTriggerPositions === "object"
                    ? settings.pickerTriggerPositions
                    : {}
            ).filter(([host, offset]) => /^[a-z0-9.-]+$/i.test(host)
                && offset && Number.isFinite(offset.x) && Number.isFinite(offset.y))
                .map(([host, offset]) => [host, {
                    x: Math.max(-2000, Math.min(2000, Math.round(offset.x))),
                    y: Math.max(-2000, Math.min(2000, Math.round(offset.y)))
                }])),
            siteRenderModes: Object.fromEntries(Object.entries(
                settings.siteRenderModes && typeof settings.siteRenderModes === "object"
                    ? settings.siteRenderModes
                    : {}
            ).filter(([host, mode]) => typeof host === "string" && ["light", "balanced", "full"].includes(mode))),
            autoCheckUpdates: settings.autoCheckUpdates !== false,
            maintainerGuidance: settings.maintainerGuidance !== false,
            updateCheckIntervalHours: interval,
            isInitDone: true
        }
    }
})()
