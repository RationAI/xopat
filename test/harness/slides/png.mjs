/**
 * Minimal PNG encoder — enough for synthetic test tiles, nothing more.
 *
 * Written by hand rather than pulled in as a dependency: the whole point of the
 * synthetic slide is that a checkout can run browser tests with no external
 * data, no image service and no extra install. A ~70-line encoder over the
 * `node:zlib` already in the runtime is a smaller liability than another
 * package in the tree.
 *
 * 8-bit RGBA, filter type 0 on every scanline. No interlacing, no palettes.
 */
import zlib from "node:zlib";

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, body, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba  width*height*4 bytes
 * @returns {Buffer} a complete PNG file
 */
export function encodePng(width, height, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type: truecolour with alpha
    ihdr[10] = 0;  // deflate
    ihdr[11] = 0;  // adaptive filtering
    ihdr[12] = 0;  // no interlace

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
            .copy(raw, y * (stride + 1) + 1);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}
