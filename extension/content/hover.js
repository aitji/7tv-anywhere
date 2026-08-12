(() => {
    const shared = globalThis.__7tvAnywhereShared ||= {}
    const infoByEmote = shared.emoteInfo ||= new WeakMap()
    let host = null
    let root = null
    let card = null
    let timer = null
    let active = null

    const styleText = `.card,.preview,.row{display:grid}.body,.name,.preview{min-width:0}:host{all:initial}.card{box-sizing:border-box;width:min(350px,calc(100vw - 16px));gap:10px;align-items:center;padding:11px;color:#efeff1;background:#18181b;border:1px solid #3a3a3d;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.42);font:13px/1.35 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card.layout-left,.card.layout-right{grid-template-columns:minmax(0,1fr) minmax(64px,40%)}.card.layout-left{grid-template-columns:minmax(64px,40%) minmax(0,1fr)}.card.layout-right .preview{order:2}.card.layout-hidden,.card.layout-top{grid-template-columns:minmax(0,1fr)}.preview{place-items:center;min-height:42px;max-height:96px;overflow:visible}.preview img{grid-area:1/1;display:block;max-width:100%;max-height:92px;object-fit:contain}.preview img+img{z-index:1}.layout-top .preview img{max-height:82px}.layout-hidden .preview{display:none}.title{margin:0 0 7px;color:#fff;font-size:13px;font-weight:700;overflow-wrap:anywhere;white-space:pre-wrap}.row{grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:7px;margin-top:5px}.tag{color:#a970ff;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.name{color:#dedee3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.channel{color:#8b8b98;font-weight:500}`
    function createCard() {
        if (host) return
        host = document.createElement("div")
        host.setAttribute("data-emoteanywhere-skip", "true")
        host.setAttribute("aria-hidden", "true")
        host.style.setProperty("display", "none", "important")
        host.style.setProperty("position", "fixed", "important")
        host.style.setProperty("z-index", "2147483647", "important")
        host.style.setProperty("pointer-events", "none", "important")
        root = host.attachShadow({ mode: "open" })
        const style = document.createElement("style")
        style.textContent = styleText
        card = document.createElement("div")
        card.className = "card"
        card.setAttribute("role", "tooltip")
        root.append(style, card)
        document.documentElement.appendChild(host)
    }

    function add(parent, tag, className, text = "") {
        const element = document.createElement(tag)
        element.className = className
        element.textContent = text
        parent.appendChild(element)
        return element
    }

    function render(info) {
        card.className = `card layout-${shared.hoverCfg.layout || "right"}`
        card.replaceChildren()
        const preview = add(card, "div", "preview")
        info.emotes.forEach(item => {
            const img = document.createElement("img")
            img.src = item.url
            img.alt = item.name ?? '?'
            img.title = `${item.name} (${item.channelName || "Global 7TV"})`
            preview.appendChild(img)
        })
        const body = add(card, "div", "body")
        add(body, "h3", "title", shared.formatEmoteHover(shared.hoverCfg.template, info))
        info.emotes.forEach((item, index) => {
            const row = add(body, "div", "row")
            add(row, "span", "tag", index || info.textOverlay ? "Overlay" : "Base")
            const name = add(row, "span", "name", item.name)
            add(name, "span", "channel", ` @${item.channelName || "Global 7TV"}`)
        })
    }

    function position(target) {
        const targetRect = target.getBoundingClientRect()
        const rect = host.getBoundingClientRect()
        const gap = 8
        const width = document.documentElement.clientWidth
        const height = document.documentElement.clientHeight
        const left = Math.max(gap, Math.min(width - rect.width - gap,
            targetRect.left + targetRect.width / 2 - rect.width / 2))
        const below = targetRect.bottom + gap
        const top = below + rect.height <= height - gap
            ? below
            : Math.max(gap, targetRect.top - rect.height - gap)
        host.style.setProperty("left", `${left}px`, "important")
        host.style.setProperty("top", `${top}px`, "important")
        host.style.setProperty("visibility", "visible", "important")
    }

    function show(target) {
        if (!target.isConnected || shared.hoverCfg.style !== "card") return
        const info = infoByEmote.get(target)
        if (!info) return
        createCard()
        render(info)
        host.style.setProperty("display", "block", "important")
        host.style.setProperty("visibility", "hidden", "important")
        position(target)
        host.setAttribute("aria-hidden", "false")
    }

    function hide() {
        clearTimeout(timer)
        timer = null
        active = null
        if (!host) return
        host.style.setProperty("display", "none", "important")
        host.setAttribute("aria-hidden", "true")
    }

    function emoteFromEvent(event) {
        for (const node of typeof event.composedPath === "function" ? event.composedPath() : [event.target])
            if (node && node.nodeType === Node.ELEMENT_NODE
                && node.matches("[data-emoteanywhere-rendered='true']")) return node
        return null
    }

    document.addEventListener("pointerover", event => {
        if (shared.hoverCfg.style !== "card") return hide()
        const target = emoteFromEvent(event)
        if (!target || target === active) return
        hide()
        active = target
        timer = setTimeout(() => show(target), shared.hoverCfg.delay)
    }, true)
    document.addEventListener("pointerout", event => {
        const target = emoteFromEvent(event)
        if (!target || target.contains(event.relatedTarget)) return
        hide()
    }, true)
    document.addEventListener("scroll", hide, true)
    window.addEventListener("resize", hide)
    shared.hideEmoteHover = hide
})()
