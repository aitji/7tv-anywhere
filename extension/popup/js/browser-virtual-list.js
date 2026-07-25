function createBrowserVirtualList(container) {
    const PRELOAD_PX = 120
    const RELEASE_PX = 720
    let observer = null
    let entries = []
    let entryByKey = new Map()
    let frame = 0

    const release = entry => {
        if (!entry.rendered) return
        const active = document.activeElement
        if (entry.slot.contains(active) && typeof active.blur === "function") active.blur()
        const height = Math.ceil(entry.slot.getBoundingClientRect().height)
        if (height > 0) entry.height = height
        entry.slot.style.height = `${entry.height}px`
        entry.slot.replaceChildren()
        entry.slot.classList.remove("is-rendered")
        entry.slot.setAttribute("aria-hidden", "true")
        entry.node = null
        entry.rendered = false
    }

    const materialize = entry => {
        if (entry.rendered) return
        entry.rendered = true
        entry.slot.classList.add("is-rendered")
        entry.slot.removeAttribute("aria-hidden")
        entry.slot.style.height = "auto"
        entry.node = entry.render(entry.item, entry.index)
        entry.slot.replaceChildren(entry.node)

        requestAnimationFrame(() => {
            if (!entry.rendered) return
            const height = Math.ceil(entry.slot.getBoundingClientRect().height)
            if (height > 0) entry.height = height
            entry.slot.style.height = `${entry.height}px`
        })
    }

    const rerender = entry => {
        if (!entry.rendered) return
        const active = entry.slot.contains(document.activeElement)
        const next = entry.render(entry.item, entry.index)
        entry.node = next
        entry.slot.replaceChildren(next)
        if (active) next.querySelector("button, input, select")?.focus()
        requestAnimationFrame(() => {
            if (!entry.rendered) return
            const height = Math.ceil(entry.slot.getBoundingClientRect().height)
            if (height > 0) entry.height = height
            entry.slot.style.height = `${entry.height}px`
        })
    }

    const sweep = () => {
        frame = 0
        if (container.closest("[hidden]")) return
        const viewport = window.innerHeight || document.documentElement.clientHeight || 600
        for (const entry of entries) {
            const rect = entry.slot.getBoundingClientRect()
            const near = rect.bottom >= -PRELOAD_PX && rect.top <= viewport + PRELOAD_PX
            const far = rect.bottom < -RELEASE_PX || rect.top > viewport + RELEASE_PX
            if (near) materialize(entry)
            else if (far) release(entry)
        }
    }

    const scheduleSweep = () => {
        if (frame) return
        frame = requestAnimationFrame(sweep)
    }

    window.addEventListener("scroll", scheduleSweep, { passive: true, capture: true })
    document.addEventListener("scroll", scheduleSweep, { passive: true, capture: true })
    window.addEventListener("resize", scheduleSweep, { passive: true })

    const ensureObserver = () => {
        if (observer || typeof IntersectionObserver !== "function") return
        observer = new IntersectionObserver(changes => {
            for (const change of changes) {
                const entry = entryByKey.get(change.target.dataset.virtualKey)
                if (!entry) continue
                if (change.isIntersecting && !container.closest("[hidden]")) materialize(entry)
            }
            scheduleSweep()
        }, { root: null, rootMargin: `${PRELOAD_PX}px 0px` })
    }

    const syncOrder = nextEntries => {
        for (let index = 0; index < nextEntries.length; index++) {
            const slot = nextEntries[index].slot
            const current = container.children[index]
            if (current !== slot) container.insertBefore(slot, current || null)
        }
        while (container.children.length > nextEntries.length)
            container.lastElementChild.remove()
    }

    const mount = (items, render, estimate, options = {}) => {
        const keyOf = options.key || ((_, index) => String(index))
        const versionOf = options.version || (() => "")
        const patch = options.patch || null
        const nextEntries = []
        const nextByKey = new Map()

        ensureObserver()

        items.forEach((item, index) => {
            const key = String(keyOf(item, index))
            const version = String(versionOf(item, index))
            let entry = entryByKey.get(key)

            if (!entry) {
                const slot = document.createElement("div")
                const height = Math.max(1, Number(estimate(item, index)) || 1)
                slot.className = "browser-virtual-slot"
                slot.style.height = `${height}px`
                slot.dataset.virtualKey = key
                slot.setAttribute("aria-hidden", "true")
                entry = {
                    key,
                    item,
                    index,
                    slot,
                    render,
                    patch,
                    version,
                    height,
                    node: null,
                    rendered: false
                }
                observer?.observe(slot)
            } else {
                const changed = entry.version !== version
                entry.item = item
                entry.index = index
                entry.render = render
                entry.patch = patch
                entry.version = version
                if (!entry.rendered) {
                    entry.height = Math.max(1, Number(estimate(item, index)) || entry.height || 1)
                    entry.slot.style.height = `${entry.height}px`
                } else if (changed) rerender(entry)
            }

            nextEntries.push(entry)
            nextByKey.set(key, entry)
        })

        for (const entry of entries) {
            if (nextByKey.has(entry.key)) continue
            observer?.unobserve(entry.slot)
            entry.slot.remove()
        }

        entries = nextEntries
        entryByKey = nextByKey
        syncOrder(entries)
        scheduleSweep()
    }

    const refresh = keys => {
        const wanted = keys ? new Set(Array.isArray(keys) ? keys.map(String) : [String(keys)]) : null
        for (const entry of entries) {
            if (!entry.rendered || !entry.patch || (wanted && !wanted.has(entry.key))) continue
            entry.patch(entry.node, entry.item, entry.index)
            requestAnimationFrame(() => {
                if (!entry.rendered) return
                const height = Math.ceil(entry.slot.getBoundingClientRect().height)
                if (height > 0) entry.height = height
                entry.slot.style.height = `${entry.height}px`
            })
        }
    }

    const destroy = () => {
        if (observer) observer.disconnect()
        observer = null
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        entries = []
        entryByKey = new Map()
        container.replaceChildren()
    }

    return { destroy, mount, refresh }
}
