#!/usr/bin/env node
/**
 * Minimal static slide file server for local development.
 *
 * Serves raw slide files (TIFF/OME-TIFF, DZI, vector tiles, images…) straight
 * off disk with HTTP **range** support, which is what a client-side decoder
 * like `modules/webtiff` needs — it reads the header, then fetches tile offsets
 * with `Range:` requests rather than downloading the whole file.
 *
 * xOpat's own static handler (`responseStaticFile` in `server/node/index.js`)
 * deliberately does not do this: it answers 200 with the whole buffer, which is
 * correct for a 40 KB script and ruinous for a 2 GB pyramid, and a range-reading
 * decoder handed a 200 mis-slices it. Hence this sidecar. If the core handler
 * ever grows 206 support, `docs/data` can become a static root and this file
 * can go away.
 *
 *     npm run serve:slides
 *     node server/utils/node/slide-fileserver.mjs [root] [--port 9100] [--host 127.0.0.1]
 *     XOPAT_SLIDE_ROOT=/data/scans node server/utils/node/slide-fileserver.mjs
 *
 * The default root is the repository's `docs/data`, which is what the
 * `demo/visualization-flexibility` ENV fragment expects: one origin serving both
 * `slides/<file>` (the gitignored source data) and `generated/<…>` (whatever
 * `npm run demo:data` produced).
 *
 * Routes:
 *     GET  /files/<path>     the file itself (Range, HEAD, conditional GET)
 *     GET  /list             JSON listing of the root
 *     GET  /list/<subdir>    JSON listing of a subdirectory
 *     GET  /health           { ok: true, root }
 *
 * Development tool, not a production server: it binds to loopback by default and
 * sends permissive CORS headers so the viewer can read it from any local origin.
 * Do not expose it — it serves every readable file under `root`.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/utils/node/ -> repo root -> docs/data
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_ROOT = path.join(REPO_ROOT, "docs", "data");

const CONTENT_TYPES = {
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".svs": "image/tiff",
    ".ndpi": "image/tiff",
    ".scn": "image/tiff",
    ".qptiff": "image/tiff",
    ".btf": "image/tiff",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".json": "application/json",
    ".geojson": "application/geo+json",
    // Mapbox Vector Tiles. There is no registered type; every tile server in the
    // wild sends one of these two, and the decoder reads bytes either way.
    ".pbf": "application/octet-stream",
    ".mvt": "application/vnd.mapbox-vector-tile",
    ".dzi": "application/xml",
    ".xml": "application/xml",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".dcm": "application/dicom",
    ".zip": "application/zip",
};

function parseArgs(argv) {
    const opts = { root: process.env.XOPAT_SLIDE_ROOT || DEFAULT_ROOT, port: 9100, host: "127.0.0.1" };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--port") opts.port = Number(argv[++i]);
        else if (argv[i] === "--host") opts.host = argv[++i];
        else rest.push(argv[i]);
    }
    if (rest.length) opts.root = rest[0];
    opts.root = path.resolve(opts.root);
    return opts;
}

const opts = parseArgs(process.argv.slice(2));

/**
 * Resolve a URL path under the root, refusing anything that escapes it.
 * `path.resolve` collapses `..` before the check, so encoded traversal
 * (`%2e%2e%2f`) is caught too — the URL is decoded first.
 * @return {string|null} absolute path, or null when out of bounds
 */
function safeResolve(root, urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        return null;
    }
    if (decoded.includes("\0")) return null;
    const target = path.resolve(root, "." + path.posix.normalize("/" + decoded));
    const rel = path.relative(root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return target;
}

function setCommonHeaders(res) {
    // Local development only: the viewer may run on any localhost port.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, If-Range, If-None-Match, Content-Type");
    // Without this the browser hides the headers a range-reading decoder needs.
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag");
    res.setHeader("Accept-Ranges", "bytes");
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body, null, 2);
    setCommonHeaders(res);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
    res.end(payload);
}

const etagOf = (stat) => `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

/**
 * Parse a single-range `Range: bytes=…` header. Multi-range requests are not
 * supported (no decoder needs them) and fall back to the full body.
 * @return {{start:number,end:number}|null|"unsatisfiable"}
 */
function parseRange(header, size) {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;
    let start;
    let end;
    if (rawStart === "") {
        // suffix range: last N bytes
        const suffix = Number(rawEnd);
        if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === "" ? size - 1 : Number(rawEnd);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "unsatisfiable";
    return { start, end: Math.min(end, size - 1) };
}

async function serveFile(req, res, filePath, stat) {
    const etag = etagOf(stat);
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";

    setCommonHeaders(res);
    res.setHeader("Content-Type", type);
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    res.setHeader("Cache-Control", "no-cache");

    if (req.headers["if-none-match"] === etag) {
        res.writeHead(304);
        return res.end();
    }

    // `If-Range` guards a resumed read against the file changing underneath it.
    const ifRange = req.headers["if-range"];
    const rangeUsable = !ifRange || ifRange === etag;
    const range = rangeUsable ? parseRange(req.headers.range, stat.size) : null;

    if (range === "unsatisfiable") {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.writeHead(416);
        return res.end();
    }

    if (range) {
        const length = range.end - range.start + 1;
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
        res.setHeader("Content-Length", length);
        res.writeHead(206);
        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    }

    res.setHeader("Content-Length", stat.size);
    res.writeHead(200);
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(filePath).pipe(res);
}

async function listDirectory(res, dirPath, relPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const item = { name: entry.name, directory: entry.isDirectory() };
        if (!entry.isDirectory()) {
            try {
                const stat = await fsp.stat(path.join(dirPath, entry.name));
                item.size = stat.size;
                item.modified = stat.mtime.toISOString();
            } catch { /* unreadable entry: list it without details */ }
        }
        item.path = relPath ? `${relPath}/${entry.name}` : entry.name;
        items.push(item);
    }
    items.sort((a, b) => (a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1));
    sendJson(res, 200, { path: relPath, items });
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === "OPTIONS") {
            setCommonHeaders(res);
            res.writeHead(204);
            return res.end();
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            return sendJson(res, 405, { error: "Only GET and HEAD are supported." });
        }

        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        if (url.pathname === "/health") {
            return sendJson(res, 200, { ok: true, root: opts.root });
        }

        const isList = url.pathname === "/list" || url.pathname.startsWith("/list/");
        const isFile = url.pathname.startsWith("/files/");
        if (!isList && !isFile) {
            return sendJson(res, 404, { error: "Use /files/<path>, /list[/<dir>] or /health." });
        }

        const relPath = isList
            ? url.pathname.slice("/list".length).replace(/^\/+/, "")
            : url.pathname.slice("/files/".length);
        const target = safeResolve(opts.root, relPath);
        if (!target) return sendJson(res, 403, { error: "Path outside of the served root." });

        let stat;
        try {
            stat = await fsp.stat(target);
        } catch {
            return sendJson(res, 404, { error: `Not found: ${relPath}` });
        }

        if (stat.isDirectory()) {
            if (!isList) return sendJson(res, 400, { error: "That is a directory — use /list/<dir>." });
            return listDirectory(res, target, relPath.replace(/\/+$/, ""));
        }
        if (isList) return sendJson(res, 400, { error: "That is a file — use /files/<path>." });

        return serveFile(req, res, target, stat);
    } catch (e) {
        console.error("[slide-fileserver]", e);
        if (!res.headersSent) sendJson(res, 500, { error: String(e?.message || e) });
        else res.destroy();
    }
});

if (!fs.existsSync(opts.root)) {
    console.error(`[slide-fileserver] root does not exist: ${opts.root}`);
    process.exit(1);
}

server.listen(opts.port, opts.host, () => {
    console.log(`[slide-fileserver] serving ${opts.root}`);
    console.log(`[slide-fileserver] http://${opts.host}:${opts.port}/files/<path>  |  /list  |  /health`);
});
