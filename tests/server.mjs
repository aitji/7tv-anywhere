import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
}

createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname)
        const file = path.resolve(root, `.${pathname}`)
        if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path")
        const info = await stat(file)
        if (!info.isFile()) throw new Error("Not a file")
        response.writeHead(200, {
            "content-type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
            "cache-control": "no-store"
        })
        createReadStream(file).pipe(response)
    } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        response.end("Not found")
    }
}).listen(4177, "127.0.0.1", () => {
    console.log("7TV Anywhere test server listening on http://127.0.0.1:4177")
})
