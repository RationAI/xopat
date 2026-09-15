/**
 * The traversal invariants that fix single-region tunnel vision.
 *
 * The old walk was depth-first with ONE budget: root 1 was drilled to exhaustion and
 * roots 2..4 were routinely never visited, because the budget ran out inside the first
 * branch. Two mechanisms replace that, and both are properties worth pinning:
 *
 * 1. **The survey account is reserved** — coverage is not what happens to be left over.
 * 2. **Novelty decays per branch** — so the queue spreads across the slide rather than
 *    drilling one island until the budget is gone.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    createBudget, canSpend, spend, rolloverSurveyBudget,
    priority, shouldExpand, checklistGaps, pathPrior, PriorityQueue,
    areaWeight, cellularityWeight, confidenceWeight, fillWeight,
} = await loadLib("scheduler");
const { sanitizeChecklist } = await loadLib("checklist");

test.afterAll(() => cleanupLib());

const CHECKLIST = sanitizeChecklist([
    { id: "invasion", label: "Invasion", question: "?", requiredMpp: 0.5, weight: 1 },
    { id: "atypia", label: "Atypia", question: "?", requiredMpp: 0.25, weight: 1 },
], { source: "derived" });

const node = (over = {}) => ({
    id: "n", rootId: "r1", rung: 0, interest: 0.5,
    slideAreaFraction: 0.5, deliveredMpp: 1.0, ...over,
});

/**
 * The drill gate these traversal tests run under.
 *
 * A real area floor with tissue well above it: the gate is not what any test in this file is
 * about, and it must not be the reason an expansion decision goes one way. (The gate itself is
 * pinned in `drill-gate.test.mjs`, which is where its calibration belongs.)
 */
const GATE = { interestThreshold: 0.5, minDrillTissue: 1_000 };

const ctx = (over = {}) => ({
    checklist: CHECKLIST, maxArea: 1, expandedPerRoot: new Map(), ...over,
});

// ---- budget accounts -------------------------------------------------------

test("the survey account is reserved from the focus account", { tag: ["@unit"] }, () => {
    const b = createBudget(28, 0.35);

    expect(b.surveyBudget).toBe(10);
    expect(b.focusBudget).toBe(18);
    expect(b.surveyBudget + b.focusBudget).toBe(28);
});

test("focus cannot draw on survey budget", { tag: ["@unit"] }, () => {
    const b = createBudget(10, 0.5); // 5 survey, 5 focus

    for (let i = 0; i < 5; i++) spend(b, "focus");

    expect(canSpend(b, "focus"), "focus is spent out").toBe(false);
    expect(canSpend(b, "survey"), "and it did not touch coverage").toBe(true);
    expect(b.surveyCalls).toBe(0);
});

test("survey leftovers roll into focus, but only after the survey", { tag: ["@unit"] }, () => {
    const b = createBudget(10, 0.5);
    spend(b, "survey");
    spend(b, "survey");

    expect(b.focusBudget, "before rollover, focus has only its own share").toBe(5);

    rolloverSurveyBudget(b);

    expect(b.focusBudget, "the 3 unspent survey calls become focus calls").toBe(8);
    expect(canSpend(b, "survey"), "and coverage cannot be spent retroactively").toBe(false);
});

test("total calls never exceed the cap", { tag: ["@unit"] }, () => {
    const b = createBudget(28, 0.35);

    while (canSpend(b, "survey")) spend(b, "survey");
    rolloverSurveyBudget(b);
    while (canSpend(b, "focus")) spend(b, "focus");

    expect(b.analyzeCalls).toBe(28);
});

// ---- expansion rule --------------------------------------------------------

test("an open checklist question is reason enough to expand", { tag: ["@unit"] }, () => {
    // Low interest, but a feature this rung could not settle. An interest-only gate
    // prunes exactly the branch a closer look would resolve.
    const dull = node({
        interest: 0.1,
        answers: { invasion: { present: "not-assessable" }, atypia: { present: "not-assessable" } },
    });

    expect(shouldExpand(dull, CHECKLIST, GATE)).toBe(true);
});

test("a settled feature is not a gap", { tag: ["@unit"] }, () => {
    const settled = node({
        interest: 0.1, deliveredMpp: 0.25,
        answers: { invasion: { present: "no" }, atypia: { present: "yes" } },
    });

    expect(checklistGaps(settled, CHECKLIST), "answered at adequate power = settled").toEqual([]);
    expect(shouldExpand(settled, CHECKLIST, GATE)).toBe(false);
});

test("uncertain counts as a gap, no does not", { tag: ["@unit"] }, () => {
    const hedged = node({ answers: { invasion: { present: "uncertain" }, atypia: { present: "no" } } });

    expect(checklistGaps(hedged, CHECKLIST)).toEqual(["invasion"]);
});

test("a feature already resolved past is not chased further", { tag: ["@unit"] }, () => {
    // Delivered 0.25; the invasion feature only needs 0.5. Drilling for it would spend
    // budget on detail the question does not need.
    const fine = node({ deliveredMpp: 0.25, answers: { invasion: { present: "uncertain" } } });

    expect(checklistGaps(fine, CHECKLIST)).not.toContain("invasion");
});

test("glass is never expanded, however interesting the model found it", { tag: ["@unit"] }, () => {
    // Glass is a statement about how much TISSUE the box holds, not about the shape of its
    // bounding box: a sparse bbox over a real core is not glass, and vetoing on fill is what
    // made prostate cores unreadable. So the veto has to come from `tissueArea`.
    const glass = node({ interest: 0.95, tissueArea: 10 });

    expect(shouldExpand(glass, CHECKLIST, GATE)).toBe(false);
});

test("an errored node is not expanded", { tag: ["@unit"] }, () => {
    const failed = node({ interest: 0.9, error: "driver timed out" });

    expect(shouldExpand(failed, CHECKLIST, GATE)).toBe(false);
});

// ---- priority --------------------------------------------------------------

test("an unscored node still has a usable priority", { tag: ["@unit"] }, () => {
    // A node the walk has not judged must be reachable; a zero would make "never looked"
    // indistinguishable from "looked and found nothing".
    expect(priority(node({ interest: null, cellularity: 0.8 }), ctx())).toBeGreaterThan(0);
});

test("an open question outranks a marginally higher raw interest", { tag: ["@unit"] }, () => {
    const withGap = node({
        id: "gap", interest: 0.55,
        answers: { invasion: { present: "not-assessable" }, atypia: { present: "not-assessable" } },
    });
    const settled = node({
        id: "settled", interest: 0.6, deliveredMpp: 0.25,
        answers: { invasion: { present: "no" }, atypia: { present: "no" } },
    });

    expect(priority(withGap, ctx())).toBeGreaterThan(priority(settled, ctx()));
});

test("one root cannot consume the queue", { tag: ["@unit"] }, () => {
    // THE tunnel-vision test. A strong branch that has already been expanded four times
    // must yield to a fresh region, even one that scored lower.
    const expanded = new Map([["r1", 4]]);
    const strongButMined = node({ id: "a", rootId: "r1", interest: 0.9 });
    const freshElsewhere = node({ id: "b", rootId: "r2", interest: 0.45 });

    const c = ctx({ expandedPerRoot: expanded });
    expect(priority(freshElsewhere, c)).toBeGreaterThan(priority(strongButMined, c));
});

test("a dominant branch still wins while it keeps earning it", { tag: ["@unit"] }, () => {
    // Novelty must be a nudge, not a ban: one prior expansion should not hand the budget
    // to a far weaker region.
    const c = ctx({ expandedPerRoot: new Map([["r1", 1]]) });

    expect(priority(node({ rootId: "r1", interest: 0.9 }), c))
        .toBeGreaterThan(priority(node({ rootId: "r2", interest: 0.2 }), c));
});

test("hedged answers earn less of the budget", { tag: ["@unit"] }, () => {
    const c = ctx();
    expect(priority(node({ confidence: "low" }), c))
        .toBeLessThan(priority(node({ confidence: "high" }), c));
});

test("a box that is mostly background is discounted", { tag: ["@unit"] }, () => {
    const c = ctx();
    expect(priority(node({ bboxFillFraction: 0.02 }), c))
        .toBeLessThan(priority(node({ bboxFillFraction: 0.9 }), c));
});

test("pathPrior weights a node by what its ancestors believed", { tag: ["@unit"] }, () => {
    expect(pathPrior([]), "a root is neutral").toBe(1);
    expect(pathPrior([0.9])).toBeGreaterThan(pathPrior([0.2]));
    expect(pathPrior([0]), "a zeroed ancestor floors rather than annihilates").toBeGreaterThan(0);
});

// ---- queue -----------------------------------------------------------------

test("the queue pops the best node, and re-scores as the run changes", { tag: ["@unit"] }, () => {
    const expanded = new Map();
    const c = ctx({ expandedPerRoot: expanded });
    const q = new PriorityQueue(n => priority(n, c));
    q.pushAll([
        node({ id: "a", rootId: "r1", interest: 0.9 }),
        node({ id: "b", rootId: "r2", interest: 0.6 }),
        node({ id: "c", rootId: "r1", interest: 0.8 }),
    ]);

    expect(q.pop().id, "highest first").toBe("a");

    // r1 has now been expanded; its remaining node must be re-weighed against r2's.
    expanded.set("r1", 5);
    expect(q.pop().id, "a frozen score would still have said 'c'").toBe("b");
    expect(q.pop().id).toBe("c");
    expect(q.pop()).toBeNull();
});

test("the queue reports its size and empties", { tag: ["@unit"] }, () => {
    const q = new PriorityQueue(n => n.interest ?? 0);
    expect(q.size).toBe(0);
    q.push(node());
    expect(q.size).toBe(1);
    q.pop();
    expect(q.size).toBe(0);
});

// ---- the weights are shared with presentation ranking ------------------------------

test("ranking and spending order agree in direction on the same pair of nodes", { tag: ["@unit"] }, () => {
    // These weights are exported because `_rankOverviewNodes` composes them too. They used to
    // be reimplemented there with different constants — `pathPrior` clamping at 0.01 not 0.05,
    // `cellularityWeight` as 0.8 + 0.4x — so the list a reader was shown could contradict the
    // order the budget had actually been spent in, on the same nodes in the same run. One
    // implementation is the fix; this pins that the two consumers cannot disagree in direction.
    const rank = (n, maxArea) => (n.interest ?? -1) * pathPrior(n.ancestorInterests ?? [])
        * confidenceWeight(n.confidence) * areaWeight(n, maxArea)
        * fillWeight(n) * cellularityWeight(n);

    const strong = node({ id: "strong", interest: 0.8, confidence: "high", cellularity: 0.9, bboxFillFraction: 0.5 });
    const weak = node({ id: "weak", interest: 0.3, confidence: "low", cellularity: 0.1, bboxFillFraction: 0.05 });
    const c = ctx();

    expect(rank(strong, 1)).toBeGreaterThan(rank(weak, 1));
    expect(priority(strong, c)).toBeGreaterThan(priority(weak, c));
});

test("a hedged high score and a confident lower one order the same way in both", { tag: ["@unit"] }, () => {
    // The case the divergent constants actually moved: the two scores are close enough that a
    // different confidence or cellularity curve flips them.
    const hedged = node({ id: "hedged", interest: 0.7, confidence: "low", cellularity: 0.2 });
    const sure = node({ id: "sure", interest: 0.5, confidence: "high", cellularity: 0.8 });
    const c = ctx();

    const rankOrder = Math.sign(
        (0.7 * confidenceWeight("low") * cellularityWeight(hedged))
        - (0.5 * confidenceWeight("high") * cellularityWeight(sure)));

    expect(Math.sign(priority(hedged, c) - priority(sure, c)), "same direction, one implementation")
        .toBe(rankOrder);
});

// ---- the gap rule terminates at the ladder's finest rung -------------------------------
//
// From the lung run: a 20x scan at 0.504 µm/px whose derived checklist asked 0.25 for nuclear
// atypia. `f.requiredMpp < deliveredMpp` stayed true at EVERY resolution the slide could
// produce, including its own native, so the gap never closed: `mustResolve` stayed true and
// the walk subdivided until its fields were 63 x 73 µm — small enough that a vision model
// confabulated "nests and cords infiltrating stroma" from a 62 x 72 pixel raster.
//
// `finestMpp` is the ladder's finest rung, and `ladderRungs` floors it at the scan's own
// resolution. This is what consumes that: still open is only a GAP while there is somewhere
// finer to go.

/** The lung slide: 20x, 0.504 µm/px, which is also the ladder's finest rung there. */
const LUNG_FINEST = 0.504;

test("a feature the slide cannot reach stops being a gap at native", { tag: ["@unit"] }, () => {
    const atNative = node({
        deliveredMpp: LUNG_FINEST, finestMpp: LUNG_FINEST,
        answers: { invasion: { present: "no" }, atypia: { present: "not-assessable" } },
    });

    expect(checklistGaps(atNative, CHECKLIST), "0.25 is unreachable — there is nowhere to go")
        .toEqual([]);
});

test("above the finest rung the same feature is still a gap", { tag: ["@unit"] }, () => {
    // The anti-regression half: descent must be untouched while a finer read exists, or the
    // walk stops going deeper and then reports it could not judge.
    const coarse = node({
        deliveredMpp: 2.0, finestMpp: LUNG_FINEST,
        answers: { invasion: { present: "uncertain" }, atypia: { present: "not-assessable" } },
    });

    expect(checklistGaps(coarse, CHECKLIST).sort()).toEqual(["atypia", "invasion"]);
});

test("without finestMpp the gap rule is unchanged", { tag: ["@unit"] }, () => {
    // An uncalibrated slide has no rung to compare against, and closing the gate on an
    // unknown would stop a walk that has not started.
    const unknown = node({
        deliveredMpp: LUNG_FINEST,
        answers: { atypia: { present: "not-assessable" } },
    });

    expect(checklistGaps(unknown, CHECKLIST)).toContain("atypia");
});
