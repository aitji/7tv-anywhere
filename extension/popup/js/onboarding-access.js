const SITE_ACCESS_PERMISSION_RESULT_KEY = "siteAccessPermissionResult"

function requestDefaultSiteAccess(source = "default-access") {
    ext.storage.local.set({
        [SITE_ACCESS_PERMISSION_RESULT_KEY]: {
            granted: null,
            pending: true,
            source,
            updatedAt: Date.now()
        }
    }).catch(() => { })
    return setDefaultSiteAccess(true, null).then(async granted => {
        await ext.storage.local.set({
            [SITE_ACCESS_PERMISSION_RESULT_KEY]: {
                granted: granted === true,
                pending: false,
                source,
                updatedAt: Date.now()
            }
        })
        return granted
    })
}

async function consumeSiteAccessPermissionResult() {
    const state = await ext.storage.local.get(SITE_ACCESS_PERMISSION_RESULT_KEY)
    const result = state[SITE_ACCESS_PERMISSION_RESULT_KEY]
    if (!result || typeof result !== "object") return
    await ext.storage.local.remove(SITE_ACCESS_PERMISSION_RESULT_KEY)
    const granted = result.pending ? await hasAllSitesPermission() : result.granted === true
    if (result.source === "onboarding") onboardingPermissionResumeResult = { granted }
    if (granted) {
        showSiteAccessStatus("All-website access allowed. Default website access is On.")
        return
    }
    showSiteAccessStatus(
        "Website access was denied. Allow access before 7TV Anywhere can inject the picker and render emotes on pages.",
        true
    )
}

function showOnboardingPermissionPrompt(source = "onboarding") {
    onboardingPermissionSource = source
    onboardingPermissionTitleEl.textContent = "Enable on all websites"
    onboardingPermissionContinueBtn.disabled = false
    onboardingPermissionCancelBtn.hidden = false
    onboardingPermissionBody.textContent = "Your browser will show its own permission request. Choose Allow to enable emotes and the picker automatically on websites, or Deny to keep default access Off."
    onboardingPermissionContinueBtn.textContent = "Request browser permission"
    onboardingPermissionOverlay.hidden = false
    onboardingPermissionContinueBtn.focus()
}

async function toggleDefaultAccessFromOnboarding() {
    if (onboardingPrefs.siteAccessDefault) {
        onboardingPrefs.siteAccessChoice = "all"
        await persistOnboardingSession()
        renderOnboarding()
        return
    }
    showOnboardingPermissionPrompt()
}

async function choosePerSiteAccessFromOnboarding() {
    if (onboardingPrefs.siteAccessDefault)
        onboardingPrefs.siteAccessDefault = await setDefaultSiteAccess(false, null)
    onboardingPrefs.siteAccessChoice = "per-site"
    onboardingPrefs.siteAccessDenied = false
    await persistOnboardingSession()
    renderOnboarding()
}

function renderAccessOnboarding(container) {
    container.appendChild(onboardingIntro(
        "Website access unlocks the main 7TV Anywhere experience: emotes render and the picker appears without setting up every site first."
    ))
    const demo = onboardingElement("div", "onboarding-access-demo")
    const before = onboardingElement("div", "onboarding-access-stage")
    before.append(
        onboardingElement("span", "onboarding-preview-label", "Without access"),
        onboardingElement("div", "onboarding-access-message raw", "HUGGIES"),
        onboardingElement("div", "onboarding-access-composer", "Type a message")
    )
    const after = onboardingElement("div", "onboarding-access-stage is-enabled")
    const rendered = onboardingElement("div", "onboarding-access-message")
    rendered.append(onboardingImage("", "huggies"), onboardingElement("span", "", "HUGGIES"))
    const composer = onboardingElement("div", "onboarding-access-composer", "Type a message")
    composer.appendChild(onboardingElement("i", "onboarding-access-search"))
    after.append(
        onboardingElement("span", "onboarding-preview-label", "With access"),
        rendered,
        composer
    )
    demo.append(before, onboardingElement("span", "onboarding-access-arrow", "→"), after)
    container.appendChild(demo)

    const choices = onboardingElement("div", "onboarding-access-choices")
    const all = onboardingElement("button", `onboarding-access-choice${onboardingPrefs.siteAccessChoice === "all" ? " is-selected" : ""}`)
    all.type = "button"
    all.append(
        onboardingElement("span", "onboarding-recommended", "Recommended"),
        onboardingElement("strong", "", onboardingPrefs.siteAccessDefault ? "Enabled on all websites" : "Enable on all websites"),
        onboardingElement("span", "", "One browser permission lets rendering and the picker work automatically.")
    )
    all.addEventListener("click", () => toggleDefaultAccessFromOnboarding().catch(() => { }))
    const perSite = onboardingElement("button", `onboarding-access-choice${onboardingPrefs.siteAccessChoice === "per-site" ? " is-selected" : ""}`)
    perSite.type = "button"
    perSite.append(
        onboardingElement("strong", "", "Choose websites individually"),
        onboardingElement("span", "", "No all-website access. Turn on the site switch and approve permission manually on every website you want to use.")
    )
    perSite.addEventListener("click", () => choosePerSiteAccessFromOnboarding().catch(() => { }))
    choices.append(all, perSite)
    container.appendChild(choices)

    const note = onboardingElement("div", "onboarding-info-note")
    note.textContent = onboardingPrefs.siteAccessChoice === "all"
        ? "Automatic access is enabled. You can still set individual websites to Off."
        : onboardingPrefs.siteAccessDenied
            ? "Website access was denied. Allow it before 7TV Anywhere can inject the picker and render emotes automatically, or use manual per-site access."
            : onboardingPrefs.siteAccessChoice === "per-site"
                ? "Manual mode selected: enable and approve each website separately from the popup."
                : "Choose how much website access you trust 7TV Anywhere with before continuing."
    container.appendChild(note)
}
