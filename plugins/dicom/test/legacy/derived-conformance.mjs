/**
 * DICOM derived-object conformance checks.
 *
 * Covers the parts of the SEG / Parametric Map pipeline that are pure logic and
 * therefore the parts most likely to break silently: the Image Pixel module, the
 * Modality/VOI display chain, Segment Sequence parsing, bit unpacking, and the
 * TILED_FULL frame map.
 *
 * ## Why this is not a Cypress spec
 *
 * The e2e suite boots the whole viewer against a live WSI service and needs a
 * deployment env plus real credentials to reach a DICOMweb store; none of that
 * is available in CI, and `test/README.md` already flags the suite as fragile.
 * Everything asserted here sits below the viewer, so a standalone runner gives
 * real coverage with no server, no browser and no credentials.
 *
 * The fixtures are shaped after actual objects in the NCI Imaging Data Commons
 * public store (nuclei segmentations and an "Aggressiveness Score Map"), so the
 * cases are the ones real data exercises, not invented ones.
 *
 *   node test/dicom/derived-conformance.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

globalThis.HTTPError = class HTTPError extends Error {
    constructor(msg, status, text) { super(msg); this.statusCode = status; this.textData = text; }
};
globalThis.$ = { t: (key) => key.split('.').pop() };
globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

const pluginDir = path.resolve(import.meta.dirname, '../..');
const P = pathToFileURL(pluginDir).href;
const pipeline = await import(P + '/pixel-pipeline.mjs');
const DicomTools = (await import(P + '/dicom-query.mjs')).default;

/* ------------------------------------------------------------------ */
/* Tiny assertion harness                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { passed++; return; }
    failures.push(`${name}\n     expected ${e}\n     actual   ${a}`);
}

const el = (vr, ...values) => ({ vr, Value: values });

/* ------------------------------------------------------------------ */
/* Image Pixel module                                                  */
/* ------------------------------------------------------------------ */

{
    const ds = {
        "00280002": el("US", 1), "00280004": el("CS", "MONOCHROME2"),
        "00280100": el("US", 16), "00280101": el("US", 12), "00280102": el("US", 11),
        "00280103": el("US", 0), "00280008": el("IS", "117"),
    };
    const p = pipeline.parseImagePixel(ds);
    check("imagePixel.bitsStored", p.bitsStored, 12);
    check("imagePixel.frames", p.numberOfFrames, 117);
    check("imagePixel.isMonochrome", pipeline.isMonochrome(p), true);

    // A dataset that omits PhotometricInterpretation must NOT be assumed RGB —
    // that assumption is what corrupted every monochrome frame before.
    const bare = pipeline.parseImagePixel({ "00280002": el("US", 1) });
    check("imagePixel.inferredMonochrome", bare.photometricInterpretation, "MONOCHROME2");
    const bareColour = pipeline.parseImagePixel({ "00280002": el("US", 3) });
    check("imagePixel.inferredRGB", bareColour.photometricInterpretation, "RGB");

    // Float Pixel Data (7FE0,0008) marks the Parametric Map form.
    const float = pipeline.parseImagePixel({ "00280100": el("US", 32), "7FE00008": { vr: "OF", BulkDataURI: "x" } });
    check("imagePixel.floatPixelData", float.floatPixelData, true);
}

/* ------------------------------------------------------------------ */
/* Modality + VOI, including the Shared Functional Groups placement    */
/* ------------------------------------------------------------------ */

{
    const ct = { "00281052": el("DS", "-1024"), "00281053": el("DS", "1"), "00281054": el("LO", "HU") };
    check("modality.rescale", pipeline.parseModalityLut(ct),
        { kind: "linear", slope: 1, intercept: -1024, units: "HU", explanation: null });

    // Enhanced multi-frame objects hide the chain in (5200,9229). A top-level
    // read returns nothing and the overlay renders flat.
    const enhanced = {
        "52009229": el("SQ", {
            "00289145": el("SQ", { "00281052": el("DS", "0"), "00281053": el("DS", "1"), "00281054": el("LO", "US") }),
            "00289132": el("SQ", { "00281050": el("DS", "0.5"), "00281051": el("DS", "1"), "00281056": el("CS", "LINEAR") }),
        }),
    };
    check("modality.sharedFG", pipeline.parseModalityLut(enhanced)?.units, "US");
    check("voi.sharedFG", pipeline.parseVoiLut(enhanced)?.presets, [{ center: 0.5, width: 1, explanation: null }]);

    // Multi-valued WindowCenter/Width are presets, not one window.
    const multi = { "00281050": el("DS", "40", "300"), "00281051": el("DS", "400", "1500") };
    check("voi.presetCount", pipeline.parseVoiLut(multi).presets.length, 2);

    // A zero width would divide by zero downstream.
    check("voi.rejectsZeroWidth",
        pipeline.parseVoiLut({ "00281050": el("DS", "40"), "00281051": el("DS", "0") }), null);
}

/* ------------------------------------------------------------------ */
/* VOI arithmetic (PS3.3 C.11.2.1.2)                                   */
/* ------------------------------------------------------------------ */

{
    // Soft-tissue CT window: -160 HU black, 40 HU mid, 240 HU white.
    const w = { center: 40, width: 400 };
    check("voi.linear.low", Math.round(pipeline.applyVoiValue(-160, w)), 0);
    check("voi.linear.mid", Math.round(pipeline.applyVoiValue(40, w)), 128);
    check("voi.linear.high", Math.round(pipeline.applyVoiValue(240, w)), 255);

    // Width 1 on integer data is a step at the centre.
    check("voi.linear.width1", [3, 4, 5, 6].map(x => pipeline.applyVoiValue(x, { center: 5, width: 1 })),
        [0, 0, 255, 255]);

    // The same window on *continuous* samples must ramp: the (w-1) term counts
    // distinct integers and is meaningless for floats. Evaluating it literally
    // turns a real 0..1 Parametric Map into a binary mask.
    check("voi.continuous.ramp",
        [0, 0.5, 1].map(x => Math.round(pipeline.applyVoiValue(x, { center: 0.5, width: 1, continuous: true }))),
        [0, 128, 255]);

    const mapper = pipeline.makeContinuousVoiMapper({
        modalityLut: { kind: "linear", slope: 1, intercept: 0 },
        voiLut: { presets: [{ center: 0.5, width: 1 }], fn: "LINEAR", lut: null },
    });
    check("voi.mapper.float", [0, 0.5, 1].map(x => Math.round(mapper(x))), [0, 128, 255]);
}

/* ------------------------------------------------------------------ */
/* Grayscale LUT: signedness, bit depth, MONOCHROME1                   */
/* ------------------------------------------------------------------ */

{
    const pixel = {
        samplesPerPixel: 1, photometricInterpretation: "MONOCHROME2",
        bitsAllocated: 16, bitsStored: 12, highBit: 11, pixelRepresentation: 0,
    };
    const lut = pipeline.buildGrayscaleLut(pixel, {
        modalityLut: { kind: "linear", slope: 1, intercept: -1024 },
        voiLut: { presets: [{ center: 40, width: 400 }], fn: "LINEAR", lut: null },
    });
    // Sized by bitsStored, not bitsAllocated: every index is masked to the
    // stored width, so a 2^bitsAllocated table would just repeat itself
    // (0.086 ms vs 0.50 ms warm, and 16x less memory, for identical output).
    check("lut.sizedByBitsStored", lut.length, 4096);
    check("lut.window", [lut[864], lut[1064], lut[1264]], [0, 128, 255]);

    // The shrink must be invisible to consumers, which index with
    // `raw & (lut.length - 1)`. Assert that against a full-width reference
    // built by evaluating the same chain per raw value.
    {
        const mask = lut.length - 1;
        let identical = true;
        for (let raw = 0; raw < 65536; raw += 7) {          // stride: 9363 samples
            const expected = pipeline.applyVoiValue(
                pipeline.applyModality(raw & mask, { kind: "linear", slope: 1, intercept: -1024 }),
                { center: 40, width: 400 });
            if (Math.abs(lut[raw & mask] - Math.max(0, Math.min(255, expected))) > 1) { identical = false; break; }
        }
        check("lut.maskedLookupMatchesFullWidth", identical, true);
    }

    const inverted = pipeline.buildGrayscaleLut({ ...pixel, photometricInterpretation: "MONOCHROME1" }, {
        modalityLut: { kind: "linear", slope: 1, intercept: -1024 },
        voiLut: { presets: [{ center: 40, width: 400 }], fn: "LINEAR", lut: null },
    });
    check("lut.monochrome1", inverted[1064], 255 - lut[1064]);

    // Signed data must sign-extend from bitsStored, not from bitsAllocated.
    const signed = pipeline.buildGrayscaleLut({ ...pixel, pixelRepresentation: 1 }, {
        modalityLut: null,
        voiLut: { presets: [{ center: 0, width: 4096 }], fn: "LINEAR", lut: null },
    });
    check("lut.signedNegativeIsDark", signed[0x800] < signed[0], true);
}

/* ------------------------------------------------------------------ */
/* Segment Sequence                                                    */
/* ------------------------------------------------------------------ */

{
    const ds = {
        "00620002": el("SQ",
            {
                "00620004": el("US", 2), "00620005": el("LO", "Stroma"),
                "00620008": el("CS", "AUTOMATIC"),
                // CIELab for pure red, as DICOM PCS-Values.
                "0062000D": el("US", 34902, 57136, 51670),
                "0062000F": el("SQ", { "00080104": el("LO", "Connective tissue") }),
            },
            {
                "00620004": el("US", 1), "00620005": el("LO", "Nuclei"),
                "0062000F": el("SQ", { "00080104": el("LO", "Nucleus") }),
            },
        ),
    };
    const segs = DicomTools.parseSegments(ds);
    check("segments.sortedByNumber", segs.map(s => s.number), [1, 2]);
    check("segments.type", segs[1].type, "Connective tissue");
    // Segment 1 declares no colour, so it gets the deterministic fallback hue —
    // deterministic matters: two screenshots of the same slide must agree.
    check("segments.fallbackColourStable", segs[0].color, pipeline.hueForIndex(0));
    check("segments.cielabIsReddish", segs[1].color[0] > 200 && segs[1].color[1] < 80, true);
}

/* ------------------------------------------------------------------ */
/* Bit unpacking (SEG BINARY, PS3.5 8.1.1)                             */
/* ------------------------------------------------------------------ */

{
    check("unpackBits.lsbFirst", Array.from(pipeline.unpackBits(new Uint8Array([0b10110001]), 8)),
        [1, 0, 0, 0, 1, 1, 0, 1]);

    // Frames are NOT byte-aligned in the BINARY encoding; a per-row or
    // per-frame byte offset shears the mask.
    const packed = new Uint8Array([0b11111111, 0b00000000]);
    check("unpackBits.frame1of4", Array.from(pipeline.unpackBitsFrame(packed, 1, 4)), [1, 1, 1, 1]);
    check("unpackBits.frame2of4", Array.from(pipeline.unpackBitsFrame(packed, 2, 4)), [0, 0, 0, 0]);
}

/* ------------------------------------------------------------------ */
/* Palette Color LUT (PS3.3 C.7.9)                                     */
/* ------------------------------------------------------------------ */

{
    // A full 256-entry palette must survive intact — it is applied at decode,
    // not squeezed into the 8/32-entry colour-map control.
    const size = 256, firstMapped = 0;
    const ramp = (scale) => Array.from({ length: size }, (_, i) => Math.round(i * scale));
    const ds = {
        "00281101": el("US", size, firstMapped, 8),
        "00281102": el("US", size, firstMapped, 8),
        "00281103": el("US", size, firstMapped, 8),
        "00281201": el("OW", ...ramp(1)),          // red   ramps 0..255
        "00281202": el("OW", ...ramp(0.5)),        // green ramps 0..127
        "00281203": el("OW", ...Array(size).fill(9)),
    };
    const p = pipeline.parsePaletteLut(ds);
    check("palette.fullFidelity", [p.size, p.r.length], [256, 256]);
    check("palette.endsExact", [p.r[0], p.r[255], p.g[255], p.b[7]], [0, 255, 128, 9]);

    // 16-bit entries are normalized down to 8 bits so consumers never branch.
    const wide = {
        "00281101": el("US", 4, 0, 16),
        "00281102": el("US", 4, 0, 16),
        "00281103": el("US", 4, 0, 16),
        "00281201": el("OW", 0, 65535, 32768, 0),
        "00281202": el("OW", 0, 0, 0, 0),
        "00281203": el("OW", 0, 0, 0, 0),
    };
    check("palette.16bitNormalized", Array.from(pipeline.parsePaletteLut(wide).r), [0, 255, 128, 0]);

    // `firstMapped` shifts the index origin; values below it clamp to entry 0.
    const shifted = pipeline.parsePaletteLut({
        "00281101": el("US", 3, 100, 8), "00281102": el("US", 3, 100, 8), "00281103": el("US", 3, 100, 8),
        "00281201": el("OW", 10, 20, 30), "00281202": el("OW", 0, 0, 0), "00281203": el("OW", 0, 0, 0),
    });
    check("palette.firstMapped", shifted.firstMapped, 100);
    // The indexing rule the tile sources use, asserted directly.
    const indexOf = (stored) => Math.min(Math.max(stored - shifted.firstMapped, 0), shifted.size - 1);
    check("palette.indexClamping", [99, 100, 101, 102, 999].map(v => shifted.r[indexOf(v)]),
        [10, 10, 20, 30, 30]);

    // Segmented form: a discrete run followed by a linear ramp.
    const seg = pipeline.expandSegmentedPalette(
        Uint16Array.from([0, 2, 5, 5, /* discrete 5,5 */ 1, 2, 9 /* ramp to 9 over 2 */]), 4);
    check("palette.segmentedExpansion", Array.from(seg), [5, 5, 7, 9]);

    // Indirect segments (opcode 2) are refused, not guessed at.
    check("palette.indirectRefused",
        pipeline.expandSegmentedPalette(Uint16Array.from([2, 1, 0]), 4), null);
}

/* ------------------------------------------------------------------ */
/* Half-float encoding for the RGBA16F upload path                     */
/* ------------------------------------------------------------------ */

{
    // WebGL2's HALF_FLOAT upload takes uint16 bit patterns; a Float32Array
    // raises INVALID_OPERATION, so the conversion happens in JS.
    const halfToFloat = (h) => {
        const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
        if (e === 0x1f) return m ? NaN : s * Infinity;
        return s * Math.pow(2, e - 15) * (1 + m / 1024);
    };
    const round = (v) => halfToFloat(pipeline.floatToHalf(v));

    check("half.exactValues", [0, 0.5, 1, -1, 0.25, 2048, 65504].map(round),
        [0, 0.5, 1, -1, 0.25, 2048, 65504]);
    check("half.overflowSaturates", round(1e6), Infinity);
    check("half.signedZeroUnderflow", round(1e-9), 0);
    // Normalized [0,1] samples keep ~3 decimal digits — the reason the tile
    // source normalizes instead of shipping raw Hounsfield units.
    check("half.normalizedPrecision", Math.abs(round(0.0005) - 0.0005) < 1e-6, true);

    const packed = new Uint16Array(4 * 3);
    pipeline.writeHalfChannel(packed, [1, 0.5, 0], 2);
    check("half.writesOnlyItsChannel",
        [halfToFloat(packed[2]), halfToFloat(packed[6]), halfToFloat(packed[10]),
            packed[0], packed[1], packed[3]],
        [1, 0.5, 0, 0, 0, 0]);
}

/* ------------------------------------------------------------------ */
/* Derived-object attribution                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a study whose series listing and per-series probes are answered from
 * fixtures, and count the requests so caching can be asserted.
 */
function derivedStudyClient({ studyUID, smSeries = [], segs = [] }) {
    const routes = {};
    const seriesRows = [
        ...smSeries.map(uid => ({ "0020000E": el("UI", uid), "00080060": el("CS", "SM") })),
        ...segs.map(s => ({
            "0020000E": el("UI", s.seriesUID),
            "00080060": el("CS", "SEG"),
            "0008103E": el("LO", s.label || ""),
        })),
    ];
    routes[`/studies/${studyUID}/series`] = seriesRows;

    for (const s of segs) {
        const instanceUID = `${s.seriesUID}.1`;
        routes[`/studies/${studyUID}/series/${s.seriesUID}/instances`] =
            [{ "00080018": el("UI", instanceUID), "00080016": el("UI", DicomTools.SOP_SEGMENTATION) }];
        routes[`/studies/${studyUID}/series/${s.seriesUID}/instances/${instanceUID}/metadata`] = [{
            "00080016": el("UI", DicomTools.SOP_SEGMENTATION),
            "00620001": el("CS", "BINARY"),
            "00620002": el("SQ", { "00620004": el("US", 1), "00620005": el("LO", s.label || "Seg") }),
            "00280004": el("CS", s.photometric || "MONOCHROME2"),
            ...(s.photometric === "PALETTE COLOR" ? {
                "00281101": el("US", 2, 0, 8), "00281102": el("US", 2, 0, 8), "00281103": el("US", 2, 0, 8),
                "00281201": el("OW", 0, 255), "00281202": el("OW", 0, 0), "00281203": el("OW", 0, 0),
            } : {}),
            ...(s.references
                ? { "00081115": el("SQ", { "0020000E": el("UI", s.references) }) }
                : {}),
        }];
    }

    const base = mockClient(routes);
    let requests = 0;
    return {
        get requests() { return requests; },
        async fetchRaw(url, init) { requests++; return base.fetchRaw(url, init); },
    };
}

{
    // The shape that exposed the bug: several slides in one study, each with its
    // own segmentation. Attributing by anything other than the declared
    // reference paints one slide's mask over another.
    const STUDY = "2.25.multi";
    const SLIDE_A = "1.2.sm.a", SLIDE_B = "1.2.sm.b";
    const client = derivedStudyClient({
        studyUID: STUDY,
        smSeries: [SLIDE_A, SLIDE_B],
        segs: [
            { seriesUID: "1.2.seg.a", label: "Binary TIL Map", references: SLIDE_A },
            { seriesUID: "1.2.seg.b", label: "Binary TIL Map", references: SLIDE_B },
            { seriesUID: "1.2.seg.orphan", label: "Unlinked" },
        ],
    });

    const index = await DicomTools.getStudyDerivedIndex(client, STUDY);
    check("attribution.indexedAll", index.derived.map(d => d.seriesUID).sort(),
        ["1.2.seg.a", "1.2.seg.b", "1.2.seg.orphan"]);
    check("attribution.smCount", index.smSeriesCount, 2);

    check("attribution.slideAGetsOnlyItsOwn",
        DicomTools.derivedSeriesForSlide(index, SLIDE_A).map(d => d.seriesUID), ["1.2.seg.a"]);
    check("attribution.slideBGetsOnlyItsOwn",
        DicomTools.derivedSeriesForSlide(index, SLIDE_B).map(d => d.seriesUID), ["1.2.seg.b"]);

    // Segment metadata rides along with the index — the shader config needs it
    // before the first tile is fetched.
    check("attribution.carriesSegments",
        DicomTools.derivedSeriesForSlide(index, SLIDE_A)[0].segments.map(s => s.label), ["Binary TIL Map"]);

    // Filtering is pure: no further requests.
    const after = client.requests;
    DicomTools.derivedSeriesForSlide(index, SLIDE_A);
    DicomTools.derivedSeriesForSlide(index, SLIDE_B);
    check("attribution.filteringIsOffline", client.requests, after);
}

{
    // `hasPalette` decides which shader the overlay builder picks: an object
    // carrying its own colour map is baked CPU-side and rendered passthrough,
    // instead of being colour-mapped a second time by the parametric shader.
    const STUDY = "2.25.palette";
    const SLIDE = "1.2.sm.p";
    const client = derivedStudyClient({
        studyUID: STUDY,
        smSeries: [SLIDE],
        segs: [
            { seriesUID: "1.2.seg.mono", references: SLIDE },
            { seriesUID: "1.2.seg.pal", references: SLIDE, photometric: "PALETTE COLOR" },
        ],
    });
    const index = await DicomTools.getStudyDerivedIndex(client, STUDY);
    const byUid = Object.fromEntries(index.derived.map(d => [d.seriesUID, d.hasPalette]));
    check("palette.indexFlags", [byUid["1.2.seg.mono"], byUid["1.2.seg.pal"]], [false, true]);
}

{
    // Single-slide study: an unlinked segmentation is unambiguous, so it counts.
    // Real writers (IDC's included) do omit ReferencedSeriesSequence.
    const STUDY = "2.25.single";
    const SLIDE = "1.2.sm.only";
    const client = derivedStudyClient({
        studyUID: STUDY,
        smSeries: [SLIDE],
        segs: [{ seriesUID: "1.2.seg.orphan", label: "Nuclei" }],
    });

    const index = await DicomTools.getStudyDerivedIndex(client, STUDY);
    check("attribution.unlinkedAttachesWhenUnambiguous",
        DicomTools.derivedSeriesForSlide(index, SLIDE).map(d => d.seriesUID), ["1.2.seg.orphan"]);
}

{
    // A study with no derived objects must not be re-probed per slide, and must
    // not throw.
    const STUDY = "2.25.bare";
    const client = derivedStudyClient({ studyUID: STUDY, smSeries: ["1.2.sm.x"], segs: [] });
    const index = await DicomTools.getStudyDerivedIndex(client, STUDY);
    check("attribution.emptyStudy", [index.derived.length, index.smSeriesCount], [0, 1]);
    check("attribution.emptyStudyNoOverlays",
        DicomTools.derivedSeriesForSlide(index, "1.2.sm.x"), []);
}

/* ------------------------------------------------------------------ */
/* Shader compositing declarations                                     */
/* ------------------------------------------------------------------ */

{
    // `use_mode: "blend"` without an explicit `use_blend` selects the 'mask'
    // blend function, whose GLSL never reads the foreground's RGB — every
    // overlay renders colourless and no colour/opacity/visibility edit has any
    // effect. The renderer default "show" is premultiplied source-over, which is
    // what an overlay needs. Nothing else catches this: it compiles, runs, and
    // only shows up as "the overlay is the wrong colour" on screen.
    const shaderSrc = {
        "dicom-seg": await import("node:fs").then(fs =>
            fs.readFileSync(path.join(pluginDir, "shaders/dicom-seg.mjs"), "utf8")),
        "dicom-parametric": await import("node:fs").then(fs =>
            fs.readFileSync(path.join(pluginDir, "shaders/dicom-parametric.mjs"), "utf8")),
    };

    for (const [name, src] of Object.entries(shaderSrc)) {
        // Comments mentioning it are fine; an actual declaration is not.
        const declares = /^\s*use_mode\s*:/m.test(src);
        check(`shader.${name}.doesNotSetUseMode`, declares, false);

        // Titles must go through the injected namespace-aware translator, not a
        // hardcoded `dicom.`-prefixed key (which resolves in no namespace and
        // renders raw on screen).
        check(`shader.${name}.noHardcodedNamespace`, /t\(\s*['"]dicom\./.test(src), false);
    }
}

/* ------------------------------------------------------------------ */
/* Background identity resolution                                      */
/* ------------------------------------------------------------------ */

{
    // `dataReference` is index-or-value. A raw BackgroundItem out of
    // before-app-init still carries the inline DataOverride; anything that has
    // been through the open pipeline is a BackgroundConfig exposing the numeric
    // index into config.data. Reading `.dataID` off the number yields undefined
    // and silently disables overlays — which is exactly what happened when they
    // worked at boot but never through the slide switcher.
    const dataID = { studyUID: "1.2.study", seriesUID: "1.2.series", role: "wsi" };
    const override = { dataID, protocol: "dicom" };

    // Mirror of the plugin's `_dicomIdentityOf` fallback (the plugin class
    // itself needs the full app runtime, so the resolution rule is asserted
    // here rather than the method).
    const config = { data: ["some/other/slide", override] };
    const resolve = (background) => {
        const ref = background.dataReference;
        const spec = typeof ref === "number" ? config.data[ref] : ref;
        if (!spec || typeof spec !== "object") return null;
        return spec.dataID ?? spec;
    };

    check("identity.fromInlineOverride", resolve({ dataReference: override }), dataID);
    check("identity.fromNumericIndex", resolve({ dataReference: 1 }), dataID);
    check("identity.nonDicomStringRef", resolve({ dataReference: "path/to/slide.tif" }), null);
    check("identity.unknownIndex", resolve({ dataReference: 0 }), null);
}

/* ------------------------------------------------------------------ */
/* TILED_FULL frame map, via the real discovery path                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} routes path -> DICOM-JSON body. A value of the form
 *   `{ __status, __body, __headers }` is returned verbatim instead, so a route
 *   can model a 204 / empty body / total-count header. Unknown paths 404.
 */
function mockClient(routes) {
    return {
        async fetchRaw(url) {
            const path = url.split('?')[0];
            const entry = routes[path];
            if (entry === undefined) throw new HTTPError(`404 ${path}`, 404, 'not found');
            if (entry && entry.__status !== undefined) {
                return new Response(entry.__body ?? null, {
                    status: entry.__status,
                    headers: { 'content-type': 'application/dicom+json', ...(entry.__headers || {}) },
                });
            }
            return new Response(JSON.stringify(entry),
                { status: 200, headers: { 'content-type': 'application/dicom+json' } });
        },
    };
}

/* ------------------------------------------------------------------ */
/* QIDO status handling                                                */
/* ------------------------------------------------------------------ */

{
    // DICOMweb answers a query that matched nothing with 204 and an EMPTY body.
    // Parsing that as JSON is what turned every zero-result search in the slide
    // browser into "Bad DICOM JSON: Unexpected end of JSON input".
    const noContent = mockClient({ "/studies": { __status: 204 } });
    check("qido.204IsEmptyResult",
        await DicomTools.qidoSafeWithMeta(noContent, "/studies?PatientName=*zzz*", "0020000D"),
        { rows: [], total: 0 });

    // Some servers use 200 + empty body for the same thing.
    const emptyBody = mockClient({ "/studies": { __status: 200, __body: "" } });
    check("qido.emptyBodyIsEmptyResult",
        await DicomTools.qidoSafeWithMeta(emptyBody, "/studies", "0020000D"),
        { rows: [], total: 0 });

    // A missing collection is an empty one, matching `qido`'s own 404 branch.
    check("qido.404IsEmptyResult",
        await DicomTools.qidoSafeWithMeta(mockClient({}), "/studies", "0020000D"),
        { rows: [], total: 0 });

    // The happy path must still surface rows and the total header.
    const withRows = mockClient({
        "/studies": {
            __status: 200,
            __body: JSON.stringify([{ "00080018": el("UI", "1.2.3") }]),
            __headers: { "x-total-count": "42" },
        },
    });
    const ok = await DicomTools.qidoSafeWithMeta(withRows, "/studies", "0020000D");
    check("qido.rowsAndTotal", [ok.rows.length, ok.total], [1, 42]);

    // `rows` is always an array — callers .map() it without a guard.
    const notArray = mockClient({ "/studies": { __status: 200, __body: JSON.stringify({ nope: 1 }) } });
    check("qido.rowsAlwaysArray", (await DicomTools.qidoSafeWithMeta(notArray, "/studies")).rows, []);
}

{
    // A 3250x2234 nuclei segmentation, 256px tiles, one segment, TILED_FULL and
    // no per-frame functional groups — the shape every IDC SEG object has.
    const STUDY = "1.2.3", SERIES = "1.2.3.4", INSTANCE = "1.2.3.4.5";
    const meta = {
        "00080016": el("UI", DicomTools.SOP_SEGMENTATION),
        "00080060": el("CS", "SEG"),
        "00280002": el("US", 1), "00280004": el("CS", "MONOCHROME2"),
        "00280100": el("US", 1), "00280101": el("US", 1), "00280102": el("US", 0),
        "00280008": el("IS", "117"),
        "00280010": el("US", 256), "00280011": el("US", 256),
        "00480006": el("UL", 3250), "00480007": el("UL", 2234),
        "00209311": el("CS", "TILED_FULL"),
        "00620001": el("CS", "BINARY"),
        "00620002": el("SQ", { "00620004": el("US", 1), "00620005": el("LO", "Nuclei") }),
    };
    const client = mockClient({
        [`/studies/${STUDY}/series/${SERIES}/instances`]: [{ "00080018": el("UI", INSTANCE) }],
        [`/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE}/metadata`]: [meta],
    });

    const item = await DicomTools.findDerivedItem(client, STUDY, SERIES, "seg");
    const level = item.levels[0];
    check("tiledFull.levelDims", [level.width, level.height], [3250, 2234]);
    check("tiledFull.frameDims", [level.frameWidth, level.frameHeight], [256, 256]);
    check("tiledFull.segmentationType", item.segmentationType, "BINARY");
    check("tiledFull.strategy", level._strategy, "tiled-full-segment-major");
    check("tiledFull.tileCount", Object.keys(level.frames).length, 13 * 9);
    check("tiledFull.firstTile", level.frames["0_0"], { 1: 1 });
    check("tiledFull.rowMajorSecondRow", level.frames["0_1"], { 1: 14 });
    check("tiledFull.lastTile", level.frames["12_8"], { 1: 117 });
}

{
    // A whole-slide Parametric Map: one 466x306 frame that covers a
    // 52002x35748 matrix. Deriving the grid from TotalPixelMatrix would demand
    // 112x117 tiles for a single frame and produce an empty overlay.
    const STUDY = "9.9", SERIES = "9.9.1", INSTANCE = "9.9.1.1";
    const meta = {
        "00080016": el("UI", DicomTools.SOP_PARAMETRIC_MAP),
        "00280002": el("US", 1), "00280004": el("CS", "MONOCHROME2"),
        "00280100": el("US", 32), "00280008": el("IS", "1"),
        "00280010": el("US", 306), "00280011": el("US", 466),
        "00480006": el("UL", 52002), "00480007": el("UL", 35748),
        "7FE00008": { vr: "OF", BulkDataURI: "bulk" },
        "52009229": el("SQ", {
            "00289145": el("SQ", { "00281052": el("DS", "0"), "00281053": el("DS", "1") }),
            "00289132": el("SQ", { "00281050": el("DS", "0.5"), "00281051": el("DS", "1"), "00281056": el("CS", "LINEAR") }),
        }),
        "00409096": el("SQ", { "00409214": el("FD", 0), "00409213": el("FD", 1), "00409210": el("SH", "Aggressiveness") }),
    };
    const client = mockClient({
        [`/studies/${STUDY}/series/${SERIES}/instances`]: [{ "00080018": el("UI", INSTANCE) }],
        [`/studies/${STUDY}/series/${SERIES}/instances/${INSTANCE}/metadata`]: [meta],
    });

    const item = await DicomTools.findDerivedItem(client, STUDY, SERIES, "pmap");
    const level = item.levels[0];
    check("pmap.logicalTileSpansMatrix", [level.tileWidth, level.tileHeight], [52002, 35748]);
    check("pmap.frameDims", [level.frameWidth, level.frameHeight], [466, 306]);
    check("pmap.singleTile", Object.keys(level.frames), ["0_0"]);
    check("pmap.float", item.pixel.floatPixelData, true);
    check("pmap.valueRange", item.valueRange, { min: 0, max: 1 });
    check("pmap.voi", item.voiLut.presets, [{ center: 0.5, width: 1, explanation: null }]);
}

/* ------------------------------------------------------------------ */

if (failures.length) {
    console.error(`\nDICOM conformance: ${passed} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`DICOM conformance: ${passed} checks passed.`);
