/**
 * Two things about the radiology query layer are worth pinning.
 *
 * The classifier is exclusive by construction: it must never claim a slide, a
 * segmentation or a parametric map, because every one of those has a reader that
 * knows what to do with it and this one does not.
 *
 * The request budget is a design constraint, not an optimisation. `findWSIItems`
 * can walk its instances because a pyramid has ~5 levels; the same loop over a
 * 300-slice CT is 300 requests and tens of megabytes of JSON. If a refactor ever
 * reintroduces a per-instance walk here, this test is what says so.
 */
import { test, expect } from "@xopat/test-harness";

// `tile-source.mjs` is not imported here, but dicom-query.mjs is standalone.
globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const AXIAL = [1, 0, 0, 0, 1, 0];
const CT_SOP = "1.2.840.10008.5.1.4.1.1.2";

/** A QIDO instance row for slice `i` of a CT. */
const ctRow = (i, over = {}) => ({
    "00080016": { Value: [CT_SOP] },
    "00080018": { Value: [`1.2.3.${i}`] },
    "00080060": { Value: ["CT"] },
    "00200013": { Value: [i + 1] },
    "00200032": { Value: [0, 0, i * 1.25] },
    "00200037": { Value: AXIAL },
    "00200052": { Value: ["1.2.99"] },
    "00280010": { Value: [512] },
    "00280011": { Value: [512] },
    "00280030": { Value: [0.7, 0.7] },
    "00280004": { Value: ["MONOCHROME2"] },
    "00280100": { Value: [16] },
    "00280101": { Value: [12] },
    "00280103": { Value: [1] },
    "00281053": { Value: [1] },
    "00281052": { Value: [-1024] },
    "00281050": { Value: [40] },
    "00281051": { Value: [400] },
    "00281055": { Value: ["SOFT TISSUE"] },
    "00280008": { Value: [1] },
    ...over,
});

/** Instance-level `/metadata` for the representative slice. */
const ctMetadata = () => [ctRow(0)];

/**
 * A client that records every path it is asked for. `fetchRaw` is the only
 * surface `DicomTools` uses, so stubbing it exercises the real query code.
 */
function stubClient(routes) {
    const calls = [];
    return {
        calls,
        async fetchRaw(path) {
            calls.push(path);
            for (const [match, body] of routes) {
                if (path.includes(match)) {
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

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

test("claims CT/MR/PT/CR/DX/NM by SOP class or modality", { tag: ["@unit"] }, () => {
    expect(DicomTools.isRadiologyInstance(ctRow(0))).toBe(true);
    expect(DicomTools.isRadiologyInstance({ "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.4.1"] } })).toBe(true);
    expect(DicomTools.isRadiologyInstance({ "00080060": { Value: ["MR"] } })).toBe(true);
    expect(DicomTools.isRadiologyInstance({ "00080060": { Value: ["PT"] } })).toBe(true);
    expect(DicomTools.isRadiologyInstance({ "00080060": { Value: ["DX"] } })).toBe(true);
});

test("never claims a slide, a segmentation or a parametric map", { tag: ["@unit"] }, () => {
    const wsi = { "00080060": { Value: ["SM"] }, "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] } };
    expect(DicomTools.isRadiologyInstance(wsi)).toBe(false);
    // isWSIInstance must keep answering exactly as it did.
    expect(DicomTools.isWSIInstance(wsi)).toBe(true);

    const seg = { "00080016": { Value: [DicomTools.SOP_SEGMENTATION] }, "00080060": { Value: ["SEG"] } };
    expect(DicomTools.isRadiologyInstance(seg)).toBe(false);
    expect(DicomTools.isSegInstance(seg)).toBe(true);

    const pmap = { "00080016": { Value: [DicomTools.SOP_PARAMETRIC_MAP] }, "00080060": { Value: ["OT"] } };
    expect(DicomTools.isRadiologyInstance(pmap)).toBe(false);

    // A CT-modality object that also declares itself WSI stays a slide.
    expect(DicomTools.isRadiologyInstance({
        "00080060": { Value: ["CT"] },
        "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME", "WSI"] },
    })).toBe(false);
});

test("refuses the SOP classes with no depth axis", { tag: ["@unit"] }, () => {
    for (const sop of [
        "1.2.840.10008.5.1.4.1.1.4.2",   // MR Spectroscopy
        "1.2.840.10008.5.1.4.1.1.7",     // Secondary Capture
        "1.2.840.10008.5.1.4.1.1.6.1",   // Ultrasound
    ]) {
        expect(DicomTools.isRadiologyInstance({ "00080016": { Value: [sop] } })).toBe(false);
    }
    expect(DicomTools.isRadiologyInstance(null)).toBe(false);
    expect(DicomTools.isRadiologyInstance({})).toBe(false);
});

test("separates volume modalities from projection ones", { tag: ["@unit"] }, () => {
    expect(DicomTools.radiologyGeometryOf(ctRow(0))).toBe("volume");
    expect(DicomTools.radiologyGeometryOf({ "00080060": { Value: ["DX"] } })).toBe("projection");
    expect(DicomTools.radiologyGeometryOf({ "00080060": { Value: ["CR"] } })).toBe("projection");
    expect(DicomTools.radiologyGeometryOf({ "00080060": { Value: ["SM"] } })).toBe(null);
});

/* ------------------------------------------------------------------ */
/* describeRadiologySeries                                             */
/* ------------------------------------------------------------------ */

test("describes a 300-slice series in exactly two requests", { tag: ["@unit"] }, async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ctRow(i));
    const client = stubClient([
        ["/metadata", ctMetadata()],
        ["/series?SeriesInstanceUID=", [{ "0008103E": { Value: ["CT chest"] }, "00200011": { Value: [3] } }]],
        ["/instances", rows],
    ]);

    const d = await DicomTools.describeRadiologySeries(client, "1.2.STUDY", "1.2.SERIES");

    expect(d.error).toBe(undefined);
    expect(d.planes).toHaveLength(300);
    expect(d.modality).toBe("CT");
    expect(d.spacingUm).toBeCloseTo(1250, 6);
    expect(d.spacingSource).toBe("positions");
    expect(d.orderStrategy).toBe("ipp-normal");

    // Instance listing + one representative /metadata + the series-label row.
    // NOT 300. The series row is skippable; the first two are not.
    expect(client.calls).toHaveLength(3);
    expect(client.calls.filter(p => p.includes("/metadata"))).toHaveLength(1);

    // With the series row supplied, it is two.
    const client2 = stubClient([["/metadata", ctMetadata()], ["/instances", rows]]);
    await DicomTools.describeRadiologySeries(client2, "1.2.STUDY", "1.2.SERIES", { seriesMeta: { description: "x" } });
    expect(client2.calls).toHaveLength(2);
});

test("reads the representative metadata from the middle plane", { tag: ["@unit"] }, async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ctRow(i));
    const client = stubClient([["/metadata", ctMetadata()], ["/instances", rows]]);
    await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });

    // Plane 5 of 0..10 — not the first, which on a real series is the slice most
    // likely to be partially outside the patient.
    expect(client.calls.find(p => p.includes("/metadata"))).toContain("1.2.3.5");
});

test("carries the display chain and a CT-clamped normalization range", { tag: ["@unit"] }, async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ctRow(i));
    const client = stubClient([["/metadata", ctMetadata()], ["/instances", rows]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });

    expect(d.voiPresets).toEqual([{ center: 40, width: 400, explanation: "SOFT TISSUE" }]);
    expect(d.units).toBe(null);
    expect(d.invert).toBe(false);
    expect(d.width).toBe(512);
    // PixelSpacing is millimetres; micronsX/Y are micrometres.
    expect(d.micronsX).toBeCloseTo(700, 6);
    expect(d.micronsY).toBeCloseTo(700, 6);
    // Clamped to the Hounsfield range plus margin, not the 12-bit signed span.
    expect(d.valueRange.min).toBeGreaterThan(-1200);
    expect(d.valueRange.max).toBeLessThan(3200);
    expect(d.frameOfReferenceUID).toBe("1.2.99");
});

test("gives a plane with its own rescale its own Modality LUT", { tag: ["@unit"] }, async () => {
    // A PET whose second plane carries a different decay correction.
    const rows = [
        ctRow(0, { "00080060": { Value: ["PT"] }, "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.128"] } }),
        ctRow(1, {
            "00080060": { Value: ["PT"] }, "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.128"] },
            "00281053": { Value: [2] }, "00281052": { Value: [0] },
        }),
    ];
    const client = stubClient([["/metadata", [rows[0]]], ["/instances", rows]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });

    expect(d.modality).toBe("PT");
    expect(d.planes[0].modalityLut).toEqual(expect.objectContaining({ slope: 1, intercept: -1024 }));
    expect(d.planes[1].modalityLut).toEqual(expect.objectContaining({ slope: 2, intercept: 0 }));
    // The normalization range is one pair of GLSL literals, so it must cover
    // both planes' transforms.
    expect(d.valueRange.max).toBeGreaterThan(4000);
});

test("falls back to ImagerPixelSpacing when a projection carries no PixelSpacing", { tag: ["@unit"] }, async () => {
    // A CR/DX routinely declares only (0018,1164) — detector element spacing. It
    // is the only calibration such an object has, and without it the slide opens
    // measuring in pixels.
    const dx = ctRow(0, {
        "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.1.1"] },
        "00080060": { Value: ["DX"] },
        "00181164": { Value: [0.139, 0.139] },
    });
    delete dx["00280030"];

    const client = stubClient([["/metadata", [dx]], ["/instances", [dx]]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "DX", { seriesMeta: {} });

    expect(d.error).toBe(undefined);
    expect(d.geometry).toBe("projection");
    expect(d.micronsX).toBeCloseTo(139, 6);
    expect(d.micronsY).toBeCloseTo(139, 6);
});

test("picks a middle instance as the series thumbnail, once per series", { tag: ["@unit"] }, async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ctRow(i));
    const client = stubClient([["/instances", rows]]);

    // The middle by InstanceNumber, not the first: the ends of a stack are
    // frequently outside the patient, so slice 0 of a chest CT is often air.
    expect(await DicomTools.pickPreviewInstance(client, "S", "E")).toBe("1.2.3.5");

    // Scrolling the card in and out of view must not re-query.
    expect(await DicomTools.pickPreviewInstance(client, "S", "E")).toBe("1.2.3.5");
    expect(client.calls).toHaveLength(1);

    // A series the store knows nothing about costs the card its picture, not an
    // exception thrown into the list rendering.
    expect(await DicomTools.pickPreviewInstance(stubClient([]), "S", "MISSING")).toBe(null);
});

test("returns null for a series that holds no radiology instances", { tag: ["@unit"] }, async () => {
    const wsiRow = { "00080018": { Value: ["1"] }, "00080060": { Value: ["SM"] } };
    const client = stubClient([["/instances", [wsiRow]]]);
    expect(await DicomTools.describeRadiologySeries(client, "S", "E")).toBe(null);

    const empty = stubClient([]);
    expect(await DicomTools.describeRadiologySeries(empty, "S", "E")).toBe(null);
});

test("surfaces a refusal from the plane model instead of half a stack", { tag: ["@unit"] }, async () => {
    const rows = [ctRow(0), ctRow(1, { "00280010": { Value: [256] } })];
    const client = stubClient([["/instances", rows]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E");
    expect(d.error).toContain("different Rows/Columns");
    expect(d.modality).toBe("CT");
});

test("retries with includefield=all when the store dropped the field list", { tag: ["@unit"] }, async () => {
    // What a bare QIDO fallback returns: identity and raster, no geometry.
    const bare = Array.from({ length: 3 }, (_, i) => ({
        "00080016": { Value: [CT_SOP] },
        "00080018": { Value: [`1.2.3.${i}`] },
        "00200013": { Value: [i + 1] },
        "00280010": { Value: [512] },
        "00280011": { Value: [512] },
        "00280008": { Value: [1] },
    }));
    const full = Array.from({ length: 3 }, (_, i) => ctRow(i));

    let served = 0;
    const client = {
        calls: [],
        async fetchRaw(path) {
            this.calls.push(path);
            const body = path.includes("/metadata") ? ctMetadata()
                : path.includes("/instances") ? (served++ === 0 ? bare : full)
                    : [];
            return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
        },
    };

    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });
    expect(d.orderStrategy).toBe("ipp-normal");
    expect(client.calls[1]).toContain("includefield=all");
    // The retry is bounded: one extra listing, never a per-instance walk.
    expect(client.calls.filter(p => p.includes("/instances") && !p.includes("/metadata"))).toHaveLength(2);
});

test("degrades to InstanceNumber when even the retry carries no geometry", { tag: ["@unit"] }, async () => {
    const bare = [2, 0, 1].map(i => ({
        "00080016": { Value: [CT_SOP] },
        "00080018": { Value: [`1.2.3.${i}`] },
        "00200013": { Value: [i + 1] },
        "00280010": { Value: [512] },
        "00280011": { Value: [512] },
        "00180088": { Value: [1.5] },
        "00280008": { Value: [1] },
    }));
    const client = stubClient([["/metadata", ctMetadata()], ["/instances", bare]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });

    expect(d.orderStrategy).toBe("instance-number");
    expect(d.planes.map(p => p.instanceUID)).toEqual(["1.2.3.0", "1.2.3.1", "1.2.3.2"]);
    expect(d.spacingUm).toBe(1500);
    expect(d.spacingSource).toBe("spacing-between-slices");
});

test("expands an enhanced multi-frame instance into planes", { tag: ["@unit"] }, async () => {
    const row = ctRow(0, { "00280008": { Value: [3] } });
    const meta = [{
        ...row,
        "52009229": { Value: [{
            "00209116": { Value: [{ "00200037": { Value: AXIAL } }] },
            "00289110": { Value: [{ "00280030": { Value: [0.7, 0.7] }, "00180088": { Value: [2] } }] },
        }] },
        "52009230": { Value: [0, 1, 2].map(i => ({
            "00209113": { Value: [{ "00200032": { Value: [0, 0, i * 2] } }] },
        })) },
    }];

    const client = stubClient([["/metadata", meta], ["/instances", [row]]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });

    expect(d.multiframe).toBe(true);
    expect(d.planes.map(p => p.frame)).toEqual([1, 2, 3]);
    expect(d.planes.every(p => p.instanceUID === "1.2.3.0")).toBe(true);
    expect(d.spacingUm).toBeCloseTo(2000, 6);
    // One listing + one metadata. The frames come out of that single fetch.
    expect(client.calls).toHaveLength(2);
});

test("refuses a multi-frame instance with no Per-Frame Functional Groups", { tag: ["@unit"] }, async () => {
    const row = ctRow(0, { "00280008": { Value: [3] } });
    const client = stubClient([["/metadata", [row]], ["/instances", [row]]]);
    const d = await DicomTools.describeRadiologySeries(client, "S", "E", { seriesMeta: {} });
    // Rendering frame 1 and calling it the series would be the silent failure.
    expect(d.error).toContain("Per-Frame Functional Groups");
});
