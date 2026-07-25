import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import { createFakeDom } from "./fake-dom.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = file => readFile(path.join(root, file), "utf8")
const plain = value => JSON.parse(JSON.stringify(value))

async function createBrowserHarness() {
    const dom = createFakeDom()
    const sentMessages = []
    const virtualCalls = { mounts: [], refreshes: [] }
    const uiCalls = { notice: 0, save: 0, home: 0, manage: 0, render: 0 }
    let messageHandler = async () => ({})
    let confirmation = null

    const context = vm.createContext({
        ...dom,
        chrome: {
            runtime: {
                async sendMessage(message) {
                    sentMessages.push(message)
                    return messageHandler(message)
                }
            }
        },
        console,
        URL,
        structuredClone,
        cloneState: value => JSON.parse(JSON.stringify(value)),
        setTimeout,
        clearTimeout,
        browserVirtualList: {
            mount(items, render, estimate, options) {
                virtualCalls.mounts.push({ items, render, estimate, options })
            },
            refresh(keys) {
                virtualCalls.refreshes.push(keys)
            }
        },
        renderNotice() { uiCalls.notice++ },
        updateSaveBar() { uiCalls.save++ },
        renderHome() { uiCalls.home++ },
        renderManageView() { uiCalls.manage++ },
        renderEmoteBrowser() { uiCalls.render++ },
        showConfirm(value) { confirmation = value }
    })

    for (const file of [
        "extension/popup/js/state.js",
        "extension/popup/js/emote-browser-data.js",
        "extension/popup/js/emote-browser-emotes.js",
        "extension/popup/js/emote-browser-set-dialog.js"
    ]) vm.runInContext(await read(file), context, { filename: file })

    vm.runInContext(`
        globalThis.__browserTest = {
            browserSets,
            browserChannels,
            makeEmoteGroup,
            syncEmoteGroupState,
            renderLoadedEmotes,
            loadBrowserSetPreview,
            openBrowserSetSelection,
            applyBrowserSetSelection,
            updateBrowserSetSelectionWarning,
            requestEnableBrowserSet,
            selectedBrowserSet,
            setDraft(value) {
                draft = fillDraft(value)
                syncDraftGlobals()
            },
            getDraft() { return draft },
            setLoaded(value) { setPopupEmote(value) },
            setFilters(channelId, setId, blockedOnly = false) {
                browserChannelFilter.value = channelId
                browserSetFilter.value = setId
                browserBlockedOnlyInput.checked = blockedOnly
            },
            getPreview(channelId, setId) {
                return browserPreviewBySet.get(previewCacheKey(channelId, setId)) || null
            },
            getPreviewError(channelId, setId) {
                return browserPreviewError.get(previewCacheKey(channelId, setId)) || null
            },
            getPreviewUi() {
                return {
                    hidden: browserSetPreviewEl.hidden,
                    copyHidden: browserSetPreviewCopyEl.hidden,
                    title: browserSetPreviewTitleEl.textContent,
                    copy: browserSetPreviewCopyEl.textContent,
                    action: browserSetPreviewActionBtn.textContent
                }
            },
            getOverlay() {
                return {
                    hidden: browserSetOverlay.hidden,
                    warning: browserSetOverlayWarningEl.textContent,
                    inputs: [...browserSetOverlayListEl.querySelectorAll('input[type="checkbox"]')],
                    labels: [...browserSetOverlayListEl.children]
                }
            }
        }
    `, context)

    return {
        ...dom,
        api: context.__browserTest,
        sentMessages,
        virtualCalls,
        uiCalls,
        setMessageHandler(handler) { messageHandler = handler },
        getConfirmation() { return confirmation }
    }
}

const harness = await createBrowserHarness()
const { api } = harness

const sets = [
    { id: "halloween", setName: "Vedal Halloween", count: 966, channelId: "vedal", channelName: "vedal987", enabled: false },
    { id: "main", setName: "Main Set", count: 964, channelId: "vedal", channelName: "vedal987", enabled: true },
    { id: "christmas", setName: "Christmas set", count: 983, channelId: "vedal", channelName: "vedal987", enabled: false },
    { id: "no-emotes", setName: "No Emotes", count: 1, channelId: "vedal", channelName: "vedal987", enabled: false },
    { id: "looking", setName: "What u looking at?", count: 885, channelId: "vedal", channelName: "vedal987", enabled: false }
]
const loaded = [
    { name: "This", id: "vedal-this", url: "vedal.webp", channelId: "vedal", channelName: "vedal987", setId: "main", setName: "Main Set", priority: 4 },
    { name: "This", id: "camila-this", url: "camila.webp", channelId: "camila", channelName: "camila", setId: "camila-main", setName: "Main Set", priority: 2 },
    { name: "OnlyVedal", id: "only", url: "only.webp", channelId: "vedal", channelName: "vedal987", setId: "main", setName: "Main Set", priority: 3 }
]

api.setDraft({
    customSets: sets,
    channelSettings: { vedal: { alwaysMain: true, knownActiveSetId: "main" } },
    excludedEmote: ["This"],
    emoteSize: 2,
    caseSensitive: false,
    matchPriority: "channel",
    renderMode: "balanced"
})
api.setLoaded(loaded)

const orderedSets = plain(api.browserSets("vedal"))
assert.deepEqual(Array.from(orderedSets, set => set.setId), ["halloween", "main", "christmas", "no-emotes", "looking"])
assert.equal(orderedSets.find(set => set.setId === "main").loadedCount, 2)
assert.equal(orderedSets.find(set => set.setId === "christmas").loadedCount, 0)

const channels = plain(api.browserChannels())
assert.deepEqual(Array.from(channels, channel => channel.channelId), ["vedal", "camila"])
assert.equal(channels[0].emotes.length, 2)
assert.equal(channels[0].sets.length, 5)

api.setFilters("vedal", "main")
api.renderLoadedEmotes()
assert.deepEqual(plain(api.getPreviewUi()), {
    hidden: true,
    copyHidden: true,
    title: "",
    copy: "",
    action: ""
})

const singleCard = api.makeEmoteGroup([loaded[2]])
assert.equal(singleCard.tagName, "ARTICLE")
assert.equal(singleCard.querySelectorAll("img").length, 1)
assert.equal(singleCard.querySelectorAll(".emote-source-list").length, 0)
assert.equal(singleCard.querySelector("[data-source-status]").textContent, "Active")

const duplicateCard = api.makeEmoteGroup(loaded.slice(0, 2))
assert.equal(duplicateCard.querySelectorAll("img").length, 2)
assert.equal(duplicateCard.querySelectorAll(".emote-source-row").length, 2)
assert.equal(duplicateCard.querySelector("[data-group-action]").textContent, "Restore all")

const vedalRow = duplicateCard.querySelectorAll(".emote-source-row")
    .find(row => row._emote.channelId === "vedal")
const vedalAction = vedalRow.querySelector("[data-source-action]")
assert.equal(vedalAction.textContent, "Restore")
vedalAction.click()
assert.deepEqual(plain(api.getDraft().excludedEmote), [{ name: "This", channelId: "camila" }])
assert.deepEqual(harness.virtualCalls.refreshes.at(-1), "this")
api.syncEmoteGroupState(duplicateCard, loaded.slice(0, 2))
assert.equal(vedalRow.querySelector("[data-source-status]").textContent, "Active")
assert.equal(vedalAction.textContent, "Block")

vedalAction.click()
api.syncEmoteGroupState(duplicateCard, loaded.slice(0, 2))
assert.deepEqual(
    Array.from(plain(api.getDraft().excludedEmote), rule => rule.channelId).sort(),
    ["camila", "vedal"]
)
assert.equal(vedalRow.querySelector("[data-source-status]").textContent, "Blocked")
assert.equal(vedalAction.textContent, "Restore")
assert.ok(harness.uiCalls.notice >= 2)
assert.ok(harness.uiCalls.save >= 2)

api.setFilters("vedal", "christmas")
api.requestEnableBrowserSet()
const confirmation = harness.getConfirmation()
assert.equal(confirmation.title, "Stop following the main set?")
assert.equal(confirmation.actionLabel, "Choose sets")
assert.match(confirmation.body, /Christmas set/)
confirmation.onAction()
let overlay = api.getOverlay()
assert.equal(overlay.hidden, false)
assert.deepEqual(Array.from(overlay.inputs, input => input.value), ["halloween", "main", "christmas", "no-emotes", "looking"])
assert.equal(overlay.labels[2].classList.contains("is-focused"), true)
assert.equal(overlay.inputs.find(input => input.value === "christmas").checked, true)
assert.match(overlay.warning, /More than one set is enabled/)
assert.match(overlay.labels[1].textContent, /currently active on the channel/)

for (const input of overlay.inputs) input.checked = input.value === "christmas"
api.updateBrowserSetSelectionWarning()
assert.equal(api.getOverlay().warning, "")
api.applyBrowserSetSelection()
const appliedDraft = plain(api.getDraft())
assert.deepEqual(
    Array.from(appliedDraft.customSets.filter(set => set.enabled), set => set.id),
    ["christmas"]
)
assert.equal(appliedDraft.channelSettings.vedal.alwaysMain, false)
assert.equal(api.getOverlay().hidden, true)
assert.equal(harness.uiCalls.home, 1)
assert.equal(harness.uiCalls.save >= 3, true)

api.setFilters("vedal", "christmas")
harness.setMessageHandler(async message => {
    assert.deepEqual(plain(message), { type: "GET_SET_EMOTES", setId: "christmas" })
    return {
        setName: "Christmas set",
        emotes: [{ name: "Snow", id: "snow", url: "snow.webp" }]
    }
})
await api.loadBrowserSetPreview(api.selectedBrowserSet())
api.renderLoadedEmotes()
assert.deepEqual(plain(harness.sentMessages.at(-1)), { type: "GET_SET_EMOTES", setId: "christmas" })
assert.equal(api.getPreviewUi().hidden, false)
assert.equal(api.getPreviewUi().copyHidden, false)
assert.match(api.getPreviewUi().title, /Previewing Christmas set/)
const preview = plain(api.getPreview("vedal", "christmas"))
assert.equal(preview.length, 1)
assert.deepEqual(preview[0], {
    name: "Snow",
    id: "snow",
    url: "snow.webp",
    channelId: "vedal",
    channelName: "vedal987",
    setId: "christmas",
    setName: "Christmas set",
    previewOnly: true,
    priority: 0
})

harness.setMessageHandler(async () => ({ error: "7TV unavailable" }))
api.setFilters("vedal", "no-emotes")
await api.loadBrowserSetPreview(api.selectedBrowserSet())
assert.match(api.getPreviewError("vedal", "no-emotes"), /7TV unavailable/)

async function testSetLoadPriority() {
    const stored = {
        customSets: [
            { id: "first", setName: "First", channelId: "vedal", channelName: "vedal987", enabled: true },
            { id: "second", setName: "Second", channelId: "vedal", channelName: "vedal987", enabled: true },
            { id: "other", setName: "Other", channelId: "camila", channelName: "camila", enabled: true }
        ],
        channelSettings: {},
        emoteSize: 2
    }
    const setData = {
        global: [],
        first: [{ id: "first-copy", name: "Same", data: { host: { url: "//cdn/first" } } }],
        second: [{ id: "second-copy", name: "Same", data: { host: { url: "//cdn/second" } } }],
        other: [{ id: "other-copy", name: "Same", data: { host: { url: "//cdn/other" } } }]
    }
    const changeListeners = []
    const context = vm.createContext({
        console,
        setTimeout,
        clearTimeout,
        CACHE_TTL_MS: 60_000,
        PARTIAL_RETRY_MS: 5_000,
        EMOTE_CACHE_VERSION: 1,
        EMOTE_FETCH_CONCURRENCY: 4,
        PARTIAL_RETRY_ALARM: "retry",
        SEVEN_TV_API: "https://7tv.test/v3",
        clamp: value => Number(value) || 2,
        errorText: value => String(value),
        refreshMain: async sets => sets,
        setEmoteLoadStatus: async () => {},
        fetchWithTimeout: async url => {
            const id = url.split("/").at(-1)
            return {
                ok: true,
                async json() { return { id, name: id, emotes: setData[id] || [] } }
            }
        },
        ext: {
            storage: {
                local: {
                    async get() { return stored },
                    async set(value) { Object.assign(stored, value) }
                },
                onChanged: { addListener(listener) { changeListeners.push(listener) } }
            },
            alarms: { create() {}, clear() {} },
            tabs: { async query() { return [] }, async sendMessage() {} }
        }
    })
    vm.runInContext(await read("extension/background/30-emotes.js"), context, {
        filename: "extension/background/30-emotes.js"
    })
    vm.runInContext("globalThis.__loadEmote = loadEmote", context)

    const result = plain(await context.__loadEmote())
    const vedal = result.emotes.find(emote => emote.channelId === "vedal" && emote.name === "Same")
    const camila = result.emotes.find(emote => emote.channelId === "camila" && emote.name === "Same")
    assert.equal(vedal.id, "first-copy")
    assert.equal(vedal.setId, "first")
    assert.equal(vedal.priority, 1)
    assert.equal(camila.id, "other-copy")
    assert.equal(camila.priority, 3)
}

async function testVirtualList() {
    const dom = createFakeDom()
    dom.window.innerHeight = 250
    dom.document.documentElement.clientHeight = 250
    const context = vm.createContext({ ...dom, console })
    vm.runInContext(await read("extension/popup/js/browser-virtual-list.js"), context, {
        filename: "extension/popup/js/browser-virtual-list.js"
    })
    vm.runInContext("globalThis.__createVirtualList = createBrowserVirtualList", context)

    const container = dom.document.createElement("div")
    const list = context.__createVirtualList(container)
    const renderCount = new Map()
    const patchCount = new Map()
    const render = item => {
        renderCount.set(item.id, (renderCount.get(item.id) || 0) + 1)
        const row = dom.document.createElement("article")
        row.dataset.itemId = item.id
        row.textContent = item.label
        return row
    }
    const patch = (node, item) => {
        patchCount.set(item.id, (patchCount.get(item.id) || 0) + 1)
        node.textContent = item.label
    }
    const items = Array.from({ length: 20 }, (_, index) => ({ id: String(index), label: `Item ${index}`, version: 1 }))

    list.mount(items, render, () => 100, {
        key: item => item.id,
        version: item => item.version,
        patch
    })
    dom.flushAnimationFrames()
    assert.equal(container.children.length, 20)
    assert.equal(container.children.filter(slot => slot.childElementCount > 0).length, 4)

    const firstSlot = container.children[0]
    const firstNode = firstSlot.firstElementChild
    const updated = items.map(item => item.id === "0" ? { ...item, label: "Updated" } : item)
    list.mount(updated, render, () => 100, {
        key: item => item.id,
        version: item => item.version,
        patch
    })
    dom.flushAnimationFrames()
    assert.equal(container.children[0], firstSlot)
    assert.equal(container.children[0].firstElementChild, firstNode)

    list.refresh("0")
    dom.flushAnimationFrames()
    assert.equal(firstNode.textContent, "Updated")
    assert.equal(patchCount.get("0"), 1)
    assert.equal(renderCount.get("0"), 1)

    dom.window._scrollY = 1500
    dom.window.dispatch("scroll")
    dom.flushAnimationFrames()
    assert.equal(firstSlot.childElementCount, 0)
    assert.equal(firstSlot.getAttribute("aria-hidden"), "true")
    assert.ok(container.children.slice(13, 18).some(slot => slot.childElementCount > 0))

    const retainedSlot = container.children[15]
    list.mount(updated.slice(10), render, () => 100, {
        key: item => item.id,
        version: item => item.version,
        patch
    })
    dom.flushAnimationFrames()
    assert.equal(container.children.length, 10)
    assert.equal(container.children[5], retainedSlot)

    list.destroy()
    assert.equal(container.children.length, 0)
}

await testSetLoadPriority()
await testVirtualList()
console.log("verified functional emote browsing, 7TV set priority, scoped blocking, set preview/selection, and virtual-list lifecycle")
