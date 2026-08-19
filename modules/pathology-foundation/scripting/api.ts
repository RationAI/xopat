/// <reference path="../../../src/types/globals.d.ts" />

// Same-module import (the AGENTS.md ban is on crossing the plugin/module/core boundary).
import { forPresentation } from "../lib/presentation";

/**
 * Pathology foundation-model scripting namespace (`pathology`).
 *
 * A thin adapter over the `pathology-foundation` module that the host scripting
 * layer and the LLM chat integrations call. It exposes concrete pathology
 * **jobs** the agent can complete reliably rather than a single vague "analyze":
 *  - `annotateTissue` / `tissueCoverage` — built on the module's built-in,
 *    in-browser tissue detector; they read the raw background image, need no
 *    server, and nothing leaves the viewer.
 *  - `segmentAtPoint` — asks the user to click a point, then segments that spot
 *    (requires a `segment` driver, e.g. the SAM plugin).
 *  - `analyzeRegion` — vision → text findings (requires an `analyze` driver).
 *  - interactive helpers: `pickPoint`, `getSelectedAnnotation`,
 *    `requestAnnotationSelection`.
 *
 * Consent is requested only when the resolved driver is REMOTE; local drivers
 * and the interactive prompts run without a consent dialog.
 */

const PATHOLOGY_DTS = `
export type PathologyFeature = "tissue-mask" | "segment" | "analyze";

/** A configured foundation-model transport and the jobs it can perform. */
export type PathologyDriverInfo = {
    id: string;
    label: string;
    /** True when it runs in-browser (no snapshot leaves the viewer). */
    local: boolean;
    features: PathologyFeature[];
};

export type ViewerPoint = { x: number; y: number };

export type SelectedAnnotation = { id: string | number } | null;

/** Image-space bounding box; pass to viewer.frameImageRegion(bounds) to navigate to a result. */
export type Bounds = { x: number; y: number; width: number; height: number };

export type TissueAnnotationResult = {
    driver: string;
    /** Ids of the polygon annotations drawn for the detected tissue. */
    annotationIds: Array<string | number>;
    /** Fraction of the CURRENT VIEW covered by tissue (0..1) — not the whole slide. */
    viewCoverage: number;
    /** What viewCoverage refers to — always "current-view". Quote this scope when reporting the number. */
    coverageScope: "current-view";
    /** Image-space bbox of the drawn tissue (null if none) — feed to viewer.frameImageRegion(...) to view it. */
    bounds: Bounds | null;
    /** Image-space centre of bounds (null if none) — feed to viewer.focusOnImage(center.x, center.y). */
    center: ViewerPoint | null;
};

export type TissueCoverageResult = {
    driver: string;
    annotationId: string | number;
    /** Fraction of the ANNOTATION's area covered by tissue (0..1) — "how much of this region is tissue?". */
    annotationTissueFraction: number;
    /** What the fractions measure — always "annotation-vs-current-view". Quote the scope when reporting. */
    coverageScope: "annotation-vs-current-view";
    tissuePixels: number;
    areaPixels: number;
    /** Total tissue pixels detected in the CURRENT VIEW (same mask as tissuePixels). */
    viewTissuePixels: number;
    /** Share of the current view's tissue that lies inside the annotation (0..1) — "what fraction of the tissue is in this region?". */
    fractionOfViewTissue: number;
    /** Image-space bbox of the measured annotation. */
    bounds: Bounds | null;
    center: ViewerPoint | null;
};

export type SegmentResult = {
    driver: string;
    /**
     * "ok" — a region was segmented and drawn. "empty" — the driver found nothing
     * segmentable at that spot (a genuine negative; report it as such). "rejected-oversegmented"
     * — the driver DID return a mask but it failed validation (covered >90% of the
     * view) and was discarded; this is a failed run, NOT evidence about the tissue.
     */
    status: "ok" | "empty" | "rejected-oversegmented";
    /** Human-readable note explaining a non-"ok" status. */
    statusMessage?: string;
    /** Ids of polygon annotations created from the returned mask. */
    annotationIds: Array<string | number>;
    /** Image-space bbox of the drawn region (null if none) — feed to viewer.frameImageRegion(...). */
    bounds: Bounds | null;
    center: ViewerPoint | null;
};

export type AnalysisResult = {
    driver: string;
    /** Text findings from the vision model, or null. */
    findings: string | null;
    /**
     * Present for region analyses: false when the region's tiles could not all be
     * loaded in time and the model saw partially loaded data — treat as provisional.
     */
    isComplete?: boolean;
    /**
     * Present when \`mpp\` forced the region to be SAMPLED rather than delivered whole:
     * the fraction of it the model actually saw. A finding then speaks for that part only.
     */
    coveredFraction?: number;
};

/** One named thing a run is trying to establish about the tissue. */
export type ChecklistFeature = {
    /** Machine id, and the key its answer comes back under. Short, lower-case. */
    id: string;
    /** Row label for a report. */
    label: string;
    /** The question asked of each field of view. */
    question: string;
    /**
     * µm per pixel needed to judge it. Roughly: 2 for tissue architecture, 1 for growth
     * pattern, 0.5 for glandular/cellular detail, 0.25 for nuclear detail. A field coarser
     * than this records the feature as "not-assessable" WITHOUT spending a model call.
     */
    requiredMpp: number;
    /** 0..1, how much this feature matters to the question (default 1). */
    weight?: number;
};

/** The set of questions a run obeyed, and where they came from. */
export type Checklist = {
    features: ChecklistFeature[];
    /** "derived" — a model wrote it from the query. "fallback" — generic; say so if you report it. */
    source: "explicit" | "derived" | "fallback";
    query?: string;
};

/** One field's answer to one checklist feature. */
export type FeatureAnswer = {
    id: string;
    /** The model's own short statement, or null when it gave none. */
    answer: string | null;
    /**
     * **"not-assessable" is NOT a negative finding.** It means this image at this
     * resolution could not show the feature — a reason to look closer, never a reason to
     * report the feature as absent. Never render it as "no", "absent" or "not seen".
     */
    present: "yes" | "no" | "uncertain" | "not-assessable";
    confidence: "low" | "medium" | "high" | null;
    /** Why it was not assessable: "resolution" (the image was too coarse) vs "model". */
    reason?: "resolution" | "model" | "unparsed";
};

/** One row of the evidence table: a question asked, answered, and cited. */
export type EvidenceRow = {
    id: string;
    label: string;
    question: string;
    requiredMpp: number;
    /**
     * Aggregate across every region that answered. Any "yes" wins, then "uncertain", then
     * "no" — because the walk samples PART of the slide, so one positive is a finding
     * while many negatives are not proof of absence.
     */
    verdict: "yes" | "no" | "uncertain" | "not-assessable";
    counts: { yes: number; no: number; uncertain: number; notAssessable: number };
    /**
     * The regions to cite AND to link. Best-ranked first.
     *
     * \`bounds\` is ready to use as a region link exactly as it stands: \`{x, y, width,
     * height}\` are whole level-0 image pixels and map straight to \`x, y, w, h\`. Naming
     * one of these regions in prose without linking it leaves the user unable to find it.
     */
    citedBy: Array<{
        label: string;
        bounds: Bounds;
        answer: string | null;
        confidence: "low" | "medium" | "high" | null;
        deliveredMpp: number | null;
    }>;
    /**
     * True when NO region ever reached this feature's required resolution. Offer to look
     * closer (\`interrogateRegion\`); do NOT report the feature as absent.
     */
    underResolved: boolean;
};

export type InterrogationResult = {
    region: Bounds;
    /** The questions actually asked. */
    checklist: Checklist;
    requestedMpp: number | null;
    /** The resolution actually delivered — the basis for weighing every answer below. */
    deliveredMpp: number | null;
    /** Per-field detail, so you can link the user to the field that carries an answer. */
    fields: Array<{
        label: string;
        bounds: Bounds;
        deliveredMpp: number | null;
        answers: FeatureAnswer[];
        findings: string | null;
        error?: string;
    }>;
    /** One answer per feature across the whole region. */
    answers: FeatureAnswer[];
    /** Below 1 when the region was sampled rather than fully covered. Say so if you report it. */
    coveredFraction: number;
    isComplete: boolean;
    budget: { analyzeCalls: number };
};

export type MontageResult = {
    driver: string;
    /** One entry per region you passed in, in the same order. */
    cells: Array<{
        /** The name you gave the region (or "region N"). */
        label: string;
        /** The label drawn on the composite — how the model referred to this cell. */
        cellLabel: string;
        bounds: Bounds;
        deliveredMpp: number | null;
        answers: FeatureAnswer[];
        interest: number | null;
        findings: string | null;
    }>;
    /** The model's whole reply. */
    findings: string | null;
    cellMpp: number | null;
    cellSizeUm: { width: number; height: number } | null;
    isComplete: boolean;
};

/** A coarse map of where the nuclei are. Local and free — no model call. */
export type DensityMap = {
    /** Parent-global rectangle this map covers. */
    bounds: Bounds;
    /** Grid CELLS, not pixels. */
    width: number;
    height: number;
    /** Row-major, 0..1, normalized against the 95th percentile. */
    values: number[];
    /**
     * "saturation-fallback" means the stain class made nuclear unmixing meaningless, so
     * these values rank stain intensity rather than nuclei.
     */
    method: "nuclear-deconvolution" | "saturation-fallback" | "driver";
    /** Mean density over a box, 0..1. */
    sample(bounds: Bounds): number;
    /** The densest cells as boxes, densest first — hand these to a closer look. */
    top(n: number): Array<{ bounds: Bounds; value: number }>;
};

/** One connected tissue island found by exploreSlide. */
export type SlideRegion = {
    /** 0-based array rank — INTERNAL. Never show it to the user; use \`label\`. */
    index: number;
    /** How to NAME this region to the user, counted from 1: "region 1" is the largest island. */
    label: string;
    /** Image-space bbox — feed to viewer.frameImageRegion(region.bounds) to navigate to it. */
    bounds: Bounds;
    center: ViewerPoint;
    /** Fraction of the whole overview this island covers (0..1). */
    areaFraction: number;
    /** Always true: bounds come from a low-resolution overview. Frame the region and re-run annotateTissue for a precise outline. */
    isApproximate: true;
};

export type SlideExploration = {
    driver: string;
    slide: {
        width: number;
        height: number;
        /** Physical calibration, or null if uncalibrated. */
        micronsPerPixel: number | null;
        /** Native/objective magnification (e.g. 40), or null if unknown. */
        magnification: number | null;
    };
    /** Fraction of the WHOLE SLIDE covered by tissue (0..1). */
    slideCoverage: number;
    /** What slideCoverage refers to — always "whole-slide". Quote this scope when reporting the number. */
    coverageScope: "whole-slide";
    /**
     * False when the slide's tiles were still streaming when the overview was
     * captured — slideCoverage/regions are then PROVISIONAL and likely understated.
     * Report them as provisional ("the overview did not finish loading"); do NOT
     * assert the slide has little/no tissue from an incomplete overview.
     */
    isComplete: boolean;
    /** Tissue islands ranked by area (largest first); empty when the slide looks blank. */
    regions: SlideRegion[];
    /** Coarse model-assisted note; present only when hint was requested and an analyze driver ran. */
    hint?: string | null;
};

export type RegionReviewResult = {
    /** 0-based array rank — INTERNAL. Never show it to the user; use \`label\`. */
    index: number;
    /** How to NAME this region to the user, counted from 1 ("region 2"). */
    label: string;
    bounds: Bounds;
    /** With feature "analyze": the model's findings text (or null). */
    findings?: string | null;
    /** With feature "tissue-mask": fraction of the framed region (the current view) that is tissue (0..1). */
    viewCoverage?: number;
    annotationIds?: Array<string | number>;
    /** False when the region's tiles were still streaming when the job ran — treat the result as provisional. */
    isComplete?: boolean;
    /** Set if the region could not be processed. */
    error?: string;
};

/** One node of a hierarchical expert overview (see buildOverview). */
export type OverviewNode = {
    /** 0-based rank among siblings — INTERNAL, and NOT unique across the tree. Use \`label\`. */
    index: number;
    /**
     * How to NAME this region to the user: counted from 1 and carrying the ancestry path,
     * so it is unique — "region 2" at the top, "region 2.1" one level in.
     */
    label: string;
    /** Recursion depth (0 = a whole-slide tissue island) — INTERNAL; humans count levels from 1. */
    depth: number;
    /** Parent-global image-space bbox — feed to viewer.frameImageRegion(bounds). */
    bounds: Bounds;
    center: ViewerPoint;
    /** Magnification ACTUALLY achieved for this node, or null when the slide gives no basis. */
    magnification: number | null;
    /** Area fraction — of the whole slide at the top level, of the framed parent below. NOT comparable across levels. */
    areaFraction: number;
    /** Fraction of the WHOLE SLIDE this node covers (0..1) — comparable at any depth; use this when talking size. */
    slideAreaFraction: number;
    /** Fraction of the node's box that is really tissue (0..1); null when not measured. Low = mostly background. */
    bboxFillFraction: number | null;
    /** Physical field of view of the box, or null when the slide is uncalibrated. */
    fieldOfViewUm?: { width: number; height: number } | null;
    /** The vision model's short description of the region (model-assisted, not a diagnosis). */
    findings: string | null;
    /**
     * Interest/relevance 0..1, or null when the model returned NO usable score.
     * null means UNKNOWN — never present or compare it as if it were 0.
     */
    interest: number | null;
    /**
     * How 'interest' was established. "unparsed" (and to a lesser degree "keyword") means
     * the score is unreliable — say so rather than quoting it as the model's judgement.
     */
    verdict?: {
        interest: number | null;
        drill: boolean;
        confidence: "low" | "medium" | "high" | null;
        /**
         * Whether the features the question needs could be JUDGED at this resolution.
         * Independent of interest: false means "could not tell here", NOT "nothing here".
         */
        resolvable: boolean | null;
        source: "contract" | "normalized" | "keyword" | "unparsed";
        /** The scale assumed when source is "normalized" (e.g. 5 = the model answered out of 5). */
        scoreScale?: number;
    };
    /** µm per pixel of the image the model actually saw here — the real limit on what it could resolve. */
    renderedMpp?: number | null;
    /**
     * True when this view was too coarse for the detail the question needs. If such a node
     * has NO children (the walk ran out of depth or budget), its findings are a look at the
     * tissue from too far away — say so instead of quoting them as a read.
     */
    resolutionShortfall?: boolean;
    /** Composite rank (interest weighted by ancestors, confidence, slide area, tissue fill). Order of 'ranked'. */
    rankScore?: number;
    /** drill = looked interesting; resolve = too coarse to judge, so re-read closer; stop = pruned; leaf = hit the depth cap. */
    decision: "drill" | "resolve" | "stop" | "leaf";
    /** False when tiles were still streaming — findings are provisional. */
    isComplete: boolean;
    /** Set when the node could not be analysed. */
    error?: string;
    children: OverviewNode[];
};

/** What kind of signal a stain encodes — decides what a model may claim from it. */
export type StainClass = "histochemical" | "targeted" | "fluorescence" | "unstained" | "unknown";

/**
 * What is known about the slide. Supply this to buildOverview whenever you can: without
 * it the vision model is told the stain and site are unknown and is forbidden from naming
 * them — safe, but far less useful than a walk that knows what it is looking at.
 */
export type SlideContext = {
    /** The stain, in the user's own words (e.g. whatever they call it). Free text. */
    stain?: string;
    /**
     * What the stain can show. This decides what the model may claim:
     * "histochemical" = morphology/tinctorial only, licenses NO named-target result;
     * "targeted"/"fluorescence" = licenses ONLY the targets listed below;
     * "unstained" = licenses no staining result at all.
     */
    stainClass?: StainClass;
    /** The targets/channels actually assayed. Required for "targeted"/"fluorescence" — without them the stain is treated as unknown. */
    targets?: string[];
    /** The specimen site, in the user's own words. Free text. */
    organ?: string;
    /** Any extra clinical framing the user gave you (e.g. specimen type, prior therapy). */
    notes?: string;
    /** "explicit" = you/the user stated it; "derived" = read from slide metadata; "unknown" = nothing established. */
    source: "explicit" | "derived" | "unknown";
};

/**
 * buildOverview returns this INSTEAD of walking when it does not know what the slide is.
 * Nothing has been analysed and no budget has been spent — the walk is deliberately not
 * started, because a blind one produces findings you would have to throw away.
 *
 * Do this: ask the user for the fields in 'missing', in ONE bundled question, then call
 * buildOverview again with context set. If they do not know or do not care, call again
 * with context: "unknown" to proceed blind (findings will be structure-only).
 */
export type OverviewContextRequired = {
    status: "context-required";
    /** Whatever was established (possibly nothing). Confirm rather than re-ask what is here. */
    context: SlideContext;
    /** The fields still unknown — ask for exactly these. */
    missing: Array<"stain" | "organ">;
};

export type OverviewResult = {
    /** Discriminator: an actual walk. Check this before using the result. */
    status: "ok";
    driver: string;
    /** The feature this overview hunted for ("areas with X"), if any. */
    query?: string;
    /**
     * What the walk was told about the slide. If source is "unknown", the findings were
     * constrained to structure only — ask the user for the stain and site (ONE bundled
     * question) and rebuild with context set before presenting a confident answer.
     */
    context: SlideContext;
    slide: SlideExploration["slide"];
    /** Whole-slide tissue coverage (0..1). */
    slideCoverage: number;
    coverageScope: "whole-slide";
    /** False when the level-0 overview ran on partially-loaded tiles (provisional). */
    isComplete: boolean;
    /** Top-level tissue islands, each a subtree. Coarse — prefer 'ranked' for navigation. */
    root: OverviewNode[];
    /**
     * Flat focal regions ordered by rankScore — the model's interest weighted by how much
     * its ancestors believed in it, its stated confidence, and how much slide and real
     * tissue its box holds. USE THIS ORDER, not raw interest: a high score on a sliver of
     * mostly-background under an uninteresting parent is exactly what the weighting demotes.
     * Each node.bounds is a tight, navigable window — do NOT link the coarse top-level boxes.
     */
    ranked: OverviewNode[];
    /**
     * **WRITE THE ANSWER FROM THIS.** One row per question the run asked, with the
     * aggregate verdict and the regions that evidence it. Cite \`citedBy[i].label\` and
     * build a region link from \`citedBy[i].bounds\` for EVERY region you name — the
     * bounds are whole image pixels and map straight to a link's \`x, y, w, h\`.
     *
     * Two rules when reporting it:
     * - \`verdict: "not-assessable"\` and \`underResolved: true\` mean the run never got a
     *   close enough look. Say that, and offer \`interrogateRegion\` — do NOT report the
     *   feature as absent.
     * - Every finding is a model-assisted observation supporting the pathologist's own
     *   read, never a diagnosis.
     */
    evidence: EvidenceRow[];
    /** The questions the run obeyed. \`source: "fallback"\` means they were generic — say so. */
    checklist: Checklist;
    /**
     * A one-line-per-row rendering of \`evidence\`, for convenience only. It is NOT the
     * source of truth and drops detail the rows carry; prefer \`evidence\`.
     */
    summary?: string | null;
    /**
     * True when the user stopped the walk (its progress dialog has a cancel button).
     * NOT an error and NOT a failure: the regions present were really examined. Report
     * them, say the slide was not finished, and offer to continue — never discard them
     * or silently restart the whole walk.
     */
    cancelled?: boolean;
    /**
     * Caveats you MUST pass on to the user (unparsed scores, unknown slide context,
     * cancellation, truncation). Never present an overview as complete/authoritative
     * while this is non-empty.
     */
    warnings: string[];
    /** ISO timestamp the overview was built (freshness for reuse). */
    builtAtIso: string;
    /** Budget accounting: analyzeCalls (incl. repairCalls), nodesVisited, truncated when a cap stopped it early. */
    budget: { analyzeCalls: number; repairCalls: number; nodesVisited: number; truncated: boolean };
};

export type BuildOverviewOptions = {
    /**
     * Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience.
     * Keep it a short phrase: when a node's verdict cannot be scored, the fallback ranks it
     * by the fraction of query words present, so piling on terms dilutes every region's score.
     */
    query?: string;
    /**
     * What is known about the slide.
     * - Omit (or "auto"): try to read stain/site from the slide's own metadata. If that
     *   fails, buildOverview returns status "context-required" WITHOUT walking, so you can
     *   ask the user before any budget is spent.
     * - A SlideContext: the user's answer. Partial is fine ("H&E, site unknown") — the walk
     *   proceeds and simply forbids naming whatever is still missing. Set stainClass from
     *   what they describe; it decides what the model may claim.
     * - "unknown": the user was asked and cannot say — proceed blind, structure-only.
     */
    context?: SlideContext | "auto" | "unknown";
    /** Re-ask once when the model returns no usable score (default true). */
    repairVerdict?: boolean;
    /** Measure how much of each region is really tissue (local, default true). */
    measureFill?: boolean;
    /** Max recursion depth (default 2). */
    maxDepth?: number;
    /** Regions explored per node (default 4). */
    breadth?: number;
    /**
     * Explicit objective magnification per depth; null = fit the region. LEAVE IT UNSET:
     * by default each depth targets a RESOLUTION derived from the slide's own calibration
     * (~1, ~0.5, ~0.25 µm/pixel), which is what decides whether a view can answer the
     * question at all. Setting it by hand overrides that and is rarely what you want.
     */
    magnificationLadder?: Array<number | null>;
    /** Drill only when interest is at least this (default 0.5). */
    interestThreshold?: number;
    /** Minimum tissue fill (0..1) before an unreadable view may spend budget drilling (default 0.1). */
    minDrillFill?: number;
    /** Hard cap on vision calls for the whole run (default 18). */
    maxAnalyzeCalls?: number;
    /** Hard cap on regions visited for the whole run (default 24). */
    maxNodes?: number;
    /** Draw visited regions as annotations (default false). */
    annotate?: boolean;
    /** Attach a local findings digest as summary (default true). */
    synthesize?: boolean;
    /** Return the cached overview (if any) instead of rebuilding (default false). */
    reuse?: boolean;
    driver?: string;
};

export interface PathologyScriptApi extends ScriptApiObject {
    /** List the configured drivers and which features each can perform. */
    listDrivers(): PathologyDriverInfo[];

    /**
     * Detect tissue over the whole slide and return the ranked tissue islands
     * (\`regions\`, largest first) plus whole-slide \`slideCoverage\` and slide metadata.
     * The slide is rendered OFF-SCREEN — the user's viewport never moves, and the user
     * can keep navigating freely while it runs.
     *
     * Use this to orient BEFORE acting on the slide — but only once you are already acting
     * on it at the user's request: do not call it to answer a question that is not about
     * where the tissue is, and do not call it "just to look".
     *
     * Offer navigation to a result with \`viewer.frameImageRegion(regions[i].bounds)\`
     * — never zoom to guessed coordinates. If \`isComplete\` is false the overview ran on
     * partially-loaded tiles: report the numbers as provisional, do not assert the slide
     * is blank. Otherwise, if \`slideCoverage\` is ~0 or \`regions\` is empty, the slide
     * looks blank; say so instead of hunting. \`slideCoverage\` is WHOLE-SLIDE (contrast
     * annotateTissue's \`viewCoverage\`, which is current-view). The overview is
     * low-resolution, so bounds are approximate — follow up with a region-scoped
     * analyzeRegion, or annotateTissue after framing, for precision.
     * @param options.annotate draw the islands as annotations (default false).
     * @param options.hint attach one coarse model note (needs an analyze driver; asks the user).
     * @param options.driver optional tissue-mask driver id.
     * @param options.minAreaFraction smallest island to report as a fraction of the overview (default 0.001).
     */
    exploreSlide(options?: {
        driver?: string;
        annotate?: boolean;
        hint?: boolean;
        minAreaFraction?: number;
    }): Promise<SlideExploration>;

    /**
     * Walk the top tissue regions and run one job on each, rendering every region
     * OFF-SCREEN (optionally at a target \`magnification\`) — the user's viewport is
     * never moved. \`feature\` is "analyze" (vision→text findings per region, default)
     * or "tissue-mask" (per-region tissue coverage). When \`regions\` is omitted,
     * exploreSlide supplies them.
     *
     * ONLY on an explicit request to go through / review the tissue. With feature
     * "analyze" this is several slow vision calls — never run it to enrich an answer
     * the user did not ask for. For a visual question about what the user currently
     * sees, use analyzeRegion without a region (one call) instead.
     *
     * Asks the user once when analyzing.
     * @param options.max cap on regions processed (default 5).
     */
    reviewRegions(options?: {
        regions?: SlideRegion[];
        max?: number;
        magnification?: number;
        feature?: PathologyFeature;
        prompt?: string;
        driver?: string;
    }): Promise<RegionReviewResult[]>;

    /**
     * BUILD A HIERARCHICAL OVERVIEW you can reason over — THE MOST EXPENSIVE CALL HERE.
     *
     * RUN IT WHEN THE USER ASKS FOR ANYTHING SLIDE-WIDE: "walk me through the slide",
     * "find/rank the interesting regions", "where are the areas with X", "survey the
     * tissue" — AND ALSO the report-shaped asks: "report the findings", "what is on this
     * slide", "is there cancer". Those are slide-wide hunts too, and this is the call that
     * answers them: ONE walk, budgeted and cached, instead of ten hand-rolled analyzeRegion
     * round-trips that cost more, see less, and cannot compare regions against each other.
     * It renders regions off-screen (the user keeps their view and can navigate freely) but
     * fires many slow vision calls — MINUTES of work the user is waiting on.
     *
     * Do NOT run it: to answer a question that is not about the slide's content; to check or
     * enrich something you could answer from the current view (use analyzeRegion — one call);
     * to gather background before a different task; because a scan "might help"; or on a
     * slide you have already scanned this session (use getOverview). If you think a scan
     * would help but the user did not ask, say so in one sentence and let them decide — do
     * not start it and do not ask twice.
     *
     * When it IS wanted: it orients (exploreSlide), then walks the top tissue islands,
     * describes each with the vision model, scores them, and drills — into the interesting
     * ones, AND into any it could not read at the resolution it had. Pass \`query\` with the
     * feature you are hunting for so the walk is steered toward it. The whole tree is CACHED per slide:
     * call \`getOverview()\` first and only build when it is absent or genuinely no longer
     * fits the question (\`reuse: true\` returns the cache).
     * Navigate to any node with \`viewer.frameImageRegion(node.bounds)\`. Findings are
     * model-assisted observations, never a diagnosis. Needs an \`analyze\` driver and asks
     * the user ONCE for the whole run (it fires many analyze calls).
     * If \`budget.truncated\` is true a cap stopped the walk early — say the overview is partial.
     *
     * CHECK \`status\` FIRST. If it is "context-required" the walk did NOT run and nothing
     * was analysed: the viewer could not establish what the slide is, and refuses to spend
     * the (slow, expensive) vision budget guessing. Ask the user for the \`missing\` fields
     * in ONE bundled question, then call again with \`context\` set — that single informed
     * walk is the whole point. Only if they cannot say, call again with context: "unknown".
     * A vision model told nothing about the slide invents it: it names an organ from
     * ambiguous morphology and reports results of staining that was never performed.
     * The answer is remembered for the slide, so ask ONCE per slide, not once per job —
     * and ask it FIRST, in the same turn you start the task, not after other calls have
     * already been paid for. \`getSlideContext()\` is free: check it before asking at all.
     *
     * ACCURACY — when status is "ok":
     * - Report in \`ranked\` order, not by raw \`interest\`.
     * - A node whose \`interest\` is null has NO score — say so; it is not a zero.
     * - A leaf with \`resolutionShortfall\` was read from too far away: its findings describe
     *   architecture, not cytology. Do not quote them as a close read, and do not turn that
     *   into a question for the user — call analyzeRegion on its \`bounds\` at a higher
     *   \`magnification\` and answer from what comes back.
     * - Surface every entry of \`result.warnings\` to the user. Warnings naming a
     *   CONTRADICTION between a region and its drill are the interesting ones: the finer
     *   view usually wins, but say both were seen rather than silently picking one.
     * - \`cancelled: true\` means the user stopped it: the tree is real but partial. Report
     *   what is there and offer to continue; do not treat it as an error or start over.
     *
     * The walk shows the user a progress dialog and can be cancelled from it. Its results
     * are cached after EVERY region, so if a call ever fails or times out, call
     * getOverview() before doing anything else — the regions already examined are still
     * there, and re-running would pay for them a second time.
     */
    buildOverview(options?: BuildOverviewOptions): Promise<OverviewResult | OverviewContextRequired>;

    /**
     * Return the CACHED hierarchical overview for the current slide, or null if none was
     * built yet. FREE: no model call, no navigation, no waiting.
     *
     * ALWAYS try this before even considering buildOverview — if it returns a tree, answer
     * from it (each node has \`findings\`, \`interest\`, and a \`bounds\` to navigate to)
     * rather than paying for a rescan. Check \`builtAtIso\` and \`query\` to judge whether it
     * still fits the question. A null here is NOT a reason to scan: it just means no scan
     * has been run, which is the normal state unless the user asked for one.
     */
    getOverview(): OverviewResult | null;

    /** Drop the cached overview for the current slide (forces the next buildOverview to rebuild). */
    clearOverview(): void;

    /**
     * Detect tissue in the CURRENT VIEW of the ACTIVE viewer and draw it as
     * polygon annotation(s). Reads the raw background image with a built-in
     * in-browser detector (no server, nothing leaves the viewer). Detection is
     * limited to what is currently visible — to cover the whole slide, fit it in
     * view first (e.g. zoom out). \`viewCoverage\` is the fraction of the current
     * view, not of the whole slide. The result includes \`bounds\`/\`center\`; navigate
     * to it with \`viewer.frameImageRegion(result.bounds)\`.
     * @param driver optional tissue-mask driver id.
     */
    annotateTissue(driver?: string): Promise<TissueAnnotationResult>;

    /**
     * Measure an annotation against the tissue in the CURRENT VIEW. If
     * \`annotationId\` is omitted, the user is asked to select an annotation.
     * Everything is measured from one current-view tissue mask (no navigation),
     * so the fractions are resolution-consistent. Returns:
     *  - \`annotationTissueFraction\` (0..1): fraction of the ANNOTATION's area that
     *    is tissue — "how much of this region is tissue?".
     *  - \`fractionOfViewTissue\` (0..1): share of the VISIBLE tissue that lies
     *    inside the annotation — "what fraction of the tissue is in this region?".
     * Do NOT navigate the whole slide to answer this; use this method directly.
     * @param annotationId the annotation's increment id (optional).
     * @param driver optional tissue-mask driver id.
     */
    tissueCoverage(annotationId?: string | number, driver?: string): Promise<TissueCoverageResult>;

    /**
     * Segment the region at a SPECIFIC SPOT. The user is asked to click a point
     * on the slide, then that region is segmented and drawn as a polygon
     * annotation. Requires a driver implementing the "segment" feature (e.g. the
     * Segment Anything plugin). For segmenting ALL tissue use annotateTissue
     * instead. May ask for permission if the driver is remote. Check \`status\` in
     * the result: "empty" means nothing segmentable was found (a genuine negative),
     * while "rejected-oversegmented" means the run FAILED validation — do not present
     * it as a finding about the tissue.
     * @param prompt optional guidance, e.g. "tumour gland".
     * @param driver optional segment driver id.
     */
    segmentAtPoint(prompt?: string, driver?: string): Promise<SegmentResult>;

    /**
     * Send a slide snapshot plus \`prompt\` to a vision/analysis model and return its
     * findings as text. Requires an "analyze" driver. Asks the user for permission
     * (the snapshot leaves the viewer).
     *
     * WITHOUT \`options.region\` it snapshots what the user CURRENTLY SEES (their live
     * viewport, overlays included) — the right and cheap answer to "what am I looking
     * at?" / "what is this?".
     *
     * WITH \`options.region\` (parent-global image-pixel bbox, e.g. from exploreSlide or
     * getOverview) the region is rendered OFF-SCREEN through the same pipeline the user
     * sees — the user's viewport is NOT moved, so you can inspect any part of the slide
     * while the user keeps navigating. Request only the resolution you need: a small
     * patch is much cheaper than a full frame (\`magnification\` sets the objective
     * magnification, e.g. 20, or \`targetPixels\` bounds the raster area — default ≈2MP).
     * Region renders exclude annotation overlays. Check \`isComplete\` on the result:
     * false means tiles were still loading and the findings are provisional.
     *
     * ONE vision call either way. Prefer it over any slide-wide scan whenever the
     * question is about a single view or region.
     *
     * THIS IS THE ZOOM. Inside a task the user has already asked for, needing a closer look
     * is not a decision to hand back to them: "the resolution was insufficient", "this needs
     * high-power review", "I recommend inspecting region 3" are all instructions to call
     * this again with a tighter \`region\` and a higher \`magnification\` — not sentences to
     * put in an answer. Ask the user only for something they know and you cannot measure
     * (what the specimen is, what they want examined), never for permission to look closer.
     *
     * Whatever has been established about the slide (see \`getSlideContext\`) is attached
     * automatically, together with the MEASURED scale and resolution of the raster that is
     * sent. Two calls on the same tissue therefore share one frame of reference — the reason
     * an ungrounded drill can otherwise contradict the previous one with equal confidence.
     * Pass \`raw: true\` only if you deliberately want an unframed prompt.
     * @param prompt the question/instruction for the model.
     * @param options optional driver id (string, back-compat) or options object.
     */
    analyzeRegion(prompt: string, options?: string | {
        /** Optional analyze driver id. */
        driver?: string;
        /** Parent-global image-pixel bbox to render off-screen; omit to snapshot the user's current view. */
        region?: Bounds;
        /** Render magnification for \`region\` (e.g. 20). Clamped to native resolution and a size cap. */
        magnification?: number;
        /** Alternative to magnification: approximate raster pixel budget for \`region\` (default ~2,000,000). */
        targetPixels?: number;
        /**
         * "composite" (default): with no region, the on-screen view incl. overlays; with a
         * region, the user's ACTIVE visualization (no annotation overlays).
         * "background": the raw slide image only.
         */
        source?: "composite" | "background";
        /**
         * Target resolution in µm per delivered pixel — the precise way to ask for detail.
         * Unlike \`magnification\`/\`targetPixels\`, which the render may quietly clamp, this
         * is DELIVERED: a region too large to carry at this resolution is sampled instead
         * of squashed, and \`coveredFraction\` then says how much of it was read.
         */
        mpp?: number;
        /** Send \`prompt\` verbatim, without the slide-context/scale preamble. Rarely wanted. */
        raw?: boolean;
    }): Promise<AnalysisResult>;

    /**
     * Ask SPECIFIC questions about one region and get TYPED answers back.
     *
     * **This is the call for "check X in region N".** Prefer it over \`analyzeRegion\`
     * whenever the question is a checklist rather than "describe this": you get one answer
     * per question, each with its own confidence, instead of prose you then have to
     * interpret and may truncate.
     *
     * It TILES the region itself at the resolution the questions need, so never hand-split
     * a region and never loop this over sub-boxes yourself. \`coveredFraction\` below 1
     * means the region was sampled rather than fully covered — say so if you report it.
     *
     * **\`present: "not-assessable"\` is NEVER a negative finding.** It means the image at
     * that resolution could not show the feature. Reporting it as "absent" or "not seen"
     * is wrong and is the single most important mistake to avoid with this result.
     */
    interrogateRegion(region: Bounds, options?: {
        /** The features to establish. Each carries the µm/px needed to judge it. */
        features?: ChecklistFeature[];
        /** Simpler alternative: plain questions, asked at the finest resolution available. */
        questions?: string[];
        /** Target resolution in µm/px. Defaults to the finest any supplied feature needs. */
        mpp?: number;
        /** Fields to read (default 4). More covers more of the region and costs more calls. */
        maxFields?: number;
        driver?: string;
    }): Promise<InterrogationResult>;

    /**
     * Score or compare SEVERAL regions in ONE vision call.
     *
     * Use this before spending a call per region: triaging a dozen candidates individually
     * would consume most of an overview's budget, and as a montage it costs one call. The
     * model also sees the fields side by side, which is the only way it can tell you that
     * one of them is unlike the others.
     *
     * Each region is drawn as a separate labelled cell (\`A1\`, \`B2\`, …) with gutters
     * between them; the result maps every cell label back to the region you passed in.
     */
    montageRegions(regions: Array<Bounds | { bounds: Bounds; label?: string }>, options?: {
        /** A free-text question about the set. Ignored when \`features\` is given. */
        prompt?: string;
        /** Ask the same typed checklist of every cell. */
        features?: ChecklistFeature[];
        /** Grid columns (default: roughly square). */
        cols?: number;
        /** Resolution each cell is rendered at, in µm/px. Defaults to a survey-level view. */
        mpp?: number;
        driver?: string;
    }): Promise<MontageResult>;

    /**
     * Where the nuclei are, as a coarse normalized grid over the slide.
     *
     * **FREE — local, deterministic, no model call.** Consult it BEFORE committing a vision
     * budget: it tells you which tissue is cell-dense, and "biggest tissue island" cannot
     * distinguish a large bland region from a small dense one. \`top(n)\` gives the densest
     * spots directly as boxes you can hand to \`interrogateRegion\` or \`montageRegions\`.
     *
     * \`method: "saturation-fallback"\` means the slide's stain class made nuclear unmixing
     * meaningless, so the values rank stain intensity — still a useful ordering, but not a
     * statement about nuclei.
     */
    buildDensityMap(options?: {
        driver?: string;
        /** Grid cell size in survey-raster pixels (default 16). */
        cell?: number;
        /** Recompute instead of reusing the cached map. */
        refresh?: boolean;
    }): Promise<DensityMap>;

    /**
     * What has been established about the current slide, or null. FREE — no model call.
     *
     * Check it BEFORE asking the user what the specimen is: the answer is remembered per
     * slide, so a question they already answered must not be asked again by the next job.
     */
    getSlideContext(): SlideContext | null;

    /**
     * Remember what the slide is, for every later call on it.
     *
     * Call it the moment the user tells you ("prostate needle biopsy, H&E") — before, or
     * together with, the walk. Everything afterwards (buildOverview, every analyzeRegion
     * drill) is then grounded in it, and nothing asks again. Set \`stainClass\` from what
     * they describe: it is what decides which claims the vision model is allowed to make.
     */
    setSlideContext(context: SlideContext): SlideContext;

    /**
     * Ask the user to click a point on the ACTIVE viewer; returns its image
     * coordinates, or null if canceled.
     * @param message optional prompt text.
     */
    pickPoint(message?: string): Promise<ViewerPoint | null>;

    /** The annotation the user currently has selected on the ACTIVE viewer, or null. */
    getSelectedAnnotation(): SelectedAnnotation;

    /**
     * Return the currently selected annotation id, or ask the user to select one
     * and wait for it. Null if canceled.
     * @param message optional prompt text.
     */
    requestAnnotationSelection(message?: string): Promise<string | number | null>;
}
`;

const MODULE_ID = "pathology-foundation";

/**
 * Build and register the `pathology` scripting namespace. Called once from
 * index.ts at bundle-eval time.
 */
export function registerPathologyScriptingApi(): void {
    const ScriptingManager = (globalThis as any).ScriptingManager;
    if (!ScriptingManager?.registerExternalApi || !ScriptingManager?.XOpatScriptingApi) {
        console.warn("[pathology-foundation] ScriptingManager unavailable; scripting namespace not registered.");
        return;
    }

    const ScriptApiBase = ScriptingManager.XOpatScriptingApi as {
        new (namespace: string, name: string, description: string): any;
    };

    const t = (key: string, opts?: any): string => (globalThis as any).$?.t?.(key, opts) ?? key;

    class XOpatPathologyScriptApi extends ScriptApiBase {
        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: PATHOLOGY_DTS },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "Pathology foundation models",
                "Run concrete pathology jobs on the current slide instead of guessing.\n\n" +
                "Slide-wide jobs (exploreSlide, reviewRegions, buildOverview, region-scoped analyzeRegion) " +
                "render regions OFF-SCREEN through the same pipeline the user sees — they NEVER move the " +
                "user's viewport, so the user keeps navigating freely while they run. Only offer navigation " +
                "(viewer.frameImageRegion) as a follow-up; never navigate to 'show' the model something.\n\n" +
                "SCANNING IS EXPENSIVE — RUN IT ONLY WHEN THE USER ASKS FOR IT. buildOverview and " +
                "reviewRegions fire many slow vision calls; a single overview can take MINUTES. They are " +
                "never a way to 'have a look first', to check your answer, to enrich a reply, or to seem " +
                "thorough. Run one ONLY when the user's own message asks about the slide's content — to " +
                "explore, scan, survey, walk it, find/rank regions, or report what is on it. If the user " +
                "asked something else — or you are merely unsure whether they want a scan — do NOT start " +
                "one: answer what you can and offer the scan in one short sentence, letting them say yes. " +
                "Never scan speculatively, never re-scan a slide you have already scanned, and never chain " +
                "a scan onto an unrelated request.\n\n" +
                "THAT BRAKE IS ABOUT SLIDE-WIDE SCANS, NOT ABOUT LOOKING. Once the user HAS asked for " +
                "something on the slide, carry it out: a single analyzeRegion — including a tighter, " +
                "higher-magnification one on a region you could not read — is part of the task they " +
                "already authorised, not a new one to seek permission for. 'I need higher magnification' " +
                "is an instruction to call analyzeRegion again, never a question to put to the user. Ask " +
                "them only for what they know and you cannot measure (what the specimen is, what they " +
                "want examined) — ask it ONCE, up front, bundled, and remember it with setSlideContext.\n\n" +
                "Costs, cheapest first. FREE, no model call: getOverview (a cached tree — always try it " +
                "before considering a scan), getSlideContext, and buildDensityMap (where the cells are; " +
                "consult it before committing to an expensive scan). LOCAL, in-browser on the raw slide, " +
                "nothing leaves the viewer: annotateTissue, tissueCoverage, exploreSlide. ONE vision call: " +
                "analyzeRegion, and montageRegions however many regions it is given. A FEW vision calls: " +
                "interrogateRegion, reviewRegions. MANY, and minutes of wall-clock: buildOverview.\n\n" +
                "What each does: exploreSlide surveys the whole slide off-screen and returns the ranked " +
                "tissue islands (a bbox each) plus whole-slide coverage — offer navigation only to those " +
                "with viewer.frameImageRegion(region.bounds), never to guessed/empty coordinates. " +
                "buildOverview surveys the tissue, then spends its budget on the most promising regions, " +
                "and returns an EVIDENCE TABLE keyed by the questions derived from your query. " +
                "interrogateRegion asks specific questions about ONE region at a resolution that can " +
                "answer them, tiling it itself. montageRegions compares SEVERAL regions in a single call. " +
                "getSlideContext/setSlideContext remember what the specimen is, once per slide, so every " +
                "later call is grounded and the user is asked only once. reviewRegions goes through the " +
                "tissue region by region. annotateTissue outlines ALL tissue in the CURRENT VIEW; " +
                "tissueCoverage(annotationId?) measures how much of a region is tissue AND what fraction " +
                "of the visible tissue lies in it. segmentAtPoint outlines a SPECIFIC spot (the user " +
                "clicks it). Select the viewer with application.setActiveViewer before calling.\n\n" +
                "ANSWERS ARE TYPED, AND 'not-assessable' IS NOT A NEGATIVE. It means the image at that " +
                "resolution could not show the feature — never report it as absent, not seen, or " +
                "negative. Reporting an unassessed feature as absent is the most damaging mistake " +
                "available here.\n\n" +
                "NAMING REGIONS: every region carries a `label` ('region 1', 'region 2.1') — that is the " +
                "only name to put in an answer or a region link. `index` and `depth` are 0-based array " +
                "internals; never print them, and never number regions or levels from 0 to the user.",
            );
        }

        // Registration happens at bundle-eval, but the module singleton this
        // namespace proxies is resolved lazily and may be absent (module disabled).
        // Reporting availability lets the manifest builder drop the namespace so the
        // chat LLM is not offered pathology tools it cannot actually run.
        isAvailable(): boolean {
            return !!(globalThis as any).singletonModule?.(MODULE_ID);
        }

        _getModule(): any {
            const instance = (globalThis as any).singletonModule?.(MODULE_ID);
            if (!instance) {
                throw new Error("The pathology-foundation module is not available. Enable it first.");
            }
            return instance;
        }

        /**
         * Consent only when the resolved driver is remote (a snapshot would leave
         * the viewer). A grant is remembered per driver+feature for the rest of the
         * session so a multi-step workflow (annotateTissue → tissueCoverage → ...)
         * prompts once, not per call. Deployments can force per-call prompting via
         * the `alwaysAskRemoteConsent` static meta (ENV — a session bundle cannot
         * flip it).
         */
        async _consentIfRemote(
            feature: string,
            driverId: string | undefined,
            task: string,
            extraDetails: string[] = [],
            /**
             * Distinguishes a grant for THIS kind of work from other uses of the same
             * feature. Without it, approving one cheap snapshot would silently
             * pre-authorize a multi-call slide sweep for the rest of the session — the
             * user consented to a very different cost than the one they'd get.
             */
            scope?: string
        ): Promise<void> {
            const module = this._getModule();
            const info = module.describeDriverForFeature(feature, driverId);
            if (info?.local) return;
            const alwaysAsk = module.getStaticMeta?.("alwaysAskRemoteConsent", false);
            const key = `pathology:${feature}:${info?.id || "default"}${scope ? `:${scope}` : ""}`;
            await this.requireActionConsent({
                title: t("pathology.consentTitle"),
                description: t("pathology.consentDescription"),
                details: [
                    t("pathology.consentDriver", { driver: info?.label || info?.id || "(default)" }),
                    t("pathology.consentTask", { task }),
                    ...extraDetails,
                ],
                mode: "warning",
                confirmLabel: t("pathology.consentConfirm"),
                rejectedMessage: t("pathology.consentRejected"),
                cacheKey: alwaysAsk ? undefined : key,
            });
        }

        // ---- slide context resolution (adapter-owned; see the security note below) ----

        /**
         * The `patient` scripting namespace, bound to this call's viewer context.
         *
         * Lives HERE and not in the module on purpose. That namespace is marked
         * `sensitive` and is deliberately withheld from the assistant's default grants so
         * it can be granted and revoked on its own; the module reaching it in-process
         * would bypass that decision silently. The adapter is the layer that already owns
         * consent, so it is the only layer allowed to touch it — and it never passes what
         * it reads any further than {@link _matchVocabulary}.
         */
        _patientApiForActiveViewer(): any {
            const manager = (globalThis as any).APPLICATION_CONTEXT?.Scripting;
            const base = manager?.getApi?.("patient");
            if (!base?.bindInvocationContext) return null;
            const uid = this.activeViewer?.uniqueId;
            return base.bindInvocationContext({
                scriptingContext: {
                    id: `__pathology_context_${uid}__`,
                    getActiveViewerContextId: () => uid,
                    activeViewerContextId: uid,
                    isConsentDialogBypassed: () => false,
                },
            });
        }

        /**
         * Resolve what is known about the slide: explicit → remembered → derived → unknown.
         *
         * Never guesses. When nothing resolves the result says so, and the caller is asked
         * before any budget is spent — an unstated fact is one a vision model will invent.
         *
         * Anything established is remembered against the slide, so the question is asked once
         * per slide rather than once per job. Without that, every drill re-derives (and every
         * walk re-asks) something the user already answered two calls ago.
         */
        async _resolveContext(context: any): Promise<any> {
            const module = this._getModule();
            const viewer = this.activeViewer;

            // "unknown" is the caller explicitly accepting a blind walk (the user was asked
            // and could not say). It is NOT the same as having failed to establish anything,
            // so it carries the acknowledgement that suppresses the ask.
            if (context === "unknown") {
                return module.setSlideContext(viewer, { source: "unknown", acknowledgedUnknown: true });
            }

            // A human's own words are authoritative and are never checked against the
            // vocabulary — a stain the deployment has never heard of must still get through.
            // A partial answer ("H&E, site unknown") is still an answer: it proceeds, and the
            // preamble simply forbids naming whatever is still missing.
            if (context && typeof context === "object") {
                return module.setSlideContext(viewer, {
                    ...context, source: context.source || "explicit", acknowledgedUnknown: true,
                });
            }
            if (context !== undefined && context !== "auto") return { source: "unknown" };

            const remembered = module.getSlideContext(viewer);
            if (remembered) return remembered;
            try {
                const derived = await this._deriveContext();
                return derived?.source === "unknown" ? derived : module.setSlideContext(viewer, derived);
            } catch (_) {
                return { source: "unknown" };
            }
        }

        /**
         * Derive stain/site from patient-sensitive sources through a closed vocabulary.
         *
         * The safety property is that this function can only ever EMIT a `label` from the
         * configured vocabulary. Unmatched text is not sanitized or truncated — it is never
         * emitted at all, so identifiers in a file name cannot leak no matter how the
         * vocabulary grows. Nothing read here is returned raw.
         */
        async _deriveContext(): Promise<any> {
            const patient = this._patientApiForActiveViewer();
            if (!patient) return { source: "unknown" };

            const haystack: string[] = [];
            try {
                const meta = patient.getPatientMetadata?.();
                if (meta && typeof meta === "object") haystack.push(...Object.values(meta).map(v => String(v ?? "")));
            } catch (_) { /* sensitive source unavailable — stay unknown */ }
            try {
                haystack.push(String(patient.getSlidePaths?.()?.fileName ?? ""));
            } catch (_) { /* ignore */ }
            try {
                const channels = (globalThis as any).APPLICATION_CONTEXT?.Scripting?.getApi?.("viewer");
                const names = channels?.getMetadata?.()?.channels;
                if (Array.isArray(names)) haystack.push(...names.map((c: any) => String(c?.name ?? "")));
            } catch (_) { /* ignore */ }

            const vocabulary = this._getModule().getStaticMeta?.("contextVocabulary", null) || {};
            const stain = this._matchVocabulary(haystack, vocabulary.stains);
            const organ = this._matchVocabulary(haystack, vocabulary.organs);
            if (!stain && !organ) return { source: "unknown" };
            return {
                stain: stain?.label,
                stainClass: stain?.class,
                targets: stain?.targets,
                organ: organ?.label,
                source: "derived",
            };
        }

        /** First vocabulary entry whose `match` aliases appear as a whole token in `haystack`. */
        _matchVocabulary(haystack: string[], entries: any): any | null {
            if (!Array.isArray(entries)) return null;
            const tokens = new Set<string>();
            for (const value of haystack) {
                for (const token of String(value).toLowerCase().split(/[^a-z0-9&+-]+/)) {
                    if (token) tokens.add(token);
                }
            }
            for (const entry of entries) {
                const aliases = Array.isArray(entry?.match) ? entry.match : [];
                if (aliases.some((a: any) => tokens.has(String(a).toLowerCase()))) return entry;
            }
            return null;
        }

        /** One consent line showing exactly what slide context the model will be told. */
        _contextConsentDetail(context: any): string {
            const parts = [context?.stain, context?.organ].filter(Boolean);
            return parts.length
                ? t("pathology.consentContext", { context: parts.join(", ") })
                : t("pathology.consentContextUnknown");
        }

        // ---- read / interactive (no consent) ----

        listDrivers(): any {
            return this._getModule().listDrivers();
        }

        async pickPoint(message?: string): Promise<any> {
            return this._getModule().pickViewportPoint(this.activeViewer, message ? { message } : undefined);
        }

        getSelectedAnnotation(): any {
            const id = this._getModule().getSelectedAnnotationId(this.activeViewer);
            return id === null ? null : { id };
        }

        async requestAnnotationSelection(message?: string): Promise<any> {
            return this._getModule().awaitAnnotationSelection(this.activeViewer, message ? { message } : undefined);
        }

        // ---- orientation (local geometry; consent only for the optional hint) ----

        async exploreSlide(options?: {
            driver?: string;
            annotate?: boolean;
            hint?: boolean;
            minAreaFraction?: number;
        }): Promise<any> {
            const module = this._getModule();
            if (options?.hint) {
                await this._consentIfRemote("analyze", options?.driver, "whole-slide overview hint");
            }
            // Shaped for the model on the way out, exactly like buildOverview/getOverview.
            // Without this the region list ships raw engine doubles — bounds like
            // 12345.678901234567 where 12346 is the whole-pixel value a region link
            // actually uses — and the region count is unbounded, so a fragmented slide
            // spent thousands of tokens on float noise. The cached geometry keeps its
            // full precision; this is a view, not a mutation.
            return forPresentation(await module.exploreSlide(this.activeViewer, options || {}));
        }

        async reviewRegions(options?: {
            regions?: any[];
            max?: number;
            magnification?: number;
            feature?: string;
            prompt?: string;
            driver?: string;
        }): Promise<any> {
            const module = this._getModule();
            options = options || {};
            options.feature = options?.feature || "analyze";
            // Scoped: a multi-region walk is a different ask than one snapshot.
            await this._consentIfRemote(
                options.feature, options.driver, "review tissue regions → findings", [], "review"
            );
            return module.reviewRegions(this.activeViewer, options || {});
        }

        async buildOverview(options?: any): Promise<any> {
            const module = this._getModule();
            // Resolve context BEFORE anything else. It is local (nothing leaves the viewer),
            // and every later step depends on it: the walk is only worth running once we
            // know what the slide is.
            const context = await this._resolveContext(options?.context);

            // Refuse to spend the vision budget on a blind walk. A run costs many slow
            // model calls, and one that does not know the stain or site produces findings
            // the caller must then discard — so ask FIRST and walk once, informed, rather
            // than walking twice. The caller can proceed anyway with context: "unknown".
            const missing = this._missingContextFields(context);
            if (missing.length) {
                return { status: "context-required", context, missing };
            }

            // One consent for the whole recursive run (it fires many analyze calls); the
            // dialog shows the user exactly what slide context will be sent with it.
            // Scoped to "overview" so a grant for a single snapshot never stands in for
            // approval of a minutes-long, many-call sweep.
            await this._consentIfRemote("analyze", options?.driver, "recursive expert overview", [
                this._contextConsentDetail(context),
            ], "overview");

            // Turn the question into the schema the whole run obeys. Derivation lives HERE,
            // not in the engine: it needs a chat model, and the engine must stay usable by
            // a plugin or script with no chat model present.
            const checklist = options?.checklist || options?.features
                ? undefined
                : await this._deriveChecklist(options?.query, context);

            // Shaped for the model on the way out: whole-pixel geometry (what a region
            // link needs), short numbers and capped prose. The cached tree keeps its full
            // precision — this is a view, not a mutation.
            return forPresentation(await module.buildOverview(this.activeViewer, {
                ...(options || {}),
                context,
                ...(checklist ? { checklist } : {}),
            }));
        }

        /**
         * Ask the assistant's own model to turn the reviewer's question into a small set of
         * named features, each with the resolution needed to judge it.
         *
         * A text-only call — no image, no session, no history — so it is cheap and cannot
         * touch the chat transcript. Returns null on any failure, and the engine then falls
         * back to its generic checklist: a worse run, flagged in `warnings`, but a run.
         *
         * The result is model-written text bound for another model's prompt, so it is
         * sanitized here (and again in the engine) rather than trusted.
         */
        async _deriveChecklist(query: string | undefined, context: any): Promise<any> {
            if (!query || !String(query).trim()) return null;
            try {
                const chat = (globalThis as any).singletonModule?.("vercel-ai-chat-sdk");
                const ref = chat?.getAssistantTextModel?.();
                const rpc = (globalThis as any).xserver?.module?.["vercel-ai-chat-sdk"];
                if (!ref?.providerId || !rpc?.runVisionInference) return null;

                const res = await rpc.runVisionInference({
                    providerId: ref.providerId,
                    model: ref.modelId || null,
                    system: $.t("pathology.checklistSystem"),
                    prompt: $.t("pathology.checklistPrompt", {
                        query: String(query).slice(0, 500),
                        stain: context?.stain || $.t("pathology.checklistUnknownValue"),
                        organ: context?.organ || $.t("pathology.checklistUnknownValue"),
                    }),
                    maxOutputTokens: 512,
                }, { priority: "background" });

                const parsed = this._parseChecklistJson(res?.text);
                return parsed ? { features: parsed, source: "derived", query } : null;
            } catch (e) {
                console.warn("[pathology] checklist derivation unavailable; using the generic fallback.", e);
                return null;
            }
        }

        /** The last JSON array in a model's reply, or null. Never throws. */
        _parseChecklistJson(text: any): any[] | null {
            if (typeof text !== "string" || !text.trim()) return null;
            const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
            const candidates = fenced.length ? [fenced[fenced.length - 1][1]] : [];
            const open = text.indexOf("["), close = text.lastIndexOf("]");
            if (open >= 0 && close > open) candidates.push(text.slice(open, close + 1));
            for (const body of candidates) {
                try {
                    const data = JSON.parse(body);
                    const list = Array.isArray(data) ? data : data?.features;
                    if (Array.isArray(list) && list.length) return list;
                } catch { /* try the next candidate */ }
            }
            return null;
        }

        /**
         * Which context fields are still unestablished. Empty once the caller has either
         * supplied them, had them derived, or explicitly accepted running without them.
         */
        _missingContextFields(context: any): string[] {
            if (context?.acknowledgedUnknown) return [];
            const missing: string[] = [];
            if (!context?.stain) missing.push("stain");
            if (!context?.organ) missing.push("organ");
            return missing;
        }

        getOverview(): any {
            return forPresentation(this._getModule().getOverview(this.activeViewer));
        }

        clearOverview(): void {
            this._getModule().clearOverview(this.activeViewer);
        }

        // ---- tissue jobs (built-in driver is local → usually no consent) ----

        async annotateTissue(driver?: string): Promise<any> {
            const module = this._getModule();
            await this._consentIfRemote("tissue-mask", driver, "detect tissue → annotations");
            return module.annotateTissue(this.activeViewer, { driver });
        }

        async tissueCoverage(annotationId?: string | number, driver?: string): Promise<any> {
            const module = this._getModule();
            const viewer = this.activeViewer;
            let id = annotationId;
            if (id === undefined || id === null) {
                id = await module.awaitAnnotationSelection(viewer);
                if (id === null || id === undefined) {
                    throw new Error("No annotation was selected; tissue coverage canceled.");
                }
            }
            await this._consentIfRemote("tissue-mask", driver, "tissue coverage of an annotation");
            return module.tissueCoverage(viewer, id, { driver });
        }

        // ---- point-driven segmentation (interactive) + analysis ----

        async segmentAtPoint(prompt?: string, driver?: string): Promise<any> {
            const module = this._getModule();
            const viewer = this.activeViewer;
            const point = await module.pickViewportPoint(viewer);
            if (!point) throw new Error("No point was selected; segmentation canceled.");
            await this._consentIfRemote("segment", driver, "segmentation → annotation");
            return module.segmentAtPoint(viewer, { prompt: prompt || "", driver, point });
        }

        async analyzeRegion(
            prompt: string,
            options?: string | {
                driver?: string;
                region?: any;
                magnification?: number;
                targetPixels?: number;
                source?: "composite" | "background";
                raw?: boolean;
            }
        ): Promise<any> {
            const module = this._getModule();
            const opts = typeof options === "string" ? { driver: options } : (options || {});
            await this._consentIfRemote("analyze", opts.driver, "image analysis → findings");

            // Ground the call in whatever is already established about the slide. This never
            // ASKS (that belongs to the walk, which is what the budget hangs on) — it only
            // reuses what is known, so a drill inherits the stain licence and the measured
            // scale instead of being a blind snapshot the model narrates from scratch.
            const context = opts.raw ? null : module.getSlideContext(this.activeViewer);

            // Whitelist the fields — engine-internal knobs (preRead) must not be reachable
            // from scripts.
            return module.analyzeRegion(this.activeViewer, {
                prompt: prompt || "",
                driver: opts.driver,
                source: opts.source,
                region: opts.region,
                magnification: opts.magnification,
                targetPixels: opts.targetPixels,
                ...(typeof (opts as any).mpp === "number" ? { mpp: (opts as any).mpp } : {}),
                ...(context ? { context } : {}),
                ...(opts.raw ? { raw: true } : {}),
            });
        }

        /**
         * Ask specific questions about one region, at a resolution that can answer them.
         *
         * Scoped consent: an interrogation reads several fields at high power, which is a
         * different cost class from the single snapshot `analyzeRegion` approves. A grant
         * for one must not stand in for the other (see `_consentIfRemote`).
         */
        async interrogateRegion(region: any, options?: any): Promise<any> {
            const module = this._getModule();
            const opts = options || {};
            const context = module.getSlideContext(this.activeViewer);
            await this._consentIfRemote("analyze", opts.driver, "targeted region interrogation", [
                $.t("pathology.consentInterrogate", { fields: Math.max(1, opts.maxFields ?? 4) }),
                ...(context ? [this._contextConsentDetail(context)] : []),
            ], "interrogate");

            // Whitelisted: `signal` and every engine-internal knob stay unreachable.
            return module.interrogateRegion(this.activeViewer, {
                region,
                ...(Array.isArray(opts.features) ? { features: opts.features } : {}),
                ...(Array.isArray(opts.questions) ? { questions: opts.questions } : {}),
                ...(typeof opts.mpp === "number" ? { mpp: opts.mpp } : {}),
                ...(typeof opts.maxFields === "number" ? { maxFields: opts.maxFields } : {}),
                ...(opts.driver ? { driver: opts.driver } : {}),
                ...(context ? { context } : {}),
            });
        }

        /**
         * Compare several regions in ONE vision call.
         *
         * Cheaper than looking at them one at a time by roughly the number of regions, and
         * the model sees them side by side — which is the only way it can say that one is
         * unlike the others.
         */
        async montageRegions(regions: any[], options?: any): Promise<any> {
            const module = this._getModule();
            const opts = options || {};
            const count = Array.isArray(regions) ? regions.length : 0;
            const context = module.getSlideContext(this.activeViewer);
            await this._consentIfRemote("analyze", opts.driver, "composite comparison of several regions", [
                $.t("pathology.consentMontage", { count }),
                ...(context ? [this._contextConsentDetail(context)] : []),
            ], "montage");

            return module.montageRegions(this.activeViewer, {
                regions,
                ...(typeof opts.prompt === "string" ? { prompt: opts.prompt } : {}),
                ...(Array.isArray(opts.features) ? { features: opts.features } : {}),
                ...(typeof opts.cols === "number" ? { cols: opts.cols } : {}),
                ...(typeof opts.cellPixels === "number" ? { cellPixels: opts.cellPixels } : {}),
                ...(typeof opts.mpp === "number" ? { mpp: opts.mpp } : {}),
                ...(opts.driver ? { driver: opts.driver } : {}),
                ...(context ? { context } : {}),
            });
        }

        /**
         * Where the nuclei are, as a coarse grid. FREE — local, deterministic, no model
         * call — so it is the right thing to consult before spending a vision budget.
         */
        async buildDensityMap(options?: any): Promise<any> {
            const module = this._getModule();
            const opts = options || {};
            // A no-op for the built-in (local) implementation; a deployment that binds a
            // remote nuclei detector to this feature gets the prompt it deserves.
            await this._consentIfRemote("cellularity", opts.driver, "local cell-density map");
            const map = await module.buildDensityMap(this.activeViewer, {
                ...(opts.driver ? { driver: opts.driver } : {}),
                ...(typeof opts.cell === "number" ? { cell: opts.cell } : {}),
                ...(opts.refresh ? { refresh: true } : {}),
            });
            // Cross the script bridge as plain data plus the two reads worth having; a
            // Float32Array and bound methods do not survive the boundary intact.
            return {
                bounds: map.bounds,
                width: map.width,
                height: map.height,
                method: map.method,
                values: Array.from(map.values as Float32Array),
                top: (n: number) => map.top(n),
                sample: (b: any) => map.sample(b),
            };
        }

        getSlideContext(): any {
            return this._getModule().getSlideContext(this.activeViewer);
        }

        setSlideContext(context: any): any {
            if (!context || typeof context !== "object") {
                throw new Error("setSlideContext() requires an object, e.g. { stain: 'H&E', organ: 'prostate' }.");
            }
            return this._getModule().setSlideContext(this.activeViewer, {
                ...context,
                source: context.source || "explicit",
                acknowledgedUnknown: true,
            });
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatPathologyScriptApi("pathology")),
        { label: "pathology" },
    );
}
