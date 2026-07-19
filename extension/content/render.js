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
    let isActive = false
    let observer = null

    const pendingRoot = new Set()
    const ownNode = new WeakSet()
    let scheduled = false

    if (typeof requestIdleCallback === "function") requestIdleCallback(() => init(), { timeout: 2000 })
    else setTimeout(init, 0)

    async function init() {
        await evlActive()
        ext.storage.onChanged.addListener(storageChange)
        ext.runtime.onMessage.addListener(runtimeMessage)
    }

    async function runtimeMessage(msg) {
        if (msg && msg.type === "EMOTES_UPDATED" && isActive) {
            await loadEmote()
            if (document.body) schProing(document.body)
        }
    }

    async function storageChange(changes, area) {
        if (area !== "local") return
        if ("enabled" in changes || "disabledSites" in changes || "enabledUnsupportedSites" in changes) await evlActive()
        if (isActive && ("excludedEmote" in changes || "emoteSet" in changes || "emoteSize" in changes)) {
            await loadEmote()
            if (document.body) schProing(document.body)
        }
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
            await loadEmote()
            startObserving()
        } else if (!shouldBeActive && isActive) {
            isActive = false
            stopObserving()
        }
    }

    async function loadEmote() {
        const [{ emotes = [] }, { excludedEmote = [], emoteSize: size }] = await Promise.all([
            ext.runtime.sendMessage({ type: "GET_EMOTES" }),
            ext.storage.local.get(["excludedEmote", "emoteSize"])
        ])

        emoteSize = size || 2
        const excluded = new Set(excludedEmote)
        const map = new Map()
        for (const emote of emotes) {
            if (excluded.has(emote.name)) continue
            map.set(emote.name, emote)
        }
        emoteMap = map
    }

    function startObserving() {
        observer = new MutationObserver(handleMutations)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        schProing(document.body)
    }

    function stopObserving() {
        if (observer) observer.disconnect()
        observer = null
        pendingRoot.clear()
    }

    function handleMutations(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === "childList") mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return
                if (ownNode.has(node)) return
                schProing(node)
            })

            else if (mutation.type === "characterData") {
                const parent = mutation.target.parentElement
                if (parent && !ownNode.has(mutation.target)) schProing(parent)
            }
        }
    }

    function schProing(root) {
        if (isSkipSub(root)) return
        pendingRoot.add(root)
        if (scheduled) return
        scheduled = true

        const run = () => {
            scheduled = false
            const roots = Array.from(pendingRoot)
            pendingRoot.clear()
            for (const r of roots) processRoot(r)
        }

        if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1000 })
        else setTimeout(run, 50)
    }

    function isSkipSub(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false
        if (SKIP_TAGS.has(node.tagName)) return true
        if (node.isContentEditable) return true
        if (node.closest && node.closest("[data-emoteanywhere-skip]")) return true
        return false
    }

    function processRoot(root) {
        if (!emoteMap.size) return
        if (!root.isConnected && root !== document.body) return

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

        function step(deadline) {
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
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT
        if (parent.closest("[data-emoteanywhere-skip]")) return NodeFilter.FILTER_REJECT
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

        const children = Array.from(frag.childNodes)
        textNode.parentNode.replaceChild(frag, textNode)
        children.forEach(child => ownNode.add(child))
    }

    function buildFragment(text) {
        WORD_RE.lastIndex = 0
        let match
        let lastIndex = 0
        let found = false
        const frag = document.createDocumentFragment()

        while ((match = WORD_RE.exec(text)) !== null) {
            const emote = emoteMap.get(match[0])
            if (!emote) continue

            let start = match.index
            let end = match.index + match[0].length

            if (start > lastIndex && text[start - 1] === ":" && text[end] === ":") {
                start -= 1
                end += 1
            }

            found = true
            if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)))
            frag.appendChild(createEmoteImg(emote))
            lastIndex = end
        }

        if (!found) return null
        if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
        return frag
    }

    function createEmoteImg(emote) {
        const img = document.createElement("img")
        img.src = emote.url
        img.alt = emote.name
        img.title = emote.channelName ? `${emote.name} (${emote.channelName})` : emote.name
        img.setAttribute("data-emoteanywhere-skip", "true")
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
                const fallback = document.createTextNode(emote.name)
                ownNode.add(fallback)
                img.replaceWith(fallback)
            }
        })

        return img
    }
})()
