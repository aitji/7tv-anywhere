(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser

    const TRIGGER_RE = /:([A-Za-z0-9_]{1,})$/
    const DEBOUNCE_MS = 90

    let isActive = false
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
        await elvActive()
        ext.storage.onChanged.addListener(async (changes, area) => (area === "local" && ("enabled" in changes || "disabledSites" in changes || "enabledUnsupportedSites" in changes)) && await elvActive())
    }

    async function checkUnsupported() {
        try {
            const res = await ext.runtime.sendMessage({ type: "IS_SITE_UNSUPPORTED", url: location.href })
            return !!(res && res.unsupported)
        } catch { return false }
    }

    async function elvActive() {
        const { enabled = true, disabledSites = [], enabledUnsupportedSites = [] } = await ext.storage.local.get(["enabled", "disabledSites", "enabledUnsupportedSites"])
        const isUnsupported = await checkUnsupported()
        const siteOk = isUnsupported ? enabledUnsupportedSites.includes(location.hostname) : !disabledSites.includes(location.hostname)
        const beActive = enabled && siteOk
        if (beActive === isActive) return
        isActive = beActive

        if (isActive) attachListener()
        else {
            detachListener()
            closeDropdown()
        }
    }

    // helpers
    const attachListener = () => {
        document.addEventListener("input", onInput, true)
        document.addEventListener("keydown", onKeydown, true)
        document.addEventListener("mousedown", onDocMouseDown, true)
        window.addEventListener("scroll", viewportUpdate, true)
        window.addEventListener("resize", viewportUpdate, true)
    }

    const detachListener = () => {
        document.removeEventListener("input", onInput, true)
        document.removeEventListener("keydown", onKeydown, true)
        document.removeEventListener("mousedown", onDocMouseDown, true)
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
    const onInput = (e) => {
        const el = e.target
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
            const node = range.startContainer
            if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null

            const offset = range.startOffset
            const before = node.nodeValue.slice(0, offset)
            const m = before.match(TRIGGER_RE)
            if (!m) return null

            return {
                kind: "editable",
                el,
                node,
                start: offset - m[0].length,
                end: offset,
                query: m[1]
            }
        }

        return null
    }

    const queueSugg = (query) => {
        clearTimeout(debounceTimer)
        const myToken = ++reqToken

        debounceTimer = setTimeout(async () => {
            const res = await ext.runtime.sendMessage({ type: "GET_SUGGESTIONS", query })
            if (myToken !== reqToken) return
            suggestions = (res && res.suggestions) || []
            activeIndex = suggestions.length ? 0 : -1

            if (suggestions.length) renderDropdown()
            else closeDropdown()
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

    const onDocMouseDown = (e) => {
        if (!open) return
        if (host && e.composedPath().includes(host)) return
        closeDropdown()
    }

    const viewportUpdate = () => (open && matchContext) && posDropdown(matchContext.el, matchContext)
    const commitSugg = (emote, keepSearch = false) => {
        const ctx = matchContext
        if (!ctx) return
        ctx.el.focus()

        if (ctx.kind === "field") ctx.el.setSelectionRange(ctx.start, ctx.end)
        else {
            const range = document.createRange()
            const sel = window.getSelection()
            const len = ctx.node.nodeValue ? ctx.node.nodeValue.length : 0

            range.setStart(ctx.node, Math.min(ctx.start, len))
            range.setEnd(ctx.node, Math.min(ctx.end, len))
            sel.removeAllRanges()
            sel.addRange(range)
        }

        const rep = keepSearch
            ? `${emote.name} :${ctx.query}`
            : `${emote.name} `

        const insert = document.execCommand("insertText", false, rep)
        if (!insert) manualInsert(ctx, rep)

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
            const node = ctx.node
            const text = node.nodeValue
            node.nodeValue = text.slice(0, ctx.start) + rep + text.slice(ctx.end)
            const range = document.createRange()
            const pos = ctx.start + rep.length
            range.setStart(node, pos)
            range.setEnd(node, pos)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
            ctx.el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: rep }))
        }
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
        style.textContent = `.ea-dropdown{position:fixed;width:260px;max-height:260px;overflow-y:auto;background:#161b22;border:1px solid #30363d;border-radius:8px;box-shadow:0 8px 24px rgba(1,4,9,0.6);padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;} .ea-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;color:#c9d1d9;font-size:13px;line-height:1.2;} .ea-item img{width:24px;height:24px;object-fit:contain;flex-shrink:0;} .ea-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .ea-item-active{background:#1f6feb33;color:#58a6ff;} .ea-dropdown::-webkit-scrollbar{width:8px;} .ea-dropdown::-webkit-scrollbar-thumb{background:#30363d;border-radius:4px;}`
        shadow.appendChild(style)

        listEl = document.createElement("div")
        listEl.className = "ea-dropdown"
        listEl.style.display = "none"
        shadow.appendChild(listEl)
    }

    const renderDropdown = () => {
        ensureHost()
        listEl.innerHTML = ""

        suggestions.forEach((emote, index) => {
            const item = document.createElement("div")
            item.className = "ea-item" + (index === activeIndex ? " ea-item-active" : "")

            const img = document.createElement("img")
            img.src = emote.url
            img.alt = emote.name
            item.appendChild(img)

            const name = document.createElement("span")
            name.textContent = emote.name
            item.appendChild(name)

            item.addEventListener("mousedown", (e) => {
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

    const itemActive = () => {
        if (!listEl) return
        listEl.querySelectorAll(".ea-item").forEach((item, index) => {
            item.classList.toggle("ea-item-active", index === activeIndex)
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

    const posDropdown = (el, ctx) => {
        ensureHost()
        const rect = ctx.kind === "field" ? getFieldRect(el, ctx.end) : getEditRect(ctx)
        if (!rect) return

        const width = 260
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
            const range = document.createRange()
            const len = ctx.node.nodeValue ? ctx.node.nodeValue.length : 0
            const pos = Math.min(ctx.end, len)
            range.setStart(ctx.node, pos)
            range.setEnd(ctx.node, pos)

            const rects = range.getClientRects()
            if (rects.length) return rects[0]
            return range.getBoundingClientRect()
        } catch { return ctx.el.getBoundingClientRect() }
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
