/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * Pathology foundation-model broker.
 *
 * A model-agnostic core that turns a rendered viewport into pathology results.
 * Instead of one catch-all "analyze" call, the module exposes a small set of
 * **named features** (jobs) a model can implement, and lets each {@link FmDriver}
 * register only the features it actually supports. The foundation resolves a
 * capable driver per requested feature, runs it, and materializes the result
 * (masks → polygon annotations, coverage → a ratio, analysis → text).
 *
 * Features:
 *  - `tissue-mask` — automatic foreground/tissue detection, **no prompt**.
 *    Ships with a built-in, dependency-free statistical driver so the module
 *    works out of the box.
 *  - `segment`     — point-driven region mask (SAM, custom endpoints).
 *  - `analyze`     — vision → text findings (via the Vercel SDK, isolated from
 *    the chat agent).
 *
 * **Reads the raw background image, not the overlay.** Tissue/segment pixels come
 * from the core `visualization` scripting API (`renderCurrentBackgroundPixels`),
 * which renders only the background image group of the live viewport — no
 * data/visualization overlay, no hand-rolled capture. Coordinate work reuses the
 * viewer's own conversions. Everything is viewer-explicit (never `window.VIEWER`)
 * so it behaves in a multi-viewport grid.
 *
 * @class PathologyFoundation
 * @extends XOpatModuleSingleton
 */

// Library / core globals resolved at runtime (no cross-boundary ES imports).
const OSD: any = (window as any).OpenSeadragon;
const OSDAnnotations: any = (window as any).OSDAnnotations;

/** i18n helper (`$.t` is global and always returns a string after init). */
const t = (key: string, opts?: any): string => (window as any).$?.t?.(key, opts) ?? key;

/**
 * Slack left around a framed region, as a fraction of its size. The overview prompt
 * quotes this to the model, so the framing and the prompt must read it from here —
 * a padding the model is not told about reads to it as extra tissue-free "structure".
 */
const OVERVIEW_FRAME_PADDING = 0.1;

/**
 * Ceiling on a single background read (one GPU→CPU frame grab). Generous by an order
 * of magnitude for the work itself; it exists purely so the read cannot wedge.
 *
 * The scripting layer's only backstop is a 3_600_000ms per-call timer that no caller
 * overrides (`scripting-manager.ts`), and when it fires it does NOT cancel the
 * host-side work — so an unbounded await here means an hour of dead UI followed by a
 * viewport that still jumps once the abandoned run finishes. Every await on the
 * exploration path must be bounded locally instead.
 */
const BACKGROUND_READ_TIMEOUT_MS = 15000;

/** Target raster size for a tissue mask. See `_maskRenderSize`. */
const MASK_TARGET_PIXELS = 2_000_000;

/**
 * Hard ceiling handed to the pixel reader. A guard that permits 64MP is not a guard;
 * this sits just above {@link MASK_TARGET_PIXELS} so an unscaled read fails loudly
 * rather than quietly allocating for a second.
 */
const MASK_MAX_PIXELS = 4_000_000;

/** Default raster size for an off-screen region render fed to a vision model. */
const REGION_ANALYZE_TARGET_PIXELS = 2_000_000;

/**
 * Ceiling for a magnification-driven off-screen region render. A high requested
 * magnification over a large region would otherwise ask the renderer for a
 * gigapixel raster; the render clamps to this and reports the magnification it
 * actually achieved instead.
 */
const REGION_RENDER_MAX_PIXELS = 8_000_000;

/**
 * Target RESOLUTION (µm per delivered raster pixel) per overview depth — the ladder the
 * walk climbs when the caller states no explicit `magnificationLadder`.
 *
 * Resolution, not objective power, is what decides which claims a view can license:
 * ~1 µm/px shows tissue architecture, ~0.5 µm/px shows glandular detail, ~0.25 µm/px is
 * where nuclear features start to exist. Expressed this way the ladder is slide-agnostic —
 * a 20× scan and a 40× scan reach the same rungs, at different objective numbers.
 *
 * The previous default (`[null, 10, 20]`) opened at "fit the whole tissue island into the
 * raster budget", which on a needle biopsy is a few objective × — a view in which nothing
 * the question asks about exists.
 */
const OVERVIEW_MPP_LADDER = [1.0, 0.5, 0.25];

/**
 * How far short of its rung a render may land before the node counts as unresolved.
 *
 * A large region cannot be delivered at 1 µm/px inside {@link REGION_RENDER_MAX_PIXELS} —
 * the render clamps and hands back something coarser. That is not a failure, it is the
 * reason to subdivide, and it is a fact the module MEASURES rather than a judgement the
 * vision model has to volunteer.
 */
const OVERVIEW_RESOLUTION_SHORTFALL_FACTOR = 2;

/**
 * Reject `promise` if it has not settled within `ms`, naming the stage.
 *
 * Deliberately does NOT cancel the underlying work — nothing on these paths accepts
 * an AbortSignal yet — so this bounds the *wait*, not the work. That is still the
 * difference between a stage-named error in seconds and an hour of frozen UI.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let done = false;
        const startedAt = Date.now();
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            console.warn(`[pathology-foundation] '${label}' did not finish within ${ms}ms; giving up.`);
            reject(new Error(`Pathology: '${label}' timed out after ${ms}ms.`));
        }, ms);
        promise.then(
            value => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const elapsed = Date.now() - startedAt;
                if (elapsed > ms / 2) {
                    console.warn(`[pathology-foundation] '${label}' took ${elapsed}ms (limit ${ms}ms).`);
                }
                resolve(value);
            },
            error => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/** The named features (jobs) a driver may implement. */
export type PathologyFeature = "tissue-mask" | "segment" | "analyze";

/** Binary mask in the background-render pixel space (1 = foreground). */
export interface MaskResult {
    binaryMask: Uint8Array;
    width: number;
    height: number;
    label?: string;
    score?: number;
}

/** RGBA background pixels of the current viewport plus a lazy PNG encoder. */
/** What the core `visualization` namespace hands back from a pixel read. */
interface RawPixelsResult {
    width: number;
    height: number;
    /** Typed when the read asked for `pixelFormat: "typed"`; a boxed array otherwise. */
    data: Uint8ClampedArray | number[];
}

/** How much raster a read should produce. Downscaling is opt-in; see `_rasterRenderSize`. */
export interface RasterReadOptions {
    /**
     * Shrink the raster isotropically to about this many pixels when the source is
     * larger. Omit for a 1:1 device-resolution read — required wherever the pixels
     * back a precise outline (segmentation, tissue annotation) rather than a coarse
     * orientation decision.
     */
    targetPixels?: number;
}

export interface PixelSource {
    width: number;
    height: number;
    /** RGBA, length = width*height*4. */
    pixels: Uint8ClampedArray | number[];
    /** Encode the same pixels as a PNG blob (memoized) — for remote drivers. */
    toBlob: () => Promise<Blob>;
}

/**
 * A raster read by this module, plus the scale needed to map it back to the viewer.
 *
 * Kept separate from {@link PixelSource} on purpose: `PixelSource` is the DRIVER-facing
 * contract (third parties implement features that receive it), and drivers work purely
 * in raster pixels — handing them a device-scale factor would be both meaningless and
 * a breaking change to their signature.
 */
export interface RasterRead extends PixelSource {
    /**
     * Device pixels per raster pixel (1 when read 1:1). Anything mapping raster
     * coordinates back to the viewer MUST apply this — the raster is not guaranteed
     * to be device-sized, and assuming it is silently misplaces geometry.
     */
    scale: number;
}

/**
 * An OFF-SCREEN region render: a {@link RasterRead} plus the render's provenance.
 * Produced by `_renderRegionRaster` — the raster comes from the standalone
 * flex-renderer pass over an explicit parent-global image region, so the user's
 * viewport is never involved (its `scale` maps raster px to level-0 image px of
 * the rendered region instead of device px).
 */
export interface RegionRaster extends RasterRead {
    /** False when the tile-load wait timed out and the raster holds partially loaded data. */
    isComplete: boolean;
    /** Magnification the raster was actually rendered at (null when uncalibrated). */
    renderedMagnification: number | null;
    /** Map a raster pixel to PARENT-GLOBAL image coordinates (linear over the rendered bounds). */
    mapPoint: (px: number, py: number) => { x: number; y: number };
    /** The parent-global bounds the raster covers (after any padding/clamping). */
    renderedBounds: Bounds;
}

export interface TissueMaskInput extends PixelSource {}

export interface SegmentInput extends PixelSource {
    /** Free-text guidance for what to segment. */
    prompt: string;
    /** Seed point in background-render pixels; defaults to the view centre. */
    point?: { x: number; y: number };
}

export interface AnalyzeInput {
    /** PNG of the on-screen composite (may include the overlay). */
    imageBlob: Blob;
    prompt: string;
}

export interface AnalyzeResult {
    text: string;
}

/**
 * A foundation-model transport. A driver declares the {@link PathologyFeature}s
 * it can perform by providing a handler per feature; the foundation only routes
 * a feature to a driver that implements it. Set `local: true` when the driver
 * runs entirely in the browser (nothing leaves the viewer) so callers can skip
 * the consent prompt.
 */
export interface FmDriver {
    id: string;
    label?: string;
    local?: boolean;
    config?: Record<string, unknown>;
    features: {
        "tissue-mask"?: (input: TissueMaskInput) => Promise<MaskResult>;
        "segment"?: (input: SegmentInput) => Promise<MaskResult | null>;
        "analyze"?: (input: AnalyzeInput) => Promise<AnalyzeResult>;
    };
}

export interface PathologyDriverInfo {
    id: string;
    label: string;
    local: boolean;
    features: PathologyFeature[];
}

export interface ResolvedDriverInfo {
    id: string;
    label: string;
    local: boolean;
}

export interface TissueMaskSummary {
    driver: string;
    width: number;
    height: number;
    tissuePixels: number;
    totalPixels: number;
    coverage: number;
}

/** Image-space bounding box of a result, for navigation (`viewer.frameImageRegion`). */
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TissueAnnotationResult {
    driver: string;
    annotationIds: Array<string | number>;
    /** Fraction of the CURRENT VIEW covered by tissue (0..1) — not the whole slide. */
    viewCoverage: number;
    /** What `viewCoverage` refers to — always "current-view". */
    coverageScope: "current-view";
    /** Image-space bbox of the drawn tissue, or null if nothing was drawn. */
    bounds: Bounds | null;
    /** Image-space centre of `bounds`, or null. */
    center: { x: number; y: number } | null;
}

export interface TissueCoverageResult {
    driver: string;
    annotationId: string | number;
    /** Fraction of the ANNOTATION's area that is tissue (0..1). */
    annotationTissueFraction: number;
    /** What the fractions are measured against — always "annotation-vs-current-view". */
    coverageScope: "annotation-vs-current-view";
    tissuePixels: number;
    areaPixels: number;
    /** Total tissue pixels detected in the CURRENT VIEW (same mask as `tissuePixels`). */
    viewTissuePixels: number;
    /** Share of the current view's tissue that lies inside the annotation (0..1). */
    fractionOfViewTissue: number;
    /** Image-space bbox of the measured annotation. */
    bounds: Bounds | null;
    center: { x: number; y: number } | null;
}

/**
 * Outcome of turning a driver mask into a polygon. Distinguishes a genuine
 * empty result from a validation rejection so callers (and the LLM) never
 * mistake a rejected mask for "the model found nothing there".
 */
export type SegmentStatus = "ok" | "empty" | "rejected-oversegmented";

export interface SegmentResult {
    driver: string;
    /**
     * "ok" — a region was segmented and drawn; "empty" — the driver returned
     * no usable mask (nothing segmentable at that spot); "rejected-oversegmented"
     * — the mask failed validation (covered >90% of the view) and was discarded.
     */
    status: SegmentStatus;
    /** Human-readable note for non-"ok" statuses. */
    statusMessage?: string;
    annotationIds: Array<string | number>;
    /** Image-space bbox of the drawn region, or null. */
    bounds: Bounds | null;
    center: { x: number; y: number } | null;
}

export interface AnalysisResult {
    driver: string;
    findings: string | null;
    /**
     * Present for off-screen region analyses (a `region` was passed): false when the
     * tile-load wait timed out and the model saw partially loaded data.
     */
    isComplete?: boolean;
}

/** One connected tissue island found during whole-slide orientation. */
export interface SlideRegion {
    /** 0-based rank; region 0 is the largest tissue island. */
    index: number;
    /** Parent-global image-space bbox — pass to `viewer.frameImageRegion(bounds)`. */
    bounds: Bounds;
    /** Image-space centre of `bounds`. */
    center: { x: number; y: number };
    /** Fraction of the whole overview this island covers (0..1). */
    areaFraction: number;
    /**
     * Always true: the bbox comes from a low-resolution overview render. Frame
     * the region and re-run `annotateTissue` when a precise outline is needed.
     */
    isApproximate: true;
}

export interface SlideExploration {
    driver: string;
    slide: {
        /** Whole-slide (parent-global) pixel dimensions. */
        width: number;
        height: number;
        /** Physical calibration, or null when the image is uncalibrated. */
        micronsPerPixel: number | null;
        /** Native/objective magnification (e.g. 40), or null when unknown. */
        magnification: number | null;
    };
    /** Fraction of the surveyed rectangle covered by tissue (0..1). */
    slideCoverage: number;
    /**
     * What `slideCoverage`/`regions` refer to: "whole-slide" normally, or
     * "current-view" in the fallback taken when the source exposes no slide
     * dimensions (the survey then covers the live viewport, not the whole slide).
     */
    coverageScope: "whole-slide" | "current-view";
    /**
     * False when the tile pyramid was still streaming when the overview was
     * captured (load wait timed out) — coverage/regions are then provisional and
     * likely UNDERSTATED; report them as such rather than asserting low coverage.
     */
    isComplete: boolean;
    /** Tissue islands ranked by area (largest first). Empty when the slide looks blank. */
    regions: SlideRegion[];
    /** Coarse model-assisted overview note; present only when `hint` was requested and an analyze driver ran. */
    hint?: string | null;
}

export interface RegionReviewResult {
    index: number;
    bounds: Bounds;
    /** Present when `feature: "analyze"` — the model's findings text (or null). */
    findings?: string | null;
    /** Present when `feature: "tissue-mask"` — fraction of the region that is tissue (0..1). */
    viewCoverage?: number;
    /** Present when the review drew annotations. */
    annotationIds?: Array<string | number>;
    /** False when the region's tiles were still streaming when the job ran — the result is provisional. */
    isComplete?: boolean;
    /** Set when the region could not be processed (e.g. the driver failed). */
    error?: string;
}

/**
 * What kind of signal a stain encodes. This — not the stain's name — is what lets one
 * parameterized sentence correctly constrain a vision model on ANY stain: the module
 * never needs to know what a given stain *is*, only what class of claim it can license.
 */
export type StainClass =
    /** Morphology + tinctorial contrast only; licenses no named-target claim. */
    | "histochemical"
    /** One or few named targets on a brightfield chromogen; licenses only `targets`. */
    | "targeted"
    /** Labelled channels; signal licenses only its own label. */
    | "fluorescence"
    /** Label-free / unstained; licenses no staining claim at all. */
    | "unstained"
    /** Not established — degrade closed (licenses nothing beyond structure). */
    | "unknown";

/**
 * What is known about the slide itself, stated to the vision model so it cannot quietly
 * invent it. Free-text fields are rendered VERBATIM and are never matched against a list —
 * a human's statement is authoritative even when the module has never heard of it.
 *
 * Resolution (explicit → derived → unknown) belongs to the scripting adapter, which is
 * where consent and namespace grants live; this engine only consumes a resolved value and
 * never reads the sensitive `patient` namespace itself.
 */
export interface SlideContext {
    /** The stain as the operator/user names it. Rendered verbatim. */
    stain?: string;
    /** Signal class of `stain`; drives the prompt constraint. Absent ⇒ treated as "unknown". */
    stainClass?: StainClass;
    /** Named targets/channels actually assayed (for "targeted"/"fluorescence"). */
    targets?: string[];
    /** The specimen site as the operator/user names it. Rendered verbatim. */
    organ?: string;
    /** Operator/user free text (e.g. "resection, prior therapy"). NEVER derived. */
    notes?: string;
    /** Where this came from. "unknown" ⇒ the prompt forbids naming stain/site. */
    source: "explicit" | "derived" | "unknown";
    /**
     * True once a human has been asked — whether they answered or said they could not.
     * "Asked and unanswerable" is itself an answer, and callers must not re-ask it: that is
     * how one request turns into a question every time a job touches the slide.
     */
    acknowledgedUnknown?: boolean;
}

/** Measured facts about a framed node, gathered AFTER the viewport settles. */
export interface NodeViewFacts {
    /** Magnification actually achieved on screen (null when no scalebar basis exists). */
    magnification: number | null;
    /** Physical field of view, or null when the slide is uncalibrated. */
    fieldOfViewUm: { width: number; height: number } | null;
    /** Field of view in image pixels (always available). */
    fieldOfViewPx: { width: number; height: number };
    /** Size of the raster the model actually receives, in its own pixels. */
    rasterPx: { width: number; height: number };
    /**
     * µm per pixel OF THE DELIVERED RASTER — the real resolution the model is looking at,
     * not the slide's native one. A region render is downsampled to fit the pixel budget,
     * so quoting the slide's µm/px would promise the model detail it was never sent.
     */
    renderedMpp: number | null;
    /** The rung's target µm/px this render was aiming at, when a ladder was in play. */
    targetMpp: number | null;
    /**
     * True when {@link renderedMpp} is coarser than {@link targetMpp} by more than
     * {@link OVERVIEW_RESOLUTION_SHORTFALL_FACTOR}: the region is too big to deliver at the
     * rung's resolution, so it must be subdivided rather than judged.
     */
    resolutionShortfall: boolean;
    /** Fraction of the WHOLE SLIDE this node's bbox covers (0..1) — comparable across depths. */
    slideAreaFraction: number;
    /** Fraction of the framed box that is tissue (0..1), or null when not measured. */
    bboxFillFraction: number | null;
}

/** How a node's interest score was established — so a parse failure is never read as a real 0. */
export type VerdictSource =
    /** The model emitted a conforming 0..1 SCORE. */
    | "contract"
    /** The model emitted a score on another scale (1-5/1-10/...); normalized to 0..1. */
    | "normalized"
    /** No machine line; interest derived coarsely from query keywords in the prose. */
    | "keyword"
    /** No usable score at all — interest is UNKNOWN (null), not zero. */
    | "unparsed";

export interface OverviewVerdict {
    /** Interest 0..1, or null when nothing usable was returned. NEVER fabricated as 0. */
    interest: number | null;
    drill: boolean;
    confidence: "low" | "medium" | "high" | null;
    /**
     * Whether the features the question needs could be JUDGED at this resolution —
     * deliberately independent of `interest`. "I cannot tell at this power" is a reason to
     * look closer, not a reason to stop, so it must not arrive disguised as a low score.
     * Null when the model did not state it.
     */
    resolvable: boolean | null;
    source: VerdictSource;
    /** The denominator assumed when `source` is "normalized" (5, 10, 100, ...). */
    scoreScale?: number;
}

/**
 * One node of a hierarchical {@link OverviewResult}. Produced by `buildOverview`:
 * a region that was framed, described by the vision model, scored for interest,
 * and either drilled into (children) or pruned.
 */
export interface OverviewNode {
    /** Rank of this region among its siblings (largest tissue island first). */
    index: number;
    /** Recursion depth (0 = a whole-slide tissue island). */
    depth: number;
    /** Parent-global image-space bbox — feed to viewer.frameImageRegion(bounds). */
    bounds: Bounds;
    center: { x: number; y: number };
    /**
     * On-screen magnification ACHIEVED for this node (read back after the viewport
     * settled), or null when no scalebar basis exists. Not the requested ladder value —
     * the zoom can silently no-op or be clamped.
     */
    magnification: number | null;
    /**
     * Area fraction — of the whole slide at depth 0, of the framed parent below.
     * NOT comparable across depths; use {@link OverviewNode.slideAreaFraction} for that.
     */
    areaFraction: number;
    /** Fraction of the WHOLE SLIDE this node's bbox covers (0..1) — comparable at any depth. */
    slideAreaFraction: number;
    /** Fraction of the framed box that is actually tissue (0..1); null when not measured. */
    bboxFillFraction: number | null;
    /** Physical field of view of the framed box, or null when the slide is uncalibrated. */
    fieldOfViewUm?: { width: number; height: number } | null;
    /** µm per pixel of the raster the model actually saw (not the slide's native µm/px). */
    renderedMpp?: number | null;
    /** True when the render landed too coarse for this depth's rung — the node needs subdividing, not judging. */
    resolutionShortfall?: boolean;
    /** The vision model's short description of this region (or null on failure). */
    findings: string | null;
    /**
     * Interest 0..1, or null when the model returned no usable score. A null here means
     * UNKNOWN — never render or rank it as a zero.
     */
    interest: number | null;
    /** How `interest` was established, so callers can flag unreliable scores. */
    verdict?: OverviewVerdict;
    /** Composite ranking score (see `ranked`); interest weighted by path/confidence/area/fill. */
    rankScore?: number;
    /**
     * What happened to this branch: drilled because it looked interesting, drilled because
     * it could not be judged at this resolution (`resolve`), pruned, or a depth/budget leaf.
     */
    decision: "drill" | "resolve" | "stop" | "leaf";
    /** False when the region's tiles were still streaming — findings are provisional. */
    isComplete: boolean;
    /** Set when the node could not be analysed (driver error). */
    error?: string;
    children: OverviewNode[];
}

/** Budget accounting for a {@link buildOverview} run (protects the slow backend). */
export interface OverviewBudget {
    /** Vision (analyze) calls actually made, including verdict repairs. */
    analyzeCalls: number;
    /** Of `analyzeCalls`, how many were spent re-asking for a conforming verdict. */
    repairCalls: number;
    /** Regions framed and visited. */
    nodesVisited: number;
    /** True when a cap (maxAnalyzeCalls/maxNodes/maxDepth) stopped the walk early. */
    truncated: boolean;
}

/**
 * A hierarchical "expert overview" of a slide: the ranked tissue islands, each
 * described and (where interesting) drilled into at higher magnification. Cached
 * per slide so broad chat queries can reuse the descriptions instead of
 * re-sweeping. Every finding is a model-assisted observation, not a diagnosis.
 */
export interface OverviewResult {
    /** Discriminates a completed walk from the adapter's "context-required" refusal. */
    status: "ok";
    driver: string;
    /** The feature query this overview was built for ("areas with X"), if any. */
    query?: string;
    /**
     * What the walk was told about the slide. When `source` is "unknown" the model was
     * forbidden from naming a stain or site — ask the user for them and rebuild.
     */
    context: SlideContext;
    slide: SlideExploration["slide"];
    /** Whole-slide tissue coverage (0..1). */
    slideCoverage: number;
    coverageScope: "whole-slide";
    /** False when the level-0 overview ran on partially-loaded tiles (provisional). */
    isComplete: boolean;
    /** Top-level tissue islands, each a subtree. */
    root: OverviewNode[];
    /**
     * Flat list of the described regions ranked by `rankScore` — the model's interest
     * weighted by its ancestors' interest, its stated confidence, and how much real
     * tissue the box holds. Ranking by raw interest alone lets a tiny, low-confidence
     * leaf under an uninteresting parent outrank a large well-supported region.
     * Nodes with unknown interest sort last. These are the focal spots to link to.
     */
    ranked: OverviewNode[];
    /** Optional locally-assembled digest of the highest-interest findings. */
    summary?: string | null;
    /**
     * True when the walk was stopped early (user cancel or caller signal). The tree is
     * whatever had been described by then — real, but partial. Never presented as a
     * failure: the regions in it cost the same model calls either way.
     */
    cancelled?: boolean;
    /**
     * Caveats the caller MUST surface: unparsed verdicts, unknown slide context,
     * cancellation, truncation. Empty when the walk was clean.
     */
    warnings: string[];
    /** ISO timestamp the overview was built (freshness for reuse decisions). */
    builtAtIso: string;
    budget: OverviewBudget;
}

export interface BuildOverviewOptions {
    /** Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience. */
    query?: string;
    /**
     * What is known about the slide (stain, its signal class, site). Supply this: without
     * it the model is told the stain and site are unknown and is forbidden from naming
     * them, which is safe but much less useful. Must be already resolved — the engine
     * never reads patient-sensitive sources itself.
     */
    context?: SlideContext;
    /** Re-ask once for a conforming verdict when the model's reply has no usable SCORE (default true). */
    repairVerdict?: boolean;
    /** Measure how much of each framed box is really tissue, locally (default true). */
    measureFill?: boolean;
    /** Show a cancellable progress dialog over the viewer (default true). */
    progress?: boolean;
    /** Stop the walk early; the regions already described are kept and returned. */
    signal?: AbortSignal;
    /** Max recursion depth (default 2). */
    maxDepth?: number;
    /** Regions explored per node (default 4). */
    breadth?: number;
    /**
     * Explicit objective magnification per depth; null = fit the region into the raster
     * budget. Omit it (recommended) and the walk derives each rung from
     * {@link OVERVIEW_MPP_LADDER} instead, targeting a RESOLUTION rather than a power —
     * which is what actually decides whether a view can answer the question.
     */
    magnificationLadder?: Array<number | null>;
    /** Drill only when the parsed interest score is at least this (default 0.5). */
    interestThreshold?: number;
    /**
     * Minimum tissue fill (0..1) a box must have before an unresolvable view is allowed to
     * spend budget drilling for detail (default 0.1). Stops the walk from chasing sharper
     * pictures of background.
     */
    minDrillFill?: number;
    /** Hard cap on vision calls for the whole run (default 18). */
    maxAnalyzeCalls?: number;
    /** Hard cap on regions visited for the whole run (default 24). */
    maxNodes?: number;
    /** How child regions are discovered (only "tissue" in v1). */
    subdivide?: "tissue";
    /** Draw the visited regions as annotations (default false). */
    annotate?: boolean;
    /** Attach a locally-assembled findings digest as `summary` (default true). */
    synthesize?: boolean;
    /** Return the cached overview (if any) instead of rebuilding (default false). */
    reuse?: boolean;
    driver?: string;
}

/** {@link BuildOverviewOptions} with every knob resolved to a concrete value. */
interface ResolvedOverviewOptions {
    query?: string;
    driver?: string;
    context: SlideContext;
    repairVerdict: boolean;
    measureFill: boolean;
    progress: boolean;
    maxDepth: number;
    breadth: number;
    interestThreshold: number;
    minDrillFill: number;
    maxAnalyzeCalls: number;
    maxNodes: number;
    subdivide: "tissue";
    annotate: boolean;
    synthesize: boolean;
    reuse: boolean;
}

/** Per-depth render targets for one overview walk. See `_resolveLadder`. */
interface OverviewLadder {
    /** Objective magnification requested at each depth (null = fit the raster budget). */
    magnifications: Array<number | null>;
    /** The µm/px each rung was aiming at, when the ladder was derived from calibration. */
    targetMpp: Array<number | null>;
    /** False when the slide is uncalibrated and the walk fell back to fixed rungs. */
    derived: boolean;
}

type Point = { x: number; y: number };

/**
 * Built-in HttpClient transport for a custom image→mask endpoint (SAM
 * `/segment`-compatible). Implements `segment` by default (or `tissue-mask` when
 * configured with `"feature": "tissue-mask"`). It POSTs the **background** image
 * (from {@link PixelSource.toBlob}) so a server model sees the raw slide too.
 * Auth / proxy / secureMode are handled by HttpClient.
 *
 * (Vision→text is intentionally NOT handled here: rather than hardcode one
 * provider's chat wire format, analysis is routed through the Vercel driver.)
 */
class HttpMaskDriver implements FmDriver {
    id: string;
    label: string;
    local = false;
    config: Record<string, unknown>;
    features: FmDriver["features"] = {};

    private _client: any;
    private _path: string;
    private _model?: string;

    constructor(id: string, cfg: Record<string, any>) {
        this.id = id;
        this.label = cfg.label || id;
        this._model = cfg.model;
        this._path = cfg.path || "segment";
        this.config = cfg;

        const HttpClient = (window as any).HttpClient;
        this._client = new HttpClient({ baseURL: cfg.baseURL, proxy: cfg.proxyAlias });

        const feature: PathologyFeature = cfg.feature === "tissue-mask" ? "tissue-mask" : "segment";
        this.features[feature] = ((input: TissueMaskInput | SegmentInput) => this._segment(input)) as any;
    }

    private async _segment(input: TissueMaskInput | SegmentInput): Promise<MaskResult> {
        const base64 = await blobToBase64(await input.toBlob());
        const data = await this._client.request(this._path, {
            method: "POST",
            expect: "json",
            // Slow vision POST — ride the background lane so it yields connection slots to
            // interactive tile loading (matches the other inference/vision RPCs).
            priority: "background",
            body: {
                image: base64,
                prompt: (input as SegmentInput).prompt || "",
                point: (input as SegmentInput).point,
                model: this._model,
            },
        });
        return decodeBase64Mask(data);
    }
}

/**
 * Optional Vercel-AI-SDK transport (the `analyze` feature only). It calls the
 * vercel-ai-chat-sdk module's **stateless** `runVisionInference` RPC, isolated
 * from the chat agent (no session/history/personality), bound to a DEDICATED
 * pathology provider instance (`providerId`).
 */
class VercelAnalyzeDriver implements FmDriver {
    id: string;
    label: string;
    local = false;
    config: Record<string, unknown>;
    features: FmDriver["features"];

    private _providerId: string;
    private _model?: string;
    private _system?: string;
    private _scopeId: string;

    constructor(id: string, cfg: Record<string, any>) {
        this.id = id;
        this.label = cfg.label || id;
        this._providerId = cfg.providerId;
        this._model = cfg.model;
        this._system = cfg.system;
        this._scopeId = cfg.module || "vercel-ai-chat-sdk";
        this.config = cfg;
        if (!this._providerId) {
            throw new Error(
                `vercel driver "${id}" requires a providerId (a dedicated pathology provider instance, ` +
                `separate from the chat agent's provider).`
            );
        }
        this.features = { "analyze": (input) => this._analyze(input) };
    }

    private async _analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
        const scope = (window as any).xserver?.module?.[this._scopeId];
        if (!scope?.runVisionInference) {
            throw new Error(`The "${this._scopeId}" module is not available; cannot use vercel driver "${this.id}".`);
        }
        const base64 = await blobToBase64(input.imageBlob);
        const res = await scope.runVisionInference({
            providerId: this._providerId,
            model: this._model,
            system: this._system,
            prompt: input.prompt,
            imageBase64: base64,
            mediaType: "image/png",
        }, {
            // Yield connection slots to interactive tile loading — bounded per
            // origin by APPLICATION_CONTEXT.requestScheduler (background lane).
            priority: "background",
        });
        return { text: typeof res?.text === "string" ? res.text : "" };
    }
}

// ---- pure helpers -----------------------------------------------------------

/** PNG blob → base64 (no data-URL prefix). */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Decode a `{ binary_mask (base64), width, height }` segmentation response. */
function decodeBase64Mask(data: any): MaskResult {
    const binaryStr = atob(data.binary_mask);
    const binaryMask = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        binaryMask[i] = binaryStr.charCodeAt(i);
    }
    return { binaryMask, width: data.width, height: data.height, label: data.label, score: data.score };
}

/** RGBA pixels → PNG blob. */
function pixelsToPngBlob(pixels: Uint8ClampedArray | number[], width: number, height: number): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const arr = pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
    ctx.putImageData(new ImageData(arr, width, height), 0, 0);
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Failed to encode the background image."))), "image/png")
    );
}

/** Otsu's method: the between-class-variance-maximizing threshold of a 0..255 histogram. */
function otsuThreshold(values: Uint8Array): number {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < values.length; i++) hist[values[i]]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, threshold = 0;
    for (let th = 0; th < 256; th++) {
        wB += hist[th];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += th * hist[th];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; threshold = th; }
    }
    return threshold;
}

/**
 * Dependency-free tissue detector over RGBA pixels. On a brightfield (e.g. H&E)
 * slide the glass background is bright and unsaturated while stained tissue is
 * coloured; so we threshold the HSV **saturation** channel with an adaptive Otsu
 * cut and drop near-white pixels. A statistical approximation — good enough to
 * bootstrap masks/coverage, overridable by a real `tissue-mask` driver.
 */
function builtinTissueMask(pixels: Uint8ClampedArray | number[], width: number, height: number): MaskResult {
    const n = width * height;
    const sat = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        sat[i] = max === 0 ? 0 : Math.round(((max - min) / max) * 255);
    }
    const satCut = otsuThreshold(sat);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (sat[i] > satCut && luma < 240) mask[i] = 1;
    }
    return { binaryMask: mask, width, height, label: "tissue" };
}

/** Shoelace polygon area (absolute). */
function polygonArea(pts: Point[]): number {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a / 2);
}

/** Image-space bounding box over one or more polygons (nulls skipped). */
function boundsOfPolygons(polys: Array<Point[] | null | undefined>): Bounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const poly of polys) {
        if (!poly) continue;
        for (const p of poly) {
            any = true;
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (!any) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Centre point of a bbox, or null. */
function centerOf(b: Bounds | null): { x: number; y: number } | null {
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

/** Ray-casting point-in-polygon test. */
function pointInRing(x: number, y: number, ring: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
        if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

class PathologyFoundation extends (XOpatModuleSingleton as any) {
    private _drivers: Map<string, FmDriver>;
    private _defaultForFeature: Record<string, string>;
    private MagicWand: any;
    /** Cached id of the dedicated "Pathology" preset (created lazily, reused). */
    private _pathologyPresetId: string | number | null = null;
    /**
     * In-memory hierarchical overviews, keyed by `tileSourceId` (never url —
     * DICOMweb shares baseUrl across slides). Survives viewer/visualization
     * switches within the session; lost on reload. See {@link buildOverview}.
     */
    private _overviews: Map<string, OverviewResult> = new Map();
    /**
     * Resolved slide context, keyed the same way. What the slide IS does not change between
     * calls, so establishing it is a once-per-slide cost — without this every analyze call
     * re-derives it and every walk re-asks the user for something they already answered,
     * mid-task, after the budget has been spent. Never persisted: it can hold what a user
     * said about a specimen, which belongs to the session and nowhere else.
     */
    private _slideContexts: Map<string, SlideContext> = new Map();

    constructor() {
        super();
        this._drivers = new Map();
        this.MagicWand = null;
        this._defaultForFeature = (this.getStaticMeta("defaultDrivers", {}) as Record<string, string>) || {};

        // Built-in, dependency-free tissue detector so the module works out of
        // the box. Registered first → default for `tissue-mask`. local => no
        // snapshot ever leaves the viewer.
        this.registerDriver({
            id: "builtin",
            label: "Built-in tissue detector",
            local: true,
            features: {
                "tissue-mask": async (input: TissueMaskInput) =>
                    builtinTissueMask(input.pixels, input.width, input.height),
            },
        });

        // Configured transports: { "<id>": { type:"http"|"vercel", ... } }.
        const drivers = this.getStaticMeta("drivers", {}) as Record<string, any>;
        for (const [id, cfg] of Object.entries(drivers || {})) {
            if (!cfg) continue;
            const type = cfg.type || "http";
            try {
                if (type === "http") {
                    this.registerDriver(new HttpMaskDriver(id, cfg));
                } else if (type === "vercel") {
                    this.registerDriver(new VercelAnalyzeDriver(id, cfg));
                } else {
                    console.warn(`[pathology-foundation] driver "${id}" has unknown type "${type}"; skipped.`);
                }
            } catch (e) {
                console.error(`[pathology-foundation] failed to build ${type} driver "${id}":`, e);
            }
        }
    }

    // ---- driver registry ----

    registerDriver(driver: FmDriver): void {
        if (!driver?.id || !driver.features || typeof driver.features !== "object") {
            throw new Error("[pathology-foundation] a driver needs an id and a features map.");
        }
        const featureIds = Object.keys(driver.features).filter(k => typeof (driver.features as any)[k] === "function");
        if (!featureIds.length) {
            throw new Error(`[pathology-foundation] driver "${driver.id}" implements no features.`);
        }
        this._drivers.set(driver.id, driver);
        this.raiseEvent("drivers-changed");
    }

    unregisterDriver(id: string): void {
        this._drivers.delete(id);
        this.raiseEvent("drivers-changed");
    }

    listDrivers(): PathologyDriverInfo[] {
        return Array.from(this._drivers.values()).map(d => ({
            id: d.id,
            label: d.label || d.id,
            local: !!d.local,
            features: Object.keys(d.features).filter(
                k => typeof (d.features as any)[k] === "function"
            ) as PathologyFeature[],
        }));
    }

    getDriverForFeature(feature: PathologyFeature, driverId?: string | null): FmDriver {
        if (driverId) {
            const d = this._drivers.get(driverId);
            if (!d) {
                const known = Array.from(this._drivers.keys()).join(", ") || "(none)";
                throw new Error(`Unknown pathology driver "${driverId}". Available: ${known}.`);
            }
            if (typeof d.features[feature] !== "function") {
                throw new Error(`Driver "${driverId}" does not support the "${feature}" feature.`);
            }
            return d;
        }
        const preferred = this._defaultForFeature[feature];
        if (preferred) {
            const d = this._drivers.get(preferred);
            if (d && typeof d.features[feature] === "function") return d;
        }
        for (const d of this._drivers.values()) {
            if (typeof d.features[feature] === "function") return d;
        }
        throw new Error(`No pathology driver implements the "${feature}" feature.`);
    }

    describeDriverForFeature(feature: PathologyFeature, driverId?: string | null): ResolvedDriverInfo {
        const d = this.getDriverForFeature(feature, driverId);
        return { id: d.id, label: d.label || d.id, local: !!d.local };
    }

    // ---- tissue jobs (built on the `tissue-mask` feature) ----

    async computeTissueMask(viewer: any, options?: { driver?: string }): Promise<TissueMaskSummary> {
        // Coverage is a ratio over the whole raster, so a downscaled read gives the
        // same answer for a fraction of the cost. `width`/`height` below therefore
        // describe the MASK, not the device canvas — as they always have.
        const { driverId, mask } = await this._runTissueMask(viewer, options?.driver, undefined, {
            targetPixels: MASK_TARGET_PIXELS,
        });
        const total = mask.width * mask.height;
        const tissue = this._countFilled(mask.binaryMask);
        return {
            driver: driverId,
            width: mask.width,
            height: mask.height,
            tissuePixels: tissue,
            totalPixels: total,
            coverage: total ? tissue / total : 0,
        };
    }

    async annotateTissue(viewer: any, options?: { driver?: string }): Promise<TissueAnnotationResult> {
        // Read 1:1: this method's whole point is a precise outline, so it must not be
        // handed the downscaled raster orientation uses.
        const { driverId, mask, bg } = await this._runTissueMask(viewer, options?.driver);
        const context = this._annotations();
        const ref = this._ref(viewer);
        const ratio = OSD.pixelDensityRatio;

        const minArea = 0.003 * mask.width * mask.height;
        const contours = this._traceOuterContours(mask).filter(pts => polygonArea(pts) >= minArea);
        const polys = contours.map(pts =>
            this._contourToImage(pts, ref, mask, mask.width * bg.scale, mask.height * bg.scale, ratio)
        );

        const total = mask.width * mask.height;
        const tissue = this._countFilled(mask.binaryMask);
        const bounds = boundsOfPolygons(polys);
        return {
            driver: driverId,
            annotationIds: this._commitPolygons(viewer, context, polys),
            viewCoverage: total ? tissue / total : 0,
            coverageScope: "current-view",
            bounds,
            center: centerOf(bounds),
        };
    }

    /**
     * Whole-slide orientation. Renders the entire slide OFF-SCREEN (the user's
     * viewport is never touched), detects tissue with the `tissue-mask` driver, and
     * returns a ranked list of tissue islands (each with a parent-global bbox to
     * navigate to) plus whole-slide coverage and slide metadata. The agent should
     * call this FIRST so any follow-up work targets real tissue and never frames
     * empty glass. The user can keep navigating freely the whole time.
     *
     * The overview is a low-resolution render, so `regions` bounds are approximate —
     * follow up with `annotateTissue` (or a region-scoped `analyzeRegion`) for a
     * high-resolution result.
     *
     * @param annotate draw the detected islands as polygon annotations (default off).
     * @param hint when true and an `analyze` driver exists, attach one coarse
     *   model-assisted overview note (a snapshot leaves the viewer — the scripting
     *   layer asks for consent).
     * @param minAreaFraction smallest island to report, as a fraction of the
     *   overview (default 0.001; looser than `annotateTissue` because the overview
     *   is coarse).
     */
    async exploreSlide(
        viewer: any,
        options?: { driver?: string; annotate?: boolean; hint?: boolean; minAreaFraction?: number }
    ): Promise<SlideExploration> {
        if (!viewer) throw new Error("exploreSlide() requires a viewer.");
        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);
        const slideMeta = this._slideMeta(viewer, ref);
        const slideDimsKnown = slideMeta.width > 0 && slideMeta.height > 0;

        // Survey rectangle in parent-global image coords. Normally the slide's whole
        // content rectangle — no letterbox margins, no viewport framing: the raster
        // IS the slide (for a virtual-region crop, the CROP expressed in parent-global
        // coords). When the source exposes NO slide dimensions (some DICOM / custom
        // sources), degrade to surveying the CURRENT VIEW so orientation still returns
        // a best-effort overview instead of throwing — the result is then scoped
        // "current-view", and regions can't be slide-clamped.
        let surveyBounds: Bounds;
        if (slideDimsKnown) {
            const content = ref?.getContentSize?.();
            const localBR: Point = { x: content?.x || slideMeta.width, y: content?.y || slideMeta.height };
            const toParent = (p: Point): Point => (cropped ? cropped.toParentImageCoordinates(p) : p);
            const pTL = toParent({ x: 0, y: 0 });
            const pBR = toParent(localBR);
            surveyBounds = {
                x: Math.min(pTL.x, pBR.x),
                y: Math.min(pTL.y, pBR.y),
                width: Math.abs(pBR.x - pTL.x),
                height: Math.abs(pBR.y - pTL.y),
            };
        } else {
            const view = this._currentViewParentBounds(viewer, ref, cropped);
            if (!view) throw new Error("The slide dimensions are unavailable; cannot build an overview.");
            surveyBounds = view;
        }
        const raster = await this._renderRegionRaster(viewer, surveyBounds, {
            targetPixels: MASK_TARGET_PIXELS,
            layers: "background",
        });
        const { driverId, mask } = await this._runTissueMask(viewer, options?.driver, raster);

        // Mask px → parent-global image coords: a pure linear map over the surveyed
        // rectangle, expressed against the mask's own dimensions so it stays correct
        // whatever resolution the driver returned the mask at.
        const mapParent = (px: number, py: number): Point => ({
            x: surveyBounds.x + (px / mask.width) * surveyBounds.width,
            y: surveyBounds.y + (py / mask.height) * surveyBounds.height,
        });
        // Annotations are committed in ref-LOCAL coords (the fabric canvas expects
        // the region's own coordinates for a virtual-region crop).
        const toLocal = (p: Point): Point => (cropped ? cropped.fromParentImageCoordinates(p) : p);

        const total = mask.width * mask.height;
        const minArea = Math.max(1, (options?.minAreaFraction ?? 0.001) * total);
        const slideArea = slideMeta.width * slideMeta.height;

        // The raster IS the whole slide here, so tissue/total is genuine whole-slide coverage
        // (unlike annotateTissue's current-view coverage). Computed before the contour loop so
        // the whole-slide-box guard below can tell a spurious full-rectangle outline (low
        // coverage) from a legitimately all-tissue slide (high coverage).
        const slideCoverage = total ? this._countFilled(mask.binaryMask) / total : 0;

        const localPolys: Array<Point[]> = [];
        const regions: SlideRegion[] = [];
        this._traceOuterContours(mask)
            .map(pts => ({ pts, area: polygonArea(pts) }))
            .filter(r => r.area >= minArea)
            .sort((a, b) => b.area - a.area)
            .forEach(r => {
                const imagePoly = r.pts.map(p => mapParent(p.x, p.y));
                const raw = boundsOfPolygons([imagePoly]);
                if (!raw) return;
                // Clamp to the slide (link targets must be real, on-slide) and drop a degenerate
                // box that spans the whole slide ONLY when coverage is low (a spurious
                // full-rectangle contour); an all-tissue slide genuinely yields a whole-slide
                // region and must be kept, else exploreSlide reports blank on solid tissue.
                // In the current-view fallback the slide extent is unknown, so keep the raw
                // (already on-view) box unclamped.
                const bounds = slideDimsKnown
                    ? this._clampBoundsToSlide(raw, slideMeta.width, slideMeta.height)
                    : raw;
                if (!bounds) return;
                if (slideArea > 0 && bounds.width * bounds.height > 0.999 * slideArea && slideCoverage < 0.9) return;
                localPolys.push(imagePoly.map(toLocal));
                regions.push({
                    index: regions.length,
                    bounds,
                    center: centerOf(bounds)!,
                    areaFraction: r.area / total,
                    isApproximate: true,
                });
            });

        if (options?.annotate && localPolys.length) {
            this._commitPolygons(viewer, this._annotations(), localPolys);
        }

        let hint: string | null | undefined;
        if (options?.hint && this._hasFeature("analyze", options?.driver)) {
            // Reuse the already-rendered whole-slide raster — no extra render.
            const res = await this.analyzeRegion(viewer, {
                prompt: t("pathology.overviewHintPrompt"),
                driver: options?.driver,
                source: "background",
                region: surveyBounds,
                preRead: raster,
            });
            hint = res?.findings ?? null;
        }

        return {
            driver: driverId,
            slide: slideMeta,
            slideCoverage,
            coverageScope: slideDimsKnown ? "whole-slide" : "current-view",
            isComplete: raster.isComplete,
            regions,
            hint,
        };
    }

    /**
     * Walk the top tissue regions and run one job on each. Every region is rendered
     * OFF-SCREEN (optionally at a target magnification) — the user's viewport is never
     * moved, so the user can keep navigating while the walk runs. Per region, `feature`:
     *  - `analyze`     → vision→text findings per region (needs an analyze driver);
     *  - `tissue-mask` → per-region tissue coverage.
     * A `segment` feature is point-driven and cannot be batched, so it is rejected.
     *
     * @param regions regions to walk; when omitted, `exploreSlide` supplies them.
     * @param max cap on how many regions to process (default 5).
     * @param magnification optional render magnification (e.g. 20).
     * @param feature the per-region job (default "analyze").
     */
    async reviewRegions(
        viewer: any,
        options?: {
            regions?: SlideRegion[];
            max?: number;
            magnification?: number;
            feature?: PathologyFeature;
            prompt?: string;
            driver?: string;
        }
    ): Promise<RegionReviewResult[]> {
        if (!viewer) throw new Error("reviewRegions() requires a viewer.");
        const feature = options?.feature ?? "analyze";
        if (feature === "segment") {
            throw new Error("reviewRegions does not support the point-driven 'segment' feature; use segmentAtPoint.");
        }
        let regions = options?.regions;
        if (!regions || !regions.length) {
            regions = (await this.exploreSlide(viewer, { driver: options?.driver })).regions;
        }
        const max = Math.max(0, options?.max ?? 5);
        const targets = regions.slice(0, max);

        // Reuse whatever is already established about the slide; never ask for it here —
        // a region walk should inherit the frame of reference, not open a new question.
        const context = this.getSlideContext(viewer) || undefined;

        const results: RegionReviewResult[] = [];
        for (const region of targets) {
            try {
                if (feature === "analyze") {
                    const res = await this.analyzeRegion(viewer, {
                        prompt: options?.prompt || t("pathology.reviewRegionPrompt"),
                        driver: options?.driver,
                        source: "background",
                        region: region.bounds,
                        magnification: options?.magnification,
                        ...(context ? { context } : {}),
                    });
                    results.push({
                        index: region.index,
                        bounds: region.bounds,
                        findings: res?.findings ?? null,
                        isComplete: res?.isComplete ?? true,
                    });
                } else {
                    const raster = await this._renderRegionRaster(viewer, region.bounds, {
                        targetPixels: MASK_TARGET_PIXELS,
                        magnification: options?.magnification,
                        layers: "background",
                    });
                    const { mask } = await this._runTissueMask(viewer, options?.driver, raster);
                    const total = mask.width * mask.height;
                    results.push({
                        index: region.index,
                        bounds: region.bounds,
                        viewCoverage: total ? this._countFilled(mask.binaryMask) / total : 0,
                        isComplete: raster.isComplete,
                    });
                }
            } catch (e: any) {
                results.push({ index: region.index, bounds: region.bounds, error: e?.message || String(e) });
            }
        }
        return results;
    }

    /**
     * Build (or reuse) a hierarchical "expert overview" of the slide: orient with
     * {@link exploreSlide}, then walk the top tissue islands, describe each with the
     * `analyze` vision model, score them for interest/relevance, and recurse into the
     * interesting ones at higher magnification — like a pathologist opening a case.
     * The walk is budgeted (the vision backend is slow, concurrency 4) and the whole
     * tree is cached per slide so broad chat queries can reuse the descriptions
     * instead of re-sweeping. Viewer-explicit; every node is rendered off-screen, so
     * the user's viewport is never touched and the user can keep navigating freely.
     *
     * Requires an `analyze` driver. Every finding is a model-assisted observation,
     * never a diagnosis.
     */
    async buildOverview(viewer: any, options?: BuildOverviewOptions): Promise<OverviewResult> {
        if (!viewer) throw new Error("buildOverview() requires a viewer.");
        if (!this._hasFeature("analyze", options?.driver)) {
            throw new Error("buildOverview needs an 'analyze' driver (e.g. a configured vision model).");
        }
        const opts: ResolvedOverviewOptions = {
            query: options?.query,
            driver: options?.driver,
            context: this._normalizeContext(options?.context),
            repairVerdict: options?.repairVerdict ?? true,
            measureFill: options?.measureFill ?? true,
            progress: options?.progress ?? true,
            maxDepth: options?.maxDepth ?? 2,
            breadth: options?.breadth ?? 4,
            interestThreshold: options?.interestThreshold ?? 0.5,
            minDrillFill: options?.minDrillFill ?? 0.1,
            // Drilling now actually happens (an unresolvable view no longer prunes itself),
            // so the run needs room for the rungs it will legitimately climb.
            maxAnalyzeCalls: options?.maxAnalyzeCalls ?? 18,
            maxNodes: options?.maxNodes ?? 24,
            subdivide: options?.subdivide ?? "tissue",
            annotate: options?.annotate ?? false,
            synthesize: options?.synthesize ?? true,
            reuse: options?.reuse ?? false,
        };
        const ladder = this._resolveLadder(viewer, options?.magnificationLadder);
        // Everything the walk was told about the slide is now established for the slide, not
        // just for this run: later drills reuse it instead of asking the user a second time.
        this.setSlideContext(viewer, opts.context);

        if (opts.reuse) {
            const cached = this.getOverview(viewer);
            if (cached) return cached;
        }

        const budget: OverviewBudget = { analyzeCalls: 0, repairCalls: 0, nodesVisited: 0, truncated: false };

        // A walk is many slow model calls. Give the user something to watch and a way
        // out, and compose any caller-supplied signal into the same controller so both
        // routes stop the same way.
        const control = new AbortController();
        const onExternalAbort = () => control.abort();
        options?.signal?.addEventListener("abort", onExternalAbort);
        if (options?.signal?.aborted) control.abort();
        const dialog = this._openOverviewProgress(viewer, opts, control);

        // Published after every node so a timeout, a cancel, or a lost tab costs nothing
        // already paid for: getOverview() returns whatever has been described so far.
        const rootNodes: OverviewNode[] = [];
        let exploration: SlideExploration | null = null;
        const publish = (): OverviewResult => {
            const result: OverviewResult = {
                status: "ok",
                driver: this.describeDriverForFeature("analyze", opts.driver).id,
                query: opts.query,
                context: opts.context,
                slide: exploration?.slide ?? { width: 0, height: 0, micronsPerPixel: null, magnification: null },
                slideCoverage: exploration?.slideCoverage ?? 0,
                coverageScope: "whole-slide",
                isComplete: exploration?.isComplete ?? false,
                root: rootNodes,
                ranked: this._rankOverviewNodes(rootNodes),
                summary: opts.synthesize ? this._overviewDigest(rootNodes, opts.query) : undefined,
                cancelled: control.signal.aborted,
                warnings: this._overviewWarnings(rootNodes, opts, budget, control.signal.aborted, ladder),
                builtAtIso: new Date().toISOString(),
                budget,
            };
            this._storeOverview(viewer, result);
            return result;
        };

        try {
            exploration = await this.exploreSlide(viewer, { driver: opts.driver });
            const slideArea = Math.max(1, exploration.slide.width * exploration.slide.height);
            const roots = exploration.regions.slice(0, opts.breadth);

            for (const region of roots) {
                // Cancellation is checked between nodes: a node in flight is parked on a
                // model call we cannot recall, so we stop at the next boundary instead of
                // pretending we aborted mid-request.
                if (control.signal.aborted) break;
                if (this._budgetExhausted(budget, opts)) { budget.truncated = true; break; }
                const node = await this._exploreOverviewNode(
                    viewer, region, 0, opts, ladder, budget, slideArea, null, control.signal, dialog
                );
                if (node) rootNodes.push(node);
                publish();
            }
            return publish();
        } finally {
            options?.signal?.removeEventListener("abort", onExternalAbort);
            // `done(0)` means "hold the dialog open until close() is called" — and nothing ever
            // called it, so a finished walk left "Exploring the slide" on screen forever. A
            // completed walk shows the bar full and auto-closes; a cancelled one has nothing to
            // celebrate and closes at once.
            if (control.signal.aborted) dialog?.close?.();
            else dialog?.done?.();
        }
    }

    /**
     * A cancellable progress dialog for a walk, or null when the UI is unavailable or the
     * caller opted out. Anchored to the viewer being walked — in a grid, a full-screen
     * dialog would not say *which* slide is busy. Never throws: progress UI failing must
     * not take the walk down with it.
     */
    private _openOverviewProgress(viewer: any, opts: ResolvedOverviewOptions, control: AbortController): any {
        if (opts.progress === false) return null;
        try {
            const UI = (window as any).UI;
            if (!UI?.ProgressDialog) return null;
            const dialog = UI.ProgressDialog.show({
                title: t("pathology.overviewProgressTitle"),
                label: t("pathology.overviewProgressStarting"),
                hint: t("pathology.overviewProgressHint"),
                total: opts.maxNodes,
                cancellable: true,
                // The walk renders off-screen and only competes for bandwidth/GPU, so the
                // user may keep navigating — the chat panel carries progress while hidden.
                backgroundable: true,
                viewer,
            });
            // The walk can only stop at a node boundary — the vision call in flight cannot be
            // recalled — so say that. Without it the click looked ignored for as long as that
            // call took, and the label kept advertising the region it was still finishing.
            dialog.onCancel(() => {
                control.abort();
                dialog.setLabel(t("pathology.overviewProgressCancelling"));
            });
            return dialog;
        } catch (_) {
            return null;
        }
    }

    /**
     * Fill in a context's defaults without ever guessing. An absent context, or one whose
     * stain class was not stated, degrades CLOSED to "unknown" — the prompt then forbids
     * naming a stain or site rather than leaving a silence the model would fill itself.
     */
    private _normalizeContext(ctx?: SlideContext): SlideContext {
        if (!ctx) return { source: "unknown" };
        const targets = (ctx.targets || []).map(s => String(s).trim()).filter(Boolean);
        const stain = ctx.stain?.trim() || undefined;
        const organ = ctx.organ?.trim() || undefined;
        let stainClass: StainClass = ctx.stainClass || "unknown";
        // A targeted/fluorescence stain whose targets nobody recorded licenses no target
        // claim at all — it must not end up more permissive than an unknown stain. Same
        // for a class asserted without a stain to name.
        const targetsMissing = (stainClass === "targeted" || stainClass === "fluorescence") && !targets.length;
        if (targetsMissing || !stain) stainClass = "unknown";
        const source: SlideContext["source"] = (stain || organ) ? (ctx.source || "explicit") : "unknown";
        return {
            stain,
            stainClass,
            targets: targets.length ? targets : undefined,
            organ,
            notes: ctx.notes?.trim() || undefined,
            source,
            // Carried through: dropping it here would re-open the "asked and answered"
            // question on the very next call that normalizes the same context.
            ...(ctx.acknowledgedUnknown ? { acknowledgedUnknown: true } : {}),
        };
    }

    /** Caveats the caller must surface; derived locally, no model call. */
    private _overviewWarnings(
        roots: OverviewNode[],
        opts: ResolvedOverviewOptions,
        budget: OverviewBudget,
        cancelled = false,
        ladder?: OverviewLadder
    ): string[] {
        const warnings: string[] = [];
        let unparsed = 0;
        let unresolved = 0;
        const walk = (n: OverviewNode) => {
            if (n.verdict?.source === "unparsed") unparsed++;
            // A leaf still short of its rung is a claim the walk could not settle — the
            // caller must know that before quoting its findings as a read of the tissue.
            if (n.resolutionShortfall && !n.children.length) unresolved++;
            n.children.forEach(walk);
        };
        roots.forEach(walk);
        if (cancelled) warnings.push(t("pathology.warnCancelled"));
        if (unparsed) warnings.push(t("pathology.warnUnparsedVerdict", { count: unparsed }));
        if (unresolved) warnings.push(t("pathology.warnUnresolvedLeaves", { count: unresolved }));
        if (ladder && !ladder.derived) warnings.push(t("pathology.warnLadderUncalibrated"));
        if (opts.context.source === "unknown" || !opts.context.stain || !opts.context.organ) {
            warnings.push(t("pathology.warnContextUnknown"));
        }
        for (const conflict of this._contradictionWarnings(roots)) warnings.push(conflict);
        if (budget.truncated) warnings.push(t("pathology.warnTruncated"));
        return warnings;
    }

    /**
     * Parent/child findings that assert opposite polarity about the same feature.
     *
     * A drill exists to overturn the parent's read, so disagreement is normal and the finer
     * view usually wins — but the caller composing a report sees both texts and has no way
     * to know they conflict. Silently picking one is how "basal cells absent" at one rung
     * and "basal cells present and intact" at the next both end up in the same report.
     *
     * Deliberately vocabulary-free: it pairs a generic negation pattern with whatever noun
     * phrase the model used, so it never needs a clinical term list to maintain.
     */
    private _contradictionWarnings(roots: OverviewNode[], max = 3): string[] {
        const out: string[] = [];
        const negated = (text: string): Set<string> => {
            const found = new Set<string>();
            const patterns = [
                /\b(?:no|without|absent|lacking|lack of|loss of|not)\s+((?:[a-z]+\s+){0,2}[a-z]+)\b/gi,
                /\b((?:[a-z]+\s+){0,2}[a-z]+)\s+(?:is|are|was|were)?\s*(?:absent|not (?:seen|identified|present))\b/gi,
            ];
            for (const re of patterns) {
                for (const m of text.matchAll(re)) found.add(m[1].toLowerCase().trim());
            }
            return found;
        };
        const asserted = (text: string): Set<string> => {
            const found = new Set<string>();
            const re = /\b((?:[a-z]+\s+){0,2}[a-z]+)\s+(?:is|are|was|were)?\s*(?:present|intact|preserved|identified)\b/gi;
            for (const m of text.matchAll(re)) found.add(m[1].toLowerCase().trim());
            return found;
        };
        const walk = (node: OverviewNode) => {
            for (const child of node.children) {
                if (out.length >= max) return;
                if (node.findings && child.findings) {
                    const conflicts = [
                        ...[...negated(node.findings)].filter(k => asserted(child.findings!).has(k)),
                        ...[...asserted(node.findings)].filter(k => negated(child.findings!).has(k)),
                    ];
                    if (conflicts.length) {
                        out.push(t("pathology.warnContradiction", {
                            feature: conflicts[0],
                            parentIndex: node.index,
                            parentDepth: node.depth,
                            childIndex: child.index,
                            childDepth: child.depth,
                        }));
                    }
                }
                walk(child);
            }
        };
        roots.forEach(walk);
        return out.slice(0, max);
    }

    /** The cached overview for the slide open in `viewer`, or null. */
    getOverview(viewer: any): OverviewResult | null {
        if (!viewer) throw new Error("getOverview() requires a viewer.");
        const key = this._slideKey(viewer);
        return (key && this._overviews.get(key)) || null;
    }

    /** Drop the cached overview for the slide open in `viewer` (forces a rebuild). */
    clearOverview(viewer: any): void {
        if (!viewer) throw new Error("clearOverview() requires a viewer.");
        const key = this._slideKey(viewer);
        if (key) {
            this._overviews.delete(key);
            this._slideContexts.delete(key);
        }
    }

    /** What has been established about the slide open in `viewer`, or null. */
    getSlideContext(viewer: any): SlideContext | null {
        const key = viewer && this._slideKey(viewer);
        return (key && this._slideContexts.get(key)) || null;
    }

    /**
     * Remember what the slide is, for every later call on it.
     *
     * The engine never derives this itself (that reads patient-sensitive sources, which is
     * the scripting adapter's job under its own consent rules) — it only stores what it is
     * handed. A `source: "unknown"` context is stored too: "the user was asked and could not
     * say" is an answer, and re-asking it is exactly the loop this cache exists to break.
     */
    setSlideContext(viewer: any, context: SlideContext): SlideContext {
        const normalized = this._normalizeContext(context);
        const key = viewer && this._slideKey(viewer);
        if (key) this._slideContexts.set(key, normalized);
        return normalized;
    }

    /**
     * The per-depth render targets for a walk.
     *
     * Derived from {@link OVERVIEW_MPP_LADDER} against the slide's own calibration, so each
     * rung asks for a RESOLUTION and the objective number follows from the scan. An explicit
     * `magnificationLadder` from the caller is honoured verbatim — it is a deliberate
     * override, and second-guessing it would make the knob useless.
     *
     * `derived` is false when neither calibration nor an override was available and the walk
     * fell back to the legacy fixed rungs; the caller warns about it.
     */
    private _resolveLadder(viewer: any, explicit?: Array<number | null>): OverviewLadder {
        if (Array.isArray(explicit) && explicit.length) {
            return { magnifications: explicit, targetMpp: explicit.map(() => null), derived: true };
        }
        const mpp = this._micronsPerPixel(viewer);
        const nativeMag = this._nativeMagnification(viewer);
        if (!mpp || !nativeMag) {
            return { magnifications: [null, 10, 20], targetMpp: [null, null, null], derived: false };
        }
        // objective power that samples the slide at `target` µm per raster pixel
        const magFor = (target: number) => Math.max(1, Math.min(nativeMag, nativeMag * (mpp / target)));
        return {
            magnifications: OVERVIEW_MPP_LADDER.map(magFor),
            targetMpp: [...OVERVIEW_MPP_LADDER],
            derived: true,
        };
    }

    /** Native objective power of the scan, or null when the slide carries no scalebar basis. */
    private _nativeMagnification(viewer: any): number | null {
        try {
            const mag = viewer?.scalebar?.magnification;
            return typeof mag === "number" && mag > 0 ? mag : null;
        } catch {
            return null;
        }
    }

    /**
     * Render one region off-screen, describe + score it with the vision model, and — when
     * the model finds it interesting, OR when the render could not carry the detail the
     * question needs — subdivide it into finer tissue islands and recurse. Budget-aware at
     * every step.
     */
    private async _exploreOverviewNode(
        viewer: any,
        region: SlideRegion,
        depth: number,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder,
        budget: OverviewBudget,
        slideArea: number,
        parent: OverviewNode | null,
        signal: AbortSignal,
        dialog: any
    ): Promise<OverviewNode | null> {
        if (signal.aborted) return null;
        if (budget.nodesVisited >= opts.maxNodes) { budget.truncated = true; return null; }
        budget.nodesVisited++;
        dialog?.setLabel?.(t("pathology.overviewProgressRegion", { depth, index: region.index }));
        this.raiseEvent("overview-progress", {
            phase: "region-start",
            viewerId: viewer?.uniqueId,
            depth,
            index: region.index,
            nodesVisited: budget.nodesVisited,
            maxNodes: opts.maxNodes,
            analyzeCalls: budget.analyzeCalls,
            maxAnalyzeCalls: opts.maxAnalyzeCalls,
        });

        const rung = Math.min(depth, ladder.magnifications.length - 1);
        const requestedMag = ladder.magnifications[rung] ?? null;
        const targetMpp = ladder.targetMpp[rung] ?? null;
        // Render the padded region OFF-SCREEN — the user's viewport is never moved.
        // The padding matches what the prompt quotes (OVERVIEW_FRAME_PADDING).
        const paddedBounds = this._padBoundsToSlide(viewer, region.bounds, OVERVIEW_FRAME_PADDING);
        let raster: RegionRaster;
        try {
            raster = await this._renderRegionRaster(viewer, paddedBounds, {
                magnification: typeof requestedMag === "number" ? requestedMag : undefined,
                targetPixels: typeof requestedMag === "number" ? undefined : REGION_ANALYZE_TARGET_PIXELS,
                layers: "background",
            });
        } catch (e: any) {
            return {
                index: region.index,
                depth,
                bounds: region.bounds,
                center: region.center,
                magnification: null,
                areaFraction: region.areaFraction,
                slideAreaFraction: Math.max(0, Math.min(1, (region.bounds.width * region.bounds.height) / slideArea)),
                bboxFillFraction: null,
                fieldOfViewUm: null,
                findings: null,
                interest: null,
                decision: "stop",
                isComplete: false,
                children: [],
                error: e?.message || String(e),
            };
        }
        const loaded = raster.isComplete;

        // Measure what was ACTUALLY rendered — the requested magnification may have been
        // clamped (render-size caps), and the prompt is about to quote these numbers.
        const facts = await this._measureNodeView(viewer, region, slideArea, opts, raster, targetMpp);

        const node: OverviewNode = {
            index: region.index,
            depth,
            bounds: region.bounds,
            center: region.center,
            magnification: facts.magnification,
            areaFraction: region.areaFraction,
            slideAreaFraction: facts.slideAreaFraction,
            bboxFillFraction: facts.bboxFillFraction,
            fieldOfViewUm: facts.fieldOfViewUm,
            renderedMpp: facts.renderedMpp,
            resolutionShortfall: facts.resolutionShortfall,
            findings: null,
            interest: null,
            decision: "leaf",
            isComplete: loaded,
            children: [],
        };

        if (budget.analyzeCalls >= opts.maxAnalyzeCalls) {
            budget.truncated = true;
            node.decision = "stop";
            return node;
        }

        try {
            const prompt = this._overviewPrompt(opts, facts, depth, parent);
            budget.analyzeCalls++;
            const res = await this.analyzeRegion(viewer, {
                prompt,
                driver: opts.driver,
                source: "background",
                region: paddedBounds,
                preRead: raster,
            });
            node.findings = res?.findings ?? null;
            let verdict = this._parseOverviewVerdict(res?.findings, opts.query);

            // The model answered but skipped the machine line. One bounded re-ask is far
            // cheaper than losing the node's score — and much safer than inventing a 0.
            if (verdict.source === "unparsed" && this._canRepairVerdict(opts, budget)) {
                budget.analyzeCalls++;
                budget.repairCalls++;
                const repair = await this.analyzeRegion(viewer, {
                    prompt: `${prompt}\n\n${t("pathology.verdictRepairPrompt")}`,
                    driver: opts.driver,
                    source: "background",
                    region: paddedBounds,
                    preRead: raster,
                });
                const repaired = this._parseOverviewVerdict(repair?.findings, opts.query);
                if (repaired.source !== "unparsed") verdict = repaired;
            }

            node.verdict = verdict;
            node.interest = verdict.interest;

            // tick() takes an ABSOLUTE count against the dialog's `total` (maxNodes),
            // not an increment — nodesVisited is exactly that count.
            dialog?.tick?.(budget.nodesVisited);

            // Two independent reasons to go deeper, and they must stay independent.
            //
            // The first is the one the model volunteers: this looks worth a closer read.
            // A model that hedges has not earned more of the budget for THAT reason.
            const wantsDrill = verdict.drill
                && (verdict.interest ?? 0) >= opts.interestThreshold
                && verdict.confidence !== "low";

            // The second is the one the walk must not need permission for: the view cannot
            // carry the detail the question is about — either measured here (the render
            // landed short of its rung) or stated by the model (RESOLVABLE: no). Treating
            // that as a stop is a death spiral: the region is unreadable, so it scores low
            // and hedges, so it is never re-read at a resolution that could settle it.
            // Guarded by real tissue: chasing a sharper picture of background is waste.
            const unresolved = verdict.resolvable === false || facts.resolutionShortfall;
            const mustResolve = unresolved && (facts.bboxFillFraction ?? 1) >= opts.minDrillFill;

            const canDrill = depth < opts.maxDepth
                && (wantsDrill || mustResolve)
                && loaded
                && !signal.aborted
                && !this._budgetExhausted(budget, opts);

            if (canDrill) {
                const children = await this._subdivideRegion(viewer, region.bounds, opts.driver);
                if (children.length) {
                    node.decision = wantsDrill ? "drill" : "resolve";
                    for (const child of children.slice(0, opts.breadth)) {
                        if (signal.aborted) break;
                        if (this._budgetExhausted(budget, opts)) { budget.truncated = true; break; }
                        const childNode = await this._exploreOverviewNode(
                            viewer, child, depth + 1, opts, ladder, budget, slideArea, node, signal, dialog
                        );
                        if (childNode) node.children.push(childNode);
                    }
                } else {
                    node.decision = "stop";
                }
            } else {
                // Reached the depth cap while still interesting — or still unreadable —
                // => a genuine leaf; otherwise the model (or the defensive parser) stopped.
                node.decision = ((verdict.drill || unresolved) && depth >= opts.maxDepth) ? "leaf" : "stop";
            }

            if (opts.annotate) {
                try { this._annotateRegionBox(viewer, region.bounds); } catch { /* non-fatal */ }
            }
        } catch (e: any) {
            node.error = e?.message || String(e);
            node.decision = "stop";
        }
        return node;
    }

    /**
     * Subdivide a region into finer children in parent-global image coords, from an
     * OFF-SCREEN render of the parent bounds (the user's viewport is not involved).
     * When the tissue is several distinct islands it uses them, otherwise (one
     * contiguous mass) it falls back to a tissue-aware N×N GRID so drilling always
     * yields genuinely SMALLER, higher-magnification children — never a reframe of
     * the same box. Children are clamped inside the parent and any that fail to
     * shrink are dropped. Ranked largest-first.
     */
    private async _subdivideRegion(viewer: any, parentBounds: Bounds, driverId?: string): Promise<SlideRegion[]> {
        const raster = await this._renderRegionRaster(viewer, parentBounds, {
            targetPixels: MASK_TARGET_PIXELS,
            layers: "background",
        });
        const { mask } = await this._runTissueMask(viewer, driverId, raster);
        const total = mask.width * mask.height;
        if (!total) return [];
        // Mask px → parent-global: a pure linear map over the rendered parent bounds.
        const mapPoint = (px: number, py: number): Point => ({
            x: parentBounds.x + (px / mask.width) * parentBounds.width,
            y: parentBounds.y + (py / mask.height) * parentBounds.height,
        });
        const toParent = (p: Point): Point => p;

        // Tissue islands within the framed view (parent coords, ranked largest-first).
        const islands = this._traceOuterContours(mask)
            .map(pts => ({ pts, area: polygonArea(pts) }))
            .filter(r => r.area >= 0.01 * total)
            .sort((a, b) => b.area - a.area)
            .map(r => {
                const poly = r.pts.map(p => toParent(mapPoint(p.x, p.y)));
                const b = boundsOfPolygons([poly]);
                return b ? { bounds: b, areaFraction: r.area / total } : null;
            })
            .filter((c): c is { bounds: Bounds; areaFraction: number } => !!c);

        // Genuine multi-island split needs ≥2 islands with no single one dominating
        // the frame; otherwise grid-split the contiguous mass into smaller cells.
        const candidates = (islands.length >= 2 && islands[0].areaFraction <= 0.6)
            ? islands
            : this._gridSplitTissue(mask, mapPoint, toParent);

        const parentArea = Math.max(1, parentBounds.width * parentBounds.height);
        const px1 = parentBounds.x + parentBounds.width, py1 = parentBounds.y + parentBounds.height;
        const regions: SlideRegion[] = [];
        for (const c of candidates) {
            // Keep the child inside the region the user was pointed at.
            const bx0 = Math.max(parentBounds.x, c.bounds.x), by0 = Math.max(parentBounds.y, c.bounds.y);
            const bx1 = Math.min(px1, c.bounds.x + c.bounds.width), by1 = Math.min(py1, c.bounds.y + c.bounds.height);
            const w = bx1 - bx0, h = by1 - by0;
            if (!(w > 0) || !(h > 0)) continue;
            const bounds: Bounds = { x: bx0, y: by0, width: w, height: h };
            // Progress guard: a child must be meaningfully smaller than its parent.
            if (bounds.width * bounds.height > 0.7 * parentArea) continue;
            regions.push({
                index: regions.length,
                bounds,
                center: centerOf(bounds)!,
                areaFraction: c.areaFraction,
                isApproximate: true,
            });
        }
        return regions;
    }

    /**
     * Split the framed view's tissue into an N×N grid (default 3×3), keeping only
     * cells that actually contain tissue, and map each cell rect to parent-global
     * image coords. Guarantees smaller children when the tissue is one contiguous mass.
     */
    private _gridSplitTissue(
        mask: MaskResult,
        mapPoint: (px: number, py: number) => Point,
        toParent: (p: Point) => Point,
        n = 3
    ): Array<{ bounds: Bounds; areaFraction: number }> {
        const total = mask.width * mask.height || 1;
        const cw = mask.width / n, ch = mask.height / n;
        const cells: Array<{ bounds: Bounds; areaFraction: number }> = [];
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                const x0 = Math.floor(gx * cw), y0 = Math.floor(gy * ch);
                const x1 = Math.floor((gx + 1) * cw), y1 = Math.floor((gy + 1) * ch);
                let area = 0, filled = 0;
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        area++;
                        if (mask.binaryMask[y * mask.width + x]) filled++;
                    }
                }
                // Skip near-empty cells so vision budget is not spent on glass.
                if (!area || filled / area < 0.05) continue;
                const tl = toParent(mapPoint(x0, y0));
                const br = toParent(mapPoint(x1, y1));
                const bounds: Bounds = {
                    x: Math.min(tl.x, br.x),
                    y: Math.min(tl.y, br.y),
                    width: Math.abs(br.x - tl.x),
                    height: Math.abs(br.y - tl.y),
                };
                cells.push({ bounds, areaFraction: filled / total });
            }
        }
        return cells.sort((a, b) => b.areaFraction - a.areaFraction);
    }

    /**
     * Flatten the overview tree into a ranked list of the described regions.
     *
     * Ranking on raw interest alone (and breaking ties deeper-first) rewards exactly the
     * failure mode this walk is prone to: the model zooms in, sees more detail, scores
     * itself higher with nothing to check against, and a sliver of a region under an
     * uninteresting parent tops the list. So weight each score by how much its ancestors
     * believed in it, how confident the model said it was, and how much slide and real
     * tissue the box actually holds. Raw `interest` is preserved untouched; the weights
     * are exposed via `rankScore` so a caller can explain the order.
     */
    private _rankOverviewNodes(roots: OverviewNode[]): OverviewNode[] {
        const flat: Array<{ node: OverviewNode; pathPrior: number }> = [];
        const walk = (n: OverviewNode, ancestors: number[]) => {
            flat.push({ node: n, pathPrior: this._pathPrior(ancestors) });
            const next = n.interest != null ? [...ancestors, n.interest] : ancestors;
            n.children.forEach(c => walk(c, next));
        };
        roots.forEach(r => walk(r, []));

        const described = flat.filter(e => e.node.findings && e.node.bounds && !e.node.error);
        const maxArea = Math.max(...described.map(e => e.node.slideAreaFraction || 0), Number.EPSILON);

        for (const { node, pathPrior } of described) {
            node.rankScore = node.interest == null
                ? -1 // unknown interest — sorts last, never treated as a real 0
                : node.interest * pathPrior * this._confidenceWeight(node) * this._areaWeight(node, maxArea) * this._fillWeight(node);
        }

        return described
            .map(e => e.node)
            .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1) || b.slideAreaFraction - a.slideAreaFraction)
            .slice(0, 12);
    }

    /** Geometric mean of the ancestors' interest; neutral (0.5) at the root or when unscored. */
    private _pathPrior(ancestors: number[]): number {
        if (!ancestors.length) return 1;
        const product = ancestors.reduce((acc, v) => acc * Math.max(v, 0.01), 1);
        return Math.pow(product, 1 / ancestors.length);
    }

    /** A model that hedged should not outrank one that did not. */
    private _confidenceWeight(node: OverviewNode): number {
        switch (node.verdict?.confidence) {
            case "low": return 0.5;
            case "medium": return 0.85;
            case "high": return 1;
            default: return 0.85;
        }
    }

    /** Mild, never dominant: a large region is favoured, but area alone cannot win. */
    private _areaWeight(node: OverviewNode, maxArea: number): number {
        const ratio = (node.slideAreaFraction || 0) / maxArea;
        return Math.max(0.35, Math.min(1, Math.sqrt(ratio)));
    }

    /** A box that is mostly background earned its score on very little tissue. */
    private _fillWeight(node: OverviewNode): number {
        if (node.bboxFillFraction == null) return 1;
        return node.bboxFillFraction >= 0.15 ? 1 : 0.6;
    }

    /**
     * The full per-node prompt: what we know about the slide, what we measured about this
     * view, what the parent said, the region/query question, and the verdict contract.
     *
     * A vision model handed a bare image and asked to score it has no way to know the
     * stain, the site, or the scale — so it invents them. Everything stated here is
     * something the module already holds or just measured; nothing is guessed.
     */
    private _overviewPrompt(
        opts: ResolvedOverviewOptions,
        facts: NodeViewFacts,
        depth: number,
        parent: OverviewNode | null
    ): string {
        const question = opts.query
            ? t("pathology.overviewQueryPrompt", { query: opts.query })
            : t("pathology.overviewRegionPrompt");
        return [
            ...this._contextPreamble(opts.context, facts, depth, parent),
            question,
            t("pathology.verdictContract"),
        ].join(" ");
    }

    /**
     * The context sentences prepended to every overview analyze call.
     *
     * Deliberately parameterized: the stain line is chosen by the stain's SIGNAL CLASS and
     * has the caller's own stain/target names substituted in, so it constrains a stain the
     * module has never heard of just as well as a common one. No sentence here names a
     * stain, marker, organ, or diagnosis — that would be a clinical enumeration rotting in
     * the source the first time a deployment mounts something unanticipated.
     */
    private _contextPreamble(
        ctx: SlideContext,
        facts: NodeViewFacts,
        depth: number,
        parent: OverviewNode | null
    ): string[] {
        const lines: string[] = [t("pathology.ctxIntro")];

        // What the stain can license the model to claim.
        const targets = (ctx.targets || []).join(", ");
        switch (ctx.stainClass) {
            case "histochemical":
                lines.push(t("pathology.ctxStainHistochemical", { stain: ctx.stain }));
                break;
            case "targeted":
                lines.push(t("pathology.ctxStainTargeted", { stain: ctx.stain, targets }));
                break;
            case "fluorescence":
                lines.push(t("pathology.ctxStainFluorescence", { stain: ctx.stain, targets }));
                break;
            case "unstained":
                lines.push(t("pathology.ctxStainUnstained", { stain: ctx.stain }));
                break;
            default:
                // A named stain whose class nobody stated (or a targeted one with no
                // recorded targets) still tells the model more than nothing: name it, and
                // license nothing beyond it. Only a wholly unnamed stain gets the blind line.
                lines.push(ctx.stain
                    ? t("pathology.ctxStainNamedUnknownClass", { stain: ctx.stain })
                    : t("pathology.ctxStainUnknown"));
        }

        lines.push(ctx.organ
            ? t("pathology.ctxOrganKnown", { organ: ctx.organ })
            : t("pathology.ctxOrganUnknown"));
        if (ctx.notes) lines.push(t("pathology.ctxNotes", { notes: ctx.notes }));

        // How big this view actually is — without it, sparse fragments read as a mass — and
        // at what resolution. The µm/px quoted is the RENDERED one: the raster is downsampled
        // to fit the pixel budget, and a model told the slide's native value believes it can
        // see nuclear detail that was resampled away before the image ever left the viewer.
        lines.push(facts.fieldOfViewUm
            ? t("pathology.ctxScale", {
                fovWidthUm: Math.round(facts.fieldOfViewUm.width),
                fovHeightUm: Math.round(facts.fieldOfViewUm.height),
                mag: facts.magnification != null ? this._round(facts.magnification, 1) : "?",
                mpp: this._round(facts.renderedMpp
                    ?? facts.fieldOfViewUm.width / Math.max(1, facts.rasterPx.width), 3),
            })
            : t("pathology.ctxScaleUncalibrated", {
                fovWidthPx: Math.round(facts.fieldOfViewPx.width),
                fovHeightPx: Math.round(facts.fieldOfViewPx.height),
            }));

        // Say plainly when the render could not carry this rung's detail, so the model
        // reports what it can see instead of inferring what it "should" be able to see.
        if (facts.resolutionShortfall && facts.renderedMpp) {
            lines.push(t("pathology.ctxResolutionShortfall", {
                renderedMpp: this._round(facts.renderedMpp, 2),
            }));
        }

        const geometryArgs = {
            paddingPercent: Math.round(OVERVIEW_FRAME_PADDING * 100),
            slideAreaFraction: this._round(facts.slideAreaFraction * 100, 2),
        };
        lines.push(facts.bboxFillFraction != null
            ? t("pathology.ctxGeometry", { ...geometryArgs, fillPercent: Math.round(facts.bboxFillFraction * 100) })
            : t("pathology.ctxGeometryNoFill", geometryArgs));

        // Anchor the drill against the parent, or the model just re-scores itself upward.
        const parentGist = parent?.findings ? this._gistOf(parent.findings) : null;
        if (parentGist) lines.push(t("pathology.ctxParent", { depth, parentGist }));

        lines.push(t("pathology.ctxHonesty"));
        return lines;
    }

    /** First sentence of a findings text, capped — used wherever a short gist is needed. */
    private _gistOf(findings: string, max = 200): string {
        return String(findings).split(/(?<=[.!?])\s/)[0].slice(0, max);
    }

    private _round(v: number, decimals: number): number {
        const f = Math.pow(10, decimals);
        return Math.round(v * f) / f;
    }

    /**
     * Measure what was actually RENDERED for the node's region. It exists because the
     * module must report the magnification and the RESOLUTION the raster really achieved —
     * the request may have been clamped by the render-size caps — and the prompt quotes
     * these numbers. The tissue fill is measured on the same raster the model is about to see.
     *
     * The resolution matters more than it looks. A region render is downsampled to fit the
     * pixel budget, so the slide's native µm/px describes an image the model was never
     * sent: quoting it tells a model looking at 1.4 µm/px that it has 0.25 µm/px, and it
     * then answers cytology questions it cannot see the answer to.
     */
    private async _measureNodeView(
        viewer: any,
        region: SlideRegion,
        slideArea: number,
        opts: { measureFill: boolean; driver?: string },
        raster: RegionRaster,
        targetMpp: number | null = null
    ): Promise<NodeViewFacts> {
        const bounds = region.bounds;
        const fieldOfViewPx = {
            width: Math.max(1, bounds.width || 1),
            height: Math.max(1, bounds.height || 1),
        };
        const mpp = this._micronsPerPixel(viewer);
        let fill: number | null = null;
        if (opts.measureFill) {
            try {
                // A ratio over the raster — scale-invariant, so a small raster suffices.
                // Reuse the node raster when it is mask-sized; re-render small otherwise.
                const fillRaster = raster.width * raster.height <= MASK_MAX_PIXELS
                    ? raster
                    : await this._renderRegionRaster(viewer, raster.renderedBounds, {
                        targetPixels: MASK_TARGET_PIXELS,
                        layers: "background",
                    });
                const { mask } = await this._runTissueMask(viewer, opts.driver, fillRaster);
                const total = mask.width * mask.height;
                fill = total ? this._countFilled(mask.binaryMask) / total : null;
            } catch {
                fill = null;
            }
        }
        // `raster.scale` is level-0 image pixels per raster pixel, so this is the µm/px of
        // the image the model receives — never the slide's native value.
        const renderedMpp = mpp ? mpp * (raster.scale || 1) : null;
        return {
            magnification: raster.renderedMagnification,
            fieldOfViewUm: mpp ? { width: fieldOfViewPx.width * mpp, height: fieldOfViewPx.height * mpp } : null,
            fieldOfViewPx,
            rasterPx: { width: raster.width, height: raster.height },
            renderedMpp,
            targetMpp,
            resolutionShortfall: !!(targetMpp && renderedMpp
                && renderedMpp > targetMpp * OVERVIEW_RESOLUTION_SHORTFALL_FACTOR),
            slideAreaFraction: Math.max(0, Math.min(1, (bounds.width * bounds.height) / slideArea)),
            bboxFillFraction: fill,
        };
    }

    private _micronsPerPixel(viewer: any): number | null {
        try {
            const mpp = viewer?.scalebar?.micronsPerPixel?.();
            return typeof mpp === "number" && mpp > 0 ? mpp : null;
        } catch {
            return null;
        }
    }

    private _canRepairVerdict(opts: ResolvedOverviewOptions, budget: OverviewBudget): boolean {
        if (!opts.repairVerdict) return false;
        // Cap repairs well below the call budget so a chatty model cannot double the run.
        if (budget.repairCalls >= Math.ceil(opts.maxAnalyzeCalls / 4)) return false;
        return budget.analyzeCalls < opts.maxAnalyzeCalls;
    }

    /**
     * Parse the model's verdict line (`SCORE: <0..1> DRILL: <yes|no> CONFIDENCE: <...>`).
     *
     * Tolerant on the way in, honest on the way out. Models routinely answer on a 1-5 or
     * 1-10 scale, wrap values in the template's own angle brackets, or echo the placeholder;
     * the previous strict 0..1 regex silently turned every one of those into `interest: 0`,
     * which is indistinguishable from a real "not interesting" and hid genuine findings.
     * So: normalize known scales, reject template echoes, and when nothing usable comes back
     * report interest as UNKNOWN (null) rather than inventing a number. DRILL and CONFIDENCE
     * parse independently — a missing SCORE must not discard a stated DRILL.
     */
    private _parseOverviewVerdict(text: string | null | undefined, query?: string): OverviewVerdict {
        if (!text || typeof text !== "string") {
            return { interest: null, drill: false, confidence: null, resolvable: null, source: "unparsed" };
        }

        const drillMatch = text.match(/DRILL\s*[:=]\s*[<*`"']*\s*(yes|no|true|false)/i);
        const drill = drillMatch ? /^(yes|true)$/i.test(drillMatch[1]) : false;
        const confMatch = text.match(/CONFIDENCE\s*[:=]\s*[<*`"']*\s*(low|medium|high)/i);
        const confidence = (confMatch ? confMatch[1].toLowerCase() : null) as OverviewVerdict["confidence"];
        // Parsed independently, and NULL when unstated — an axis the model omitted must not
        // read as "resolvable: false" (endless drilling) nor as "true" (silent blind spot).
        const resolvableMatch = text.match(/RESOLVABLE\s*[:=]\s*[<*`"']*\s*(yes|no|true|false)/i);
        const resolvable = resolvableMatch ? /^(yes|true)$/i.test(resolvableMatch[1]) : null;

        const scoreMatch = text.match(/SCORE\s*[:=]\s*[<*`"']*\s*([0-9]*\.?[0-9]+)\s*(?:\/\s*([0-9]+))?/i);
        if (scoreMatch && !this._isTemplateEcho(text)) {
            const raw = parseFloat(scoreMatch[1]);
            if (Number.isFinite(raw)) {
                const explicitScale = scoreMatch[2] ? parseFloat(scoreMatch[2]) : null;
                const { interest, scale } = this._normalizeScore(raw, explicitScale);
                return {
                    interest,
                    drill,
                    confidence,
                    resolvable,
                    source: scale === 1 ? "contract" : "normalized",
                    ...(scale === 1 ? {} : { scoreScale: scale }),
                };
            }
        }

        // No usable score. A query gives us a coarse prose signal; without one we know
        // nothing — and "nothing" must stay null, never collapse to 0.
        if (query) {
            return {
                interest: this._keywordInterest(text, query), drill, confidence, resolvable, source: "keyword",
            };
        }
        return { interest: null, drill, confidence, resolvable, source: "unparsed" };
    }

    /**
     * Wrap a caller's prompt in the same grounding the overview walk uses: what the slide is,
     * and what the delivered raster actually shows (size, magnification, resolution).
     *
     * Measured from the raster that is about to be sent, so the numbers describe the image
     * the model receives rather than the slide it came from. Never throws — a grounding
     * failure must degrade to the bare prompt, not lose the analysis.
     */
    private async _groundPrompt(
        viewer: any,
        context: SlideContext,
        raster: RegionRaster,
        driver: string | undefined,
        prompt: string
    ): Promise<string> {
        try {
            const bounds = raster.renderedBounds;
            const slide = this._slideMeta(viewer, this._ref(viewer));
            const slideArea = Math.max(1, slide.width * slide.height);
            const region: SlideRegion = {
                index: 0,
                bounds,
                center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
                areaFraction: 0,
                isApproximate: true,
            };
            // measureFill off: an ad-hoc analyze call should not silently pay for a mask run.
            const facts = await this._measureNodeView(
                viewer, region, slideArea, { measureFill: false, driver }, raster
            );
            return [...this._contextPreamble(context, facts, 0, null), prompt].join(" ");
        } catch {
            return prompt;
        }
    }

    /** True when the model parroted the contract's placeholder instead of filling it in. */
    private _isTemplateEcho(text: string): boolean {
        return /SCORE\s*[:=]\s*<?\s*(?:decimal|number|a\s+decimal|0\s*(?:to|-|\.\.)\s*1\b)/i.test(text);
    }

    /**
     * Map a raw score onto 0..1. An explicit `/N` is authoritative; otherwise infer the
     * scale from the magnitude, since a value above 1 cannot have been on the 0..1 scale
     * the contract asked for. Returns the assumed denominator so callers can flag it.
     */
    private _normalizeScore(raw: number, explicitScale: number | null): { interest: number; scale: number } {
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        if (explicitScale && explicitScale > 0) return { interest: clamp(raw / explicitScale), scale: explicitScale };
        if (raw <= 1) return { interest: clamp(raw), scale: 1 };
        if (raw <= 5) return { interest: clamp(raw / 5), scale: 5 };
        if (raw <= 10) return { interest: clamp(raw / 10), scale: 10 };
        return { interest: clamp(raw / 100), scale: 100 };
    }

    /** Fraction of the query's salient words present in `text` (0..1); 0 without a query. */
    private _keywordInterest(text: string, query?: string): number {
        if (!query) return 0;
        const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        if (!words.length) return 0;
        const hay = text.toLowerCase();
        let hits = 0;
        for (const w of words) if (hay.includes(w)) hits++;
        return Math.min(1, hits / words.length);
    }

    private _budgetExhausted(
        budget: OverviewBudget,
        opts: { maxAnalyzeCalls: number; maxNodes: number }
    ): boolean {
        return budget.analyzeCalls >= opts.maxAnalyzeCalls || budget.nodesVisited >= opts.maxNodes;
    }

    /** A short digest of the highest-interest findings across the tree (local, no model call). */
    private _overviewDigest(roots: OverviewNode[], query?: string): string {
        const flat: OverviewNode[] = [];
        const walk = (n: OverviewNode) => { flat.push(n); n.children.forEach(walk); };
        roots.forEach(walk);
        const ranked = flat
            .filter(n => n.findings)
            .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1))
            .slice(0, 5);
        if (!ranked.length) return t("pathology.overviewDigestEmpty");
        const lines = ranked.map(n => {
            const gist = this._gistOf(String(n.findings));
            const score = n.interest != null ? ` (${n.interest.toFixed(2)})` : "";
            return t("pathology.overviewDigestLine", { index: n.index, depth: n.depth, score, gist });
        });
        return query
            ? t("pathology.overviewDigestQuery", { query, lines: lines.join("\n") })
            : t("pathology.overviewDigest", { lines: lines.join("\n") });
    }

    /** Per-slide cache key: the tiled image's `tileSourceId` (never url). */
    private _slideKey(viewer: any): string | null {
        try {
            const id = this._ref(viewer)?.source?.tileSourceId;
            return id != null ? String(id) : null;
        } catch {
            return null;
        }
    }

    private _storeOverview(viewer: any, result: OverviewResult): void {
        const key = this._slideKey(viewer);
        if (key) this._overviews.set(key, result);
    }

    /** Draw a region's bbox as a polygon annotation (crop-aware, in the ref's local image coords). */
    private _annotateRegionBox(viewer: any, bounds: Bounds): void {
        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);
        const toLocal = (x: number, y: number): Point =>
            cropped ? cropped.fromParentImageCoordinates({ x, y }) : { x, y };
        const poly = [
            toLocal(bounds.x, bounds.y),
            toLocal(bounds.x + bounds.width, bounds.y),
            toLocal(bounds.x + bounds.width, bounds.y + bounds.height),
            toLocal(bounds.x, bounds.y + bounds.height),
        ];
        this._commitPolygons(viewer, this._annotations(), [poly]);
    }

    async tissueCoverage(
        viewer: any,
        annotationId: string | number,
        options?: { driver?: string }
    ): Promise<TissueCoverageResult> {
        // Read 1:1 — the annotation's rings are rasterized against this mask, so its
        // pixels must line up with the geometry rather than a downscaled proxy.
        const { driverId, mask, bg } = await this._runTissueMask(viewer, options?.driver);
        const context = this._annotations();
        const fabric = context.getFabric(viewer);
        const object = fabric?.findObjectOnCanvasByIncrementId?.(annotationId);
        if (!object) throw new Error(`No annotation with id ${annotationId} on the active viewer.`);

        const factory = context.getAnnotationObjectFactory(object.factoryID);
        const raw = factory?.toPointArray?.(object, OSDAnnotations.AnnotationObjectFactory.withObjectPoint);
        if (!raw || !raw.length) throw new Error("The annotation has no polygon geometry to measure.");

        const imageRings: Point[][] = Array.isArray(raw[0]) ? raw : [raw];
        const ref = this._ref(viewer);
        const ratio = OSD.pixelDensityRatio;
        // image → CSS → device px → RASTER px. The last step is 1:1 for this read, but
        // is applied explicitly so the mapping states its assumption instead of relying
        // on it: a raster that is not device-sized would otherwise misalign silently.
        const maskRings = imageRings.map(ring =>
            ring.map((p: Point) => {
                const ve = ref.imageToViewerElementCoordinates(new OSD.Point(p.x, p.y));
                return { x: (ve.x * ratio) / bg.scale, y: (ve.y * ratio) / bg.scale };
            })
        );

        const { area, tissue } = this._coverageOverRings(maskRings, mask);
        // Total tissue in the current view, from the SAME mask → the annotation's
        // share of the visible tissue is resolution-consistent (no navigation).
        const viewTissuePixels = this._countFilled(mask.binaryMask);
        const bounds = boundsOfPolygons([imageRings[0]]);
        return {
            driver: driverId,
            annotationId,
            annotationTissueFraction: area ? tissue / area : 0,
            coverageScope: "annotation-vs-current-view",
            tissuePixels: tissue,
            areaPixels: area,
            viewTissuePixels,
            fractionOfViewTissue: viewTissuePixels ? tissue / viewTissuePixels : 0,
            bounds,
            center: centerOf(bounds),
        };
    }

    // ---- point-driven segmentation + text analysis ----

    /**
     * Segment the region at a point (image coords) via the `segment` feature and
     * commit it as an annotation. `point` is converted to background-render
     * pixels before the driver runs; omit it to seed the view centre.
     */
    async segmentAtPoint(
        viewer: any,
        options: { prompt?: string; driver?: string; point?: Point }
    ): Promise<SegmentResult> {
        if (!viewer) throw new Error("segmentAtPoint() requires a viewer.");
        const driver = this.getDriverForFeature("segment", options?.driver);
        const bg = await this._readBackground(viewer);

        let point: Point | undefined;
        if (options?.point) {
            const ref = this._ref(viewer);
            const ve = ref.imageToViewerElementCoordinates(new OSD.Point(options.point.x, options.point.y));
            point = { x: ve.x * OSD.pixelDensityRatio, y: ve.y * OSD.pixelDensityRatio };
        }

        this.raiseEvent("analysis-started", { driver: driver.id, feature: "segment" });
        try {
            const mask = await driver.features["segment"]!({
                width: bg.width,
                height: bg.height,
                pixels: bg.pixels,
                toBlob: bg.toBlob,
                prompt: options?.prompt || "",
                point,
            });
            const outcome = mask
                ? this._maskToPolygonResult(
                    mask, this._ref(viewer), bg.width * bg.scale, bg.height * bg.scale, OSD.pixelDensityRatio, viewer
                )
                : { polygon: null, status: "empty" as SegmentStatus, statusMessage: "The driver returned no mask for this point." };
            const poly = outcome.polygon;
            const ids = poly ? this._commitPolygons(viewer, this._annotations(), [poly]) : [];
            const bounds = boundsOfPolygons([poly]);
            return {
                driver: driver.id,
                status: outcome.status,
                statusMessage: outcome.statusMessage,
                annotationIds: ids,
                bounds,
                center: centerOf(bounds),
            };
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, feature: "segment" });
        }
    }

    /**
     * Vision → text findings for the current view, or — when `region` is given — for
     * an ARBITRARY slide region rendered OFF-SCREEN (the user's viewport is never moved).
     *
     * Without `region`, `source` decides what the model actually sees:
     *  - `"composite"` (default) — the on-screen composite, overlay included. Right for
     *    "what am I looking at?", where the user's overlay is part of the question.
     *  - `"background"` — the raw slide only. Right for pathology reasoning: the drill is
     *    about tissue, and an overlay is at best noise and at worst a hallucination
     *    source — with `annotate` on, the overview would otherwise feed its own region
     *    boxes back to the model as if they were anatomy. A visualization worth reading
     *    should be inspected deliberately through the `visualization` namespace, not
     *    leaked into every drill frame.
     *
     * With `region` (parent-global image pixels), the render goes through the same
     * flex-renderer pipeline the viewer uses: `"composite"` maps to the user's ACTIVE
     * visualization (note: annotation/DOM overlays are not part of the pipeline and are
     * excluded), `"background"` to the raw slide. `magnification` or `targetPixels`
     * bound the render size — small patches are cheap, so request only what is needed.
     *
     * `context` grounds the call the same way the overview walk grounds its own: the stain's
     * signal class, the site, and the MEASURED scale/resolution of the raster are prepended
     * to `prompt`. Without it a drill is a blind vision call — the model is not told what it
     * is looking at or how much detail it was actually sent, so it fills both in, and two
     * calls on the same tissue can return opposite readings with equal confidence.
     *
     * @param options.preRead internal: an already-rendered raster to reuse instead of
     *   re-rendering `region` (must correspond to the same bounds/source).
     */
    async analyzeRegion(
        viewer: any,
        options: {
            prompt: string;
            driver?: string;
            source?: "composite" | "background";
            region?: Bounds;
            magnification?: number;
            targetPixels?: number;
            preRead?: RegionRaster;
            /** What is known about the slide; prepended as the grounding preamble. */
            context?: SlideContext;
            /** Send `prompt` verbatim, with no preamble (default false when `context` is given). */
            raw?: boolean;
        }
    ): Promise<AnalysisResult> {
        if (!viewer) throw new Error("analyzeRegion() requires a viewer.");
        const driver = this.getDriverForFeature("analyze", options?.driver);

        let imageBlob: Blob | null | undefined;
        let isComplete: boolean | undefined;
        let prompt = options?.prompt || "";
        if (options?.region || options?.preRead) {
            const raster = options.preRead || await this._renderRegionRaster(viewer, options.region!, {
                layers: options?.source === "background" ? "background" : "active",
                magnification: options?.magnification,
                targetPixels: options?.targetPixels ?? REGION_ANALYZE_TARGET_PIXELS,
            });
            imageBlob = await raster.toBlob();
            isComplete = raster.isComplete;
            if (options?.context && !options?.raw) {
                prompt = await this._groundPrompt(viewer, options.context, raster, options.driver, prompt);
            }
        } else {
            imageBlob = options?.source === "background"
                ? await (await this._readBackground(viewer)).toBlob()
                : (await this.captureViewportImage(viewer))?.blob;
        }
        if (!imageBlob) throw new Error("Failed to capture the viewport image.");

        this.raiseEvent("analysis-started", { driver: driver.id, feature: "analyze" });
        try {
            const res = await driver.features["analyze"]!({ imageBlob, prompt });
            return {
                driver: driver.id,
                findings: res?.text ?? null,
                ...(isComplete === undefined ? {} : { isComplete }),
            };
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, feature: "analyze" });
        }
    }

    // ---- interactive helpers (local; reuse core conversions / annotation selection) ----

    /**
     * Ask the user to click a point on the viewport; resolve with its IMAGE
     * coordinates (or null on cancel/timeout). Reuses the tiled image's own
     * `viewerElementToImageCoordinates` conversion.
     */
    async pickViewportPoint(viewer: any, opts?: { message?: string; timeoutMs?: number }): Promise<Point | null> {
        if (!viewer) throw new Error("A viewer is required.");
        const ref = this._ref(viewer);
        const Dialogs = (window as any).Dialogs;
        const message = opts?.message || t("pathology.clickPointPrompt");
        const timeoutMs = opts?.timeoutMs ?? 60000;

        return new Promise<Point | null>(resolve => {
            let done = false;
            let timer: any;
            const cleanup = () => {
                viewer.removeHandler("canvas-click", onClick);
                document.removeEventListener("keydown", onKey, true);
                if (timer) window.clearTimeout(timer);
            };
            const finish = (val: Point | null) => { if (done) return; done = true; cleanup(); resolve(val); };
            const onClick = (event: any) => {
                if (!event?.quick) return;               // ignore drags/pans
                event.preventDefaultAction = true;       // suppress OSD zoom-on-click
                const img = ref.viewerElementToImageCoordinates(event.position);
                finish({ x: img.x, y: img.y });
            };
            const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(null); };

            viewer.addHandler("canvas-click", onClick);
            document.addEventListener("keydown", onKey, true);
            timer = window.setTimeout(() => finish(null), timeoutMs);
            if (Dialogs?.show) Dialogs.show(message, Math.min(timeoutMs, 15000), Dialogs.MSG_INFO);
        });
    }

    /** Increment id of the currently selected annotation on the viewer, or null. */
    getSelectedAnnotationId(viewer: any): string | number | null {
        const context = this._annotations();
        const selected = context.getFabric(viewer)?.getSelectedAnnotations?.() || [];
        const id = selected[0]?.incrementId;
        return id === undefined ? null : id;
    }

    /**
     * Return the currently selected annotation id, or prompt the user to select
     * one and await it (`annotation-selection-changed`). Null on cancel/timeout.
     */
    async awaitAnnotationSelection(viewer: any, opts?: { message?: string; timeoutMs?: number }): Promise<string | number | null> {
        const existing = this.getSelectedAnnotationId(viewer);
        if (existing !== null) return existing;

        const fabric = this._annotations().getFabric(viewer);
        const Dialogs = (window as any).Dialogs;
        const message = opts?.message || t("pathology.selectAnnotationPrompt");
        const timeoutMs = opts?.timeoutMs ?? 60000;

        return new Promise<string | number | null>(resolve => {
            let done = false;
            let timer: any;
            const cleanup = () => {
                fabric?.removeHandler?.("annotation-selection-changed", onSel);
                document.removeEventListener("keydown", onKey, true);
                if (timer) window.clearTimeout(timer);
            };
            const finish = (val: string | number | null) => { if (done) return; done = true; cleanup(); resolve(val); };
            const onSel = (e: any) => {
                const obj = (e?.selected || [])[0];
                if (obj?.incrementId !== undefined) finish(obj.incrementId);
            };
            const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(null); };

            fabric?.addHandler?.("annotation-selection-changed", onSel);
            document.addEventListener("keydown", onKey, true);
            timer = window.setTimeout(() => finish(null), timeoutMs);
            if (Dialogs?.show) Dialogs.show(message, Math.min(timeoutMs, 15000), Dialogs.MSG_INFO);
        });
    }

    // ---- internal ----

    private async _runTissueMask(
        viewer: any,
        driverId?: string,
        preRead?: RasterRead,
        readOpts?: RasterReadOptions
    ): Promise<{ driverId: string; bg: RasterRead; mask: MaskResult }> {
        if (!viewer) throw new Error("A viewer is required.");
        const driver = this.getDriverForFeature("tissue-mask", driverId);
        // Orientation supplies a slide-cropped background (letterbox-safe); other
        // callers read the full current-view raster.
        const bg = preRead || await this._readBackground(viewer, readOpts);

        this.raiseEvent("analysis-started", { driver: driver.id, feature: "tissue-mask" });
        try {
            const mask = await driver.features["tissue-mask"]!({
                width: bg.width,
                height: bg.height,
                pixels: bg.pixels,
                toBlob: bg.toBlob,
            });
            return { driverId: driver.id, bg, mask };
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, feature: "tissue-mask" });
        }
    }

    /** True while the viewer is still panning/zooming (no `viewer.isAnimating()` exists). */
    private _isViewerAnimating(viewer: any): boolean {
        const vp = viewer?.viewport;
        if (!vp) return false;
        const springs = [vp.centerSpringX, vp.centerSpringY, vp.zoomSpring];
        for (const s of springs) {
            if (s && typeof s.isAtTargetValue === "function" && !s.isAtTargetValue()) return true;
        }
        return false;
    }

    /**
     * Resolve once the viewer has stopped animating so a background capture and the
     * subsequent coordinate mapping use the same, settled transform. Returns
     * immediately when not animating; otherwise waits for OSD `animation-finish`
     * (re-checking the springs, since animations can chain) with a hard timeout so
     * it can never hang.
     */
    private _waitForViewerSettled(viewer: any, timeoutMs = 4000): Promise<void> {
        if (!this._isViewerAnimating(viewer)) return Promise.resolve();
        return new Promise<void>(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                viewer.removeHandler?.("animation-finish", onFinish);
                // Let one frame paint at the settled transform before capturing.
                (typeof requestAnimationFrame === "function")
                    ? requestAnimationFrame(() => resolve())
                    : resolve();
            };
            const onFinish = () => { if (!this._isViewerAnimating(viewer)) finish(); };
            const timer = setTimeout(finish, timeoutMs);
            viewer.addHandler?.("animation-finish", onFinish);
        });
    }

    /**
     * Resolve once every tiled image has finished streaming so a current-view
     * capture reads a fully-painted background (settling the springs is not
     * enough — a zoom change reloads the pyramid). Returns immediately when already
     * loaded; a hard timeout keeps it from hanging on a stalled tile source.
     *
     * @returns true when the viewer really finished loading; false when the wait
     *   timed out (or no load signal exists) and any capture that follows reads
     *   partially-streamed tiles — callers surface this as `isComplete: false`.
     */
    private _waitForFullyLoaded(viewer: any, timeoutMs = 10000): Promise<boolean> {
        if (viewer?.getFullyLoaded?.()) return Promise.resolve(true);
        return new Promise<boolean>(resolve => {
            let done = false;
            const finish = (loaded: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve(loaded); };
            const timer = setTimeout(() => finish(false), timeoutMs);
            if (typeof viewer?.whenFullyLoaded === "function") viewer.whenFullyLoaded(() => finish(true));
            else if (typeof viewer?.addOnceHandler === "function") viewer.addOnceHandler("fully-loaded-change", () => finish(true));
            else finish(false);
        });
    }

    /** The virtual-region crop source of a tiled image (region↔parent mapping), or null. */
    private _croppedSourceOf(item: any): any {
        const s = item?.source;
        return s && typeof s.getParentId === "function" && s.getParentId() ? s : null;
    }

    /** True when a driver implementing `feature` is available (never throws). */
    private _hasFeature(feature: PathologyFeature, driverId?: string): boolean {
        try {
            this.getDriverForFeature(feature, driverId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * The current viewport as a parent-global image rectangle, or null when the
     * viewer can't map it. Used only by the exploreSlide fallback for sources that
     * expose no slide dimensions: the survey then covers what the user is looking at
     * rather than the whole slide.
     */
    private _currentViewParentBounds(viewer: any, ref: any, cropped: any): Bounds | null {
        const vp = viewer?.viewport;
        if (!vp?.getBounds || typeof ref?.viewportToImageCoordinates !== "function") return null;
        try {
            const b = vp.getBounds(true);
            const toParent = (p: Point): Point => (cropped ? cropped.toParentImageCoordinates(p) : p);
            const tl = toParent(ref.viewportToImageCoordinates(new OSD.Point(b.x, b.y), true));
            const br = toParent(ref.viewportToImageCoordinates(new OSD.Point(b.x + b.width, b.y + b.height), true));
            const x = Math.min(tl.x, br.x), y = Math.min(tl.y, br.y);
            const width = Math.abs(br.x - tl.x), height = Math.abs(br.y - tl.y);
            if (!(width > 0) || !(height > 0)) return null;
            return { x, y, width, height };
        } catch (_e) {
            return null;
        }
    }

    /** Whole-slide (parent-global) dimensions, calibration, and native magnification. */
    private _slideMeta(viewer: any, ref: any): SlideExploration["slide"] {
        const contentSize = ref?.getContentSize?.();
        const regionW = contentSize?.x ?? 0;
        const regionH = contentSize?.y ?? 0;
        const cropped = this._croppedSourceOf(ref);
        const parentDims = cropped?.getParentDimensions?.();
        const scalebar = viewer?.scalebar;
        const mpp = scalebar?.micronsPerPixel?.();
        return {
            width: parentDims?.x ?? regionW,
            height: parentDims?.y ?? regionH,
            micronsPerPixel: (mpp ?? null) as number | null,
            magnification: (scalebar?.magnification || null) as number | null,
        };
    }

    /**
     * Read the raw background raster of the live viewport (no overlay) by reusing
     * the core `visualization` scripting API, bound to THIS viewer's context so
     * it is correct in a multi-viewport grid.
     */
    private async _readBackground(viewer: any, readOpts?: RasterReadOptions): Promise<RasterRead> {
        // The render below captures the LIVE viewport and the mask is later mapped
        // with the LIVE transform. If the viewer is still flying to a new location
        // (e.g. after viewer.frameImageRegion, which does not await its animation),
        // the capture and the mapping would use different transforms — yielding a
        // correctly-shaped but MIS-PLACED result. Wait for the view to settle so
        // both use the same transform. (Tiles still streaming after settle are a
        // separate concern, not handled here.)
        await this._waitForViewerSettled(viewer);

        const viz = this._visualizationApiFor(viewer);
        if (!viz?.renderCurrentBackgroundPixels) {
            throw new Error("The visualization API is unavailable; cannot read the background image.");
        }
        const canvas = viewer?.drawer?.canvas;
        const deviceWidth = canvas?.width || 0, deviceHeight = canvas?.height || 0;
        const size = this._rasterRenderSize(deviceWidth, deviceHeight, readOpts);
        const res = await withTimeout<RawPixelsResult>(
            viz.renderCurrentBackgroundPixels({
                maxPixels: readOpts?.targetPixels ? MASK_MAX_PIXELS : 64_000_000,
                pixelFormat: "typed",
                ...(size ? { width: size.width, height: size.height } : {}),
            }),
            BACKGROUND_READ_TIMEOUT_MS,
            "read the slide background"
        );
        if (!res?.width || !res?.height || !res?.data) {
            throw new Error("Failed to read the background image of the viewer.");
        }
        const width = res.width, height = res.height, pixels = res.data;
        let blobPromise: Promise<Blob> | null = null;
        return {
            width,
            height,
            pixels,
            scale: deviceWidth ? deviceWidth / width : 1,
            toBlob: () => (blobPromise ||= pixelsToPngBlob(pixels, width, height)),
        };
    }

    /**
     * Raster size for a read, or null to render 1:1 at device resolution.
     *
     * Downscaling is OPT-IN per call site, never global. A tissue mask for orientation
     * is a coarse foreground/background decision and gains nothing from a 19MP HiDPI
     * frame — shrinking it to ~2MP cuts the readback, the saturation pass, the Otsu
     * histogram and both contour traces at once. But the same reader also feeds
     * `segmentAtPoint` and `annotateTissue`, whose whole job is a PRECISE outline;
     * silently halving their input resolution would degrade real user-facing output.
     * Scaled isotropically, so geometry (and every area fraction) is unchanged.
     */
    private _rasterRenderSize(
        deviceWidth: number,
        deviceHeight: number,
        readOpts?: RasterReadOptions
    ): { width: number; height: number } | null {
        const target = readOpts?.targetPixels;
        if (!target) return null;
        const pixels = deviceWidth * deviceHeight;
        if (!(pixels > target)) return null;
        const factor = Math.sqrt(target / pixels);
        return {
            width: Math.max(1, Math.round(deviceWidth * factor)),
            height: Math.max(1, Math.round(deviceHeight * factor)),
        };
    }

    /**
     * Pad a parent-global bbox by `padding` (fraction of each dimension, both sides)
     * and clamp it to the slide. The result is what actually gets rendered, so callers
     * must quote/map against the RETURNED bounds, not the input.
     */
    private _padBoundsToSlide(viewer: any, bounds: Bounds, padding: number): Bounds {
        let x0 = bounds.x - bounds.width * padding;
        let y0 = bounds.y - bounds.height * padding;
        let x1 = bounds.x + bounds.width * (1 + padding);
        let y1 = bounds.y + bounds.height * (1 + padding);
        const meta = this._slideMeta(viewer, this._ref(viewer));
        if (meta.width > 0 && meta.height > 0) {
            x0 = Math.max(0, x0); y0 = Math.max(0, y0);
            x1 = Math.min(meta.width, x1); y1 = Math.min(meta.height, y1);
        }
        if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return bounds;
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    /**
     * Render an arbitrary PARENT-GLOBAL image region OFF-SCREEN through the core
     * `visualization` scripting API (standalone flex-renderer pass) — the user's
     * viewport is never touched, so the user can keep navigating freely while the
     * module browses the slide.
     *
     * Output size: `magnification` renders at that objective magnification (native
     * scalebar basis, capped by {@link REGION_RENDER_MAX_PIXELS} and never upsampled
     * past native resolution); otherwise `targetPixels` bounds the raster area.
     * `layers: "active"` reproduces the user's live visualization; `"background"`
     * (default) renders the raw slide.
     */
    private async _renderRegionRaster(
        viewer: any,
        bounds: Bounds,
        opts?: {
            targetPixels?: number;
            magnification?: number;
            layers?: "background" | "active";
            timeoutMs?: number;
        }
    ): Promise<RegionRaster> {
        if (!viewer) throw new Error("A viewer is required.");
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
            throw new Error("A region with positive width and height is required.");
        }
        const viz = this._visualizationApiFor(viewer);
        if (!viz?.renderRegionPixels) {
            throw new Error("The visualization API is unavailable; cannot render the slide region.");
        }

        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);

        // parent-global → ref-local (identity when the slide is not a virtual-region crop)
        const toLocal = (x: number, y: number): Point =>
            cropped ? cropped.fromParentImageCoordinates({ x, y }) : { x, y };
        const tl = toLocal(bounds.x, bounds.y);
        const br = toLocal(bounds.x + bounds.width, bounds.y + bounds.height);
        const region = {
            x: Math.min(tl.x, br.x),
            y: Math.min(tl.y, br.y),
            width: Math.abs(br.x - tl.x),
            height: Math.abs(br.y - tl.y),
        };
        if (!(region.width > 0) || !(region.height > 0)) {
            throw new Error("The requested region maps to an empty area of the slide.");
        }

        const aspect = region.width / region.height;
        const nativeMag = viewer?.scalebar?.magnification || null;
        let outWidth: number;
        if (typeof opts?.magnification === "number" && opts.magnification > 0 && nativeMag) {
            outWidth = region.width * (opts.magnification / nativeMag);
        } else {
            const target = opts?.targetPixels ?? REGION_ANALYZE_TARGET_PIXELS;
            outWidth = Math.sqrt(target * aspect);
        }
        // Never upsample past native resolution; keep the raster area bounded.
        outWidth = Math.min(outWidth, region.width);
        const maxArea = opts?.targetPixels ? Math.min(MASK_MAX_PIXELS, REGION_RENDER_MAX_PIXELS) : REGION_RENDER_MAX_PIXELS;
        if ((outWidth * outWidth) / aspect > maxArea) {
            outWidth = Math.sqrt(maxArea * aspect);
        }
        outWidth = Math.max(16, Math.round(outWidth));

        const refIndex = this._worldIndexOf(viewer, ref);
        const res = await withTimeout<RawPixelsResult & { isComplete?: boolean }>(
            viz.renderRegionPixels({
                region,
                size: { width: outWidth },
                layers: opts?.layers ?? "background",
                refIndex,
                pixelFormat: "typed",
                maxPixels: 64_000_000,
                ...(typeof opts?.timeoutMs === "number" ? { timeoutMs: opts.timeoutMs } : {}),
            }),
            opts?.timeoutMs ?? BACKGROUND_READ_TIMEOUT_MS,
            "render the slide region"
        );
        if (!res?.width || !res?.height || !res?.data) {
            throw new Error("Failed to render the requested slide region.");
        }

        const width = res.width, height = res.height, pixels = res.data;
        let blobPromise: Promise<Blob> | null = null;
        return {
            width,
            height,
            pixels,
            // Level-0 image pixels per raster pixel (of the rendered region).
            scale: width ? region.width / width : 1,
            toBlob: () => (blobPromise ||= pixelsToPngBlob(pixels, width, height)),
            isComplete: res.isComplete !== false,
            renderedMagnification: nativeMag ? (width / region.width) * nativeMag : null,
            mapPoint: (px: number, py: number) => ({
                x: bounds.x + (px / width) * bounds.width,
                y: bounds.y + (py / height) * bounds.height,
            }),
            renderedBounds: bounds,
        };
    }

    /** Index of `item` in the viewer's world (0 when not found — the background item). */
    private _worldIndexOf(viewer: any, item: any): number {
        const count = viewer?.world?.getItemCount?.() ?? 0;
        for (let i = 0; i < count; i++) {
            if (viewer.world.getItemAt(i) === item) return i;
        }
        return 0;
    }

    /** Intersect a bbox with the slide bounds; null when the overlap is negligible. */
    private _clampBoundsToSlide(b: Bounds, slideW: number, slideH: number): Bounds | null {
        if (!(slideW > 0) || !(slideH > 0)) return b;
        const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
        const x1 = Math.min(slideW, b.x + b.width), y1 = Math.min(slideH, b.y + b.height);
        const w = x1 - x0, h = y1 - y0;
        if (!(w > 0) || !(h > 0)) return null;
        return { x: x0, y: y0, width: w, height: h };
    }

    /** The core `visualization` namespace bound to `viewer`'s context (in-process). */
    private _visualizationApiFor(viewer: any): any {
        const manager = (window as any).APPLICATION_CONTEXT?.Scripting;
        const base = manager?.getApi?.("visualization");
        if (!base?.bindInvocationContext) return null;
        const uid = viewer?.uniqueId;
        return base.bindInvocationContext({
            scriptingContext: {
                id: `__pathology_${uid}__`,
                getActiveViewerContextId: () => uid,
                activeViewerContextId: uid,
                isConsentDialogBypassed: () => false,
            },
        });
    }

    private _countFilled(mask: Uint8Array): number {
        let n = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
        return n;
    }

    private _annotations(): any {
        const context = OSDAnnotations?.instance?.();
        if (!context) throw new Error("The annotations module is not available.");
        return context;
    }

    private _ref(viewer: any): any {
        // Prefer the BACKGROUND world item — that is the image `renderCurrentBackgroundPixels`
        // renders, so mask→image mapping stays in the same (full-res) space and can't key off
        // a half-res visualization item. Fall back to the scalebar's referenced image.
        const count = viewer.world?.getItemCount?.() ?? 0;
        for (let i = 0; i < count; i++) {
            const item = viewer.world.getItemAt(i);
            if (item?.getConfig?.("background")) return item;
        }
        const ref = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
        if (!ref) throw new Error("The viewer has no tiled image to map coordinates against.");
        return ref;
    }

    /** True for a real, registered preset (not the "__unknown__" sentinel `get()` returns for misses). */
    private _isRealPreset(preset: any): boolean {
        return !!preset && preset.presetID !== undefined && preset.presetID !== "__unknown__";
    }

    /** A dedicated, cached "Pathology" preset (created once via addPreset; factory defaults to polygonFactory). */
    private _pathologyPreset(context: any): any {
        const presets = context.presets;
        if (this._pathologyPresetId != null) {
            const existing = presets.get?.(this._pathologyPresetId);
            // get() returns the unknown sentinel on a miss — verify the id round-trips.
            if (this._isRealPreset(existing) && existing.presetID === this._pathologyPresetId) return existing;
        }
        const preset = presets.addPreset?.(undefined, "Pathology");
        if (preset?.presetID != null) this._pathologyPresetId = preset.presetID;
        return preset;
    }

    /**
     * Options for created annotations: the active left-click preset when one is really set, else a cached
     * dedicated "Pathology" preset. Always from a real registered preset so the annotation is tagged
     * (presetID + colour) — an empty options object yields untagged grey "unknown" annotations.
     */
    private _resolveVisualProps(context: any): Record<string, unknown> {
        const presets = context.presets;
        let preset = presets.getActivePreset?.(true);
        if (!this._isRealPreset(preset)) {
            preset = this._pathologyPreset(context);
        }
        return (preset ? presets.getAnnotationOptionsFromInstance?.(preset, true) : {}) || {};
    }

    private _commitPolygons(viewer: any, context: any, polys: Array<Point[] | null>): Array<string | number> {
        const factory = context.getAnnotationObjectFactory("polygon");
        const visualProps = this._resolveVisualProps(context);
        const fabric = context.getFabric(viewer);
        const ids: Array<string | number> = [];
        for (const poly of polys) {
            if (!poly || poly.length < 3) continue;
            const annotation = factory.create(poly, visualProps);
            fabric.addAnnotation(annotation);
            const id = annotation?.incrementId ?? annotation?.id;
            if (id !== undefined && id !== null) ids.push(id);
        }
        return ids;
    }

    private _coverageOverRings(rings: Point[][], mask: MaskResult): { area: number; tissue: number } {
        const outer = rings[0];
        if (!outer || outer.length < 3) return { area: 0, tissue: 0 };
        const w = mask.width, h = mask.height;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of outer) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        minX = Math.max(0, Math.floor(minX));
        minY = Math.max(0, Math.floor(minY));
        maxX = Math.min(w - 1, Math.ceil(maxX));
        maxY = Math.min(h - 1, Math.ceil(maxY));

        let area = 0, tissue = 0;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const cx = x + 0.5, cy = y + 0.5;
                if (!pointInRing(cx, cy, outer)) continue;
                let inHole = false;
                for (let k = 1; k < rings.length; k++) {
                    if (pointInRing(cx, cy, rings[k])) { inHole = true; break; }
                }
                if (inHole) continue;
                area++;
                if (mask.binaryMask[y * w + x]) tissue++;
            }
        }
        return { area, tissue };
    }

    // ---- capture (on-screen composite) + mask→polygon infra ----

    /**
     * Capture the on-screen composite of a viewer as a PNG blob (device pixels).
     * Includes the visualization overlay — used only where that is desirable
     * (the `analyze` feature). Tissue/segment read the raw background instead
     * (see {@link _readBackground}). The SAM plugin also delegates here.
     */
    async captureViewportImage(viewer: any): Promise<{ blob: Blob; width: number; height: number } | null> {
        const sourceCanvas = viewer?.drawer?.canvas;
        if (!sourceCanvas || sourceCanvas.width < 1) {
            console.error("[pathology-foundation] no viewport canvas available to capture.");
            return null;
        }

        const width = sourceCanvas.width;
        const height = sourceCanvas.height;

        let ctx: CanvasRenderingContext2D | undefined;
        if (viewer.tools?.screenshot) {
            ctx = viewer.tools.screenshot(false, { x: width, y: height }, new OSD.Rect(0, 0, width, height));
        }
        if (!ctx) {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
            ctx.drawImage(sourceCanvas, 0, 0);
        }

        return new Promise<{ blob: Blob; width: number; height: number } | null>(resolve => {
            ctx!.canvas.toBlob(blob => {
                if (!blob) {
                    console.error("[pathology-foundation] failed to capture viewport image.");
                    resolve(null);
                    return;
                }
                resolve({ blob, width, height });
            }, "image/png");
        });
    }

    /** All non-inner (outer) contours of a binary mask, in mask pixel space. */
    private _traceOuterContours(mask: MaskResult): Point[][] {
        this.MagicWand = this.MagicWand || OSDAnnotations.makeMagicWand();
        const contours = this.MagicWand.traceContours({
            data: mask.binaryMask,
            width: mask.width,
            height: mask.height,
            bounds: { minX: 0, minY: 0, maxX: mask.width, maxY: mask.height },
        });
        return contours.filter((c: any) => !c.inner).map((c: any) => c.points);
    }

    /**
     * Map a contour (mask pixel space) to image coordinates of `ref`. The mask is
     * at the background-render device-pixel size; we convert device → CSS pixels
     * via the pixel-density ratio, then map through the viewer's tiled image —
     * keeping the viewer's on-screen offset intact (essential in a grid).
     */
    private _contourToImage(
        points: Point[],
        ref: any,
        mask: MaskResult,
        screenshotWidth: number,
        screenshotHeight: number,
        ratio: number
    ): Point[] {
        const sx = screenshotWidth / mask.width;
        const sy = screenshotHeight / mask.height;
        // REGION-LOCAL when `ref` is a virtual-region crop — correct as long as
        // the polygon is handed to the same region's fabric canvas.
        return points.map(pt =>
            ref.viewerElementToImageCoordinates(new OSD.Point((pt.x * sx) / ratio, (pt.y * sy) / ratio))
        );
    }

    /**
     * Trace a binary mask into the single largest region as a polygon in image
     * coordinates, reporting WHY when no polygon results — an empty mask and a
     * validation-rejected mask are different outcomes and callers (especially the
     * LLM-facing API) must be able to tell them apart.
     */
    private _maskToPolygonResult(
        mask: MaskResult,
        ref: any,
        screenshotWidth: number,
        screenshotHeight: number,
        ratio: number,
        viewer: any
    ): { polygon: Point[] | null; status: SegmentStatus; statusMessage?: string } {
        const { binaryMask } = mask;
        const totalPixels = binaryMask.length;
        const filledPixels = this._countFilled(binaryMask);

        if (filledPixels === 0) {
            const message = "Empty segmentation mask received.";
            viewer.raiseEvent("warn-user", {
                originType: "module",
                originId: "pathology-foundation",
                code: "W_PATHOLOGY_NO_SEGMENTATION",
                message,
            });
            return { polygon: null, status: "empty", statusMessage: message };
        }
        if (filledPixels / totalPixels > 0.9) {
            const message = "Segmentation mask covers more than 90% of the image; treated as invalid.";
            viewer.raiseEvent("warn-user", {
                originType: "module",
                originId: "pathology-foundation",
                code: "W_PATHOLOGY_OVER_SEGMENTATION",
                message,
            });
            return { polygon: null, status: "rejected-oversegmented", statusMessage: message };
        }

        let largest: Point[] | undefined;
        let count = 0;
        for (const points of this._traceOuterContours(mask)) {
            if (points.length > count) { largest = points; count = points.length; }
        }
        if (!largest) {
            return { polygon: null, status: "empty", statusMessage: "No traceable contour in the segmentation mask." };
        }
        return {
            polygon: this._contourToImage(largest, ref, mask, screenshotWidth, screenshotHeight, ratio),
            status: "ok",
        };
    }

    /**
     * Trace a binary mask into the single largest region as a polygon in image
     * coordinates. Public helper the SAM plugin (point-prompted) delegates to.
     */
    maskToPolygon(
        mask: MaskResult,
        ref: any,
        screenshotWidth: number,
        screenshotHeight: number,
        ratio: number,
        viewer: any
    ): Point[] | null {
        return this._maskToPolygonResult(mask, ref, screenshotWidth, screenshotHeight, ratio, viewer).polygon;
    }
}

(window as any).PathologyFoundation = PathologyFoundation;
addModule("pathology-foundation", PathologyFoundation as any);

export {};
