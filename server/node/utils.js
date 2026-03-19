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

async function rawReqToString (req) {
    const buffers = [];
    for await (const chunk of req) {
        buffers.push(chunk);
    }
    return Buffer.concat(buffers).toString();
}

function base64UrlToBuffer(b64url) {
    let s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
}


module.exports = {
    mimeOf, rawReqToString, base64UrlToBuffer
}