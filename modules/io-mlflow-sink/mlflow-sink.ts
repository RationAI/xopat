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

import { makeMlflowSink, type MlflowSinkConfig } from "./mlflow-sink-factory";
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
const TRUSTED_ONLY_KEYS = ["proxy", "baseURL", "auth", "experimentAllow"] as const;

class IOMlflowSink extends XOpatModuleSingleton {
    /** Runtime-registered mappers. Take precedence over built-in templates. */
    private _mappers = new Map<string, MlflowMapper>();
    /** Session-scoped template choice (scripting). Never overrides trusted keys. */
    private _templateOverride?: string;
    /** Returned by registerSink; held for hot-reload / tests. */
    private _disposeSink?: () => void;

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

        const sink = makeMlflowSink({
            id: "mlflow",
            label: "MLflow",
            getOptions: () => this._composeOptions(pipeline),
            getMapper: (name) => this._mappers.get(name) ?? BUILT_IN_TEMPLATES[name],
        });
        this._disposeSink = pipeline.registerSink(sink);
    }

    /**
     * Compose the sink's runtime options. Layered, latest wins:
     *   1. Hardcoded JS defaults (always present, safety net).
     *   2. include.json `mlflow` block (deployment-tunable defaults).
     *   3. `ENV.client.io.sinkOverrides.mlflow` (admin per-deployment values).
     *
     * A session-scoped template choice is applied last, but only for `template` —
     * never for a key that selects an endpoint or relaxes auth.
     */
    private _composeOptions(pipeline: any): MlflowSinkConfig {
        const fromInclude = stripDocs((this.getStaticMeta("mlflow") ?? {}) as Record<string, unknown>);
        const fromAdmin = stripDocs((pipeline.sinkOverrides?.("mlflow") ?? {}) as Record<string, unknown>);
        const composed = { ...HARDCODED_DEFAULTS, ...fromInclude, ...fromAdmin } as MlflowSinkConfig;
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
