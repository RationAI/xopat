/**
 * The point marker is capped on screen.
 *
 * It used to be sized `7 / graphicZoom` in image space with
 * `graphicZoom = sqrt(realZoom) / 2`, i.e. `14 * sqrt(realZoom)` screen pixels:
 * 28 px wide at 1:1 and growing without bound, so the marker covered the 5-10 px
 * structure it was placed on. Zoomed out the softened size is kept; zoomed in the
 * radius stays at `Point.MAX_SCREEN_RADIUS` screen pixels.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let A;

globalThis.window = globalThis.window ?? globalThis;

test.beforeAll(async () => {
    installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
            OpenSeadragon: { extend: Object.assign },
            fabric: {
                Rect: class {}, Ellipse: class {}, Polygon: class {},
                Polyline: class {}, Line: class {},
                util: {},
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objectGenericFactories.js"), "OSDAnnotations");
});

const pointFactory = () => new A.Point({}, { get: () => undefined });

/** Run the zoom pass exactly as the overlay does: `zooming(sqrt(zoom) / 2, zoom)`. */
const zoomed = (realZoom) => {
    const object = { originalStrokeWidth: 2 };
    pointFactory().onZoom(object, Math.sqrt(realZoom) / 2, realZoom);
    return object;
};

test("a zoomed-out point keeps its softened size @unit", () => {
    for (const realZoom of [0.001, 0.01, 0.1]) {
        const object = zoomed(realZoom);
        expect(object.rx).toBeCloseTo(14 / Math.sqrt(realZoom), 9);
        expect(object.ry).toBe(object.rx);
    }
});

test("a zoomed-in point stays at the screen cap @unit", () => {
    for (const realZoom of [1, 4, 16, 64]) {
        const object = zoomed(realZoom);
        expect(object.rx * realZoom).toBeCloseTo(A.Point.MAX_SCREEN_RADIUS, 9);
        expect(object.ry).toBe(object.rx);
        // The stroke is a constant 2 screen pixels alongside it.
        expect(object.strokeWidth * realZoom).toBeCloseTo(2, 9);
    }
});

test("the screen radius never exceeds the cap and never jumps @unit", () => {
    let previous = zoomed(0.01).rx * 0.01;
    for (let realZoom = 0.01; realZoom < 8; realZoom *= 1.05) {
        const screenRadius = zoomed(realZoom).rx * realZoom;
        expect(screenRadius).toBeLessThanOrEqual(A.Point.MAX_SCREEN_RADIUS + 1e-9);
        expect(screenRadius).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(screenRadius - previous).toBeLessThan(0.5);
        previous = screenRadius;
    }
});

test("a new point is sized like a zoomed one @unit", () => {
    for (const realZoom of [0.01, 1, 16]) {
        const graphicZoom = Math.sqrt(realZoom) / 2;
        const factory = pointFactory();
        factory.canvasOf = () => ({ computeGraphicZoom: () => graphicZoom });
        factory.hitTolerancePx = () => 0;
        const created = factory.configure({}, { color: "#f00" });
        const reference = zoomed(realZoom);
        expect(created.rx).toBeCloseTo(reference.rx, 9);
        expect(created.strokeWidth).toBeCloseTo(reference.strokeWidth, 9);
    }
});

test("a border-width change gives a point the width the next zoom would @unit", () => {
    // The visuals pass (creation, the border slider) and the zoom pass used two
    // formulas, so a point's border changed thickness on the first zoom after.
    for (const realZoom of [0.01, 1, 16]) {
        const graphicZoom = Math.sqrt(realZoom) / 2;
        const factory = pointFactory();
        const canvas = { computeGraphicZoom: () => graphicZoom, getZoom: () => realZoom };
        const object = {
            color: "#f00", originalStrokeWidth: 2,
            set(props) { Object.assign(this, props); },
            getCenterPoint: () => ({ x: 0, y: 0 }),
            setPositionByOrigin() {}, setCoords() {},
        };

        factory.updateRendering(object, { color: "#f00" }, { originalStrokeWidth: 5 }, { stroke: "black" }, canvas);
        const afterVisuals = object.strokeWidth;
        factory.onZoom(object, graphicZoom, realZoom);

        expect(object.originalStrokeWidth).toBe(5);
        expect(afterVisuals).toBeCloseTo(object.strokeWidth, 12);
        expect(object.strokeWidth * realZoom, "5 screen pixels at any zoom").toBeCloseTo(5, 9);
    }
});
