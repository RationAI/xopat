import type { ScriptApiMetadata } from "./abstract-types";
import type {
    VisualizationScriptApi,
    VisualizationDocsModel,
    VisualizationStateSnapshot,
    VisualizationViewportRenderOptions,
    VisualizationViewportPixelsResult,
    VisualizationFirstPassExtractOptions,
    VisualizationLayerSource,
    VisualizationShaderGroupOrLayer,
} from "./visualization-api.scripts";

import { XOpatScriptingApi } from "./abstract-api";
import { reviewVisualizationProposal, type VisualizationReviewDecision } from "./visualization-review";

/**
 * Thrown by `requireVisualizationReview` when the user clicks "Send to LLM with
 * feedback" in the playground. Carries the textual feedback and the snapshot
 * the user had pending in the playground at the moment of feedback. The script
 * runtime surfaces this to the assistant as a tool error whose message contains
 * the feedback verbatim — the LLM treats it as a normal "user wants refinement"
 * signal and re-plans.
 */
class VisualizationReviewFeedbackError extends Error {
    feedback: string;
    editedSnapshot: VisualizationStateSnapshot;

    constructor(feedback: string, editedSnapshot: VisualizationStateSnapshot) {
        super("User wants the assistant to refine the proposed change. Feedback: " + feedback);
        this.name = "VisualizationReviewFeedbackError";
        this.feedback = feedback;
        this.editedSnapshot = editedSnapshot;
    }
}

function cloneJson<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return value;
    }
}

function sanitizeArrayOfIntegers(value: any): number[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const out: number[] = [];
    for (const item of value) {
        if (Number.isInteger(item)) {
            out.push(item);
        }
    }
    return out;
}

function isPlainObject(value: any): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }
    return !Array.isArray(value);
}

export class XOpatVisualizationScriptApi extends XOpatScriptingApi implements VisualizationScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatVisualizationScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => {
                const res = await fetch(APPLICATION_CONTEXT.url + "src/classes/scripting/visualization-api.scripts.d.ts");
                if (!res.ok) {
                    throw new Error("Failed to load visualization-api.scripts.d.ts");
                }
                return await res.text();
            }
        }
    };

    constructor(namespace: string) {
        super(
            namespace,
            "Visualization Interface",
            "The namespace provides shader documentation, persistent visualization management for the current viewer session, and standalone viewport rendering/extraction with custom visualization configurations."
        );
    }

    protected get shaderConfigurator(): any {
        const fr: any = (OpenSeadragon as any).FlexRenderer;
        if (!fr) {
            throw new Error("FlexRenderer is not available.");
        }

        if (!fr.ShaderConfigurator) {
            throw new Error("FlexRenderer.ShaderConfigurator is not available.");
        }

        return fr.ShaderConfigurator;
    }

    /**
     * xOpat session-format extras that augment the renderer-published `shaderConfigBase`
     * whitelist. `dataReferences` is the host's session-data wiring; `shaders` and `order`
     * belong to group layers. Everything else allowed at the top level of a layer comes
     * from the renderer schema.
     */
    protected static readonly XOPAT_SESSION_TOP_KEYS = ["dataReferences", "shaders", "order"];

    /**
     * Read a params bucket from a shader schema. Plural names parallel each other.
     */
    protected readSchemaParamsBucket(schemaParams: any, kind: "builtIns" | "controls" | "customParams"): any[] {
        if (!isPlainObject(schemaParams)) return [];
        const direct = (schemaParams as any)[kind];
        return Array.isArray(direct) ? direct : [];
    }

    /**
     * Locate one shader's entry in the renderer-published config schema model. Returns the
     * raw schema object (not cloned) - callers must not mutate. Match is by shader `type`.
     */
    protected findShaderInModel(model: any, shaderType: string): any | undefined {
        const shaders = model && model.shaders;
        if (Array.isArray(shaders)) {
            return shaders.find((s: any) => s && s.type === shaderType);
        }
        if (isPlainObject(shaders)) {
            for (const value of Object.values(shaders)) {
                if (value && (value as any).type === shaderType) return value;
            }
        }
        return undefined;
    }

    /**
     * Allowed top-level layer keys for a given shader. Pulled from
     * `model.shaderConfigBase.properties` ∪ `schema.rootConfig.properties` ∪ xOpat session-format
     * extras. Underscore-prefixed and `cache` are filtered out as renderer-internal storage that
     * should not be set from a script.
     */
    protected getAllowedTopLevelKeys(model: any, schema: any): Set<string> {
        const allowed = new Set<string>(XOpatVisualizationScriptApi.XOPAT_SESSION_TOP_KEYS);
        const collect = (props: any) => {
            if (!Array.isArray(props)) return;
            for (const entry of props) {
                if (!entry || typeof entry.key !== "string") continue;
                if (entry.key.startsWith("_")) continue;
                if (entry.key === "cache") continue;
                allowed.add(entry.key);
            }
        };
        collect(model && model.shaderConfigBase && model.shaderConfigBase.properties);
        collect(schema && schema.rootConfig && schema.rootConfig.properties);
        return allowed;
    }

    /**
     * Allowed `params` keys for a layer of `schema`. Union of built-ins, UI controls, and
     * custom params - all read from the renderer-published schema. The host adds nothing.
     */
    protected getAllowedParamKeys(schema: any): Set<string> {
        const allowed = new Set<string>();
        const params = schema && schema.params;
        for (const bucket of ["builtIns", "controls", "customParams"] as const) {
            for (const entry of this.readSchemaParamsBucket(params, bucket)) {
                if (entry && typeof entry.key === "string") {
                    allowed.add(entry.key);
                } else if (entry && typeof entry.name === "string") {
                    // customParams may use `name` rather than `key`.
                    allowed.add(entry.name);
                }
            }
        }
        return allowed;
    }

    /**
     * Validate one layer (and its nested children) against the renderer-published schema.
     * Generic and schema-driven: the host does not know any shader names or control names.
     * Pushes human-readable issues into `issues`.
     */
    protected validateLayerKeys(
        layer: any,
        path: string,
        model: any,
        issues: string[]
    ): void {
        if (!isPlainObject(layer)) return;

        // Recurse into nested groups first so the user gets every issue at once.
        if (isPlainObject(layer.shaders)) {
            for (const [childKey, child] of Object.entries(layer.shaders)) {
                this.validateLayerKeys(child, path ? `${path}/${childKey}` : childKey, model, issues);
            }
        }

        const layerType = typeof layer.type === "string" ? layer.type : undefined;
        if (!layerType || layerType === "group") return;

        const schema = this.findShaderInModel(model, layerType);
        if (!schema) {
            // Shader-type validity is the runtime's job; we'd duplicate its message here.
            return;
        }

        const allowedTop = this.getAllowedTopLevelKeys(model, schema);
        const unknownTop = Object.keys(layer).filter((key) => !allowedTop.has(key));
        if (unknownTop.length > 0) {
            issues.push(
                `Layer '${path || layer.id || layerType}' has unknown top-level fields: ` +
                `${unknownTop.join(", ")}. Allowed for shader '${layerType}': ` +
                `${[...allowedTop].sort().join(", ")}.`
            );
        }

        if (isPlainObject(layer.params)) {
            const allowedParams = this.getAllowedParamKeys(schema);
            if (allowedParams.size > 0) {
                const unknownParams = Object.keys(layer.params).filter((key) => !allowedParams.has(key));
                if (unknownParams.length > 0) {
                    issues.push(
                        `Shader '${layerType}' (layer '${path || layer.id || layerType}') does not define ` +
                        `params: ${unknownParams.join(", ")}. Valid params: ` +
                        `${[...allowedParams].sort().join(", ")}.`
                    );
                }
            }
        }
    }

    /**
     * Validate a list of proposed visualizations before the user is asked to review them.
     * Throws on the first issue with a message that lists every offending key plus the valid
     * set, so the LLM can fix and retry without the user ever seeing the playground.
     *
     * Typed as `any[]` because two `VisualizationItem` types coexist in this file (scripts vs
     * ambient, see top-of-file TODO); the validator only does shape checks via `isPlainObject`.
     */
    protected validateProposedVisualizations(visualizations: any[]): void {
        if (!Array.isArray(visualizations) || visualizations.length < 1) return;

        const model = (() => {
            try {
                return this.shaderConfigurator.compileConfigSchemaModel();
            } catch (_err) {
                return undefined;
            }
        })();
        if (!model) return; // Renderer hasn't published a schema; let the runtime layer take it.

        const issues: string[] = [];
        visualizations.forEach((viz, i) => {
            if (!isPlainObject(viz) || !isPlainObject((viz as any).shaders)) return;
            for (const [layerKey, layer] of Object.entries((viz as any).shaders)) {
                this.validateLayerKeys(layer, `viz[${i}].${layerKey}`, model, issues);
            }
        });

        if (issues.length > 0) {
            throw new Error(
                `Visualization validation failed before review:\n- ${issues.join("\n- ")}`
            );
        }
    }

    protected get standaloneFactory(): any {
        const osd: any = OpenSeadragon as any;
        if (typeof osd.makeStandaloneFlexDrawer !== "function") {
            throw new Error("OpenSeadragon.makeStandaloneFlexDrawer is not available.");
        }
        return osd.makeStandaloneFlexDrawer;
    }

    protected getCurrentStandaloneDrawer(): any {
        const viewer: any = this.activeViewer;
        let drawer = viewer.__scriptVisualizationStandaloneDrawer;
        if (!drawer) {
            drawer = this.standaloneFactory(viewer);
            viewer.__scriptVisualizationStandaloneDrawer = drawer;
        }
        return drawer;
    }

    protected getActiveVisualizationSelection(): Array<number | undefined> | undefined {
        const raw = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true);
        if (raw === undefined || raw === null) {
            return undefined;
        }

        if (Array.isArray(raw)) {
            return raw.map((entry: any) => {
                if (Number.isInteger(entry)) {
                    return entry;
                }
                return undefined;
            });
        }

        if (Number.isInteger(raw)) {
            return [raw];
        }

        return undefined;
    }

    protected buildVisualizationStateSnapshot(): VisualizationStateSnapshot {
        return {
            data: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            visualizations: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.visualizations) ? APPLICATION_CONTEXT.config.visualizations : []),
            activeVisualizationIndex: cloneJson(this.getActiveVisualizationSelection())
        };
    }

    protected async applyVisualizationStateSnapshot(
        snapshot: VisualizationStateSnapshot,
        options: {
            historyLabel?: string;
            requireConsent?: boolean;
        } = {}
    ): Promise<boolean> {
        const appContext: any = APPLICATION_CONTEXT;
        const visualizations = Array.isArray(snapshot.visualizations) ? cloneJson(snapshot.visualizations) : [];
        const data = Array.isArray(snapshot.data) ? cloneJson(snapshot.data) : [];
        const activeIndex = snapshot.activeVisualizationIndex === undefined
            ? undefined
            : cloneJson(snapshot.activeVisualizationIndex);

        if (options.requireConsent) {
            await this.requireActionConsent({
                title: "Allow visualization state restore?",
                description: "The script wants to restore a previously captured visualization state for the current viewer session.",
                details: [
                    "The current visualization configuration will be replaced.",
                    "The change will persist in the current session and can be shared or exported.",
                    "Undo history will capture this as a visualization change when possible."
                ],
                mode: "warning",
                confirmLabel: "Restore",
                cancelLabel: "Cancel",
                rejectedMessage: "Visualization state restore was canceled by the user."
            });
        }

        return await appContext.openViewerWith(
            data,
            undefined,
            visualizations,
            undefined,
            activeIndex,
            {
                historyMode: "visualization-step",
                historyLabel: options.historyLabel || "restore visualization state",
                strictVisualization: true,
            }
        );
    }

    /**
     * Open the Visualization Playground in review mode for an LLM- or script-supplied
     * snapshot. Replaces the simple consent dialog for visualization-mutating actions.
     *
     * Behavior on each user choice:
     *   - Accept   → resolves to the (possibly edited) snapshot the user accepted.
     *                Caller must commit it (e.g. via APPLICATION_CONTEXT.updateVisualization).
     *   - Feedback → throws VisualizationReviewFeedbackError. The error message is
     *                "User wants the assistant to refine ... Feedback: <text>" so the
     *                script runtime surfaces it to the LLM as a normal tool error and
     *                the model can re-plan. .feedback / .editedSnapshot are also
     *                attached to the error for richer handling.
     *   - Decline  → throws Error(rejectedMessage), matching the existing consent
     *                cancellation contract.
     *
     * Honors `bypassConsentDialog` (auto-accept).
     *
     * Falls back to plain `requireActionConsent` when PlaygroundService is unavailable
     * (headless / test environments).
     */
    protected async requireVisualizationReview(
        proposed: VisualizationStateSnapshot,
        options: {
            title?: string;
            rationale?: string;
            historyLabel?: string;
            consentTitle?: string;
            consentDescription?: string;
            consentDetails?: string[];
            confirmLabel?: string;
            cancelLabel?: string;
            rejectedMessage?: string;
        } = {}
    ): Promise<VisualizationStateSnapshot> {
        const rejectedMessage = options.rejectedMessage || "The proposed visualization change was canceled by the user.";

        // Trusted automation: skip review entirely.
        if (this.bypassConsentDialog) {
            return cloneJson(proposed);
        }

        const PLAYGROUND: any = (window as any).PLAYGROUND;
        if (!PLAYGROUND?.open || typeof document === "undefined") {
            // No playground: degrade to the existing yes/no consent.
            await this.requireActionConsent({
                title: options.consentTitle || options.title || "Allow visualization change?",
                description: options.consentDescription || options.rationale || "The script wants to change the visualization in the current viewer session.",
                details: options.consentDetails,
                mode: "warning",
                confirmLabel: options.confirmLabel,
                cancelLabel: options.cancelLabel,
                rejectedMessage,
            });
            return cloneJson(proposed);
        }

        const viewer = this.activeViewer;
        // Apply-on-accept is OFF: the caller pipeline (APPLICATION_CONTEXT.updateVisualization
        // or applyVisualizationStateSnapshot) commits after this returns, so we don't want
        // the helper to apply twice. The helper still runs the playground UI and returns
        // the user's decision.
        const noopApply = async () => true;
        const review: VisualizationReviewDecision = await reviewVisualizationProposal(
            viewer,
            proposed,
            noopApply,
            {
                title: options.title,
                rationale: options.rationale,
                historyLabel: options.historyLabel,
            },
        );

        if (review.decision === "feedback") {
            throw new VisualizationReviewFeedbackError(review.feedback, review.editedSnapshot);
        }
        if (review.decision === "decline") {
            throw new Error(rejectedMessage);
        }
        // Accept: return the (possibly edited) snapshot for the caller to commit.
        return review.appliedSnapshot;
    }

    protected createLayerId(base: string, index: number): string {
        let raw = base;
        if (!raw) {
            raw = "script_layer_" + String(index);
        }

        const generator = (UTILITIES as any).generateID;
        const fr: any = (OpenSeadragon as any).FlexRenderer;

        if (typeof generator === "function") {
            return generator(String(raw), 16);
        }

        if (fr && typeof fr.sanitizeKey === "function") {
            try {
                return fr.sanitizeKey(String(raw));
            } catch (e) {
                return "script_layer_" + String(index);
            }
        }

        return "script_layer_" + String(index);
    }

    protected normalizeShaderMap(
        sourceShaders: any,
        path: string[] = []
    ): { shaders: Record<string, VisualizationShaderGroupOrLayer>; aliases: Map<string, string>; } {
        if (!sourceShaders || typeof sourceShaders !== "object" || Array.isArray(sourceShaders)) {
            return {
                shaders: {},
                aliases: new Map<string, string>()
            };
        }

        const normalizedShaders: Record<string, VisualizationShaderGroupOrLayer> = {};
        const keyAliases = new Map<string, string>();
        let index = 0;

        for (const key in sourceShaders) {
            if (!Object.prototype.hasOwnProperty.call(sourceShaders, key)) {
                continue;
            }

            const layer = cloneJson(sourceShaders[key]);
            if (!layer || typeof layer !== "object") {
                continue;
            }

            const hasNestedShaders = layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders);
            if ((!layer.type || typeof layer.type !== "string") && hasNestedShaders) {
                layer.type = "group";
            }
            if (!layer.type || typeof layer.type !== "string") {
                throw new Error(
                    "Every visualization shader layer must define a valid 'type'" +
                    (path.length ? " at '" + path.concat([key]).join("/") + "'" : "") +
                    "."
                );
            }

            if (!layer.id || typeof layer.id !== "string") {
                layer.id = this.createLayerId(layer.name || key || layer.type, index);
            }

            if (!layer.name || typeof layer.name !== "string") {
                layer.name = key || layer.type;
            }

            if (layer.shaders !== undefined) {
                const nested = this.normalizeShaderMap(layer.shaders, path.concat([layer.id]));
                layer.shaders = nested.shaders;

                if (Array.isArray(layer.order)) {
                    const seenOrder = new Set<string>();
                    const normalizedOrder: string[] = [];

                    for (const entry of layer.order) {
                        if (typeof entry !== "string" || !entry) {
                            continue;
                        }

                        const mapped = nested.aliases.get(entry) || entry;
                        if (layer.shaders?.[mapped] && !seenOrder.has(mapped)) {
                            normalizedOrder.push(mapped);
                            seenOrder.add(mapped);
                        }
                    }

                    for (const childId of Object.keys(layer.shaders)) {
                        if (!seenOrder.has(childId)) {
                            normalizedOrder.push(childId);
                        }
                    }

                    layer.order = normalizedOrder;
                }
            }

            normalizedShaders[layer.id] = layer;
            keyAliases.set(key, layer.id);
            keyAliases.set(layer.id, layer.id);
            index++;
        }

        return {
            shaders: normalizedShaders,
            aliases: keyAliases
        };
    }

    protected forEachShaderLayer(
        shaderMap: Record<string, VisualizationShaderGroupOrLayer> | undefined,
        callback: (layer: VisualizationShaderGroupOrLayer, layerId: string, path: string[]) => void,
        path: string[] = []
    ): void {
        if (!shaderMap || typeof shaderMap !== "object") {
            return;
        }

        for (const [layerId, layer] of Object.entries(shaderMap)) {
            if (!layer || typeof layer !== "object") {
                continue;
            }

            const nextPath = path.concat([layerId]);
            callback(layer, layerId, nextPath);

            if (layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders)) {
                this.forEachShaderLayer(layer.shaders, callback, nextPath);
            }
        }
    }

    protected normalizeVisualizationInput(input: VisualizationLayerSource): VisualizationItem {
        let visualization: any;

        if (input && isPlainObject(input) && isPlainObject((input as any).shaders)) {
            visualization = cloneJson(input);
        } else if (input && isPlainObject(input)) {
            visualization = {
                name: "Script visualization",
                shaders: cloneJson(input)
            };
        } else {
            throw new Error("Visualization input must be a VisualizationItem or a shader map.");
        }

        if (!visualization.name || typeof visualization.name !== "string") {
            visualization.name = "Script visualization";
        }

        if (!visualization.shaders || typeof visualization.shaders !== "object") {
            visualization.shaders = {};
        }

        visualization.shaders = this.normalizeShaderMap(visualization.shaders).shaders;
        return visualization as VisualizationItem;
    }

    protected getResolvedDataReferenceMap(viewer: OpenSeadragon.Viewer): Map<number, number> {
        const out = new Map<number, number>();
        const count = viewer.world && viewer.world.getItemCount ? viewer.world.getItemCount() : 0;

        for (let i = 0; i < count; i++) {
            const item: any = viewer.world.getItemAt(i);
            if (!item || typeof item.getConfig !== "function") {
                continue;
            }

            const backgroundConfig = item.getConfig("background");
            if (backgroundConfig && Number.isInteger(backgroundConfig.dataReference)) {
                out.set(backgroundConfig.dataReference, i);
            }
        }

        const visualizations = Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations
            : [];

        for (const visualization of visualizations) {
            const shaders = visualization && visualization.shaders ? visualization.shaders : {};
            this.forEachShaderLayer(shaders, (layer) => {
                const dataReferences = sanitizeArrayOfIntegers(layer.dataReferences);
                const tiledImages = sanitizeArrayOfIntegers(layer.tiledImages);
                const max = Math.min(dataReferences.length, tiledImages.length);

                for (let i = 0; i < max; i++) {
                    out.set(dataReferences[i], tiledImages[i]);
                }
            });
        }

        return out;
    }

    protected resolveStandaloneShaderMap(
        shaderMap: Record<string, VisualizationShaderGroupOrLayer>,
        dataReferenceMap: Map<number, number>,
        viewer: OpenSeadragon.Viewer
    ): Record<string, VisualizationShaderGroupOrLayer> {
        const configuration: Record<string, VisualizationShaderGroupOrLayer> = {};

        for (const [shaderId, sourceLayer] of Object.entries(shaderMap)) {
            const layer = cloneJson(sourceLayer);
            if (!layer || typeof layer !== "object") {
                continue;
            }

            const resolvedTiledImages = sanitizeArrayOfIntegers(layer.tiledImages);

            if (resolvedTiledImages.length < 1) {
                const dataReferences = sanitizeArrayOfIntegers(layer.dataReferences);
                if (dataReferences.length > 0) {
                    for (const dataReference of dataReferences) {
                        if (!dataReferenceMap.has(dataReference)) {
                            throw new Error(
                                "Unable to resolve dataReference '" + dataReference + "' to a tiled image in the current viewer. " +
                                "Persist the visualization first, or provide explicit tiledImages."
                            );
                        }
                        resolvedTiledImages.push(dataReferenceMap.get(dataReference) as number);
                    }
                }
            }

            if (resolvedTiledImages.length < 1 && layer.type !== "group") {
                if (viewer.world && viewer.world.getItemCount && viewer.world.getItemCount() > 0) {
                    resolvedTiledImages.push(0);
                } else {
                    throw new Error("No tiled images are available in the active viewer.");
                }
            }

            layer.tiledImages = resolvedTiledImages;

            if (layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders)) {
                layer.shaders = this.resolveStandaloneShaderMap(layer.shaders, dataReferenceMap, viewer);
                if (!Array.isArray(layer.order)) {
                    layer.order = Object.keys(layer.shaders);
                }
            }

            configuration[layer.id || shaderId] = layer;
        }

        return configuration;
    }

    protected resolveStandaloneConfiguration(input: VisualizationLayerSource): Record<string, VisualizationShaderGroupOrLayer> {
        const viewer = this.activeViewer;
        const visualization = this.normalizeVisualizationInput(input);
        const dataReferenceMap = this.getResolvedDataReferenceMap(viewer);
        return this.resolveStandaloneShaderMap(visualization.shaders || {}, dataReferenceMap, viewer);
    }

    protected cropAndScaleCanvas(sourceCanvas: HTMLCanvasElement, options: VisualizationViewportRenderOptions = {}): HTMLCanvasElement {
        const outputCanvas = document.createElement("canvas");
        const focusX = Number.isFinite(options.x as number) ? Number(options.x) : 0;
        const focusY = Number.isFinite(options.y as number) ? Number(options.y) : 0;
        const focusWidth = Number.isFinite(options.regionWidth as number) ? Number(options.regionWidth) : sourceCanvas.width;
        const focusHeight = Number.isFinite(options.regionHeight as number) ? Number(options.regionHeight) : sourceCanvas.height;
        const outputWidth = Number.isFinite(options.width as number) ? Number(options.width) : focusWidth;
        const outputHeight = Number.isFinite(options.height as number) ? Number(options.height) : focusHeight;

        outputCanvas.width = outputWidth;
        outputCanvas.height = outputHeight;

        const ctx = outputCanvas.getContext("2d");
        if (!ctx) {
            throw new Error("Failed to create a 2D canvas context for viewport extraction.");
        }

        ctx.drawImage(
            sourceCanvas,
            focusX,
            focusY,
            focusWidth,
            focusHeight,
            0,
            0,
            outputWidth,
            outputHeight
        );

        return outputCanvas;
    }

    protected async extractCanvasForVisualization(
        input: VisualizationLayerSource,
        options: VisualizationViewportRenderOptions = {}
    ): Promise<HTMLCanvasElement> {
        const viewer: any = this.activeViewer;
        const drawer = this.getCurrentStandaloneDrawer();
        const configuration = this.resolveStandaloneConfiguration(input);
        const extractedCanvas = await drawer.extract({
            mode: "second-pass",
            configuration,
            view: viewer.drawer,
            result: "canvas"
        });

        if (!extractedCanvas) {
            throw new Error("Failed to render the standalone visualization extraction.");
        }

        return this.cropAndScaleCanvas(extractedCanvas, options);
    }

    protected getHistoryLabel(action: string): string {
        return "visualization: " + action;
    }

    /**
     * Returns the shader types that can be used by visualization layers.
     */
    getAvailableShaderTypes(): string[] {
        const available = (OpenSeadragon as any).FlexRenderer.ShaderMediator.availableShaders();
        const out: string[] = [];

        for (const Shader of available) {
            if (!Shader || typeof Shader.type !== "function") {
                continue;
            }
            out.push(String(Shader.type()));
        }

        return out;
    }

    /**
     * Returns the machine-friendly shader documentation model for visualization scripting.
     */
    getShaderDocsModel(): VisualizationDocsModel {
        const configurator = this.shaderConfigurator;
        const model = configurator.compileDocsModel();
        return cloneJson(model);
    }

    /**
     * Returns the shader documentation serialized as JSON.
     */
    getShaderDocsJson(pretty = true): string {
        const configurator = this.shaderConfigurator;
        const model = configurator.compileDocsModel();

        if (pretty) {
            return configurator.serializeDocs("json", model);
        }

        return JSON.stringify(model);
    }

    /**
     * Returns the shader documentation serialized as plain text.
     */
    getShaderDocsText(): string {
        const configurator = this.shaderConfigurator;
        const model = configurator.compileDocsModel();
        return configurator.serializeDocs("text", model);
    }

    /**
     * Returns the documentation entry for one shader type, or undefined if no such type is
     * registered. Use after `getAvailableShaderTypes()` to drill into one shader without
     * dumping the whole catalog (which can get truncated when many shaders are registered).
     */
    getShaderDocs(type: string): any {
        if (typeof type !== "string" || !type.trim()) return undefined;
        const configurator = this.shaderConfigurator;
        const model = configurator.compileDocsModel();
        const shaders = model && model.shaders;
        if (!Array.isArray(shaders)) return undefined;
        const entry = shaders.find((s: any) => s && s.type === type);
        return entry ? cloneJson(entry) : undefined;
    }

    /**
     * Returns the persisted visualization list for the current session.
     */
    getVisualizations(): VisualizationItem[] {
        const visualizations = Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations
            : [];
        return cloneJson(visualizations);
    }

    /**
     * Returns the current active visualization selection.
     */
    getActiveVisualizationIndex(): Array<number | undefined> | undefined {
        return cloneJson(this.getActiveVisualizationSelection());
    }

    /**
     * Returns the first active visualization configuration, when one is selected.
     */
    getActiveVisualization(): VisualizationItem | undefined {
        const active = APPLICATION_CONTEXT.activeVisualizationConfig();
        return cloneJson(active);
    }

    /**
     * Captures the current visualization-related session state so it can be restored later.
     */
    captureState(): VisualizationStateSnapshot {
        return this.buildVisualizationStateSnapshot();
    }

    /**
     * Restores a previously captured visualization state.
     *
     * Routes through the Visualization Playground review flow: the user can accept,
     * edit-then-accept, send back to the assistant with feedback (throws
     * VisualizationReviewFeedbackError), or decline (throws).
     */
    async restoreState(snapshot: VisualizationStateSnapshot): Promise<boolean> {
        this.validateProposedVisualizations(
            Array.isArray(snapshot && snapshot.visualizations) ? snapshot.visualizations : []
        );
        const accepted = await this.requireVisualizationReview(snapshot, {
            title: "Review proposed visualization (restore state)",
            rationale: "The script wants to restore a previously captured visualization state.",
            historyLabel: this.getHistoryLabel("restore-state"),
            consentTitle: "Allow visualization state restore?",
            consentDescription: "The script wants to restore a previously captured visualization state for the current viewer session.",
            consentDetails: [
                "The current visualization configuration will be replaced.",
                "The change will persist in the current session and can be shared or exported.",
                "Undo history will capture this as a visualization change when possible.",
            ],
            rejectedMessage: "Visualization state restore was canceled by the user.",
        });
        return await this.applyVisualizationStateSnapshot(accepted, {
            historyLabel: this.getHistoryLabel("restore-state"),
            requireConsent: false,
        });
    }

    /**
     * Changes the active visualization selection for the current viewer session.
     */
    async setActiveVisualization(index: number | number[]): Promise<boolean> {
        await this.requireActionConsent({
            title: "Allow visualization switch?",
            description: "The script wants to change the active visualization in the current viewer session.",
            details: [
                "Only the visualization selection will change.",
                "The change will persist in the current session and can be shared or exported."
            ],
            mode: "warning",
            confirmLabel: "Switch visualization",
            cancelLabel: "Cancel",
            rejectedMessage: "Changing the active visualization was canceled by the user."
        });

        const visualizations = this.getVisualizations();
        return await APPLICATION_CONTEXT.updateVisualization(visualizations, [], index);
    }

    /**
     * Replaces the full visualization list for the current session.
     */
    async replaceVisualizations(
        visualizations: VisualizationItem[],
        activeVizIndex?: number | number[],
        newData: DataID[] = []
    ): Promise<boolean> {
        const next = Array.isArray(visualizations) ? visualizations.map(item => this.normalizeVisualizationInput(item)) : [];
        this.validateProposedVisualizations(next);

        const proposedSnapshot: VisualizationStateSnapshot = {
            data: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            visualizations: cloneJson(next),
            activeVisualizationIndex: cloneJson(activeVizIndex) as any,
        };
        const accepted = await this.requireVisualizationReview(proposedSnapshot, {
            title: "Review proposed visualization (replace)",
            rationale: "The script wants to replace the visualization list for this session.",
            historyLabel: this.getHistoryLabel("replace"),
            consentTitle: "Allow visualization replacement?",
            consentDescription: "The script wants to replace the persisted visualization list for the current viewer session.",
            consentDetails: [
                "Existing visualizations in the session will be replaced.",
                "The new configuration will persist and can be exported or shared.",
                "Undo history will record this as a visualization change when possible.",
            ],
            rejectedMessage: "Replacing the visualization list was canceled by the user.",
        });

        const acceptedVisualizations = (Array.isArray(accepted.visualizations) ? accepted.visualizations : next) as typeof next;
        return await APPLICATION_CONTEXT.updateVisualization(acceptedVisualizations, newData, activeVizIndex);
    }

    /**
     * Adds a new visualization to the current session.
     */
    async addVisualization(
        visualization: VisualizationItem,
        options: {
            makeActive?: boolean;
            newData?: DataID[];
        } = {}
    ): Promise<boolean> {
        const next = this.getVisualizations();
        const normalized = this.normalizeVisualizationInput(visualization);
        this.validateProposedVisualizations([normalized]);
        next.push(normalized);

        let nextActiveIndex = this.getActiveVisualizationSelection();
        if (options.makeActive !== false) {
            nextActiveIndex = [next.length - 1];
        }

        const proposedSnapshot: VisualizationStateSnapshot = {
            data: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            visualizations: cloneJson(next),
            activeVisualizationIndex: cloneJson(nextActiveIndex) as any,
        };
        const accepted = await this.requireVisualizationReview(proposedSnapshot, {
            title: "Review proposed visualization (add)",
            rationale: "The script wants to add a new visualization.",
            historyLabel: this.getHistoryLabel("add"),
            consentTitle: "Allow adding a visualization?",
            consentDescription: "The script wants to add a new visualization to the current viewer session.",
            consentDetails: [
                "The new visualization will persist in the current session.",
                "The updated state can be shared or exported.",
                "Undo history will record this as a visualization change when possible.",
            ],
            rejectedMessage: "Adding the visualization was canceled by the user.",
        });

        const acceptedVisualizations = (Array.isArray(accepted.visualizations) ? accepted.visualizations : next) as typeof next;
        return await APPLICATION_CONTEXT.updateVisualization(acceptedVisualizations, options.newData || [], nextActiveIndex as any);
    }

    /**
     * Updates an existing visualization in the persisted session state.
     */
    async updateVisualizationAt(
        index: number,
        patch: Partial<VisualizationItem>,
        options: {
            makeActive?: boolean;
            newData?: DataID[];
        } = {}
    ): Promise<boolean> {
        if (!Number.isInteger(index) || index < 0) {
            throw new Error("Visualization index must be a non-negative integer.");
        }

        const next = this.getVisualizations();
        if (index >= next.length) {
            throw new Error("Visualization index " + index + " is out of range.");
        }

        const merged = $.extend(true, {}, next[index], patch || {});
        next[index] = this.normalizeVisualizationInput(merged);
        this.validateProposedVisualizations([next[index]]);

        let nextActiveIndex = this.getActiveVisualizationSelection();
        if (options.makeActive === true) {
            nextActiveIndex = [index];
        }

        const proposedSnapshot: VisualizationStateSnapshot = {
            data: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            visualizations: cloneJson(next),
            activeVisualizationIndex: cloneJson(nextActiveIndex) as any,
        };
        const accepted = await this.requireVisualizationReview(proposedSnapshot, {
            title: "Review proposed visualization (update)",
            rationale: "The script wants to update an existing visualization.",
            historyLabel: this.getHistoryLabel("update"),
            consentTitle: "Allow visualization update?",
            consentDescription: "The script wants to update an existing visualization in the current session.",
            consentDetails: [
                "The visualization change will persist in the current session.",
                "Undo history will record this as a visualization change when possible.",
            ],
            rejectedMessage: "Updating the visualization was canceled by the user.",
        });

        const acceptedVisualizations = (Array.isArray(accepted.visualizations) ? accepted.visualizations : next) as typeof next;
        return await APPLICATION_CONTEXT.updateVisualization(acceptedVisualizations, options.newData || [], nextActiveIndex as any);
    }

    /**
     * Removes a visualization from the persisted session state.
     */
    async removeVisualization(index: number, nextActiveIndex?: number | number[]): Promise<boolean> {
        if (!Number.isInteger(index) || index < 0) {
            throw new Error("Visualization index must be a non-negative integer.");
        }

        await this.requireActionConsent({
            title: "Allow visualization removal?",
            description: "The script wants to remove a visualization from the current session.",
            details: [
                "The visualization will be removed from the persisted session state.",
                "Undo history will record this as a visualization change when possible."
            ],
            mode: "warning",
            confirmLabel: "Remove visualization",
            cancelLabel: "Cancel",
            rejectedMessage: "Removing the visualization was canceled by the user."
        });

        const next = this.getVisualizations();
        if (index >= next.length) {
            throw new Error("Visualization index " + index + " is out of range.");
        }

        next.splice(index, 1);

        let desiredIndex = nextActiveIndex;
        if (desiredIndex === undefined) {
            if (next.length < 1) {
                desiredIndex = undefined;
            } else {
                desiredIndex = Math.max(0, Math.min(index, next.length - 1));
            }
        }

        return await APPLICATION_CONTEXT.updateVisualization(next, [], desiredIndex as any);
    }

    /**
     * Renders the current viewport through a temporary standalone visualization and returns a PNG data URL.
     */
    async renderCurrentViewportPng(
        visualization: VisualizationLayerSource,
        options: VisualizationViewportRenderOptions = {}
    ): Promise<string> {
        const canvas = await this.extractCanvasForVisualization(visualization, options);
        if (typeof canvas.toDataURL !== "function") {
            throw new Error("The extracted viewport canvas does not support toDataURL().");
        }
        return canvas.toDataURL("image/png");
    }

    /**
     * Renders the current viewport through a temporary standalone visualization and returns RGBA pixels.
     */
    async renderCurrentViewportPixels(
        visualization: VisualizationLayerSource,
        options: VisualizationViewportRenderOptions = {}
    ): Promise<VisualizationViewportPixelsResult> {
        const canvas = await this.extractCanvasForVisualization(visualization, options);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Failed to create a 2D context for pixel extraction.");
        }

        const maxPixels = Number.isFinite(options.maxPixels as number) ? Number(options.maxPixels) : 1024 * 1024;
        const pixelCount = canvas.width * canvas.height;
        if (pixelCount > maxPixels) {
            throw new Error("Requested extraction is too large. Reduce the output size or raise maxPixels.");
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return {
            width: canvas.width,
            height: canvas.height,
            data: Array.from(imageData.data)
        };
    }

    /**
     * Extracts a first-pass texture or stencil layer from the active viewer's standalone renderer state.
     */
    async extractCurrentFirstPassLayer(options: VisualizationFirstPassExtractOptions): Promise<VisualizationViewportPixelsResult> {
        const drawer = this.getCurrentStandaloneDrawer();
        const viewer: any = this.activeViewer;

        if (!viewer || !viewer.drawer || !viewer.drawer.renderer) {
            throw new Error("The active viewer does not have a renderer state to extract from.");
        }

        const kind = options && options.kind ? options.kind : "texture";
        const layerIndex = options && Number.isInteger(options.layerIndex) ? options.layerIndex : 0;
        const result = await drawer.extract({
            mode: "first-pass-layer",
            kind,
            layerIndex,
            result: "uint8"
        });

        const width = options && Number.isFinite(options.width as number)
            ? Number(options.width)
            : drawer.renderer.canvas.width;
        const height = options && Number.isFinite(options.height as number)
            ? Number(options.height)
            : drawer.renderer.canvas.height;

        return {
            width,
            height,
            data: Array.from(result)
        };
    }
}
