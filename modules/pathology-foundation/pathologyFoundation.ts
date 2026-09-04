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

// Same-module imports only. The ban in AGENTS.md §1 is on crossing the
// plugin/module/core BOUNDARY — the pure layer below lives inside this module and is
// bundled with it, which is what makes it unit-testable without a viewer.
import {
    boundsOfPolygons, centerOf, clampBoundsToSlide, countFilled, coverageOverRings,
    coveredFraction, cropMask, gridSplitTissue, intersectBounds, mergeOverlappingBounds,
    padBounds, pointInRing, polygonArea, readingOrder, round,
} from "./lib/geometry";
import {
    blobToBase64, builtinTissueMask, composeMontage, decodeBase64Mask, densityGrid,
    montageCellLabel, pixelsToPngBlob, planMontageLayout, saturationChannel,
    stainConcentration, DEFAULT_STAIN_VECTORS,
} from "./lib/imaging";
import type { MontageCell, StainVectors } from "./lib/imaging";
import { isTemplateEcho, keywordInterest, normalizeScore, parseOverviewVerdict } from "./lib/verdict";
import {
    fallbackChecklist, sanitizeChecklist, splitByResolution, unassessable, exceedsSlide,
    markBelowRequested, MAX_CHECKLIST_FEATURES,
} from "./lib/checklist";
import { aggregateFeatureAnswers, parseFieldAnswers } from "./lib/answers";
import { ladderRungs } from "./lib/ladder";
import { buildEvidence, renderEvidence } from "./lib/evidence";
import {
    accumulateBudget, canSpend, checklistGaps, createBudget, isRedundantRead, priority,
    rolloverSurveyBudget, shouldExpand, spend, worthDrilling, PriorityQueue,
    // The presentation ranking composes the same weights the priority queue scores with —
    // see `_rankOverviewNodes`. They are imported rather than reimplemented because the
    // reimplementation drifted, and a ranked list that contradicts the spend order is a bug
    // nobody can see from either side alone.
    areaWeight, cellularityWeight, confidenceWeight, fillWeight, pathPrior,
} from "./lib/scheduler";
import { runFieldPipeline } from "./lib/pipeline";
import { applyPlanEdits, overlapPairs } from "./lib/plan";
import type { OverviewBudget, SchedulableNode } from "./lib/scheduler";
import type {
    Checklist, ChecklistFallbackReason, ChecklistFeature, FeatureAnswer,
} from "./lib/checklist";
import type { EvidenceRow } from "./lib/evidence";
import {
    fieldRenderAttempt, fitDownsample, isMppExact, maskSampler, planFields, rasterSizeFor,
    FIELD_MAX_PIXELS, FIELD_MPP_TOLERANCE,
} from "./lib/fields";
import {
    isKeyOfSlide, normalizeScopeRect, pickSurvey, rememberBounded, resolveSurveyMpp,
    shouldResegmentScope, surveyCacheKey, surveyPixelBudget,
} from "./lib/scope";
import type { CoverageScope } from "./lib/scope";
import { clampNumber } from "./lib/types";
import type { Bounds, MaskResult, Point } from "./lib/types";
import type { OverviewVerdict, VerdictSource } from "./lib/verdict";
import type { DensitySampler, Field, FieldPlan, MaskSampler } from "./lib/fields";

// Re-exported so `pathologyFoundation` stays the single public import surface for the
// module's types — the internal file split is not something a consumer should track.
export type { Bounds, MaskResult, Point } from "./lib/types";
export type { OverviewVerdict, VerdictSource } from "./lib/verdict";
export type { Field, FieldPlan } from "./lib/fields";
export type {
    Checklist, ChecklistFallbackReason, ChecklistFeature, FeatureAnswer,
} from "./lib/checklist";
export type { EvidenceRow, EvidenceCitation } from "./lib/evidence";
export type { OverviewBudget } from "./lib/scheduler";

// Library / core globals resolved at runtime (no cross-boundary ES imports).
const OSD: any = (window as any).OpenSeadragon;
const OSDAnnotations: any = (window as any).OSDAnnotations;

/** i18n helper (`$.t` is global and always returns a string after init). */
const t = (key: string, opts?: any): string => (window as any).$?.t?.(key, opts) ?? key;

/**
 * The human-facing name of a region, counted from 1: `[2]` → "region 3", `[2, 0]` →
 * "region 3.1" once nested. `index`/`depth` stay 0-based array ranks — this string is the
 * ONLY form a user (or the assistant quoting a result) ever sees. Ranks restart per parent,
 * so the dotted ancestry path is what makes a nested region unambiguous.
 *
 * The numbers follow the SLIDE LAYOUT (rows top to bottom, left to right within a row — see
 * {@link readingOrder}), not size or interest. A reviewer counts fragments off the glass, so
 * a number that encoded size rank made every region link a lookup: "region 1" was the largest
 * island, which is routinely the third core along.
 */
const regionLabel = (path: number[]): string =>
    t("pathology.regionLabel", { number: path.map(i => i + 1).join(".") });

/** Drill depth as a human counts it: depth 0 is level 1. */
const levelOf = (depth: number): number => depth + 1;

/**
 * The user-facing word for an evidence verdict.
 *
 * Spelled out rather than interpolated into a key: `$.t(`pathology.verdict.${v}`)` is
 * invisible to `npm run i18n-audit`, so a missing translation would ship as the raw last
 * segment instead of failing the build.
 */
const verdictWord = (verdict: "yes" | "no" | "uncertain" | "not-assessable"): string => {
    switch (verdict) {
        case "yes": return t("pathology.verdictYes");
        case "no": return t("pathology.verdictNo");
        case "uncertain": return t("pathology.verdictUncertain");
        default: return t("pathology.verdictNotAssessable");
    }
};

/** Every node of a tree, depth-first — the evidence table is over regions, not branches. */
const flattenNodes = (roots: OverviewNode[]): OverviewNode[] => {
    const out: OverviewNode[] = [];
    const walk = (n: OverviewNode) => { out.push(n); n.children.forEach(walk); };
    roots.forEach(walk);
    return out;
};

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

/**
 * Slack between a render's OWN budgets and the wedge guard wrapped around it.
 *
 * A region render has TWO budgets, and the guard must sit above their sum:
 *
 * - `queueTimeoutMs` bounds the wait for a turn. Off-screen passes are serialized per viewer and
 *   admitted through the background request scheduler, and neither wait used to be bounded or
 *   counted. That is what made this guard fire on renders that had not started: its clock runs
 *   from the CALL, the load budget's runs from admission, so the two measured different intervals
 *   and every queued field reported "the region could not be rendered".
 * - `timeoutMs` bounds the tile-load wait once the pass runs. On expiry it returns the partial
 *   raster with `isComplete: false`, which is a USEFUL result — the caller is told what it got.
 *
 * The {@link withTimeout} around the call is a different thing from both: a wedge guard that
 * REJECTS. Sizing it equal to a budget makes them fire together, converting a returnable partial
 * into a throw. It therefore sits strictly above the sum, leaving room for the render itself
 * (GPU pass + readback).
 */
const RENDER_GUARD_SLACK_MS = 4000;

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
 * Grid cell of the nuclear-density map, in survey-raster pixels.
 *
 * On a 2 MP survey this is roughly a 110×90 grid — about 10 000 floats, small enough to
 * keep with the survey indefinitely, coarse enough that a single dark artefact cannot
 * dominate a cell, and fine enough that a hot spot smaller than a tissue island is still
 * visible as one.
 */
const DENSITY_CELL_PIXELS = 16;

/**
 * Smallest gap between two incremental publishes, in ms.
 *
 * The tree is published after every completed node so a cancel or a timeout keeps the
 * work already paid for. With four analyses landing at once that is a rank + evidence
 * rebuild several times a second, for a result nobody reads between model calls.
 */
const PUBLISH_THROTTLE_MS = 250;

/**
 * Tissue islands the survey pass will cover.
 *
 * The survey's job is coverage, so it is not bounded by the same number that bounds how
 * many children a focus expansion opens (`breadth`) — using one knob for both is how "look
 * at the whole slide" ended up meaning "look at four things".
 */
const SURVEY_MAX_ROOTS = 12;

/**
 * Tile-load budgets, split by what the render is FOR.
 *
 * These became load-bearing when the renderer started actually waiting: before, every path shared
 * one 15 s number that bounded nothing, and now it bounds a real wait. Off-screen passes are
 * serialized per viewer (`runSerializedRegionTask`), so a single budget applied to a ~20-field walk
 * is minutes of worst case.
 *
 * The survey is one render whose coverage decides the entire walk — it gets the generous budget,
 * and reporting it incomplete costs far more than waiting. A field is planned to fit one raster, so
 * it is a handful of tiles at the level it renders; there are many of them, and one that cannot
 * finish is better flagged than waited out.
 */
const SURVEY_LOAD_TIMEOUT_MS = 15000;
const FIELD_LOAD_TIMEOUT_MS = 6000;

/**
 * Budget for the wait BEFORE a render starts — queue position plus scheduler admission.
 *
 * Separate from the load budgets above because it is bounded by a different thing: how many
 * passes are ahead of this one, not how many tiles this one needs. A walk legitimately queues
 * (renders are serialized on purpose), so this is generous; it exists to give the wedge guard a
 * number to sit above, and to fail a genuinely congested queue by name rather than as a
 * render failure.
 */
const RENDER_QUEUE_TIMEOUT_MS = 20000;

/**
 * Attempts a field render gets before it is reported unread.
 *
 * The retry is not optimism, it is the cheapest thing available: the failed attempt already
 * REQUESTED its tiles, and they keep arriving into the shared tile cache after the budget
 * expired. A second attempt over a warm cache usually returns immediately. The third drops one
 * pyramid level (~4x fewer tiles) and reports the coarser resolution it actually delivered, which
 * the checklist splitter already knows how to handle. Beyond that the region is not slow, it is
 * unreadable, and more attempts only spend the walk's wall-clock.
 */
const FIELD_RENDER_ATTEMPTS = 3;

/**
 * Coverage below which a WHOLE-SLIDE survey is treated as a failed read rather than a blank
 * slide, when it also found at most one island.
 *
 * 0.1% of a slide is one small fragment. Real slides are either meaningfully covered or empty;
 * the shape that says "the render only saw the tiles the user had loaded" is a trace of tissue
 * plus a single island, which is exactly what a partial off-screen pass produces. Scoped runs
 * are excluded: a caller who framed a rectangle of mostly glass gets an honest low number.
 */
const SURVEY_IMPLAUSIBLE_COVERAGE = 0.005;

/**
 * Surveys kept per slide, least-recently-used first out.
 *
 * Each one holds a ~2 MB mask, and scopes are unbounded — a user panning around and asking
 * about "here" a dozen times would otherwise accumulate a dozen masks for the session. Four
 * is enough to keep the whole-slide survey alongside the last few regions of interest, which
 * is the pattern that actually repeats.
 */
const MAX_SURVEYS_PER_SLIDE = 4;

/**
 * Least tissue a planned tile must hold to be worth a vision call, as a fraction of the tile.
 *
 * A coverage decision, not a drill decision: this drops cells that are essentially glass
 * before anything is rendered. Matches `gridSplitTissue`'s own floor so the two child sources
 * agree about what counts as an empty cell.
 */
const TILE_MIN_FILL = 0.05;

/**
 * When a scoped survey's single region counts as "it just outlined the whole scope".
 *
 * Deliberately near 1: the case being caught is a contour that literally spans the rectangle,
 * not a large island inside it. See {@link PathologyFoundation._resegmentCollapsedScope}.
 */
const SCOPE_COLLAPSED_SPAN = 0.9;

/**
 * Tissue coverage above which a scope IS one object and must not be re-segmented.
 *
 * Mirrors the full-rectangle contour guard in `_surveySlide`: a rectangle that is nearly all
 * tissue legitimately traces as one region.
 */
const SCOPE_SOLID_TISSUE_COVERAGE = 0.9;

/** Grid used to separate a collapsed scope; the same N `_subdivideRegion` splits a mass into. */
const SCOPE_RESEGMENT_GRID = 3;

/**
 * When two region boxes stop being two regions.
 *
 * A region is the bounding box of a traced contour, and a contour that is not a compact
 * blob — a curved biopsy strip, a folded core, a ribbon of mucosa — produces a box holding
 * a great deal of its neighbour. Nothing downstream could tell: each box was rendered,
 * sent to a vision model and reported as a separate finding, so the user saw a stack of
 * examination markers over one piece of tissue and the budget paid for the same cells
 * several times.
 *
 * The merge is on the BOXES because the box is what gets rendered: two contours sharing a
 * rectangle cannot be read separately, so keeping them apart is a distinction the pipeline
 * has no way to honour.
 *
 * Operators can retune or disable it with `ENV.modules.pathology-foundation.regionMerge`
 * (`false`, or `{iou, containment}`). Deliberately deployment-level rather than a per-call
 * option: it decides what a region IS, and the survey it shapes is cached per (slide,
 * scope, budget) — a per-call flag would hand the next caller a survey segmented under
 * rules it never asked for.
 */
const REGION_MERGE_IOU = 0.4;
const REGION_MERGE_CONTAINMENT = 0.9;

/** Plans kept per slide. Small: a plan is a decision point, not a history. */
const MAX_PLANS_PER_SLIDE = 3;

/**
 * Smallest share of a frame the SECOND-largest island may hold and still make a split real.
 *
 * The islands are already filtered at 1% of the frame, so this is the line between "two
 * objects" and "one object plus debris" — the only thing that should send a frame to the
 * blind grid instead of to the separation the mask already found.
 */
const ISLAND_MIN_SIBLING = 0.05;

/**
 * Accepted `checklistFallbackReason` values.
 *
 * The reason reaches a locale string, and it arrives through a script the chat model wrote,
 * so it is validated against a closed set rather than interpolated (AGENTS.md §0.2/§7).
 */
const CHECKLIST_FALLBACK_REASONS = new Set<ChecklistFallbackReason>([
    "no-query", "no-model", "unparseable", "error",
]);

/**
 * Fields one montage may carry.
 *
 * The ceiling is legibility, not bytes: past a dozen cells each is small enough that a
 * model is judging thumbnails. TUNING NOTE — the right value depends on the deployment's
 * render-versus-inference cost, which has to be measured on a real slide: a montage
 * trades N renders for one model call, and that is only a saving while a render is the
 * cheaper of the two.
 */
const MONTAGE_MAX_CELLS = 12;

/** Pixel ceiling for a composite, so it stays comfortably inside one request body. */
const MONTAGE_MAX_PIXELS = 4_000_000;

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
 * Resolution of the orientation rung, in µm/px.
 *
 * Deliberately coarser than any feature would ask for: its job is to place the tissue and
 * rank it, not to answer anything. Prefixing the ladder with it means the first look at a
 * region is cheap and wide, and the budget climbs only where the answers are still open.
 */
const SURVEY_MPP = 2.0;

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
 * Rate-limit `fn`, with a `force` escape for the call that must not be dropped.
 *
 * The tree is published after every completed node so a cancel or a timeout keeps the work
 * already paid for; without this that is a rank + evidence rebuild several times a second for a
 * result nobody reads between model calls.
 */
function throttled(fn: () => void, minGapMs: number): (force?: boolean) => void {
    let last = 0;
    return (force = false) => {
        const now = Date.now();
        if (!force && now - last < minGapMs) return;
        last = now;
        fn();
    };
}

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
export type PathologyFeature = "tissue-mask" | "segment" | "analyze" | "cellularity";

/** Grid of normalized 0..1 values over a raster, as a `cellularity` driver returns it. */
export interface DensityGrid {
    values: Float32Array | number[];
    /** Grid CELLS, not pixels. */
    width: number;
    height: number;
}

/**
 * Where the nuclei are, as a coarse normalized grid over a region of the slide.
 *
 * The point of this is that it is FREE: local, deterministic, no model call, computed
 * from a raster the survey already rendered. It says where to spend a vision budget
 * before any of it is spent, which is a strictly better ordering than "biggest tissue
 * island first" — a large bland island and a small dense one are not equally worth a
 * call, and area cannot tell them apart.
 */
export interface DensityMap {
    /** Parent-global rectangle this map covers. */
    bounds: Bounds;
    /** Grid CELLS, not pixels. */
    width: number;
    height: number;
    /** Row-major, 0..1, normalized against the 95th percentile. */
    values: Float32Array;
    /**
     * How it was derived. `"saturation-fallback"` means colour unmixing was meaningless
     * for this stain class, so the value is stain intensity rather than nuclear density —
     * still a usable ordering, but not a claim about nuclei.
     */
    method: "nuclear-deconvolution" | "saturation-fallback" | "driver";
    /** Mean density over a parent-global box, 0..1. Zero outside {@link bounds}. */
    sample(b: Bounds): number;
    /** The `n` densest cells as parent-global boxes, densest first. */
    top(n: number): Array<{ bounds: Bounds; value: number }>;
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
    /**
     * Why this read happens. Diagnostic only — forwarded to the core `region-capture`
     * event so the capture indicator can label the marker it draws. Translate at the
     * call site (the `pathology.capture*` locale keys).
     */
    label?: string;
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
    /**
     * False when the raster does NOT hold every tile it covers — INCLUDING when the render
     * {@link stalled}. The renderer's own "fully loaded" flag can read true over permanently
     * missing tiles, so it is ANDed with `!stalled` at the single point a raster is produced;
     * consumers therefore only ever need this one flag.
     *
     * Every raster carries this, not just the off-screen ones ({@link RegionRaster} merely
     * re-states it): a live-viewport read is incomplete exactly when the viewport was still
     * streaming, and that case used to arrive as `undefined` — so `analyzeRegion` omitted the flag
     * from its result and the model was shown blank slide with nothing said about it.
     *
     * Consumers must degrade closed on `false`: do not measure it, do not cache it, and do not
     * describe it to a model as the region without saying it is provisional.
     */
    isComplete: boolean;
    /**
     * True when the render gave up because nothing more COULD arrive (a permanently missing tile is
     * dropped from OSD's load candidates, so completeness can never flip) rather than because it
     * ran out of budget.
     *
     * This is what tells a caller whether asking again is worth anything: `!isComplete && !stalled`
     * is "slow, try a longer budget"; `stalled` is "these pixels are all this region will ever
     * yield". Live-viewport reads, which do not wait at all, report false.
     */
    stalled: boolean;
}

/**
 * An OFF-SCREEN region render: a {@link RasterRead} plus the render's provenance.
 * Produced by `_renderRegionRaster` — the raster comes from the standalone
 * flex-renderer pass over an explicit parent-global image region, so the user's
 * viewport is never involved (its `scale` maps raster px to level-0 image px of
 * the rendered region instead of device px).
 */
export interface RegionRaster extends RasterRead {
    /** Magnification the raster was actually rendered at (null when uncalibrated). */
    renderedMagnification: number | null;
    /** Map a raster pixel to PARENT-GLOBAL image coordinates (linear over the rendered bounds). */
    mapPoint: (px: number, py: number) => { x: number; y: number };
    /** The parent-global bounds the raster covers (after any padding/clamping). */
    renderedBounds: Bounds;
}

/**
 * A {@link RegionRaster} produced from a planned {@link Field}, carrying the resolution
 * it was asked for alongside the one it actually delivered.
 *
 * The pair exists so the two can be COMPARED. Quoting a requested resolution that the
 * render did not achieve is how the walk came to tell a vision model it was looking at
 * nuclear detail it had never been sent — so the prompt quotes `deliveredMpp` and only
 * `deliveredMpp`, and `mppExact` says whether the two ever diverged.
 */
export interface FieldRaster extends RegionRaster {
    /** µm/px the field was planned for; null on an uncalibrated slide. */
    requestedMpp: number | null;
    /** µm/px this raster actually carries — the ONLY figure a prompt may quote. */
    deliveredMpp: number | null;
    /** Level-0 image px per raster px, as delivered. */
    downsample: number;
    /**
     * False only when the delivered resolution missed the request. That is a BUG (a
     * clamp fired where the planner proved none was needed), not a soft condition —
     * the walk logs it rather than describing it to the model.
     */
    mppExact: boolean;
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
    /**
     * What this image IS — for the audit trail, never for the model.
     *
     * A remote driver ships the pixels to a server that has no idea which slide
     * or which box they are; without this, a logged vision call is an anonymous
     * PNG. It is carried alongside the image and used only for diagnostics: a
     * driver must never put it into the prompt, because that would make an
     * operator's logging configuration change what the model is asked.
     */
    context?: AnalysisContext;
}

/** Identity of one analyzed image: which slide, which box, how closely read. */
export interface AnalysisContext {
    /** The job this call serves: "analyze", "montage", … */
    feature?: string;
    /** Human-facing name of the region, counted from 1 ("region 2.1"). */
    label?: string | null;
    /** Parent-global level-0 pixels — WHAT left the browser. Null for a composite. */
    region?: Bounds | null;
    /**
     * The boxes a COMPOSITE was assembled from, each with the label drawn on it.
     *
     * A montage is one image of many non-adjacent fields, so a single `region`
     * cannot describe it — and "the model looked at twelve places" is exactly
     * what an audit trail must not lose.
     */
    regions?: Array<{ label?: string | null; bounds: Bounds }> | null;
    viewerId?: string | null;
    /** Slide identity. Never a URL: DICOMweb shares one baseUrl across slides (§8). */
    tileSourceId?: string | null;
    /** µm per delivered raster pixel — how closely the image was actually read. */
    deliveredMpp?: number | null;
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
        /**
         * Where the nuclei are, as a coarse grid over the input raster. The built-in
         * implementation unmixes the nuclear stain; a deployment with a real nuclei
         * detector registers a driver for this feature and the walk uses it instead,
         * with no other change.
         */
        "cellularity"?: (input: CellularityInput) => Promise<DensityGrid>;
    };
}

export interface CellularityInput extends PixelSource {
    /** Restricts the measurement to tissue, so a block is not scored down for its glass. */
    mask?: MaskResult;
    /** Grid cell size in raster pixels. */
    cell?: number;
    /** What the slide is — decides whether unmixing is meaningful at all. */
    stainClass?: StainClass;
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
    /**
     * Fraction of the requested `region` the model was actually shown, when `mpp` forced
     * the region to be sampled rather than delivered whole. Absent means the whole region
     * was read. A finding from a partial read speaks for the part that was read.
     */
    coveredFraction?: number;
}

/** One field read during an interrogation, with its answers. */
export interface InterrogationField {
    label: string;
    bounds: Bounds;
    /** µm/px this field was delivered at — the basis for weighing its answers. */
    deliveredMpp: number | null;
    /** One entry per checklist feature, in checklist order. Always complete. */
    answers: FeatureAnswer[];
    findings: string | null;
    error?: string;
}

export interface InterrogationResult {
    region: Bounds;
    /** The questions that were actually asked, after sanitizing. */
    checklist: Checklist;
    requestedMpp: number | null;
    deliveredMpp: number | null;
    /** Per-field detail, so a caller can navigate to the field that carries an answer. */
    fields: InterrogationField[];
    /**
     * One answer per feature across the whole region. Aggregated asymmetrically — any
     * positive wins — because the fields are a SAMPLE of the region: one field showing a
     * feature is evidence it is there, while several not showing it is not proof it is not.
     */
    answers: FeatureAnswer[];
    /**
     * Fraction of `region` actually looked at. Below 1 when the resolution asked for meant
     * the region had to be sampled, or when a field could not be rendered; a finding then
     * speaks for the part that was read.
     */
    coveredFraction: number;
    /**
     * False when tiles were still streaming, or when a field could not be rendered at all —
     * the answers are provisional either way.
     */
    isComplete: boolean;
    /**
     * What went wrong at the IMAGE level, in the reader's own words.
     *
     * Present only when something did. A checklist of `not-assessable` is ambiguous by
     * construction — it looks the same whether the model examined the field and could not
     * tell, or no field was ever produced — and a reader (human or chat model) that guesses
     * wrong prescribes the wrong fix. This is where the run says which it was.
     */
    warnings?: string[];
    budget: { analyzeCalls: number };
}

export interface MontageResult {
    driver: string;
    /** One entry per region, in the order given, carrying the grid label drawn on the image. */
    cells: Array<{
        label: string;
        /** The label drawn on the composite (`A1`, `B2`, …) — how the model referred to it. */
        cellLabel: string;
        bounds: Bounds;
        deliveredMpp: number | null;
        answers: FeatureAnswer[];
        interest: number | null;
        findings: string | null;
    }>;
    /** The model's whole reply, for a caller that wants to quote it. */
    findings: string | null;
    /** Resolution each cell was rendered at. */
    cellMpp: number | null;
    cellSizeUm: { width: number; height: number } | null;
    isComplete: boolean;
}

/** One connected tissue island found during whole-slide orientation. */
export interface SlideRegion {
    /**
     * 0-based reading-order rank among its siblings — INTERNAL. Never show it; use
     * {@link SlideRegion.label}. It is NOT the array position: the array is in priority
     * order (most tissue, best score), the number is where the region sits on the slide.
     */
    index: number;
    /**
     * Human-facing name, counted from 1 in SLIDE READING ORDER — rows top to bottom, left to
     * right within a row. "region 1" is the first fragment on the glass, not the largest one;
     * interest/size ranking lives in `rankScore` and the `ranked` list.
     */
    label: string;
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

/**
 * Where an exploration starts, and what it is allowed to cover.
 *
 * The walk used to be hardwired to the whole slide content rectangle, with the current view
 * reachable only as a degraded fallback for sources that expose no dimensions. A scope is a
 * HARD restriction: the survey raster covers exactly this rectangle (so a viewport scope buys
 * a much finer mask for the same pixel budget), islands and every child drilled out of them
 * are clamped to it, and the result says which scope produced it.
 *
 * - `"slide"` (default) — the whole slide, i.e. today's behaviour.
 * - `"viewport"` — what the user is currently looking at.
 * - an explicit rectangle in PARENT-GLOBAL level-0 image pixels (the same coordinate space
 *   every `bounds` in this module speaks).
 */
export type ExplorationScope = "slide" | "viewport" | Bounds;

export type { CoverageScope } from "./lib/scope";

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
     * What `slideCoverage`/`regions` refer to: "whole-slide" normally, "current-view" when
     * the caller asked for `scope: "viewport"` (or in the fallback taken when the source
     * exposes no slide dimensions), "region" for an explicit rectangle. Anything other than
     * "whole-slide" means these numbers describe {@link scopeBounds}, NOT the slide.
     */
    coverageScope: CoverageScope;
    /** The rectangle actually surveyed, in parent-global image pixels. */
    scopeBounds: Bounds;
    /**
     * False when the tile pyramid was still streaming when the overview was
     * captured (load wait timed out) — coverage/regions are then provisional and
     * likely UNDERSTATED; report them as such rather than asserting low coverage.
     */
    isComplete: boolean;
    /**
     * Tissue islands in slide reading order — the order their numbers count in, so a walk
     * down this list is a walk down the slide. `areaFraction` is what to sort by when size
     * is the question. Empty when the slide looks blank.
     */
    regions: SlideRegion[];
    /** Coarse model-assisted overview note; present only when `hint` was requested and an analyze driver ran. */
    hint?: string | null;
}

export interface RegionReviewResult {
    /** 0-based reading-order rank of the reviewed region — INTERNAL; show {@link RegionReviewResult.label}. */
    index: number;
    /** Human-facing name of the reviewed region, counted from 1 in slide reading order ("region 2"). */
    label: string;
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

/**
 * One node of a hierarchical {@link OverviewResult}. Produced by `buildOverview`:
 * a region that was framed, described by the vision model, scored for interest,
 * and either drilled into (children) or pruned.
 */
export interface OverviewNode {
    /** 0-based reading-order rank among its siblings — INTERNAL, not unique across the
     * tree. Show {@link OverviewNode.label} instead. */
    index: number;
    /**
     * Human-facing name, counted from 1 in slide reading order and carrying the ancestry path
     * so it is unique: "region 2" at the top, "region 2.1" one level in. The only form to
     * show a user. It names WHERE the region is, never how interesting it is.
     */
    label: string;
    /** Recursion depth (0 = a whole-slide tissue island) — INTERNAL; humans count levels from 1. */
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
     * Area fraction — of the whole slide at the top level, of the framed parent below.
     * NOT comparable across depths; use {@link OverviewNode.slideAreaFraction} for that.
     */
    areaFraction: number;
    /** Fraction of the WHOLE SLIDE this node's bbox covers (0..1) — comparable at any depth. */
    slideAreaFraction: number;
    /** Fraction of the framed box that is actually tissue (0..1); null when not measured. */
    bboxFillFraction: number | null;
    /**
     * How much TISSUE the box holds, in µm² (level-0 px² on an uncalibrated slide).
     *
     * The absolute quantity behind {@link bboxFillFraction}, and the one the drill gate
     * reads. A fraction cannot answer "is there anything in here worth another call?": a
     * prostate core's island bbox is 93% glass by construction, and gating on that number
     * closed the walk on every slide whose tissue is not rectangular.
     */
    tissueArea?: number | null;
    /**
     * Fields planned for this node and not yet read — INTERNAL, stripped from script results.
     *
     * A region that tiles into fifteen fields must not silently become the four a single
     * expansion can afford. The remainder rides on the node, which goes back on the queue to
     * compete for the next slot; whatever is still here when the run ends is reported as
     * `budget.plannedNotRead`.
     */
    pendingTiles?: SlideRegion[];
    /**
     * Checklist hash this node's children were generated for — INTERNAL, stripped from results.
     *
     * `refineOverview` puts the WHOLE cached tree back on the frontier, including nodes that
     * were already expanded to exhaustion. `_childrenOf` is deterministic over the same bounds
     * and rung, so re-expanding one re-renders and re-analyzes identical children and appends
     * them to `children` a second time — every refinement, compounding. This is how the walk
     * tells "already done" from "worth asking again": a NEW checklist is a new question and
     * genuinely re-opens the node, the same one is not.
     */
    expandedUnder?: string;
    /**
     * Normalized nuclear density of this box (0..1), or null when no density map exists.
     *
     * A local measurement, not a model opinion. Lets a report say "low-cellularity area,
     * not examined closely" instead of silently omitting the region.
     */
    cellularity?: number | null;
    /** Physical field of view of the framed box, or null when the slide is uncalibrated. */
    fieldOfViewUm?: { width: number; height: number } | null;
    /** µm per pixel of the raster the model actually saw (not the slide's native µm/px). */
    renderedMpp?: number | null;
    /** The rung's target µm/px this field was planned for. */
    requestedMpp?: number | null;
    /**
     * µm per pixel the render actually delivered. Equal to {@link requestedMpp} by
     * construction — fields are sized so nothing needs clamping — and the only figure
     * ever quoted to the vision model.
     */
    deliveredMpp?: number | null;
    /**
     * True when this node's read landed COARSER than its ladder rung asked for.
     *
     * Not a bug and not a tripwire: a region too large to carry its rung in one call is read
     * whole and coarse on purpose, and this flag is what says so — it routes the node's
     * children to a lattice at the rung rather than to island splitting, and it tells the
     * caller a leaf's findings were formed below the resolution the question wanted. It is a
     * comparison of delivered against target µm/px, NOT "the lattice had more than one cell":
     * a box that fits a single raster finer than its rung is not short of it.
     */
    resolutionShortfall?: boolean;
    /** The vision model's short description of this region (or null on failure). */
    findings: string | null;
    /**
     * One typed answer per checklist feature, keyed by feature id. Always complete — a
     * feature the model skipped, or that this field's resolution could not carry, is
     * present as `not-assessable` rather than missing.
     *
     * Read this rather than parsing {@link findings}: a detail stated in prose is exactly
     * what used to be truncated away before it reached the report.
     */
    answers?: Record<string, FeatureAnswer>;
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
    /**
     * Which top-level tissue island this node descends from. The unit the scheduler
     * balances between, so that no one branch can consume the whole budget.
     */
    rootId?: string;
    /** Ancestry ranks, root first — the label is rendered from this. */
    path?: number[];
    /** Interests of this node's ancestors, for the path prior. */
    ancestorInterests?: number[];
}

/**
 * A hierarchical "expert overview" of a slide: the ranked tissue islands, each
 * described and (where interesting) drilled into at higher magnification. Cached
 * per slide so broad chat queries can reuse the descriptions instead of
 * re-sweeping. Every finding is a model-assisted observation, not a diagnosis.
 *
 * **Field order here mirrors the order the object is CONSTRUCTED in**, which is
 * deliberate: a consumer that truncates this object keeps a prefix of it, so the small
 * decision-bearing fields come first and the node tree comes last. See the comment on
 * the result literal in `buildOverview`.
 */
export interface OverviewResult {
    /**
     * Whether this is an examination at all, or an account of one that did not happen.
     *
     * `"incomplete"` means NOTHING here was read at a resolution that can answer the questions
     * asked — the survey ran on a streaming pyramid, or the walk never found a region it would
     * look at closely — and the caller must report that limitation instead of writing findings.
     * `"ok"` means at least one question was settled; whether ALL of them were is
     * {@link isComplete}, and the rows say which.
     *
     * It is the FIRST key of the object for a reason: the warnings said all of this before, and
     * a result whose top-level fields still read `status: "ok"` / `isComplete: true` invited a
     * reader to believe the optimistic half.
     *
     * (`"context-required"` is the adapter's separate refusal, before any walk starts.)
     */
    status: "ok" | "incomplete";
    driver: string;
    /** The feature query this overview was built for ("areas with X"), if any. */
    query?: string;
    /**
     * What the walk was told about the slide. When `source` is "unknown" the model was
     * forbidden from naming a stain or site — ask the user for them and rebuild.
     */
    context: SlideContext;
    slide: SlideExploration["slide"];
    /** Tissue coverage (0..1) of {@link scopeBounds} — the whole slide unless the run was scoped. */
    slideCoverage: number;
    /**
     * Anything other than "whole-slide" means the walk covered {@link scopeBounds} only. A
     * scoped run must never be reported as a whole-slide read; `warnings` says so too.
     */
    coverageScope: CoverageScope;
    /** The rectangle the walk was confined to, in parent-global image pixels. */
    scopeBounds: Bounds;
    /**
     * Was the tissue actually EXAMINED?
     *
     * False while any checklist feature is still unanswered or was only ever met at too coarse a
     * resolution — which is the state a walk ends in when it never found a region it was willing
     * to read closely. Do not write findings from a result with `isComplete: false`; say what
     * could not be read.
     *
     * This used to report the survey RASTER's completeness, which is a different question with a
     * different answer, and the two disagreeing is how a run that examined nothing was presented
     * as a completed examination. That reading now lives in {@link surveyComplete}.
     */
    isComplete: boolean;
    /**
     * False when the survey render ran on a partially-loaded tile pyramid: coverage and the
     * island list are then provisional and UNDERSTATED, never evidence that a slide is blank.
     */
    surveyComplete: boolean;
    /** The checklist the run obeyed, and where it came from. */
    checklist: Checklist;
    /**
     * **The primary output.** One row per question the run asked, with the aggregate
     * answer and the regions that evidence it. Write the report FROM THIS, not from
     * `summary` — the rows carry what each region actually said, and the difference
     * between "not present" and "never assessable at the resolution we reached".
     */
    evidence: EvidenceRow[];
    /**
     * Flat list of the described regions ranked by `rankScore` — the model's interest
     * weighted by its ancestors' interest, its stated confidence, and how much real
     * tissue the box holds. Ranking by raw interest alone lets a tiny, low-confidence
     * leaf under an uninteresting parent outrank a large well-supported region.
     * Nodes with unknown interest sort last. These are the focal spots to link to.
     *
     * Flat by construction: entries carry no `children` (the subtree is reachable through
     * {@link root}), so ranking a region does not re-serialize everything beneath it.
     */
    ranked: OverviewNode[];
    /**
     * A one-line-per-row rendering of {@link evidence}, so a caller expecting a string
     * still receives one. A convenience, explicitly not the source of truth.
     */
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
    /**
     * Top-level tissue islands, each a subtree. LAST on purpose: it is by far the largest
     * field, and everything above it must survive a consumer that keeps only a prefix.
     */
    root: OverviewNode[];
}

export interface BuildOverviewOptions {
    /** Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience. */
    query?: string;
    /**
     * Where to explore. `"slide"` (default) walks the whole slide; `"viewport"` confines the
     * whole run — survey, islands and every drill — to what the user is currently looking at;
     * an explicit parent-global rectangle confines it to that box. See {@link ExplorationScope}.
     *
     * A scoped run is not a cheaper whole-slide run: it covers less and sees it better, and
     * `coverageScope` / `warnings` say so.
     */
    scope?: ExplorationScope;
    /**
     * Resolution (µm/px) of the orientation pass — the survey render AND the coarsest rung of
     * the ladder, which are kept in step deliberately.
     *
     * Default {@link SURVEY_MPP} for a whole-slide run. For a scoped run the default is
     * whichever is FINER of that and the resolution the scope already affords inside
     * `surveyPixels` — forcing 2 µm/px on a viewport-sized box would spend the first rung on
     * detail the box beats for free. An explicit value is honoured verbatim.
     *
     * Ignored on an uncalibrated slide: there is no physical scale to hit, and `surveyPixels`
     * is then the honest budget.
     */
    surveyMpp?: number;
    /** Raster budget for the survey render, in pixels (default 2 MP, ceiling 4 MP). */
    surveyPixels?: number;
    /** Tissue islands the survey pass covers (default 12). */
    maxRoots?: number;
    /** Slack left around each framed region, as a fraction of its size (default 0.1, max 0.5). */
    framePadding?: number;
    /** Raster budget for ONE vision call, in pixels (default 2 MP, ceiling 8 MP). */
    fieldPixels?: number;
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
    /**
     * Max recursion depth. Defaults to the number of rungs on the run's ladder (at least 2),
     * because one rung costs one level — a node reads its box at the rung it affords and its
     * children read the same box at the next one. A smaller value caps the run ABOVE the
     * finest resolution the ladder declares.
     */
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
     * Least tissue a box must hold before it is worth drilling, in µm² (level-0 px² on an
     * uncalibrated slide). Defaults to ONE vision call's worth of tissue at the finest rung
     * the run will reach — derived from `fieldPixels` and the ladder, not a constant.
     */
    minDrillTissue?: number;
    /** Hard cap on vision calls for the whole run (default 28). */
    maxAnalyzeCalls?: number;
    /** Hard cap on regions visited for the whole run (default 36). */
    maxNodes?: number;
    /**
     * The features the run should establish, each with the resolution it needs.
     *
     * This is what makes the query load-bearing: the checklist becomes the answer schema,
     * the ladder, the drill rule, the ranking and the report rows. Supply it (or a
     * `checklist`) to control the run precisely; omit it and the engine falls back to a
     * generic checklist, flagged in `warnings`.
     *
     * Sanitized on the way in — bounded count and lengths, slugged ids — because it ends
     * up inside a vision model's prompt.
     */
    features?: ChecklistFeature[];
    /** A whole checklist, as returned by a derivation step. Takes precedence over `features`. */
    checklist?: Checklist;
    /**
     * Why the caller could not supply a checklist, when it tried and failed.
     *
     * Derivation needs a chat model, so it lives in the scripting adapter, not here — which
     * means the engine cannot observe its failure and used to report every fallback the same
     * way. "The model is not reachable" and "you asked a vague question" are opposite
     * diagnoses, and only one of them is the caller's to act on.
     */
    checklistFallbackReason?: ChecklistFallbackReason;
    /**
     * Traversal strategy. `"best-first"` (default) surveys the tissue, then spends what is
     * left on the globally most promising regions. `"dfs"` is the previous depth-first
     * walk, retained for one release as an escape hatch — it explores the first island to
     * exhaustion and can leave later ones unvisited.
     */
    scheduler?: "best-first" | "dfs";
    /** Share of the call budget reserved for coverage before any drilling (default 0.35). */
    surveyFraction?: number;
    /** Concurrent vision calls (default 4, matching the inference RPC's own ceiling). */
    concurrency?: number;
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
    minDrillTissue: number;
    maxAnalyzeCalls: number;
    maxNodes: number;
    subdivide: "tissue";
    annotate: boolean;
    synthesize: boolean;
    reuse: boolean;
    /** Always present: the caller's, sanitized, or the generic fallback. */
    checklist: Checklist;
    scheduler: "best-first" | "dfs";
    surveyFraction: number;
    concurrency: number;
    /** Resolved once, so nothing downstream re-reads a module constant mid-walk. */
    maxRoots: number;
    framePadding: number;
    fieldPixels: number;
    /**
     * The rectangle the run is confined to. Every framed region is clipped to it, so the
     * padding a node gets for context cannot reach back outside the scope and hand the model
     * tissue the survey never looked at. Equal to the slide's content rectangle on an
     * unscoped run, where the clip is a no-op.
     */
    scopeBounds: Bounds;
}

/** Everything a walk obeys, settled once and shared by the plan and the run that executes it. */
interface ResolvedOverviewRun {
    scope: { bounds: Bounds; coverageScope: CoverageScope };
    checklist: Checklist;
    surveyMpp: number | null;
    ladder: OverviewLadder;
    opts: ResolvedOverviewOptions;
}

/**
 * A walk that has been costed but not run.
 *
 * The expensive half of an overview is the vision walk; everything before it — one survey
 * render, the tissue mask, the density prior, the checklist, the ladder — is cheap and
 * already cached. Splitting the call at that seam is what lets the assistant see WHAT will
 * be examined and WHAT it will be asked before minutes of model calls are committed, and
 * lets it drop regions it can already tell are not worth reading.
 *
 * The survey is held by reference rather than re-derived at run time: the region list the
 * caller edited must be the region list that runs, and a re-survey could legitimately
 * return different islands.
 */
interface OverviewPlan {
    planId: string;
    slideKey: string;
    run: ResolvedOverviewRun;
    exploration: SlideExploration;
    /** The caller options the plan was drawn up from; replayed verbatim by `runPlan`. */
    options?: BuildOverviewOptions;
    builtAtIso: string;
}

/** What a caller may strike off a plan before running it. */
export interface OverviewPlanEdits {
    /** Region labels to skip. */
    drop?: string[];
    /** Region labels to keep, to the exclusion of everything else. */
    only?: string[];
    /** Extra vision calls to allow beyond the plan's budget. */
    addCalls?: number;
    driver?: string;
}

/** A costed, not-yet-run walk. See {@link PathologyFoundation.planOverview}. */
export interface OverviewPlanResult {
    planId: string;
    coverageScope: CoverageScope;
    scopeBounds: Bounds;
    checklist: Checklist;
    ladder: { magnifications: Array<number | null>; targetMpp: Array<number | null> };
    regions: Array<{
        label: string;
        bounds: Bounds;
        areaFraction: number;
        /** Tissue share of the box, from the cached mask. Null when no survey covers it. */
        fill: number | null;
        /** Nuclear density prior, 0..1. Null when the driver offers no density feature. */
        cellularity: number | null;
    }>;
    /** Regions still sharing part of their box after merging — a judgement call left to the caller. */
    overlapPairs: Array<{ a: string; b: string; iou: number }>;
    /** Calls the coverage pass will spend. Depth is adaptive and deliberately not guessed at. */
    estimatedSurveyCalls: number;
    maxAnalyzeCalls: number;
    slideCoverage: number;
    surveyComplete: boolean;
    /** Regions the root cap left out — coverage the run will not reach (no silent caps). */
    regionsOmitted: number;
    builtAtIso: string;
}

/** A plan that can no longer be run: the slide moved on, or the edits left nothing to read. */
export interface OverviewPlanExpired {
    status: "plan-expired";
    planId: string;
    reason?: "no-regions";
}

/**
 * A cached whole-slide tissue survey: everything `exploreSlide` derived, minus the pixels.
 *
 * The mask is kept because it answers "how much tissue is in this box?" and "what shape is
 * it?" for ANY box on the slide, at survey resolution, for free. The RGBA raster it was
 * computed from is deliberately not kept — it is four times the size and only the mask is
 * ever asked for again.
 */
interface SlideSurvey {
    builtAtIso: string;
    /** Parent-global rectangle the mask covers. */
    surveyBounds: Bounds;
    slide: SlideExploration["slide"];
    slideCoverage: number;
    coverageScope: CoverageScope;
    regions: SlideRegion[];
    /** Ref-local polygons of the detected islands, for `annotate`. */
    localPolys: Array<Point[]>;
    mask: MaskResult;
    /** Reads a tissue fraction for any parent-global box out of {@link mask}. */
    sampler: MaskSampler;
    /**
     * Nuclear density over the same rectangle. Derived from the survey raster while it is
     * still in hand — waiting would mean re-rendering the whole slide for it later.
     * Absent when no `cellularity` driver is registered, which is a supported deployment:
     * the walk then ranks on tissue area alone, as it always did.
     */
    density?: DensityMap;
    driverId: string;
}

/** What `refineOverview` needs to continue a walk under the rules it originally ran under. */
interface OverviewRunState {
    opts: ResolvedOverviewOptions;
    ladder: OverviewLadder;
    /** Expansions performed under each root — the anti-starvation term, which must survive. */
    expandedPerRoot: Map<string, number>;
    /** Slide metadata and coverage, for republishing without re-surveying. */
    exploration: SlideExploration;
    /** Cumulative spend across the original run and every refinement of it. */
    spent: OverviewBudget;
    /** How many times this tree has been continued. */
    refinements: number;
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
            // Diagnostics only — the server logs it beside the image and never
            // puts it in the model's message. This is what turns a logged vision
            // call from an anonymous PNG into "region 2.1 of this slide, read at
            // 1.6 µm/px".
            context: input.context,
        }, {
            // Yield connection slots to interactive tile loading — bounded per
            // origin by APPLICATION_CONTEXT.requestScheduler (background lane).
            priority: "background",
        });
        return { text: typeof res?.text === "string" ? res.text : "" };
    }
}

class PathologyFoundation extends (XOpatModuleSingleton as any) {
    /** Monotonic id source for `region-capture` announcements from captureViewportImage. */
    private static _viewCaptureSeq = 0;
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
    /**
     * What the work on this slide is currently ABOUT, keyed the same way.
     *
     * A conversation settles on a region and then stops naming it: "review core 3", "and the
     * findings?", "do a deep scan". The last of those carries its target in the conversation, not
     * in the sentence, and a walk that answered it slide-wide spent minutes examining the wrong
     * tissue. So a region-scoped call records its region here, and a later call that names no
     * scope inherits it.
     *
     * Not a hidden narrowing: a run that took the focus reports `coverageScope: "region"`,
     * `scopeBounds`, and the scoped-coverage warning — the same three signals an explicit scope
     * produces. `scope: "slide"` is the opt-out and clears it.
     */
    private _focusRegions: Map<string, { label?: string; bounds: Bounds }> = new Map();
    /**
     * Everything a stopped walk needs to be CONTINUED rather than restarted, keyed the same way.
     *
     * The tree is cached, but the tree alone cannot resume: the traversal also needs the resolved
     * options it ran under, the ladder it climbed, and the per-root expansion counts the
     * anti-starvation weight is computed from. Rebuilding those by guesswork would make a
     * refinement rank by different rules than the run it continues.
     */
    private _overviewRuns: Map<string, OverviewRunState> = new Map();
    /**
     * Costed-but-unrun walks, keyed like the surveys and bounded the same way.
     *
     * A plan holds a survey by reference, so it is cheap to keep and expensive to lose — but
     * it is also stale the moment the slide changes, which is what the slide-keyed bound
     * takes care of. A caller whose plan has been evicted gets `plan-expired` and can plan
     * again; nothing re-surveys behind their back.
     */
    private _overviewPlans: Map<string, OverviewPlan> = new Map();
    private _planCounter = 0;
    /**
     * Tissue surveys, keyed by `tileSourceId` PLUS the rectangle and pixel budget they were
     * derived at (see `surveyCacheKey`). A slide can now be surveyed at more than one scope — the
     * whole slide coarsely, the current view finely — and serving one where the other was
     * asked for would silently answer at the wrong resolution over the wrong box.
     *
     * A slide's tissue mask does not change, yet the walk used to re-derive it constantly:
     * once for orientation, once per node to measure fill, and once more per node to find
     * children — three renders and three threshold passes over largely the same pixels.
     * Keeping the mask (a ~2 MB `Uint8Array`) and dropping the RGBA it came from (~8 MB)
     * turns all of that into arithmetic.
     *
     * A survey whose tiles were still streaming is NOT cached: it understates coverage,
     * and caching it would make a transient network state permanent for the session.
     */
    private _surveys: Map<string, SlideSurvey> = new Map();

    constructor() {
        super();
        this._drivers = new Map();
        this.MagicWand = null;
        this._defaultForFeature = (this.getStaticMeta("defaultDrivers", {}) as Record<string, string>) || {};

        // Built-in, dependency-free tissue detector so the module works out of
        // the box. Registered first → default for `tissue-mask`. local => no
        // snapshot ever leaves the viewer.
        const stainVectors = (this.getStaticMeta("stainVectors", null) as StainVectors | null)
            || DEFAULT_STAIN_VECTORS;
        this.registerDriver({
            id: "builtin",
            label: "Built-in tissue detector",
            local: true,
            features: {
                "tissue-mask": async (input: TissueMaskInput) =>
                    builtinTissueMask(input.pixels, input.width, input.height),
                "cellularity": async (input: CellularityInput) => {
                    const count = input.width * input.height;
                    // Unmixing assumes an absorbing stain basis. Fluorescence is emissive and
                    // an unstained slide has nothing to unmix, so the basis is meaningless
                    // there — fall back to stain intensity, which still ranks regions even
                    // though it is not a statement about nuclei.
                    const emissive = input.stainClass === "fluorescence" || input.stainClass === "unstained";
                    const signal = emissive
                        ? Float32Array.from(saturationChannel(input.pixels, count), v => v / 255)
                        : stainConcentration(input.pixels, count, stainVectors);
                    return densityGrid(
                        signal, input.width, input.height,
                        input.cell ?? DENSITY_CELL_PIXELS,
                        input.mask?.binaryMask
                    );
                },
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
        // Name what IS here. A bare "feature X is missing" tells a caller nothing about what to
        // do next, so an agent's only move is to guess at another call and spend a turn finding
        // out that one is missing too — the inventory is what turns one dead end into a choice.
        const available = [...new Set(this.listDrivers().flatMap(d => d.features))].sort();
        throw new Error(
            `No pathology driver implements the "${feature}" feature. `
            + `Available features: ${available.join(", ") || "(none)"}.`
        );
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
        const tissue = countFilled(mask.binaryMask);
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
        const tissue = countFilled(mask.binaryMask);
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
     * Orientation pass. Renders a rectangle of the slide OFF-SCREEN (the user's viewport is
     * never touched), detects tissue with the `tissue-mask` driver, and returns a ranked list
     * of tissue islands (each with a parent-global bbox to navigate to) plus that rectangle's
     * tissue coverage and slide metadata. The agent should call this FIRST so any follow-up
     * work targets real tissue and never frames empty glass. The user can keep navigating
     * freely the whole time.
     *
     * The rectangle is the whole slide by default and whatever `scope` says otherwise — and a
     * scope is a real restriction, not a hint: the same pixel budget spread over a viewport
     * instead of a whole slide is a far finer mask, which is the point of asking for one.
     *
     * The survey is a low-resolution render, so `regions` bounds are approximate — follow up
     * with `annotateTissue` (or a region-scoped `analyzeRegion`) for a high-resolution result.
     *
     * @param scope where to look: "slide" (default), "viewport", or a parent-global rectangle.
     * @param surveyMpp resolution of the survey render, µm/px. See {@link BuildOverviewOptions.surveyMpp}.
     * @param surveyPixels raster budget for the survey render (default 2 MP, ceiling 4 MP).
     * @param annotate draw the detected islands as polygon annotations (default off).
     * @param hint when true and an `analyze` driver exists, attach one coarse
     *   model-assisted overview note (a snapshot leaves the viewer — the scripting
     *   layer asks for consent).
     * @param minAreaFraction smallest island to report, as a fraction of the
     *   surveyed rectangle (default 0.001; looser than `annotateTissue` because the
     *   survey is coarse).
     */
    async exploreSlide(
        viewer: any,
        options?: {
            driver?: string; annotate?: boolean; hint?: boolean; minAreaFraction?: number;
            /** Re-derive the tissue survey instead of reusing the cached one. */
            refresh?: boolean;
            scope?: ExplorationScope;
            surveyMpp?: number;
            surveyPixels?: number;
        }
    ): Promise<SlideExploration> {
        if (!viewer) throw new Error("exploreSlide() requires a viewer.");
        const { survey, raster } = await this._surveySlide(viewer, options);

        if (options?.annotate && survey.localPolys.length) {
            this._commitPolygons(viewer, this._annotations(), survey.localPolys);
        }

        let hint: string | null | undefined;
        if (options?.hint && this._hasFeature("analyze", options?.driver)) {
            // Reuse the survey raster when this call produced it. A cached survey kept the
            // mask and dropped the pixels, so an opt-in hint then pays for its own render —
            // which is the right trade: the mask is asked for constantly, the pixels once.
            const res = await this.analyzeRegion(viewer, {
                prompt: t("pathology.overviewHintPrompt"),
                driver: options?.driver,
                source: "background",
                region: survey.surveyBounds,
                ...(raster ? { preRead: raster } : { targetPixels: MASK_TARGET_PIXELS }),
            });
            hint = res?.findings ?? null;
        }

        return {
            driver: survey.driverId,
            slide: survey.slide,
            slideCoverage: survey.slideCoverage,
            coverageScope: survey.coverageScope,
            scopeBounds: survey.surveyBounds,
            // Only a COMPLETE survey is ever cached, so a cache hit is complete by construction.
            isComplete: raster ? raster.isComplete : true,
            // Presented in slide reading order, which is what the numbering means. The cached
            // `survey.regions` keeps its priority order for callers that take a prefix of it.
            regions: survey.regions.slice().sort((a, b) => a.index - b.index),
            hint,
        };
    }

    /**
     * Ask a set of specific questions about one region, at a resolution that can answer them.
     *
     * This is the call for "check X here" — the deep-dive counterpart to `buildOverview`'s
     * breadth. It exists because the overview's job is triage: it asks every field the same
     * checklist at whatever rung it reached, which is the right trade for covering a slide
     * and the wrong one for settling a question about one place.
     *
     * It TILES the region itself when the requested resolution cannot carry it in one call,
     * and reports `coveredFraction` when it had to sample rather than cover — so a caller
     * never hand-splits a region and never has to guess how much of it was read.
     *
     * Answers are typed, not prose: `not-assessable` is a distinct outcome from `no`, and
     * conflating the two is how a feature gets reported as absent when the image could
     * never have shown it.
     */
    async interrogateRegion(viewer: any, options: {
        region: Bounds;
        /** Features to establish. Sanitized like any other checklist. */
        features?: ChecklistFeature[];
        /** Sugar for `features`: plain questions, asked at the finest resolution available. */
        questions?: string[];
        /** Target resolution. Defaults to the finest any supplied feature asks for. */
        mpp?: number;
        /** Fields to read. More fields cover more of the region and cost more calls. */
        maxFields?: number;
        driver?: string;
        context?: SlideContext;
        signal?: AbortSignal;
        concurrency?: number;
    }): Promise<InterrogationResult> {
        if (!viewer) throw new Error("interrogateRegion() requires a viewer.");
        if (!options?.region) throw new Error("interrogateRegion() requires a region.");
        if (!this._hasFeature("analyze", options?.driver)) {
            throw new Error("interrogateRegion needs an 'analyze' driver (e.g. a configured vision model).");
        }
        // Naming a region is what makes it the subject; a later unqualified call follows it.
        this.setFocusRegion(viewer, options.region);

        const checklist = this._interrogationChecklist(options);
        const slideMpp = this._micronsPerPixel(viewer);
        const wantMpp = options.mpp
            ?? Math.min(...checklist.features.map(f => f.requiredMpp));
        const maxFields = Math.max(1, options.maxFields ?? 4);
        const context = this._normalizeContext(options.context ?? this.getSlideContext(viewer) ?? undefined);

        const survey = this._surveyCovering(viewer, options.region);
        const slide = this._slideMeta(viewer, this._ref(viewer));
        const plan = planFields({
            bounds: options.region,
            mpp: slideMpp ? wantMpp : null,
            slideMpp,
            ...(slideMpp ? {} : { downsample: 1 }),
            maxRasterPixels: FIELD_MAX_PIXELS,
            maxFields,
            minFill: 0,
            ...(survey ? { mask: survey.sampler } : {}),
            ...(survey?.density ? { density: survey.density } : {}),
            ...(slide.width > 0 && slide.height > 0 ? { slide: { width: slide.width, height: slide.height } } : {}),
        });
        if (!plan.fields.length) {
            throw new Error("The requested region maps to an empty area of the slide.");
        }

        const regionArea = Math.max(1, options.region.width * options.region.height);
        const fields: InterrogationResult["fields"] = [];
        let analyzeCalls = 0;
        let isComplete = true;

        for await (const done of runFieldPipeline<Field, FieldRaster, InterrogationField | null>(plan.fields, {
            render: (field) => this._renderField(viewer, field, {
                layers: "background",
                label: t("pathology.captureInterrogate"),
            }),
            analyze: async (field, raster) => {
                // `slideMpp` is what the scan holds. Asking for finer is a legitimate request
                // this slide cannot meet — meeting it as far as possible and saying so beats
                // returning a checklist of `not-assessable` and `analyzeCalls: 0`, which is a
                // call that looked at nothing while reporting a verdict for every feature.
                const { assessable, deferred } =
                    splitByResolution(checklist, raster.deliveredMpp, undefined, slideMpp);
                const answers: Record<string, FeatureAnswer> = {};
                for (const f of deferred) answers[f.id] = unassessable(f.id, "resolution");
                // A render that spent its budget or stalled hands back the tiles it did get.
                // That is worth analyzing — but the result it produces is a read of part of the
                // field, and saying so is the difference between a partial answer and a wrong one.
                if (!raster.isComplete) isComplete = false;

                let findings: string | null = null;
                if (assessable.length) {
                    analyzeCalls++;
                    const facts = await this._measureNodeView(
                        viewer,
                        { index: 0, label: field.label, bounds: field.bounds, center: centerOf(field.bounds)!, areaFraction: 0, isApproximate: true },
                        Math.max(1, slide.width * slide.height),
                        { measureFill: false, driver: options.driver },
                        raster,
                        field.mpp
                    );
                    const askedFor: Checklist = { ...checklist, features: assessable };
                    const res = await this.analyzeRegion(viewer, {
                        prompt: [
                            ...this._contextPreamble(context, facts, 0, null),
                            t("pathology.fieldChecklistIntro"),
                            ...assessable.map(f => t("pathology.fieldChecklistItem", { id: f.id, question: f.question })),
                            t("pathology.fieldAnswerContract"),
                        ].join(" "),
                        driver: options.driver,
                        source: "background",
                        region: field.bounds,
                        preRead: raster,
                    });
                    const parsed = parseFieldAnswers(res?.findings, askedFor);
                    Object.assign(answers, parsed.answers);
                    markBelowRequested(answers, assessable, raster.deliveredMpp);
                    findings = parsed.prose || res?.findings || null;
                    if (res?.isComplete === false) isComplete = false;
                }
                return {
                    label: field.label,
                    bounds: field.bounds,
                    deliveredMpp: raster.deliveredMpp,
                    answers: checklist.features.map(f => answers[f.id] ?? unassessable(f.id, "unparsed")),
                    findings,
                };
            },
            onError: (field, error) => {
                // Nothing was rendered, so nothing was read: the result cannot claim to be
                // complete, and the features are `unread` — not `unparsed`, which would let
                // the aggregate report "the model could not tell" about an image the model
                // was never shown.
                isComplete = false;
                return {
                    label: field.label,
                    bounds: field.bounds,
                    deliveredMpp: null,
                    answers: checklist.features.map(f => unassessable(f.id, "unread")),
                    findings: null,
                    error: (error as any)?.message || String(error),
                };
            },
            visionConcurrency: Math.max(1, options.concurrency ?? 4),
            renderWindow: Math.max(1, options.concurrency ?? 4),
            ...(options.signal ? { signal: options.signal } : {}),
        })) {
            if (done) fields.push(done);
        }

        // Only fields that produced a raster COVER anything. Summing the planned bounds of a
        // field that failed to render reported `coveredFraction: 1` for a run in which every
        // field errored — a number that says "the whole region was examined" about a region
        // nothing looked at.
        const unread = fields.filter(f => f.error);
        const coveredArea = fields.reduce(
            (sum, f) => sum + (f.error ? 0 : f.bounds.width * f.bounds.height), 0
        );
        const warnings = unread.length
            // Named as a rendering failure, because the aggregate answers alone read as a
            // resolution problem and send the reader to zoom in — which cannot help.
            ? [t("pathology.warnFieldsUnread", {
                count: unread.length,
                total: fields.length,
                reason: unread[0]?.error ?? "",
            })]
            : [];
        return {
            region: options.region,
            checklist,
            requestedMpp: slideMpp ? wantMpp : null,
            deliveredMpp: plan.deliveredMpp,
            fields,
            answers: this._aggregateAnswers(fields, checklist),
            coveredFraction: Math.max(0, Math.min(1, coveredArea / regionArea)),
            isComplete,
            ...(warnings.length ? { warnings } : {}),
            budget: { analyzeCalls },
        };
    }

    /**
     * Score or compare several regions in ONE vision call.
     *
     * N renders, one model call. Triaging a dozen candidates individually would spend half
     * a walk's budget; as a montage it costs one call — and the model sees the fields side
     * by side, which is the only way it can say "this one is unlike the others" at all.
     *
     * The composite is explicitly described to the model as separate, non-adjacent fields
     * with their own labels, and drawn with gutters so that framing is visually true and
     * not merely asserted.
     */
    async montageRegions(viewer: any, options: {
        regions: Array<Bounds | { bounds: Bounds; label?: string }>;
        /** A free-text question about the set. Ignored when `features` is given. */
        prompt?: string;
        features?: ChecklistFeature[];
        cols?: number;
        cellPixels?: number;
        /** Resolution each cell is rendered at. Defaults to the survey rung. */
        mpp?: number;
        driver?: string;
        context?: SlideContext;
        signal?: AbortSignal;
    }): Promise<MontageResult> {
        if (!viewer) throw new Error("montageRegions() requires a viewer.");
        const input = (options?.regions || []).slice(0, MONTAGE_MAX_CELLS);
        if (!input.length) throw new Error("montageRegions() requires at least one region.");
        if (!this._hasFeature("analyze", options?.driver)) {
            throw new Error("montageRegions needs an 'analyze' driver (e.g. a configured vision model).");
        }

        const entries = input.map((r, i) => {
            const bounds = (r as any).bounds ?? (r as Bounds);
            return { bounds, label: (r as any).label || regionLabel([i]) };
        });
        const slideMpp = this._micronsPerPixel(viewer);
        const mpp = options.mpp ?? SURVEY_MPP;
        const layout = planMontageLayout(entries.length, {
            ...(options.cols ? { cols: options.cols } : {}),
            ...(options.cellPixels ? { cellPixels: options.cellPixels } : {}),
            maxPixels: MONTAGE_MAX_PIXELS,
        });

        // Renders are serialized by the core anyway, so this loop is the natural shape;
        // the saving being bought here is in MODEL calls, not in render parallelism.
        const cells: MontageCell[] = [];
        const rendered: Array<{ bounds: Bounds; label: string; cellLabel: string; deliveredMpp: number | null }> = [];
        let isComplete = true;
        for (let i = 0; i < entries.length; i++) {
            if (options.signal?.aborted) break;
            const entry = entries[i];
            const plan = planFields({
                bounds: entry.bounds,
                mpp: slideMpp ? mpp : null,
                slideMpp,
                ...(slideMpp ? {} : { downsample: fitDownsample(entry.bounds, FIELD_MAX_PIXELS) }),
                single: true,
                maxRasterPixels: FIELD_MAX_PIXELS,
                minFill: 0,
            });
            const field = plan.fields[0];
            if (!field) continue;
            try {
                const raster = await this._renderField(viewer, field, {
                    layers: "background",
                    label: t("pathology.captureMontage"),
                });
                const cellLabel = montageCellLabel(cells.length, layout.cols);
                cells.push({
                    width: raster.width, height: raster.height, pixels: raster.pixels, cellLabel,
                });
                rendered.push({
                    bounds: entry.bounds, label: entry.label, cellLabel,
                    deliveredMpp: raster.deliveredMpp,
                });
                if (!raster.isComplete) isComplete = false;
            } catch (e) {
                // One unreadable region must not cost the whole comparison.
                console.warn(`[pathology-foundation] montage skipped ${entry.label}:`, e);
            }
        }
        if (!cells.length) throw new Error("None of the requested regions could be rendered.");

        const composite = await composeMontage(cells, layout);
        const context = this._normalizeContext(options.context ?? this.getSlideContext(viewer) ?? undefined);
        const checklist = options.features
            ? sanitizeChecklist(options.features, { source: "explicit" })
            : null;

        const cellSizeUm = slideMpp
            ? { width: rendered[0].bounds.width * slideMpp, height: rendered[0].bounds.height * slideMpp }
            : null;
        const prompt = [
            t("pathology.montageIntro", {
                count: cells.length,
                labels: rendered.map(r => r.cellLabel).join(", "),
            }),
            ...(cellSizeUm
                ? [t("pathology.montageScale", {
                    widthUm: Math.round(cellSizeUm.width),
                    heightUm: Math.round(cellSizeUm.height),
                    mpp: round(rendered[0].deliveredMpp ?? mpp, 2),
                })]
                : []),
            t("pathology.montageCellLegend"),
            ...(checklist
                ? [
                    t("pathology.fieldChecklistIntro"),
                    ...checklist.features.map(f => t("pathology.fieldChecklistItem", { id: f.id, question: f.question })),
                ]
                : [options.prompt || t("pathology.montageDefaultPrompt")]),
            t("pathology.montageContract"),
        ].join(" ");

        const driver = this.getDriverForFeature("analyze", options.driver);
        this.raiseEvent("analysis-started", { driver: driver.id, feature: "analyze", region: null });
        let text: string | null = null;
        try {
            const res = await driver.features["analyze"]!({
                imageBlob: composite.blob,
                prompt: [...this._contextPreamble(context, this._montageFacts(cellSizeUm, composite), 0, null), prompt].join(" "),
                // A montage is many non-adjacent fields in one image, so there is no
                // single region to name — every cell is listed instead, with the
                // label that is drawn on it, so the record maps back to the slide.
                context: this._analysisContext(viewer, "montage", {
                    label: rendered.map(r => r.cellLabel).join(", ") || null,
                    regions: rendered.map(r => ({ label: r.cellLabel, bounds: r.bounds })),
                    deliveredMpp: rendered[0]?.deliveredMpp ?? null,
                }),
            });
            text = res?.text ?? null;
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, feature: "analyze", region: null });
        }

        return {
            driver: driver.id,
            cells: this._parseMontageAnswers(text, rendered, checklist),
            findings: text,
            cellMpp: rendered[0].deliveredMpp,
            cellSizeUm,
            isComplete,
        };
    }

    /**
     * Where the nuclei are on this slide, as a coarse normalized grid.
     *
     * Local, deterministic and FREE — no model call, and no render of its own when the
     * survey is already in hand. Its purpose is to be consulted BEFORE a vision budget is
     * committed: "biggest tissue island first" cannot distinguish a large bland island
     * from a small dense one, and that distinction is most of what makes a triage order
     * worth having.
     *
     * Cached with the survey, so repeated calls cost nothing.
     */
    async buildDensityMap(
        viewer: any,
        options?: { driver?: string; cell?: number; refresh?: boolean }
    ): Promise<DensityMap> {
        if (!viewer) throw new Error("buildDensityMap() requires a viewer.");
        const { survey, raster } = await this._surveySlide(viewer, {
            driver: options?.driver, refresh: options?.refresh,
        });
        if (survey.density && !options?.refresh && !options?.cell) return survey.density;

        // The survey drops its pixels once the mask is derived, so a cache hit that has no
        // density yet has to re-read them. Still one render, and only the first time.
        const pixels = raster || await this._renderRegionRaster(viewer, survey.surveyBounds, {
            targetPixels: MASK_TARGET_PIXELS,
            layers: "background",
            label: t("pathology.captureDensity"),
        });
        const density = await this._runCellularity(viewer, options?.driver, pixels, survey, options?.cell);
        if (!options?.cell) survey.density = density;
        return density;
    }

    /** Run the `cellularity` feature over a raster and wrap it as a {@link DensityMap}. */
    private async _runCellularity(
        viewer: any,
        driverId: string | undefined,
        raster: RegionRaster,
        survey: SlideSurvey,
        cell?: number
    ): Promise<DensityMap> {
        const driver = this.getDriverForFeature("cellularity", driverId);
        const grid = await driver.features["cellularity"]!({
            width: raster.width,
            height: raster.height,
            pixels: raster.pixels,
            toBlob: raster.toBlob,
            // The survey mask is over the SAME rectangle at the same nominal resolution, so
            // it lines up pixel-for-pixel only when the driver returned it at the raster's
            // size. Pass it when it matches; a mismatch would silently mask the wrong pixels.
            ...(survey.mask.width === raster.width && survey.mask.height === raster.height
                ? { mask: survey.mask }
                : {}),
            ...(cell ? { cell } : {}),
            stainClass: this.getSlideContext(viewer)?.stainClass,
        });
        return this._asDensityMap(grid, survey.surveyBounds,
            driver.id === "builtin"
                ? (this.getSlideContext(viewer)?.stainClass === "fluorescence"
                    || this.getSlideContext(viewer)?.stainClass === "unstained"
                    ? "saturation-fallback" : "nuclear-deconvolution")
                : "driver");
    }

    /** Give a raw {@link DensityGrid} its parent-global geometry and sampling helpers. */
    private _asDensityMap(grid: DensityGrid, bounds: Bounds, method: DensityMap["method"]): DensityMap {
        const width = Math.max(1, grid.width | 0);
        const height = Math.max(1, grid.height | 0);
        const values = grid.values instanceof Float32Array
            ? grid.values
            : Float32Array.from(grid.values || []);
        const cellW = bounds.width / width;
        const cellH = bounds.height / height;
        const boundsOfCell = (gx: number, gy: number): Bounds => ({
            x: bounds.x + gx * cellW, y: bounds.y + gy * cellH, width: cellW, height: cellH,
        });
        return {
            bounds, width, height, values, method,
            sample(b: Bounds): number {
                const x0 = Math.max(0, Math.floor((b.x - bounds.x) / cellW));
                const y0 = Math.max(0, Math.floor((b.y - bounds.y) / cellH));
                const x1 = Math.min(width, Math.ceil((b.x + b.width - bounds.x) / cellW));
                const y1 = Math.min(height, Math.ceil((b.y + b.height - bounds.y) / cellH));
                if (!(x1 > x0) || !(y1 > y0)) return 0;
                let sum = 0, n = 0;
                for (let gy = y0; gy < y1; gy++) {
                    for (let gx = x0; gx < x1; gx++) { sum += values[gy * width + gx]; n++; }
                }
                return n ? sum / n : 0;
            },
            top(n: number) {
                const cells: Array<{ bounds: Bounds; value: number }> = [];
                for (let gy = 0; gy < height; gy++) {
                    for (let gx = 0; gx < width; gx++) {
                        const value = values[gy * width + gx];
                        if (value > 0) cells.push({ bounds: boundsOfCell(gx, gy), value });
                    }
                }
                return cells.sort((a, b) => b.value - a.value).slice(0, Math.max(0, n | 0));
            },
        };
    }

    /**
     * Render the survey rectangle — the read every later decision rests on.
     *
     * ONE render, one generous budget. This used to re-issue the render up to three times because
     * the vendored flex-renderer drew whatever tiles happened to be resident and never waited for
     * the ones it scheduled, so the first whole-slide survey of a cold slide saw only the region
     * the user had been looking at (a 21x50 mm biopsy came back as one 3 mm island at 0.1 %
     * coverage, cached for the session because the raster claimed to be complete). The renderer now
     * waits, so re-asking would just re-pay a budget the first pass already spent — and each retry
     * re-queued through the background scheduler, where the tiles the previous attempt scheduled
     * kept the pass out until the ~1500 ms starvation escape.
     */
    private async _renderSurveyRaster(
        viewer: any,
        surveyBounds: Bounds,
        targetPixels: number
    ): Promise<RegionRaster> {
        return this._renderRegionRaster(viewer, surveyBounds, {
            targetPixels,
            layers: "background",
            timeoutMs: this._budget("surveyLoadTimeoutMs", SURVEY_LOAD_TIMEOUT_MS),
            label: t("pathology.captureSurvey"),
        });
    }

    /**
     * The tissue survey behind `exploreSlide`, derived once per (slide, scope, budget).
     *
     * Returns the freshly-rendered raster alongside the survey when this call did the work,
     * so a caller that also needs the pixels does not pay for a second render. A cache hit
     * returns no raster — the survey keeps the mask and drops the pixels on purpose.
     */
    private async _surveySlide(
        viewer: any,
        options?: {
            driver?: string; minAreaFraction?: number; refresh?: boolean;
            scope?: ExplorationScope; surveyMpp?: number; surveyPixels?: number;
        }
    ): Promise<{ survey: SlideSurvey; raster: RegionRaster | null }> {
        const slideKey = this._slideKey(viewer);
        const { bounds: surveyBounds, coverageScope } = this._resolveScope(viewer, options?.scope);
        // Resolve the rung BEFORE the budget: on a scoped run the rung is what decides how
        // many pixels are worth asking for, and asking for the flat whole-slide budget over a
        // small box is how a "closer look" came back at whole-slide coarseness.
        const surveyMpp = this._resolveSurveyMpp(viewer, surveyBounds, coverageScope, options);
        const targetPixels = this._surveyPixelBudget(viewer, surveyBounds, {
            surveyMpp, surveyPixels: options?.surveyPixels,
        });
        const key = slideKey ? surveyCacheKey(slideKey, surveyBounds, targetPixels) : null;

        if (!options?.refresh && key) {
            const cached = this._surveys.get(key);
            // Re-insert on a hit so recency is real, not just insertion age.
            if (cached) {
                rememberBounded(this._surveys, key, slideKey!, cached, MAX_SURVEYS_PER_SLIDE);
                return { survey: cached, raster: null };
            }
        }

        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);
        const slideMeta = this._slideMeta(viewer, ref);
        const slideDimsKnown = slideMeta.width > 0 && slideMeta.height > 0;

        const raster = await this._renderSurveyRaster(viewer, surveyBounds, targetPixels);
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
        // The area a contour may legitimately span is the SURVEYED rectangle, which is the
        // whole slide only on an unscoped run. Using the slide's area on a scoped one would
        // never fire the degenerate-box guard, since no box inside the scope can approach it.
        const surveyArea = surveyBounds.width * surveyBounds.height;

        // The raster IS the surveyed rectangle, so tissue/total is genuine coverage OF THAT
        // RECTANGLE (unlike annotateTissue's current-view coverage) — the whole slide when the
        // run is unscoped, the scope otherwise; `coverageScope` says which. Computed before
        // the contour loop so the full-rectangle guard below can tell a spurious outline (low
        // coverage) from a legitimately all-tissue rectangle (high coverage).
        const slideCoverage = total ? countFilled(mask.binaryMask) / total : 0;

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
                // Clamp into the SURVEYED rectangle — that is the hard restriction a scope
                // buys, and on an unscoped run it is the slide, so nothing changes there.
                // Then clamp to the slide as well (link targets must be real, on-slide);
                // in the current-view fallback the slide extent is unknown, so that step is
                // skipped and the raw (already on-view) box stands.
                const inScope = intersectBounds(raw, surveyBounds);
                if (!inScope) return;
                const bounds = slideDimsKnown
                    ? clampBoundsToSlide(inScope, slideMeta.width, slideMeta.height)
                    : inScope;
                if (!bounds) return;
                // Drop a degenerate box spanning the whole surveyed rectangle ONLY when
                // coverage is low (a spurious full-rectangle contour); an all-tissue view
                // genuinely yields one and must be kept, else exploreSlide reports blank on
                // solid tissue.
                if (surveyArea > 0 && bounds.width * bounds.height > 0.999 * surveyArea && slideCoverage < 0.9) return;
                localPolys.push(imagePoly.map(toLocal));
                const index = regions.length;
                regions.push({
                    index,
                    label: regionLabel([index]),
                    bounds,
                    center: centerOf(bounds)!,
                    areaFraction: r.area / total,
                    isApproximate: true,
                });
            });

        const survey: SlideSurvey = {
            builtAtIso: new Date().toISOString(),
            surveyBounds,
            slide: slideMeta,
            slideCoverage,
            coverageScope,
            // Merging and the collapsed-scope rescue both renumber positionally — they have
            // to, since they rebuild the list. Reading-order numbering is applied ONCE, on
            // whatever survives, so a label is never assigned twice from a different list.
            regions: this._numberByReadingOrder(this._resegmentCollapsedScope(
                this._mergeRegions(regions), mask, mapParent, surveyBounds, coverageScope, slideCoverage
            )),
            localPolys,
            mask,
            sampler: maskSampler(mask, surveyBounds),
            driverId,
        };

        // Derive the density prior NOW, while the pixels are still here. Deferring it would
        // mean re-rendering the whole slide for something the survey raster already
        // contains. A failure is not fatal: the prior is an improvement to the ordering,
        // not a precondition for having one.
        if (this._hasFeature("cellularity", options?.driver)) {
            try {
                survey.density = await this._runCellularity(viewer, options?.driver, raster, survey);
            } catch (e) {
                console.warn("[pathology-foundation] cellularity map unavailable; ranking on area alone.", e);
            }
        }
        // A partial render understates coverage and misplaces islands. Caching one would
        // make a transient network state permanent for the rest of the session.
        if (key && slideKey && raster.isComplete) {
            rememberBounded(this._surveys, key, slideKey, survey, MAX_SURVEYS_PER_SLIDE);
        }
        return { survey, raster };
    }

    /**
     * Split a scoped survey that came back as ONE region spanning its own rectangle.
     *
     * A scope is drawn around tissue the reviewer cares about — typically several cores. At
     * survey coarseness those cores are separated by a few mask pixels of glass, and outer
     * contours are traced 8-connected, so one diagonal touch anywhere merges them into a
     * single contour whose bounding box is the whole scope. `exploreSlide` then reports one
     * region, the walk gets one root, and the assistant describes a four-core biopsy as "a
     * single core" — from a box that is 90% glass (`bboxFillFraction` ~0.1 is the tell).
     *
     * The mask already says where the tissue is, so no extra render is needed: fall back to
     * the same tissue-aware grid that {@link _subdivideRegion} uses for a contiguous mass.
     * Every cell holds real tissue (`TILE_MIN_FILL`), so the walk gets several honest roots
     * to spread its survey budget across instead of one rectangle to re-describe.
     *
     * Untouched when the run is unscoped (a whole-slide contour that spans the slide is
     * already dropped upstream), when the survey found real structure, or when the rectangle
     * genuinely IS solid tissue — there is nothing to separate in that case.
     */
    private _resegmentCollapsedScope(
        regions: SlideRegion[],
        mask: MaskResult,
        mapParent: (px: number, py: number) => Point,
        surveyBounds: Bounds,
        coverageScope: CoverageScope,
        slideCoverage: number
    ): SlideRegion[] {
        const first = regions[0];
        const collapsed = shouldResegmentScope({
            coverageScope,
            regionCount: regions.length,
            regionArea: first ? first.bounds.width * first.bounds.height : null,
            surveyArea: surveyBounds.width * surveyBounds.height,
            coverage: slideCoverage,
            spanFraction: SCOPE_COLLAPSED_SPAN,
            solidCoverage: SCOPE_SOLID_TISSUE_COVERAGE,
        });
        if (!collapsed) return regions;

        const cells = gridSplitTissue(mask, mapParent, SCOPE_RESEGMENT_GRID, TILE_MIN_FILL);
        if (cells.length < 2) return regions;
        return cells.map((cell, index) => ({
            index,
            label: regionLabel([index]),
            bounds: intersectBounds(cell.bounds, surveyBounds) || cell.bounds,
            center: centerOf(cell.bounds)!,
            areaFraction: cell.areaFraction,
            isApproximate: true,
        }));
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
        let ownRegions = false;
        if (!regions || !regions.length) {
            regions = (await this.exploreSlide(viewer, { driver: options?.driver })).regions;
            ownRegions = true;
        }
        const max = Math.max(0, options?.max ?? 5);
        // "The top regions" means the most tissue, and `exploreSlide` now hands them back in
        // slide reading order — so say which N are wanted rather than taking a prefix and
        // hoping the order still means size. A caller-supplied list is their order to keep.
        const ranked = ownRegions
            ? regions.slice().sort((a, b) => (b.areaFraction ?? 0) - (a.areaFraction ?? 0))
            : regions;
        const targets = ranked.slice(0, max);

        // Reuse whatever is already established about the slide; never ask for it here —
        // a region walk should inherit the frame of reference, not open a new question.
        const context = this.getSlideContext(viewer) || undefined;

        const results: RegionReviewResult[] = [];
        for (const region of targets) {
            // Caller-supplied regions may predate labels — derive one rather than echo a blank.
            const label = region.label || regionLabel([region.index]);
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
                        label,
                        bounds: region.bounds,
                        findings: res?.findings ?? null,
                        isComplete: res?.isComplete ?? true,
                    });
                } else {
                    const raster = await this._renderRegionRaster(viewer, region.bounds, {
                        targetPixels: MASK_TARGET_PIXELS,
                        magnification: options?.magnification,
                        layers: "background",
                        label: t("pathology.captureReview", { label }),
                    });
                    const { mask } = await this._runTissueMask(viewer, options?.driver, raster);
                    const total = mask.width * mask.height;
                    results.push({
                        index: region.index,
                        label,
                        bounds: region.bounds,
                        viewCoverage: total ? countFilled(mask.binaryMask) / total : 0,
                        isComplete: raster.isComplete,
                    });
                }
            } catch (e: any) {
                results.push({ index: region.index, label, bounds: region.bounds, error: e?.message || String(e) });
            }
        }
        // Read back in slide order: the review picked the biggest regions, but a reader
        // (and the links they follow) wants them in the order they sit on the glass.
        return ownRegions ? results.sort((a, b) => a.index - b.index) : results;
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
        const run = this._resolveOverviewRun(viewer, options);
        // Everything the walk was told about the slide is now established for the slide, not
        // just for this run: later drills reuse it instead of asking the user a second time.
        this.setSlideContext(viewer, run.opts.context);

        if (run.opts.reuse) {
            const cached = this.getOverview(viewer);
            if (cached) return cached;
        }
        return this._walkOverview(viewer, run, options);
    }

    /**
     * Cost a walk without running one: survey the tissue, settle the questions, rank the
     * regions — and stop there.
     *
     * A scan is minutes of vision calls, and the caller has, until now, had no way to see
     * what it was about to spend them on. Everything this does is the cheap half of
     * `buildOverview` (one survey render, already cached per slide/scope/budget) plus
     * arithmetic, so the plan costs roughly nothing and is worth reading before committing.
     *
     * `overlapPairs` is reported rather than silently resolved: region merging (see
     * {@link REGION_MERGE_IOU}) has already collapsed the boxes that ARE the same box, so what
     * survives is genuine partial overlap — a judgement call about whether two boxes are one
     * piece of tissue, which the caller is better placed to make than a threshold.
     */
    async planOverview(viewer: any, options?: BuildOverviewOptions): Promise<OverviewPlanResult> {
        if (!viewer) throw new Error("planOverview() requires a viewer.");
        const run = this._resolveOverviewRun(viewer, options);
        this.setSlideContext(viewer, run.opts.context);

        const exploration = await this.exploreSlide(viewer, {
            driver: run.opts.driver,
            ...(options?.scope !== undefined ? { scope: options.scope } : {}),
            ...(run.surveyMpp != null ? { surveyMpp: run.surveyMpp } : {}),
            ...(options?.surveyPixels != null ? { surveyPixels: options.surveyPixels } : {}),
        });

        // Which islands are walked is a size decision; the order they are LISTED in is the
        // reviewer's, so the plan reads down the slide rather than down a size ranking.
        const roots = this._byTissueFirst(exploration.regions).slice(0, run.opts.maxRoots);
        const survey = this._surveyCovering(viewer, run.scope.bounds);
        const regions = roots
            .slice()
            .sort((a, b) => a.index - b.index)
            .map(region => ({
                label: region.label,
                bounds: region.bounds,
                areaFraction: region.areaFraction,
                fill: survey?.sampler ? survey.sampler.fill(region.bounds) : null,
                cellularity: survey?.density ? survey.density.sample(region.bounds) : null,
            }));

        // What the survey pass alone will cost. Depth is best-first and adaptive, so a
        // per-region depth estimate would be a fiction; the honest figures are "one call per
        // root to cover the tissue" and "this many in total to spend after that".
        const estimatedSurveyCalls = Math.min(regions.length, run.opts.maxAnalyzeCalls);
        const plan: OverviewPlan = {
            planId: this._nextPlanId(),
            slideKey: this._slideKey(viewer) || "",
            run,
            exploration,
            options,
            builtAtIso: new Date().toISOString(),
        };
        if (plan.slideKey) {
            rememberBounded(
                this._overviewPlans, `${plan.slideKey}|plan|${plan.planId}`,
                plan.slideKey, plan, MAX_PLANS_PER_SLIDE
            );
        }

        return {
            planId: plan.planId,
            coverageScope: exploration.coverageScope,
            scopeBounds: exploration.scopeBounds,
            checklist: run.checklist,
            ladder: { magnifications: run.ladder.magnifications, targetMpp: run.ladder.targetMpp },
            regions,
            overlapPairs: overlapPairs(regions),
            estimatedSurveyCalls,
            maxAnalyzeCalls: run.opts.maxAnalyzeCalls,
            slideCoverage: exploration.slideCoverage,
            surveyComplete: exploration.isComplete,
            regionsOmitted: Math.max(0, exploration.regions.length - roots.length),
            builtAtIso: plan.builtAtIso,
        };
    }

    /**
     * Execute a plan from {@link planOverview}, minus whatever the caller struck off it.
     *
     * The plan's own survey runs — not a fresh one. Re-surveying would pay for the render
     * again and, worse, could return a different region list, so the boxes the caller
     * approved would not be the boxes examined.
     */
    async runPlan(viewer: any, planId: string, edits?: OverviewPlanEdits): Promise<OverviewResult | OverviewPlanExpired> {
        if (!viewer) throw new Error("runPlan() requires a viewer.");
        if (!this._hasFeature("analyze", edits?.driver)) {
            throw new Error("runPlan needs an 'analyze' driver (e.g. a configured vision model).");
        }
        const slideKey = this._slideKey(viewer);
        const plan = slideKey ? this._overviewPlans.get(`${slideKey}|plan|${planId}`) : undefined;
        // Degrade closed: silently re-planning would charge the user for a survey they
        // believe they already paid for, against a region list they never saw.
        if (!plan) return { status: "plan-expired", planId };

        const keep = applyPlanEdits(plan.exploration.regions, edits);
        if (!keep.length) return { status: "plan-expired", planId, reason: "no-regions" };

        const run: ResolvedOverviewRun = edits?.addCalls
            ? {
                ...plan.run,
                opts: {
                    ...plan.run.opts,
                    maxAnalyzeCalls: clampNumber(
                        plan.run.opts.maxAnalyzeCalls + edits.addCalls, plan.run.opts.maxAnalyzeCalls, 1, 512),
                },
            }
            : plan.run;
        this.setSlideContext(viewer, run.opts.context);
        return this._walkOverview(viewer, run, plan.options, { ...plan.exploration, regions: keep });
    }

    /** Monotonic within a session; a plan is only ever looked up beside its slide key. */
    private _nextPlanId(): string {
        return `p${++this._planCounter}`;
    }

    /**
     * Settle everything a walk obeys, without starting one.
     *
     * Shared by {@link buildOverview} and {@link planOverview} so a plan cannot be drawn up
     * under different rules than the run that executes it — the knobs interlock (the scope
     * decides the coarse rung, the checklist decides the ladder, the ladder's finest rung
     * decides how much tissue is worth a call), and two copies of that dependency order
     * would drift apart one default at a time.
     */
    private _resolveOverviewRun(viewer: any, options?: BuildOverviewOptions): ResolvedOverviewRun {
        // Resolved first, in dependency order: the scope decides the coarse rung and the
        // rectangle every framed region is clipped to; the checklist decides the ladder; and
        // the ladder's finest rung decides how much tissue is worth a call. None of the knobs
        // below can be settled before those three.
        const scope = this._resolveScope(viewer, options?.scope);
        // Sanitized even when it came from a caller: a script is untrusted input, and this
        // text ends up inside a vision model's prompt (AGENTS.md §0.2/§7).
        const checklist = this._resolveChecklist(options);
        const surveyMpp = this._resolveSurveyMpp(viewer, scope.bounds, scope.coverageScope, options);
        const ladder = this._resolveLadder(viewer, checklist, options?.magnificationLadder, surveyMpp);
        const fieldPixels = Math.round(
            clampNumber(options?.fieldPixels, FIELD_MAX_PIXELS, 1024, REGION_RENDER_MAX_PIXELS));

        const opts: ResolvedOverviewOptions = {
            query: options?.query,
            driver: options?.driver,
            scopeBounds: scope.bounds,
            context: this._normalizeContext(options?.context),
            repairVerdict: options?.repairVerdict ?? true,
            measureFill: options?.measureFill ?? true,
            progress: options?.progress ?? true,
            // One ladder rung costs one depth level: a node reads its box at the rung it can
            // afford and `_tileChildren` reads the SAME box at the next rung as its children.
            // A flat 2 therefore capped every run two rungs above the finest resolution the
            // ladder declares — the walk stopped at ~1 µm/px reporting that it could not see
            // cell detail, which was true and entirely self-inflicted. The depth a run needs
            // is a property of its ladder, so read it from there.
            maxDepth: options?.maxDepth ?? Math.max(2, ladder.targetMpp.length),
            breadth: options?.breadth ?? 4,
            interestThreshold: options?.interestThreshold ?? 0.5,
            minDrillTissue: clampNumber(
                options?.minDrillTissue, this._defaultMinDrillTissue(viewer, ladder, fieldPixels), 0, Infinity),
            // Raised with concurrency: four calls in flight means the same wall-clock buys
            // more of them, and the survey account needs room to cover the slide before
            // any of it is spent drilling.
            maxAnalyzeCalls: options?.maxAnalyzeCalls ?? 28,
            maxNodes: options?.maxNodes ?? 36,
            // Deployment escape hatch, not a session knob — a traversal strategy is not
            // something an imported session bundle should be able to change (§7).
            scheduler: options?.scheduler
                ?? (this.getStaticMeta("scheduler", "best-first") as "best-first" | "dfs"),
            surveyFraction: options?.surveyFraction ?? 0.35,
            concurrency: Math.max(1, options?.concurrency ?? 4),
            subdivide: options?.subdivide ?? "tissue",
            annotate: options?.annotate ?? false,
            synthesize: options?.synthesize ?? true,
            reuse: options?.reuse ?? false,
            // Resolved once, and clamped: every one of these arrives through a script the
            // chat model wrote, and a NaN breadth or a gigapixel field budget must degrade to
            // a default rather than propagate into a render request (§0.2/§7).
            maxRoots: Math.round(clampNumber(options?.maxRoots, SURVEY_MAX_ROOTS, 1, 64)),
            framePadding: clampNumber(options?.framePadding, OVERVIEW_FRAME_PADDING, 0, 0.5),
            fieldPixels,
            checklist,
        };
        return { scope, checklist, surveyMpp, ladder, opts };
    }

    /**
     * Run the walk itself, from a resolved run and an optional survey that is already in hand.
     *
     * `precomputed` is what {@link runPlan} passes: the plan already paid for the survey, and
     * re-running it would both cost a render and re-derive the region list the user has since
     * edited. Everything else — budget accounts, the cancellable progress dialog, the
     * incremental publish, the continuation bookkeeping — is identical either way, which is
     * exactly why it lives here once.
     */
    private async _walkOverview(
        viewer: any,
        run: ResolvedOverviewRun,
        options?: BuildOverviewOptions,
        precomputed?: SlideExploration
    ): Promise<OverviewResult> {
        const { scope, surveyMpp, ladder, opts } = run;
        const budget = createBudget(opts.maxAnalyzeCalls, opts.surveyFraction);

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
        const publish = (): OverviewResult => this._publishOverview({
            viewer, opts, ladder, budget, rootNodes,
            exploration, fallbackScope: scope, cancelled: control.signal.aborted,
        });
        const expandedPerRoot = new Map<string, number>();

        try {
            exploration = precomputed ?? await this.exploreSlide(viewer, {
                driver: opts.driver,
                ...(options?.scope !== undefined ? { scope: options.scope } : {}),
                ...(surveyMpp != null ? { surveyMpp } : {}),
                ...(options?.surveyPixels != null ? { surveyPixels: options.surveyPixels } : {}),
            });
            const slideArea = Math.max(1, exploration.slide.width * exploration.slide.height);

            // Refuse to walk a survey that is not a reading of the slide. A vision budget spent
            // on islands that are an artefact of which tiles were resident buys findings about a
            // fragment, presented as a slide-wide examination — and the tree would then be cached
            // under this slide's key. Degrade closed (AGENTS.md §7): publish the (empty) result,
            // which carries `status: "incomplete"` and the warning that says what to do about it.
            if (!exploration.isComplete || this._surveyImplausible(exploration)) {
                return publish();
            }

            if (opts.scheduler === "best-first") {
                await this._walkBestFirst(
                    viewer, exploration, opts, ladder, budget, slideArea, control.signal, dialog,
                    rootNodes, publish, expandedPerRoot
                );
                // Everything a continuation needs, kept beside the tree. A budget is a
                // checkpoint, not a verdict — see `refineOverview`.
                this._rememberRun(viewer, {
                    opts, ladder, expandedPerRoot, exploration, spent: budget, refinements: 0,
                });
                return publish();
            }

            // Legacy depth-first traversal, kept for one release behind the `scheduler`
            // static-meta knob so a deployment that hits a problem with the new one can
            // revert without a rollback.
            const roots = this._byTissueFirst(exploration.regions).slice(0, opts.breadth);
            for (const region of roots) {
                // Cancellation is checked between nodes: a node in flight is parked on a
                // model call we cannot recall, so we stop at the next boundary instead of
                // pretending we aborted mid-request.
                if (control.signal.aborted) break;
                if (this._budgetExhausted(budget, opts)) { budget.truncated = true; break; }
                const node = await this._exploreOverviewNode(
                    viewer, region, 0, [region.index], opts, ladder, budget, slideArea, null, control.signal, dialog
                );
                if (node) rootNodes.push(node);
                publish();
            }
            // A depth-first tree is still a tree, and stopping short is still stopping short — so
            // it must be continuable too. The continuation runs the best-first frontier over it,
            // which is the only traversal that can resume at all.
            this._rememberRun(viewer, {
                opts, ladder, expandedPerRoot, exploration, spent: budget, refinements: 0,
            });
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
     * Assemble and cache the result for a tree as it currently stands.
     *
     * Shared by the first walk and by every refinement, because a continued run must publish
     * through exactly the same code — the ranking, the evidence table and the caveats are derived
     * from the tree, and a second implementation of that derivation would be a second set of
     * answers to the same question.
     */
    private _publishOverview(args: {
        viewer: any;
        opts: ResolvedOverviewOptions;
        ladder: OverviewLadder;
        budget: OverviewBudget;
        rootNodes: OverviewNode[];
        exploration: SlideExploration | null;
        /** Used only when there is no exploration to read the real scope from. */
        fallbackScope: { bounds: Bounds; coverageScope: CoverageScope };
        cancelled: boolean;
    }): OverviewResult {
        const { viewer, opts, ladder, budget, rootNodes, exploration, fallbackScope, cancelled } = args;
        // Rank BEFORE building the table: `buildEvidence` cites regions best-first and
        // reads `rankScore`, which the ranking pass assigns. Reversing the two silently
        // orders every citation list by nothing.
        const ranked = this._rankOverviewNodes(rootNodes);
        const flat = flattenNodes(rootNodes);
        const nativeMpp = this._micronsPerPixel(viewer);
        const evidence = buildEvidence(flat, opts.checklist, nativeMpp);
        // Recomputed on every publish so an incremental snapshot reports the same
        // shortfall the final one does. Both are the difference between "the walk finished"
        // and "the walk stopped", which `truncated` alone cannot express: a run that never
        // found anything it would expand ends with its budget intact and looks complete.
        budget.focusUnspent = Math.max(0, budget.focusBudget - budget.focusCalls);
        budget.plannedNotRead = flat.reduce((n, node) => n + (node.pendingTiles?.length ?? 0), 0);
        const coverageScope = exploration?.coverageScope ?? fallbackScope.coverageScope;
        // The two completeness questions, kept apart. "Did the pixels all arrive?" is the
        // survey's; "was the tissue examined?" is the run's, and it is the one a reader means.
        // A row that is `underResolved` is a question this walk never got close enough to
        // answer, so the examination is not finished no matter how the render went.
        //
        // A row that is `beyondSlide` is NOT one of those, and used to be. Its requirement is
        // finer than the scan itself, so no walk of this slide can ever clear it — counting it
        // here made `examined` permanently false, which led every result with "NOT AN
        // EXAMINATION: no region was read at a resolution that can answer these questions"
        // directly above rows reporting findings. A caveat that fires on every run of a slide,
        // contradicting its own body, is one a reader learns to skip.
        const surveyComplete = exploration?.isComplete ?? false;
        const examined = evidence.length > 0 && evidence.every(row => !row.underResolved);
        // `status` answers a coarser question than `isComplete`: is there anything here to
        // report AT ALL? A run that settled five questions of six is an examination with a gap
        // — `isComplete: false`, the per-row `underResolved` flags and the warnings all say so,
        // and suppressing the five would be its own kind of dishonesty. A run that settled NONE
        // is the failure this discriminator exists for.
        const anythingRead = evidence.some(row => !row.underResolved);
        // KEY ORDER IS LOAD-BEARING. A consumer that truncates this object keeps a
        // PREFIX of it — the chat SDK caps a script result at a few thousand characters
        // of pretty-printed JSON — and `root` is by far the largest field. With the
        // tree first, the cut landed inside its second node and `evidence`/`ranked`
        // never reached the model at all: it could see only the coarse island boxes it
        // is told never to link, so it described regions without linking them.
        //
        // Everything small and decision-bearing therefore comes FIRST, and the tree
        // last. `JSON.stringify` preserves insertion order, so this holds whatever
        // limit a consumer applies.
        const result: OverviewResult = {
            status: anythingRead && surveyComplete ? "ok" : "incomplete",
            driver: this.describeDriverForFeature("analyze", opts.driver).id,
            query: opts.query,
            context: opts.context,
            slide: exploration?.slide ?? { width: 0, height: 0, micronsPerPixel: null, magnification: null },
            slideCoverage: exploration?.slideCoverage ?? 0,
            // What was ACTUALLY surveyed. This used to be the literal "whole-slide", which
            // was already wrong for the no-dimensions fallback and would be a false claim
            // of slide-wide coverage for every scoped run.
            coverageScope,
            scopeBounds: exploration?.scopeBounds ?? fallbackScope.bounds,
            isComplete: examined,
            surveyComplete,
            checklist: opts.checklist,
            evidence,
            ranked,
            summary: opts.synthesize
                ? this._composeSummary(evidence, examined)
                : undefined,
            cancelled,
            warnings: this._overviewWarnings(
                rootNodes, opts, budget, cancelled, ladder, evidence, coverageScope,
                { complete: surveyComplete, implausible: this._surveyImplausible(exploration) },
                nativeMpp),
            builtAtIso: new Date().toISOString(),
            budget,
            // The walk surveys the biggest islands first; a reader wants them in the order
            // they sit on the slide, which is the order their numbers count in. A shallow
            // copy — publish runs repeatedly while the walk is still pushing into these.
            root: rootNodes.slice().sort((a, b) => a.index - b.index),
        };
        // An empty refusal is not an overview of this slide. Storing one would answer the next
        // `getOverview` with it and make a transient loading state look like a cached finding.
        if (rootNodes.length) this._storeOverview(viewer, result);
        return result;
    }

    /**
     * Does this survey look like a failed read rather than a sparse slide?
     *
     * The signature of a partial off-screen pass is a trace of tissue in ONE island: the render
     * showed the tiles that happened to be resident, the mask found tissue exactly there, and
     * the result claims that fragment is the slide. A genuinely sparse whole slide is possible,
     * so this never asserts — it only makes the run say so out loud, and stops `buildOverview`
     * from spending a vision budget walking a phantom.
     *
     * Whole-slide scopes only: a caller who framed a rectangle of mostly glass asked for exactly
     * that number and must get it back unqualified.
     */
    private _surveyImplausible(exploration: SlideExploration | null): boolean {
        if (!exploration || exploration.coverageScope !== "whole-slide") return false;
        // Tissue was found but nothing was outlined. That is not a sparse slide, it is a survey
        // that produced no reading at all — most often the whole-rectangle contour being dropped
        // as degenerate, which leaves an empty region list behind a perfectly healthy-looking
        // coverage figure. Coverage alone cannot catch it, because coverage is exactly the number
        // that looks fine.
        if (!exploration.regions.length && exploration.slideCoverage > 0) return true;
        return exploration.slideCoverage < SURVEY_IMPLAUSIBLE_COVERAGE && exploration.regions.length <= 1;
    }

    /**
     * The evidence table as one readable block — led by what the run could NOT do.
     *
     * A per-row table of "not assessable" is a true statement that reads, to anything
     * summarizing it, like a set of negative findings. The header states the one thing that
     * governs how every row beneath it may be used, in the same field, so a reader that quotes
     * only `summary` still quotes the limitation.
     */
    private _composeSummary(evidence: EvidenceRow[], examined: boolean): string {
        const rows = renderEvidence(evidence, row => t("pathology.evidenceRow", {
            label: row.label,
            verdict: verdictWord(row.verdict),
            regions: row.citedBy.map(c => c.label).join(", ") || t("pathology.evidenceNoRegions"),
        })) || t("pathology.evidenceEmpty");
        return examined ? rows : `${t("pathology.summaryNotExamined")}\n${rows}`;
    }

    /** Keep (or update) the state a continuation of this slide's walk will need. */
    private _rememberRun(viewer: any, state: OverviewRunState): void {
        const key = this._slideKey(viewer);
        if (key) this._overviewRuns.set(key, state);
    }

    /**
     * Continue the cached walk instead of starting a new one.
     *
     * The budget is a checkpoint, not a verdict. A 28-call run that stops with a frontier still
     * queued has described real tissue and left a plan for the rest; the only way to act on
     * "keep going" used to be `buildOverview` again, which re-surveys the slide and pays a second
     * time for every node already described. This resumes: Phase A is skipped, the frontier is
     * rebuilt from the tree, and a fresh budget is spent entirely on depth.
     *
     * `region` concentrates the continuation on one part of the tree; `maxDepth` lifts the depth
     * cap; `query` re-derives what the run is looking for, which re-scores the whole frontier
     * because the checklist is what `shouldExpand` and `priority` read.
     */
    async refineOverview(viewer: any, options?: {
        /** Vision calls to spend, all of them on depth. Defaults to the original budget. */
        addCalls?: number;
        /** Concentrate on the part of the tree covering this box. */
        region?: Bounds;
        /** Allow the walk another rung deeper than it was originally permitted. */
        maxDepth?: number;
        /** Re-focus the run: derives a new checklist and re-ranks the frontier against it. */
        query?: string;
        features?: ChecklistFeature[];
        checklist?: Checklist;
        progress?: boolean;
        signal?: AbortSignal;
        driver?: string;
    }): Promise<OverviewResult> {
        if (!viewer) throw new Error("refineOverview() requires a viewer.");
        const key = this._slideKey(viewer);
        const run = key ? this._overviewRuns.get(key) : null;
        const cached = this.getOverview(viewer);
        if (!run || !cached) {
            // Deliberately not "start one instead": a walk is minutes of the user's time, and
            // silently promoting a continuation into a fresh run is not a decision to make for
            // them.
            throw new Error(
                "There is no overview to refine on this slide. Run buildOverview({ query, scope }) first."
            );
        }

        const addCalls = Math.round(clampNumber(options?.addCalls, run.opts.maxAnalyzeCalls, 1, 500));
        const checklist = (options?.query || options?.features || options?.checklist)
            ? this._resolveChecklist(options)
            : run.opts.checklist;
        const opts: ResolvedOverviewOptions = {
            ...run.opts,
            ...(options?.driver ? { driver: options.driver } : {}),
            ...(options?.query ? { query: options.query } : {}),
            checklist,
            maxDepth: Math.round(clampNumber(options?.maxDepth, run.opts.maxDepth, 1, 8)),
            progress: options?.progress ?? run.opts.progress,
            // The caps are per-run, and this run is the continuation: budget it in addition to
            // what was already spent rather than against a total that is already used up.
            maxAnalyzeCalls: addCalls,
            maxNodes: run.spent.nodesVisited + addCalls,
        };

        // All of it on depth: the survey is cached, the roots are described, and there is no
        // coverage pass to reserve for. `rolloverSurveyBudget` already means exactly that.
        const budget = createBudget(addCalls, 0);
        rolloverSurveyBudget(budget);

        const control = new AbortController();
        const onExternalAbort = () => control.abort();
        options?.signal?.addEventListener("abort", onExternalAbort);
        if (options?.signal?.aborted) control.abort();
        const dialog = this._openOverviewProgress(viewer, opts, control);

        const rootNodes = cached.root;
        const all = flattenNodes(rootNodes);
        const slideArea = Math.max(1, run.exploration.slide.width * run.exploration.slide.height);
        // Cumulative from the first call, so the published figures answer "what did this
        // examination cost?" rather than "what did the last increment cost?".
        const publish = (): OverviewResult => this._publishOverview({
            viewer, opts, ladder: run.ladder,
            budget: accumulateBudget(run.spent, budget),
            rootNodes, exploration: run.exploration,
            fallbackScope: { bounds: opts.scopeBounds, coverageScope: cached.coverageScope },
            cancelled: control.signal.aborted,
        });

        try {
            const queue = this._frontierQueue(opts, all, run.expandedPerRoot);
            // Everything the tree still holds that could be looked at again. `_expandFrontier`
            // re-checks each one against the (possibly new) checklist and depth cap, so this is
            // deliberately permissive — the queue is a candidate set, not a decision.
            const frontier = all.filter(node =>
                node.isComplete && !node.error
                && (!options?.region || !!intersectBounds(node.bounds, options.region)));
            if (!frontier.length) {
                throw new Error(options?.region
                    ? "No part of the cached overview covers that region. "
                        + "Run buildOverview({ scope: region }) to examine it — it needs its own survey."
                    : "The cached overview has nothing left to examine.");
            }
            queue.pushAll(frontier);

            await this._expandFrontier(
                viewer, queue, all, run.expandedPerRoot, opts, run.ladder, budget, slideArea,
                control.signal, dialog, throttled(publish, PUBLISH_THROTTLE_MS)
            );

            this._rememberRun(viewer, {
                ...run, opts, spent: accumulateBudget(run.spent, budget), refinements: run.refinements + 1,
            });
            return publish();
        } finally {
            options?.signal?.removeEventListener("abort", onExternalAbort);
            if (control.signal.aborted) dialog?.close?.();
            else dialog?.done?.();
        }
    }

    /**
     * Survey the whole slide, then spend what is left on the globally most promising
     * regions — the traversal that replaces depth-first recursion.
     *
     * **Phase A** reads every tissue-bearing cell once, at the coarsest rung, out of the
     * reserved survey account. This is the coverage floor: the run cannot reach the end
     * with a part of the slide never looked at, because looking is paid for first and
     * focus expansion cannot borrow against it.
     *
     * **Phase B** takes the best node off one global queue, expands it, puts the children
     * back in the same queue, and repeats. Because every node competes with every other
     * node — not just with its siblings — the budget goes where the run as a whole most
     * needs it, and a strong first region can no longer consume everything before the
     * second is ever seen.
     */
    private async _walkBestFirst(
        viewer: any,
        exploration: SlideExploration,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder,
        budget: OverviewBudget,
        slideArea: number,
        signal: AbortSignal,
        dialog: any,
        rootNodes: OverviewNode[],
        publish: () => OverviewResult,
        expandedPerRoot: Map<string, number>
    ): Promise<void> {
        const all: OverviewNode[] = [];
        const queue = this._frontierQueue(opts, all, expandedPerRoot);
        const publishThrottled = throttled(publish, PUBLISH_THROTTLE_MS);

        // ---- Phase A: cover the tissue ----------------------------------------
        // `maxRoots` alone: how many islands the survey opens is a different question from how
        // many children one expansion reads (`breadth`), and maxing the two let a raised
        // `breadth` silently widen the survey, which no caller ever means by it.
        // Most tissue first: `exploration.regions` is in slide reading order (that is what a
        // region NUMBER means), so a bare prefix would cut the survey by slide layout.
        const roots = this._byTissueFirst(exploration.regions).slice(0, opts.maxRoots);
        dialog?.setLabel?.(t("pathology.overviewProgressSurvey", { done: 0, total: roots.length }));

        let surveyed = 0;
        for await (const node of this._analyzeFields(
            viewer, roots.map((region, i) => ({ region, path: [region.index], depth: 0, parent: null, rootId: `r${i}` })),
            opts, ladder, budget, slideArea, signal, "survey"
        )) {
            rootNodes.push(node);
            all.push(node);
            queue.push(node);
            dialog?.setLabel?.(t("pathology.overviewProgressSurvey", { done: ++surveyed, total: roots.length }));
            dialog?.tick?.(budget.nodesVisited);
            publishThrottled();
        }
        // A root the survey never reached is tissue nobody looked at; say so rather than
        // letting the reader assume the whole slide was covered.
        budget.surveyIncomplete = surveyed < roots.length
            || exploration.regions.length > roots.length;

        // Whatever coverage did not cost now belongs to depth.
        rolloverSurveyBudget(budget);
        publishThrottled(true);

        // ---- Phase B: spend the rest on what matters most ----------------------
        await this._expandFrontier(
            viewer, queue, all, expandedPerRoot, opts, ladder, budget, slideArea, signal, dialog, publishThrottled
        );
    }

    /**
     * The priority queue the frontier lives in, scored against a context that keeps moving.
     *
     * `maxArea` and the per-root expansion counts both change as the walk proceeds, so the score
     * is read through a closure rather than captured: a score frozen at insertion would order the
     * queue by a world that no longer exists. Shared by the first walk and every refinement of it,
     * so a resumed run ranks by exactly the same function the original did.
     */
    private _frontierQueue(
        opts: ResolvedOverviewOptions,
        all: OverviewNode[],
        expandedPerRoot: Map<string, number>
    ): PriorityQueue<OverviewNode> {
        const ctx = () => ({
            checklist: opts.checklist,
            maxArea: Math.max(...all.map(n => n.slideAreaFraction || 0), Number.EPSILON),
            expandedPerRoot,
        });
        return new PriorityQueue<OverviewNode>(node => priority(this._schedulable(node), ctx()));
    }

    /**
     * Spend a focus budget on the frontier: pop the globally best node, expand it, queue the
     * children, repeat.
     *
     * Lifted out of {@link _walkBestFirst} so that {@link refineOverview} continues a stopped walk
     * through the SAME traversal rather than a second implementation of it. A budget is a
     * checkpoint, not a verdict — a run that stops here must be resumable, and it only is if
     * resuming is this function called again with a fresh budget and the same queue rebuilt.
     */
    private async _expandFrontier(
        viewer: any,
        queue: PriorityQueue<OverviewNode>,
        all: OverviewNode[],
        expandedPerRoot: Map<string, number>,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder,
        budget: OverviewBudget,
        slideArea: number,
        signal: AbortSignal,
        dialog: any,
        publishThrottled: (force?: boolean) => void
    ): Promise<void> {
        while (!signal.aborted && canSpend(budget, "focus") && budget.nodesVisited < opts.maxNodes) {
            const node = queue.pop();
            if (!node) break;
            if (node.depth >= opts.maxDepth) continue;
            if (!node.isComplete) continue; // a partial render cannot be drilled honestly
            if (!shouldExpand(this._schedulable(node, ladder), opts.checklist, opts)) continue;
            // Already expanded for THIS question, with nothing left over: re-deriving children
            // would produce the identical boxes at the identical rung and append a second copy
            // of them. A different checklist is a different question and does re-open the node.
            const exhausted = !node.pendingTiles?.length
                && node.children.length > 0
                && node.expandedUnder === opts.checklist.hash;
            if (exhausted) continue;

            // Fields left over from a previous expansion of this node come first: the planning
            // decision was made when it last won the queue, and only the reading is left.
            const children = node.pendingTiles?.length
                ? node.pendingTiles
                : await this._childrenOf(viewer, node, opts, ladder);
            if (!children.length) { node.decision = "stop"; node.pendingTiles = undefined; continue; }

            // Drop children whose tissue has already been read this closely. Tissue geometry
            // overlaps — a lattice re-covers ground a sibling's box already held — and without
            // this the same cells are rendered, sent to a vision model and reported twice.
            // Measured against the reads themselves, so it costs nothing and cannot suppress a
            // genuine drill: only nodes at the child's rung or finer count.
            const childRung = this._rungOf(node.depth + 1, ladder);
            const readSoFar = all
                .filter(n => n.isComplete !== false && n.bounds)
                .map(n => ({ bounds: n.bounds, rung: this._rungOf(n.depth, ladder) }));
            const fresh = children.filter(region => {
                if (!isRedundantRead({ bounds: region.bounds, rung: childRung }, readSoFar, coveredFraction)) return true;
                budget.skippedRedundant++;
                return false;
            });
            if (!fresh.length) { node.decision = "stop"; node.pendingTiles = undefined; continue; }

            // One expansion reads at most `breadth` of them. The remainder stays ON the node,
            // which goes back on the queue — so a region that tiles into fifteen fields is not
            // silently four, and `noveltyWeight` still makes it earn each further slot against
            // fresher regions instead of draining the budget in one pass.
            const batch = fresh.slice(0, opts.breadth);
            const rest = fresh.slice(opts.breadth);
            node.pendingTiles = rest.length ? rest : undefined;

            const rootId = this._rootIdOf(node, all);
            expandedPerRoot.set(rootId, (expandedPerRoot.get(rootId) ?? 0) + 1);
            node.decision = checklistGaps(this._schedulable(node), opts.checklist).length ? "resolve" : "drill";
            node.expandedUnder = opts.checklist.hash;

            dialog?.setLabel?.(t("pathology.overviewProgressFocus", { label: node.label }));
            for await (const child of this._analyzeFields(
                viewer,
                batch.map(region => ({
                    region, path: [...(node.path || []), region.index],
                    depth: node.depth + 1, parent: node, rootId,
                })),
                opts, ladder, budget, slideArea, signal, "focus"
            )) {
                node.children.push(child);
                all.push(child);
                queue.push(child);
                dialog?.tick?.(budget.nodesVisited);
                publishThrottled();
            }
            if (node.pendingTiles?.length) queue.push(node);
        }

        // Why the loop ended, which is not the same question as how much it spent.
        //
        // Every `continue` above drops its node WITHOUT re-queueing it, so the frontier strictly
        // drains: an empty queue with budget still in hand means the walk ran out of tissue worth
        // reading, not out of calls. That is the good outcome and the common one — the caps are
        // ceilings — but until it was said out loud a run that spent 12 of 28 calls was
        // indistinguishable from one that stalled, and got reported as partial.
        budget.converged = !signal.aborted
            && queue.size === 0
            && canSpend(budget, "focus")
            && budget.nodesVisited < opts.maxNodes;

        // A node still worth expanding when the budget ran out is a leaf, not a dead end — and
        // so is one holding fields that were planned and never read. Both mean the same thing to
        // a caller: this tree can be CONTINUED, and `refineOverview` is how.
        for (const node of queue.peekAll()) {
            if (node.pendingTiles?.length) { budget.truncated = true; continue; }
            if (node.decision === "leaf" && shouldExpand(this._schedulable(node, ladder), opts.checklist, opts)) {
                budget.truncated = true;
            }
        }
        publishThrottled(true);
    }

    /**
     * Render and analyze a batch of regions concurrently, yielding nodes as they finish.
     *
     * The renders serialize inside the core regardless; what this buys is the vision calls
     * overlapping each other and the next render, which is where a run's wall-clock
     * actually goes. Budget is charged as each call is admitted, so a batch cannot
     * collectively overshoot the account it is drawing on.
     */
    private async *_analyzeFields(
        viewer: any,
        items: Array<{ region: SlideRegion; path: number[]; depth: number; parent: OverviewNode | null; rootId: string }>,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder,
        budget: OverviewBudget,
        slideArea: number,
        signal: AbortSignal,
        account: "survey" | "focus"
    ): AsyncGenerator<OverviewNode> {
        // Admit only what the account can pay for; the rest is truncation, and is reported.
        const affordable = items.filter(() => {
            if (!canSpend(budget, account)) { budget.truncated = true; return false; }
            spend(budget, account);
            return true;
        });
        if (!affordable.length) return;

        for await (const node of runFieldPipeline<typeof affordable[0], null, OverviewNode>(affordable, {
            // The node helper renders internally, so there is no separate stage to
            // overlap here: the semaphore admits N nodes, each of which renders and then
            // analyzes. Renders still serialize in the core, so the effect is the same
            // overlap — and resident pixels are bounded by the semaphore rather than by
            // the render window, at one raster per admitted node.
            render: async () => null,
            renderWindow: Math.max(1, opts.concurrency),
            analyze: async (item) => {
                budget.nodesVisited++;
                return this._exploreOverviewNode(
                    viewer, item.region, item.depth, item.path, opts, ladder,
                    budget, slideArea, item.parent, signal, null, { rootId: item.rootId, charged: true }
                ) as Promise<OverviewNode>;
            },
            onError: (item, error) => this._failedNode(item.region, item.path, item.depth, slideArea, error),
            visionConcurrency: opts.concurrency,
            signal,
        })) {
            if (node) yield node;
        }
    }

    /**
     * The scheduler's view of a node — structural, so the two types stay independent.
     *
     * `ladder` is what lets the scheduler terminate the "the model said it could not see"
     * route: without the finest rung there is no way to tell "look closer" from "there is
     * nowhere closer to look".
     */
    private _schedulable(node: OverviewNode, ladder?: OverviewLadder): SchedulableNode {
        return {
            id: node.label,
            rootId: node.rootId || node.label,
            rung: node.depth,
            interest: node.interest,
            confidence: node.verdict?.confidence ?? null,
            cellularity: node.cellularity ?? null,
            bboxFillFraction: node.bboxFillFraction,
            tissueArea: node.tissueArea ?? null,
            slideAreaFraction: node.slideAreaFraction,
            deliveredMpp: node.deliveredMpp ?? null,
            answers: node.answers,
            ancestorInterests: node.ancestorInterests || [],
            pendingTiles: node.pendingTiles?.length ?? 0,
            resolvable: node.verdict?.resolvable ?? null,
            finestMpp: this._finestRung(ladder),
            error: node.error,
        };
    }

    /** The finest µm/px a ladder targets, or null when the slide is uncalibrated. */
    private _finestRung(ladder?: OverviewLadder): number | null {
        const targets = (ladder?.targetMpp ?? []).filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
        return targets.length ? Math.min(...targets) : null;
    }

    /**
     * Tissue held by a box, in µm² (level-0 px² when the slide is uncalibrated).
     *
     * Null when fill was never measured — the drill gate then declines to veto rather than
     * treating an absent measurement as an empty box.
     */
    private _tissueAreaOf(viewer: any, bounds: Bounds, fillFraction: number | null): number | null {
        if (fillFraction == null) return null;
        const px = Math.max(0, fillFraction) * bounds.width * bounds.height;
        const mpp = this._micronsPerPixel(viewer);
        return mpp ? px * mpp * mpp : px;
    }

    private _rootIdOf(node: OverviewNode, all: OverviewNode[]): string {
        return node.rootId || all.find(n => n.label === node.label)?.rootId || node.label;
    }

    /** A node that could not be read at all — recorded rather than dropped. */
    private _failedNode(
        region: SlideRegion, path: number[], depth: number, slideArea: number, error: unknown
    ): OverviewNode {
        return {
            index: region.index,
            label: regionLabel(path),
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
            error: (error as any)?.message || String(error),
        };
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

    /**
     * The checklist a walk will obey: the caller's, sanitized, or the generic fallback.
     *
     * The engine never DERIVES one — that needs a chat model and the consent boundary that
     * owns it, which is the scripting adapter's job. Keeping derivation out here is what
     * lets a plugin or a script call `buildOverview` with no chat model present and still
     * get a run with the same schema, the same drill rule and the same evidence table.
     *
     * Sanitizing a caller-supplied checklist is not redundant with sanitizing a derived
     * one: a script is untrusted input too, and this text is on its way into a prompt.
     */
    private _resolveChecklist(options?: BuildOverviewOptions): Checklist {
        const supplied = options?.checklist ?? options?.features;
        if (supplied) {
            const clean = sanitizeChecklist(supplied, {
                source: options?.checklist?.source === "derived" ? "derived" : "explicit",
                query: options?.query,
            });
            if (clean) return clean;
        }
        // A caller that TRIED to derive one tells us why it could not; a caller that never
        // tried leaves this unset, and the reason is inferred from whether there was a
        // question at all. Sanitized like any other caller input — it reaches a locale string.
        const reason = CHECKLIST_FALLBACK_REASONS.has(options?.checklistFallbackReason as any)
            ? options!.checklistFallbackReason
            : (supplied ? "unparseable" : undefined);
        return fallbackChecklist({
            matchLabel: t("pathology.checklistFallbackMatchLabel"),
            match: t("pathology.checklistFallbackMatch", { query: options?.query || "" }),
            extentLabel: t("pathology.checklistFallbackExtentLabel"),
            extent: t("pathology.checklistFallbackExtent"),
            qualityLabel: t("pathology.checklistFallbackQualityLabel"),
            quality: t("pathology.checklistFallbackQuality"),
        }, options?.query, reason);
    }

    /** Caveats the caller must surface; derived locally, no model call. */
    private _overviewWarnings(
        roots: OverviewNode[],
        opts: ResolvedOverviewOptions,
        budget: OverviewBudget,
        cancelled = false,
        ladder?: OverviewLadder,
        evidence?: EvidenceRow[],
        coverageScope: CoverageScope = "whole-slide",
        survey?: { complete: boolean; implausible: boolean },
        /** The slide's own calibration — quoted when a feature asks for finer than it. */
        nativeMpp?: number | null
    ): string[] {
        const warnings: string[] = [];
        // BEFORE everything, including the scope note: if the pixels the survey was derived
        // from never arrived, the island list is not a reading of the slide at all, and every
        // statement below is about whatever tiles happened to be resident.
        if (survey && !survey.complete) warnings.push(t("pathology.warnSurveyPartialRender"));
        else if (survey?.implausible) warnings.push(t("pathology.warnSurveyImplausible"));
        // FIRST, because it reframes every other number in the result. A reader assumes a
        // slide walk covered the slide; a scoped one did not, and saying so afterwards is
        // too late to stop "no tumour found" being read as a whole-slide negative.
        if (coverageScope !== "whole-slide") warnings.push(t("pathology.warnScopedCoverage"));
        // Also near the top, and for the same reason: a run that stopped with budget in hand
        // and questions still open did not examine the tissue, and every number below reads as
        // if it had. This is the shape the old fill veto produced — one call out of
        // twenty-eight, `truncated: false`, everything "not-assessable".
        const stalled = (evidence ?? []).some(r => r.underResolved);
        if (budget.focusUnspent > 0 && stalled) {
            warnings.push(t("pathology.warnNoProgress", { unspent: budget.focusUnspent }));
        }
        if (budget.plannedNotRead > 0) {
            warnings.push(t("pathology.warnPlannedNotRead", { count: budget.plannedNotRead }));
        }
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
        // A generic checklist answers "does this look like what you asked about"; a derived
        // one names the features that decide it. The difference is large enough that the
        // caller must know which one produced the evidence table — AND which side is at
        // fault: a fallback despite a real query means derivation FAILED, and telling the
        // caller to "ask a more specific question" then sends them to fix the wrong thing.
        if (opts.checklist?.source === "fallback") {
            warnings.push(opts.query?.trim()
                ? t("pathology.warnChecklistDerivationFailed", {
                    reason: t(`pathology.checklistFallbackReason.${opts.checklist.fallbackReason || "error"}`),
                })
                : t("pathology.warnChecklistFallback"));
        }
        // Coverage is the claim a reader will assume by default. If part of the tissue was
        // never looked at, that assumption is wrong and has to be corrected explicitly.
        if (budget.surveyIncomplete) warnings.push(t("pathology.warnSurveyIncomplete"));
        // A feature nothing ever got close enough to judge is the one a reader is most
        // likely to misread as a negative. Say it before they do.
        const unassessed = evidence?.filter(r => r.underResolved) ?? [];
        if (unassessed.length) {
            warnings.push(t("pathology.warnFeatureUnassessed", {
                count: unassessed.length,
                features: unassessed.map(r => r.label).join(", "),
            }));
        }
        // Different advice, so a different warning. "Inspect them closer" is the wrong thing
        // to tell a reader when the scan holds nothing closer — what they need to know is that
        // these answers were formed at the slide's limit, below what the question asked for,
        // and that no further reading will improve them.
        const beyond = evidence?.filter(r => r.beyondSlide) ?? [];
        if (beyond.length) {
            warnings.push(t("pathology.warnFeatureBeyondSlide", {
                count: beyond.length,
                features: beyond.map(r => `${r.label} (${r.requiredMpp} µm/px)`).join(", "),
                finest: nativeMpp ? round(nativeMpp, 3) : "?",
            }));
        }
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
                            parentLabel: node.label,
                            parentLevel: levelOf(node.depth),
                            childLabel: child.label,
                            childLevel: levelOf(child.depth),
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
            // The resume state goes with the tree it belongs to: continuing a walk whose tree was
            // dropped would extend nothing, and the focus is part of what "start over" means.
            this._overviewRuns.delete(key);
            this._focusRegions.delete(key);
            // The tissue surveys go too — ALL of them for this slide, at every scope:
            // "rebuild the overview" has to mean re-deriving what the walk stands on, not
            // replaying it against the same cached masks.
            for (const surveyKey of [...this._surveys.keys()]) {
                if (isKeyOfSlide(surveyKey, key)) this._surveys.delete(surveyKey);
            }
        }
    }

    /**
     * The region the work on this slide is currently about, or null.
     *
     * Free and local. A caller that wants to know what an unqualified request would target should
     * read this rather than guess — and a caller that wants the whole slide should say so with
     * `scope: "slide"` rather than by omitting the scope.
     */
    getFocusRegion(viewer: any): { label?: string; bounds: Bounds } | null {
        const key = viewer && this._slideKey(viewer);
        return (key && this._focusRegions.get(key)) || null;
    }

    /**
     * Record (or clear, with null) the region the work on this slide is about.
     *
     * Called automatically by every region-scoped entry point, so it rarely needs calling by
     * hand — the exception is a caller that has established a region by some other means (a user
     * selection, an annotation) and wants later unqualified calls to follow it.
     */
    setFocusRegion(viewer: any, bounds: Bounds | null, label?: string): void {
        const key = viewer && this._slideKey(viewer);
        if (!key) return;
        if (!bounds) { this._focusRegions.delete(key); return; }
        const rect = normalizeScopeRect(bounds, ...this._slideExtent(viewer));
        if (rect) this._focusRegions.set(key, { bounds: rect, ...(label ? { label } : {}) });
    }

    /** Slide width/height as a tuple, for the clamping helpers. */
    private _slideExtent(viewer: any): [number, number] {
        const meta = this._slideMeta(viewer, this._ref(viewer));
        return [meta.width, meta.height];
    }

    /**
     * Dimensions, calibration and native power of the slide open in `viewer`.
     *
     * Public because "what detail does this scan actually hold?" is a question callers OUTSIDE
     * the engine have to answer — the checklist derivation must not ask a model for a resolution
     * the slide cannot produce, and a caller sizing a region needs the same figure. Reading it
     * only as a by-product of a walk means it is unavailable exactly when it is needed: before
     * the walk.
     */
    getSlideMeta(viewer: any): SlideExploration["slide"] {
        return this._slideMeta(viewer, this._ref(viewer));
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
     * The per-depth render targets for a walk — derived from the CHECKLIST when there is a
     * real one; see {@link ladderRungs} for the arithmetic and for why a FALLBACK checklist
     * is explicitly not one.
     *
     * The rungs are the resolutions the question actually needs, coarsest first, preceded
     * by a survey rung for orientation. That is the difference between a ladder and a
     * guess: asking about nuclei produces a rung that resolves nuclei, and asking only
     * about architecture does not spend budget climbing to one.
     *
     * A fixed ladder cannot do this. `[1.0, 0.5, 0.25]` climbed to nuclear resolution for
     * every question, including the ones that were answered two rungs earlier, and stopped
     * there for the ones that needed more. It remains the default for a run that states no
     * requirement, because "no stated requirement" is not the same as "architecture is enough".
     *
     * An explicit `magnificationLadder` from the caller is honoured verbatim — it is a
     * deliberate override, and second-guessing it would make the knob useless. `derived`
     * is false when neither calibration nor an override was available.
     *
     * `surveyMpp` is the resolution of the orientation rung the ladder is prefixed with. It
     * comes from the caller (or from the scope, via `_resolveSurveyMpp`) rather than from a
     * constant, so that the survey render and the rung the walk believes it opened at cannot
     * disagree — a scoped run reads its region at a finer rung and must ladder from there.
     */
    private _resolveLadder(
        viewer: any,
        checklist?: Checklist | null,
        explicit?: Array<number | null>,
        surveyMpp: number = SURVEY_MPP
    ): OverviewLadder {
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
        const rungs = ladderRungs({
            requiredMpp: checklist?.features.map(f => f.requiredMpp),
            source: checklist?.source,
            surveyMpp,
            defaultLadder: OVERVIEW_MPP_LADDER,
            // A rung is a RENDER TARGET, and level 0 is the finest sampling that exists. A
            // checklist may legitimately ask for finer (see `sanitizeChecklist`); the ladder
            // is where that request meets the scan.
            nativeMpp: mpp,
        });
        return { magnifications: rungs.map(magFor), targetMpp: rungs, derived: true };
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
        /** 0-based ancestry ranks of this node, root first — rendered as its 1-based label. */
        path: number[],
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder,
        budget: OverviewBudget,
        slideArea: number,
        parent: OverviewNode | null,
        signal: AbortSignal,
        dialog: any,
        /**
         * Set by the best-first scheduler, which admits and charges each field against a
         * budget account BEFORE dispatching it — so this node must not charge again, and
         * must not re-check a cap the scheduler already enforced.
         */
        scheduled?: { rootId: string; charged: boolean }
    ): Promise<OverviewNode | null> {
        if (signal.aborted) return null;
        if (!scheduled?.charged) {
            if (budget.nodesVisited >= opts.maxNodes) { budget.truncated = true; return null; }
            budget.nodesVisited++;
        }
        const label = regionLabel(path);
        dialog?.setLabel?.(t("pathology.overviewProgressRegion", { label, level: levelOf(depth) }));
        this.raiseEvent("overview-progress", {
            phase: "region-start",
            viewerId: viewer?.uniqueId,
            depth,
            index: region.index,
            label,
            nodesVisited: budget.nodesVisited,
            maxNodes: opts.maxNodes,
            analyzeCalls: budget.analyzeCalls,
            maxAnalyzeCalls: opts.maxAnalyzeCalls,
        });

        const rung = Math.min(depth, ladder.magnifications.length - 1);
        const targetMpp = ladder.targetMpp[rung] ?? null;
        // Render the padded region OFF-SCREEN — the user's viewport is never moved.
        // The padding matches what the prompt quotes (both read `opts.framePadding`), and it
        // is clipped back into the run's scope: padding is context around a region, never a
        // way for a scoped walk to read tissue its survey never covered.
        const paddedBounds = intersectBounds(
            this._padBoundsToSlide(viewer, region.bounds, opts.framePadding), opts.scopeBounds
        ) || region.bounds;

        // Plan the region as FIELDS rather than asking for one image of the whole box.
        // At this rung's resolution a region is usually bigger than a single vision call
        // can carry; the old path resolved that by downsampling until it fitted, which
        // is exactly how the walk came to describe nuclear features from architecture-
        // scale pixels. A box that DOES fit is read at the rung. A box that does not is
        // read whole and coarse — coverage is the right trade for the node's own look,
        // since that read is what ranks it against every other region — and `_tileChildren`
        // is what then reads the same box AT the rung, one depth level down. That is why
        // `maxDepth` must be at least as deep as the ladder is long.
        const { plan, shortOfRung } = this._planNodeFields(viewer, paddedBounds, rung, targetMpp, ladder, opts.fieldPixels);
        const field = plan.fields[0];
        let raster: FieldRaster;
        try {
            if (!field) throw new Error("The region holds no tissue to examine at this resolution.");
            raster = await this._renderField(viewer, field, {
                layers: "background",
                label: t("pathology.captureExamine", { label, level: levelOf(depth) }),
            });
        } catch (e: any) {
            return {
                index: region.index,
                label,
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

        // What the model is actually shown. When the plan tiled the region, this is one
        // tile of it — so it, not the enclosing box, is what the node reports, what the
        // prompt is grounded in, and where a region link points. Reporting the whole box
        // for a read of part of it is how a finding ends up attributed to tissue nobody
        // looked at. Subdivision still works from the full region below.
        const viewBounds = field.bounds;
        const facts = await this._measureNodeView(
            viewer, { ...region, bounds: viewBounds }, slideArea, opts, raster, targetMpp
        );
        // The planner KNOWS whether this rung was met — it is the one that decided to trade
        // resolution for coverage. That is a better answer than re-deriving it from a
        // ratio threshold, which only notices a shortfall once it exceeds a factor of two.
        facts.resolutionShortfall = shortOfRung;

        const node: OverviewNode = {
            index: region.index,
            label,
            depth,
            bounds: viewBounds,
            center: centerOf(viewBounds)!,
            magnification: facts.magnification,
            areaFraction: region.areaFraction,
            slideAreaFraction: facts.slideAreaFraction,
            bboxFillFraction: facts.bboxFillFraction,
            tissueArea: this._tissueAreaOf(viewer, viewBounds, facts.bboxFillFraction),
            cellularity: this._densityFor(viewer, viewBounds)?.sample(viewBounds) ?? null,
            fieldOfViewUm: facts.fieldOfViewUm,
            renderedMpp: raster.deliveredMpp,
            requestedMpp: raster.requestedMpp,
            deliveredMpp: raster.deliveredMpp,
            // Now means what it says: the region could not be delivered at this rung's
            // resolution, so coverage was kept and resolution given up. It is no longer a
            // side effect of a render clamp nobody asked for.
            resolutionShortfall: shortOfRung,
            findings: null,
            interest: null,
            decision: "leaf",
            isComplete: loaded,
            children: [],
            // Scheduler bookkeeping. Carried on the node so the priority queue can weigh
            // it later without re-walking the tree to work out where it came from.
            ...(scheduled ? { rootId: scheduled.rootId } : {}),
            path,
            ancestorInterests: parent
                ? [...(parent.ancestorInterests || []), ...(parent.interest != null ? [parent.interest] : [])]
                : [],
        };

        // The scheduler admits and charges each field before dispatching it, so re-checking
        // the cap here would reject work already paid for.
        if (!scheduled?.charged && budget.analyzeCalls >= opts.maxAnalyzeCalls) {
            budget.truncated = true;
            node.decision = "stop";
            return node;
        }

        try {
            // Only ask what this field can answer. A feature needing finer detail than the
            // render carries is recorded unassessable HERE, with no model call — the
            // honest answer, and the signal that sends the walk deeper.
            // `opts.checklist` is always present — `_resolveChecklist` falls back to a
            // generic one rather than returning nothing, so every run has the same schema.
            //
            // The slide's own calibration is passed so "defer it to a finer read" is only
            // said when a finer read exists. At the limit the feature is ASKED — a real
            // answer at 0.504 µm/px beats a manufactured `not-assessable` for a 0.25 µm/px
            // requirement no scan on this slide will ever meet.
            const nativeMpp = this._micronsPerPixel(viewer);
            const { assessable, deferred } =
                splitByResolution(opts.checklist, raster.deliveredMpp, undefined, nativeMpp);

            const prompt = this._overviewPrompt(opts, facts, depth, parent, assessable);
            if (!scheduled?.charged) budget.analyzeCalls++;
            const res = await this.analyzeRegion(viewer, {
                prompt,
                driver: opts.driver,
                source: "background",
                region: viewBounds,
                preRead: raster,
            });
            node.findings = res?.findings ?? null;

            const askedFor: Checklist = { ...opts.checklist, features: assessable };
            let parsed = parseFieldAnswers(res?.findings, askedFor, opts.query);

            // The model wrote prose but no machine block. One bounded re-ask is far
            // cheaper than losing every answer the field could have given — and much
            // safer than recording them all as unassessable when they were assessable.
            if (parsed.parsed === "none" && assessable.length && this._canRepairVerdict(opts, budget)) {
                budget.analyzeCalls++;
                budget.repairCalls++;
                const repair = await this.analyzeRegion(viewer, {
                    prompt: `${prompt}\n\n${t("pathology.answerRepairPrompt")}`,
                    driver: opts.driver,
                    source: "background",
                    region: viewBounds,
                    preRead: raster,
                });
                const repaired = parseFieldAnswers(repair?.findings, askedFor, opts.query);
                if (repaired.parsed !== "none") parsed = repaired;
            }

            node.answers = parsed.answers;
            for (const f of deferred) node.answers[f.id] = unassessable(f.id, "resolution");
            // Mark what was answered below its own stated requirement, so the report can say
            // "asked for 0.25, answered at 0.504" rather than either hiding the gap or
            // treating the answer as if it had met the requirement.
            markBelowRequested(node.answers, assessable, raster.deliveredMpp);
            if (parsed.prose) node.findings = parsed.prose;

            const verdict = parsed.verdict;
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
            // With a checklist the drill signal is a FACT about the run, not an opinion:
            // a feature that is still open in a field that otherwise scores is a question
            // this rung could not settle, and the only way to settle it is to look closer.
            //
            // Through the SAME helper the best-first scheduler uses, so the two schedulers
            // cannot drift on what counts as a gap (the polarity — "no" at an adequate
            // resolution is settled, `uncertain`/`not-assessable` are not — is stated once,
            // there). `node.deliveredMpp` is `raster.deliveredMpp`, assigned above.
            const gaps = opts.checklist ? checklistGaps(this._schedulable(node, ladder), opts.checklist) : [];
            const unresolved = gaps.length > 0 || verdict.resolvable === false || shortOfRung;
            // Same gate the best-first scheduler applies, through the same helper, so the two
            // schedulers cannot disagree about what is worth drilling.
            const mustResolve = unresolved && worthDrilling(this._schedulable(node), opts);

            const canDrill = depth < opts.maxDepth
                && (wantsDrill || mustResolve)
                && loaded
                && !signal.aborted
                && !this._budgetExhausted(budget, opts)
                // Under the best-first scheduler this node does NOT recurse: it returns,
                // enters the global queue, and is expanded only if it wins against every
                // other node. Recursing here would restore depth-first traversal inside
                // the very mechanism that exists to replace it.
                && !scheduled;

            if (canDrill) {
                const children = await this._childrenOf(viewer, node, opts, ladder);
                if (children.length) {
                    node.decision = wantsDrill ? "drill" : "resolve";
                    for (const child of children.slice(0, opts.breadth)) {
                        if (signal.aborted) break;
                        if (this._budgetExhausted(budget, opts)) { budget.truncated = true; break; }
                        const childNode = await this._exploreOverviewNode(
                            viewer, child, depth + 1, [...path, child.index],
                            opts, ladder, budget, slideArea, node, signal, dialog
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
     * Plan the fields that answer one node's rung.
     *
     * The ladder states a RESOLUTION; this turns it into renders that deliver it. A rung
     * with no µm/px target (an uncalibrated slide) falls back to a raster budget, which is
     * the one case where "fit it into N pixels" is the honest answer — there is no
     * physical scale to be wrong about.
     */
    private _planNodeFields(
        viewer: any,
        bounds: Bounds,
        rung: number,
        targetMpp: number | null,
        ladder: OverviewLadder,
        fieldPixels: number = FIELD_MAX_PIXELS
    ): { plan: FieldPlan; shortOfRung: boolean } {
        const slideMpp = this._micronsPerPixel(viewer);
        const slide = this._slideMeta(viewer, this._ref(viewer));
        const survey = this._surveyCovering(viewer, bounds);
        const common = {
            bounds,
            rung,
            slideMpp,
            maxRasterPixels: fieldPixels,
            // Free priors: which tiles hold tissue, and which of those hold nuclei. Both
            // come from the survey, so they cost nothing and are consulted BEFORE a call.
            ...(survey ? { mask: survey.sampler } : {}),
            ...(survey?.density ? { density: survey.density } : {}),
            ...(slide.width > 0 && slide.height > 0 ? { slide: { width: slide.width, height: slide.height } } : {}),
            // The walk has already decided this box is worth reading, so a low-fill tile
            // inside it is still part of the answer — filtering belongs to the survey pass.
            minFill: 0,
        };

        // Uncalibrated: express the rung as a downsample. There is no physical scale to be
        // wrong about, and the rungs must still differ from each other.
        if (!slideMpp || !targetMpp) {
            const downsample = Math.pow(2, Math.max(0, ladder.magnifications.length - 1 - rung));
            return { plan: planFields({ ...common, single: true, downsample }), shortOfRung: false };
        }

        const wanted = planFields({ ...common, mpp: targetMpp });
        if (wanted.fields.length <= 1) return { plan: wanted, shortOfRung: false };

        // The region does not fit one call at this rung's resolution, so this READ keeps
        // COVERAGE and gives up resolution: one field over the whole region at whatever µm/px
        // it affords. That is the right trade for a node's own look — it is what produces the
        // interest score that ranks the region against every other — and it is not the end of
        // the story: `shortOfRung` is what sends the node to `_tileChildren`, which reads the
        // same box AT the rung as a lattice. Making the trade silently is what was wrong;
        // making it and then never recovering is what left every feature unassessable.
        const plan = planFields({ ...common, single: true, downsample: fitDownsample(bounds, fieldPixels) });
        // ...but "the lattice had more than one cell" is not the same question as "did this read
        // land short of the rung". A box a hair wider than one tile still fits a single raster
        // at a FINER µm/px than the rung asked for, and calling that a shortfall made the node
        // report `resolutionShortfall` on a read that beat its own target — which then warned
        // about unresolved leaves, and permanently routed `_childrenOf` down the tile path when
        // the tissue wanted separating, not re-reading. Compare the resolutions.
        const delivered = plan.deliveredMpp;
        return {
            plan,
            shortOfRung: delivered == null || delivered > targetMpp * (1 + FIELD_MPP_TOLERANCE),
        };
    }

    /**
     * How much tissue makes a box worth another call: enough to FILL a readable part of one
     * field at the finest rung this run will reach.
     *
     * Derived rather than chosen. A constant would be wrong on the next slide — the same number
     * is generous on a 40x scan and prohibitive on a 10x one — whereas "there is more here than
     * a smear of tissue in a field" is the same statement about the work at any calibration.
     * µm² when the slide is calibrated, level-0 px² when it is not, matching
     * {@link OverviewNode.tissueArea}.
     *
     * The {@link TILE_MIN_FILL} factor is the whole point, and its absence was a bug: one field's
     * area of SOLID tissue is unreachable for any box smaller than a field, and for any box whose
     * tissue is not rectangular at any size. At 2 MP and 1 µm/px that demanded 2 mm² of tissue,
     * so a 3.4 x 1.5 mm core holding 1.4 mm² was refused, the walk spent 1 of 28 calls, and every
     * feature came back "not-assessable" on a run that reported itself complete — the same
     * outcome the older bbox-fill floor at 0.1 produced, in different arithmetic. The gate's
     * real job is only to refuse glass, and it is the same floor `planFields` already applies to
     * a tile, so the two agree about what an empty box is.
     */
    private _defaultMinDrillTissue(viewer: any, ladder: OverviewLadder, fieldPixels: number): number {
        const rungs = ladder.targetMpp.filter((m): m is number => typeof m === "number" && m > 0);
        const finest = rungs.length ? Math.min(...rungs) : null;
        return (finest ? fieldPixels * finest * finest : fieldPixels) * TILE_MIN_FILL;
    }

    /**
     * Split a region into the fields that read it AT its next rung — the expansion that makes
     * the ladder reachable.
     *
     * A region larger than one call at its rung used to have exactly one outcome: it was
     * rendered as a single squashed image at whatever resolution fitted, every checklist
     * feature was recorded unassessable because the delivered µm/px was coarser than any of
     * them needed, and the only route to detail was tissue-island subdivision. On a
     * contiguous core there are no sub-islands, so there was no route at all — a walk could
     * spend one call out of twenty-eight and report itself finished.
     *
     * This is the missing route, and it is nearly free: `planFields` lays the lattice, the
     * cached survey mask drops the glass cells with NO render, and the survivors come back
     * ranked by tissue and cellularity. Nothing here touches the network.
     */
    private _tileChildren(
        viewer: any,
        bounds: Bounds,
        depth: number,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder
    ): SlideRegion[] {
        const rung = Math.min(depth + 1, ladder.magnifications.length - 1);
        const targetMpp = ladder.targetMpp[rung] ?? null;
        const slideMpp = this._micronsPerPixel(viewer);
        const slide = this._slideMeta(viewer, this._ref(viewer));
        const survey = this._surveyCovering(viewer, bounds);
        const parentArea = Math.max(1, bounds.width * bounds.height);

        const plan = planFields({
            bounds,
            rung,
            slideMpp,
            maxRasterPixels: opts.fieldPixels,
            // Unlike a node's own read (where the box is already known to be worth reading, so
            // minFill is 0), this IS the coverage decision: a cell of glass must cost nothing.
            minFill: TILE_MIN_FILL,
            ...(survey ? { mask: survey.sampler } : {}),
            ...(survey?.density ? { density: survey.density } : {}),
            ...(slide.width > 0 && slide.height > 0 ? { slide: { width: slide.width, height: slide.height } } : {}),
            // Uncalibrated slides have no rung to hit, so "finer" is expressed the only way it
            // can be: half the downsample the parent's single field settled for.
            ...(slideMpp && targetMpp
                ? { mpp: targetMpp }
                : { downsample: Math.max(1, fitDownsample(bounds, opts.fieldPixels) / 2) }),
        });

        // Array order is the field SCORE order `planFields` returned — the walk takes the
        // first `breadth` of these, so it must survive. Only the numbering is spatial.
        return this._numberByReadingOrder(plan.fields
            // A single field spanning the parent is a reframe, not progress — the caller then
            // falls back to island subdivision rather than re-reading the same box.
            .filter(f => f.bounds.width * f.bounds.height <= 0.9 * parentArea)
            .map((f, index) => ({
                index,
                // Provisional: the walk relabels the child with its full ancestry path.
                label: regionLabel([index]),
                bounds: f.bounds,
                center: centerOf(f.bounds)!,
                areaFraction: (f.fill * f.bounds.width * f.bounds.height) / parentArea,
                isApproximate: true,
            })));
    }

    /**
     * The children of a node, from whichever source fits why it is being expanded.
     *
     * A node short of its rung needs the SAME tissue read closer, which is a lattice. A node
     * that reached its rung and is still interesting needs the tissue INSIDE it separated,
     * which is islands. Each falls back to the other rather than to nothing: a contiguous
     * mass has no islands, and a box already at its rung tiles into a reframe of itself.
     */
    private async _childrenOf(
        viewer: any,
        node: OverviewNode,
        opts: ResolvedOverviewOptions,
        ladder: OverviewLadder
    ): Promise<SlideRegion[]> {
        const tiles = () => this._tileChildren(viewer, node.bounds, node.depth, opts, ladder);
        const islands = () => this._subdivideRegion(viewer, node.bounds, opts.driver, node.label);
        if (node.resolutionShortfall) {
            const planned = tiles();
            return planned.length ? planned : islands();
        }
        const split = await islands();
        return split.length ? split : tiles();
    }

    /**
     * Subdivide a region into finer children in parent-global image coords.
     * When the tissue is several distinct islands it uses them, otherwise (one
     * contiguous mass) it falls back to a tissue-aware N×N GRID so drilling always
     * yields genuinely SMALLER, higher-magnification children — never a reframe of
     * the same box. Children are clamped inside the parent and any that fail to
     * shrink are dropped. Returned in priority order (area weighted by density — the walk
     * takes a `breadth` prefix), NUMBERED in reading order.
     *
     * The mask comes from the cached whole-slide survey whenever the region resolves to
     * enough of it to have a shape. Only a region too small for that — deep in a drill —
     * still costs an off-screen render of its own.
     */
    private async _subdivideRegion(viewer: any, parentBounds: Bounds, driverId?: string, parentLabel?: string): Promise<SlideRegion[]> {
        const { mask, bounds: maskBounds } = await this._maskOver(viewer, parentBounds, driverId, parentLabel);
        const total = mask.width * mask.height;
        if (!total) return [];
        // Mask px → parent-global: a pure linear map over the bounds the mask covers.
        // Snapped crop bounds, not the request, or every derived box shifts by up to one
        // survey pixel — which at survey resolution is a visible slice of the slide.
        const mapPoint = (px: number, py: number): Point => ({
            x: maskBounds.x + (px / mask.width) * maskBounds.width,
            y: maskBounds.y + (py / mask.height) * maskBounds.height,
        });
        const toParent = (p: Point): Point => p;

        // Tissue islands within the framed view (parent coords, ranked largest-first).
        const traced = this._traceOuterContours(mask)
            .map(pts => ({ pts, area: polygonArea(pts) }))
            .filter(r => r.area >= 0.01 * total)
            .sort((a, b) => b.area - a.area)
            .map(r => {
                const poly = r.pts.map(p => toParent(mapPoint(p.x, p.y)));
                const b = boundsOfPolygons([poly]);
                return b ? { bounds: b, areaFraction: r.area / total } : null;
            })
            .filter((c): c is { bounds: Bounds; areaFraction: number } => !!c);
        // Collapse islands whose BOXES are the same box before anything judges the split.
        // Two contours sharing a rectangle become one child either way — the only question
        // is whether the pipeline notices, and un-merged they read as separate regions,
        // get separate vision calls, and are reported as separate findings.
        const mergeOptions = this._regionMergeOptions();
        const islands = mergeOptions ? mergeOverlappingBounds(traced, mergeOptions) : traced;

        // Genuine multi-island split needs ≥2 islands of which at least two are real OBJECTS;
        // otherwise grid-split the contiguous mass into smaller cells.
        //
        // The test used to be "no single island dominates" (`islands[0] <= 0.6`), which asks
        // about the largest island when the question is about the SECOND — a big core beside a
        // small one is two cores, and routing that to a blind grid throws away the separation
        // the mask already found. What disqualifies a split is one mass surrounded by specks,
        // and a floor on the runner-up says exactly that.
        const candidates = (islands.length >= 2 && islands[1].areaFraction >= ISLAND_MIN_SIBLING)
            ? islands
            : gridSplitTissue(mask, mapPoint);

        // Order the children by how much they are worth looking at, not merely by size.
        // The walk takes the first `breadth` of them, so this ordering decides what gets a
        // vision call and what never gets read at all — and area alone rates a large bland
        // fragment above a small dense one. The density prior is free, so consult it.
        const density = this._densityFor(viewer, parentBounds);
        if (density) {
            candidates.sort((a, b) =>
                b.areaFraction * (0.5 + 0.5 * density.sample(b.bounds)) -
                a.areaFraction * (0.5 + 0.5 * density.sample(a.bounds)));
        }

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
            const index = regions.length;
            regions.push({
                index,
                // Provisional: the walk relabels the child with its full ancestry path.
                label: regionLabel([index]),
                bounds,
                center: centerOf(bounds)!,
                areaFraction: c.areaFraction,
                isApproximate: true,
            });
        }
        // Ranked order stays (it decides which children get read); numbering goes spatial.
        return this._numberByReadingOrder(regions);
    }

    /**
     * A tissue mask covering `bounds`, from the cached survey when it can carry the shape,
     * otherwise from a fresh off-screen render.
     *
     * The survey mask is ~2 MP over the whole slide, so a small region resolves to only a
     * handful of its pixels — enough to answer "is there tissue here?", not enough to trace
     * an outline from. `minMaskPixels` is where that line sits: below it the crop would
     * yield contours made of survey-resolution staircases, and the children drawn from them
     * would be boxes around nothing in particular.
     *
     * Returns the bounds the mask ACTUALLY covers — snapped to survey pixel edges for a
     * crop — because that, not the request, is what maps mask pixels back to the slide.
     */
    private async _maskOver(
        viewer: any,
        bounds: Bounds,
        driverId?: string,
        label?: string,
        minMaskPixels = 4096
    ): Promise<{ mask: MaskResult; bounds: Bounds }> {
        const survey = this._surveyCovering(viewer, bounds);
        if (survey) {
            const crop = cropMask(survey.mask, survey.surveyBounds, bounds);
            if (crop && crop.mask.width * crop.mask.height >= minMaskPixels) return crop;
        }
        const raster = await this._renderRegionRaster(viewer, bounds, {
            targetPixels: MASK_TARGET_PIXELS,
            layers: "background",
            label: t("pathology.captureSubdivide", { label: label || t("pathology.regionLabel", { number: "?" }) }),
        });
        const { mask } = await this._runTissueMask(viewer, driverId, raster);
        return { mask, bounds };
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
     *
     * The weights come from `lib/scheduler` — the SAME functions the priority queue scores
     * with. They were reimplemented here once, with quietly different constants, so the list a
     * reader was shown could disagree with the order the budget had actually been spent in.
     * Only the terms differ, deliberately: `noveltyWeight` and `checklistGapWeight` shape where
     * a run should look NEXT, which is not a statement about what it found.
     *
     * Returns CHILDLESS views of the nodes. `rankScore` is still written onto the originals
     * (the evidence table reads it back off the tree), but the returned entries must not
     * carry `children`: they are the same objects `root` already holds, and `JSON.stringify`
     * has no reference dedup, so a ranked island would re-serialize its entire subtree a
     * second time — and a ranked child of a ranked parent a third. On a real run that
     * duplication alone was several times the size of everything else in the result.
     */
    private _rankOverviewNodes(roots: OverviewNode[]): OverviewNode[] {
        const flat: Array<{ node: OverviewNode; prior: number }> = [];
        const walk = (n: OverviewNode, ancestors: number[]) => {
            flat.push({ node: n, prior: pathPrior(ancestors) });
            const next = n.interest != null ? [...ancestors, n.interest] : ancestors;
            n.children.forEach(c => walk(c, next));
        };
        roots.forEach(r => walk(r, []));

        const described = flat.filter(e => e.node.findings && e.node.bounds && !e.node.error);
        const maxArea = Math.max(...described.map(e => e.node.slideAreaFraction || 0), Number.EPSILON);

        for (const { node, prior } of described) {
            const s = this._schedulable(node);
            node.rankScore = node.interest == null
                ? -1 // unknown interest — sorts last, never treated as a real 0
                : node.interest * prior * confidenceWeight(node.verdict?.confidence)
                    * areaWeight(s, maxArea) * fillWeight(s) * cellularityWeight(s);
        }

        return described
            .map(e => e.node)
            .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1) || b.slideAreaFraction - a.slideAreaFraction)
            .slice(0, 12)
            // Shallow copy AFTER sorting, so the sort still reads the live `rankScore`.
            .map(node => ({ ...node, children: [] as OverviewNode[] }));
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
        parent: OverviewNode | null,
        assessable?: ChecklistFeature[]
    ): string {
        const preamble = this._contextPreamble(opts.context, facts, depth, parent, opts.framePadding);

        // With a checklist, the questions ARE the prompt. Only the features this field's
        // resolution can actually answer are asked — the rest are recorded as unassessable
        // without spending a call, which is both the honest answer and the signal that
        // sends the walk deeper.
        if (assessable?.length) {
            return [
                ...preamble,
                t("pathology.fieldChecklistIntro"),
                ...assessable.map(f => t("pathology.fieldChecklistItem", { id: f.id, question: f.question })),
                t("pathology.fieldAnswerContract"),
            ].join(" ");
        }

        const question = opts.query
            ? t("pathology.overviewQueryPrompt", { query: opts.query })
            : t("pathology.overviewRegionPrompt");
        return [...preamble, question, t("pathology.verdictContract")].join(" ");
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
        parent: OverviewNode | null,
        /**
         * Slack the framing left around the region, so the model is told about the margin it
         * is actually looking at. A walk passes its resolved knob; the ad-hoc callers below
         * frame nothing themselves and keep the default.
         */
        framePadding: number = OVERVIEW_FRAME_PADDING
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
                mag: facts.magnification != null ? round(facts.magnification, 1) : "?",
                mpp: round(facts.renderedMpp
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
                renderedMpp: round(facts.renderedMpp, 2),
            }));
        }

        const geometryArgs = {
            // The framing knob, not the constant: a caller that widened or removed the padding
            // must not have the model told about a slack that is no longer there.
            paddingPercent: Math.round(framePadding * 100),
            slideAreaFraction: round(facts.slideAreaFraction * 100, 2),
        };
        lines.push(facts.bboxFillFraction != null
            ? t("pathology.ctxGeometry", { ...geometryArgs, fillPercent: Math.round(facts.bboxFillFraction * 100) })
            : t("pathology.ctxGeometryNoFill", geometryArgs));

        // Anchor the drill against the parent, or the model just re-scores itself upward.
        const parentGist = parent?.findings ? this._gistOf(parent.findings) : null;
        if (parentGist) lines.push(t("pathology.ctxParent", { level: levelOf(depth), parentGist }));

        lines.push(t("pathology.ctxHonesty"));
        return lines;
    }

    /** First sentence of a findings text, capped — used wherever a short gist is needed. */
    private _gistOf(findings: string, max = 200): string {
        return String(findings).split(/(?<=[.!?])\s/)[0].slice(0, max);
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
                fill = this._fillOf(viewer, raster.renderedBounds);
                if (fill == null) {
                    // No usable survey coverage for this box. A ratio is scale-invariant, so
                    // the node's own raster answers it when it is small enough to threshold;
                    // otherwise measuring the fill is not worth a render of its own.
                    if (raster.width * raster.height <= MASK_MAX_PIXELS) {
                        const { mask } = await this._runTissueMask(viewer, opts.driver, raster);
                        const total = mask.width * mask.height;
                        fill = total ? countFilled(mask.binaryMask) / total : null;
                    }
                }
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

    /** The checklist an interrogation will ask, from `features`, `questions`, or neither. */
    private _interrogationChecklist(options: {
        features?: ChecklistFeature[]; questions?: string[]; mpp?: number;
    }): Checklist {
        if (options.features?.length) {
            const clean = sanitizeChecklist(options.features, { source: "explicit" });
            if (clean) return clean;
        }
        if (options.questions?.length) {
            // Plain questions carry no resolution of their own, so they inherit the call's
            // — asking at the finest available power is the safe default for a deep dive.
            const mpp = options.mpp ?? 0.25;
            const clean = sanitizeChecklist(
                options.questions.slice(0, MAX_CHECKLIST_FEATURES).map((question, i) => ({
                    id: `q${i + 1}`, label: `Q${i + 1}`, question, requiredMpp: mpp,
                })),
                { source: "explicit" }
            );
            if (clean) return clean;
        }
        throw new Error("interrogateRegion() requires features or questions to ask.");
    }

    /**
     * One answer per feature across every field that was read.
     *
     * The rule itself is pure and lives with the other answer logic in `lib/answers.ts`
     * (`aggregateFeatureAnswers`), where it can be tested without a viewer.
     */
    private _aggregateAnswers(fields: InterrogationField[], checklist: Checklist): FeatureAnswer[] {
        return aggregateFeatureAnswers(fields, checklist.features);
    }

    /** Per-cell answers from a montage reply, keyed by the grid labels drawn on the image. */
    private _parseMontageAnswers(
        text: string | null,
        rendered: Array<{ bounds: Bounds; label: string; cellLabel: string; deliveredMpp: number | null }>,
        checklist: Checklist | null
    ): MontageResult["cells"] {
        return rendered.map(cell => {
            // The model answers per grid label, so the cell's section of the reply is
            // whatever follows its label up to the next one. Crude, and deliberately so:
            // a stricter format would discard usable answers over punctuation.
            const section = this._montageSection(text, cell.cellLabel, rendered.map(r => r.cellLabel));
            const parsed = section && checklist
                ? parseFieldAnswers(section, checklist)
                : null;
            return {
                label: cell.label,
                cellLabel: cell.cellLabel,
                bounds: cell.bounds,
                deliveredMpp: cell.deliveredMpp,
                answers: checklist
                    ? checklist.features.map(f => parsed?.answers[f.id] ?? unassessable(f.id, "unparsed"))
                    : [],
                interest: parsed?.verdict.interest ?? null,
                findings: section,
            };
        });
    }

    /** The slice of a montage reply that belongs to one cell label. */
    private _montageSection(text: string | null, cellLabel: string, allLabels: string[]): string | null {
        if (!text) return null;
        const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const start = text.search(new RegExp(`(^|[^A-Za-z0-9])${escape(cellLabel)}\\b`, "m"));
        if (start < 0) return null;
        const rest = text.slice(start + cellLabel.length);
        const others = allLabels.filter(l => l !== cellLabel).map(escape);
        if (!others.length) return rest.trim() || null;
        const end = rest.search(new RegExp(`(^|[^A-Za-z0-9])(${others.join("|")})\\b`, "m"));
        return (end < 0 ? rest : rest.slice(0, end)).trim() || null;
    }

    /** Minimal view facts describing the composite itself, for the grounding preamble. */
    private _montageFacts(
        cellSizeUm: { width: number; height: number } | null,
        composite: { width: number; height: number }
    ): NodeViewFacts {
        return {
            magnification: null,
            fieldOfViewUm: cellSizeUm,
            fieldOfViewPx: { width: composite.width, height: composite.height },
            rasterPx: { width: composite.width, height: composite.height },
            renderedMpp: null,
            targetMpp: null,
            resolutionShortfall: false,
            slideAreaFraction: 0,
            bboxFillFraction: null,
        };
    }

    /**
     * The cached nuclear-density map covering `bounds`, or null when none was derived.
     *
     * `bounds` picks WHICH survey answers: a scoped run leaves a finer density map over its
     * region, and sampling the whole-slide one there would rate a hot spot by the average of
     * a much bigger cell.
     */
    private _densityFor(viewer: any, bounds?: Bounds): DensityMap | null {
        return this._surveyCovering(viewer, bounds)?.density || null;
    }

    /**
     * Tissue fraction of a parent-global box, read out of the cached survey mask.
     *
     * Null when there is no survey for this slide yet, or when the box maps to too few
     * survey pixels to mean anything — a handful of pixels can say "there is tissue here"
     * but the resulting ratio is noise, and a fill figure feeds a drill decision.
     */
    private _fillOf(viewer: any, bounds: Bounds, minMaskPixels = 64): number | null {
        const survey = this._surveyCovering(viewer, bounds);
        if (!survey) return null;
        const px = (bounds.width / Math.max(1e-9, survey.surveyBounds.width)) * survey.mask.width;
        const py = (bounds.height / Math.max(1e-9, survey.surveyBounds.height)) * survey.mask.height;
        if (px * py < minMaskPixels) return null;
        return survey.sampler.fill(bounds);
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
                label: regionLabel([0]),
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
            return t("pathology.overviewDigestLine", {
                label: n.label || regionLabel([n.index]),
                level: levelOf(n.depth),
                score,
                gist,
            });
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

    /**
     * Identity of an image that is about to leave the browser.
     *
     * Carried beside the pixels for the audit trail — WHICH slide, WHICH box, how
     * closely read — so a logged vision call is a reviewable record rather than an
     * anonymous PNG on a server. It is diagnostics only: a driver passes it
     * through to be logged and must never put it in the prompt, or an operator's
     * logging configuration would change what the model is asked.
     */
    private _analysisContext(
        viewer: any,
        feature: string,
        extra?: Partial<AnalysisContext>
    ): AnalysisContext {
        return {
            feature,
            viewerId: viewer?.uniqueId ?? null,
            tileSourceId: this._slideKey(viewer),
            deliveredMpp: null,
            region: null,
            label: null,
            ...(extra || {}),
        };
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

        const { area, tissue } = coverageOverRings(maskRings, mask);
        // Total tissue in the current view, from the SAME mask → the annotation's
        // share of the visible tissue is resolution-consistent (no navigation).
        const viewTissuePixels = countFilled(mask.binaryMask);
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
        const bg = await this._readBackground(viewer, { label: t("pathology.captureSegment") });

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
            /**
             * Target resolution in µm per delivered pixel — the precise way to ask for
             * detail. Unlike `magnification`/`targetPixels`, which are requests the render
             * may quietly clamp, this is planned as a field and DELIVERED: a region too
             * large to carry at this resolution is tiled, and the caller is told so via
             * `coveredFraction`. Ignored on an uncalibrated slide, and when `preRead` is
             * given. Takes precedence over `magnification`.
             */
            mpp?: number;
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
        let coveredFraction: number | undefined;
        if (options?.region || options?.preRead) {
            // Naming a region is what makes it the subject; a later unqualified call follows it.
            // `preRead` alone does not: the walk's own nodes come through here, and every field
            // it reads would otherwise re-point the focus at whatever it looked at last.
            if (options.region && !options.preRead) this.setFocusRegion(viewer, options.region);
            const layers = options?.source === "background" ? "background" : "active";
            let raster: RegionRaster;
            if (options.preRead) {
                raster = options.preRead;
            } else if (typeof options?.mpp === "number" && options.mpp > 0 && this._micronsPerPixel(viewer)) {
                // Resolution was asked for by name, so deliver it. One field is read — the
                // densest, when the region needs more than one — and `coveredFraction` says
                // how much of the region that was, instead of quietly returning a squashed
                // image of all of it and letting the prompt claim the resolution anyway.
                const plan = planFields({
                    bounds: options.region!,
                    mpp: options.mpp,
                    slideMpp: this._micronsPerPixel(viewer),
                    maxRasterPixels: FIELD_MAX_PIXELS,
                    maxFields: 1,
                    minFill: 0,
                });
                const field = plan.fields[0];
                if (!field) throw new Error("The requested region maps to an empty area of the slide.");
                raster = await this._renderField(viewer, field, { layers, label: t("pathology.captureAnalyze") });
                coveredFraction = (field.bounds.width * field.bounds.height)
                    / Math.max(1, options.region!.width * options.region!.height);
            } else {
                raster = await this._renderRegionRaster(viewer, options.region!, {
                    layers,
                    magnification: options?.magnification,
                    targetPixels: options?.targetPixels ?? REGION_ANALYZE_TARGET_PIXELS,
                    label: t("pathology.captureAnalyze"),
                });
            }
            imageBlob = await raster.toBlob();
            isComplete = raster.isComplete;
            if (options?.context && !options?.raw) {
                prompt = await this._groundPrompt(viewer, options.context, raster, options.driver, prompt);
            }
        } else {
            // No region named: this reads the LIVE viewport, which never waits for tiles. It is
            // still incomplete exactly when the view was mid-stream, and that must reach the caller
            // — leaving `isComplete` undefined here is what dropped the flag from the result and
            // let a half-loaded frame be reported as a finished read.
            if (options?.source === "background") {
                const bg = await this._readBackground(viewer, { label: t("pathology.captureAnalyze") });
                imageBlob = await bg.toBlob();
                isComplete = bg.isComplete;
            } else {
                const shot = await this.captureViewportImage(viewer, t("pathology.captureAnalyze"));
                imageBlob = shot?.blob;
                isComplete = shot?.isComplete;
            }
        }
        if (!imageBlob) throw new Error("Failed to capture the viewport image.");

        // `region` completes the audit trail: it says WHICH part of the slide left the
        // browser, which the `region-capture` event alone cannot (a `preRead` raster is
        // captured under a different call).
        // `scale` is level-0 px per raster px, so slide µm/px times it IS the
        // delivered resolution — the number that says whether this image could
        // carry cell-level detail at all. Derived rather than read off the raster
        // because a plain `RegionRaster` does not carry one (only a planned
        // `FieldRaster` does).
        const slideMppNow = this._micronsPerPixel(viewer);
        const preRead = options?.preRead;
        const context = this._analysisContext(viewer, "analyze", {
            region: options?.region ?? preRead?.renderedBounds ?? null,
            deliveredMpp: slideMppNow && preRead ? round(slideMppNow * preRead.scale, 3) : null,
        });
        this.raiseEvent("analysis-started", { driver: driver.id, feature: "analyze", region: context.region });
        try {
            const res = await driver.features["analyze"]!({ imageBlob, prompt, context });
            return {
                driver: driver.id,
                findings: res?.text ?? null,
                ...(isComplete === undefined ? {} : { isComplete }),
                ...(coveredFraction === undefined || coveredFraction >= 1 ? {} : { coveredFraction }),
            };
        } finally {
            this.raiseEvent("analysis-finished", {
                driver: driver.id, feature: "analyze",
                region: options?.region ?? options?.preRead?.renderedBounds ?? null,
            });
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
        const bg = preRead || await this._readBackground(viewer, {
            ...readOpts,
            label: readOpts?.label || t("pathology.captureTissueMask"),
        });

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
     * The current viewport as a parent-global image rectangle, or null when the viewer can't
     * map it. Backs `scope: "viewport"`, and the fallback for sources that expose no slide
     * dimensions — where the survey covers what the user is looking at because nothing else
     * is knowable, rather than because it was asked for.
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

    /**
     * Resolve an {@link ExplorationScope} into the parent-global rectangle a survey will
     * cover, plus what that rectangle means for the result's coverage claim.
     *
     * The rectangle form arrives from a script the chat model wrote, so it is treated as
     * hostile input (AGENTS.md §0.2/§7): every field must be a finite number, the box must
     * have area, and it is clamped into the slide rather than trusted to be on it. A box that
     * misses the slide entirely is an error, not an empty survey — silently surveying nothing
     * would be reported as "this slide looks blank".
     */
    private _resolveScope(viewer: any, scope?: ExplorationScope): { bounds: Bounds; coverageScope: CoverageScope } {
        const resolved = this._resolveScopeBounds(viewer, scope);
        // The single decision point for what the work is about, so every entry point that takes a
        // scope keeps the focus current without each of them remembering to. Only an EXPLICIT
        // scope moves it: an omitted one is already following the focus, and the no-dimensions
        // fallback to the current view is a degradation rather than a statement of intent.
        if (scope === "slide") this.setFocusRegion(viewer, null);
        else if (scope != null) this.setFocusRegion(viewer, resolved.bounds);
        return resolved;
    }

    private _resolveScopeBounds(viewer: any, scope?: ExplorationScope): { bounds: Bounds; coverageScope: CoverageScope } {
        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);
        const meta = this._slideMeta(viewer, ref);
        const slideDimsKnown = meta.width > 0 && meta.height > 0;

        const currentView = (): Bounds => {
            const view = this._currentViewParentBounds(viewer, ref, cropped);
            if (!view) throw new Error("The current view could not be mapped onto the slide.");
            // Clamped when the slide extent is known: the viewport routinely extends past the
            // slide edge, and a survey of glass beyond it is budget spent on nothing.
            return (slideDimsKnown ? clampBoundsToSlide(view, meta.width, meta.height) : view) || view;
        };

        if (scope === "viewport") return { bounds: currentView(), coverageScope: "current-view" };

        // An omitted scope follows the region the work is already about. The alternative — a
        // silent whole-slide default — is what turned "do a deep scan" into minutes of examining
        // the wrong tissue after two turns spent on one core. `scope: "slide"` is how a caller
        // demands the slide, and it is the only thing that clears the focus.
        if (scope == null) {
            const focus = this._focusRegions.get(this._slideKey(viewer) || "");
            if (focus) return { bounds: focus.bounds, coverageScope: "region" };
        }

        if (scope && scope !== "slide") {
            const rect = normalizeScopeRect(scope, meta.width, meta.height);
            if (!rect) {
                throw new Error(
                    "An exploration scope must be a rectangle {x, y, width, height} of image pixels, on the slide."
                );
            }
            return { bounds: rect, coverageScope: "region" };
        }

        // "slide" / omitted. The slide's whole content rectangle — no letterbox margins, no
        // viewport framing: the raster IS the slide (for a virtual-region crop, the CROP
        // expressed in parent-global coords). When the source exposes NO slide dimensions
        // (some DICOM / custom sources), degrade to the CURRENT VIEW so orientation still
        // returns a best-effort overview instead of throwing — the result is then scoped
        // "current-view", and regions can't be slide-clamped.
        if (!slideDimsKnown) {
            const view = this._currentViewParentBounds(viewer, ref, cropped);
            if (!view) throw new Error("The slide dimensions are unavailable; cannot build an overview.");
            return { bounds: view, coverageScope: "current-view" };
        }
        const content = ref?.getContentSize?.();
        const localBR: Point = { x: content?.x || meta.width, y: content?.y || meta.height };
        const toParent = (p: Point): Point => (cropped ? cropped.toParentImageCoordinates(p) : p);
        const pTL = toParent({ x: 0, y: 0 });
        const pBR = toParent(localBR);
        return {
            bounds: {
                x: Math.min(pTL.x, pBR.x),
                y: Math.min(pTL.y, pBR.y),
                width: Math.abs(pBR.x - pTL.x),
                height: Math.abs(pBR.y - pTL.y),
            },
            coverageScope: "whole-slide",
        };
    }

    /**
     * Raster budget for a survey of `bounds`.
     *
     * `surveyMpp` states a RESOLUTION, which is what a caller actually means by "look closer
     * at this area"; it is converted here into the pixel budget the render path already
     * takes, so there is one render entry point rather than two. Uncalibrated slides have no
     * physical scale to hit and fall back to the flat budget.
     */
    private _surveyPixelBudget(viewer: any, bounds: Bounds, options?: { surveyMpp?: number; surveyPixels?: number }): number {
        return surveyPixelBudget(
            bounds, this._micronsPerPixel(viewer), options || {}, MASK_TARGET_PIXELS, MASK_MAX_PIXELS
        );
    }

    /**
     * The µm/px the orientation rung aims at.
     *
     * An explicit value wins verbatim — the same contract `magnificationLadder` has. Otherwise
     * {@link SURVEY_MPP} for a whole-slide run, but never coarser than what the scope already
     * affords inside its own pixel budget: on a viewport-sized box, 2 µm/px would throw away
     * resolution the render was going to deliver for free.
     */
    private _resolveSurveyMpp(
        viewer: any,
        bounds: Bounds,
        coverageScope: CoverageScope,
        options?: { surveyMpp?: number; surveyPixels?: number }
    ): number | undefined {
        return resolveSurveyMpp(
            bounds, this._micronsPerPixel(viewer), coverageScope, options || {}, SURVEY_MPP, MASK_TARGET_PIXELS
        );
    }

    /** This slide's cached surveys, in least-recently-used order. */
    private *_surveysOf(slideKey: string): Generator<SlideSurvey> {
        for (const [key, survey] of this._surveys) {
            if (isKeyOfSlide(key, slideKey)) yield survey;
        }
    }

    /**
     * The best cached survey for `bounds` on this slide: the one that covers the box at the
     * finest mask resolution over it. See `pickSurvey`.
     */
    private _surveyCovering(viewer: any, bounds?: Bounds): SlideSurvey | null {
        const slideKey = this._slideKey(viewer);
        return slideKey ? pickSurvey(this._surveysOf(slideKey), bounds) : null;
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
        // both use the same transform.
        await this._waitForViewerSettled(viewer);
        // Settling is the only thing worth waiting for here. This reads the view the USER is
        // looking at, so it is faithful by construction — if tiles are missing they are missing on
        // screen too, and waiting would return a view the user never saw (and one that no longer
        // matches where they have navigated to since). Measure instead, and report it: a mask over
        // blanks still must not be treated as the slide, because a hole reads as background and
        // silently shrinks every tissue island in it.
        const viewerLoaded = viewer?.getFullyLoaded?.() === true;

        const viz = this._visualizationApiFor(viewer);
        if (!viz?.renderCurrentBackgroundPixels) {
            throw new Error("The visualization API is unavailable; cannot read the background image.");
        }
        const canvas = viewer?.drawer?.canvas;
        const deviceWidth = canvas?.width || 0, deviceHeight = canvas?.height || 0;
        const size = this._rasterRenderSize(deviceWidth, deviceHeight, readOpts);
        const res = await withTimeout<RawPixelsResult & { isComplete?: boolean }>(
            viz.renderCurrentBackgroundPixels({
                maxPixels: readOpts?.targetPixels ? MASK_MAX_PIXELS : 64_000_000,
                pixelFormat: "typed",
                ...(readOpts?.label ? { label: readOpts.label } : {}),
                ...(size ? { width: size.width, height: size.height } : {}),
            }),
            // This path reads the LIVE viewport and never waits for tiles, so there is no internal
            // budget to sit above — the guard is purely a wedge guard here.
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
            // Both must hold, and both degrade closed: `viewerLoaded` is this call's own measurement
            // before the read, `res.isComplete` is the core's at read time (a core too old to report
            // it counts as incomplete). Either being false means pixels that must not be measured,
            // cached, or described to a model as the slide.
            isComplete: viewerLoaded && res.isComplete === true,
            // Nothing waited, so nothing gave up: a live-viewport read is never "stalled".
            stalled: false,
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
        const meta = this._slideMeta(viewer, this._ref(viewer));
        return padBounds(bounds, padding, meta.width, meta.height);
    }

    /**
     * The ladder rung a node at `depth` is read at — the depth, floored at the finest rung
     * the ladder has. The one place that arithmetic lives, because the redundancy gate and
     * the field planner must agree on what "as closely" means.
     */
    private _rungOf(depth: number, ladder: OverviewLadder): number {
        return Math.min(Math.max(0, depth), ladder.magnifications.length - 1);
    }

    /**
     * The merge thresholds this deployment segments regions by, or null when an operator
     * turned the merge off. See {@link REGION_MERGE_IOU} for why it lives in static meta.
     */
    private _regionMergeOptions(): { iou: number; containment: number } | null {
        const configured = this.getStaticMeta("regionMerge", undefined) as
            | boolean | { iou?: number; containment?: number } | undefined;
        if (configured === false) return null;
        const from = (configured && typeof configured === "object") ? configured : {};
        return {
            iou: clampNumber(from.iou, REGION_MERGE_IOU, 0, 1),
            containment: clampNumber(from.containment, REGION_MERGE_CONTAINMENT, 0, 1),
        };
    }

    /**
     * Number a set of SIBLING regions the way a reviewer reads the slide.
     *
     * The array order is left alone: it is priority order, and it decides what gets rendered,
     * what gets a vision call and what a `slice(0, n)` keeps. This rewrites only `index` and
     * `label` — the region's identity for the user, for a region link and for every
     * label-addressed lookup (`_rootIdOf`, `applyPlanEdits`).
     *
     * Nothing indexes these arrays by `region.index`; it is copied onto nodes and pushed into
     * `path`, which is what makes the two orders separable at all.
     */
    private _numberByReadingOrder(regions: SlideRegion[]): SlideRegion[] {
        if (regions.length < 2 || this._regionOrderMode() !== "reading") return regions;
        const ranks = readingOrder(regions);
        return regions.map((region, at) => ({
            ...region,
            index: ranks[at],
            label: regionLabel([ranks[at]]),
        }));
    }

    /**
     * The same regions, most tissue first.
     *
     * Every "take the top N islands" in this module used to be a prefix of a list that
     * happened to be area-sorted. Numbering is spatial now and `exploreSlide` hands its list
     * back in that order, so a prefix would silently mean "the leftmost N" — which is a
     * budget decision made by slide layout. Callers that mean size now say so.
     */
    private _byTissueFirst(regions: SlideRegion[]): SlideRegion[] {
        return regions.slice().sort((a, b) => (b.areaFraction ?? 0) - (a.areaFraction ?? 0));
    }

    /**
     * How region numbers are assigned — a DEPLOYMENT knob, like `regionMerge`.
     *
     * It shapes every label the cached survey and the whole traversal carry, and labels are
     * what a plan edit and a region link address, so a session bundle must not be able to
     * change it (AGENTS.md §7). `"area"` restores the legacy size-rank numbering.
     */
    private _regionOrderMode(): "reading" | "area" {
        return this.getStaticMeta("regionOrder", "reading") === "area" ? "area" : "reading";
    }

    /**
     * A render budget, in ms, overridable per deployment.
     *
     * The defaults are guesses about tile latency made on one network. A WAN-hosted DICOMweb
     * store invalidates all of them at once, and the symptom — every field reported unread — is
     * indistinguishable from a broken slide unless an operator can move the number. Static meta,
     * not `getOption`: this decides how long the viewer waits on a backend, so a session bundle
     * must not be able to set it (AGENTS.md §7).
     *
     * Clamped rather than trusted: a zero or negative budget would make every render fail
     * instantly, and an unbounded one would let the walk wedge for the scripting layer's hour.
     */
    private _budget(key: string, fallback: number): number {
        return clampNumber(this.getStaticMeta(key, undefined) as number | undefined, fallback, 500, 300_000);
    }

    /**
     * Collapse region boxes describing the same tissue, then renumber.
     *
     * Renumbering is not cosmetic: `label` is the only identity a region has for the user
     * and for a region link, and `index` addresses the array. A merge that left "region 1,
     * region 3, region 4" behind would put a gap in the user's numbering and a stale index
     * on every child path derived from it.
     */
    private _mergeRegions(regions: SlideRegion[]): SlideRegion[] {
        const options = this._regionMergeOptions();
        if (!options || regions.length < 2) return regions;
        const merged = mergeOverlappingBounds(regions, options);
        if (merged.length === regions.length) return regions;
        return merged.map((region, index) => ({
            ...region,
            index,
            label: regionLabel([index]),
            center: centerOf(region.bounds)!,
        }));
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
            /**
             * Why this region is being read. Purely diagnostic — carried on the core
             * `region-capture` event so the capture indicator can tell the user which
             * part of the slide was analyzed and for what. Translate at the call site.
             */
            label?: string;
        }
    ): Promise<RegionRaster> {
        const { region, aspect, nativeMag } = this._regionRenderGeometry(viewer, bounds);

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

        return this._renderRegionAt(viewer, bounds, region, nativeMag, {
            outWidth,
            layers: opts?.layers,
            timeoutMs: opts?.timeoutMs,
            label: opts?.label,
        });
    }

    /**
     * Render one planned {@link Field} at EXACTLY the resolution it was planned for.
     *
     * This is the path that closes the module's oldest correctness hole. Its sibling
     * {@link _renderRegionRaster} is a *budget* renderer: it takes a magnification, works
     * out a raster size, and then clamps the area into a pixel ceiling — which on a
     * whole-slide image is not a rare edge case but the normal outcome. A 15 mm island
     * asked for 1 µm/px came back at ~4.3 µm/px while the prompt kept quoting 1 µm/px, so
     * the vision model was invited to answer questions whose evidence had been scaled out
     * of the image before it ever arrived.
     *
     * A field carries the raster size the planner already proved fits one call, so there
     * is nothing left to clamp. Three deliberate differences:
     *
     * - **Both dimensions are passed.** The core re-fits the requested box to the region's
     *   aspect (`visualization-api.ts`); handing it a size already at that aspect makes the
     *   refit a no-op instead of a silent letterbox.
     * - **`maxPixels` is the field's own size, not a global ceiling.** The core's guard
     *   THROWS above it, so this turns a limiter into a tripwire: a clamp that should be
     *   impossible fails loudly rather than degrading the resolution behind the prompt.
     * - **The delivered resolution is measured and checked**, never assumed.
     *
     * ## Attempts
     *
     * A failed render is retried, up to {@link FIELD_RENDER_ATTEMPTS}, because the common failure
     * is a slow tile server rather than an unreadable region — and a walk that turns one slow
     * region into `not-assessable` reports a clinical-sounding non-answer for an infrastructure
     * problem. The escalation and its stopping rules are in {@link _attemptFieldRender}.
     */
    private async _renderField(
        viewer: any,
        field: Field,
        opts?: { layers?: "background" | "active"; timeoutMs?: number; label?: string }
    ): Promise<FieldRaster> {
        const slideMpp = this._micronsPerPixel(viewer);
        let lastError: any = null;

        for (let attempt = 0; attempt < FIELD_RENDER_ATTEMPTS; attempt++) {
            // What this attempt asks for — the field as planned, or one rung coarser once
            // retrying at full resolution has stopped helping. See `fieldRenderAttempt`.
            const asked = fieldRenderAttempt(field, attempt);
            const requestedMpp = asked.mpp;

            // Re-derived per attempt: `_regionRenderGeometry` reads the live world, and a
            // virtual-region crop can map the same parent-global bounds to a different local
            // extent than the planner sized against.
            const { region, nativeMag } = this._regionRenderGeometry(viewer, field.bounds);
            const size = rasterSizeFor(region, asked.downsample);

            let raster: RegionRaster;
            try {
                raster = await this._renderRegionAt(viewer, field.bounds, region, nativeMag, {
                    outWidth: size.width,
                    outHeight: size.height,
                    // +1 row of slack absorbs the renderer's own rounding without admitting a clamp.
                    maxPixels: size.width * size.height + size.width + 1,
                    layers: opts?.layers,
                    timeoutMs: opts?.timeoutMs,
                    label: opts?.label,
                });
            } catch (e) {
                lastError = e;
                if (!this._shouldRetryRender(e, attempt)) throw e;
                continue;
            }

            const deliveredMpp = slideMpp ? slideMpp * raster.scale : null;
            const mppExact = isMppExact(region, raster.width, slideMpp, requestedMpp);
            if (!mppExact) {
                // Not a warning to pass to the model — a defect in the planner or the render
                // path. Loud, with the numbers needed to tell which.
                console.error("[pathology-foundation] field resolution drift", {
                    field: field.id, requestedMpp, deliveredMpp,
                    planned: size, delivered: { width: raster.width, height: raster.height },
                });
            }
            return {
                ...raster,
                requestedMpp,
                deliveredMpp,
                downsample: raster.scale,
                mppExact,
            };
        }
        throw lastError ?? new Error("Failed to render the requested slide region.");
    }

    /**
     * Whether a failed field render is worth attempting again.
     *
     * Two failures are deliberately NOT retried:
     *
     * - A queue timeout. The pass never started because passes ahead of it are still running;
     *   re-submitting adds to the very queue that rejected it, and delays everything behind it.
     * - The last attempt, obviously — but stated as a rule so the caller cannot loop.
     *
     * A `stalled` render is a third non-retryable case, but it never reaches here: `stalled`
     * comes back as a RESULT (`isComplete: false`), not a throw, and the field reports it as the
     * partial read it is. See `_renderRegionAt`.
     */
    private _shouldRetryRender(error: any, attempt: number): boolean {
        if (attempt >= FIELD_RENDER_ATTEMPTS - 1) return false;
        if (error?.name === "QueueTimeoutError") return false;
        return true;
    }

    /**
     * Parent-global bounds → the ref-local region the renderer works in, plus the
     * scalebar basis both render paths quote magnification against.
     */
    private _regionRenderGeometry(viewer: any, bounds: Bounds): {
        region: Bounds; aspect: number; nativeMag: number | null;
    } {
        if (!viewer) throw new Error("A viewer is required.");
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
            throw new Error("A region with positive width and height is required.");
        }
        const ref = this._ref(viewer);
        const cropped = this._croppedSourceOf(ref);

        // parent-global → ref-local (identity when the slide is not a virtual-region crop)
        const toLocal = (x: number, y: number): Point =>
            cropped ? cropped.fromParentImageCoordinates({ x, y }) : { x, y };
        const tl = toLocal(bounds.x, bounds.y);
        const br = toLocal(bounds.x + bounds.width, bounds.y + bounds.height);
        const region: Bounds = {
            x: Math.min(tl.x, br.x),
            y: Math.min(tl.y, br.y),
            width: Math.abs(br.x - tl.x),
            height: Math.abs(br.y - tl.y),
        };
        if (!(region.width > 0) || !(region.height > 0)) {
            throw new Error("The requested region maps to an empty area of the slide.");
        }
        return { region, aspect: region.width / region.height, nativeMag: viewer?.scalebar?.magnification || null };
    }

    /** The shared render + raster assembly behind `_renderRegionRaster` and `_renderField`. */
    private async _renderRegionAt(
        viewer: any,
        bounds: Bounds,
        region: Bounds,
        nativeMag: number | null,
        opts: {
            outWidth: number;
            outHeight?: number;
            maxPixels?: number;
            layers?: "background" | "active";
            timeoutMs?: number;
            label?: string;
        }
    ): Promise<RegionRaster> {
        const viz = this._visualizationApiFor(viewer);
        if (!viz?.renderRegionPixels) {
            throw new Error("The visualization API is unavailable; cannot render the slide region.");
        }
        const refIndex = this._worldIndexOf(viewer, this._ref(viewer));
        // The render's own tile-load budget — a REAL wait now, so the default is the bounded one.
        // A caller that knows its render is worth more (the survey, whose coverage decides the whole
        // walk) opts into a longer budget explicitly; everything else, including any call site added
        // later, gets the value that keeps a serialized multi-field walk from running for minutes.
        const loadBudgetMs = opts.timeoutMs ?? this._budget("fieldLoadTimeoutMs", FIELD_LOAD_TIMEOUT_MS);
        // The wait for a TURN at rendering, which the core owns (it owns the queue and the
        // scheduler) and now bounds on request. Before it existed this wait was unbounded and
        // uncounted, and the wedge guard below — whose clock starts here, not at admission —
        // was firing on renders that had not begun.
        const queueBudgetMs = this._budget("renderQueueTimeoutMs", RENDER_QUEUE_TIMEOUT_MS);
        const res = await withTimeout<RawPixelsResult & { isComplete?: boolean; stalled?: boolean }>(
            viz.renderRegionPixels({
                region,
                size: {
                    width: opts.outWidth,
                    ...(opts.outHeight ? { height: opts.outHeight } : {}),
                },
                layers: opts.layers ?? "background",
                refIndex,
                pixelFormat: "typed",
                maxPixels: opts.maxPixels ?? 64_000_000,
                ...(opts.label ? { label: opts.label } : {}),
                timeoutMs: loadBudgetMs,
                queueTimeoutMs: queueBudgetMs,
            }),
            // Strictly above BOTH budgets — see RENDER_GUARD_SLACK_MS. Sized against either one
            // alone, the guard measures an interval the core is not bounding, and a fully-spent
            // budget becomes a throw that discards the partial it earned.
            queueBudgetMs + loadBudgetMs + RENDER_GUARD_SLACK_MS,
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
            // The core contract (visualization-api: "fullyLoaded alone can be true over holes")
            // says only `isComplete && !stalled` is a faithful read of the region. Folded in HERE,
            // at the one place a raster is produced, so every consumer degrades closed without each
            // of them having to remember. `stalled` stays on the object for the retry decision.
            isComplete: res.isComplete !== false && res.stalled !== true,
            stalled: res.stalled === true,
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

    // ---- capture (on-screen composite) + mask→polygon infra ----

    /**
     * Capture the on-screen composite of a viewer as a PNG blob (device pixels).
     * Includes the visualization overlay — used only where that is desirable
     * (the `analyze` feature). Tissue/segment read the raw background instead
     * (see {@link _readBackground}). The SAM plugin also delegates here.
     *
     * Settles the view and then WAITS for the pyramid, because this reads the on-screen canvas:
     * whatever is painted at that instant is the entire capture. A frame grabbed mid-stream is
     * blank where tiles have not landed, and sending that to a vision model as the view is how a
     * model came to describe empty canvas as tissue. `isComplete` reports the outcome — false when
     * the wait timed out and the blob really does hold partially-streamed tiles.
     */
    async captureViewportImage(
        viewer: any,
        label?: string
    ): Promise<{ blob: Blob; width: number; height: number; isComplete: boolean } | null> {
        const sourceCanvas = viewer?.drawer?.canvas;
        if (!sourceCanvas || sourceCanvas.width < 1) {
            console.error("[pathology-foundation] no viewport canvas available to capture.");
            return null;
        }

        // Settle the springs — a capture mid-flight reads the wrong PLACE, which no flag can
        // describe. Then measure, do not wait: what is painted is what the user is looking at.
        await this._waitForViewerSettled(viewer);
        const isComplete = viewer?.getFullyLoaded?.() === true;
        if (!isComplete) {
            console.warn("[pathology-foundation] viewport capture holds partially loaded tiles.");
        }

        // This path reads the on-screen canvas directly instead of going through the
        // core visualization API, so it must announce itself: otherwise a composite
        // grab would be the one capture the user never sees. Same event contract as
        // src/classes/scripting/visualization-api.ts (see src/EVENTS.md).
        const captureId = `pf-view-${++PathologyFoundation._viewCaptureSeq}`;
        const announce = (phase: "start" | "end", ok?: boolean) => {
            try {
                viewer?.raiseEvent?.("region-capture", {
                    captureId, phase, kind: "viewport",
                    label: label || t("pathology.captureViewport"),
                    ...(phase === "end" ? { ok: ok !== false } : {}),
                });
            } catch (e) { /* indicator must never break a capture */ }
        };
        announce("start");

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

        return new Promise<{ blob: Blob; width: number; height: number; isComplete: boolean } | null>(resolve => {
            ctx!.canvas.toBlob(blob => {
                if (!blob) {
                    console.error("[pathology-foundation] failed to capture viewport image.");
                    announce("end", false);
                    resolve(null);
                    return;
                }
                announce("end", true);
                resolve({ blob, width, height, isComplete });
            }, "image/png");
        });
    }

    /**
     * All non-inner (outer) contours of a binary mask, in mask pixel space.
     *
     * `bounds` is INCLUSIVE here — magic-wand's own producers set `maxX = xr - 1` and its
     * `prepareMask` loops `x < maxX + 1`. Passing the exclusive `mask.width` made it read
     * `data[y * width + width]`, which is the FIRST PIXEL OF THE NEXT ROW, and paint it into
     * the padded mask's right-hand border column — the column the tracer requires to be
     * empty. Tissue at the left edge of row y+1 therefore bridged row y down the right edge,
     * silently merging components that share no boundary at all. On a scoped biopsy that is
     * enough to turn several cores into one contour spanning the whole scope.
     */
    private _traceOuterContours(mask: MaskResult): Point[][] {
        this.MagicWand = this.MagicWand || OSDAnnotations.makeMagicWand();
        const contours = this.MagicWand.traceContours({
            data: mask.binaryMask,
            width: mask.width,
            height: mask.height,
            bounds: { minX: 0, minY: 0, maxX: mask.width - 1, maxY: mask.height - 1 },
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
        const filledPixels = countFilled(binaryMask);

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
