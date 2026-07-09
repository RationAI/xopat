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

export type TissueAnnotationResult = {
    driver: string;
    /** Ids of the polygon annotations drawn for the detected tissue. */
    annotationIds: Array<string | number>;
    /** Fraction of the whole view covered by tissue (0..1). */
    coverage: number;
};

export type TissueCoverageResult = {
    driver: string;
    annotationId: string | number;
    /** Fraction of the annotation's area covered by tissue (0..1). */
    coverage: number;
    tissuePixels: number;
    areaPixels: number;
};

export type SegmentResult = {
    driver: string;
    /** Ids of polygon annotations created from the returned mask. */
    annotationIds: Array<string | number>;
};

export type AnalysisResult = {
    driver: string;
    /** Text findings from the vision model, or null. */
    findings: string | null;
};

export interface PathologyScriptApi extends ScriptApiObject {
    /** List the configured drivers and which features each can perform. */
    listDrivers(): PathologyDriverInfo[];

    /**
     * Detect ALL tissue on the ACTIVE viewer and draw it as polygon
     * annotation(s). Reads the raw background image with a built-in in-browser
     * detector (no server, nothing leaves the viewer). Use this for "outline /
     * segment the tissue". Select the viewer first with
     * application.setActiveViewer(...).
     * @param driver optional tissue-mask driver id.
     */
    annotateTissue(driver?: string): Promise<TissueAnnotationResult>;

    /**
     * Measure what fraction of an annotation is covered by tissue. If
     * \`annotationId\` is omitted, the user is asked to select an annotation.
     * Use this for "how much of this region is tissue?". Returns \`coverage\`
     * in 0..1.
     * @param annotationId the annotation's increment id (optional).
     * @param driver optional tissue-mask driver id.
     */
    tissueCoverage(annotationId?: string | number, driver?: string): Promise<TissueCoverageResult>;

    /**
     * Segment the region at a SPECIFIC SPOT. The user is asked to click a point
     * on the slide, then that region is segmented and drawn as a polygon
     * annotation. Requires a driver implementing the "segment" feature (e.g. the
     * Segment Anything plugin). For segmenting ALL tissue use annotateTissue
     * instead. May ask for permission if the driver is remote.
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
                "Run concrete pathology jobs on the current slide instead of guessing. To work with tissue, " +
                "call annotateTissue to outline ALL the tissue, or tissueCoverage(annotationId?) to measure how " +
                "much of a region is tissue — both use a built-in in-browser detector on the raw slide and need " +
                "no server. To outline a SPECIFIC spot call segmentAtPoint (the user is asked to click it). To " +
                "answer a visual question call analyzeRegion (needs a configured model and asks the user first). " +
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

        /** Consent only when the resolved driver is remote (a snapshot would leave the viewer). */
        async _consentIfRemote(feature: string, driverId: string | undefined, task: string): Promise<void> {
            const info = this._getModule().describeDriverForFeature(feature, driverId);
            if (info?.local) return;
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
