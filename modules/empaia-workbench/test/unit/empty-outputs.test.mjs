/**
 * When "this analysis produced nothing" may be believed.
 *
 * The regression: EMPAIA tutorial app TA06 (`my_cells: collection<collection<point>>`)
 * ran for 47 s over two ROIs and wrote **24 690** points. The workbench flipped
 * `status` to COMPLETED before any of them were queryable, xOpat read once in
 * the same microtask as that poll, got an empty list, and recorded "produced
 * nothing" in two caches that nothing invalidates. The panel showed `my_cells: 0`
 * for the rest of the session, and the retry button could not clear it.
 *
 * One read is not evidence. This file is the bound on how much doubt is allowed
 * before it becomes evidence — because `_emptyJobs` still has to stop an endless
 * re-query of a run that genuinely wrote nothing.
 */
import { test, expect } from "@xopat/test-harness";

const {
    isEmptyResultConclusive, shouldKeepWaiting,
    DEFAULT_EMPTY_OUTPUT_RETRIES, DEFAULT_EMPTY_OUTPUT_WINDOW_MS,
} = await import("../../visibility.ts");

const NOW = 1_700_000_000_000;
const wait = (attempts, ageMs = 0) => ({ attempts, since: NOW - ageMs });
const budget = (over = {}) => ({ now: NOW, ...over });

// ── the cheap case stays cheap ──────────────────────────────────────────────

test("an app that promised no shapes is conclusive on the first read", () => {
    // TA01 produces one integer. An empty annotation list is the answer, not a
    // symptom — retrying it would be pure waste, and this is what keeps
    // `_emptyJobs` doing the job it was written for.
    expect(isEmptyResultConclusive({ terminal: true })).toBe(true);
    expect(isEmptyResultConclusive({ terminal: true, expectsAnnotations: false })).toBe(true);
});

// ── the TA06 case ───────────────────────────────────────────────────────────

test("a promised output that came back empty is not believed on read 1", () => {
    expect(isEmptyResultConclusive({
        terminal: true, expectsAnnotations: true, wait: wait(1), budget: budget(),
    })).toBe(false);
});

test("…but it is believed once the attempts run out", () => {
    // Convergence. Without this the module re-queries a genuinely empty run for
    // the life of the tab, which is the failure `_emptyJobs` exists to prevent.
    expect(isEmptyResultConclusive({
        terminal: true, expectsAnnotations: true,
        wait: wait(DEFAULT_EMPTY_OUTPUT_RETRIES), budget: budget(),
    })).toBe(true);
});

test("…and once the window closes, however few attempts were spent", () => {
    // The poll backoff reaches 30 s, so a deployment with a long `jobPollMs`
    // could sit at attempt 2 forever. Both axes bound the wait; either ends it.
    expect(isEmptyResultConclusive({
        terminal: true, expectsAnnotations: true,
        wait: wait(1, DEFAULT_EMPTY_OUTPUT_WINDOW_MS), budget: budget(),
    })).toBe(true);
});

// ── validation outranks the budget ──────────────────────────────────────────

test("validation still running is inconclusive even with the budget spent", () => {
    expect(isEmptyResultConclusive({
        terminal: true, outputValidation: "RUNNING",
        expectsAnnotations: true, wait: wait(99), budget: budget(),
    })).toBe(false);
    // It does not even need the promise: the workbench itself says it has not
    // finished checking what was written.
    expect(isEmptyResultConclusive({ terminal: true, outputValidation: "RUNNING" })).toBe(false);
});

test("every other validation state falls through to the retry budget", () => {
    // The fix must be correct in a deployment where output validation never runs
    // at all — there, only the bounded retry helps, so none of these may block.
    for (const outputValidation of ["NONE", "COMPLETED", "ERROR", "FAILED", undefined, null, ""]) {
        expect(isEmptyResultConclusive({ terminal: true, outputValidation })).toBe(true);
        expect(isEmptyResultConclusive({
            terminal: true, outputValidation,
            expectsAnnotations: true, wait: wait(1), budget: budget(),
        })).toBe(false);
    }
});

// ── the two older invariants, under the wider signature ─────────────────────

test("a failed query and an unfinished job still dominate everything", () => {
    expect(isEmptyResultConclusive({
        terminal: true, failed: true, expectsAnnotations: false,
    })).toBe(false);
    expect(isEmptyResultConclusive({
        terminal: false, expectsAnnotations: false,
    })).toBe(false);
});

// ── the bound itself ────────────────────────────────────────────────────────

test("shouldKeepWaiting is bounded on attempts and on wall clock", () => {
    expect(shouldKeepWaiting(undefined, budget())).toBe(false);

    expect(shouldKeepWaiting(wait(4), budget({ maxAttempts: 5 }))).toBe(true);
    expect(shouldKeepWaiting(wait(5), budget({ maxAttempts: 5 }))).toBe(false);
    expect(shouldKeepWaiting(wait(6), budget({ maxAttempts: 5 }))).toBe(false);

    expect(shouldKeepWaiting(wait(1, 59_999), budget({ windowMs: 60_000 }))).toBe(true);
    expect(shouldKeepWaiting(wait(1, 60_000), budget({ windowMs: 60_000 }))).toBe(false);
});
