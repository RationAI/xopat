/**
 * Bulk selection and layer management on the canvas wrapper.
 *
 * - "Select all" must cost one selection update and ONE event: the board panel
 *   rebuilds on every `annotation-selection-changed`, so an event per object is
 *   what used to freeze the viewer.
 * - The active layer is only where new annotations go. It must not decide what
 *   can be selected — it used to flip `selectable` on every member.
 * - A batch layer move is one undoable step that restores the original order.
 * - A promoted annotation must not cache its render: the cache is size-capped,
 *   and a large or rotated shape comes back stretched and blocky.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let A;
let history;

globalThis.window = globalThis.window ?? globalThis;

test.beforeAll(async () => {
    installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatViewerSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            XOpatUser: { instance: () => ({ id: "user-1" }) },
            addModule: () => {},
            requireViewerSingletonPresence: () => {},
            fabric: { Rect: class {}, Ellipse: class {}, Polygon: class {}, Polyline: class {}, Line: class {} },
            // Runs the forward step at once and keeps the inverse for the test.
            APPLICATION_CONTEXT: {
                history: {
                    push(forward, backward) {
                        history.push({ forward, backward });
                        return forward();
                    },
                },
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "presets.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "annotations-canvas.js"), "OSDAnnotations");
});

test.beforeEach(() => { history = []; });

let nextId = 1;
/** A committed annotation, as `FabricWrapper.isAnnotation` recognises one. */
function annotation(props = {}) {
    const id = nextId++;
    return { incrementId: id, internalID: `a${id}`, sessionID: "s", visible: true, ...props };
}

/** A FabricWrapper with real methods and just enough state to run them. */
function wrapper(objects = []) {
    const w = Object.create(A.FabricWrapper.prototype);
    let active = null;
    Object.assign(w, {
        events: [],
        objects,
        __selectionSnapshot: [],
        _layers: {},
        _layer: undefined,
        _selectedLayers: new Set(),
        _boardOrder: [],
        _byIncrementId: new Map(),
        viewer: { uniqueId: "v1" },
        // `canvas` is a getter over the overlay's fabric canvas.
        overlay: { fabric: {
            getObjects: () => w.objects,
            getActiveObject: () => active,
            setActiveObject: (o) => { active = o; },
            discardActiveObject: () => { active = null; },
            requestRenderAll: () => {},
            add: (o) => { if (!w.objects.includes(o)) w.objects.push(o); },
            remove: (o) => { w.objects = w.objects.filter(x => x !== o); },
        } },
        raiseEvent: (name, payload) => w.events.push({ name, payload }),
        removeHighlight: () => {},
        highlightAnnotation: () => {},
        _applyAnnotationVisibilityState: () => {},
    });
    w.module = {
        fabric: w,
        session: "s",
        isAnnotationFilteredOut: (o) => !!o.filtered,
        _generateInternalId: () => `gen${nextId++}`,
        assignAnnotationIds: () => {},
        getAnnotationObjectFactory: () => undefined,
    };
    for (const o of objects) w._boardOrder.push({ type: "annotation", id: String(o.incrementId) });
    return w;
}

const named = (w, name) => w.events.filter(e => e.name === name);

test("selecting many annotations raises one selection event", { tag: ["@unit"] }, () => {
    const objects = Array.from({ length: 500 }, () => annotation());
    const w = wrapper(objects);

    expect(w.selectAnnotations(objects)).toBe(500);

    expect(named(w, "annotation-selection-changed")).toHaveLength(1);
    expect(w.getSelectedAnnotations()).toHaveLength(500);
    expect(w.canvas.getActiveObject(), "last one is fabric's active object").toBe(objects[499]);
});

test("selectAnnotations replaces or extends, and reports what it dropped", { tag: ["@unit"] }, () => {
    const [a, b, c] = [annotation(), annotation(), annotation()];
    const w = wrapper([a, b, c]);
    w.selectAnnotations([a, b]);

    w.selectAnnotations([c], { clearPrevious: false });
    expect(w.getSelectedAnnotations()).toEqual([a, b, c]);

    w.events.length = 0;
    w.selectAnnotations([b]);
    expect(w.getSelectedAnnotations()).toEqual([b]);
    expect(named(w, "annotation-selection-changed")[0].payload.deselected).toEqual([a, c]);

    // Re-selecting the same set is not a change.
    w.events.length = 0;
    w.selectAnnotations([b]);
    expect(w.events).toEqual([]);
});

test("select all skips what the user cannot see or touch", { tag: ["@unit"] }, () => {
    const plain = annotation();
    const hidden = annotation({ visible: false });
    const filtered = annotation({ filtered: true });
    const inHiddenLayer = annotation({ layerID: "L1" });
    const inLayer = annotation({ layerID: "L2" });
    const helper = { isHelperAnnotation: true, visible: true };
    const w = wrapper([plain, hidden, filtered, inHiddenLayer, inLayer, helper]);
    w._layers = { L1: { id: "L1", visible: false }, L2: { id: "L2", visible: true } };

    w.selectAllAnnotations();
    expect(w.getSelectedAnnotations()).toEqual([plain, inLayer]);

    w.selectAllAnnotations({ layerId: "L2" });
    expect(w.getSelectedAnnotations()).toEqual([inLayer]);

    w.selectAllAnnotations({ layerId: null });
    expect(w.getSelectedAnnotations(), "null = annotations in no layer").toEqual([plain]);
});

test("the active layer is a drawing target, not a selection gate", { tag: ["@unit"] }, () => {
    const inA = annotation({ layerID: "A", selectable: true });
    const inB = annotation({ layerID: "B", selectable: true });
    const w = wrapper([inA, inB]);
    w._createLayer({ id: "A", _objects: [] });
    w._createLayer({ id: "B", _objects: [] });

    w.setActiveLayer("A");
    w.setActiveLayer("B");
    w.unsetActiveLayer();

    expect(inA.selectable).toBe(true);
    expect(inB.selectable).toBe(true);
    expect(named(w, "active-layer-changed").map(e => e.payload.layer?.id)).toEqual(["A", "B", undefined]);
});

test("a new layer becomes the drawing target; undo hands it back", { tag: ["@unit"] }, () => {
    const w = wrapper();
    w._createLayer({ id: "old", _objects: [] });
    w.setActiveLayer("old");

    w.createLayer("fresh");
    expect(w.getActiveLayer().id).toBe("fresh");

    // A new annotation with no layer of its own lands in the active one.
    const drawn = annotation();
    w._addAnnotationToLayer(drawn);
    expect(drawn.layerID).toBe("fresh");
    w.getLayer("fresh").removeObjects([drawn]);

    history.at(-1).backward();
    expect(w.getLayer("fresh")).toBeUndefined();
    expect(w.getActiveLayer().id).toBe("old");
});

test("deleting the active layer releases it", { tag: ["@unit"] }, () => {
    const w = wrapper();
    w._createLayer({ id: "L", _objects: [] });
    w.setActiveLayer("L");

    w._deleteLayer("L");

    expect(w.getActiveLayer()).toBeUndefined();
});

test("renaming a layer is undoable and refuses a blank name", { tag: ["@unit"] }, () => {
    const w = wrapper();
    w._createLayer({ id: "L", name: "Tumor", _objects: [] });

    expect(w.renameLayer("L", "   ")).toBe(false);
    expect(w.renameLayer("L", " Stroma ")).toBe(true);
    expect(w.getLayer("L").name).toBe("Stroma");

    history.at(-1).backward();
    expect(w.getLayer("L").name).toBe("Tumor");
});

test("a batch layer move is one step that undo restores in order", { tag: ["@unit"] }, () => {
    const roots = [annotation(), annotation(), annotation(), annotation()];
    const w = wrapper(roots);
    w._createLayer({ id: "src", _objects: [] });
    w._createLayer({ id: "dst", _objects: [] });
    const layered = [annotation(), annotation(), annotation()];
    w.objects.push(...layered);
    w.getLayer("src").addObjects(layered);
    const boardBefore = w.getBoardOrder();
    const srcBefore = w.getLayer("src").getObjects();
    w.events.length = 0;
    history.length = 0;

    // Mixed origin, given out of order, with a duplicate and one already there.
    const moved = w.setAnnotationsLayer([roots[2], layered[1], roots[0], roots[2]], "dst");

    expect(moved).toBe(3);
    expect(history).toHaveLength(1);
    expect(named(w, "layer-objects-changed")).toHaveLength(1);
    expect(w.getLayer("dst").getObjects()).toEqual([roots[2], layered[1], roots[0]]);
    expect(w.getLayer("src").getObjects()).toEqual([layered[0], layered[2]]);
    expect(roots[0].layerID).toBe("dst");

    history[0].backward();

    expect(w.getLayer("dst").getObjects()).toEqual([]);
    expect(w.getLayer("src").getObjects()).toEqual(srcBefore);
    expect(w.getBoardOrder()).toEqual(boardBefore);
    expect(roots[0].layerID).toBeUndefined();
    expect(layered[1].layerID).toBe("src");
});

test("moving annotations out of a layer puts them back on the board", { tag: ["@unit"] }, () => {
    const w = wrapper();
    w._createLayer({ id: "L", _objects: [] });
    const members = [annotation(), annotation()];
    w.objects.push(...members);
    w.getLayer("L").addObjects(members);

    expect(w.setAnnotationsLayer(members, null)).toBe(2);

    expect(w.getLayer("L").getObjects()).toEqual([]);
    expect(members.every(o => o.layerID === undefined)).toBe(true);
    expect(w.getBoardOrder().filter(e => e.type === "annotation").map(e => e.id))
        .toEqual(members.map(o => String(o.incrementId)));
});

test("a promoted annotation does not cache its render", { tag: ["@unit"] }, () => {
    const w = wrapper();
    w.updateSingleAnnotationVisuals = () => {};
    // What a helper looks like while it is being drawn.
    const child = { objectCaching: false };
    const helper = { isHelperAnnotation: true, excludeFromExport: true, objectCaching: false, _objects: [child], visible: true };

    w._promoteHelperAnnotation(helper);

    // No own value: the object follows the prototype default (off) again.
    expect(Object.hasOwn(helper, "objectCaching")).toBe(false);
    expect(Object.hasOwn(child, "objectCaching")).toBe(false);
    expect(helper.isHelperAnnotation).toBeUndefined();
});
