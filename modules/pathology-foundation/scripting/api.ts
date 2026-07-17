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
    /** On-screen magnification this node was viewed at, or null (fit-to-region). */
    magnification: number | null;
    /** Area fraction — of the whole slide at depth 0, of the framed parent below. */
    areaFraction: number;
    /** The vision model's short description of the region (model-assisted, not a diagnosis). */
    findings: string | null;
    /** Interest/relevance score 0..1 (null when no verdict was parsed). */
    interest: number | null;
    /** drill = recursed into; stop = pruned; leaf = interesting but hit the depth cap. */
    decision: "drill" | "stop" | "leaf";
    /** False when tiles were still streaming — findings are provisional. */
    isComplete: boolean;
    /** Set when the node could not be analysed. */
    error?: string;
    children: OverviewNode[];
};

export type OverviewResult = {
    driver: string;
    /** The feature this overview hunted for ("areas with X"), if any. */
    query?: string;
    slide: SlideExploration["slide"];
    /** Whole-slide tissue coverage (0..1). */
    slideCoverage: number;
    coverageScope: "whole-slide";
    /** False when the level-0 overview ran on partially-loaded tiles (provisional). */
    isComplete: boolean;
    /** Top-level tissue islands, each a subtree. Coarse — prefer 'ranked' for navigation. */
    root: OverviewNode[];
    /**
     * Flat, interest-ranked focal regions (highest first, tighter/deeper winning ties).
     * USE THESE to rank your answer and to build region links — each node.bounds is a
     * tight, on-slide, navigable window. Do NOT link the coarse depth-0 root boxes.
     */
    ranked: OverviewNode[];
    /** Optional local digest of the highest-interest findings (only when synthesize:true). */
    summary?: string | null;
    /** ISO timestamp the overview was built (freshness for reuse). */
    builtAtIso: string;
    /** Budget accounting: analyzeCalls made, nodesVisited, truncated when a cap stopped it early. */
    budget: { analyzeCalls: number; nodesVisited: number; truncated: boolean };
};

export type BuildOverviewOptions = {
    /** Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience. */
    query?: string;
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
     * ORIENT FIRST. Fit the whole slide, detect tissue, and return the ranked
     * tissue islands (\`regions\`, largest first) plus whole-slide \`slideCoverage\` and
     * slide metadata. Navigate to a result with \`viewer.frameImageRegion(regions[i].bounds)\`
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
     * coverage). When \`regions\` is omitted, exploreSlide supplies them. Use this for
     * "go through / review the tissue". Asks the user once when analyzing. The user's
     * view is restored afterwards.
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
     * BUILD A HIERARCHICAL OVERVIEW you can reason over. Use this for BROAD questions
     * ("where are the regions with X?", "give me an expert walkthrough", "find areas
     * that look like Y") instead of hand-looping exploreSlide/analyzeRegion. It orients
     * (exploreSlide), then walks the top tissue islands, describes each with the vision
     * model, scores them, and drills into the interesting ones at higher magnification —
     * on a budget. Pass \`query\` with the feature you are hunting for so the walk is
     * steered toward it. The whole tree is CACHED per slide: call \`getOverview()\` first
     * and only build when it is absent or stale (\`reuse: true\` returns the cache).
     * Navigate to any node with \`viewer.frameImageRegion(node.bounds)\`. Findings are
     * model-assisted observations, never a diagnosis. Needs an \`analyze\` driver and asks
     * the user ONCE for the whole run (it fires many analyze calls). The view is restored.
     * If \`budget.truncated\` is true a cap stopped the walk early — say the overview is partial.
     */
    buildOverview(options?: BuildOverviewOptions): Promise<OverviewResult>;

    /**
     * Return the CACHED hierarchical overview for the current slide, or null if none was
     * built yet. Cheap and local (no model call, no navigation). ALWAYS try this before
     * buildOverview for a broad query — if it returns a tree, answer from it (each node
     * has \`findings\`, \`interest\`, and a \`bounds\` to navigate to). Check \`builtAtIso\`
     * and \`query\` to judge whether it still fits the question.
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
                "Run concrete pathology jobs on the current slide instead of guessing. START by calling " +
                "exploreSlide to orient: it fits the whole slide, finds the tissue islands (ranked, with a bbox " +
                "each) and reports whole-slide coverage — navigate only to those regions with " +
                "viewer.frameImageRegion(region.bounds), never to guessed/empty coordinates. For a BROAD " +
                "question (\"where are the regions with X?\", \"expert walkthrough\") call getOverview first and, " +
                "if empty/stale, buildOverview({ query }) — it builds a cached hierarchical map (describe → score " +
                "→ drill) you then answer from, instead of hand-looping. To go through the " +
                "tissue region by region call reviewRegions. To work with tissue in the CURRENT VIEW, call " +
                "annotateTissue to outline ALL the tissue, or tissueCoverage(annotationId?) to measure both how " +
                "much of a region is tissue AND what fraction of the visible tissue lies in it (one current-view " +
                "measurement). These use a built-in in-browser detector on the raw slide and need no server. To " +
                "outline a SPECIFIC spot call segmentAtPoint (the user is asked to click it). To answer a visual " +
                "question call analyzeRegion (needs a configured model and asks the user first). Select the viewer " +
                "with application.setActiveViewer before calling.",
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
        async _consentIfRemote(feature: string, driverId: string | undefined, task: string): Promise<void> {
            const module = this._getModule();
            const info = module.describeDriverForFeature(feature, driverId);
            if (info?.local) return;
            const alwaysAsk = module.getStaticMeta?.("alwaysAskRemoteConsent", false);
            await this.requireActionConsent({
                title: t("pathology.consentTitle"),
                description: t("pathology.consentDescription"),
                details: [
                    t("pathology.consentDriver", { driver: info?.label || info?.id || "(default)" }),
                    t("pathology.consentTask", { task }),
                ],
                mode: "warning",
                confirmLabel: t("pathology.consentConfirm"),
                rejectedMessage: t("pathology.consentRejected"),
                cacheKey: alwaysAsk ? undefined : `pathology:${feature}:${info?.id || "default"}`,
            });
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
            await this._consentIfRemote(options.feature, options.driver, "review tissue regions → findings");
            return module.reviewRegions(this.activeViewer, options || {});
        }

        async buildOverview(options?: any): Promise<any> {
            const module = this._getModule();
            // One consent for the whole recursive run (it fires many analyze calls).
            await this._consentIfRemote("analyze", options?.driver, "recursive expert overview");
            return module.buildOverview(this.activeViewer, options || {});
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
