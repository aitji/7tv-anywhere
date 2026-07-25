class FakeClassList {
    constructor(element) {
        this.element = element
        this.values = new Set()
    }

    set(value) {
        this.values = new Set(String(value || "").split(/\s+/).filter(Boolean))
    }

    add(...names) {
        for (const name of names) this.values.add(name)
    }

    remove(...names) {
        for (const name of names) this.values.delete(name)
    }

    contains(name) {
        return this.values.has(name)
    }

    toggle(name, force) {
        const enabled = force === undefined ? !this.contains(name) : !!force
        if (enabled) this.add(name)
        else this.remove(name)
        return enabled
    }

    toString() {
        return [...this.values].join(" ")
    }
}

const dataName = name => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())

function selectorMatch(element, selector) {
    selector = selector.trim()
    if (!selector) return false

    let checked = false
    if (selector.endsWith(":checked")) {
        checked = true
        selector = selector.slice(0, -8)
    }
    if (checked && !element.checked) return false

    const attributes = [...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)]
    selector = selector.replace(/\[[^\]]+\]/g, "")
    for (const [, name, expected] of attributes) {
        let actual
        if (name === "hidden") actual = element.hidden ? "" : null
        else if (name.startsWith("data-")) actual = element.dataset[dataName(name)]
        else actual = element.getAttribute(name) ?? element[name]
        if (actual === null || actual === undefined || actual === false) return false
        if (expected !== undefined && String(actual) !== expected) return false
    }

    const id = selector.match(/#([\w-]+)/)?.[1]
    if (id && element.id !== id) return false

    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1])
    if (classes.some(name => !element.classList.contains(name))) return false

    const tag = selector.match(/^[a-z][\w-]*/i)?.[0]
    return !tag || element.tagName === tag.toUpperCase()
}

export class FakeElement {
    constructor(tagName = "div", document = null, fragment = false) {
        this.tagName = fragment ? "#FRAGMENT" : String(tagName).toUpperCase()
        this.ownerDocument = document
        this.parentNode = null
        this.children = []
        this.dataset = {}
        this.attributes = new Map()
        this.listeners = new Map()
        this.classList = new FakeClassList(this)
        this.style = {
            setProperty: (name, value) => { this.style[name] = String(value) }
        }
        this.hidden = false
        this.disabled = false
        this.checked = false
        this.value = ""
        this.type = ""
        this.title = ""
        this.src = ""
        this.alt = ""
        this.loading = ""
        this.placeholder = ""
        this._text = ""
        this._fragment = fragment
    }

    get className() {
        return this.classList.toString()
    }

    set className(value) {
        this.classList.set(value)
    }

    get childNodes() {
        return this.children
    }

    get childElementCount() {
        return this.children.length
    }

    get firstElementChild() {
        return this.children[0] || null
    }

    get lastElementChild() {
        return this.children.at(-1) || null
    }

    get textContent() {
        if (this.children.length) return this.children.map(child => child.textContent).join("")
        return this._text
    }

    set textContent(value) {
        this._text = String(value ?? "")
        this.replaceChildren()
    }

    appendChild(child) {
        if (!child) return child
        if (child._fragment) {
            for (const nested of [...child.children]) this.appendChild(nested)
            return child
        }
        child.remove()
        child.parentNode = this
        child.ownerDocument ||= this.ownerDocument
        this.children.push(child)
        return child
    }

    replaceChildren(...children) {
        for (const child of this.children) child.parentNode = null
        this.children = []
        for (const child of children) this.appendChild(child)
    }

    insertBefore(child, before) {
        if (!before) return this.appendChild(child)
        child.remove()
        const index = this.children.indexOf(before)
        if (index < 0) return this.appendChild(child)
        child.parentNode = this
        child.ownerDocument ||= this.ownerDocument
        this.children.splice(index, 0, child)
        return child
    }

    remove() {
        if (!this.parentNode) return
        const index = this.parentNode.children.indexOf(this)
        if (index >= 0) this.parentNode.children.splice(index, 1)
        this.parentNode = null
    }

    setAttribute(name, value) {
        const text = String(value)
        this.attributes.set(name, text)
        if (name === "id") this.id = text
        if (name === "class") this.className = text
        if (name.startsWith("data-")) this.dataset[dataName(name)] = text
    }

    getAttribute(name) {
        if (name === "id") return this.id || null
        if (name === "class") return this.className || null
        if (name.startsWith("data-")) return this.dataset[dataName(name)] ?? null
        return this.attributes.get(name) ?? null
    }

    removeAttribute(name) {
        this.attributes.delete(name)
        if (name.startsWith("data-")) delete this.dataset[dataName(name)]
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || []
        listeners.push(listener)
        this.listeners.set(type, listeners)
    }

    dispatchEvent(event) {
        event.target ||= this
        event.currentTarget = this
        for (const listener of this.listeners.get(event.type) || []) listener.call(this, event)
        return !event.defaultPrevented
    }

    click() {
        this.dispatchEvent({ type: "click", target: this, preventDefault() { this.defaultPrevented = true } })
    }

    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this
    }

    blur() {
        if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null
    }

    contains(node) {
        if (!node) return false
        if (node === this) return true
        return this.children.some(child => child.contains(node))
    }

    matches(selector) {
        return selector.split(",").some(part => selectorMatch(this, part))
    }

    querySelectorAll(selector) {
        const selectors = selector.split(",").map(item => item.trim()).filter(Boolean)
        const out = []
        const walk = node => {
            for (const child of node.children) {
                if (selectors.some(item => selectorMatch(child, item))) out.push(child)
                walk(child)
            }
        }
        walk(this)
        return out
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null
    }

    closest(selector) {
        let node = this
        while (node) {
            if (node.matches?.(selector)) return node
            node = node.parentNode
        }
        return null
    }

    getBoundingClientRect() {
        if (this._rect) return { ...this._rect }
        const height = Math.max(1, Number.parseFloat(this.style.height) || 1)
        if (this.classList.contains("browser-virtual-slot") && this.parentNode) {
            const index = this.parentNode.children.indexOf(this)
            const scrollY = this.ownerDocument?.defaultView?._scrollY || 0
            const top = index * height - scrollY
            return { top, bottom: top + height, height }
        }
        return { top: 0, bottom: height, height }
    }

    cloneNode(deep = false) {
        const clone = new FakeElement(this.tagName, this.ownerDocument)
        clone.className = this.className
        clone._text = this._text
        for (const [name, value] of this.attributes) clone.setAttribute(name, value)
        if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true))
        return clone
    }
}

export function createFakeDom() {
    const ids = new Map()
    const documentListeners = new Map()
    const windowListeners = new Map()
    const rafQueue = new Map()
    let rafId = 0

    const document = {
        activeElement: null,
        defaultView: null,
        documentElement: { clientHeight: 600 },
        body: null,
        head: null,
        createElement: tag => new FakeElement(tag, document),
        createElementNS: (_, tag) => new FakeElement(tag, document),
        createDocumentFragment: () => new FakeElement("fragment", document, true),
        getElementById(id) {
            if (!ids.has(id)) {
                const element = new FakeElement("div", document)
                element.id = id
                ids.set(id, element)
            }
            return ids.get(id)
        },
        querySelectorAll() { return [] },
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) || []
            listeners.push(listener)
            documentListeners.set(type, listeners)
        },
        dispatch(type) {
            for (const listener of documentListeners.get(type) || []) listener({ type })
        }
    }
    document.body = new FakeElement("body", document)
    document.head = new FakeElement("head", document)

    const window = {
        innerHeight: 600,
        _scrollY: 0,
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) || []
            listeners.push(listener)
            windowListeners.set(type, listeners)
        },
        dispatch(type) {
            for (const listener of windowListeners.get(type) || []) listener({ type })
        }
    }
    document.defaultView = window

    const requestAnimationFrame = callback => {
        const id = ++rafId
        rafQueue.set(id, callback)
        return id
    }
    const cancelAnimationFrame = id => rafQueue.delete(id)
    const flushAnimationFrames = () => {
        let turns = 0
        while (rafQueue.size && turns++ < 50) {
            const batch = [...rafQueue.entries()]
            rafQueue.clear()
            for (const [, callback] of batch) callback()
        }
        if (rafQueue.size) throw new Error("animation frame queue did not settle")
    }

    class FakeIntersectionObserver {
        constructor(callback) {
            this.callback = callback
            this.targets = new Set()
        }
        observe(target) { this.targets.add(target) }
        unobserve(target) { this.targets.delete(target) }
        disconnect() { this.targets.clear() }
        trigger(target, isIntersecting = true) {
            this.callback([{ target, isIntersecting }])
        }
    }

    return {
        document,
        window,
        requestAnimationFrame,
        cancelAnimationFrame,
        flushAnimationFrames,
        IntersectionObserver: FakeIntersectionObserver
    }
}
