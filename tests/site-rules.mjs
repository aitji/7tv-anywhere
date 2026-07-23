import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import { backgroundModules } from "../scripts/extension-layout.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const event = { addListener() { } }
const storageData = {}
const actionState = { text: "", color: "", title: "" }
const browser = {
    runtime: {
        onInstalled: event,
        onStartup: event,
        onMessage: event,
        getManifest: () => ({ version: "test" })
    },
    storage: {
        onChanged: event,
        local: {
            async get() { return storageData },
            async set(value) { Object.assign(storageData, value) },
            async remove() { }
        }
    },
    alarms: {
        onAlarm: event,
        create() { },
        clear() { }
    },
    action: {
        async setBadgeText({ text }) { actionState.text = text },
        async setBadgeBackgroundColor({ color }) { actionState.color = color },
        async setTitle({ title }) { actionState.title = title }
    },
    tabs: {
        async query() { return [] },
        async sendMessage() { }
    }
}

const context = vm.createContext({
    browser,
    URL,
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
    console
})
for (const file of backgroundModules) {
    const source = await readFile(path.join(root, "extension", file), "utf8")
    vm.runInContext(source, context, { filename: file })
}
vm.runInContext(
    `globalThis.__siteRuleTest = {
        siteVerdict, clsComment, errorText,
        initialize, checkUpdate, reStaleOp, syncBadge, startBadgeWork,
        getDraft, saveDraft, discardDraft, addChannel,
        getEmote, reloadEmote, refreshMain, getSugg, caseFit, resChannel,
        channelRes, activeId, getSet, getUser, getTwitch
    };`,
    context
)

const {
    siteVerdict,
    clsComment,
    errorText,
    ...internal
} = context.__siteRuleTest
for (const [name, value] of Object.entries(internal))
    assert.equal(typeof value, "function", `${name} must be available across background modules`)
assert.equal(errorText(new Error("No connection.")), "No connection...")
assert.equal(errorText(null), "Something went wrong...")

storageData.pendingDraft = { customSets: [], channelSettings: {} }
await context.__siteRuleTest.syncBadge()
assert.equal(actionState.text, "?")
assert.match(actionState.title, /Unsaved changes/)

storageData.channelOperation = { phase: "resolving" }
await context.__siteRuleTest.syncBadge()
assert.equal(actionState.text, "…")
assert.match(actionState.title, /Fetching data/)

storageData.channelOperation = { phase: "error" }
await context.__siteRuleTest.syncBadge()
assert.equal(actionState.text, "!")
assert.match(actionState.title, /needs attention/)

storageData.channelOperation = null
const finishSave = context.__siteRuleTest.startBadgeWork("save")
await context.__siteRuleTest.syncBadge()
assert.equal(actionState.text, "…")
assert.match(actionState.title, /Saving changes/)
finishSave()

delete storageData.pendingDraft
storageData.updateInfo = { updateAvailable: true, latestVersion: "9.9.9" }
await context.__siteRuleTest.syncBadge()
assert.equal(actionState.text, "↑")
assert.match(actionState.title, /v9\.9\.9/)

Object.assign(storageData, {
    emoteSet: [
        { name: "Clap", id: "title", url: "https://example.com/title.webp", priority: 1 },
        { name: "cLAP", id: "mixed", url: "https://example.com/mixed.webp", priority: 5 },
        { name: "CLAP", id: "upper", url: "https://example.com/upper.webp", priority: 9 },
        { name: "LETSGO", id: "go", url: "https://example.com/go.webp", priority: 1 }
    ],
    getEmoteAt: Date.now(),
    emoteSetSize: 2,
    emoteSize: 2,
    emoteSetPartial: false,
    emoteSetKey: JSON.stringify([2, "global"]),
    customSets: [],
    excludedEmote: [],
    caseSensitive: false
})
assert.equal((await context.__siteRuleTest.getSugg("letsgo"))[0]?.name, "LETSGO")
const clap = await context.__siteRuleTest.getSugg("clap")
assert.deepEqual(
    Array.from(clap.slice(0, 3), item => item.name),
    ["Clap", "cLAP", "CLAP"]
)
storageData.emoteSet.push({
    name: "cLap",
    id: "tie",
    url: "https://example.com/tie.webp",
    priority: 10
})
assert.equal((await context.__siteRuleTest.getSugg("clap"))[0]?.name, "cLap")
storageData.caseSensitive = true
assert.equal((await context.__siteRuleTest.getSugg("letsgo")).length, 0)
assert.equal((await context.__siteRuleTest.getSugg("LETSGO"))[0]?.name, "LETSGO")
const rawConfig = await readFile(path.join(root, "sites.jsonc"), "utf8")
const { siteRules } = JSON.parse(clsComment(rawConfig))
const verdict = (url, rules = siteRules) => siteVerdict(url, rules)

assert.equal(verdict("https://youtube.com").flag, "support")
assert.equal(verdict("https://youtube.com/").flag, "support")
assert.equal(verdict("https://www.youtube.com/watch?v=abc").flag, "support")
assert.equal(verdict("https://evilyoutube.com/").flag, null)

assert.equal(verdict("https://discord.com/channels/1").flag, "not_support")
assert.equal(verdict("https://sub.discord.com/channels/1").flag, null)

assert.match(
    verdict("https://vedal.ai/pendsmthngonmydsk/").note,
    /without her permission/
)
assert.equal(verdict("https://vedal.ai/another-page").note, ":vedal: :vedal: :vedal:")
assert.equal(verdict("https://neurosama.com").note, ":Wokege: lavalamp warning")
assert.equal(verdict("https://neurosama.com/").note, ":Wokege: lavalamp warning")

assert.equal(
    verdict("https://anything.example/path", [{
        flag: "support",
        host: "",
        note: "global"
    }]).note,
    "global"
)

assert.equal(
    verdict("https://legacy.example/", [{
        flag: "support",
        pattern: "https://legacy.example",
        note: "legacy"
    }]).note,
    "legacy"
)

console.log(`verified ${siteRules.length} compatibility rules and matcher behavior`)
