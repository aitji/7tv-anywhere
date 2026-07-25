function renderExcluded() {
    syncDraftGlobals()
    excludedListEl.replaceChildren()
    excludedEmptyEl.style.display = excludedEmote.length ? "none" : "block"
    excludedEmote.forEach(name => {
        const emote = emoteByName.get(name)

        const row = document.createElement("div")
        row.className = "card excluded-row card-draggable"
        row.draggable = true
        row.dataset.emoteName = name

        row.addEventListener("dragstart", (e) => {
            row.classList.add("dragging")
            e.dataTransfer.effectAllowed = "move"
            e.dataTransfer.setData("text/plain", name)
        })
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging")
            commitExcludDOM()
        })

        const dragHandle = document.createElement("span")
        dragHandle.className = "drag-handle"
        dragHandle.appendChild(makeIcon("drag"))
        dragHandle.title = "Drag to reorder"
        row.appendChild(dragHandle)

        if (emote) {
            const img = document.createElement("img")
            img.className = "excluded-thumb"
            img.src = emote.url
            img.alt = name
            row.appendChild(img)
        } else {
            const placeholder = document.createElement("div")
            placeholder.className = "excluded-thumb no-thumb"
            placeholder.textContent = "?"
            placeholder.title = "Not found in your currently loaded emotes"
            row.appendChild(placeholder)
        }

        const label = document.createElement("span")
        label.className = "card-name"
        const labelText = document.createElement("span")
        labelText.className = "card-name-text"
        labelText.textContent = name
        labelText.title = name
        label.appendChild(labelText)
        row.appendChild(label)

        const removeBtn = document.createElement("button")
        removeBtn.className = "card-icon-btn"
        removeBtn.appendChild(makeIcon("remove"))
        removeBtn.title = "Remove from excluded list"
        removeBtn.addEventListener("click", () => removeExcluded(name))
        row.appendChild(removeBtn)

        excludedListEl.appendChild(row)
    })
}

excludedListEl.addEventListener("dragover", (e) => {
    const drag = excludedListEl.querySelector(".dragging")
    if (!drag) return
    e.preventDefault()

    const afterEl = getDragEl(excludedListEl, e.clientY)
    if (afterEl == null) excludedListEl.appendChild(drag)
    else excludedListEl.insertBefore(drag, afterEl)
})

async function commitExcludDOM() {
    const visual = [...excludedListEl.querySelectorAll(".card-draggable")].map(el => el.dataset.emoteName)
    if (!visual.length) return
    draft.excludedEmote = visual
    renderNotice()
    updateSaveBar()
}

async function removeExcluded(name) {
    draft.excludedEmote = (draft.excludedEmote || []).filter(n => n !== name)
    renderExcluded()
    renderNotice()
    updateSaveBar()
}

async function addExcludedName(name, keepSearch = false) {
    excludeHint.textContent = ""
    excludeHint.classList.remove("error")

    if (!name) return
    const isDuplicate = excludedEmote.some(item =>
        caseSensitive ? item === name : String(item).toLowerCase() === String(name).toLowerCase()
    )
    if (isDuplicate) {
        excludeHint.textContent = "Already excluded..."
        excludeHint.classList.add("error")
        return
    }

    draft.excludedEmote = [...(draft.excludedEmote || []), name]
    if (!keepSearch) {
        excludeInput.value = ""
        excludeSearchResultsEl.replaceChildren()
    } else {
        const query = excludeInput.value.trim()
        if (query) runExSearch(query)
    }

    renderExcluded()
    renderNotice()
    updateSaveBar()

    if (!emoteByName.has(name))
        excludeHint.textContent = `Added "${name}" to your draft! It wasn't found in your loaded emotes, double-check its spelling and letter case...`
    else excludeHint.textContent = `Added "${name}" to your draft!`
}

excludeInput.addEventListener("input", () => {
    clearTimeout(excludeSearchTimer)
    const query = excludeInput.value.trim()
    if (!query) return excludeSearchResultsEl.replaceChildren()

    excludeSearchTimer = setTimeout(() => runExSearch(query), 100)
})

async function runExSearch(query) {
    const res = await ext.runtime.sendMessage({ type: "GET_SUGGESTIONS", query })
    const isExcluded = name => excludedEmote.some(item =>
        caseSensitive ? item === name : String(item).toLowerCase() === String(name).toLowerCase()
    )
    const sugg = ((res && res.suggestions) || []).filter(emote => !isExcluded(emote.name))

    excludeSearchResultsEl.replaceChildren()
    sugg.slice(0, 8).forEach(emote => {
        const row = document.createElement("div")
        row.className = "search-result"

        const img = document.createElement("img")
        img.src = emote.url
        img.alt = emote.name
        row.appendChild(img)

        const name = document.createElement("span")
        name.className = "search-result-name"
        name.textContent = emote.name
        name.title = emote.name
        row.appendChild(name)

        row.addEventListener("click", (e) => addExcludedName(emote.name, e.shiftKey))
        excludeSearchResultsEl.appendChild(row)
    })
}

excludeAddBtn.addEventListener("click", (e) => addExcludedName(excludeInput.value.trim(), e.shiftKey))
excludeInput.addEventListener("keydown", e => (e.key === "Enter") && addExcludedName(excludeInput.value.trim(), e.shiftKey))
