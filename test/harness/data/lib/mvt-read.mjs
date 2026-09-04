/**
 * Minimal MVT reader — exists to verify {@link ./mvt-write.mjs}.
 *
 * A hand-rolled protobuf writer that is never decoded is a hand-rolled protobuf
 * writer that is probably wrong, and the failure mode is a tile the viewer
 * silently renders as empty. So the round trip is part of the tool, and the
 * unit test in `test/suites/unit/` drives both halves.
 *
 * Reads only what the writer emits: polygon features, packed tags and geometry,
 * string/uint/double values.
 */

const CMD_MOVE_TO = 1;
const CMD_LINE_TO = 2;
const CMD_CLOSE_PATH = 7;

class Cursor {
    constructor(buf, start = 0, end = buf.length) {
        this.buf = buf;
        this.pos = start;
        this.end = end;
    }

    get done() { return this.pos >= this.end; }

    varint() {
        let result = 0;
        let shift = 0;
        for (;;) {
            const byte = this.buf[this.pos++];
            result |= (byte & 0x7f) << shift;
            if (!(byte & 0x80)) break;
            shift += 7;
            if (shift > 35) throw new Error("[mvt-read] varint too long");
        }
        return result >>> 0;
    }

    /** @return {{field: number, wire: number}} */
    tag() {
        const key = this.varint();
        return { field: key >>> 3, wire: key & 0x7 };
    }

    slice() {
        const length = this.varint();
        const start = this.pos;
        this.pos += length;
        return new Cursor(this.buf, start, start + length);
    }

    double() {
        const value = this.buf.readDoubleLE(this.pos);
        this.pos += 8;
        return value;
    }

    /** Advance past a field whose contents we do not read. */
    skip(wire) {
        if (wire === 0) this.varint();
        else if (wire === 1) this.pos += 8;
        else if (wire === 2) this.pos += this.varint();
        else if (wire === 5) this.pos += 4;
        else throw new Error(`[mvt-read] unsupported wire type ${wire}`);
    }
}

const unzigzag = (n) => (n >>> 1) ^ -(n & 1);

/** Decode a geometry command stream back into closed rings. */
function decodeGeometry(values) {
    const rings = [];
    let ring = null;
    let x = 0;
    let y = 0;
    let i = 0;

    while (i < values.length) {
        const cmd = values[i] & 0x7;
        const count = values[i] >> 3;
        i++;
        if (cmd === CMD_MOVE_TO) {
            for (let n = 0; n < count; n++) {
                x += unzigzag(values[i++]);
                y += unzigzag(values[i++]);
                if (ring && ring.length) rings.push(ring.concat([ring[0]]));
                ring = [[x, y]];
            }
        } else if (cmd === CMD_LINE_TO) {
            for (let n = 0; n < count; n++) {
                x += unzigzag(values[i++]);
                y += unzigzag(values[i++]);
                ring.push([x, y]);
            }
        } else if (cmd === CMD_CLOSE_PATH) {
            if (ring && ring.length) {
                rings.push(ring.concat([ring[0]]));
                ring = null;
            }
        } else {
            throw new Error(`[mvt-read] unknown command ${cmd}`);
        }
    }
    if (ring && ring.length) rings.push(ring.concat([ring[0]]));
    return rings;
}

function readPacked(cursor) {
    const out = [];
    while (!cursor.done) out.push(cursor.varint());
    return out;
}

/**
 * Decode a tile.
 * @param {Buffer} buf
 * @return {Array<{name: string, extent: number, version: number, features: Array<{id?: number, properties: object, rings: number[][][]}>}>}
 */
export function decodeTile(buf) {
    const layers = [];
    const root = new Cursor(buf);
    while (!root.done) {
        const { field, wire } = root.tag();
        if (field !== 3 || wire !== 2) { root.skip(wire); continue; }

        const lc = root.slice();
        const layer = { name: "", extent: 4096, version: 1, features: [] };
        const rawFeatures = [];
        const keys = [];
        const values = [];

        while (!lc.done) {
            const f = lc.tag();
            if (f.field === 1 && f.wire === 2) {
                const s = lc.slice();
                layer.name = s.buf.toString("utf8", s.pos, s.end);
            } else if (f.field === 2 && f.wire === 2) {
                rawFeatures.push(lc.slice());
            } else if (f.field === 3 && f.wire === 2) {
                const s = lc.slice();
                keys.push(s.buf.toString("utf8", s.pos, s.end));
            } else if (f.field === 4 && f.wire === 2) {
                const vc = lc.slice();
                let value = null;
                while (!vc.done) {
                    const v = vc.tag();
                    if (v.field === 1 && v.wire === 2) {
                        const s = vc.slice();
                        value = s.buf.toString("utf8", s.pos, s.end);
                    } else if (v.field === 3 && v.wire === 1) {
                        value = vc.double();
                    } else if ((v.field === 4 || v.field === 5) && v.wire === 0) {
                        value = vc.varint();
                    } else if (v.field === 7 && v.wire === 0) {
                        value = vc.varint() !== 0;
                    } else {
                        vc.skip(v.wire);
                    }
                }
                values.push(value);
            } else if (f.field === 5 && f.wire === 0) {
                layer.extent = lc.varint();
            } else if (f.field === 15 && f.wire === 0) {
                layer.version = lc.varint();
            } else {
                lc.skip(f.wire);
            }
        }

        for (const fc of rawFeatures) {
            const feature = { properties: {}, rings: [] };
            let tags = [];
            while (!fc.done) {
                const f = fc.tag();
                if (f.field === 1 && f.wire === 0) feature.id = fc.varint();
                else if (f.field === 2 && f.wire === 2) tags = readPacked(fc.slice());
                else if (f.field === 3 && f.wire === 0) feature.type = fc.varint();
                else if (f.field === 4 && f.wire === 2) feature.rings = decodeGeometry(readPacked(fc.slice()));
                else fc.skip(f.wire);
            }
            for (let i = 0; i + 1 < tags.length; i += 2) {
                feature.properties[keys[tags[i]]] = values[tags[i + 1]];
            }
            layer.features.push(feature);
        }

        layers.push(layer);
    }
    return layers;
}
