import type {
    AllowedScriptApiManifest, AnyFn, ApiCallMessage, ApiResponseMessage, ContextAwareHostAction,
    ExecuteScriptOptions, ExternalScriptApiRegistration, MethodKeys, NamespaceSchema, NamespacesState, ParsedDts, ScriptApiMetadata,
    ScriptApiNamespaces, ScriptApiObject, ScriptManagerStatic, ScriptNamespaceConsentEntry,
    ScriptingContextState, ViewerActionMap, WorkerInitMessage, WorkerRecord
} from "./scripting/abstract-types";
import {XOpatScriptingApi} from "./scripting/abstract-api";

import { XOpatApplicationScriptApi } from "./scripting/app-api";
import { XOpatViewerScriptApi } from "./scripting/viewer-api";
import { XOpatVisualizationScriptApi } from "./scripting/visualization-api";


const WORKER_RESERVED_GLOBALS = [
    "onmessage",
    "postMessage",
    "close",
    "importScripts",
    "self",
    "location",
    "navigator",
    "fetch",
] as const;

const WORKER_SCHEMA_META_KEYS = new Set([
    "__self__",
    "_docs",
    "params",
    "returnType",
    "tsSignature",
    "tsDeclaration",
    "namespaceTsDeclaration",
    "name",
    "description",
]);

function createContextWorkerId(contextId: string, prefix = "script"): string {
    const safeContextId = String(contextId || "default")
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "_") || "default";

    return `${safeContextId}-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generateWorkerBoilerplate<TNamespaces extends ScriptApiNamespaces>(
    namespaces: NamespacesState<TNamespaces>,
    apiTimeout: number
): string {
    let workerCode = "";

    for (const namespace in namespaces) {
        const methods = namespaces[namespace];
        if (!methods) continue;

        if (WORKER_RESERVED_GLOBALS.includes(namespace as typeof WORKER_RESERVED_GLOBALS[number])) {
            console.error(`[Security] Cannot expose namespace '${namespace}' because it conflicts with a reserved Worker global.`);
            continue;
        }

        if (!namespace.match(/[a-zA-Z0-9][a-zA-Z0-9_]*/)) {
            console.error(`[Syntax] Cannot use namespace '${namespace}' - it must be a valid javascript variable name token.`);
            continue;
        }

        workerCode += `const _ns_${namespace} = {};\n`;
        const runtimeMethods = methods as Record<string, unknown>;
        const isNamespaceAllowed = !!runtimeMethods["__self__"];

        for (const method in runtimeMethods) {
            if (WORKER_SCHEMA_META_KEYS.has(method)) continue;

            if (runtimeMethods[method] || isNamespaceAllowed) {
                workerCode += `
                    _ns_${namespace}.${method} = (...params) => {
                        return new Promise((resolve, reject) => {
                            const callId = Math.random().toString(36).substring(2);

                            const timeoutId = setTimeout(() => {
                                if (_pendingCalls.has(callId)) {
                                    _pendingCalls.delete(callId);
                                    reject(new Error("API Timeout: ${namespace}.${method} took longer than " + API_TIMEOUT + "ms"));
                                }
                            }, API_TIMEOUT);

                            _pendingCalls.set(callId, { resolve, reject, timeoutId });

                            _securePort.postMessage({
                                type: 'api-call',
                                callId: callId,
                                namespace: '${namespace}',
                                method: '${method}',
                                params: params
                            });
                        });
                    };`;
            }
        }

        workerCode += `
            Object.freeze(_ns_${namespace});
            Object.defineProperty(self, '${namespace}', {
                value: _ns_${namespace},
                writable: false,
                configurable: false
            });\n`;
    }

    return workerCode;
}

function buildWorkerSource(script: string, boilerplate: string, apiTimeout: number): string {
    return `
(function() {
let _securePort = null;
const _pendingCalls = new Map();
const API_TIMEOUT = ${apiTimeout};
let _finished = false;

const finishWithResult = (result) => {
    if (_finished) return;
    _finished = true;
    try {
        self.postMessage({ result });
    } catch (_) {}
};

const finishWithError = (err) => {
    if (_finished) return;
    _finished = true;
    const message = err instanceof Error ? err.message : String(err);
    try {
        self.postMessage({ error: message });
    } catch (_) {}
};

const initHandler = (e) => {
    if (e.data.type === "init") {
        self.removeEventListener("message", initHandler);
        _securePort = e.ports[0];

        _securePort.onmessage = (msg) => {
            const { type, callId, result, error } = msg.data;
            if (type === "api-response" && _pendingCalls.has(callId)) {
                const pending = _pendingCalls.get(callId);
                const { resolve, reject, timeoutId } = pending;
                clearTimeout(timeoutId);
                _pendingCalls.delete(callId);

                if (error) reject(new Error(error));
                else resolve(result);
            }
        };

        ${boilerplate}

        Object.defineProperty(self, "onmessage", {
            value: null,
            writable: false,
            configurable: false
        });

        // Run the user script inside an async scope so top-level await works. 'eval' not in strict mode
        (async () => {
            "use strict";

            // Shadow common escape hatches / side-effectful globals inside the script scope.
            const self = undefined;
            const globalThis = undefined;
            const postMessage = undefined;
            const importScripts = undefined;
            const fetch = undefined;
            const XMLHttpRequest = undefined;
            const WebSocket = undefined;
            const EventSource = undefined;
            const Worker = undefined;
            const SharedWorker = undefined;
            const navigator = undefined;
            const caches = undefined;
            const indexedDB = undefined;
            const Function = undefined;

            ${script}
        })().then(finishWithResult).catch(finishWithError);
    }
};

self.addEventListener("unhandledrejection", (event) => {
    event.preventDefault?.();
    finishWithError(event.reason);
});

self.addEventListener("error", (event) => {
    event.preventDefault?.();
    finishWithError(event.error || event.message || "Worker execution failed.");
});

self.addEventListener("message", initHandler);
})();`;
}

async function dispatchWorkerApiCall<TNamespaces extends ScriptApiNamespaces>(
    manager: ScriptingManager<TNamespaces>,
    context: ScriptingContext<TNamespaces>,
    workerId: string,
    data: ApiCallMessage,
    port: MessagePort
): Promise<void> {
    const { namespace, method, params, callId } = data;
    const nsConfig = manager.namespaces[namespace];
    context.touchWorker(workerId);

    const workerTimeoutId = setTimeout(() => {
        console.warn(`Worker ${workerId} exceeded global timeout in context ${context.id}.`);
        port.postMessage({
            type: "api-response",
            callId,
            error: `API Timeout: ${namespace}.${method} exceeded global timeout.`,
        } satisfies ApiResponseMessage);
        context.terminateWorker(workerId);
    }, manager.apiTimeout);

    if (nsConfig && ((nsConfig as Record<string, unknown>)[method] || nsConfig["__self__"])) {
        const action = manager.viewerActions[`${namespace}:${method}`] || manager.viewerActions[method];
        if (typeof action === "function") {
            try {
                const hostAction = action as ContextAwareHostAction;
                const result = hostAction.__scriptingContextAware
                    ? await hostAction(context, ...params)
                    : await hostAction(...params);
                clearTimeout(workerTimeoutId);
                port.postMessage({ type: "api-response", callId, result } satisfies ApiResponseMessage);
            } catch (err) {
                clearTimeout(workerTimeoutId);
                port.postMessage({
                    type: "api-response",
                    callId,
                    error: err instanceof Error ? err.toString() : String(err),
                } satisfies ApiResponseMessage);
            }
        } else {
            clearTimeout(workerTimeoutId);
            port.postMessage({
                type: "api-response",
                callId,
                error: `Method ${method} is not implemented on the host.`,
            } satisfies ApiResponseMessage);
        }
    } else {
        clearTimeout(workerTimeoutId);
        console.warn(`[Security] Blocked call: ${namespace}.${method}`);
        port.postMessage({
            type: "api-response",
            callId,
            error: `Unauthorized API call: ${namespace}.${method}`,
        } satisfies ApiResponseMessage);
    }
}

export class ScriptingContext<
    TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces
> {
    protected manager: ScriptingManager<TNamespaces>;
    protected _id: string;
    protected _label?: string;
    protected _metadata?: Record<string, unknown>;
    protected _workers: Record<string, WorkerRecord>;
    protected _createdAt: number;
    protected _lastUsedAt: number;
    protected _activeViewerContextId: string | null;
    protected _bypassConsentDialog: boolean;

    constructor(
        manager: ScriptingManager<TNamespaces>,
        id: string,
        options: {
            label?: string;
            metadata?: Record<string, unknown>;
            activeViewerContextId?: string | null;
            bypassConsentDialog?: boolean;
        } = {}
    ) {
        this.manager = manager;
        this._id = id;
        this._label = options.label;
        this._metadata = options.metadata ? { ...options.metadata } : undefined;
        this._workers = {};
        this._createdAt = Date.now();
        this._lastUsedAt = this._createdAt;
        this._activeViewerContextId = options.activeViewerContextId ?? null;
        this._bypassConsentDialog = options.bypassConsentDialog === true;
    }

    get id(): string {
        return this._id;
    }

    get label(): string | undefined {
        return this._label;
    }

    setLabel(label?: string): this {
        this._label = label;
        this.touch();
        return this;
    }

    get metadata(): Record<string, unknown> | undefined {
        return this._metadata ? { ...this._metadata } : undefined;
    }

    setMetadata(metadata?: Record<string, unknown>): this {
        this._metadata = metadata ? { ...metadata } : undefined;
        this.touch();
        return this;
    }

    patchMetadata(metadata: Record<string, unknown>): this {
        this._metadata = { ...(this._metadata || {}), ...metadata };
        this.touch();
        return this;
    }

    touch(): this {
        this._lastUsedAt = Date.now();
        return this;
    }

    registerWorker(workerId: string, record: WorkerRecord): this {
        this._workers[workerId] = record;
        return this.touch();
    }

    unregisterWorker(workerId: string): this {
        delete this._workers[workerId];
        return this.touch();
    }

    hasWorker(workerId: string): boolean {
        return !!this._workers[workerId];
    }

    getWorkerRecord(workerId: string): WorkerRecord | null {
        return this._workers[workerId] || null;
    }

    listWorkerIds(): string[] {
        return Object.keys(this._workers);
    }

    touchWorker(workerId: string): void {
        const record = this._workers[workerId];
        if (!record) return;

        record.lastUsedAt = Date.now();
        this.touch();
    }

    createWorkerId(prefix = "script"): string {
        return createContextWorkerId(this._id, prefix);
    }

    setActiveViewerContextId(contextId: string | null | undefined): this {
        this._activeViewerContextId = contextId || null;
        return this.touch();
    }

    getActiveViewerContextId(): string | null {
        return this._activeViewerContextId;
    }

    /**
     * Enable or disable automatic approval of consent dialogs for this scripting context.
     * When set to true the context behaves like a CLI "-y" flag and host-side prompts are skipped.
     *
     * @param value true to auto-accept consent prompts, false to keep prompting the user
     * @returns this for chaining
     */
    setBypassConsentDialog(value: boolean = false): this {
        this._bypassConsentDialog = value === true;
        return this.touch();
    }

    /**
     * Returns true when this context should skip consent dialogs and automatically approve the action.
     */
    isConsentDialogBypassed(): boolean {
        return this._bypassConsentDialog;
    }

    getState(): ScriptingContextState {
        return {
            id: this._id,
            label: this._label,
            metadata: this._metadata ? { ...this._metadata } : undefined,
            activeViewerContextId: this._activeViewerContextId,
            bypassConsentDialog: this._bypassConsentDialog,
            workerIds: this.listWorkerIds(),
            createdAt: this._createdAt,
            lastUsedAt: this._lastUsedAt,
        };
    }

    executeScript(script: string, options: ExecuteScriptOptions = {}): Promise<unknown> {
        const workerId = options.workerId || this.createWorkerId("script");

        return new Promise((resolve, reject) => {
            let worker: Worker | null;

            try {
                worker = this.createWorker(script, { ...options, workerId });
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            if (!worker) {
                reject(new Error("Unable to create script worker."));
                return;
            }

            const timeoutId = setTimeout(() => {
                this.terminateWorker(workerId);
                reject(new Error("Script execution timed out."));
            }, this.manager.apiTimeout);

            worker.onmessage = (event: MessageEvent<{ result?: unknown; error?: string }>) => {
                clearTimeout(timeoutId);
                const { result, error } = event.data || {};
                this.terminateWorker(workerId);

                if (error) reject(new Error(error));
                else resolve(result);
            };

            worker.onerror = (event: ErrorEvent) => {
                clearTimeout(timeoutId);
                this.terminateWorker(workerId);
                reject(new Error(event.message || "Script worker failed."));
            };
        });
    }

    createWorker(script: string, options: ExecuteScriptOptions = {}): Worker | null {
        const workerId = options.workerId || this.createWorkerId("script");

        if (script.trim().startsWith("http") || script.endsWith(".js") || script.endsWith(".mjs")) {
            console.warn("Creating a worker from a URL is not supported now due to origin security reasons. Use serialized text.");
            return null;
        }

        if (this.hasWorker(workerId)) {
            this.terminateWorker(workerId);
        }

        const channel = new MessageChannel();
        const workerBlobCode = buildWorkerSource(
            script,
            generateWorkerBoilerplate(this.manager.namespaces, this.manager.apiTimeout),
            this.manager.apiTimeout
        );
        const blob = new Blob([workerBlobCode], { type: "application/javascript" });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);

        channel.port1.onmessage = (event: MessageEvent<ApiCallMessage>) => {
            void dispatchWorkerApiCall(this.manager, this, workerId, event.data, channel.port1);
        };

        this.registerWorker(workerId, {
            worker,
            channel,
            contextId: this._id,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            reusable: !!options.reuseWorker,
        });

        worker.postMessage({ type: "init" } satisfies WorkerInitMessage, [channel.port2]);
        URL.revokeObjectURL(workerUrl);

        return worker;
    }

    abortScript(workerId?: string): void {
        if (workerId) {
            this.terminateWorker(workerId, "aborted");
            return;
        }

        for (const id of this.listWorkerIds()) {
            this.terminateWorker(id, "aborted");
        }
    }

    terminateWorker(workerId: string, reason: "terminated" | "aborted" = "terminated"): void {
        const record = this._workers[workerId];
        if (!record) return;

        record.worker.terminate();
        record.channel.port1.close();
        this.unregisterWorker(workerId);
        console.log(`Worker ${workerId} ${reason} in context ${this._id}.`);
    }

    destroy(): void {
        this.manager.destroyContext(this._id);
    }
}

export class ScriptingManager<

    TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces
> {
    static __self: ScriptingManager<any> | undefined = undefined;
    static __externalApiRegistrations?: Array<ExternalScriptApiRegistration<any>> = [];

    static XOpatScriptingApi: typeof XOpatScriptingApi;
    static ScriptingContext: typeof ScriptingContext;

    contexts: Record<string, ScriptingContext<TNamespaces>>;
    defaultContextId: string;
    viewerActions: ViewerActionMap<TNamespaces>;
    apiTimeout: number;
    namespaces: NamespacesState<TNamespaces>;
    ready: Promise<void> | undefined;
    protected _bootstrapClosed: boolean;
    protected _initializing: boolean;
    protected _processedExternalRegistrations: Set<ExternalScriptApiRegistration<TNamespaces>>;

    static instance(): ScriptingManager<any> {
        return this.__self || new this();
    }

    static instantiated(): boolean {
        return !!this.__self;
    }

    static registerExternalApi(
        registrar: ExternalScriptApiRegistration<any>["registrar"],
        options: { label?: string } = {}
    ): Promise<void> | void {
        const staticContext = this as ScriptManagerStatic<any>;
        const registration: ExternalScriptApiRegistration<any> = {
            registrar,
            label: options.label,
        };

        staticContext.__externalApiRegistrations ||= [];
        staticContext.__externalApiRegistrations.push(registration);

        const instance = staticContext.__self;
        if (!instance) return;

        return instance._registerExternalApiRegistration(registration);
    }

    constructor(viewerActions: ViewerActionMap<TNamespaces> = {}, apiTimeout = 30000) {
        const staticContext = this.constructor as unknown as ScriptManagerStatic<TNamespaces>;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${(this.constructor as typeof ScriptingManager).name}.instance().`;
        }
        staticContext.__self = this;

        this.contexts = {};
        this.defaultContextId = "default";
        this.viewerActions = viewerActions;
        this.apiTimeout = apiTimeout;
        this.namespaces = {} as NamespacesState<TNamespaces>;
        this._bootstrapClosed = false;
        this._initializing = false;
        this._processedExternalRegistrations = new Set();
        this.ready = undefined;
        this.createContext({ id: this.defaultContextId, label: "Default" });
    }

    protected normalizeContextId(contextId?: string | null): string {
        const normalized = String(contextId || this.defaultContextId).trim();
        return normalized || this.defaultContextId;
    }

    createContext(options: {
        id?: string;
        label?: string;
        metadata?: Record<string, unknown>;
        activeViewerContextId?: string | null;
        bypassConsentDialog?: boolean;
    } = {}): ScriptingContext<TNamespaces> {
        const contextId = this.normalizeContextId(options.id);
        const existing = this.contexts[contextId];
        if (existing) {
            if (options.label !== undefined) existing.setLabel(options.label);
            if (options.metadata !== undefined) existing.setMetadata(options.metadata);
            if (options.activeViewerContextId !== undefined) {
                existing.setActiveViewerContextId(options.activeViewerContextId);
            }
            if (options.bypassConsentDialog !== undefined) {
                existing.setBypassConsentDialog(options.bypassConsentDialog);
            }
            return existing;
        }

        const context = new ScriptingContext<TNamespaces>(this, contextId, {
            label: options.label,
            metadata: options.metadata,
            activeViewerContextId: options.activeViewerContextId,
            bypassConsentDialog: options.bypassConsentDialog,
        });
        this.contexts[contextId] = context;
        return context;
    }

    getContext(contextId: string = this.defaultContextId): ScriptingContext<TNamespaces> {
        return this.contexts[this.normalizeContextId(contextId)] || this.createContext({ id: contextId });
    }

    hasContext(contextId: string): boolean {
        return !!this.contexts[this.normalizeContextId(contextId)];
    }

    listContexts(): ScriptingContext<TNamespaces>[] {
        return Object.values(this.contexts);
    }

    listContextStates(): ScriptingContextState[] {
        return this.listContexts().map(context => context.getState());
    }


    destroyContext(contextId: string): void {
        const normalized = this.normalizeContextId(contextId);
        const context = this.contexts[normalized];
        if (!context) return;

        context.abortScript();
        delete this.contexts[normalized];

        if (normalized === this.defaultContextId) {
            this.createContext({ id: this.defaultContextId, label: "Default" });
        }
    }


    async initialize(): Promise<void> {
        if (this.ready) return this.ready;
        if (!this._initializing) {
            this.ready = this._initializeBuiltins();
        }
        return this.ready;
    }

    private async _initializeBuiltins(): Promise<void> {
        this._initializing = true;
        try {
            await this.ingestApi(new XOpatApplicationScriptApi("application"));
            await this.ingestApi(new XOpatViewerScriptApi("viewer"));
            await this.ingestApi(new XOpatVisualizationScriptApi("visualization"));

            const staticContext = this.constructor as unknown as ScriptManagerStatic<TNamespaces>;
            const externalRegistrations = [...(staticContext.__externalApiRegistrations || [])];
            for (const registration of externalRegistrations) {
                await this._ingestExternalRegistration(registration);
            }
        } finally {
            this._initializing = false;
            this._bootstrapClosed = true;
        }
    }

    protected async _registerExternalApiRegistration(
        registration: ExternalScriptApiRegistration<TNamespaces>
    ): Promise<void> {
        if (!this.ready) {
            // we will do it once at init time, the preferred way
            return;
        }
        if (!this._bootstrapClosed) {
            await this.initialize();
        }

        const workerCount = this.listContexts().reduce((count, context) => count + context.listWorkerIds().length, 0);
        const lateNote = workerCount > 0
            ? ` ${workerCount} worker(s) already exist, so they will not see the new namespace.`
            : "";

        console.warn(
            `[ScriptingManager] External scripting API '${registration.label || "unknown"}' was registered after the bootstrap phase finished.` +
            ` Register external APIs before ScriptingManager.instance() or before awaiting manager.ready.${lateNote}`
        );

        return this._ingestExternalRegistration(registration);
    }

    protected async _ingestExternalRegistration(
        registration: ExternalScriptApiRegistration<TNamespaces>
    ): Promise<void> {
        if (this._processedExternalRegistrations.has(registration)) return;

        this._processedExternalRegistrations.add(registration);
        try {
            await registration.registrar(this);
        } catch (e) {
            this._processedExternalRegistrations.delete(registration);
            throw e;
        }
    }

    async ingestApi<TApi extends XOpatScriptingApi>(apiInstance: TApi): Promise<void> {
        const ns = apiInstance.namespace;

        const methodsDocs: Partial<Record<MethodKeys<TApi>, string>> = {};
        const paramsDocs: Partial<Record<MethodKeys<TApi>, Array<{ name: string; type: string }>>> = {};
        const returnTypes: Partial<Record<MethodKeys<TApi>, string>> = {};
        const tsSignatures: Partial<Record<MethodKeys<TApi>, string>> = {};
        const tsDeclarations: Partial<Record<MethodKeys<TApi>, string>> = {};
        const schema: NamespaceSchema<TApi> = {
            __self__: true,
            name: apiInstance.name,
            description: apiInstance.description,
        } as NamespaceSchema<TApi>;

        const ctor = (apiInstance as any).constructor;
        const metadata: ScriptApiMetadata<TApi> | undefined = ctor?.ScriptApiMetadata;

        try {
            const parsedDts = await this.loadDtsMetadata(apiInstance, metadata);

            const prototype = Object.getPrototypeOf(apiInstance);
            const methodNames = Object.getOwnPropertyNames(prototype)
                .filter(name =>
                    name !== "constructor" &&
                    !name.startsWith("_") &&
                    typeof (apiInstance as any)[name] === "function"
                ) as MethodKeys<TApi>[];

            methodNames.forEach(name => {
                schema[name] = true;

                const boundFn = Object.assign(
                    (context: ScriptingContext<TNamespaces>, ...params: unknown[]) => {
                        const contextualApi = apiInstance.bindInvocationContext({ scriptingContext: context });
                        return (contextualApi as any)[name](...params);
                    },
                    { __scriptingContextAware: true }
                ) as ContextAwareHostAction;

                this.viewerActions[`${ns}:${name}`] = boundFn;
                this.viewerActions[name] ??= boundFn;

                const funcStr = (apiInstance as any)[name].toString();
                const docMatch = funcStr.match(/\/\*\*([\s\S]*?)\*\//);
                const jsDoc = docMatch ? docMatch[1] : "";

                methodsDocs[name] =
                    metadata?.docs?.[name] ||
                    parsedDts?.docs?.[name] ||
                    (jsDoc
                        ? jsDoc.replace(/[* \n\r\t]+/g, " ").trim()
                        : "Executes the " + name + " operation.");

                paramsDocs[name] =
                    metadata?.params?.[name] ||
                    parsedDts?.params?.[name] ||
                    this.extractParamsFromDoc(jsDoc);

                returnTypes[name] =
                    metadata?.returnType?.[name] ||
                    parsedDts?.returnType?.[name] ||
                    this.extractReturnTypeFromDoc(jsDoc);

                tsSignatures[name] =
                    metadata?.tsSignature?.[name] ||
                    parsedDts?.tsSignature?.[name];

                tsDeclarations[name] =
                    metadata?.tsDeclaration?.[name] ||
                    parsedDts?.tsDeclaration?.[name];
            });

            this.namespaces[ns] = {
                ...schema,
                _docs: methodsDocs,
                params: paramsDocs,
                returnType: returnTypes,
                tsSignature: tsSignatures,
                tsDeclaration: tsDeclarations,
                namespaceTsDeclaration:
                    metadata?.namespaceTsDeclaration ||
                    parsedDts?.namespaceTsDeclaration,
            };
            console.log(`Registered API namespace '${ns}'.`, this.namespaces[ns]);

        } catch (e) {
            console.error(`Scripting namespace ${ns} disabled. Failed to load API metadata:`, e);
        }
    }

    protected parseDtsForApi<TApi extends ScriptApiObject>(apiInstance: TApi, dtsText: string): ParsedDts {
        const interfaceName = this.findApiInterfaceName(apiInstance, dtsText);
        const interfaceDecl = this.extractExportDeclaration(dtsText, "interface", interfaceName);

        if (!interfaceDecl) {
            throw new Error(`Could not find interface '${interfaceName}' in dtypes file.`);
        }

        const interfaceBody = this.extractInterfaceBody(interfaceDecl);
        const namespaceTsDeclaration = this.collectRelevantDeclarations(dtsText, interfaceName);

        const parsed: ParsedDts = {
            namespaceTsDeclaration,
            tsSignature: {},
            tsDeclaration: {},
            params: {},
            returnType: {},
            docs: {},
        };

        for (const statement of this.splitTopLevelStatements(interfaceBody)) {
            const trimmed = statement.trim();
            if (!trimmed) continue;

            const docMatch = trimmed.match(/^\/\*\*([\s\S]*?)\*\/\s*/);
            const rawDoc = docMatch?.[1] || "";
            const withoutDoc = trimmed.slice(docMatch?.[0]?.length || 0).trim();

            const methodMatch = withoutDoc.match(
                /^([A-Za-z_]\w*)\s*(<[\s\S]*?>)?\s*\(([\s\S]*)\)\s*:\s*([\s\S]+)$/
            );

            if (!methodMatch) continue;

            const methodName = methodMatch[1]!;
            const genericPart = methodMatch[2] || "";
            const paramsText = (methodMatch[3] || "").trim();
            const returns = (methodMatch[4] || "void").trim();

            const declaration = `${methodName}${genericPart}(${paramsText}): ${returns};`;
            const signature = `${methodName}${genericPart}(${paramsText}): ${returns}`;

            parsed.tsDeclaration[methodName] = declaration;
            parsed.tsSignature[methodName] = signature;
            parsed.params[methodName] = this.parseTsParams(paramsText);
            parsed.returnType[methodName] = returns;
            parsed.docs[methodName] = this.extractDocSummary(rawDoc);
        }

        return parsed;
    }

    protected collectRelevantDeclarations(dtsText: string, interfaceName: string): string {
        const blocks: string[] = [];

        const importLines = dtsText.match(/^import[^\n]+$/gm) || [];
        if (importLines.length) blocks.push(importLines.join("\n"));

        const exportMatches = [
            ...dtsText.matchAll(/^export\s+(type|interface)\s+([A-Za-z_]\w*)\b/gm),
        ];

        for (const match of exportMatches) {
            const kind = match[1] as "type" | "interface";
            const name = match[2]!;
            const decl = this.extractExportDeclaration(dtsText, kind, name);
            if (!decl) continue;

            const isTargetInterface = kind === "interface" && name === interfaceName;
            const isOtherScriptApiInterface = /extends\s+ScriptApiObject\b/.test(decl) && !isTargetInterface;

            if (isTargetInterface || !isOtherScriptApiInterface) {
                blocks.push(decl.trim());
            }
        }

        return blocks.join("\n\n").trim();
    }

    protected parseTsParams(paramsText: string): Array<{ name: string; type: string }> {
        const text = paramsText.trim();
        if (!text) return [];

        return this.splitTopLevelByComma(text)
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const idx = this.findTopLevelColon(part);
                if (idx === -1) {
                    return { name: part.replace(/\?$/, "").trim(), type: "unknown" };
                }

                const name = part.slice(0, idx).trim().replace(/\?$/, "");
                const type = part.slice(idx + 1).trim();
                return { name, type };
            });
    }

    protected extractExportDeclaration(
        dtsText: string,
        kind: "type" | "interface",
        name: string
    ): string | null {
        const startMatch = new RegExp(`^export\\s+${kind}\\s+${name}\\b`, "m").exec(dtsText);
        if (!startMatch || startMatch.index === undefined) return null;

        const start = startMatch.index;
        let i = start;

        let braceDepth = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let angleDepth = 0;

        let inString: '"' | "'" | "`" | null = null;
        let inLineComment = false;
        let inBlockComment = false;

        let seenEquals = false;
        let seenOpeningBrace = false;

        const startsTopLevelExport = (index: number) =>
            (index === 0 || dtsText[index - 1] === "\n") &&
            dtsText.slice(index).startsWith("export ");

        for (; i < dtsText.length; i++) {
            const ch = dtsText[i]!;
            const next = dtsText[i + 1] || "";

            if (inLineComment) {
                if (ch === "\n") inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (ch === "*" && next === "/") {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (inString) {
                if (ch === "\\" && next) {
                    i++;
                    continue;
                }
                if (ch === inString) {
                    inString = null;
                }
                continue;
            }

            if (ch === "/" && next === "/") {
                inLineComment = true;
                i++;
                continue;
            }

            if (ch === "/" && next === "*") {
                inBlockComment = true;
                i++;
                continue;
            }

            if (ch === '"' || ch === "'" || ch === "`") {
                inString = ch as '"' | "'" | "`";
                continue;
            }

            if (ch === "=") seenEquals = true;

            if (ch === "{") {
                braceDepth++;
                seenOpeningBrace = true;
                continue;
            }
            if (ch === "}") {
                if (braceDepth > 0) braceDepth--;

                if (kind === "interface" && seenOpeningBrace && braceDepth === 0) {
                    i++;
                    break;
                }
                continue;
            }

            if (ch === "(") parenDepth++;
            else if (ch === ")" && parenDepth > 0) parenDepth--;

            else if (ch === "[") bracketDepth++;
            else if (ch === "]" && bracketDepth > 0) bracketDepth--;

            else if (ch === "<") angleDepth++;
            else if (ch === ">" && angleDepth > 0) angleDepth--;

            if (
                kind === "type" &&
                ch === ";" &&
                braceDepth === 0 &&
                parenDepth === 0 &&
                bracketDepth === 0 &&
                angleDepth === 0
            ) {
                i++;
                break;
            }

            if (
                i > start &&
                braceDepth === 0 &&
                parenDepth === 0 &&
                bracketDepth === 0 &&
                angleDepth === 0 &&
                startsTopLevelExport(i)
            ) {
                break;
            }
        }

        return dtsText.slice(start, i).trim();
    }

    protected extractInterfaceBody(interfaceDecl: string): string {
        const open = interfaceDecl.indexOf("{");
        if (open === -1) {
            throw new Error("Interface declaration is missing opening brace.");
        }

        let depth = 0;
        for (let i = open; i < interfaceDecl.length; i++) {
            const ch = interfaceDecl[i]!;
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    return interfaceDecl.slice(open + 1, i);
                }
            }
        }

        throw new Error("Interface declaration is missing closing brace.");
    }

    protected splitTopLevelStatements(body: string): string[] {
        const parts: string[] = [];
        let start = 0;

        let braceDepth = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let angleDepth = 0;

        let inString: '"' | "'" | "`" | null = null;
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < body.length; i++) {
            const ch = body[i]!;
            const next = body[i + 1] || "";

            if (inLineComment) {
                if (ch === "\n") inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (ch === "*" && next === "/") {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (inString) {
                if (ch === "\\" && next) {
                    i++;
                    continue;
                }
                if (ch === inString) inString = null;
                continue;
            }

            if (ch === "/" && next === "/") {
                inLineComment = true;
                i++;
                continue;
            }

            if (ch === "/" && next === "*") {
                inBlockComment = true;
                i++;
                continue;
            }

            if (ch === '"' || ch === "'" || ch === "`") {
                inString = ch as '"' | "'" | "`";
                continue;
            }

            if (ch === "{") braceDepth++;
            else if (ch === "}" && braceDepth > 0) braceDepth--;

            else if (ch === "(") parenDepth++;
            else if (ch === ")" && parenDepth > 0) parenDepth--;

            else if (ch === "[") bracketDepth++;
            else if (ch === "]" && bracketDepth > 0) bracketDepth--;

            else if (ch === "<") angleDepth++;
            else if (ch === ">" && angleDepth > 0) angleDepth--;

            if (
                ch === ";" &&
                braceDepth === 0 &&
                parenDepth === 0 &&
                bracketDepth === 0 &&
                angleDepth === 0
            ) {
                parts.push(body.slice(start, i).trim());
                start = i + 1;
            }
        }

        const tail = body.slice(start).trim();
        if (tail) parts.push(tail);

        return parts.filter(Boolean);
    }

    protected splitTopLevelByComma(text: string): string[] {
        const parts: string[] = [];
        let start = 0;

        let braceDepth = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let angleDepth = 0;

        let inString: '"' | "'" | "`" | null = null;
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i]!;
            const next = text[i + 1] || "";

            if (inLineComment) {
                if (ch === "\n") inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (ch === "*" && next === "/") {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (inString) {
                if (ch === "\\" && next) {
                    i++;
                    continue;
                }
                if (ch === inString) inString = null;
                continue;
            }

            if (ch === "/" && next === "/") {
                inLineComment = true;
                i++;
                continue;
            }

            if (ch === "/" && next === "*") {
                inBlockComment = true;
                i++;
                continue;
            }

            if (ch === '"' || ch === "'" || ch === "`") {
                inString = ch as '"' | "'" | "`";
                continue;
            }

            if (ch === "{") braceDepth++;
            else if (ch === "}" && braceDepth > 0) braceDepth--;

            else if (ch === "(") parenDepth++;
            else if (ch === ")" && parenDepth > 0) parenDepth--;

            else if (ch === "[") bracketDepth++;
            else if (ch === "]" && bracketDepth > 0) bracketDepth--;

            else if (ch === "<") angleDepth++;
            else if (ch === ">" && angleDepth > 0) angleDepth--;

            if (
                ch === "," &&
                braceDepth === 0 &&
                parenDepth === 0 &&
                bracketDepth === 0 &&
                angleDepth === 0
            ) {
                parts.push(text.slice(start, i));
                start = i + 1;
            }
        }

        parts.push(text.slice(start));
        return parts;
    }

    protected findTopLevelColon(text: string): number {
        let braceDepth = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let angleDepth = 0;

        let inString: '"' | "'" | "`" | null = null;
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i]!;
            const next = text[i + 1] || "";

            if (inLineComment) {
                if (ch === "\n") inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (ch === "*" && next === "/") {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (inString) {
                if (ch === "\\" && next) {
                    i++;
                    continue;
                }
                if (ch === inString) inString = null;
                continue;
            }

            if (ch === "/" && next === "/") {
                inLineComment = true;
                i++;
                continue;
            }

            if (ch === "/" && next === "*") {
                inBlockComment = true;
                i++;
                continue;
            }

            if (ch === '"' || ch === "'" || ch === "`") {
                inString = ch as '"' | "'" | "`";
                continue;
            }

            if (ch === "{") braceDepth++;
            else if (ch === "}" && braceDepth > 0) braceDepth--;

            else if (ch === "(") parenDepth++;
            else if (ch === ")" && parenDepth > 0) parenDepth--;

            else if (ch === "[") bracketDepth++;
            else if (ch === "]" && bracketDepth > 0) bracketDepth--;

            else if (ch === "<") angleDepth++;
            else if (ch === ">" && angleDepth > 0) angleDepth--;

            if (
                ch === ":" &&
                braceDepth === 0 &&
                parenDepth === 0 &&
                bracketDepth === 0 &&
                angleDepth === 0
            ) {
                return i;
            }
        }

        return -1;
    }

    protected findApiInterfaceName<TApi extends ScriptApiObject>(apiInstance: TApi, dtsText: string): string {
        const ctorName = String((apiInstance as any)?.constructor?.name || "").trim();
        const namespace = String((apiInstance as any)?.namespace || "").trim();

        const toPascal = (value: string): string =>
            value
                .replace(/[^A-Za-z0-9]+/g, " ")
                .split(" ")
                .filter(Boolean)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join("");

        const normalizeCtorBase = (value: string): string =>
            value
                .replace(/^XOpat/, "")
                .replace(/ScriptApi$/, "");

        const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

        const ctorBase = normalizeCtorBase(ctorName);
        const nsBase = toPascal(namespace);

        const explicitCandidates = unique([
            ctorBase ? `${ctorBase}ScriptApi` : "",
            nsBase ? `${nsBase}ScriptApi` : "",

            // Common read-only naming pattern:
            // XOpatAnnotationsReadScriptApi -> AnnotationsScriptApi
            ctorBase.endsWith("Read") ? `${ctorBase.slice(0, -4)}ScriptApi` : "",
            nsBase.endsWith("Read") ? `${nsBase.slice(0, -4)}ScriptApi` : "",

            // Optional symmetry if you ever have "FooWrite" namespace names.
            ctorBase.endsWith("Write") ? `${ctorBase}ScriptApi` : "",
            nsBase.endsWith("Write") ? `${nsBase}ScriptApi` : "",
        ]);

        for (const candidate of explicitCandidates) {
            const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp(`export\\s+interface\\s+${escaped}\\b`).test(dtsText)) {
                return candidate;
            }
        }

        const prototype = Object.getPrototypeOf(apiInstance);
        const runtimeMethods = new Set(
            Object.getOwnPropertyNames(prototype).filter(name =>
                name !== "constructor" &&
                !name.startsWith("_") &&
                typeof (apiInstance as any)[name] === "function"
            )
        );

        const interfaceMatches = [
            ...dtsText.matchAll(
                /export\s+interface\s+([A-Za-z_]\w*)\s+extends\s+ScriptApiObject\s*\{([\s\S]*?)\n\}/gm
            ),
        ];

        const scored = interfaceMatches
            .map(match => {
                const interfaceName = match[1]!;
                const body = match[2] || "";
                const methodNames = [
                    ...body.matchAll(/(?:\/\*\*[\s\S]*?\*\/\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*([^;]+);/g),
                ].map(m => m[1]!);

                const overlap = methodNames.filter(name => runtimeMethods.has(name)).length;
                const missing = [...runtimeMethods].filter(name => !methodNames.includes(name)).length;

                return {
                    interfaceName,
                    overlap,
                    missing,
                    methodCount: methodNames.length,
                };
            })
            .filter(item => item.overlap > 0)
            .sort((a, b) =>
                b.overlap - a.overlap ||
                a.missing - b.missing ||
                b.methodCount - a.methodCount
            );

        if (scored.length === 1) {
            return scored[0]!.interfaceName;
        }

        if (scored.length > 1 && scored[0]!.overlap > scored[1]!.overlap) {
            return scored[0]!.interfaceName;
        }

        if (interfaceMatches.length === 1) {
            return interfaceMatches[0]![1]!;
        }

        throw new Error(
            `Could not infer API interface name for namespace '${namespace}'. ` +
            `Tried: ${explicitCandidates.join(", ") || "(none)"}.`
        );
    }

    protected extractDocSummary(doc: string): string {
        return doc
            .replace(/^\s*\*\s?/gm, "")
            .replace(/\r/g, "")
            .trim()
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean)
            .join(" ");
    }

    extractParamsFromDoc(doc: string): Array<{ name: string; type: string }> {
        const paramsRegex = /@param {([^}]+)} (\w+)/g;
        const params: Array<{ name: string; type: string }> = [];
        let match: RegExpExecArray | null;
        while ((match = paramsRegex.exec(doc)) !== null) {
            try {
                params.push({ name: match![2]!, type: match![1]! });
            } catch (e) {
                console.error("Failed to parse param from doc:", match, e);
            }
        }
        return params;
    }

    extractReturnTypeFromDoc(doc: string): string {
        const returnRegex = /@returns {([^}]+)}/;
        const match = doc.match(returnRegex);
        return match ? match[1]! : "void";
    }

    registerNamespace<K extends string, TImpl extends ScriptApiObject>(
        namespace: K,
        schema: Partial<Record<MethodKeys<TImpl>, boolean>>,
        implementations: TImpl,
        options: { contextAware?: boolean } = {}
    ): void {
        this.namespaces[namespace] = {
            __self__: false,
            ...schema,
        };

        for (const [methodName, func] of Object.entries(implementations) as Array<[keyof TImpl & string, TImpl[keyof TImpl & string]]>) {
            const hostAction = options.contextAware
                ? Object.assign(
                    (context: ScriptingContext<TNamespaces>, ...params: unknown[]) =>
                        (func as AnyFn).call(implementations, context, ...params),
                    { __scriptingContextAware: true }
                ) as ContextAwareHostAction
                : func as ContextAwareHostAction;

            this.viewerActions[`${namespace}:${methodName}`] = hostAction;
        }
    }

    getAllowedApiManifest(allowedNamespaces?: string[]): AllowedScriptApiManifest {
        const allowedSet = allowedNamespaces ? new Set(allowedNamespaces) : null;
        const namespaces: AllowedScriptApiManifest["namespaces"] = [];

        for (const [namespace, schema] of Object.entries(this.namespaces || {})) {
            if (allowedSet && !allowedSet.has(namespace)) continue;
            if (!schema?.__self__) continue;

            const methods: AllowedScriptApiManifest["namespaces"][number]["methods"] = [];

            for (const [methodName, enabled] of Object.entries(schema)) {
                if (
                    methodName === "__self__" ||
                    methodName === "_docs" ||
                    methodName === "params" ||
                    methodName === "returnType" ||
                    methodName === "tsSignature" ||
                    methodName === "tsDeclaration" ||
                    methodName === "namespaceTsDeclaration"
                ) {
                    continue;
                }

                if (!schema.__self__ && !enabled) continue;

                methods.push({
                    name: methodName,
                    description: schema._docs?.[methodName],
                    params: schema.params?.[methodName] || [],
                    returns: schema.returnType?.[methodName] || "void",
                    tsSignature: schema.tsSignature?.[methodName],
                    tsDeclaration: schema.tsDeclaration?.[methodName],
                });
            }

            namespaces.push({
                namespace,
                name: schema.name,
                description: schema.description,
                tsDeclaration: schema.namespaceTsDeclaration,
                methods,
            });
        }

        return { namespaces };
    }

    getNamespaceConsentEntries(): Record<string, ScriptNamespaceConsentEntry> {
        const result: Record<string, ScriptNamespaceConsentEntry> = {};

        for (const [namespace, schema] of Object.entries(this.namespaces || {})) {
            result[namespace] = {
                title: schema.name,
                description: schema.description,
                granted: false
            };
        }

        return result;
    }

    protected async loadDtsMetadata<TApi extends ScriptApiObject>(
        apiInstance: TApi,
        metadata?: ScriptApiMetadata<TApi>
    ): Promise<ParsedDts | null> {
        const source = metadata?.dtypesSource;
        if (!source) return null;

        let dtsText: string;

        switch (source.kind) {
            case "text":
                dtsText = source.value;
                break;

            case "url": {
                const response = await fetch(source.value, { credentials: "same-origin" });
                if (!response.ok) {
                    throw new Error(`Failed to load dtypes from '${source.value}'.`);
                }
                dtsText = await response.text();
                break;
            }

            case "resolve": {
                const resolved = await source.value();

                // If resolver returned raw declarations, use them directly.
                if (typeof resolved === "string") {
                    dtsText = resolved;
                    break;
                }

                throw new Error("dtypesSource.resolve must return declaration text.");
            }

            default:
                throw new Error(`Unsupported dtypesSource kind: ${(source as any)?.kind}`);
        }

        if (!dtsText.trim()) {
            throw new Error(`Resolved empty type definitions for namespace '${apiInstance.namespace}'.`);
        }

        return this.parseDtsForApi(apiInstance, dtsText);
    }

    syncNamespaceConsent(consents: Record<string, { granted: boolean }>): void {
        const known = this.getNamespaceConsentEntries();

        for (const namespace of Object.keys(known)) {
            const granted = !!consents?.[namespace]?.granted;
            this.grantNamespaceConsent(namespace, granted);
        }
    }

    setConsent(namespace: string, method: string, value: boolean): void {
        if (!this.namespaces[namespace]) this.namespaces[namespace] = { __self__: false };
        this.namespaces[namespace][method] = value;
    }

    grantNamespaceConsent(namespace: string, value: boolean): void {
        if (!this.namespaces[namespace]) this.namespaces[namespace] = { __self__: false };
        this.namespaces[namespace]["__self__"] = value;
    }
}

ScriptingManager.XOpatScriptingApi = XOpatScriptingApi;
ScriptingManager.ScriptingContext = ScriptingContext;
(window as any).ScriptingManager = ScriptingManager;