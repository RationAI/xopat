import type { ScriptApiMetadata } from "./abstract-types";
import type {
    VisualizationScriptApi,
    VisualizationStateSnapshot,
    VisualizationViewportRenderOptions,
    VisualizationViewportPixelsResult,
    VisualizationRegionRenderOptions,
    VisualizationRegionPixelsResult,
    VisualizationFirstPassExtractOptions,
    VisualizationLayerSource,
    VisualizationShaderGroupOrLayer,
    VisualizationDataSourceInfo,
    VisualizationDataProbe,
    VisualizationDataProbeOptions,
} from "./visualization-api.scripts";

import { XOpatScriptingApi } from "./abstract-api";
import { fetchDtsCached } from "./dts-fetch";
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
            value: () => fetchDtsCached(APPLICATION_CONTEXT.url + "src/classes/scripting/visualization-api.scripts.d.ts")
        }
    };

    /**
     * Default output-size cap for off-screen REGION renders (level-0 image pixels). Shared by
     * the region render guard (extractRegionCanvas) and the region pixel-readback guard
     * (renderRegionPixels) so the two stay symmetric — a region the render allows never fails
     * on readback. Distinct from readCanvasPixels' own viewport/background default (1024*1024).
     */
    protected static readonly REGION_DEFAULT_MAX_PIXELS = 4096 * 4096;

    /** Monotonic id source for `region-capture` announcements (see announceCapture). */
    protected static _captureSeq = 0;

    constructor(namespace: string) {
        super(
            namespace,
            "Visualization Interface",
            "Controls HOW data is displayed: the shader layers drawn over each slide, and the raw scan underneath them (an implicit identity pass-through). Provides shader documentation and schema-based discovery of the available options, inspection of the data being rendered (describeData for source metadata, probeData for the actual value range and distribution, critiqueCurrentRendering for a written second opinion on how the current view looks), persistent visualization management for the current viewer session, and standalone viewport rendering/extraction with custom configurations. This is the namespace for any request about appearance — improving, fixing or changing a visualization needs the data's properties, NOT the specimen's stain or clinical context. Inspect the data and getSchema() before mutating; prefer exploring layer types, examples, params and validation guidance over guessing."
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
            APPLICATION_CONTEXT.renderDebug?.registerDrawer(drawer, {
                label: "script-viz", viewer, kind: "offscreen"
            });
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
     * the layer is deep-merged. Visualization-level fields (`name`, `order`, ...) are deep-merged.
     *
     * Why this matters: deep-merging across a type change produces a half-old/half-new layer that
     * carries the previous shader's control values, which the new shader's schema rejects with
     * `additionalProperties: false`. The LLM-facing failure looks like "spurious validation error"
     * when the real issue is "you can't patch type, you have to replace the layer".
     */
    protected mergeVisualizationPatch(existing: any, patch: any): any {
        if (!isPlainObject(patch)) return cloneJson(existing) as any;

        const merged: any = OpenSeadragon.extend(true, {}, existing);

        // Visualization-level fields (name, order, etc.) merge normally.
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
                    merged.shaders[layerKey] = OpenSeadragon.extend(true, {}, existingLayer || {}, cloneJson(patchLayer));
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
        const configuration = this.resolveStandaloneConfiguration(input);
        // Serialize on the shared per-viewer standalone drawer: the drawer and its viewport
        // bindings are single-flight, so an unqueued pass here would race a concurrent off-screen
        // region render (see runSerializedRegionTask).
        const out = await this.runSerializedRegionTask(viewer, () =>
            this.getCurrentStandaloneDrawer().extract({
                mode: "second-pass",
                configuration,
                view: viewer.drawer,
                result: "canvas"
            }), { kind: "viewport", label: options.label });

        // Unwrapped only to read the canvas out of the envelope: this caller has no completeness
        // contract of its own, and a caller-supplied visualization may reference any world item, so
        // there is nothing narrower than "the whole live world" to measure anyway.
        const { canvas } = this.unwrapExtract(out, "Failed to render the standalone visualization extraction.");
        return this.cropAndScaleCanvas(canvas, options);
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
        // path: `compileConfigSchemaModel` validates the library's OWN bundled examples against the
        // schema it just generated, and throws the whole document away when they disagree. The
        // schema is fine; the examples are decorative data. Recorded in UPSTREAM.md — once the
        // library warns instead of throwing, this try/catch can drop the fallback. Note the cache
        // only helps a caller that has already succeeded once: a first call with no cache still
        // fails, which is why this cannot be the only mitigation.
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
        this.attachShaderCatalog(slim);
        return slim;
    }

    /**
     * Compact index of the available shader types, derived from the schema the renderer
     * just published. Consumers that only need to CHOOSE a type (the assistant, a picker
     * UI) read this instead of walking the full `$defs.shaderLayers` document, which is
     * an order of magnitude larger. Same shape as the session-schema catalogue in
     * `server/static/scheme.js`, kept derived rather than hand-listed so it cannot go
     * stale when the renderer registry changes.
     */
    protected attachShaderCatalog(schema: Record<string, any>): void {
        const layers = schema?.$defs?.shaderLayers;
        if (!isPlainObject(layers)) return;

        const catalog: Record<string, any> = {};
        for (const [type, layerSchema] of Object.entries<any>(layers)) {
            if (!isPlainObject(layerSchema)) continue;
            catalog[type] = {
                type,
                name: layerSchema.title || type,
                description: layerSchema.description || "",
                intent: layerSchema["x-intent"] || "",
                expects: layerSchema["x-expects"] || {},
            };
        }
        schema["x-shaderCatalog"] = catalog;
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
     * On success, `normalized` is what the mutating call would build anyway, so
     * callers should forward it rather than re-serializing their own literal.
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
     * Read a rendered canvas back as RGBA pixels, honouring the size guard and the
     * requested representation.
     *
     * `Array.from` on a viewport-sized buffer is brutally expensive — it boxes every
     * colour channel into a heap-allocated JS number (~520ms and ~344MB for a
     * 1500x800 @DPR2 frame, versus ~7ms and ~18MB for the typed buffer) and leaves
     * every downstream loop indexing a non-typed array. It stays the default only
     * because the `number[]` shape is the published, JSON-friendly script contract;
     * in-process callers should ask for `pixelFormat: "typed"` and pay neither cost.
     */
    protected readCanvasPixels(
        canvas: HTMLCanvasElement,
        options: VisualizationViewportRenderOptions,
        contextErrorMessage: string
    ): VisualizationViewportPixelsResult {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error(contextErrorMessage);
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
            data: options.pixelFormat === "typed" ? imageData.data : Array.from(imageData.data)
        };
    }

    /**
     * Renders the current viewport through a temporary standalone visualization and returns RGBA pixels.
     */
    async renderCurrentViewportPixels(
        visualization: VisualizationLayerSource,
        options: VisualizationViewportRenderOptions = {}
    ): Promise<VisualizationViewportPixelsResult> {
        const canvas = await this.extractCanvasForVisualization(visualization, options);
        return this.readCanvasPixels(canvas, options, "Failed to create a 2D context for pixel extraction.");
    }

    /**
     * Renders ONLY the background image group of the current viewport (no data/visualization overlay),
     * at the live zoom/pan, into a screen-oriented canvas. Reuses the standalone drawer second-pass with a
     * configuration restricted to the background shader layer(s) — the same primitive
     * {@link extractCanvasForVisualization} uses, but filtered to backgrounds.
     */
    /**
     * Harvest the live renderer's BACKGROUND shader configs, keyed for `drawWithConfiguration`.
     * The live renderer stores each shader under a per-viewer NAMESPACED id
     * (`viewer.__shaderNamespace + structuralId`; see shader-id-namespace.ts).
     * Look the background configs up the same way navigatorThumbnail does
     * (src/classes/osd/tools.ts) — the raw structural id misses.
     */
    protected harvestBackgroundConfiguration(viewer: any): Record<string, any> {
        const renderer: any = viewer?.drawer?.renderer;
        if (!renderer?.getShaderLayerConfig) {
            throw new Error("The active viewer has no renderer to read the background image from.");
        }

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
        return configuration;
    }

    /**
     * Harvest the FULL live shader stack (background + visualization layers) in renderer order,
     * so an off-screen pass reproduces exactly what the user currently sees. Skips invisible and
     * errored layers. Shallow-copies each config so user-edited control values on `cfg.cache`
     * ride along (same recipe as modules/annotations/viewport-segmentation.js).
     */
    protected harvestActiveConfiguration(viewer: any, options: { allowEmpty?: boolean } = {}): Record<string, any> {
        const renderer: any = viewer?.drawer?.renderer;
        if (!renderer?.getShaderLayerOrder || !renderer?.getShaderLayerConfig) {
            throw new Error("The active viewer has no renderer to read the visualization from.");
        }

        const order: string[] = renderer.getShaderLayerOrder() || [];
        const configuration: Record<string, any> = {};
        for (const id of order) {
            const cfg = renderer.getShaderLayerConfig(id);
            if (!cfg || cfg.error) continue;
            if (cfg.visible === 0 || cfg.visible === false) continue;
            configuration[id] = { ...cfg };
        }
        // `allowEmpty` lets callers degrade (e.g. to the raw background) when no layer is
        // currently visible/renderable, rather than hard-failing; the no-renderer case above
        // still throws unconditionally.
        if (!options.allowEmpty && !Object.keys(configuration).length) {
            throw new Error("No visible shader layer is available to render.");
        }
        return configuration;
    }

    /**
     * Render the CURRENT viewport's background layer off-screen, and say how much of it is real.
     *
     * `view: viewer.drawer` takes flex-renderer's `fullDrawPass = false` branch: the pass re-renders
     * the second pass over the LIVE drawer's first-pass texture instead of driving the mirrors. Its
     * pixels are therefore exactly as complete as what the user is looking at — which is why no wait
     * is requested here. A capture of the view the user is on is faithful by construction: missing
     * tiles are missing on screen too, and waiting would return a view they never saw. Without the
     * flag, though, a viewport still streaming was indistinguishable from a settled one, and the
     * blanks went to a vision model as if they were tissue.
     */
    protected async extractBackgroundCanvas(
        options: VisualizationViewportRenderOptions = {}
    ): Promise<{ canvas: HTMLCanvasElement; isComplete: boolean }> {
        const viewer: any = this.activeViewer;
        const configuration = this.harvestBackgroundConfiguration(viewer);
        // Only the background item's pixels end up in this result, so completeness is defined over
        // that item alone — otherwise a faulty overlay the pass never drew brands every background
        // read incomplete forever. LIVE world items here, not mirrors: this branch measures the live
        // world (the off-screen path narrows over its mirrors instead). Omitted for an empty world
        // so the renderer falls back to its own default rather than being handed `[undefined]`.
        const backgroundItem = viewer?.world?.getItemAt?.(0);
        // Serialize on the shared per-viewer standalone drawer — same single-flight guard as
        // the region-render path, so background readback never interleaves an off-screen
        // region pass and corrupts its raster.
        const out = await this.runSerializedRegionTask(viewer, () =>
            this.getCurrentStandaloneDrawer().extract({
                mode: "second-pass",
                configuration,
                view: viewer.drawer,
                result: "canvas",
                ...(backgroundItem ? { waitImages: [backgroundItem] } : {}),
            }), { kind: "viewport", label: options.label });

        const { canvas, isComplete } = this.unwrapExtract(out, "Failed to render the background layer.");
        return { canvas: this.cropAndScaleCanvas(canvas, options), isComplete };
    }

    /**
     * Renders the current viewport's BACKGROUND image only (no overlay) and returns a PNG data URL.
     * Use {@link renderCurrentBackgroundPixels} when you need to know whether the viewport had
     * finished streaming — a data URL cannot carry that, and a partial one looks identical.
     */
    async renderCurrentBackgroundPng(options: VisualizationViewportRenderOptions = {}): Promise<string> {
        const { canvas } = await this.extractBackgroundCanvas(options);
        if (typeof canvas.toDataURL !== "function") {
            throw new Error("The extracted background canvas does not support toDataURL().");
        }
        return canvas.toDataURL("image/png");
    }

    /**
     * Renders the current viewport's BACKGROUND image only (no overlay) and returns raw RGBA pixels
     * plus `isComplete` — false when the live viewport was still streaming tiles as it was read.
     */
    async renderCurrentBackgroundPixels(options: VisualizationViewportRenderOptions = {}): Promise<VisualizationViewportPixelsResult> {
        const { canvas, isComplete } = await this.extractBackgroundCanvas(options);
        const pixels = this.readCanvasPixels(canvas, options, "Failed to create a 2D context for background extraction.");
        return { ...pixels, isComplete };
    }

    /**
     * Announce a pixel capture on the VIEWER it reads from, as the `region-capture` event
     * (phases `queued` → `start` → `end`; see src/EVENTS.md). This is the only signal that an
     * off-screen pass happened at all — the user's viewport never moves — so the core capture
     * indicator (and any auditing consumer) can show WHICH part of the slide was read and by
     * whom. Never throws into a render path: a broken listener must not fail the capture.
     */
    protected announceCapture(viewer: any, payload: RegionCaptureEvent): void {
        try {
            viewer?.raiseEvent?.("region-capture", payload);
        } catch (e) {
            console.warn("[capture] region-capture listener failed:", e);
        }
    }

    /**
     * Serialize every off-screen standalone-drawer pass per viewer (region renders AND
     * background/viewport extracts — they share one drawer). The drawer's internal lock
     * protects a single pass, but consecutive broker calls also share cached state
     * (mirror tiled images, `lastDrawFullyLoaded`), so the whole task must be atomic.
     */
    protected runSerializedRegionTask<T>(
        viewer: any,
        task: () => Promise<T>,
        capture?: CaptureAnnouncement,
        opts?: { queueTimeoutMs?: number }
    ): Promise<T> {
        // Gate the pass behind the shared background scheduler. An off-screen pass drives
        // its detached mirror TiledImages via `update(true)`, which schedules NEW tile
        // downloads on the ordinary (ungated) tile path — those bursts otherwise contend
        // with live interactive tiles for the browser's per-origin connections and stall
        // navigation. Acquiring a background slot for the tile origin defers the pass (and
        // its download burst) to a live-idle window; the scheduler's starvation escape
        // (~1500ms) still force-admits one pass at a time under sustained navigation so the
        // report always progresses. Per-pass acquire (not per-batch) re-checks busy in the
        // gap, yielding the pool back to any tiles the user's navigation just kicked off.
        //
        // Limitation: this gates connection ADMISSION — it controls WHEN a pass may start.
        // It does not de-prioritize mirror tiles WITHIN a running pass; once admitted, a
        // pass's ungated tiles compete for its duration. Acceptable because passes are
        // serialized (one burst max in flight) and now land in idle gaps. A true per-tile
        // priority seam needs the vendored loader (flagged upstream).
        const captureId = capture ? `cap-${++XOpatVisualizationScriptApi._captureSeq}` : "";
        if (capture) this.announceCapture(viewer, { ...capture, captureId, phase: "queued" });
        // The two waits above the task — queue position and scheduler admission — are what
        // `queueTimeoutMs` bounds, and the clock starts HERE, at submission, because that is
        // when the caller's own wall-clock guard starts. Measured from a single deadline rather
        // than per-wait so a pass cannot spend the budget twice.
        const queueBudget = Number.isFinite(opts?.queueTimeoutMs as number) && (opts!.queueTimeoutMs as number) > 0
            ? Number(opts!.queueTimeoutMs) : 0;
        const deadline = queueBudget ? Date.now() + queueBudget : 0;
        const queueTimeout = (): Error => {
            const e = new Error($.t("error.regionRenderQueueTimeout", { ms: queueBudget }));
            e.name = "QueueTimeoutError";
            return e;
        };
        const gated = async (): Promise<T> => {
            let error: any = null;
            let started = false;
            let release: (() => void) | null = null;
            try {
                // Waited its whole budget for a turn in the queue — reject before doing any
                // work, so a congested queue costs the caller a fast, named failure instead
                // of a render whose result arrives after the caller gave up on it.
                if (deadline && Date.now() >= deadline) throw queueTimeout();

                const scheduler = (APPLICATION_CONTEXT as any)?.requestScheduler;
                if (scheduler) {
                    // Whatever is left of the budget bounds admission. `acquire` drops an
                    // aborted waiter from its lane, so an expired wait frees the slot rather
                    // than holding one nobody will use.
                    const controller = deadline ? new AbortController() : null;
                    const timer = controller
                        ? setTimeout(() => controller.abort(queueTimeout()), Math.max(0, deadline - Date.now()))
                        : null;
                    try {
                        release = await scheduler.acquire(
                            this._regionTileOrigin(viewer),
                            controller ? { signal: controller.signal } : {}
                        ).catch((e: any) => {
                            // Our own deadline is a real failure; anything else (a scheduler
                            // that refused for its own reasons) degrades to running ungated,
                            // which is what this path did before it could be bounded at all.
                            if (e?.name === "QueueTimeoutError") throw e;
                            return null;
                        });
                    } finally {
                        if (timer !== null) clearTimeout(timer);
                    }
                }
                // Announced only after admission: a queued pass may wait seconds for a live-idle
                // window, and a marker claiming "capturing now" during that wait would lie.
                started = true;
                if (capture) this.announceCapture(viewer, { ...capture, captureId, phase: "start" });
                return await task();
            } catch (e) {
                error = e;
                throw e;
            } finally {
                if (release) release();
                // Terminate the capture even when it never started: the indicator holds a
                // "queued" marker live until an `end` arrives, so skipping this would leave a
                // rectangle on the slide claiming a read that was abandoned.
                if (capture) this.announceCapture(viewer, {
                    ...capture,
                    captureId,
                    phase: "end",
                    ok: !error && started,
                    error: error ? (error instanceof Error ? error.message : String(error)) : undefined
                });
            }
        };
        const prev: Promise<any> = viewer.__scriptRegionRenderQueue || Promise.resolve();
        const next = prev.catch(() => undefined).then(gated);
        // Store only a completion signal — never the task's fulfilled value. Adopting the
        // result would pin the last render canvas (up to a ~256MB RGBA buffer) alive on the
        // queue until the next region render, indefinitely if none follows.
        viewer.__scriptRegionRenderQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    /**
     * Origin key for a viewer's tile traffic, used to place an off-screen region pass in the
     * SAME scheduler lane as that slide's live tiles / z-plane prefetch (so the idle cap bounds
     * their sum). Derived from the reference source's tile URL; never throws into the render
     * path — synthetic / `data:` / `blob:` sources fall back to the app origin, then `"*"`.
     */
    protected _regionTileOrigin(viewer: any): string {
        try {
            const src = viewer?.world?.getItemAt?.(0)?.source;
            const url = src?.getTileUrl?.(src.maxLevel || 0, 0, 0);
            if (typeof url === "string" && url) return new URL(url, location.href).origin;
        } catch (_) { /* fall through to app-origin fallback */ }
        try {
            return new URL((APPLICATION_CONTEXT as any).url).origin;
        } catch (_) {
            return "*";
        }
    }

    /**
     * Normalize what `drawer.extract({mode: "second-pass"})` returned.
     *
     * The renderer waits for the tiles it schedules and reports `{data, fullyLoaded, stalled}` for
     * that call — completeness is per-call and race-free, scoped to the images the pass was told to
     * wait on (`waitImages`), and `stalled` distinguishes "ran out of budget" from "gave up because
     * no further tile could arrive". A 404'd tile is excluded from OSD's completeness computation
     * entirely, so `fullyLoaded` alone can be true over holes: only `fullyLoaded && !stalled` is a
     * fully trustworthy read.
     *
     * `waitImages` scopes both branches, but over different sets: the off-screen pass narrows over
     * the mirrors it drives, while the steal-live-state branch (`view: viewer.drawer`) narrows over
     * LIVE world items, since that is whose completeness its pixels have. A caller that hands the
     * wrong set gets a warning and a fall back to "all of them", never a wrong answer.
     */
    protected unwrapExtract(
        out: any,
        failMessage: string
    ): { canvas: HTMLCanvasElement; isComplete: boolean; stalled: boolean } {
        const enveloped = out && typeof out === "object" && "fullyLoaded" in out;
        const canvas = enveloped ? out.data : out;
        if (!canvas) throw new Error(failMessage);
        // No envelope means a renderer predating the wait entirely: completeness is unknown, and
        // unknown must degrade closed (AGENTS.md §7) rather than read as "yes".
        if (!enveloped) return { canvas, isComplete: false, stalled: false };
        return { canvas, isComplete: out.fullyLoaded !== false, stalled: out.stalled === true };
    }

    /**
     * Detached mirror TiledImages, index-aligned with `viewer.world` (live shader configs
     * reference world-item indices), sharing the live sources / tile cache / image loader so
     * already-loaded tiles are reused and new tiles land in the ordinary cache. Detached images
     * never disturb the live viewport — the standalone drawer rebinds them to its own viewport
     * for the duration of a pass (see flex-renderer makeStandaloneFlexDrawer).
     */
    protected async getRegionMirrorImages(viewer: any, drawer: any): Promise<any[]> {
        const world = viewer.world;
        const count = world?.getItemCount?.() ?? 0;
        if (!count) {
            throw new Error("No tiled images are available in the active viewer.");
        }
        const liveItems: any[] = [...Array(count).keys()].map(i => world.getItemAt(i));
        const key = liveItems
            .map(ti => ti?.source?.tileSourceId || ti?.source?.url || "unknown")
            .join("|");

        const cached = viewer.__scriptRegionMirrorImages;
        if (cached && cached.key === key) {
            return cached.images;
        }
        if (cached) {
            for (const ti of cached.images) {
                try { ti.destroy(); } catch (e) { /* already destroyed */ }
            }
            viewer.__scriptRegionMirrorImages = null;
        }

        // Settle every instantiation so a late failure does not orphan the mirrors that
        // already succeeded — Promise.all would reject and leak those detached TiledImages
        // (handlers + tile-cache refs) since they are neither stored nor destroyed.
        const settled = await Promise.allSettled(liveItems.map(liveItem => new Promise<any>((resolve, reject) => {
            const bounds = typeof liveItem.getBoundsNoRotate === "function"
                ? liveItem.getBoundsNoRotate(true)
                : liveItem.getBounds(true);
            viewer.instantiateTiledImageClass({
                tileSource: liveItem.source,
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                success: (e: any) => {
                    const ti = e.item;
                    ti.getDrawer = () => drawer;
                    ti.__synthetic = true;
                    resolve(ti);
                },
                error: (e: any) => reject(e?.message ? new Error(e.message) : e),
            });
        })));
        const created = settled
            .filter(s => s.status === "fulfilled")
            .map(s => (s as PromiseFulfilledResult<any>).value);
        const failed = settled.find(s => s.status === "rejected") as PromiseRejectedResult | undefined;
        if (failed) {
            for (const ti of created) {
                try { ti.destroy(); } catch (e) { /* already destroyed */ }
            }
            throw failed.reason;
        }
        const images = created;

        viewer.__scriptRegionMirrorImages = { key, images };
        if (!viewer.__scriptRegionMirrorCloseHook) {
            viewer.__scriptRegionMirrorCloseHook = true;
            viewer.addHandler("close", () => {
                const current = viewer.__scriptRegionMirrorImages;
                if (current) {
                    for (const ti of current.images) {
                        try { ti.destroy(); } catch (e) { /* already destroyed */ }
                    }
                }
                viewer.__scriptRegionMirrorImages = null;
            });
        }
        return images;
    }

    /**
     * Render an ARBITRARY image region OFF-SCREEN through the flex-renderer pipeline without
     * touching the live viewport. `region` is given in full-resolution (level-0) image pixels
     * of the reference world item. The output size preserves the region's aspect ratio: the
     * requested `size` acts as a bounding box and the lesser dimension is derived when only
     * one is provided.
     *
     * Excluded from the result: fabric/annotation overlays and DOM overlays — they are not part
     * of the flex pipeline. Use viewer screenshot APIs for the on-screen composite.
     */
    protected async extractRegionCanvas(
        options: VisualizationRegionRenderOptions
    ): Promise<{ canvas: HTMLCanvasElement; isComplete: boolean; stalled: boolean }> {
        const viewer: any = this.activeViewer;
        const region = options?.region;
        if (!region || !(Number(region.width) > 0) || !(Number(region.height) > 0)) {
            throw new Error("renderRegion requires a region with positive width and height (level-0 image pixels).");
        }

        const layers = options.layers === "background" ? "background" : "active";
        let configuration: Record<string, any>;
        // Whether the pass ends up producing background pixels only — which is what decides the
        // scope of its completeness, and is NOT always the mode the caller asked for (see below).
        let rendersBackgroundOnly = layers === "background";
        if (layers === "background") {
            configuration = this.harvestBackgroundConfiguration(viewer);
        } else {
            // Prefer the live visible stack, but degrade to the raw background (slide) when no
            // shader layer is currently visible/renderable — a region question the raw slide can
            // still answer must not hard-fail just because overlays are hidden/errored.
            configuration = this.harvestActiveConfiguration(viewer, { allowEmpty: true });
            if (!Object.keys(configuration).length) {
                configuration = this.harvestBackgroundConfiguration(viewer);
                // Degraded to the raw slide, so this pass produces background pixels no matter what
                // was asked for — and its completeness must be judged as such. Reading the REQUESTED
                // mode here would wait on the very overlays whose absence caused the degrade.
                rendersBackgroundOnly = true;
            }
        }

        const announcedRefIndex = Number.isInteger(options.refIndex) ? Number(options.refIndex) : 0;
        return this.runSerializedRegionTask(viewer, async () => {
            const drawer = this.getCurrentStandaloneDrawer();
            const mirrors = await this.getRegionMirrorImages(viewer, drawer);

            const refIndex = announcedRefIndex;
            const ref = mirrors[refIndex];
            if (!ref) {
                throw new Error(`Reference tiled image index ${refIndex} is out of range (0..${mirrors.length - 1}).`);
            }

            // The images whose pixels this pass actually produces — what completeness MEANS here.
            const waitSet = rendersBackgroundOnly ? [ref] : mirrors;

            const osd: any = OpenSeadragon as any;
            const bounds = ref.imageToViewportRectangle(
                new osd.Rect(Number(region.x) || 0, Number(region.y) || 0, Number(region.width), Number(region.height))
            );

            // Fit the region's aspect ratio into the requested size box — the standalone
            // viewport letterboxes mismatched aspect ratios with out-of-region content.
            const aspect = Number(region.width) / Number(region.height);
            let outWidth = Number(options.size?.width);
            let outHeight = Number(options.size?.height);
            if (!(outWidth > 0) && !(outHeight > 0)) {
                throw new Error("renderRegion requires size.width and/or size.height.");
            }
            if (!(outHeight > 0)) outHeight = outWidth / aspect;
            else if (!(outWidth > 0)) outWidth = outHeight * aspect;
            else if (outWidth / outHeight > aspect) outWidth = outHeight * aspect;
            else outHeight = outWidth / aspect;
            outWidth = Math.max(1, Math.round(outWidth));
            outHeight = Math.max(1, Math.round(outHeight));

            const maxPixels = Number.isFinite(options.maxPixels as number)
                ? Number(options.maxPixels)
                : XOpatVisualizationScriptApi.REGION_DEFAULT_MAX_PIXELS;
            if (outWidth * outHeight > maxPixels) {
                throw new Error("Requested region render is too large. Reduce the output size or raise maxPixels.");
            }

            // STOP-GAP (AGENTS.md §1: renderer internals belong in the library). The standalone
            // DRAWER does not clear its target between passes — the standalone RENDERER facade does
            // — so transparent areas keep the previous pass's pixels and a region render can show
            // fragments of an unrelated earlier one. Recorded in UPSTREAM.md; delete this block once
            // the drawer clears for itself. Note this is not equivalent to the library's own clear:
            // it does not set `clearColor`, so it clears to whatever was last bound rather than to
            // the presentation backdrop. Fixing that here would deepen the reach into renderer
            // internals, which is why it is left to the library.
            const gl = drawer.renderer?.gl;
            if (gl) gl.clear(gl.COLOR_BUFFER_BIT);

            // The pass waits for the tiles it schedules and reports per-call completeness for the
            // images named in `waitImages` — an off-screen extract has no next frame to refine in,
            // so "what was resident when it ran" would otherwise be the whole result with nothing
            // saying so. See the renderer's own docs on `_collectReadyTiles` / `extract`.
            const out = await drawer.extract({
                mode: "second-pass",
                tiledImages: mirrors,
                configuration,
                view: {
                    bounds,
                    center: new osd.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                    rotation: 0,
                    zoom: 1.0 / bounds.width,
                },
                size: { x: outWidth, y: outHeight },
                result: "canvas",
                waitFullLoad: true,
                loadTimeoutMs: Number.isFinite(options.timeoutMs as number) ? Number(options.timeoutMs) : 10000,
                // Every mirror is DRAWN, but a background pass is only as complete as the REFERENCE
                // image: waiting on an overlay this pass never renders — one that is hidden, or
                // whose source is faulty — would hold the pass to its full budget and then brand
                // the result incomplete forever. Ignored by bundles predating round 2; `waitSet`
                // below corrects for those.
                waitImages: waitSet,
            });
            return this.unwrapExtract(out, "Failed to render the requested region.");
        }, {
            kind: "region",
            refIndex: announcedRefIndex,
            region: {
                x: Number(region.x) || 0,
                y: Number(region.y) || 0,
                width: Number(region.width),
                height: Number(region.height)
            },
            label: options.label
        }, {
            ...(Number.isFinite(options.queueTimeoutMs as number)
                ? { queueTimeoutMs: Number(options.queueTimeoutMs) } : {}),
        });
    }

    /**
     * Renders an arbitrary image region off-screen through the ACTIVE visualization (or the raw
     * background) and returns a PNG data URL. Never moves the user's viewport.
     *
     * A data URL cannot carry completeness, and a partially-tiled render looks exactly like a real
     * one — which is how blank slide areas reached a vision model as if they were tissue. So this
     * REFUSES an incomplete render by default (`onIncomplete: "throw"`). Pass `"allow"` only when
     * the caller has some other way to tell the consumer the image is provisional, or use
     * {@link renderRegionPngDetailed}, which hands you the flag instead of deciding for you.
     */
    async renderRegionPng(options: VisualizationRegionRenderOptions): Promise<string> {
        const { dataUrl, isComplete } = await this.renderRegionPngDetailed(options);
        if (!isComplete && (options?.onIncomplete ?? "throw") === "throw") {
            throw new Error(
                "The region render is incomplete — some tiles had not loaded. Retry with a larger " +
                "timeoutMs or a smaller region, use renderRegionPixels/renderRegionPngDetailed to " +
                "read the isComplete flag, or pass onIncomplete: 'allow' to accept partial pixels."
            );
        }
        return dataUrl;
    }

    /**
     * {@link renderRegionPng} plus the completeness of the pass that produced it.
     *
     * `stalled` is only meaningful on a flex-renderer that waits: it says the wait gave up because
     * no further tile could arrive (e.g. the remaining tiles 404) rather than because it ran out of
     * time. `isComplete && !stalled` is the only combination that should be treated as a faithful
     * read of the region.
     */
    async renderRegionPngDetailed(
        options: VisualizationRegionRenderOptions
    ): Promise<{ dataUrl: string; isComplete: boolean; stalled: boolean }> {
        const { canvas, isComplete, stalled } = await this.extractRegionCanvas(options);
        if (typeof canvas.toDataURL !== "function") {
            throw new Error("The extracted region canvas does not support toDataURL().");
        }
        return { dataUrl: canvas.toDataURL("image/png"), isComplete, stalled };
    }

    /**
     * Renders an arbitrary image region off-screen and returns raw RGBA pixels plus an
     * `isComplete` flag (false when the tile-load wait timed out and the render proceeded
     * with partially loaded data). Never moves the user's viewport.
     */
    async renderRegionPixels(options: VisualizationRegionRenderOptions): Promise<VisualizationRegionPixelsResult> {
        const { canvas, isComplete, stalled } = await this.extractRegionCanvas(options);
        // Guard readback with the SAME default as the region render, so a region the render
        // allowed never throws on readback (readCanvasPixels otherwise defaults to 1024*1024).
        const readbackOptions: VisualizationViewportRenderOptions = {
            ...(options as VisualizationViewportRenderOptions),
            maxPixels: Number.isFinite(options.maxPixels as number)
                ? Number(options.maxPixels)
                : XOpatVisualizationScriptApi.REGION_DEFAULT_MAX_PIXELS
        };
        const pixels = this.readCanvasPixels(
            canvas,
            readbackOptions,
            "Failed to create a 2D context for region extraction."
        );
        return { ...pixels, isComplete, stalled };
    }

    /**
     * Describes every data source the session knows about, so a caller choosing HOW to render
     * something can look at WHAT it is first.
     *
     * This exists because the alternative was guessing: the schema says which shader types are
     * valid but nothing about the data they would render, so "make this visualization better"
     * had no input other than asking the user what the slide contains — a question about the
     * specimen that has no bearing on how a scalar overlay should be mapped to colour.
     *
     * Identity is keyed by `tileSourceId`, never by URL: DICOMweb shares one `baseUrl` across
     * slides, so URL keys collide silently.
     */
    describeData(): VisualizationDataSourceInfo[] {
        const viewer: any = this.activeViewer;
        const config: any = APPLICATION_CONTEXT.config || {};
        const data: any[] = Array.isArray(config.data) ? config.data : [];
        const backgrounds: any[] = Array.isArray(config.background) ? config.background : [];
        const visualizations: any[] = Array.isArray(config.visualizations) ? config.visualizations : [];

        const worldIndexOf = viewer ? this.getResolvedDataReferenceMap(viewer) : new Map<number, number>();

        // dataReference -> the layers that render it, across every persisted visualization.
        const referencedBy = new Map<number, VisualizationDataSourceInfo["referencedBy"]>();
        visualizations.forEach((visualization: any, vizIndex: number) => {
            this.forEachShaderLayer(visualization?.shaders || {}, (layer: any, layerId: string) => {
                for (const ref of sanitizeArrayOfIntegers(layer?.dataReferences)) {
                    const list = referencedBy.get(ref) || [];
                    list.push({
                        visualizationIndex: vizIndex,
                        layerId: String(layer?.id || layerId),
                        type: layer?.type ?? null,
                    });
                    referencedBy.set(ref, list);
                }
            });
        });

        const backgroundRefs = new Set<number>();
        for (const background of backgrounds) {
            if (Number.isInteger(background?.dataReference)) backgroundRefs.add(background.dataReference);
        }

        return data.map((entry: any, index: number): VisualizationDataSourceInfo => {
            const worldIndex = worldIndexOf.has(index) ? worldIndexOf.get(index)! : null;
            const item: any = worldIndex != null && viewer?.world?.getItemAt
                ? viewer.world.getItemAt(worldIndex)
                : null;
            const source: any = item?.source;

            let metadata: any = null;
            try {
                metadata = source?.getMetadata?.() ?? null;
            } catch (e) {
                // A source that cannot describe itself is still worth listing.
            }

            const contentSize = item?.getContentSize?.();
            const layers = referencedBy.get(index) || [];

            return {
                dataReference: index,
                // `config.data` entries are opaque ids/paths chosen by the deployment.
                dataId: typeof entry === "string" ? entry : (entry?.id ?? null),
                tileSourceId: source?.tileSourceId ?? null,
                role: backgroundRefs.has(index)
                    ? "background"
                    : (layers.length ? "overlay" : "unbound"),
                loaded: worldIndex != null,
                worldIndex,
                width: contentSize?.x ?? null,
                height: contentSize?.y ?? null,
                metadata: cloneJson(metadata),
                referencedBy: layers,
            };
        });
    }

    /**
     * Measures what a data source actually CONTAINS, by rendering it off-screen through a
     * plain `identity` layer at the current view and reading the pixels back.
     *
     * The point is threshold and palette choice: breaks placed without knowing the value
     * distribution are decoration, and a source whose values sit in the bottom eighth of the
     * range renders as an almost-empty overlay no matter which palette is picked. Reuses the
     * existing standalone-render path — no new rendering machinery, and the user's viewport
     * never moves.
     *
     * `channels` are reported in RGBA order. `looksScalar` is true when R, G and B agree
     * everywhere sampled, i.e. the source carries one value per pixel rather than colour.
     */
    async probeData(
        dataReference: number,
        options: VisualizationDataProbeOptions = {}
    ): Promise<VisualizationDataProbe> {
        if (!Number.isInteger(dataReference) || dataReference < 0) {
            throw new Error("probeData requires a non-negative integer dataReference (an index into config.data).");
        }

        const bins = Number.isInteger(options.bins) && (options.bins as number) > 1
            ? Math.min(64, options.bins as number)
            : 16;
        // Small on purpose: this is a distribution question, and a downsampled read answers it
        // for a fraction of the readback cost.
        const maxPixels = Number.isFinite(options.maxPixels as number)
            ? Number(options.maxPixels)
            : 256 * 256;

        // `maxPixels` only GUARDS the readback — the render is viewport-sized unless an explicit
        // output width/height is given, so ask for a downscaled canvas that fits the budget at
        // the viewport's aspect ratio. Without this every probe on a normal window would trip
        // the readback guard instead of returning statistics.
        const viewer: any = this.activeViewer;
        const sourceWidth = Math.max(1, viewer?.drawer?.canvas?.width || viewer?.container?.clientWidth || 1024);
        const sourceHeight = Math.max(1, viewer?.drawer?.canvas?.height || viewer?.container?.clientHeight || 1024);
        const scale = Math.min(1, Math.sqrt(maxPixels / (sourceWidth * sourceHeight)));
        const outWidth = Math.max(1, Math.floor(sourceWidth * scale));
        const outHeight = Math.max(1, Math.floor(sourceHeight * scale));

        const probe = await this.renderCurrentViewportPixels(
            {
                shaders: {
                    __probe: { id: "__probe", type: "identity", dataReferences: [dataReference], params: {} },
                },
            } as unknown as VisualizationLayerSource,
            { width: outWidth, height: outHeight, maxPixels, pixelFormat: "typed" }
        );

        const pixels: any = probe.data;
        const total = probe.width * probe.height;
        const channels = [0, 1, 2, 3].map(() => ({
            min: 255,
            max: 0,
            sum: 0,
            histogram: new Array(bins).fill(0),
        }));

        let opaque = 0;
        let scalar = true;
        for (let i = 0; i < pixels.length; i += 4) {
            const alpha = pixels[i + 3];
            // Fully transparent pixels are "no data here", not a zero value — counting them
            // would drag every range toward 0 and make the whole probe describe the padding.
            if (alpha === 0) continue;
            opaque++;
            if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2]) scalar = false;
            for (let c = 0; c < 4; c++) {
                const value = pixels[i + c];
                const channel = channels[c]!;
                if (value < channel.min) channel.min = value;
                if (value > channel.max) channel.max = value;
                channel.sum += value;
                channel.histogram[Math.min(bins - 1, Math.floor((value / 256) * bins))]++;
            }
        }

        if (!opaque) {
            return {
                dataReference,
                sampledPixels: total,
                opaquePixels: 0,
                empty: true,
                note: "Nothing from this source is visible in the current view — pan/zoom to where it has data, or check that the source is loaded.",
            };
        }

        const channelNames = ["r", "g", "b", "a"] as const;
        const described = channels.map((channel, index) => ({
            channel: channelNames[index]!,
            min: channel.min,
            max: channel.max,
            mean: Math.round((channel.sum / opaque) * 100) / 100,
            histogram: channel.histogram as number[],
        }));

        // What a threshold-bearing shader actually needs: the occupied slice of 0..1, so
        // breaks land inside the data instead of across empty range.
        const value = described[0]!;
        return {
            dataReference,
            sampledPixels: total,
            opaquePixels: opaque,
            empty: false,
            looksScalar: scalar,
            channels: described,
            suggestedRange: { low: Math.round((value.min / 255) * 1000) / 1000, high: Math.round((value.max / 255) * 1000) / 1000 },
        };
    }

    /**
     * Renders what the user currently sees and asks a vision model to say what is wrong with
     * it, returning that critique as text.
     *
     * The last resort before asking the user: metadata answers "what is this data", but an
     * aesthetic complaint ("the visualization is not nice") is about the composite on screen,
     * which no amount of config inspection reproduces. Routed through the chat module's
     * stateless `runVisionInference` RPC — the same egress the pathology analysis path uses,
     * with the same provider and consent posture. Returns null when no vision-capable provider
     * is configured, so callers degrade to asking rather than failing.
     */
    async critiqueCurrentRendering(
        question?: string,
        options: VisualizationViewportRenderOptions = {}
    ): Promise<string | null> {
        const chat = (globalThis as any).singletonModule?.("vercel-ai-chat-sdk");
        const model = chat?.getAssistantTextModel?.();
        const rpc = (globalThis as any).xserver?.module?.["vercel-ai-chat-sdk"];
        if (!model?.providerId || !rpc?.runVisionInference) return null;

        // Detailed, not renderRegionPng: a critique of a half-loaded view is worth having (the
        // shader settings it judges are visible in whatever DID render), but the model must be told
        // the blanks are missing tiles, not a rendering fault it should explain.
        const { dataUrl, isComplete } = await this.renderRegionPngDetailed({
            ...(options as any),
            region: this.currentViewportImageRegion(),
            layers: "active",
            size: { width: 1024 },
        } as VisualizationRegionRenderOptions);

        const base64 = String(dataUrl).split(",", 2)[1];
        if (!base64) return null;

        const basePrompt = question
            ? $.t("scripting.visualization.critiqueQuestion", { question: String(question).slice(0, 500) })
            : $.t("scripting.visualization.critiquePrompt");

        try {
            const result = await rpc.runVisionInference({
                providerId: model.providerId,
                model: model.modelId || null,
                system: $.t("scripting.visualization.critiqueSystem"),
                prompt: isComplete
                    ? basePrompt
                    : `${$.t("scripting.visualization.critiqueIncomplete")}\n\n${basePrompt}`,
                imageBase64: base64,
                mediaType: "image/png",
                maxOutputTokens: 512,
            }, { priority: "background" });
            const text = typeof result?.text === "string" ? result.text.trim() : "";
            return text || null;
        } catch (e) {
            // Degrade to "ask the user" rather than turning an optional second opinion into
            // a failed script.
            return null;
        }
    }

    /**
     * The current viewport expressed in level-0 image pixels of the reference item — the
     * coordinate space `renderRegion*` expects.
     */
    protected currentViewportImageRegion(): { x: number; y: number; width: number; height: number } {
        const viewer: any = this.activeViewer;
        const item: any = viewer?.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null;
        if (!item) throw new Error("The active viewer has no image to capture.");

        const bounds = viewer.viewport.getBounds(true);
        const topLeft = item.viewportToImageCoordinates(bounds.getTopLeft());
        const bottomRight = item.viewportToImageCoordinates(bounds.getBottomRight());
        const size = item.getContentSize();

        // The viewport routinely extends past the slide; clamp so the render is of the image,
        // not of the surrounding background.
        const x = Math.max(0, Math.min(topLeft.x, bottomRight.x));
        const y = Math.max(0, Math.min(topLeft.y, bottomRight.y));
        const right = Math.min(size.x, Math.max(topLeft.x, bottomRight.x));
        const bottom = Math.min(size.y, Math.max(topLeft.y, bottomRight.y));
        if (!(right > x) || !(bottom > y)) {
            throw new Error("The current view does not overlap the image.");
        }
        return { x, y, width: right - x, height: bottom - y };
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
