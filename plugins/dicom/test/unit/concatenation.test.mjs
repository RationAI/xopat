/**
 * DICOM Concatenation: one logical pyramid level split across several SOP
 * Instances (0020,9161 ConcatenationUID, 0020,9162 InConcatenationNumber,
 * 0020,9228 ConcatenationFrameOffsetNumber).
 *
 * The plugin had no notion of it. The parts share TotalPixelMatrix dimensions, so
 * they all landed on one level record whose `instanceUID` and `frames` were plain
 * overwrites — last part wins. Each part covers a fraction of the grid, so the
 * frame map was rejected and the level ended up empty: one silently broken level
 * in an otherwise fine pyramid.
 *
 * The fix is a parts table on the level and one resolver that turns a level-logical
 * frame number into (instance, local frame). These tests pin that arithmetic, the
 * merge, and the diagnostics for the cases where the store does not give enough
 * to order the parts at all.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;
const { DICOMWebTileSource } = await import("../../tile-source.mjs");

const TILE = 256;
const BASE = "https://store.example/dicomWeb";
const STUDY = "1.2.study";
const SERIES = "1.2.series";
const CONCAT = "1.2.concat";
const UID_A = "1.2.part.a";
const UID_B = "1.2.part.b";

const posFG = (x, y) => ({
    "0048021A": {
        Value: [{
            "0048021E": { Value: [x * TILE + 1] },
            "0048021F": { Value: [y * TILE + 1] },
        }],
    },
});

const levelMeta = ({
    uid, tilesX = 8, tilesY = 8, fgs = null, numberOfFrames = null,
    dimOrg = "TILED_FULL", concatUID = null, inConcat = null, frameOffset = null,
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
    if (concatUID) attrs["00209161"] = { Value: [concatUID] };
    if (inConcat != null) attrs["00209162"] = { Value: [inConcat] };
    if (frameOffset != null) attrs["00209228"] = { Value: [frameOffset] };
    return [attrs];
};

/** Positions for the rows [yFrom, yTo) of an 8-wide grid, row-major. */
const rowBand = (yFrom, yTo, tilesX = 8) => {
    const out = [];
    for (let y = yFrom; y < yTo; y++) for (let x = 0; x < tilesX; x++) out.push(posFG(x, y));
    return out;
};

const build = (metas, wsiExtra = {}) => {
    const wsi = { levels: [], seriesUID: SERIES, ...wsiExtra };
    for (const meta of metas) {
        DicomTools._ingestInstanceMetadata(meta[0]["00080018"].Value[0], null, meta, wsi, null);
    }
    DicomTools._finalizeWsiLevels(wsi);
    DicomTools._inferSequentialLayoutForWsi(wsi);
    return wsi;
};

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

/** A QIDO instance row, as the grouping sees it. */
const row = (uid, width, { type = "ORIGINAL", frames = 16, concatUID = null } = {}) => {
    const ds = {
        "00080018": { Value: [uid] },
        "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] },
        "00080060": { Value: ["SM"] },
        "00080008": { Value: [type, "PRIMARY", "VOLUME"] },
        "00280008": { Value: [frames] },
        "00280010": { Value: [TILE] },
        "00280011": { Value: [TILE] },
        "00480006": { Value: [width] },
        "00480007": { Value: [width] },
        "00400512": { Value: ["SPEC-1"] },
        "00480106": { Value: ["PATH-1"] },
    };
    if (concatUID) ds["00209161"] = { Value: [concatUID] };
    return ds;
};

/* ------------------------------------------------------------------ */
/* Positioned parts                                                    */
/* ------------------------------------------------------------------ */

test("two positioned parts merge into one level", { tag: ["@unit"] }, async () => {
    const wsi = build([
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, inConcat: 1, frameOffset: 0 }),
        levelMeta({ uid: UID_B, fgs: rowBand(4, 8), concatUID: CONCAT, inConcat: 2, frameOffset: 32 }),
    ]);
    const [level] = wsi.levels;

    // Neither part covers the grid on its own; both consume every frame they
    // carry, which is what makes them acceptable.
    expect(level._strategy).toBe("pixel-pos");
    expect(level.parts.length).toBe(2);
    expect(Object.keys(level.frames).length).toBe(64);
    expect(level.sparse).toBe(false);
    // The representative UID is the part with the lowest frame offset.
    expect(level.instanceUID).toBe(UID_A);

    // `frames` is numbered over the LEVEL, so the resolver is what maps back to
    // an instance and its own 1-based frame numbering.
    expect(level.frames["0_0"]).toBe(1);
    expect(level.frames["0_4"]).toBe(33);
    expect(DicomTools.resolveFrameRef(level, 1)).toEqual({ instanceUID: UID_A, frame: 1 });
    expect(DicomTools.resolveFrameRef(level, 32)).toEqual({ instanceUID: UID_A, frame: 32 });
    expect(DicomTools.resolveFrameRef(level, 33)).toEqual({ instanceUID: UID_B, frame: 1 });
    expect(DicomTools.resolveFrameRef(level, 64)).toEqual({ instanceUID: UID_B, frame: 32 });
    expect(DicomTools.resolveFrameRef(level, 65)).toBe(null);
});

test("a batch spanning two parts becomes one request per instance", { tag: ["@unit"] }, async () => {
    const wsi = build([
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, frameOffset: 0 }),
        levelMeta({ uid: UID_B, fgs: rowBand(4, 8), concatUID: CONCAT, frameOffset: 32 }),
    ]);

    const src = Object.create(DICOMWebTileSource.prototype);
    src.baseUrl = BASE;
    src.studyUID = STUDY;
    src.seriesUID = SERIES;
    src.useRendered = false;
    src.tileWidth = TILE;
    src.tileHeight = TILE;
    src.wsi = wsi;
    src.maxLevel = 0;
    src.minLevel = 0;
    src.requests = [];
    src.client = {
        fetchRaw: async (url, init) => {
            src.requests.push({ url, init });
            return { ok: true, headers: { get: () => "multipart/related; boundary=x" } };
        },
    };
    src.parseMultipartRelated = async () => [{
        headers: { "transfer-syntax": "1.2.840.10008.1.2.4.50" },
        bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1]),
    }];
    src.getTileWidth = () => TILE;
    src.getTileHeight = () => TILE;
    src._levelInfoFor = () => ({ pixel: { samplesPerPixel: 3, photometricInterpretation: "RGB", planarConfiguration: 0, bitsAllocated: 8, bitsStored: 8 } });
    src._pixelFor = () => ({ samplesPerPixel: 3, photometricInterpretation: "RGB", planarConfiguration: 0, bitsAllocated: 8, bitsStored: 8 });

    // A cell in each part.
    expect(src.getTileUrl(0, 0, 0)).toContain(`/instances/${UID_A}/frames/1`);
    expect(src.getTileUrl(0, 0, 4)).toContain(`/instances/${UID_B}/frames/1`);

    const makeJob = (url) => {
        const job = { src: url, tile: { level: 0 }, userData: {}, settled: [] };
        job.finish = (...a) => job.settled.push({ how: "finish", a });
        job.fail = (msg) => job.settled.push({ how: "fail", msg });
        return job;
    };
    const jobs = [makeJob(src.getTileUrl(0, 0, 0)), makeJob(src.getTileUrl(0, 0, 4))];
    await src._getTileBatch({ jobs });

    // A frames/1,2,3 URL cannot span two SOP Instances, so this split is correct
    // rather than a missed optimisation.
    expect(src.requests.length).toBe(2);
    expect(src.requests.map(r => r.url).some(u => u.includes(UID_A))).toBe(true);
    expect(src.requests.map(r => r.url).some(u => u.includes(UID_B))).toBe(true);
    expect(jobs.every(j => j.settled.length === 1)).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Unpositioned parts — the sequential rung is level-wide              */
/* ------------------------------------------------------------------ */

test("a concatenated TILED_FULL level tiles across its parts", { tag: ["@unit"] }, async () => {
    // Neither part's frame count covers the grid — the level's does. That is why
    // the sequential fallback cannot live in per-instance ingest.
    const wsi = build([
        levelMeta({ uid: UID_A, numberOfFrames: 32, concatUID: CONCAT, inConcat: 1, frameOffset: 0 }),
        levelMeta({ uid: UID_B, numberOfFrames: 32, concatUID: CONCAT, inConcat: 2, frameOffset: 32 }),
    ]);
    const [level] = wsi.levels;

    expect(level._strategy).toBe("sequential-tiled-full-row-major");
    expect(level.sparse).toBe(false);
    expect(Object.keys(level.frames).length).toBe(64);
    expect(DicomTools.resolveFrameRef(level, 32)).toEqual({ instanceUID: UID_A, frame: 32 });
    expect(DicomTools.resolveFrameRef(level, 33)).toEqual({ instanceUID: UID_B, frame: 1 });
});

test("a single-instance level is exactly what it was before parts existed", { tag: ["@unit"] }, async () => {
    const wsi = build([levelMeta({ uid: UID_A, numberOfFrames: 64 })]);
    const [level] = wsi.levels;

    expect(level._strategy).toBe("sequential-tiled-full-row-major");
    expect(level.frames).toEqual(DicomTools._buildSequentialFrames(8, 8, "row-major"));
    expect(level.parts.length).toBe(1);
    expect(level.sparse).toBe(false);
    // And the resolver is a no-op on it.
    expect(DicomTools.resolveFrameRef(level, 7)).toEqual({ instanceUID: UID_A, frame: 7 });
});

/* ------------------------------------------------------------------ */
/* Offsets the store did not spell out                                 */
/* ------------------------------------------------------------------ */

test("offsets fall back to InConcatenationNumber, then refuse to guess", { tag: ["@unit"] }, async () => {
    // No 0020,9228 anywhere: order by 0020,9162 and accumulate frame counts.
    const derived = build([
        levelMeta({ uid: UID_B, fgs: rowBand(4, 8), concatUID: CONCAT, inConcat: 2 }),
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, inConcat: 1 }),
    ]);
    const [level] = derived.levels;
    expect(level.parts.map(p => p.instanceUID)).toEqual([UID_A, UID_B]);
    expect(DicomTools.resolveFrameRef(level, 33)).toEqual({ instanceUID: UID_B, frame: 1 });

    // Neither attribute: any ordering would silently misplace whole regions of
    // the slide, so one part is kept and the rest reported.
    const rec = captured(() => build([
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT }),
        levelMeta({ uid: UID_B, fgs: rowBand(4, 6), concatUID: CONCAT }),
    ]));
    const kept = rec.value.levels[0];
    expect(rec.error.length).toBe(1);
    expect(rec.error[0]).toContain("Cannot order");
    expect(kept.parts.length).toBe(1);
    expect(kept.instanceUID).toBe(UID_A);
    expect(kept.sparse).toBe(true);
    expect(rec.info.join("\n")).toContain("parts=1");
});

/* ------------------------------------------------------------------ */
/* Degenerate merges                                                   */
/* ------------------------------------------------------------------ */

test("a cell claimed by two parts goes to the lower offset, and is reported", { tag: ["@unit"] }, async () => {
    const rec = captured(() => build([
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, frameOffset: 0 }),
        // Overlaps rows 3..7 — row 3 is claimed twice.
        levelMeta({ uid: UID_B, fgs: rowBand(3, 8), concatUID: CONCAT, frameOffset: 32 }),
    ]));
    const [level] = rec.value.levels;

    expect(Object.keys(level.frames).length).toBe(64);
    expect(level.frames["0_3"]).toBe(25);            // part A's frame, not part B's
    expect(DicomTools.resolveFrameRef(level, 25)).toEqual({ instanceUID: UID_A, frame: 25 });
    expect(rec.warn.join("\n")).toContain("claimed by more than");
    expect(rec.info.join("\n")).toContain("collisions=8");
});

test("parts that disagree about being positioned yield a partial level, not a guess",
    { tag: ["@unit"] }, async () => {
        const rec = captured(() => build([
            levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, frameOffset: 0 }),
            levelMeta({ uid: UID_B, numberOfFrames: 32, concatUID: CONCAT, frameOffset: 32 }),
        ]));
        const [level] = rec.value.levels;

        // Completing this sequentially would have to invent frame numbers for
        // cells the positioned part already owns.
        expect(Object.keys(level.frames).length).toBe(32);
        expect(level.sparse).toBe(true);
        expect(level._strategy).toBe("pixel-pos");
        expect(rec.warn.join("\n")).toContain(UID_B);
    });

test("parts that are not the same concatenation are called out", { tag: ["@unit"] }, async () => {
    // `_injectLevelByDims` matches dimensions within ±1 px. Two unrelated images
    // of the same size land on one level, and only the ConcatenationUID can say so.
    const rec = captured(() => build([
        levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, frameOffset: 0 }),
        levelMeta({ uid: UID_B, fgs: rowBand(4, 8), concatUID: "1.2.other", frameOffset: 32 }),
    ]));

    expect(rec.warn.join("\n")).toContain("do not share one ConcatenationUID");
});

/* ------------------------------------------------------------------ */
/* Grouping: parts must survive long enough to be merged               */
/* ------------------------------------------------------------------ */

test("the pyramid ranking counts levels, not instances", { tag: ["@unit"] }, async () => {
    // Six instances, three distinct sizes — a three-level pyramid whose levels are
    // concatenated. It must not outrank a genuine five-level one.
    const concatenated = {
        pyramidInstances: [
            row("c.1", 4096, { concatUID: CONCAT }), row("c.2", 4096, { concatUID: CONCAT }),
            row("c.3", 2048, { concatUID: CONCAT }), row("c.4", 2048, { concatUID: CONCAT }),
            row("c.5", 1024, { concatUID: CONCAT }), row("c.6", 1024, { concatUID: CONCAT }),
        ],
    };
    const genuine = {
        pyramidInstances: [row("g.1", 4096), row("g.2", 2048), row("g.3", 1024), row("g.4", 512), row("g.5", 256)],
    };

    expect(DicomTools._bestWsiGroup([concatenated, genuine])[0]).toBe(genuine);
    expect(DicomTools._bestWsiGroup([])).toEqual([]);
});

test("same-size instances are dropped as duplicates unless they are one concatenation",
    { tag: ["@unit"] }, async () => {
        const [group] = await DicomTools.groupSeriesInstances([
            row("o.1", 4096),
            row("d.1", 2048, { type: "DERIVED", concatUID: CONCAT }),
            row("d.2", 2048, { type: "DERIVED", concatUID: CONCAT }),
            row("d.3", 1024, { type: "DERIVED" }),
            row("d.4", 1024, { type: "DERIVED" }),
        ], { studyUID: STUDY, seriesUID: SERIES });

        const uids = group.pyramidInstances.map(ds => ds["00080018"].Value[0]);
        // Both halves of the 2048 level survive; the genuine 1024 duplicate does not.
        expect(uids).toEqual(["o.1", "d.1", "d.2", "d.3"]);
    });

test("an all-DERIVED pyramid keeps its base level", { tag: ["@unit"] }, async () => {
    // The reference for "is this a smaller level?" used to be measured from the
    // largest DERIVED instance and then dropped, because nothing is smaller than
    // itself. Every pyramid with no ORIGINAL instance therefore started one level
    // down and rendered at half the available resolution — and that is most
    // converted data: com.pixelmed.convert.TIFFToDicom marks every level DERIVED,
    // which is what all of IDC is.
    const [group] = await DicomTools.groupSeriesInstances([
        row("d.1", 4096, { type: "DERIVED" }),
        row("d.2", 2048, { type: "DERIVED" }),
        row("d.3", 1024, { type: "DERIVED" }),
    ], { studyUID: STUDY, seriesUID: SERIES });

    expect(group.pyramidInstances.map(ds => ds["00080018"].Value[0]))
        .toEqual(["d.1", "d.2", "d.3"]);
});

test("one ORIGINAL still admits every smaller DERIVED level", { tag: ["@unit"] }, async () => {
    // The other side of the same branch: with an ORIGINAL present it is the
    // reference, and the whole derived list is still considered from index 0.
    const [group] = await DicomTools.groupSeriesInstances([
        row("o.1", 4096),
        row("d.1", 2048, { type: "DERIVED" }),
        row("d.2", 1024, { type: "DERIVED" }),
    ], { studyUID: STUDY, seriesUID: SERIES });

    expect(group.pyramidInstances.map(ds => ds["00080018"].Value[0]))
        .toEqual(["o.1", "d.1", "d.2"]);
});

test("a single-frame instance is a pyramid candidate only as a concatenation part",
    { tag: ["@unit"] }, async () => {
        const [asPart] = await DicomTools.groupSeriesInstances(
            [row("p.1", 4096, { frames: 1, concatUID: CONCAT })], { studyUID: STUDY, seriesUID: SERIES });
        expect(asPart.pyramidInstances.length).toBe(1);

        const [alone] = await DicomTools.groupSeriesInstances(
            [row("p.1", 4096, { frames: 1 })], { studyUID: STUDY, seriesUID: SERIES });
        expect(alone.pyramidInstances.length).toBe(0);

        // And the second gate, in ingest, agrees with the first.
        const wsi = build([
            levelMeta({ uid: UID_A, fgs: rowBand(0, 4), concatUID: CONCAT, frameOffset: 0 }),
            levelMeta({ uid: UID_B, fgs: [posFG(0, 4)], concatUID: CONCAT, frameOffset: 32 }),
        ]);
        expect(wsi.levels[0].parts.length).toBe(2);
        expect(DicomTools.resolveFrameRef(wsi.levels[0], 33)).toEqual({ instanceUID: UID_B, frame: 1 });
    });
