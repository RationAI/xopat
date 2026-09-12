/**
 * Ground truth for the geometry the panel prints.
 *
 * Everything else in this module's suite checks *agreement* — that the label
 * matches the number, that the panel matches the canvas. Agreement is not
 * correctness: both sides can share one wrong scale, which is exactly how the
 * `formatArea` mix-up survived. These cases assert against values computed
 * independently of the implementation — a 100×200 rectangle is 20000, an ellipse
 * is πab, a square with a quarter-sized hole is 0.75 — so a wrong answer has
 * nowhere to hide.
 *
 * Runs against the REAL annotation factories (`objects.js` +
 * `objectGenericFactories.js`) loaded headlessly, following
 * `modules/annotations/test/unit/label-value.test.mjs`: no canvas, no fabric, no
 * browser. `getArea` only ever reads plain properties off the object, so a
 * literal stands in for a fabric instance.
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
            // The point factories pass `fabric.Polygon` & co. to `super()` as a
            // class reference and never instantiate one here — a marker is enough.
            fabric: {
                Rect: class {}, Ellipse: class {},
                Polygon: class {}, Polyline: class {}, Line: class {},
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objects.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "objectGenericFactories.js"), "OSDAnnotations");

    // The measurements module reads its own namespace off the same global.
    globalThis.window.OSDAnnotations = A;
    await import("../../raster-sampler.js");
    await import("../../geometry-metrics.js");
});

const NS = () => globalThis.AnnotationMeasurements;

/** Instantiate a real factory without a context/preset manager. */
function realFactory(Cls, factoryId) {
    return new Cls({}, { get: () => undefined }, factoryId, factoryId);
}

/** Point factories take only (context, presetManager) — the rest is fixed in super(). */
function pointFactory(Cls) {
    return new Cls({}, { get: () => undefined });
}

/** An `annotations`-like object exposing just the factory lookup `areaOf` needs. */
function annotationsWith(map) {
    return { getAnnotationObjectFactory: (id) => map[id] };
}

// ─── the factory formulas, against values computed by hand ────────────────────

test("a 100x200 rectangle measures exactly 20000 px² @unit", () => {
    const rect = realFactory(A.Rect, "rect");
    expect(rect.getArea({ width: 100, height: 200 })).toBe(20000);
});

test("an ellipse measures pi*rx*ry @unit", () => {
    const ellipse = realFactory(A.Ellipse, "ellipse");
    expect(ellipse.getArea({ rx: 50, ry: 20 })).toBeCloseTo(Math.PI * 50 * 20, 9);
});

test("a polygon measures its shoelace area, either winding @unit", () => {
    const polygon = pointFactory(A.Polygon);
    // A 3-4-5 right triangle: legs 30 and 40 → area 600.
    const triangle = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 40 }];
    expect(polygon.getArea({ points: triangle })).toBeCloseTo(600, 9);
    // Winding must not change the magnitude — the implementation takes |sum|/2.
    expect(polygon.getArea({ points: [...triangle].reverse() })).toBeCloseTo(600, 9);
});

test("areaOf refuses a shape it cannot measure instead of guessing @unit", () => {
    const annotations = annotationsWith({ polyline: pointFactory(A.Polyline) });
    // An open path has no area; the engine must surface NaN, not 0 — 0 would be
    // a legitimate-looking measurement of an unmeasurable thing.
    const area = NS().geometry.areaOf(annotations, { factoryID: "polyline", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] });
    expect(Number.isNaN(area)).toBe(true);
});

test("a polyline measures its summed segment lengths @unit", () => {
    const polyline = pointFactory(A.Polyline);
    // 3-4-5 then a unit step: 5 + 1.
    const length = polyline.getLength({ points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 5 }] });
    expect(length).toBeCloseTo(6, 9);
});

// ─── ring maths ───────────────────────────────────────────────────────────────

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const HOLE = [{ x: 2.5, y: 2.5 }, { x: 7.5, y: 2.5 }, { x: 7.5, y: 7.5 }, { x: 2.5, y: 7.5 }];

test("polygonAreaImagePx subtracts holes @unit", () => {
    const g = NS().geometry;
    expect(g.polygonAreaImagePx([SQUARE])).toBeCloseTo(100, 9);
    // 10x10 minus 5x5.
    expect(g.polygonAreaImagePx([SQUARE, HOLE])).toBeCloseTo(75, 9);
});

test("a degenerate ring has no area rather than a negative one @unit", () => {
    const g = NS().geometry;
    // A hole larger than its outer ring must clamp at 0, never go negative.
    expect(g.polygonAreaImagePx([HOLE, SQUARE])).toBe(0);
    expect(Number.isNaN(g.polygonAreaImagePx([]))).toBe(true);
});

test("ringSignedArea carries the winding, centroid sits at the middle @unit", () => {
    const g = NS().geometry;
    expect(g.ringSignedArea(SQUARE)).toBeCloseTo(100, 9);
    expect(g.ringSignedArea([...SQUARE].reverse())).toBeCloseTo(-100, 9);

    const c = g.centroid(SQUARE);
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(5, 9);
});

test("pointInRing decides inside and outside @unit", () => {
    const g = NS().geometry;
    expect(g.pointInRing({ x: 5, y: 5 }, SQUARE)).toBe(true);
    expect(g.pointInRing({ x: 15, y: 5 }, SQUARE)).toBe(false);
    expect(g.pointInRing({ x: -0.001, y: 5 }, SQUARE)).toBe(false);
});

// ─── ratios ───────────────────────────────────────────────────────────────────

/** Two rects whose areas are known exactly: 20000 and 5000. */
function ratioFixture() {
    const annotations = annotationsWith({ rect: realFactory(A.Rect, "rect") });
    return {
        annotations,
        big: { factoryID: "rect", width: 100, height: 200 },
        small: { factoryID: "rect", width: 50, height: 100 },
    };
}

test("areaRatio is the exact quotient of two known areas @unit", () => {
    const { annotations, big, small } = ratioFixture();
    const res = NS().geometry.areaRatio(annotations, small, big);
    expect(res.numeratorAreaPx).toBe(5000);
    expect(res.denominatorAreaPx).toBe(20000);
    expect(res.ratio).toBeCloseTo(0.25, 12);
});

test("areaRatioAgainstSet sums the denominators @unit", () => {
    const { annotations, big, small } = ratioFixture();
    const res = NS().geometry.areaRatioAgainstSet(annotations, small, [big, big]);
    expect(res.denominatorAreaPx).toBe(40000);
    expect(res.ratio).toBeCloseTo(0.125, 12);
});

test("areaRatioBetweenSets sums both sides @unit", () => {
    const { annotations, big, small } = ratioFixture();
    // 2 x 5000 over 20000.
    const res = NS().geometry.areaRatioBetweenSets(annotations, [small, small], [big]);
    expect(res.numeratorAreaPx).toBe(10000);
    expect(res.denominatorAreaPx).toBe(20000);
    expect(res.ratio).toBeCloseTo(0.5, 12);
});

test("swapping the two sides gives the reciprocal @unit", () => {
    // The property the swap button rests on. Before sets were allowed on both
    // sides, one of these two was simply not expressible.
    const { annotations, big, small } = ratioFixture();
    const forward = NS().geometry.areaRatioBetweenSets(annotations, [small], [big]);
    const reverse = NS().geometry.areaRatioBetweenSets(annotations, [big], [small]);

    expect(forward.ratio).toBeCloseTo(0.25, 12);
    expect(reverse.ratio).toBeCloseTo(4, 12);
    expect(forward.ratio * reverse.ratio).toBeCloseTo(1, 12);
});

test("a set with an unmeasurable member counts the rest @unit", () => {
    const { annotations, big, small } = ratioFixture();
    // A member whose factory reports no area must not poison the sum with NaN.
    const unmeasurable = { factoryID: "rect" };
    const res = NS().geometry.areaRatioBetweenSets(annotations, [small, unmeasurable], [big]);
    expect(res.numeratorAreaPx).toBe(5000);
    expect(res.ratio).toBeCloseTo(0.25, 12);
});

test("a zero denominator yields NaN, not Infinity @unit", () => {
    const { annotations, small } = ratioFixture();
    const empty = { factoryID: "rect", width: 0, height: 0 };
    expect(Number.isNaN(NS().geometry.areaRatio(annotations, small, empty).ratio)).toBe(true);
    expect(Number.isNaN(NS().geometry.areaRatioAgainstSet(annotations, small, []).ratio)).toBe(true);
});
