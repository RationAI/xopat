/**
 * Minimal TIFF / BigTIFF reader — exactly the shape the demo's source masks are
 * in, and nothing else.
 *
 * Deliberately not `geotiff` or any other package. This is a dev-only tool that
 * reads exactly two files, both of which were probed before this was written:
 *
 *     cancer-inference.tif   BigTIFF LE, 105185x221772, tiled 256, Deflate, 8-bit, 1 sample, 11 IFDs
 *     detection.tiff         BigTIFF LE,  52592x110886, tiled 256, Deflate, 8-bit, 1 sample, 10 IFDs
 *
 * `node:zlib` covers the decompression, so the whole reader is header walking.
 * Adding a dependency to the tree for that would be the wrong trade — but the
 * corollary is that this reader must FAIL LOUDLY on anything outside that
 * envelope rather than silently producing garbage. Every unsupported feature
 * below throws with the tag value that caused it.
 *
 * Unsupported on purpose: strips (only tiles), compression other than none/
 * Deflate (so no JPEG — `slide.tif` is never read here), bit depths other than
 * 8, multi-sample pixels, planar configuration 2, and horizontal prediction.
 */
import fs from "node:fs";
import zlib from "node:zlib";

// TIFF tags we care about. Everything else in an IFD is skipped.
const TAG = {
    IMAGE_WIDTH: 256,
    IMAGE_LENGTH: 257,
    BITS_PER_SAMPLE: 258,
    COMPRESSION: 259,
    PHOTOMETRIC: 262,
    SAMPLES_PER_PIXEL: 277,
    PLANAR_CONFIG: 284,
    PREDICTOR: 317,
    TILE_WIDTH: 322,
    TILE_LENGTH: 323,
    TILE_OFFSETS: 324,
    TILE_BYTE_COUNTS: 325,
};

const COMPRESSION_NONE = 1;
const COMPRESSION_DEFLATE_ADOBE = 8;
const COMPRESSION_DEFLATE_OLD = 32946;

/** Byte width of each TIFF field type, indexed by the type code. */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

class Reader {
    constructor(fd, littleEndian) {
        this.fd = fd;
        this.le = littleEndian;
    }

    read(offset, length) {
        const buf = Buffer.alloc(length);
        const got = fs.readSync(this.fd, buf, 0, length, offset);
        if (got !== length) {
            throw new Error(`[tiff-read] short read at ${offset}: wanted ${length}, got ${got}`);
        }
        return buf;
    }

    u16(buf, at) { return this.le ? buf.readUInt16LE(at) : buf.readUInt16BE(at); }
    u32(buf, at) { return this.le ? buf.readUInt32LE(at) : buf.readUInt32BE(at); }
    u64(buf, at) { return Number(this.le ? buf.readBigUInt64LE(at) : buf.readBigUInt64BE(at)); }
}

/**
 * Read one field's values. Values that do not fit inline live at an offset.
 *
 * Only integer field types are decoded — those are the only ones any tag in
 * {@link TAG} uses. A field of some other type (RATIONAL resolution tags,
 * ASCII software strings, …) is simply not our business: it is skipped by the
 * caller before it ever reaches here, so an unrelated tag in a perfectly
 * readable file cannot fail the parse.
 *
 * @return {number[]}
 */
function readFieldValues(r, big, entry, at) {
    const type = r.u16(entry, at + 2);
    const count = big ? r.u64(entry, at + 4) : r.u32(entry, at + 4);
    const size = TYPE_SIZE[type];
    if (!size) throw new Error(`[tiff-read] unsupported field type ${type}`);

    const inlineCapacity = big ? 8 : 4;
    const total = size * count;
    const valueAt = at + (big ? 12 : 8);

    let bytes;
    if (total <= inlineCapacity) {
        bytes = entry.subarray(valueAt, valueAt + total);
    } else {
        const offset = big ? r.u64(entry, valueAt) : r.u32(entry, valueAt);
        bytes = r.read(offset, total);
    }

    const out = new Array(count);
    for (let i = 0; i < count; i++) {
        const o = i * size;
        switch (type) {
            case 1: case 2: case 6: case 7: out[i] = bytes[o]; break;
            case 3: out[i] = r.le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o); break;
            case 8: out[i] = r.le ? bytes.readInt16LE(o) : bytes.readInt16BE(o); break;
            case 4: out[i] = r.le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o); break;
            case 9: out[i] = r.le ? bytes.readInt32LE(o) : bytes.readInt32BE(o); break;
            case 16: case 17: out[i] = Number(r.le ? bytes.readBigUInt64LE(o) : bytes.readBigUInt64BE(o)); break;
            default: throw new Error(`[tiff-read] unsupported field type ${type}`);
        }
    }
    return out;
}

/** The tags this reader actually consumes; everything else in an IFD is skipped. */
const WANTED_TAGS = new Set(Object.values(TAG));

/** Parse one IFD into a `{tag: values[]}` map plus the next IFD offset. */
function readIfd(r, big, offset) {
    const countBuf = r.read(offset, big ? 8 : 2);
    const count = big ? r.u64(countBuf, 0) : r.u16(countBuf, 0);
    const entrySize = big ? 20 : 12;
    const entries = r.read(offset + (big ? 8 : 2), count * entrySize);

    const fields = {};
    for (let i = 0; i < count; i++) {
        const at = i * entrySize;
        const tag = r.u16(entries, at);
        // Decode only what we read. A real pyramid carries RATIONAL resolution
        // tags, ASCII descriptions and vendor blobs; none of them are a reason
        // to refuse a file whose geometry is perfectly readable.
        if (!WANTED_TAGS.has(tag)) continue;
        fields[tag] = readFieldValues(r, big, entries, at);
    }

    const nextAt = offset + (big ? 8 : 2) + count * entrySize;
    const nextBuf = r.read(nextAt, big ? 8 : 4);
    const next = big ? r.u64(nextBuf, 0) : r.u32(nextBuf, 0);
    return { fields, next };
}

/**
 * One pyramid level: geometry plus where its tiles live.
 * @typedef {object} TiffLevel
 * @property {number} index      IFD index, 0 = full resolution
 * @property {number} width
 * @property {number} height
 * @property {number} tileWidth
 * @property {number} tileHeight
 * @property {number} tilesAcross
 * @property {number} tilesDown
 */

/**
 * Open a TIFF and describe its levels. Throws on anything outside the supported
 * envelope described in the file header.
 *
 * @param {string} filePath
 * @return {{levels: TiffLevel[], close(): void, readLevelRegion(level:number, x0:number, y0:number, x1:number, y1:number): Uint8Array}}
 */
export function openTiff(filePath) {
    const fd = fs.openSync(filePath, "r");

    let header;
    try {
        header = Buffer.alloc(16);
        fs.readSync(fd, header, 0, 16, 0);
    } catch (e) {
        fs.closeSync(fd);
        throw e;
    }

    const order = header.toString("ascii", 0, 2);
    if (order !== "II" && order !== "MM") {
        fs.closeSync(fd);
        throw new Error(`[tiff-read] ${filePath}: not a TIFF (byte order "${order}")`);
    }
    const r = new Reader(fd, order === "II");

    const magic = r.u16(header, 2);
    const big = magic === 43;
    if (magic !== 42 && magic !== 43) {
        fs.closeSync(fd);
        throw new Error(`[tiff-read] ${filePath}: bad magic ${magic} (expected 42 or 43)`);
    }

    const firstIfd = big ? r.u64(header, 8) : r.u32(header, 4);

    const levels = [];
    const raw = [];
    let offset = firstIfd;
    let index = 0;
    // A pyramid of a 200k-pixel slide is ~11 IFDs; the bound is a runaway guard
    // for a malformed chain, not a real limit.
    while (offset && index < 64) {
        const { fields, next } = readIfd(r, big, offset);
        const one = (tag, dflt) => (fields[tag] === undefined ? dflt : fields[tag][0]);

        const width = one(TAG.IMAGE_WIDTH);
        const height = one(TAG.IMAGE_LENGTH);
        const tileWidth = one(TAG.TILE_WIDTH);
        const tileHeight = one(TAG.TILE_LENGTH);

        if (tileWidth === undefined || tileHeight === undefined) {
            fs.closeSync(fd);
            throw new Error(`[tiff-read] ${filePath} IFD ${index}: striped images are not supported, only tiled`);
        }
        const compression = one(TAG.COMPRESSION, COMPRESSION_NONE);
        if (compression !== COMPRESSION_NONE
            && compression !== COMPRESSION_DEFLATE_ADOBE
            && compression !== COMPRESSION_DEFLATE_OLD) {
            fs.closeSync(fd);
            throw new Error(`[tiff-read] ${filePath} IFD ${index}: compression ${compression} is not supported ` +
                `(only 1=none, 8/32946=Deflate). JPEG-compressed slides must be read by the viewer, not by this tool.`);
        }
        const bits = one(TAG.BITS_PER_SAMPLE, 8);
        const samples = one(TAG.SAMPLES_PER_PIXEL, 1);
        const planar = one(TAG.PLANAR_CONFIG, 1);
        const predictor = one(TAG.PREDICTOR, 1);
        if (bits !== 8 || samples !== 1 || planar !== 1 || predictor !== 1) {
            fs.closeSync(fd);
            throw new Error(`[tiff-read] ${filePath} IFD ${index}: unsupported layout ` +
                `(bits=${bits}, samples=${samples}, planar=${planar}, predictor=${predictor}); ` +
                `only 8-bit single-sample chunky data without prediction is handled`);
        }

        const tilesAcross = Math.ceil(width / tileWidth);
        const tilesDown = Math.ceil(height / tileHeight);

        levels.push({ index, width, height, tileWidth, tileHeight, tilesAcross, tilesDown });
        raw.push({
            compression,
            offsets: fields[TAG.TILE_OFFSETS] || [],
            byteCounts: fields[TAG.TILE_BYTE_COUNTS] || [],
        });

        offset = next;
        index++;
    }

    if (!levels.length) {
        fs.closeSync(fd);
        throw new Error(`[tiff-read] ${filePath}: no readable IFD`);
    }

    const inflate = (buf, compression) =>
        compression === COMPRESSION_NONE ? buf : zlib.inflateSync(buf);

    return {
        levels,

        /**
         * Decode the rectangle `[x0,y0)-(x1,y1)` of one level into a tightly
         * packed 8-bit buffer. Only the tiles the rectangle touches are read
         * and inflated.
         *
         * @return {Uint8Array} `(x1-x0) * (y1-y0)` bytes, row-major
         */
        readLevelRegion(level, x0, y0, x1, y1) {
            const lv = levels[level];
            if (!lv) throw new Error(`[tiff-read] no such level ${level}`);
            const meta = raw[level];

            x0 = Math.max(0, Math.min(lv.width, Math.floor(x0)));
            y0 = Math.max(0, Math.min(lv.height, Math.floor(y0)));
            x1 = Math.max(x0, Math.min(lv.width, Math.ceil(x1)));
            y1 = Math.max(y0, Math.min(lv.height, Math.ceil(y1)));

            const outW = x1 - x0;
            const outH = y1 - y0;
            const out = new Uint8Array(outW * outH);
            if (!outW || !outH) return out;

            const colFrom = Math.floor(x0 / lv.tileWidth);
            const colTo = Math.floor((x1 - 1) / lv.tileWidth);
            const rowFrom = Math.floor(y0 / lv.tileHeight);
            const rowTo = Math.floor((y1 - 1) / lv.tileHeight);

            for (let row = rowFrom; row <= rowTo; row++) {
                for (let col = colFrom; col <= colTo; col++) {
                    const tileIndex = row * lv.tilesAcross + col;
                    const byteCount = meta.byteCounts[tileIndex];
                    // A sparse pyramid may omit an empty tile; treat it as zeros.
                    if (!byteCount) continue;

                    const compressed = r.read(meta.offsets[tileIndex], byteCount);
                    const tile = inflate(compressed, meta.compression);

                    const tileX = col * lv.tileWidth;
                    const tileY = row * lv.tileHeight;
                    const copyX0 = Math.max(x0, tileX);
                    const copyY0 = Math.max(y0, tileY);
                    const copyX1 = Math.min(x1, tileX + lv.tileWidth);
                    const copyY1 = Math.min(y1, tileY + lv.tileHeight);

                    for (let y = copyY0; y < copyY1; y++) {
                        const srcRow = (y - tileY) * lv.tileWidth;
                        const dstRow = (y - y0) * outW;
                        for (let x = copyX0; x < copyX1; x++) {
                            out[dstRow + (x - x0)] = tile[srcRow + (x - tileX)];
                        }
                    }
                }
            }
            return out;
        },

        close() { fs.closeSync(fd); },
    };
}

/**
 * Pick the coarsest level whose long edge is still at least `minLongEdge`.
 * Reading a 1–2 Mpx level of a 23 Gpx pyramid is what keeps the generator
 * sub-second; the caller scales the result back up to slide coordinates.
 *
 * @param {TiffLevel[]} levels
 * @param {number} minLongEdge
 * @return {TiffLevel}
 */
export function pickWorkingLevel(levels, minLongEdge) {
    let chosen = levels[0];
    for (const lv of levels) {
        if (Math.max(lv.width, lv.height) >= minLongEdge) chosen = lv;
    }
    return chosen;
}
