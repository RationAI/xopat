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
// The rounding slack for comparing two µm/px figures is one number, not two: a private copy
// here silently decided whether a node counted as "read at its rung" differently from the
// field planner that produced the figure.
import { FIELD_MPP_TOLERANCE } from "./fields";

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
    /**
     * How much TISSUE the box holds, in µm² (level-0 px² on an uncalibrated slide).
     *
     * The absolute quantity, not {@link bboxFillFraction}. A tissue island's bounding box is
     * mostly glass whenever the tissue is not itself rectangular — a prostate core measures
     * 0.07-0.11 fill — so a fraction says almost nothing about whether there is anything in
     * there to look at, while the area says exactly that. Null when never measured.
     */
    tissueArea?: number | null;
    deliveredMpp?: number | null;
    answers?: Record<string, FeatureAnswer>;
    /** Interests of this node's ancestors, root first. */
    ancestorInterests?: number[];
    /** Fields already planned for this node and not yet read. Expanding it costs no new planning. */
    pendingTiles?: number;
    /**
     * The model's own answer to "could this view carry the features the question is about?".
     *
     * `false` is the one signal a checklist cannot produce: it means every feature the field
     * WAS asked came back unassessable, so there is no answer to leave open and
     * {@link checklistGaps} is empty. Treating that silence as "settled" is the death spiral
     * this whole file exists to avoid — see {@link shouldExpand}.
     */
    resolvable?: boolean | null;
    /**
     * The finest µm/px this run's ladder will ever target.
     *
     * The terminator for the `resolvable === false` route. Without it a model that answers
     * "too coarse" at every resolution — or an uncalibrated slide, where there is no
     * resolution to compare — would keep the node expandable forever.
     */
    finestMpp?: number | null;
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
    /**
     * Focus calls the run never spent.
     *
     * A run that stops with budget in hand did not finish the slide — it failed to find
     * anything it was willing to expand. That is the opposite of `truncated`, reads
     * identically in a result object, and is exactly how a walk that made one call out of
     * twenty-eight came back looking like a completed examination.
     */
    focusUnspent: number;
    /**
     * The walk ran out of tissue worth reading BEFORE it ran out of budget.
     *
     * The frontier drained: every remaining node was settled, glass, already read as closely,
     * or at the bottom of the ladder. That is a COMPLETE walk and the good outcome — the caps
     * are ceilings, not targets — so it must not be reported as partial and does not want
     * `refineOverview`.
     *
     * Distinct from {@link focusUnspent}, which counts the same leftover calls without saying
     * why they are left. Unspent budget because there was nothing left to read is convergence;
     * unspent budget with regions still unread is the stall this flag exists to tell it from.
     */
    converged: boolean;
    /**
     * Fields that were planned and never read.
     *
     * Coverage a caller would otherwise assume happened. Reported rather than dropped
     * silently (AGENTS.md: no silent caps).
     */
    plannedNotRead: number;
    /**
     * Fields skipped because the tissue in them had already been read as closely.
     *
     * A saving, not a limitation: the box was covered by reads at the same or a finer
     * resolution, so looking again would have bought the same pixels a second time.
     * Reported for the same reason `plannedNotRead` is — no silent caps — but it is
     * explicitly NOT a warning, and nothing should describe it as reduced coverage.
     */
    skippedRedundant: number;
    /**
     * How many times this tree has been CONTINUED past its original budget.
     *
     * 0 on a first walk. A budget is a checkpoint rather than a verdict, so the figures above are
     * cumulative across refinements — otherwise a continued run would report the last increment
     * and read as if the whole examination had cost that little.
     */
    refinements: number;
}

export function createBudget(maxAnalyzeCalls: number, surveyFraction = 0.35): OverviewBudget {
    const surveyBudget = Math.max(1, Math.round(maxAnalyzeCalls * surveyFraction));
    return {
        analyzeCalls: 0, repairCalls: 0, nodesVisited: 0, truncated: false,
        surveyCalls: 0, focusCalls: 0, montageCalls: 0,
        surveyBudget,
        focusBudget: Math.max(0, maxAnalyzeCalls - surveyBudget),
        surveyIncomplete: false,
        focusUnspent: 0,
        converged: false,
        plannedNotRead: 0,
        skippedRedundant: 0,
        refinements: 0,
    };
}

/**
 * Fold one run's spend into the cumulative total for a tree that has been continued.
 *
 * `focusUnspent` and `plannedNotRead` are STATE, not sums: they describe where the tree stands
 * now, so the latest run's values replace rather than add. The call counters are sums, because
 * the question they answer — "what did this examination cost?" — is about the whole examination.
 */
export function accumulateBudget(total: OverviewBudget, run: OverviewBudget): OverviewBudget {
    return {
        ...run,
        analyzeCalls: total.analyzeCalls + run.analyzeCalls,
        repairCalls: total.repairCalls + run.repairCalls,
        nodesVisited: total.nodesVisited + run.nodesVisited,
        surveyCalls: total.surveyCalls + run.surveyCalls,
        focusCalls: total.focusCalls + run.focusCalls,
        montageCalls: total.montageCalls + run.montageCalls,
        surveyBudget: total.surveyBudget + run.surveyBudget,
        focusBudget: total.focusBudget + run.focusBudget,
        skippedRedundant: total.skippedRedundant + run.skippedRedundant,
        // A tree that was truncated once and then completed is no longer truncated; a tree that
        // was complete and then hit a cap is. The latest run is the authority on both — and on
        // `converged`, which arrives through the spread above for exactly the same reason.
        truncated: run.truncated,
        surveyIncomplete: total.surveyIncomplete,
        refinements: total.refinements + 1,
    };
}

/**
 * How much of a box may already have been read as closely before reading it again is waste.
 *
 * Not 1.0, because the last slice of a box is rarely worth a whole vision call on its own,
 * and not much lower, because a box that is half new tissue genuinely is new tissue.
 */
export const REDUNDANT_COVERAGE = 0.7;

/** A box that has been read, and the rung it was read at. */
export interface ReadField {
    bounds: BoundsLike;
    /** Ladder rung — higher is finer. */
    rung: number;
}

/** Structural bbox; kept local so the scheduler stays independent of the engine's types. */
export interface BoundsLike { x: number; y: number; width: number; height: number }

/**
 * Has this box already been read, at this resolution or better?
 *
 * The walk plans fields from tissue geometry, and tissue geometry overlaps: a region's
 * bounding box shares area with its neighbour's, a drill's lattice re-covers ground the
 * survey read, and a curved strip yields boxes that are largely each other. None of that
 * was ever checked, so the same cells were rendered, sent to a vision model and reported
 * as separate findings — the visible symptom being a stack of examination markers over one
 * piece of tissue.
 *
 * **Only reads at the same rung or finer count.** A parent read at a coarser rung contains
 * its children completely; counting it would suppress every drill the walk exists to make.
 * Resolution is the whole point of looking again.
 *
 * `coverage` is injected rather than imported so this file stays free of geometry —
 * the caller passes `coveredFraction` from `./geometry`.
 */
export function isRedundantRead(
    candidate: { bounds: BoundsLike; rung: number },
    read: ReadField[],
    coverage: (box: BoundsLike, others: BoundsLike[]) => number,
    threshold = REDUNDANT_COVERAGE
): boolean {
    if (threshold >= 1) return false;
    const asClose = read.filter(r => r.rung >= candidate.rung).map(r => r.bounds);
    if (!asClose.length) return false;
    return coverage(candidate.bounds, asClose) >= threshold;
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
    // The same terminator `statedUnreadable` uses, for the same reason: "still open" is only
    // a gap while there is somewhere finer to GO. A field already read at the ladder's finest
    // rung has nothing left to descend to, whatever the checklist asked for.
    //
    // Without this, a requirement finer than the slide itself (a derived `0.25` on a 0.504
    // µm/px scan) left `f.requiredMpp < deliveredMpp` true at every resolution including
    // native, so the gate never closed: `mustResolve` stayed true, the walk subdivided until
    // its fields were ~60 µm across, and a vision model was asked to read cytology from a
    // 62x72 pixel raster. The rung floor in `ladderRungs` makes `finestMpp` reachable; this
    // is what consumes it.
    if (atFinestRung(node)) return [];
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
 * True when this node was read at (or finer than) the finest rung the run will ever target.
 *
 * Deliberately false when either figure is missing — an uncalibrated slide has no resolution
 * to compare, and closing the gate on an unknown would stop a walk that has not started.
 */
function atFinestRung(node: SchedulableNode): boolean {
    const delivered = node.deliveredMpp;
    const finest = node.finestMpp;
    if (delivered == null || finest == null || !(finest > 0)) return false;
    return delivered <= finest * (1 + FIELD_MPP_TOLERANCE);
}

/** The tissue gate every drill decision passes through. */
export interface DrillGate {
    /**
     * Least tissue a box must hold to be worth another call, in the same units as
     * {@link SchedulableNode.tissueArea}. Derive it from the run's own numbers — a readable
     * fraction of one field at the finest rung — rather than picking a constant. Set it to a
     * whole field's area and it stops being a glass filter and becomes a veto on every box
     * smaller than one call, which is most of them.
     */
    minDrillTissue: number;
}

/**
 * Is there enough tissue in this box to justify spending another call on it?
 *
 * The one place that decision is made, because it is asked from two directions — the
 * best-first scheduler's `shouldExpand` and the depth-first walk's `mustResolve` — and when
 * those two drifted apart the walk's behaviour depended on which scheduler happened to be
 * configured.
 *
 * It answers ONE question — "is there tissue here, or is this glass?" — and it must not be made
 * to answer any other. Both times this gate has been wrong it was because it had quietly taken
 * on a second job: first as a bbox FILL floor (which is a question about tissue SHAPE), then as a
 * whole-field AREA floor (a question about tissue SIZE). Each vetoed real cores, and a walk that
 * expands nothing reads exactly like a walk that found nothing. In particular: a prostate core's
 * island bbox measures 0.066-0.107 fill, so a 0.1 fill floor expanded nothing on that slide and
 * still reported the run complete. Fill belongs in RANKING ({@link fillWeight}), where a sparse
 * box loses to a dense one instead of being silently removed from consideration. Whether a box is
 * worth the call for any other reason belongs to {@link shouldExpand}; how much of it is worth
 * RENDERING belongs to the tiler, which drops glass cells against the survey mask before anything
 * is fetched.
 */
export function worthDrilling(node: SchedulableNode, opts: DrillGate): boolean {
    if (node.error) return false;
    // Never veto on a measurement that was not taken: `measureFill: false` is a supported
    // configuration, and refusing to drill anything under it would be a silent behaviour
    // change rather than a saving.
    if (node.tissueArea == null) return true;
    return node.tissueArea >= Math.max(0, opts.minDrillTissue);
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
 * Every route is still guarded by real tissue: chasing a sharper picture of glass is waste.
 */
export function shouldExpand(
    node: SchedulableNode,
    checklist: Checklist,
    opts: DrillGate & { interestThreshold: number }
): boolean {
    if (!worthDrilling(node, opts)) return false;
    const gaps = checklistGaps(node, checklist);
    // Fields already planned for this node: the work is decided, only the reading is left,
    // so there is nothing further to justify.
    if ((node.pendingTiles ?? 0) > 0) return true;
    if (gaps.length > 0) return true;
    if (statedUnreadable(node)) return true;
    return (node.interest ?? node.cellularity ?? 0) >= opts.interestThreshold;
}

/**
 * The model said this view could not carry the question, and a finer rung still exists.
 *
 * {@link checklistGaps} cannot see this case. A feature is a gap only while a FINER rung could
 * settle it — `requiredMpp < deliveredMpp` — so a field read at or below every feature's stated
 * requirement has no gaps by definition, even when the model answered "not-assessable" to all of
 * them. That is exactly what a generic checklist produces: it declares 1 µm/px sufficient, the
 * field is delivered at 0.85, and the model's own "I cannot see cell detail here" is discarded as
 * settled. The branch dies at architecture resolution and the run reports itself complete.
 *
 * So the model's verdict gets its own route, terminated by the ladder rather than by the
 * checklist: keep going while there is a finer rung to go to. On an uncalibrated slide there is
 * no resolution to compare and the route is closed — the checklist gap rule already drills there.
 */
function statedUnreadable(node: SchedulableNode): boolean {
    if (node.resolvable !== false) return false;
    const delivered = node.deliveredMpp;
    const finest = node.finestMpp;
    if (delivered == null || finest == null || !(finest > 0)) return false;
    // Same comparison as {@link atFinestRung}, negated — one statement of "there is somewhere
    // finer to go", so the model's route and the checklist's route cannot disagree about
    // when the ladder has run out.
    return !atFinestRung(node);
}

// ---- weights ---------------------------------------------------------------

function checklistGapWeight(node: SchedulableNode, checklist: Checklist): number {
    const total = checklist.features.length || 1;
    return 1 + 0.6 * (checklistGaps(node, checklist).length / total);
}

/**
 * Gentle and never zero: a real finding in sparse tissue must still be able to win.
 *
 * Exported, like the three below, because PRESENTATION ranking composes the same weights.
 * They used to be reimplemented there with different constants (this one `0.8 + 0.4x`,
 * `pathPrior` clamping at 0.01 rather than 0.05), so the list a reader was shown disagreed
 * with the order the budget had actually been spent in — on the same nodes, in the same run.
 */
export function cellularityWeight(node: SchedulableNode): number {
    return node.cellularity == null ? 1 : 0.6 + 0.7 * node.cellularity;
}

/** Geometric mean of the ancestors' interest; neutral at a root or when unscored. */
export function pathPrior(ancestors: number[]): number {
    if (!ancestors.length) return 1;
    const product = ancestors.reduce((p, v) => p * Math.max(0.05, v), 1);
    return Math.pow(product, 1 / ancestors.length);
}

export function confidenceWeight(confidence: FeatureAnswer["confidence"] | undefined): number {
    switch (confidence) {
        case "low": return 0.5;
        case "medium": return 0.85;
        case "high": return 1;
        default: return 0.85;
    }
}

export function areaWeight(node: SchedulableNode, maxArea: number): number {
    const ratio = (node.slideAreaFraction || 0) / Math.max(maxArea, Number.EPSILON);
    return Math.max(0.35, Math.min(1, Math.sqrt(ratio)));
}

export function fillWeight(node: SchedulableNode): number {
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
