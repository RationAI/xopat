const path = require("node:path");

function mimeOf(p) {
    const ext = path.extname(p).toLowerCase();
    return  {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm',
    }[ext] || 'application/octet-stream';
}

/**
 * Absolute ceiling on a body read through `rawReqToString`, mirroring the RPC
 * path's `XOPAT_RPC_MAX_BODY_BYTES`.
 *
 * This function serves `/proxy/*` and the `responseViewer` POST, and it used to
 * buffer whatever the peer sent — the RPC route was the only one with a cap, so
 * these two were the cheapest way to make the server allocate without bound.
 */
const MAX_RAW_BODY_BYTES = Math.max(65536, Number(process.env.XOPAT_RPC_MAX_BODY_BYTES) || 16 * 1024 * 1024);

class RawBodyTooLargeError extends Error {
    constructor(limit) {
        super(`Request body exceeds the ${limit} byte limit.`);
        this.name = "RawBodyTooLargeError";
        this.code = "RAW_BODY_TOO_LARGE";
        this.statusCode = 413;
    }
}

async function rawReqToBuffer (req, maxBytes = MAX_RAW_BODY_BYTES) {
    const buffers = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) {
            // Stop reading rather than finish buffering and then complain — the
            // point of the limit is the allocation, not the verdict.
            //
            // `pause()`, NOT `destroy()`: destroying the request tears down the
            // socket, so the 413 the caller needs can never be written and they
            // just see a connection reset. The handler answers first; the socket
            // is closed by the `Connection: close` on that response.
            req.pause();
            throw new RawBodyTooLargeError(maxBytes);
        }
        buffers.push(chunk);
    }
    return Buffer.concat(buffers);
}

/**
 * UTF-8 text form of the body. Only for callers that genuinely want text (the
 * viewer POST, which is form-urlencoded or JSON).
 *
 * `/proxy/*` must NOT use this: decoding arbitrary upload bytes as UTF-8 and
 * letting `fetch` re-encode them corrupts every non-text payload (STOW-RS
 * multipart, audio uploads) and silently disagrees with the forwarded
 * `Content-Length`. Use `rawReqToBuffer` there.
 */
async function rawReqToString (req, maxBytes = MAX_RAW_BODY_BYTES) {
    return (await rawReqToBuffer(req, maxBytes)).toString();
}

function base64UrlToBuffer(b64url) {
    let s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
}


module.exports = {
    mimeOf, rawReqToString, rawReqToBuffer, base64UrlToBuffer, RawBodyTooLargeError, MAX_RAW_BODY_BYTES
}