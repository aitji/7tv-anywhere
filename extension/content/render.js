(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser
    const shared = globalThis.__7tvAnywhereShared ||= {}
    shared.getSiteVerdict ||= url => {
        if (shared.siteVerdictUrl !== url || !shared.siteVerdictPromise) {
            shared.siteVerdictUrl = url
            shared.siteVerdictPromise = Promise.resolve(
                ext.runtime.sendMessage({ type: "IS_SITE_UNSUPPORTED", url })
            ).catch(() => ({ unsupported: false }))
        }
        return shared.siteVerdictPromise
    }
    shared.getTopSite ||= () => {
        if (!shared.topSitePromise) {
            const request = window.top === window
                ? Promise.resolve({ hostname: location.hostname, url: location.href })
                : Promise.resolve(ext.runtime.sendMessage({ type: "GET_TOP_LEVEL_SITE", url: location.href }))
            shared.topSitePromise = request.then(site => ({
                hostname: site && site.hostname || location.hostname,
                url: site && site.url || location.href
            })).catch(() => ({ hostname: location.hostname, url: location.href }))
        }
        return shared.topSitePromise
    }

    const SKIP_TAGS = Object.freeze(new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
        "IFRAME", "OBJECT", "EMBED", "CODE", "PRE", "SVG"
    ]))

    const WORD_RE = /[A-Za-z0-9_]+/g
    const DEFAULT_HOVER_TEMPLATE = "{original} ({emote}@{channel})"
    const MODE = Object.freeze({
        light: { maxNodeLength: 4000, chunkSize: 80, observeShadow: false, initialScan: false },
        balanced: { maxNodeLength: 12000, chunkSize: 160, observeShadow: true, initialScan: true },
        full: { maxNodeLength: 20000, chunkSize: 240, observeShadow: true, initialScan: true }
    })

    let emoteMap = new Map()
    let emoteSize = 2
    let caseSensitive = false
    let matchPriority = "channel"
    let renderMode = "balanced"
    let renderCfg = MODE.balanced
    let zeroWidthEmote = true
    let zeroWidthText = false
    let minNameLength = Infinity
    let maxNameLength = 0
    let firstChar = new Set()
    let pickCache = new Map()
    let isActive = false
    let observer = null
    let observedRoots = new WeakSet()
    const knownRoots = new Set([document])
    let needsRefresh = false
    let lifeRev = 0
    let processRev = 0

    const pendingRoot = new Set()
    const ownNode = new WeakSet()
    shared.emoteInfo ||= new WeakMap()
    shared.hoverCfg ||= {
        style: "card",
        layout: "right",
        template: DEFAULT_HOVER_TEMPLATE,
        delay: 350
    }
    shared.formatEmoteHover ||= (template, info) => {
        const emotes = Array.isArray(info && info.emotes) ? info.emotes : []
        const names = emotes.map(item => item.name).filter(Boolean).join(" + ")
        const channels = [...new Set(emotes.map(item => item.channelName).filter(Boolean))].join(" + ")
        const value = String(template || DEFAULT_HOVER_TEMPLATE).replace(/\{(original|emote|channel)\}/g, (_, key) => ({
            original: String(info && info.original || "").trim(),
            emote: names,
            channel: channels || "Global 7TV"
        })[key])
        return value.trim() || names || String(info && info.original || "").trim()
    }
    let scheduled = false

    setTimeout(init, 0)

    async function init() {
        ext.storage.onChanged.addListener(storageChange)
        ext.runtime.onMessage.addListener(runtimeMessage)
        document.addEventListener("visibilitychange", visibilityChange)
        await evlActive()
    }

    async function runtimeMessage(msg) {
        if (msg && msg.type === "EMOTES_UPDATED" && isActive) {
            await refreshEmote()
        }
    }

    async function storageChange(changes, area) {
        if (area !== "local") return
        if ("siteCfg" in changes) {
            shared.siteVerdictUrl = null
            shared.siteVerdictPromise = null
        }
        if ("enabled" in changes || "disabledSites" in changes || "enabledUnsupportedSites" in changes || "siteCfg" in changes) await evlActive()
        if (isActive && ("excludedEmote" in changes || "emoteSet" in changes
            || "emoteSize" in changes || "caseSensitive" in changes || "matchPriority" in changes
            || "renderMode" in changes || "siteRenderModes" in changes || "zeroWidthEmote" in changes
            || "zeroWidthText" in changes
            || "emoteHoverStyle" in changes || "emoteHoverLayout" in changes
            || "emoteHoverTemplate" in changes || "emoteHoverDelay" in changes)) {
            await refreshEmote()
        }
    }

    async function visibilityChange() {
        if (document.hidden) return suspend()
        await resume()
    }

    function suspend() {
        lifeRev++
        stopObserving()
        emoteMap.clear()
    }

    async function resume() {
        if (!isActive || document.hidden || observer) return
        const rev = ++lifeRev
        const loaded = await loadEmote()
        if (!loaded || rev !== lifeRev || !isActive || document.hidden) return
        applyEmote(loaded)

        if (needsRefresh) {
            restoreRendered()
            needsRefresh = false
        }
        startObserving()
    }

    async function refreshEmote() {
        if (!isActive) return
        needsRefresh = true
        if (document.hidden) return suspend()

        const rev = ++lifeRev
        const loaded = await loadEmote()
        if (!loaded || rev !== lifeRev || !isActive || document.hidden) return
        const modeChanged = renderMode !== loaded.renderMode
        applyEmote(loaded)

        if (modeChanged && observer) stopObserving()
        restoreRendered()
        needsRefresh = false
        if (observer) schProing(document.body)
        else startObserving()
    }

    async function checkUnsupported(site) {
        const res = await shared.getSiteVerdict(site.url)
        return !!(res && res.unsupported)
    }

    async function evlActive() {
        const [state, site] = await Promise.all([
            ext.storage.local.get(["enabled", "disabledSites", "enabledUnsupportedSites"]),
            shared.getTopSite()
        ])
        const { enabled = true, disabledSites = [], enabledUnsupportedSites = [] } = state
        const isUnsupported = await checkUnsupported(site)
        const siteOk = isUnsupported
            ? enabledUnsupportedSites.includes(site.hostname)
            : !disabledSites.includes(site.hostname)
        const shouldBeActive = enabled && siteOk

        if (shouldBeActive && !isActive) {
            isActive = true
            await resume()
        } else if (!shouldBeActive && isActive) {
            lifeRev++
            isActive = false
            needsRefresh = false
            stopObserving()
            emoteMap.clear()
            restoreRendered()
        } else if (shouldBeActive && !document.hidden && !observer) {
            await resume()
        }
    }

    async function loadEmote() {
        let result
        try {
            result = await Promise.all([
                ext.runtime.sendMessage({ type: "GET_EMOTES" }),
                ext.storage.local.get([
                    "excludedEmote", "emoteSize", "caseSensitive", "matchPriority", "renderMode", "siteRenderModes",
                    "zeroWidthEmote", "zeroWidthText", "emoteHoverStyle", "emoteHoverLayout", "emoteHoverTemplate", "emoteHoverDelay"
                ]),
                shared.getTopSite()
            ])
        } catch { return false }
        const [{
            emotes = []
        } = {}, {
            excludedEmote = [],
            emoteSize: size,
            caseSensitive: matchCase = false,
            matchPriority: priorityMode = "channel",
            renderMode: mode = "balanced",
            siteRenderModes = {},
            zeroWidthEmote: stackZeroWidth = true,
            zeroWidthText: stackOnText = false,
            emoteHoverStyle: hoverStyle = "card",
            emoteHoverLayout: hoverLayout = "right",
            emoteHoverTemplate: hoverTemplate = DEFAULT_HOVER_TEMPLATE,
            emoteHoverDelay: hoverDelay = 350
        } = {}, site = {}] = result

        const nextSize = size || 2
        const nextCase = matchCase === true
        const nextPriority = priorityMode === "case" ? "case" : "channel"
        const nextMode = cleanRenderMode(
            siteRenderModes && typeof siteRenderModes === "object" && siteRenderModes[site.hostname]
                ? siteRenderModes[site.hostname]
                : mode
        )
        const key = name => nextCase ? name : String(name).toLowerCase()
        const map = new Map()
        const excluded = makeExclusionMatcher(excludedEmote, nextCase)
        let min = Infinity
        let max = 0
        const first = new Set()
        for (const emote of emotes) {
            if (excluded(emote)) continue
            const name = key(emote.name)
            min = Math.min(min, name.length)
            max = Math.max(max, name.length)
            first.add(name[0])
            const variant = map.get(name) || []
            variant.push(emote)
            map.set(name, variant)
        }
        return {
            map,
            size: nextSize,
            caseSensitive: nextCase,
            matchPriority: nextPriority,
            renderMode: nextMode,
            zeroWidthEmote: stackZeroWidth !== false,
            zeroWidthText: stackOnText === true,
            hoverCfg: {
                style: hoverStyle === "title" ? "title" : "card",
                layout: ["right", "left", "top", "hidden"].includes(hoverLayout) ? hoverLayout : "right",
                template: String(hoverTemplate || DEFAULT_HOVER_TEMPLATE).slice(0, 400),
                delay: Math.max(0, Math.min(1500, Number(hoverDelay) || 0))
            },
            minNameLength: Number.isFinite(min) ? min : Infinity,
            maxNameLength: max,
            firstChar: first
        }
    }

    function applyEmote(loaded) {
        emoteMap = loaded.map
        emoteSize = loaded.size
        caseSensitive = loaded.caseSensitive
        matchPriority = loaded.matchPriority
        renderMode = loaded.renderMode
        renderCfg = MODE[renderMode]
        zeroWidthEmote = loaded.zeroWidthEmote
        zeroWidthText = loaded.zeroWidthText
        pickCache = new Map()
        shared.hoverCfg = loaded.hoverCfg
        minNameLength = loaded.minNameLength
        maxNameLength = loaded.maxNameLength
        firstChar = loaded.firstChar
    }

    function cleanRenderMode(value) {
        return MODE[value] ? value : "balanced"
    }

    function sourceId(emote) {
        return String(emote && emote.channelId
            ? emote.channelId
            : emote && emote.channelName
                ? `legacy:${emote.channelName}`
                : "global")
    }

    function makeExclusionMatcher(excluded, matchCase) {
        const global = new Set()
        const bySource = new Set()
        for (const item of Array.isArray(excluded) ? excluded : []) {
            const name = typeof item === "string"
                ? item
                : item && typeof item.name === "string"
                    ? item.name
                    : ""
            if (!name) continue
            const key = matchCase ? name : name.toLowerCase()
            if (typeof item === "string") global.add(key)
            else if (typeof item.channelId === "string") bySource.add(`${item.channelId}\0${key}`)
        }
        return emote => {
            const name = String(emote && emote.name || "")
            const key = matchCase ? name : name.toLowerCase()
            return global.has(key) || bySource.has(`${sourceId(emote)}\0${key}`)
        }
    }

    function startObserving() {
        if (!document.body || document.hidden || !isActive || observer) return
        processRev++
        observer = new MutationObserver(handleMutations)
        observeRoot(document.body)
        if (renderCfg.observeShadow) observeOpenShadows(document.body)
        if (renderCfg.initialScan) schProing(document.body)
    }

    function observeRoot(root) {
        if (!observer || observedRoots.has(root)) return
        observer.observe(root, { childList: true, subtree: true, characterData: true })
        observedRoots.add(root)
        knownRoots.add(root)
    }

    function observeOpenShadows(root) {
        if (!root) return
        const observe = element => {
            if (!element.shadowRoot || observedRoots.has(element.shadowRoot)) return
            observeRoot(element.shadowRoot)
            schProing(element.shadowRoot)
        }
        if (root.nodeType === Node.ELEMENT_NODE) observe(root)
        if (root.querySelectorAll) for (const element of root.querySelectorAll("*")) observe(element)
    }

    function stopObserving() {
        processRev++
        if (observer) observer.disconnect()
        observer = null
        observedRoots = new WeakSet()
        pendingRoot.clear()
        scheduled = false
    }

    function canProcess() {
        return isActive && !document.hidden && !!observer
    }

    function handleMutations(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === "childList") mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return
                if (ownNode.has(node)) {
                    ownNode.delete(node)
                    return
                }
                if (node.nodeType === Node.ELEMENT_NODE && renderCfg.observeShadow) observeOpenShadows(node)
                schProing(node)
            })

            else if (mutation.type === "characterData") {
                if (ownNode.has(mutation.target)) ownNode.delete(mutation.target)
                else schProing(mutation.target)
            }
        }
    }

    function schProing(root) {
        if (!canProcess()) return
        if (isSkipSub(root)) return
        queueRoot(root)
        if (scheduled) return
        scheduled = true
        const rev = processRev

        const run = () => {
            scheduled = false
            if (!canProcess() || rev !== processRev) {
                pendingRoot.clear()
                return
            }
            const roots = Array.from(pendingRoot)
            pendingRoot.clear()
            for (const r of roots) processRoot(r)
        }

        queueMicrotask(run)
    }

    function queueRoot(root) {
        for (const pending of pendingRoot) {
            if (containsRoot(pending, root)) return
            if (containsRoot(root, pending)) pendingRoot.delete(pending)
        }
        pendingRoot.add(root)
    }

    function containsRoot(parent, child) {
        if (parent === child) return true
        if (parent.nodeType === Node.TEXT_NODE || typeof parent.contains !== "function") return false
        return parent.contains(child)
    }

    function isSkipSub(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false
        return shouldSkipElement(node)
    }

    function shouldSkipElement(element) {
        if (!element) return false
        if (SKIP_TAGS.has(element.tagName)) return true
        if (element.isContentEditable) return true
        if (!element.closest) return false
        return !!element.closest([
            "[data-emoteanywhere-skip]",
            "[contenteditable]",
            "[role='textbox']",
            "[data-slate-editor='true']",
            "[aria-hidden='true']",
            "button"
        ].join(","))
    }

    function processRoot(root) {
        if (!canProcess()) return
        if (!emoteMap.size) return
        if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && !root.isConnected && root !== document.body) return

        if (root.nodeType === Node.TEXT_NODE) {
            if (acceptNode(root) !== NodeFilter.FILTER_ACCEPT) return
            return proTextNode(root)
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode })
        const textNodes = []
        let n
        while ((n = walker.nextNode())) textNodes.push(n)
        proNodeChunk(textNodes)
    }

    function proNodeChunk(node) {
        if (!node.length) return
        let index = 0
        const rev = processRev

        function step(deadline) {
            if (!canProcess() || rev !== processRev) return
            const hasDeadline = deadline && typeof deadline.timeRemaining === "function"
            let sinceYield = 0
            while (index < node.length) {
                proTextNode(node[index])
                index++
                sinceYield++
                if (sinceYield >= renderCfg.chunkSize) break
                if (hasDeadline && deadline.timeRemaining() <= 0) break
            }

            if (index < node.length) {
                if (typeof requestIdleCallback === "function") requestIdleCallback(step, { timeout: 1000 })
                else setTimeout(step, 16)
            }
        }

        if (typeof requestIdleCallback === "function") requestIdleCallback(step, { timeout: 1000 })
        else setTimeout(step, 0)
    }

    function acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT
        if (!node.nodeValue || node.nodeValue.length > renderCfg.maxNodeLength) return NodeFilter.FILTER_REJECT

        return NodeFilter.FILTER_ACCEPT
    }

    function proTextNode(textNode) {
        if (ownNode.has(textNode)) {
            ownNode.delete(textNode)
            return
        }
        if (!textNode.parentNode) return

        const text = textNode.nodeValue
        if (!text || text.length < 2) return
        if (text.length < minNameLength) return

        const frag = buildFragment(text)
        if (!frag) return

        textNode.parentNode.replaceChild(frag, textNode)
    }

    function buildFragment(text) {
        WORD_RE.lastIndex = 0
        let match
        const token = []

        while ((match = WORD_RE.exec(text)) !== null) {
            if (!canMatchWord(match[0])) continue
            const emote = pickEmote(match[0])
            if (!emote) continue

            let start = match.index
            let end = match.index + match[0].length

            if (start > 0 && text[start - 1] === ":" && text[end] === ":") {
                start -= 1
                end += 1
            }

            token.push({ emote, start, end, original: text.slice(start, end) })
        }

        if (!token.length) return null
        const group = []
        for (const item of token) {
            const previous = group[group.length - 1]
            if (zeroWidthEmote && item.emote.zeroWidth && previous
                && isInlineSpace(text.slice(previous.end, item.start))) {
                previous.item.push(item)
                previous.end = item.end
            } else group.push({
                start: item.start,
                end: item.end,
                item: [item],
                textOverlay: zeroWidthEmote && zeroWidthText && item.emote.zeroWidth
            })
        }

        let lastIndex = 0
        let previous = null
        const frag = document.createDocumentFragment()
        for (const item of group) {
            let sourceStart = item.start
            const gap = text.slice(lastIndex, item.start)
            if (item.textOverlay) {
                while (sourceStart > lastIndex && isInlineSpaceChar(text[sourceStart - 1])) sourceStart--
            } else if (previous && !previous.textOverlay && isInlineSpace(gap)) sourceStart = lastIndex

            if (sourceStart > lastIndex) appendOwnText(frag, text.slice(lastIndex, sourceStart))
            const original = text.slice(item.start, item.end)
            const source = text.slice(sourceStart, item.end)
            frag.appendChild(createEmoteStack(item.item, original, source, item.textOverlay))
            lastIndex = item.end
            previous = item
        }
        if (lastIndex < text.length) appendOwnText(frag, text.slice(lastIndex))
        return frag
    }

    function appendOwnText(parent, text) {
        const node = document.createTextNode(text)
        ownNode.add(node)
        parent.appendChild(node)
    }

    function isInlineSpace(value) {
        for (let i = 0; i < value.length; i++) if (!isInlineSpaceChar(value[i])) return false
        return true
    }

    function isInlineSpaceChar(char) {
        return char === " " || char === "\t" || char === "\u00a0"
    }

    function canMatchWord(word) {
        if (word.length < minNameLength || word.length > maxNameLength) return false
        const first = caseSensitive ? word[0] : word[0].toLowerCase()
        return firstChar.has(first)
    }

    function pickEmote(input) {
        if (pickCache.has(input)) return pickCache.get(input)
        const key = caseSensitive ? input : input.toLowerCase()
        const variant = emoteMap.get(key)
        if (!variant || !variant.length) return rememberPick(input, null)
        if (variant.length === 1) return rememberPick(input, variant[0])

        let best = variant[0]
        let bestCase = caseFit(input, best.name)
        for (let i = 1; i < variant.length; i++) {
            const item = variant[i]
            const score = caseFit(input, item.name)
            const itemPriority = item.priority || 0
            const bestPriority = best.priority || 0
            const better = matchPriority === "case"
                ? score > bestCase || (score === bestCase && itemPriority > bestPriority)
                : itemPriority > bestPriority || (itemPriority === bestPriority && score > bestCase)
            if (better) {
                best = item
                bestCase = score
            }
        }
        return rememberPick(input, best)
    }

    function rememberPick(input, emote) {
        if (pickCache.size >= 2048) pickCache.delete(pickCache.keys().next().value)
        pickCache.set(input, emote)
        return emote
    }

    function caseFit(input, name) {
        let score = 0
        for (let i = 0; i < Math.min(input.length, name.length); i++)
            if (input[i] === name[i]) score++
        return score
    }

    function createEmoteStack(items, originalText, sourceText = originalText, textOverlay = false) {
        const stack = document.createElement("span")
        const height = emoteSize <= 1 ? "1.2em" : "28px"
        const info = {
            original: originalText,
            textOverlay,
            emotes: items.map(item => ({
                id: item.emote.id,
                name: item.emote.name,
                channelName: item.emote.channelName || "Global 7TV",
                setName: item.emote.setName || "",
                url: item.emote.url,
                original: item.original,
                zeroWidth: item.emote.zeroWidth === true
            }))
        }
        const label = shared.formatEmoteHover(shared.hoverCfg.template, info)
        stack.setAttribute("data-emoteanywhere-skip", "true")
        stack.setAttribute("data-emoteanywhere-rendered", "true")
        stack.setAttribute("role", "img")
        stack.setAttribute("aria-label", label)
        stack.dataset.emoteanywhereText = sourceText
        if (textOverlay) stack.dataset.emoteanywhereTextOverlay = "true"
        if (shared.hoverCfg.style === "title") stack.title = label
        stack.style.setProperty("display", "inline-block", "important")
        stack.style.setProperty("position", "relative", "important")
        stack.style.setProperty("height", height, "important")
        if (textOverlay) stack.style.setProperty("width", "0", "important")
        stack.style.setProperty("line-height", "0", "important")
        stack.style.setProperty("vertical-align", "bottom", "important")
        stack.style.setProperty("margin-top", "0", "important")
        stack.style.setProperty("margin-bottom", "0", "important")
        shared.emoteInfo.set(stack, info)

        items.forEach((item, index) => {
            const img = document.createElement("img")
            img.src = item.emote.url
            img.alt = sourceText
            img.draggable = false
            img.style.setProperty("display", "block", "important")
            img.style.setProperty("height", height, "important")
            img.style.setProperty("width", "auto", "important")
            img.style.setProperty("max-width", "none", "important")
            img.style.setProperty("margin", "0", "important")
            if (index || textOverlay) {
                img.style.setProperty("position", "absolute", "important")
                img.style.setProperty("left", textOverlay ? "0" : "50%", "important")
                img.style.setProperty("bottom", "0", "important")
                img.style.setProperty("transform", "translateX(-50%)", "important")
                img.style.setProperty("z-index", String(index), "important")
                if (index) img.style.setProperty("pointer-events", "none", "important")
            }
            img.addEventListener("error", () => retryEmote(img, item.emote, stack, sourceText))
            stack.appendChild(img)
        })

        ownNode.add(stack)
        return stack
    }

    function retryEmote(img, emote, stack, originalText) {
        if (!img.dataset.eaRetried) {
            img.dataset.eaRetried = "1"
            const url = new URL(emote.url, location.href)
            url.searchParams.set("_ea_retry", String(Date.now()))
            img.src = url.href
            return
        }
        if (!stack.isConnected) return
        const fallback = document.createTextNode(originalText)
        ownNode.add(fallback)
        stack.replaceWith(fallback)
    }

    function restoreRendered() {
        shared.hideEmoteHover?.()
        for (const root of Array.from(knownRoots)) {
            if (root !== document && !root.isConnected) {
                knownRoots.delete(root)
                continue
            }
            const stacks = root.querySelectorAll
                ? root.querySelectorAll("[data-emoteanywhere-rendered='true']")
                : []
            for (const stack of stacks) {
                const text = stack.dataset.emoteanywhereText || stack.alt || ""
                stack.replaceWith(document.createTextNode(text))
            }
        }
    }
})()
