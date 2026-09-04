/**
 * Adapter over FlexRenderer's published validation API.
 *
 * Validation is the renderer's job, not xOpat's. The renderer publishes exactly two
 * host-facing entry points and this module calls only those:
 *
 *   - `ShaderConfigurator.compileConfigSchemaModel()` — the JSON Schema 2020-12 document
 *     describing every valid layer and control envelope. The host compiles it with its
 *     own AJV and validates a config against it.
 *   - `ShaderConfigurator.getShaderCouplingValidators(type)` — the per-shader invariants
 *     that a schema cannot express (e.g. "colormap steps === breaks + 1"). The host
 *     *invokes* them; the rules live in the library.
 *
 * Nothing here knows a shader name, a control name, a palette or a fatality rule. There
 * is no probing of the shader registry, no inspection of renderer internals, and no
 * host-side judgement about which findings matter — the verdict is reported verbatim to
 * whoever asked. If the renderer or AJV is unavailable, validation reports `skipped`;
 * callers must treat that as "unknown", never as "valid".
 *
 * Why it exists: until now this logic lived inside
 * `src/classes/scripting/visualization-api.ts`, so only the scripting/LLM path was
 * gated. A visualization arriving from a session, a URL hash or a hand-written config
 * reached `overrideConfigureAll` unvalidated and its mistakes surfaced far downstream.
 * One boundary, two consumers: the scripting API wraps this in throwing methods, the
 * open pipeline collects and reports.
 *
 * This module never mutates the config it is given and never drops a layer. Deciding
 * what to do with a finding belongs to the caller.
 */

/** One validation finding. `path` is human-facing; `shaderId` is the top-level map key. */
export interface VisualizationIssue {
    kind: "schema" | "coupling";
    /** Index into the `visualizations` array passed to {@link validateVisualizations}. */
    vizIndex: number;
    /** Top-level shader map key this issue belongs to, when it could be determined. */
    shaderId?: string;
    /** Human-readable location, e.g. `viz[0]/shaders/mask/params/color`. */
    path: string;
    message: string;
    /** Coupling findings only — echoed from the renderer's validator payload. */
    coupling?: string;
    layerType?: string;
    controls?: string[];
    expected?: any;
    actual?: any;
}

export interface VisualizationValidationReport {
    /** No issues found. Check {@link skipped} before reading this as "valid". */
    ok: boolean;
    /** Validation could not run (no renderer, no AJV, or the schema failed to compile). */
    skipped: boolean;
    issues: VisualizationIssue[];
    /** Raw AJV errors per visualization index, for structured consumers. */
    ajvErrors: Record<number, any[]>;
}

/* ------------------------------------------------------------------ *
 * Renderer access
 * ------------------------------------------------------------------ */

/** The FlexRenderer configurator. Throws when the renderer is not loaded. */
export function getShaderConfigurator(): any {
    const fr: any = (globalThis as any).OpenSeadragon?.FlexRenderer;
    if (!fr) {
        throw new Error("FlexRenderer is not available.");
    }
    if (!fr.ShaderConfigurator) {
        throw new Error("FlexRenderer.ShaderConfigurator is not available.");
    }
    return fr.ShaderConfigurator;
}

/** Non-throwing variant for paths that must degrade instead of failing. */
function tryGetShaderConfigurator(): any | undefined {
    try {
        return getShaderConfigurator();
    } catch (e) {
        return undefined;
    }
}

/* ------------------------------------------------------------------ *
 * Schema compile / AJV, memoized for the session
 * ------------------------------------------------------------------ */

let _ajvValidator: (((value: any) => boolean) & { errors?: any[] }) | undefined;
let _ajvDisabled = false;
let _publishedSchemaCache: Record<string, any> | undefined;

/** Drop the memoized schema + validator. Call after registering shaders at runtime. */
export function invalidateVisualizationSchemaCache(): void {
    _ajvValidator = undefined;
    _ajvDisabled = false;
    _publishedSchemaCache = undefined;
}

/**
 * The renderer-published JSON Schema, with a last-known-good cache.
 *
 * `compileConfigSchemaModel` validates the library's OWN bundled examples against the
 * schema it just generated and throws the whole document away when they disagree — the
 * schema is fine, the examples are decorative. Recorded in UPSTREAM.md; until the
 * library warns instead of throwing, fall back to the previous good document. Rethrows
 * when there is no cache to fall back to.
 */
export function compileVisualizationConfigSchema(): Record<string, any> {
    try {
        const schema = getShaderConfigurator().compileConfigSchemaModel();
        _publishedSchemaCache = schema;
        return schema;
    } catch (err) {
        if (_publishedSchemaCache) return _publishedSchemaCache;
        throw err;
    }
}

/**
 * Lazily compiled AJV validator for the published schema, or `undefined` when
 * validation is unavailable. Callers must treat `undefined` as "skip; downstream
 * gates run" — never as "valid".
 */
export function getVisualizationSchemaValidator(): (((value: any) => boolean) & { errors?: any[] }) | undefined {
    if (_ajvValidator) return _ajvValidator;
    if (_ajvDisabled) return undefined;

    // The bundled UMD at src/libs/ajv7.min.js sets `window.ajv7` to the module exports
    // object, not the constructor — unwrap `.default` when the candidate is an object.
    const g = globalThis as any;
    let AjvCtor: any;
    for (const name of ["Ajv2020", "ajv2020", "Ajv", "ajv", "ajv7"]) {
        const cand = g[name];
        if (typeof cand === "function") { AjvCtor = cand; break; }
        if (cand && typeof cand.default === "function") { AjvCtor = cand.default; break; }
    }
    if (typeof AjvCtor !== "function") {
        _ajvDisabled = true;
        warnOnce(
            "AJV is not available on globalThis (looked for Ajv2020 / ajv2020 / Ajv / ajv / ajv7). " +
            "Visualization schema validation is disabled for this session."
        );
        return undefined;
    }

    // Options chosen for the recursive `group` schema:
    //   strict:false        - the renderer publishes x-* keywords AJV does not recognize
    //   allErrors:true      - one pass surfaces every problem at once
    //   inlineRefs:false    - never inline $refs; keeps group→group from blowing the
    //                         call stack at compile time
    //   validateSchema:false- the renderer is the source of truth
    try {
        const fullSchema = compileVisualizationConfigSchema();
        const ajv = new AjvCtor({ strict: false, allErrors: true, inlineRefs: false, validateSchema: false });
        _ajvValidator = ajv.compile(fullSchema) as any;
        return _ajvValidator!;
    } catch (err) {
        _ajvDisabled = true;
        warnOnce(
            "AJV failed to compile the renderer schema (" + String((err as any)?.message || err) +
            "). Visualization schema validation is disabled for the rest of this session."
        );
        return undefined;
    }
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Validate visualizations against the renderer-published schema and the shaders' own
 * coupling rules. Never throws on a finding, never mutates the input.
 *
 * Each entry may be a full `{name, shaders, order?}` visualization or anything carrying
 * a `shaders` map; entries without one are skipped.
 */
export function validateVisualizations(visualizations: any[]): VisualizationValidationReport {
    const issues: VisualizationIssue[] = [];
    const ajvErrors: Record<number, any[]> = {};

    if (!Array.isArray(visualizations) || !visualizations.length) {
        return { ok: true, skipped: false, issues, ajvErrors };
    }

    const validate = getVisualizationSchemaValidator();
    let skipped = !validate;

    for (let i = 0; i < visualizations.length; i++) {
        const viz: any = visualizations[i];
        if (!isPlainObject(viz) || !isPlainObject(viz.shaders)) continue;

        if (validate) {
            // The schema root expects `{shaders, order?}` — wrap so AJV sees one config.
            const envelope = {
                shaders: viz.shaders,
                ...(Array.isArray(viz.order) ? { order: viz.order } : {}),
            };

            let ok: boolean;
            try {
                ok = validate(envelope);
            } catch (err) {
                // AJV runtime explosion (stack overflow on a deep group graph). Disable
                // for the session; findings already collected stay valid.
                _ajvDisabled = true;
                _ajvValidator = undefined;
                skipped = true;
                warnOnce(
                    "AJV threw during validate (" + String((err as any)?.message || err) +
                    "). Visualization schema validation disabled for the rest of this session."
                );
                break;
            }

            if (!ok) {
                const raw = (validate as any).errors as any[] | undefined;
                if (raw) ajvErrors[i] = raw;
                for (const e of filterOneOfErrorsByDiscriminator(raw, viz)) {
                    const instancePath: string = typeof e?.instancePath === "string" ? e.instancePath : "";
                    issues.push({
                        kind: "schema",
                        vizIndex: i,
                        shaderId: shaderIdFromInstancePath(instancePath),
                        path: `viz[${i}]${instancePath}`,
                        message: `${e?.message ?? "invalid"}${e?.params ? " " + safeJson(e.params) : ""}`,
                    });
                }
            }
        }

        for (const [key, layer] of Object.entries<any>(viz.shaders)) {
            collectCouplingIssues(layer, i, key, key, issues);
        }
    }

    return { ok: issues.length === 0, skipped, issues, ajvErrors };
}

/**
 * Run every coupling rule the shader declares for `layer.type`. The validators come
 * from the renderer; the host invokes them but does not own the rules. Recurses into
 * group children so one call covers a whole layer subtree.
 */
function collectCouplingIssues(
    layer: any,
    vizIndex: number,
    shaderId: string,
    path: string,
    out: VisualizationIssue[],
): void {
    if (!isPlainObject(layer)) return;

    if (isPlainObject(layer.shaders)) {
        for (const [childKey, child] of Object.entries<any>(layer.shaders)) {
            collectCouplingIssues(child, vizIndex, shaderId, path ? `${path}/${childKey}` : childKey, out);
        }
    }

    const layerType = typeof layer.type === "string" ? layer.type : undefined;
    if (!layerType || layerType === "group") return;

    const configurator = tryGetShaderConfigurator();
    if (!configurator || typeof configurator.getShaderCouplingValidators !== "function") return;

    let validators: any[];
    try {
        validators = configurator.getShaderCouplingValidators(layerType);
    } catch (e) {
        // The renderer refuses to describe this type (typically because it is not
        // registered). That verdict is the schema's to report, not ours to infer.
        return;
    }
    if (!Array.isArray(validators) || !validators.length) return;

    for (const entry of validators) {
        if (!entry || typeof entry.validate !== "function") continue;

        let outcome: any;
        try {
            outcome = entry.validate(layer);
        } catch (err: any) {
            out.push({
                kind: "coupling",
                vizIndex,
                shaderId,
                layerType,
                coupling: entry.name,
                path: `viz[${vizIndex}]/shaders/${path}`,
                message: `Coupling validator '${entry.name}' on shader '${layerType}' threw: ${err?.message || err}.`,
            });
            continue;
        }

        if (outcome && outcome.ok === false) {
            const summary = entry.summary ? ` ${entry.summary}` : "";
            const corrective = formatCouplingCorrective(outcome.expected, outcome.actual);
            out.push({
                kind: "coupling",
                vizIndex,
                shaderId,
                layerType,
                coupling: entry.name,
                controls: entry.controls,
                expected: outcome.expected,
                actual: outcome.actual,
                path: `viz[${vizIndex}]/shaders/${path}`,
                message: `Coupling '${entry.name}' on shader '${layerType}' (${path}) was not satisfied.${summary}${corrective ? ` ${corrective}` : ""}`,
            });
        }
    }
}

/* ------------------------------------------------------------------ *
 * Formatting helpers (shared with the scripting API)
 * ------------------------------------------------------------------ */

/**
 * AJV reports `oneOf` failures branch-by-branch: a single typo in a colormap layer
 * produces one identical "must NOT have additional properties …" line per registered
 * shader type. The branch noise buries the actual fix.
 *
 * For each error whose `instancePath` falls inside `/shaders/<id>`, look up the input
 * layer's `type` and drop errors whose `schemaPath` clearly belongs to a *different*
 * shader-type branch. Errors against the root envelope, the shaders map structure, or
 * branches without a recognisable type tag are preserved. Idempotent, side-effect free.
 */
export function filterOneOfErrorsByDiscriminator(errors: any[] | undefined, viz: any): any[] {
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

        const key = `${ip}::${e?.message || ""}::${e?.params ? safeJson(e.params) : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out.length ? out : errors;
}

/**
 * One-line corrective hint for a coupling violation: walks the validator's `expected`
 * payload and emits ``To satisfy: set `x` = 1, `y` = 2.`` so the fix travels with the
 * failure. Generic over coupling shape; per-coupling logic lives in flex-renderer.
 */
export function formatCouplingCorrective(expected: any, _actual?: any): string {
    if (!isPlainObject(expected)) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
        let rendered: string;
        if (value === null || value === undefined) rendered = String(value);
        else if (typeof value === "number" || typeof value === "boolean") rendered = String(value);
        else if (typeof value === "string") rendered = JSON.stringify(value);
        else rendered = safeJson(value);
        parts.push(`\`${key}\` = ${rendered}`);
    }
    if (!parts.length) return "";
    return `To satisfy: set ${parts.join(", ")}.`;
}

/** Render issues as one indented line each — the shape both consumers print. */
export function formatIssueLines(issues: VisualizationIssue[]): string {
    return issues.map(issue => `  ${issue.path}: ${issue.message}`).join("\n");
}

export function isPlainObject(value: any): boolean {
    if (!value || typeof value !== "object") return false;
    return !Array.isArray(value);
}

function shaderIdFromInstancePath(instancePath: string): string | undefined {
    const m = instancePath.match(/^\/shaders\/([^/]+)/);
    return m ? m[1] : undefined;
}

function safeJson(value: any): string {
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

const _warned = new Set<string>();

/**
 * Session-scoped one-shot warning. Validation being unavailable is an operator-facing
 * fact, not a per-config one — repeating it once per visualization would drown the log.
 */
function warnOnce(message: string): void {
    if (_warned.has(message)) return;
    _warned.add(message);
    const log = (globalThis as any).APPLICATION_CONTEXT?.log;
    if (typeof log === "function") {
        try {
            log("app.visualization").warn(message);
            return;
        } catch (e) { /* fall through to console */ }
    }
    console.warn("[visualization-validation] " + message);
}
