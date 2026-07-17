// Instance-level fault isolation for OpenSeadragon EventSource dispatch.
//
// OSD invokes handlers bare: `getHandler` (openseadragon.js, dispatch loop) and
// `raiseEvent` have no try/catch, and `updateMulti` re-arms requestAnimationFrame
// *after* `updateOnce` returns. A single throwing handler on any event raised from
// inside `updateOnce` (`animation`, `animation-finish`, `update-viewport`, ...)
// therefore aborts the frame before the loop is rescheduled and the canvas stops
// rendering permanently, with no recovery path. A broken plugin/module must never
// be able to do that to the core viewer.
//
// The vendored library must not be patched here (AGENTS.md §1.6/§1.7), so instead
// every EventSource xOpat owns gets its registration API wrapped: handlers passed
// through `addHandler`/`addOnceHandler` run inside a try/catch, faults are reported
// through the standard `error-user` surface, and a handler that keeps throwing is
// unregistered so it cannot storm the render loop frame after frame.
//
// The upstream fix (try/finally around `updateOnce` + per-handler try/catch in
// `getHandler`) belongs in OpenSeadragon itself; see src/EVENTS.md.

/** Faults tolerated per (source, event, handler) before the handler is unregistered. */
const MAX_CONSECUTIVE_FAULTS = 3;

/**
 * Events whose sync throw is a documented control signal rather than a bug:
 * `before-app-init` aborts viewer loading (see src/EVENTS.md), and the refresh/open
 * hooks abort the cycle the same way. Async handlers on these events reject their
 * promise instead, which flows through `raiseEventAwaiting` untouched — this list
 * only preserves the semantics for *synchronous* handlers.
 */
const RETHROW_EVENTS = new Set<string>(["before-app-init", "before-refresh", "before-open"]);

const ISOLATION_TOKEN = Symbol("XOpatEventIsolation");

interface HandlerState {
    /** Consecutive faults; reset by any successful invocation. */
    faults: number;
    /** Whether the first fault was already reported in full. */
    reported: boolean;
}

interface OwnedRecord {
    source: any;
    eventName: string;
    original: Function;
}

interface IsolationState {
    label: string;
    /** eventName -> original handler -> wrapped handler installed in OSD. */
    wrapped: Map<string, WeakMap<Function, Function>>;
    /** eventName -> original handler -> fault bookkeeping. */
    faults: Map<string, WeakMap<Function, HandlerState>>;
}

/** ownerId -> handlers registered while that owner was the current owner. */
const OWNED: Map<string, OwnedRecord[]> = new Map();

/** Stack of owner ids; the top is attributed to any handler registered right now. */
const OWNER_STACK: string[] = [];

/** Re-entrancy guard: reporting a fault raises an event, which runs guarded handlers. */
let REPORTING = false;

/**
 * Run `fn` with `ownerId` attributed to every handler it registers on an isolated
 * source. Used by the loader around plugin/module construction and `pluginReady`,
 * so a failed element's handlers can be torn down via `removeHandlersOwnedBy`.
 *
 * Attribution is best effort: handlers registered later from async callbacks run
 * outside this scope and fall back to a stack-based guess (or "unknown").
 */
export function withHandlerOwner<T>(ownerId: string, fn: () => T): T {
    OWNER_STACK.push(ownerId);
    try {
        return fn();
    } finally {
        OWNER_STACK.pop();
    }
}

/** Best-effort owner of the code registering (or throwing from) a handler. */
function guessOwner(err?: any): string {
    const current = OWNER_STACK[OWNER_STACK.length - 1];
    if (current) return current;
    const stack = typeof err?.stack === "string" ? err.stack : "";
    const match = /\/(plugins|modules)\/([^/]+)\//.exec(stack);
    return match?.[2] || "unknown";
}

function ownerType(ownerId: string): string {
    if ((window as any).PLUGINS?.[ownerId]) return "plugin";
    if ((window as any).MODULES?.[ownerId]) return "module";
    return "unknown";
}

/** Where to raise `error-user`: the faulting viewer, else any live viewer. */
function reportTarget(source: any): any {
    if (source?.viewport && typeof source.raiseEvent === "function") return source;
    const manager = (window as any).VIEWER_MANAGER;
    return manager?.active || manager?.viewers?.[0];
}

function stateOf(source: any): IsolationState | undefined {
    return source?.[ISOLATION_TOKEN];
}

function faultStateFor(state: IsolationState, eventName: string, handler: Function): HandlerState {
    let perEvent = state.faults.get(eventName);
    if (!perEvent) {
        perEvent = new WeakMap();
        state.faults.set(eventName, perEvent);
    }
    let entry = perEvent.get(handler);
    if (!entry) {
        entry = { faults: 0, reported: false };
        perEvent.set(handler, entry);
    }
    return entry;
}

function reportFault(source: any, eventName: string, handler: Function, err: any, removed: boolean) {
    const owner = guessOwner(err);
    const label = stateOf(source)?.label || "event-source";
    console.error(
        `[event-isolation] handler for '${eventName}' on ${label} threw` +
        ` (owner: ${owner}, handler: ${handler.name || "<anonymous>"})` +
        (removed ? " — repeated fault, handler unregistered" : ""),
        err
    );

    if (REPORTING) return;
    const target = reportTarget(source);
    if (!target) return;

    REPORTING = true;
    try {
        target.raiseEvent("error-user", {
            originType: ownerType(owner),
            originId: owner,
            code: removed ? "E_HANDLER_REMOVED" : "E_HANDLER_FAULT",
            message: removed
                ? $.t("error.handlerFaultRemoved", { event: eventName, owner })
                : $.t("error.handlerFault", { event: eventName, owner }),
            trace: err,
        });
    } catch (e) {
        console.error("[event-isolation] failed to report a handler fault", e);
    } finally {
        REPORTING = false;
    }
}

/**
 * Harden a single EventSource instance: every handler registered from now on runs
 * isolated. Idempotent, and safe to call before any handler is attached (earlier is
 * better — handlers registered before the call stay unguarded).
 *
 * The vendored prototype is untouched; only this instance's registration API is
 * replaced, so non-xOpat EventSources keep stock behaviour.
 */
export function installEventIsolation(source: any, label: string): void {
    if (!source || source[ISOLATION_TOKEN]) return;
    if (typeof source.addHandler !== "function") return;

    const state: IsolationState = { label, wrapped: new Map(), faults: new Map() };
    Object.defineProperty(source, ISOLATION_TOKEN, { value: state, enumerable: false, writable: false });

    const rawAdd = source.addHandler.bind(source);
    const rawAddOnce = typeof source.addOnceHandler === "function" ? source.addOnceHandler.bind(source) : undefined;
    const rawRemove = typeof source.removeHandler === "function" ? source.removeHandler.bind(source) : undefined;

    const wrap = (eventName: string, handler: Function): Function => {
        let perEvent = state.wrapped.get(eventName);
        if (!perEvent) {
            perEvent = new WeakMap();
            state.wrapped.set(eventName, perEvent);
        }
        const existing = perEvent.get(handler);
        if (existing) return existing;

        const wrapped = function (this: any, ...params: any[]) {
            try {
                // A thenable result is returned untouched: async handlers never throw
                // synchronously, so `raiseEventAwaiting` keeps seeing their rejection
                // and documented abort signals still work.
                const result = handler.apply(this, params);
                faultStateFor(state, eventName, handler).faults = 0;
                return result;
            } catch (err) {
                if (RETHROW_EVENTS.has(eventName)) throw err;

                const entry = faultStateFor(state, eventName, handler);
                entry.faults++;
                const remove = entry.faults >= MAX_CONSECUTIVE_FAULTS;
                if (remove) {
                    try {
                        source.removeHandler(eventName, handler);
                    } catch (e) {
                        console.error("[event-isolation] failed to unregister a faulty handler", e);
                    }
                    reportFault(source, eventName, handler, err, true);
                } else if (!entry.reported) {
                    entry.reported = true;
                    reportFault(source, eventName, handler, err, false);
                }
                return undefined;
            }
        };
        perEvent.set(handler, wrapped);

        const owner = guessOwner();
        let owned = OWNED.get(owner);
        if (!owned) OWNED.set(owner, owned = []);
        owned.push({ source, eventName, original: handler });
        return wrapped;
    };

    source.addHandler = function (eventName: string, handler: Function, userData?: any, priority?: number) {
        if (typeof handler !== "function") return rawAdd(eventName, handler, userData, priority);
        return rawAdd(eventName, wrap(eventName, handler), userData, priority);
    };

    if (rawAddOnce) {
        source.addOnceHandler = function (eventName: string, handler: Function, userData?: any, times?: number, priority?: number) {
            if (typeof handler !== "function") return rawAddOnce(eventName, handler, userData, times, priority);
            return rawAddOnce(eventName, wrap(eventName, handler), userData, times, priority);
        };
    }

    if (rawRemove) {
        // OSD compares handler identity, so removal must resolve the wrapper the
        // original was registered with. Unknown handlers pass through unchanged.
        source.removeHandler = function (eventName: string, handler: Function) {
            const wrapped = state.wrapped.get(eventName)?.get(handler);
            return rawRemove(eventName, wrapped || handler);
        };
    }
}

/**
 * Unregister every handler attributed to `ownerId` from all isolated sources.
 * Used when a plugin/module is cleaned up: a failed element left wired keeps
 * throwing on events it can no longer service.
 *
 * @return number of handlers removed
 */
export function removeHandlersOwnedBy(ownerId: string): number {
    const owned = OWNED.get(ownerId);
    if (!owned) return 0;
    OWNED.delete(ownerId);

    let removed = 0;
    for (const record of owned) {
        try {
            record.source.removeHandler(record.eventName, record.original);
            removed++;
        } catch (e) {
            console.warn(`[event-isolation] could not remove '${record.eventName}' handler of '${ownerId}'`, e);
        }
    }
    return removed;
}
