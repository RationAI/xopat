/**
 * Costing a walk before running it.
 *
 * A plan exists so a minutes-long scan can be inspected — and trimmed — before it is paid
 * for. Two things have to hold for that to be safe: the caller's edits must address regions
 * the way the caller SEES them, and the overlaps worth acting on must reach a reader whose
 * result is truncated at a fixed size.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { applyPlanEdits, overlapPairs, MAX_REPORTED_OVERLAP_PAIRS } = await loadLib("plan");

test.afterAll(() => cleanupLib());

const region = (label, x, y, w = 100, h = 100) => ({ label, bounds: { x, y, width: w, height: h } });

const THREE = [region("region 1", 0, 0), region("region 2", 500, 0), region("region 3", 1000, 0)];

test("no edits keeps every region", { tag: ["@unit"] }, () => {
    expect(applyPlanEdits(THREE)).toEqual(THREE);
    expect(applyPlanEdits(THREE, {})).toEqual(THREE);
});

test("drop removes exactly the named regions", { tag: ["@unit"] }, () => {
    const kept = applyPlanEdits(THREE, { drop: ["region 2"] });

    expect(kept.map(r => r.label)).toEqual(["region 1", "region 3"]);
});

test("only keeps the named regions and nothing else", { tag: ["@unit"] }, () => {
    const kept = applyPlanEdits(THREE, { only: ["region 3", "region 1"] });

    expect(kept.map(r => r.label), "order comes from the plan, not from the edit").toEqual(["region 1", "region 3"]);
});

test("an unknown label is ignored, not fatal", { tag: ["@unit"] }, () => {
    // Striking a region that no longer exists means the same thing as striking one that
    // does; throwing would discard a survey the caller already paid for.
    expect(applyPlanEdits(THREE, { drop: ["region 9"] })).toHaveLength(3);
    expect(applyPlanEdits(THREE, { only: ["region 9"] }), "an empty plan is the caller's answer, not an error")
        .toHaveLength(0);
});

test("edits do not mutate the plan's own region list", { tag: ["@unit"] }, () => {
    applyPlanEdits(THREE, { drop: ["region 1"] });

    expect(THREE.map(r => r.label), "the plan must stay runnable a second time")
        .toEqual(["region 1", "region 2", "region 3"]);
});

test("overlapPairs reports only real overlap, worst first", { tag: ["@unit"] }, () => {
    const pairs = overlapPairs([
        region("region 1", 0, 0),
        region("region 2", 90, 0),   // barely touches region 1
        region("region 3", 10, 0),   // largely region 1
        region("region 4", 5000, 0), // alone
    ]);

    expect(pairs[0]).toMatchObject({ a: "region 1", b: "region 3" });
    expect(pairs.every(p => p.iou > 0), "a pair with no shared area is not an overlap").toBe(true);
    expect(pairs.some(p => p.a === "region 4" || p.b === "region 4")).toBe(false);
});

test("overlapPairs is bounded — a fragmented slide is quadratic", { tag: ["@unit"] }, () => {
    // Twenty boxes each overlapping its neighbours: 100+ pairs, read by a model on a fixed
    // character budget. The cap keeps the ones worth acting on.
    const many = Array.from({ length: 20 }, (_, i) => region(`region ${i + 1}`, i * 5, 0));

    expect(overlapPairs(many)).toHaveLength(MAX_REPORTED_OVERLAP_PAIRS);
    expect(overlapPairs(many, 3)).toHaveLength(3);
});

test("overlapPairs is empty when nothing overlaps", { tag: ["@unit"] }, () => {
    expect(overlapPairs(THREE)).toEqual([]);
    expect(overlapPairs([])).toEqual([]);
});
