/**
 * A declared tile grid is a promise about allocation, so it needs a ceiling.
 *
 * The frame maps are built by looping the grid and writing one entry per cell,
 * on the main thread, inside the awaited slide open. Every number that sizes
 * that loop — TotalPixelMatrixColumns/Rows, Columns/Rows, NumberOfFrames,
 * segment count — comes straight out of the archive's metadata.
 *
 * The checks that already existed compare the cell count against a frame count
 * from the SAME response, so they establish self-consistency and never
 * magnitude: a 100 000 × 100 000 grid of 1 px tiles declaring 10^10 frames is
 * perfectly consistent, passes them all, and then asks for 10^10 allocations.
 *
 * The bound rejects the level rather than clamping it, because the tile source
 * reads `tilesX`/`tilesY` back for `getNumTiles` — a clamped grid would render
 * a pyramid that disagrees with the frame map, which is wrong tiles served
 * confidently instead of a slide that visibly fails.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

const SERIES = "1.2.series";

/** One tiled instance, sized by its grid rather than by a pixel count. */
const levelMeta = ({ uid, tile = 256, tilesX = 8, tilesY = 8 }) => ([{
    "00080018": { Value: [uid] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00280008": { Value: [tilesX * tilesY] },
    "00280010": { Value: [tile] },
    "00280011": { Value: [tile] },
    "00480006": { Value: [tilesX * tile] },
    "00480007": { Value: [tilesY * tile] },
    "00209311": { Value: ["TILED_FULL"] },
    "00280002": { Value: [3] },
    "00280004": { Value: ["RGB"] },
    "00280100": { Value: [8] },
    "00280101": { Value: [8] },
}]);

const ingest = (meta) => {
    const wsi = { levels: [], seriesUID: SERIES };
    const errors = [];
    const original = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    try {
        DicomTools._ingestInstanceMetadata(meta[0]["00080018"].Value[0], null, meta, wsi, null);
        // `tilesX`/`tilesY` are settled here, not at ingest.
        DicomTools._finalizeWsiLevels(wsi);
    } finally {
        console.error = original;
    }
    return { wsi, errors };
};

/* ------------------------------------------------------------------ */
/* The value parser                                                    */
/* ------------------------------------------------------------------ */

const ds = (value) => ({ "00280008": { Value: [value] } });

test("an integer tag beyond the safe range is refused, not truncated", () => {
    // `x|0` used to wrap these to something small and plausible, which is worse
    // than refusing them: the level then looked fine and mapped nothing.
    expect(DicomTools.iv(ds(1e17), "00280008")).toBe(undefined);
    expect(DicomTools.iv(ds("100000000000000000"), "00280008")).toBe(undefined);
    // Merely large is still a number — 10^12 frames is arithmetically sound and
    // it is the cell ceiling, not the parser, that refuses to materialize it.
    expect(DicomTools.iv(ds(1e12), "00280008")).toBe(1e12);
    expect(DicomTools.gridWithinBounds(1e6, 1e6, 1, "test")).toBe(false);
});

test("a negative or fractional count is refused", () => {
    // A negative edge made `Math.ceil(w / -1)` negative, so the loops simply did
    // not run and the level carried a negative `tilesX` into `getNumTiles`.
    expect(DicomTools.iv(ds(-1), "00280008")).toBe(undefined);
    expect(DicomTools.iv(ds("-4"), "00280008")).toBe(undefined);
    expect(DicomTools.iv(ds(2.5), "00280008")).toBe(undefined);
});

test("ordinary counts still parse, in either wire form", () => {
    expect(DicomTools.iv(ds(0), "00280008")).toBe(0);
    expect(DicomTools.iv(ds(4096), "00280008")).toBe(4096);
    expect(DicomTools.iv(ds("4096"), "00280008")).toBe(4096);
    expect(DicomTools.iv({}, "00280008")).toBe(undefined);
});

/* ------------------------------------------------------------------ */
/* The ceiling                                                         */
/* ------------------------------------------------------------------ */

test("a grid within the bound is accepted", () => {
    expect(DicomTools.gridWithinBounds(1000, 1000, 1, "test")).toBe(true);
});

test("a grid past the bound is refused, including via its depth", () => {
    expect(DicomTools.gridWithinBounds(100000, 100000, 1, "test")).toBe(false);
    // Segments multiply the cell count, so the bound has to see them.
    expect(DicomTools.gridWithinBounds(1000, 1000, 8, "test")).toBe(false);
});

test("a degenerate grid is refused rather than treated as empty", () => {
    expect(DicomTools.gridWithinBounds(0, 10, 1, "test")).toBe(false);
    expect(DicomTools.gridWithinBounds(-1, 10, 1, "test")).toBe(false);
    expect(DicomTools.gridWithinBounds(NaN, 10, 1, "test")).toBe(false);
});

/* ------------------------------------------------------------------ */
/* End to end                                                          */
/* ------------------------------------------------------------------ */

test("a real pyramid level is ingested untouched", () => {
    // 40 000 × 40 000 px at 256 — a large but entirely ordinary slide level.
    const { wsi, errors } = ingest(levelMeta({ uid: "1.2.ok", tilesX: 157, tilesY: 157 }));

    expect(wsi.levels.length).toBe(1);
    expect(wsi.levels[0].tilesX).toBe(157);
    expect(errors).toEqual([]);
});

test("an implausible grid produces no level, and says so", () => {
    // 100 000 × 100 000 tiles of 1 px: self-consistent, and 10^10 allocations.
    const { wsi, errors } = ingest(levelMeta({ uid: "1.2.bomb", tile: 1, tilesX: 100000, tilesY: 100000 }));

    expect(wsi.levels.length).toBe(0);
    // The user must be able to tell a refused slide from an empty one.
    expect(errors.join(" ")).toContain("exceeds the");
});
