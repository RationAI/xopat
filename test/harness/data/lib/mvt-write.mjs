/**
 * Minimal Mapbox Vector Tile writer — the polygon subset, by hand.
 *
 * The alternative is tippecanoe or ogr2ogr, i.e. asking every contributor who
 * wants to regenerate the demo data to install a C++ toolchain. The polygon
 * subset of MVT is small enough that a self-contained writer is the cheaper
 * liability, and it keeps `npm run fixtures:derive` a pure-Node command.
 *
 * Encodes `vector_tile.proto` version 2:
 *
 *     Tile    { repeated Layer layers = 3 }
 *     Layer   { name = 1, features = 2, keys = 3, values = 4, extent = 5, version = 15 }
 *     Feature { id = 1, tags = 2 [packed], type = 3, geometry = 4 [packed] }
 *     Value   { string = 1, double = 3, int64 = 4, bool = 7 }
 *
 * Geometry is the usual command/parameter stream: a CommandInteger
 * `(id & 0x7) | (count << 3)` followed by `2 * count` zigzag-encoded coordinate
 * deltas, with MoveTo = 1, LineTo = 2, ClosePath = 7.
 *
 * Winding follows the v2 spec: an exterior ring has POSITIVE shoelace area and
 * an interior ring negative, in the tile's y-down coordinate space. That is
 * already what `contour.mjs` produces, so nothing is reversed here.
 */

const GEOM_POLYGON = 3;
const CMD_MOVE_TO = 1;
const CMD_LINE_TO = 2;
const CMD_CLOSE_PATH = 7;

class Writer {
    constructor() {
        this.chunks = [];
    }

    /** @param {number} value unsigned */
    varint(value) {
        const bytes = [];
        let v = value >>> 0;
        do {
            let byte = v & 0x7f;
            v >>>= 7;
            if (v) byte |= 0x80;
            bytes.push(byte);
        } while (v);
        this.chunks.push(Buffer.from(bytes));
        return this;
    }

    /** field header: (fieldNumber << 3) | wireType */
    tag(field, wireType) {
        return this.varint((field << 3) | wireType);
    }

    /** wire type 2: length-delimited */
    bytes(field, buf) {
        this.tag(field, 2).varint(buf.length);
        this.chunks.push(buf);
        return this;
    }

    string(field, str) {
        return this.bytes(field, Buffer.from(str, "utf8"));
    }

    /** wire type 0: varint */
    uint(field, value) {
        return this.tag(field, 0).varint(value);
    }

    double(field, value) {
        const buf = Buffer.alloc(8);
        buf.writeDoubleLE(value, 0);
        this.tag(field, 1);
        this.chunks.push(buf);
        return this;
    }

    finish() {
        return Buffer.concat(this.chunks);
    }
}

const zigzag = (n) => (n << 1) ^ (n >> 31);
const command = (id, count) => (id & 0x7) | (count << 3);

/** Pack an array of uint32 as a packed repeated field. */
function packed(field, values) {
    const inner = new Writer();
    for (const v of values) inner.varint(v);
    const buf = inner.finish();
    const out = new Writer();
    out.bytes(field, buf);
    return out.finish();
}

/**
 * Encode one polygon's rings as an MVT geometry command stream.
 *
 * @param {number[][][]} rings closed rings in tile coordinates (first vertex
 *     repeated as last), exterior first
 * @return {number[]} command/parameter integers
 */
export function encodePolygonGeometry(rings) {
    const geometry = [];
    let cx = 0;
    let cy = 0;

    for (const ring of rings) {
        // The closing repeat is implicit in ClosePath and must not be emitted.
        const points = ring.slice(0, ring.length - 1);
        if (points.length < 3) continue;

        geometry.push(command(CMD_MOVE_TO, 1));
        geometry.push(zigzag(points[0][0] - cx), zigzag(points[0][1] - cy));
        cx = points[0][0];
        cy = points[0][1];

        geometry.push(command(CMD_LINE_TO, points.length - 1));
        for (let i = 1; i < points.length; i++) {
            geometry.push(zigzag(points[i][0] - cx), zigzag(points[i][1] - cy));
            cx = points[i][0];
            cy = points[i][1];
        }

        geometry.push(command(CMD_CLOSE_PATH, 1));
    }
    return geometry;
}

/**
 * Build one vector tile.
 *
 * @param {Array<{name: string, extent?: number, features: Array<{id?: number, properties?: object, rings: number[][][]}>}>} layers
 * @return {Buffer} the `.pbf` body
 */
export function encodeTile(layers) {
    const tile = new Writer();

    for (const layer of layers) {
        if (!layer.features.length) continue;
        const extent = layer.extent || 4096;

        // Property dictionaries are per layer: a feature's `tags` are pairs of
        // indexes into `keys` and `values`.
        const keys = [];
        const keyIndex = new Map();
        const values = [];
        const valueIndex = new Map();

        const internKey = (k) => {
            let i = keyIndex.get(k);
            if (i === undefined) {
                i = keys.length;
                keys.push(k);
                keyIndex.set(k, i);
            }
            return i;
        };
        const internValue = (v) => {
            const signature = typeof v + ":" + String(v);
            let i = valueIndex.get(signature);
            if (i === undefined) {
                i = values.length;
                values.push(v);
                valueIndex.set(signature, i);
            }
            return i;
        };

        const featureBuffers = [];
        for (const feature of layer.features) {
            const geometry = encodePolygonGeometry(feature.rings);
            if (!geometry.length) continue;

            const tags = [];
            for (const [k, v] of Object.entries(feature.properties || {})) {
                if (v === undefined || v === null) continue;
                tags.push(internKey(k), internValue(v));
            }

            const fw = new Writer();
            if (feature.id !== undefined) fw.uint(1, feature.id);
            if (tags.length) fw.chunks.push(packed(2, tags));
            fw.uint(3, GEOM_POLYGON);
            fw.chunks.push(packed(4, geometry));
            featureBuffers.push(fw.finish());
        }
        if (!featureBuffers.length) continue;

        const lw = new Writer();
        lw.string(1, layer.name);
        for (const buf of featureBuffers) lw.bytes(2, buf);
        for (const key of keys) lw.string(3, key);
        for (const value of values) {
            const vw = new Writer();
            if (typeof value === "string") vw.string(1, value);
            else if (typeof value === "boolean") vw.uint(7, value ? 1 : 0);
            else if (Number.isInteger(value) && value >= 0) vw.uint(5, value);
            else vw.double(3, value);
            lw.bytes(4, vw.finish());
        }
        lw.uint(5, extent);
        lw.uint(15, 2); // version

        tile.bytes(3, lw.finish());
    }

    return tile.finish();
}

/**
 * Clip a ring to an axis-aligned rectangle (Sutherland–Hodgman).
 *
 * The clip region is convex and the rings are simple, which is exactly the case
 * this algorithm is correct for. Holes are clipped independently of their
 * exterior, which is fine here: a hole clipped away entirely simply disappears,
 * and a hole clipped in half stays a valid interior ring of the clipped
 * exterior.
 *
 * @param {number[][]} ring closed ring
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @return {number[][]|null} closed clipped ring, or null when nothing remains
 */
export function clipRing(ring, minX, minY, maxX, maxY) {
    const edges = [
        { inside: (p) => p[0] >= minX, cut: (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])] },
        { inside: (p) => p[0] <= maxX, cut: (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])] },
        { inside: (p) => p[1] >= minY, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY] },
        { inside: (p) => p[1] <= maxY, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY] },
    ];

    let points = ring.slice(0, ring.length - 1);
    for (const edge of edges) {
        if (!points.length) return null;
        const next = [];
        for (let i = 0; i < points.length; i++) {
            const cur = points[i];
            const prev = points[(i - 1 + points.length) % points.length];
            const curIn = edge.inside(cur);
            const prevIn = edge.inside(prev);
            if (curIn) {
                if (!prevIn) next.push(edge.cut(prev, cur));
                next.push(cur);
            } else if (prevIn) {
                next.push(edge.cut(prev, cur));
            }
        }
        points = next;
    }

    if (points.length < 3) return null;
    return points.concat([points[0]]);
}
