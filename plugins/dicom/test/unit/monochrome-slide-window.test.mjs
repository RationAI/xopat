/**
 * A monochrome slide — a fluorescence or multiplex-IHC optical path — stores
 * intensity, and the DICOM display chain for one that declares no VOI is the
 * identity. Rendering exactly that is correct, and with the values confined to a
 * narrow part of the 8-bit range it is also very nearly unreadable, with no
 * control anywhere to say so.
 *
 * The fix is to let `dicom-window` own the window for those slides. That is only
 * honest while the byte the shader samples IS the stored value, so the two
 * halves — the tile source deciding not to bake, and the plugin deciding to
 * mount the layer — ask ONE predicate. These tests pin the predicate, both
 * halves' use of it, and the property the whole change rests on: with the layer
 * at its opening window, the picture does not move.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const {
    buildGrayscaleLut,
    buildIdentityLut,
    canDeferVoiToShader,
    isIdentityModalityLut,
} = await import("../../pixel-pipeline.mjs");
const DicomTools = (await import("../../dicom-query.mjs")).default;

/** The Image Pixel module of an 8-bit MONOCHROME2 slide level. */
const MONO8 = {
    samplesPerPixel: 1,
    photometricInterpretation: "MONOCHROME2",
    planarConfiguration: 0,
    bitsAllocated: 8,
    bitsStored: 8,
    highBit: 7,
    pixelRepresentation: 0,
};

/* ------------------------------------------------------------------ */
/* The predicate                                                       */
/* ------------------------------------------------------------------ */

test("an 8-bit MONOCHROME2 slide with no window defers to the shader", { tag: ["@unit"] }, () => {
    expect(canDeferVoiToShader(MONO8)).toBe(true);
    // A rescale pair AT its identity values is what conformant SM writers emit;
    // it must mean the same thing as no Modality LUT at all.
    expect(canDeferVoiToShader(MONO8, {
        modalityLut: { kind: "linear", slope: 1, intercept: 0 },
    })).toBe(true);
    expect(isIdentityModalityLut(null)).toBe(true);
    expect(isIdentityModalityLut({ kind: "linear", slope: 1, intercept: 0 })).toBe(true);
    expect(isIdentityModalityLut({ kind: "linear", slope: 2, intercept: 0 })).toBe(false);
});

test("everything the 8-bit byte cannot carry keeps its baked window", { tag: ["@unit"] }, () => {
    // Colour and palette have no window to speak of.
    expect(canDeferVoiToShader({ ...MONO8, samplesPerPixel: 3, photometricInterpretation: "RGB" })).toBe(false);
    expect(canDeferVoiToShader({ ...MONO8, photometricInterpretation: "PALETTE COLOR" })).toBe(false);

    // MONOCHROME1 would need its inversion moved to the shader too, which
    // changes what an author-declared layer other than dicom-window renders.
    expect(canDeferVoiToShader({ ...MONO8, photometricInterpretation: "MONOCHROME1" })).toBe(false);

    // Wider than 8 bits is quantized on the way to the byte; windowing a
    // quantized sample bands. That data belongs on the radiology path.
    expect(canDeferVoiToShader({ ...MONO8, bitsAllocated: 16, bitsStored: 12, highBit: 11 })).toBe(false);
    expect(canDeferVoiToShader({ ...MONO8, pixelRepresentation: 1 })).toBe(false);

    // A non-identity Modality LUT means the byte is not the stored value.
    expect(canDeferVoiToShader(MONO8, {
        modalityLut: { kind: "linear", slope: 1, intercept: -1024 },
    })).toBe(false);

    // With a window declared the bake is doing real work; dropping it would
    // change the default picture, which this change must never do.
    expect(canDeferVoiToShader(MONO8, {
        voiLut: { presets: [{ center: 128, width: 64 }], fn: "LINEAR", lut: null },
    })).toBe(false);
    expect(canDeferVoiToShader(MONO8, {
        voiLut: { presets: [], fn: "LINEAR", lut: { firstMapped: 0, bitsPerEntry: 8, data: new Uint8Array(256) } },
    })).toBe(false);
});

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

test("the deferred table is the identity, and the baked one was not quite", { tag: ["@unit"] }, () => {
    const identity = buildIdentityLut();
    expect(identity.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(identity[i]).toBe(i);

    // The table this replaces is the LINEAR formula over the full stored range.
    // It is the identity to within a least-significant bit, and off by one at
    // the top — which is why swapping it for the real identity is a fix, not a
    // change of appearance.
    const baked = buildGrayscaleLut(MONO8);
    let maxDelta = 0;
    for (let i = 0; i < 256; i++) maxDelta = Math.max(maxDelta, Math.abs(baked[i] - i));
    expect(maxDelta).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------ */
/* The opening window really is the identity                           */
/* ------------------------------------------------------------------ */

test("the layer's opening window maps every stored byte back to itself", { tag: ["@unit"] }, async () => {
    const { initialWindow, resolveValueRange } = await import("../../shaders/voi-controls.mjs");

    // What `describeMonochromeSlide` emits for an 8-bit unsigned slide.
    const params = { valueRange: { min: 0, max: 255 }, voiPresets: [] };
    const range = resolveValueRange(params);
    const { center, width } = initialWindow(params);
    expect(center).toBe(127.5);
    expect(width).toBe(255);

    // The GLSL, evaluated in JS: sample -> real -> LINEAR_EXACT VOI -> [0,1].
    for (const stored of [0, 1, 127, 128, 254, 255]) {
        const sample = stored / 255;
        const real = range.min + sample * (range.max - range.min);
        const t = Math.min(1, Math.max(0, (real - center) / Math.max(width, 1e-6) + 0.5));
        expect(Math.round(t * 255)).toBe(stored);
    }
});

/* ------------------------------------------------------------------ */
/* Both halves ask the same question                                   */
/* ------------------------------------------------------------------ */

const STUDY = "1.2.study";
const SERIES = "1.2.series";

const levelRow = (uid, width) => ({
    "00080018": { Value: [uid] },
    "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] },
    "00080060": { Value: ["SM"] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00280008": { Value: [(width / 256) ** 2] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00400512": { Value: ["SPEC-1"] },
    "00480106": { Value: ["0"] },
});

const levelMeta = (uid, width, pixelTags = {}) => [{
    "00080018": { Value: [uid] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00200052": { Value: ["1.2.for"] },
    "00280008": { Value: [(width / 256) ** 2] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00209311": { Value: ["TILED_FULL"] },
    "00280030": { Value: [0.001, 0.001] },
    "00280002": { Value: [1] },
    "00280004": { Value: ["MONOCHROME2"] },
    "00280100": { Value: [8] },
    "00280101": { Value: [8] },
    "00280102": { Value: [7] },
    "00280103": { Value: [0] },
    // The identity rescale pair a conformant SM writer emits.
    "00281052": { Value: [0] },
    "00281053": { Value: [1] },
    ...pixelTags,
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

const monochromeSeries = (extraTags = {}) => stubClient([
    [p => p.includes("/instances?"), [levelRow("uid.1", 4096), levelRow("uid.2", 2048)]],
    ["/metadata", p => {
        const fine = p.includes("uid.1");
        return levelMeta(fine ? "uid.1" : "uid.2", fine ? 4096 : 2048, extraTags);
    }],
]);

test("describeMonochromeSlide answers for a monochrome slide with no window", { tag: ["@unit"] }, async () => {
    const d = await DicomTools.describeMonochromeSlide(monochromeSeries(), STUDY, SERIES);

    expect(d).toBeTruthy();
    expect(d.valueRange).toEqual({ min: 0, max: 255 });
    expect(d.voiPresets).toEqual([]);
    expect(d.invert).toBe(false);
    expect(d.modality).toBe("SM");
});

test("describeMonochromeSlide refuses a slide whose window is declared", { tag: ["@unit"] }, async () => {
    const client = monochromeSeries({
        "00281050": { Value: [128] },   // WindowCenter
        "00281051": { Value: [64] },    // WindowWidth
    });
    expect(await DicomTools.describeMonochromeSlide(client, STUDY, SERIES)).toBe(null);
});

test("describeMonochromeSlide refuses a colour slide", { tag: ["@unit"] }, async () => {
    const client = monochromeSeries({
        "00280002": { Value: [3] },
        "00280004": { Value: ["RGB"] },
    });
    expect(await DicomTools.describeMonochromeSlide(client, STUDY, SERIES)).toBe(null);
});

test("the tile source stops baking for exactly the slides the plugin describes", { tag: ["@unit"] }, async () => {
    const { DICOMWebTileSource } = await import("../../tile-source.mjs");

    const source = Object.create(DICOMWebTileSource.prototype);
    source.wsi = {
        pixel: MONO8,
        levels: [{ width: 4096, pixel: MONO8, modalityLut: { kind: "linear", slope: 1, intercept: 0 } }],
    };
    source._voiWindowOverride = null;
    source._voiPresetIndex = 0;

    expect(source.voiDeferredToShader()).toBe(true);

    const lut = source._grayscaleLutFor(source.wsi.levels[0], MONO8);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);

    // An explicit setVoiWindow is a request to bake THAT window and outranks the
    // deferral — otherwise the existing API would silently stop working.
    source.wsi.levels[0].__grayLut = undefined;
    source.wsi.levels[0].__grayLutKey = undefined;
    source._voiWindowOverride = { center: 128, width: 32 };
    expect(source.voiDeferredToShader()).toBe(false);
    const windowed = source._grayscaleLutFor(source.wsi.levels[0], MONO8);
    expect(windowed[0]).toBe(0);
    expect(windowed[255]).toBe(255);
    expect(windowed[112]).toBe(0);
});
