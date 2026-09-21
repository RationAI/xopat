/**
 * How closely a walk will read, expressed as a list of resolutions.
 *
 * A walk descends one rung per depth level: a node reads its box at the finest µm/px that
 * box affords, and its children read the same tissue at the next rung down. The ladder is
 * therefore not a display detail — it is the entire statement of how much detail the run
 * can ever see, and `maxDepth` is derived from its length rather than chosen.
 *
 * This file exists because that statement was being made by the wrong thing. The rungs were
 * taken from the checklist's `requiredMpp` values, and when checklist derivation failed the
 * GENERIC placeholder checklist's values were used verbatim — 1 and 2 µm/px — producing a
 * two-rung ladder capped at architecture resolution. Every field on a 40x scan then came
 * back "the resolution is too low to judge cells", which was true, and was caused entirely
 * here. A placeholder must not decide how closely a slide is read.
 *
 * Pure: no viewer, no calibration lookup, no i18n. Just the rung arithmetic. The one import
 * is type-only, so it is erased at build time and that purity is unaffected.
 */

import type { Checklist } from "./checklist";

/**
 * Where a checklist came from; only `fallback` means "nobody stated a requirement".
 *
 * Taken from the Checklist itself rather than restated: the `fallback` branch below turns on
 * this value matching, and a second copy of the union would let the two drift apart silently.
 */
export type ChecklistOrigin = Checklist["source"];

export interface LadderRequest {
    /**
     * The resolutions the checklist's features need, in any order. Empty or absent when
     * there is no checklist.
     */
    requiredMpp?: readonly number[] | null;
    /** Where those figures came from. A `fallback` checklist states no real requirement. */
    source?: ChecklistOrigin | null;
    /** µm/px the orientation pass delivered. The ladder starts at or below it. */
    surveyMpp: number;
    /** The resolutions to use when the checklist does not state any, coarsest first. */
    defaultLadder: readonly number[];
    /**
     * The slide's own calibration — level 0, the finest sampling that EXISTS. Rungs are
     * floored at it.
     *
     * A rung is a render target, and a target finer than level 0 cannot be rendered: the
     * planner floors the downsample at 1 and hands back native anyway. Carrying the finer
     * figure as a rung therefore bought nothing and cost three things — an extra
     * `maxDepth` level derived from the ladder's length, a `finestMpp` no field could ever
     * match (so the drill gate never closed and the walk subdivided until its fields were
     * ~60 µm across), and a resolution quoted in prompts that the image did not have.
     *
     * This floors the TARGETS only. What a checklist feature says it needs is left
     * untouched wherever it is stated; see {@link Checklist} and `exceedsSlide`.
     *
     * Omit on an uncalibrated slide (or pass null): the rungs are then used as given.
     */
    nativeMpp?: number | null;
}

/**
 * The rungs a run will descend, coarsest first, deduplicated.
 *
 * Two cases, and the distinction between them is the whole point:
 *
 * - a checklist somebody actually WROTE (`explicit`/`derived`) states the resolutions its
 *   questions need, so those are the rungs — plus a coarse orientation rung when the survey
 *   was coarser than the coarsest feature. Going finer than the finest requirement would be
 *   budget spent on detail nothing in the run asks about;
 * - anything else (no checklist, or the generic fallback) has no stated requirement, so the
 *   default ladder applies — minus any rung coarser than the survey already delivered, which
 *   would have nothing to add. A scoped run whose survey is already fine starts partway down.
 *
 * Never empty: a run with no rung to aim at has no way to look closer at anything.
 */
export function ladderRungs(req: LadderRequest): number[] {
    // Floor every candidate at what the scan actually holds. Applied to the INPUTS rather
    // than the result so `dedupe` collapses the rungs that land on native together — two
    // features asking for 0.25 and 0.4 on a 0.504 slide describe one reachable rung, not
    // two, and two identical rungs would add a depth level that reads the same pixels twice.
    const floor = req.nativeMpp && req.nativeMpp > 0 ? req.nativeMpp : 0;
    const reachable = (v: number) => Math.max(v, floor);

    const usable = (req.requiredMpp ?? [])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
        .map(reachable);
    const fallback = [...req.defaultLadder]
        .filter(v => typeof v === "number" && Number.isFinite(v) && v > 0)
        .map(reachable);

    if (usable.length && req.source !== "fallback") {
        const needed = [...new Set(usable)].sort((a, b) => b - a);
        return dedupe([Math.max(needed[0], req.surveyMpp), ...needed]);
    }

    if (!fallback.length) return [reachable(req.surveyMpp)];
    const finerThanSurvey = fallback.filter(v => v < req.surveyMpp);
    // Everything the default ladder offers is coarser than what the survey already read —
    // take its finest rung anyway, or the walk has nowhere to descend to at all.
    return dedupe(finerThanSurvey.length ? finerThanSurvey : [Math.min(...fallback)]);
}

/** Sorted coarsest-first, with adjacent duplicates removed. */
function dedupe(rungs: number[]): number[] {
    return [...rungs]
        .sort((a, b) => b - a)
        .filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
}
