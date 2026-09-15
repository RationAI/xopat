/**
 * The annotation label as a *value slot*.
 *
 * The label pill used to be a measurement readout with the set of measurements
 * hardcoded — area, else length, else nothing — and no way for anything to put
 * something else there. An integration that needed to (EMPAIA, showing a
 * prediction on the ROI it was run over) had to forge a seam, and wrote its value
 * into the annotation's *name* instead. That is where the reported
 * `"Tumor ratio 0 6"` came from: name plus value, then the board appending the
 * annotation's own numeric label.
 *
 * So the slot has a resolution order now, and these pin it:
 *
 *   object.displayValue            instance override, whoever attached it owns it
 *   preset.meta.labelSource        class-level: names which meta key to render
 *   area, else length              unchanged, what everything else still gets
 *
 * Driven against the real `AnnotationObjectFactory` with hand-rolled objects and
 * a fake preset manager — no canvas, no fabric, no browser.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;

/** A preset manager holding at most one preset, shaped like the real one. */
function presets(labelSource) {
    const preset = labelSource === undefined ? undefined : {
        meta: { labelSource: { name: "Label source", value: labelSource } },
        getMetaValue(key) { return this.meta[key] ? this.meta[key].value : undefined; },
    };
    return { get: (id) => (id === "p1" ? preset : undefined) };
}

/**
 * A factory with the geometry the case needs.
 * `undefined` area/length is the unmeasurable shape (point, text, group).
 */
function factory({ area, length, supports = true, labelSource } = {}) {
    const F = class extends A.AnnotationObjectFactory {
        getArea() { return area; }
        getLength() { return length; }
        supportsMeasurements() { return supports; }
    };
    return new F({}, presets(labelSource), "test-factory", "rect");
}

/** An annotation. No canvas, so no scalebar — geometry formats as raw px. */
const object = (over = {}) => ({ presetID: "p1", ...over });

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
});

test.afterAll(() => shim?.restore());

// ── the default: nothing attached, nothing changes ──────────────────────────

test("geometry still answers when nothing is attached", { tag: ["@unit"] }, () => {
    expect(factory({ area: 400 }).getLabelValue(object()))
        .toEqual({ text: "400 px²", source: "area" });
});

test("length is the fallback for a shape with no area", { tag: ["@unit"] }, () => {
    expect(factory({ length: 30 }).getLabelValue(object()))
        .toEqual({ text: "30 px", source: "length" });
});

test("an unmeasurable shape with nothing attached says nothing", { tag: ["@unit"] }, () => {
    expect(factory({}).getLabelValue(object())).toEqual({ text: "", source: "" });
});

// ── instance override ───────────────────────────────────────────────────────

test("an attached value beats the geometry", { tag: ["@unit"] }, () => {
    expect(factory({ area: 400 }).getLabelValue(object({ displayValue: "0.5" })))
        .toEqual({ text: "0.5", source: "value" });
});

test("an attached value survives supportsMeasurements() being false", { tag: ["@unit"] }, () => {
    // The opt-out means "this shape's extent carries no meaning" — an Arrow. It
    // is a statement about geometry and must not suppress a value someone
    // deliberately put on the same shape.
    const f = factory({ area: 400, supports: false });
    expect(f.getLabelValue(object()).text).toBe("");
    expect(f.getLabelValue(object({ displayValue: "tumor" })))
        .toEqual({ text: "tumor", source: "value" });
});

test("a non-string attached value is rendered, not dropped", { tag: ["@unit"] }, () => {
    expect(factory({ area: 400 }).getLabelValue(object({ displayValue: 0.5 })).text).toBe("0.5");
});

test("an empty attached value falls through instead of blanking the label", { tag: ["@unit"] }, () => {
    for (const empty of ["", null, undefined]) {
        expect(factory({ area: 400 }).getLabelValue(object({ displayValue: empty })))
            .toEqual({ text: "400 px²", source: "area" });
    }
});

// ── preset rule ─────────────────────────────────────────────────────────────

test("a preset can name which meta key fills the label", { tag: ["@unit"] }, () => {
    const f = factory({ area: 400, labelSource: "Tumor ratio" });
    expect(f.getLabelValue(object({ meta: { "Tumor ratio": 0.5 } })))
        .toEqual({ text: "0.5", source: "value" });
});

test("zero is a value, not an absence", { tag: ["@unit"] }, () => {
    // The whole reason the reported case read `Tumor ratio 0`: a ratio of 0 is a
    // real prediction. A truthiness test would have hidden it.
    const f = factory({ area: 400, labelSource: "Tumor ratio" });
    expect(f.getLabelValue(object({ meta: { "Tumor ratio": 0 } })).text).toBe("0");
});

test("a preset naming a key the annotation lacks falls back to geometry", { tag: ["@unit"] }, () => {
    const f = factory({ area: 400, labelSource: "Tumor ratio" });
    expect(f.getLabelValue(object({ meta: {} })))
        .toEqual({ text: "400 px²", source: "area" });
    expect(f.getLabelValue(object())).toEqual({ text: "400 px²", source: "area" });
});

test("the instance override outranks the preset rule", { tag: ["@unit"] }, () => {
    const f = factory({ area: 400, labelSource: "Tumor ratio" });
    expect(f.getLabelValue(object({ displayValue: "0.9", meta: { "Tumor ratio": 0.5 } })).text)
        .toBe("0.9");
});

test("no preset at all is not an error", { tag: ["@unit"] }, () => {
    expect(factory({ area: 400 }).getLabelValue({ presetID: "missing" }))
        .toEqual({ text: "400 px²", source: "area" });
});

// ── the name every render path still calls ──────────────────────────────────

test("getMeasurementLabel is the text of the same answer", { tag: ["@unit"] }, () => {
    const f = factory({ area: 400 });
    expect(f.getMeasurementLabel(object())).toBe("400 px²");
    expect(f.getMeasurementLabel(object({ displayValue: "0.5" }))).toBe("0.5");
    expect(factory({}).getMeasurementLabel(object())).toBe("");
});

test("attaching a value is idempotent", { tag: ["@unit"] }, () => {
    // The bug this replaces composed its own previous output back into itself, so
    // hiding and re-showing an analysis grew "Tumor ratio 0 · Tumor ratio 0".
    const f = factory({ area: 400 });
    const o = object();
    o.displayValue = "0.5";
    const first = f.getLabelValue(o).text;
    o.displayValue = "0.5";
    expect(f.getLabelValue(o).text).toBe(first);
});
