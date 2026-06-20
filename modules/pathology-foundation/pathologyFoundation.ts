/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * Pathology foundation-model broker.
 *
 * Generic, model-agnostic core: capture the rendered viewport, hand the
 * snapshot + a text prompt to a pluggable {@link FmDriver}, and turn whatever
 * the driver returns into either polygon annotations (segmentation masks) or
 * plain findings (text analysis). It owns the **normalized contract** at the
 * module boundary so transports (HttpClient, in-browser transformers, the
 * Vercel SDK) are swappable without ever changing the agent-facing `pathology`
 * scripting namespace.
 *
 * Pure compute + IO: it never reaches for the global `VIEWER`. Every
 * viewer-bound operation receives the viewer explicitly so it behaves correctly
 * in a multi-viewport grid. The capture + mask→polygon helpers were factored
 * out of the original SAM module so SAM and any future model share one
 * implementation.
 *
 * @class PathologyFoundation
 * @extends XOpatModuleSingleton
 */

// Library globals are resolved at runtime (no cross-boundary ES imports).
const OSD: any = (window as any).OpenSeadragon;
const OSDAnnotations: any = (window as any).OSDAnnotations;

/** Binary mask in the captured screenshot's pixel space. */
export interface MaskResult {
    binaryMask: Uint8Array;
    width: number;
    height: number;
    label?: string;
    score?: number;
}

/** Normalized driver output. A driver may return masks, findings, or both. */
export interface FmAnalysis {
    masks?: MaskResult[];
    findings?: string | Record<string, unknown>;
}

export interface FmDriverInput {
    /** PNG blob of the captured viewport (device pixels). */
    imageBlob: Blob;
    /** User/agent text prompt describing the task. */
    prompt: string;
    /** Coarse task hint so a driver can pick an endpoint/mode. */
    task: "segment" | "analyze";
    /** Per-driver configuration (endpoint, model, ...). */
    config: Record<string, unknown>;
}

/**
 * A foundation-model transport. Implementations adapt their wire protocol to
 * the single {@link FmAnalysis} contract; register them with
 * {@link PathologyFoundation.registerDriver}. Built-in `http` drivers come from
 * configuration; other modules/plugins (e.g. the SAM plugin) register their own
 * at runtime — conditional integration, no hard dependency.
 */
export interface FmDriver {
    id: string;
    label?: string;
    capabilities: { masks?: boolean; text?: boolean };
    config?: Record<string, unknown>;
    analyze(input: FmDriverInput): Promise<FmAnalysis>;
}

export interface PathologyAnalyzeOptions {
    prompt: string;
    task: "segment" | "analyze";
    driver?: string;
}

export interface PathologyAnalyzeResult {
    driver: string;
    annotationIds: Array<string | number>;
    findings: string | Record<string, unknown> | null;
    summary: string;
}

export interface PathologyDriverInfo {
    id: string;
    label: string;
    capabilities: { masks?: boolean; text?: boolean };
    isDefault: boolean;
}

interface ViewportCapture {
    blob: Blob;
    width: number;
    height: number;
}

/**
 * Built-in HttpClient transport. `mode: "segment"` posts to a custom image→mask
 * endpoint (SAM `/segment`-compatible); `mode: "chat"` posts an
 * OpenAI-compatible chat-completions request with the snapshot as an image part
 * and returns the assistant text. Auth/proxy/secureMode are handled by
 * HttpClient — secrets stay server-side when a `proxyAlias` is configured.
 */
class HttpFmDriver implements FmDriver {
    id: string;
    label: string;
    capabilities: { masks?: boolean; text?: boolean };
    config: Record<string, unknown>;

    private _client: any;
    private _mode: "segment" | "chat";
    private _path: string;
    private _model?: string;

    constructor(id: string, cfg: Record<string, any>) {
        this.id = id;
        this.label = cfg.label || id;
        this._mode = cfg.mode === "chat" ? "chat" : "segment";
        this._model = cfg.model;
        this._path = cfg.path || (this._mode === "chat" ? "v1/chat/completions" : "segment");
        this.capabilities = this._mode === "chat" ? { text: true } : { masks: true };
        this.config = cfg;

        const HttpClient = (window as any).HttpClient;
        // proxyAlias keeps upstream auth on the server; baseURL is the absolute
        // or proxied endpoint base. One of the two must be configured.
        this._client = new HttpClient({ baseURL: cfg.baseURL, proxy: cfg.proxyAlias });
    }

    async analyze(input: FmDriverInput): Promise<FmAnalysis> {
        const base64 = await blobToBase64(input.imageBlob);

        if (this._mode === "segment") {
            const data = await this._client.request(this._path, {
                method: "POST",
                expect: "json",
                body: { image: base64, prompt: input.prompt, model: this._model },
            });
            return { masks: [decodeBase64Mask(data)] };
        }

        // OpenAI-compatible vision chat: image as a data-URL image part.
        const data = await this._client.request(this._path, {
            method: "POST",
            expect: "json",
            body: {
                model: this._model,
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: input.prompt },
                        { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
                    ],
                }],
            },
        });

        const findings = data?.choices?.[0]?.message?.content;
        return { findings: typeof findings === "string" ? findings : data };
    }
}

/**
 * Optional Vercel-AI-SDK transport (text/analysis only). It calls the
 * vercel-ai-chat-sdk module's **stateless** `runVisionInference` RPC, which
 * resolves a model and runs one-shot generation in a context fully isolated
 * from the chat agent (no session/history/personality). It is bound to a
 * DEDICATED pathology provider instance (`providerId`) so the model + secrets
 * are separate from whatever drives the agent above.
 *
 * Reached only by configuring a `{ "type": "vercel", "providerId": ... }`
 * driver; the pathology module never hard-depends on the chat module.
 */
class VercelFmDriver implements FmDriver {
    id: string;
    label: string;
    capabilities = { text: true };
    config: Record<string, unknown>;

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
    }

    async analyze(input: FmDriverInput): Promise<FmAnalysis> {
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
        return { findings: typeof res?.text === "string" ? res.text : "" };
    }
}

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

class PathologyFoundation extends (XOpatModuleSingleton as any) {
    private _drivers: Map<string, FmDriver>;
    private _defaultDriverId: string | null;
    private MagicWand: any;

    constructor() {
        super();
        this._drivers = new Map();
        this._defaultDriverId = null;
        this.MagicWand = null;

        // Built-in HttpClient drivers come straight from configuration so an
        // admin can wire MedGemma (chat) or a segmentation server (segment)
        // without code. Shape: { "<id>": { type:"http", mode, baseURL|proxyAlias, path?, model?, label? } }
        const drivers = this.getStaticMeta("drivers", {}) as Record<string, any>;
        for (const [id, cfg] of Object.entries(drivers || {})) {
            if (!cfg) continue;
            const type = cfg.type || "http";
            try {
                if (type === "http") {
                    this.registerDriver(new HttpFmDriver(id, cfg));
                } else if (type === "vercel") {
                    this.registerDriver(new VercelFmDriver(id, cfg));
                } else {
                    console.warn(`[pathology-foundation] driver "${id}" has unknown type "${type}"; skipped.`);
                }
            } catch (e) {
                console.error(`[pathology-foundation] failed to build ${type} driver "${id}":`, e);
            }
        }

        const configuredDefault = this.getStaticMeta("defaultDriver", "") as string;
        if (configuredDefault && this._drivers.has(configuredDefault)) {
            this._defaultDriverId = configuredDefault;
        }
    }

    // ---- driver registry ----

    /** Register (or replace) a transport. Other modules/plugins call this. */
    registerDriver(driver: FmDriver): void {
        if (!driver?.id || typeof driver.analyze !== "function") {
            throw new Error("[pathology-foundation] a driver needs an id and analyze().");
        }
        this._drivers.set(driver.id, driver);
        if (!this._defaultDriverId) this._defaultDriverId = driver.id;
        this.raiseEvent("drivers-changed");
    }

    unregisterDriver(id: string): void {
        this._drivers.delete(id);
        if (this._defaultDriverId === id) {
            this._defaultDriverId = this._drivers.keys().next().value || null;
        }
        this.raiseEvent("drivers-changed");
    }

    getDriver(id?: string | null): FmDriver {
        const resolved = id || this._defaultDriverId;
        if (!resolved) {
            throw new Error("No pathology foundation-model driver is configured.");
        }
        const driver = this._drivers.get(resolved);
        if (!driver) {
            const known = Array.from(this._drivers.keys()).join(", ") || "(none)";
            throw new Error(`Unknown pathology driver "${resolved}". Available: ${known}.`);
        }
        return driver;
    }

    listDrivers(): PathologyDriverInfo[] {
        return Array.from(this._drivers.values()).map(d => ({
            id: d.id,
            label: d.label || d.id,
            capabilities: d.capabilities || {},
            isDefault: d.id === this._defaultDriverId,
        }));
    }

    // ---- orchestration ----

    /**
     * Capture the supplied viewer, run it through a driver, and materialize the
     * result: masks become polygon annotations on that viewer; text findings
     * are returned for the caller (the chat agent) to use.
     */
    async analyze(viewer: any, options: PathologyAnalyzeOptions): Promise<PathologyAnalyzeResult> {
        if (!viewer) throw new Error("analyze() requires a viewer.");
        const driver = this.getDriver(options.driver);

        this.raiseEvent("analysis-started", { driver: driver.id, task: options.task });
        try {
            const capture = await this.captureViewportImage(viewer);
            if (!capture) throw new Error("Failed to capture the viewport image.");

            const result = await driver.analyze({
                imageBlob: capture.blob,
                prompt: options.prompt || "",
                task: options.task,
                config: driver.config || {},
            });

            const annotationIds = result.masks?.length
                ? this._commitMasks(viewer, capture, result.masks)
                : [];

            const findings = result.findings ?? null;
            return {
                driver: driver.id,
                annotationIds,
                findings,
                summary: this._summarize(driver.id, annotationIds, findings),
            };
        } finally {
            this.raiseEvent("analysis-finished", { driver: driver.id, task: options.task });
        }
    }

    private _summarize(
        driverId: string,
        annotationIds: Array<string | number>,
        findings: string | Record<string, unknown> | null
    ): string {
        const parts: string[] = [];
        if (annotationIds.length) {
            parts.push(`Created ${annotationIds.length} annotation${annotationIds.length === 1 ? "" : "s"} via "${driverId}".`);
        }
        if (typeof findings === "string" && findings.trim()) {
            parts.push(findings.trim());
        } else if (findings && typeof findings === "object") {
            parts.push(`Received structured findings from "${driverId}".`);
        }
        if (!parts.length) parts.push(`"${driverId}" returned no segmentation or findings.`);
        return parts.join(" ");
    }

    /** Trace each mask into a polygon and commit it on the given viewer. */
    private _commitMasks(viewer: any, capture: ViewportCapture, masks: MaskResult[]): Array<string | number> {
        const context = OSDAnnotations?.instance?.();
        if (!context) {
            throw new Error("The annotations module is not available; cannot draw masks.");
        }
        const ref = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world.getItemAt(0);
        if (!ref) return [];
        const ratio = OSD.pixelDensityRatio;

        const ids: Array<string | number> = [];
        const factory = context.getAnnotationObjectFactory("polygon");

        // The agent flow has no toolbar preset selection, so resolve one
        // explicitly (mirrors the annotations write-scripts layer): active
        // preset → first existing → create a default. Never assume a selection.
        const presets = context.presets;
        let preset = presets.getActivePreset?.(true);
        if (!preset) {
            const ids0: Array<string | number> = presets.getExistingIds?.() || [];
            if (ids0.length) preset = presets.get?.(ids0[0]);
        }
        if (!preset) {
            preset = presets.addPreset?.(undefined, "Pathology", undefined, context.polygonFactory);
        }
        const visualProps = (preset
            ? presets.getAnnotationOptionsFromInstance?.(preset, true)
            : presets.getAnnotationOptions?.(true)) || {};

        for (const mask of masks) {
            const polygon = this.maskToPolygon(mask, ref, capture.width, capture.height, ratio, viewer);
            if (!polygon) continue;
            const annotation = factory.create(polygon, visualProps);
            context.getFabric(viewer).addAnnotation(annotation);
            if (annotation?.id !== undefined && annotation?.id !== null) ids.push(annotation.id);
        }
        return ids;
    }

    // ---- shared capture + mask→polygon infra (factored out of the SAM module) ----

    /**
     * Capture the rendered raster of a specific viewer as a PNG blob (device
     * pixels). Uses the per-viewer screenshot tool; falls back to a direct draw
     * of the drawer canvas. Captures only the image (no fabric annotations).
     */
    async captureViewportImage(viewer: any): Promise<ViewportCapture | null> {
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

        return new Promise<ViewportCapture | null>(resolve => {
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

    /**
     * Trace a binary mask into a polygon in image coordinates of the supplied
     * viewer. The mask is in the captured screenshot's pixel space; we scale to
     * the screenshot device-pixel size, convert device → CSS pixels via the
     * pixel-density ratio, then map through the viewer's tiled image — which
     * keeps the viewer's on-screen offset intact (essential in a grid).
     *
     * @returns array of {x,y} image-space points, or null if the mask is unusable
     */
    maskToPolygon(
        mask: MaskResult,
        ref: any,
        screenshotWidth: number,
        screenshotHeight: number,
        ratio: number,
        viewer: any
    ): Array<{ x: number; y: number }> | null {
        const { binaryMask, width, height } = mask;
        const totalPixels = binaryMask.length;
        const filledPixels = binaryMask.reduce((sum: number, val: number) => sum + val, 0);

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

        this.MagicWand = this.MagicWand || OSDAnnotations.makeMagicWand();
        const contours = this.MagicWand.traceContours({
            data: binaryMask,
            width,
            height,
            bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
        });

        let largest: Array<{ x: number; y: number }> | undefined;
        let count = 0;
        for (const line of contours) {
            if (!line.inner && line.points.length > count) {
                largest = line.points;
                count = line.points.length;
            }
        }
        if (!largest) return null;

        const sx = screenshotWidth / width;
        const sy = screenshotHeight / height;
        return largest.map(pt =>
            ref.viewerElementToImageCoordinates(new OSD.Point((pt.x * sx) / ratio, (pt.y * sy) / ratio))
        );
    }
}

(window as any).PathologyFoundation = PathologyFoundation;
addModule("pathology-foundation", PathologyFoundation as any);

export {};
