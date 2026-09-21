/**
 * Every shape's area and length, under the object's fabric transform.
 *
 * `Rect.getArea` was `width * height`, `Ellipse.getArea` was `π·rx·ry`, and
 * `Line.getLength` was `hypot(x1,y1,x2,y2)` — none of them looked at `scaleX`,
 * `scaleY` or `angle`. A rect being resized by a corner handle carries the change
 * in `scaleX`/`scaleY` until `recalculate()` folds it back, and an imported
 * annotation can carry one permanently, so the label, the board total and the
 * measurements panel all read the pre-resize number.
 *
 * The matrix is supplied explicitly here rather than through fabric, so each case
 * states the transform it is asserting about. Two properties matter and are easy
 * to get wrong:
 *
 *   - **Area scales by the determinant**, so rotation must not change it. A "fix"
 *     that multiplied by `scaleX * scaleY * cos(angle)` would pass a uniform-scale
 *     test and fail here.
 *   - **Length does NOT scale by a single factor.** Under an anisotropic transform
 *     a diagonal grows by neither `scaleX` nor `scaleY`, which is why the point
 *     positions have to be transformed before the distance is taken.
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
            fabric: {
                Rect: class {}, Ellipse: class {}, Polygon: class {},
                Polyline: class {}, Line: class {},
                // The real `fabric.util.transformPoint`, which is all the geometry
                // helpers use. Reimplemented rather than stubbed so the tests
                // exercise real matrix arithmetic.
                util: {
                    transformPoint: (p, m) => ({
                        x: m[0] * p.x + m[2] * p.y + m[4],
                        y: m[1] * p.x + m[3] * p.y + m[5],
                    }),
                },
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objectGenericFactories.js"), "OSDAnnotations");
});

// ─── matrices, as fabric orders them: [a, b, c, d, e, f] ─────────────────────

const IDENTITY = [1, 0, 0, 1, 0, 0];
const scale = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
const rotate = (deg) => {
    const r = (deg * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};

/** Attach a transform to a plain annotation literal. */
const withMatrix = (object, matrix, pathOffset = { x: 0, y: 0 }) => ({
    ...object,
    pathOffset,
    calcTransformMatrix: () => matrix,
});

const factory = (Cls, ...args) => new Cls({}, { get: () => undefined }, ...args);
const rectFactory = () => factory(A.Rect, "rect", "rect");
const ellipseFactory = () => factory(A.Ellipse, "ellipse", "ellipse");
const polygonFactory = () => new A.Polygon({}, { get: () => undefined });
const polylineFactory = () => new A.Polyline({}, { get: () => undefined });
const lineFactory = () => new A.Line({}, { get: () => undefined });

// A 100×200 rect, a 50/20 ellipse, a 30/40 right triangle, a 3-4-5 line.
const RECT = { width: 100, height: 200, left: 0, top: 0 };
const ELLIPSE = { rx: 50, ry: 20, left: 0, top: 0 };
const TRIANGLE = { points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 40 }] };
const LINE = { x1: 0, y1: 0, x2: 3, y2: 4 };

const RECT_AREA = 100 * 200;
const ELLIPSE_AREA = Math.PI * 50 * 20;
const TRIANGLE_AREA = 600;

// ─── an object with no matrix must behave exactly as before ──────────────────

test("a literal without calcTransformMatrix keeps the untransformed answer @unit", () => {
    // `Multipolygon.getArea` hands the polygon factory bare `{points: ring}`
    // literals, and callers throughout the tree pass plain objects. "No matrix"
    // has to mean identity, not a crash and not zero.
    expect(rectFactory().getArea(RECT)).toBe(RECT_AREA);
    expect(ellipseFactory().getArea(ELLIPSE)).toBeCloseTo(ELLIPSE_AREA, 9);
    expect(polygonFactory().getArea(TRIANGLE)).toBeCloseTo(TRIANGLE_AREA, 9);
    expect(lineFactory().getLength(LINE)).toBeCloseTo(5, 9);
});

test("an identity matrix changes nothing @unit", () => {
    expect(rectFactory().getArea(withMatrix(RECT, IDENTITY))).toBeCloseTo(RECT_AREA, 9);
    expect(ellipseFactory().getArea(withMatrix(ELLIPSE, IDENTITY))).toBeCloseTo(ELLIPSE_AREA, 9);
    expect(polygonFactory().getArea(withMatrix(TRIANGLE, IDENTITY))).toBeCloseTo(TRIANGLE_AREA, 9);
    expect(lineFactory().getLength(withMatrix(LINE, IDENTITY))).toBeCloseTo(5, 9);
});

// ─── area scales by the determinant ──────────────────────────────────────────

test("a uniform scale of 2 quadruples every area @unit", () => {
    const m = scale(2, 2);
    expect(rectFactory().getArea(withMatrix(RECT, m))).toBeCloseTo(RECT_AREA * 4, 6);
    expect(ellipseFactory().getArea(withMatrix(ELLIPSE, m))).toBeCloseTo(ELLIPSE_AREA * 4, 6);
    expect(polygonFactory().getArea(withMatrix(TRIANGLE, m))).toBeCloseTo(TRIANGLE_AREA * 4, 6);
});

test("an anisotropic scale multiplies area by sx*sy @unit", () => {
    const m = scale(2, 3);
    expect(rectFactory().getArea(withMatrix(RECT, m))).toBeCloseTo(RECT_AREA * 6, 6);
    expect(ellipseFactory().getArea(withMatrix(ELLIPSE, m))).toBeCloseTo(ELLIPSE_AREA * 6, 6);
    expect(polygonFactory().getArea(withMatrix(TRIANGLE, m))).toBeCloseTo(TRIANGLE_AREA * 6, 6);
});

test("rotation leaves area alone @unit", () => {
    // The determinant of a rotation is 1. A multiplier built from the angle
    // instead of the determinant would fail exactly here.
    for (const deg of [30, 90, 137]) {
        const m = rotate(deg);
        expect(rectFactory().getArea(withMatrix(RECT, m))).toBeCloseTo(RECT_AREA, 6);
        expect(ellipseFactory().getArea(withMatrix(ELLIPSE, m))).toBeCloseTo(ELLIPSE_AREA, 6);
        expect(polygonFactory().getArea(withMatrix(TRIANGLE, m))).toBeCloseTo(TRIANGLE_AREA, 6);
    }
});

test("translation leaves area alone @unit", () => {
    const m = translate(1000, -250);
    expect(rectFactory().getArea(withMatrix(RECT, m))).toBeCloseTo(RECT_AREA, 6);
    expect(polygonFactory().getArea(withMatrix(TRIANGLE, m))).toBeCloseTo(TRIANGLE_AREA, 6);
});

// ─── length is not a scalar multiple ─────────────────────────────────────────

test("a uniform scale doubles a length @unit", () => {
    expect(lineFactory().getLength(withMatrix(LINE, scale(2, 2)))).toBeCloseTo(10, 6);
    const polyline = { points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 5 }] };
    expect(polylineFactory().getLength(withMatrix(polyline, scale(2, 2)))).toBeCloseTo(12, 6);
});

test("an anisotropic scale stretches a diagonal by neither factor @unit", () => {
    // (0,0)→(3,4) under (sx=2, sy=3) becomes (0,0)→(6,12): length 6*sqrt(5) ≈ 13.416.
    // Not 5*2 = 10, and not 5*3 = 15 — the number a scalar multiplier would give.
    const length = lineFactory().getLength(withMatrix(LINE, scale(2, 3)));
    expect(length).toBeCloseTo(Math.hypot(6, 12), 6);
    expect(length).not.toBeCloseTo(10, 1);
    expect(length).not.toBeCloseTo(15, 1);
});

test("rotation leaves a length alone @unit", () => {
    expect(lineFactory().getLength(withMatrix(LINE, rotate(37)))).toBeCloseTo(5, 6);
});

// ─── shapes that deliberately do not measure ─────────────────────────────────

test("unmeasurable shapes stay unmeasurable under any transform @unit", () => {
    // Pinned so "returns undefined" stays a decision rather than an oversight:
    // a point has no extent, text is a label, a polyline has no enclosed area.
    const m = scale(2, 3);
    expect(factory(A.Point, "point", "point").getArea(withMatrix(ELLIPSE, m))).toBe(undefined);
    expect(factory(A.Text, "text", "text").getArea(withMatrix(RECT, m))).toBe(undefined);
    expect(polylineFactory().getArea(withMatrix(TRIANGLE, m))).toBe(undefined);
    expect(rectFactory().getLength(withMatrix(RECT, m))).toBe(undefined);
});

// ─── toPointArray reports image coordinates ──────────────────────────────────

test("a scaled rect outlines its scaled corners @unit", () => {
    const withObjectPoint = A.AnnotationObjectFactory.withObjectPoint;
    const corners = rectFactory().toPointArray(withMatrix(RECT, scale(2, 3)), withObjectPoint);

    // Local corners are centre-relative (±50, ±100); under (2,3) they become
    // (±100, ±300), so the outline spans 200×600 — the scaled size.
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(600, 6);
});

test("a rotated rect's outline is genuinely rotated @unit", () => {
    const withObjectPoint = A.AnnotationObjectFactory.withObjectPoint;
    const corners = rectFactory().toPointArray(withMatrix(RECT, rotate(90)), withObjectPoint);

    // A 100×200 rect turned 90° spans 200×100.
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 6);
});

test("toPointArray hands back a copy, never the live points array @unit", () => {
    // It used to return `obj.points` by identity, so any consumer that tidied its
    // result was editing the annotation.
    const object = withMatrix(TRIANGLE, IDENTITY);
    const out = polygonFactory().toPointArray(object, A.AnnotationObjectFactory.withObjectPoint);
    expect(out).not.toBe(object.points);
    out[0].x = 9999;
    expect(object.points[0].x).toBe(0);
});
