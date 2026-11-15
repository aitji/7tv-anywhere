(() => {
    /** @type {typeof chrome} */
    const ext = typeof browser === "undefined" ? chrome : browser
    const shared = globalThis.__7tvAnywhereShared ||= {}
    if (shared.pickerLoaded) return
    shared.pickerLoaded = true

    const GRID_ROW_HEIGHT = 68
    const GRID_GAP = 5
    const GRID_PRELOAD_PX = 80
    const VIRTUAL_SCROLL_IDLE_MS = 85
    const VIRTUAL_SCROLL_REFRESH_MS = 160
    const DRAG_THRESHOLD = 5
    const TOUCH_DRAG_DELAY = 280
    const SVG_NS = "http://www.w3.org/2000/svg"
    const TWITCH_ICON = "M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2 3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z"
    const SEVEN_ICON = [
        "m20.7465 5.48825 1.2334-2.1508.6661-1.1372L21.4125.04944V0h-6.5866l2.4669 4.3016.6908 1.18665h2.7629Z",
        "m7.15395 19.9258 7.40065-12.9048.9127-1.5822-2.4669-4.3016L12.3097.02476H1.8995L.66606 2.17556 0 3.31276l1.23344 2.1508v.04945H9.12745L2.96025 16.267l-.8634 1.5328 1.23344 2.1508V20h3.82366",
        "M17.4655 19.9257h3.7743l4.9338-8.6032.8634-1.4833-1.2334-2.1508v-.04941h-3.799l-2.4669 4.30161-.1727.3214-2.4669-4.30162-.1726-.32139-2.4669 4.30161-.6907 1.1866 3.7003 6.4524.1973.3461Z"
    ]
    const OVERLAY_ICON = "m10.05 110.42 112 64a12 12 0 0 0 11.9 0l112-64a12 12 0 0 0 0-20.84l-112-64a12 12 0 0 0-11.9 0l-112 64a12 12 0 0 0 0 20.84ZM128 49.82 215.81 100 128 150.18 40.19 100Zm122.42 92.23A12 12 0 0 1 246 158.42l-112 64a12 12 0 0 1-11.9 0l-112-64A12 12 0 1 1 22 137.58l106 60.6 106-60.6a12 12 0 0 1 16.42 4.47Z"
    let active = false
    let pickerEnabled = true
    let layout = "tabs"
    let target = null
    let savedSelection = null
    let host = null
    let root = null
    let trigger = null
    let panel = null
    let nav = null
    let search = null
    let sortSelect = null
    let closeButton = null
    let content = null
    let status = null
    let navTooltip = null
    let open = false
    let emotes = []
    let channels = []
    let favorites = new Set()
    let usage = {}
    let loadToken = 0
    let siteKey = ""
    let pickerTriggerPositions = {}
    let sortMode = "default"
    let triggerOffset = { x: 0, y: 0 }
    let triggerDrag = null
    let triggerLongPress = null
    let virtualSections = []
    let virtualFrame = 0
    let virtualScrollTimer = 0
    let virtualScrollRefreshTimer = 0
    let lastVirtualMountAt = 0
    let virtualResizeObserver = null

    init()

    async function init() {
        document.addEventListener("focusin", onFocus, true)
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("keydown", onKeydown, true)
        window.addEventListener("scroll", onViewportChange, true)
        window.addEventListener("resize", onViewportChange, true)
        ext.storage.onChanged.addListener(storageChanged)
        await evaluateActive()
    }

    async function evaluateActive() {
        const [state, site] = await Promise.all([
            ext.storage.local.get([
                "enabled", "siteAccessDefault", "enabledSites", "disabledSites", "enabledUnsupportedSites", "pickerEnabled", "pickerLayout",
                "pickerTriggerPositions", "pickerSort", "pickerOverlayFirst"
            ]),
            shared.getTopSite ? shared.getTopSite() : Promise.resolve({ hostname: location.hostname, url: location.href })
        ])
        const verdict = shared.getSiteVerdict
            ? await shared.getSiteVerdict(site.url)
            : { unsupported: false }
        pickerEnabled = state.pickerEnabled !== false
        layout = state.pickerLayout === "sidebar" ? "sidebar" : "tabs"
        siteKey = String(site.hostname || location.hostname || "").toLowerCase()
        pickerTriggerPositions = state.pickerTriggerPositions && typeof state.pickerTriggerPositions === "object"
            ? state.pickerTriggerPositions
            : {}
        const storedOffset = pickerTriggerPositions[siteKey]
        triggerOffset = storedOffset && Number.isFinite(storedOffset.x) && Number.isFinite(storedOffset.y)
            ? { x: storedOffset.x, y: storedOffset.y }
            : { x: 0, y: 0 }
        sortMode = cleanPickerSort(state.pickerSort, state.pickerOverlayFirst)
        const permitted = state.siteAccessDefault === true
            ? !(state.disabledSites || []).includes(site.hostname)
            : (state.enabledSites || []).includes(site.hostname)
        const siteOk = permitted && (!(verdict && verdict.unsupported)
            || (state.enabledUnsupportedSites || []).includes(site.hostname))
        active = state.enabled !== false && pickerEnabled && siteOk
        if (!active) unload()
        else if (target) showTrigger()
        applyLayout()
        syncSort()
    }

    function storageChanged(changes, area) {
        if (area !== "local") return
        if (changes.pickerFavorites) {
            const nextFavorites = new Set(Array.isArray(changes.pickerFavorites.newValue)
                ? changes.pickerFavorites.newValue
                : [])
            const changed = nextFavorites.size !== favorites.size
                || [...nextFavorites].some(key => !favorites.has(key))
            favorites = nextFavorites
            if (open && changed) render(true)
        }
        if (changes.pickerUsage) {
            const nextUsage = changes.pickerUsage.newValue && typeof changes.pickerUsage.newValue === "object"
                ? changes.pickerUsage.newValue
                : {}
            const nextKeys = Object.keys(nextUsage)
            const changed = nextKeys.length !== Object.keys(usage).length
                || nextKeys.some(key => nextUsage[key]?.count !== usage[key]?.count
                    || nextUsage[key]?.lastUsed !== usage[key]?.lastUsed)
            usage = nextUsage
            if (open && changed) render(true)
        }
        if (changes.pickerTriggerPositions) {
            pickerTriggerPositions = changes.pickerTriggerPositions.newValue
                && typeof changes.pickerTriggerPositions.newValue === "object"
                ? changes.pickerTriggerPositions.newValue : {}
            const storedOffset = pickerTriggerPositions[siteKey]
            triggerOffset = storedOffset && Number.isFinite(storedOffset.x) && Number.isFinite(storedOffset.y)
                ? { x: storedOffset.x, y: storedOffset.y } : { x: 0, y: 0 }
            position()
        }
        if (changes.pickerSort || changes.pickerOverlayFirst) {
            const nextSort = cleanPickerSort(
                changes.pickerSort ? changes.pickerSort.newValue : sortMode,
                changes.pickerOverlayFirst && changes.pickerOverlayFirst.newValue
            )
            const changed = nextSort !== sortMode
            sortMode = nextSort
            syncSort()
            if (open && changed) render(true)
        }
        if (["enabled", "siteAccessDefault", "enabledSites", "disabledSites", "enabledUnsupportedSites", "pickerEnabled", "pickerLayout", "siteCfg"]
            .some(key => changes[key])) {
            if (changes.siteCfg) {
                shared.siteVerdictUrl = null
                shared.siteVerdictPromise = null
            }
            evaluateActive().catch(() => { })
        }
    }

    function editableFromEvent(event) {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target]
        for (const item of path) {
            if (!(item instanceof Element) || item.closest?.("[data-emoteanywhere-skip='true']")) continue
            if (item.tagName === "TEXTAREA") return item.disabled || item.readOnly ? null : item
            if (item.tagName === "INPUT") {
                const type = (item.getAttribute("type") || "text").toLowerCase()
                return ["text", "search", "email", "url", "tel", ""].includes(type) && !item.disabled && !item.readOnly
                    ? item
                    : null
            }
            if (item.isContentEditable)
                return item.closest("[contenteditable='true'],[contenteditable=''],[role='textbox']") || item
        }
        return null
    }

    function onFocus(event) {
        if (!active) return
        if (host && event.composedPath().includes(host)) return
        const next = editableFromEvent(event)
        if (!next) {
            if (open) closePanel(false)
            if (!targetHasFocus()) {
                target = null
                hideTrigger()
            }
            return
        }
        target = next
        captureSelection()
        showTrigger()
    }

    function onPointerDown(event) {
        if (host && event.composedPath().includes(host)) return
        const next = editableFromEvent(event)
        if (next) {
            if (open) closePanel(false)
            target = next
            setTimeout(captureSelection, 0)
            return
        }
        if (open) closePanel(false)
        target = null
        hideTrigger()
    }

    function onKeydown(event) {
        if (event.key === "Escape" && open) {
            event.preventDefault()
            closePanel()
            target?.focus()
        }
    }

    function ensureUi() {
        if (host) return
        host = document.createElement("div")
        host.setAttribute("data-emoteanywhere-skip", "true")
        host.style.setProperty("position", "fixed", "important")
        host.style.setProperty("z-index", "2147483647", "important")
        host.style.setProperty("inset", "0 auto auto 0", "important")
        root = host.attachShadow({ mode: "open" })
        const style = document.createElement("style")
        style.textContent = styleText()
        const providerStyle = document.createElement("style")
        providerStyle.textContent = providerStyleText()
        trigger = document.createElement("button")
        trigger.className = "trigger"
        trigger.type = "button"
        trigger.title = "Open 7TV emote picker"
        trigger.setAttribute("aria-label", "Open 7TV emote picker")
        trigger.setAttribute("aria-expanded", "false")
        const glass = document.createElement("span")
        glass.className = "glass"
        trigger.appendChild(glass)
        trigger.addEventListener("pointerdown", startTriggerDrag)
        trigger.addEventListener("pointermove", moveTriggerDrag)
        trigger.addEventListener("pointerup", finishTriggerDrag)
        trigger.addEventListener("pointercancel", cancelTriggerDrag)

        panel = document.createElement("section")
        panel.className = "panel"
        panel.hidden = true
        panel.setAttribute("aria-label", "7TV emote picker")
        const searchWrap = document.createElement("div")
        searchWrap.className = "search"
        search = document.createElement("input")
        search.type = "search"
        search.placeholder = "Search emotes or channels"
        search.setAttribute("aria-label", "Search emotes or channels")
        search.autocomplete = "off"
        search.addEventListener("input", () => render(false))
        sortSelect = document.createElement("select")
        sortSelect.className = "panel-sort"
        sortSelect.title = "Emote order"
        sortSelect.setAttribute("aria-label", "Emote order")
        for (const [value, label] of [
            ["default", "Channel order"],
            ["twitch", "Twitch emotes first"],
            ["7tv", "7TV emotes first"],
            ["overlay", "7TV overlays first"]
        ]) {
            const option = document.createElement("option")
            option.value = value
            option.textContent = label
            sortSelect.appendChild(option)
        }
        sortSelect.addEventListener("change", async () => {
            sortMode = cleanPickerSort(sortSelect.value)
            if (open) render(true)
            await ext.storage.local.set({ pickerSort: sortMode })
        })
        closeButton = document.createElement("button")
        closeButton.className = "panel-tool close"
        closeButton.type = "button"
        closeButton.title = "Close 7TV emote picker"
        closeButton.setAttribute("aria-label", "Close 7TV emote picker")
        closeButton.textContent = "×"
        closeButton.addEventListener("click", () => {
            closePanel()
            target?.focus()
        })
        searchWrap.append(search, sortSelect, closeButton)
        nav = document.createElement("nav")
        nav.className = "nav"
        content = document.createElement("div")
        content.className = "content"
        content.addEventListener("scroll", onContentScroll, { passive: true })
        status = document.createElement("div")
        status.className = "status"
        status.setAttribute("role", "status")
        navTooltip = document.createElement("div")
        navTooltip.className = "nav-tooltip"
        navTooltip.hidden = true
        panel.append(searchWrap, nav, content, status, navTooltip)
        root.append(style, providerStyle, trigger, panel)
        document.documentElement.appendChild(host)
        if (typeof ResizeObserver === "function") {
            virtualResizeObserver = new ResizeObserver(() => {
                if (!open) return
                layoutVirtualSections()
                scheduleVirtualUpdate(true)
            })
            virtualResizeObserver.observe(content)
        }
        applyLayout()
        syncSort()
    }

    function styleText() {
        const extra = `.trigger{touch-action:none;user-select:none}.trigger.dragging{cursor:grabbing;border-color:#8e93a6}.nav,.content{scrollbar-color:#393445 #151822;scrollbar-width:thin}.content{overflow-anchor:none;scroll-behavior:auto!important}.nav::-webkit-scrollbar,.content::-webkit-scrollbar{width:9px;height:9px}.nav::-webkit-scrollbar-track,.content::-webkit-scrollbar-track{background:#151822}.nav::-webkit-scrollbar-thumb,.content::-webkit-scrollbar-thumb{background:#393445;border:2px solid #151822;border-radius:999px}.nav::-webkit-scrollbar-thumb:hover,.content::-webkit-scrollbar-thumb:hover{background:#524665}.virtual-grid{position:relative;min-width:0}.virtual-row{position:absolute;right:0;left:0;display:grid;gap:5px;height:68px}.virtual-row .emote{box-sizing:border-box;height:68px;min-height:0}`
        return extra + `:host{all:initial}.trigger{position:fixed;display:none;width:28px;height:28px;padding:0;border:1px solid #474b59;border-radius:7px;background:#181b24;color:#e8e9ef;box-shadow:0 4px 14px rgba(0,0,0,.38);cursor:pointer}.trigger:hover,.trigger:focus-visible,.trigger[aria-expanded="true"]{border-color:#9d72f8;background:#242033;outline:none}.glass{position:absolute;left:8px;top:7px;width:8px;height:8px;border:2px solid currentColor;border-radius:50%}.glass:after{content:"";position:absolute;width:6px;height:2px;right:-5px;bottom:-3px;background:currentColor;transform:rotate(45deg);border-radius:2px}.panel{position:fixed;box-sizing:border-box;width:min(430px,calc(100vw - 8px));height:min(470px,calc(100vh - 12px));overflow:hidden;color:#e6e8ef;background:#0c0e14;border:1px solid #343846;border-radius:12px;box-shadow:0 14px 38px rgba(0,0,0,.58);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.panel[hidden],.panel.sidebar[hidden]{display:none}.search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;padding:9px;background:#151822;border-bottom:1px solid #2a2e3b}.search input{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;color:#e6e8ef;background:#1c202c;border:1px solid #343846;border-radius:7px;font:inherit;outline:none}.search input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.16)}.panel-tool{display:flex;align-items:center;justify-content:center;gap:5px;min-width:32px;padding:0 8px;color:#a6aabb;background:#1c202c;border:1px solid #343846;border-radius:7px;font:600 10px/1 inherit;cursor:pointer}.panel-tool:hover,.panel-tool:focus-visible{color:#fff;border-color:#8b5cf6;outline:none}.panel-tool.close{padding:0;width:32px;font-size:20px;font-weight:400}.overlay-sort[aria-pressed="true"]{color:#ffc1df;background:#30202c;border-color:#b75f8e}.layers-icon{flex:none;width:15px;height:15px}.nav{display:flex;gap:4px;min-width:0;padding:6px;overflow:auto;background:#151822;border-bottom:1px solid #2a2e3b;scrollbar-width:thin}.nav button{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:6px;max-width:140px;padding:5px 8px;overflow:hidden;color:#a6aabb;background:#1c202c;border:1px solid #2a2e3b;border-radius:7px;font:600 11px/1.2 inherit;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.nav button:hover,.nav button:focus-visible{color:#fff;border-color:#8b5cf6;outline:none}.nav-icon{display:grid;flex:none;place-items:center;width:20px;height:20px;overflow:hidden;color:#d7d9e3;background:#292d3a;border-radius:50%;font:700 9px/1 inherit}.nav-icon img{display:block;width:100%;height:100%;object-fit:cover}.nav-label{overflow:hidden;text-overflow:ellipsis}.content{box-sizing:border-box;min-width:0;height:calc(100% - 100px);padding:8px;overflow:auto;scroll-behavior:smooth}.section{margin:0 0 10px;scroll-margin-top:4px}.section h3{position:sticky;top:-8px;z-index:1;margin:0 0 5px;padding:6px 2px 4px;color:#b8bbca;background:#0c0e14;font-size:11px;letter-spacing:.04em;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:5px}.emote{position:relative;display:grid;place-items:center;min-height:68px;padding:6px 4px 18px;overflow:hidden;color:#e6e8ef;background:#151822;border:1px solid transparent;border-radius:8px;font:10px/1.1 inherit;cursor:pointer}.emote.overlay{background:linear-gradient(150deg,rgba(252,141,199,.1),transparent 50%),#151822;border-color:rgba(252,141,199,.42)}.emote:hover,.emote:focus-visible{background-color:#211d30;border-color:#8b5cf6;outline:none}.emote img{position:relative;display:block;width:34px;height:34px;object-fit:contain;transition:opacity .12s ease}.emote.is-loading img{opacity:0}.emote.is-loading:before{content:"";position:absolute;top:7px;left:50%;width:34px;height:34px;border-radius:5px;background:linear-gradient(105deg,#202430 28%,#323746 42%,#202430 58%);background-size:220% 100%;transform:translateX(-50%);animation:picker-loading 1.15s ease-in-out infinite;animation-delay:var(--loading-delay,0ms)}@keyframes picker-loading{0%{background-position:100% 0}100%{background-position:-100% 0}}.emote-name{position:absolute;right:3px;bottom:4px;left:3px;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap}.overlay-badge{position:absolute;z-index:2;top:3px;left:4px;display:grid;place-items:center;width:17px;height:17px;color:#fc8dc7;background:rgba(21,24,34,.86);border-radius:4px}.overlay-badge .layers-icon{width:14px;height:14px}.favorite{position:absolute;z-index:2;top:2px;right:3px;padding:2px;color:#777d91;background:transparent;border:0;font-size:15px;line-height:1;cursor:pointer}.favorite.on{color:#f0b429}.more{width:100%;margin-top:7px;padding:7px;color:#c8cbd6;background:#1c202c;border:1px solid #343846;border-radius:7px;font:600 11px inherit;cursor:pointer}.status{padding:0 9px 7px;color:#8e93a6}.nav-tooltip{position:absolute;z-index:8;max-width:230px;padding:6px 8px;color:#f1f2f6;background:#272b37;border:1px solid #4a5060;border-radius:6px;box-shadow:0 5px 16px rgba(0,0,0,.45);font:500 11px/1.3 inherit;pointer-events:none}.panel.sidebar{display:grid;grid-template-columns:48px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}.panel.sidebar .search{grid-column:1/3;grid-row:1}.panel.sidebar .nav{grid-column:1;grid-row:2;align-content:flex-start;flex-direction:column;min-width:0;padding:5px;background:#11141c;border-right:1px solid #2a2e3b;border-bottom:0}.panel.sidebar .nav button{justify-content:center;width:37px;height:37px;padding:4px}.panel.sidebar .nav-label{display:none}.panel.sidebar .content{grid-column:2;grid-row:2;min-width:0;height:auto}.panel.sidebar .status{grid-column:1/3;grid-row:3}.panel.sidebar .empty{padding:7px 5px}.panel.sidebar .section:has(.empty){margin-bottom:6px}.empty{padding:14px 8px;text-align:center;color:#8e93a6}@media(max-width:390px){.overlay-sort-text{display:none}.grid{grid-template-columns:repeat(auto-fill,minmax(56px,1fr))}.panel{height:min(430px,calc(100vh - 8px))}}@media(prefers-reduced-motion:reduce){.emote.is-loading:before{animation:none}.emote img{transition:none}}`
    }

    function providerStyleText() {
        return `.panel-sort{box-sizing:border-box;min-width:112px;max-width:134px;padding:0 8px;color:#a6aabb;background:#1c202c;border:1px solid #343846;border-radius:7px;font:600 10px/1 inherit;cursor:pointer;outline:none}.panel-sort:hover,.panel-sort:focus-visible{color:#fff;border-color:#8b5cf6}.emote .provider-icon,.emote .overlay-icon{position:absolute;z-index:2;top:3px;display:grid;box-sizing:border-box;place-items:center;height:17px;color:#f4f0ff;background:rgba(21,24,34,.9);border:1px solid rgba(12,14,20,.88);border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.35)}.emote .provider-icon{left:4px;width:20px}.emote .provider-icon.twitch{color:#9146ff}.emote .overlay-icon{left:27px;width:17px;color:#fc8dc7}.provider-icon svg{width:17px;height:13px}.provider-icon.twitch svg,.overlay-icon svg{width:14px;height:14px}@media(max-width:390px){.panel-sort{min-width:104px;max-width:118px}}`
    }

    function applyLayout() {
        if (!panel) return
        panel.classList.toggle("sidebar", layout === "sidebar")
        if (open) {
            layoutVirtualSections()
            scheduleVirtualUpdate(true)
        }
    }

    function cleanPickerSort(value, legacyOverlay = false) {
        return ["default", "twitch", "7tv", "overlay"].includes(value)
            ? value
            : legacyOverlay ? "overlay" : "default"
    }

    function emoteProvider(emote) {
        return emote && emote.provider === "twitch" ? "Twitch" : "7TV"
    }

    function createIcon(viewBox, paths, className, title) {
        const icon = document.createElement("span")
        icon.className = className
        icon.title = title
        icon.setAttribute("aria-label", title)
        icon.setAttribute("role", "img")
        const svg = document.createElementNS(SVG_NS, "svg")
        svg.setAttribute("viewBox", viewBox)
        svg.setAttribute("fill", "currentColor")
        svg.setAttribute("aria-hidden", "true")
        for (const d of Array.isArray(paths) ? paths : [paths]) {
            const path = document.createElementNS(SVG_NS, "path")
            path.setAttribute("d", d)
            svg.appendChild(path)
        }
        icon.appendChild(svg)
        return icon
    }

    const createProviderIcon = emote => emoteProvider(emote) === "Twitch"
        ? createIcon("0 0 24 24", TWITCH_ICON, "provider-icon twitch", "Twitch")
        : createIcon("0 0 28 20", SEVEN_ICON, "provider-icon", "7TV")
    const createOverlayIcon = () => createIcon("0 0 256 256", OVERLAY_ICON, "overlay-icon", "Overlaying")

    function syncSort() {
        if (sortSelect) sortSelect.value = sortMode
    }

    function targetHasFocus() {
        let focused = document.activeElement
        while (focused && focused.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
        return focused === target || Boolean(target && focused && target.contains?.(focused))
    }

    function targetInViewport() {
        if (!target || !target.isConnected) return false
        const rect = target.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < innerHeight && rect.left < innerWidth
    }

    function onViewportChange() {
        if (!host || !target) return
        if (!targetInViewport()) {
            if (open) closePanel(false)
            hideTrigger()
            return
        }
        if (open || targetHasFocus()) {
            trigger.style.display = "block"
            position()
        }
    }

    function startTriggerDrag(event) {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        captureSelection()
        const coarse = event.pointerType === "touch"
            || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)
        triggerDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: triggerOffset.x,
            offsetY: triggerOffset.y,
            ready: !coarse,
            dragging: false,
            canceled: false
        }
        trigger.setPointerCapture?.(event.pointerId)
        if (coarse) triggerLongPress = setTimeout(() => {
            if (!triggerDrag) return
            triggerDrag.ready = true
            trigger.classList.add("dragging")
        }, TOUCH_DRAG_DELAY)
    }

    function moveTriggerDrag(event) {
        if (!triggerDrag || event.pointerId !== triggerDrag.pointerId) return
        const dx = event.clientX - triggerDrag.startX
        const dy = event.clientY - triggerDrag.startY
        const distance = Math.hypot(dx, dy)
        if (!triggerDrag.ready) {
            if (distance > 10) {
                triggerDrag.canceled = true
                clearTriggerLongPress()
            }
            return
        }
        if (!triggerDrag.dragging && distance < DRAG_THRESHOLD) return
        triggerDrag.dragging = true
        trigger.classList.add("dragging")
        triggerOffset = {
            x: triggerDrag.offsetX + dx,
            y: triggerDrag.offsetY + dy
        }
        position()
    }

    function finishTriggerDrag(event) {
        if (!triggerDrag || event.pointerId !== triggerDrag.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        const drag = triggerDrag
        clearTriggerLongPress()
        triggerDrag = null
        trigger.classList.remove("dragging")
        trigger.releasePointerCapture?.(event.pointerId)
        if (drag.dragging) {
            saveTriggerOffset().catch(() => { })
            return
        }
        if (!drag.canceled) open ? closePanel() : openPanel()
    }

    function cancelTriggerDrag(event) {
        if (!triggerDrag || event.pointerId !== triggerDrag.pointerId) return
        clearTriggerLongPress()
        triggerDrag = null
        trigger?.classList.remove("dragging")
    }

    function clearTriggerLongPress() {
        if (triggerLongPress) clearTimeout(triggerLongPress)
        triggerLongPress = null
    }

    async function saveTriggerOffset() {
        if (!siteKey) return
        const next = {
            ...pickerTriggerPositions,
            [siteKey]: { x: Math.round(triggerOffset.x), y: Math.round(triggerOffset.y) }
        }
        pickerTriggerPositions = next
        await ext.storage.local.set({ pickerTriggerPositions: next })
    }

    function showTrigger() {
        if (!active || !targetInViewport()) {
            hideTrigger()
            return
        }
        ensureUi()
        trigger.style.display = "block"
        position()
    }

    function hideTrigger() {
        if (trigger)
            trigger.style.display = "none"
    }

    function position() {
        if (!host || !targetInViewport()) return
        const rect = target.getBoundingClientRect()
        const triggerSize = 28
        const gap = 5
        const baseLeft = rect.right + gap + triggerSize <= innerWidth
            ? rect.right + gap
            : Math.max(4, rect.right - triggerSize - 4)
        const baseTop = Math.max(4, Math.min(innerHeight - triggerSize - 4, rect.bottom - triggerSize))
        const triggerLeft = Math.max(4, Math.min(innerWidth - triggerSize - 4, baseLeft + triggerOffset.x))
        const triggerTop = Math.max(4, Math.min(innerHeight - triggerSize - 4, baseTop + triggerOffset.y))
        triggerOffset = { x: triggerLeft - baseLeft, y: triggerTop - baseTop }
        trigger.style.left = `${Math.round(triggerLeft)}px`
        trigger.style.top = `${Math.round(triggerTop)}px`
        if (!open) return
        const width = Math.min(430, innerWidth - 8)
        const height = Math.min(470, innerHeight - 12)
        let left = Math.min(rect.left, innerWidth - width - 4)
        let top = rect.bottom + gap
        if (top + height > innerHeight - 4) top = Math.max(4, rect.top - height - gap)
        panel.style.left = `${Math.max(4, Math.round(left))}px`
        panel.style.top = `${Math.max(4, Math.round(top))}px`
    }

    async function openPanel() {
        if (open) return
        ensureUi()
        open = true
        panel.hidden = false
        trigger.title = "Close 7TV emote picker"
        trigger.setAttribute("aria-label", "Close 7TV emote picker")
        trigger.setAttribute("aria-expanded", "true")
        shared.closeAutocomplete?.()
        position()
        search.value = ""
        discardVirtualRows()
        content.replaceChildren()
        status.textContent = "Loading emotes..."
        search.focus()
        const token = ++loadToken
        try {
            const [data, state] = await Promise.all([
                ext.runtime.sendMessage({ type: "GET_PICKER_DATA" }),
                ext.storage.local.get(["pickerFavorites", "pickerUsage", "pickerSort", "pickerOverlayFirst"])
            ])
            if (!open || token !== loadToken) return
            emotes = Array.isArray(data && data.emotes) ? data.emotes : []
            channels = Array.isArray(data && data.channels) ? data.channels : []
            favorites = new Set(Array.isArray(state.pickerFavorites) ? state.pickerFavorites : [])
            usage = state.pickerUsage && typeof state.pickerUsage === "object" ? state.pickerUsage : {}
            sortMode = cleanPickerSort(state.pickerSort, state.pickerOverlayFirst)
            syncSort()
            render(false)
        } catch {
            status.textContent = "Emotes could not be loaded"
        }
    }

    function closePanel(showButton = true) {
        if (!panel) return
        open = false
        loadToken++
        panel.hidden = true
        trigger.title = "Open 7TV emote picker"
        trigger.setAttribute("aria-label", "Open 7TV emote picker")
        trigger.setAttribute("aria-expanded", "false")
        search.value = ""
        discardVirtualRows()
        virtualSections = []
        disposeImages(nav)
        nav.replaceChildren()
        content.replaceChildren()
        if (showButton) showTrigger()
        else hideTrigger()
    }
    shared.closePicker = closePanel

    function emoteKey(emote) {
        return `${emote.channelId || "global"}:${emote.id || emote.name}`
    }

    function orderEmotes(items) {
        if (sortMode === "default") return items
        return [...items].sort((left, right) => {
            if (sortMode === "overlay")
                return Number(Boolean(right.zeroWidth)) - Number(Boolean(left.zeroWidth))
            const first = sortMode === "twitch" ? "twitch" : "7tv"
            const leftProvider = emoteProvider(left) === "Twitch" ? "twitch" : "7tv"
            const rightProvider = emoteProvider(right) === "Twitch" ? "twitch" : "7tv"
            return Number(rightProvider === first) - Number(leftProvider === first)
        })
    }

    function groupData() {
        const byChannel = new Map(channels.map(channel => [channel.id, []]))
        for (const emote of emotes) {
            const id = emote.channelId || "global"
            if (!byChannel.has(id)) byChannel.set(id, [])
            byChannel.get(id).push(emote)
        }
        const favorite = orderEmotes(emotes.filter(emote => favorites.has(emoteKey(emote))))
        const frequent = emotes.filter(emote => usage[emoteKey(emote)])
            .sort((left, right) => {
                const a = usage[emoteKey(left)] || {}
                const b = usage[emoteKey(right)] || {}
                return (b.count || 0) - (a.count || 0) || (b.lastUsed || 0) - (a.lastUsed || 0)
            })
            .slice(0, 48)
        const groups = [
            { id: "favorites", short: "★", name: "Favorites", emotes: favorite },
            { id: "frequent", short: "↻", name: "Frequently used", emotes: orderEmotes(frequent) }
        ]
        for (const channel of channels) groups.push({
            id: `channel-${channel.id}`,
            short: channel.id === "global" ? "G" : channel.name.slice(0, 2).toUpperCase(),
            name: channel.name,
            avatarUrl: channel.avatarUrl || (channel.id === "global" && typeof ext.runtime.getURL === "function"
                ? ext.runtime.getURL("icons/icon-48.png")
                : ""),
            channel: true,
            emotes: orderEmotes(byChannel.get(channel.id) || [])
        })
        return groups
    }

    function captureScrollAnchor() {
        if (!content) return null
        const viewport = content.getBoundingClientRect()
        const cards = [...content.querySelectorAll(".emote[data-emote-key]")]
            .filter(card => {
                const rect = card.getBoundingClientRect()
                return rect.bottom > viewport.top && rect.top < viewport.bottom
            })
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
        const card = cards[0]
        if (card) return {
            kind: "emote",
            key: card.dataset.emoteKey,
            offset: card.getBoundingClientRect().top - viewport.top
        }
        const heading = [...content.querySelectorAll(".section h3")].find(item => {
            const rect = item.getBoundingClientRect()
            return rect.bottom > viewport.top && rect.top < viewport.bottom
        })
        return heading ? {
            kind: "section",
            key: heading.parentElement?.id || "",
            offset: heading.getBoundingClientRect().top - viewport.top
        } : null
    }

    function restoreScrollAnchor(anchor) {
        if (!anchor || !content) return
        const viewport = content.getBoundingClientRect()
        const candidates = anchor.kind === "emote"
            ? [...content.querySelectorAll(".emote[data-emote-key]")]
                .filter(card => card.dataset.emoteKey === anchor.key)
            : [root.getElementById(anchor.key)?.querySelector("h3")].filter(Boolean)
        const match = candidates.sort((left, right) => {
            const leftOffset = left.getBoundingClientRect().top - viewport.top
            const rightOffset = right.getBoundingClientRect().top - viewport.top
            return Math.abs(leftOffset - anchor.offset) - Math.abs(rightOffset - anchor.offset)
        })[0]
        if (!match) return
        const delta = match.getBoundingClientRect().top - viewport.top - anchor.offset
        if (Math.abs(delta) < 0.5) return
        content.scrollTop += delta
        updateVirtualRows(true)
    }

    function render(preserveScroll = false) {
        if (!open) return
        const previousScroll = preserveScroll ? content.scrollTop : 0
        const scrollAnchor = preserveScroll ? captureScrollAnchor() : null
        const query = search.value.trim().toLowerCase()
        discardVirtualRows()
        disposeImages(nav)
        nav.replaceChildren()
        content.replaceChildren()
        virtualSections = []
        if (query) {
            nav.hidden = true
            const matched = orderEmotes(emotes.filter(emote =>
                String(emote.name || "").toLowerCase().includes(query)
                || String(emote.channelName || "").toLowerCase().includes(query)
            ))
            renderSection({ id: "search-results", name: "Search results", emotes: matched })
            status.textContent = `${matched.length} matching emotes`
        } else {
            nav.hidden = false
            const groups = groupData()
            for (const group of groups) {
                const button = createNavButton(group)
                nav.appendChild(button)
                renderSection(group)
            }
            status.textContent = `${emotes.length} available emotes`
        }
        layoutVirtualSections()
        content.scrollTop = previousScroll
        updateVirtualRows(true)
        restoreScrollAnchor(scrollAnchor)
    }

    function createNavButton(group) {
        const button = document.createElement("button")
        button.type = "button"
        const description = `${group.name} · ${group.emotes.length} emote${group.emotes.length === 1 ? "" : "s"}`
        button.title = description
        button.setAttribute("aria-label", description)

        const icon = document.createElement("span")
        icon.className = "nav-icon"
        if (group.avatarUrl) {
            const image = document.createElement("img")
            image.referrerPolicy = "no-referrer"
            image.loading = "lazy"
            image.src = group.avatarUrl
            image.alt = ""
            image.addEventListener("error", () => {
                image.remove()
                icon.textContent = group.short
            }, { once: true })
            icon.appendChild(image)
        } else icon.textContent = group.short

        const label = document.createElement("span")
        label.className = "nav-label"
        label.textContent = group.name
        button.append(icon, label)
        button.addEventListener("pointerenter", () => showNavTooltip(button, description))
        button.addEventListener("pointerleave", hideNavTooltip)
        button.addEventListener("focus", () => showNavTooltip(button, description))
        button.addEventListener("blur", hideNavTooltip)
        button.addEventListener("click", () => {
            hideNavTooltip()
            const section = root.getElementById(group.id)
            if (section) content.scrollTo({ top: Math.max(0, section.offsetTop - 2), behavior: "smooth" })
        })
        return button
    }

    function showNavTooltip(button, text) {
        if (!navTooltip || layout !== "sidebar") return
        navTooltip.textContent = text
        navTooltip.hidden = false
        const panelRect = panel.getBoundingClientRect()
        const buttonRect = button.getBoundingClientRect()
        navTooltip.style.left = `${Math.round(buttonRect.right - panelRect.left + 7)}px`
        navTooltip.style.top = `${Math.max(4, Math.round(buttonRect.top - panelRect.top + (buttonRect.height - navTooltip.offsetHeight) / 2))}px`
    }

    function hideNavTooltip() {
        if (navTooltip) navTooltip.hidden = true
    }

    function renderSection(group) {
        const section = document.createElement("section")
        section.className = "section"
        section.id = group.id
        const heading = document.createElement("h3")
        heading.textContent = `${group.name} · ${group.emotes.length}`
        section.appendChild(heading)
        if (!group.emotes.length) {
            const empty = document.createElement("div")
            empty.className = "empty"
            empty.textContent = group.id === "favorites"
                ? "Right-click an emote—or tap its star—to keep it here"
                : group.id === "frequent" ? "Used emotes will appear here" : "No emotes"
            section.appendChild(empty)
            content.appendChild(section)
            return
        }
        const grid = document.createElement("div")
        grid.className = "virtual-grid"
        section.appendChild(grid)
        content.appendChild(section)
        virtualSections.push({ section, grid, emotes: group.emotes, columns: 1, renderedRows: new Map() })
    }

    function layoutVirtualSections() {
        if (!content || !open) return
        const available = Math.max(56, (content.clientWidth || (layout === "sidebar" ? 366 : 414)) - 16)
        const minimum = innerWidth <= 360 ? 56 : 62
        const columns = Math.max(1, Math.floor((available + GRID_GAP) / (minimum + GRID_GAP)))
        for (const state of virtualSections) {
            if (state.columns !== columns) {
                state.columns = columns
                for (const row of state.renderedRows.values()) disposeVirtualRow(row)
                state.renderedRows.clear()
            }
            const rowCount = Math.ceil(state.emotes.length / columns)
            const height = rowCount ? rowCount * GRID_ROW_HEIGHT + (rowCount - 1) * GRID_GAP : 0
            state.grid.style.height = `${height}px`
        }
    }

    function disposeImages(container) {
        for (const image of container?.querySelectorAll("img") || []) {
            image.removeAttribute("srcset")
            image.removeAttribute("src")
            image.remove()
        }
    }

    function disposeVirtualRow(row) {
        disposeImages(row)
        row.remove()
    }

    function discardVirtualRows() {
        if (virtualFrame) cancelAnimationFrame(virtualFrame)
        virtualFrame = 0
        if (virtualScrollTimer) clearTimeout(virtualScrollTimer)
        virtualScrollTimer = 0
        if (virtualScrollRefreshTimer) clearTimeout(virtualScrollRefreshTimer)
        virtualScrollRefreshTimer = 0
        lastVirtualMountAt = 0
        for (const state of virtualSections) {
            for (const row of state.renderedRows.values()) disposeVirtualRow(row)
            state.renderedRows.clear()
        }
    }

    function onContentScroll() {
        if (!open || !content) return
        scheduleVirtualUpdate(false, false)
        if (!virtualScrollRefreshTimer) {
            const remaining = Math.max(0, VIRTUAL_SCROLL_REFRESH_MS - (Date.now() - lastVirtualMountAt))
            virtualScrollRefreshTimer = setTimeout(() => {
                virtualScrollRefreshTimer = 0
                scheduleVirtualUpdate(true, true)
            }, remaining)
        }
        if (virtualScrollTimer) clearTimeout(virtualScrollTimer)
        virtualScrollTimer = setTimeout(() => {
            virtualScrollTimer = 0
            if (virtualScrollRefreshTimer) clearTimeout(virtualScrollRefreshTimer)
            virtualScrollRefreshTimer = 0
            scheduleVirtualUpdate(true, true)
        }, VIRTUAL_SCROLL_IDLE_MS)
    }

    function scheduleVirtualUpdate(force = false, mountRows = true) {
        if (!open || !content) return
        if (force && virtualFrame) cancelAnimationFrame(virtualFrame)
        if (virtualFrame && !force) return
        virtualFrame = requestAnimationFrame(() => {
            virtualFrame = 0
            updateVirtualRows(mountRows)
        })
    }

    function contentOffset(element) {
        const elementRect = element.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        return elementRect.top - contentRect.top + content.scrollTop
    }

    function updateVirtualRows(mountRows = true) {
        if (!open || !content) return
        if (mountRows) lastVirtualMountAt = Date.now()
        const viewportTop = content.scrollTop - GRID_PRELOAD_PX
        const viewportBottom = content.scrollTop + content.clientHeight + GRID_PRELOAD_PX
        const stride = GRID_ROW_HEIGHT + GRID_GAP
        for (const state of virtualSections) {
            const gridTop = contentOffset(state.grid)
            const rowCount = Math.ceil(state.emotes.length / state.columns)
            const first = Math.max(0, Math.floor((viewportTop - gridTop) / stride))
            const last = Math.min(rowCount - 1, Math.ceil((viewportBottom - gridTop) / stride))
            for (const [index, row] of state.renderedRows) {
                if (index >= first && index <= last) continue
                disposeVirtualRow(row)
                state.renderedRows.delete(index)
            }
            if (last < first) continue
            for (let index = first; index <= last; index++) {
                const existing = state.renderedRows.get(index)
                if (existing && (!mountRows || existing.dataset.virtualPlaceholder !== "true")) continue
                if (existing) {
                    disposeVirtualRow(existing)
                    state.renderedRows.delete(index)
                }
                const row = document.createElement("div")
                row.className = "virtual-row"
                row.dataset.virtualPlaceholder = mountRows ? "false" : "true"
                row.style.top = `${index * stride}px`
                row.style.gridTemplateColumns = `repeat(${state.columns}, minmax(0, 1fr))`
                const start = index * state.columns
                state.emotes.slice(start, start + state.columns).forEach((emote, offset) =>
                    row.appendChild(createEmote(emote, start + offset, mountRows)))
                state.grid.appendChild(row)
                state.renderedRows.set(index, row)
            }
        }
    }

    function createEmote(emote, visualIndex = 0, loadImage = true) {
        const button = document.createElement("div")
        button.className = `emote is-loading${emote.zeroWidth ? " overlay" : ""}`
        button.style.setProperty("--loading-delay", `${-(visualIndex % 16) * 18}ms`)
        button.tabIndex = 0
        button.setAttribute("role", "button")
        button.dataset.emoteKey = emoteKey(emote)
        const provider = emoteProvider(emote)
        button.title = `${emote.name} · ${emote.channelName || "Global 7TV"} · ${provider}${emote.zeroWidth ? " · Overlaying" : ""}`
        const image = document.createElement("img")
        image.className = "emote-image"
        image.referrerPolicy = "no-referrer"
        image.loading = "lazy"
        image.decoding = "async"
        if (loadImage) {
            const revealImage = () => button.classList.remove("is-loading")
            image.addEventListener("load", revealImage, { once: true })
            image.addEventListener("error", revealImage, { once: true })
            image.src = emote.url
            if (image.complete) queueMicrotask(revealImage)
        }
        image.alt = ""
        const name = document.createElement("span")
        name.className = "emote-name"
        name.textContent = emote.name
        const providerIcon = createProviderIcon(emote)
        const favorite = document.createElement("button")
        favorite.className = `favorite${favorites.has(emoteKey(emote)) ? " on" : ""}`
        favorite.type = "button"
        favorite.textContent = favorites.has(emoteKey(emote)) ? "★" : "☆"
        favorite.title = favorites.has(emoteKey(emote)) ? "Remove from favorites" : "Add to favorites"
        favorite.setAttribute("aria-label", favorite.title)
        favorite.addEventListener("pointerdown", event => {
            event.preventDefault()
            event.stopPropagation()
        })
        favorite.addEventListener("click", event => {
            event.preventDefault()
            event.stopPropagation()
            toggleFavorite(emote)
        })
        button.addEventListener("click", event => {
            if (event.target.closest?.(".favorite")) return
            chooseEmote(emote, event.shiftKey)
        })
        button.addEventListener("contextmenu", event => {
            event.preventDefault()
            event.stopPropagation()
            toggleFavorite(emote)
        })
        button.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            chooseEmote(emote, event.shiftKey)
        })
        button.append(image, name)
        button.appendChild(providerIcon)
        if (emote.zeroWidth) button.appendChild(createOverlayIcon())
        button.appendChild(favorite)
        return button
    }

    async function toggleFavorite(emote) {
        const key = emoteKey(emote)
        if (favorites.has(key)) favorites.delete(key)
        else favorites.add(key)
        render(true)
        await ext.storage.local.set({ pickerFavorites: [...favorites] })
    }

    async function chooseEmote(emote, keepOpen = false) {
        insertText(`${emote.name} `)
        const key = emoteKey(emote)
        const previous = usage[key] || {}
        usage = {
            ...usage,
            [key]: { count: Math.min(999999, (previous.count || 0) + 1), lastUsed: Date.now() }
        }
        const entries = Object.entries(usage)
            .sort(([, a], [, b]) => (b.lastUsed || 0) - (a.lastUsed || 0))
            .slice(0, 250)
        usage = Object.fromEntries(entries)
        if (keepOpen) render(true)
        else {
            closePanel()
            target?.focus()
        }
        await ext.storage.local.set({ pickerUsage: usage })
    }

    function captureSelection() {
        if (!target) return
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            savedSelection = {
                kind: "field",
                start: target.selectionStart ?? target.value.length,
                end: target.selectionEnd ?? target.value.length
            }
            return
        }
        const selection = window.getSelection()
        if (!selection || !selection.rangeCount) return
        const range = selection.getRangeAt(0)
        if (target.contains(range.commonAncestorContainer) || target === range.commonAncestorContainer)
            savedSelection = { kind: "editable", range: range.cloneRange() }
    }

    function insertText(text) {
        if (!target || !target.isConnected) return
        target.focus()
        if (savedSelection?.kind === "field" && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
            const start = savedSelection.start
            const end = savedSelection.end
            const proto = target.tagName === "TEXTAREA"
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
            const next = target.value.slice(0, start) + text + target.value.slice(end)
            if (setter) setter.call(target, next)
            else target.value = next
            target.setSelectionRange(start + text.length, start + text.length)
        } else if (savedSelection?.kind === "editable") {
            let range = savedSelection.range
            if (!range || !target.contains(range.commonAncestorContainer)) {
                range = document.createRange()
                range.selectNodeContents(target)
                range.collapse(false)
            }
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            range.deleteContents()
            const node = document.createTextNode(text)
            range.insertNode(node)
            range.setStartAfter(node)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
        }
        target.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: text
        }))
        captureSelection()
    }

    function unload() {
        open = false
        target = null
        savedSelection = null
        clearTriggerLongPress()
        triggerDrag = null
        virtualResizeObserver?.disconnect()
        virtualResizeObserver = null
        discardVirtualRows()
        virtualSections = []
        host?.remove()
        host = root = trigger = panel = nav = search = sortSelect = closeButton = content = status = navTooltip = null
    }
})()
