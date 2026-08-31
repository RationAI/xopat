/**
 * The evidence table: one row per question asked, with what was found and where.
 *
 * ## What this replaces
 *
 * The walk's summary used to be the FIRST SENTENCE of the top five nodes, glued together
 * locally. Every node's remaining text was discarded, so a detail the vision model did
 * report — the one the reviewer asked about — routinely never reached the answer. Worse,
 * a region that could not be judged looked identical to a region that was judged and
 * found unremarkable, because prose has no field for "I could not tell".
 *
 * A table keyed by the checklist inverts that. The question is the row; the regions are
 * the citations; "nobody could see it" is a value rather than an absence. The consuming
 * agent writes prose from this, so nothing has to be truncated to fit a summary.
 */

import type { Checklist, FeatureAnswer } from "./checklist";
import { exceedsSlide } from "./checklist";
import type { Bounds } from "./types";

/** The minimum a node must expose to appear in the table. */
export interface EvidenceNode {
    label: string;
    bounds: Bounds;
    answers?: Record<string, FeatureAnswer>;
    rankScore?: number;
    deliveredMpp?: number | null;
    error?: string;
}

export interface EvidenceCitation {
    label: string;
    bounds: Bounds;
    /** The model's own words for this feature in this region, when it gave any. */
    answer: string | null;
    confidence: FeatureAnswer["confidence"];
    /** The resolution that answer was formed at — the reader's basis for weighing it. */
    deliveredMpp: number | null;
}

export interface EvidenceRow {
    id: string;
    label: string;
    question: string;
    requiredMpp: number;
    /** Aggregate across every region that answered. See the polarity note below. */
    verdict: FeatureAnswer["present"];
    counts: { yes: number; no: number; uncertain: number; notAssessable: number };
    /** Best-ranked regions supporting the verdict — what to cite and where to link. */
    citedBy: EvidenceCitation[];
    /**
     * True when NO region ever reached this feature's required resolution. The verdict is
     * then `not-assessable` and means "the run never got close enough", which is an
     * invitation to look closer — never a negative finding.
     *
     * NOT set when the reason is {@link exceedsSlide}: "look closer" is not advice when
     * there is nothing closer to look at, and a row that can never clear it makes every
     * run of that slide report itself unexamined forever. That case is
     * {@link beyondSlide} instead.
     */
    underResolved: boolean;
    /**
     * True when this feature asks for finer detail than the SCAN holds.
     *
     * A fact about the slide, not about the walk — no amount of further reading changes it,
     * so it is reported once and separately. The feature is still asked at the slide's limit
     * (see `splitByResolution`), so this row can carry real answers; what it must not carry
     * is the implication that a closer read is available.
     */
    beyondSlide: boolean;
}

const MAX_CITATIONS = 5;

/**
 * Aggregate per-region answers into one row per checklist feature.
 *
 * **The polarity is deliberately asymmetric**: any `yes` makes the row `yes`, then any
 * `uncertain`, then `no`, and only an entirely unanswered feature is `not-assessable`.
 *
 * A slide is not homogeneous. One field showing a feature is evidence it is present
 * somewhere; a hundred fields not showing it is not evidence it is absent everywhere,
 * because the walk only ever samples part of the tissue. Averaging would let breadth
 * bury a focal finding — which, on a slide, is usually the finding that matters.
 */
export function buildEvidence(
    nodes: EvidenceNode[],
    checklist: Checklist,
    /** The slide's own calibration, so a requirement finer than the scan is told apart from
     *  a walk that stopped short. Omit on an uncalibrated slide. */
    nativeMpp?: number | null
): EvidenceRow[] {
    const usable = nodes.filter(n => n && n.answers && n.bounds && !n.error);

    return checklist.features.map(feature => {
        const beyondSlide = exceedsSlide(feature, nativeMpp);
        const counts = { yes: 0, no: 0, uncertain: 0, notAssessable: 0 };
        const citations: Array<EvidenceCitation & { present: FeatureAnswer["present"]; rank: number }> = [];
        let reachedResolution = false;

        for (const node of usable) {
            const answer = node.answers![feature.id];
            if (!answer) continue;
            switch (answer.present) {
                case "yes": counts.yes++; break;
                case "no": counts.no++; break;
                case "uncertain": counts.uncertain++; break;
                default: counts.notAssessable++;
            }
            // "Reached" is about the IMAGE, not the answer. A confident `no` at adequate
            // power is a real negative, and a model that looked at an adequate image and
            // still could not tell is not the walk's failure to get close enough. Only the
            // planner's own "this field was too coarse for that feature" counts against it.
            if (!(answer.present === "not-assessable" && answer.reason === "resolution")) {
                reachedResolution = true;
            }
            citations.push({
                label: node.label,
                bounds: node.bounds,
                answer: answer.answer,
                confidence: answer.confidence,
                deliveredMpp: node.deliveredMpp ?? null,
                present: answer.present,
                rank: node.rankScore ?? -1,
            });
        }

        const verdict: FeatureAnswer["present"] =
            counts.yes ? "yes"
                : counts.uncertain ? "uncertain"
                    : counts.no ? "no"
                        : "not-assessable";

        // Cite the regions that carry the verdict, not merely the best-ranked ones: a row
        // that concluded "yes" and then linked five regions that said "no" would be worse
        // than useless to a reader checking it.
        const supporting = citations.filter(c => c.present === verdict);
        const pool = supporting.length ? supporting : citations;

        return {
            id: feature.id,
            label: feature.label,
            question: feature.question,
            requiredMpp: feature.requiredMpp,
            verdict,
            counts,
            citedBy: pool
                .sort((a, b) => b.rank - a.rank)
                .slice(0, MAX_CITATIONS)
                .map(({ present, rank, ...citation }) => citation),
            // "The run never got close enough" is only true while closer exists.
            underResolved: !reachedResolution && !beyondSlide,
            beyondSlide,
        };
    });
}

/**
 * A one-line-per-row rendering, so a caller expecting a string still receives one.
 *
 * A convenience, explicitly not the source of truth: the table is. `render` is supplied by
 * the caller because every user-facing word belongs in a locale file, not here.
 */
export function renderEvidence(
    rows: EvidenceRow[],
    render: (row: EvidenceRow) => string
): string {
    return rows.map(render).filter(Boolean).join("\n");
}
