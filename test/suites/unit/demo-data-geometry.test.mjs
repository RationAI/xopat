/**
 * The geometry and encoders behind `npm run fixtures:derive`.
 *
 * These are hand-rolled on purpose — a TIFF reader, a TIFF writer, a contour
 * tracer and a protobuf/MVT writer, so that regenerating the demo data needs
 * nothing but Node. The corresponding risk is that a hand-rolled encoder which
 * is never decoded is probably wrong, and its failure mode is not an exception:
 * it is a tile the viewer renders as empty, or a polygon in the wrong place.
 *
 * So each writer is checked against a reader, and the tracer against grids whose
 * answers can be worked out by hand.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    traceCellRings, assemblePolygons, signedArea, pointInRing, mergeCollinear,
} from "../../harness/data/lib/contour.mjs";
import { encodeTile, encodePolygonGeometry, clipRing } from "../../harness/data/lib/mvt-write.mjs";
import { decodeTile } from "../../harness/data/lib/mvt-read.mjs";
import { encodeTiff, boxResample } from "../../harness/data/lib/tiff-write.mjs";
import { openTiff } from "../../harness/data/lib/tiff-read.mjs";

/** Build a binary grid from an ASCII picture; `#` is inside. */
function grid(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) cells[y * width + x] = rows[y][x] === "#" ? 1 : 0;
    }
    return { cells, width, height };
}

const trace = (rows) => {
    const g = grid(rows);
    return traceCellRings(g.cells, g.width, g.height);
};

// ── contour tracer ─────────────────────────────────────────────────────────

test("a single cell traces to its own four corners", () => {
    const rings = trace(["#"]);
    expect(rings.length).toBe(1);
    expect(rings[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
});

test("collinear vertices are merged, so a solid block costs four points", () => {
    const rings = trace(["###", "###", "###"]);
    expect(rings.length).toBe(1);
    expect(rings[0].length).toBe(5);          // 4 corners + the closing repeat
    expect(signedArea(rings[0])).toBe(9);
});

test("ring area equals the cell count it encloses", () => {
    // The tracer follows cell EDGES, so this is exact, not approximate — which
    // is the whole reason it is not marching squares.
    for (const rows of [["##.##", "#####", ".###."], ["#..", "#..", "##."], ["####"]]) {
        const g = grid(rows);
        const total = traceCellRings(g.cells, g.width, g.height)
            .reduce((sum, ring) => sum + signedArea(ring), 0);
        const cells = g.cells.reduce((n, v) => n + (v ? 1 : 0), 0);
        expect(total).toBe(cells);
    }
});

test("a hole traces as an opposite-winding ring and lands inside its parent", () => {
    const rings = trace(["###", "#.#", "###"]);
    expect(rings.length).toBe(2);
    const areas = rings.map(signedArea).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);

    const polygons = assemblePolygons(rings);
    expect(polygons.length).toBe(1);
    expect(polygons[0].length).toBe(2);       // outer + one hole
});

test("an island inside a hole becomes its own polygon, not a second hole", () => {
    const polygons = assemblePolygons(trace([
        "#####",
        "#...#",
        "#.#.#",
        "#...#",
        "#####",
    ]));
    expect(polygons.length).toBe(2);
    // Sorted smallest-first: the island has no holes, the ring has one.
    expect(polygons.map(p => p.length).sort()).toEqual([1, 2]);
});

test("diagonally touching cells separate instead of forming a self-touching ring", () => {
    // Popping an arbitrary outgoing edge at a pinch yields ONE ring that visits
    // the shared vertex twice — a self-intersecting ring, which RFC 7946 forbids
    // and tessellators mishandle. Taking the tightest turn splits them.
    const rings = trace(["#.", ".#"]);
    expect(rings.length).toBe(2);
    expect(rings.map(signedArea)).toEqual([1, 1]);

    const many = trace(["#.#", ".#.", "#.#"]);
    expect(many.length).toBe(5);
    expect(many.every(r => signedArea(r) === 1)).toBe(true);
});

test("pointInRing agrees with the ring it came from", () => {
    const ring = trace(["###", "###", "###"])[0];
    expect(pointInRing(ring, 1.5, 1.5)).toBe(true);
    expect(pointInRing(ring, -0.5, 1.5)).toBe(false);
    expect(pointInRing(ring, 1.5, 4)).toBe(false);
});

test("mergeCollinear leaves a ring with no collinear runs untouched", () => {
    const triangle = [[0, 0], [4, 0], [0, 4], [0, 0]];
    expect(mergeCollinear(triangle)).toEqual(triangle);
});

// ── MVT writer ─────────────────────────────────────────────────────────────

const square = [[10, 10], [100, 10], [100, 120], [10, 120], [10, 10]];
const hole = [[30, 30], [30, 60], [60, 60], [60, 30], [30, 30]];

test("a tile round-trips through the writer and back", () => {
    const buf = encodeTile([{
        name: "predictions",
        extent: 4096,
        features: [
            { id: 7, properties: { class: "tumor", score: 0.75, n: 42, flag: true }, rings: [square, hole] },
        ],
    }]);

    const [layer] = decodeTile(buf);
    expect(layer.name).toBe("predictions");
    expect(layer.version).toBe(2);          // v2 is what the renderer's worker expects
    expect(layer.extent).toBe(4096);
    expect(layer.features.length).toBe(1);

    const [feature] = layer.features;
    expect(feature.id).toBe(7);
    expect(feature.type).toBe(3);           // POLYGON
    expect(feature.rings).toEqual([square, hole]);
    expect(feature.properties.class).toBe("tumor");
    expect(feature.properties.score).toBeCloseTo(0.75, 10);
    expect(feature.properties.n).toBe(42);
    expect(feature.properties.flag).toBe(true);
});

test("property dictionaries are interned, not repeated per feature", () => {
    // Two features sharing a class must not store the string twice; a tile of a
    // thousand polygons otherwise pays for a thousand copies of "tumor".
    const shared = encodeTile([{
        name: "p",
        features: [
            { id: 1, properties: { class: "tumor" }, rings: [square] },
            { id: 2, properties: { class: "tumor" }, rings: [square] },
        ],
    }]);
    const distinct = encodeTile([{
        name: "p",
        features: [
            { id: 1, properties: { class: "tumor" }, rings: [square] },
            { id: 2, properties: { class: "stroma" }, rings: [square] },
        ],
    }]);
    expect(shared.length).toBeLessThan(distinct.length);

    const [layer] = decodeTile(shared);
    expect(layer.features.map(f => f.properties.class)).toEqual(["tumor", "tumor"]);
});

test("geometry is emitted as MoveTo / LineTo / ClosePath with zigzag deltas", () => {
    const geometry = encodePolygonGeometry([[[5, 5], [9, 5], [9, 9], [5, 5]]]);
    // command = (id & 0x7) | (count << 3)
    expect(geometry[0]).toBe((1 & 0x7) | (1 << 3));   // MoveTo, 1 point
    expect(geometry[1]).toBe(10);                     // zigzag(5)
    expect(geometry[2]).toBe(10);
    expect(geometry[3]).toBe((2 & 0x7) | (2 << 3));   // LineTo, 2 points
    expect(geometry[geometry.length - 1]).toBe((7 & 0x7) | (1 << 3)); // ClosePath
});

test("an empty layer is omitted rather than written as a stub", () => {
    expect(encodeTile([{ name: "p", features: [] }]).length).toBe(0);
});

// ── clipping ───────────────────────────────────────────────────────────────

test("clipping keeps the part inside the rectangle", () => {
    const clipped = clipRing(square, 0, 0, 50, 50);
    const xs = clipped.map(p => p[0]);
    const ys = clipped.map(p => p[1]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(50);
    expect(Math.max(...ys)).toBeLessThanOrEqual(50);
    expect(Math.abs(signedArea(clipped))).toBe(1600);   // [10..50] x [10..50]
});

test("a ring entirely outside the rectangle clips to nothing", () => {
    expect(clipRing(square, 500, 500, 600, 600)).toBe(null);
});

test("a ring entirely inside is returned unchanged in area", () => {
    const clipped = clipRing(square, -10, -10, 1000, 1000);
    expect(Math.abs(signedArea(clipped))).toBe(Math.abs(signedArea(square)));
});

// ── TIFF writer / reader ───────────────────────────────────────────────────

const pattern = (w, h, seed) => {
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (x * 7 + y * 13 + seed) & 255;
    return px;
};

function withTempTiff(levels, fn) {
    const file = path.join(os.tmpdir(), `xopat-demo-tiff-${process.pid}-${levels[0].width}.tif`);
    fs.writeFileSync(file, encodeTiff(levels, 256));
    const tiff = openTiff(file);
    try {
        return fn(tiff);
    } finally {
        tiff.close();
        fs.unlinkSync(file);
    }
}

test("a multi-level pyramid round-trips pixel for pixel", () => {
    const l0 = { width: 600, height: 1265, pixels: pattern(600, 1265, 0) };
    const l1 = { width: 300, height: 632, pixels: boxResample(l0.pixels, 600, 1265, 300, 632) };

    withTempTiff([l0, l1], (tiff) => {
        expect(tiff.levels.map(l => `${l.width}x${l.height}`)).toEqual(["600x1265", "300x632"]);
        expect(Array.from(tiff.readLevelRegion(0, 0, 0, 600, 1265))).toEqual(Array.from(l0.pixels));
        expect(Array.from(tiff.readLevelRegion(1, 0, 0, 300, 632))).toEqual(Array.from(l1.pixels));
    });
});

test("a region read spanning four tiles reassembles correctly", () => {
    // Tiles are 256 px, so [250,250)-(270,270) straddles a corner where four of
    // them meet — the case an off-by-one in the copy loop would survive.
    const l0 = { width: 600, height: 600, pixels: pattern(600, 600, 3) };
    withTempTiff([l0], (tiff) => {
        const region = tiff.readLevelRegion(0, 250, 250, 270, 270);
        for (let y = 0; y < 20; y++) {
            for (let x = 0; x < 20; x++) {
                expect(region[y * 20 + x]).toBe(l0.pixels[(250 + y) * 600 + (250 + x)]);
            }
        }
    });
});

test("a single-tile level uses the inline offset field and still reads back", () => {
    // A LONG field of count 1 lives in the IFD entry itself rather than in an
    // external array — a separate code path in the writer.
    const only = { width: 100, height: 100, pixels: pattern(100, 100, 5) };
    withTempTiff([only], (tiff) => {
        expect(tiff.levels[0].tilesAcross).toBe(1);
        expect(Array.from(tiff.readLevelRegion(0, 0, 0, 100, 100))).toEqual(Array.from(only.pixels));
    });
});

test("the reader refuses a layout it cannot honestly decode", () => {
    const notATiff = path.join(os.tmpdir(), `xopat-demo-not-a-tiff-${process.pid}.tif`);
    fs.writeFileSync(notATiff, Buffer.from("this is not a tiff at all", "ascii"));
    try {
        expect(() => openTiff(notATiff)).toThrow(/byte order/);
    } finally {
        fs.unlinkSync(notATiff);
    }
});

test("boxResample averages rather than dropping samples", () => {
    // 2x2 -> 1x1 must be the mean of all four, not the top-left one: these are
    // prediction scores, and subsampling is how a coarse level stops agreeing
    // with the fine one.
    const src = new Uint8Array([0, 10, 20, 30]);
    expect(Array.from(boxResample(src, 2, 2, 1, 1))).toEqual([15]);
});

// ── the demo's own geometry claims ─────────────────────────────────────────

test("the prediction grid's aspect matches the slide's closely enough to align", () => {
    // Nothing registers the stretched mask onto the slide: OpenSeadragon
    // normalizes both to viewport width 1, so alignment IS aspect agreement.
    const slideW = 105185;
    const slideH = 221772;
    const cell = 512;
    const cellsX = Math.ceil(slideW / cell);
    const cellsY = Math.ceil(slideH / cell);

    expect([cellsX, cellsY]).toEqual([206, 434]);
    const residual = Math.abs(cellsX / cellsY - slideW / slideH) / (slideW / slideH);
    expect(residual).toBeLessThan(0.001);
});

test("the two mask pyramids sit on opposite sides of the injection threshold", () => {
    // `PREVIEW_LEVEL_MIN_COARSEST_PX` in src/classes/preview-level.ts, and
    // `MAX_THUMBNAIL_SOURCE_PIXELS` in modules/webtiff/tile-source.mjs. Mask B
    // must clear the first and stay under the second, or the demo exercises the
    // preview FAILURE path while claiming to show the success path.
    const threshold = 2048;
    const thumbnailBudget = 32 * 1024 * 1024;

    const maskA = { width: 486, height: 1025 };
    const maskB = { width: 1945, height: 4100 };

    expect(Math.max(maskA.width, maskA.height)).toBeLessThanOrEqual(threshold);
    expect(Math.max(maskB.width, maskB.height)).toBeGreaterThan(threshold);
    expect(maskB.width * maskB.height).toBeLessThan(thumbnailBudget);
});
