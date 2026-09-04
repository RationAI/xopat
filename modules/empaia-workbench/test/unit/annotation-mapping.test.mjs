/**
 * The EMPAIA ⇄ xOpat annotation geometry mapping.
 *
 * Both directions are pure functions over plain records, so the whole
 * coordinate contract is testable without a canvas: EMPAIA coordinates are
 * level-0 image pixels, which is exactly what fabric objects carry.
 *
 * The regression these guard: TA03's output points arriving stacked in the
 * slide's top-left corner. Whatever the cause turns out to be, "the mapper puts
 * a point where its coordinates say" must stay asserted, and the offset must
 * cancel between export and import.
 */
import { test, expect } from "@xopat/test-harness";

const { nativeToEmpaia, empaiaToNative } = await import("../../convertor.ts");

const ctx = (extra = {}) => ({ scopeId: "scope-1", slideId: "wsi-1", defaultNpp: 250, ...extra });

test("a point maps to its own coordinates, in both directions", () => {
    const wire = empaiaToNative(
        { type: "point", coordinates: [40321, 17890], reference_id: "wsi-1" }, ctx());
    expect(wire).toMatchObject({ factoryID: "point", type: "ellipse", left: 40321, top: 17890 });

    const back = nativeToEmpaia({ factoryID: "point", left: 40321, top: 17890 }, ctx());
    expect(back).toMatchObject({ type: "point", coordinates: [40321, 17890], reference_id: "wsi-1" });
});

test("the coordinate offset cancels across a round trip", () => {
    const offset = ctx({ coordinateOffset: { x: 1000, y: 250 } });
    const posted = nativeToEmpaia({ factoryID: "point", left: 40321, top: 17890 }, offset);
    expect(posted.coordinates).toEqual([41321, 18140]);
    expect(empaiaToNative({ type: "point", coordinates: posted.coordinates, reference_id: "wsi-1" }, offset))
        .toMatchObject({ left: 40321, top: 17890 });
});

test("a rectangle keeps its corner and its scaled extent", () => {
    // fabric stores a resized rect as unscaled width/height plus a scale factor;
    // exporting the raw width would send the app a region of the wrong size.
    expect(nativeToEmpaia(
        { factoryID: "rect", left: 500, top: 600, width: 100, height: 40, scaleX: 3, scaleY: 2 }, ctx()))
        .toMatchObject({ type: "rectangle", upper_left: [500, 600], width: 300, height: 80 });

    expect(empaiaToNative(
        { type: "rectangle", upper_left: [500, 600], width: 300, height: 80, reference_id: "wsi-1" }, ctx()))
        .toMatchObject({ factoryID: "rect", left: 500, top: 600, width: 300, height: 80 });
});

test("a malformed geometry is skipped, never placed at the origin", () => {
    // The failure mode this whole file exists for: a mapper that coerced a bad
    // coordinate to 0 would silently pile every annotation into the corner.
    for (const bad of [
        { type: "point", reference_id: "wsi-1" },
        { type: "point", coordinates: [], reference_id: "wsi-1" },
        { type: "point", coordinates: ["a", "b"], reference_id: "wsi-1" },
        { type: "point", coordinates: [null, 5], reference_id: "wsi-1" },
    ]) {
        expect(empaiaToNative(bad, ctx())).toBe(undefined);
    }
});

test("a job's output is imported read-only and carries its producing job", () => {
    const native = empaiaToNative({
        type: "point", coordinates: [10, 20], reference_id: "wsi-1",
        creator_id: "job-7", creator_type: "job", id: "ann-1",
    }, ctx({ isJobId: (id) => id === "job-7" }));
    expect(native).toMatchObject({ readOnly: true, empaiaJobId: "job-7", empaiaId: "ann-1" });
});

// ── naming shapes that carry no class ──────────────────────────────────────

test("a job's unclassified shape is filed under the app's output preset", () => {
    // TA06 declares an annotation output and no class output — an app may only
    // write what its EAD declares, so these shapes cannot carry a class. Without
    // a preset of their own all 24 690 of them read as the literal "Unknown".
    const native = empaiaToNative(
        { type: "point", coordinates: [10, 20], reference_id: "wsi-1",
            creator_id: "job-7", creator_type: "job" },
        ctx({ isJobId: (id) => id === "job-7", presetForJobOutput: () => "empaia-out:my_cells" }));
    expect(native.presetID).toBe("empaia-out:my_cells");
});

test("the user's own unclassified shape is not filed under it", () => {
    // Scratch work the pathologist drew is not this app's result, and grouping it
    // with the analysis output would misattribute their own annotations.
    const native = empaiaToNative(
        { type: "point", coordinates: [10, 20], reference_id: "wsi-1",
            creator_id: "scope-1", creator_type: "scope" },
        ctx({ isJobId: () => false, presetForJobOutput: () => "empaia-out:my_cells" }));
    expect(native.presetID).toBe(undefined);
});

test("a class always wins over the output preset", () => {
    // TA05 declares both. The class is the more specific fact and the one the
    // workbench actually stored.
    const native = empaiaToNative(
        { type: "point", coordinates: [10, 20], reference_id: "wsi-1",
            creator_id: "job-7", creator_type: "job",
            classes: [{ value: "org.empaia.vendor.app.v1.classes.tumor" }] },
        ctx({
            isJobId: () => true,
            presetForClassValue: (v) => (v ? `empaia:${v}` : undefined),
            presetForJobOutput: () => "empaia-out:my_cells",
        }));
    expect(native.presetID).toBe("empaia:org.empaia.vendor.app.v1.classes.tumor");
    expect(native.empaiaClass).toBe("org.empaia.vendor.app.v1.classes.tumor");
});

test("the wire's creation time is carried, so no row says 'Invalid Date'", () => {
    // Nothing on the import path assigns `created`; only interactive creation
    // does. The board prints `new Date(object.created)` and an absent value
    // renders as the literal string "Invalid Date" on every imported row.
    const native = empaiaToNative(
        { type: "point", coordinates: [1, 2], reference_id: "wsi-1", created_at: 1_700_000_000_000 },
        ctx());
    expect(native.created).toBe(1_700_000_000_000);
    // Absent or malformed stays absent — a wrong time is worse than none.
    expect(empaiaToNative({ type: "point", coordinates: [1, 2], reference_id: "wsi-1" }, ctx()).created)
        .toBe(undefined);
    expect(empaiaToNative(
        { type: "point", coordinates: [1, 2], reference_id: "wsi-1", created_at: "yesterday" }, ctx()).created)
        .toBe(undefined);
});
