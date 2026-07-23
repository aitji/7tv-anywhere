import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const unsafe = /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extDir = path.join(root, "extension")
const srcDir = path.join(root, "scripts")
const testDir = path.join(root, "tests")

async function lists(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...await lists(entryPath))
        else files.push(entryPath)
    }
    return files
}

const extFile = await lists(extDir)
const toolFile = await lists(srcDir)
const testFile = await lists(testDir)
const jsFile = [
    ...extFile.filter(file => file.endsWith(".js")),
    ...toolFile.filter(file => file.endsWith(".mjs")),
    ...testFile.filter(file => file.endsWith(".mjs"))
]

for (const file of jsFile) {
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" })
    if (res.status !== 0) {
        process.stderr.write(res.stderr || res.stdout)
        process.exitCode = 1
    }

    const source = await readFile(file, "utf8")
    if (file.startsWith(extDir) && unsafe.test(source)) {
        console.error(`unsafe HTML DOM assignment found in ${path.relative(root, file)}`)
        process.exitCode = 1
    }
}

for (const file of [
    path.join(extDir, "manifest.json"),
    path.join(root, "manifests", "firefox.json"),
    path.join(root, "amo-metadata.json")
]) JSON.parse(await readFile(file, "utf8"))

if (process.exitCode) process.exit(process.exitCode)
console.log(`checked ${jsFile.length} files and browser manifest sources`)
