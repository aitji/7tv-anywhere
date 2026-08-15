const ALL_SITE_PERMISSION = "<all_urls>"
let lastSitePermissionError = ""

function permissionPattern(host) {
    const value = String(host || "").trim().toLowerCase()
    return value && /^[a-z0-9.-]+$/i.test(value) ? `*://${value}/*` : ""
}

async function hasAllSitesPermission() {
    if (!ext.permissions?.contains) return true
    try { return await ext.permissions.contains({ origins: [ALL_SITE_PERMISSION] }) }
    catch { return false }
}

async function hasSitePermission(host) {
    if (await hasAllSitesPermission()) return true
    const pattern = permissionPattern(host)
    if (!pattern || !ext.permissions?.contains) return false
    try { return await ext.permissions.contains({ origins: [pattern] }) }
    catch { return false }
}

async function requestSitePermission(origin) {
    lastSitePermissionError = ""
    if (!ext.permissions?.request) return true
    try { return await ext.permissions.request({ origins: [origin] }) }
    catch (error) {
        lastSitePermissionError = errorText(error, "The browser could not open the permission request")
        return false
    }
}

async function removeSitePermission(origin) {
    if (!ext.permissions?.remove) return false
    try { return await ext.permissions.remove({ origins: [origin] }) }
    catch { return false }
}

async function injectCurrentSite() {
    if (!Number.isInteger(currentTabId)) return { success: false, error: "No active website tab was found" }
    try {
        const result = await ext.runtime.sendMessage({ type: "INJECT_SITE_RUNTIME", tabId: currentTabId })
        if (result?.success === false) return result
        return result && typeof result === "object" ? { success: true, ...result } : { success: true }
    } catch (error) {
        return { success: false, error: errorText(error, "7TV Anywhere could not start on this page") }
    }
}

function showSiteAccessStatus(message, error = false) {
    for (const element of [siteRenderModeStatusEl, siteAccessStatusEl]) {
        if (!element) continue
        element.textContent = message
        element.classList.toggle("error", error)
    }
}

function currentSiteAccessMode(host, state) {
    if ((state.enabledSites || []).includes(host)) return "on"
    if ((state.disabledSites || []).includes(host)) return "off"
    return "default"
}

function currentSiteIsOn(host, state) {
    const mode = currentSiteAccessMode(host, state)
    if (mode === "on") return true
    if (mode === "off") return false
    if (host === hostname && isUnsupportedSite
        && !(state.enabledUnsupportedSites || []).includes(host)) return false
    return siteAccessDefault
}

function setDefaultAccessButtons(on) {
    defaultAccessModeBtns.forEach(button => {
        const active = (button.dataset.defaultAccess === "on") === on
        button.classList.toggle("is-active", active)
        button.setAttribute("aria-pressed", active ? "true" : "false")
    })
}

function setCurrentSiteSwitch(on) {
    setSwitch(toggleSiteBtn, on)
    toggleSiteBtn.title = on ? "Disable on this website" : "Enable on this website"
    toggleSiteBtn.setAttribute("aria-label", toggleSiteBtn.title)
}

async function setDefaultSiteAccess(next, statusEl = siteAccessStatusEl) {
    statusEl?.classList.remove("error")
    if (next) {
        const granted = await requestSitePermission(ALL_SITE_PERMISSION)
        if (!granted) {
            siteAccessDefault = false
            setDefaultAccessButtons(false)
            setSwitch(defaultSiteAccessBtn, false)
            await ext.storage.local.set({ siteAccessDefault: false })
            if (statusEl) statusEl.textContent = "All-website access was not granted. Enable only the websites you trust"
            return false
        }
        siteAccessDefault = true
        await ext.storage.local.set({ siteAccessDefault: true, enabled: true })
        await injectCurrentSite()
        if (statusEl) statusEl.textContent = "7TV Anywhere can now work on websites automatically"
    } else {
        await removeSitePermission(ALL_SITE_PERMISSION)
        const state = await ext.storage.local.get(["enabledSites"])
        const retained = []
        for (const host of Array.isArray(state.enabledSites) ? state.enabledSites : []) {
            if (await hasSitePermission(host)) retained.push(host)
        }
        siteAccessDefault = false
        enabledSites = retained
        await ext.storage.local.set({ siteAccessDefault: false, enabledSites: retained })
        if (statusEl) statusEl.textContent = "Default is off. Enable and approve each website separately"
    }
    setDefaultAccessButtons(siteAccessDefault)
    setSwitch(defaultSiteAccessBtn, siteAccessDefault)
    await renderSiteAccess()
    return siteAccessDefault
}

async function setSiteAccessMode(host, mode, unsupported = false) {
    const pattern = permissionPattern(host)
    if (!pattern || !["on", "default", "off"].includes(mode)) return null
    if (mode === "on" && !siteAccessDefault) {
        showSiteAccessStatus(`Waiting for permission to use 7TV Anywhere on ${host}`)
        if (!await requestSitePermission(pattern)) {
            const detail = lastSitePermissionError || "permission was not granted"
            showSiteAccessStatus(`Could not enable ${host}: ${detail}`, true)
            return null
        }
    }
    const state = await ext.storage.local.get(["disabledSites", "enabledSites", "enabledUnsupportedSites"])
    let disabled = Array.isArray(state.disabledSites) ? state.disabledSites : []
    let enabled = Array.isArray(state.enabledSites) ? state.enabledSites : []
    let unsupportedEnabled = Array.isArray(state.enabledUnsupportedSites) ? state.enabledUnsupportedSites : []

    if (mode === "on") {
        enabled = Array.from(new Set([...enabled, host]))
        disabled = disabled.filter(item => item !== host)
        if (unsupported) unsupportedEnabled = Array.from(new Set([...unsupportedEnabled, host]))
    } else if (mode === "off") {
        disabled = Array.from(new Set([...disabled, host]))
        enabled = enabled.filter(item => item !== host)
        unsupportedEnabled = unsupportedEnabled.filter(item => item !== host)
        if (!siteAccessDefault) await removeSitePermission(pattern)
    } else {
        disabled = disabled.filter(item => item !== host)
        enabled = enabled.filter(item => item !== host)
        unsupportedEnabled = unsupportedEnabled.filter(item => item !== host)
        if (!siteAccessDefault) await removeSitePermission(pattern)
    }

    enabledSites = enabled
    await ext.storage.local.set({
        disabledSites: disabled,
        enabledSites: enabled,
        enabledUnsupportedSites: unsupportedEnabled,
        ...(mode === "on" ? { enabled: true } : {})
    })
    const injection = mode === "on" && host === hostname ? await injectCurrentSite() : null
    return { mode, injection }
}

async function setCurrentSiteAccess(next) {
    if (!hostname) return null
    const changed = await setSiteAccessMode(hostname, next ? "on" : "off", isUnsupportedSite)
    if (!changed) return null
    setCurrentSiteSwitch(next)
    if (next && changed.injection?.success === false) {
        const detail = errorText(changed.injection.error, "Reload this page to start 7TV Anywhere")
        showSiteAccessStatus(`Enabled on ${hostname}. ${detail}`, true)
    } else {
        showSiteAccessStatus(`${next ? "Enabled" : "Disabled"} on ${hostname}`)
    }
    await renderSiteAccess()
    return next
}

async function renderSiteAccess() {
    siteAccessDefault = await hasAllSitesPermission()
    const state = await ext.storage.local.get([
        "siteAccessDefault", "disabledSites", "enabledSites", "enabledUnsupportedSites", "siteAccessSites"
    ])
    state.disabledSites = Array.isArray(state.disabledSites) ? state.disabledSites : []
    state.enabledSites = Array.isArray(state.enabledSites) ? state.enabledSites : []
    state.enabledUnsupportedSites = Array.isArray(state.enabledUnsupportedSites) ? state.enabledUnsupportedSites : []
    enabledSites = state.enabledSites
    const hosts = Array.from(new Set([
        ...state.disabledSites,
        ...state.enabledSites
    ])).filter(host => permissionPattern(host)).sort((a, b) => a.localeCompare(b))

    setDefaultAccessButtons(siteAccessDefault)
    setSwitch(defaultSiteAccessBtn, siteAccessDefault)
    if (state.siteAccessDefault !== siteAccessDefault)
        await ext.storage.local.set({ siteAccessDefault })
    if (state.siteAccessSites) await ext.storage.local.remove("siteAccessSites")
    if (hostname) setCurrentSiteSwitch(currentSiteIsOn(hostname, state))
    siteAccessSummaryEl.textContent = hosts.length
        ? `${hosts.length} saved choice${hosts.length === 1 ? "" : "s"}`
        : "No saved choices"
    siteAccessListEl.replaceChildren(...hosts.map(host => {
        const on = currentSiteAccessMode(host, state) === "on"
        const row = document.createElement("div")
        row.className = "site-access-row"
        const main = document.createElement("button")
        main.className = "site-access-row-main"
        main.type = "button"
        main.title = `${on ? "Turn off" : "Turn on"} ${host}`
        const copy = document.createElement("div")
        const name = document.createElement("strong")
        name.textContent = host
        const note = document.createElement("span")
        note.textContent = on ? "Always On" : "Always Off"
        copy.append(name, note)
        const toggle = document.createElement("span")
        toggle.className = "switch switch-sm"
        toggle.setAttribute("aria-hidden", "true")
        setSwitch(toggle, on)
        const knob = document.createElement("span")
        knob.className = "switch-knob"
        toggle.appendChild(knob)
        main.append(copy, toggle)
        main.addEventListener("click", async () => {
            main.disabled = true
            await setSiteAccessMode(host, on ? "off" : "on")
            await renderSiteAccess()
        })

        const remove = document.createElement("button")
        remove.className = "site-access-remove"
        remove.type = "button"
        remove.textContent = "×"
        remove.title = `Remove ${host} override and use the website default`
        remove.setAttribute("aria-label", remove.title)
        remove.addEventListener("click", async () => {
            remove.disabled = true
            await setSiteAccessMode(host, "default")
            siteAccessStatusEl.textContent = `${host} now uses the website default`
            await renderSiteAccess()
        })
        row.append(main, remove)
        return row
    }))
}

async function toggleDefaultAccess(next, control) {
    if (next && !await hasAllSitesPermission()) {
        showOnboardingPermissionPrompt("default-access")
        return
    }
    control.disabled = true
    try { await setDefaultSiteAccess(next) }
    finally { control.disabled = false }
}

defaultAccessModeBtns.forEach(button => button.addEventListener("click", async () => {
    await toggleDefaultAccess(button.dataset.defaultAccess === "on", button)
}))

defaultSiteAccessBtn.addEventListener("click", async () => {
    await toggleDefaultAccess(!siteAccessDefault, defaultSiteAccessBtn)
})

toggleSiteBtn.addEventListener("click", async () => {
    toggleSiteBtn.disabled = true
    try { await setCurrentSiteAccess(!isOn(toggleSiteBtn)) }
    finally { toggleSiteBtn.disabled = !hostname }
})
