/// <reference path="../../../src/types/globals.d.ts" />

/**
 * Pathology foundation-model scripting namespace (`pathology`).
 *
 * Mirrors the annotations/questionnaire scripting pattern: a thin adapter over
 * the `pathology-foundation` module that the host scripting layer and the LLM
 * integrations (the vercel-ai-chat-sdk module and every other chat provider)
 * can call. The scripting manager injects this namespace + the inline `.d.ts`
 * below into the model system prompt, so those declarations are what teach the
 * model how to use it.
 *
 * The namespace **description** carries the behavioural steering — it nudges the
 * agent to use a real foundation model (segmentation / analysis) instead of
 * guessing a viewport bounding box. Because the manifest is shared by all
 * providers, this needs no change in the chat module.
 *
 * No ES import crosses the module/plugin/core boundary: `ScriptingManager` and
 * `singletonModule` are runtime globals.
 */

/**
 * Inline TypeScript declarations describing the `pathology` namespace. Parsed by
 * ScriptingManager.parseDtsForApi; the interface name must resolve from the
 * namespace ("pathology" -> PathologyScriptApi).
 */
const PATHOLOGY_DTS = `
/** A configured foundation-model transport. */
export type PathologyDriverInfo = {
    id: string;
    label: string;
    /** What this driver can return. */
    capabilities: { masks?: boolean; text?: boolean };
    isDefault: boolean;
};

export type PathologyAnalysis = {
    /** The driver that produced this result. */
    driver: string;
    /** Ids of polygon annotations created from returned masks (empty for text-only). */
    annotationIds: Array<string | number>;
    /** Text or structured findings returned by the model, or null. */
    findings: string | Record<string, unknown> | null;
    /** Short human-readable summary suitable for relaying to the user. */
    summary: string;
};

export interface PathologyScriptApi extends ScriptApiObject {
    /** List the configured foundation-model drivers and their capabilities. */
    listDrivers(): PathologyDriverInfo[];

    /**
     * Send a snapshot of the ACTIVE viewer plus \`prompt\` to a segmentation
     * model and draw the returned tissue/region mask(s) as polygon annotations.
     * Prefer this over computing a bounding box when the user wants a region
     * outlined. Select the viewer first with application.setActiveViewer(...).
     * Asks the user for permission (the slide image leaves the viewer).
     * @param prompt optional guidance, e.g. "tumour epithelium".
     * @param driver optional driver id (defaults to the configured default).
     */
    segmentRegion(prompt?: string, driver?: string): Promise<PathologyAnalysis>;

    /**
     * Send a snapshot of the ACTIVE viewer plus \`prompt\` to a vision/analysis
     * model and return its findings (classification/description) as text. Use
     * this to answer pathology questions instead of guessing. Asks the user for
     * permission (the slide image leaves the viewer).
     * @param prompt the question/instruction for the model.
     * @param driver optional driver id (defaults to the configured default).
     */
    analyzeRegion(prompt: string, driver?: string): Promise<PathologyAnalysis>;
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

    class XOpatPathologyScriptApi extends ScriptApiBase {
        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: PATHOLOGY_DTS },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "Pathology foundation models",
                "Run pathology foundation models on the current slide. When the user asks where tissue/tumour " +
                "is, or to outline/segment a region, call segmentRegion to get a real mask drawn as an annotation " +
                "instead of computing a bounding box. When the user asks what something is, call analyzeRegion to " +
                "get model findings instead of guessing. Both send a snapshot of the active viewer to a configured " +
                "model and ask the user for permission first. Select the viewer with application.setActiveViewer " +
                "before calling.",
            );
        }

        /** Live module instance; throws when the module is not loaded. */
        _getModule(): any {
            const instance = (globalThis as any).singletonModule?.(MODULE_ID);
            if (!instance) {
                throw new Error("The pathology-foundation module is not available. Enable it first.");
            }
            return instance;
        }

        /** One consent prompt before a snapshot leaves the viewer. Throws on decline. */
        async _consent(driverId: string, task: string): Promise<void> {
            await this.requireActionConsent({
                title: "Send slide snapshot for analysis",
                description: "A script wants to send a snapshot of the current slide to a pathology model.",
                details: [
                    `Model driver: ${driverId || "(default)"}`,
                    `Task: ${task}`,
                ],
                mode: "warning",
                confirmLabel: "Send",
                rejectedMessage: "The pathology analysis was canceled by the user.",
            });
        }

        // ---- read (no consent) ----

        listDrivers(): any {
            return this._getModule().listDrivers();
        }

        // ---- analysis (consent gated: a slide snapshot leaves the viewer) ----

        async segmentRegion(prompt?: string, driver?: string): Promise<any> {
            const module = this._getModule();
            await this._consent(driver || "default", "segmentation → annotations");
            return module.analyze(this.activeViewer, {
                prompt: prompt || "",
                task: "segment",
                driver,
            });
        }

        async analyzeRegion(prompt: string, driver?: string): Promise<any> {
            const module = this._getModule();
            await this._consent(driver || "default", "image analysis → findings");
            return module.analyze(this.activeViewer, {
                prompt: prompt || "",
                task: "analyze",
                driver,
            });
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatPathologyScriptApi("pathology")),
        { label: "pathology" },
    );
}
