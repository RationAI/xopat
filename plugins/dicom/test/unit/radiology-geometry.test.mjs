/**
 * The radiology plane model decides what the depth axis of a CT/MR/PET stack
 * *is*. Every failure mode here is silent at runtime: slices in the wrong order,
 * two interleaved volumes combed together, or a spacing off by the overlap
 * factor still render a plausible picture of the wrong thing — and `spacingUm`
 * feeds `mapPlaneIndex`, so a wrong value misregisters every overlay on the
 * stack. Hence these tests pin the ordering rules, not the output pixels.
 */
import { test, expect } from "@xopat/test-harness";

const {
    buildPlaneModel,
    chooseValueRange,
    normalFromOrientation,
    planeCandidateFromInstance,
    planeCandidatesFromMultiframe,
    RADIOLOGY_MAX_DIMENSION,
} = await import("../../radiology-geometry.mjs");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Axial orientation: rows run +x, columns run +y, so the normal is +z. */
const AXIAL = [1, 0, 0, 0, 1, 0];

const plane = (over = {}) => ({
    instanceUID: over.instanceUID ?? `uid-${over.instanceNumber ?? 0}`,
    frame: 1,
    ipp: over.ipp !== undefined ? over.ipp : [0, 0, over.z ?? 0],
    iop: over.iop !== undefined ? over.iop : AXIAL,
    sliceLocation: over.sliceLocation,
    instanceNumber: over.instanceNumber,
    inStackPosition: over.inStackPosition,
    rows: over.rows ?? 512,
    cols: over.cols ?? 512,
    pixelSpacing: over.pixelSpacing !== undefined ? over.pixelSpacing : [0.7, 0.7],
    sliceThickness: over.sliceThickness,
    spacingBetweenSlices: over.spacingBetweenSlices,
    photometricInterpretation: over.photometricInterpretation ?? "MONOCHROME2",
    keys: over.keys ?? {},
});

/** N axial planes, `step` mm apart, shuffled so ordering has to do real work. */
const stack = (n, step = 1, over = {}) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(plane({ ...over, z: i * step, instanceNumber: i + 1, instanceUID: `uid-${i}` }));
    return [...out].reverse();
};

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

test("orders by the projection of ImagePositionPatient onto the slice normal", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel(stack(5, 2.5));

    expect(model.error).toBe(undefined);
    expect(model.orderStrategy).toBe("ipp-normal");
    expect(model.planes.map(p => p.position)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(model.planes.map(p => p.instanceUID)).toEqual(["uid-0", "uid-1", "uid-2", "uid-3", "uid-4"]);
    expect(model.spacingUm).toBe(2500);
    expect(model.spacingSource).toBe("positions");
    expect(model.irregular).toBe(false);
});

test("projects onto the cluster normal, so an anti-parallel orientation does not comb the stack", { tag: ["@unit"] }, () => {
    // Same physical plane, opposite row/column convention: the per-plane normal
    // is -z. Projecting onto each plane's own normal would flip half the signs.
    const flipped = [-1, 0, 0, 0, 1, 0];
    const model = buildPlaneModel([
        plane({ z: 0, instanceNumber: 1, instanceUID: "a" }),
        plane({ z: 1, instanceNumber: 2, instanceUID: "b", iop: flipped }),
        plane({ z: 2, instanceNumber: 3, instanceUID: "c" }),
    ]);

    expect(model.error).toBe(undefined);
    expect(model.planes.map(p => p.instanceUID)).toEqual(["a", "b", "c"]);
    expect(model.rejected).toEqual([]);
});

test("keeps the dominant orientation and reports the localizer it dropped", { tag: ["@unit"] }, () => {
    const sagittal = [0, 1, 0, 0, 0, -1];
    const model = buildPlaneModel([
        ...stack(4),
        plane({ z: 0, instanceNumber: 99, instanceUID: "scout", iop: sagittal, ipp: [5, 0, 0] }),
    ]);

    expect(model.planes).toHaveLength(4);
    expect(model.rejected).toEqual([
        { reason: "differing image orientation (localizer or second series)", count: 1 },
    ]);
    expect(model.warnings.join(" ")).toContain("2 image orientations");
});

test("falls back to SliceLocation, then InstanceNumber", { tag: ["@unit"] }, () => {
    const noGeometry = [3, 1, 2].map(i => plane({
        instanceUID: `uid-${i}`, instanceNumber: i, ipp: null, iop: null, sliceLocation: i * 4,
    }));
    const byLocation = buildPlaneModel(noGeometry);
    expect(byLocation.orderStrategy).toBe("slice-location");
    expect(byLocation.planes.map(p => p.position)).toEqual([4, 8, 12]);
    // SliceLocation *is* the projected position, so a derived spacing is honest.
    expect(byLocation.spacingSource).toBe("positions");
    expect(byLocation.spacingUm).toBe(4000);

    const numberedOnly = [3, 1, 2].map(i => plane({
        instanceUID: `uid-${i}`, instanceNumber: i, ipp: null, iop: null,
    }));
    const byNumber = buildPlaneModel(numberedOnly);
    expect(byNumber.orderStrategy).toBe("instance-number");
    expect(byNumber.planes.map(p => p.instanceUID)).toEqual(["uid-1", "uid-2", "uid-3"]);
    // No coordinate exists, so a spacing "derived" from the ordering would be
    // derived from nothing.
    expect(byNumber.spacingUm).toBe(undefined);
    expect(byNumber.spacingSource).toBe(null);
});

test("ignores a positional minority rather than shrinking the series to it", { tag: ["@unit"] }, () => {
    const many = [1, 2, 3, 4, 5].map(i => plane({
        instanceUID: `uid-${i}`, instanceNumber: i, ipp: null, iop: null, sliceLocation: i,
    }));
    // One instance carries full geometry. Ordering by it alone would render a
    // one-plane stack and reject the other five.
    many.push(plane({ instanceUID: "odd", instanceNumber: 6, z: 6, sliceLocation: 6 }));

    const model = buildPlaneModel(many);
    expect(model.orderStrategy).toBe("slice-location");
    expect(model.planes).toHaveLength(6);
    expect(model.rejected).toEqual([]);
});

test("mixed positional metadata degrades to InstanceNumber rather than guessing", { tag: ["@unit"] }, () => {
    // Some planes have SliceLocation, some only IPP: neither coordinate covers
    // the series, so no single depth axis can be built from either.
    const model = buildPlaneModel([
        plane({ instanceUID: "a", instanceNumber: 1, ipp: null, iop: null, sliceLocation: 1 }),
        plane({ instanceUID: "b", instanceNumber: 2, ipp: null, iop: null, sliceLocation: 2 }),
        plane({ instanceUID: "c", instanceNumber: 3, z: 3 }),
    ]);
    expect(model.orderStrategy).toBe("instance-number");
    expect(model.planes.map(p => p.instanceUID)).toEqual(["a", "b", "c"]);
    expect(model.spacingUm).toBe(undefined);
});

test("refuses a series with no depth ordering at all", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel([
        plane({ instanceUID: "a", ipp: null, iop: null }),
        plane({ instanceUID: "b", ipp: null, iop: null }),
    ]);
    expect(model.error).toContain("depth order is undefined");
});

test("InStackPositionNumber outranks the computed projection", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel([
        plane({ instanceUID: "a", instanceNumber: 1, z: 10, inStackPosition: 3 }),
        plane({ instanceUID: "b", instanceNumber: 2, z: 20, inStackPosition: 1 }),
        plane({ instanceUID: "c", instanceNumber: 3, z: 30, inStackPosition: 2 }),
    ]);
    expect(model.planes.map(p => p.instanceUID)).toEqual(["b", "c", "a"]);
});

/* ------------------------------------------------------------------ */
/* Spacing                                                             */
/* ------------------------------------------------------------------ */

test("never prefers SliceThickness over a derived spacing", { tag: ["@unit"] }, () => {
    // Overlapped acquisition: 5 mm slabs every 2.5 mm. Reporting 5000 would
    // misregister every physically-mapped overlay by a factor of two.
    const model = buildPlaneModel(stack(4, 2.5, { sliceThickness: 5, spacingBetweenSlices: 5 }));
    expect(model.spacingUm).toBe(2500);
    expect(model.spacingSource).toBe("positions");
});

test("spacing precedence when no positions exist: SpacingBetweenSlices, then SliceThickness", { tag: ["@unit"] }, () => {
    const withSpacing = buildPlaneModel([1, 2, 3].map(i => plane({
        instanceUID: `uid-${i}`, instanceNumber: i, ipp: null, iop: null,
        spacingBetweenSlices: 3, sliceThickness: 5,
    })));
    expect(withSpacing.spacingUm).toBe(3000);
    expect(withSpacing.spacingSource).toBe("spacing-between-slices");

    const thicknessOnly = buildPlaneModel([1, 2, 3].map(i => plane({
        instanceUID: `uid-${i}`, instanceNumber: i, ipp: null, iop: null, sliceThickness: 5,
    })));
    expect(thicknessOnly.spacingUm).toBe(5000);
    expect(thicknessOnly.spacingSource).toBe("slice-thickness");
    expect(thicknessOnly.warnings.join(" ")).toContain("SliceThickness");
});

test("flags irregular spacing, emits the median, and keeps exact positions in the labels", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel([
        plane({ instanceUID: "a", instanceNumber: 1, z: 0 }),
        plane({ instanceUID: "b", instanceNumber: 2, z: 1 }),
        plane({ instanceUID: "c", instanceNumber: 3, z: 2.2 }),
        plane({ instanceUID: "d", instanceNumber: 4, z: 3.3 }),
    ]);
    expect(model.irregular).toBe(true);
    expect(model.spacingUm).toBeCloseTo(1100, 6);
    expect(model.planes.map(p => p.label)).toEqual(["0.0 mm", "1.0 mm", "2.2 mm", "3.3 mm"]);
});

test("splits at a positional gap and keeps the largest contiguous run", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel([
        ...[0, 1, 2].map(i => plane({ instanceUID: `lo-${i}`, instanceNumber: i + 1, z: i })),
        ...[0, 1, 2, 3, 4].map(i => plane({ instanceUID: `hi-${i}`, instanceNumber: i + 10, z: 60 + i })),
    ]);

    expect(model.planes.map(p => p.instanceUID)).toEqual(["hi-0", "hi-1", "hi-2", "hi-3", "hi-4"]);
    expect(model.spacingUm).toBe(1000);
    expect(model.rejected).toEqual([{ reason: "position gap (discontinuous stack)", count: 3 }]);
});

/* ------------------------------------------------------------------ */
/* Interleaved volumes                                                 */
/* ------------------------------------------------------------------ */

test("refuses to interleave a dual-echo MR: it splits and renders one volume", { tag: ["@unit"] }, () => {
    const planes = [];
    for (let i = 0; i < 4; i++) {
        planes.push(plane({ instanceUID: `e1-${i}`, instanceNumber: 2 * i + 1, z: i, keys: { echoNumber: "1" } }));
        planes.push(plane({ instanceUID: `e2-${i}`, instanceNumber: 2 * i + 2, z: i, keys: { echoNumber: "2" } }));
    }
    // One extra plane on echo 1 makes it the larger volume, deterministically.
    planes.push(plane({ instanceUID: "e1-4", instanceNumber: 99, z: 4, keys: { echoNumber: "1" } }));

    const model = buildPlaneModel(planes);
    expect(model.subVolumes.map(s => s.key)).toEqual(["echoNumber=1", "echoNumber=2"]);
    expect(model.activeSubVolume).toBe("echoNumber=1");
    expect(model.planes.map(p => p.instanceUID)).toEqual(["e1-0", "e1-1", "e1-2", "e1-3", "e1-4"]);
    // The sub-volume is named in the labels once more than one exists.
    expect(model.planes[0].label).toBe("0.0 mm · echoNumber=1");
    expect(model.warnings.join(" ")).toContain("interleaves 2 volumes");

    const other = buildPlaneModel(planes, { subVolume: "echoNumber=2" });
    expect(other.planes.map(p => p.instanceUID)).toEqual(["e2-0", "e2-1", "e2-2", "e2-3"]);
});

test("does not split on a discriminator that never varies between co-located planes", { tag: ["@unit"] }, () => {
    // Many scanners increment AcquisitionNumber per slice. Splitting on it would
    // reduce the series to one plane per sub-volume.
    const model = buildPlaneModel(stack(6).map((p, i) => ({ ...p, keys: { acquisitionNumber: String(i) } })));
    expect(model.subVolumes).toHaveLength(1);
    expect(model.activeSubVolume).toBe(null);
    expect(model.planes).toHaveLength(6);
    expect(model.planes[0].label).toBe("0.0 mm");
});

test("collapses indistinguishable duplicates, keeping the lowest InstanceNumber", { tag: ["@unit"] }, () => {
    const model = buildPlaneModel([
        plane({ instanceUID: "orig", instanceNumber: 1, z: 0 }),
        plane({ instanceUID: "resent", instanceNumber: 7, z: 0 }),
        plane({ instanceUID: "next", instanceNumber: 2, z: 1 }),
    ]);
    expect(model.planes.map(p => p.instanceUID)).toEqual(["orig", "next"]);
    expect(model.warnings.join(" ")).toContain("duplicate plane");
});

/* ------------------------------------------------------------------ */
/* Raster refusals                                                     */
/* ------------------------------------------------------------------ */

test("refuses a series whose planes are not one common raster", { tag: ["@unit"] }, () => {
    expect(buildPlaneModel([
        plane({ instanceUID: "a", instanceNumber: 1, z: 0 }),
        plane({ instanceUID: "b", instanceNumber: 2, z: 1, rows: 256 }),
    ]).error).toContain("different Rows/Columns");

    expect(buildPlaneModel([
        plane({ instanceUID: "a", instanceNumber: 1, z: 0 }),
        plane({ instanceUID: "b", instanceNumber: 2, z: 1, pixelSpacing: [0.35, 0.35] }),
    ]).error).toContain("different PixelSpacing");

    expect(buildPlaneModel([plane({ photometricInterpretation: "RGB" })]).error)
        .toContain("not a monochrome intensity image");

    expect(buildPlaneModel([plane({ rows: RADIOLOGY_MAX_DIMENSION + 1 })]).error)
        .toContain(`${RADIOLOGY_MAX_DIMENSION}px limit`);

    expect(buildPlaneModel([]).error).toBe("no instances in series");
});

/* ------------------------------------------------------------------ */
/* Candidate extraction                                                */
/* ------------------------------------------------------------------ */

test("normalFromOrientation rejects a degenerate orientation", { tag: ["@unit"] }, () => {
    expect(normalFromOrientation(AXIAL)).toEqual([0, 0, 1]);
    expect(normalFromOrientation([1, 0, 0, 1, 0, 0])).toBe(null);   // parallel cosines
    expect(normalFromOrientation([1, 0, 0])).toBe(null);
    expect(normalFromOrientation(null)).toBe(null);
});

test("reads a plane candidate out of a DICOM-JSON instance row", { tag: ["@unit"] }, () => {
    const c = planeCandidateFromInstance({
        "00080018": { Value: ["1.2.3"] },
        "00200032": { Value: [0, 0, "-120.5"] },
        "00200037": { Value: AXIAL },
        "00200013": { Value: ["4"] },
        "00280010": { Value: [512] },
        "00280011": { Value: [512] },
        "00280030": { Value: ["0.7", "0.7"] },
        "00180088": { Value: [1.25] },
        "00280004": { Value: ["monochrome2"] },
        "00180086": { Value: [2] },
        "00281053": { Value: ["1"] },
        "00281052": { Value: ["-1024"] },
    });

    expect(c.instanceUID).toBe("1.2.3");
    expect(c.frame).toBe(1);
    expect(c.ipp).toEqual([0, 0, -120.5]);
    expect(c.instanceNumber).toBe(4);
    expect(c.spacingBetweenSlices).toBe(1.25);
    expect(c.photometricInterpretation).toBe("MONOCHROME2");
    expect(c.keys.echoNumber).toBe("2");
    // A differing rescale pair is itself a discriminator between co-located planes.
    expect(c.keys.rescale).toBe("1/-1024");

    expect(planeCandidateFromInstance({})).toBe(null);
});

test("per-frame functional groups override the shared ones", { tag: ["@unit"] }, () => {
    const ds = {
        "00080018": { Value: ["1.2.3"] },
        "00280010": { Value: [256] },
        "00280011": { Value: [256] },
        "00280004": { Value: ["MONOCHROME2"] },
        "52009229": { Value: [{
            "00209116": { Value: [{ "00200037": { Value: AXIAL } }] },
            "00289110": { Value: [{ "00280030": { Value: [1, 1] }, "00180088": { Value: [2] } }] },
            "00289145": { Value: [{ "00281053": { Value: [1] }, "00281052": { Value: [0] } }] },
        }] },
        "52009230": { Value: [0, 1, 2].map(i => ({
            "00209113": { Value: [{ "00200032": { Value: [0, 0, i * 2] } }] },
            "00209111": { Value: [{ "00209057": { Value: [3 - i] } }] },
            // Frame 1 overrides the shared rescale — a per-frame transform that
            // the shared-only lookup would miss, and that must reach the plane.
            ...(i === 1 ? { "00289145": { Value: [{ "00281053": { Value: [2] }, "00281052": { Value: [-10] } }] } } : {}),
        })) },
    };

    const candidates = planeCandidatesFromMultiframe(ds);
    expect(candidates).toHaveLength(3);
    expect(candidates.map(c => c.frame)).toEqual([1, 2, 3]);
    expect(candidates[0].ipp).toEqual([0, 0, 0]);
    expect(candidates[0].iop).toEqual(AXIAL);
    expect(candidates[0].spacingBetweenSlices).toBe(2);
    expect(candidates[0].keys.rescale).toBe("1/0");
    expect(candidates[1].keys.rescale).toBe("2/-10");
    expect(candidates[2].inStackPosition).toBe(1);

    // InStackPositionNumber is authored, so it drives the order.
    const model = buildPlaneModel(candidates);
    expect(model.planes.map(p => p.frame)).toEqual([3, 2, 1]);
    expect(model.planes.every(p => p.instanceUID === "1.2.3")).toBe(true);

    expect(planeCandidatesFromMultiframe({})).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Normalization range                                                 */
/* ------------------------------------------------------------------ */

const ct16 = { bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 1, photometricInterpretation: "MONOCHROME2" };
const hu = { kind: "linear", slope: 1, intercept: 0, units: "HU" };

test("clamps CT to the Hounsfield range half-float can actually resolve", { tag: ["@unit"] }, () => {
    const range = chooseValueRange({ modality: "CT", pixel: ct16, modalityLut: hu });
    // -1024..3071 plus the 2% margin, instead of the -32768..32767 the pixel
    // representation allows (~32 HU per representable half-float step).
    expect(range.min).toBeCloseTo(-1024 - 4095 * 0.02, 6);
    expect(range.max).toBeCloseTo(3071 + 4095 * 0.02, 6);
});

test("does not clamp CT stored values when no Modality LUT puts them in HU", { tag: ["@unit"] }, () => {
    const range = chooseValueRange({ modality: "CT", pixel: { ...ct16, bitsStored: 12 }, modalityLut: null });
    expect(range.min).toBeLessThan(-2048);
    expect(range.max).toBeGreaterThan(2047);
});

test("widens the range to cover every declared preset", { tag: ["@unit"] }, () => {
    const voiLut = { presets: [{ center: 40, width: 400 }, { center: -600, width: 1500 }], fn: "LINEAR", lut: null };
    const range = chooseValueRange({ modality: "CT", pixel: ct16, modalityLut: hu, voiLut });
    // Selecting the lung preset must not clip against the range chosen to hold it.
    expect(range.min).toBeLessThanOrEqual(-1350);
    expect(range.max).toBeGreaterThanOrEqual(240);
});

test("PET starts at zero and covers every plane's rescale", { tag: ["@unit"] }, () => {
    const pt = { bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 0, photometricInterpretation: "MONOCHROME2" };
    const range = chooseValueRange({
        modality: "PT", pixel: pt, modalityLut: { kind: "linear", slope: 1, intercept: 0 },
        extraRanges: [{ min: 0, max: 120000 }],
    });
    expect(range.min).toBeLessThanOrEqual(0);
    expect(range.max).toBeGreaterThanOrEqual(120000);
});

test("a declared real-world range wins over the derived one", { tag: ["@unit"] }, () => {
    const range = chooseValueRange({
        modality: "PT", pixel: ct16, modalityLut: hu, realWorldRange: { min: 0, max: 20 },
    });
    expect(range.min).toBeCloseTo(-0.4, 6);
    expect(range.max).toBeCloseTo(20.4, 6);
});

test("a degenerate range still yields a usable span", { tag: ["@unit"] }, () => {
    const flat = { bitsAllocated: 8, bitsStored: 8, pixelRepresentation: 0 };
    const range = chooseValueRange({ pixel: flat, modalityLut: { kind: "linear", slope: 0, intercept: 5 } });
    expect(range.max).toBeGreaterThan(range.min);
});
