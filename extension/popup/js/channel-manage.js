const openManageView = (id) => {
    currentChannelId = id
    viewHome.hidden = true
    viewManage.hidden = false
    renderManageView()
}

const closeManageView = () => {
    currentChannelId = null
    viewManage.hidden = true
    viewHome.hidden = false
    renderHome()
}

backBtn.addEventListener("click", closeManageView)

function showConfirm({ title, body, actionLabel, danger = false, onAction }) {
    confirmTitle.textContent = title
    confirmBody.textContent = body
    confirmActionBtn.textContent = actionLabel
    confirmActionBtn.className = `${danger ? "btn-danger" : "btn-primary"} btn-full`
    confirmAction = onAction
    confirmOverlay.hidden = false
    confirmCancelBtn.focus()
}

function closeConfirm() {
    confirmOverlay.hidden = true
    confirmAction = null
}

confirmCancelBtn.addEventListener("click", closeConfirm)
confirmOverlay.addEventListener("click", event => {
    if (event.target === confirmOverlay) closeConfirm()
})
confirmActionBtn.addEventListener("click", async () => {
    const action = confirmAction
    closeConfirm()
    if (action) await action()
})

const asChannelSet = () => draft.customSets.filter(s => s.channelId === currentChannelId)
function renderManageView() {
    const set = asChannelSet().slice().reverse()
    if (!set.length) return closeManageView()

    const name = set[0].channelName
    const enabled = set.filter(s => s.enabled !== false)
    const pref = draft.channelSettings[currentChannelId] || {}

    manageChannelTitle.textContent = name
    manageChannelSummary.textContent = `${enabled.length}/${set.length} active sets ~${sumEmotes(set)} emotes`
    manageChannelStatus.textContent = ""
    alwaysMainToggle.checked = !!pref.alwaysMain

    manageOverlapWarning.hidden = pref.alwaysMain || enabled.length <= 1
    if (!manageOverlapWarning.hidden)
        manageOverlapWarning.textContent = "More than one set is enabled here, so emotes sharing a name may override each other..."

    const activeSet = pref.knownActiveSetId && set.find(s => s.id === pref.knownActiveSetId)
    if (activeSet) {
        alwaysMainActive.hidden = false
        alwaysMainActive.textContent = pref.alwaysMain
            ? `Following ${name}'s current main set: "${activeSet.setName}"`
            : `${name}'s current main set on 7TV is "${activeSet.setName}"`
    } else alwaysMainActive.hidden = true

    manageSetListEl.replaceChildren()
    set.forEach((set, index) => manageSetListEl.appendChild(renderSetCard(set, pref, index, set.length)))
}

function renderSetCard(set, pref, index, total) {
    const willActive = pref.knownActiveSetId && set.id === pref.knownActiveSetId
    const locked = !!pref.alwaysMain

    const card = document.createElement("div")
    card.className = "card card-draggable" + (willActive ? " is-main-set" : "")
    card.draggable = true
    card.dataset.setId = set.id

    card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", set.id)
    })
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging")
        commitSetOrderDOM()
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
    prioBadge.title = "Priority order, sets higher in the list win when emote names collide"
    top.appendChild(prioBadge)
    top.appendChild(makeMoveControls(index, total, direction => moveSet(set.id, direction)))

    const name = document.createElement("span")
    name.className = "card-name"
    if (willActive) name.appendChild(makeIcon("star"))
    const nameText = document.createElement("span")
    nameText.className = "card-name-text"
    nameText.textContent = set.setName
    nameText.title = set.setName
    name.appendChild(nameText)
    top.appendChild(name)

    const removeBtn = document.createElement("button")
    removeBtn.className = "card-icon-btn"
    removeBtn.appendChild(makeIcon("remove"))
    removeBtn.title = "Remove this set"
    removeBtn.addEventListener("click", () => {
        draft.customSets = draft.customSets.filter(s => s !== set)
        renderManageView()
        updateSaveBar()
    })
    top.appendChild(removeBtn)
    card.appendChild(top)

    const sub = document.createElement("div")
    sub.className = "card-sub"
    sub.textContent = willActive
        ? `${set.count ?? "?"} emotes · currently active on the channel`
        : `${set.count ?? "?"} emotes`
    card.appendChild(sub)

    if (set.preview && set.preview.length) {
        const strip = document.createElement("div")
        strip.className = "preview-strip"
        set.preview.slice(0, 8).forEach(e => {
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

    const on = set.enabled !== false
    const status = document.createElement("span")
    status.className = "card-status " + (on ? "on" : "off")
    status.textContent = locked ? (on ? "Enabled (following main)" : "Disabled") : (on ? "Enabled" : "Disabled")
    bottom.appendChild(status)

    const toggle = makeSwitch(on, {
        disabled: locked,
        title: locked ? 'Turn off "Always use main channel emote set" to control sets individually' : ''
    })

    if (!locked) toggle.addEventListener("click", () => {
        set.enabled = !on
        renderManageView()
        updateSaveBar()
    })
    bottom.appendChild(toggle)
    card.appendChild(bottom)

    return card
}

manageSetListEl.addEventListener("dragover", (e) => {
    const drag = manageSetListEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterElement = getDragEl(manageSetListEl, e.clientY)
    if (afterElement == null) manageSetListEl.appendChild(drag)
    else manageSetListEl.insertBefore(drag, afterElement)
})

function commitSetOrderDOM() {
    const visual = [...manageSetListEl.querySelectorAll(".card-draggable")].map(el => el.dataset.setId)
    if (!visual.length) return

    const byId = new Map(draft.customSets.filter(s => s.channelId === currentChannelId).map(s => [s.id, s]))
    const orderChannel = visual.slice().reverse().map(id => byId.get(id)).filter(Boolean)

    let i = 0
    draft.customSets = draft.customSets.map(s => s.channelId === currentChannelId ? orderChannel[i++] : s)

    renderManageView()
    updateSaveBar()
}

function moveSet(setId, direction) {
    const visual = asChannelSet().slice().reverse()
    const from = visual.findIndex(set => set.id === setId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= visual.length) return
    ;[visual[from], visual[to]] = [visual[to], visual[from]]
    const reordered = visual.slice().reverse()
    let index = 0
    draft.customSets = draft.customSets.map(set =>
        set.channelId === currentChannelId ? reordered[index++] : set
    )
    renderManageView()
    updateSaveBar()
}

alwaysMainToggle.addEventListener("change", () => {
    const sets = asChannelSet()
    if (!sets.length) return

    const pref = draft.channelSettings[currentChannelId] || {}
    if (alwaysMainToggle.checked) {
        const mainId = pref.knownActiveSetId || sets[0].id
        sets.forEach(s => { s.enabled = s.id === mainId })
        draft.channelSettings[currentChannelId] = { ...pref, alwaysMain: true }
    } else draft.channelSettings[currentChannelId] = { ...pref, alwaysMain: false }

    renderManageView()
    updateSaveBar()
})

refreshMainNowBtn.addEventListener("click", async () => {
    refreshMainNowBtn.disabled = true
    const originalContent = clone(refreshMainNowBtn)
    refreshMainNowBtn.textContent = "Refreshing..."
    const result = await ext.runtime.sendMessage({ type: "REFRESH_CHANNEL", channelId: currentChannelId })
    refreshMainNowBtn.replaceChildren(...originalContent)
    refreshMainNowBtn.disabled = false

    if (!result || result.error || result.type !== "channel")
        return manageChannelStatus.textContent = errorText(result && result.error, "Couldn't refresh this channel")

    applyActiveSetInfo(result)
    manageChannelStatus.textContent = "Refreshed!"
    renderManageView()
    updateSaveBar()
})

function applyActiveSetInfo(result) {
    const pref = draft.channelSettings[currentChannelId] || {}
    const activeSet = result.sets.find(s => s.id === result.activeSetId)
    let sets = asChannelSet()

    if (activeSet && !sets.some(s => s.id === activeSet.id)) {
        draft.customSets.push({
            id: activeSet.id,
            setName: activeSet.name,
            count: activeSet.count,
            preview: activeSet.preview || [],
            channelId: result.channel.id,
            channelName: result.channel.name,
            enabled: !!pref.alwaysMain
        })
        sets = asChannelSet()
    }

    if (pref.alwaysMain && result.activeSetId) sets.forEach(s => { s.enabled = s.id === result.activeSetId })
    draft.channelSettings[currentChannelId] = {
        ...pref,
        knownActiveSetId: result.activeSetId,
        mainRefreshedAt: Date.now()
    }
}

hardReloadChannelBtn.addEventListener("click", async () => {
    hardReloadChannelBtn.classList.add("spinning")
    hardReloadChannelBtn.disabled = true

    const result = await ext.runtime.sendMessage({ type: "REFRESH_CHANNEL", channelId: currentChannelId })
    hardReloadChannelBtn.classList.remove("spinning")
    hardReloadChannelBtn.disabled = false

    if (!result || result.error || result.type !== "channel")
        return manageChannelStatus.textContent = errorText(result && result.error, "Couldn't reach 7TV")

    const byId = new Map(result.sets.map(s => [s.id, s]))
    let changedCount = 0
    draft.customSets.forEach(s => {
        if (s.channelId !== currentChannelId) return
        const fresh = byId.get(s.id)
        if (!fresh) return
        s.setName = fresh.name
        s.count = fresh.count
        s.preview = fresh.preview || []
        changedCount++
    })

    applyActiveSetInfo(result)
    manageChannelStatus.textContent = `Reloaded from 7TV, ${changedCount} set${changedCount === 1 ? "" : "s"} refreshed!`
    renderManageView()
    updateSaveBar()
})
