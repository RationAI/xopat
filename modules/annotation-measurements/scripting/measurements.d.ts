/**
 * `measurements` scripting namespace — quantify annotated regions on the
 * viewer bound to the current script context. All values are physical-unit
 * (µm / µm² / per-mm²) when the slide is calibrated, and are computed
 * deterministically (independent of the current zoom / pan).
 *
 * Annotations are referenced by their integer `incrementId` (see
 * annotationsRead.getAnnotations()). Select the viewer first via
 * application.setActiveViewer(contextId).
 */
interface MeasurementSamplingOptions {
    /** Which pixels to read. "rendered" = the full visible composite as shown
     *  (best for colormapped / fluorescence data); "background-raw" = the raw
     *  background image (calibration-stable stain intensity). Default "rendered". */
    source?: "rendered" | "background-raw";
    /** Intensity channel. "V" = max(R,G,B), robust to colormaps (default);
     *  "L" = luminance; "R"/"G"/"B" = single channel. */
    channel?: "V" | "L" | "R" | "G" | "B";
    /** Positivity / component threshold in [0,255], or "auto" for per-region
     *  Otsu (default). */
    threshold?: number | "auto";
}

interface MeasurementResult {
    annotationId: number;
    areaUm2: number;
    areaMm2: number;
    lengthUm: number;
    /** Mean masked intensity of the chosen channel. */
    mean: number;
    median: number;
    /** Fraction (0–1) of the region at or above the threshold. */
    percentPositive: number;
    threshold: number;
    /** Connected-component (object) count above threshold. */
    componentCount: number;
    densityPerMm2: number;
    meanComponentAreaUm2: number;
    /** Non-null when the region could not be measured (reason code). */
    skipped: string | null;
}

interface AreaRatioResult {
    /** area(numerator) / area(denominator). Unit-free. */
    ratio: number;
    numeratorAreaPx: number;
    denominatorAreaPx: number;
}

interface TissueRatioResult {
    /** annotation area / derived tissue area. */
    ratio: number;
    annotationAreaPx: number;
    tissueAreaPx: number;
    tissueRegions: number;
}

interface CompositionResult {
    parentAreaUm2: number;
    classes: Array<{ preset: string; areaUm2: number; fractionOfParent: number; count: number }>;
}

interface DensityResult {
    count?: number;
    densityPerMm2?: number;
    regionMm2?: number;
    threshold?: number;
    skipped?: string;
}

export interface MeasurementsScriptApi extends ScriptApiObject {
    /** Full metric set (area + intensity + components) for one annotation. */
    measure(annotationRef: number, options?: MeasurementSamplingOptions): Promise<MeasurementResult>;

    /** Exact area ratio between two annotations (geometry-based, zoom-independent). */
    areaRatio(numeratorRef: number, denominatorRef: number): AreaRatioResult;

    /** Ratio of an annotation's area to an auto-derived tissue mask. Derives the
     *  tissue outline via the pathology module (throws if it is not loaded). */
    tissueRatio(annotationRef: number, options?: { driver?: string }): Promise<TissueRatioResult>;

    /** Per-preset area breakdown of annotations contained inside a parent region. */
    composition(parentRef: number): CompositionResult | null;

    /** Object count and density per mm² inside an annotation. */
    density(annotationRef: number, options?: MeasurementSamplingOptions): Promise<DensityResult>;
}
