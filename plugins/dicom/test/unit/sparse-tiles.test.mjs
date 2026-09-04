/**
 * What a sparse level costs at render time.
 *
 * A DICOM pyramid level may legally have holes. The viewer used to answer a hole
 * with `…/frames/0` — an invalid frame index, deliberately, so the tile would
 * "fail fast". But fail-fast is a round trip: every absent tile became a real
 * HTTP GET the store answered 400/404, once per pan, and the cell was then marked
 * as failed rather than uncovered, so the coarser level could not show through.
 *
 * OpenSeadragon already has the contract for this — `tileExists` — and these
 * tests pin the three properties that follow from using it: an absent tile is not
 * requested, its URL is still stable and unique (OSD asks for one regardless),
 * and a level with no usable frames at all never reaches the pyramid.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const { DICOMWebTileSource } = await import("../../tile-source.mjs");

const BASE = "https://store.example/dicomWeb";
const STUDY = "1.2.study";
const SERIES = "1.2.series";
const INSTANCE = "1.2.inst.a";

const level = (over = {}) => ({
    width: 1024, height: 1024, tileWidth: 256, tileHeight: 256,
    instanceUID: INSTANCE,
    frames: { "0_0": 1, "2_1": 2 },
    ...over,
});

function makeSource(levels) {
    const src = Object.create(DICOMWebTileSource.prototype);
    src.baseUrl = BASE;
    src.studyUID = STUDY;
    src.seriesUID = SERIES;
    src.useRendered = false;
    src.tileWidth = 256;
    src.tileHeight = 256;
    src.wsi = { levels };
    src.maxLevel = levels.length - 1;
    src.minLevel = 0;
    src.requests = [];
    src.client = {
        fetchRaw: async (url, init) => {
            src.requests.push({ url, init });
            return { ok: true, headers: { get: () => "multipart/related; boundary=x" } };
        },
    };
    src.parseMultipartRelated = async () => [];
    return src;
}

/** An ImageJob stand-in that records how many times it was settled. */
const makeJob = (srcUrl) => {
    const job = { src: srcUrl, tile: { level: 0 }, userData: {}, settled: [] };
    job.finish = (data, res, type) => job.settled.push({ how: "finish", data, type });
    job.fail = (msg) => job.settled.push({ how: "fail", msg });
    return job;
};

/* ------------------------------------------------------------------ */
/* tileExists                                                          */
/* ------------------------------------------------------------------ */

test("only a sparse level reports absent tiles", { tag: ["@unit"] }, async () => {
    const sparse = makeSource([level({ sparse: true })]);
    expect(sparse.tileExists(0, 0, 0)).toBe(true);
    expect(sparse.tileExists(0, 2, 1)).toBe(true);
    expect(sparse.tileExists(0, 1, 0)).toBe(false);
    expect(sparse.tileExists(0, 3, 3)).toBe(false);

    // A dense level answers for every cell, mapped or not — its map is complete
    // by construction, and second-guessing it here would change what renders.
    const dense = makeSource([level({ sparse: false })]);
    expect(dense.tileExists(0, 1, 0)).toBe(true);

    // The derived and radiology sources build level records that carry no
    // `sparse` field at all. They must keep the base behaviour.
    const foreign = makeSource([level()]);
    expect(foreign.tileExists(0, 1, 0)).toBe(true);
});

test("a sparse level still reports its FULL grid", { tag: ["@unit"] }, async () => {
    // Sparseness is about holes, not about a smaller level. If `getNumTiles`
    // shrank to the mapped cells, everything past the last hole would fall out
    // of bounds and the level would render as a fragment of itself.
    globalThis.OpenSeadragon.Point = globalThis.OpenSeadragon.Point ||
        class Point { constructor(x, y) { this.x = x; this.y = y; } };

    const src = makeSource([level({ sparse: true, tilesX: 4, tilesY: 4 })]);
    const grid = src.getNumTiles(0);
    expect({ x: grid.x, y: grid.y }).toEqual({ x: 4, y: 4 });
    // The far corner exists as a cell; it is `tileExists` that calls it absent.
    expect(src.tileExists(0, 3, 3)).toBe(false);
});

/* ------------------------------------------------------------------ */
/* getTileUrl                                                          */
/* ------------------------------------------------------------------ */

test("an absent tile gets a stable per-cell URL, never frame 0", { tag: ["@unit"] }, async () => {
    const src = makeSource([level({ sparse: true })]);

    const a = src.getTileUrl(0, 1, 0);
    const b = src.getTileUrl(0, 3, 3);

    expect(a).not.toContain("/frames/0");
    expect(a).toContain("/frames/none#1_0");
    // The URL is the default cache key, so two absent cells must not collide.
    expect(a).not.toBe(b);
    // And it must not look like a frame reference, or the batcher would try to
    // fold it into a multi-frame request.
    expect(src._frameRefFromSrc(a)).toBe(null);

    // A present cell is unaffected.
    expect(src.getTileUrl(0, 0, 0)).toBe(
        `${BASE}/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE}/frames/1`);
});

test("a level index outside the pyramid does not throw", { tag: ["@unit"] }, async () => {
    // OSD asks for a tile URL even when `tileExists` said no, and it asks before
    // its own bounds are settled — so this used to be a TypeError inside the
    // library on an unguarded `level.instanceUID`.
    const src = makeSource([level({ sparse: true })]);
    expect(typeof src.getTileUrl(7, 0, 0)).toBe("string");
});

/* ------------------------------------------------------------------ */
/* The request budget                                                  */
/* ------------------------------------------------------------------ */

test("an absent tile costs no request and settles exactly once", { tag: ["@unit"] }, async () => {
    const src = makeSource([level({ sparse: true })]);
    const job = makeJob(src.getTileUrl(0, 1, 0));

    // Forced through the batcher, which is the path OSD would take if a sparse
    // tile ever reached the loader despite `tileExists`.
    await src._getTileBatch({ jobs: [job] });

    expect(src.requests).toEqual([]);
    expect(job.settled.length).toBe(1);
    expect(job.settled[0].how).toBe("fail");
});

/* ------------------------------------------------------------------ */
/* Level normalization                                                 */
/* ------------------------------------------------------------------ */

test("a level with no mapped frame never enters the pyramid", { tag: ["@unit"] }, async () => {
    const normalize = DICOMWebTileSource.prototype._normalizeLevels;

    const empty = level({ width: 4096, height: 4096, frames: {} });
    const sparse = level({ width: 2048, height: 2048, sparse: true });
    const dense = level();
    const noGeometry = level({ width: 8192, height: null });
    const noInstance = level({ width: 8192, instanceUID: null });

    const out = normalize.call({}, [empty, dense, sparse, noGeometry, noInstance]);

    // An unmapped level renders nothing, yet it used to keep its slot — skewing
    // `getLevelScale` and, when it sorted first, redefining what level 0 is.
    expect(out.map(l => l.width)).toEqual([2048, 1024]);
    expect(out[0].sparse).toBe(true);
});
