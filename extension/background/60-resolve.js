const readId = (raw) => {
    const t = String(raw || "").trim()
    if (!t) return null

    const url = t.match(/(?:emote-sets|users)\/([A-Za-z0-9]+)/)
    if (url) return url[1]

    if (/^[A-Za-z0-9_]+$/.test(t)) return t
    return null
}

async function resChannel(rQuery) {
    const id = readId(rQuery)
    if (!id) return { error: errorText(`Couldn't parse "${rQuery}"`) }

    if (/^\d+$/.test(id)) {
        const user = await getTwitch(id)
        return user
            ? channelRes(user)
            : { error: errorText(`Couldn't find "${rQuery}" as a Twitch user`) }
    }

    const is7tvId = id.length === 24
    if (is7tvId) {
        const set = await getSet(id)
        if (set) return { type: "set", set }
    }

    const twitch = await getTwitch(id)
    if (twitch) return channelRes(twitch)

    const user = await getUser(id)
    if (user) return channelRes(user)

    if (!is7tvId) {
        const set = await getSet(id)
        if (set) return { type: "set", set }
    }

    return { error: errorText(`Couldn't find "${rQuery}" as a set, channel, or Twitch username`) }
}

async function channelRes(user) {
    const ownSet = user.emote_sets || []
    const set = (await Promise.all(ownSet.map(item => getSet(item.id)))).filter(Boolean)

    return {
        type: "channel",
        channel: { id: user.id, name: user.display_name || user.username || user.id },
        sets: set,
        activeSetId: activeId(user)
    }
}

function activeId(user) {
    if (!user) return null
    if (user.active_emote_set_id) return user.active_emote_set_id

    const connect = user.connections || []
    const twitch = connect.find(item => item.platform === "TWITCH") || connect[0]
    if (twitch) return twitch.emote_set_id || (twitch.emote_set && twitch.emote_set.id) || null
    return null
}

async function getSet(id) {
    try {
        const res = await fetchWithTimeout(`${SEVEN_TV_API}/emote-sets/${id}`)
        if (!res.ok) return null

        const data = await res.json()
        const emote = data.emotes || []
        const preview = emote
            .slice(0, PREVIEW_EMOTE_COUNT)
            .filter(e => e && e.data && e.data.host && e.data.host.url)
            .map(e => ({ name: e.name, url: `https:${e.data.host.url}/1x.webp` }))
        return { id: data.id, name: data.name || data.id, count: emote.length, preview }
    } catch { return null }
}

async function getUser(id) {
    try {
        const res = await fetchWithTimeout(`${SEVEN_TV_API}/users/${id}`)
        if (!res.ok) return null
        return await res.json()
    } catch { return null }
}

// username -> id
async function getTwitch(username) {
    try {
        const { commonChannel } = await getCfg()
        const lookup = String(username || "").toLowerCase()
        let twitchId = /^\d+$/.test(lookup)
            ? lookup
            : (commonChannel && commonChannel[lookup]) || null
        if (!twitchId) {
            const idRes = await fetchWithTimeout(`${THIRD_PARTY_API}/twitch/id/${encodeURIComponent(lookup)}`)
            if (!idRes.ok) return null
            twitchId = (await idRes.text()).trim()
        }

        if (!twitchId) return null
        if (!/^\d+$/.test(twitchId)) return null

        const cRes = await fetchWithTimeout(`${SEVEN_TV_API}/users/twitch/${twitchId}`)
        if (!cRes.ok) return null
        const data = await cRes.json()

        const mainId = (data.emote_set && data.emote_set.id) || data.emote_set_id || null
        if (data.user) return { ...data.user, active_emote_set_id: mainId }

        return {
            id: data.id,
            username: data.username,
            display_name: data.display_name,
            emote_sets: data.emote_set ? [data.emote_set] : [],
            active_emote_set_id: mainId
        }
    } catch { return null }
}
