/// <reference path="../../../src/types/globals.d.ts" />

/**
 * MLflow sink scripting namespace (`mlflowSink`).
 *
 * Exposes the *structure* half of the sink: which template shapes records into
 * MLflow experiments/runs, and the ability to register a custom mapper. It
 * deliberately exposes nothing about transport — a script cannot read or set
 * `proxy`, `baseURL`, `auth` or `experimentAllow`, because those pick the
 * destination and bound what a mapper may reach. They are deployment config
 * (`getStaticMeta` / `ENV.client.io.sinkOverrides`) and stay that way.
 *
 * A mapper registered here is an ordinary function supplied by the script; it
 * is never built from a string, so no `eval`/`Function` is involved. Its return
 * value is still validated by the sink and still checked against the static
 * experiment allowlist before anything is dispatched.
 *
 * Changing how scored data is written to a shared experiment tracker is a
 * consequential, outward-facing change, so both `setTemplate` and
 * `registerMapper` ask the user for permission.
 */

const MODULE_ID = "io-mlflow-sink";

/** Consent text lives in the module's own locale bundle (namespace = module id). */
const t = (key: string, options: Record<string, unknown> = {}): string =>
    $.t(key, { ...options, ns: MODULE_ID });

const MLFLOW_SINK_DTS = `
/** A selectable record→MLflow structure. */
export type TemplateInfo = {
    name: string;
    description: string;
    /** False for mappers registered at runtime. */
    builtIn: boolean;
};

/** What a mapper returns: the MLflow shape for one record. */
export type MlflowMapping = {
    /** Experiment to write into. Refused if outside the deployment's allowlist. */
    experiment: string;
    run: {
        /** Name used only when the run is created. */
        name?: string;
        /** Tag identifying the run to reuse. */
        identifierTag: { key: string; value: string };
        /** Tags applied only when the run is created. */
        extraTags?: Array<{ key: string; value: string }>;
    };
    metrics?: Array<{ key: string; value: number; step?: number; timestamp?: number }>;
    params?: Array<{ key: string; value: string }>;
    tags?: Array<{ key: string; value: string }>;
};

/** The dispatch being mapped. Read-only. */
export type MapperContext = {
    ownerId: string;
    capabilityId: string;
    resourceName?: string;
    itemId?: string;
    viewerId?: string;
    backgroundId?: string;
};

/** Templates a mapper may interpolate. Contains no endpoint or credential. */
export type MapperOptions = {
    experimentTemplate: string;
    runTemplate: string;
    identifierTag: string;
    /**
     * True when the session fixed the run: records the template would spread over
     * many runs share one. Keep them apart in keys/artifact paths (e.g. prefix the
     * slide or viewer id), or they overwrite each other.
     */
    sharedRun?: boolean;
};

/** Return null to decline a record — the sink then skips it cleanly. */
export type Mapper = (ctx: MapperContext, item: unknown, options: MapperOptions) => MlflowMapping | null;

export interface MlflowSinkScriptApi {
    /** Every selectable template, built-in and registered. */
    listTemplates(): TemplateInfo[];

    /** The template currently shaping dispatches. */
    getTemplate(): string;

    /** Longer explanation of one template. Throws if the name is unknown. */
    describeTemplate(name: string): TemplateInfo;

    /**
     * Select the template for this session. Asks the user for permission.
     * Does not persist — the configured template returns on reload.
     */
    setTemplate(name: string): Promise<string>;

    /** Drop a session template choice and fall back to the configured one. */
    resetTemplate(): void;

    /**
     * Register a custom mapper and select it. Asks the user for permission.
     * The mapper shapes structure only; it cannot choose an endpoint, and an
     * experiment outside the deployment allowlist is refused at dispatch.
     */
    registerMapper(name: string, mapper: Mapper): Promise<string>;

    /**
     * The experiment/run this session writes into, as set (placeholders
     * unresolved), or undefined (template-derived).
     */
    getTarget(): { experiment: string; run?: string } | undefined;

    /**
     * Select the experiment (and optionally the run, by name) this session writes
     * into. Asks the user for permission. Does not persist. Only honoured when the
     * deployment allows session targets AND bounds them with an experiment
     * allowlist; still checked against its allowlists.
     *
     * Names may use letters, digits, space and . _ - / : plus placeholders resolved
     * per record: {backgroundId} {viewerId} {ownerId} {capabilityGroup} — e.g.
     * { experiment: "xopat-cohort-A", run: "review-{backgroundId}" } gives one run per slide.
     * A fixed run (no placeholder) collects every slide; built-in structures then
     * prefix keys/artifact paths with the slide or viewer so nothing is overwritten.
     */
    setTarget(target: { experiment: string; run?: string }): Promise<{ experiment: string; run?: string }>;

    /** Forget the session's experiment/run choice. */
    clearTarget(): void;
}
`;

/**
 * Build and register the `mlflowSink` scripting namespace. Called once from
 * index.ts at bundle-eval time; the module is resolved lazily per call.
 */
export function registerMlflowSinkScriptingApi(): void {
    const ScriptingManager = (globalThis as any).ScriptingManager;
    if (!ScriptingManager?.registerExternalApi || !ScriptingManager?.XOpatScriptingApi) {
        console.warn("[io-mlflow-sink] ScriptingManager unavailable; scripting namespace not registered.");
        return;
    }

    const ScriptApiBase = ScriptingManager.XOpatScriptingApi as {
        new (namespace: string, name: string, description: string): any;
    };

    class XOpatMlflowSinkScriptApi extends ScriptApiBase {
        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: MLFLOW_SINK_DTS },
            assistant: {
                intentPatterns: [/mlflow|experiment|metric/i],
            },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "MLflow sink structure",
                "Control how xOpat records are shaped when they land in MLflow. listTemplates() shows the " +
                "available structures: slide-scoring (one run per slide), run-per-viewer (stepped metrics per " +
                "viewer), run-per-session (write-once params) and bundle-artifact (whole bundle as a JSON " +
                "artifact). setTemplate(name) selects one for this session. registerMapper(name, fn) supplies a " +
                "custom structure: fn receives the dispatch context and the record and returns an experiment, a " +
                "run identifier tag, and metrics/params/tags — or null to decline the record. setTarget({experiment, " +
                "run}) picks the experiment and run this session writes into, where the deployment allows it; names may " +
                "carry placeholders such as {backgroundId} for one run per slide. This namespace " +
                "shapes structure ONLY; the MLflow endpoint, proxy, credentials and the allowed experiment names " +
                "are deployment config and cannot be read or changed from a script.",
            );
        }

        // ---- internals (underscore-prefixed members are not exposed to scripts) ----

        _sink(): any {
            const instance = (globalThis as any).singletonModule?.(MODULE_ID);
            if (!instance) {
                throw new Error("The io-mlflow-sink module is not available. Enable it first.");
            }
            return instance;
        }

        _find(name: string): any {
            const hit = this._sink().listTemplates().find((t: any) => t.name === name);
            if (!hit) {
                const known = this._sink().listTemplates().map((t: any) => t.name).join(", ");
                throw new Error(`No template named "${name}". Available: ${known}.`);
            }
            return hit;
        }

        async _consent(title: string, details: string[], cacheKey?: string, allowRemember = true): Promise<void> {
            await this.requireActionConsent({
                title,
                description: t("consent.description"),
                details,
                mode: "warning",
                confirmLabel: t("consent.confirm"),
                rejectedMessage: t("consent.rejected"),
                cacheKey,
                allowRemember,
            });
        }

        // ---- api ----

        listTemplates(): any[] {
            return this._sink().listTemplates();
        }

        getTemplate(): string {
            return this._sink().getTemplate();
        }

        describeTemplate(name: string): any {
            return this._find(name);
        }

        async setTemplate(name: string): Promise<string> {
            const template = this._find(name);
            await this._consent(t("consent.setTemplate.title"), [
                t("consent.setTemplate.structure", { name: template.name, description: template.description }),
                t("consent.setTemplate.scope"),
            ], "mlflow:set-template");
            this._sink().setTemplate(name);
            return name;
        }

        resetTemplate(): void {
            this._sink().resetTemplate();
        }

        async registerMapper(name: string, mapper: unknown): Promise<string> {
            if (typeof mapper !== "function") {
                throw new Error("registerMapper: the second argument must be a function.");
            }
            await this._consent(t("consent.registerMapper.title"), [
                t("consent.registerMapper.detail", { name: String(name) }),
                t("consent.allowlistNote"),
            ], "mlflow:register-mapper");
            const sink = this._sink();
            sink.registerMapper(name, mapper as any);
            sink.setTemplate(name);
            return name;
        }

        getTarget(): any {
            return this._sink().getTarget();
        }

        async setTarget(target: unknown): Promise<any> {
            const sink = this._sink();
            // Validate BEFORE asking: the user should never approve a name the
            // sink then rejects, nor see raw unvalidated input in the dialog.
            const normalized = sink.validateTarget(target);
            await this._consent(t("consent.setTarget.title"), [
                t("consent.setTarget.experiment", { experiment: normalized.experiment }),
                normalized.run
                    ? t("consent.setTarget.run", { run: normalized.run })
                    : t("consent.setTarget.runFromTemplate"),
                t("consent.allowlistNote"),
                // Advisory: a per-binding config may still honour it, so warn, don't refuse.
                ...(sink.isTargetHonoured() ? [] : [t("consent.setTarget.notHonoured")]),
            ],
            // Keyed by destination and never remembered: approving one experiment
            // must not silently approve a later switch to another.
            `mlflow:set-target:${normalized.experiment}::${normalized.run ?? ""}`, false);
            return sink.setTarget(normalized);
        }

        clearTarget(): void {
            this._sink().clearTarget();
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatMlflowSinkScriptApi("mlflowSink")),
        { label: "mlflowSink" },
    );
}
