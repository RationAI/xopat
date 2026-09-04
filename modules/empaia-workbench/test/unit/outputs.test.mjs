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
    outputKind, formatOutputValue, labelForOutputValue,
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

// ── one value, as a user reads it ───────────────────────────────────────────

test("values degrade rather than print noise", () => {
    expect(formatOutputValue(true)).toBe("yes");
    expect(formatOutputValue(false)).toBe("no");
    expect(formatOutputValue(2)).toBe("2");
    expect(formatOutputValue(null)).toBe("");
    expect(formatOutputValue(undefined)).toBe("");
});

test("a float is trimmed to four decimals, an integer keeps none", () => {
    // A raw 0.9327239990234375 in a label is noise; the exact value stays under
    // its own key in the annotation's meta.
    expect(formatOutputValue(0.932723999)).toBe("0.9327");
    expect(formatOutputValue(3)).toBe("3");
    // `0` is a legitimate prediction and must not read as absent.
    expect(formatOutputValue(0)).toBe("0");
});

test("a label says what its number means", () => {
    // The whole point: TA12's ROI showed a bare "0", which says nothing about
    // whether it is a ratio, a count or a score.
    expect(labelForOutputValue("Tumor Ratio", 0)).toBe("Tumor Ratio 0");
    expect(labelForOutputValue("Tumor Ratio", 0.5)).toBe("Tumor Ratio 0.5");
});

test("an unnamed output is a bare value, never an id", () => {
    // Falling back to a record id would read as `bfc1a2e4-… 0` — noise, and
    // worse than saying nothing about what the number is.
    expect(labelForOutputValue(undefined, 7)).toBe("7");
    expect(labelForOutputValue("   ", 7)).toBe("7");
});

test("no value means no label, named or not", () => {
    expect(labelForOutputValue("Tumor Ratio", undefined)).toBe("");
    expect(labelForOutputValue("Tumor Ratio", null)).toBe("");
});

// ── leaf resolution must not fall through to the collection-items query ─────

test("a one-element array `items` still names the leaf type", async () => {
    // A document that writes `items` as an array instead of an object used to
    // resolve to no leaf at all, which made the output "unknown" — and an
    // unknown collection was sent to `collections/{id}/items/query`, which a
    // backend answers with 422 for a collection whose members are collections.
    const { leafTypeOf } = await import("../../ead.ts");
    expect(leafTypeOf({
        type: "collection",
        items: [{ type: "collection", items: [{ type: "point", reference: "io.my_wsi" }] }],
    })).toEqual({ type: "point", depth: 2 });
});

test("TA03's nested point collection is never classified as a value collection", () => {
    const cells = describeOutputs(fixture("ta03"), "standalone")[0];
    expect(outputKind(cells)).toBe("annotation");
    // The dispatch guard in loadResolvedResults keys on exactly this.
    expect(outputKind(cells)).not.toBe("primitive");
});

// ── per-annotation values: summarize first, list second ─────────────────────

const conf = (annotationId, value, name = "confidence score") => ({
    type: "float", name, value,
    reference_id: annotationId, reference_type: "annotation",
});

test("values that describe annotations are grouped, not just listed", async () => {
    const { summarizeAnnotationValues } = await import("../../outputs.ts");
    const r = summarizeAnnotationValues([
        conf("a", 0.5), conf("b", 0.9), conf("c", 0.7),
        // Slide-level scalars are somebody else's section.
        { type: "integer", name: "total", value: 3, reference_type: "wsi", reference_id: "wsi-1" },
    ]);

    expect(r.total).toBe(3);
    expect(r.truncated).toBe(false);
    expect(r.rows.map(row => row.annotationId)).toEqual(["a", "b", "c"]);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({
        name: "confidence score", count: 3, min: 0.5, max: 0.9, uniform: false,
    });
    expect(r.summary[0].mean).toBeCloseTo(0.7, 10);
});

test("an all-identical group says so — that is the reading that looks like a bug", () => {
    // TA04 returns 0.9 ten times. Ten identical rows read as a broken integration
    // until something states plainly that all ten really are 0.9.
    return import("../../outputs.ts").then(({ summarizeAnnotationValues }) => {
        const r = summarizeAnnotationValues(
            Array.from({ length: 10 }, (_, i) => conf(`ann-${i}`, 0.9)));
        expect(r.summary[0]).toMatchObject({ count: 10, min: 0.9, max: 0.9, uniform: true });
    });
});

test("above the cap nothing is listed, and the summary still covers everything", async () => {
    const { summarizeAnnotationValues } = await import("../../outputs.ts");
    const many = Array.from({ length: 50 }, (_, i) => conf(`ann-${i}`, i / 100));
    const r = summarizeAnnotationValues(many, 10);

    // A truncated list answers "what is the range?" with whatever sorted first,
    // which is worse than not answering. The summary is computed over all 50.
    expect(r.truncated).toBe(true);
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(50);
    expect(r.summary[0]).toMatchObject({ count: 50, min: 0, max: 0.49 });
});

test("non-numeric groups tally instead of averaging", async () => {
    const { summarizeAnnotationValues } = await import("../../outputs.ts");
    const r = summarizeAnnotationValues([
        conf("a", "tumor", "call"), conf("b", "stroma", "call"), conf("c", "tumor", "call"),
    ]);
    expect(r.summary[0].mean).toBe(undefined);
    expect(r.summary[0].tally).toEqual([{ value: "tumor", count: 2 }, { value: "stroma", count: 1 }]);
    expect(r.summary[0].uniform).toBe(false);
});

test("a value with no annotation behind it is not a per-annotation value", async () => {
    const { summarizeAnnotationValues } = await import("../../outputs.ts");
    expect(summarizeAnnotationValues([
        { name: "x", value: 1, reference_type: "annotation" },          // no reference_id
        { name: "y", reference_id: "a", reference_type: "annotation" }, // no value
    ]).total).toBe(0);
});

// ── naming shapes that carry no class ──────────────────────────────────────

test("an app with one annotation output names it", async () => {
    // TA06 declares `my_cells` and NO class output, so its 24 690 points arrive
    // unclassified and used to be filed under the literal word "Unknown".
    const { soleAnnotationOutput } = await import("../../outputs.ts");
    expect(soleAnnotationOutput(fixture("ta06"), "standalone")).toEqual({
        key: "my_cells", label: "my_cells",
    });
    expect(soleAnnotationOutput(fixture("ta03"), "standalone")).toEqual({
        key: "my_cells", label: "my_cells",
    });
});

test("the io node's own name wins over the key", async () => {
    const { soleAnnotationOutput } = await import("../../outputs.ts");
    const ead = {
        io: {
            my_wsi: { type: "wsi" },
            my_cells: {
                type: "collection", name: "Detected cells",
                items: { type: "point", reference: "io.my_wsi" },
            },
        },
        modes: { standalone: { inputs: ["my_wsi"], outputs: ["my_cells"] } },
    };
    expect(soleAnnotationOutput(ead, "standalone").label).toBe("Detected cells");
});

test("no annotation output, or several, names nothing", async () => {
    const { soleAnnotationOutput } = await import("../../outputs.ts");
    // TA01 produces one integer — an empty annotation list is the answer, and
    // there is no output to attribute shapes to.
    expect(soleAnnotationOutput(fixture("ta01"), "standalone")).toBe(undefined);

    // With two shape outputs the pooled annotation query cannot say which is
    // which without a collection query each — the same reason `annotationCount`
    // is only claimed for a single output.
    const two = {
        io: {
            my_wsi: { type: "wsi" },
            cells: { type: "collection", items: { type: "point", reference: "io.my_wsi" } },
            nuclei: { type: "collection", items: { type: "polygon", reference: "io.my_wsi" } },
        },
        modes: { standalone: { inputs: ["my_wsi"], outputs: ["cells", "nuclei"] } },
    };
    expect(soleAnnotationOutput(two, "standalone")).toBe(undefined);
});

test("an app whose shapes carry classes still resolves its output", async () => {
    // TA05 declares both; the class wins at import time, but the identity of the
    // shape output is still answerable and must not depend on that.
    const { soleAnnotationOutput } = await import("../../outputs.ts");
    expect(soleAnnotationOutput(fixture("ta05"), "standalone")?.key).toBe("my_cells");
});
