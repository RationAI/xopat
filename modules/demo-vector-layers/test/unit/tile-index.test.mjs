/**
 * The sparse-pyramid declaration.
 *
 * The demo MVT pyramid stores only tiles that carry geometry — 1981 of the
 * ~119 000 its zoom range implies — so without a `tileExists` predicate every
 * other tile is requested and 404s, and `ViewerFaultySourceRegistry` eventually
 * flags the whole source faulty. That is the correct reaction to a 404: a client
 * cannot tell a missing tile from a broken server. The descriptor's `tileIndex`
 * is what makes the absence *expected*, so the request is never made and the
 * 404 stays an error.
 *
 * The index is remote data, so the two things asserted here are that it decodes
 * exactly, and that anything malformed degrades to "ask the server" rather than
 * to a hidden tile.
 */
import { test, expect } from "@xopat/test-harness";

// The module registers a slide protocol on load, guarded on `window.SLIDE_PROTOCOLS`
// and `window.OpenSeadragon`; a bare object leaves both undefined so the import is
// side-effect free here.
globalThis.window = globalThis.window || {};

const { decodeTileIndex, tileIndexHas } = await import("../../index.mjs");

/** Build an index the way `make-visualization-demo.mjs` does. */
function encode(levels) {
    return {
        encoding: "bitmask-base64-rowmajor",
        levels: levels.map(({ across, down, present }) => {
            const bits = new Uint8Array(Math.ceil((across * down) / 8));
            for (const [x, y] of present) {
                const bit = y * across + x;
                bits[bit >> 3] |= 1 << (7 - (bit & 7));
            }
            return { across, down, bits: Buffer.from(bits).toString("base64") };
        })
    };
}

test("a decoded index answers exactly the tiles that were written", () => {
    // 3 x 2 grid, tiles (0,0), (2,0) and (1,1) present. Deliberately not a
    // multiple of 8, so the trailing padding bits are exercised.
    const levels = decodeTileIndex(encode([{ across: 3, down: 2, present: [[0, 0], [2, 0], [1, 1]] }]));
    expect(levels).not.toBe(null);

    const seen = [];
    for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 3; x++) {
            if (tileIndexHas(levels, 0, x, y)) seen.push([x, y]);
        }
    }
    expect(seen).toEqual([[0, 0], [2, 0], [1, 1]]);
});

test("a tile outside the level's grid does not exist", () => {
    const levels = decodeTileIndex(encode([{ across: 3, down: 2, present: [[0, 0]] }]));

    expect(tileIndexHas(levels, 0, 3, 0)).toBe(false);
    expect(tileIndexHas(levels, 0, 0, 2)).toBe(false);
    expect(tileIndexHas(levels, 0, -1, 0)).toBe(false);
});

test("a level the index does not describe is treated as dense", () => {
    // An index that stops short must not hide tiles it says nothing about —
    // it is a declaration of sparseness, not of the pyramid's extent.
    const levels = decodeTileIndex(encode([{ across: 1, down: 1, present: [] }]));

    expect(tileIndexHas(levels, 0, 0, 0)).toBe(false);
    expect(tileIndexHas(levels, 1, 0, 0)).toBe(true);
});

test("no index at all means the server is authoritative", () => {
    expect(tileIndexHas(null, 9, 205, 433)).toBe(true);
});

test("a malformed index is refused rather than half-trusted", () => {
    // Every one of these would otherwise silently suppress real tile requests.
    expect(decodeTileIndex(undefined)).toBe(null);
    expect(decodeTileIndex({ encoding: "something-else", levels: [] })).toBe(null);
    expect(decodeTileIndex({ encoding: "bitmask-base64-rowmajor", levels: [] })).toBe(null);
    expect(decodeTileIndex({
        encoding: "bitmask-base64-rowmajor",
        levels: [{ across: 0, down: 1, bits: "" }]
    })).toBe(null);
    expect(decodeTileIndex({
        encoding: "bitmask-base64-rowmajor",
        levels: [{ across: 1.5, down: 1, bits: "AA==" }]
    })).toBe(null);
    // Truncated bitmask: 206 x 434 needs 11176 bytes, not one.
    expect(decodeTileIndex({
        encoding: "bitmask-base64-rowmajor",
        levels: [{ across: 206, down: 434, bits: "AA==" }]
    })).toBe(null);
});
