/**
 * A drawn shape must end up either committed (interactive, exported, sent to the
 * sink) or removed — never left as a helper on the canvas.
 *
 * A helper is frozen: non-selectable, `excludeFromExport`, never dispatched. One
 * left behind looks like a saved annotation, cannot be touched, and is gone on
 * reload with no error. Three routes produced exactly that with quick-draw:
 *
 *   - a refused promotion (pre-create guard / validate) kept the helper,
 *   - Rect/Ellipse inherited a no-op `finishIndirect`, so a tool switch mid-drag
 *     orphaned the in-progress shape,
 *   - `initCreate` overwrote a still-set `_current` without cleaning it up.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let A;

globalThis.window = globalThis.window ?? globalThis;

test.beforeAll(async () => {
    installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatViewerSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
            fabric: { Rect: class {}, Ellipse: class {}, Polygon: class {}, Polyline: class {}, Line: class {} },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objectGenericFactories.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "annotations-canvas.js"), "OSDAnnotations");
});

/** Silence the deliberate console.error of the refusal path. */
function quietly(fn) {
    const orig = console.error;
    console.error = () => {};
    try { return fn(); } finally { console.error = orig; }
}

/** Fabric stub that records what happened to each helper. */
function fakeFabric(onPromote = () => {}) {
    return {
        helpers: new Set(),
        promoted: [],
        addHelperAnnotation(o) { this.helpers.add(o); },
        deleteHelperAnnotation(o) { this.helpers.delete(o); },
        promoteHelperAnnotation(o) {
            this.helpers.delete(o);
            this.promoted.push(o);
            onPromote(o);
            return true;
        },
    };
}

const shape = (props) => ({ ...props, set(p) { Object.assign(this, p); } });

function makeFactory(kind, fabric) {
    const presets = { getAnnotationOptions: () => ({}), get: () => undefined };
    const f = kind === "rect"
        ? new A.Rect({ fabric }, presets)
        : new A.Ellipse({ fabric }, presets);
    f.create = (params) => shape(params);
    // Ellipse measures the drag in screen space; identity is enough here.
    f._imageToWindowPoint = (x, y) => ({ x, y });
    f._windowDeltaToImageLength = (dx, dy) => Math.abs(dx || dy);
    f._getViewportRotation = () => 0;
    return f;
}

for (const kind of ["rect", "ellipse"]) {
    test(`${kind}: a mode switch mid-drag commits the shape instead of orphaning it`, { tag: ["@unit"] }, () => {
        const fabric = fakeFabric();
        const f = makeFactory(kind, fabric);
        f.initCreate(10, 10, true);
        f.updateCreate(50, 60);
        const drawn = f.getCurrentObject();

        f.finishIndirect();

        expect(fabric.promoted).toEqual([drawn]);
        expect(fabric.helpers.size).toBe(0);
        expect(f.getCurrentObject()).toBeFalsy();
    });

    test(`${kind}: a second press without a release does not orphan the first helper`, { tag: ["@unit"] }, () => {
        const fabric = fakeFabric();
        const f = makeFactory(kind, fabric);
        f.initCreate(10, 10, true);
        f.initCreate(30, 30, true);

        expect(fabric.helpers.size).toBe(1);
        expect([...fabric.helpers][0]).toBe(f.getCurrentObject());
    });

    test(`${kind}: re-entering finishIndirect from annotation-create promotes once`, { tag: ["@unit"] }, () => {
        // A handler that switches mode synchronously on `annotation-create`
        // re-enters finishIndirect() while finishDirect() is still on the stack.
        let f;
        const fabric = fakeFabric(() => f.finishIndirect());
        f = makeFactory(kind, fabric);
        f.initCreate(10, 10, true);
        f.updateCreate(50, 60);

        f.finishDirect();

        expect(fabric.promoted).toHaveLength(1);
    });
}

/** Just the slice of FabricWrapper that promoteHelperAnnotation touches. */
function fakeWrapper(createResult) {
    const canvasObjects = new Set();
    const self = {
        canvasObjects,
        settled: 0,
        canvas: { remove: (o) => canvasObjects.delete(o), requestRenderAll: () => {} },
        module: { annotationResource: { create: () => createResult } },
        viewer: { uniqueId: "v1" },
        deleteHelperAnnotation(o) { canvasObjects.delete(o); return true; },
        _deleteAnnotation(o) { canvasObjects.delete(o); return true; },
        _settleAnnotationSync() { self.settled++; },
        _discardFailedPromotion: A.FabricWrapper.prototype._discardFailedPromotion,
    };
    return self;
}

const promote = (w, o) => A.FabricWrapper.prototype.promoteHelperAnnotation.call(w, o);

test("a refused promotion removes the helper from the canvas", { tag: ["@unit"] }, () => {
    const helper = { isHelperAnnotation: true };
    const w = fakeWrapper({ ok: false, refused: true, reason: "no", settled: Promise.resolve() });
    w.canvasObjects.add(helper);

    expect(quietly(() => promote(w, helper))).toBe(false);
    expect(w.canvasObjects.has(helper)).toBe(false);
    expect(w.settled).toBe(0);
});

test("a half-applied promotion (apply threw) is removed too", { tag: ["@unit"] }, () => {
    // `_promoteHelperAnnotation` drops the helper flag first and may throw later.
    const obj = { isHelperAnnotation: false };
    const w = fakeWrapper({ ok: false, refused: true, code: "W_IO_APPLY_THREW", settled: Promise.resolve() });
    w.canvasObjects.add(obj);

    quietly(() => promote(w, obj));
    expect(w.canvasObjects.has(obj)).toBe(false);
});

test("an accepted promotion keeps the object and settles the sync", { tag: ["@unit"] }, () => {
    const helper = { isHelperAnnotation: true };
    const w = fakeWrapper({ ok: true, settled: Promise.resolve({ ok: true }) });
    w.canvasObjects.add(helper);

    expect(promote(w, helper)).toBe(true);
    expect(w.canvasObjects.has(helper)).toBe(true);
    expect(w.settled).toBe(1);
});
