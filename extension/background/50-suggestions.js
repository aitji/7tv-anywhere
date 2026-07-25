const SUGGESTION_PREF_KEYS = Object.freeze(["excludedEmote", "caseSensitive", "matchPriority"])
let suggestionPrefsCache = null
let suggestionIndexSource = null
let suggestionIndex = []

async function getSuggestionPrefs() {
    if (suggestionPrefsCache) return suggestionPrefsCache
    suggestionPrefsCache = await ext.storage.local.get(SUGGESTION_PREF_KEYS)
    return suggestionPrefsCache
}

ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (changes.emoteSet) {
        suggestionIndexSource = null
        suggestionIndex = []
    }
    if (!suggestionPrefsCache) return
    for (const key of SUGGESTION_PREF_KEYS) {
        if (!(key in changes)) continue
        if (changes[key].newValue === undefined) delete suggestionPrefsCache[key]
        else suggestionPrefsCache[key] = changes[key].newValue
    }
})

function getSuggestionIndex(emote) {
    if (suggestionIndexSource === emote) return suggestionIndex
    suggestionIndexSource = emote
    suggestionIndex = emote.map(item => ({
        item,
        sensitiveName: String(item.name),
        insensitiveName: String(item.name).toLowerCase(),
        sensitiveNorm: norm(item.name, true),
        insensitiveNorm: norm(item.name, false)
    }))
    return suggestionIndex
}

async function getSugg(query) {
    const [emote, prefs] = await Promise.all([getEmote(), getSuggestionPrefs()])
    const {
        excludedEmote = [],
        caseSensitive = false,
        matchPriority = "channel"
    } = prefs

    const q = norm(query, caseSensitive)
    const priorityMode = cleanMatchPriority(matchPriority)
    const isExcluded = makeExclusionMatcher(excludedEmote, caseSensitive)
    const matchByName = new Map()
    for (const entry of getSuggestionIndex(emote)) {
        if (isExcluded(entry.item)) continue
        const score = fuzzy(q, caseSensitive ? entry.sensitiveNorm : entry.insensitiveNorm)
        if (score <= 0) continue
        const candidate = {
            item: entry.item,
            score,
            caseScore: caseFit(query, entry.item.name)
        }
        const previous = matchByName.get(entry.sensitiveName)
        if (!previous || compareSuggestion(candidate, previous, priorityMode) < 0)
            matchByName.set(entry.sensitiveName, candidate)
    }

    const match = Array.from(matchByName.values())
    match.sort((a, b) => {
        const score = b.score - a.score
        if (score) return score
        if (priorityMode === "case")
            return b.caseScore - a.caseScore
                || (b.item.priority || 0) - (a.item.priority || 0)
                || a.item.name.localeCompare(b.item.name)
        return (b.item.priority || 0) - (a.item.priority || 0)
            || b.caseScore - a.caseScore
            || a.item.name.localeCompare(b.item.name)
    })
    return match.slice(0, MAX_SUGGESTIONS).map(entry => entry.item)
}

function compareSuggestion(a, b, priorityMode) {
    const score = b.score - a.score
    if (score) return score
    if (priorityMode === "case")
        return b.caseScore - a.caseScore
            || (b.item.priority || 0) - (a.item.priority || 0)
            || a.item.name.localeCompare(b.item.name)
    return (b.item.priority || 0) - (a.item.priority || 0)
        || b.caseScore - a.caseScore
        || a.item.name.localeCompare(b.item.name)
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
