/**
 * A source is condemned in proportion to how many tiles it has.
 *
 * `ViewerFaultySourceRegistry` tolerates five consecutive tile failures before
 * marking a source faulty. That number is calibrated for whole-slide pyramids,
 * where a handful of failed requests among thousands is a transient blip.
 *
 * It is exactly wrong for a small source. A single-level, single-tile overlay —
 * a prediction grid stored as one pixel per square, a thumbnail-only mask — can
 * only ever produce ONE failure, and `tileRetryMax` defaults to 0, so it could
 * never reach five. The consequence was silence: a 404 on the only tile of an
 * overlay left the layer blank with nothing in the UI to say so, which is worse
 * than the missing data.
 *
 * These vectors pin the budget: small sources are condemned by the failures they
 * are actually capable of producing, big ones keep the tolerance they need.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { ViewerFaultySourceRegistry } =
    await import("../../../src/classes/app/viewer-faulty-source-registry.ts");

/**
 * A tiled image whose source reports a pyramid of `levels` entries, each level
 * `l` holding `2^l x 2^l` tiles — so a one-level source has exactly one tile.
 */
function makeItem({ levels = 1, url = "https://slides/x", getNumTiles } = {}) {
    return {
        source: {
            url,
            tileSourceId: url,
            minLevel: 0,
            maxLevel: levels - 1,
            getNumTiles: getNumTiles || ((level) => ({ x: 2 ** level, y: 2 ** level })),
        },
    };
}

test("a single-tile source is condemned by its single failure", () => {
    const registry = new ViewerFaultySourceRegistry();
    const item = makeItem({ levels: 1 });
    const key = ViewerFaultySourceRegistry.keyForItem(item);
    const budget = ViewerFaultySourceRegistry.tileFailureBudgetFor(item, registry.faultyThreshold);

    expect(budget).toBe(1);
    expect(registry.recordTileFailure(key, "404", budget)).toBe(true);
    expect(registry.isFaulty(key)).toBe(true);
});

test("without a budget the same source stays silent forever", () => {
    // The regression this exists to catch: four failures is already more than a
    // one-tile source can produce, and it is still not faulty.
    const registry = new ViewerFaultySourceRegistry();
    const key = ViewerFaultySourceRegistry.keyForItem(makeItem({ levels: 1 }));
    for (let i = 0; i < 4; i++) {
        expect(registry.recordTileFailure(key, "404")).toBe(false);
    }
    expect(registry.isFaulty(key)).toBe(false);
});

test("a small pyramid gets a budget of its own tile count", () => {
    // 2 levels => 1 + 4 = 5 tiles, which happens to equal the default;
    // 1+4 clamps at the threshold, so check the strictly-smaller case too.
    const twoTiles = makeItem({ levels: 1, getNumTiles: () => ({ x: 2, y: 1 }) });
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(twoTiles, 5)).toBe(2);

    const threeTiles = makeItem({ levels: 1, getNumTiles: () => ({ x: 3, y: 1 }) });
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(threeTiles, 5)).toBe(3);
});

test("a large pyramid keeps the full tolerance", () => {
    const item = makeItem({ levels: 10 });
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(item, 5)).toBe(5);
});

test("the budget walk stops early instead of summing a whole pyramid", () => {
    // A gigapixel source must not cost a level-by-level walk on every failed
    // tile: the loop exits as soon as the running total reaches the threshold.
    let calls = 0;
    const item = makeItem({
        levels: 12,
        getNumTiles: (level) => { calls++; return { x: 2 ** level, y: 2 ** level }; },
    });
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(item, 5)).toBe(5);
    expect(calls).toBeLessThanOrEqual(3);
});

test("a source that cannot report its tiles falls back to the default", () => {
    const opaque = { source: { url: "https://slides/y" } };
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(opaque, 5)).toBe(5);

    const throwing = { source: { minLevel: 0, maxLevel: 3, getNumTiles() { throw new Error("nope"); } } };
    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(throwing, 5)).toBe(5);

    expect(ViewerFaultySourceRegistry.tileFailureBudgetFor(undefined, 5)).toBe(5);
});

test("a successful tile still clears the counter under a small budget", () => {
    const registry = new ViewerFaultySourceRegistry();
    const item = makeItem({ levels: 1, getNumTiles: () => ({ x: 3, y: 1 }) });
    const key = ViewerFaultySourceRegistry.keyForItem(item);
    const budget = ViewerFaultySourceRegistry.tileFailureBudgetFor(item, registry.faultyThreshold);

    expect(registry.recordTileFailure(key, "404", budget)).toBe(false);
    expect(registry.recordTileFailure(key, "404", budget)).toBe(false);
    registry.recordTileSuccess(key);
    // Counter reset: two more failures must not tip it over on their own.
    expect(registry.recordTileFailure(key, "404", budget)).toBe(false);
    expect(registry.recordTileFailure(key, "404", budget)).toBe(false);
    expect(registry.isFaulty(key)).toBe(false);
    expect(registry.recordTileFailure(key, "404", budget)).toBe(true);
});

test("the transition is reported exactly once", () => {
    // The caller raises a notification off this boolean, so a second failure
    // after the verdict must not produce a second toast.
    const registry = new ViewerFaultySourceRegistry();
    const key = ViewerFaultySourceRegistry.keyForItem(makeItem({ levels: 1 }));
    expect(registry.recordTileFailure(key, "404", 1)).toBe(true);
    expect(registry.recordTileFailure(key, "404", 1)).toBe(false);
});
