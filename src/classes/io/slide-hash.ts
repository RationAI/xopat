/**
 * Keyed slide identity for `{slideHash}`.
 *
 * `{slideHash}` names stored data (GitHub paths, MLflow runs) by the slide it
 * belongs to. An unkeyed hash of the slide path is reversible offline: slide
 * paths follow guessable patterns (case numbers), so anyone holding only the
 * stored data can hash candidate paths until one matches. A keyed HMAC with an
 * operator secret (`ENV.client.io.slideHashKey`) closes that — without the key,
 * a candidate path cannot be checked.
 *
 * Synchronous on purpose: `IO_PIPELINE.formatPath` is synchronous and called
 * from inside sink option composition, so WebCrypto (async only) does not fit.
 * The key is delivered to the browser, so a viewer user can see it; the threat
 * this addresses is the holder of the stored data, not the viewer user.
 */

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of `data`. */
export function sha256(data: Uint8Array): Uint8Array {
    const bitLen = data.length * 8;
    const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    // Messages here are far below 2^32 bits; the high word stays zero.
    view.setUint32(padded.length - 4, bitLen >>> 0);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));

    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    // Typed-array reads are always in bounds here; `!` only satisfies
    // `noUncheckedIndexedAccess`.
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const w15 = w[i - 15]!, w2 = w[i - 2]!;
            const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
            const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
            w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
        }
        let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            hh = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        const add = [a, b, c, d, e, f, g, hh];
        for (let i = 0; i < 8; i++) h[i] = h[i]! + add[i]!;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!);
    return out;
}

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 (RFC 2104) over UTF-8 `key` and `message`, as lowercase hex. */
export function hmacSha256Hex(key: string, message: string): string {
    const enc = new TextEncoder();
    let k: Uint8Array = enc.encode(key);
    if (k.length > 64) k = sha256(k);
    const block = new Uint8Array(64);
    block.set(k);
    const inner = new Uint8Array(64);
    const outer = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
        inner[i] = block[i]! ^ 0x36;
        outer[i] = block[i]! ^ 0x5c;
    }
    const msg = enc.encode(message);
    const innerInput = new Uint8Array(64 + msg.length);
    innerInput.set(inner);
    innerInput.set(msg, 64);
    const innerHash = sha256(innerInput);
    const outerInput = new Uint8Array(64 + 32);
    outerInput.set(outer);
    outerInput.set(innerHash, 64);
    return toHex(sha256(outerInput));
}

/** `{slideHash}` value: the first 16 hex chars of HMAC-SHA256(key, canonical slide entry). */
export function slideHashOf(key: string, canonical: string): string {
    return hmacSha256Hex(key, canonical).slice(0, 16);
}
