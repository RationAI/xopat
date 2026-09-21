/**
 * Costing a walk before running it: what the caller may strike off, and what is worth
 * telling them about before they commit.
 *
 * ## Why a plan exists at all
 *
 * The expensive half of an overview is the vision walk — minutes of slow model calls. The
 * half before it (one survey render, the tissue mask, the density prior, the checklist, the
 * ladder) is cheap and already cached. Until now the two were one call, so the only way to
 * find out what a scan would cover was to pay for it.
 *
 * Splitting at that seam gives the caller — usually an assistant acting for a pathologist —
 * the region list and the questions BEFORE the spend, and a way to drop what is not worth
 * reading. This file is the pure part of that: no viewer, no async, no render.
 */

import type { Bounds } from "./types";
import { boundsIoU } from "./geometry";

/** Overlapping pairs reported by a plan. Bounded because a fragmented slide produces O(n²). */
export const MAX_REPORTED_OVERLAP_PAIRS = 10;

/** What a caller may strike off a plan before running it. */
export interface PlanEdits {
    /** Region labels to skip. */
    drop?: string[];
    /** Region labels to keep, to the exclusion of everything else. */
    only?: string[];
}

/** The minimum a region must expose to be planned over. */
export interface PlannableRegion {
    label: string;
    bounds: Bounds;
}

/**
 * The regions a plan runs after the caller's edits.
 *
 * Addressed by LABEL, never by index. The label is the region's identity everywhere the
 * user and the assistant see it ("region 2"), while an index is an array internal that
 * shifts the moment anything renumbers — which region merging does. An unknown label is
 * ignored rather than fatal: striking a region that no longer exists means the same thing
 * either way, and failing the whole run over it would throw away a paid-for survey.
 */
export function applyPlanEdits<T extends PlannableRegion>(regions: T[], edits?: PlanEdits): T[] {
    const only = edits?.only?.length ? new Set(edits.only) : null;
    const drop = edits?.drop?.length ? new Set(edits.drop) : null;
    if (!only && !drop) return regions.slice();
    return regions.filter(r => (!only || only.has(r.label)) && (!drop || !drop.has(r.label)));
}

/**
 * Region pairs that still share a meaningful part of their box, worst first.
 *
 * Reported rather than silently resolved. Boxes that ARE the same box have already been
 * merged (see `mergeOverlappingBounds`); what survives is genuine partial overlap, which is
 * a judgement about whether two boxes are one piece of tissue — better made by the caller
 * looking at the slide than by a threshold.
 */
export function overlapPairs(
    regions: PlannableRegion[],
    max = MAX_REPORTED_OVERLAP_PAIRS
): Array<{ a: string; b: string; iou: number }> {
    const pairs: Array<{ a: string; b: string; iou: number }> = [];
    for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
            const iou = boundsIoU(regions[i].bounds, regions[j].bounds);
            if (iou > 0) pairs.push({ a: regions[i].label, b: regions[j].label, iou });
        }
    }
    return pairs.sort((x, y) => y.iou - x.iou).slice(0, Math.max(0, max));
}
