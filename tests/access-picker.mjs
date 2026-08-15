import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = relative => readFile(path.join(root, relative), "utf8")
const manifest = JSON.parse(await read("extension/manifest.json"))

assert.equal(manifest.content_scripts, undefined)
assert.ok(manifest.permissions.includes("scripting"))
assert.ok(manifest.optional_host_permissions.includes("<all_urls>"))

const runtimeListeners = []
const startupListeners = []
const permissionAddedListeners = []
const permissionRemovedListeners = []
const storageListeners = []
const registered = []
const injected = []
const storage = {}
let allSites = false
const grantedOrigins = new Set()
const event = listeners => ({ addListener(listener) { listeners.push(listener) } })
const ext = {
    runtime: {
        onInstalled: event(runtimeListeners),
        onStartup: event(startupListeners)
    },
    permissions: {
        async contains(request) {
            return request.origins.every(origin => origin === "<all_urls>" ? allSites : grantedOrigins.has(origin))
        },
        async remove() { return true },
        onAdded: event(permissionAddedListeners),
        onRemoved: event(permissionRemovedListeners)
    },
    scripting: {
        async getRegisteredContentScripts() { return registered },
        async registerContentScripts(scripts) { registered.splice(0, registered.length, ...scripts) },
        async updateContentScripts(scripts) { registered.splice(0, registered.length, ...scripts) },
        async unregisterContentScripts() { registered.length = 0 },
        async executeScript(details) { injected.push(details) }
    },
    storage: {
        local: {
            async get(keys) {
                const list = typeof keys === "string" ? [keys] : keys
                return Object.fromEntries(list.map(key => [key, storage[key]]))
            },
            async set(values) { Object.assign(storage, values) }
        },
        onChanged: event(storageListeners)
    }
}
const context = vm.createContext({
    ext,
    URL,
    console,
    errorText: value => String(value)
})
vm.runInContext(await read("extension/background/02-site-access.js"), context, {
    filename: "extension/background/02-site-access.js"
})
await new Promise(resolve => setTimeout(resolve, 0))
vm.runInContext(`globalThis.__accessTest = {
    siteHostname, siteOriginPattern, hasAllSiteAccess, ensureSiteContentScript,
    syncAllSiteAccess, injectSiteRuntime
}`, context)

const api = context.__accessTest
assert.equal(api.siteHostname("https://chat.example.com/room"), "chat.example.com")
assert.equal(api.siteHostname("chrome://extensions"), "")
assert.equal(api.siteOriginPattern("chat.example.com"), "*://chat.example.com/*")
allSites = true
await api.ensureSiteContentScript()
assert.equal(registered.length, 1)
assert.equal(registered[0].matches[0], "<all_urls>")
assert.equal(registered[0].allFrames, true)
assert.ok(registered[0].js.includes("content/picker.js"))

allSites = false
storage.enabledSites = ["chat.example.com"]
grantedOrigins.add("*://chat.example.com/*")
await api.ensureSiteContentScript()
assert.deepEqual(Array.from(registered[0].matches), ["*://chat.example.com/*"])

storage.enabledSites = []
await api.ensureSiteContentScript()
assert.equal(registered.length, 0)

allSites = true
assert.equal(await api.syncAllSiteAccess(), true)
assert.equal(storage.siteAccessDefault, true)
assert.equal((await api.injectSiteRuntime(42)).success, true)
assert.deepEqual(JSON.parse(JSON.stringify(injected[0].target)), { tabId: 42, allFrames: true })
assert.ok(injected[0].files.includes("content/picker.js"))

const picker = await read("extension/content/picker.js")
for (const required of [
    "pickerFavorites", "pickerUsage", "Frequently used", "sidebar", "tabs",
    'image.referrerPolicy = "no-referrer"', "channel.avatarUrl", "nav-tooltip",
    "grid-template-columns:48px minmax(0,1fr)", "pickerTriggerPositions",
    "TOUCH_DRAG_DELAY", "virtual-grid", "GRID_PRELOAD_PX", "updateVirtualRows",
    "scrollbar-color:#393445 #151822", ".panel.sidebar[hidden]{display:none}",
    "Close 7TV emote picker", "Right-click an emote", "pickerOverlayFirst",
    "Overlay emote", "contextmenu", "picker-loading", "prefers-reduced-motion:reduce",
    "captureScrollAnchor", "restoreScrollAnchor", "event.shiftKey",
    "VIRTUAL_SCROLL_IDLE_MS", "VIRTUAL_SCROLL_REFRESH_MS", "lastVirtualMountAt",
    'content.addEventListener("scroll", onContentScroll',
    'image.removeAttribute("src")', "overflow-anchor:none", "scroll-behavior:auto!important",
    "disposeVirtualRow", "mountRows = true", "virtualPlaceholder", "loadImage = true"
]) assert.ok(picker.includes(required), `picker must include ${required}`)
assert.ok(!picker.includes("Show more"), "picker must expose full fake height instead of Show more")
assert.ok(!picker.includes("visibleCounts"), "picker must not retain incremental-page state")
assert.ok(!picker.includes('content.addEventListener("scroll", scheduleVirtualUpdate'),
    "scroll events must not be mistaken for forced virtual updates")

const resolver = await read("extension/background/60-resolve.js")
assert.ok(resolver.includes("avatarUrl: normalizeAvatarUrl"), "channel lookup must return its avatar")
const emoteLoader = await read("extension/background/30-emotes.js")
assert.ok(emoteLoader.includes("channelAvatarUrl"), "loaded emotes must retain channel avatar metadata")

const onboarding = `${await read("extension/popup/js/onboarding.js")}\n${await read("extension/popup/js/onboarding-access.js")}`
for (const required of [
    "Website access", "In-page picker", "Emotes and hover", "Privacy and finish",
    "RESET_ALL_DATA", "onboardingSession", "HUGGIES_URL", "Request browser permission"
]) assert.ok(onboarding.includes(required), `onboarding must include ${required}`)
assert.ok(onboarding.includes("onboarding-live-preview"), "onboarding previews must stay visible")
assert.ok(onboarding.includes("persistOnboardingSession"), "onboarding progress must be resumable")
assert.ok(onboarding.includes("previousScroll"), "live preview rerenders must preserve scrolling")
assert.ok(!onboarding.includes("onboardingContentEl.scrollTop = 0"), "preference changes must not jump to the top")
assert.ok(!onboarding.includes("Check for extension updates automatically"), "release checks are not a first-run decision")
assert.ok(onboarding.includes("Turn on the site switch and approve permission manually on every website"),
    "per-site onboarding must explain the manual permission step")
assert.ok(onboarding.includes("onboarding-access-demo"), "website access must include a live demonstration")
assert.ok(onboarding.includes("requestDefaultSiteAccess"),
    "all-site authorization must request permission directly from the current popup")
for (const removed of ["permissionPageMode", "openPermissionSetupPage", "COMPLETE_PERMISSION_HANDOFF", "ext.windows.create"])
    assert.ok(!onboarding.includes(removed), `direct permission flow must not retain ${removed}`)

const popup = await read("extension/popup/popup.html")
const popupBaseCss = await read("extension/popup/css/base.css")
const popupSettingsCss = await read("extension/popup/css/settings.css")
assert.ok(popup.includes('aria-label="Close onboarding">×</button>'))
assert.ok(!popup.includes("Ã"), "popup controls must not contain mojibake")
assert.ok(popupBaseCss.includes("width: 360px"), "browser-action popup must keep its intended width")
assert.ok(!popupBaseCss.includes("width: min(360px, 100vw)"), "viewport-relative sizing must not collapse popup width")
for (const mode of ["on", "off"])
    assert.ok(popup.includes(`data-default-access="${mode}"`), `popup must include ${mode} default mode`)
assert.ok(popup.includes('id="toggle-site"'), "current website must have a simple switch")
assert.ok(!popup.includes('data-default-access="auto"'), "default access must not expose an unclear Auto mode")
assert.ok(popup.includes("Only sites you explicitly enable or disable are saved"))
assert.ok(!popupSettingsCss.includes(".site-access-row span"),
    "saved-site copy styles must not push the switch knob off center")

const siteAccess = await read("extension/popup/js/site-access.js")
assert.ok(siteAccess.includes('remove.textContent = "×"'), "saved website choices need a remove action")
assert.ok(siteAccess.includes('showOnboardingPermissionPrompt("default-access")'),
    "all-website On must use the visible permission handoff")
assert.ok(!siteAccess.includes("lastSeen"), "site access must not build browsing history")
const siteAccessMode = siteAccess.slice(
    siteAccess.indexOf("async function setSiteAccessMode"),
    siteAccess.indexOf("async function setCurrentSiteAccess")
)
assert.ok(siteAccessMode.indexOf("requestSitePermission(pattern)") < siteAccessMode.indexOf("ext.storage.local.get"),
    "per-site permission must be requested before an async storage read can lose the click gesture")
assert.ok(siteAccess.includes("siteRenderModeStatusEl"),
    "per-site permission failures must be visible beside the current website switch")
assert.ok(onboarding.includes("SITE_ACCESS_PERMISSION_RESULT_KEY"),
    "permission results must survive the browser closing the popup during its native prompt")
assert.ok(onboarding.includes("onboardingPermissionResumeResult"),
    "onboarding must explain a denied native prompt after the popup is reopened")
const backgroundRuntime = await read("extension/background/10-runtime.js")
for (const removed of ["COMPLETE_PERMISSION_HANDOFF", "completePermissionHandoff", "action.openPopup", "ext.windows.remove"])
    assert.ok(!backgroundRuntime.includes(removed), `background must not retain dead permission handoff ${removed}`)
const backgroundAccess = await read("extension/background/02-site-access.js")
assert.ok(!backgroundAccess.includes("rememberSiteAccess"), "background must not remember opened websites")

const manualPlayground = await read("tests/manual-emote-playground.html")
for (const required of [
    'id="plain-input"', 'id="textarea-input"', 'id="rich-editor"',
    'id="stress-test"', 'id="chat-feed"', "data-emoteanywhere-rendered"
]) assert.ok(manualPlayground.includes(required), `manual playground must include ${required}`)
assert.ok(!manualPlayground.includes("localhost"), "hosted manual playground must not assume localhost")
assert.ok(!manualPlayground.includes('src="/extension/'), "hosted manual playground must be self-contained")

console.log("verified optional host access, dynamic all-frame injection, picker preferences, and reusable onboarding")
