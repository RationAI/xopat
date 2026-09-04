/**
 * Tile batching is the hot path, and its failure modes are quiet ones.
 *
 * `BatchImageJob` completes when its children's finish/fail count reaches
 * `jobs.length`. Settle a child twice and the batch completes early, stranding
 * its siblings as permanently "loading" — they are never re-selected for
 * download and that corner of the slide just stays blank. Settle one zero times
 * and the batch hangs to its timeout. So the invariant these tests defend is:
 * **every job settles exactly once, on every path**.
 *
 * The other half is the request budget. Batching exists because one WADO-RS
 * request per tile, against a store where each costs ~5.9 s including a
 * per-URL CORS preflight, is what made a slide take 80 s to fill.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const { DICOMWebTileSource } = await import("../../tile-source.mjs");

const BASE = "https://store.example/dicomWeb";
const STUDY = "1.2.study";
const SERIES = "1.2.series";
const INSTANCE_A = "1.2.inst.a";
const INSTANCE_B = "1.2.inst.b";

/** A baseline-JPEG bitstream the native fast path accepts (SOI + payload). */
const jpegBytes = (marker) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, marker]);

const rgb8 = {
    samplesPerPixel: 3,
    photometricInterpretation: "RGB",
    planarConfiguration: 0,
    bitsAllocated: 8,
    bitsStored: 8,
};

/**
 * A tile source wired just far enough to exercise the batcher: a stub client, a
 * pixel descriptor that takes the native path (so no cornerstone/worker is
 * needed), and the level lookup the decode tail consults.
 */
function makeSource({ fetchImpl, parts } = {}) {
    const src = Object.create(DICOMWebTileSource.prototype);

    src.baseUrl = BASE;
    src.studyUID = STUDY;
    src.seriesUID = SERIES;
    src.useRendered = false;
    src.tileWidth = 256;
    src.tileHeight = 256;
    src.requests = [];

    src.client = {
        fetchRaw: async (url, init) => {
            src.requests.push({ url, init });
            if (fetchImpl) return fetchImpl(url, init);
            return { ok: true, headers: { get: () => 'multipart/related; boundary=x' } };
        },
    };

    // Bypass the real multipart split — the parser has its own coverage, and
    // what matters here is how parts are mapped onto jobs.
    src.parseMultipartRelated = async (res) =>
        (typeof parts === "function" ? parts(res) : parts) ?? [];

    src.getTileWidth = () => 256;
    src.getTileHeight = () => 256;
    src._levelInfoFor = () => ({ pixel: rgb8 });
    src._pixelFor = () => rgb8;

    return src;
}

/** An ImageJob stand-in that records how many times it was settled. */
function makeJob(instanceUID, frame, level = 0) {
    const job = {
        src: `${BASE}/studies/${STUDY}/series/${SERIES}/instances/${instanceUID}/frames/${frame}`,
        tile: { level },
        userData: {},
        settled: [],
    };
    job.finish = (data, res, type) => job.settled.push({ how: "finish", data, type });
    job.fail = (msg) => job.settled.push({ how: "fail", msg });
    return job;
}

const part = (bytes) => ({ headers: { 'transfer-syntax': "1.2.840.10008.1.2.4.50" }, bytes });

/* ------------------------------------------------------------------ */
/* Grouping and request shape                                          */
/* ------------------------------------------------------------------ */

test("one instance's tiles become ONE multi-frame request", { tag: ["@unit"] }, async () => {
    const src = makeSource({ parts: [part(jpegBytes(1)), part(jpegBytes(2)), part(jpegBytes(3))] });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2), makeJob(INSTANCE_A, 3)];

    await src._getTileBatch({ jobs });

    expect(src.requests.length).toBe(1);
    expect(src.requests[0].url).toBe(
        `${BASE}/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE_A}/frames/1,2,3`);
    // Each job settled exactly once, with its own part.
    expect(jobs.map(j => j.settled.length)).toEqual([1, 1, 1]);
    expect(jobs.map(j => j.settled[0].how)).toEqual(["finish", "finish", "finish"]);
});

test("a batch spanning pyramid levels splits per instance, not per tile", { tag: ["@unit"] }, async () => {
    // A bucket is keyed by source, and one source owns every level — so a batch
    // legitimately mixes instances and must not be sent as one URL.
    const src = makeSource({ parts: () => [part(jpegBytes(1)), part(jpegBytes(2))] });
    const jobs = [
        makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2),
        makeJob(INSTANCE_B, 7, 1), makeJob(INSTANCE_B, 8, 1),
    ];

    await src._getTileBatch({ jobs });

    expect(src.requests.length).toBe(2);
    const urls = src.requests.map(r => r.url).sort();
    expect(urls[0]).toContain(`${INSTANCE_A}/frames/1,2`);
    expect(urls[1]).toContain(`${INSTANCE_B}/frames/7,8`);
    expect(jobs.every(j => j.settled.length === 1)).toBe(true);
});

test("tiles are requested at most once, and never with maxRetries", { tag: ["@unit"] }, async () => {
    const src = makeSource({ parts: [part(jpegBytes(1))] });
    await src._getTileBatch({ jobs: [makeJob(INSTANCE_A, 1)] });

    // Retrying a tile the viewer has panned past only holds a connection slot.
    expect(src.requests[0].init.maxRetries).toBe(0);
});

/* ------------------------------------------------------------------ */
/* Degradation — every path settles every job exactly once             */
/* ------------------------------------------------------------------ */

test("a short response serves what arrived and re-requests the rest singly", { tag: ["@unit"] }, async () => {
    // The store answers 3 requested frames with 2 parts. Positional mapping
    // follows the requested frame list, so frames 1 and 2 are served and only
    // frame 3 falls back.
    let call = 0;
    const src = makeSource({
        parts: () => (++call === 1
            ? [part(jpegBytes(1)), part(jpegBytes(2))]
            : [part(jpegBytes(3))]),
    });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2), makeJob(INSTANCE_A, 3)];

    await src._getTileBatch({ jobs });
    await new Promise(r => setTimeout(r, 0));   // the single re-request is async

    expect(src.requests.length).toBe(2);
    expect(src.requests[1].url).toContain(`${INSTANCE_A}/frames/3`);
    expect(jobs.map(j => j.settled.length)).toEqual([1, 1, 1]);
});

test("a failed batch degrades to single requests instead of failing the tiles", { tag: ["@unit"] }, async () => {
    let call = 0;
    const src = makeSource({
        fetchImpl: async () => {
            if (++call === 1) throw new Error("stream reset");
            return { ok: true, headers: { get: () => 'multipart/related; boundary=x' } };
        },
        parts: [part(jpegBytes(9))],
    });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2)];

    await src._getTileBatch({ jobs });
    await new Promise(r => setTimeout(r, 0));

    // xOpat runs OSD with tileRetryMax 0, so the library never retries a failed
    // batch in non-batched mode — the fallback has to be ours.
    expect(src.requests.length).toBe(3);           // 1 failed batch + 2 singles
    expect(jobs.map(j => j.settled.length)).toEqual([1, 1]);
    expect(jobs.every(j => j.settled[0].how === "finish")).toBe(true);
});

test("an empty response fails each job once rather than hanging the batch", { tag: ["@unit"] }, async () => {
    const src = makeSource({ parts: [] });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2)];

    await src._getTileBatch({ jobs });
    await new Promise(r => setTimeout(r, 0));

    // Batch returns nothing -> singles are tried -> those also return nothing.
    expect(jobs.map(j => j.settled.length)).toEqual([1, 1]);
    expect(jobs.every(j => j.settled[0].how === "fail")).toBe(true);
});

test("a URL this source did not build goes down the single path", { tag: ["@unit"] }, async () => {
    const src = makeSource({ parts: [part(jpegBytes(1))] });
    // frames/0 is getTileUrl's deliberate fail-fast placeholder for a missing
    // frame mapping; batching it would fabricate a real request for it.
    const bad = makeJob(INSTANCE_A, 0);
    const good = makeJob(INSTANCE_A, 4);

    await src._getTileBatch({ jobs: [bad, good] });
    await new Promise(r => setTimeout(r, 0));

    const urls = src.requests.map(r => r.url);
    expect(urls.some(u => u.endsWith("/frames/0"))).toBe(true);
    expect(urls.some(u => u.endsWith("/frames/4"))).toBe(true);
    expect(urls.some(u => u.includes("0,4") || u.includes("4,0"))).toBe(false);
});

test("unbatchable jobs go through downloadTileStart, not straight to _getTile", { tag: ["@unit"] }, async () => {
    // src/classes/preview-level.ts serves the synthetic level-0 tile by PATCHING
    // `downloadTileStart` on the source instance and matching an
    // `xopat-preview://` src. Batching routes tiles to downloadTileBatchStart,
    // which bypasses that patch — so anything the batcher cannot address must be
    // handed back to the public entry point or the preview tile gets fetched as
    // if its scheme were a URL.
    const src = makeSource({ parts: [part(jpegBytes(1))] });

    const intercepted = [];
    const inherited = src.downloadTileStart.bind(src);
    src.downloadTileStart = (context) => {
        if (typeof context?.src === "string" && context.src.startsWith("xopat-preview://")) {
            intercepted.push(context.src);
            context.finish("preview", null, "rasterBlob");
            return;
        }
        inherited(context);
    };

    const preview = makeJob(INSTANCE_A, 1);
    preview.src = "xopat-preview://slide-1";
    const normal = makeJob(INSTANCE_A, 5);

    await src._getTileBatch({ jobs: [preview, normal] });
    await new Promise(r => setTimeout(r, 0));

    expect(intercepted).toEqual(["xopat-preview://slide-1"]);
    expect(preview.settled.length).toBe(1);
    // The preview scheme never becomes a request.
    expect(src.requests.every(r => !r.url.startsWith("xopat-preview"))).toBe(true);
    expect(normal.settled.length).toBe(1);
});

/* ------------------------------------------------------------------ */
/* Settling and aborts                                                 */
/* ------------------------------------------------------------------ */

test("a job cannot be settled twice", { tag: ["@unit"] }, async () => {
    const src = makeSource();
    const job = makeJob(INSTANCE_A, 1);

    src._settle(job, "finish", "a", null, "rasterBlob");
    src._settle(job, "finish", "b", null, "rasterBlob");
    src._settle(job, "fail", "nope");

    // Double-settling completes the parent batch early and strands its siblings.
    expect(job.settled.length).toBe(1);
    expect(job.settled[0].data).toBe("a");
});

test("the shared request survives until every job in it is abandoned", { tag: ["@unit"] }, async () => {
    let aborted = false;
    const src = makeSource({
        fetchImpl: (url, init) => {
            init.signal?.addEventListener?.("abort", () => { aborted = true; });
            return new Promise(() => {});   // never settles
        },
    });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2), makeJob(INSTANCE_A, 3)];

    src._getTileBatch({ jobs });
    await new Promise(r => setTimeout(r, 0));

    src.downloadTileAbort(jobs[0]);
    expect(aborted).toBe(false);   // jobs 2 and 3 still want those frames
    src.downloadTileAbort(jobs[1]);
    expect(aborted).toBe(false);

    src.downloadTileAbort(jobs[2]);
    expect(aborted).toBe(true);
});

test("an aborted job is not re-requested when its batch degrades", { tag: ["@unit"] }, async () => {
    // The batch request must still be in flight when the abort lands — that is
    // the real ordering (OSD abandons tiles while the network is slow), and the
    // only one where the guard has anything to do.
    let failBatch;
    let call = 0;
    const src = makeSource({
        fetchImpl: () => {
            if (++call === 1) return new Promise((_, rej) => { failBatch = () => rej(new Error("stream reset")); });
            return Promise.resolve({ ok: true, headers: { get: () => 'multipart/related; boundary=x' } });
        },
        parts: [part(jpegBytes(1))],
    });
    const jobs = [makeJob(INSTANCE_A, 1), makeJob(INSTANCE_A, 2)];

    const done = src._getTileBatch({ jobs });
    await new Promise(r => setTimeout(r, 0));

    src.downloadTileAbort(jobs[0]);   // OSD gives up on this tile mid-flight
    failBatch();
    await done;
    await new Promise(r => setTimeout(r, 0));

    // Only the surviving job is re-requested; spending a connection on a tile
    // nobody is waiting for is the thing aborts exist to prevent.
    expect(src.requests.length).toBe(2);
    expect(src.requests[1].url).toContain("/frames/2");
});

/* ------------------------------------------------------------------ */
/* Proxied deployments                                                 */
/* ------------------------------------------------------------------ */

test("an empty base yields relative URLs, so a proxy can resolve them", { tag: ["@unit"] }, async () => {
    // When `plugins.dicom.httpClient.proxy` is set, the plugin hands the tile
    // source an EMPTY baseUrl. It has to: `XOpatRemoteEndpoint.resolveUrl`
    // returns an absolute URL unchanged, so an absolute base would send tiles
    // straight to the upstream origin — bypassing the proxy, and having their
    // auth headers stripped as cross-origin — while QIDO and metadata (relative)
    // still went through it. The deployment would half-work.
    const src = makeSource({ parts: [part(jpegBytes(1)), part(jpegBytes(2))] });
    src.baseUrl = "";

    const jobs = [
        { ...makeJob(INSTANCE_A, 1), src: `/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE_A}/frames/1` },
        { ...makeJob(INSTANCE_A, 2), src: `/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE_A}/frames/2` },
    ];
    for (const j of jobs) {
        j.settled = [];
        j.finish = (d, r, t) => j.settled.push({ how: "finish", d, t });
        j.fail = (m) => j.settled.push({ how: "fail", m });
    }

    await src._getTileBatch({ jobs });

    expect(src.requests.length).toBe(1);
    const url = src.requests[0].url;
    expect(url.startsWith("/studies/")).toBe(true);
    expect(url).toBe(`/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE_A}/frames/1,2`);
    expect(jobs.every(j => j.settled.length === 1)).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Batch sizing                                                        */
/* ------------------------------------------------------------------ */

test("batch width tracks the observed frame size", { tag: ["@unit"] }, () => {
    const src = makeSource();

    // Before any observation, a fixed default.
    expect(src.batchMaxJobs()).toBe(8);

    // Tiny frames (a coarse pyramid level) batch as wide as the cap allows.
    for (let i = 0; i < 20; i++) src._observeFrameBytes(4 * 1024);
    expect(src.batchMaxJobs()).toBe(16);

    // Large frames stay narrow, so one abort or failure discards less.
    const big = makeSource();
    for (let i = 0; i < 20; i++) big._observeFrameBytes(512 * 1024);
    expect(big.batchMaxJobs()).toBe(2);
});

test("batching is refused where a multi-frame URL is not answerable", { tag: ["@unit"] }, () => {
    const src = makeSource();
    expect(src.batchEnabled()).toBe(true);
    expect(src.batchCompatible(src)).toBe(true);
    expect(src.batchCompatible(makeSource())).toBe(false);

    // `…/frames/{n}/rendered` has no multi-frame form.
    src.useRendered = true;
    expect(src.batchEnabled()).toBe(false);

    // The clientless plain-fetch fallback is not the supported route.
    const noClient = makeSource();
    noClient.client = null;
    expect(noClient.batchEnabled()).toBe(false);
});
