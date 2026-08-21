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
