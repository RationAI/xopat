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

/**
 * Thrown when the user declines a proposed visualization in the playground
 * review modal (or dismisses it via X/ESC, which is mapped to decline by
 * `visualization-review.ts`). Distinct from a feedback decision: there is no
 * actionable text — the user just said no.
 *
 * Worker→main serialization preserves only `error.message`, so the meaningful
 * signal to LLM-side script runtimes is the message text. The constructor
 * appends a fixed directive so the assistant treats this as "ask the user,
 * don't silently retry" instead of as a malformed-script bug. In-process
 * listeners can still discriminate via `instanceof` or `error.name`.
 */
class VisualizationReviewDeclinedError extends Error {
    declinedMessage: string;

    constructor(declinedMessage: string) {
        super(
            declinedMessage +
            " The user declined the proposal without giving feedback; ask them what they wanted different before retrying with another shader or parameters."
        );
        this.name = "VisualizationReviewDeclinedError";
        this.declinedMessage = declinedMessage;
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

/**
 * AJV reports `oneOf` failures branch-by-branch: a single typo in a colormap
 * layer produces one identical "must NOT have additional properties …" line
 * per registered shader type (currently 14). The branch noise buries the
 * actual fix.
 *
 * For each error whose `instancePath` falls inside `/shaders/<id>` (root or
 * nested), look up the input layer's `type` and drop any error whose
 * `schemaPath` clearly belongs to a *different* shader-type branch (matched
 * by `/shaderLayers/<other-type>/`). Errors against the root envelope, the
 * shaders map structure, or branches without a recognisable type tag are
 * preserved.
 *
 * Idempotent and side-effect-free; the raw AJV errors stay attached to
 * `err.ajvErrors` for the chat module's structured-error channel.
 */
function filterOneOfErrorsByDiscriminator(errors: any[] | undefined, viz: any): any[] {
    if (!Array.isArray(errors) || !errors.length) return [];
    if (!isPlainObject(viz) || !isPlainObject(viz.shaders)) return errors;

    const shaderIdRegex = /^\/shaders\/([^/]+)/;
    const branchRegex = /\/shaderLayers\/([^/]+)/;

    const out: any[] = [];
    const seen = new Set<string>();
    for (const e of errors) {
        const ip: string = typeof e?.instancePath === "string" ? e.instancePath : "";
        const sp: string = typeof e?.schemaPath === "string" ? e.schemaPath : "";

        const idMatch = ip.match(shaderIdRegex);
        if (idMatch) {
            const shaderId = idMatch[1];
            const branchMatch = sp.match(branchRegex);
            if (branchMatch) {
                const branchType = branchMatch[1];
                const layer = (viz.shaders as any)[shaderId!];
                const inputType = isPlainObject(layer) && typeof layer.type === "string" ? layer.type : undefined;
                if (inputType && inputType !== branchType) continue;     // wrong-branch noise
            }
        }

        // Dedupe identical (instancePath, message) pairs that survive the filter.
        const key = `${ip}::${e?.message || ""}::${e?.params ? JSON.stringify(e.params) : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out.length ? out : errors;
}

/**
 * Render a one-line corrective hint for a coupling violation. Walks the
 * validator's `expected` payload (small object of `{ "<dotted.path>": value }`
 * entries) and emits `Set X = Y[, Z = W][.]` so the LLM gets the literal fix
 * inline with the failure message — no second-round trip required.
 *
 * Generic over coupling shape; per-coupling logic lives in flex-renderer.
 * Returns "" when the expected payload is empty or absent.
 */
function formatCouplingCorrective(expected: any, _actual: any): string {
    if (!isPlainObject(expected)) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
        let rendered: string;
        if (value === null || value === undefined) rendered = String(value);
        else if (typeof value === "number" || typeof value === "boolean") rendered = String(value);
        else if (typeof value === "string") rendered = JSON.stringify(value);
        else {
            try { rendered = JSON.stringify(value); } catch (e) { rendered = String(value); }
        }
        parts.push(`\`${key}\` = ${rendered}`);
    }
    if (!parts.length) return "";
    return `To satisfy: set ${parts.join(", ")}.`;
}

function isPlainObject(value: any): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }
    return !Array.isArray(value);
}

/**
 * Build the set of shader ids that the open pipeline injects from
 * `APPLICATION_CONTEXT.config.background[i].id`. Both the raw form and the
 * FlexRenderer-sanitized form are returned so callers can test against either.
 *
 * The renderer's `_shaders` map is keyed by sanitized id; if a visualization
 * config carries a shader whose id sanitizes onto a background's id, the open
 * pipeline emits two distinct map entries that collapse to one in the
 * renderer's order array, producing GLSL that declares the same uniforms
 * twice. We use this set at the data-model boundaries (write via
 * normalizeVisualizationInput, read via getVisualizations / getActiveVisualization)
 * to enforce the structural invariant: backgrounds are owned by
 * `config.background`, never by `config.visualizations[i].shaders`.
 */
function collectBackgroundShaderIds(): Set<string> {
    const out = new Set<string>();
    try {
        const cfg: any = APPLICATION_CONTEXT?.config;
        const backgrounds = Array.isArray(cfg?.background) ? cfg.background : [];
        const fr: any = (OpenSeadragon as any)?.FlexRenderer;
        const sanitize: ((s: string) => string) | undefined = typeof fr?.sanitizeKey === "function" ? fr.sanitizeKey : undefined;
        for (const bg of backgrounds) {
            const id = bg?.id;
            if (typeof id !== "string" || !id.length) continue;
            out.add(id);
            if (sanitize) {
                try { out.add(sanitize(id)); } catch (e) { /* skip non-stringable */ }
            }
        }
    } catch (e) { /* swallow — best-effort filter */ }
    return out;
}

/**
 * Drop any top-level shader entries (and their entries in `viz.order`) whose
 * id appears in the background-shader-id set. Mutates `viz` in place. Walks
 * only the top level — the invariant applies to root visualization shaders;
 * nested group children are not currently in scope (no known case where bg
 * ids collide with nested ids).
 */
function stripBackgroundShaderIds(viz: any): void {
    if (!viz || typeof viz !== "object") return;
    const bgIds = collectBackgroundShaderIds();
    if (!bgIds.size) return;

    if (viz.shaders && typeof viz.shaders === "object" && !Array.isArray(viz.shaders)) {
        for (const id of Object.keys(viz.shaders)) {
            if (bgIds.has(id)) delete viz.shaders[id];
        }
    }
    if (Array.isArray(viz.order)) {
        viz.order = viz.order.filter((id: any) => typeof id !== "string" || !bgIds.has(id));
    }
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
            "The namespace provides shader documentation, schema-based discovery for available visualization options, persistent visualization management for the current viewer session, and standalone viewport rendering/extraction with custom visualization configurations. Inspect getSchema() and related metadata before mutating visualizations; prefer exploring available layer types, examples, params, and validation guidance over guessing."
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
    protected _publishedSchemaCache: Record<string, any> | undefined;

    /**
     * Drop the cached validator and re-enable validation. Call after registering new shaders at
     * runtime so the next validation picks up the new schema.
     */
    public invalidateSchemaCache(): void {
        this._ajvValidator = undefined;
        this._ajvDisabled = false;
        this._publishedSchemaCache = undefined;
    }

    /**
     * Lazy AJV compile with defenses against the recursive `group` schema. Returns undefined when
     * AJV is missing or when compile fails (e.g. stack overflow on a recursive `$ref` graph).
     * Callers must treat undefined as "validation unavailable; skip and let downstream gates run".
     */
    protected getSchemaValidator(): ((value: any) => boolean) | undefined {
        if (this._ajvValidator) return this._ajvValidator;
        if (this._ajvDisabled) return undefined;

        // Look for the AJV constructor under any of the names hosts commonly expose. Prefer
        // 2020-12-aware classes; fall back to the default AJV class. Note: if the loaded class
        // only knows draft-07, the compile call below will throw on the renderer's 2020-12
        // schema and the catch will disable validation — same outcome as no AJV at all.
        //
        // The bundled UMD at src/libs/ajv7.min.js sets `window.ajv7` to the module's
        // exports object (NOT the constructor): the Ajv class is the `default` export.
        // Walk every candidate name and unwrap `.default` if the value is an object
        // rather than a function — same probe order, just resilient to UMD shapes.
        const g = globalThis as any;
        const candidates = ["Ajv2020", "ajv2020", "Ajv", "ajv", "ajv7"];
        let AjvCtor: any;
        for (const name of candidates) {
            const cand = g[name];
            if (typeof cand === "function") { AjvCtor = cand; break; }
            if (cand && typeof cand.default === "function") { AjvCtor = cand.default; break; }
        }
        if (typeof AjvCtor !== "function") {
            this._ajvDisabled = true;
            console.warn(
                "[visualization scripting] AJV is not available on globalThis (looked for " +
                "Ajv2020 / ajv2020 / Ajv / ajv / ajv7). Schema validation is disabled; the " +
                "playground review remains the gate."
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
                const filtered = filterOneOfErrorsByDiscriminator(errors, viz);
                const summary = filtered.map(e => {
                    const where = e.instancePath ? `viz[${i}]${e.instancePath}` : `viz[${i}]`;
                    return `  ${where}: ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`;
                }).join("\n");
                const err: any = new Error(`Visualization validation failed before review:\n${summary}`);
                err.ajvErrors = errors;     // raw errors for the chat module's structured channel
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
                const corrective = formatCouplingCorrective(outcome.expected, outcome.actual);
                const msg = `Coupling '${entry.name}' on shader '${layerType}' (${path || layer.id || layerType}) was not satisfied.${summary}${corrective ? ` ${corrective}` : ""}`;
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
        // Derive per-slot viz from each active background entry's
        // `visualizationIndex` field — the new single source of truth.
        const activeBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
        const slots: Array<number | undefined> = Array.isArray(activeBg)
            ? activeBg
            : (Number.isInteger(activeBg) ? [activeBg] : []);
        if (slots.length === 0) return undefined;
        const backgrounds: any[] = Array.isArray(APPLICATION_CONTEXT.config.background)
            ? APPLICATION_CONTEXT.config.background
            : [];
        return slots.map((bgIdx: any) => {
            const v = Number.isInteger(bgIdx) ? backgrounds[bgIdx as number]?.visualizationIndex : undefined;
            return Number.isInteger(v) ? v as number : undefined;
        });
    }

    protected buildVisualizationStateSnapshot(): VisualizationStateSnapshot {
        const visualizations = cloneJson(Array.isArray(APPLICATION_CONTEXT.config.visualizations) ? APPLICATION_CONTEXT.config.visualizations : []);
        // Persisted visualizations may carry top-level shader entries whose ids
        // collide with config.background[i].id. The playground assembler keys
        // bg shaders by bgRef.id and viz shaders by their authored id, so a
        // collision produces two distinct renderOutput rows pointing at the
        // same image — visible as a duplicated background row in the side menu
        // and a double-render in the playground viewer. Strip here so every
        // proposal-bound snapshot built from current state is clean.
        for (const viz of visualizations) stripBackgroundShaderIds(viz);
        return {
            data: cloneJson(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            visualizations,
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
                rejectedMessage: "Visualization state restore was canceled by the user.",
                cacheKey: "visualization:restore-state"
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
     *   - Decline  → throws VisualizationReviewDeclinedError whose message wraps
     *                rejectedMessage with a directive sentence telling the LLM to ask
     *                the user before retrying. Worker→main serialization preserves
     *                only message text, so the directive must live there.
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
            cacheKey?: string;
        } = {}
    ): Promise<VisualizationStateSnapshot> {
        const rejectedMessage = options.rejectedMessage || "The proposed visualization change was canceled by the user.";

        // Order matters: prefer the Playground over any bypass, because visualization mutations
        // are user-visible state changes that the user should be able to inspect / edit / reject
        // even when the script context otherwise auto-accepts simple consent prompts. The
        // `bypassConsentDialog` flag is only honored when no Playground UI is available
        // (headless/test environments).
        const PLAYGROUND: any = (window as any).PLAYGROUND;
        const playgroundAvailable = !!(PLAYGROUND && typeof PLAYGROUND.open === "function" && typeof document !== "undefined");

        // Defensive strip: even if the snapshot was built ad-hoc by a caller
        // (instead of going through buildVisualizationStateSnapshot), guarantee
        // the playground/headless commit never sees a viz shader whose id
        // collides with a configured background. Operates on a clone so the
        // caller's object is left intact.
        const sanitized: VisualizationStateSnapshot = cloneJson(proposed);
        if (Array.isArray(sanitized.visualizations)) {
            for (const viz of sanitized.visualizations) stripBackgroundShaderIds(viz);
        }

        if (!playgroundAvailable) {
            if (this.bypassConsentDialog) {
                return sanitized;
            }
            await this.requireActionConsent({
                title: options.consentTitle || options.title || "Allow visualization change?",
                description: options.consentDescription || options.rationale || "The script wants to change the visualization in the current viewer session.",
                details: options.consentDetails,
                mode: "warning",
                confirmLabel: options.confirmLabel,
                cancelLabel: options.cancelLabel,
                rejectedMessage,
                cacheKey: options.cacheKey,
            });
            return sanitized;
        }

        const viewer = this.activeViewer;
        // Apply-on-accept is OFF: the caller pipeline (APPLICATION_CONTEXT.updateVisualization
        // or applyVisualizationStateSnapshot) commits after this returns, so we don't want
        // the helper to apply twice. The helper still runs the playground UI and returns
        // the user's decision.
        const noopApply = async () => true;
        const review: VisualizationReviewDecision = await reviewVisualizationProposal(
            viewer,
            sanitized,
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
            throw new VisualizationReviewDeclinedError(rejectedMessage);
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
        stripBackgroundShaderIds(visualization);
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
     * Discovery guidance:
     * - inspect `$defs.shaderLayers` to enumerate available shader/layer types
     * - read each candidate's `x-intent`, `x-expects`, and `x-controlCouplings` before choosing
     * - copy `examples[0]` from the selected layer type as the structural starting point
     * - set only params that exist on that type; different layer types intentionally expose different controls
     * - if the schema evidence is ambiguous, inspect more state or ask a clarification question instead of guessing
     *
     * The slim view drops `$defs.uiControlEnvelopes` (typedef catalog) since `$defs.shaderLayers[type].examples`
     * already encode valid envelope values. xOpat's own AJV instance still uses the full schema
     * (with refs intact) for validation.
     */
    getSchema(): Record<string, any> {
        // Defensive caller-side wrapper for the FlexRenderer "published examples failed validation"
        // path - tracked upstream as patch B4 in docs/patches/flex-renderer-llm-schema.md. Once the
        // upstream library no longer rejects its own examples, this try/catch can drop the fallback.
        let fullSchema: any;
        try {
            fullSchema = this.shaderConfigurator.compileConfigSchemaModel();
            this._publishedSchemaCache = fullSchema;
        } catch (err) {
            if (this._publishedSchemaCache) {
                fullSchema = this._publishedSchemaCache;
            } else {
                const message = err instanceof Error ? err.message : String(err);
                const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || "schema compile failed";
                throw new Error(`getSchema(): ${firstLine}`);
            }
        }
        const slim = cloneJson(fullSchema);
        if (slim && isPlainObject(slim.$defs)) {
            delete slim.$defs.uiControlEnvelopes;
        }
        return slim;
    }

    /**
     * Returns the persisted visualization list for the current session.
     *
     * Each entry is stripped of background-derived shader entries before
     * being returned (see stripBackgroundShaderIds). The persisted config
     * itself is not mutated; the next API write triggers a clean rewrite,
     * which heals corrupted historical state organically.
     */
    getVisualizations(): VisualizationItem[] {
        const visualizations = Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations
            : [];
        const cloned = cloneJson(visualizations);
        for (const viz of cloned) stripBackgroundShaderIds(viz);
        return cloned;
    }

    /**
     * Returns the current active visualization selection, intersected with the
     * actual visualization array — entries that point outside the array become
     * `undefined`, and an entirely-empty result is returned as `undefined`.
     *
     * Rationale: the persisted `activeVisualizationIndex` option is a free
     * cursor that does not auto-sync with `config.visualizations.length`, so
     * scripts could observe `[0]` even when no visualization exists. Surfacing
     * the cursor verbatim led the LLM to assume a viz existed and to issue
     * follow-up calls against an absent target. Guarding here keeps the
     * internal protected getter raw (callers that build snapshots want the
     * unfiltered cursor) while giving the public API a sane invariant.
     */
    getActiveVisualizationIndex(): Array<number | undefined> | undefined {
        const raw = cloneJson(this.getActiveVisualizationSelection());
        if (raw === undefined) return undefined;
        const total = Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations.length
            : 0;
        if (total === 0) return undefined;
        const guarded = raw.map((entry) =>
            Number.isInteger(entry) && (entry as number) >= 0 && (entry as number) < total ? entry : undefined
        );
        return guarded.every((entry) => entry === undefined) ? undefined : guarded;
    }

    /**
     * Returns the first active visualization configuration, when one is selected.
     * Stripped of background-derived shader entries; see getVisualizations.
     */
    getActiveVisualization(): VisualizationItem | undefined {
        const active = APPLICATION_CONTEXT.activeVisualizationConfig();
        const cloned = cloneJson(active);
        if (cloned) stripBackgroundShaderIds(cloned);
        return cloned;
    }

    /**
     * Dry-run validator for a proposed VisualizationItem (or shader-map). Runs
     * the same JSON-Schema and coupling checks as `addVisualization` /
     * `updateVisualizationAt` / `replaceVisualizations`, without mutating
     * state or opening the playground review.
     *
     * Use this before any visualization-mutating call to catch shape errors,
     * unknown fields, and cross-field rule violations (e.g. colormap class
     * count vs threshold breaks). Returns a structured report; the caller
     * fixes anything where `ok === false` and re-validates.
     *
     * Shape: same as the `addVisualization` first argument — either a full
     * `VisualizationItem` (`{ name, shaders }`) or a shader-map.
     */
    validateProposedVisualization(viz: any): {
        ok: boolean;
        normalized?: VisualizationItem;
        schemaErrors: string[];
        couplingViolations: Array<{
            coupling: string;
            layerType?: string;
            layerPath?: string;
            controls?: string[];
            expected?: any;
            actual?: any;
            message: string;
        }>;
    } {
        const schemaErrors: string[] = [];
        const couplingViolations: Array<{
            coupling: string; layerType?: string; layerPath?: string;
            controls?: string[]; expected?: any; actual?: any; message: string;
        }> = [];

        let normalized: VisualizationItem | undefined;
        try {
            normalized = this.normalizeVisualizationInput(viz);
        } catch (err: any) {
            schemaErrors.push(String(err?.message || err));
            return { ok: false, schemaErrors, couplingViolations };
        }

        try {
            this.validateProposedVisualizations([normalized]);
        } catch (err: any) {
            const msg = String(err?.message || err);
            // Strip the leading "Visualization validation failed before review:" header so the
            // returned strings are pure error lines the caller can re-render.
            for (const line of msg.split(/\r?\n/)) {
                const trimmed = line.replace(/^Visualization validation failed before review:?$/, "").trim();
                if (trimmed) schemaErrors.push(trimmed);
            }
        }

        if (isPlainObject((normalized as any).shaders)) {
            for (const [key, layer] of Object.entries((normalized as any).shaders)) {
                try {
                    this.validateLayerCouplings(layer, key);
                } catch (err: any) {
                    const v = err?.couplingViolation || {};
                    couplingViolations.push({
                        coupling: v.coupling || "(unnamed)",
                        layerType: v.layerType,
                        layerPath: v.layerPath,
                        controls: v.controls,
                        expected: v.expected,
                        actual: v.actual,
                        message: String(err?.message || err),
                    });
                }
            }
        }

        const ok = schemaErrors.length === 0 && couplingViolations.length === 0;
        return ok
            ? { ok, normalized, schemaErrors, couplingViolations }
            : { ok, schemaErrors, couplingViolations };
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
            cacheKey: "visualization:restore-state",
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
            rejectedMessage: "Changing the active visualization was canceled by the user.",
            cacheKey: "visualization:set-active"
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
            cacheKey: "visualization:replace",
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
            cacheKey: "visualization:add",
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
            cacheKey: "visualization:update",
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
            rejectedMessage: "Removing the visualization was canceled by the user.",
            cacheKey: "visualization:remove"
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
     * Renders ONLY the background image group of the current viewport (no data/visualization overlay),
     * at the live zoom/pan, into a screen-oriented canvas. Reuses the standalone drawer second-pass with a
     * configuration restricted to the background shader layer(s) — the same primitive
     * {@link extractCanvasForVisualization} uses, but filtered to backgrounds.
     */
    protected async extractBackgroundCanvas(options: VisualizationViewportRenderOptions = {}): Promise<HTMLCanvasElement> {
        const viewer: any = this.activeViewer;
        const renderer: any = viewer?.drawer?.renderer;
        if (!renderer?.getShaderLayerConfig) {
            throw new Error("The active viewer has no renderer to read the background image from.");
        }

        // The live renderer stores each shader under a per-viewer NAMESPACED id
        // (`viewer.__shaderNamespace + structuralId`; see shader-id-namespace.ts).
        // Look the background configs up the same way navigatorThumbnail does
        // (src/external/osd_tools.js) — the raw structural id misses.
        const ns: string = viewer.__shaderNamespace || "";
        const backgrounds: any[] = Array.isArray(APPLICATION_CONTEXT.config?.background)
            ? APPLICATION_CONTEXT.config.background
            : [];
        const configuration: Record<string, any> = {};
        for (const bg of backgrounds) {
            const id = bg?.id;
            if (typeof id !== "string" || !id.length) continue;
            const cfg = renderer.getShaderLayerConfig(ns + id) || renderer.getShaderLayerConfig(id);
            if (cfg) configuration[cfg.id ?? (ns + id)] = cfg;
        }
        if (!Object.keys(configuration).length) {
            throw new Error("No background layer is available to render.");
        }

        const drawer = this.getCurrentStandaloneDrawer();
        const extractedCanvas = await drawer.extract({
            mode: "second-pass",
            configuration,
            view: viewer.drawer,
            result: "canvas"
        });
        if (!extractedCanvas) {
            throw new Error("Failed to render the background layer.");
        }

        return this.cropAndScaleCanvas(extractedCanvas, options);
    }

    /**
     * Renders the current viewport's BACKGROUND image only (no overlay) and returns a PNG data URL.
     */
    async renderCurrentBackgroundPng(options: VisualizationViewportRenderOptions = {}): Promise<string> {
        const canvas = await this.extractBackgroundCanvas(options);
        if (typeof canvas.toDataURL !== "function") {
            throw new Error("The extracted background canvas does not support toDataURL().");
        }
        return canvas.toDataURL("image/png");
    }

    /**
     * Renders the current viewport's BACKGROUND image only (no overlay) and returns raw RGBA pixels.
     */
    async renderCurrentBackgroundPixels(options: VisualizationViewportRenderOptions = {}): Promise<VisualizationViewportPixelsResult> {
        const canvas = await this.extractBackgroundCanvas(options);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Failed to create a 2D context for background extraction.");
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
