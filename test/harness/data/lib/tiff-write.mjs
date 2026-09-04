/**
 * Minimal tiled, multi-level TIFF writer — 8-bit grayscale, Deflate.
 *
 * Writes exactly the shape `tiff-read.mjs` parses out of the real source masks
 * (tiled 256x256, Adobe Deflate, 8 bits, one sample, chunky, no predictor,
 * one IFD per pyramid level with `NewSubfileType = 1` on the reduced ones), so
 * a mask produced here is structurally the same kind of file as the ones the
 * viewer already opens. That is deliberate: the demo should not depend on
 * `modules/webtiff` handling a layout nothing else in the repo produces.
 *
 * Classic TIFF (magic 42), not BigTIFF: the generated masks are a few megabytes,
 * far below the 4 GB offset limit, and classic is the more widely readable of
 * the two.
 */
import zlib from "node:zlib";

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const COMPRESSION_DEFLATE = 8;
const PHOTOMETRIC_MIN_IS_BLACK = 1;

/**
 * One level to write.
 * @typedef {object} TiffWriteLevel
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} pixels `width * height` bytes
 */

/**
 * Cut a level into tiles, padding the right/bottom edge tiles with zeros as the
 * TIFF spec requires (a tile is always full-sized on disk; the image dimensions
 * say how much of it is meaningful).
 */
function deflateTiles(level, tileSize) {
    const across = Math.ceil(level.width / tileSize);
    const down = Math.ceil(level.height / tileSize);
    const tiles = [];

    for (let row = 0; row < down; row++) {
        for (let col = 0; col < across; col++) {
            const tile = new Uint8Array(tileSize * tileSize);
            const x0 = col * tileSize;
            const y0 = row * tileSize;
            const copyW = Math.min(tileSize, level.width - x0);
            const copyH = Math.min(tileSize, level.height - y0);
            for (let y = 0; y < copyH; y++) {
                const src = (y0 + y) * level.width + x0;
                tile.set(level.pixels.subarray(src, src + copyW), y * tileSize);
            }
            tiles.push(zlib.deflateSync(Buffer.from(tile.buffer, tile.byteOffset, tile.length), { level: 9 }));
        }
    }
    return { tiles, across, down };
}

/**
 * Encode a pyramid.
 *
 * @param {TiffWriteLevel[]} levels finest first; the writer marks every level
 *     after the first as a reduced-resolution subfile
 * @param {number} [tileSize=256]
 * @return {Buffer} a complete TIFF file
 */
export function encodeTiff(levels, tileSize = 256) {
    if (!levels.length) throw new Error("[tiff-write] no levels to write");

    const prepared = levels.map(level => {
        if (level.pixels.length !== level.width * level.height) {
            throw new Error(`[tiff-write] level ${level.width}x${level.height} has ` +
                `${level.pixels.length} bytes, expected ${level.width * level.height}`);
        }
        return { level, ...deflateTiles(level, tileSize) };
    });

    // Pass 1 — lay out the file so every offset is known before an IFD is built.
    // Order: header, tile data, per-level offset/bytecount arrays, IFDs.
    let cursor = 8;
    for (const p of prepared) {
        p.tileOffsets = [];
        p.tileByteCounts = [];
        for (const tile of p.tiles) {
            p.tileOffsets.push(cursor);
            p.tileByteCounts.push(tile.length);
            cursor += tile.length;
        }
    }
    for (const p of prepared) {
        // A single-value LONG field is stored inline; only arrays need space.
        p.offsetsAt = p.tiles.length > 1 ? (cursor += p.tiles.length * 4, cursor - p.tiles.length * 4) : 0;
        p.countsAt = p.tiles.length > 1 ? (cursor += p.tiles.length * 4, cursor - p.tiles.length * 4) : 0;
    }

    const ENTRY_COUNT = 12;
    const ifdSize = 2 + ENTRY_COUNT * 12 + 4;
    for (const p of prepared) {
        p.ifdAt = cursor;
        cursor += ifdSize;
    }

    // Pass 2 — emit.
    const parts = [];
    const header = Buffer.alloc(8);
    header.write("II", 0, "ascii");
    header.writeUInt16LE(42, 2);
    header.writeUInt32LE(prepared[0].ifdAt, 4);
    parts.push(header);

    for (const p of prepared) parts.push(...p.tiles);

    for (const p of prepared) {
        if (!p.offsetsAt) continue;
        const offsets = Buffer.alloc(p.tiles.length * 4);
        const counts = Buffer.alloc(p.tiles.length * 4);
        for (let i = 0; i < p.tiles.length; i++) {
            offsets.writeUInt32LE(p.tileOffsets[i], i * 4);
            counts.writeUInt32LE(p.tileByteCounts[i], i * 4);
        }
        parts.push(offsets, counts);
    }

    prepared.forEach((p, index) => {
        const ifd = Buffer.alloc(ifdSize);
        ifd.writeUInt16LE(ENTRY_COUNT, 0);

        let at = 2;
        /** Entries MUST be written in ascending tag order — readers rely on it. */
        const entry = (tag, type, count, value) => {
            ifd.writeUInt16LE(tag, at);
            ifd.writeUInt16LE(type, at + 2);
            ifd.writeUInt32LE(count, at + 4);
            // A SHORT stored inline occupies the first two bytes of the value
            // field, not the last; writing it as a LONG would be read as 0.
            if (type === TYPE_SHORT && count === 1) ifd.writeUInt16LE(value, at + 8);
            else ifd.writeUInt32LE(value, at + 8);
            at += 12;
        };

        const single = p.tiles.length === 1;
        entry(254, TYPE_LONG, 1, index === 0 ? 0 : 1);          // NewSubfileType
        entry(256, TYPE_LONG, 1, p.level.width);                 // ImageWidth
        entry(257, TYPE_LONG, 1, p.level.height);                // ImageLength
        entry(258, TYPE_SHORT, 1, 8);                            // BitsPerSample
        entry(259, TYPE_SHORT, 1, COMPRESSION_DEFLATE);          // Compression
        entry(262, TYPE_SHORT, 1, PHOTOMETRIC_MIN_IS_BLACK);     // Photometric
        entry(277, TYPE_SHORT, 1, 1);                            // SamplesPerPixel
        entry(284, TYPE_SHORT, 1, 1);                            // PlanarConfiguration
        entry(322, TYPE_LONG, 1, tileSize);                      // TileWidth
        entry(323, TYPE_LONG, 1, tileSize);                      // TileLength
        entry(324, TYPE_LONG, p.tiles.length, single ? p.tileOffsets[0] : p.offsetsAt);
        entry(325, TYPE_LONG, p.tiles.length, single ? p.tileByteCounts[0] : p.countsAt);

        const next = prepared[index + 1];
        ifd.writeUInt32LE(next ? next.ifdAt : 0, at);
        parts.push(ifd);
    });

    return Buffer.concat(parts);
}

/**
 * Box-downsample an 8-bit raster by an arbitrary factor.
 *
 * Averaging rather than nearest: these are prediction scores, and dropping
 * three of every four is how a coarse level stops agreeing with the fine one.
 *
 * @param {Uint8Array} src
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @return {Uint8Array}
 */
export function boxResample(src, srcW, srcH, dstW, dstH) {
    const dst = new Uint8Array(dstW * dstH);
    const sx = srcW / dstW;
    const sy = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
        const y0 = Math.floor(y * sy);
        const y1 = Math.max(y0 + 1, Math.min(srcH, Math.ceil((y + 1) * sy)));
        for (let x = 0; x < dstW; x++) {
            const x0 = Math.floor(x * sx);
            const x1 = Math.max(x0 + 1, Math.min(srcW, Math.ceil((x + 1) * sx)));
            let sum = 0;
            let n = 0;
            for (let yy = y0; yy < y1; yy++) {
                const row = yy * srcW;
                for (let xx = x0; xx < x1; xx++) { sum += src[row + xx]; n++; }
            }
            dst[y * dstW + x] = n ? Math.round(sum / n) : 0;
        }
    }
    return dst;
}
