/**
 * What an operand chip stands for once the canvas has moved on.
 *
 * Operands hold object references. An annotation deleted after it was picked
 * must fall out of the comparison — and out of hover/focus, which used to draw a
 * highlight of a ghost because `viewerOf` falls back to the active viewer for an
 * object on no canvas. `isLive` is the strict check; `operandObjects` and
 * `pruneOperand` are built on it.
 *
 * Also pins the `list` kind (a derived tissue mask lands as one): a single
 * member reads exactly like a picked annotation — numbered, so it is visibly
 * something on the slide — and several read as a counted set.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../ui/format.js");
await import("../../ui/picker.js");

const picker = () => globalThis.AnnotationMeasurements.ui.picker;

/** One fabric canvas holding `objects`, registered as the only wrapper. */
function canvasWith(objects) {
    const viewer = { id: "v1" };
    const canvas = {
        _objects: objects.slice(),
        contains(o) { return this._objects.includes(o); },
        getObjects() { return this._objects.slice(); },
    };
    const wrapper = { canvas, viewer };
    globalThis.OSDAnnotations = { FabricWrapper: { instances: () => [wrapper] } };
    const fabric = {
        canvas,
        isAnnotation: (o) => o && o.incrementId !== undefined,
    };
    const annotations = {
        viewer,
        getFabric: () => fabric,
        presets: { get: (id) => ({ presetID: id, color: "#123456", getMetaValue: (k) => (k === "category" ? `Class ${id}` : undefined) }) },
    };
    return { annotations, viewer, canvas };
}

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const ann = (incrementId, presetID = "p") => ({ incrementId, presetID, sessionID: "s" });

test("a deleted annotation is no longer live and its operand resolves to nothing @unit", () => {
    const a = ann(1), b = ann(2);
    const { annotations, viewer, canvas } = canvasWith([a, b]);

    expect(picker().isLive(annotations, a)).toBe(true);
    expect(picker().operandObjects(annotations, viewer, { kind: "annotation", object: a })).toEqual([a]);

    canvas._objects = [b];                        // `a` deleted
    expect(picker().isLive(annotations, a)).toBe(false);
    expect(picker().operandObjects(annotations, viewer, { kind: "annotation", object: a })).toEqual([]);
});

test("pruneOperand clears a dead annotation and thins a list, by identity @unit", () => {
    const a = ann(1), b = ann(2), c = ann(3);
    const { annotations, canvas } = canvasWith([a, b, c]);
    const single = { kind: "annotation", object: a };
    const list = { kind: "list", objects: [a, b, c] };

    // Untouched operands come back as the same object, so callers can compare.
    expect(picker().pruneOperand(annotations, single)).toBe(single);
    expect(picker().pruneOperand(annotations, list)).toBe(list);

    canvas._objects = [b];
    expect(picker().pruneOperand(annotations, single)).toBe(null);
    const thinned = picker().pruneOperand(annotations, list);
    expect(thinned).not.toBe(list);
    expect(thinned.objects).toEqual([b]);

    canvas._objects = [];
    expect(picker().pruneOperand(annotations, list)).toBe(null);
    // Set-valued kinds have no members to lose.
    const cls = { kind: "class", presetID: "p" };
    expect(picker().pruneOperand(annotations, cls)).toBe(cls);
});

test("a list of one reads like a picked annotation; several read as a counted set @unit", () => {
    const a = ann(7, "tissue"), b = ann(8, "tissue");
    const { annotations } = canvasWith([a, b]);

    const one = picker().describeOperand(annotations, { kind: "list", objects: [a] }, t);
    expect(one.label).toBe("Class tissue #7");
    expect(one.empty).toBe(false);

    const many = picker().describeOperand(annotations, { kind: "list", objects: [a, b] }, t);
    expect(many.label).toBe(`listSet:${JSON.stringify({ name: "Class tissue", count: 2 })}`);
    expect(many.color).toBe("#123456");

    const named = picker().describeOperand(annotations, { kind: "list", objects: [a, b], label: "Tissue" }, t);
    expect(named.label).toContain('"name":"Tissue"');
});

test("hover and focus are no-ops for an object on no canvas @unit", () => {
    const a = ann(1);
    const { annotations, canvas } = canvasWith([a]);
    let highlighted = 0;
    annotations.getFabric = () => ({
        canvas,
        highlightAnnotation: () => { highlighted++; },
        removeHighlight: () => {},
        getSelectedAnnotations: () => [],
        focusObjectOrArea: () => { highlighted++; },
    });

    picker().hoverHighlight(annotations, a, true);
    expect(highlighted).toBe(1);

    canvas._objects = [];                         // deleted
    picker().hoverHighlight(annotations, a, true);
    picker().focusAnnotation(annotations, a);
    expect(highlighted).toBe(1);
});
