(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser
    const shared = globalThis.__7tvAnywhereShared ||= {}
    if (shared.autocompleteLoaded) return
    shared.autocompleteLoaded = true
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

    const TRIGGER_RE = /:([A-Za-z0-9_]{1,})$/
    const DEBOUNCE_MS = 90
    const SVG_NS = "http://www.w3.org/2000/svg"
    const TWITCH_ICON = "M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2 3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z"
    const SEVEN_ICON = [
        "m20.7465 5.48825 1.2334-2.1508.6661-1.1372L21.4125.04944V0h-6.5866l2.4669 4.3016.6908 1.18665h2.7629Z",
        "m7.15395 19.9258 7.40065-12.9048.9127-1.5822-2.4669-4.3016L12.3097.02476H1.8995L.66606 2.17556 0 3.31276l1.23344 2.1508v.04945H9.12745L2.96025 16.267l-.8634 1.5328 1.23344 2.1508V20h3.82366",
        "M17.4655 19.9257h3.7743l4.9338-8.6032.8634-1.4833-1.2334-2.1508v-.04941h-3.799l-2.4669 4.30161-.1727.3214-2.4669-4.30162-.1726-.32139-2.4669 4.30161-.6907 1.1866 3.7003 6.4524.1973.3461Z"
    ]
    const OVERLAY_ICON = "m10.05 110.42 112 64a12 12 0 0 0 11.9 0l112-64a12 12 0 0 0 0-20.84l-112-64a12 12 0 0 0-11.9 0l-112 64a12 12 0 0 0 0 20.84ZM128 49.82 215.81 100 128 150.18 40.19 100Zm122.42 92.23A12 12 0 0 1 246 158.42l-112 64a12 12 0 0 1-11.9 0l-112-64A12 12 0 1 1 22 137.58l106 60.6 106-60.6a12 12 0 0 1 16.42 4.47Z"

    let isActive = false
    let siteEnabled = false
    let host = null
    let shadow = null
    let listEl = null

    let open = false
    let suggestions = []
    let activeIndex = -1
    let debounceTimer = null
    let matchContext = null
    let reqToken = 0

    init()
    async function init() {
        document.addEventListener("visibilitychange", visibilityChange)
        await elvActive()
        ext.storage.onChanged.addListener(async (changes, area) => {
            if (area !== "local") return
            if ("siteCfg" in changes) {
                shared.siteVerdictUrl = null
                shared.siteVerdictPromise = null
            }
            if ("enabled" in changes || "siteAccessDefault" in changes || "enabledSites" in changes
                || "disabledSites" in changes || "enabledUnsupportedSites" in changes || "siteCfg" in changes)
                await elvActive()
        })
    }

    async function checkUnsupported(site) {
        const res = await shared.getSiteVerdict(site.url)
        return !!(res && res.unsupported)
    }

    async function elvActive() {
        const [state, site] = await Promise.all([
            ext.storage.local.get(["enabled", "siteAccessDefault", "enabledSites", "disabledSites", "enabledUnsupportedSites"]),
            shared.getTopSite()
        ])
        const { enabled = true, siteAccessDefault = false, enabledSites = [], disabledSites = [], enabledUnsupportedSites = [] } = state
        const isUnsupported = await checkUnsupported(site)
        const permitted = siteAccessDefault
            ? !disabledSites.includes(site.hostname)
            : enabledSites.includes(site.hostname)
        const siteOk = permitted && (!isUnsupported || enabledUnsupportedSites.includes(site.hostname))
        siteEnabled = enabled && siteOk
        setActive(siteEnabled && !document.hidden)
    }

    function visibilityChange() {
        setActive(siteEnabled && !document.hidden)
    }

    function setActive(beActive) {
        if (beActive === isActive) return
        isActive = beActive

        if (isActive) attachListener()
        else {
            detachListener()
            unloadDropdown()
        }
    }

    function unloadDropdown() {
        closeDropdown()
        host?.remove()
        host = null
        shadow = null
        listEl = null
    }

    // helpers
    const attachListener = () => {
        document.addEventListener("input", onInput, true)
        document.addEventListener("keydown", onKeydown, true)
        document.addEventListener("pointerdown", onDocPointerDown, true)
        window.addEventListener("scroll", viewportUpdate, true)
        window.addEventListener("resize", viewportUpdate, true)
    }

    const detachListener = () => {
        document.removeEventListener("input", onInput, true)
        document.removeEventListener("keydown", onKeydown, true)
        document.removeEventListener("pointerdown", onDocPointerDown, true)
        window.removeEventListener("scroll", viewportUpdate, true)
        window.removeEventListener("resize", viewportUpdate, true)
    }

    const isTextField = (el) => {
        if (!el || el.disabled || el.readOnly) return false
        if (el.tagName === "TEXTAREA") return true
        if (el.tagName === "INPUT") {
            const type = (el.getAttribute("type") || "text").toLowerCase()
            return ["text", "search", "email", "url", "tel", ""].includes(type)
        }
        return false
    }

    const isEditable = (el) => !!el && (isTextField(el) || el.isContentEditable)
    const editableFromEvent = (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target]
        for (const item of path) {
            if (!(item instanceof Element)) continue
            if (isTextField(item)) return item
            if (item.isContentEditable) {
                return item.closest("[contenteditable='true'],[contenteditable=''],[role='textbox']") || item
            }
        }
        return null
    }

    const onInput = (e) => {
        const el = editableFromEvent(e)
        if (!isEditable(el)) {
            if (open) closeDropdown()
            return
        }

        const context = isMatch(el)
        if (!context) return closeDropdown()

        matchContext = context
        posDropdown(el, context)
        queueSugg(context.query)
    }

    const isMatch = (el) => {
        if (isTextField(el)) {
            const v = el.value
            const cursor = el.selectionStart
            if (cursor == null) return null
            const before = v.slice(0, cursor)
            const m = before.match(TRIGGER_RE)
            if (!m) return null
            return {
                kind: "field",
                el,
                start: cursor - m[0].length,
                end: cursor,
                query: m[1]
            }
        }

        if (el.isContentEditable) {
            const sel = window.getSelection()
            if (!sel || sel.rangeCount === 0) return null
            const range = sel.getRangeAt(0)
            if (!range.collapsed) return null
            if (!el.contains(range.startContainer) && el !== range.startContainer) return null

            const beforeRange = document.createRange()
            beforeRange.selectNodeContents(el)
            try { beforeRange.setEnd(range.startContainer, range.startOffset) }
            catch { return null }
            const before = beforeRange.cloneContents().textContent || ""
            const m = before.match(TRIGGER_RE)
            if (!m) return null
            const end = before.length
            const replaceRange = rangeFromTextOffsets(el, end - m[0].length, end)
            if (!replaceRange) return null

            return {
                kind: "editable",
                el,
                range: replaceRange,
                query: m[1]
            }
        }

        return null
    }

    const queueSugg = (query) => {
        clearTimeout(debounceTimer)
        const myToken = ++reqToken
        renderStatus("Searching...")

        debounceTimer = setTimeout(async () => {
            let res = null
            try { res = await ext.runtime.sendMessage({ type: "GET_SUGGESTIONS", query }) }
            catch { }
            if (myToken !== reqToken) return
            suggestions = (res && res.suggestions) || []
            activeIndex = suggestions.length ? 0 : -1

            if (suggestions.length) renderDropdown()
            else renderStatus("No matching emotes")
        }, DEBOUNCE_MS)
    }

    const onKeydown = (e) => {
        if (!open) return

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            e.stopPropagation()
            if (!suggestions.length) return
            activeIndex = e.key === "ArrowDown"
                ? (activeIndex + 1) % suggestions.length
                : (activeIndex - 1 + suggestions.length) % suggestions.length
            itemActive()
        } else if (e.key === "Enter" || e.key === "Tab") {
            if (activeIndex < 0 || !suggestions[activeIndex]) return
            e.preventDefault()
            e.stopPropagation()
            commitSugg(suggestions[activeIndex], e.shiftKey)
        } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            closeDropdown()
        }
    }

    const onDocPointerDown = (e) => {
        if (!open) return
        if (host && e.composedPath().includes(host)) return
        closeDropdown()
    }

    const viewportUpdate = () => (open && matchContext) && posDropdown(matchContext.el, matchContext)
    const commitSugg = (emote, keepSearch = false) => {
        const ctx = matchContext
        if (!ctx) return
        ctx.el.focus()

        if (ctx.kind === "editable") {
            let range = ctx.range
            if (!range || !range.startContainer || !range.startContainer.isConnected) {
                const current = isMatch(ctx.el)
                if (!current || current.kind !== "editable") return closeDropdown()
                range = current.range
            }
            ctx.range = range
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
        }

        const rep = keepSearch
            ? `${emote.name} :${ctx.query}`
            : `${emote.name} `

        if (ctx.kind === "field") manualInsert(ctx, rep)
        else if (!document.execCommand("insertText", false, rep)) manualInsert(ctx, rep)

        if (!keepSearch) closeDropdown()
    }

    const manualInsert = (ctx, rep) => {
        if (ctx.kind === "field") {
            const el = ctx.el
            const value = el.value
            const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, "value").set
            setter.call(el, value.slice(0, ctx.start) + rep + value.slice(ctx.end))
            const pos = ctx.start + rep.length
            el.setSelectionRange(pos, pos)
            el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: rep }))
        } else {
            const range = ctx.range
            if (!range) return
            range.deleteContents()
            const node = document.createTextNode(rep)
            range.insertNode(node)
            const selectionRange = document.createRange()
            selectionRange.setStartAfter(node)
            selectionRange.collapse(true)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(selectionRange)
            ctx.el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: rep }))
        }
    }

    const createSvg = (viewBox, paths) => {
        const svg = document.createElementNS(SVG_NS, "svg")
        svg.setAttribute("viewBox", viewBox)
        svg.setAttribute("fill", "currentColor")
        svg.setAttribute("aria-hidden", "true")
        for (const d of Array.isArray(paths) ? paths : [paths]) {
            const path = document.createElementNS(SVG_NS, "path")
            path.setAttribute("d", d)
            svg.appendChild(path)
        }
        return svg
    }

    const createSourceBadge = emote => {
        const isTwitch = emote && emote.provider === "twitch"
        const badge = document.createElement("span")
        badge.className = `ea-source-badge ${isTwitch ? "twitch" : "seven"}`
        badge.title = isTwitch ? "Twitch emote" : "7TV emote"
        badge.appendChild(createSvg(isTwitch ? "0 0 24 24" : "0 0 28 20", isTwitch ? TWITCH_ICON : SEVEN_ICON))
        badge.appendChild(document.createTextNode(isTwitch ? "Twitch" : "7TV"))
        return badge
    }

    const createOverlayBadge = () => {
        const badge = document.createElement("span")
        badge.className = "ea-overlay-badge"
        badge.title = "Overlaying"
        badge.setAttribute("aria-label", "Overlaying")
        badge.appendChild(createSvg("0 0 256 256", OVERLAY_ICON))
        return badge
    }

    const ensureHost = () => {
        if (host) return
        host = document.createElement("div")
        host.setAttribute("data-emoteanywhere-skip", "true")
        host.style.position = "fixed"
        host.style.top = "0"
        host.style.left = "0"
        host.style.zIndex = "2147483647"
        document.documentElement.appendChild(host)

        shadow = host.attachShadow({ mode: "open" })
        const style = document.createElement("style")
        style.textContent = `.ea-dropdown{position:fixed;width:min(300px,calc(100vw - 8px));max-height:min(260px,calc(100vh - 12px));overflow-y:auto;background:#161b22;border:1px solid #30363d;border-radius:8px;box-shadow:0 8px 24px rgba(1,4,9,0.6);padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;} .ea-item{display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 8px;border-radius:6px;cursor:pointer;color:#c9d1d9;font-size:13px;line-height:1.2;} .ea-item img{width:24px;height:24px;object-fit:contain;flex-shrink:0;} .ea-copy{display:grid;flex:1;min-width:0;gap:2px;} .ea-copy strong,.ea-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .ea-copy strong{font-size:13px;font-weight:600;} .ea-copy small{color:#8b949e;font-size:10px;} .ea-badges{display:flex;flex:none;align-items:center;gap:3px}.ea-source-badge,.ea-overlay-badge{display:inline-flex;box-sizing:border-box;align-items:center;justify-content:center;height:18px;color:#f4f0ff;background:#252b35;border:1px solid #3a424e;border-radius:5px}.ea-source-badge{gap:3px;padding:0 5px;font-size:9px;font-weight:700}.ea-source-badge.twitch{color:#b68cff}.ea-source-badge svg{width:13px;height:10px}.ea-source-badge.twitch svg{width:11px;height:11px}.ea-overlay-badge{width:18px;color:#fc8dc7}.ea-overlay-badge svg{width:12px;height:12px}.ea-item-active{background:#1f6feb33;color:#58a6ff;} .ea-status{padding:9px 10px;color:#8b949e;font-size:12px;} .ea-dropdown::-webkit-scrollbar{width:8px;} .ea-dropdown::-webkit-scrollbar-thumb{background:#30363d;border-radius:4px;} @media(pointer:coarse){.ea-item{min-height:44px;}}`
        shadow.appendChild(style)

        listEl = document.createElement("div")
        listEl.className = "ea-dropdown"
        listEl.setAttribute("role", "listbox")
        listEl.style.display = "none"
        shadow.appendChild(listEl)
    }

    const renderDropdown = () => {
        ensureHost()
        listEl.replaceChildren()

        suggestions.forEach((emote, index) => {
            const item = document.createElement("div")
            item.className = "ea-item" + (index === activeIndex ? " ea-item-active" : "")
            item.setAttribute("role", "option")
            item.setAttribute("aria-selected", index === activeIndex ? "true" : "false")

            const img = document.createElement("img")
            img.referrerPolicy = "no-referrer"
            img.src = emote.url
            img.alt = emote.name ?? '?'
            item.appendChild(img)

            const copy = document.createElement("div")
            copy.className = "ea-copy"
            const name = document.createElement("strong")
            name.textContent = emote.name
            copy.appendChild(name)
            const source = document.createElement("small")
            source.textContent = emote.channelName || "Global 7TV"
            copy.appendChild(source)
            item.appendChild(copy)

            const badges = document.createElement("span")
            badges.className = "ea-badges"
            badges.appendChild(createSourceBadge(emote))
            if (emote.zeroWidth) badges.appendChild(createOverlayBadge())
            item.appendChild(badges)

            item.addEventListener("pointerdown", (e) => {
                e.preventDefault()
                e.stopPropagation()
                commitSugg(emote, e.shiftKey)
            })
            item.addEventListener("mouseenter", () => {
                activeIndex = index
                itemActive()
            })

            listEl.appendChild(item)
        })

        listEl.style.display = "block"
        open = true
        if (matchContext) posDropdown(matchContext.el, matchContext)
    }

    const renderStatus = (message) => {
        ensureHost()
        listEl.replaceChildren()
        const status = document.createElement("div")
        status.className = "ea-status"
        status.textContent = message
        listEl.appendChild(status)
        listEl.style.display = "block"
        open = true
        if (matchContext) posDropdown(matchContext.el, matchContext)
    }

    const itemActive = () => {
        if (!listEl) return
        listEl.querySelectorAll(".ea-item").forEach((item, index) => {
            item.classList.toggle("ea-item-active", index === activeIndex)
            item.setAttribute("aria-selected", index === activeIndex ? "true" : "false")
            if (index === activeIndex) item.scrollIntoView({ block: "nearest" })
        })
    }

    const closeDropdown = () => {
        open = false
        suggestions = []
        activeIndex = -1
        matchContext = null
        clearTimeout(debounceTimer)
        reqToken++
        if (listEl) listEl.style.display = "none"
    }
    shared.closeAutocomplete = closeDropdown

    const posDropdown = (el, ctx) => {
        ensureHost()
        const rect = ctx.kind === "field" ? getFieldRect(el, ctx.end) : getEditRect(ctx)
        if (!rect) return

        const width = Math.min(300, Math.max(160, window.innerWidth - 8))
        const margin = 6
        let left = rect.left
        let top = rect.bottom + margin

        if (left + width > window.innerWidth) left = Math.max(4, window.innerWidth - width - 4)
        if (top + 260 > window.innerHeight && rect.top - margin > 260) top = rect.top - margin - Math.min(260, listEl.scrollHeight || 260)

        listEl.style.left = `${Math.round(left)}px`
        listEl.style.top = `${Math.round(top)}px`
    }

    const getEditRect = (ctx) => {
        try {
            const range = ctx.range.cloneRange()
            range.collapse(false)

            const rects = range.getClientRects()
            if (rects.length) return rects[0]
            return range.getBoundingClientRect()
        } catch { return ctx.el.getBoundingClientRect() }
    }

    const rangeFromTextOffsets = (root, start, end) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let position = 0
        let startNode = null
        let startOffset = 0
        let endNode = null
        let endOffset = 0
        let node

        while ((node = walker.nextNode())) {
            const next = position + (node.nodeValue || "").length
            if (!startNode && start >= position && start <= next) {
                startNode = node
                startOffset = start - position
            }
            if (end >= position && end <= next) {
                endNode = node
                endOffset = end - position
                break
            }
            position = next
        }
        if (!startNode || !endNode) return null

        const range = document.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)
        return range
    }

    const properties = Object.freeze([
        "boxSizing", "width", "height", "overflowX", "overflowY",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily",
        "lineHeight", "letterSpacing", "textTransform", "wordSpacing", "textIndent", "whiteSpace", "wordWrap"
    ])
    const getFieldRect = (el, position) => {
        const style = window.getComputedStyle(el)
        const mirror = document.createElement("div")

        mirror.style.position = "fixed"
        mirror.style.visibility = "hidden"
        mirror.style.top = "-9999px"
        mirror.style.left = "0"
        mirror.style.whiteSpace = el.tagName === "TEXTAREA" ? "pre-wrap" : "pre"
        mirror.style.wordWrap = "break-word"
        properties.forEach(prop => { mirror.style[prop] = style[prop] })

        const rectEl = el.getBoundingClientRect()
        mirror.style.width = `${rectEl.width}px`

        const before = document.createTextNode(el.value.substring(0, position))
        mirror.appendChild(before)

        const marker = document.createElement("span")
        marker.textContent = "\u200b"
        mirror.appendChild(marker)

        document.body.appendChild(mirror)
        const markerRect = marker.getBoundingClientRect()
        const mirrorRect = mirror.getBoundingClientRect()
        document.body.removeChild(mirror)

        const offsetTop = markerRect.top - mirrorRect.top
        const offsetLeft = markerRect.left - mirrorRect.left

        return {
            left: rectEl.left + offsetLeft - el.scrollLeft,
            top: rectEl.top + offsetTop - el.scrollTop,
            bottom: rectEl.top + offsetTop - el.scrollTop + markerRect.height
        }
    }
})()
