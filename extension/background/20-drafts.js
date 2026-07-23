function mutateDraft(work) {
    const next = queueDraft.then(work, work)
    queueDraft = next.catch(() => { })
    return next
}

async function reStaleOp() {
    if (isInitChannelFly) return
    const { channelOperation } = await ext.storage.local.get("channelOperation")
    if (!channelOperation || channelOperation.phase !== "resolving") return
    await ext.storage.local.set({
        channelOperation: {
            ...channelOperation,
            phase: "error",
            message: "The previous lookup was interrupted, Try adding the channel again...",
            error: "Lookup interrupted",
            updatedAt: Date.now(),
            finishedAt: Date.now()
        }
    })
}

async function getDraft() {
    const { pendingDraft, customSets = [], channelSettings = {} } = await ext.storage.local.get([
        "pendingDraft", "customSets", "channelSettings"
    ])
    const src = validDraft(pendingDraft)
        ? pendingDraft
        : { customSets, channelSettings }
    return {
        customSets: cloneState(src.customSets),
        channelSettings: cloneState(src.channelSettings)
    }
}

async function saveDraft(input) {
    const done = startBadgeWork("save")
    try {
        return await mutateDraft(async () => {
            const state = validDraft(input) ? input : await getDraft()
            if (!validDraft(state)) throw new Error("The saved draft is invalid...")
            await ext.storage.local.set({
                customSets: cloneState(state.customSets),
                channelSettings: cloneState(state.channelSettings)
            })
            await ext.storage.local.remove("pendingDraft")
            const result = await reloadEmote()
            return { success: true, emotes: result.emotes, warning: result.warning }
        })
    } finally { done() }
}

async function discardDraft() {
    return mutateDraft(() => ext.storage.local.remove(["pendingDraft", "channelOperation"]))
}

function applyResult(res, state) {
    if (res.type === "set") {
        const dupe = state.customSets.some(s => s.id === res.set.id)
        if (!dupe) state.customSets.push({
            id: res.set.id,
            setName: res.set.name,
            count: res.set.count,
            preview: res.set.preview || [],
            channelId: res.set.id,
            channelName: res.set.name,
            enabled: true
        })
        return {
            changed: !dupe,
            message: dupe
                ? `"${res.set.name}" is already in your draft...`
                : `Added "${res.set.name}" to your draft!`
        }
    }

    if (!res.sets.length) return { changed: false, message: `${res.channel.name} has no public emote sets...` }

    const track = new Set(state.customSets
        .filter(s => s.channelId === res.channel.id)
        .map(s => s.id)
    )
    const entry = res.sets
        .filter(set => !track.has(set.id))
        .map(set => ({
            id: set.id,
            setName: set.name,
            count: set.count,
            preview: set.preview || [],
            channelId: res.channel.id,
            channelName: res.channel.name,
            enabled: set.id === res.activeSetId
        }))

    state.channelSettings[res.channel.id] = {
        alwaysMain: true,
        ...(state.channelSettings[res.channel.id] || {}),
        knownActiveSetId: res.activeSetId
    }
    state.customSets.push(...entry)

    if (!entry.length) return { changed: false, message: `${res.channel.name} is already fully tracked...` }
    return {
        changed: true,
        message: `Added ${res.channel.name}'s ${entry.length} set${entry.length === 1 ? "" : "s"} to your draft!`
    }
}

async function addChannel(input) {
    const query = String(input || "").trim()
    if (!query) return { error: "Enter a channel, set, link, or ID..." }
    await initialize()
    if (isInitChannelFly)
        return { error: "Another channel is already being added..." }

    const opId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const start = Date.now()
    const setOp = async (phase, message, extra = {}) => {
        const op = {
            id: opId,
            query,
            phase,
            message,
            startedAt: start,
            updatedAt: Date.now(),
            ...extra
        }
        await ext.storage.local.set({ channelOperation: op })
        return op
    }

    isInitChannelFly = (async () => {
        await setOp("resolving", `Finding "${query}" in the background...`)
        const res = await resChannel(query)
        if (!res || res.error) {
            const error = errorText(res && res.error, "Channel lookup failed")
            await setOp("error", error, { finishedAt: Date.now(), error })
            return { error }
        }

        const change = await mutateDraft(async () => {
            const state = await getDraft()
            const summary = applyResult(res, state)
            if (summary.changed) await ext.storage.local.set({
                pendingDraft: { ...state, updatedAt: Date.now() }
            })
            return summary
        })
        const message = change.changed
            ? `${change.message} Save when you are ready!`
            : change.message
        await setOp("done", message, {
            finishedAt: Date.now(),
            changed: change.changed
        })
        return { success: true, ...change }
    })()

    try { return await isInitChannelFly }
    catch (err) {
        const error = errorText(err)
        await setOp("error", error, { finishedAt: Date.now(), error })
        return { error }
    } finally {
        isInitChannelFly = null
    }
}
