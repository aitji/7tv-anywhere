const SETTINGS_HELP = Object.freeze({
    rendering: {
        title: "Page scanning and size",
        body: "Scanning changes where 7TV Anywhere looks for text. It does not change which emotes are loaded",
        example: [
            ["Light", "Prioritizes new chat and page text. Best for slower phones"],
            ["Balanced", "Scans the current page and common open components"],
            ["Full", "Checks more complex page content with higher CPU use"]
        ]
    },
    matching: {
        title: "Name matching",
        body: "These options decide which emote wins when typed text can match more than one loaded emote",
        example: [
            ["Exact case off", "letsgo may render LETSGO"],
            ["Channel order", "The higher channel or set in your Emotes list wins"],
            ["Closest case", "clap prefers Clap before channel order breaks a tie"]
        ]
    },
    overlays: {
        title: "Overlay behavior",
        body: "7TV marks some emotes as zero-width overlays. Consecutive normal emotes also connect without their typed spaces",
        example: [
            ["Stack on", "BASE OVERLAY becomes one layered emote"],
            ["Stack off", "BASE and OVERLAY render beside each other"],
            ["Text overlay on", "everyone WIDEALERT may visually cover the end of everyone"],
            ["Text overlay off", "WIDEALERT keeps normal emote width beside the text"]
        ]
    },
    hover: {
        title: "Hover details",
        body: "Choose the custom solid card or the browser's small tooltip. Both use the same text template, including line breaks",
        example: [
            ["Template", "{original} ({emote}@{channel})"],
            ["Example", ":HUGGIES: (HUGGIES@vedal987)"],
            ["Delay", "0 ms is immediate. A longer delay avoids accidental popups"]
        ]
    },
    guidance: {
        title: "Maintainer guidance",
        body: "This downloads the small compatibility-rules file maintained with 7TV Anywhere. Turning it off removes site notes and automatic unsupported-site recommendations",
        example: [
            ["Off", "No compatibility-rules request runs in the background"],
            ["Online", "7TV emote downloads and optional extension update checks are separate"]
        ]
    }
})

const normalizeSettingText = value => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9{}@]+/g, " ")
    .trim()

function fuzzySettingMatch(value, query) {
    const text = normalizeSettingText(value)
    const word = text.split(/\s+/)
    return normalizeSettingText(query).split(/\s+/).filter(Boolean).every(term => {
        if (text.includes(term)) return true
        if (term.length < 3) return false
        return word.some(item => {
            if (!item.includes(term[0]) || item.length > term.length * 3) return false
            let index = 0
            for (let i = 0; i < item.length && index < term.length; i++)
                if (item[i] === term[index]) index++
            return index === term.length
        })
    })
}

function renderSettingsView() {
    const query = settingsSearchInput.value.trim()
    let found = 0
    settingsCardEl.forEach(card => {
        const value = `${card.dataset.search || ""} ${card.textContent}`
        const visible = !query || fuzzySettingMatch(value, query)
        card.hidden = !visible
        if (visible) found++
    })
    settingsGroupEl.forEach(group => {
        const hasMatch = !!group.querySelector("[data-setting-card]:not([hidden])")
        group.hidden = query ? !hasMatch : group.dataset.settingsPanel !== settingsGroup
    })
    settingsCategoryBtns.forEach(btn => {
        const active = btn.dataset.settingsGroup === settingsGroup
        btn.classList.toggle("is-active", active)
        btn.setAttribute("aria-selected", active ? "true" : "false")
    })
    settingsEmptyEl.hidden = found > 0
    settingsSearchSummaryEl.textContent = query
        ? `${found} matching group${found === 1 ? "" : "s"}`
        : ""
}

let lastSettingsHelpBtn = null
function openSettingsHelp(key, button) {
    const help = SETTINGS_HELP[key]
    if (!help) return
    lastSettingsHelpBtn = button
    settingsHelpTitleEl.textContent = help.title
    settingsHelpBodyEl.textContent = help.body
    settingsHelpExamplesEl.replaceChildren(...help.example.map(([label, value]) => {
        const row = document.createElement("div")
        const strong = document.createElement("strong")
        const span = document.createElement("span")
        strong.textContent = label
        span.textContent = value
        row.append(strong, span)
        return row
    }))
    settingsHelpOverlay.hidden = false
    settingsHelpCloseBtn.focus()
}

function closeSettingsHelp() {
    if (settingsHelpOverlay.hidden) return
    settingsHelpOverlay.hidden = true
    lastSettingsHelpBtn?.focus()
    lastSettingsHelpBtn = null
}

settingsSearchInput.addEventListener("input", renderSettingsView)
settingsCategoryBtns.forEach(btn => btn.addEventListener("click", () => {
    settingsGroup = btn.dataset.settingsGroup
    settingsSearchInput.value = ""
    renderSettingsView()
}))
settingsHelpBtns.forEach(btn => btn.addEventListener("click", () => {
    openSettingsHelp(btn.dataset.settingsHelp, btn)
}))
settingsHelpCloseBtn.addEventListener("click", closeSettingsHelp)
settingsHelpXBtn.addEventListener("click", closeSettingsHelp)
settingsHelpOverlay.addEventListener("pointerdown", event => {
    if (event.target === settingsHelpOverlay) closeSettingsHelp()
})
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSettingsHelp()
})
renderSettingsView()
