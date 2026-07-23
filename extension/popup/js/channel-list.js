findSetsBtn.addEventListener("click", findChannel)
channelQueryInput.addEventListener("keydown", e => (e.key === "Enter") && findChannel())

async function findChannel() {
    if (channelOperationState && channelOperationState.phase === "resolving") return
    const query = channelQueryInput.value.trim()
    if (!query) {
        channelOperationState = {
            phase: "error",
            message: "Enter a Twitch channel, 7TV set, link, or ID...",
            updatedAt: Date.now()
        }
        renderChannelStatus()
        return
    }

    channelOperationState = {
        phase: "resolving",
        message: `Finding "${query}" in the background; you can close this popup...`,
        updatedAt: Date.now()
    }
    renderChannelStatus()
    updateSaveBar()

    let res
    try {
        res = await ext.runtime.sendMessage({ type: "ADD_CHANNEL_TO_DRAFT", query })
    } catch (err) {
        res = { error: String(err) }
    }

    if (!res || res.error) {
        channelOperationState = {
            phase: "error",
            message: errorText(res && res.error),
            updatedAt: Date.now()
        }
        renderChannelStatus()
        updateSaveBar()
        return
    }

    channelQueryInput.value = ""
    channelOperationState = {
        phase: "done",
        message: res.message || "Added to your draft! Save when you are ready!",
        updatedAt: Date.now()
    }
    renderChannelStatus()
    updateSaveBar()
}

const groupByChannel = (customSets) => {
    const map = new Map()
    for (const set of customSets) {
        if (!map.has(set.channelId)) map.set(set.channelId, { channelId: set.channelId, channelName: set.channelName, sets: [] })
        map.get(set.channelId).sets.push(set)
    }

    return Array.from(map.values())
}

const sumEmotes = (sets) => sets.filter(s => s.enabled !== false).reduce((total, s) => total + (s.count || 0), 0)
function renderHome() {
    const C = groupByChannel(draft.customSets).reverse()
    const activeC = C.filter(c => c.sets.some(s => s.enabled !== false))

    channelsEmptyEl.style.display = C.length ? "none" : "block"
    channelsSummaryEl.textContent = C.length
        ? `${activeC.length}/${C.length} active ~${sumEmotes(draft.customSets)} emotes`
        : ""

    channelCardsEl.replaceChildren()
    C.forEach((c, i) => channelCardsEl.appendChild(renderCCard(c, i, C.length)))
}


function makeSwitch(on, { small = false, disabled = false, title = "" } = {}) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "switch" + (small ? " switch-sm" : "") + (disabled ? " switch-disabled" : "")
    btn.setAttribute("role", "switch")
    btn.setAttribute("aria-checked", on ? "true" : "false")
    if (title) btn.title = title
    btn.disabled = disabled
    const knob = document.createElement("span")
    knob.className = "switch-knob"
    btn.appendChild(knob)
    return btn
}

function renderCCard(channel, index, total) {
    const enabledSet = channel.sets.filter(s => s.enabled !== false)
    const channelOn = enabledSet.length > 0
    const alwayMain = !!(draft.channelSettings[channel.channelId] || {}).alwaysMain

    const card = document.createElement("div")
    card.className = "card card-draggable" + (alwayMain ? " is-main-set" : "")
    card.draggable = true
    card.dataset.channelId = channel.channelId

    card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", channel.channelId)
    })
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging")
        commitChannelOrderDOM()
    })

    const top = document.createElement("div")
    top.className = "card-top"

    const dragHandle = document.createElement("span")
    dragHandle.className = "drag-handle"
    dragHandle.appendChild(makeIcon("drag"))
    dragHandle.title = "Drag to reorder priority"
    top.appendChild(dragHandle)

    const prioBadge = document.createElement("span")
    prioBadge.className = "priority-badge"
    prioBadge.textContent = index + 1
    prioBadge.title = "Priority order, channels higher in the list win when emote names collide"
    top.appendChild(prioBadge)
    top.appendChild(makeMoveControls(index, total, direction => moveChannel(channel.channelId, direction)))

    const name = document.createElement("span")
    name.className = "card-name"
    if (alwayMain) name.appendChild(makeIcon("star"))
    const nameText = document.createElement("span")
    nameText.className = "card-name-text"
    nameText.textContent = channel.channelName
    nameText.title = channel.channelName
    name.appendChild(nameText)
    top.appendChild(name)

    const removeBtn = document.createElement("button")
    removeBtn.className = "card-icon-btn"
    removeBtn.appendChild(makeIcon("remove"))
    removeBtn.title = "Remove this channel and all of its sets"
    removeBtn.addEventListener("click", () => {
        draft.customSets = draft.customSets.filter(s => s.channelId !== channel.channelId)
        delete draft.channelSettings[channel.channelId]
        renderHome()
        updateSaveBar()
    })
    top.appendChild(removeBtn)
    card.appendChild(top)

    const sub = document.createElement("div")
    sub.className = "card-sub"
    sub.textContent = alwayMain
        ? `Always following the channel's current main set · ${sumEmotes(channel.sets)}`
        : `${enabledSet.length}/${channel.sets.length} active sets · ${sumEmotes(channel.sets)} emotes`
    card.appendChild(sub)

    const previewEmote = dedupePreview(enabledSet.flatMap(s => s.preview || []))
    if (previewEmote.length) {
        const strip = document.createElement("div")
        strip.className = "preview-strip"
        previewEmote.slice(0, 20).forEach(e => {
            const img = document.createElement("img")
            img.src = e.url
            img.alt = e.name
            img.title = e.name
            img.loading = "lazy"
            strip.appendChild(img)
        })
        card.appendChild(strip)
    }

    const bottom = document.createElement("div")
    bottom.className = "card-bottom"

    const status = document.createElement("span")
    status.className = "card-status " + (channelOn ? "on" : "off")
    status.textContent = channelOn ? "Enabled" : "Disabled"
    bottom.appendChild(status)

    const action = document.createElement("div")
    action.className = "card-actions"

    const quickToggle = makeSwitch(channelOn, { title: channelOn ? "Disable all sets for this channel" : "Re-enable this channel's previous sets" })
    quickToggle.addEventListener("click", () => {
        const pref = draft.channelSettings[channel.channelId] || {}

        if (channelOn) {
            draft.channelSettings[channel.channelId] = {
                ...pref,
                lastEnabledSetIds: channel.sets.filter(s => s.enabled !== false).map(s => s.id)
            }
            channel.sets.forEach(s => { s.enabled = false })
        } else {
            const remembered = pref.lastEnabledSetIds
            if (remembered && remembered.length) channel.sets.forEach(s => { s.enabled = remembered.includes(s.id) })
            else channel.sets.forEach(s => { s.enabled = true })
            const { lastEnabledSetIds: _remembered, ...cleanPref } = pref
            if (Object.keys(cleanPref).length)
                draft.channelSettings[channel.channelId] = cleanPref
            else delete draft.channelSettings[channel.channelId]
        }

        renderHome()
        updateSaveBar()
    })
    action.appendChild(quickToggle)

    const manageBtn = document.createElement("button")
    manageBtn.className = "btn-secondary"
    manageBtn.textContent = "Manage"
    manageBtn.addEventListener("click", () => openManageView(channel.channelId))
    action.appendChild(manageBtn)

    bottom.appendChild(action)
    card.appendChild(bottom)

    return card
}

channelCardsEl.addEventListener("dragover", (e) => {
    const drag = channelCardsEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterEl = getDragEl(channelCardsEl, e.clientY)
    if (afterEl == null) channelCardsEl.appendChild(drag)
    else channelCardsEl.insertBefore(drag, afterEl)
})

function getDragEl(container, y) {
    const cards = [...container.querySelectorAll(".card-draggable:not(.dragging)")]
    return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) return { offset, element: child }

        return closest
    }, { offset: Number.NEGATIVE_INFINITY }).element
}

function commitChannelOrderDOM() {
    const visualId = [...channelCardsEl.querySelectorAll(".card-draggable")].map(el => el.dataset.channelId)
    if (!visualId.length) return

    const channelId = new Map(groupByChannel(draft.customSets).map(c => [c.channelId, c]))
    draft.customSets = visualId
        .slice()
        .reverse()
        .flatMap(id => (channelId.get(id) || { sets: [] }).sets)

    renderHome()
    updateSaveBar()
}

function makeMoveControls(index, total, move) {
    const controls = document.createElement("span")
    controls.className = "move-controls"
    for (const [label, direction, disabled] of [
        ["↑", -1, index === 0],
        ["↓", 1, index === total - 1]
    ]) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "btn-secondary move-btn"
        btn.textContent = label
        btn.title = direction < 0 ? "Move up" : "Move down"
        btn.setAttribute("aria-label", btn.title)
        btn.disabled = disabled
        btn.addEventListener("click", () => move(direction))
        controls.appendChild(btn)
    }
    return controls
}

function moveChannel(channelId, direction) {
    const visual = groupByChannel(draft.customSets).reverse()
    const from = visual.findIndex(c => c.channelId === channelId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= visual.length) return
    ;[visual[from], visual[to]] = [visual[to], visual[from]]
    draft.customSets = visual.slice().reverse().flatMap(channel => channel.sets)
    renderHome()
    updateSaveBar()
}

function dedupePreview(previews) {
    const seen = new Set()
    const out = []
    for (const p of previews) {
        if (!p || !p.url || seen.has(p.name)) continue
        seen.add(p.name)
        out.push(p)
    }
    return out
}

