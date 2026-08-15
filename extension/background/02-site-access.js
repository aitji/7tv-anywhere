const SITE_CONTENT_SCRIPT_ID = "7tv-anywhere-runtime"
const SITE_CONTENT_FILES = Object.freeze([
    "content/render.js",
    "content/hover.js",
    "content/autocomplete.js",
    "content/picker.js"
])
const SITE_CONTENT_EXCLUDES = Object.freeze(["*://*.7tv.io/*", "*://*.7tv.app/*"])
const ALL_SITE_ORIGIN = "<all_urls>"

function siteHostname(value) {
    try {
        const url = new URL(String(value || ""))
        return ["http:", "https:"].includes(url.protocol) ? url.hostname : ""
    } catch { return "" }
}

function siteOriginPattern(value) {
    const hostname = value && !String(value).includes("://")
        ? String(value).trim().toLowerCase()
        : siteHostname(value)
    return hostname ? `*://${hostname}/*` : ""
}

async function hasAllSiteAccess() {
    if (!ext.permissions?.contains) return true
    try { return await ext.permissions.contains({ origins: [ALL_SITE_ORIGIN] }) }
    catch { return false }
}

async function grantedContentMatches() {
    if (await hasAllSiteAccess()) return [ALL_SITE_ORIGIN]
    const { enabledSites = [] } = await ext.storage.local.get("enabledSites")
    const matches = []
    for (const host of Array.isArray(enabledSites) ? enabledSites : []) {
        const pattern = siteOriginPattern(host)
        if (!pattern) continue
        try {
            if (!ext.permissions?.contains || await ext.permissions.contains({ origins: [pattern] }))
                matches.push(pattern)
        } catch { }
    }
    return [...new Set(matches)]
}

async function ensureSiteContentScript() {
    if (!ext.scripting?.registerContentScripts) return
    const matches = await grantedContentMatches()
    const registered = await ext.scripting.getRegisteredContentScripts({ ids: [SITE_CONTENT_SCRIPT_ID] })
    if (!matches.length) {
        if (registered.length)
            await ext.scripting.unregisterContentScripts({ ids: [SITE_CONTENT_SCRIPT_ID] }).catch(() => { })
        return
    }
    const script = {
        id: SITE_CONTENT_SCRIPT_ID,
        matches,
        excludeMatches: [...SITE_CONTENT_EXCLUDES],
        js: [...SITE_CONTENT_FILES],
        allFrames: true,
        runAt: "document_idle",
        persistAcrossSessions: true
    }
    try {
        if (registered.length) await ext.scripting.updateContentScripts([script])
        else await ext.scripting.registerContentScripts([script])
    } catch {
        try {
            await ext.scripting.unregisterContentScripts({ ids: [SITE_CONTENT_SCRIPT_ID] })
            await ext.scripting.registerContentScripts([script])
        } catch { }
    }
}

async function syncAllSiteAccess() {
    const granted = await hasAllSiteAccess()
    const { siteAccessDefault } = await ext.storage.local.get("siteAccessDefault")
    if (siteAccessDefault !== granted) await ext.storage.local.set({ siteAccessDefault: granted })
    return granted
}

async function injectSiteRuntime(tabId) {
    if (!Number.isInteger(tabId) || !ext.scripting?.executeScript)
        return { success: false, error: "No injectable tab" }
    try {
        await ext.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: [...SITE_CONTENT_FILES]
        })
        return { success: true }
    } catch (err) {
        return { success: false, error: errorText(err, "This page cannot run extensions") }
    }
}

async function resetOptionalSiteAccess() {
    if (!ext.permissions?.remove) return
    const { enabledSites = [] } = await ext.storage.local.get("enabledSites")
    const hosts = new Set(enabledSites)
    try { await ext.permissions.remove({ origins: [ALL_SITE_ORIGIN] }) }
    catch { }
    for (const host of hosts) {
        const pattern = siteOriginPattern(host)
        if (!pattern) continue
        try { await ext.permissions.remove({ origins: [pattern] }) }
        catch { }
    }
}

ext.runtime.onInstalled.addListener(() => {
    ensureSiteContentScript().catch(() => { })
    syncAllSiteAccess().catch(() => { })
})
ext.runtime.onStartup?.addListener(() => {
    ensureSiteContentScript().catch(() => { })
    syncAllSiteAccess().catch(() => { })
})
ext.permissions?.onAdded?.addListener(() => {
    syncAllSiteAccess().catch(() => { })
    ensureSiteContentScript().catch(() => { })
})
ext.permissions?.onRemoved?.addListener(() => {
    syncAllSiteAccess().catch(() => { })
    ensureSiteContentScript().catch(() => { })
})
ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabledSites || changes.siteAccessDefault))
        ensureSiteContentScript().catch(() => { })
})
ensureSiteContentScript().catch(() => { })
