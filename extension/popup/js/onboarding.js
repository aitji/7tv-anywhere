const ONBOARDING_TOTAL = 4
const ONBOARDING_SESSION_KEY = "onboardingSession"
const HUGGIES_URL = "https://cdn.7tv.app/emote/01HF2N16Q00000CPH0355B4WE1/2x.webp"
const onboardingQuery = new URL(location.href).searchParams
const onboardingPageMode = onboardingQuery.get("onboarding") === "1"
const onboardingUrl = ext.runtime.getURL("popup/popup.html?onboarding=1")
let onboardingPermissionSource = "onboarding"
let onboardingPermissionResumeResult = null
let onboardingIndex = 0
let onboardingPrefs = null
if (onboardingPageMode) document.body.classList.add("onboarding-tab")
const onboardingElement = (tag, className = "", text = "") => {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text) element.textContent = text
    return element
}
function onboardingImage(className = "", source = "loaded") {
    const image = document.createElement("img")
    image.className = className
    image.referrerPolicy = "no-referrer"
    image.alt = "Sample emote"
    image.src = source === "huggies"
        ? HUGGIES_URL
        : loadedEmoteList.find(item => item && item.url)?.url || ext.runtime.getURL("icons/icon.svg")
    return image
}
function onboardingCursor() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.classList.add("onboarding-cursor"); svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-label", "Mouse pointer showing this is a hover preview")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M4 2.7v15.8l4-3.6 2.8 6.1 3-1.4-2.8-6.1h5.4L4 2.7Z")
    path.setAttribute("fill", "#fff"); path.setAttribute("stroke", "#171923"); path.setAttribute("stroke-width", "1.3")
    svg.appendChild(path)
    return svg
}
function onboardingIsMobile() {
    return /Android|Mobile/i.test(navigator.userAgent)
        || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)
}
function persistOnboardingSession(active = true) {
    if (!onboardingPrefs) return Promise.resolve()
    return ext.storage.local.set({
        [ONBOARDING_SESSION_KEY]: {
            active,
            index: onboardingIndex,
            prefs: cloneState(onboardingPrefs),
            updatedAt: Date.now()
        }
    })
}
const onboardingIntro = text => onboardingElement("p", "onboarding-copy", text)
const onboardingFields = () => onboardingElement("div", "onboarding-fields")
function onboardingField(labelText) {
    const field = onboardingElement("div", "onboarding-field")
    field.appendChild(onboardingElement("strong", "", labelText))
    return field
}
function onboardingCheckbox(label, key, rerender = false) {
    const field = onboardingElement("label", "onboarding-field onboarding-field-action")
    field.appendChild(onboardingElement("strong", "", label))
    const row = onboardingElement("span", "check-row")
    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = onboardingPrefs[key] === true
    const copy = onboardingElement("span", "", input.checked ? "On" : "Off")
    input.addEventListener("change", () => {
        onboardingPrefs[key] = input.checked
        copy.textContent = input.checked ? "On" : "Off"
        persistOnboardingSession().catch(() => { })
        if (rerender) refreshAppearancePreview()
    })
    row.append(input, copy)
    field.appendChild(row)
    return field
}
function onboardingSelect(label, key, options, rerender = false) {
    const field = onboardingField(label)
    const select = document.createElement("select")
    for (const [value, text] of options) {
        const option = document.createElement("option")
        option.value = value
        option.textContent = text
        select.appendChild(option)
    }
    select.value = String(onboardingPrefs[key])
    select.addEventListener("change", () => {
        onboardingPrefs[key] = select.value
        persistOnboardingSession().catch(() => { })
        if (rerender) refreshAppearancePreview()
    })
    field.appendChild(select)
    return field
}
function onboardingRange(label, key, min, max, step, suffix, rerender = false) {
    const field = onboardingField(label)
    const value = onboardingElement("span", "hint", `${onboardingPrefs[key]}${suffix}`)
    const input = document.createElement("input")
    input.type = "range"
    input.min = min
    input.max = max
    input.step = step
    input.value = onboardingPrefs[key]
    input.addEventListener("input", () => {
        onboardingPrefs[key] = Number(input.value)
        value.textContent = `${input.value}${suffix}`
        persistOnboardingSession().catch(() => { })
        if (rerender) refreshAppearancePreview()
    })
    field.append(input, value)
    return field
}
function pickerPreview() {
    const preview = onboardingElement("div", `onboarding-picker-preview${onboardingPrefs.pickerLayout === "sidebar" ? " sidebar" : ""}`)
    preview.appendChild(onboardingElement("div", "onboarding-picker-search", "Search emotes or channels"))
    const nav = onboardingElement("div", "onboarding-picker-nav")
    const channelMap = new Map()
    for (const emote of loadedEmoteList) {
        const id = String(emote.channelId || "global")
        if (id === "global" || channelMap.has(id)) continue
        channelMap.set(id, {
            name: emote.channelName || id,
            avatarUrl: emote.channelAvatarUrl || ""
        })
    }
    const categories = [
        { name: "Favorites", short: "★" },
        { name: "Frequent", short: "↻" },
        { name: "Global", short: "G", avatarUrl: ext.runtime.getURL("icons/icon.svg") },
        ...Array.from(channelMap.values()).slice(0, 3).map(channel => ({
            ...channel,
            short: channel.name.slice(0, 2).toUpperCase()
        }))
    ]
    while (categories.length < 6)
        categories.push({ name: `Channel ${categories.length - 2}`, short: `C${categories.length - 2}` })
    for (const category of categories) {
        const item = onboardingElement("span")
        item.title = category.name
        if (category.avatarUrl) {
            const image = document.createElement("img")
            image.referrerPolicy = "no-referrer"
            image.src = category.avatarUrl
            image.alt = ""
            item.appendChild(image)
        } else item.appendChild(onboardingElement("i", "", category.short))
        if (onboardingPrefs.pickerLayout === "tabs")
            item.appendChild(document.createTextNode(category.name))
        nav.appendChild(item)
    }
    const body = onboardingElement("div", "onboarding-picker-body")
    body.appendChild(onboardingElement("strong", "", "Favorites"))
    const grid = onboardingElement("div", "onboarding-picker-grid")
    for (let i = 0; i < 8; i++) grid.appendChild(onboardingElement("span"))
    body.appendChild(grid)
    preview.append(nav, body)
    return preview
}
function renderPickerOnboarding(container) {
    container.appendChild(onboardingIntro(
        "The magnifying-glass button opens beside a focused text field. Search, favorite, and recent-use data stay on this device."
    ))
    const fields = onboardingFields()
    fields.appendChild(onboardingCheckbox("Show the in-page picker", "pickerEnabled"))
    const choices = onboardingElement("div", "onboarding-choice-grid")
    for (const [value, title, description] of [
        ["tabs", "Horizontal tabs", "Categories run across the top"],
        ["sidebar", "Vertical sidebar", "Compact shortcuts run down the left"]
    ]) {
        const button = onboardingElement("button", `onboarding-choice${onboardingPrefs.pickerLayout === value ? " is-selected" : ""}`)
        button.type = "button"
        button.append(onboardingElement("strong", "", title), onboardingElement("span", "", description))
        button.addEventListener("click", () => {
            onboardingPrefs.pickerLayout = value
            persistOnboardingSession().catch(() => { })
            choices.querySelectorAll(".onboarding-choice").forEach(choice =>
                choice.classList.toggle("is-selected", choice === button))
            preview.replaceChildren(pickerPreview())
        })
        choices.appendChild(button)
    }
    fields.append(choices)
    const preview = onboardingElement("div", "onboarding-preview")
    preview.classList.add("onboarding-live-preview")
    preview.appendChild(pickerPreview())
    fields.appendChild(preview)
    container.appendChild(fields)
}
function renderingPreview() {
    const preview = onboardingElement("div", "onboarding-preview")
    const line = onboardingElement("div", "onboarding-emote-line")
    line.appendChild(document.createTextNode("hello "))
    const stack = onboardingElement("span", "onboarding-emote-stack")
    stack.style.setProperty("--preview-size", `${onboardingPrefs.emoteSize <= 1 ? 20 : 20 + onboardingPrefs.emoteSize * 7}px`)
    stack.appendChild(onboardingImage())
    if (onboardingPrefs.zeroWidthEmote) stack.appendChild(onboardingImage())
    line.append(stack, document.createTextNode(" world"))
    preview.appendChild(line)
    preview.appendChild(onboardingElement("span", "hint", `${onboardingPrefs.emoteSize}x emotes${onboardingPrefs.zeroWidthEmote ? " · overlays enabled" : ""}`))
    return preview
}
function hoverPreview() {
    const preview = onboardingElement("div", "onboarding-preview")
    const sampleText = formatHoverSample(onboardingPrefs.emoteHoverTemplate)
    if (onboardingPrefs.emoteHoverStyle === "title") {
        const sample = onboardingElement("div", "onboarding-emote-line")
        const image = onboardingImage("", "huggies")
        image.title = sampleText
        sample.append(image, onboardingElement("span", "", `Native browser title: ${sampleText}`))
        preview.appendChild(sample)
        return preview
    }
    const stage = onboardingElement("div", "onboarding-hover-stage")
    const card = onboardingElement("div", "onboarding-hover-preview")
    card.append(
        onboardingElement("div", "", sampleText),
        onboardingImage("", "huggies")
    )
    if (onboardingPrefs.emoteHoverLayout === "left") card.lastElementChild.style.order = "-1"
    stage.append(card, onboardingCursor())
    preview.append(
        onboardingElement("span", "onboarding-preview-label", "Hover preview"),
        stage
    )
    return preview
}
function refreshAppearancePreview() {
    const current = onboardingContentEl.querySelector(".onboarding-live-preview")
    if (!current) return
    const next = onboardingElement("div", "onboarding-live-stack onboarding-live-preview")
    next.append(renderingPreview(), hoverPreview())
    current.replaceWith(next)
}
function renderAppearanceOnboarding(container) {
    container.appendChild(onboardingIntro("Choose the basics now. Detailed matching and performance controls stay in Settings."))
    const fields = onboardingFields()
    const live = onboardingElement("div", "onboarding-live-stack onboarding-live-preview")
    live.append(renderingPreview(), hoverPreview())
    fields.append(
        onboardingRange("Emote size", "emoteSize", 1, 4, 1, "x", true),
        onboardingCheckbox("Stack overlay emotes", "zeroWidthEmote", true),
        onboardingSelect("Hover display", "emoteHoverStyle", [
            ["card", "7TV-style card"], ["title", "Browser tooltip"]
        ], true),
        live
    )
    if (onboardingIsMobile()) fields.prepend(onboardingElement(
        "div", "onboarding-info-note",
        "Touch screens usually cannot hover. Browser tooltip is selected by default, but mouse users can still choose the full card."
    ))
    container.appendChild(fields)
}
function renderPrivacyOnboarding(container) {
    container.appendChild(onboardingIntro("Three useful privacy facts, then you are ready."))
    const fields = onboardingFields()
    const facts = onboardingElement("div", "onboarding-facts")
    for (const [icon, title, detail] of [
        ["⌂", "Page text stays local", "Messages and editor text are not uploaded."],
        ["7", "Images come from emote CDNs", "7TV and Twitch image requests omit the referring page URL."],
        ["✓", "No analytics", "7TV Anywhere has no advertising or tracking."]
    ]) {
        const fact = onboardingElement("div", "onboarding-fact")
        fact.append(onboardingElement("i", "", icon), onboardingElement("strong", "", title), onboardingElement("span", "", detail))
        facts.appendChild(fact)
    }
    fields.append(onboardingCheckbox("Use maintainer website compatibility guidance", "maintainerGuidance"), facts)
    const summary = onboardingElement("div", "onboarding-preview")
    summary.append(
        onboardingElement("strong", "", "Ready to apply your preferences"),
        onboardingIntro("Your browser handles extension updates automatically. Channels, favorites, and website choices remain on this device.")
    )
    fields.appendChild(summary)
    container.appendChild(fields)
}
function renderOnboarding(resetScroll = false) {
    const previousScroll = resetScroll ? 0 : onboardingContentEl.scrollTop
    const titles = ["Website access", "In-page picker", "Emotes and hover", "Privacy and finish"]
    onboardingTitleEl.textContent = titles[onboardingIndex]
    onboardingStepEl.textContent = `Step ${onboardingIndex + 1} of ${ONBOARDING_TOTAL}`
    onboardingProgressEl.style.setProperty("--onboarding-progress", `${((onboardingIndex + 1) / ONBOARDING_TOTAL) * 100}%`), onboardingOverlay.querySelectorAll(".onboarding-dots i").forEach((dot, i) => dot.classList.toggle("is-active", i === onboardingIndex))
    onboardingContentEl.replaceChildren()
        ;[
            renderAccessOnboarding,
            renderPickerOnboarding,
            renderAppearanceOnboarding,
            renderPrivacyOnboarding
        ][onboardingIndex](onboardingContentEl)
    onboardingBackBtn.disabled = onboardingIndex === 0
    const accessChosen = onboardingPrefs.siteAccessChoice === "all" || onboardingPrefs.siteAccessChoice === "per-site"
    onboardingNextBtn.disabled = onboardingIndex === 0 && !accessChosen
    onboardingNextBtn.textContent = onboardingIndex === ONBOARDING_TOTAL - 1
        ? "Apply preferences"
        : onboardingIndex === 0 && !accessChosen ? "Choose access to continue" : "Continue"
    requestAnimationFrame(() => { onboardingContentEl.scrollTop = previousScroll })
    persistOnboardingSession().catch(() => { })
}
async function openOnboarding({ resume = true } = {}) {
    const state = await ext.storage.local.get(["onboardingComplete", ONBOARDING_SESSION_KEY])
    const session = resume && state[ONBOARDING_SESSION_KEY]?.active
        ? state[ONBOARDING_SESSION_KEY]
        : null
    const allSitesGranted = await hasAllSitesPermission()
    const basePrefs = {
        siteAccessDefault: allSitesGranted,
        siteAccessChoice: allSitesGranted ? "all" : state.onboardingComplete ? "per-site" : null,
        siteAccessDenied: false,
        pickerEnabled,
        pickerLayout,
        renderMode: cleanRenderMode(draft.renderMode),
        emoteSize: cleanEmoteSize(draft.emoteSize),
        zeroWidthEmote: draft.zeroWidthEmote !== false,
        zeroWidthText: draft.zeroWidthText === true,
        caseSensitive: draft.caseSensitive === true,
        matchPriority: cleanMatchPriority(draft.matchPriority),
        emoteHoverStyle: !state.onboardingComplete && !session && onboardingIsMobile()
            ? "title"
            : cleanHoverStyle(draft.emoteHoverStyle),
        emoteHoverLayout: cleanHoverLayout(draft.emoteHoverLayout),
        emoteHoverTemplate: cleanHoverTemplate(draft.emoteHoverTemplate),
        emoteHoverDelay: cleanHoverDelay(draft.emoteHoverDelay),
        maintainerGuidance
    }
    onboardingPrefs = session?.prefs ? { ...basePrefs, ...session.prefs } : basePrefs
    onboardingPrefs.siteAccessDefault = allSitesGranted
    if (allSitesGranted) onboardingPrefs.siteAccessChoice = "all"
    else if (onboardingPermissionResumeResult?.granted === false) {
        onboardingPrefs.siteAccessChoice = "per-site"
        onboardingPrefs.siteAccessDenied = true
    }
    else if (onboardingPrefs.siteAccessChoice === "all") onboardingPrefs.siteAccessChoice = null
    onboardingPermissionResumeResult = null
    onboardingIndex = Math.max(0, Math.min(ONBOARDING_TOTAL - 1, Number(session?.index) || 0))
    onboardingOverlay.classList.remove("is-prompt"), onboardingOverlay.hidden = false
    renderOnboarding(true)
    onboardingNextBtn.focus()
}
async function openOnboardingPage() {
    try {
        const tabs = await ext.tabs.query({ url: onboardingUrl })
        const tab = tabs[0]
        if (tab?.id !== undefined) return ext.tabs.update(tab.id, { active: true })
    } catch { }
    await ext.tabs.create({ url: onboardingUrl })
}
async function skipOnboarding() {
    await ext.storage.local.set({
        onboardingComplete: true,
        onboardingCompletedAt: Date.now()
    })
    await ext.storage.local.remove(ONBOARDING_SESSION_KEY)
    if (onboardingPageMode) {
        window.close()
        return
    }
    const tabs = await ext.tabs.query({ url: onboardingUrl })
    await Promise.all(tabs.filter(tab => tab.id !== undefined).map(tab => ext.tabs.remove(tab.id).catch(() => { })))
    onboardingOverlay.hidden = true
}
function showOnboardingPrompt() {
    onboardingOverlay.classList.add("is-prompt"), onboardingPromptEl.hidden = false, onboardingOverlay.hidden = false
    onboardingPromptSetupBtn.focus()
}
function closeOnboarding() {
    persistOnboardingSession(false).catch(() => { })
    onboardingOverlay.classList.remove("is-prompt"), onboardingOverlay.hidden = true
    if (onboardingPageMode) window.close()
}
async function applyOnboarding() {
    onboardingNextBtn.disabled = true
    onboardingNextBtn.textContent = "Applying..."
    try {
        Object.assign(draft, {
            renderMode: onboardingPrefs.renderMode,
            emoteSize: Number(onboardingPrefs.emoteSize),
            zeroWidthEmote: onboardingPrefs.zeroWidthEmote,
            zeroWidthText: onboardingPrefs.zeroWidthText,
            caseSensitive: onboardingPrefs.caseSensitive,
            matchPriority: onboardingPrefs.matchPriority,
            emoteHoverStyle: onboardingPrefs.emoteHoverStyle,
            emoteHoverLayout: onboardingPrefs.emoteHoverLayout,
            emoteHoverTemplate: cleanHoverTemplate(onboardingPrefs.emoteHoverTemplate),
            emoteHoverDelay: onboardingPrefs.emoteHoverDelay
        })
        const result = await ext.runtime.sendMessage({ type: "SAVE_DRAFT", draft })
        if (!result || !result.success) throw new Error((result && result.error) || "Preferences could not be saved")
        await ext.storage.local.set({
            pickerEnabled: onboardingPrefs.pickerEnabled,
            pickerLayout: onboardingPrefs.pickerLayout,
            maintainerGuidance: onboardingPrefs.maintainerGuidance,
            onboardingComplete: true,
            onboardingCompletedAt: Date.now()
        })
        await ext.storage.local.remove([
            ONBOARDING_SESSION_KEY,
            ...(!onboardingPrefs.maintainerGuidance ? ["siteCfg", "siteCfgAt"] : [])
        ])
        if (onboardingPageMode) window.close()
        else location.reload()
    } catch (err) {
        onboardingNextBtn.disabled = false
        onboardingNextBtn.textContent = "Apply preferences"
        const error = onboardingElement("p", "hint error", errorText(err))
        onboardingContentEl.appendChild(error)
    }
}
async function maybeStartOnboarding() {
    const state = await ext.storage.local.get(["onboardingComplete", ONBOARDING_SESSION_KEY])
    if (onboardingPageMode) {
        onboardingPromptEl.hidden = true
        await openOnboarding()
        return
    }
    if (!state.onboardingComplete || state[ONBOARDING_SESSION_KEY]?.active)
        showOnboardingPrompt()
}
onboardingPromptSetupBtn.addEventListener("click", async () => {
    onboardingPromptSetupBtn.disabled = true
    try {
        await openOnboardingPage()
        onboardingOverlay.hidden = true
    } finally {
        onboardingPromptSetupBtn.disabled = false
    }
})
onboardingPromptSkipBtn.addEventListener("click", () => skipOnboarding().catch(() => { }))
onboardingBackBtn.addEventListener("click", () => {
    if (onboardingIndex <= 0) return
    onboardingIndex--
    renderOnboarding(true)
})
onboardingNextBtn.addEventListener("click", async () => {
    if (onboardingIndex === 0 && !["all", "per-site"].includes(onboardingPrefs.siteAccessChoice)) return
    if (onboardingIndex < ONBOARDING_TOTAL - 1) {
        onboardingIndex++
        renderOnboarding(true)
        return
    }
    await applyOnboarding()
})
onboardingCloseBtn.addEventListener("click", () => skipOnboarding().catch(() => { }))
runOnboardingBtn.addEventListener("click", () => {
    onboardingWarningOverlay.hidden = false
    onboardingKeepBtn.focus()
})
onboardingWarningCancelBtn.addEventListener("click", () => {
    onboardingWarningOverlay.hidden = true
    runOnboardingBtn.focus()
})
onboardingKeepBtn.addEventListener("click", async () => {
    onboardingWarningOverlay.hidden = true
    await openOnboarding({ resume: false })
})
onboardingPermissionCancelBtn.addEventListener("click", () => {
    if (onboardingPermissionSource === "default-access") {
        onboardingPermissionOverlay.hidden = true
        defaultAccessModeEl.querySelector('[data-default-access="on"]')?.focus()
        return
    }
    onboardingPermissionOverlay.hidden = true
    if (!onboardingOverlay.hidden) onboardingNextBtn.focus()
})
onboardingPermissionContinueBtn.addEventListener("click", () => {
    onboardingPermissionContinueBtn.disabled = true
    requestDefaultSiteAccess(onboardingPermissionSource).then(async value => {
        if (onboardingPermissionSource === "default-access") {
            if (value) await renderSiteAccess()
            onboardingPermissionOverlay.hidden = true
            onboardingPermissionContinueBtn.disabled = false
            await consumeSiteAccessPermissionResult()
            return
        }
        onboardingPrefs.siteAccessDefault = value
        onboardingPrefs.siteAccessChoice = value ? "all" : "per-site"
        onboardingPrefs.siteAccessDenied = !value
        onboardingPermissionOverlay.hidden = true
        onboardingPermissionContinueBtn.disabled = false
        await persistOnboardingSession()
        await ext.storage.local.remove(SITE_ACCESS_PERMISSION_RESULT_KEY)
        renderOnboarding()
    }).catch(() => { onboardingPermissionContinueBtn.disabled = false })
})
onboardingResetBtn.addEventListener("click", async () => {
    onboardingResetBtn.disabled = true
    const result = await ext.runtime.sendMessage({ type: "RESET_ALL_DATA" })
    if (!result || !result.success) {
        onboardingResetBtn.disabled = false
        onboardingResetBtn.textContent = "Erase all data and continue"
        return
    }
    location.reload()
})
document.addEventListener("keydown", event => event.key === "Escape" && (() => {
    if (!onboardingPermissionOverlay.hidden) onboardingPermissionCancelBtn.click()
    else if (!onboardingWarningOverlay.hidden) onboardingWarningCancelBtn.click()
    else if (!onboardingOverlay.hidden) closeOnboarding()
})())
