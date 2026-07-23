import { readFile } from "node:fs/promises"
import AdmZip from "adm-zip"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { backgroundModules, popupScripts, popupStyles } from "./extension-layout.mjs"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const read = async (browser) => JSON.parse(await readFile(path.join(root, "build", browser, "manifest.json"), "utf8"))
const chrome = await read("chrome")
const fox = await read("firefox")

if (!chrome.background?.service_worker || chrome.background.scripts)
    throw new Error("[Chrome] build must use background.service_worker only")
if (chrome.browser_specific_settings)
    throw new Error("[Chrome] build must not contain Firefox browser_specific_settings")
if (!Array.isArray(fox.background?.scripts) || fox.background.service_worker)
    throw new Error("[Fox] build must use background.scripts only")
if (JSON.stringify(fox.background.scripts) !== JSON.stringify(backgroundModules))
    throw new Error("[Fox] background modules are missing or out of order")
if (fox.browser_specific_settings?.gecko?.strict_min_version !== "140.0")
    throw new Error("[Fox] desktop minimum version must be 140.0")
if (fox.browser_specific_settings?.gecko_android?.strict_min_version !== "142.0")
    throw new Error("[Fox] Android minimum version must be 142.0")
if (fox.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] !== "none")
    throw new Error("[Fox] data collection declaration is missing")
if (chrome.version !== fox.version)
    throw new Error("[Error] Chrome and Fox build versions do not match")
if (!chrome.content_scripts?.every(script => script.all_frames === true))
    throw new Error("[Chrome] content scripts must run in live-chat frames")
if (!fox.content_scripts?.every(script => script.all_frames === true))
    throw new Error("[Fox] content scripts must run in live-chat frames")

for (const browser of ["chrome", "firefox"]) {
    for (const relative of [
        ...backgroundModules,
        ...popupScripts.map(file => `popup/${file}`),
        ...popupStyles.map(file => `popup/${file}`)
    ]) await readFile(path.join(root, "build", browser, relative))
}

for (const browser of ["chrome", "firefox"]) {
    const zipPath = path.join(root, "dist", `7tv-anywhere-${chrome.version}-${browser}.zip`)
    const zip = new AdmZip(zipPath)
    const entry = new Map(zip.getEntries().map(item => [item.entryName, item]))
    const zippedManifest = entry.get("manifest.json")
    if (!zippedManifest)
        throw new Error(`[${browser}] package is missing manifest.json at its root`)

    const builtManifest = await readFile(path.join(root, "build", browser, "manifest.json"), "utf8")
    if (zippedManifest.getData().toString("utf8") !== builtManifest)
        throw new Error(`[${browser}] packaged manifest does not match build output`)

    for (const relative of [
        ...backgroundModules,
        ...popupScripts.map(file => `popup/${file}`),
        ...popupStyles.map(file => `popup/${file}`)
    ]) if (!entry.has(relative))
        throw new Error(`[${browser}] package is missing ${relative}`)
}

console.log(`verified Chrome and Fox manifests and packages for v${chrome.version}`)
