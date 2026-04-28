import type { ScriptApiMetadata } from "./abstract-types";
import type {
    VisualizationScriptApi,
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
     * Cached compiled validator for the renderer-published JSON Schema. Compiled ONCE on first
     * use and reused for the lifetime of the script API instance.
     *
     * `_ajvDisabled` is set to true when AJV cannot handle the schema (typically a stack overflow
     * during compile, caused by AJV inlining the recursive `group` shader). When disabled, schema
     * validation is skipped on subsequent mutations and the playground / runtime acts as the gate.
     * One console warning per session so the operator knows validation isn't running.
     */
    protected _ajvValidator: ((value: any) => boolean) & { errors?: any[] } | undefined;
    protected _ajvDisabled = false;

    /**
     * Drop the cached validator and re-enable validation. Call after registering new shaders at
     * runtime so the next validation picks up the new schema.
     */
    public invalidateSchemaCache(): void {
        this._ajvValidator = undefined;
        this._ajvDisabled = false;
    }

    /**
     * Lazy AJV compile with defenses against the recursive `group` schema. Returns undefined when
     * AJV is missing or when compile fails (e.g. stack overflow on a recursive `$ref` graph).
     * Callers must treat undefined as "validation unavailable; skip and let downstream gates run".
     */
    protected getSchemaValidator(): ((value: any) => boolean) | undefined {
        if (this._ajvValidator) return this._ajvValidator;
        if (this._ajvDisabled) return undefined;

        const AjvCtor: any = (globalThis as any).Ajv2020 || (globalThis as any).Ajv;
        if (typeof AjvCtor !== "function") {
            this._ajvDisabled = true;
            console.warn(
                "[visualization scripting] AJV is not available on globalThis (Ajv2020 / Ajv). " +
                "Schema validation is disabled; the playground review remains the gate."
            );
            return undefined;
        }

        // Options chosen for the recursive `group` schema:
        //   strict: false  - we publish x-* extension keywords AJV doesn't recognize.
        //   allErrors: true - one validation pass surfaces every problem to the LLM at once.
        //   inlineRefs: false - never inline $refs. Keeps recursive schemas (group → group) from
        //     blowing the call stack at compile time. Slight runtime cost; required for correctness.
        //   validateSchema: false - the renderer is the source of truth; skip AJV's own draft check.
        try {
            const fullSchema = this.shaderConfigurator.compileConfigSchemaModel();
            const ajv = new AjvCtor({ strict: false, allErrors: true, inlineRefs: false, validateSchema: false });
            this._ajvValidator = ajv.compile(fullSchema) as any;
            return this._ajvValidator!;
        } catch (err) {
            this._ajvDisabled = true;
            console.warn(
                "[visualization scripting] AJV failed to compile the renderer schema (" +
                String((err as any)?.message || err) +
                "). Schema validation is disabled for the rest of this session; the playground " +
                "review remains the gate."
            );
            return undefined;
        }
    }

    /**
     * Validate a list of proposed visualizations against the renderer-published JSON Schema.
     * Runs BEFORE the user is asked to review the proposal so structurally invalid layers
     * never reach the playground. Throws an Error with JSON Pointer paths to every invalid
     * field; the chat layer surfaces the message to the LLM, which fixes and retries.
     *
     * The schema is the contract - no shader names or control names are hardcoded on the host.
     * If AJV is unavailable or the schema can't be compiled, validation is skipped (the
     * playground review still acts as the gate). A `RangeError` from AJV at validate time is
     * caught and disables further validation rather than crashing the mutation.
     */
    protected validateProposedVisualizations(visualizations: any[]): void {
        if (!Array.isArray(visualizations) || visualizations.length < 1) return;

        const validate = this.getSchemaValidator();
        if (!validate) return;

        for (let i = 0; i < visualizations.length; i++) {
            const viz: any = visualizations[i];
            if (!isPlainObject(viz) || !isPlainObject(viz.shaders)) continue;

            // Schema's root expects `{ shaders: {...} }`. Wrap each visualization in the same
            // envelope so AJV evaluates it as one config.
            const envelope = { shaders: viz.shaders, ...(Array.isArray(viz.order) ? { order: viz.order } : {}) };

            let ok: boolean;
            try {
                ok = validate(envelope);
            } catch (err) {
                // Stack-overflow or any other AJV runtime explosion: disable, skip rest.
                this._ajvDisabled = true;
                this._ajvValidator = undefined;
                console.warn(
                    "[visualization scripting] AJV threw during validate (" +
                    String((err as any)?.message || err) +
                    "). Schema validation disabled for the rest of this session."
                );
                return;
            }

            if (!ok) {
                const errors = (validate as any).errors as any[] | undefined;
                const summary = (errors || []).map(e => {
                    const where = e.instancePath ? `viz[${i}]${e.instancePath}` : `viz[${i}]`;
                    return `  ${where}: ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`;
                }).join("\n");
                const err: any = new Error(`Visualization validation failed before review:\n${summary}`);
                err.ajvErrors = errors;
                throw err;
            }
        }
    }

    /**
     * Validate every coupling rule the shader declares for `layer.type`. Validators come from
     * `OpenSeadragon.FlexRenderer.ShaderConfigurator.getShaderCouplingValidators(type)` -
     * the host invokes them but does not own the rules. Throws on the first failure with
     * the validator's `expected`/`actual` payload attached. Recursively walks nested shader
     * maps (groups), so a single call covers a whole visualization.
     */
    protected validateLayerCouplings(layer: any, path: string = ""): void {
        if (!isPlainObject(layer)) return;

        if (isPlainObject(layer.shaders)) {
            for (const [childKey, child] of Object.entries(layer.shaders)) {
                this.validateLayerCouplings(child, path ? `${path}/${childKey}` : childKey);
            }
        }

        const layerType = typeof layer.type === "string" ? layer.type : undefined;
        if (!layerType || layerType === "group") return;

        const configurator: any = this.shaderConfigurator;
        if (typeof configurator.getShaderCouplingValidators !== "function") return;

        const validators = configurator.getShaderCouplingValidators(layerType);
        if (!Array.isArray(validators) || validators.length < 1) return;

        for (const entry of validators) {
            if (!entry || typeof entry.validate !== "function") continue;

            let outcome: any;
            try {
                outcome = entry.validate(layer);
            } catch (err: any) {
                const e: any = new Error(
                    `Coupling validator '${entry.name}' on shader '${layerType}' threw: ${err?.message || err}.`
                );
                e.couplingViolation = { coupling: entry.name, layerType, layerPath: path || layer.id || layerType };
                throw e;
            }

            if (outcome && outcome.ok === false) {
                const summary = entry.summary ? ` ${entry.summary}` : "";
                const msg = `Coupling '${entry.name}' on shader '${layerType}' (${path || layer.id || layerType}) was not satisfied.${summary}`;
                const e: any = new Error(msg);
                e.couplingViolation = {
                    coupling: entry.name,
                    layerType,
                    layerPath: path || layer.id || layerType,
                    controls: entry.controls,
                    expected: outcome.expected,
                    actual: outcome.actual,
                };
                throw e;
            }
        }
    }

    /**
     * Run schema + coupling validation on every visualization. Convenience wrapper called by
     * each mutation method right before requireVisualizationReview opens the playground.
     */
    protected runFullValidation(visualizations: any[]): void {
        this.validateProposedVisualizations(visualizations);
        for (const viz of visualizations) {
            if (!isPlainObject(viz) || !isPlainObject((viz as any).shaders)) continue;
            for (const [key, layer] of Object.entries((viz as any).shaders)) {
                this.validateLayerCouplings(layer, key);
            }
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

    /**
     * Merge a partial visualization patch onto an existing visualization. For each layer in
     * `patch.shaders`: if the patch changes the layer's `type`, the layer is REPLACED wholesale
     * (the old layer's params would be a different shader's controls and don't transfer); otherwise
     * the layer is deep-merged. Visualization-level fields (`name`, `goalIndex`, ...) are deep-merged.
     *
     * Why this matters: deep-merging across a type change produces a half-old/half-new layer that
     * carries the previous shader's control values, which the new shader's schema rejects with
     * `additionalProperties: false`. The LLM-facing failure looks like "spurious validation error"
     * when the real issue is "you can't patch type, you have to replace the layer".
     */
    protected mergeVisualizationPatch(existing: any, patch: any): any {
        if (!isPlainObject(patch)) return cloneJson(existing) as any;

        const merged: any = $.extend(true, {}, existing);

        // Visualization-level fields (name, goalIndex, etc.) merge normally.
        for (const [key, value] of Object.entries(patch)) {
            if (key !== "shaders") {
                merged[key] = cloneJson(value);
            }
        }

        // Per-layer: replace on type change, deep-merge otherwise.
        const patchShaders = isPlainObject(patch.shaders) ? patch.shaders : null;
        if (patchShaders) {
            if (!isPlainObject(merged.shaders)) merged.shaders = {};
            for (const [layerKey, patchLayer] of Object.entries(patchShaders)) {
                const existingLayer = merged.shaders[layerKey];
                const patchType = isPlainObject(patchLayer) ? (patchLayer as any).type : undefined;
                const existingType = isPlainObject(existingLayer) ? (existingLayer as any).type : undefined;

                if (patchType && existingType && patchType !== existingType) {
                    // Type change → fresh layer. Don't drag old controls along.
                    merged.shaders[layerKey] = cloneJson(patchLayer);
                } else {
                    merged.shaders[layerKey] = $.extend(true, {}, existingLayer || {}, cloneJson(patchLayer));
                }
            }
        }

        return merged;
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
     * Returns the renderer-published JSON Schema 2020-12 document. Single source of truth for
     * every valid layer shape - the LLM and any other consumer reads this once and validates
     * against it. Cache the result for the rest of the session.
     *
     * The slim view drops `$defs.uiControlEnvelopes` (typedef catalog) since `$defs.shaderLayers[type].examples`
     * already encode valid envelope values. xOpat's own AJV instance still uses the full schema
     * (with refs intact) for validation.
     */
    getSchema(): Record<string, any> {
        const fullSchema = this.shaderConfigurator.compileConfigSchemaModel();
        const slim = cloneJson(fullSchema);
        if (slim && isPlainObject(slim.$defs)) {
            delete slim.$defs.uiControlEnvelopes;
        }
        return slim;
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
        this.runFullValidation(
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
        this.runFullValidation(next);

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
        this.runFullValidation([normalized]);
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

        const merged = this.mergeVisualizationPatch(next[index], patch || {});
        next[index] = this.normalizeVisualizationInput(merged);
        this.runFullValidation([next[index]]);

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
