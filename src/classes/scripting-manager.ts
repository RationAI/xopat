import type {
    AllowedScriptApiManifest, AnyFn, ApiCallMessage, ApiResponseMessage, ContextAwareHostAction,
    ExecuteScriptOptions, ExternalScriptApiRegistration, MethodKeys, NamespaceSchema, NamespacesState, ParsedDts, ScriptApiMetadata,
    ScriptApiNamespaces, ScriptApiObject, ScriptManagerStatic, ScriptMethodManifestEntry, ScriptNamespaceConsentEntry,
    ScriptingContextState, StoredResultSlice, ViewerActionMap, WorkerRecord
} from "./scripting/abstract-types";
import {XOpatScriptingApi} from "./scripting/abstract-api";
import {fetchDtsCached} from "./scripting/dts-fetch";

import { XOpatApplicationScriptApi } from "./scripting/app-api";
import { XOpatViewerScriptApi } from "./scripting/viewer-api";
import { XOpatVisualizationScriptApi } from "./scripting/visualization-api";
import { XOpatPatientScriptApi } from "./scripting/patient-api";


/**
 * Attach the last `progress(value)` payload to an error for a run that never produced a
 * result. Callers (the chat runtime in particular) can then report partial work instead
 * of discarding everything the script computed before it was stopped.
 */
function withPartialResult(error: Error, partialResult: unknown): Error {
    if (partialResult !== undefined) {
        (error as import("./scripting/abstract-types").ScriptRunError).partialResult = partialResult;
    }
    return error;
}

/**
 * How long a freshly spawned worker may take to report `ready`. Bounds worker STARTUP
 * only — script run duration is governed by the (much longer) api timeout.
 */
const WORKER_STARTUP_TIMEOUT_MS = 15_000;

const WORKER_RESERVED_GLOBALS = [
    "progress",
    "onmessage",
    "postMessage",
    "close",
    "importScripts",
    "self",
    "location",
    "navigator",
    "fetch",
    "eval",
    "Function",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "caches",
    "indexedDB",
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
    "sensitive",
]);

// Cache the debug flag to avoid an APPLICATION_CONTEXT.getOption + try/catch
// per worker dispatch. Refreshed on the `option-change` broadcast and
// re-checked once after first access; flipping it mid-session takes effect
// on the next debugLog call.
let _scriptingDebugCache: boolean | null = null;
function isScriptingDebugEnabled(): boolean {
    if (_scriptingDebugCache !== null) return _scriptingDebugCache;
    try {
        const app = (globalThis as any)?.APPLICATION_CONTEXT;
        _scriptingDebugCache = app?.getOption?.("debugMode", false, false) === true;
    } catch {
        _scriptingDebugCache = false;
    }
    return _scriptingDebugCache;
}

function scriptingDebugLog(label: string, data?: unknown): void {
    if (!isScriptingDebugEnabled()) return;
    console.debug(`[SCRIPTING DEBUG] ${label}`, data);
}

function createContextWorkerId(contextId: string, prefix = "script"): string {
    const safeContextId = String(contextId || "default")
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "_") || "default";

    return `${safeContextId}-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Unique id for a single script execution (one `run` message on a worker). */
function createExecId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const NAMESPACE_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/;
const METHOD_TOKEN_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Describe the consent-allowed namespaces as CODE-FREE structured data instead of
 * generating a source string. The generic worker bootstrap turns this into frozen
 * stub globals at runtime (no host-side dynamic code = smaller injection surface).
 *
 * Mirrors the old generateWorkerBoilerplate consent logic exactly: reserved-global
 * and identifier filtering for namespaces, skip schema meta keys, and expose a
 * method when it is individually consented OR the namespace is blanket-allowed
 * (`__self__`). Method names are additionally identifier-validated as defense in depth.
 */
function buildNamespaceManifestForWorker<TNamespaces extends ScriptApiNamespaces>(
    namespaces: NamespacesState<TNamespaces>
): import("./scripting/abstract-types").WorkerNamespaceManifest {
    const manifest: import("./scripting/abstract-types").WorkerNamespaceManifest = [];

    for (const namespace in namespaces) {
        const methods = namespaces[namespace];
        if (!methods) continue;

        if (WORKER_RESERVED_GLOBALS.includes(namespace as typeof WORKER_RESERVED_GLOBALS[number])) {
            console.error(`[Security] Cannot expose namespace '${namespace}' because it conflicts with a reserved Worker global.`);
            continue;
        }

        if (!NAMESPACE_TOKEN_RE.test(namespace)) {
            console.error(`[Syntax] Cannot use namespace '${namespace}' - it must be a valid javascript variable name token.`);
            continue;
        }

        const runtimeMethods = methods as Record<string, unknown>;
        const isNamespaceAllowed = !!runtimeMethods["__self__"];
        const allowedMethods: string[] = [];

        for (const method in runtimeMethods) {
            if (WORKER_SCHEMA_META_KEYS.has(method)) continue;
            if (!(runtimeMethods[method] || isNamespaceAllowed)) continue;
            if (!METHOD_TOKEN_RE.test(method)) {
                console.error(`[Syntax] Skipping method '${namespace}.${method}' - not a valid identifier.`);
                continue;
            }
            allowedMethods.push(method);
        }

        manifest.push({ namespace, methods: allowedMethods });
    }

    return manifest;
}

/**
 * If the user script is exactly one top-level parenthesised expression
 * (a single IIFE, possibly trailed by `;`) with no top-level `return`,
 * prepend `return ` so the AsyncFunction wrapper resolves to the IIFE's
 * value instead of `undefined`. Strings/templates/comments are skipped
 * during bracket-depth tracking; anything more complex passes through
 * unchanged.
 */
function maybeAutoReturnTrailingIife(script: string): string {
    const len = script.length;
    if (len === 0) return script;

    let i = 0;
    let depth = 0;
    let hasTopLevelReturn = false;
    let stripped = "";

    const isIdent = (ch: string | undefined) => !!ch && (ch >= "0" && ch <= "9" || ch >= "A" && ch <= "Z" || ch >= "a" && ch <= "z" || ch === "_" || ch === "$");
    const isWs = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

    while (i < len) {
        const ch = script[i];
        const nx = i + 1 < len ? script[i + 1] : "";

        // Line comment
        if (ch === "/" && nx === "/") {
            while (i < len && script[i] !== "\n") i++;
            stripped += " ";
            continue;
        }
        // Block comment
        if (ch === "/" && nx === "*") {
            i += 2;
            while (i + 1 < len && !(script[i] === "*" && script[i + 1] === "/")) i++;
            i += 2;
            stripped += " ";
            continue;
        }
        // String literal
        if (ch === '"' || ch === "'") {
            const q = ch;
            i++;
            while (i < len && script[i] !== q) {
                if (script[i] === "\\" && i + 1 < len) i++;
                i++;
            }
            i++;
            stripped += '""';
            continue;
        }
        // Template literal (handles ${...} interpolation depth)
        if (ch === "`") {
            i++;
            while (i < len && script[i] !== "`") {
                if (script[i] === "\\" && i + 1 < len) { i += 2; continue; }
                if (script[i] === "$" && i + 1 < len && script[i + 1] === "{") {
                    i += 2;
                    let td = 1;
                    while (i < len && td > 0) {
                        if (script[i] === "{") td++;
                        else if (script[i] === "}") td--;
                        i++;
                    }
                    continue;
                }
                i++;
            }
            i++;
            stripped += "``";
            continue;
        }

        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);

        if (depth === 0 && isIdent(ch) && (i === 0 || !isIdent(script[i - 1]))) {
            let j = i;
            while (j < len && isIdent(script[j])) j++;
            const word = script.slice(i, j);
            if (word === "return") hasTopLevelReturn = true;
            stripped += word;
            i = j;
            continue;
        }

        stripped += ch;
        i++;
    }

    if (hasTopLevelReturn) return script;

    // Trim trailing semicolons + whitespace from the stripped form.
    let tailEnd = stripped.length;
    while (tailEnd > 0) {
        const c = stripped[tailEnd - 1];
        if (c === ";" || isWs(c)) tailEnd--;
        else break;
    }
    let head = 0;
    while (head < tailEnd && isWs(stripped[head])) head++;
    if (head >= tailEnd) return script;
    if (stripped[head] !== "(" || stripped[tailEnd - 1] !== ")") return script;

    // Confirm the entire trimmed body is one parenthesised expression: bracket
    // depth must touch 0 only at tailEnd-1, never in between.
    let d = 0;
    let lastZeroAt = -1;
    for (let k = head; k < tailEnd; k++) {
        const c = stripped[k];
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") {
            d--;
            if (d === 0) lastZeroAt = k;
            if (d < 0) return script;
        }
    }
    if (lastZeroAt !== tailEnd - 1) return script;

    // Prepend `return ` at the original script's first non-whitespace position.
    let firstNonWs = 0;
    while (firstNonWs < script.length && isWs(script[firstNonWs])) firstNonWs++;
    return script.slice(0, firstNonWs) + "return " + script.slice(firstNonWs);
}

/**
 * The strict-mode prelude injected in front of every user script before it is
 * compiled. These `const … = undefined` shadows are belt-and-braces; the real
 * barrier is the Object.defineProperty(self, …) hardening block in the bootstrap.
 * Kept as a plain string so it is embedded verbatim into the compiled function body.
 */
const WORKER_SCRIPT_PRELUDE = [
    '"use strict";',
    "const self = undefined;",
    "const globalThis = undefined;",
    "const postMessage = undefined;",
    "const importScripts = undefined;",
    "const fetch = undefined;",
    "const XMLHttpRequest = undefined;",
    "const WebSocket = undefined;",
    "const EventSource = undefined;",
    "const Worker = undefined;",
    "const SharedWorker = undefined;",
    "const navigator = undefined;",
    "const caches = undefined;",
    "const indexedDB = undefined;",
    "",
].join("\n");

/**
 * The STATIC, script-free, namespace-free worker bootstrap. Built once, wrapped
 * in a Blob, and reused for every pooled worker. It never contains user script
 * text or generated namespace code — those arrive at runtime as DATA in a `run`
 * message, so there is no host-side dynamic code string beyond this fixed source.
 *
 * Lifecycle:
 *  - Captures the privileged AsyncFunction constructor and native postMessage into
 *    closure BEFORE any hardening or user code, so user scripts can neither name
 *    nor re-derive them (constructor chain is nulled during hardening).
 *  - Emits `{type:'ready'}` and idles until the host sends a `run` message.
 *  - First `run` adopts the transferred secure MessagePort, builds frozen stub
 *    globals from the code-free namespace manifest, then hardens the global object.
 *  - Every `run` compiles the delivered script via the captured AsyncFunction
 *    (giving it GLOBAL — not bootstrap-closure — scope), runs it, and posts
 *    `{execId, result|error}`. execId gating drops calls/results from a run that
 *    is no longer active (dangling timers/promises after completion or abort).
 *
 * One-shot pool workers run exactly one script and are terminated (fresh realm per
 * script). Reusable workers (opt-in) keep the same hardened realm across scripts —
 * a documented, same-context-only relaxation.
 */
function buildGenericWorkerBootstrap(): string {
    const prelude = JSON.stringify(WORKER_SCRIPT_PRELUDE);
    return `
(function () {
// Privileged references captured before hardening; unreachable from user scripts.
const _AsyncFn = (async function () {}).constructor;
const _postToMain = self.postMessage.bind(self);

let _securePort = null;
const _pendingCalls = new Map();
let _currentExecId = null;
let _apiTimeout = 3600000;
let _hardened = false;
const _PRELUDE = ${prelude};

const _finish = (execId, payload) => {
    // Only the run that currently owns the worker may post its result. A leaked
    // callback from a superseded run cannot deliver a result for the wrong exec.
    if (_currentExecId !== execId) return;
    // Post BEFORE releasing ownership: a swallowed postMessage failure used to strand
    // the run forever (the main thread waits out the full run timeout with nothing
    // pending). The usual cause is a non-structured-cloneable return value.
    try {
        _postToMain(Object.assign({ execId: execId }, payload));
    } catch (e) {
        var detail = "";
        try { detail = (e && (e.name || e.message)) ? String(e.name || e.message) : String(e); } catch (_) { detail = "unknown error"; }
        try {
            _postToMain({
                execId: execId,
                error: "Script result could not be transferred to the application (" + detail +
                    "). Return only structured-cloneable data: plain objects, arrays, strings, numbers, booleans, null."
            });
        } catch (_) { /* the port is gone; the run timeout is the only remaining backstop */ }
    }
    _currentExecId = null;
};

// Long-running scripts publish intermediate results here. If the run is later aborted
// or times out, the host still has the last payload to report instead of nothing.
const _progress = (value) => {
    const execId = _currentExecId;
    if (execId === null) return;
    try {
        _postToMain({ type: "progress", execId: execId, value: value });
    } catch (_) { /* non-cloneable progress is dropped; it must never break the run */ }
};

const _buildStubs = (manifest) => {
    if (!Array.isArray(manifest)) return;
    for (let i = 0; i < manifest.length; i++) {
        const entry = manifest[i];
        if (!entry || typeof entry.namespace !== "string") continue;
        const nsName = entry.namespace;
        const methods = Array.isArray(entry.methods) ? entry.methods : [];
        const ns = {};
        for (let j = 0; j < methods.length; j++) {
            const method = methods[j];
            if (typeof method !== "string") continue;
            ns[method] = function () {
                const params = Array.prototype.slice.call(arguments);
                return new Promise((resolve, reject) => {
                    const execId = _currentExecId;
                    if (execId === null) {
                        reject(new Error("No active script run."));
                        return;
                    }
                    const callId = Math.random().toString(36).substring(2);
                    const timeoutId = setTimeout(() => {
                        if (_pendingCalls.has(callId)) {
                            _pendingCalls.delete(callId);
                            reject(new Error("API Timeout: " + nsName + "." + method + " took longer than " + _apiTimeout + "ms"));
                        }
                    }, _apiTimeout);
                    _pendingCalls.set(callId, { resolve: resolve, reject: reject, timeoutId: timeoutId });
                    _securePort.postMessage({
                        type: "api-call",
                        execId: execId,
                        callId: callId,
                        namespace: nsName,
                        method: method,
                        params: params
                    });
                });
            };
        }
        Object.freeze(ns);
        try {
            Object.defineProperty(self, nsName, { value: ns, writable: false, configurable: false });
        } catch (_) { /* reserved global or already defined */ }
    }
};

const _harden = () => {
    if (_hardened) return;
    _hardened = true;

    // 'progress' is part of the script surface, not a namespace: install it once,
    // frozen, before the global lockdown below.
    try {
        Object.defineProperty(self, "progress", { value: _progress, writable: false, configurable: false });
    } catch (_) { /* already defined */ }

    // Null the constructor chain FIRST, while the global 'Function' binding is still
    // live. If we locked 'self.Function = undefined' first, the 'Function.prototype'
    // reference below would throw (undefined.prototype) and be swallowed — leaving
    // ({}).constructor.constructor('code')() reachable. Nulling before locking closes
    // that classic escape. Each defineProperty is guarded independently so one failure
    // cannot skip the rest.
    const _nullCtor = (proto) => {
        try {
            Object.defineProperty(proto, "constructor", { value: undefined, configurable: false });
        } catch (_) { /* already locked */ }
    };
    try {
        _nullCtor(Function.prototype);
        _nullCtor((async function () {}).constructor.prototype);
        _nullCtor((function* () {}).constructor.prototype);
        _nullCtor((async function* () {}).constructor.prototype);
    } catch (_) { /* best effort */ }

    const _lockGlobal = (name) => {
        try {
            Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
        } catch (_) { /* already locked */ }
    };
    // postMessage is locked too; result delivery uses the captured _postToMain.
    // addEventListener/removeEventListener are locked AFTER the bootstrap installed
    // its own run/error listeners, so a user script cannot register a spy that would
    // observe a later run's script text (relevant only to reusable, shared-realm workers).
    [
        "eval", "Function",
        "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
        "Worker", "SharedWorker", "importScripts",
        "postMessage", "navigator", "caches", "indexedDB",
        "addEventListener", "removeEventListener",
    ].forEach(_lockGlobal);

    try {
        Object.defineProperty(self, "onmessage", { value: null, writable: false, configurable: false });
    } catch (_) { /* already locked */ }
};

const _runHandler = (e) => {
    const data = e && e.data;
    if (!data || data.type !== "run") return;

    if (typeof data.apiTimeout === "number") _apiTimeout = data.apiTimeout;

    // First run adopts the secure port, builds stubs from data, and hardens.
    if (!_securePort) {
        if (!e.ports || !e.ports[0]) {
            _postToMain({ execId: data.execId, error: "Worker received a run without a secure port." });
            return;
        }
        _securePort = e.ports[0];
        _securePort.onmessage = (msg) => {
            const d = (msg && msg.data) || {};
            if (d.type === "api-response" && _pendingCalls.has(d.callId)) {
                const pending = _pendingCalls.get(d.callId);
                clearTimeout(pending.timeoutId);
                _pendingCalls.delete(d.callId);
                if (d.error) pending.reject(new Error(d.error));
                else pending.resolve(d.result);
            }
        };
        _buildStubs(data.namespaces);
        _harden();
    } else {
        // Reused worker: install namespaces granted since the last run. Existing
        // namespaces are already frozen non-configurable globals, so their
        // defineProperty simply throws and is skipped; only NEW ones get added.
        // Hardening never locked Object, so defineProperty is still available.
        _buildStubs(data.namespaces);
    }

    const execId = data.execId;
    _currentExecId = execId;

    let fn;
    try {
        fn = _AsyncFn(_PRELUDE + "\\n" + String(data.script));
    } catch (err) {
        _finish(execId, { error: (err && err.message) ? err.message : String(err) });
        return;
    }

    // fn runs in GLOBAL scope (Function-constructor semantics) — it cannot see any
    // bootstrap closure variable (_securePort, _AsyncFn, _pendingCalls, …).
    Promise.resolve().then(fn).then(
        (result) => _finish(execId, { result: result }),
        (err) => _finish(execId, { error: (err instanceof Error) ? err.message : String(err) })
    );
};

self.addEventListener("unhandledrejection", (event) => {
    if (event && event.preventDefault) event.preventDefault();
    if (_currentExecId !== null) {
        const reason = event ? event.reason : undefined;
        _finish(_currentExecId, { error: (reason && reason.message) ? reason.message : String(reason) });
    }
});

self.addEventListener("error", (event) => {
    if (event && event.preventDefault) event.preventDefault();
    if (_currentExecId !== null) {
        const msg = event ? ((event.error && event.error.message) || event.message) : null;
        _finish(_currentExecId, { error: msg || "Worker execution failed." });
    }
});

self.addEventListener("message", _runHandler);
_postToMain({ type: "ready" });
})();`;
}

/**
 * Lazily-created, cached Blob object URL for the static bootstrap. Reused by every
 * pooled worker so the source is parsed/compiled by the browser only once.
 */
let _workerBootstrapBlobUrl: string | null = null;
function getWorkerBootstrapUrl(): string {
    if (_workerBootstrapBlobUrl) return _workerBootstrapBlobUrl;
    const blob = new Blob([buildGenericWorkerBootstrap()], { type: "application/javascript" });
    _workerBootstrapBlobUrl = URL.createObjectURL(blob);
    return _workerBootstrapBlobUrl;
}

/**
 * A small pool of pre-warmed, pristine (never-executed) workers running the static
 * bootstrap. Acquiring one removes `new Worker()` spawn latency from the hot path;
 * a background refill keeps the pool topped up. On exhaustion `acquire()` spawns a
 * worker synchronously (correctness over latency). Pooled workers have run no user
 * code, so handing one out preserves the fresh-realm-per-script guarantee.
 */
class WorkerPool {
    protected maxSize: number;
    protected idle: Worker[] = [];
    protected _refillScheduled = false;

    constructor(maxSize = 2) {
        this.maxSize = Math.max(0, maxSize | 0);
    }

    setMaxSize(size: number): void {
        this.maxSize = Math.max(0, size | 0);
        this._scheduleRefill();
    }

    /** Pre-spawn up to maxSize warm workers (best-effort; safe to call repeatedly). */
    warm(): void {
        this._scheduleRefill();
    }

    /**
     * Spawn a bootstrap worker and resolve once it reports `{type:'ready'}`.
     * The ready handler is temporary; the caller installs its own onmessage on checkout.
     */
    protected _spawn(): Promise<Worker> {
        return new Promise((resolve, reject) => {
            let worker: Worker;
            try {
                worker = new Worker(getWorkerBootstrapUrl());
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            // A worker that neither reports 'ready' nor errors (blocked blob URL, throttled
            // tab) would otherwise leave every caller awaiting forever with nothing pending.
            // This bounds STARTUP only — it has no bearing on how long a script may run.
            const startupTimeoutId = setTimeout(() => {
                worker.removeEventListener("message", onReady);
                worker.onerror = null;
                try { worker.terminate(); } catch (_) { /* noop */ }
                reject(new Error("Script worker did not start within " + WORKER_STARTUP_TIMEOUT_MS + "ms."));
            }, WORKER_STARTUP_TIMEOUT_MS);

            const onReady = (event: MessageEvent<any>) => {
                if (event?.data?.type !== "ready") return;
                clearTimeout(startupTimeoutId);
                worker.removeEventListener("message", onReady);
                worker.onerror = null;
                resolve(worker);
            };
            worker.addEventListener("message", onReady);
            worker.onerror = (ev) => {
                clearTimeout(startupTimeoutId);
                worker.removeEventListener("message", onReady);
                try { worker.terminate(); } catch (_) { /* noop */ }
                reject(new Error((ev as ErrorEvent)?.message || "Worker failed to start."));
            };
        });
    }

    /**
     * Hand out a pristine warm worker. Returns a pooled one instantly when available,
     * otherwise spawns on demand. The returned worker has emitted `ready` and has no
     * message/error handlers installed.
     */
    async acquire(): Promise<Worker> {
        const pooled = this.idle.pop();
        this._scheduleRefill();
        if (pooled) {
            // Drop the idle-eviction handler; the caller installs its own.
            pooled.onerror = null;
            return pooled;
        }
        return this._spawn();
    }

    /** Discard a pooled worker that died while sitting idle, so it is never handed out. */
    protected _evictIdle(worker: Worker): void {
        const index = this.idle.indexOf(worker);
        if (index >= 0) this.idle.splice(index, 1);
        try { worker.terminate(); } catch (_) { /* noop */ }
        this._scheduleRefill();
    }

    protected _scheduleRefill(): void {
        if (this._refillScheduled) return;
        if (this.idle.length >= this.maxSize) return;
        this._refillScheduled = true;
        // Defer so refilling never blocks the acquiring caller.
        setTimeout(() => {
            this._refillScheduled = false;
            void this._refill();
        }, 0);
    }

    protected async _refill(): Promise<void> {
        while (this.idle.length < this.maxSize) {
            try {
                const worker = await this._spawn();
                // maxSize may have shrunk while awaiting.
                if (this.idle.length < this.maxSize) {
                    // Stay subscribed to failures while the worker waits in the pool,
                    // otherwise a worker that dies here is handed out dead and its run
                    // never settles.
                    worker.onerror = () => this._evictIdle(worker);
                    this.idle.push(worker);
                } else { try { worker.terminate(); } catch (_) { /* noop */ } }
            } catch (e) {
                console.warn("[ScriptingManager] Failed to pre-warm a script worker:", e);
                break;
            }
        }
    }

    /** Terminate all idle workers (teardown). */
    drain(): void {
        for (const worker of this.idle.splice(0)) {
            try { worker.terminate(); } catch (_) { /* noop */ }
        }
    }
}

async function dispatchWorkerApiCall<TNamespaces extends ScriptApiNamespaces>(
    manager: ScriptingManager<TNamespaces>,
    context: ScriptingContext<TNamespaces>,
    workerId: string,
    data: ApiCallMessage,
    port: MessagePort
): Promise<void> {
    const { namespace, method, params, callId, execId } = data;
    const nsConfig = manager.namespaces[namespace];
    context.touchWorker(workerId);

    // execId gating: reject calls from a run that no longer owns this worker
    // (leaked timers/promises firing after the script completed or was aborted).
    const record = context.getWorkerRecord(workerId);
    if (record && record.currentExecId != null && execId != null && record.currentExecId !== execId) {
        console.warn(`[Security] Dropped stale script call ${namespace}.${method} (exec ${execId} != ${record.currentExecId}).`);
        port.postMessage({
            type: "api-response",
            callId,
            error: `Stale script run: ${namespace}.${method} was issued by a superseded execution.`,
        } satisfies ApiResponseMessage);
        return;
    }

    if (isScriptingDebugEnabled()) {
        scriptingDebugLog("API_CALL", {
            contextId: context.id,
            activeViewerContextId: context.getActiveViewerContextId(),
            workerId, namespace, method, params, callId, execId,
        });
    }

    const workerTimeoutId = setTimeout(() => {
        console.warn(`Worker ${workerId} exceeded global timeout in context ${context.id}.`);
        port.postMessage({
            type: "api-response",
            callId,
            error: `API Timeout: ${namespace}.${method} exceeded global timeout.`,
        } satisfies ApiResponseMessage);
        context.terminateWorker(workerId);
    }, manager.apiTimeout);

    // Cross-namespace bypass guard:
    //  - Schema entries set by ingestApi/registerNamespace are booleans
    //    (true = consented, false = revoked). Method names that aren't on
    //    the namespace appear as `undefined`. Meta keys (`_docs`, `params`,
    //    …) are objects. We require the lookup to land on a boolean → the
    //    method is genuinely declared for *this* namespace.
    //  - `__self__: true` is a blanket namespace consent; it grants every
    //    real method of the namespace, but it must not bypass the existence
    //    check (the old code let `viewer.setActiveViewer` through because
    //    the bare action was registered globally).
    //  - Action lookup is fully-qualified only — no bare-name fallback —
    //    so a worker can't reach `application.setActiveViewer` from the
    //    `viewer` namespace by guessing the bare method name.
    const methodSchema = nsConfig
        ? (nsConfig as Record<string, unknown>)[method]
        : undefined;
    const isRealMethod = methodSchema === true || methodSchema === false;
    const consented = methodSchema === true
        || (isRealMethod && nsConfig?.["__self__"] === true);
    if (consented) {
        const action = manager.viewerActions[`${namespace}:${method}`];
        if (typeof action === "function") {
            try {
                const hostAction = action as ContextAwareHostAction;
                const result = hostAction.__scriptingContextAware
                    ? await hostAction(context, ...params)
                    : await hostAction(...params);
                clearTimeout(workerTimeoutId);
                if (isScriptingDebugEnabled()) {
                    scriptingDebugLog("API_RESULT", {
                        contextId: context.id, workerId, namespace, method, callId, result,
                    });
                }
                port.postMessage({ type: "api-response", callId, result } satisfies ApiResponseMessage);
            } catch (err) {
                clearTimeout(workerTimeoutId);
                if (isScriptingDebugEnabled()) {
                    scriptingDebugLog("API_ERROR", {
                        contextId: context.id, workerId, namespace, method, callId, error: err,
                    });
                }
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
    /** Session-scoped consent grants by action-class key; never serialized (see rememberActionConsent). */
    protected _actionConsentGrants: Set<string> = new Set();
    /** Optional viewer-identity aliasing (default: identity). Runtime only, never serialized. */
    protected _viewerIdAlias: import("./scripting/abstract-types").ViewerIdAlias | null = null;
    /** WorkerIds mid-acquisition (worker not yet registered) — so abort during the acquire await is not lost. */
    protected _acquiring: Set<string> = new Set();
    /** WorkerIds whose abort arrived while acquiring; consumed once the record registers. */
    protected _pendingAbort: Set<string> = new Set();
    /** Rejectors that settle an in-flight acquire the moment an abort arrives. */
    protected _acquireAborts: Map<string, (error: Error) => void> = new Map();
    /** Stored script results by handle (see storeResult). Runtime memory only, never serialized. */
    protected _storedResults: Map<string, { serialized: string; label?: string; createdAt: number }> = new Map();
    protected _storedResultsBytes = 0;
    protected _storedResultSeq = 0;

    /** Default `maxChars` for readStoredResult when the caller passes none. */
    static DEFAULT_RESULT_SLICE_CHARS = 8_000;

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
     * Install (or clear with `null`) a viewer-identity aliasing resolver on this context.
     * Default is identity — core / local scripting installs nothing and is unaffected. A
     * consumer that streams viewer context to an untrusted upstream (e.g. the chat module
     * → LLM) installs a resolver so the model only ever handles opaque handles, translated
     * back at this single chokepoint. Runtime only; never serialized into a session bundle.
     */
    setViewerIdAlias(alias: import("./scripting/abstract-types").ViewerIdAlias | null): this {
        this._viewerIdAlias = alias || null;
        return this.touch();
    }

    /** Opaque handle → real viewer id (identity when no alias installed or on error). */
    toInternalViewerId(id: string): string {
        const fn = this._viewerIdAlias?.toInternal;
        if (!fn || id == null) return id;
        try { return fn(id) ?? id; } catch (_) { return id; }
    }

    /** Real viewer id → opaque handle (identity when no alias installed or on error). */
    toPresentedViewerId(id: string): string {
        const fn = this._viewerIdAlias?.toPresented;
        if (!fn || id == null) return id;
        try { return fn(id) ?? id; } catch (_) { return id; }
    }

    /** Real viewer name → shown name (unchanged when no alias installed or on error). */
    presentViewerName(realId: string, name: string | null | undefined): string | null {
        const fn = this._viewerIdAlias?.presentName;
        if (!fn) return name ?? null;
        try { return fn(realId, name); } catch (_) { return name ?? null; }
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

    /**
     * Remember that the user granted consent for an action class (e.g. one remote
     * driver + feature) so repeated equivalent actions in this context don't
     * re-prompt. RUNTIME MEMORY ONLY — deliberately excluded from getState() so it
     * can never be serialized into a session bundle and replayed to skip consent.
     */
    rememberActionConsent(cacheKey: string): this {
        if (cacheKey) this._actionConsentGrants.add(cacheKey);
        return this.touch();
    }

    /** True when the user already granted consent for this action class in this context. */
    isActionConsented(cacheKey: string): boolean {
        return !!cacheKey && this._actionConsentGrants.has(cacheKey);
    }

    /**
     * Park a value under an opaque, context-scoped handle so a consumer (e.g. the
     * LLM chat) can replace an oversized inline script result with a bounded
     * preview and let the model read the rest back in slices via
     * `readStoredResult` / `application.readScriptResult`. The store is a bounded
     * LRU (`manager.resultStoreMaxEntries` / `resultStoreMaxBytes`, oldest evicted
     * first). RUNTIME MEMORY ONLY — deliberately excluded from getState() so stored
     * results can never be serialized into a session bundle. Handles are only
     * resolvable through this context; other contexts cannot read them.
     */
    storeResult(value: unknown, meta: { label?: string } = {}): string {
        let serialized: string;
        try {
            serialized = JSON.stringify(value === undefined ? null : value) ?? "null";
        } catch (_) {
            serialized = JSON.stringify(String(value));
        }

        const handle = `res-${++this._storedResultSeq}-${Math.random().toString(36).slice(2, 10)}`;
        this._storedResults.set(handle, { serialized, label: meta.label, createdAt: Date.now() });
        this._storedResultsBytes += serialized.length;

        const maxEntries = Math.max(1, this.manager.resultStoreMaxEntries | 0);
        const maxBytes = Math.max(1, this.manager.resultStoreMaxBytes | 0);
        for (const [oldHandle, entry] of this._storedResults) {
            if (this._storedResults.size <= maxEntries && this._storedResultsBytes <= maxBytes) break;
            // Never evict the entry just stored — a handle must be valid on return.
            if (oldHandle === handle) break;
            this._storedResults.delete(oldHandle);
            this._storedResultsBytes -= entry.serialized.length;
        }

        this.touch();
        return handle;
    }

    /**
     * Read a bounded slice of a stored result. `path` addresses into the stored
     * structure with dotted / bracketed segments (`items[3].name`); `offset` /
     * `maxChars` slice the serialized JSON text of the addressed value (raw text
     * when the addressed value is a string). Returns null for an unknown handle
     * (evicted, foreign context, or never issued).
     */
    readStoredResult(
        handle: string,
        opts: { path?: string; offset?: number; maxChars?: number } = {}
    ): StoredResultSlice | null {
        const entry = this._storedResults.get(handle);
        if (!entry) return null;
        this.touch();

        let target: unknown;
        try {
            target = JSON.parse(entry.serialized);
        } catch (_) {
            target = entry.serialized;
        }

        if (opts.path) {
            const segments = String(opts.path).match(/[^.[\]'"]+/g) || [];
            for (const segment of segments) {
                if (target == null || typeof target !== "object") {
                    target = undefined;
                    break;
                }
                target = (target as Record<string, unknown>)[segment];
            }
        }

        const serialized = typeof target === "string"
            ? target
            : (JSON.stringify(target === undefined ? null : target) ?? "null");

        const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
        const requested = Math.floor(Number(opts.maxChars) || 0);
        const maxChars = requested > 0 ? requested : ScriptingContext.DEFAULT_RESULT_SLICE_CHARS;
        const slice = serialized.slice(offset, offset + maxChars);

        return {
            slice,
            totalChars: serialized.length,
            offset,
            truncated: offset > 0 || offset + slice.length < serialized.length,
        };
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

    /** True when a script argument looks like a URL/module path (rejected for origin safety). */
    protected _looksLikeScriptUrl(script: string): boolean {
        const trimmed = script.trim();
        return trimmed.startsWith("http") || trimmed.endsWith(".js") || trimmed.endsWith(".mjs");
    }

    /**
     * Acquire a pristine warm worker from the manager pool, wire its api-call channel
     * and result routing, and register a WorkerRecord for `workerId`. The worker has
     * run no user code yet; the caller drives it with `_dispatchRun`.
     */
    protected async _acquireWorkerRecord(workerId: string, reusable: boolean): Promise<WorkerRecord> {
        const worker = await this.manager.workerPool.acquire();
        const channel = new MessageChannel();

        channel.port1.onmessage = (event: MessageEvent<ApiCallMessage>) => {
            void dispatchWorkerApiCall(this.manager, this, workerId, event.data, channel.port1);
        };

        const record: WorkerRecord = {
            worker,
            channel,
            contextId: this._id,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            reusable,
            initialized: false,
            currentExecId: null,
            runs: new Map(),
        };

        // Route worker results (keyed by execId) to the awaiting run. A reusable
        // worker delivers many results over its life; a one-shot worker exactly one.
        worker.onmessage = (event: MessageEvent<{ type?: string; execId?: string; result?: unknown; error?: string; value?: unknown }>) => {
            const { type, execId, result, error, value } = event.data || {};
            if (execId == null) return; // ignore stray messages (e.g. a late 'ready')
            const run = record.runs?.get(execId);
            if (!run) return;

            // Intermediate payload from a long-running script: report it and keep waiting.
            if (type === "progress") {
                run.lastProgress = value;
                record.lastUsedAt = Date.now();
                try { run.onProgress?.(value); } catch (e) {
                    console.warn("[ScriptingManager] onProgress handler failed:", e);
                }
                return;
            }

            clearTimeout(run.timeoutId);
            record.runs!.delete(execId);
            if (record.currentExecId === execId) record.currentExecId = null;
            record.lastUsedAt = Date.now();

            scriptingDebugLog("EXECUTE_SCRIPT_MESSAGE", { contextId: this._id, workerId, execId, result, error });

            // A one-shot worker never runs a second script — discard it (fresh realm per script).
            if (!record.reusable) this.terminateWorker(workerId);

            if (error) run.reject(new Error(error));
            else run.resolve(result);
        };

        worker.onerror = (event: ErrorEvent) => {
            scriptingDebugLog("EXECUTE_SCRIPT_WORKER_ERROR", {
                contextId: this._id, workerId,
                message: event.message, filename: event.filename,
                lineno: event.lineno, colno: event.colno, error: event.error,
            });
            // Fail every in-flight run and drop the worker.
            const pending = record.runs ? [...record.runs.values()] : [];
            record.runs?.clear();
            this.terminateWorker(workerId);
            for (const r of pending) {
                clearTimeout(r.timeoutId);
                r.reject(withPartialResult(new Error(event.message || "Script worker failed."), r.lastProgress));
            }
        };

        this.registerWorker(workerId, record);
        scriptingDebugLog("WORKER_CREATED", {
            contextId: this._id, label: this._label,
            activeViewerContextId: this._activeViewerContextId, workerId, reusable,
        });
        return record;
    }

    /**
     * Send one `run` message and return a promise for its result. On the first run
     * for a worker the secure port is transferred (adopted + globals hardened
     * worker-side). The code-free namespace manifest is sent on EVERY run so a
     * reused worker picks up namespaces registered/consented after its first run
     * (worker-side stub build skips already-frozen namespaces, adds new ones).
     * A per-run timeout terminates a wedged worker.
     */
    protected _dispatchRun(
        record: WorkerRecord,
        workerId: string,
        script: string,
        execId: string,
        onProgress?: (value: unknown) => void
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                scriptingDebugLog("EXECUTE_SCRIPT_TIMEOUT", { contextId: this._id, workerId, execId });
                const lastProgress = record.runs?.get(execId)?.lastProgress;
                record.runs?.delete(execId);
                if (record.currentExecId === execId) record.currentExecId = null;
                this.terminateWorker(workerId);
                reject(withPartialResult(new Error("Script execution timed out."), lastProgress));
            }, this.manager.apiTimeout);

            record.runs!.set(execId, { resolve, reject, timeoutId, onProgress });
            record.currentExecId = execId;
            record.lastUsedAt = Date.now();

            const firstRun = !record.initialized;
            const message: import("./scripting/abstract-types").RunWorkerMessage = {
                type: "run",
                execId,
                script,
                apiTimeout: this.manager.apiTimeout,
                // Sent every run: the worker adds namespaces granted since its last
                // run and skips ones already installed (see _buildStubs). First run
                // additionally transfers the secure port below.
                namespaces: buildNamespaceManifestForWorker(this.manager.namespaces),
            };

            try {
                if (firstRun) {
                    record.worker.postMessage(message, [record.channel.port2]);
                    record.initialized = true;
                } else {
                    record.worker.postMessage(message);
                }
            } catch (err) {
                clearTimeout(timeoutId);
                record.runs?.delete(execId);
                if (record.currentExecId === execId) record.currentExecId = null;
                this.terminateWorker(workerId);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    /**
     * Run one script on `record`, serializing against any prior run still owning a
     * reusable worker (the worker tracks a single active exec; overlapping runs would
     * race it). One-shot workers have a unique workerId and never overlap, so they
     * dispatch directly.
     */
    protected _enqueueRun(
        record: WorkerRecord,
        workerId: string,
        script: string,
        execId: string,
        onProgress?: (value: unknown) => void
    ): Promise<unknown> {
        if (!record.reusable) {
            return this._dispatchRun(record, workerId, script, execId, onProgress);
        }
        const prior = record.busyTail || Promise.resolve();
        const runOnce = () => this._dispatchRun(record, workerId, script, execId, onProgress);
        const result = prior.then(runOnce, runOnce);
        record.busyTail = result.then(() => undefined, () => undefined);
        return result;
    }

    /**
     * Acquire a worker record while honoring an abort that lands during the
     * acquire await. `_acquireWorkerRecord` only registers the worker after the
     * pooled worker resolves, so `abortScript(workerId)` fired in that window would
     * find no record and no-op — leaving the freshly-acquired worker to run a
     * script the user already cancelled. We flag the id as acquiring (so
     * terminateWorker records the intent), then drop the worker if the abort landed.
     */
    protected async _acquireGuarded(workerId: string, reuse: boolean): Promise<WorkerRecord> {
        this._acquiring.add(workerId);

        // The abort must settle the CALLER immediately. Waiting for the acquisition to
        // resolve first means an acquire that never resolves (worker fails to start) can
        // never be cancelled — the caller hangs with nothing pending.
        let abortAcquire: (error: Error) => void = () => { /* replaced below */ };
        const aborted = new Promise<never>((_, reject) => {
            abortAcquire = (error: Error) => reject(error);
        });
        aborted.catch(() => { /* an abort landing after a successful acquire is not an error */ });
        this._acquireAborts.set(workerId, abortAcquire);

        const acquisition = this._acquireWorkerRecord(workerId, reuse);
        try {
            if (this._pendingAbort.has(workerId)) {
                throw new Error("Script aborted.");
            }
            const record = await Promise.race([acquisition, aborted]);
            if (this._pendingAbort.has(workerId)) {
                this.terminateWorker(workerId, "aborted");
                throw new Error("Script aborted.");
            }
            return record;
        } catch (error) {
            // The abort may have won the race: whatever the acquisition eventually
            // produces must be discarded, never left running the cancelled script.
            void acquisition.then(
                () => this.terminateWorker(workerId, "aborted"),
                () => { /* acquisition failed on its own */ }
            );
            throw error;
        } finally {
            this._acquireAborts.delete(workerId);
            this._acquiring.delete(workerId);
            this._pendingAbort.delete(workerId);
        }
    }

    async executeScript(script: string, options: ExecuteScriptOptions = {}): Promise<unknown> {
        // Namespace ingest may still be running (boot no longer awaits it);
        // workers snapshot the namespace manifest at init, so wait for the
        // (idempotent) bootstrap before drawing one.
        await this.manager.initialize();

        const workerId = options.workerId || this.createWorkerId("script");
        const reuse = !!options.reuseWorker;

        scriptingDebugLog("EXECUTE_SCRIPT_START", {
            contextId: this._id, label: this._label,
            activeViewerContextId: this._activeViewerContextId, workerId, options, script,
        });

        if (this._looksLikeScriptUrl(script)) {
            throw new Error("Creating a worker from a URL is not supported for origin security reasons. Use serialized script text.");
        }

        const transformed = maybeAutoReturnTrailingIife(script);
        const execId = createExecId();

        // Reuse an existing, initialized, reusable worker (opt-in, same context).
        const existing = this._workers[workerId];
        let record: WorkerRecord;
        if (reuse && existing && existing.reusable && existing.initialized) {
            record = existing;
        } else {
            if (existing) this.terminateWorker(workerId); // collision or non-reusable stale worker
            try {
                record = await this._acquireGuarded(workerId, reuse);
            } catch (error) {
                scriptingDebugLog("EXECUTE_SCRIPT_CREATE_WORKER_ERROR", { contextId: this._id, workerId, error });
                throw error instanceof Error ? error : new Error(String(error));
            }
        }

        return this._enqueueRun(record, workerId, transformed, execId, options.onProgress);
    }

    /**
     * Fire-and-forget: run a script in a fresh (or reused) worker bound to this
     * context and return the underlying Worker. Prefer `executeScript`, which
     * awaits the result. Async because workers are drawn from the warm pool.
     */
    async createWorker(script: string, options: ExecuteScriptOptions = {}): Promise<Worker | null> {
        if (this._looksLikeScriptUrl(script)) {
            console.warn("Creating a worker from a URL is not supported now due to origin security reasons. Use serialized text.");
            return null;
        }
        // See executeScript: worker manifests need the bootstrap ingest done.
        await this.manager.initialize();
        const workerId = options.workerId || this.createWorkerId("script");
        const reuse = !!options.reuseWorker;

        const existing = this._workers[workerId];
        let record: WorkerRecord;
        if (reuse && existing && existing.reusable && existing.initialized) {
            record = existing;
        } else {
            if (existing) this.terminateWorker(workerId);
            try {
                record = await this._acquireGuarded(workerId, reuse);
            } catch (error) {
                scriptingDebugLog("CREATE_WORKER_ACQUIRE_ERROR", { contextId: this._id, workerId, error });
                return null;
            }
        }
        // Kick the run; swallow the result (fire-and-forget). Rejections are logged.
        void this._enqueueRun(record, workerId, maybeAutoReturnTrailingIife(script), createExecId())
            .catch((e) => scriptingDebugLog("CREATE_WORKER_RUN_ERROR", { contextId: this._id, workerId, error: e }));
        return record.worker;
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
        if (!record) {
            // The worker is still being drawn from the pool (executeScript/createWorker
            // is awaiting acquire), so there is nothing to terminate yet. Remember the
            // abort so the acquire path drops the worker instead of running the script —
            // otherwise abortScript() silently no-ops during the acquisition window.
            if (this._acquiring.has(workerId)) {
                this._pendingAbort.add(workerId);
                // Settle the awaiting caller now instead of after the acquire resolves —
                // an acquire that never resolves would otherwise be uncancellable.
                this._acquireAborts.get(workerId)?.(
                    new Error(reason === "aborted" ? "Script aborted." : "Script worker terminated.")
                );
            }
            return;
        }

        // Snapshot and clear pending runs first so we can reject them below without
        // the worker's own onmessage (fired by nothing after terminate) racing us.
        const pending = record.runs ? [...record.runs.values()] : [];
        record.runs?.clear();
        record.currentExecId = null;

        try { record.worker.terminate(); } catch (_) { /* noop */ }
        try { record.channel.port1.close(); } catch (_) { /* noop */ }
        this.unregisterWorker(workerId);

        if (pending.length) {
            const message = reason === "aborted" ? "Script aborted." : "Script worker terminated.";
            for (const r of pending) {
                clearTimeout(r.timeoutId);
                // Carry whatever the script published before it was stopped.
                r.reject(withPartialResult(new Error(message), r.lastProgress));
            }
        }

        scriptingDebugLog("WORKER_TERMINATED", {
            contextId: this._id,
            workerId,
            reason,
        });
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
    /** Cached, cache-busting `.d.ts` fetch — for external `dtypesSource.resolve` callbacks. */
    static fetchDtsCached: typeof fetchDtsCached;

    contexts: Record<string, ScriptingContext<TNamespaces>>;
    defaultContextId: string;
    viewerActions: ViewerActionMap<TNamespaces>;
    apiTimeout: number;
    /** Bounds for the per-context stored-result LRU (see ScriptingContext.storeResult). */
    resultStoreMaxEntries = 32;
    resultStoreMaxBytes = 20 * 1024 * 1024;
    namespaces: NamespacesState<TNamespaces>;
    /** Pool of pre-warmed, pristine one-shot workers shared by every context. */
    readonly workerPool: WorkerPool;
    ready: Promise<void> | undefined;
    protected _bootstrapClosed: boolean;
    protected _initializing: boolean;
    protected _processedExternalRegistrations: Set<ExternalScriptApiRegistration<TNamespaces>>;
    protected _apiInstances: Map<string, XOpatScriptingApi> = new Map();
    protected _namespacesChangedHandlers: Set<(namespace: string | null, reason: string) => void> = new Set();
    protected readonly _discoveryMethodName = "describeScriptingApi";

    static instance(): ScriptingManager<any> {
        return this.__self || new this();
    }

    /**
     * Synthetic invocation context for in-process callers (modules / plugins /
     * core code) that reach a script API directly via `getApi()` instead of
     * the worker RPC envelope. Active viewer is auto-resolved through
     * VIEWER_MANAGER. `bypassConsent` is opt-in — defaults to false so that
     * any mutating method called through this path still triggers the
     * Playground review / consent dialog.
     */
    static inProcessContext(bypassConsent: boolean = false): import("./scripting/abstract-types").HostScriptContext {
        return {
            id: "__in_process__",
            getActiveViewerContextId: () => {
                const vm: any = (globalThis as any).VIEWER_MANAGER;
                return vm?.getActiveUniqueId?.() || vm?.active?.uniqueId || vm?.viewers?.[0]?.uniqueId;
            },
            activeViewerContextId: undefined,
            isConsentDialogBypassed: () => bypassConsent,
        } as any;
    }

    /**
     * Return a script API namespace bound to an in-process invocation context.
     * For trusted main-thread callers (modules / plugins / core code) that
     * need to read state or render pixels without going through the worker
     * RPC envelope. Trust boundary matches `singletonModule()` / `plugin()` —
     * worker scripts cannot reach this path (the RPC dispatcher builds its
     * own per-call context from worker-side metadata).
     *
     * Active viewer is auto-resolved via VIEWER_MANAGER. Consent / Playground
     * review prompts fire by default; pass `{ bypassConsent: true }` only
     * when the caller has audited every method it will invoke and accepts
     * silent mutation. Default-off keeps mutating-method calls visible to
     * the user even when reached through this accessor.
     */
    getApi<T extends XOpatScriptingApi = XOpatScriptingApi>(
        namespace: string,
        options: { bypassConsent?: boolean } = {},
    ): T | undefined {
        const api = this._apiInstances.get(namespace) as T | undefined;
        if (!api) return undefined;
        return api.bindInvocationContext({
            scriptingContext: ScriptingManager.inProcessContext(options.bypassConsent === true),
        }) as T;
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

    constructor(viewerActions: ViewerActionMap<TNamespaces> = {}, apiTimeout = 3_600_000, poolSize = 2) {
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
        this.workerPool = new WorkerPool(poolSize);
        this._bootstrapClosed = false;
        this._initializing = false;
        this._processedExternalRegistrations = new Set();
        this.ready = undefined;
        this.createContext({ id: this.defaultContextId, label: "Default" });
    }

    // ── Persistent "don't ask again" action consent ─────────────────────────
    // Cross-session remember for per-action-class confirmation dialogs. Stored in the core owner's
    // kv:cache (localStorage, user-local) as { [cacheKey]: expiresAt } — NEVER in the session bundle,
    // and never read from imported session data, so an imported peer session cannot replay consent.
    // The per-context runtime Set (_actionConsentGrants) remains the in-session layer and stays
    // excluded from getState().

    static SCRIPT_ACTION_CONSENT_KEY = 'script-action-consent:v1';
    protected _actionConsentKvHandle: any = undefined;

    protected _actionConsentKv(): any {
        if (this._actionConsentKvHandle !== undefined) return this._actionConsentKvHandle;
        try {
            const io = (globalThis as any).APPLICATION_CONTEXT?.io;
            this._actionConsentKvHandle = io?.kv?.('core', 'kv:cache') ?? null;
        } catch (_) {
            this._actionConsentKvHandle = null;
        }
        return this._actionConsentKvHandle;
    }

    protected _readActionConsentMap(): Record<string, number> {
        try {
            const raw = this._actionConsentKv()?.get?.(ScriptingManager.SCRIPT_ACTION_CONSENT_KEY);
            if (!raw || typeof raw !== 'string') return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed as Record<string, number> : {};
        } catch (_) {
            return {};
        }
    }

    protected _writeActionConsentMap(map: Record<string, number>): void {
        try {
            const kv = this._actionConsentKv();
            if (!kv) return;
            if (Object.keys(map).length) kv.set?.(ScriptingManager.SCRIPT_ACTION_CONSENT_KEY, JSON.stringify(map));
            else kv.delete?.(ScriptingManager.SCRIPT_ACTION_CONSENT_KEY);
        } catch (_) {
            // best-effort — a storage failure just means the user is re-prompted next time
        }
    }

    /** True when the local user persistently chose "don't ask again" for this action class (unexpired). */
    isActionConsentRemembered(cacheKey: string): boolean {
        if (!cacheKey) return false;
        const map = this._readActionConsentMap();
        const now = Date.now();
        let pruned = false;
        for (const [k, exp] of Object.entries(map)) {
            if (!Number.isFinite(exp) || (exp as number) <= now) { delete map[k]; pruned = true; }
        }
        if (pruned) this._writeActionConsentMap(map);
        return Object.prototype.hasOwnProperty.call(map, cacheKey);
    }

    /** Persist a "don't ask again" grant for this action class for `ttlMs` from now. */
    rememberActionConsentPersistent(cacheKey: string, ttlMs: number): void {
        if (!cacheKey || !Number.isFinite(ttlMs) || ttlMs <= 0) return;
        const map = this._readActionConsentMap();
        map[cacheKey] = Date.now() + ttlMs;
        this._writeActionConsentMap(map);
    }

    /** Forget all persisted "don't ask again" grants (for a future settings control). */
    clearRememberedActionConsents(): void {
        this._writeActionConsentMap({});
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
            const builtins: XOpatScriptingApi[] = [
                new XOpatApplicationScriptApi("application"),
                new XOpatViewerScriptApi("viewer"),
                new XOpatVisualizationScriptApi("visualization"),
                new XOpatPatientScriptApi("patient"),
            ];

            // Warm the declaration cache up front so the serial ingest below —
            // kept sequential to preserve deterministic namespace order — does
            // not pay one network round-trip per namespace. Errors are ignored
            // here; the ingest path re-resolves and reports them properly.
            for (const api of builtins) {
                const source = (api.constructor as any)?.ScriptApiMetadata?.dtypesSource;
                try {
                    if (source?.kind === "url") void fetchDtsCached(source.value).catch(() => {});
                    else if (source?.kind === "resolve") void Promise.resolve(source.value()).catch(() => {});
                } catch { /* prefetch is best-effort */ }
            }

            for (const api of builtins) {
                await this.ingestApi(api);
            }

            const staticContext = this.constructor as unknown as ScriptManagerStatic<TNamespaces>;
            const externalRegistrations = [...(staticContext.__externalApiRegistrations || [])];
            for (const registration of externalRegistrations) {
                await this._ingestExternalRegistration(registration);
            }
        } finally {
            this._initializing = false;
            this._bootstrapClosed = true;
            // Pre-spawn warm workers so the first script execution avoids spawn latency.
            this.workerPool.warm();
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
            sensitive: !!(apiInstance as any).sensitive,
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

                // Fully-qualified key only. A bare `viewerActions[name]`
                // alias woud let worker guess the bare name — see the cross-namespace ACL
                // guard in dispatchWorkerApiCall.
                this.viewerActions[`${ns}:${name}`] = boundFn;

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

            // Every namespace is independently self-describing. Expose a synthetic
            // `describeScriptingApi()` unless the API already declares its own (e.g.
            // `application`, which offers a richer cross-namespace variant).
            const discoveryName = this._discoveryMethodName;
            if (!(discoveryName in schema)) {
                (schema as any)[discoveryName] = true;
                this._attachNamespaceDiscovery(ns);
                (methodsDocs as any)[discoveryName] = "Returns this namespace's full method signatures and TypeScript declarations. Optional: methods can be called directly; use this to browse the namespace's API when deciding what to do.";
                (paramsDocs as any)[discoveryName] = [];
                (returnTypes as any)[discoveryName] = "object";
                (tsSignatures as any)[discoveryName] = `${discoveryName}(): object`;
                (tsDeclarations as any)[discoveryName] = `${discoveryName}(): object;`;
            }

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
            this._apiInstances.set(ns, apiInstance);
            console.log(`Registered API namespace '${ns}'.`, this.namespaces[ns]);
            this._notifyNamespacesChanged(ns, "ingest");

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

        const discoveryName = this._discoveryMethodName;
        if (!(discoveryName in this.namespaces[namespace])) {
            (this.namespaces[namespace] as any)[discoveryName] = true;
            this._attachNamespaceDiscovery(namespace);
        }

        this._notifyNamespacesChanged(namespace, "register");
    }

    /**
     * Manifest memoization. The full manifest (all namespaces × methods with docs and
     * TS declarations) is requested before every chat model step; rebuilding it each
     * time is pure waste and — worse — a fresh object per call defeats downstream
     * payload/prompt stability. The generation counter bumps on every mutation of the
     * underlying state: namespace registration/ingest (_notifyNamespacesChanged) and
     * actual consent changes (grantNamespaceConsent / setConsent). Completeness of
     * those bump sites is what keeps this cache correct.
     */
    protected _manifestGeneration = 0;
    protected _manifestCache: { generation: number; value: AllowedScriptApiManifest } | null = null;

    /**
     * Documentation entry for one method of a namespace schema. Shared by
     * `getAllowedApiManifest` and `getMethodManifest` so both render the same
     * method byte-identically (downstream prompt stability depends on it).
     */
    protected _buildMethodManifestEntry(
        schema: NamespaceSchema<any>,
        methodName: string
    ): AllowedScriptApiManifest["namespaces"][number]["methods"][number] {
        return {
            name: methodName,
            description: schema._docs?.[methodName],
            params: schema.params?.[methodName] || [],
            returns: schema.returnType?.[methodName] || "void",
            tsSignature: schema.tsSignature?.[methodName],
            tsDeclaration: schema.tsDeclaration?.[methodName],
        };
    }

    getAllowedApiManifest(allowedNamespaces?: string[]): AllowedScriptApiManifest {
        const cacheable = !allowedNamespaces;
        if (cacheable && this._manifestCache?.generation === this._manifestGeneration) {
            return this._manifestCache.value;
        }
        const allowedSet = allowedNamespaces ? new Set(allowedNamespaces) : null;
        const namespaces: AllowedScriptApiManifest["namespaces"] = [];

        for (const [namespace, schema] of Object.entries(this.namespaces || {})) {
            if (allowedSet && !allowedSet.has(namespace)) continue;
            if (!schema?.__self__) continue;

            const methods: AllowedScriptApiManifest["namespaces"][number]["methods"] = [];

            for (const [methodName, enabled] of Object.entries(schema)) {
                // Schema meta keys (name, description, sensitive, doc maps, …) are
                // not methods — without this they leak into the manifest as fake
                // method entries for ingested namespaces.
                if (WORKER_SCHEMA_META_KEYS.has(methodName)) continue;

                if (!schema.__self__ && !enabled) continue;

                methods.push(this._buildMethodManifestEntry(schema, methodName));
            }

            namespaces.push({
                namespace,
                name: schema.name,
                description: schema.description,
                sensitive: !!schema.sensitive,
                tsDeclaration: schema.namespaceTsDeclaration,
                methods,
            });
        }

        const manifest = { namespaces };
        if (cacheable) {
            this._manifestCache = { generation: this._manifestGeneration, value: manifest };
        }
        return manifest;
    }

    /**
     * Consent-filtered documentation slices for specific `namespace.method`
     * references (typically produced by `extractApiReferences` over a script).
     * References to unknown namespaces, unknown methods, or methods the caller is
     * not consented to use come back as `found: false` with no documentation
     * attached — this can never leak docs past consent. Duplicate refs collapse.
     */
    getMethodManifest(refs: Array<{ namespace: string; method: string }>): ScriptMethodManifestEntry[] {
        const seen = new Set<string>();
        const result: ScriptMethodManifestEntry[] = [];

        for (const ref of refs || []) {
            const namespace = ref?.namespace;
            const method = ref?.method;
            if (typeof namespace !== "string" || typeof method !== "string") continue;
            const key = `${namespace}:${method}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const schema = this.namespaces[namespace];
            const methodSchema = schema ? (schema as Record<string, unknown>)[method] : undefined;
            // Mirrors the dispatchWorkerApiCall consent guard: a real method is a
            // boolean schema entry; it is callable when individually consented or
            // blanket-allowed via the namespace's `__self__`.
            const isRealMethod = methodSchema === true || methodSchema === false;
            const consented = !WORKER_SCHEMA_META_KEYS.has(method) && isRealMethod
                && (methodSchema === true || schema?.__self__ === true);

            // `consented` already encodes "individually granted OR blanket __self__"
            // (and is false for unknown namespaces/methods), matching
            // dispatchWorkerApiCall + getAllowedApiManifest. Do NOT additionally
            // require blanket __self__ here or individually-consented methods that
            // genuinely work would report found:false with no docs.
            if (!consented) {
                result.push({ namespace, method, found: false });
                continue;
            }

            const { name: _name, ...docs } = this._buildMethodManifestEntry(schema, method);
            result.push({ namespace, method, found: true, ...docs });
        }

        return result;
    }

    /**
     * Statically scan a script for `namespace.method` member references against a
     * known namespace set. Pure text scan — no evaluation. Consumers (e.g. the LLM
     * chat) use it to attach exact method documentation to execution feedback.
     * False positives are harmless (they only select docs to attach); references
     * through aliases (`const p = pathology; p.foo()`) are not resolved.
     */
    static extractApiReferences(
        script: string,
        knownNamespaces: readonly string[]
    ): Array<{ namespace: string; method: string }> {
        if (typeof script !== "string" || !script) return [];
        const names = (knownNamespaces || []).filter(
            (ns) => typeof ns === "string" && NAMESPACE_TOKEN_RE.test(ns)
        );
        if (!names.length) return [];

        const re = new RegExp(`\\b(${names.join("|")})\\s*\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, "g");
        const seen = new Set<string>();
        const refs: Array<{ namespace: string; method: string }> = [];
        let match: RegExpExecArray | null;
        while ((match = re.exec(script)) !== null) {
            const key = `${match[1]}:${match[2]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            refs.push({ namespace: match[1]!, method: match[2]! });
        }
        return refs;
    }

    /**
     * Monotonic counter identifying the current namespace/consent state. Bumped on
     * namespace registration/ingest and on consent changes. Consumers holding
     * derived state (e.g. a reusable worker whose frozen stubs cannot gain methods)
     * compare generations to decide when to rebuild.
     */
    get manifestGeneration(): number {
        return this._manifestGeneration;
    }

    getNamespaceConsentEntries(): Record<string, ScriptNamespaceConsentEntry> {
        const result: Record<string, ScriptNamespaceConsentEntry> = {};

        for (const [namespace, schema] of Object.entries(this.namespaces || {})) {
            result[namespace] = {
                title: schema.name,
                description: schema.description,
                granted: false,
                sensitive: !!schema.sensitive
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
                dtsText = await fetchDtsCached(source.value);
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
        if (this.namespaces[namespace][method] !== value) {
            this.namespaces[namespace][method] = value;
            this._manifestGeneration++;
        }
    }

    grantNamespaceConsent(namespace: string, value: boolean): void {
        if (!this.namespaces[namespace]) this.namespaces[namespace] = { __self__: false };
        if (this.namespaces[namespace]["__self__"] !== value) {
            this.namespaces[namespace]["__self__"] = value;
            this._manifestGeneration++;
        }
    }

    /**
     * Subscribe to namespace-set changes. The handler fires whenever a scripting
     * namespace is registered (including plugins/modules loaded after bootstrap),
     * letting consumers (e.g. the LLM chat) surface and request consent for newly
     * available capabilities. Returns an unsubscribe function.
     */
    addNamespacesChangedHandler(handler: (namespace: string | null, reason: string) => void): () => void {
        this._namespacesChangedHandlers.add(handler);
        return () => this.removeNamespacesChangedHandler(handler);
    }

    removeNamespacesChangedHandler(handler: (namespace: string | null, reason: string) => void): void {
        this._namespacesChangedHandlers.delete(handler);
    }

    protected _notifyNamespacesChanged(namespace: string | null, reason: string): void {
        this._manifestGeneration++;
        for (const handler of this._namespacesChangedHandlers) {
            try {
                handler(namespace, reason);
            } catch (e) {
                console.error("[ScriptingManager] namespaces-changed handler failed:", e);
            }
        }
    }

    /**
     * Attach a synthetic, consent-filtered self-describe host action to a namespace
     * so any granted namespace is independently discoverable: the model can call
     * `<namespace>.describeScriptingApi()` to obtain that namespace's full method
     * signatures and TypeScript declarations, even when the `application` namespace
     * itself is not granted. The result is consent-filtered (only the namespace's
     * own, granted manifest is returned).
     */
    protected _attachNamespaceDiscovery(namespace: string): void {
        const manager = this;
        this.viewerActions[`${namespace}:${this._discoveryMethodName}`] = Object.assign(
            () => manager.getAllowedApiManifest([namespace]),
            { __scriptingContextAware: false }
        ) as ContextAwareHostAction;
    }
}

ScriptingManager.XOpatScriptingApi = XOpatScriptingApi;
ScriptingManager.ScriptingContext = ScriptingContext;
ScriptingManager.fetchDtsCached = fetchDtsCached;
(window as any).ScriptingManager = ScriptingManager;
