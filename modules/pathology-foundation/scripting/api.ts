/// <reference path="../../../src/types/globals.d.ts" />

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
};

/** One connected tissue island found by exploreSlide. */
export type SlideRegion = {
    /** 0-based rank; region 0 is the largest island. */
    index: number;
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
    index: number;
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
    /** Rank among siblings (largest tissue island first). */
    index: number;
    /** Recursion depth (0 = a whole-slide tissue island). */
    depth: number;
    /** Parent-global image-space bbox — feed to viewer.frameImageRegion(bounds). */
    bounds: Bounds;
    center: ViewerPoint;
    /** Magnification ACTUALLY achieved for this node, or null when the slide gives no basis. */
    magnification: number | null;
    /** Area fraction — of the whole slide at depth 0, of the framed parent below. NOT comparable across depths. */
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
        source: "contract" | "normalized" | "keyword" | "unparsed";
        /** The scale assumed when source is "normalized" (e.g. 5 = the model answered out of 5). */
        scoreScale?: number;
    };
    /** Composite rank (interest weighted by ancestors, confidence, slide area, tissue fill). Order of 'ranked'. */
    rankScore?: number;
    /** drill = recursed into; stop = pruned; leaf = interesting but hit the depth cap. */
    decision: "drill" | "stop" | "leaf";
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
     * Each node.bounds is a tight, navigable window — do NOT link the coarse depth-0 boxes.
     */
    ranked: OverviewNode[];
    /** Optional local digest of the highest-interest findings (only when synthesize:true). */
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
    /** Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience. */
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
    /** On-screen magnification per depth; null = fit region (default [null, 10, 20]). */
    magnificationLadder?: Array<number | null>;
    /** Drill only when interest is at least this (default 0.5). */
    interestThreshold?: number;
    /** Hard cap on vision calls for the whole run (default 12). */
    maxAnalyzeCalls?: number;
    /** Hard cap on regions visited for the whole run (default 24). */
    maxNodes?: number;
    /** Draw visited regions as annotations (default false). */
    annotate?: boolean;
    /** Attach a local findings digest as summary (default false). */
    synthesize?: boolean;
    /** Return the cached overview (if any) instead of rebuilding (default false). */
    reuse?: boolean;
    driver?: string;
};

export interface PathologyScriptApi extends ScriptApiObject {
    /** List the configured drivers and which features each can perform. */
    listDrivers(): PathologyDriverInfo[];

    /**
     * Fit the whole slide, detect tissue, and return the ranked tissue islands
     * (\`regions\`, largest first) plus whole-slide \`slideCoverage\` and slide metadata.
     *
     * Use this to orient BEFORE acting on the slide — but only once you are already acting
     * on it at the user's request. It refits the whole slide and waits for tiles, so it is
     * not free: do not call it to answer a question that is not about where the tissue is,
     * and do not call it "just to look".
     *
     * Navigate to a result with \`viewer.frameImageRegion(regions[i].bounds)\`
     * — never zoom to guessed coordinates. If \`isComplete\` is false the overview ran on
     * partially-loaded tiles: report the numbers as provisional, do not assert the slide
     * is blank. Otherwise, if \`slideCoverage\` is ~0 or \`regions\` is empty, the slide
     * looks blank; say so instead of hunting. \`slideCoverage\` is WHOLE-SLIDE (contrast
     * annotateTissue's \`viewCoverage\`, which is current-view). The overview is
     * low-resolution, so bounds are approximate — re-run annotateTissue after framing
     * a region for a precise outline. The user's view is restored afterwards.
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
     * Walk the top tissue regions and run one job on each, framing every region in
     * turn (optionally at a target \`magnification\`). \`feature\` is "analyze"
     * (vision→text findings per region, default) or "tissue-mask" (per-region tissue
     * coverage). When \`regions\` is omitted, exploreSlide supplies them.
     *
     * ONLY on an explicit request to go through / review the tissue. With feature
     * "analyze" this is several slow vision calls and drives the viewport around the
     * slide — never run it to enrich an answer the user did not ask for. For a visual
     * question about the CURRENT view, use analyzeRegion (one call) instead.
     *
     * Asks the user once when analyzing. The user's view is restored afterwards.
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
     * RUN IT ONLY WHEN THE USER EXPLICITLY ASKS FOR A SLIDE-WIDE EXPLORATION: "walk me
     * through the slide", "find/rank the interesting regions", "where are the areas with
     * X", "survey the tissue". It drives the viewport across the slide and fires up to a
     * dozen slow vision calls — MINUTES of work the user is waiting on. That cost is only
     * ever justified by them asking for it.
     *
     * Do NOT run it: to answer a question that is not a slide-wide hunt; to check or enrich
     * something you could answer from the current view (use analyzeRegion — one call); to
     * gather background before a different task; because a scan "might help"; or on a slide
     * you have already scanned this session (use getOverview). If you think a scan would
     * help but the user did not ask, say so in one sentence and let them decide — do not
     * start it and do not ask twice.
     *
     * When it IS wanted: it orients (exploreSlide), then walks the top tissue islands,
     * describes each with the vision model, scores them, and drills into the interesting
     * ones at higher magnification — on a budget. Pass \`query\` with the feature you are
     * hunting for so the walk is steered toward it. The whole tree is CACHED per slide:
     * call \`getOverview()\` first and only build when it is absent or genuinely no longer
     * fits the question (\`reuse: true\` returns the cache).
     * Navigate to any node with \`viewer.frameImageRegion(node.bounds)\`. Findings are
     * model-assisted observations, never a diagnosis. Needs an \`analyze\` driver and asks
     * the user ONCE for the whole run (it fires many analyze calls). The view is restored.
     * If \`budget.truncated\` is true a cap stopped the walk early — say the overview is partial.
     *
     * CHECK \`status\` FIRST. If it is "context-required" the walk did NOT run and nothing
     * was analysed: the viewer could not establish what the slide is, and refuses to spend
     * the (slow, expensive) vision budget guessing. Ask the user for the \`missing\` fields
     * in ONE bundled question, then call again with \`context\` set — that single informed
     * walk is the whole point. Only if they cannot say, call again with context: "unknown".
     * A vision model told nothing about the slide invents it: it names an organ from
     * ambiguous morphology and reports results of staining that was never performed.
     *
     * ACCURACY — when status is "ok":
     * - Report in \`ranked\` order, not by raw \`interest\`.
     * - A node whose \`interest\` is null has NO score — say so; it is not a zero.
     * - Surface every entry of \`result.warnings\` to the user.
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
     * Send a snapshot of the ACTIVE viewer plus \`prompt\` to a vision/analysis
     * model and return its findings as text. Requires an "analyze" driver. Asks
     * the user for permission (the snapshot leaves the viewer).
     *
     * ONE vision call on what is already on screen, with no navigation — the right and
     * cheap answer to "what am I looking at?" / "what is this?". Prefer it over any
     * slide-wide scan whenever the user's question is about the current view.
     * @param prompt the question/instruction for the model.
     * @param driver optional analyze driver id.
     */
    analyzeRegion(prompt: string, driver?: string): Promise<AnalysisResult>;

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
                "SCANNING IS EXPENSIVE — RUN IT ONLY WHEN THE USER ASKS FOR IT. buildOverview and " +
                "reviewRegions drive the viewport around the slide and fire many slow vision calls; a single " +
                "overview can take MINUTES. They are never a way to 'have a look first', to check your answer, " +
                "to enrich a reply, or to seem thorough. Run one ONLY when the user's own message clearly asks " +
                "to explore, scan, survey, walk the slide, or find/rank regions. If the user asked something " +
                "else — or you are merely unsure whether they want a scan — do NOT start one: answer what you " +
                "can and offer the scan in one short sentence, letting them say yes. Never scan speculatively, " +
                "never re-scan a slide you have already scanned, and never chain a scan onto an unrelated " +
                "request.\n\n" +
                "Costs, cheapest first: getOverview is FREE (a cached tree, no model, no navigation) — always " +
                "try it before considering a scan, and answer from it when it fits. annotateTissue / " +
                "tissueCoverage / exploreSlide run a built-in in-browser detector on the raw slide (no server, " +
                "nothing leaves the viewer), but exploreSlide still refits the whole slide and waits for tiles. " +
                "analyzeRegion is ONE vision call on the current view — the right tool for a visual question " +
                "about what the user is already looking at. reviewRegions is several vision calls. " +
                "buildOverview is the most expensive by far.\n\n" +
                "What each does: exploreSlide fits the whole slide and returns the ranked tissue islands (a " +
                "bbox each) plus whole-slide coverage — navigate only to those with " +
                "viewer.frameImageRegion(region.bounds), never to guessed/empty coordinates. buildOverview " +
                "(only on an explicit request for a walkthrough/region hunt) builds a cached hierarchical map " +
                "(describe → score → drill) you then answer from instead of hand-looping. reviewRegions goes " +
                "through the tissue region by region. annotateTissue outlines ALL tissue in the CURRENT VIEW; " +
                "tissueCoverage(annotationId?) measures how much of a region is tissue AND what fraction of the " +
                "visible tissue lies in it. segmentAtPoint outlines a SPECIFIC spot (the user clicks it). " +
                "Select the viewer with application.setActiveViewer before calling.",
            );
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
         * Resolve what is known about the slide: explicit → derived → unknown.
         *
         * Never guesses. When nothing resolves the result says so, and the caller is asked
         * before any budget is spent — an unstated fact is one a vision model will invent.
         */
        async _resolveContext(context: any): Promise<any> {
            // "unknown" is the caller explicitly accepting a blind walk (the user was asked
            // and could not say). It is NOT the same as having failed to establish anything,
            // so it carries the acknowledgement that suppresses the ask.
            if (context === "unknown") return { source: "unknown", acknowledgedUnknown: true };

            // A human's own words are authoritative and are never checked against the
            // vocabulary — a stain the deployment has never heard of must still get through.
            // A partial answer ("H&E, site unknown") is still an answer: it proceeds, and the
            // preamble simply forbids naming whatever is still missing.
            if (context && typeof context === "object") {
                return { ...context, source: context.source || "explicit", acknowledgedUnknown: true };
            }
            if (context !== undefined && context !== "auto") return { source: "unknown" };
            try {
                return await this._deriveContext();
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
            return module.exploreSlide(this.activeViewer, options || {});
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
            return module.buildOverview(this.activeViewer, { ...(options || {}), context });
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
            return this._getModule().getOverview(this.activeViewer);
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

        async analyzeRegion(prompt: string, driver?: string): Promise<any> {
            const module = this._getModule();
            await this._consentIfRemote("analyze", driver, "image analysis → findings");
            return module.analyzeRegion(this.activeViewer, { prompt: prompt || "", driver });
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatPathologyScriptApi("pathology")),
        { label: "pathology" },
    );
}
