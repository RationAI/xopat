/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * Annotation mode that segments the clicked feature with the Segment Anything
 * model and commits the result as a polygon annotation.
 *
 * Multi-viewport safe: it derives the active viewer from `this.context.viewer`
 * (which honours mode locking) and threads it through capture, inference and
 * annotation creation — never touching the global `VIEWER`.
 *
 * @class SegmentAnythingState
 * @extends OSDAnnotations.AnnotationState
 */

const OSDAnnotationsRef: any = (window as any).OSDAnnotations;
const OSDLib: any = (window as any).OpenSeadragon;

function samEscapeHtml(value: string): string {
    return String(value).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
    ));
}

class SegmentAnythingState extends OSDAnnotationsRef.AnnotationState {
    private sam: any;
    private _samProcessing: boolean;
    private _ready: boolean;
    private _initPromise: Promise<void> | null;
    private _isLeft: boolean;

    constructor(context: any) {
        super(context, "SAM_SEGMENTATION", "ph-sparkle", "🅢 segment anything");
        // No heavy work here — the mode is constructed at registration time,
        // long before the user opts into it. Models load lazily on activation.
        this.sam = (window as any).SAMInference.instance();
        this._samProcessing = false;
        this._ready = false;
        this._initPromise = null;
        this._isLeft = true;
    }

    /**
     * Lazily load servers + models the first time the mode is entered.
     */
    private _ensureReady(): Promise<void> {
        if (this._ready) return Promise.resolve();
        if (this._initPromise) return this._initPromise;

        USER_INTERFACE.Loading.show(true);
        USER_INTERFACE.Loading.text("Loading segmentation models...");

        this._initPromise = (async () => {
            try {
                if (this.sam.selectedComputationDevice === "Client") {
                    // In-browser inference: load only the selected model.
                    await this.sam.loadSelectedModel();
                } else {
                    // Server inference: just confirm the chosen server is up.
                    await this.sam.probeServer(this.sam.selectedComputationDevice);
                }
                this._ready = true;
            } catch (error: any) {
                this.context.viewer.raiseEvent("error-user", {
                    originType: "module",
                    originId: "sam-segmentation-experimental",
                    code: "E_SAM_INIT",
                    message: "Failed to initialize Segment Anything: " + (error?.message || error),
                });
            } finally {
                USER_INTERFACE.Loading.show(false);
                this._initPromise = null;
            }
        })();
        return this._initPromise;
    }

    setFromAuto(): boolean {
        this.context.setCursors("crosshair");
        // Kick off lazy initialization; clicks are ignored until ready.
        this._ensureReady();
        return true;
    }

    setToAuto(temporary: boolean): boolean {
        if (temporary) return false;
        this.context.setCursors("auto");
        return true;
    }

    /**
     * Mode-options panel: model + computation-device pickers. Rendered by the
     * gui_annotations toolbar when this mode is active.
     */
    customHtml(): string {
        const sam = this.sam;
        const accessor = "singletonModule('sam-segmentation-experimental')";

        const modelOptions = Object.entries(sam.ALLOWED_MODELS || {})
            .map(([hfName, shortName]) => {
                const selected = hfName === sam.selectedModel ? " selected" : "";
                return `<option value="${samEscapeHtml(hfName)}"${selected}>${samEscapeHtml(String(shortName))}</option>`;
            })
            .join("");

        const devices = ["Client", ...Object.keys(sam.GPU_SERVERS || {})];
        const deviceOptions = devices
            .map(device => {
                const selected = device === sam.selectedComputationDevice ? " selected" : "";
                const label = device === "Client" ? "Client (in-browser)" : device;
                return `<option value="${samEscapeHtml(device)}"${selected}>${samEscapeHtml(label)}</option>`;
            })
            .join("");

        // The shared mode-options panel sizes itself with `w-80`, which the
        // purged Tailwind build drops — so size this content explicitly with
        // inline styles (always applied) rather than relying on utility widths.
        return `
<div style="display:flex;flex-direction:column;gap:0.75rem;width:16rem;max-width:100%;padding:0.25rem;">
    <div style="display:flex;flex-direction:column;gap:0.25rem;">
        <label class="text-xs font-medium opacity-70" for="sam-model-dropdown">Model</label>
        <select id="sam-model-dropdown" class="select select-sm select-bordered" style="width:100%;"
            onchange="${accessor}.setModel(this.value)">${modelOptions}</select>
    </div>
    <div style="display:flex;flex-direction:column;gap:0.25rem;">
        <label class="text-xs font-medium opacity-70" for="sam-computation-dropdown">Computation</label>
        <select id="sam-computation-dropdown" class="select select-sm select-bordered" style="width:100%;"
            onchange="${accessor}.setComputationDevice(this.value)">${deviceOptions}</select>
    </div>
    <p class="text-xs opacity-60" style="margin:0;">Pick a preset, then click a feature on the slide to segment it.</p>
</div>`;
    }

    handleClickUp(o: MouseEvent, point: any, isLeftClick: boolean): boolean {
        if (!isLeftClick || this._samProcessing) return false;

        // Ignore drags/pans — a genuine "click to segment" is a short press.
        const clickDelta = Date.now() - this.context.cursor.mouseTime;
        if (clickDelta > 300) return false;

        // Readiness depends on the chosen device: a loaded client model, or a
        // reachable GPU server. Derive it from live state so switching device
        // mid-session is honoured.
        const device = this.sam.selectedComputationDevice;
        const usable = device === "Client"
            ? this.sam.isModelLoaded(this.sam.selectedModel)
            : this.sam.isServerAvailable(device);
        if (!usable) {
            this.context.viewer.raiseEvent("warn-user", {
                originType: "module",
                originId: "sam-segmentation-experimental",
                code: "W_SAM_NOT_READY",
                message: device === "Client"
                    ? "Segment Anything is still loading the model, please wait..."
                    : `Segment Anything server "${device}" is not available.`,
            });
            // (Re)start initialization in case an earlier attempt failed or the
            // computation device changed since the mode was entered.
            this._ready = false;
            this._ensureReady();
            return false;
        }

        const preset = this.context.presets.getActivePreset(isLeftClick);
        if (!preset) {
            this.abortClick(isLeftClick, true);
            return false;
        }

        this._samProcessing = true;
        this._isLeft = isLeftClick;

        // Capture the viewer now so a focus change mid-inference cannot redirect
        // the resulting annotation to a different viewport.
        const viewer = this.context.viewer;

        USER_INTERFACE.Loading.show(true);
        USER_INTERFACE.Loading.text("Waiting for segmentation...");
        this.sam.raiseSegmentationStarted();

        // Defer so the loading overlay paints before the heavy work begins.
        setTimeout(() => this._executeSegmentation(viewer, point), 0);
        return true;
    }

    private async _executeSegmentation(viewer: any, point: any): Promise<void> {
        const finish = () => {
            this._samProcessing = false;
            USER_INTERFACE.Loading.show(false);
            this.sam.raiseSegmentationFinished();
        };

        try {
            const ref = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world.getItemAt(0);
            if (!ref) {
                finish();
                return;
            }
            const ratio = OSDLib.pixelDensityRatio;

            const capture = await this.sam.captureViewportImage(viewer);
            if (!capture) {
                finish();
                return;
            }

            // Click position in the screenshot's device-pixel space: image →
            // CSS viewer-element pixels → device pixels.
            const el = ref.imageToViewerElementCoordinates(point);
            const samCoords = { x: el.x * ratio, y: el.y * ratio };

            const result = await this.sam.runInference(capture.blob, samCoords);
            if (result) {
                const polygon = this.sam.maskToPolygon(result, ref, capture.width, capture.height, ratio, viewer);
                if (polygon) {
                    const visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
                    const factory = this.context.getAnnotationObjectFactory("polygon");
                    const annotation = factory.create(polygon, visualProps);
                    this.context.getFabric(viewer).addAnnotation(annotation);
                }
            }
        } catch (error: any) {
            console.error("SAM: error during segmentation:", error);
            viewer.raiseEvent("error-user", {
                originType: "module",
                originId: "sam-segmentation-experimental",
                code: "E_SAM_SEGMENT",
                message: "Error during segmentation: " + (error?.message || error),
            });
        } finally {
            finish();
        }
    }
}

OSDAnnotationsRef.SegmentAnythingState = SegmentAnythingState;

export {};
