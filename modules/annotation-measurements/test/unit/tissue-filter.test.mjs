/**
 * Which tissue islands survive next to a target.
 *
 * A derived mask covers everything the detector found in the view, most of which
 * is not the thing being measured. `withinReach` is the rule that prunes it, and
 * it decides what ends up in the denominator of a ratio — so a quiet error here
 * changes every number downstream without looking like a failure.
 *
 * Two behaviours are easy to get wrong and are pinned below:
 *
 *   - **Containment counts as reach.** A target drawn in the middle of a large
 *     island is far from that island's *boundary*. A pure distance test discards
 *     the very region the target sits on — the worst possible answer.
 *   - **The caller owns the distance.** The rule takes a number in image pixels;
 *     the panel derives it from the viewport width so the filter follows the zoom.
 *     Keeping the policy out of here is what makes it testable at all.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../raster-sampler.js");
await import("../../geometry-metrics.js");

const geometry = () => globalThis.AnnotationMeasurements.geometry;

/** A square of `size` with its top-left at (x, y), as a polygon annotation. */
function square(x, y, size) {
    return {
        factoryID: "polygon",
        points: [
            { x, y },
            { x: x + size, y },
            { x: x + size, y: y + size },
            { x, y: y + size },
        ],
    };
}

/**
 * Minimal `annotations` stand-in: `ringsForObject` only needs a factory whose
 * `toPointArray` hands back the points.
 */
const annotations = {
    getAnnotationObjectFactory: () => ({
        toPointArray: (obj) => obj.points,
        getArea: () => NaN,
    }),
};

test("an island the target sits inside is always kept @unit", () => {
    const island = square(0, 0, 1000);
    const target = square(400, 400, 50);      // centred, ~375 px from any edge

    // Even with a reach far smaller than the distance to the boundary.
    expect(geometry().withinReach(annotations, target, island, 10)).toBe(true);
    // And with no reach at all.
    expect(geometry().withinReach(annotations, target, island, 0)).toBe(true);
});

test("a nearby island is kept and a distant one is dropped @unit", () => {
    const target = square(0, 0, 100);
    const near = square(150, 0, 100);         // 50 px gap
    const far = square(600, 0, 100);          // 500 px gap

    expect(geometry().withinReach(annotations, target, near, 100)).toBe(true);
    expect(geometry().withinReach(annotations, target, far, 100)).toBe(false);
    // Widen the reach and the far one qualifies — the rule is the distance, not
    // some property of the island.
    expect(geometry().withinReach(annotations, target, far, 600)).toBe(true);
});

test("the boundary case is inclusive @unit", () => {
    const target = square(0, 0, 100);
    const island = square(150, 0, 100);       // exactly 50 px away

    expect(geometry().withinReach(annotations, target, island, 50)).toBe(true);
    expect(geometry().withinReach(annotations, target, island, 49.9)).toBe(false);
});

test("reach scales, so the same pair flips with the zoom @unit", () => {
    // What the panel actually does: reach = factor x viewport width. The same two
    // annotations must be judged differently at different zooms, which is the whole
    // point of quoting the distance in view widths.
    const target = square(0, 0, 100);
    const island = square(400, 0, 100);       // 300 px gap
    const factor = 0.25;

    const zoomedIn = factor * 400;            // 100 px reach
    const zoomedOut = factor * 4000;          // 1000 px reach

    expect(geometry().withinReach(annotations, target, island, zoomedIn)).toBe(false);
    expect(geometry().withinReach(annotations, target, island, zoomedOut)).toBe(true);
});

test("distance is measured boundary to boundary, not centre to centre @unit", () => {
    // Two big squares 10 px apart have centres ~1010 px apart. A centre-based rule
    // would discard them at any sane reach.
    const target = square(0, 0, 1000);
    const island = square(1010, 0, 1000);

    expect(geometry().withinReach(annotations, target, island, 20)).toBe(true);
});

test("an unmeasurable shape is not kept by accident @unit", () => {
    const target = square(0, 0, 100);
    const noRings = { factoryID: "polygon", points: [] };

    expect(geometry().withinReach(annotations, target, noRings, 1e6)).toBe(false);
    expect(geometry().withinReach(annotations, noRings, square(0, 0, 100), 1e6)).toBe(false);
});

test("a negative or absent reach still honours containment @unit", () => {
    const island = square(0, 0, 1000);
    const inside = square(400, 400, 50);
    const outside = square(2000, 2000, 50);

    expect(geometry().withinReach(annotations, inside, island, undefined)).toBe(true);
    expect(geometry().withinReach(annotations, outside, island, undefined)).toBe(false);
    expect(geometry().withinReach(annotations, outside, island, -5)).toBe(false);
});

// ─── rankByProximity: which island is "the subject's" ─────────────────────────
//
// A derivation returns every island in view. The one the subject sits ON must
// come first even when a small neighbour's boundary is closer than the
// containing island's boundary — otherwise "derive the mask of my region" keeps
// the wrong island.

test("the containing island ranks first at distance 0, even when a neighbour's edge is closer @unit", () => {
    const big = square(0, 0, 1000);
    const target = square(450, 450, 100);     // centred in `big`, 450 px from its edge
    const neighbour = square(560, 450, 100);  // 10 px from the target's right edge

    const ranked = geometry().rankByProximity(annotations, target, [neighbour, big]);
    expect(ranked.map((r) => r.object)).toEqual([big, neighbour]);
    expect(ranked[0].distancePx).toBe(0);
    expect(ranked[1].distancePx).toBeCloseTo(10, 6);
});

test("without containment, islands are ordered by boundary distance @unit", () => {
    const target = square(0, 0, 100);
    const far = square(600, 0, 100);          // 500 px
    const near = square(150, 0, 100);         // 50 px
    const mid = square(300, 0, 100);          // 200 px

    const ranked = geometry().rankByProximity(annotations, target, [far, near, mid]);
    expect(ranked.map((r) => r.object)).toEqual([near, mid, far]);
    expect(ranked.map((r) => r.distancePx)).toEqual([50, 200, 500]);
});

test("unmeasurable islands are dropped and ties keep input order @unit", () => {
    const target = square(0, 0, 100);
    const left = square(-200, 0, 100);        // 100 px
    const right = square(200, 0, 100);        // 100 px
    const noRings = { factoryID: "polygon", points: [] };

    const ranked = geometry().rankByProximity(annotations, target, [right, noRings, left]);
    expect(ranked.map((r) => r.object)).toEqual([right, left]);
    // No subject geometry → nothing can be ranked.
    expect(geometry().rankByProximity(annotations, noRings, [left, right])).toEqual([]);
});
