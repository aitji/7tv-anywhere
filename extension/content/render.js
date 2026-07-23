(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser

    const SKIP_TAGS = Object.freeze(new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
        "IFRAME", "OBJECT", "EMBED", "CODE", "PRE", "SVG"
    ]))

    const MAX_NODE_LENGTH = 20000
    const WORD_RE = /[A-Za-z0-9_]+/g

    let emoteMap = new Map()
    let emoteSize = 2
    let caseSensitive = false
    let isActive = false
    let observer = null
    let observedRoots = new WeakSet()
    let needsRefresh = false
    let lifeRev = 0
    let processRev = 0

    const pendingRoot = new Set()
    const ownNode = new WeakSet()
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
        if ("enabled" in changes || "disabledSites" in changes || "enabledUnsupportedSites" in changes) await evlActive()
        if (isActive && ("excludedEmote" in changes || "emoteSet" in changes
            || "emoteSize" in changes || "caseSensitive" in changes)) {
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
        applyEmote(loaded)

        restoreRendered()
        needsRefresh = false
        if (observer) schProing(document.body)
        else startObserving()
    }

    async function checkUnsupported() {
        try {
            const res = await ext.runtime.sendMessage({ type: "IS_SITE_UNSUPPORTED", url: location.href })
            return !!(res && res.unsupported)
        } catch { return false }
    }

    async function evlActive() {
        const { enabled = true, disabledSites = [], enabledUnsupportedSites = [] } = await ext.storage.local.get(["enabled", "disabledSites", "enabledUnsupportedSites"])
        const isUnsupported = await checkUnsupported()
        const siteOk = isUnsupported ? enabledUnsupportedSites.includes(location.hostname) : !disabledSites.includes(location.hostname)
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
                ext.storage.local.get(["excludedEmote", "emoteSize", "caseSensitive"])
            ])
        } catch { return false }
        const [{
            emotes = []
        } = {}, {
            excludedEmote = [],
            emoteSize: size,
            caseSensitive: matchCase = false
        } = {}] = result

        const nextSize = size || 2
        const nextCase = matchCase === true
        const key = name => nextCase ? name : String(name).toLowerCase()
        const excluded = new Set(excludedEmote.map(key))
        const map = new Map()
        for (const emote of emotes) {
            const name = key(emote.name)
            if (excluded.has(name)) continue
            if (nextCase) map.set(name, [emote])
            else {
                const variant = map.get(name) || []
                variant.push(emote)
                map.set(name, variant)
            }
        }
        return { map, size: nextSize, caseSensitive: nextCase }
    }

    function applyEmote(loaded) {
        emoteMap = loaded.map
        emoteSize = loaded.size
        caseSensitive = loaded.caseSensitive
    }

    function startObserving() {
        if (!document.body || document.hidden || !isActive || observer) return
        processRev++
        observer = new MutationObserver(handleMutations)
        observeRoot(document.body)
        observeOpenShadows(document.body)
        schProing(document.body)
    }

    function observeRoot(root) {
        if (!observer || observedRoots.has(root)) return
        observer.observe(root, { childList: true, subtree: true, characterData: true })
        observedRoots.add(root)
    }

    function observeOpenShadows(root) {
        if (!root) return
        const elements = []
        if (root.nodeType === Node.ELEMENT_NODE) elements.push(root)
        if (root.querySelectorAll) elements.push(...root.querySelectorAll("*"))
        for (const element of elements) {
            if (!element.shadowRoot || observedRoots.has(element.shadowRoot)) continue
            observeRoot(element.shadowRoot)
            schProing(element.shadowRoot)
        }
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
                if (ownNode.has(node)) return
                if (node.nodeType === Node.ELEMENT_NODE) observeOpenShadows(node)
                schProing(node)
            })

            else if (mutation.type === "characterData") {
                const parent = mutation.target.parentElement
                if (parent && !ownNode.has(mutation.target)) schProing(parent)
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
                if (sinceYield >= 200) break
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
        if (!node.nodeValue || node.nodeValue.length > MAX_NODE_LENGTH) return NodeFilter.FILTER_REJECT

        return NodeFilter.FILTER_ACCEPT
    }

    function proTextNode(textNode) {
        if (ownNode.has(textNode)) return
        if (!textNode.parentNode) return

        const text = textNode.nodeValue
        if (!text || text.length < 2) return

        const frag = buildFragment(text)
        if (!frag) return

        textNode.parentNode.replaceChild(frag, textNode)
    }

    function buildFragment(text) {
        WORD_RE.lastIndex = 0
        let match
        let lastIndex = 0
        let found = false
        const frag = document.createDocumentFragment()

        while ((match = WORD_RE.exec(text)) !== null) {
            const emote = pickEmote(match[0])
            if (!emote) continue

            let start = match.index
            let end = match.index + match[0].length

            if (start > lastIndex && text[start - 1] === ":" && text[end] === ":") {
                start -= 1
                end += 1
            }

            found = true
            if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)))
            frag.appendChild(createEmoteImg(emote, text.slice(start, end)))
            lastIndex = end
        }

        if (!found) return null
        if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
        return frag
    }

    function pickEmote(input) {
        const key = caseSensitive ? input : input.toLowerCase()
        const variant = emoteMap.get(key)
        if (!variant || !variant.length) return null
        if (caseSensitive || variant.length === 1) return variant[0]

        let best = variant[0]
        let bestCase = caseFit(input, best.name)
        for (let i = 1; i < variant.length; i++) {
            const item = variant[i]
            const score = caseFit(input, item.name)
            if (score > bestCase
                || (score === bestCase && (item.priority || 0) > (best.priority || 0))) {
                best = item
                bestCase = score
            }
        }
        return best
    }

    function caseFit(input, name) {
        let score = 0
        for (let i = 0; i < Math.min(input.length, name.length); i++)
            if (input[i] === name[i]) score++
        return score
    }

    function createEmoteImg(emote, originalText) {
        const img = document.createElement("img")
        img.src = emote.url
        img.alt = emote.name
        img.title = emote.channelName ? `${emote.name} (${emote.channelName})` : emote.name
        img.setAttribute("data-emoteanywhere-skip", "true")
        img.setAttribute("data-emoteanywhere-rendered", "true")
        img.dataset.emoteanywhereText = originalText
        img.style.height = emoteSize <= 1 ? "1.2em" : "28px"
        img.style.verticalAlign = "bottom"
        img.style.display = "inline-block"

        img.addEventListener("error", () => {
            if (!img.dataset.eaRetried) {
                img.dataset.eaRetried = "1"
                const url = new URL(emote.url, location.href)
                url.searchParams.set("_ea_retry", String(Date.now()))
                img.src = url.href
                return
            }
            if (img.isConnected) {
                const fallback = document.createTextNode(originalText)
                img.replaceWith(fallback)
            }
        })

        ownNode.add(img)
        return img
    }

    function restoreRendered() {
        const roots = [document]
        const queue = [document.documentElement]
        while (queue.length) {
            const root = queue.shift()
            if (!root || !root.querySelectorAll) continue
            for (const element of root.querySelectorAll("*")) {
                if (!element.shadowRoot) continue
                roots.push(element.shadowRoot)
                queue.push(element.shadowRoot)
            }
        }

        for (const root of roots) {
            const images = root.querySelectorAll
                ? root.querySelectorAll("img[data-emoteanywhere-rendered='true']")
                : []
            for (const img of images) {
                const text = img.dataset.emoteanywhereText || img.alt || ""
                img.replaceWith(document.createTextNode(text))
            }
        }
    }
})()
