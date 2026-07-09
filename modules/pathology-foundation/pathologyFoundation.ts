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
export interface PixelSource {
    width: number;
    height: number;
    /** RGBA, length = width*height*4. */
    pixels: Uint8ClampedArray | number[];
    /** Encode the same pixels as a PNG blob (memoized) — for remote drivers. */
    toBlob: () => Promise<Blob>;
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
    coverage: number;
    /** Image-space bbox of the drawn tissue, or null if nothing was drawn. */
    bounds: Bounds | null;
    /** Image-space centre of `bounds`, or null. */
    center: { x: number; y: number } | null;
}

export interface TissueCoverageResult {
    driver: string;
    annotationId: string | number;
    coverage: number;
    tissuePixels: number;
    areaPixels: number;
    /** Image-space bbox of the measured annotation. */
    bounds: Bounds | null;
    center: { x: number; y: number } | null;
}

export interface SegmentResult {
    driver: string;
    annotationIds: Array<string | number>;
    /** Image-space bbox of the drawn region, or null. */
    bounds: Bounds | null;
    center: { x: number; y: number } | null;
}

export interface AnalysisResult {
    driver: string;
    findings: string | null;
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
        const { driverId, mask } = await this._runTissueMask(viewer, options?.driver);
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
        const { driverId, mask } = await this._runTissueMask(viewer, options?.driver);
        const context = this._annotations();
        const ref = this._ref(viewer);
        const ratio = OSD.pixelDensityRatio;

        const minArea = 0.003 * mask.width * mask.height;
        const contours = this._traceOuterContours(mask).filter(pts => polygonArea(pts) >= minArea);
        const polys = contours.map(pts => this._contourToImage(pts, ref, mask, mask.width, mask.height, ratio));

        const total = mask.width * mask.height;
        const tissue = this._countFilled(mask.binaryMask);
        const bounds = boundsOfPolygons(polys);
        return {
            driver: driverId,
            annotationIds: this._commitPolygons(viewer, context, polys),
            coverage: total ? tissue / total : 0,
            bounds,
            center: centerOf(bounds),
        };
    }

    async tissueCoverage(
        viewer: any,
        annotationId: string | number,
        options?: { driver?: string }
    ): Promise<TissueCoverageResult> {
        const { driverId, mask } = await this._runTissueMask(viewer, options?.driver);
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
        const maskRings = imageRings.map(ring =>
            ring.map((p: Point) => {
                const ve = ref.imageToViewerElementCoordinates(new OSD.Point(p.x, p.y));
                return { x: ve.x * ratio, y: ve.y * ratio };
            })
        );

        const { area, tissue } = this._coverageOverRings(maskRings, mask);
        const bounds = boundsOfPolygons([imageRings[0]]);
        return {
            driver: driverId,
            annotationId,
            coverage: area ? tissue / area : 0,
            tissuePixels: tissue,
            areaPixels: area,
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
            const poly = mask
                ? this.maskToPolygon(mask, this._ref(viewer), bg.width, bg.height, OSD.pixelDensityRatio, viewer)
                : null;
            const ids = poly ? this._commitPolygons(viewer, this._annotations(), [poly]) : [];
            const bounds = boundsOfPolygons([poly]);
            return { driver: driver.id, annotationIds: ids, bounds, center: centerOf(bounds) };
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, feature: "segment" });
        }
    }

    /** Vision → text findings for the current view (on-screen composite). */
    async analyzeRegion(viewer: any, options: { prompt: string; driver?: string }): Promise<AnalysisResult> {
        if (!viewer) throw new Error("analyzeRegion() requires a viewer.");
        const driver = this.getDriverForFeature("analyze", options?.driver);
        const capture = await this.captureViewportImage(viewer);
        if (!capture) throw new Error("Failed to capture the viewport image.");

        this.raiseEvent("analysis-started", { driver: driver.id, feature: "analyze" });
        try {
            const res = await driver.features["analyze"]!({ imageBlob: capture.blob, prompt: options?.prompt || "" });
            return { driver: driver.id, findings: res?.text ?? null };
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
        driverId?: string
    ): Promise<{ driverId: string; bg: PixelSource; mask: MaskResult }> {
        if (!viewer) throw new Error("A viewer is required.");
        const driver = this.getDriverForFeature("tissue-mask", driverId);
        const bg = await this._readBackground(viewer);

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

    /**
     * Read the raw background raster of the live viewport (no overlay) by reusing
     * the core `visualization` scripting API, bound to THIS viewer's context so
     * it is correct in a multi-viewport grid.
     */
    private async _readBackground(viewer: any): Promise<PixelSource> {
        const viz = this._visualizationApiFor(viewer);
        if (!viz?.renderCurrentBackgroundPixels) {
            throw new Error("The visualization API is unavailable; cannot read the background image.");
        }
        // Render at full device-pixel viewport size (the coordinate mapping in
        // maskToPolygon assumes render pixels == device pixels); lift the default
        // 1 MP guard so large viewports aren't rejected.
        const res = await viz.renderCurrentBackgroundPixels({ maxPixels: 64_000_000 });
        if (!res?.width || !res?.height || !res?.data) {
            throw new Error("Failed to read the background image of the viewer.");
        }
        const width = res.width, height = res.height, pixels = res.data;
        let blobPromise: Promise<Blob> | null = null;
        return {
            width,
            height,
            pixels,
            toBlob: () => (blobPromise ||= pixelsToPngBlob(pixels, width, height)),
        };
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
        const { binaryMask } = mask;
        const totalPixels = binaryMask.length;
        const filledPixels = this._countFilled(binaryMask);

        if (filledPixels === 0) {
            viewer.raiseEvent("warn-user", {
                originType: "module",
                originId: "pathology-foundation",
                code: "W_PATHOLOGY_NO_SEGMENTATION",
                message: "Empty segmentation mask received.",
            });
            return null;
        }
        if (filledPixels / totalPixels > 0.9) {
            viewer.raiseEvent("warn-user", {
                originType: "module",
                originId: "pathology-foundation",
                code: "W_PATHOLOGY_OVER_SEGMENTATION",
                message: "Segmentation mask covers more than 90% of the image; treated as invalid.",
            });
            return null;
        }

        let largest: Point[] | undefined;
        let count = 0;
        for (const points of this._traceOuterContours(mask)) {
            if (points.length > count) { largest = points; count = points.length; }
        }
        if (!largest) return null;
        return this._contourToImage(largest, ref, mask, screenshotWidth, screenshotHeight, ratio);
    }
}

(window as any).PathologyFoundation = PathologyFoundation;
addModule("pathology-foundation", PathologyFoundation as any);

export {};
