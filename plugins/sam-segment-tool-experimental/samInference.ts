/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * Segment Anything (SAM) inference engine.
 *
 * Loads the transformers.js library + models for in-browser inference, or
 * delegates to a configured GPU server. Pure compute + IO: it never reaches
 * for the global `VIEWER` — every viewer-bound operation receives the viewer
 * explicitly so it behaves correctly in a multi-viewport grid.
 *
 * Owned by the SAM plugin via composition (`new SAMInference(plugin)`); it reads
 * its config and raises its events through the owning plugin, so there is no
 * standalone module. Viewport capture + mask→polygon tracing are delegated to
 * the shared pathology-foundation module (see `_pathology()`); no cross-boundary
 * ES import — the broker is reached via the `singletonModule` global.
 *
 * @class SAMInference
 */

interface SamServerInfo {
    path: string;
    available: boolean;
    client: any;
}

interface SamMaskResult {
    binaryMask: Uint8Array;
    width: number;
    height: number;
}

interface SamViewportCapture {
    blob: Blob;
    width: number;
    height: number;
}

export class SAMInference {
    GPU_SERVERS: Record<string, SamServerInfo>;
    ALLOWED_MODELS: Record<string, string>;

    private _owner: any;
    private _models: Record<string, any>;
    private _processors: Record<string, any>;
    private _modelsLoaded: boolean;
    private _selectedModel: string | null;
    private _selectedComputationDevice: string;

    private AutoProcessor: any;
    private SamModel: any;
    private RawImage: any;

    /** @param owner the SAM plugin instance (provides getStaticMeta + raiseEvent). */
    constructor(owner: any) {
        this._owner = owner;
        this._models = {};
        this._processors = {};
        this._modelsLoaded = false;
        this._selectedModel = null;
        this._selectedComputationDevice = "Client";

        // Servers defined in the plugin configuration. Each server gets its own
        // HttpClient so all upstream traffic is auth/proxy/secureMode aware.
        const serverConfigs = this._owner.getStaticMeta("servers", []) as Array<{ name: string; path: string }>;
        this.GPU_SERVERS = {};
        for (const server of serverConfigs) {
            this.GPU_SERVERS[server.name] = {
                path: server.path,
                available: false,
                client: new (window as any).HttpClient({ baseURL: server.path }),
            };
        }

        // Models defined in the plugin configuration: keyed by HF id, value is short name.
        const models = this._owner.getStaticMeta("models", {}) as Record<string, string>;
        this.ALLOWED_MODELS = {};
        for (const [shortName, fullName] of Object.entries(models)) {
            this.ALLOWED_MODELS[fullName] = shortName;
        }

        // Pick a sensible default so the options panel renders a selection and
        // lazy-load knows what to fetch first.
        this._selectedModel = Object.keys(this.ALLOWED_MODELS)[0] || null;
    }

    isModelLoaded(name: string | null): boolean {
        return !!(name && this._models[name]);
    }

    /** True if the named GPU server has been probed and reported availability. */
    isServerAvailable(name: string): boolean {
        return !!this.GPU_SERVERS[name]?.available;
    }

    get modelsLoaded(): boolean {
        return this._modelsLoaded;
    }

    get selectedModel(): string | null {
        return this._selectedModel;
    }

    get selectedComputationDevice(): string {
        return this._selectedComputationDevice;
    }

    raiseSegmentationStarted(): void {
        this._owner.raiseEvent("segmentation-started");
    }

    raiseSegmentationFinished(): void {
        this._owner.raiseEvent("segmentation-finished");
    }

    /**
     * Probe a single configured GPU server for availability. Called lazily only
     * when the user actually selects that server — the Client default never
     * touches the network, so no servers are contacted unless explicitly chosen.
     */
    async probeServer(name: string): Promise<boolean> {
        const info = this.GPU_SERVERS[name];
        if (!info) return false;
        try {
            const data = await info.client.request("gpu", { method: "GET", expect: "json" });
            info.available = data?.gpu_available === true;
        } catch (_) {
            info.available = false;
        }
        return info.available;
    }

    /** Ensure the transformers.js library is loaded (idempotent, client-only). */
    private async _ensureLibrary(): Promise<void> {
        if (this.AutoProcessor) return;
        await this._loadDependencies();
        if (!this.AutoProcessor) {
            throw new Error("Transformers library failed to load; cannot run in-browser segmentation.");
        }
    }

    /**
     * Lazily load a single model's processor + weights (idempotent per model).
     * Only the model the user actually selected is fetched — eagerly loading
     * every configured model downloaded hundreds of MB and looked like a hang.
     */
    async ensureModel(modelName: string): Promise<void> {
        if (!(modelName in this.ALLOWED_MODELS)) {
            throw new Error(`SAM: model "${modelName}" is not in the configured allow-list.`);
        }
        await this._ensureLibrary();
        if (this._models[modelName]) return;

        // NB: do NOT pin device to WebGPU — quantized (q8) SAM on the WebGPU
        // backend returns degenerate, near-full masks. Let transformers.js use
        // its default (WASM), which matches the known-good v2 behaviour.
        this._processors[modelName] = await this.AutoProcessor.from_pretrained(modelName);
        this._models[modelName] = await this.SamModel.from_pretrained(modelName, { dtype: "q8" });
        this._modelsLoaded = true;
        this._owner.raiseEvent("models-loaded", { model: modelName });
    }

    /** Load whatever model is currently selected (used on mode activation). */
    async loadSelectedModel(): Promise<void> {
        if (!this._selectedModel) throw new Error("SAM: no model configured.");
        await this.ensureModel(this._selectedModel);
    }

    /**
     * Switch the active client model, loading it on demand with a loading
     * overlay. Safe to call directly from the mode-options dropdown.
     */
    async setModel(modelName: string): Promise<void> {
        if (!(modelName in this.ALLOWED_MODELS)) {
            console.error(`SAM: model ${modelName} is not allowed.`);
            return;
        }
        this._selectedModel = modelName;
        if (this._models[modelName] || this._selectedComputationDevice !== "Client") return;
        try {
            USER_INTERFACE.Loading.show(true);
            USER_INTERFACE.Loading.text(`Loading model ${this.ALLOWED_MODELS[modelName]}...`);
            await this.ensureModel(modelName);
        } catch (error: any) {
            console.error("SAM: failed to load model:", error);
        } finally {
            USER_INTERFACE.Loading.show(false);
        }
    }

    /**
     * Switch the computation device. Selecting a GPU server probes it lazily;
     * switching back to Client makes sure the selected model is loaded.
     */
    async setComputationDevice(computationDevice: string): Promise<void> {
        this._selectedComputationDevice = computationDevice;
        if (computationDevice === "Client") {
            this.setModel(this._selectedModel as string);
            return;
        }
        await this.probeServer(computationDevice);
    }

    /**
     * Run inference on a captured viewport image.
     * @param viewportBlob PNG blob of the captured viewport (device pixels)
     * @param clickCoords click position in the same (device-pixel) space
     */
    async runInference(viewportBlob: Blob, clickCoords: { x: number; y: number }): Promise<SamMaskResult | null> {
        if (!viewportBlob) {
            console.error("SAM: invalid viewport blob.");
            return null;
        }

        if (this._selectedComputationDevice === "Client") {
            if (!this.isModelLoaded(this._selectedModel)) {
                console.error("SAM: selected model not loaded.");
                return null;
            }
            return await this._runInferenceClient(viewportBlob, clickCoords);
        }
        return await this._runInferenceServer(viewportBlob, clickCoords);
    }

    private async _loadDependencies(): Promise<void> {
        if (this.AutoProcessor) return;

        const transformersConfig = this._owner.getStaticMeta("transformers", {}) as { library?: string; hash?: string };
        let libPath = transformersConfig.library;
        const expectedHash = transformersConfig.hash;

        if (!libPath || !expectedHash) {
            console.error("SAM: transformers library path or hash not found in config.");
            return;
        }

        // Loading remote, unpinned-by-URL code is a supply-chain risk. Refuse in
        // secure mode; otherwise verify a SHA-256 pin before importing.
        if (APPLICATION_CONTEXT.secureMode) {
            throw new Error("SAM: refusing to load remote transformers library in secure mode.");
        }

        // Normalize protocol-relative CDN URLs so HttpClient treats them as absolute.
        if (libPath.startsWith("//")) libPath = `https:${libPath}`;

        try {
            const lib = await this._fetchAndVerifyScript(libPath, expectedHash);
            this.AutoProcessor = lib.AutoProcessor;
            this.SamModel = lib.SamModel;
            this.RawImage = lib.RawImage;
        } catch (err) {
            console.error("SAM: secure loading of transformers library failed:", err);
        }
    }

    private async _fetchAndVerifyScript(libPath: string, expectedHash: string): Promise<any> {
        // The CDN URL is absolute; HttpClient requires a baseURL (or proxy), so
        // seed it with the library URL itself. `request` short-circuits on an
        // absolute path, follows the jsDelivr redirect, and applies no auth to
        // this foreign origin.
        const client = new (window as any).HttpClient({ baseURL: libPath });
        const scriptText: string = await client.request(libPath, { method: "GET", expect: "text" });

        const data = new TextEncoder().encode(scriptText);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        if (hashHex !== expectedHash) {
            throw new Error("SAM: transformers library hash verification failed.");
        }

        const blob = new Blob([scriptText], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        try {
            return await import(/* @vite-ignore */ blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }

    private async _runInferenceClient(viewportBlob: Blob, clickCoords: { x: number; y: number }): Promise<SamMaskResult | null> {
        let imageUrl: string | null = null;
        try {
            imageUrl = URL.createObjectURL(viewportBlob);
            const image = await this.RawImage.read(imageUrl);

            const input_points = [[[[clickCoords.x, clickCoords.y]]]];
            const processor = this._processors[this._selectedModel as string];
            const model = this._models[this._selectedModel as string];

            const inputs = await processor(image, { input_points });
            const outputs = await model(inputs);

            const masks = await processor.post_process_masks(
                outputs.pred_masks,
                inputs.original_sizes,
                inputs.reshaped_input_sizes
            );

            return this._processSegmentationMask(masks, outputs.iou_scores);
        } catch (error) {
            console.error("SAM: client inference error:", error);
            return null;
        } finally {
            if (imageUrl) URL.revokeObjectURL(imageUrl);
        }
    }

    private async _runInferenceServer(viewportBlob: Blob, clickCoords: { x: number; y: number }): Promise<SamMaskResult | null> {
        const serverInfo = this.GPU_SERVERS[this._selectedComputationDevice];
        if (!serverInfo) {
            console.error(`SAM: unknown computation device ${this._selectedComputationDevice}.`);
            return null;
        }

        const base64String = await this._blobToBase64(viewportBlob);
        const data = await serverInfo.client.request("segment", {
            method: "POST",
            expect: "json",
            body: {
                image: base64String,
                x: clickCoords.x,
                y: clickCoords.y,
                model: this.ALLOWED_MODELS[this._selectedModel as string],
            },
        });

        const binaryStr = atob(data.binary_mask);
        const binaryMask = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            binaryMask[i] = binaryStr.charCodeAt(i);
        }
        return { binaryMask, width: data.width, height: data.height };
    }

    private _blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private _processSegmentationMask(masks: any, scores: any): SamMaskResult {
        const image = this.RawImage.fromTensor(masks[0][0].mul(255));
        const scoresArray = scores.data;
        const maxIouScore = scoresArray.indexOf(Math.max(...scoresArray));
        const bestChannel = image.split()[maxIouScore];

        const binaryMask = new Uint8Array(bestChannel.data.length);
        for (let i = 0; i < bestChannel.data.length; i++) {
            binaryMask[i] = bestChannel.data[i] > 128 ? 1 : 0;
        }

        return { binaryMask, width: bestChannel.width, height: bestChannel.height };
    }

    /**
     * Trace a binary mask into a polygon in the supplied viewer's image
     * coordinates. Delegates to the shared pathology-foundation tracer so SAM
     * and any other model share one mask→polygon implementation.
     */
    maskToPolygon(
        mask: SamMaskResult,
        ref: any,
        screenshotWidth: number,
        screenshotHeight: number,
        ratio: number,
        viewer: any
    ): Array<{ x: number; y: number }> | null {
        return this._pathology().maskToPolygon(mask, ref, screenshotWidth, screenshotHeight, ratio, viewer);
    }

    /**
     * Capture the rendered raster of a specific viewer as a PNG blob (device
     * pixels). Delegates to the shared pathology-foundation broker.
     */
    async captureViewportImage(viewer: any): Promise<SamViewportCapture | null> {
        return this._pathology().captureViewportImage(viewer);
    }

    /** The shared broker that owns viewport capture + mask tracing. */
    private _pathology(): any {
        const mod = (window as any).singletonModule?.("pathology-foundation");
        if (!mod) {
            throw new Error("SAM requires the pathology-foundation module. Enable it first.");
        }
        return mod;
    }
}
