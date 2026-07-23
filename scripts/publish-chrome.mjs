import { readFile } from "node:fs/promises"
import path from "node:path"

const [packagePath] = process.argv.slice(2)
const accessToken = process.env.CWS_ACCESS_TOKEN
const publisherId = process.env.CWS_PUBLISHER_ID
const extensionId = process.env.CWS_EXTENSION_ID

if (!packagePath) throw new Error("Usage: node scripts/publish-chrome.mjs <package.zip>")
if (!accessToken || !publisherId || !extensionId) throw new Error("CWS_ACCESS_TOKEN, CWS_PUBLISHER_ID, and CWS_EXTENSION_ID are required")

const item = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`
const api = "https://chromewebstore.googleapis.com"
const authz = { Authorization: `Bearer ${accessToken}` }

async function apiRequest(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authz, ...options.headers } })
    const text = await res.text()

    let body = {}
    if (text) {
        try { body = JSON.parse(text) }
        catch { body = { response: text } }
    }

    if (!res.ok)
        throw new Error(`web store: ${res.status}: ${JSON.stringify(body)}`)

    return body
}

const bytes = await readFile(path.resolve(packagePath))
let upload = await apiRequest(`${api}/upload/v2/${item}:upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: bytes
})
console.log(`chrome upload state: ${upload.uploadState || "unknown"}`)

for (let attempt = 0; ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(upload.uploadState); attempt++) {
    if (attempt >= 30) throw new Error("chrome web store upload did not finish within 5 minutes ._.")
    await new Promise(resolve => setTimeout(resolve, 10_000))
    const status = await apiRequest(`${api}/v2/${item}:fetchStatus`)
    upload = { uploadState: status.lastAsyncUploadState }
    console.log(`chrome upload state: ${upload.uploadState || "unknown"}`)
}

if (upload.uploadState !== "SUCCEEDED")
    throw new Error(`chrome web store upload failed with state: ${upload.uploadState || "unknown"}`)


const published = await apiRequest(`${api}/v2/${item}:publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        publishType: "DEFAULT_PUBLISH",
        blockOnWarnings: true
    })
})
console.log(`chrome submission state: ${published.state || "submitted"}`)
