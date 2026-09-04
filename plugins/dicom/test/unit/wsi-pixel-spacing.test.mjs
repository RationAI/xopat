/**
 * Pixel spacing is what the scalebar, the measurement tools and the DICOM SR
 * annotation round-trip all divide by, and a wrong one is invisible: the slide
 * renders perfectly and every number next to it is off by a constant.
 *
 * Two things went wrong at once here and had to be fixed together.
 *
 * DICOM states every spacing attribute in MILLIMETRES, while `micronsX/Y` — the
 * field name, the core contract (`src/README.md`) and the radiology path — mean
 * MICROMETRES. The WSI path stored the millimetre value verbatim, which is why
 * its "no spacing declared" default read as the nonsensical `0.00025`.
 *
 * And `getMetadata()` returned the values only nested inside `imageInfo`, where
 * `viewer-state-binding-controller.ts` does not look — so every DICOM slide
 * measured in pixels no matter what the store declared. Fixing the shape without
 * the unit would have turned a silent fallback into a 1000x error.
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
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT
    ?? { getOption: (key, def) => def };
globalThis.window.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT;
globalThis.window.$ = globalThis.window.$ ?? { t: (key) => String(key).split(".").pop() };

const DicomTools = (await import("../../dicom-query.mjs")).default;
const { DICOMWebTileSource } = await import("../../tile-source.mjs");

const STUDY = "1.2.study";
const SERIES = "1.2.series";

/** A pyramid-level instance row as QIDO returns it. */
const levelRow = (uid, width) => ({
    "00080018": { Value: [uid] },
    "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] },
    "00080060": { Value: ["SM"] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00280008": { Value: [256] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00400512": { Value: ["SPEC-1"] },
    "00480106": { Value: ["PATH-1"] },
});

/**
 * Instance `/metadata`. `spacing` is millimetres, as DICOM states it — a 40x
 * slide is 0.00025 mm per pixel.
 */
const levelMeta = (uid, width, spacing) => [{
    "00080018": { Value: [uid] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00200052": { Value: ["1.2.for"] },
    "00280008": { Value: [256] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00209311": { Value: ["TILED_FULL"] },
    "00280002": { Value: [3] },
    "00280004": { Value: ["RGB"] },
    "00280100": { Value: [8] },
    "00280101": { Value: [8] },
    ...(spacing ? { "00280030": { Value: spacing } } : {}),
}];

function stubClient(routes) {
    const calls = [];
    return {
        calls,
        async fetchRaw(path) {
            calls.push(path);
            for (const [match, body] of routes) {
                if (typeof match === "function" ? match(path) : path.includes(match)) {
                    return {
                        status: 200,
                        headers: { get: () => null },
                        text: async () => JSON.stringify(typeof body === "function" ? body(path) : body),
                    };
                }
            }
            return { status: 204, headers: { get: () => null }, text: async () => "" };
        },
    };
}

const findLevels = async (spacing) => {
    const client = stubClient([
        [p => p.includes("/instances?"), [levelRow("uid.1", 4096)]],
        ["/metadata", () => levelMeta("uid.1", 4096, spacing)],
    ]);
    const items = await DicomTools.findWSIItems(client, STUDY, SERIES);
    return items[0].levels;
};

test("PixelSpacing millimetres are stored as micrometres", { tag: ["@unit"] }, async () => {
    // 0.00025 mm = 0.25 um = one 40x pixel.
    const levels = await findLevels([0.00025, 0.00025]);
    expect(levels[0].micronsX).toBeCloseTo(0.25, 9);
    expect(levels[0].micronsY).toBeCloseTo(0.25, 9);
});

test("PixelSpacing is [row (Y), column (X)], not [X, Y]", { tag: ["@unit"] }, async () => {
    const levels = await findLevels([0.0005, 0.00025]);
    expect(levels[0].micronsX).toBeCloseTo(0.25, 9);
    expect(levels[0].micronsY).toBeCloseTo(0.5, 9);
});

test("a series declaring no spacing falls back to one 40x pixel", { tag: ["@unit"] }, async () => {
    const levels = await findLevels(null);
    // Micrometres. The old `0.00025` default was 0.25 um written in millimetres,
    // which is what the verbatim-millimetre bug looked like from the outside.
    expect(levels[0].micronsX).toBeCloseTo(0.25, 9);
    expect(levels[0].micronsY).toBeCloseTo(0.25, 9);
});

test("getMetadata exposes the calibration where the core reads it", { tag: ["@unit"] }, async () => {
    const meta = DICOMWebTileSource.prototype.getMetadata.call({
        studyUID: STUDY,
        seriesUID: SERIES,
        tileWidth: 256,
        tileHeight: 256,
        wsi: { levels: [{ micronsX: 0.5, micronsY: 0.25 }] },
    });

    // TOP-LEVEL is the contract `UTILITIES.setImageMeasurements` is fed from;
    // `imageInfo` stays populated because the SR annotation convertor reads it.
    expect(meta.micronsX).toBeCloseTo(0.5, 9);
    expect(meta.micronsY).toBeCloseTo(0.25, 9);
    expect(meta.imageInfo.micronsX).toBeCloseTo(0.5, 9);
    expect(meta.imageInfo.micronsY).toBeCloseTo(0.25, 9);
});
