"use strict";

/**
 * Response compression for the static asset path and the viewer page.
 *
 * The server used to send every bundle raw: ~8 MB of JS/CSS per cold load, which
 * over a slow or distant link (a Tailscale relay, a hospital VPN) is the whole
 * startup time. Text compresses 4–5× with brotli, so this is the single biggest
 * lever on time-to-first-slide that the server itself owns.
 *
 * Design notes:
 *  - **Never on the media path.** Ranged reads address *raw* byte offsets; a
 *    compressed body breaks `Range`/`If-Range`. The caller simply does not route
 *    media here.
 *  - **Extension allowlist, not a mime guess.** Images, fonts (woff2 is already
 *    brotli) and model weights gain nothing and would only cost CPU.
 *  - **Compressed bodies are cached** in a bounded cache keyed by the file's
 *    validator, so a given bundle is compressed once per process per encoding,
 *    not once per request. Brotli at high quality is slow; doing it per request
 *    would move the bottleneck from the network to the CPU.
 *  - **Async zlib only.** A sync brotli call on a 1.5 MB bundle blocks the event
 *    loop for tens of milliseconds, stalling every other request.
 *  - Encoded responses get their own ETag (`…-br"`), because a strong or weak
 *    validator must identify the representation, not the file.
 */

const zlib = require("node:zlib");
const path = require("node:path");
const { promisify } = require("node:util");
const { createBoundedCache } = require("./storage/bounded-cache");

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Extensions whose content is text-like (or wasm) and worth compressing. */
const COMPRESSIBLE_EXTENSIONS = new Set([
    ".html", ".js", ".mjs", ".cjs", ".css", ".json", ".map", ".svg", ".txt",
    ".md", ".ts", ".geojson", ".xml", ".wasm",
]);

const DEFAULTS = Object.freeze({
    enabled: true,
    minBytes: 1024,
    maxCacheBytes: 128 * 1024 * 1024,
});

let CONFIG = DEFAULTS;
let _cache = null;
/** In-flight compressions, so a burst of identical requests compresses once. */
let _pending = null;

/**
 * Apply the operator's `core.server.compression` block. `false` disables
 * compression entirely (e.g. a reverse proxy in front already does it).
 */
function setCompressionConfig(cfg) {
    if (cfg === false) {
        CONFIG = Object.freeze({ ...DEFAULTS, enabled: false });
        return;
    }
    if (!cfg || typeof cfg !== "object") return;
    const num = (v, fallback, min) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min ? n : fallback;
    };
    CONFIG = Object.freeze({
        enabled: cfg.enabled !== false,
        minBytes: num(cfg.minBytes, DEFAULTS.minBytes, 0),
        maxCacheBytes: num(cfg.maxCacheBytes, DEFAULTS.maxCacheBytes, 0),
    });
    if (_cache) _cache.reconfigure({ maxBytes: CONFIG.maxCacheBytes || null });
}

function cache() {
    if (!_cache) {
        _cache = createBoundedCache({
            name: "core:static-compressed",
            maxBytes: CONFIG.maxCacheBytes || null,
            sizeOf: (buf) => buf.length,
        });
        _pending = createBoundedCache({ name: "core:static-compressing", maxEntries: 256 });
    }
    return _cache;
}

/**
 * Pick the encoding from `Accept-Encoding`, preferring brotli. Honours an
 * explicit `q=0` refusal; anything fancier (wildcards, ordering by q) is not
 * worth the parser — every browser sends `gzip, deflate, br[, zstd]`.
 *
 * @returns {"br"|"gzip"|null}
 */
function negotiateEncoding(acceptEncoding) {
    if (!acceptEncoding || typeof acceptEncoding !== "string") return null;
    const accepted = new Set();
    for (const part of acceptEncoding.toLowerCase().split(",")) {
        const [name, ...params] = part.trim().split(";");
        const q = params.map(p => p.trim()).find(p => p.startsWith("q="));
        if (q && Number(q.slice(2)) === 0) continue;
        if (name) accepted.add(name.trim());
    }
    if (accepted.has("br")) return "br";
    if (accepted.has("gzip")) return "gzip";
    return null;
}

/** Whether a file at `filePath` of `size` bytes is a compression candidate. */
function isCompressible(filePath, size) {
    if (!CONFIG.enabled) return false;
    if (size < CONFIG.minBytes) return false;
    return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function compressBuffer(buffer, encoding, { quality } = {}) {
    if (encoding === "br") {
        return brotli(buffer, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: quality ?? 9,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
            },
        });
    }
    return gzip(buffer, { level: 9 });
}

/**
 * Compressed representation of a file's content, cached by `cacheKey` (the
 * caller passes something that changes whenever the file does — path + size +
 * mtime). Returns `null` when compression would not shrink the body.
 *
 * @param {string} cacheKey
 * @param {Buffer} buffer
 * @param {"br"|"gzip"} encoding
 * @returns {Promise<Buffer|null>}
 */
async function getCompressed(cacheKey, buffer, encoding) {
    const store = cache();
    const key = `${encoding}:${cacheKey}`;
    const hit = store.get(key);
    if (hit) return hit.length ? hit : null;

    let job = _pending.peek(key);
    if (!job) {
        // Quality 9, not 11: 11 buys a few percent but takes seconds on a
        // 1.5 MB bundle, and the first visitor after a restart waits for it.
        job = compressBuffer(buffer, encoding, { quality: 9 })
            .then((out) => {
                // An empty buffer records "not worth it" so it is not retried.
                const keep = out.length < buffer.length * 0.95 ? out : Buffer.alloc(0);
                store.set(key, keep);
                return keep.length ? keep : null;
            })
            .finally(() => _pending.delete(key));
        _pending.set(key, job);
    }
    return job;
}

/**
 * Compress a one-off body that must not be cached (the viewer page carries
 * per-session tokens). Fast brotli quality — this runs per request.
 *
 * @returns {Promise<{body: Buffer, encoding: string|null}>}
 */
async function compressDynamic(req, body) {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    const encoding = CONFIG.enabled && buffer.length >= CONFIG.minBytes
        ? negotiateEncoding(req.headers["accept-encoding"])
        : null;
    if (!encoding) return { body: buffer, encoding: null };
    try {
        const out = await compressBuffer(buffer, encoding, { quality: 5 });
        return out.length < buffer.length ? { body: out, encoding } : { body: buffer, encoding: null };
    } catch {
        return { body: buffer, encoding: null };
    }
}

/** The ETag of an encoded representation of a file whose identity ETag is `etag`. */
function encodedEtag(etag, encoding) {
    if (!encoding) return etag;
    return etag.endsWith('"') ? `${etag.slice(0, -1)}-${encoding}"` : `${etag}-${encoding}`;
}

module.exports = {
    setCompressionConfig,
    negotiateEncoding,
    isCompressible,
    getCompressed,
    compressDynamic,
    encodedEtag,
    COMPRESSIBLE_EXTENSIONS,
};
