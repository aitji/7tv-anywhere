async function getSugg(query) {
    const [emote, { excludedEmote = [], caseSensitive = false, matchPriority = "channel" }] = await Promise.all([
        getEmote(),
        ext.storage.local.get(["excludedEmote", "caseSensitive", "matchPriority"])
    ])

    const q = norm(query, caseSensitive)
    const priorityMode = cleanMatchPriority(matchPriority)
    const exKey = name => caseSensitive ? String(name) : String(name).toLowerCase()
    const exclude = new Set(excludedEmote.map(exKey))

    const match = []
    for (const item of emote) {
        if (exclude.has(exKey(item.name))) continue
        const score = fuzzy(q, norm(item.name, caseSensitive))
        if (score > 0) match.push({
            ...item,
            score,
            caseScore: caseFit(query, item.name)
        })
    }

    match.sort((a, b) => {
        const score = b.score - a.score
        if (score) return score
        if (priorityMode === "case")
            return b.caseScore - a.caseScore
                || (b.priority || 0) - (a.priority || 0)
                || a.name.localeCompare(b.name)
        return (b.priority || 0) - (a.priority || 0)
            || b.caseScore - a.caseScore
            || a.name.localeCompare(b.name)
    })
    return match.slice(0, MAX_SUGGESTIONS)
}

// helpers
const caseFit = (input, name) => {
    const left = String(input || "")
    const right = String(name || "")
    let score = 0
    for (let i = 0; i < Math.min(left.length, right.length); i++)
        if (left[i] === right[i]) score++
    return score
}
const norm = (str, matchCase = false) => {
    const text = String(str || "")
    return (matchCase ? text : text.toLowerCase()).replace(/[^a-z0-9]/gi, "")
}
const clamp = (size) => {
    const n = Number(size)
    if (!Number.isInteger(n) || n < 1 || n > 4) return 2
    return n
}
const fuzzy = (query, text) => {
    if (!query) return 0
    if (text.includes(query)) return 100 + (100 - text.indexOf(query))

    let score = 0
    let qIndex = 0
    let lastIndex = -1

    for (let i = 0; i < text.length && qIndex < query.length; i++) {
        if (text[i] === query[qIndex]) {
            score += 10
            if (lastIndex === i - 1) score += 5
            if (qIndex === 0 && i === 0) score += 20
            lastIndex = i
            qIndex++
        }
    }

    return qIndex === query.length ? score : 0
}
