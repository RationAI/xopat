import type {
    AllowedScriptApiManifest, AnyFn, ApiCallMessage, ApiResponseMessage,
    MethodKeys, NamespaceSchema, NamespacesState, ParsedDts, ScriptApiMetadata,
    ScriptApiNamespaces, ScriptApiObject, ScriptManagerStatic, ScriptNamespaceConsentEntry,
    ViewerActionMap, WorkerInitMessage, WorkerRecord
} from "./scripting/abstract-types";
import {XOpatScriptingApi} from "./scripting/abstract-api";

import { XOpatApplicationScriptApi } from "./scripting/app-api";
import { XOpatViewerScriptApi } from "./scripting/viewer-api";

export class ScriptingManager<
    TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces
> {
    static __self: ScriptingManager<any> | undefined = undefined;

    workers: Record<string, WorkerRecord>;
    viewerActions: ViewerActionMap<TNamespaces>;
    apiTimeout: number;
    namespaces: NamespacesState<TNamespaces>;
    ready: Promise<void>;

    static instance(): ScriptingManager<any> {
        return this.__self || new this();
    }

    constructor(viewerActions: ViewerActionMap<TNamespaces> = {}, apiTimeout = 30000) {
        const staticContext = this.constructor as ScriptManagerStatic<TNamespaces>;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${(this.constructor as typeof ScriptingManager).name}.instance().`;
        }
        staticContext.__self = this;

        this.workers = {};
        this.viewerActions = viewerActions;
        this.apiTimeout = apiTimeout;
        this.namespaces = {} as NamespacesState<TNamespaces>;

        // todo: consider support for external ingestion
        this.ready = this.initializeBuiltins();
    }

    protected async initializeBuiltins(): Promise<void> {
        await this.ingestApi(new XOpatApplicationScriptApi("application"));
        await this.ingestApi(new XOpatViewerScriptApi("viewer"));
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
        };

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

                const boundFn = (apiInstance as any)[name].bind(apiInstance);
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

        const interfaceRegex = new RegExp(
            `export\\s+interface\\s+${interfaceName}\\s+extends\\s+[^\\{]+\\{([\\s\\S]*?)\\n\\}`,
            "m"
        );
        const match = dtsText.match(interfaceRegex);
        if (!match) {
            throw new Error(`Could not find interface '${interfaceName}' in dtypes file.`);
        }

        const interfaceBody = match[1] || "";
        const namespaceTsDeclaration = this.collectRelevantDeclarations(dtsText, interfaceName);

        const methodRegex =
            /(?:\/\*\*([\s\S]*?)\*\/\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*([^;]+);/g;

        const parsed: ParsedDts = {
            namespaceTsDeclaration,
            tsSignature: {},
            tsDeclaration: {},
            params: {},
            returnType: {},
            docs: {},
        };

        let m: RegExpExecArray | null;
        while ((m = methodRegex.exec(interfaceBody)) !== null) {
            const rawDoc = m[1] || "";
            const methodName = m[2]!;
            const paramsText = (m[3] || "").trim();
            const returns = (m[4] || "void").trim();
            const declaration = `${methodName}(${paramsText}): ${returns};`;
            const signature = `${methodName}(${paramsText}): ${returns}`;

            parsed.tsDeclaration[methodName] = declaration;
            parsed.tsSignature[methodName] = signature;
            parsed.params[methodName] = this.parseTsParams(paramsText);
            parsed.returnType[methodName] = returns;
            parsed.docs[methodName] = this.extractDocSummary(rawDoc);
        }

        return parsed;
    }

    protected findApiInterfaceName<TApi extends ScriptApiObject>(apiInstance: TApi, dtsText: string): string {
        const ctorName = (apiInstance as any)?.constructor?.name || "";
        const stripped = ctorName.replace(/^XOpat/, "").replace(/ScriptApi$/, "ScriptApi");

        // e.g. XOpatApplicationScriptApi -> ApplicationScriptApi
        const guess = stripped || `${apiInstance.namespace[0].toUpperCase()}${apiInstance.namespace.slice(1)}ScriptApi`;

        if (new RegExp(`export\\s+interface\\s+${guess}\\b`).test(dtsText)) {
            return guess;
        }

        const matches = [...dtsText.matchAll(/export\s+interface\s+([A-Za-z_]\w*)\s+extends\s+ScriptApiObject/g)];
        if (matches.length === 1) {
            return matches[0][1]!;
        }

        throw new Error(
            `Could not infer API interface name for namespace '${apiInstance.namespace}'. ` +
            `Expected something like '${guess}'.`
        );
    }

    protected collectRelevantDeclarations(dtsText: string, interfaceName: string): string {
        const blocks: string[] = [];

        const importLines = dtsText.match(/^import[^\n]+$/gm) || [];
        if (importLines.length) blocks.push(importLines.join("\n"));

        const typeBlocks = dtsText.match(/export\s+(?:type|interface)\s+[A-Za-z_]\w*[\s\S]*?(?=\nexport\s+(?:type|interface)\s+|\s*$)/gm) || [];
        for (const block of typeBlocks) {
            if (block.includes(`interface ${interfaceName}`) || !/extends\s+ScriptApiObject/.test(block)) {
                blocks.push(block.trim());
            }
        }

        return blocks.join("\n\n").trim();
    }

    protected parseTsParams(paramsText: string): Array<{ name: string; type: string }> {
        if (!paramsText.trim()) return [];

        return paramsText
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
            .map(part => {
                const idx = part.indexOf(":");
                if (idx === -1) return { name: part.replace(/\?$/, "").trim(), type: "unknown" };

                const name = part.slice(0, idx).trim().replace(/\?$/, "");
                const type = part.slice(idx + 1).trim();
                return { name, type };
            });
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
            params.push({ name: match[2], type: match[1] });
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
        implementations: TImpl
    ): void {
        this.namespaces[namespace] = {
            __self__: false,
            ...schema,
        };

        for (const [methodName, func] of Object.entries(implementations) as Array<[keyof TImpl & string, TImpl[keyof TImpl & string]]>) {
            this.viewerActions[`${namespace}:${methodName}`] = func as AnyFn;
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
                title: schema.name || `Allow the assistant to use '${namespace}'.`,
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

    createWorker(script: string, workerId: string): Worker | null {
        const channel = new MessageChannel();

        if (script.trim().startsWith("http") || script.endsWith(".js") || script.endsWith(".mjs")) {
            console.warn("Creating a worker from a URL is not supported now due to origin security reasons. Use serialized text.");
            return null;
        }

        const workerBlobCode = `
(function() {
let _securePort = null;
const _pendingCalls = new Map();
const API_TIMEOUT = ${this.apiTimeout};
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

        ${this.generateWorkerBoilerplate()}

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

        const blob = new Blob([workerBlobCode], { type: "application/javascript" });
        const worker = new Worker(URL.createObjectURL(blob));

        channel.port1.onmessage = (event: MessageEvent<ApiCallMessage>) => {
            this.handleApiCall(workerId, event.data, channel.port1);
        };

        this.workers[workerId] = { worker, channel };
        worker.postMessage({ type: "init" } satisfies WorkerInitMessage, [channel.port2]);

        return worker;
    }

    executeScript(script: string, workerId: string = `chat-script-${Date.now()}-${Math.random().toString(36).slice(2)}`): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const worker = this.createWorker(script, workerId);

            if (!worker) {
                reject(new Error("Unable to create script worker."));
                return;
            }

            const timeoutId = setTimeout(() => {
                this.terminateWorker(workerId);
                reject(new Error("Script execution timed out."));
            }, this.apiTimeout);

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

    abortScript(workerId: string): void {
        if (this.workers[workerId]) {
            this.workers[workerId].worker.terminate();
            delete this.workers[workerId];
            console.log(`Worker ${workerId} aborted.`);
        }
    }

    generateWorkerBoilerplate(): string {
        let workerCode = "";

        const reservedGlobals = ["onmessage", "postMessage", "close", "importScripts", "self", "location", "navigator", "fetch"];

        for (const ns in this.namespaces) {
            if (reservedGlobals.includes(ns)) {
                console.error(`[Security] Cannot expose namespace '${ns}' because it conflicts with a reserved Worker global.`);
                continue;
            }

            workerCode += `const _ns_${ns} = {};\n`;
            const methods = this.namespaces[ns];
            const isNamespaceAllowed = methods?.["__self__"];

            for (const method in methods) {
                if (
                    method === "__self__" ||
                    method === "_docs" ||
                    method === "params" ||
                    method === "returnType" ||
                    method === "tsSignature" ||
                    method === "tsDeclaration" ||
                    method === "namespaceTsDeclaration"
                ) continue;

                if (methods[method] || isNamespaceAllowed) {
                    workerCode += `
                        _ns_${ns}.${method} = (...params) => {
                            return new Promise((resolve, reject) => {
                                const callId = Math.random().toString(36).substring(2);

                                const timeoutId = setTimeout(() => {
                                    if (_pendingCalls.has(callId)) {
                                        _pendingCalls.delete(callId);
                                        reject(new Error("API Timeout: ${ns}.${method} took longer than " + API_TIMEOUT + "ms"));
                                    }
                                }, API_TIMEOUT);

                                _pendingCalls.set(callId, { resolve, reject, timeoutId });

                                _securePort.postMessage({
                                    type: 'api-call',
                                    callId: callId,
                                    namespace: '${ns}',
                                    method: '${method}',
                                    params: params
                                });
                            });
                        };`;
                }
            }

            workerCode += `
                Object.freeze(_ns_${ns});
                Object.defineProperty(self, '${ns}', {
                    value: _ns_${ns},
                    writable: false,
                    configurable: false
                });\n`;
        }

        return workerCode;
    }

    async handleApiCall(workerId: string, data: ApiCallMessage, port: MessagePort): Promise<void> {
        const { namespace, method, params, callId } = data;
        const nsConfig = this.namespaces[namespace];

        const workerTimeoutId = setTimeout(() => {
            console.warn(`Worker ${workerId} exceeded global timeout.`);
            port.postMessage({
                type: "api-response",
                callId,
                error: `API Timeout: ${namespace}.${method} exceeded global timeout.`,
            } satisfies ApiResponseMessage);
            this.terminateWorker(workerId);
        }, this.apiTimeout);

        if (nsConfig && (nsConfig[method] || nsConfig["__self__"])) {
            const action = this.viewerActions[`${namespace}:${method}`] || this.viewerActions[method];
            if (typeof action === "function") {
                try {
                    const result = await action(...params);
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

    terminateWorker(workerId: string): void {
        if (this.workers[workerId]) {
            this.workers[workerId].worker.terminate();
            delete this.workers[workerId];
            console.log(`Worker ${workerId} terminated.`);
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