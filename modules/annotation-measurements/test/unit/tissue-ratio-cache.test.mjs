/**
 * The tissue ratio is cached on the annotation like the pixel metrics, but under
 * its own key: it is geometry against a derived mask, not a function of the
 * sampling slot (source/channel). It must go stale with the shape — a resized
 * annotation reporting the ratio of its old outline would be a wrong number that
 * looks right.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../measurement-engine.js");

const Engine = () => new globalThis.AnnotationMeasurements.MeasurementEngine({ annotations: {} });

test("setTissueRatio round-trips and is independent of the sampling slot @unit", () => {
    const engine = Engine();
    const object = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    expect(engine.getTissueRatio(object)).toBe(null);

    engine.setTissueRatio(object, { ratio: 0.25, annotationAreaPx: 50, tissueAreaPx: 200, islandIds: [7], islandCount: 1 });
    const got = engine.getTissueRatio(object);
    expect(got.ratio).toBe(0.25);
    expect(got.islandIds).toEqual([7]);
    expect(typeof got.computedAt).toBe("number");
    // Pixel cache for any slot is untouched.
    expect(engine.getCached(object, { source: "rendered", channel: "V" })).toBe(null);
});

test("a shape change invalidates the cached ratio @unit", () => {
    const engine = Engine();
    const object = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    engine.setTissueRatio(object, { ratio: 0.25 });
    expect(engine.getTissueRatio(object)?.ratio).toBe(0.25);

    object.points[2].x = 12;
    expect(engine.getTissueRatio(object)).toBe(null);
});
