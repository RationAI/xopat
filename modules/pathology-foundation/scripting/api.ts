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

/**
 * Densest cells returned with a density map.
 *
 * The map itself crosses the bridge in full (`values`), so this is not a cap on information —
 * it is the ranked shortlist a caller acts on, sized to the largest montage a single call can
 * carry. More than that and the "consult this before spending a budget" step costs more to read
 * than the budget it protects.
 */
const DENSITY_TOP_SPOTS = 12;

const PATHOLOGY_DTS = `
export type PathologyFeature = "tissue-mask" | "segment" | "analyze" | "cellularity";

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
     * pattern, 0.5 for glandular/cellular detail, 0.25 for nuclear detail.
     *
     * A field coarser than this records the feature as "not-assessable" WITHOUT spending a
     * model call — but only while a finer read is still reachable. Once the walk is at the
     * slide's own resolution there is nothing to defer to, so the feature is asked anyway
     * and its answers come back flagged \`belowRequested\`. Kept exactly as stated even when
     * the slide cannot meet it; see \`EvidenceRow.beyondSlide\`.
     */
    requiredMpp: number;
    /** 0..1, how much this feature matters to the question (default 1). */
    weight?: number;
};

/** The set of questions a run obeyed, and where they came from. */
export type Checklist = {
    features: ChecklistFeature[];
    /**
     * "derived" — a model wrote it from the query. "fallback" — generic run-quality gates,
     * NOT findings: never table them, and say in one sentence that the run had no specific
     * question to work from.
     */
    source: "explicit" | "derived" | "fallback";
    /**
     * With "fallback": why no real checklist was derived. "no-query" is the only one the
     * user can act on — the others are deployment problems, so do not tell the user to
     * rephrase their question when one of them is set.
     */
    fallbackReason?: "no-query" | "no-model" | "unparseable" | "error";
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
    /**
     * Why it was not assessable. Each one calls for different advice — do not summarize them
     * all as "the model could not tell":
     *
     * - \`"resolution"\` — the image was too coarse. Offer a closer look.
     * - \`"model"\` — the model saw the image and could not tell.
     * - \`"unparsed"\` — the model replied, but said nothing about this feature.
     * - \`"unread"\` — **no image was produced at all** (the render failed or timed out).
     *   Nothing was looked at. The fix is to run the request again; suggesting a closer look
     *   or a smaller region is wrong advice, because resolution was never the problem.
     */
    reason?: "resolution" | "model" | "unparsed" | "unread";
    /**
     * The feature was answered at a resolution COARSER than it asked for, because the scan
     * holds nothing finer. A real answer — but say what it was formed at, and do not offer
     * a closer look, because there is none.
     */
    belowRequested?: boolean;
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
    /**
     * Internal bookkeeping — **never print it**. A reader cannot act on "27 of 28 fields":
     * cite the regions in \`citedBy\`, which they can go and look at.
     */
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
    /**
     * True when this feature asks for finer detail than the SCAN itself holds — a fact about
     * the slide, not about the walk.
     *
     * The row still carries real answers: the feature is asked at the slide's limit rather
     * than skipped. What you must NOT do is offer to look closer, because no such read
     * exists — say the answers were formed below the resolution the question asked for.
     */
    beyondSlide: boolean;
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
    /**
     * Below 1 when the region was sampled rather than fully covered, or when a field failed to
     * render. Say so if you report it.
     */
    coveredFraction: number;
    isComplete: boolean;
    /**
     * Image-level problems, in plain words. Present only when there were some.
     *
     * READ THIS BEFORE INTERPRETING \`answers\`. A checklist of \`not-assessable\` looks identical
     * whether the model examined the fields and could not tell or whether no image was ever
     * produced, and those need opposite advice. When this is present, relay it and follow the
     * next step it names — do not tell the user to zoom in or narrow the region on your own
     * reading of the answers.
     */
    warnings?: string[];
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
    /** Grid CELLS, not pixels. One cell is \`bounds.width / width\` by \`bounds.height / height\`. */
    width: number;
    height: number;
    /** Row-major, 0..1, normalized against the 95th percentile. */
    values: number[];
    /**
     * "saturation-fallback" means the stain class made nuclear unmixing meaningless, so
     * these values rank stain intensity rather than nuclei.
     */
    method: "nuclear-deconvolution" | "saturation-fallback" | "driver";
    /**
     * The densest cells as boxes, densest first — hand these straight to \`interrogateRegion\`
     * or \`montageRegions\`. Plain data: everything a script result carries must survive being
     * copied, so this is a precomputed array, never a method to call.
     */
    topSpots: Array<{ bounds: Bounds; value: number }>;
};

/** One connected tissue island found by exploreSlide. */
export type SlideRegion = {
    /** 0-based reading-order rank — INTERNAL. Never show it to the user; use \`label\`. */
    index: number;
    /**
     * How to NAME this region to the user, counted from 1 in slide reading order: "region 1"
     * is the first fragment on the glass, NOT the largest or the most interesting one.
     */
    label: string;
    /** Whole level-0 image pixels: use as a region link's x/y/w/h, or feed to viewer.frameImageRegion(bounds). */
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
    /** Fraction of \`scopeBounds\` covered by tissue (0..1) — the whole slide unless scoped. */
    slideCoverage: number;
    /**
     * What slideCoverage and regions refer to. QUOTE THIS SCOPE when reporting the numbers:
     * "whole-slide" is a slide-wide read; "current-view" and "region" cover \`scopeBounds\`
     * ONLY, and reporting either as a slide-wide finding is wrong.
     */
    coverageScope: "whole-slide" | "current-view" | "region";
    /** The rectangle actually surveyed, in whole image pixels. */
    scopeBounds: Bounds;
    /**
     * False when the slide's tiles were still streaming when the overview was
     * captured — slideCoverage/regions are then PROVISIONAL and likely understated.
     * Report them as provisional ("the overview did not finish loading"); do NOT
     * assert the slide has little/no tissue from an incomplete overview.
     */
    isComplete: boolean;
    /**
     * Tissue islands in slide reading order — the order their numbers count in, so walking
     * this list walks the slide. Sort by \`areaFraction\` when you need the biggest.
     * Empty when the slide looks blank.
     */
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

/**
 * A costed, not-yet-run walk (see planOverview). Nothing here cost a vision call.
 *
 * Read it as "this is what the scan will cover". \`regions\` are the tissue islands the walk
 * will read, in slide order, each with the tissue share of its box (\`fill\`) and a free local
 * nuclear-density prior (\`cellularity\`) — the two numbers that say whether a box is worth a
 * call before anything has looked at it.
 */
export type OverviewPlan = {
    planId: string;
    coverageScope: "whole-slide" | "current-view" | "region";
    scopeBounds: Bounds;
    /** The questions the run WILL ask. \`source: "fallback"\` here is worth fixing before running. */
    checklist: Checklist;
    /** The resolution rungs the walk will climb. */
    ladder: { magnifications: Array<number | null>; targetMpp: Array<number | null> };
    regions: Array<{
        label: string;
        bounds: Bounds;
        areaFraction: number;
        /** Tissue share of the box, 0..1, from the cached mask. Null when unmeasured. */
        fill: number | null;
        /** Nuclear density prior, 0..1. Null when the driver has no density feature. */
        cellularity: number | null;
    }>;
    /**
     * Regions that still share part of their box. Boxes that ARE the same box have already
     * been merged, so what is left is a judgement call: if two entries look like one piece of
     * tissue, \`drop\` one when you call \`runPlan\` rather than paying to read it twice.
     */
    overlapPairs: Array<{ a: string; b: string; iou: number }>;
    /** Vision calls the coverage pass will spend. Depth is adaptive and is NOT estimated. */
    estimatedSurveyCalls: number;
    maxAnalyzeCalls: number;
    slideCoverage: number;
    /** False = the slide was still loading. Plan again rather than running this. */
    surveyComplete: boolean;
    /** Tissue regions the root cap left out — the run will never reach them. Say so if above 0. */
    regionsOmitted: number;
    builtAtIso: string;
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
    /** Parent-global, whole level-0 image pixels: use as a region link's x/y/w/h, or feed to viewer.frameImageRegion(bounds). */
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
    /**
     * Tissue the box actually holds, in µm² (level-0 px² on an uncalibrated slide).
     *
     * The absolute figure \`bboxFillFraction\` is a ratio of: a sparse box over a real core is
     * still a lot of tissue. Use this, not the fraction, when saying how much tissue a region
     * represents. Null when fill was never measured.
     */
    tissueArea?: number | null;
    /**
     * Normalized nuclear density of the box (0..1), or null when no density map exists.
     *
     * A local measurement, not a model opinion — lets a report say "low-cellularity area, not
     * examined closely" instead of silently omitting the region.
     */
    cellularity?: number | null;
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
    /**
     * CHECK THIS FIRST.
     *
     * "ok" — at least one question was read at a resolution that can answer it; report the
     * rows that were, and say which were not (\`isComplete\`, \`evidence[].underResolved\`).
     * "incomplete" — NONE was. The slide was still loading, or the walk never got close enough
     * to the tissue. Report the LIMITATION and what would fix it (wait and re-run, or
     * \`refineOverview\`); do NOT write findings from the region prose, which describes
     * architecture at low power and reads exactly like an examination that never happened.
     */
    status: "ok" | "incomplete";
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
    /** Tissue coverage (0..1) of \`scopeBounds\` — the whole slide unless the walk was scoped. */
    slideCoverage: number;
    /**
     * Anything other than "whole-slide" means the walk covered \`scopeBounds\` ONLY. Say so:
     * "no X found" inside one region is not "no X on this slide". \`warnings\` repeats it.
     */
    coverageScope: "whole-slide" | "current-view" | "region";
    /** The rectangle the walk was confined to, in whole image pixels. */
    scopeBounds: Bounds;
    /**
     * Was the tissue actually EXAMINED? False while any question was left unanswered or was
     * only ever met at too coarse a resolution. Findings must not be written from a result
     * with \`isComplete: false\` — say what could not be read instead.
     */
    isComplete: boolean;
    /**
     * False when the survey render ran on a partially-loaded slide: coverage and the region
     * list are then provisional and UNDERSTATED, never evidence that a slide is blank.
     */
    surveyComplete: boolean;
    /**
     * Top-level tissue islands, each a subtree, in slide reading order — the order their
     * numbers count in, so listing them walks the slide. Coarse: prefer 'ranked' for
     * navigation, and this for saying which fragment is which.
     */
    root: OverviewNode[];
    /**
     * Flat focal regions ordered by rankScore — the model's interest weighted by how much
     * its ancestors believed in it, its stated confidence, and how much slide and real
     * tissue its box holds. USE THIS ORDER, not raw interest: a high score on a sliver of
     * mostly-background under an uninteresting parent is exactly what the weighting demotes.
     * Each \`node.bounds\` is a tight, navigable window: LINK THESE. Link a coarse top-level
     * \`root\` box only when the user asked about a whole fragment or core — a link to a whole
     * island just re-frames the slide the user is already looking at.
     */
    ranked: OverviewNode[];
    /**
     * **THE BASIS FOR YOUR ANSWER — not the answer itself.** One row per question the run
     * asked, with the aggregate verdict and the regions that evidence it. Read it, then
     * write PROSE that answers what the user actually asked, in their words.
     *
     * **LINK EVERY REGION YOU NAME.** \`citedBy[i].bounds\` are whole image pixels and map
     * straight to a link's \`x, y, w, h\`; \`citedBy[i].label\` is the link text. Naming a
     * region in prose without linking it leaves the user unable to find it. This is not a
     * follow-up offer to make — emitting the link IS how the user gets there.
     *
     * Reporting rules:
     * - **Lay the rows out as a table only when all three hold:** \`checklist.source\` is not
     *   \`"fallback"\`, more than one feature was asked, AND the user asked for a structured
     *   or tabular report. Otherwise weave the one to three decisive rows into the prose.
     * - \`verdict: "not-assessable"\` and \`underResolved: true\` mean the run never got a
     *   close enough look. Say that, and offer \`interrogateRegion\` — do NOT report the
     *   feature as absent.
     * - Findings are model-assisted observations supporting the pathologist's own read,
     *   never a diagnosis. That is ONE closing clause, not a section heading.
     */
    evidence: EvidenceRow[];
    /**
     * The questions the run obeyed.
     *
     * \`source: "fallback"\` means no checklist was derived and the run scored regions against
     * three GENERIC RUN-QUALITY GATES — \`match\` ("does this look like what was asked"),
     * \`extent\`, \`quality\`. They say whether the run could see anything at all; they are not
     * findings about the tissue. **Never table them and never present them as clinical
     * results.** Say in one sentence that the run had no specific question to work from, name
     * a better question to ask (or read \`fallbackReason\` — a setup failure is not something
     * rephrasing fixes), and report the region prose for what it is: architecture only.
     */
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
     * Caveats that MUST reach the user (unparsed scores, unknown slide context,
     * cancellation, truncation). Never present an overview as complete/authoritative
     * while this is non-empty.
     *
     * Fold them into ONE short \`Limitations:\` line at the end — condensed, in your own words,
     * nothing dropped. The exception is a safety matter: a caveat that INVALIDATES the run
     * leads, above any finding — the slide was still loading when surveyed, the survey looks
     * implausible, nothing was read closely enough to be an examination, the walk stalled with
     * budget unspent, or it covered one area rather than the slide. Those change what the
     * findings MEAN, so the user must read them first.
     */
    warnings: string[];
    /** ISO timestamp the overview was built (freshness for reuse). */
    builtAtIso: string;
    /**
     * Budget accounting — WHY the walk stopped, which decides how you report it.
     *
     * \`converged: true\` — it ran out of tissue worth reading before it ran out of calls.
     * That is a COMPLETE walk and the normal outcome; leftover budget is not a shortfall.
     * Do not call it partial, do not apologize for the call count, do not offer
     * \`refineOverview\`.
     *
     * \`truncated: true\` — a cap stopped it with work still queued. Offer \`refineOverview\`.
     *
     * \`focusUnspent\` above 0 while \`converged\` is false, alongside any \`underResolved\` row,
     * is the serious one: the walk stopped with calls available because it never found a
     * region it was willing to read closely. Nothing was examined in detail — say so, do not
     * present it as a completed examination, and offer \`interrogateRegion\` on the top-ranked
     * region. \`plannedNotRead\` counts fields planned and never read: that area was skipped.
     *
     * \`skippedRedundant\` is the OPPOSITE of a gap and must never be reported as one: that
     * tissue had already been read at the same resolution or better. Budget saved, not
     * coverage lost — do not mention it unless the user asks what the run cost.
     */
    budget: {
        analyzeCalls: number; repairCalls: number; nodesVisited: number; truncated: boolean;
        converged: boolean; focusUnspent: number; plannedNotRead: number; skippedRedundant: number;
        /** Times this tree has been continued with refineOverview. Figures above are cumulative. */
        refinements: number;
    };
};

export type BuildOverviewOptions = {
    /**
     * Target feature to hunt for ("tumour", "necrosis", ...); absent = generic salience.
     * Keep it a short phrase: when a node's verdict cannot be scored, the fallback ranks it
     * by the fraction of query words present, so piling on terms dilutes every region's score.
     */
    query?: string;
    /**
     * WHERE to explore. Default "slide" — the whole slide.
     *
     * Pass "viewport" when the user's question is anchored to what they are looking at
     * ("here", "this area", "what am I seeing", "go through this bit"). It is a HARD
     * restriction, not a hint: the survey, the islands and every drill stay inside the
     * current view, and the same budget spread over a small box reads it far more closely
     * than a whole-slide walk ever does. An explicit {x, y, width, height} (whole image
     * pixels, e.g. a node's \`bounds\`) confines the walk to that box.
     *
     * The result's \`coverageScope\` / \`scopeBounds\` then say what was covered, and a
     * scoped run must NOT be reported as a slide-wide finding.
     */
    scope?: "slide" | "viewport" | Bounds;
    /**
     * Resolution of the orientation pass, µm/pixel. LEAVE IT UNSET — the default is derived
     * from the scope, opening a small one as finely as it affords. Ignored if uncalibrated.
     */
    surveyMpp?: number;
    /** Raster budget for the survey render, in pixels (default 2000000, max 4000000). */
    surveyPixels?: number;
    /** Tissue islands the survey pass covers (default 12). */
    maxRoots?: number;
    /** Slack left around each framed region, as a fraction of its size (default 0.1, max 0.5). */
    framePadding?: number;
    /** Raster budget for ONE vision call, in pixels (default 2000000, max 8000000). */
    fieldPixels?: number;
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
    /**
     * Max recursion depth. LEAVE IT UNSET — the default is the run's own ladder length, and
     * lowering it caps the walk ABOVE the resolution the question needs, so every field then
     * answers "too coarse to tell".
     */
    maxDepth?: number;
    /** Fields read per expansion (default 4). Does NOT widen the survey — that is \`maxRoots\`. */
    breadth?: number;
    /**
     * Explicit objective magnification per depth; null = fit the region. LEAVE IT UNSET — by
     * default each depth targets a resolution derived from the slide's own calibration.
     */
    magnificationLadder?: Array<number | null>;
    /** Drill only when interest is at least this (default 0.5). */
    interestThreshold?: number;
    /**
     * Least tissue a box must hold before it is worth drilling, in µm² (level-0 px² on an
     * uncalibrated slide). LEAVE IT UNSET — the default is derived from the run's own numbers.
     */
    minDrillTissue?: number;
    /**
     * CEILINGS, not targets (default 28 vision calls / 36 regions). The walk stops as soon as
     * the frontier holds nothing worth reading — \`budget.converged\` says when it did — so most
     * runs finish well under these. Do NOT raise them to make a run "more thorough": that only
     * changes where a run that was already going to stop early would have been cut off.
     */
    maxAnalyzeCalls?: number;
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
     * ORIENTATION ONLY — it finds WHERE the tissue is and does NOT examine it.
     *
     * **If the user asked to explore, scan, review, go through or report on anything, they do
     * NOT mean this call — they mean \`buildOverview\`.** This one returns boxes, not findings:
     * one low-resolution render and a tissue mask. Presenting its output as an examination is
     * how "explore this core" turns into a single screenshot and a shrug, so use it as the cheap
     * step BEFORE doing work, never as the answer.
     *
     * Detects tissue and returns the tissue islands (\`regions\`, in slide reading order — rows
     * top to bottom, left to right, which is the order their numbers count in) plus
     * \`slideCoverage\` over \`scopeBounds\` and slide metadata. Sort by \`areaFraction\` when
     * size is what you need; the numbering is about WHERE a fragment is. Rendered OFF-SCREEN —
     * the user's viewport never moves, and they can keep navigating while it runs.
     *
     * Use it to orient BEFORE acting on the slide — but only once you are already acting on it
     * at the user's request: do not call it to answer a question that is not about where the
     * tissue is, and do not call it "just to look".
     *
     * Offer navigation to a result with \`viewer.frameImageRegion(regions[i].bounds)\`
     * — never zoom to guessed coordinates. If \`isComplete\` is false the overview ran on
     * partially-loaded tiles: report the numbers as provisional, do not assert the slide
     * is blank. Otherwise, if \`slideCoverage\` is ~0 or \`regions\` is empty, the surveyed
     * area looks blank; say so instead of hunting. \`slideCoverage\` covers \`scopeBounds\`
     * — whole-slide by default (contrast annotateTissue's \`viewCoverage\`, which is
     * current-view), and only that region when you passed a \`scope\`. The survey is
     * low-resolution, so bounds are approximate — follow up with a region-scoped
     * analyzeRegion, or annotateTissue after framing, for precision.
     * @param options.scope "slide" (default), "viewport", or {x, y, width, height} in whole
     *   image pixels. Pass "viewport" when the user's question is about what they are
     *   currently looking at — the same budget over a smaller box is a much finer survey.
     *   Then report the result as covering that area, NOT the slide.
     * @param options.surveyMpp resolution of the survey render, µm/pixel. Leave unset.
     * @param options.surveyPixels raster budget for the survey render (default 2000000, max 4000000).
     * @param options.annotate draw the islands as annotations (default false).
     * @param options.hint attach one coarse model note (needs an analyze driver; asks the user).
     * @param options.driver optional tissue-mask driver id.
     * @param options.minAreaFraction smallest island to report as a fraction of the surveyed area (default 0.001).
     */
    exploreSlide(options?: {
        driver?: string;
        annotate?: boolean;
        hint?: boolean;
        minAreaFraction?: number;
        scope?: "slide" | "viewport" | Bounds;
        surveyMpp?: number;
        surveyPixels?: number;
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
     * **THE HIERARCHICAL EXPLORATION CALL** — over the whole slide OR one region, via
     * \`scope\`. Also the most expensive call here.
     *
     * THIS IS WHAT "EXPLORE" MEANS. Run it whenever the user asks for exploration-shaped work,
     * **whether or not a region is named**: "explore", "exploration", "deep scan", "deep dive",
     * "go through", "survey", "walk me through", "review X and report the findings", "what is in
     * here", "report the findings", "is there cancer". A named target does not make it a
     * different job — it makes it a \`scope\`. Do NOT downgrade a scoped ask to \`exploreSlide\`
     * (that is orientation, it returns boxes) or to a single \`analyzeRegion\` (that is one
     * snapshot at one resolution): both leave the user with a screenshot where they asked for an
     * examination.
     *
     * It orients (as \`exploreSlide\` does), then walks the top tissue islands, describes each
     * with the vision model, scores them, and drills — into the interesting ones AND into any
     * it could not read at the resolution it had. Pass \`query\` with the feature you are hunting
     * for: it becomes the checklist the whole run obeys. See \`scope\` for WHERE it looks, and
     * note that an omitted \`scope\` follows the focus region rather than promising the slide.
     *
     * COST. It fires many slow vision calls — MINUTES the user waits on. Run it when they asked
     * for slide content, never speculatively (see the namespace description), and never on a
     * slide already scanned this session: the tree is cached, so try \`getOverview()\` first
     * (\`reuse: true\` returns the cache). It renders off-screen, so their view never moves.
     *
     * IF THE BUDGET RUNS OUT, CONTINUE — do not rebuild. \`budget.truncated\` and
     * \`budget.plannedNotRead\` mean there is more to do; \`refineOverview\` resumes where this
     * stopped, while calling this again re-surveys the slide and pays a second time for every
     * region already described. (\`budget.converged\` is the opposite and needs nothing.)
     *
     * CHECK \`status\` FIRST.
     * - "context-required": the walk did NOT run and nothing was analysed — see
     *   \`OverviewContextRequired\`. Ask for \`missing\` in ONE bundled question and call again.
     * - "incomplete": the walk settled NOTHING — the slide was still loading when surveyed
     *   (\`surveyComplete: false\`, and \`root\` is empty because nothing was walked), or it never
     *   read a region closely enough to answer anything. Report that, quote \`warnings\`, and say
     *   what would fix it: wait and call again for a loading slide, \`refineOverview\` for a
     *   stalled walk. Do NOT assemble findings out of the region prose — it describes low-power
     *   architecture and will read as an examination that did not happen.
     * - "ok" with \`isComplete: false\` is the milder case: some questions were settled and some
     *   were not. Report both; do not present it as finished.
     *
     * ACCURACY — when status is "ok":
     * - Report in \`ranked\` order, not by raw \`interest\`, and LINK every region you name.
     * - A node whose \`interest\` is null has NO score — say so; it is not a zero.
     * - A leaf with \`resolutionShortfall\` was read from too far away: its findings describe
     *   architecture, not cytology. Do not quote them as a close read, and do not turn that
     *   into a question for the user — call analyzeRegion on its \`bounds\` at a higher
     *   \`magnification\` and answer from what comes back.
     * - Warnings naming a CONTRADICTION between a region and its drill are the interesting
     *   ones: the finer view usually wins, but say both were seen rather than picking silently.
     * - \`cancelled: true\` means the user stopped it: the tree is real but partial. Report
     *   what is there and offer to continue; do not treat it as an error or start over.
     *
     * Findings are model-assisted observations, never a diagnosis. Needs an \`analyze\` driver
     * and asks the user ONCE for the whole run. The walk shows a cancellable progress dialog
     * and caches after EVERY region, so if a call fails or times out, call \`getOverview()\`
     * before anything else — the regions already examined are still there.
     */
    buildOverview(options?: BuildOverviewOptions): Promise<OverviewResult | OverviewContextRequired>;

    /**
     * CONTINUE the cached walk where it stopped. The answer to "keep going", "go deeper",
     * "scan more", "that was partial" — and to any \`budget\` that says there is more to do.
     *
     * A walk is budget-bound, so stopping is normal rather than a failure: it describes real
     * tissue and leaves a plan for the rest. This spends a fresh budget on that plan. It does
     * NOT re-survey the slide and does NOT re-read a single region already described, which is
     * exactly what calling \`buildOverview\` again would do — minutes and many calls to arrive
     * back where you already were.
     *
     * The result is the SAME tree, extended and re-ranked, with cumulative \`budget\` figures
     * and \`budget.refinements\` counting how many times it has been continued. Report it as one
     * examination, not as a second opinion.
     *
     * Steer it when the user did:
     * - \`region\` — concentrate on the part of the tree covering that box ("look harder at
     *   region 2"). If no examined region covers it, that is a different job and the call says
     *   so: use \`buildOverview({ scope: region })\`, which surveys it first.
     * - \`maxDepth\` — allow another rung when leaves are still \`resolutionShortfall\`.
     * - \`query\` — re-focus: derives a new checklist and re-scores the whole frontier against
     *   it, so "now check for perineural invasion" continues the same walk with a new question.
     *
     * Throws when no overview has been built on this slide — deliberately, because starting a
     * minutes-long walk is not a decision to make on the user's behalf. Call \`buildOverview\`
     * for that. Needs an \`analyze\` driver; reuses the consent already granted for the walk.
     * @param options.addCalls vision calls to spend, all on depth (default: the original budget).
     */
    refineOverview(options?: {
        addCalls?: number;
        region?: Bounds;
        maxDepth?: number;
        query?: string;
        features?: ChecklistFeature[];
        driver?: string;
    }): Promise<OverviewResult>;

    /**
     * COST a walk without running it: survey the tissue, settle the questions, rank the
     * regions, and stop. CHEAP — one local render (usually already cached) and one text call.
     * No tissue is sent to a vision model and no finding is produced.
     *
     * Takes the same options as \`buildOverview\`; \`runPlan\` then executes it.
     *
     * Show the plan to the user only when they asked to steer the scan, or when it leaves a real
     * decision: \`overlapPairs\` non-empty (two regions may be one piece of tissue),
     * \`regionsOmitted\` above 0 (tissue the run will not reach), or \`surveyComplete: false\` (the
     * slide was still loading — re-plan rather than run). Otherwise call \`runPlan\` straight
     * away, without narrating the split.
     *
     * Returns \`{status: "context-required", missing}\` under the same rule as \`buildOverview\`.
     */
    planOverview(options?: BuildOverviewOptions): Promise<OverviewPlan | OverviewContextRequired>;

    /**
     * RUN a plan from \`planOverview\`, minus whatever you strike off it. This is the expensive
     * call — the same minutes-long walk \`buildOverview\` performs, over the regions you kept.
     *
     * Address regions by \`label\` ("region 2"), never by position. \`drop\` skips those regions;
     * \`only\` keeps them and nothing else; \`addCalls\` raises the vision budget above what the
     * plan assumed.
     *
     * \`{status: "plan-expired"}\` means the plan is gone (the slide changed, or it aged out) or
     * your edits left no region to read. Nothing was spent, and re-planning is free — the survey
     * is cached — so call \`planOverview\` again. Do NOT fall back to \`buildOverview\` silently:
     * that re-surveys and pays for everything a second time.
     */
    runPlan(planId: string, edits?: {
        /** Region labels to skip. */
        drop?: string[];
        /** Region labels to keep, to the exclusion of all others. */
        only?: string[];
        /** Extra vision calls beyond the plan's budget. */
        addCalls?: number;
        driver?: string;
    }): Promise<OverviewResult | { status: "plan-expired"; planId: string; reason?: "no-regions" }>;

    /**
     * The region the work on this slide is currently ABOUT, or null. FREE: local, no model call.
     *
     * Set by the last region-scoped call (\`analyzeRegion({region})\`, \`interrogateRegion\`, a
     * scoped \`exploreSlide\`/\`buildOverview\`). A later call that names no \`scope\` follows
     * it, which is what makes "do a deep scan" after two turns about one core stay on that core.
     *
     * Check it before assuming a request is slide-wide, and mention what you are about to
     * examine when it is not obvious. \`setFocusRegion(null)\` or \`scope: "slide"\` clears it.
     */
    getFocusRegion(): { label?: string; bounds: Bounds } | null;

    /** Point later unqualified calls at this region, or clear the focus with null. */
    setFocusRegion(bounds: Bounds | null, label?: string): void;

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
     * view, not of the whole slide. The result includes \`bounds\`/\`center\` in whole
     * level-0 image pixels: link the user to it, or frame it with
     * \`viewer.frameImageRegion(result.bounds)\`.
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
        /**
         * PREFER THIS to ask for detail: target resolution in µm per delivered pixel.
         *
         * The only one of the three that is DELIVERED rather than requested — a region too
         * large to carry at this resolution is sampled instead of squashed, and
         * \`coveredFraction\` then says how much of it was read.
         */
        mpp?: number;
        /** Back-compat: render magnification (e.g. 20). A REQUEST — clamped to native and a size cap. */
        magnification?: number;
        /** Back-compat: approximate raster pixel budget (default ~2,000,000). Also a request. */
        targetPixels?: number;
        /**
         * "composite" (default): with no region, the on-screen view incl. overlays; with a
         * region, the user's ACTIVE visualization (no annotation overlays).
         * "background": the raw slide image only.
         */
        source?: "composite" | "background";
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
     *
     * **When every answer is \`not-assessable\`, check \`warnings\` and \`answers[].reason\`
     * before advising anything.** \`reason: "unread"\` (and a \`warnings\` entry) means the
     * fields failed to RENDER — no image existed, resolution was never the problem, and the
     * right advice is to run the same call again. Telling the user to zoom in or pick a
     * smaller region in that case sends them round a loop that cannot terminate.
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
        /** Raster budget per cell, in pixels. Raise it when the cells come back too small to read. */
        cellPixels?: number;
        driver?: string;
    }): Promise<MontageResult>;

    /**
     * Where the nuclei are, as a coarse normalized grid over the slide.
     *
     * **FREE — local, deterministic, no model call.** Consult it BEFORE committing a vision
     * budget: it tells you which tissue is cell-dense, and "biggest tissue island" cannot
     * distinguish a large bland region from a small dense one. \`topSpots\` is the densest
     * spots already computed, as boxes you can hand to \`interrogateRegion\` or
     * \`montageRegions\`.
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
                "user's viewport, so the user keeps navigating freely while they run. Never move the viewer " +
                "to 'show' the model something: it renders its own pixels. Pointing the USER at a region is " +
                "the opposite — always do it, inline in your prose (see NAMING AND LINKING REGIONS).\n\n" +
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
                "nothing leaves the viewer: annotateTissue, tissueCoverage, exploreSlide, planOverview " +
                "(it costs a survey and a text call, and tells you what a scan WOULD cover). ONE vision call: " +
                "analyzeRegion, and montageRegions however many regions it is given. A FEW vision calls: " +
                "interrogateRegion, reviewRegions. MANY, and minutes of wall-clock: buildOverview, " +
                "runPlan and refineOverview.\n\n" +
                "What each does: exploreSlide is ORIENTATION — it finds WHERE the tissue is and does not " +
                "examine it, returning the ranked tissue islands (a bbox each) plus coverage; link every " +
                "island you mention from its own region.bounds, never from guessed or empty coordinates. " +
                "buildOverview is THE EXPLORATION CALL, over the whole slide " +
                "or ONE REGION via `scope`: it surveys, then spends its budget on the most promising " +
                "regions, and returns an EVIDENCE TABLE keyed by the questions derived from your query. " +
                "When the user says explore, scan, go through, review-and-report — with or without naming " +
                "a region — they mean buildOverview, not exploreSlide and not a single analyzeRegion. " +
                "planOverview COSTS that walk without running it — the regions it would read and the " +
                "questions it would ask — and runPlan(planId) then runs it, minus any region you drop; " +
                "reach for them when you want to see what a scan will cover before committing the user " +
                "to minutes of it, and go straight to runPlan when there is nothing to decide. " +
                "refineOverview CONTINUES a walk that ran out of budget, without re-surveying or " +
                "re-reading anything; it is the answer to 'keep going' and to any budget that says there " +
                "is more to do. getFocusRegion says which region the work is currently about, which is " +
                "what an unqualified request will target. " +
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
                "NAMING AND LINKING REGIONS: every region carries a `label` ('region 1', 'region 2.1') — " +
                "that is the only name to put in an answer or a link. `index` and `depth` are 0-based " +
                "array internals; never print them, and never number regions or levels from 0 to the " +
                "user.\n" +
                "REGION NUMBERS FOLLOW THE SLIDE LAYOUT — rows top to bottom, left to right within a " +
                "row — so 'region 3' is the third fragment on the glass, NOT the third most interesting " +
                "one and NOT the third largest. Never renumber them: do not invent your own 'fragment 1, " +
                "fragment 2' sequence over the regions you happen to discuss, because the reader counts " +
                "the same pieces off the slide and the numbers must agree. When you enumerate regions, " +
                "go in label order unless ranking IS the point — a report that jumps 3, 1, 5 sends the " +
                "reader's clicks jumping with it.\n" +
                "WHENEVER YOU NAME A REGION, LINK IT. Every `bounds` this namespace returns is whole " +
                "level-0 image pixels and maps straight onto a markdown region link:\n" +
                "  [region 2](#xopat-region?viewer=<contextId>&x=<bounds.x>&y=<bounds.y>&w=<bounds.width>&h=<bounds.height>)\n" +
                "A host that renders markdown turns that into a click-to-navigate control, so emitting it " +
                "IS how you take the user there; a region named in plain prose is one they cannot find. " +
                "Link only coordinates a result actually returned, never guessed ones.",
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
            scope?: "slide" | "viewport" | any;
            surveyMpp?: number;
            surveyPixels?: number;
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

        /**
         * The engine options a walk runs under, or the context question that must be answered
         * first — the half of `buildOverview` and `planOverview` that is identical.
         *
         * Shared rather than written twice because the two must never disagree about it: a
         * plan drawn up under one context rule and executed under another plans against
         * features the stain cannot show, and the user approves it without being asked.
         *
         * Consent is deliberately NOT here. `buildOverview` needs it (it fires the vision
         * calls); `planOverview` does not (a local survey plus one text call). Folding it in
         * would either ask for a grant nothing spends, or leak a sweep past its gate.
         */
        async _overviewCallOptions(options?: any): Promise<any> {
            // Resolve context BEFORE anything else. It is local (nothing leaves the viewer),
            // and every later step depends on it: the walk is only worth running once we
            // know what the slide is.
            const context = await this._resolveContext(options?.context);

            // Refuse to spend the vision budget on a blind walk. A run costs many slow
            // model calls, and one that does not know the stain or site produces findings
            // the caller must then discard — so ask FIRST and walk once, informed, rather
            // than walking twice. The caller can proceed anyway with context: "unknown".
            const missing = this._missingContextFields(context);
            if (missing.length) return { status: "context-required", context, missing };

            // Turn the question into the schema the whole run obeys. Derivation lives HERE,
            // not in the engine: it needs a chat model, and the engine must stay usable by
            // a plugin or script with no chat model present.
            const derived = options?.checklist || options?.features
                ? { checklist: null, reason: null }
                : await this._deriveChecklist(options?.query, context);

            return {
                context,
                merged: {
                    ...(options || {}),
                    context,
                    ...(derived.checklist ? { checklist: derived.checklist } : {}),
                    // Carried even though the engine cannot see the failure itself: a run that
                    // silently degrades to the generic checklist reads exactly like a run that
                    // was never given a question, and the two need opposite fixes.
                    ...(derived.reason ? { checklistFallbackReason: derived.reason } : {}),
                },
            };
        }

        async buildOverview(options?: any): Promise<any> {
            const module = this._getModule();
            const prepared = await this._overviewCallOptions(options);
            if (prepared.status === "context-required") return prepared;

            // One consent for the whole recursive run (it fires many analyze calls); the
            // dialog shows the user exactly what slide context will be sent with it.
            // Scoped to "overview" so a grant for a single snapshot never stands in for
            // approval of a minutes-long, many-call sweep.
            await this._consentIfRemote("analyze", options?.driver, "recursive expert overview", [
                this._contextConsentDetail(prepared.context),
            ], "overview");

            // Shaped for the model on the way out: whole-pixel geometry (what a region
            // link needs), short numbers and capped prose. The cached tree keeps its full
            // precision — this is a view, not a mutation.
            return forPresentation(await module.buildOverview(this.activeViewer, prepared.merged));
        }

        async planOverview(options?: any): Promise<any> {
            const module = this._getModule();
            // No analyze consent: nothing here sends tissue to a vision model. The survey is a
            // local render and the checklist is a text-only call.
            const prepared = await this._overviewCallOptions(options);
            if (prepared.status === "context-required") return prepared;

            return forPresentation(await module.planOverview(this.activeViewer, prepared.merged));
        }

        async runPlan(planId: string, edits?: any): Promise<any> {
            const module = this._getModule();
            // The consent the plan itself did not need. This IS the minutes-long, many-call
            // sweep, so it is gated exactly like buildOverview — and scoped to "overview", so a
            // grant for one snapshot never stands in for it.
            await this._consentIfRemote("analyze", edits?.driver, "recursive expert overview", [
                this._contextConsentDetail(module.getSlideContext(this.activeViewer)),
            ], "overview");
            return forPresentation(await module.runPlan(this.activeViewer, planId, edits || {}));
        }

        async refineOverview(options?: any): Promise<any> {
            const module = this._getModule();
            // No consent prompt: this continues work the user already approved under the
            // "overview" scope. Asking again for the same walk would train them to click through.
            const derived = options?.query && !options?.features && !options?.checklist
                ? await this._deriveChecklist(options.query, module.getSlideContext(this.activeViewer))
                : { checklist: null, reason: null };
            return forPresentation(await module.refineOverview(this.activeViewer, {
                ...(options || {}),
                ...(derived.checklist ? { checklist: derived.checklist } : {}),
                ...(derived.reason ? { checklistFallbackReason: derived.reason } : {}),
            }));
        }

        getFocusRegion(): any {
            return forPresentation(this._getModule().getFocusRegion(this.activeViewer));
        }

        setFocusRegion(bounds: any, label?: string): void {
            this._getModule().setFocusRegion(this.activeViewer, bounds ?? null, label);
        }

        /**
         * Ask the assistant's own model to turn the reviewer's question into a small set of
         * named features, each with the resolution needed to judge it.
         *
         * A text-only call — no image, no session, no history — so it is cheap and cannot
         * touch the chat transcript. On any failure it returns the REASON instead of the
         * checklist, and the engine falls back to its generic one: a worse run, flagged in
         * `warnings`, but a run. The reason travels because the three failures need three
         * different fixes and a bare null made them one indistinguishable "derivation failed"
         * that pointed the caller at their own question.
         *
         * The result is model-written text bound for another model's prompt, so it is
         * sanitized here (and again in the engine) rather than trusted.
         */
        async _deriveChecklist(
            query: string | undefined, context: any
        ): Promise<{ checklist: any | null; reason: string | null }> {
            if (!query || !String(query).trim()) return { checklist: null, reason: "no-query" };
            try {
                const chat = (globalThis as any).singletonModule?.("vercel-ai-chat-sdk");
                const ref = chat?.getAssistantTextModel?.();
                const rpc = (globalThis as any).xserver?.module?.["vercel-ai-chat-sdk"];
                if (!ref?.providerId || !rpc?.runVisionInference) {
                    // Silent until now, which made a broken derivation indistinguishable from a
                    // caller who asked a vague question — and the run's warning blamed the
                    // caller for it.
                    console.warn("[pathology] no assistant text model for checklist derivation; " +
                        "the walk will use the generic fallback checklist.",
                        { providerId: ref?.providerId ?? null, rpc: !!rpc?.runVisionInference });
                    return { checklist: null, reason: "no-model" };
                }

                const res = await rpc.runVisionInference({
                    providerId: ref.providerId,
                    model: ref.modelId || null,
                    system: $.t("pathology.checklistSystem"),
                    prompt: $.t("pathology.checklistPrompt", {
                        query: String(query).slice(0, 500),
                        stain: context?.stain || $.t("pathology.checklistUnknownValue"),
                        organ: context?.organ || $.t("pathology.checklistUnknownValue"),
                        // Stated as a FACT about the scan, not enforced. The prompt's own scale
                        // hint offers "0.25 for nuclear detail", which a 20x slide (0.504 µm/px)
                        // cannot deliver — and nothing downstream clamps the answer, deliberately,
                        // so a requirement the slide cannot meet is reported rather than rewritten.
                        // Telling the model what the slide holds is how the common case comes out
                        // right at the source instead of being corrected four stages later.
                        finest: this._slideFinestMppNote(),
                    }),
                    maxOutputTokens: 512,
                }, { priority: "background" });

                const parsed = this._parseChecklistJson(res?.text);
                if (!parsed) {
                    console.warn("[pathology] the model returned no parseable checklist; " +
                        "the walk will use the generic fallback checklist.",
                        { replyChars: typeof res?.text === "string" ? res.text.length : 0 });
                    return { checklist: null, reason: "unparseable" };
                }
                return { checklist: { features: parsed, source: "derived", query }, reason: null };
            } catch (e) {
                console.warn("[pathology] checklist derivation unavailable; using the generic fallback.", e);
                return { checklist: null, reason: "error" };
            }
        }

        /**
         * One sentence naming the finest resolution this scan holds, or "" when unknown.
         *
         * Empty rather than a guess: an uncalibrated slide has no such figure, and inventing
         * one would put a false constraint into the prompt. i18next renders a missing
         * interpolation as an empty string, so the sentence simply does not appear.
         */
        _slideFinestMppNote(): string {
            try {
                const mpp = this._getModule()?.getSlideMeta?.(this.activeViewer)?.micronsPerPixel;
                if (typeof mpp !== "number" || !(mpp > 0)) return "";
                return $.t("pathology.checklistSlideFinest", { finest: Math.round(mpp * 1000) / 1000 });
            } catch {
                return "";
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
            // Cross the script bridge as PLAIN DATA. A script result is structure-cloned, and a
            // function cannot be cloned — so the `top`/`sample` methods this used to hand back
            // did not merely fail to work, they made every single call throw
            // (`DataCloneError: u=>a.top(u) could not be cloned`) before the caller could read
            // anything at all. The one genuinely useful read is precomputed instead; `values`
            // plus `bounds` and the grid dimensions carry the rest (cell size is
            // `bounds.width / width` by `bounds.height / height`).
            return {
                bounds: map.bounds,
                width: map.width,
                height: map.height,
                method: map.method,
                values: Array.from(map.values as Float32Array),
                topSpots: map.top(DENSITY_TOP_SPOTS),
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
