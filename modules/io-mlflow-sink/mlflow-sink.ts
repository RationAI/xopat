/// <reference path="../../src/types/globals.d.ts" />

// Module entry: registers the `mlflow` IO sink with the pipeline.
//
// This module owns the sink's defaults. Defaults come from `include.json::mlflow`
// (via `getStaticMeta("mlflow")`) with safe JS literal fallbacks; per-deployment
// values (proxy alias, experiment templates, allowlist, …) come from
// `ENV.client.io.sinkOverrides.mlflow` via `IO_PIPELINE.sinkOverrides("mlflow")`.
// The pipeline never composes options on the module's behalf.
//
// The MLflow credential lives **server-side only**, under
// `server.secure.proxies.<alias>.headers.Authorization`. See README.md.

import { makeMlflowSink, normalizeTarget, type MlflowSinkConfig, type MlflowSessionTarget } from "./mlflow-sink-factory";
import { BUILT_IN_TEMPLATES, TEMPLATE_DESCRIPTIONS, type MlflowMapper } from "./templates";

const HARDCODED_DEFAULTS: MlflowSinkConfig = {
    proxy: "mlflow",
    baseURL: "/api/2.0/mlflow",
    template: "slide-scoring",
    experimentTemplate: "xopat-{ownerId}",
    runTemplate: "xopat-{viewerId}",
    identifierTag: "data_id",
};

/** Config keys a mapper/script may never influence — they pick the destination. */
const TRUSTED_ONLY_KEYS = ["proxy", "baseURL", "auth", "experimentAllow", "sessionTarget"] as const;

/** Module log channel; never `console`, and never the untrusted value itself. */
const log = () => (globalThis as any).APPLICATION_CONTEXT?.log?.("module.io-mlflow-sink");

class IOMlflowSink extends XOpatModuleSingleton {
    /** Runtime-registered mappers. Take precedence over built-in templates. */
    private _mappers = new Map<string, MlflowMapper>();
    /** Session-scoped template choice (scripting). Never overrides trusted keys. */
    private _templateOverride?: string;
    /** Returned by registerSink; held for hot-reload / tests. */
    private _disposeSink?: () => void;
    /** Session-selected destination. Seeded once from `params.mlflowTarget`. */
    private _target?: MlflowSessionTarget;
    private _targetSeeded = false;
    /** The session supplied `params.mlflowTarget` but it failed validation. */
    private _targetRejected = false;
    /** Held so `isTargetHonoured` can compose the deployment-default options. */
    private _pipeline?: any;

    constructor() {
        super();

        // Refusal messages and template descriptions resolve against this
        // module's own bundle; load it before the first dispatch can refuse.
        this.loadLocale();

        const pipeline = (globalThis as any).IO_PIPELINE;
        if (!pipeline?.registerSink) {
            console.warn("[io-mlflow-sink] IO_PIPELINE not available — module is inert.");
            return;
        }
        this._pipeline = pipeline;

        const sink = makeMlflowSink({
            id: "mlflow",
            label: "MLflow",
            getOptions: (ctx?: IOContext) => this._composeOptions(pipeline, ctx),
            getMapper: (name) => this._mappers.get(name) ?? BUILT_IN_TEMPLATES[name],
            getTarget: () => this.getTarget(),
            isTargetRejected: () => this.isTargetRejected(),
        });
        this._disposeSink = pipeline.registerSink(sink);
    }

    /**
     * Compose the sink's runtime options. Layered, latest wins:
     *   1. Hardcoded JS defaults (always present, safety net).
     *   2. include.json `mlflow` block (deployment-tunable defaults).
     *   3. `ENV.client.io.sinkOverrides.mlflow` (admin per-deployment values).
     *   4. The per-binding `config` for THIS (owner, capability), from
     *      `ENV.client.io.bindings` — one mlflow sink can then map each owner
     *      to its own experiment/run/template without a second sink id.
     *      Same trust level as layer 3 (both are server-delivered
     *      `ENV.client.io`), so endpoint keys are legitimate here.
     *
     * The session-scoped template choice is applied AFTER layer 4 on purpose:
     * it is a user selection over a deployment default, and folding it in
     * earlier would let a per-binding `template` silently win over the
     * template the user just picked. It still only touches `template` —
     * never a key that selects an endpoint or relaxes auth.
     */
    private _composeOptions(pipeline: any, ctx?: IOContext): MlflowSinkConfig {
        const fromInclude = stripDocs((this.getStaticMeta("mlflow") ?? {}) as Record<string, unknown>);
        const fromAdmin = stripDocs((pipeline.sinkOverrides?.("mlflow") ?? {}) as Record<string, unknown>);
        const fromBinding = ctx && typeof pipeline.bindingConfig === "function"
            ? stripDocs(pipeline.bindingConfig(ctx.ownerUid, ctx.capabilityId, "mlflow") ?? {})
            : {};
        const composed = {
            ...HARDCODED_DEFAULTS,
            ...fromInclude,
            ...fromAdmin,
            ...fromBinding,
        } as MlflowSinkConfig;
        if (this._templateOverride) composed.template = this._templateOverride;
        return composed;
    }

    // ---- public API (also backing the `mlflowSink` scripting namespace) ----

    /**
     * Register a mapper under `name`. Selecting it still goes through `template`,
     * so a deployment can ship a mapper without it taking effect until bound.
     * Mappers shape structure only — see TRUSTED_ONLY_KEYS.
     */
    registerMapper(name: string, mapper: MlflowMapper): void {
        if (typeof name !== "string" || !name.trim()) {
            throw new Error("registerMapper: a non-empty name is required");
        }
        if (typeof mapper !== "function") {
            throw new Error("registerMapper: mapper must be a function");
        }
        if ((TRUSTED_ONLY_KEYS as readonly string[]).includes(name)) {
            throw new Error(`registerMapper: "${name}" is a reserved config key`);
        }
        this._mappers.set(name, mapper);
    }

    unregisterMapper(name: string): void {
        this._mappers.delete(name);
    }

    /** Names of every selectable mapper — built-in templates plus registered ones. */
    listTemplates(): Array<{ name: string; description: string; builtIn: boolean }> {
        const names = new Set([...Object.keys(BUILT_IN_TEMPLATES), ...this._mappers.keys()]);
        return [...names].map((name) => ({
            name,
            // The bundle is namespaced by module id, so `ns` is required.
            description: TEMPLATE_DESCRIPTIONS[name] ?? $.t("template.custom", { ns: this.id }),
            builtIn: name in BUILT_IN_TEMPLATES,
        }));
    }

    /** The template in effect right now (session override, else configured, else default). */
    getTemplate(): string {
        const pipeline = (globalThis as any).IO_PIPELINE;
        return this._composeOptions(pipeline).template ?? "slide-scoring";
    }

    /** Session-scoped structure choice. Deliberately NOT persisted to config. */
    setTemplate(name: string): void {
        if (!this._mappers.has(name) && !(name in BUILT_IN_TEMPLATES)) {
            throw new Error(`setTemplate: no mapper or template named "${name}"`);
        }
        this._templateOverride = name;
    }

    /** Drop the session override and fall back to the configured template. */
    resetTemplate(): void {
        this._templateOverride = undefined;
    }

    /**
     * The destination this session selected, or `undefined`.
     *
     * First call seeds it from the session's `params.mlflowTarget`
     * (`{"experiment": "...", "run": "..."}`, object or JSON string). Whether the
     * sink honours it is the operator's `sessionTarget` setting, not this getter's.
     */
    getTarget(): MlflowSessionTarget | undefined {
        const app = (globalThis as any).APPLICATION_CONTEXT;
        // Seed once, but not before the session is parsed: seeding earlier would
        // lock in "no target" for the whole session.
        if (!this._targetSeeded && app?.config) {
            this._targetSeeded = true;
            try {
                // Session params reach modules only through the core option
                // resolver (`mlflowTarget` is declared in src/config.json so the
                // parser keeps it). Never read the raw session payload.
                const raw = app.getOption("mlflowTarget");
                if (raw != null) {
                    this._target = normalizeTarget(raw);
                    this._targetRejected = !this._target;
                    // The value may name a case or patient; say THAT it was rejected, not what it was.
                    if (!this._target) log()?.warn("invalid params.mlflowTarget (expected {experiment, run?} with plain names); dispatches will be refused");
                }
            } catch (e) {
                log()?.warn(e, "reading params.mlflowTarget failed");
            }
        }
        return this._target ? { ...this._target } : undefined;
    }

    /**
     * Select the experiment (and optionally the run) for this session. Not
     * persisted. Bounded by `experimentAllow` / `runAllow` at dispatch, and only
     * read at all when the deployment sets `sessionTarget`.
     */
    setTarget(target: MlflowSessionTarget): MlflowSessionTarget {
        const normalized = this.validateTarget(target);
        this._targetSeeded = true;
        this._targetRejected = false;
        this._target = normalized;
        return { ...normalized };
    }

    /**
     * True when the session supplied a target that failed validation. The sink
     * then refuses rather than falling back to the templates: a broken choice is
     * not "no choice". Cleared by `setTarget` / `clearTarget`.
     */
    isTargetRejected(): boolean {
        this.getTarget(); // seeds from params on first call
        return this._targetRejected;
    }

    /**
     * Whether the deployment-default config honours a session target at all
     * (`sessionTarget` enabled AND `experimentAllow` bounded). Per-binding config
     * (`ENV.client.io.bindings`) may still differ for a given owner, so this is
     * advisory — used to warn before asking consent, never as a security gate.
     */
    isTargetHonoured(): boolean {
        if (!this._pipeline) return false;
        const o = this._composeOptions(this._pipeline);
        return (o.sessionTarget === "allowed" || o.sessionTarget === "required")
            && Array.isArray(o.experimentAllow) && o.experimentAllow.length > 0;
    }

    /**
     * Normalize an untrusted target without applying it (throws when invalid), so
     * a caller can show the user exactly what will be set before setting it.
     */
    validateTarget(target: unknown): MlflowSessionTarget {
        const normalized = normalizeTarget(target);
        if (!normalized) {
            throw new Error("setTarget: `experiment` is required and `run` optional; names may use only " +
                "letters, digits, space and . _ - / : plus {placeholders}, at most 250 characters");
        }
        return normalized;
    }

    /** Forget the session target. With `sessionTarget: "required"` the sink then declines. */
    clearTarget(): void {
        this._targetSeeded = true;
        this._targetRejected = false;
        this._target = undefined;
    }
}

/**
 * Strips inline documentation (`_`-prefixed keys) and `null` placeholders, so a
 * verbose include.json can carry both without shadowing upstream layers.
 */
function stripDocs(o: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
        if (k.startsWith("_")) continue;
        const v = o[k];
        if (v === null || v === undefined) continue;
        out[k] = v;
    }
    return out;
}

addModule("io-mlflow-sink", IOMlflowSink, true);

export { IOMlflowSink };
