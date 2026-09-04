/**
 * The regression suite for the walk that examined nothing and said it was done.
 *
 * A real run on a prostate core spent ONE vision call out of twenty-eight, returned
 * `truncated: false`, and reported every checklist feature as "not-assessable". Two gates
 * closed on each other:
 *
 * - the drill veto compared tissue as a FRACTION of the bounding box (`0.066 >= 0.1` → false),
 *   and a tissue island's bbox is mostly glass whenever the tissue is not rectangular. The
 *   four whole-slide islands measured 0.107 / 0.077 / 0.080 / 0.069, so it vetoed three of
 *   four there as well;
 * - and the only other route to detail — reading the region at its ladder rung — needs the
 *   region tiled, because a 62838 px box does not fit one vision call at 2 µm/px.
 *
 * Every number below is from that run: a 40x scan at 0.243 µm/px, region bounds
 * 62838 x 26493, fill 0.066.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { shouldExpand, worthDrilling, createBudget } = await loadLib("scheduler");
const { planFields, FIELD_MAX_PIXELS } = await loadLib("fields");

test.afterAll(() => cleanupLib());

const SLIDE_MPP = 0.243;
/** The prostate core the walk refused to look at. */
const CORE = { x: 25258, y: 65753, width: 62838, height: 26493 };
const CORE_FILL = 0.066;

/** µm² of tissue in a box — what the gate now reads. */
const tissueAreaOf = (bounds, fill, mpp = SLIDE_MPP) =>
    fill * bounds.width * bounds.height * mpp * mpp;

/**
 * How `_defaultMinDrillTissue` derives the gate: a readable FRACTION of one field at the finest
 * rung, not a whole field of solid tissue. The factor is `TILE_MIN_FILL`, the same floor
 * `planFields` applies to a tile, and leaving it out is what produced the second failure in this
 * file's history — see "the second gate" below.
 */
const TILE_MIN_FILL = 0.05;
const gateFor = (finestMpp, fieldPixels = FIELD_MAX_PIXELS) =>
    fieldPixels * finestMpp * finestMpp * TILE_MIN_FILL;

const CHECKLIST = {
    source: "fallback",
    features: [
        { id: "match", label: "Match", question: "?", requiredMpp: 1, weight: 1 },
        { id: "extent", label: "Extent", question: "?", requiredMpp: 1, weight: 0.6 },
        { id: "quality", label: "Quality", question: "?", requiredMpp: 2, weight: 0.3 },
    ],
};

/** The node the transcript produced, as the scheduler sees it. */
const coreNode = (over = {}) => ({
    id: "region 1",
    rootId: "r0",
    rung: 0,
    interest: 0.65,
    cellularity: 0.012,
    bboxFillFraction: CORE_FILL,
    tissueArea: tissueAreaOf(CORE, CORE_FILL),
    slideAreaFraction: 0.091,
    deliveredMpp: 7.011,
    answers: {
        match: { id: "match", present: "not-assessable", reason: "resolution" },
        extent: { id: "extent", present: "not-assessable", reason: "resolution" },
        quality: { id: "quality", present: "not-assessable", reason: "resolution" },
    },
    ancestorInterests: [],
    ...over,
});

const OPTS = { interestThreshold: 0.5, minDrillTissue: gateFor(1.0) };

// ---- the veto -----------------------------------------------------------------------

test("the core the old gate rejected is drillable", { tag: ["@unit"] }, () => {
    const node = coreNode();

    // The old test — and the old gate: 0.066 < 0.1, so nothing was ever expanded.
    expect(node.bboxFillFraction).toBeLessThan(0.1);
    // 0.066 of 1.66 GPx at 0.243 µm/px is ~6.5 mm² of tissue, against a 2 mm² gate.
    expect(node.tissueArea / 1e6, "mm² of tissue in the box").toBeGreaterThan(6);
    expect(worthDrilling(node, OPTS)).toBe(true);
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(true);
});

test("all four whole-slide islands are drillable, not three-quarters vetoed", { tag: ["@unit"] }, () => {
    // The exact fills the whole-slide run reported. The old 0.1 floor passed only the first.
    const islands = [
        { fill: 0.107, bounds: { x: 0, y: 181555, width: 67788, height: 16747 } },
        { fill: 0.069, bounds: { x: 25249, y: 65753, width: 62847, height: 26496 } },
        { fill: 0.077, bounds: { x: 18120, y: 122598, width: 62388, height: 23399 } },
        { fill: 0.080, bounds: { x: 10742, y: 16613, width: 61470, height: 22023 } },
    ];
    for (const i of islands) {
        const node = coreNode({ bboxFillFraction: i.fill, tissueArea: tissueAreaOf(i.bounds, i.fill) });
        expect(worthDrilling(node, OPTS), `fill ${i.fill}`).toBe(true);
    }
});

// ---- the second gate: the area floor that replaced the fill floor ---------------------

test("the smaller core the AREA gate rejected is drillable", { tag: ["@unit"] }, () => {
    // From the run after the fill floor was replaced. Same slide, a smaller region: the walk
    // spent 1 call of 28 again, `focusUnspent: 27`, `truncated: false`, every feature
    // "not-assessable" — because the gate was one WHOLE field of solid tissue (2 MP x 1 µm/px =
    // 2 mm²), which no box smaller than a field, and no box with fill < 1, can ever hold.
    const SMALL_CORE = { x: 3211, y: 191429, width: 14221, height: 6079 };
    const node = coreNode({
        bboxFillFraction: 0.27,
        tissueArea: tissueAreaOf(SMALL_CORE, 0.27),
        deliveredMpp: 1.598,
        interest: 0,
    });

    expect(node.tissueArea / 1e6, "mm² of tissue in the box").toBeCloseTo(1.37, 1);
    expect(node.tissueArea, "under a whole field's worth — the gate that vetoed it")
        .toBeLessThan(FIELD_MAX_PIXELS * 1.0 * 1.0);
    expect(worthDrilling(node, OPTS)).toBe(true);
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(true);
});

test("the gate separates a core from glass by orders of magnitude, not by a hair", { tag: ["@unit"] }, () => {
    // Why the fraction is the whole calibration, and why no extra exemption is needed on top of
    // it: the two things the gate must tell apart are ~1.4 mm² and ~0.002 mm² of tissue. Anything
    // that lands between them is a field that is 95% glass, which is exactly what it should
    // refuse — the failure was never a borderline call, it was a floor set above BOTH.
    const core = tissueAreaOf({ x: 3211, y: 191429, width: 14221, height: 6079 }, 0.27);
    const speck = tissueAreaOf({ x: 0, y: 0, width: 2000, height: 2000 }, 0.01);
    const gate = gateFor(1.0);

    expect(speck).toBeLessThan(gate);
    expect(gate).toBeLessThan(core);
    expect(core / speck, "three orders of magnitude apart").toBeGreaterThan(100);
});

test("a box with almost no tissue is still refused", { tag: ["@unit"] }, () => {
    // The gate has to keep doing its real job: not chasing a sharper picture of glass.
    const speck = { x: 0, y: 0, width: 2000, height: 2000 };
    const node = coreNode({ bboxFillFraction: 0.01, tissueArea: tissueAreaOf(speck, 0.01) });
    expect(worthDrilling(node, OPTS)).toBe(false);
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(false);
});

test("an unmeasured box is not vetoed on a measurement nobody took", { tag: ["@unit"] }, () => {
    // `measureFill: false` is a supported configuration; refusing to drill under it would be
    // a silent behaviour change rather than a saving.
    expect(worthDrilling(coreNode({ tissueArea: null, bboxFillFraction: null }), OPTS)).toBe(true);
});

test("a failed node is never expanded", { tag: ["@unit"] }, () => {
    expect(worthDrilling(coreNode({ error: "render failed" }), OPTS)).toBe(false);
    expect(shouldExpand(coreNode({ error: "render failed" }), CHECKLIST, OPTS)).toBe(false);
});

test("bbox fill is no longer a gate at all, at any value", { tag: ["@unit"] }, () => {
    // The knob that carried the old 0.1 floor is gone, not defaulted to off: while it existed a
    // caller could re-arm the exact veto that made a prostate core unreadable. Fill still counts,
    // in RANKING (`fillWeight`), where a sparse box loses to a dense one instead of vanishing.
    for (const fill of [0.01, 0.066, 0.107, 0.27, 1]) {
        const node = coreNode({ bboxFillFraction: fill });
        expect(worthDrilling(node, OPTS), `fill ${fill} decides nothing`).toBe(true);
    }
});

// ---- what makes a node worth expanding ----------------------------------------------

test("an open checklist question is reason enough, without a high interest score", { tag: ["@unit"] }, () => {
    // The unreadable-view death spiral: a view that cannot answer scores low and hedges, so an
    // interest-only gate prunes exactly the branch a closer look would settle.
    const node = coreNode({ interest: 0.05 });
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(true);
});

// ---- the model's own "I cannot see this here" ----------------------------------------

/**
 * The second run this file exists for. Same slide, after the fill and area gates were fixed:
 * the walk descended two levels, delivered 0.849 µm/px, and the model answered
 * `not-assessable` to every feature with `RESOLVABLE: no`. It stopped there and reported
 * `isComplete: true`.
 *
 * Nothing was left open to justify going deeper — `checklistGaps` closes a feature once the
 * field is at or below its `requiredMpp`, and the generic checklist declares 1.0 µm/px
 * sufficient. So the one party that actually looked at the pixels said it could not see, and
 * the only gate that could act on that never read it.
 */
const UNREADABLE = {
    match: { id: "match", present: "not-assessable", reason: "model" },
    extent: { id: "extent", present: "not-assessable", reason: "model" },
    quality: { id: "quality", present: "not-assessable", reason: "model" },
};

test("a model that says it cannot see is a reason to look closer", { tag: ["@unit"] }, () => {
    const node = coreNode({
        deliveredMpp: 0.849, interest: 0.1,
        answers: UNREADABLE, resolvable: false, finestMpp: 0.25,
    });

    // The checklist has nothing to add: every feature is at or past its stated requirement.
    expect(shouldExpand({ ...node, resolvable: null }, CHECKLIST, OPTS),
        "the failure — no gaps, low interest, branch dies").toBe(false);
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(true);
});

test("...but only while there is a finer rung to go to", { tag: ["@unit"] }, () => {
    // The terminator. Without it a model that answers "too coarse" at every resolution keeps
    // the node expandable until the budget runs out.
    const atFinest = coreNode({
        deliveredMpp: 0.25, interest: 0.1,
        answers: UNREADABLE, resolvable: false, finestMpp: 0.25,
    });
    expect(shouldExpand(atFinest, CHECKLIST, OPTS)).toBe(false);
});

test("an uncalibrated slide is carried by the gap rule, not this route", { tag: ["@unit"] }, () => {
    // With no `deliveredMpp` there is no resolution to compare, so the model's verdict cannot
    // be terminated and must contribute nothing. Nothing is lost: on such a slide every
    // unsettled feature is a gap by construction (`requiredMpp < Infinity`), which is what
    // keeps the node expandable — and what makes the depth cap the thing that ends the walk.
    const uncalibrated = coreNode({
        deliveredMpp: null, interest: 0.1, answers: UNREADABLE, resolvable: false, finestMpp: null,
    });
    expect(shouldExpand(uncalibrated, CHECKLIST, OPTS)).toBe(true);
    // Prove it is the gap rule doing the work: withdraw the model's verdict and nothing changes.
    expect(shouldExpand({ ...uncalibrated, resolvable: null }, CHECKLIST, OPTS)).toBe(true);
});

test("glass the model could not read is still glass", { tag: ["@unit"] }, () => {
    const speck = coreNode({
        tissueArea: 1, bboxFillFraction: 0.01, deliveredMpp: 0.849,
        answers: UNREADABLE, resolvable: false, finestMpp: 0.25,
    });
    expect(shouldExpand(speck, CHECKLIST, OPTS)).toBe(false);
});

test("a node that settled every question stops unless it is independently interesting", { tag: ["@unit"] }, () => {
    const answered = {
        match: { id: "match", present: "yes" },
        extent: { id: "extent", present: "no" },
        quality: { id: "quality", present: "yes" },
    };
    expect(shouldExpand(coreNode({ answers: answered, interest: 0.1 }), CHECKLIST, OPTS)).toBe(false);
    expect(shouldExpand(coreNode({ answers: answered, interest: 0.9 }), CHECKLIST, OPTS)).toBe(true);
});

test("fields already planned for a node keep it expandable", { tag: ["@unit"] }, () => {
    // The reading is all that is left; there is nothing further to justify. Without this a
    // region that tiled into fifteen fields would be silently four.
    const answered = {
        match: { id: "match", present: "yes" },
        extent: { id: "extent", present: "no" },
        quality: { id: "quality", present: "yes" },
    };
    const node = coreNode({ answers: answered, interest: 0.1, pendingTiles: 11 });
    expect(shouldExpand(node, CHECKLIST, OPTS)).toBe(true);
    // ...but not past the tissue gate, which still applies.
    expect(shouldExpand({ ...node, tissueArea: 1 }, CHECKLIST, OPTS)).toBe(false);
});

// ---- the other half: the region has to be tileable at its rung -----------------------

test("the core tiles at its rung instead of collapsing to one coarse field", { tag: ["@unit"] }, () => {
    // This is what the walk now expands into. At 1.0 µm/px the box is 4.1x downsampled, so a
    // single field would need ~250 MP; the lattice carries it in cells that each fit one call.
    const plan = planFields({ bounds: CORE, mpp: 1.0, slideMpp: SLIDE_MPP, minFill: 0.05 });

    expect(plan.fields.length, "a 15 mm core does not fit one call at 1 µm/px").toBeGreaterThan(1);
    expect(plan.deliveredMpp, "and the tiles deliver the rung, not 7 µm/px").toBeCloseTo(1.0, 6);
    for (const f of plan.fields) {
        expect(f.rasterPx.width * f.rasterPx.height, `${f.id} fits one vision call`)
            .toBeLessThanOrEqual(FIELD_MAX_PIXELS);
        // Every tile must be a real advance on the parent, or expanding is a reframe.
        expect(f.bounds.width * f.bounds.height).toBeLessThan(0.9 * CORE.width * CORE.height);
    }
});

test("glass cells cost nothing: the mask drops them before any render", { tag: ["@unit"] }, () => {
    // Tissue only in the left third of the box.
    const mask = { fill: (b) => (b.x + b.width / 2 < CORE.x + CORE.width / 3 ? 0.5 : 0) };
    const withMask = planFields({ bounds: CORE, mpp: 1.0, slideMpp: SLIDE_MPP, minFill: 0.05, mask });
    const without = planFields({ bounds: CORE, mpp: 1.0, slideMpp: SLIDE_MPP, minFill: 0.05 });

    expect(withMask.fields.length).toBeGreaterThan(0);
    expect(withMask.fields.length, "empty cells are never planned").toBeLessThan(without.fields.length);
});

// ---- reporting ----------------------------------------------------------------------

test("a fresh budget reports nothing unspent and nothing skipped", { tag: ["@unit"] }, () => {
    const budget = createBudget(28, 0.35);
    expect(budget.surveyBudget).toBe(10);
    expect(budget.focusBudget).toBe(18);
    // The fields that make a stalled run legible; both start clean.
    expect(budget.focusUnspent).toBe(0);
    expect(budget.plannedNotRead).toBe(0);
});
