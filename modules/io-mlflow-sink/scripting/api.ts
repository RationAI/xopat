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
                "run identifier tag, and metrics/params/tags — or null to decline the record. This namespace " +
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

        async _consent(title: string, details: string[]): Promise<void> {
            await this.requireActionConsent({
                title,
                description: "A script wants to change how scored data is written to MLflow.",
                details,
                mode: "warning",
                confirmLabel: "Apply",
                rejectedMessage: "The MLflow structure change was canceled by the user.",
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
            await this._consent("Change the MLflow record structure", [
                `New structure: ${template.name} — ${template.description}`,
                "Records written from now on use the new layout; already-written runs are untouched.",
            ]);
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
            await this._consent("Use a custom MLflow record structure", [
                `A script-supplied mapper named "${name}" will shape every record written to MLflow.`,
                "Experiments outside the deployment's allowlist are still refused.",
            ]);
            const sink = this._sink();
            sink.registerMapper(name, mapper as any);
            sink.setTemplate(name);
            return name;
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatMlflowSinkScriptApi("mlflowSink")),
        { label: "mlflowSink" },
    );
}
