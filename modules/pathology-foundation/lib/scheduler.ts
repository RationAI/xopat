/**
 * How a walk decides what to look at next, and what it is allowed to spend doing it.
 *
 * ## The failure this replaces
 *
 * The walk was depth-first over the top few tissue islands with ONE budget shared by the
 * whole run. Root 1 was explored to exhaustion; roots 2..4 were frequently never visited
 * at all, because the budget ran out inside the first branch. Combined with keeping only
 * 4 of 9 grid children per level, roughly a fifth of the tissue ever reached the finest
 * rung — and which fifth was decided by nothing more principled than "largest island
 * first, depth before breadth".
 *
 * That is the tunnel vision: not a bad scoring function, but a traversal order in which
 * the first plausible region consumes everything.
 *
 * ## The two mechanisms here
 *
 * **A reserved survey account.** Coverage is not something to be left over at the end. A
 * fixed share of the budget belongs to a breadth-first pass that touches every
 * tissue-bearing cell once, and focus expansion may not draw on it. Unspent survey budget
 * rolls into focus *after* the survey finishes — never before, or the guarantee is not one.
 *
 * **A global priority queue instead of recursion.** Every field the walk has seen sits in
 * one heap, so the next call goes to the globally most promising region rather than the
 * most promising child of wherever the recursion currently is. Sibling starvation stops
 * being something to guard against and becomes structurally impossible.
 *
 * Pure: no viewer, no driver, no async. The traversal invariants are unit tests.
 */

import type { Checklist } from "./checklist";
import type { FeatureAnswer } from "./checklist";

/** What the scheduler needs of a node. Structural, so the engine's richer type just fits. */
export interface SchedulableNode {
    id: string;
    /** Root of this node's branch — the unit that anti-starvation balances between. */
    rootId: string;
    rung: number;
    interest: number | null;
    confidence?: FeatureAnswer["confidence"];
    cellularity?: number | null;
    bboxFillFraction?: number | null;
    slideAreaFraction: number;
    deliveredMpp?: number | null;
    answers?: Record<string, FeatureAnswer>;
    /** Interests of this node's ancestors, root first. */
    ancestorInterests?: number[];
    error?: string;
}

export interface OverviewBudget {
    analyzeCalls: number;
    repairCalls: number;
    nodesVisited: number;
    truncated: boolean;
    /** Calls spent covering the slide. Reserved — focus expansion cannot draw on these. */
    surveyCalls: number;
    /** Calls spent looking closer at what the survey found. */
    focusCalls: number;
    /** Calls that carried several fields at once. */
    montageCalls: number;
    surveyBudget: number;
    focusBudget: number;
    /** True when the survey could not touch every tissue-bearing cell. */
    surveyIncomplete: boolean;
}

export function createBudget(maxAnalyzeCalls: number, surveyFraction = 0.35): OverviewBudget {
    const surveyBudget = Math.max(1, Math.round(maxAnalyzeCalls * surveyFraction));
    return {
        analyzeCalls: 0, repairCalls: 0, nodesVisited: 0, truncated: false,
        surveyCalls: 0, focusCalls: 0, montageCalls: 0,
        surveyBudget,
        focusBudget: Math.max(0, maxAnalyzeCalls - surveyBudget),
        surveyIncomplete: false,
    };
}

/** Whether an account has room for one more call. The accounts do not bleed into each other. */
export function canSpend(budget: OverviewBudget, account: "survey" | "focus"): boolean {
    return account === "survey"
        ? budget.surveyCalls < budget.surveyBudget
        : budget.focusCalls < budget.focusBudget;
}

/** Charge one call to an account. */
export function spend(budget: OverviewBudget, account: "survey" | "focus", calls = 1): void {
    budget.analyzeCalls += calls;
    if (account === "survey") budget.surveyCalls += calls;
    else budget.focusCalls += calls;
}

/**
 * Hand whatever the survey did not spend to focus.
 *
 * Called ONLY once the survey pass has finished. Rolling it over earlier would let focus
 * borrow against coverage that has not happened yet, which is exactly the guarantee the
 * reserved account exists to make.
 */
export function rolloverSurveyBudget(budget: OverviewBudget): void {
    budget.focusBudget += Math.max(0, budget.surveyBudget - budget.surveyCalls);
    budget.surveyBudget = budget.surveyCalls;
}

export interface PriorityContext {
    checklist: Checklist;
    /** Largest `slideAreaFraction` seen, for the area weight's scale. */
    maxArea: number;
    /** Expansions already performed under each root id — the anti-starvation term. */
    expandedPerRoot: Map<string, number>;
}

/**
 * How much the next call is worth spending on this node.
 *
 * Every term is a reason NOT to trust a raw score on its own:
 *
 * - `base` — the model's interest, or a local density prior when it has none. Never 0 for
 *   an unscored node: the walk must be able to look at something it has not judged yet.
 * - `checklistGap` — an open question outranks a settled one. This is what makes the run
 *   pursue the reviewer's actual question rather than general salience.
 * - `cellularity` — a free local second opinion, gentle enough never to overrule.
 * - `pathPrior` — a sliver under an uninteresting parent scoring itself highly is the
 *   classic zoom-in artefact; weight by what the ancestors believed.
 * - `confidence` — a hedged answer has not earned more of the budget.
 * - `area` / `fill` — a box that is mostly background earned its score on little tissue.
 * - `novelty` — the anti-starvation term, and the direct fix for tunnel vision: each
 *   expansion under a root makes the next one there worth slightly less, so the queue
 *   spreads across the slide instead of drilling one island to exhaustion.
 */
export function priority(node: SchedulableNode, ctx: PriorityContext): number {
    const base = node.interest ?? (0.35 + 0.4 * (node.cellularity ?? 0));
    return base
        * checklistGapWeight(node, ctx.checklist)
        * cellularityWeight(node)
        * pathPrior(node.ancestorInterests || [])
        * confidenceWeight(node.confidence)
        * areaWeight(node, ctx.maxArea)
        * fillWeight(node)
        * noveltyWeight(node, ctx.expandedPerRoot);
}

/** The checklist features this node leaves open AND a finer rung could still settle. */
export function checklistGaps(node: SchedulableNode, checklist: Checklist): string[] {
    return checklist.features
        .filter(f => {
            const present = node.answers?.[f.id]?.present ?? "not-assessable";
            // Polarity matters. A feature answered `no` at a resolution that CAN see it is
            // settled and is not a gap; `uncertain` and `not-assessable` are. Without the
            // distinction the walk either stops on unread features or drills settled ones
            // forever.
            if (present === "yes" || present === "no") return false;
            // Nothing to gain from a finer look at a feature this field already resolved
            // past — that would be budget spent chasing detail the question does not need.
            return f.requiredMpp < (node.deliveredMpp ?? Infinity);
        })
        .map(f => f.id);
}

/**
 * Whether a node is worth expanding at all.
 *
 * An open checklist question is reason enough on its own — it does not need the model to
 * ALSO have volunteered that the region looks interesting. That independence matters: an
 * unreadable view scores low and hedges, so an interest-only gate prunes exactly the
 * branch a closer look would settle, and the region is never re-read at a resolution that
 * could answer it.
 *
 * Both routes are still guarded by real tissue: chasing a sharper picture of glass is waste.
 */
export function shouldExpand(
    node: SchedulableNode,
    checklist: Checklist,
    opts: { interestThreshold: number; minDrillFill: number }
): boolean {
    if (node.error) return false;
    const worthIt = (node.bboxFillFraction ?? 1) >= opts.minDrillFill;
    if (!worthIt) return false;
    if (checklistGaps(node, checklist).length > 0) return true;
    return (node.interest ?? node.cellularity ?? 0) >= opts.interestThreshold;
}

// ---- weights ---------------------------------------------------------------

function checklistGapWeight(node: SchedulableNode, checklist: Checklist): number {
    const total = checklist.features.length || 1;
    return 1 + 0.6 * (checklistGaps(node, checklist).length / total);
}

/** Gentle and never zero: a real finding in sparse tissue must still be able to win. */
function cellularityWeight(node: SchedulableNode): number {
    return node.cellularity == null ? 1 : 0.6 + 0.7 * node.cellularity;
}

/** Geometric mean of the ancestors' interest; neutral at a root or when unscored. */
export function pathPrior(ancestors: number[]): number {
    if (!ancestors.length) return 1;
    const product = ancestors.reduce((p, v) => p * Math.max(0.05, v), 1);
    return Math.pow(product, 1 / ancestors.length);
}

function confidenceWeight(confidence: FeatureAnswer["confidence"] | undefined): number {
    switch (confidence) {
        case "low": return 0.5;
        case "medium": return 0.85;
        case "high": return 1;
        default: return 0.85;
    }
}

function areaWeight(node: SchedulableNode, maxArea: number): number {
    const ratio = (node.slideAreaFraction || 0) / Math.max(maxArea, Number.EPSILON);
    return Math.max(0.35, Math.min(1, Math.sqrt(ratio)));
}

function fillWeight(node: SchedulableNode): number {
    if (node.bboxFillFraction == null) return 1;
    return node.bboxFillFraction >= 0.15 ? 1 : 0.6;
}

/**
 * Diminishing returns per branch.
 *
 * The tunnel-vision fix, expressed as ranking rather than as a hand-written breadth loop:
 * after N expansions under one root, the next one there is worth `1/(1+N)` of its raw
 * score, so a fresh region elsewhere overtakes it. Nothing is forbidden — a genuinely
 * dominant branch still wins repeatedly — but it has to keep earning it.
 */
function noveltyWeight(node: SchedulableNode, expandedPerRoot: Map<string, number>): number {
    return 1 / (1 + (expandedPerRoot.get(node.rootId) ?? 0));
}

/**
 * A binary max-heap over nodes, scored lazily by `score`.
 *
 * Lazily on purpose: a node's priority changes as its branch is expanded (the novelty
 * term) and as the run's `maxArea` grows, so a score frozen at insertion would order the
 * queue by a world that no longer exists. The heap therefore re-scores on each `pop`,
 * which is O(n) per pop — irrelevant at the tens of nodes a budget of 28 calls can reach,
 * and simpler than a correct decrease-key.
 */
export class PriorityQueue<T> {
    private items: T[] = [];

    constructor(private score: (item: T) => number) {}

    get size(): number { return this.items.length; }

    push(item: T): void { this.items.push(item); }

    pushAll(items: Iterable<T>): void { for (const item of items) this.items.push(item); }

    /** The highest-scoring item, removed. Null when empty. */
    pop(): T | null {
        if (!this.items.length) return null;
        let best = 0;
        let bestScore = this.score(this.items[0]);
        for (let i = 1; i < this.items.length; i++) {
            const s = this.score(this.items[i]);
            if (s > bestScore) { best = i; bestScore = s; }
        }
        const [item] = this.items.splice(best, 1);
        return item;
    }

    /** Snapshot of the queued items, highest-scoring first. Does not mutate. */
    peekAll(): T[] {
        return [...this.items].sort((a, b) => this.score(b) - this.score(a));
    }
}
