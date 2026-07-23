import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import AdmZip from "adm-zip"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dir = path.join(root, "extension")
const foxPath = path.join(root, "manifests", "firefox.json")

const arg = process.argv.slice(2)
const getArg = (e) => {
    const i = arg.indexOf(e)
    return i === -1 ? null : arg[i + 1]
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"))
const manifest = await readJson(path.join(dir, "manifest.json"))
const foxOverlay = await readJson(foxPath)

const version = getArg("--version") || manifest.version
const outdir = path.resolve(root, getArg("--out-dir") || "build")
const distDir = path.join(root, "dist")
const relOutdir = path.relative(root, outdir)

// early throw
if (!/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(version))
    throw new Error(`Invalid browser extension version: ${version}`)

if (
    !relOutdir ||
    relOutdir.startsWith("..") ||
    path.isAbsolute(relOutdir)
) throw new Error(`Build output must be a directory inside ${root}`)


const chromeManifest = {
    ...manifest,
    version
}
const foxManifest = {
    ...manifest,
    ...foxOverlay,
    version
}

await rm(outdir, { recursive: true, force: true })
await rm(distDir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })
await mkdir(distDir, { recursive: true })

for (const [nam, man] of [
    ["chrome", chromeManifest],
    ["firefox", foxManifest]
]) {
    const browser = path.join(outdir, nam)
    await cp(dir, browser, { recursive: true })
    await writeFile(
        path.join(browser, "manifest.json"),
        `${JSON.stringify(man, null, 4)}\n`,
        "utf8"
    )

    const zip = new AdmZip()
    zip.addLocalFolder(browser)
    await zip.writeZipPromise(path.join(distDir, `7tv-anywhere-${version}-${nam}.zip`))
}

console.log(`built unpacked sources in ${relOutdir} and browser packages in dist`)
