/**
 * Hand-drawn shapes below a minimum on-screen extent are discarded.
 *
 * Rect/Ellipse used to discard only an exact zero extent, so a press-hold-release
 * without motion committed the 1x1 image-px seed and a flat ellipse drag committed
 * `ry ≈ 0` — both practically invisible annotations. The minimum is measured in
 * screen pixels, so the same 1x1 seed is a legitimate shape when zoomed far in.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let A;

globalThis.window = globalThis.window ?? globalThis;

let shims;
test.afterAll(() => shims?.restore());

test.beforeAll(async () => {
    shims = installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
            OpenSeadragon: { extend: Object.assign },
            fabric: {
                Rect: class {}, Ellipse: class {}, Polygon: class {},
                Polyline: class {},
                Line: class { constructor(points) { [this.x1, this.y1, this.x2, this.y2] = points; } },
                util: {},
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objectGenericFactories.js"), "OSDAnnotations");
});

/** @param {number} scale screen pixels per image pixel */
const fakeContext = (scale) => {
    const log = { promoted: [], added: [], deleted: [] };
    return {
        log,
        viewer: { scalebar: { imagePixelSizeOnScreen: () => scale } },
        fabric: {
            promoteHelperAnnotation: (o) => log.promoted.push(o),
            addAnnotation: (o) => log.added.push(o),
            deleteHelperAnnotation: (o) => log.deleted.push(o),
        },
    };
};
const presets = { get: () => undefined, getAnnotationOptions: () => ({ color: "#f00" }) };

const finishWith = (Factory, scale, current, explicitSize = false) => {
    const context = fakeContext(scale);
    const factory = new Factory(context, presets);
    factory._current = current;
    factory._explicitSize = explicitSize;
    factory.finishDirect();
    return context.log;
};

test("rect seed left by a press without a drag is discarded @unit", () => {
    const log = finishWith(A.Rect, 1, { width: 1, height: 1 });
    expect(log.promoted).toHaveLength(0);
    expect(log.deleted).toHaveLength(1);
});

test("a flat rect sliver is discarded @unit", () => {
    const log = finishWith(A.Rect, 1, { width: 200, height: 0.5 });
    expect(log.promoted).toHaveLength(0);
});

test("the same 1x1 rect is kept when zoomed far in @unit", () => {
    const log = finishWith(A.Rect, 10, { width: 1, height: 1 });
    expect(log.promoted).toHaveLength(1);
});

test("a fixed-area rect is kept however small it is on screen @unit", () => {
    const log = finishWith(A.Rect, 0.01, { width: 5, height: 5 }, true);
    expect(log.promoted).toHaveLength(1);
});

test("an ellipse dragged flat (ry ≈ 0) is discarded @unit", () => {
    const log = finishWith(A.Ellipse, 1, { rx: 80, ry: 1e-3 });
    expect(log.promoted).toHaveLength(0);
    expect(log.deleted).toHaveLength(1);
});

test("a normally dragged ellipse is kept @unit", () => {
    const log = finishWith(A.Ellipse, 1, { rx: 40, ry: 20 });
    expect(log.promoted).toHaveLength(1);
});

test("a line shorter than 10 screen px is discarded, a longer one kept @unit", () => {
    const short = finishWith(A.Line, 1, { x1: 0, y1: 0, x2: 3, y2: 4 });
    expect(short.added).toHaveLength(0);
    const long = finishWith(A.Line, 1, { x1: 0, y1: 0, x2: 12, y2: 16 });
    expect(long.added).toHaveLength(1);
});

/* isDegenerate: constant-cost zero-size check used by the scripting API. */
const factoryOf = (Factory) => new Factory(fakeContext(1), presets);

test("isDegenerate: rect and ellipse need a positive extent @unit", () => {
    expect(factoryOf(A.Rect).isDegenerate({ width: 0, height: 5 })).toBe(true);
    expect(factoryOf(A.Rect).isDegenerate({ width: 1, height: 1 })).toBe(false);
    expect(factoryOf(A.Ellipse).isDegenerate({ rx: 5, ry: 0 })).toBe(true);
    expect(factoryOf(A.Ellipse).isDegenerate({ rx: 5 }), "missing ry is NaN").toBe(true);
    expect(factoryOf(A.Ellipse).isDegenerate({ rx: 5, ry: 2 })).toBe(false);
});

test("isDegenerate: a line needs distinct endpoints @unit", () => {
    expect(factoryOf(A.Line).isDegenerate({ x1: 3, y1: 3, x2: 3, y2: 3 })).toBe(true);
    expect(factoryOf(A.Line).isDegenerate({ x1: 3, y1: 3, x2: 4, y2: 3 })).toBe(false);
});

test("isDegenerate: polygon needs 3 points, polyline 2 @unit", () => {
    const pt = (x, y) => ({ x, y });
    expect(factoryOf(A.Polygon).isDegenerate({ points: [pt(0, 0), pt(1, 1)] })).toBe(true);
    expect(factoryOf(A.Polygon).isDegenerate({ points: [pt(0, 0), pt(1, 1), pt(0, 1)] })).toBe(false);
    expect(factoryOf(A.Polyline).isDegenerate({ points: [pt(0, 0)] })).toBe(true);
    expect(factoryOf(A.Polyline).isDegenerate({ points: [pt(0, 0), pt(1, 1)] })).toBe(false);
});

test("isDegenerate: a point is never degenerate @unit", () => {
    expect(factoryOf(A.Point).isDegenerate({ rx: 0, ry: 0 })).toBe(false);
});
