/**
 * The rule deciding whether a region an analysis consumed stays on screen.
 *
 * Separate from the module so it is a pure function of three facts — who locked
 * the region, which analyses are shown, which are still running — rather than of
 * the module's whole state. That is what makes it testable, and this rule is
 * worth testing: it decides when the user's own drawing disappears, and getting
 * it wrong in either direction is a bug they will report ("my region vanished" /
 * "the slide is a forest of boxes I cannot delete").
 */

import { isJobValidationPending } from "./types";

/** How the caller answers the two questions the rule asks about a job. */
export interface RegionVisibilityContext {
    /** Is this analysis' output currently shown? */
    isShown(jobId: string): boolean;
    /** Has this analysis not reached a final state yet? */
    isRunning(jobId: string): boolean;
}

/**
 * Should a region locked by `lockingJobs` be on screen?
 *
 * @param lockingJobs analyses that have consumed this region; empty/undefined
 *   means it is nobody's input — live work, always shown. The empty-string id
 *   means "locked, holder unknown" (learned from a backend refusal): no
 *   visibility decision can honour it, so the region stays.
 */
export function regionStaysVisible(
    lockingJobs: Iterable<string> | undefined,
    ctx: RegionVisibilityContext
): boolean {
    if (!lockingJobs) return true;

    let attributable = false;
    for (const jobId of lockingJobs) {
        if (!jobId) return true;
        attributable = true;
        // A run in flight has no result to show yet, so it is not in the shown
        // set — but taking the region away the moment the user submits it is the
        // opposite of feedback.
        if (ctx.isRunning(jobId) || ctx.isShown(jobId)) return true;
    }
    return !attributable;
}

/**
 * Is "this analysis produced no annotations" a fact, or only what we saw so far?
 *
 * The module remembers empty results (`_emptyJobs`) so a job that genuinely wrote
 * nothing is not re-queried on every reconcile. That memory is never revisited, so
 * recording the wrong thing is permanent for the session — and there are two ways
 * to see an empty list that mean nothing of the kind:
 *
 *  - the job had not finished, so of course it had produced nothing yet;
 *  - the query failed, and every failure in this path returns `[]` (see
 *    `JobResults.failed`).
 *
 * Both used to be recorded as "produced nothing", after which the self-healing
 * re-import was suppressed and only a page reload brought the result back.
 *
 * Two more, added after TA06 finished with 24 690 points and reported zero:
 *
 *  - the workbench is still *validating* what the app wrote, so nothing it has
 *    not finished writing can be read back yet;
 *  - the app declared an annotation output, the workbench named a container for
 *    it, and the read returned nothing — which for a run that has just this
 *    instant flipped to COMPLETED is a race, not an answer.
 *
 * The last one is bounded (see {@link shouldKeepWaiting}), because `_emptyJobs`
 * exists to stop an endless re-query and must keep doing that. `expectsAnnotations`
 * is what preserves it cheaply: an app that declares no annotation output at all
 * (TA01 — one integer) is conclusive on the first read, with no extra queries.
 */
export interface EmptyResultFacts {
    failed?: boolean;
    terminal: boolean;
    /** `job.output_validation_status`, verbatim off the wire. */
    outputValidation?: string | null;
    /**
     * Does this job PROMISE annotations — an EAD output of kind `"annotation"`
     * for which `job.outputs[key]` names a real container? Without the promise,
     * an empty list is the answer rather than a symptom, and nothing is retried.
     */
    expectsAnnotations?: boolean;
    /** The wait so far; absent means this is the first empty read. */
    wait?: OutputWait;
    budget?: OutputWaitBudget;
}

export function isEmptyResultConclusive(f: EmptyResultFacts): boolean {
    if (f.failed) return false;
    if (!f.terminal) return false;
    // The workbench is still checking what the app wrote. Nothing it has not
    // finished writing is queryable yet, so an empty list says nothing.
    if (isJobValidationPending(f.outputValidation)) return false;
    // The app promised shapes and none came back. ONE read, fired in the same
    // microtask as the poll that first saw COMPLETED, is not evidence: TA06
    // writes ~25 000 points and the workbench flips `status` before any of them
    // are queryable. Bounded, so a run that genuinely wrote nothing is still
    // accepted — within `budget`, and then permanently.
    if (f.expectsAnnotations && shouldKeepWaiting(f.wait, f.budget)) return false;
    return true;
}

// ── waiting for an output that has not appeared yet ─────────────────────────

/** Re-reads allowed after a job settles empty, and the wall-clock window for them. */
export const DEFAULT_EMPTY_OUTPUT_RETRIES = 5;
export const DEFAULT_EMPTY_OUTPUT_WINDOW_MS = 60_000;

/** What the module remembers about a job whose output has not appeared yet. */
export interface OutputWait {
    /** Reads taken so far — this is what the attempt budget bounds. */
    attempts: number;
    /** `Date.now()` of the first empty read. */
    since: number;
}

export interface OutputWaitBudget {
    maxAttempts?: number;
    windowMs?: number;
    /** Injectable clock, so the window is testable without waiting a minute. */
    now?: number;
}

/**
 * Is there still a reason to re-read?
 *
 * Converges on **both** axes, and either exhausting ends the wait: a fast tick
 * stream cannot burn more than `maxAttempts` queries, and a slow one — the poll
 * backoff reaches 30 s — cannot keep a "waiting" chip on screen past `windowMs`.
 * A policy bounded on only one of them fails on the other deployment.
 */
export function shouldKeepWaiting(wait: OutputWait | undefined, budget: OutputWaitBudget = {}): boolean {
    if (!wait) return false;
    const now = budget.now ?? Date.now();
    return wait.attempts < (budget.maxAttempts ?? DEFAULT_EMPTY_OUTPUT_RETRIES)
        && (now - wait.since) < (budget.windowMs ?? DEFAULT_EMPTY_OUTPUT_WINDOW_MS);
}

// ── which analyses are painted on the slide ─────────────────────────────────

/** Everything the "what should be shown now" rule needs, and nothing else. */
export interface VisibleJobsInput {
    /** Ids shown before this poll. */
    current: Iterable<string>;
    /** Ids the poll still reports; anything else has been deleted upstream. */
    live: Iterable<string>;
    /** Has the user chosen what to show on this slide? */
    userOwned: boolean;
    /** Newest analysis with a result, or undefined when none has finished. */
    latestCompletedId?: string;
    /** Analyses that finished during this session and are not shown yet. */
    arrivedIds?: Iterable<string>;
    /** Most analyses that may be painted at once. */
    limit: number;
    /** Sort key for eviction — completion time, oldest evicted first. */
    orderOf?: (id: string) => number;
}

/**
 * The set of analyses that should be on the slide after a poll.
 *
 * Three rules, in order, and the third is the one worth stating:
 *
 * 1. An analysis the poll no longer reports stops being shown.
 * 2. **While the user has not chosen**, the newest finished analysis is the one
 *    shown — replacing whatever was there.
 * 3. **An arrival is shown whether they have chosen or not.** Picking an older
 *    analysis from the history marks the slide user-owned, which used to switch
 *    rule 2 off for good — so a run started afterwards finished with nothing on
 *    the canvas acknowledging it. An arrival is *added* rather than replacing,
 *    so a comparison the user assembled survives the new result joining it.
 *
 * Over the limit, the oldest non-arrival is dropped: every shown analysis
 * imports its output onto the canvas, and an arrival is the one thing the user
 * is actively waiting to see.
 */
export function resolveVisibleJobs(input: VisibleJobsInput): Set<string> {
    const live = new Set(input.live);
    const next = new Set([...input.current].filter(id => live.has(id)));

    if (!input.userOwned && input.latestCompletedId) {
        // Nothing finished yet leaves the slide alone rather than blanking what a
        // previous poll legitimately showed.
        next.clear();
        next.add(input.latestCompletedId);
    }

    const arrived = new Set([...(input.arrivedIds ?? [])].filter(id => live.has(id)));
    for (const id of arrived) next.add(id);

    if (next.size <= input.limit) return next;

    const orderOf = input.orderOf ?? (() => 0);
    const droppable = [...next]
        .filter(id => !arrived.has(id))
        .sort((a, b) => orderOf(a) - orderOf(b));
    for (const id of droppable) {
        if (next.size <= input.limit) break;
        next.delete(id);
    }
    return next;
}
