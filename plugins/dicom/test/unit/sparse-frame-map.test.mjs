/**
 * The frame-mapping ladder decides which frame of a DICOM instance is which tile
 * of the slide. Get it wrong and the slide renders scrambled; refuse too much and
 * it renders nothing. Until now the ladder had no coverage at all.
 *
 * What is pinned here is the acceptance rule, because that is what changed. A
 * level used to be accepted only when its frames covered every cell of the grid —
 * but PS3.3 says "the level may be sparse and any number of tiles may be absent",
 * so a perfectly conformant partial map was thrown away and the level rendered
 * blank, including the tiles that did exist.
 *
 * So there are two proofs of correctness now, and they are not interchangeable:
 * DENSE (every cell covered) for a mapper that guesses, SPARSE (every frame
 * consumed, in bounds, no collision) for the two that read what the standard
 * defines the position to be.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

const TILE = 256;
const SERIES = "1.2.series";

/** A per-frame functional group carrying an explicit pixel origin (1-based). */
const posFG = (x, y) => ({
    "0048021A": {
        Value: [{
            "0048021E": { Value: [x * TILE + 1] },   // ColumnPositionInTotalImagePixelMatrix
            "0048021F": { Value: [y * TILE + 1] },   // RowPositionInTotalImagePixelMatrix
        }],
    },
});

/** A per-frame functional group carrying only DimensionIndexValues (1-based). */
const divFG = (a, b) => ({ "00209157": { Value: [a + 1, b + 1] } });

/** Shared functional groups naming which DIV slot is the column and which the row. */
const DIS_XY = {
    "52009229": {
        Value: [{
            "00209222": {
                Value: [
                    { "00209165": { Value: ["0048021E"] } },
                    { "00209165": { Value: ["0048021F"] } },
                ],
            },
        }],
    },
};

/** Instance `/metadata` for one pyramid level (or one part of one). */
const levelMeta = ({
    uid = "1.2.a", tilesX = 4, tilesY = 4, fgs = null, numberOfFrames = null,
    dimOrg = "TILED_FULL", shared = null,
} = {}) => {
    const attrs = {
        "00080018": { Value: [uid] },
        "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
        "00280008": { Value: [numberOfFrames ?? (fgs ? fgs.length : 0)] },
        "00280010": { Value: [TILE] },
        "00280011": { Value: [TILE] },
        "00480006": { Value: [tilesX * TILE] },
        "00480007": { Value: [tilesY * TILE] },
        "00209311": { Value: [dimOrg] },
        "00280002": { Value: [3] },
        "00280004": { Value: ["RGB"] },
        "00280100": { Value: [8] },
        "00280101": { Value: [8] },
    };
    if (fgs) attrs["52009230"] = { Value: fgs };
    if (shared) Object.assign(attrs, shared);
    return [attrs];
};

/** Every cell of a grid, row-major. */
const cells = (tilesX, tilesY) => {
    const out = [];
    for (let y = 0; y < tilesY; y++) for (let x = 0; x < tilesX; x++) out.push([x, y]);
    return out;
};

/** The whole ingest pipeline for a WSI group, exactly as `findWSIItems` runs it. */
const build = (metas, wsiExtra = {}) => {
    const wsi = { levels: [], seriesUID: SERIES, ...wsiExtra };
    for (const meta of metas) {
        DicomTools._ingestInstanceMetadata(meta[0]["00080018"].Value[0], null, meta, wsi,
            wsiExtra.frameOrder || null);
    }
    DicomTools._finalizeWsiLevels(wsi);
    DicomTools._inferSequentialLayoutForWsi(wsi);
    return wsi;
};

/** Run `fn` with the console captured, so a diagnostic can be asserted on. */
const captured = (fn) => {
    const rec = { error: [], warn: [], info: [] };
    const original = { error: console.error, warn: console.warn, info: console.info };
    console.error = (...a) => rec.error.push(a.join(" "));
    console.warn = (...a) => rec.warn.push(a.join(" "));
    console.info = (...a) => rec.info.push(a.join(" "));
    try {
        rec.value = fn();
    } finally {
        Object.assign(console, original);
    }
    return rec;
};

/* ------------------------------------------------------------------ */
/* Dense levels — the behaviour that must not move                     */
/* ------------------------------------------------------------------ */

test("a dense level with pixel positions maps every cell", { tag: ["@unit"] }, async () => {
    const wsi = build([levelMeta({ fgs: cells(4, 4).map(([x, y]) => posFG(x, y)) })]);
    const [level] = wsi.levels;

    expect(level._strategy).toBe("pixel-pos");
    expect(level.sparse).toBe(false);
    expect(Object.keys(level.frames).length).toBe(16);
    expect(level.frames["0_0"]).toBe(1);
    expect(level.frames["3_3"]).toBe(16);
    expect(level.instanceUID).toBe("1.2.a");
});

test("out-of-bounds frames do not disqualify a level that covers the grid", { tag: ["@unit"] }, async () => {
    // `oob` has never been part of the dense rule and must not become part of it:
    // a file whose in-bounds frames tile the grid exactly renders correctly no
    // matter how many strays it also carries.
    const fgs = cells(4, 4).map(([x, y]) => posFG(x, y));
    fgs.push(posFG(99, 99));

    const wsi = build([levelMeta({ fgs })]);
    const [level] = wsi.levels;

    expect(level._strategy).toBe("pixel-pos");
    expect(level.sparse).toBe(false);
    expect(Object.keys(level.frames).length).toBe(16);
});

test("two frames claiming one cell are refused by every per-frame tier", { tag: ["@unit"] }, async () => {
    // 16 frames, but the last repeats (0,0) — so (3,3) is never covered.
    const fgs = cells(4, 4).map(([x, y]) => posFG(x, y));
    fgs[15] = posFG(0, 0);

    // TILED_FULL with a matching frame count still has the sequential rung to
    // fall to, and that is what it must land on — not on a colliding map.
    const dense = build([levelMeta({ fgs })]);
    expect(dense.levels[0]._strategy).toBe("sequential-tiled-full-row-major");

    // With no sequential rung available the level stays unmapped rather than
    // guessing: 17 declared frames cannot tile a 16-cell grid.
    const rec = captured(() => build([levelMeta({ fgs, numberOfFrames: 17, dimOrg: "TILED_SPARSE" })]));
    expect(rec.value.levels[0]._strategy).toBeFalsy();
    expect(Object.keys(rec.value.levels[0].frames).length).toBe(0);
    expect(rec.error.length).toBe(1);
});

/* ------------------------------------------------------------------ */
/* Sparse levels — absent tiles are legal, not malformed               */
/* ------------------------------------------------------------------ */

test("a sparse level keeps the tiles it has", { tag: ["@unit"] }, async () => {
    const present = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [7, 4], [0, 5], [1, 6], [2, 7], [7, 7]];
    const rec = captured(() => build([levelMeta({
        tilesX: 8, tilesY: 8, dimOrg: "TILED_SPARSE",
        fgs: present.map(([x, y]) => posFG(x, y)),
    })]));
    const [level] = rec.value.levels;

    expect(level._strategy).toBe("pixel-pos");
    expect(level.sparse).toBe(true);
    expect(Object.keys(level.frames).length).toBe(12);
    expect(level.frames["0_0"]).toBe(1);
    expect(level.frames["7_7"]).toBe(12);
    expect(level.frames["3_3"]).toBe(undefined);
    // The old code called this file malformed. It is not.
    expect(rec.error).toEqual([]);
});

test("a sparse level with one unusable frame is refused, not half-mapped", { tag: ["@unit"] }, async () => {
    // Sparse acceptance is "every frame consumed". A frame whose position cannot
    // be read breaks that proof, and a partial map built on a broken proof would
    // be indistinguishable from a correct sparse one.
    const fgs = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [7, 4], [0, 5], [1, 6], [2, 7]]
        .map(([x, y]) => posFG(x, y));
    fgs.push({});   // present, but carries no position

    const rec = captured(() => build([levelMeta({ tilesX: 8, tilesY: 8, dimOrg: "TILED_SPARSE", fgs })]));
    const [level] = rec.value.levels;

    expect(level._strategy).toBeFalsy();
    expect(Object.keys(level.frames).length).toBe(0);
    expect(rec.error.length).toBe(1);
    expect(rec.error[0]).toContain("Malformed TILED_SPARSE");
});

test("TILED_SPARSE with no per-frame data at all is still reported", { tag: ["@unit"] }, async () => {
    const rec = captured(() => build([levelMeta({
        tilesX: 8, tilesY: 8, dimOrg: "TILED_SPARSE", numberOfFrames: 12,
    })]));
    const [level] = rec.value.levels;

    expect(level._strategy).toBeFalsy();
    expect(Object.keys(level.frames).length).toBe(0);
    expect(rec.error.length).toBe(1);
    expect(rec.error[0]).toContain("Malformed TILED_SPARSE");
    // And the operator gets told which rung got furthest, or that none did.
    expect(rec.info.join("\n")).toContain("strategy=none reason=tiled-sparse-no-positions");
});

/* ------------------------------------------------------------------ */
/* DimensionIndexValues — resolved vs guessed                          */
/* ------------------------------------------------------------------ */

test("DIV resolved through DimensionIndexSequence may be sparse; a bare DIV guess may not",
    { tag: ["@unit"] }, async () => {
        const present = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [7, 4], [0, 5], [1, 6], [2, 7], [7, 7]];
        const fgs = present.map(([x, y]) => divFG(x, y));

        // With the sequence, the slots are stated, not guessed — the same proof
        // pixel positions get.
        const resolved = build([levelMeta({
            tilesX: 8, tilesY: 8, dimOrg: "TILED_SPARSE", fgs, shared: DIS_XY,
        })]);
        expect(resolved.levels[0]._strategy).toBe("div-dis");
        expect(resolved.levels[0].sparse).toBe(true);
        expect(Object.keys(resolved.levels[0].frames).length).toBe(12);

        // Without it, the only evidence for the axis order is that it tiles the
        // whole grid — which a sparse subset can never show. Refused.
        const rec = captured(() => build([levelMeta({
            tilesX: 8, tilesY: 8, dimOrg: "TILED_SPARSE", fgs,
        })]));
        expect(rec.value.levels[0]._strategy).toBeFalsy();
        expect(Object.keys(rec.value.levels[0].frames).length).toBe(0);
    });

test("a DIV axis order that is ambiguous is still refused and reported", { tag: ["@unit"] }, async () => {
    // On a full square grid both axis assignments map every cell, so neither is
    // evidence. This is the documented source of the high-res striping bug.
    const rec = captured(() => build([levelMeta({ fgs: cells(4, 4).map(([x, y]) => divFG(x, y)) })]));

    expect(rec.warn.join("\n")).toContain("Ambiguous DIV axes");
    expect(rec.value.levels[0]._strategy).toBe("sequential-tiled-full-row-major");
});

/* ------------------------------------------------------------------ */
/* Sequential inference must survive a sparse level in the series      */
/* ------------------------------------------------------------------ */

/** A truth level whose frames are numbered in `layout` order. */
const layoutFgs = (tilesX, tilesY, layout, drop = 0) => {
    const fgs = [];
    for (const [x, y] of cells(tilesX, tilesY)) {
        fgs[DicomTools._sequentialFrameAt(x, y, tilesX, tilesY, layout) - 1] = posFG(x, y);
    }
    return drop ? fgs.slice(0, fgs.length - drop) : fgs;
};

test("inference reads dense truth levels and ignores sparse ones", { tag: ["@unit"] }, async () => {
    const target = () => levelMeta({ uid: "1.2.b", tilesX: 2, tilesY: 2, numberOfFrames: 4 });

    // A dense truth level numbered serpentine teaches the sequential level the
    // scanner's layout.
    const inferred = build([
        levelMeta({ uid: "1.2.a", fgs: layoutFgs(4, 4, "row-major-serpentine") }),
        target(),
    ]);
    const seq = inferred.levels.find(L => L.width === 512);
    expect(seq._strategy).toBe("sequential-inferred-row-major-serpentine");
    expect(seq.frames).toEqual(DicomTools._buildSequentialFrames(2, 2, "row-major-serpentine"));

    // A sparse level cannot teach it anything: its frames are numbered over the
    // cells that exist, so every dense candidate scores near zero — and since the
    // score is a per-level MINIMUM, treating it as truth would kill inference for
    // the whole series.
    const sparseOnly = build([
        levelMeta({
            uid: "1.2.a", dimOrg: "TILED_SPARSE",
            fgs: layoutFgs(4, 4, "row-major-serpentine", 2),
        }),
        target(),
    ]);
    const truth = sparseOnly.levels.find(L => L.width === 1024);
    expect(truth.sparse).toBe(true);
    expect(truth._strategy).toBe("pixel-pos");
    expect(sparseOnly.levels.find(L => L.width === 512)._strategy).toBe("sequential-tiled-full-row-major");
});
