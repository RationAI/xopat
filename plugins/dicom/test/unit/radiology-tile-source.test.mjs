/**
 * The z-stack contract is duck-typed, so nothing enforces it at load time — a
 * source that breaks it still opens and still renders, it just shows the wrong
 * slice or leaks plane pixels between series. These vectors drive the source the
 * way the core does: through `withPlane` + `getTileUrl` (which is how the
 * controller learns the URL of a plane it is not showing), and through
 * `downloadTileStart` with a `src` that does NOT match the active plane (which
 * is how the prefetcher loads neighbours).
 *
 * The pixel path is checked by round-tripping a synthetic 12-bit-signed CT frame
 * and reading the Hounsfield values back out of the half-float pack.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {
    converter: { copyings: {}, destructors: {} },
    TileSource: class { constructor(options) { Object.assign(this, options || {}); } },
    ImageJob: function ImageJob() { throw new Error("not used in unit tests"); },
};
globalThis.OpenSeadragon = globalThis.window.OpenSeadragon;
globalThis.HTTPError = globalThis.HTTPError ?? class HTTPError extends Error {};
globalThis.APPLICATION_CONTEXT = { getOption: (key, def) => (key === "webGlPrecision" ? "auto" : def) };
globalThis.window.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT;
// The i18n namespace, as `src/classes/app/i18n-dom.ts` installs it: the stub
// returns the key's last segment, which is what the app does before i18next
// initializes. Echoing the key would hide a wrong namespace.
globalThis.window.$ = globalThis.window.$ ?? { t: (key) => String(key).split(".").pop() };

const { withPlane } = await import("../../../../src/classes/app/viewer-depth-controller.ts");
const { RadiologySeriesTileSource } = await import("../../radiology-tile-source.mjs");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const WIDTH = 4;
const HEIGHT = 2;
const AXIAL = [1, 0, 0, 0, 1, 0];
const CT_SOP = "1.2.840.10008.5.1.4.1.1.2";
const EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";

/** A QIDO/metadata row for slice `i` of a 12-bit-signed CT in Hounsfield units. */
const ctRow = (i) => ({
    "00080016": { Value: [CT_SOP] },
    "00080018": { Value: [`1.2.3.${i}`] },
    "00080060": { Value: ["CT"] },
    "00200013": { Value: [i + 1] },
    "00200032": { Value: [0, 0, i * 1.25] },
    "00200037": { Value: AXIAL },
    "00200052": { Value: ["1.2.FOR"] },
    "00280010": { Value: [HEIGHT] },
    "00280011": { Value: [WIDTH] },
    "00280030": { Value: [0.7, 0.6] },
    "00280004": { Value: ["MONOCHROME2"] },
    "00280002": { Value: [1] },
    "00280100": { Value: [16] },
    "00280101": { Value: [12] },
    "00280102": { Value: [11] },
    "00280103": { Value: [1] },
    "00281053": { Value: [1] },
    "00281052": { Value: [-1024] },
    "00281050": { Value: [40] },
    "00281051": { Value: [400] },
    "00281055": { Value: ["SOFT TISSUE"] },
    "00280008": { Value: [1] },
});

/** Stored samples for one plane: air, water, a mid value, and the 12-bit floor. */
const STORED = [0, 1024, 2047, 2048, 100, 200, 300, 400];

function frameBody() {
    const samples = Int16Array.from(STORED.slice(0, WIDTH * HEIGHT));
    return new Uint8Array(samples.buffer.slice(0));
}

/** A client whose `/frames/N` route answers with a one-part multipart envelope. */
function stubClient(rows, { frames = {} } = {}) {
    const calls = [];
    return {
        calls,
        async fetchRaw(path) {
            calls.push(path);
            if (/\/frames\/\d+$/.test(path)) {
                const body = frames[path] ?? frameBody();
                return {
                    status: 200,
                    ok: true,
                    __multipart: [{ headers: { "transfer-syntax": EXPLICIT_VR_LE }, bytes: body }],
                    headers: { get: () => "multipart/related" },
                    text: async () => "",
                };
            }
            const json = path.includes("/metadata") ? [rows[0]]
                : path.includes("/instances") ? rows
                    : [];
            return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(json) };
        },
    };
}

const BASE_URL = "https://dicom.example/dicom-web";

/**
 * OpenSeadragon's real `TileSource` constructor copies its options onto the
 * instance; the unit stub other suites may have installed first does not. Set
 * the identity explicitly so the source under test does not depend on which
 * stub won the race in this worker.
 */
function newSource(options) {
    const src = new RadiologySeriesTileSource(options);
    return Object.assign(src, options);
}

async function makeSource(planeCount = 5, options = {}) {
    const rows = Array.from({ length: planeCount }, (_, i) => ctRow(i));
    const client = stubClient(rows);
    const src = newSource({
        baseUrl: BASE_URL,
        studyUID: "1.2.STUDY",
        seriesUID: "1.2.SERIES",
        client,
        ...options,
    });
    // The multipart envelope is faked, so short-circuit the parser rather than
    // hand-building boundaries the parser is not what we are testing.
    src.parseMultipartRelated = async (res) => res.__multipart || [];
    await src._initializeFromServer();
    return { src, client };
}

/** IEEE-754 binary16 -> Number, so the pack can be read back. */
function halfToFloat(h) {
    const sign = (h & 0x8000) ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * frac * Math.pow(2, -24);
    if (exp === 0x1f) return frac ? NaN : sign * Infinity;
    return sign * (1 + frac / 1024) * Math.pow(2, exp - 15);
}

/** A tile-job context that captures what the source finished with. */
function jobContext(src) {
    const ctx = {
        src,
        finished: null,
        failure: null,
        finish(data, res, type) { ctx.finished = { data, type }; },
        fail(message) { ctx.failure = message; },
    };
    return ctx;
}

/* ------------------------------------------------------------------ */
/* Geometry and the z-stack descriptor                                 */
/* ------------------------------------------------------------------ */

test("declares one level whose tile is the whole image", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource();

    expect(src.width).toBe(WIDTH);
    expect(src.height).toBe(HEIGHT);
    expect(src.minLevel).toBe(0);
    expect(src.maxLevel).toBe(0);
    // WADO-RS /frames/{n} has no sub-region form, so tiling would refetch the
    // whole frame per tile.
    expect(src.getTileWidth(0)).toBe(WIDTH);
    expect(src.getTileHeight(0)).toBe(HEIGHT);
    expect(src.getLevelScale(0)).toBe(1);
    // A `/rendered` preview would carry the server's window, not ours.
    expect(src.__noPreviewLevel).toBe(true);
    expect(await src.getThumbnail()).toBe(null);
    expect(await src.downloadICCProfile()).toBe(null);
    expect(await src._renderedFallback()).toBe(null);
});

test("opts into the z-stack with a physically-meaningful spacing", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(5);
    expect(src.zStack.count).toBe(5);
    expect(src.zStack.index).toBe(0);
    // 1.25 mm in micrometres — the unit `mapPlaneIndex` aligns overlays by.
    expect(src.zStack.spacingUm).toBeCloseTo(1250, 6);
    expect(src.zStack.labels).toEqual(["0.0 mm", "1.3 mm", "2.5 mm", "3.8 mm", "5.0 mm"]);
});

test("a single-plane projection still declares count 1", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(1);
    // count <= 1 keeps the navigator's focal-plane row hidden and the URL stable.
    expect(src.zStack.count).toBe(1);
    src.setZDepth(3);
    expect(src.zStack.index).toBe(0);
});

test("role-scoped tileSourceId, so plane records cannot leak between series", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource();
    expect(src.tileSourceId).toBe("dicom-rad:https://dicom.example/dicom-web#1.2.STUDY/1.2.SERIES");
    // The DICOMweb baseUrl is shared by every series on the endpoint.
    expect(src.tileSourceId).not.toContain("dicom:https");
});

/* ------------------------------------------------------------------ */
/* The z-stack contract, driven as the core drives it                  */
/* ------------------------------------------------------------------ */

test("distinct planes yield distinct URLs, reached by flipping setZDepth", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(5);

    // Exactly how ViewerDepthController asks for a plane it is not showing.
    const urls = [0, 1, 2, 3, 4].map(p => withPlane(src, p, () => src.getTileUrl(0, 0, 0)));
    expect(new Set(urls).size).toBe(5);
    expect(urls[2]).toContain("/instances/1.2.3.2/frames/1");

    // ...and the flip restores the active plane, because setZDepth is
    // synchronous and identity-only.
    expect(src.zStack.index).toBe(0);
    expect(src.getTileUrl(0, 0, 0)).toBe(urls[0]);
});

test("setZDepth clamps and touches nothing but identity state", { tag: ["@unit"] }, async () => {
    const { src, client } = await makeSource(5);
    const before = client.calls.length;

    src.setZDepth(3);
    expect(src.zStack.index).toBe(3);
    expect(src._activeZ).toBe(3);
    src.setZDepth(99);
    expect(src.zStack.index).toBe(4);
    src.setZDepth(-5);
    expect(src.zStack.index).toBe(0);

    // No fetching, no cache work — the controller owns the repaint.
    expect(client.calls).toHaveLength(before);
});

test("the tile hash key is z-independent and carries the source identity", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(5);

    const keys = [0, 1, 2, 3, 4].map(p => withPlane(src, p, () => src.getTileHashKey(0, 0, 0)));
    // One tile identity across all planes: that is what lets the controller
    // layer per-plane pixels on top of a single cache record.
    expect(new Set(keys).size).toBe(1);
    // The plane-change zombie purge matches on this substring.
    expect(keys[0]).toContain(src.tileSourceId);
    // And it is not OSD's URL-based default, which would be plane-dependent.
    expect(src.getTileHashKey).not.toBe(OpenSeadragon.TileSource.prototype?.getTileHashKey);
});

test("downloadTileStart resolves the plane from context.src, not the active index", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(5);

    // The prefetcher's exact shape: active plane 0, job asking for plane 3.
    const target = withPlane(src, 3, () => src.getTileUrl(0, 0, 0));
    expect(src.zStack.index).toBe(0);

    const ctx = jobContext(target);
    src.downloadTileStart(ctx);
    await new Promise(r => setTimeout(r, 0));

    expect(ctx.failure).toBe(null);
    expect(ctx.finished.type).toBe("gpuTextureSet");
    // Resolved from the URL, so a per-plane rescale would have been the right one.
    expect(src._planeByUrl.get(target).instanceUID).toBe("1.2.3.3");
});

test("an unknown plane URL fails the tile rather than guessing", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(3);
    const ctx = jobContext("https://dicom.example/dicom-web/studies/x/series/y/instances/nope/frames/1");
    src.downloadTileStart(ctx);
    await new Promise(r => setTimeout(r, 0));
    expect(ctx.finished).toBe(null);
    expect(ctx.failure).toContain("Unknown radiology plane URL");
});

/* ------------------------------------------------------------------ */
/* Pixel path                                                          */
/* ------------------------------------------------------------------ */

test("packs Hounsfield values into R16F, recoverable to within half-float error", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(3);
    const ctx = jobContext(src.getTileUrl(0, 0, 0));
    src.downloadTileStart(ctx);
    await new Promise(r => setTimeout(r, 0));

    const { data, width, height, channelCount, packs } = ctx.finished.data;
    expect(width).toBe(WIDTH);
    expect(height).toBe(HEIGHT);
    expect(channelCount).toBe(1);
    // ONE component per pixel. A plane carries a single quantitative channel, so
    // the RGBA16F pack this used to emit was three quarters padding — and the
    // renderer now rejects a length that does not match the format, so a stride
    // slip fails at upload instead of rendering garbage.
    expect(packs[0].format).toBe("R16F");
    expect(packs[0].data).toHaveLength(WIDTH * HEIGHT);
    expect(packs[0].data).toBeInstanceOf(Uint16Array);
    expect(data).toBe(undefined);   // packs carry the payload

    const { min, max } = src.wsi.valueRange;
    const span = max - min;
    const readHu = (i) => min + halfToFloat(packs[0].data[i]) * span;

    // Half-float carries ~11 mantissa bits, so a value normalized over a ~2100 HU
    // span resolves to roughly 0.5 HU — better than CT's own quantization, and
    // the whole reason the range is clamped rather than left at the 16-bit span.
    const closeHu = (actual, expected) => expect(Math.abs(actual - expected)).toBeLessThan(1);

    // slope 1 / intercept -1024, 12-bit stored, two's complement:
    //   0 -> -1024 HU (air), 1024 -> 0 HU (water), 2047 -> 1023 HU,
    //   2048 -> -2048 stored -> -3072 HU, clamped to the range floor.
    closeHu(readHu(0), -1024);
    closeHu(readHu(1), 0);
    closeHu(readHu(2), 1023);
    closeHu(readHu(3), min);
    closeHu(readHu(4), -924);
});

test("the normalization range is the CT-clamped one the shader will denormalize", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(3);
    const d = src.getRadiologyDescriptor();

    expect(d.modality).toBe("CT");
    expect(d.invert).toBe(false);
    expect(d.planeCount).toBe(3);
    expect(d.voiPresets).toEqual([{ center: 40, width: 400, explanation: "SOFT TISSUE" }]);
    // Wide enough to hold air..bone and the declared preset, narrow enough that
    // half-float resolves single Hounsfield units.
    expect(d.valueRange.min).toBeLessThanOrEqual(-1024);
    expect(d.valueRange.max).toBeGreaterThanOrEqual(1023);
    expect(d.valueRange.max - d.valueRange.min).toBeLessThan(6000);
});

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

test("reports micrometres, keeping PHI out of the display path", { tag: ["@unit"] }, async () => {
    const { src } = await makeSource(3, { patientDetails: { patientID: "PAT1", name: "Doe^Jane" } });
    const meta = src.getMetadata();

    // PixelSpacing is [row (Y), column (X)] in millimetres; micronsX/Y are µm.
    expect(meta.micronsX).toBeCloseTo(600, 6);
    expect(meta.micronsY).toBeCloseTo(700, 6);
    // Explicitly "no objective", NOT "unknown": `undefined` would make the core
    // guess a magnification off the pixel size and then warn that a 0.6 mm/px CT
    // is a slide macro image.
    expect(meta.magnification).toBe(null);
    expect(meta.imageInfo.planeCount).toBe(3);
    expect(meta.imageInfo.orderStrategy).toBe("ipp-normal");
    expect(meta.imageInfo.frameOfReferenceUID).toBe("1.2.FOR");
    expect(JSON.stringify(meta)).not.toContain("Doe^Jane");

    // Patient data reaches only the sensitive getter, inherited unchanged.
    expect(src.getSensitiveMetadata().patient.name).toBe("Doe^Jane");

    // Labels resolve through the `dicom` locale namespace; the pre-i18next stub
    // renders the key's last segment, which is enough to pin that every field
    // goes through a key rather than a hardcoded English string.
    const display = src.getDisplayMetadata();
    const labels = display[0].fields.map(f => f.label);
    expect(labels).toEqual([
        "modality", "dimensions", "slices", "sliceSpacing", "pixelSize", "valueRange", "window", "planeOrdering",
    ]);
    expect(JSON.stringify(display)).not.toContain("Doe^Jane");
});

test("initialization refuses a series the plane model rejected", { tag: ["@unit"] }, async () => {
    const rows = [ctRow(0), { ...ctRow(1), "00280010": { Value: [99] } }];
    const src = newSource({
        baseUrl: BASE_URL, studyUID: "S", seriesUID: "E", client: stubClient(rows),
    });
    await expect(src._initializeFromServer()).rejects.toThrow(/different Rows\/Columns/);
});
