/**
 * A budget is a checkpoint, not a verdict.
 *
 * An overview walk stops when its calls run out, having described real tissue and left a plan for
 * the rest. Before `refineOverview` the only way to act on "keep going" was to build again — which
 * re-surveys the slide and pays a second time for every region already read, to arrive back where
 * the user already was.
 *
 * Resuming is the same traversal called again with a fresh budget and the frontier rebuilt from
 * the cached tree. What is tested here is the arithmetic that makes that honest: a continuation
 * spends everything on depth, and the figures it publishes describe the whole examination rather
 * than the last increment.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    createBudget, rolloverSurveyBudget, accumulateBudget, shouldExpand, canSpend, spend,
} = await loadLib("scheduler");

test.afterAll(() => cleanupLib());

const CHECKLIST = {
    source: "derived",
    features: [
        { id: "invasion", label: "Invasion", question: "?", requiredMpp: 0.5, weight: 1 },
        { id: "grade", label: "Grade", question: "?", requiredMpp: 0.25, weight: 0.8 },
    ],
};
const GATE = { interestThreshold: 0.5, minDrillTissue: 0 };

const node = (over = {}) => ({
    id: "region 1", rootId: "r0", rung: 1,
    interest: 0.6, cellularity: 0.2,
    bboxFillFraction: 0.4, tissueArea: 5e6,
    slideAreaFraction: 0.05, deliveredMpp: 1.0,
    answers: {}, ancestorInterests: [],
    ...over,
});

// ---- the continuation's budget ------------------------------------------------------

test("a refinement spends everything on depth, reserving nothing for a survey", { tag: ["@unit"] }, () => {
    // Phase A is not re-run — the survey is cached and the roots are described — so a reserved
    // survey account would be calls the continuation can never touch.
    const budget = createBudget(20, 0);
    rolloverSurveyBudget(budget);

    expect(budget.focusBudget, "all twenty available to the frontier").toBe(20);
    expect(budget.surveyBudget).toBe(0);
    expect(canSpend(budget, "survey")).toBe(false);
    expect(canSpend(budget, "focus")).toBe(true);
});

test("a first walk still reserves its coverage account", { tag: ["@unit"] }, () => {
    // The refinement's zero must not have become the default: coverage-paid-for-first is the
    // guarantee the reserved account exists to make.
    const budget = createBudget(28, 0.35);
    expect(budget.surveyBudget).toBe(10);
    expect(budget.focusBudget).toBe(18);
});

// ---- what a continued run reports ---------------------------------------------------

test("continuing reports the whole examination, not the last increment", { tag: ["@unit"] }, () => {
    const first = createBudget(28, 0.35);
    for (let i = 0; i < 10; i++) spend(first, "survey");
    for (let i = 0; i < 18; i++) spend(first, "focus");
    first.nodesVisited = 28;
    first.truncated = true;

    const second = createBudget(20, 0);
    rolloverSurveyBudget(second);
    for (let i = 0; i < 12; i++) spend(second, "focus");
    second.nodesVisited = 12;
    second.truncated = false;

    const total = accumulateBudget(first, second);

    // "What did this examination cost?" is a question about the examination.
    expect(total.analyzeCalls, "28 + 12").toBe(40);
    expect(total.nodesVisited).toBe(40);
    expect(total.focusCalls).toBe(30);
    expect(total.refinements).toBe(1);
    // A tree that was truncated and then finished is no longer truncated: the latest run decides.
    expect(total.truncated).toBe(false);
});

test("a second refinement keeps counting", { tag: ["@unit"] }, () => {
    let total = createBudget(28, 0.35);
    for (let i = 0; i < 5; i++) spend(total, "focus");

    for (const calls of [10, 10]) {
        const run = createBudget(calls, 0);
        rolloverSurveyBudget(run);
        for (let i = 0; i < calls; i++) spend(run, "focus");
        total = accumulateBudget(total, run);
    }

    expect(total.refinements).toBe(2);
    expect(total.analyzeCalls).toBe(25);
});

test("state fields describe now, not the sum of every run", { tag: ["@unit"] }, () => {
    // `focusUnspent` and `plannedNotRead` say where the tree STANDS. Summing them would report a
    // shortfall that a later run already cleared.
    const first = createBudget(28, 0.35);
    first.focusUnspent = 18;
    first.plannedNotRead = 11;

    const second = createBudget(20, 0);
    rolloverSurveyBudget(second);
    second.focusUnspent = 0;
    second.plannedNotRead = 0;

    const total = accumulateBudget(first, second);
    expect(total.focusUnspent, "the frontier was drained; say so").toBe(0);
    expect(total.plannedNotRead).toBe(0);
});

// ---- which nodes come back to the frontier ------------------------------------------

test("a node holding planned-but-unread fields is expandable regardless of its answers", { tag: ["@unit"] }, () => {
    // This is what a refinement picks up first: the planning decision was already made and paid
    // for, so there is nothing left to justify.
    const settled = {
        invasion: { id: "invasion", present: "yes" },
        grade: { id: "grade", present: "no" },
    };
    const stalled = node({ answers: settled, interest: 0.1, pendingTiles: 7 });
    expect(shouldExpand(stalled, CHECKLIST, GATE)).toBe(true);

    // ...and the same node without them is done: settled questions, no interest, nothing to do.
    expect(shouldExpand({ ...stalled, pendingTiles: 0 }, CHECKLIST, GATE)).toBe(false);
});

test("raising maxDepth is what re-opens a leaf, not re-queuing it", { tag: ["@unit"] }, () => {
    // The frontier is a candidate set; the depth cap is enforced by the traversal. A node at the
    // old cap is still expandable on its own merits — which is precisely why refineOverview must
    // pass a raised maxDepth rather than expecting the queue to know.
    const deep = node({ rung: 2, answers: { invasion: { id: "invasion", present: "uncertain" } } });
    expect(shouldExpand(deep, CHECKLIST, GATE), "an open question keeps it a candidate").toBe(true);
});

test("a node that failed to render never returns to the frontier", { tag: ["@unit"] }, () => {
    expect(shouldExpand(node({ error: "render timed out", pendingTiles: 5 }), CHECKLIST, GATE)).toBe(false);
});

test("re-focusing with a new checklist re-opens settled nodes", { tag: ["@unit"] }, () => {
    // `refineOverview({query})` derives a new checklist, and the frontier is re-scored against it:
    // a node that answered every OLD question has not answered the new one.
    const answered = node({
        interest: 0.1,
        answers: { invasion: { id: "invasion", present: "yes" }, grade: { id: "grade", present: "no" } },
    });
    expect(shouldExpand(answered, CHECKLIST, GATE), "nothing left to ask").toBe(false);

    const newQuestion = {
        source: "derived",
        features: [{ id: "pni", label: "Perineural invasion", question: "?", requiredMpp: 0.5, weight: 1 }],
    };
    expect(shouldExpand(answered, newQuestion, GATE), "a new question is a reason to look again").toBe(true);
});

// ---- stopping early is the good outcome, and has to be sayable ----------------------

/**
 * `_expandFrontier`'s exit condition, in the arithmetic it is made of.
 *
 * Every gate in that loop `continue`s WITHOUT re-queueing, so the frontier strictly drains and
 * an empty queue with budget in hand means "nothing left worth reading". The traversal itself
 * needs a viewer; the decision does not, and this is the part that was getting reported wrong.
 */
const converged = (queueSize, budget, maxNodes, aborted = false) =>
    !aborted && queueSize === 0 && canSpend(budget, "focus") && budget.nodesVisited < maxNodes;

test("a drained frontier with budget in hand is convergence, not truncation", { tag: ["@unit"] }, () => {
    // The run this exists for: 12 calls of 28, every remaining node settled or glass. Before the
    // flag it was indistinguishable from a stall and got reported as an incomplete examination.
    const b = createBudget(28, 0.35);
    rolloverSurveyBudget(b);
    for (let i = 0; i < 12; i++) { spend(b, "focus"); b.nodesVisited++; }

    expect(canSpend(b, "focus"), "calls were still available").toBe(true);
    expect(converged(0, b, 36), "and there was nothing left to spend them on").toBe(true);
    expect(b.truncated, "a cap never bit").toBe(false);
});

test("hitting the node cap is truncation, never convergence", { tag: ["@unit"] }, () => {
    const b = createBudget(60, 0.35);
    rolloverSurveyBudget(b);
    b.nodesVisited = 36;

    expect(canSpend(b, "focus"), "budget was not the binding constraint").toBe(true);
    expect(converged(4, b, 36), "a non-empty queue alone rules it out").toBe(false);
    expect(converged(0, b, 36), "and so does the cap, even on an empty queue").toBe(false);
});

test("a cancelled walk is not a converged one", { tag: ["@unit"] }, () => {
    // The user stopping a walk says nothing about whether the tissue was exhausted, and reporting
    // a cancellation as a complete examination is the one reading that must not happen.
    const b = createBudget(28, 0.35);
    rolloverSurveyBudget(b);

    expect(converged(0, b, 36, true)).toBe(false);
});

test("a fresh budget carries converged: false", { tag: ["@unit"] }, () => {
    // It is a conclusion the traversal reaches, never an assumption it starts from.
    expect(createBudget(28, 0.35).converged).toBe(false);
});

test("continuing a tree adopts the latest run's verdict on both flags", { tag: ["@unit"] }, () => {
    // A tree truncated once and then continued to exhaustion has converged; the reverse also
    // holds. Both are STATE about where the tree stands now, not sums over its history.
    const first = { ...createBudget(28, 0.35), truncated: true, converged: false, nodesVisited: 20 };
    const second = { ...createBudget(20, 0.35), truncated: false, converged: true, nodesVisited: 6 };
    const total = accumulateBudget(first, second);

    expect(total.converged, "the continuation drained the frontier").toBe(true);
    expect(total.truncated).toBe(false);
    expect(total.nodesVisited, "cost is still cumulative").toBe(26);
});
