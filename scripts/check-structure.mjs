import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { backgroundModules, popupScripts, popupStyles } from "./extension-layout.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = path.join(root, "extension")
const popupDir = path.join(extensionDir, "popup")
const readJson = async file => JSON.parse(await readFile(file, "utf8"))
const same = (left, right) =>
    left.length === right.length && left.every((value, index) => value === right[index])

for (const relative of [
    ...backgroundModules,
    ...popupScripts.map(file => `popup/${file}`),
    ...popupStyles.map(file => `popup/${file}`)
]) await access(path.join(extensionDir, relative))

const manifest = await readJson(path.join(extensionDir, "manifest.json"))
if (manifest.background?.service_worker !== "background.js")
    throw new Error("Chrome must use the background worker loader")

const firefox = await readJson(path.join(root, "manifests", "firefox.json"))
if (!same(firefox.background?.scripts || [], backgroundModules))
    throw new Error("Firefox background module order does not match extension-layout.mjs")

const worker = await readFile(path.join(extensionDir, "background.js"), "utf8")
const workerModules = [...worker.matchAll(/"([^"]+\.js)"/g)].map(match => match[1])
if (!same(workerModules, backgroundModules))
    throw new Error("Chrome background loader order does not match extension-layout.mjs")

const popupHtml = await readFile(path.join(popupDir, "popup.html"), "utf8")
const htmlScripts = [...popupHtml.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1])
const htmlStyles = [...popupHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(match => match[1])
if (!same(htmlScripts, popupScripts))
    throw new Error("Popup script order does not match extension-layout.mjs")
if (!same(htmlStyles, popupStyles))
    throw new Error("Popup stylesheet order does not match extension-layout.mjs")

const popupState = await readFile(path.join(popupDir, "js", "state.js"), "utf8")
if (/savedSerialized\s*=\s*serializeComparableState\s*\(/.test(popupState))
    throw new Error("Popup state must not call a helper from a later classic script during initialization")

const sourceFiles = [
    ...backgroundModules.map(file => path.join(extensionDir, file)),
    ...popupScripts.map(file => path.join(popupDir, file)),
    ...popupStyles.map(file => path.join(popupDir, file))
]
for (const file of sourceFiles) {
    const lineCount = (await readFile(file, "utf8")).split(/\r?\n/).length
    if (lineCount > 500)
        throw new Error(`${path.relative(root, file)} has ${lineCount} lines; split it by responsibility`)
}

console.log(`verified ${sourceFiles.length} ordered extension modules (all under 500 lines)`)
