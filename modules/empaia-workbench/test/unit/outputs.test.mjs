/**
 * Reading the OUTPUT half of an EAD.
 *
 * The T02 tutorial app is the shape that exposed the gap: its whole result is
 * "one tumour-cell count per rectangle you drew", declared as a collection of
 * integers whose items reference `io.my_rectangles.items`. Nothing read that
 * chain, so the counts arrived as an unattributed list and the app's entire
 * point was unreadable.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
    describeOutputs, perItemOutputs, zipRegionResults,
    outputKind, describeAnnotationValues, formatOutputValue,
} = await import("../../outputs.ts");

const fixture = (id) => JSON.parse(readFileSync(
    fileURLToPath(new URL(`../fixtures/ead/${id}.json`, import.meta.url)), "utf8"));

/** `{key: kind}` for a mode — what each declared output actually holds. */
const kinds = (id, mode = "standalone") => Object.fromEntries(
    describeOutputs(fixture(id), mode).map(spec => [spec.key, outputKind(spec)]));

/** Tutorial App 02 v3, verbatim from the EMPAIA definitions repository. */
const T02 = {
    name: "Tutorial App 02 v3",
    name_short: "TA02v3",
    io: {
        my_wsi: { type: "wsi" },
        my_rectangles: {
            type: "collection",
            items: { type: "rectangle", reference: "io.my_wsi" },
        },
        tumor_cell_counts: {
            type: "collection",
            items: { type: "integer", reference: "io.my_rectangles.items" },
        },
        avg_tumor_cell_count: { type: "float", reference: "io.my_rectangles" },
    },
    modes: {
        standalone: {
            inputs: ["my_wsi", "my_rectangles"],
            outputs: ["tumor_cell_counts", "avg_tumor_cell_count"],
        },
    },
};

test("describeOutputs resolves the T02 reference chains", () => {
    const specs = describeOutputs(T02, "standalone");
    expect(specs.map(s => s.key)).toEqual(["tumor_cell_counts", "avg_tumor_cell_count"]);

    const [counts, average] = specs;
    // A per-item collection: its attribution lives on `items.reference`, not on
    // the collection node, which declares no reference at all.
    expect(counts.type).toBe("collection");
    expect(counts.itemType).toBe("integer");
    expect(counts.referenceKey).toBe("my_rectangles");
    expect(counts.perItem).toBe(true);

    // The average describes the collection as a whole — one value, not one each.
    expect(average.type).toBe("float");
    expect(average.referenceKey).toBe("my_rectangles");
    expect(average.perItem).toBe(false);
});

test("describeOutputs ignores inputs and unknown keys", () => {
    const specs = describeOutputs(T02, "standalone");
    expect(specs.some(s => s.key === "my_wsi")).toBe(false);
    expect(specs.some(s => s.key === "my_rectangles")).toBe(false);

    expect(describeOutputs(T02, "preprocessing")).toEqual([]);
    expect(describeOutputs(undefined, "standalone")).toEqual([]);
    expect(describeOutputs({ io: {}, modes: { standalone: { outputs: ["nope"] } } }, "standalone"))
        .toEqual([]);
});

test("perItemOutputs selects only what resolves against the named input", () => {
    const specs = describeOutputs(T02, "standalone");
    expect(perItemOutputs(specs, "my_rectangles").map(s => s.key)).toEqual(["tumor_cell_counts"]);
    expect(perItemOutputs(specs, "something_else")).toEqual([]);
    expect(perItemOutputs(specs, undefined)).toEqual([]);
});

test("zipRegionResults prefers reference_id over position", () => {
    // Deliberately out of order: reference_id has to win, or a backend that
    // reorders silently attributes every count to the wrong rectangle.
    const rows = zipRegionResults(["a", "b", "c"], {
        tumor_cell_counts: [
            { value: 30, reference_id: "c" },
            { value: 10, reference_id: "a" },
            { value: 20, reference_id: "b" },
        ],
    });
    expect(rows.map(r => r.values.tumor_cell_counts)).toEqual([10, 20, 30]);
    expect(rows.map(r => r.index)).toEqual([1, 2, 3]);
});

test("zipRegionResults falls back to position when no item carries a reference", () => {
    const rows = zipRegionResults(["a", "b"], {
        tumor_cell_counts: [{ value: 7 }, { value: 8 }],
    });
    expect(rows.map(r => r.values.tumor_cell_counts)).toEqual([7, 8]);
});

test("zipRegionResults keeps a partially referenced output on the reference path", () => {
    // One populated reference_id is enough: mixing the two strategies inside one
    // output would attribute the same value twice.
    const rows = zipRegionResults(["a", "b"], {
        tumor_cell_counts: [{ value: 5, reference_id: "b" }, { value: 9, reference_id: null }],
    });
    expect(rows[0].values.tumor_cell_counts).toBe(undefined);
    expect(rows[1].values.tumor_cell_counts).toBe(5);
});

test("zipRegionResults tolerates count mismatches without inventing values", () => {
    const rows = zipRegionResults(["a", "b", "c"], { tumor_cell_counts: [{ value: 1 }] });
    expect(rows.length).toBe(3);
    expect(rows[0].values.tumor_cell_counts).toBe(1);
    // Absent, not null: a null renders as a computed result the app never produced.
    expect("tumor_cell_counts" in rows[1].values).toBe(false);

    const extra = zipRegionResults(["a"], { tumor_cell_counts: [{ value: 1 }, { value: 2 }] });
    expect(extra.length).toBe(1);
    expect(extra[0].values.tumor_cell_counts).toBe(1);
});

test("zipRegionResults handles no regions and no outputs", () => {
    expect(zipRegionResults([], { tumor_cell_counts: [{ value: 1 }] })).toEqual([]);
    expect(zipRegionResults(["a"], {})).toEqual([{ regionId: "a", index: 1, values: {} }]);
    expect(zipRegionResults(undefined, undefined)).toEqual([]);
});

// ── what an output actually holds ───────────────────────────────────────────

test("outputKind sees through collection wrappers, however deep", () => {
    // TA02: numbers, one per input rectangle — the table case.
    expect(kinds("ta02")).toEqual({ tumor_cell_counts: "primitive", avg_tumor_cell_count: "primitive" });

    // TA03/TA06: a collection of collections of POINTS. Dispatching on
    // "is it a collection?" asked the server for the `value` of records that have
    // none — one wasted request per output per job, then a column of blanks.
    expect(kinds("ta03")).toEqual({ my_cells: "annotation" });
    expect(kinds("ta06")).toEqual({ my_cells: "annotation" });

    // TA04 adds per-point floats; TA05 adds per-point classes.
    expect(kinds("ta04")).toEqual({ my_cells: "annotation", my_confidences: "primitive" });
    expect(kinds("ta05")).toEqual({ my_cells: "annotation", my_cell_classes: "class" });

    // TA10 mixes all three at once, plus plain scalars.
    expect(kinds("ta10")).toEqual({
        detected_nuclei: "annotation",
        model_confidences: "primitive",
        nucleus_classifications: "class",
        number_positive: "primitive",
        number_negative: "primitive",
        positivity: "primitive",
    });

    // TA13's pixel map is neither a value nor a shape.
    expect(kinds("ta13", "preprocessing")).toMatchObject({ tissue_nuclei_map: "pixelmap" });
});

test("the leaf type and its depth are recorded, not just items.type", () => {
    const cells = describeOutputs(fixture("ta03"), "standalone")[0];
    expect(cells.itemType).toBe("collection");   // what the old code saw
    expect(cells.leafType).toBe("point");        // what it actually holds
    expect(cells.leafDepth).toBe(2);
});

test("an unknown io type is reported as unknown rather than guessed", () => {
    expect(kinds("ta14", "preprocessing")).toEqual({ my_questionnaire_response: "unknown" });
});

// ── the blank-column bug ────────────────────────────────────────────────────

test("a valueless item leaves the key absent, so the cell reads as empty not blank", () => {
    // Inner collections have no `value` at all. Writing `undefined` still creates
    // the key, and `key in values` then renders "" where "—" was meant.
    const rows = zipRegionResults(["a", "b"], {
        my_cells: [{ reference_id: "a" }, { reference_id: "b" }],
    });
    expect("my_cells" in rows[0].values).toBe(false);
    expect("my_cells" in rows[1].values).toBe(false);

    const positional = zipRegionResults(["a", "b"], { my_cells: [{}, {}] });
    expect("my_cells" in positional[0].values).toBe(false);
});

test("a real value alongside valueless siblings still lands", () => {
    const rows = zipRegionResults(["a", "b"], {
        counts: [{ value: 7, reference_id: "a" }, { reference_id: "b" }],
    });
    expect(rows[0].values.counts).toBe(7);
    expect("counts" in rows[1].values).toBe(false);
});

// ── per-annotation labels ───────────────────────────────────────────────────

test("per-object values read as class first, numbers after", () => {
    const object = { empaiaClass: "org.empaia.vendor.app.v1.classes.tumor" };
    expect(describeAnnotationValues(object, [{ name: "confidence", value: 0.932723999 }]))
        .toBe("tumor · confidence 0.9327");
});

test("an existing category is kept as the lead, never overwritten", () => {
    // The class is a permanent fact about the annotation; a run's number is not.
    expect(describeAnnotationValues({}, [{ name: "score", value: 3 }], "Tumour nest"))
        .toBe("Tumour nest · score 3");
});

test("labels degrade rather than print noise", () => {
    expect(describeAnnotationValues(undefined, [])).toBe("");
    expect(describeAnnotationValues({}, [{ value: 5 }])).toBe("5");
    expect(describeAnnotationValues({}, [{ name: "n", value: undefined }])).toBe("");
    expect(formatOutputValue(true)).toBe("yes");
    expect(formatOutputValue(2)).toBe("2");
    expect(formatOutputValue(null)).toBe("");
});
