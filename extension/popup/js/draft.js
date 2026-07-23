function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, canonicalize(value[key])])
    )
}

function serializeComparableState(state) {
    const customSets = (state.customSets || []).map(set => ({
        ...set,
        enabled: set.enabled !== false
    }))
    const channelSettings = {}
    for (const [channelId, pref] of Object.entries(state.channelSettings || {})) {
        const clean = { ...(pref || {}) }
        delete clean.lastEnabledSetIds
        if (clean.alwaysMain !== true) delete clean.alwaysMain
        if (Object.keys(clean).length) channelSettings[channelId] = clean
    }
    return JSON.stringify(canonicalize({ customSets, channelSettings }))
}

const isDirty = (serialized = serializeComparableState(draft)) => serialized !== savedSerialized
function updateSaveBar() {
    const serialized = JSON.stringify(draft)
    const dirty = isDirty(serializeComparableState(draft))
    const lookupRunning = channelOperationState && channelOperationState.phase === "resolving"
    saveBtn.disabled = !dirty || lookupRunning
    discardBtn.disabled = !dirty || lookupRunning
    saveHintEl.textContent = dirty
        ? (lookupRunning
            ? "A channel lookup is still running; your draft is safe if you close this popup"
            : "Save to apply it or Discard to undo it")
        : "Nothing to save yet"
    if (popupReady) renderSettingsData()

    if (!popupReady) return
    if (serialized === lastPersistedDraft) return
    lastPersistedDraft = serialized
    if (dirty) {
        ext.storage.local.set({
            pendingDraft: {
                customSets: cloneState(draft.customSets),
                channelSettings: cloneState(draft.channelSettings),
                updatedAt: Date.now()
            }
        }).catch(() => { })
    } else ext.storage.local.remove("pendingDraft").catch(() => { })
}

async function saveDraft() {
    if (!isDirty()) return
    const submitted = cloneState(draft)
    const submittedSerialized = JSON.stringify(submitted)
    const submittedComparable = serializeComparableState(submitted)
    saveBtn.disabled = true
    saveBtn.textContent = "Saving..."

    try {
        const result = await ext.runtime.sendMessage({ type: "SAVE_DRAFT", draft: submitted })
        if (!result || !result.success) throw new Error((result && result.error) || "Save failed.")
        saved = submitted
        savedSerialized = submittedComparable
        lastPersistedDraft = submittedSerialized
        if (result.emotes) {
            setCount(result.emotes.length)
            setPopupEmote(result.emotes)
            renderExcluded()
            renderNotice()
        }
        reloadWarningEl.textContent = result.warning || ""
    } catch (err) {
        reloadWarningEl.textContent = errorText(err)
    } finally {
        saveBtn.textContent = "Save changes"
        updateSaveBar()
    }
}

saveBtn.addEventListener("click", saveDraft)
discardBtn.addEventListener("click", () => {
    if (!isDirty()) return
    showConfirm({
        title: "Discard this draft?",
        body: "This removes every unsaved channel and set change; saved settings and loaded emotes stay unchanged",
        actionLabel: "Discard changes",
        danger: true,
        onAction: async () => {
            await ext.runtime.sendMessage({ type: "DISCARD_DRAFT" }).catch(() => { })
            draft = cloneState(saved)
            lastPersistedDraft = JSON.stringify(draft)
            channelOperationState = null
            renderChannelStatus()
            if (currentChannelId) closeManageView()
            renderHome()
            updateSaveBar()
        }
    })
})
emoteSizeInput.addEventListener("input", () => emoteSizeValue.textContent = `${emoteSizeInput.value}x`)
reloadBtn.addEventListener("click", async () => { await triggerReload() })
emoteSizeInput.addEventListener("change", async () => {
    await ext.storage.local.set({ emoteSize: parseInt(emoteSizeInput.value, 10) })
    await triggerReload()
})

async function triggerReload() {
    const originalContent = clone(reloadBtn)
    reloadBtn.textContent = "Reloading..."
    reloadBtn.disabled = true
    reloadWarningEl.textContent = ""

    try {
        const res = await ext.runtime.sendMessage({ type: "RELOAD_EMOTES" })
        if (res && res.success) {
            const emotes = res.emotes || []
            setCount(emotes.length)
            setPopupEmote(emotes)
            renderExcluded()
            renderNotice()
            if (res.warning) reloadWarningEl.textContent = res.warning
        } else reloadWarningEl.textContent = errorText(res && res.error)
    } catch (err) { reloadWarningEl.textContent = errorText(err) }

    reloadBtn.replaceChildren(...originalContent)
    reloadBtn.disabled = false
}
