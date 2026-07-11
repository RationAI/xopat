// Per-element CRUD façade. Created via XOpatElement.defineResource(...).
//
// Sync-core design (Phase 8) + per-resource outbox queue (Phase 9):
//
//   create(item, { apply, inverseApply, rollbackOnAsyncRefuse })
//     1. validate(item, ctx)                    ← sync
//     2. runGuards(pre-create ctx, item)        ← sync, first-refusal wins
//     3. apply()                                ← sync, in caller's frame
//     4. push history (if inverseApply given)   ← sync
//     5. enqueue dispatch in the outbox         ← async, FIFO per resource
//     6. return { ok: true, settled }           ← sync
//
// The outbox queue serializes all sink dispatches for one resource:
// op N+1's sink call doesn't begin until op N has settled. This
// guarantees the server sees ops in the order the user issued them, even
// when individual sink calls have variable latency.
//
// Coalescing (when `def.coalesce: true` AND `def.identityOf` provided):
// before pushing a new entry, the queue checks the latest unstarted
// entry of the same identity and applies these rewrite rules:
//   create + delete → both removed
//   delete + create → both removed
//   update + update → keep latest only
//   update + delete → drop update, keep delete
//   create + update → merge into create's payload (if def.merge given)
// In-flight entries never coalesce.
//
// Reserved meta keys written by the pipeline (sinks / guards may read):
//   `clientOpId` — stable per-call UUID for sink-side dedup on retry.
//   `fromUndo` / `fromRedo` — auto-history replay flags.
//   `phase: 'post-commit'` — set on the queued dispatch context.

import type { IOPipeline } from "./io-pipeline";
import { OutboxStore, type PersistedOutboxEntry } from "./outbox-store";

export interface IOResourceCreateOptions {
    ownerUid: string;
    ownerId: string;
    xoType: "core" | "plugin" | "module";
    pipeline: IOPipeline;
    def: IOResourceDef<any>;
}

const _hasCrypto = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
function newClientOpId(): string {
    if (_hasCrypto) return crypto.randomUUID();
    return "op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

interface QueueEntry {
    direction: "create" | "update" | "delete";
    identity: string;
    rawPayload: any;
    itemId: string | undefined;
    options: IOResourceMutateOptions;
    ctx: IOContext;
    started: boolean;
    settle: (result: IOResult) => void;
    settled: Promise<IOResult>;
    /** Phase 10: resolves with `{ ok: true }` once IDB persist succeeds, or
     *  `{ ok: false }` if the persist failed (quota / write error). The
     *  worker awaits this before dispatching. Absent for non-persisted
     *  resources (in-memory only). */
    persistedPromise?: Promise<IOResult>;
    /** Phase 10: replay path uses the already-serialized payload directly
     *  (skips `def.serialize` because the persisted form IS the wire form). */
    replayPayload?: unknown;
    /** Phase 10: replay-mode flag — `apply` and `history` are skipped. */
    isReplay?: boolean;
}

const COALESCED_RESULT: IOResult = { ok: true, payload: { coalesced: true } as any };
const DROPPED_RESULT: IOResult = {
    ok: false, refused: true, reason: "queue dropped", code: "W_IO_QUEUE_DROPPED",
};

const NETWORK_REFUSAL_CODES = new Set([
    "W_IO_DISPATCH_THREW",
    "W_IO_SINK_THREW",
    "W_IO_HTTP_NETWORK",
]);

function isStallSignal(r: IOResult): boolean {
    if (r.ok) return false;
    const code = String((r as any).code ?? "");
    return NETWORK_REFUSAL_CODES.has(code) || /^5\d\d$/.test(code);
}

export class IOResourceImpl<T = unknown> implements IOResource<T> {
    readonly name: string;
    private readonly capabilityId: string;
    private readonly ownerUid: string;
    private readonly ownerId: string;
    private readonly xoType: "core" | "plugin" | "module";
    private readonly pipeline: IOPipeline;
    private readonly def: IOResourceDef<T>;

    private _outbox: QueueEntry[] = [];
    private _running = false;
    private _stalled = false;
    /** Auto-incrementing fallback identity when def.identityOf is missing. */
    private _syntheticIdSeq = 0;
    // Phase 10 persistence state.
    /** undefined = not yet attempted; null = attempted and unavailable; OutboxStore otherwise. */
    private _store: OutboxStore | null | undefined = undefined;
    private _storePromise: Promise<OutboxStore | null> | null = null;
    /** Approximate count of persisted entries for this resource (cap pre-flight). */
    private _persistedCount = 0;
    /** Boot replay completed for this resource. */
    private _replayDone = false;
    /** Set by the pipeline when offline; worker pauses dispatch. */
    private _offline = false;

    constructor(opts: IOResourceCreateOptions) {
        this.name = opts.def.name;
        this.capabilityId = `crud:${opts.def.name}`;
        this.ownerUid = opts.ownerUid;
        this.ownerId = opts.ownerId;
        this.xoType = opts.xoType;
        this.pipeline = opts.pipeline;
        this.def = opts.def as IOResourceDef<T>;

        // Subscribe to the core connectivity source of truth so the worker can
        // pause dispatch deterministically (instead of burning `withRetry`
        // budget) and replay the outbox the moment we come back online. Falls
        // back to a raw `navigator.onLine` read when the singleton is absent
        // (SSR/headless), keeping the same pause semantics without listeners.
        const net = (window as any).APPLICATION_CONTEXT?.networkStatus as NetworkStatusLike | undefined;
        if (net?.addHandler) {
            this._offline = net.isOffline;
            net.addHandler("network-status-changed", ({ online }) => {
                this._offline = !online;
                if (online && !this._running && this._outbox.length > 0) {
                    Promise.resolve().then(() => this._run());
                }
            });
        } else if (typeof navigator !== "undefined") {
            this._offline = navigator.onLine === false;
        }

        if (this.def.persistOutbox) {
            // Kick off boot replay in the background. Does not block ctor;
            // user-issued ops queue normally and tail any replayed ops.
            void this._bootReplay();
        }
    }

    private buildCtx(direction: IODirection, itemId?: string, meta?: Record<string, unknown>): IOContext {
        return {
            direction,
            capabilityId: this.capabilityId,
            xoType: this.xoType,
            ownerUid: this.ownerUid,
            ownerId: this.ownerId,
            resourceName: this.name,
            itemId,
            key: "",
            meta: { clientOpId: newClientOpId(), ...(meta ?? {}) },
        };
    }

    // ── Phase 10: persistent outbox helpers ──────────────────────────────

    /** Lazy IndexedDB store load. Caches result; safe to call repeatedly. */
    private async _whenStoreReady(): Promise<OutboxStore | null> {
        if (this._store !== undefined) return this._store;
        if (!this._storePromise) {
            this._storePromise = OutboxStore.open().then(s => {
                this._store = s;
                if (s === null) {
                    this.pipeline.emitQueueEvent_("io:outbox-unavailable", {
                        reason: "IndexedDB unavailable (private mode or blocked)",
                    });
                }
                return s;
            });
        }
        return this._storePromise;
    }

    /** On boot, prune stale entries and re-enqueue the survivors. */
    private async _bootReplay(): Promise<void> {
        const store = await this._whenStoreReady();
        if (!store) {
            this._replayDone = true;
            return;
        }
        const maxAge = this.def.persistMaxAgeMs ?? 7 * 24 * 3600 * 1000;
        const now = Date.now();
        try {
            const pruned = await store.pruneOlderThan(now - maxAge);
            if (pruned > 0) {
                this.pipeline.emitQueueEvent_("io:outbox-pruned", {
                    ownerUid: this.ownerUid, resourceName: this.name, count: pruned,
                });
            }
        } catch (e) {
            console.warn(`[IO] resource "${this.name}" prune failed:`, e);
        }

        let entries: PersistedOutboxEntry[] = [];
        try {
            entries = await store.listForResource(this.ownerUid, this.name);
        } catch (e) {
            console.warn(`[IO] resource "${this.name}" listForResource failed:`, e);
        }
        this._persistedCount = entries.length;

        // Replay-mode: build queue entries that skip apply + history and
        // dispatch the already-serialized payload as-is. Coalescing applies
        // pairwise as entries enqueue (a stack of undo/redo collapses).
        for (const e of entries) {
            this._enqueueReplay(e);
        }

        // Quota warning (post-prune so the figure reflects current state).
        const q = await store.quotaSnapshot();
        if (q && q.quota > 0 && q.usage / q.quota > 0.8) {
            this.pipeline.emitQueueEvent_("io:outbox-quota-warn", {
                usage: q.usage, quota: q.quota, ratio: q.usage / q.quota,
            });
        }

        this._replayDone = true;
        this.pipeline.emitQueueEvent_("io:outbox-replayed", {
            ownerUid: this.ownerUid, resourceName: this.name, count: entries.length,
        });
    }

    private _enqueueReplay(persisted: PersistedOutboxEntry): void {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(persisted.metaJson || "{}"); } catch {}
        const ctx: IOContext = {
            direction: persisted.direction,
            capabilityId: this.capabilityId,
            xoType: this.xoType,
            ownerUid: this.ownerUid,
            ownerId: this.ownerId,
            resourceName: this.name,
            itemId: persisted.itemId,
            key: "",
            meta: { ...meta, clientOpId: persisted.clientOpId, fromReplay: true },
        };
        const entry: QueueEntry = {
            direction: persisted.direction,
            identity: persisted.identity,
            rawPayload: persisted.serializedPayload,
            replayPayload: persisted.serializedPayload,
            itemId: persisted.itemId,
            isReplay: true,
            options: {
                rollbackOnAsyncRefuse: persisted.rollbackOnAsyncRefuse,
                skipGuards: true,
                skipHistory: true,
                meta: ctx.meta,
            },
            ctx,
            started: false,
        } as QueueEntry;
        entry.settled = new Promise<IOResult>((resolve) => { entry.settle = resolve; });
        // Replays don't re-coalesce against unstarted siblings normally —
        // but pairwise rule still applies (e.g. persisted create + delete
        // collapse on boot). _coalesce handles that uniformly.
        if (this._coalesce(entry)) {
            // Coalesced out — also drop the persisted entry.
            void this._unpersistById(persisted.clientOpId);
            return;
        }
        this._outbox.push(entry);
        if (!this._running) Promise.resolve().then(() => this._run());
    }

    /** Persist a freshly-enqueued entry. Returns a Promise the worker awaits. */
    private _persistEntry(entry: QueueEntry): Promise<IOResult> {
        return (async (): Promise<IOResult> => {
            const store = await this._whenStoreReady();
            if (!store) return { ok: true }; // unavailable → memory-only fallback
            const persisted: PersistedOutboxEntry = {
                clientOpId: String(entry.ctx.meta.clientOpId),
                ownerUid: this.ownerUid,
                resourceName: this.name,
                direction: entry.direction,
                identity: entry.identity,
                itemId: entry.itemId,
                serializedPayload: entry.direction === "delete"
                    ? undefined
                    : (this.def.serialize ? this.def.serialize(entry.rawPayload as T, entry.ctx) : entry.rawPayload),
                createdAt: Date.now(),
                attemptCount: 0,
                rollbackOnAsyncRefuse: !!entry.options.rollbackOnAsyncRefuse,
                metaJson: this._safeStringify(entry.ctx.meta),
            };
            try {
                await store.add(persisted);
                this._persistedCount++;
                return { ok: true };
            } catch (e: any) {
                return {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_OUTBOX_WRITE",
                };
            }
        })();
    }

    private async _unpersist(entry: QueueEntry): Promise<void> {
        const id = entry.ctx.meta?.clientOpId;
        if (!id) return;
        await this._unpersistById(String(id));
    }

    private async _unpersistById(clientOpId: string): Promise<void> {
        const store = await this._whenStoreReady();
        if (!store) return;
        try {
            await store.remove(clientOpId);
            if (this._persistedCount > 0) this._persistedCount--;
        } catch (e) {
            console.warn(`[IO] resource "${this.name}" unpersist failed:`, e);
        }
    }

    /** JSON.stringify with a non-throwing fallback (omits non-serializable keys). */
    private _safeStringify(obj: unknown): string {
        try { return JSON.stringify(obj); }
        catch {
            try {
                return JSON.stringify(obj, (_k, v) => {
                    if (typeof v === "function") return undefined;
                    if (v instanceof Error) return { name: v.name, message: v.message };
                    return v;
                });
            } catch { return "{}"; }
        }
    }

    private _scheduleRollback(): void {
        Promise.resolve().then(async () => {
            try {
                const history = (globalThis as any).APPLICATION_CONTEXT?.history;
                if (history?.undo) await history.undo();
            } catch (e) {
                console.error(`[IO] resource "${this.name}" rollback failed:`, e);
            }
        });
    }

    /**
     * Sync core: validate → guards → apply. Returns sync IOResult or
     * refusal. Does NOT push history or enqueue dispatch.
     */
    private _runSyncCore(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        ctx: IOContext,
        options: IOResourceMutateOptions,
    ): IOResult {
        const v = this.def.validate?.(itemOrPatch as T, ctx);
        if (v && !v.ok) return v;

        if (!options.skipGuards) {
            const preDirection = (
                direction === "create" ? "pre-create"
                : direction === "update" ? "pre-update"
                : "pre-delete"
            ) as IODirection;
            const ctxPre = { ...ctx, direction: preDirection };
            const payload = direction === "delete" ? undefined : itemOrPatch;
            const g = this.pipeline.runGuards(ctxPre, payload);
            if (!g.ok) return g;
        }

        if (options.apply) {
            try { options.apply(); }
            catch (e: any) {
                return {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_APPLY_THREW",
                };
            }
        }
        return { ok: true };
    }

    /** Identity key used for coalescing. Falls back to a synthetic per-call
     *  id when `def.identityOf` is missing or returns nothing. */
    private _identityFor(direction: "create" | "update" | "delete", itemOrPatch: any, itemId: string | undefined): string {
        if (direction !== "create" && itemId !== undefined) return String(itemId);
        try {
            const id = this.def.identityOf?.(itemOrPatch as T);
            if (id !== undefined && id !== null && String(id).length > 0) return String(id);
        } catch { /* ignore */ }
        // Synthetic — guaranteed unique, so coalesce never triggers.
        return `__synth__::${++this._syntheticIdSeq}`;
    }

    /**
     * Walk the outbox backward looking for the latest unstarted entry with
     * the same identity. Stops on the first started same-identity entry
     * (cannot coalesce past an in-flight op). Returns the index, or -1.
     */
    private _findCoalescePartner(identity: string): number {
        for (let i = this._outbox.length - 1; i >= 0; i--) {
            const e = this._outbox[i]!;
            if (e.identity !== identity) continue;
            if (e.started) return -1;
            return i;
        }
        return -1;
    }

    /**
     * Apply coalescing rules between the new entry and the latest pending
     * same-identity entry. Returns true if the new entry should be SKIPPED
     * (coalesced out). May splice the partner from the outbox.
     */
    private _coalesce(newEntry: QueueEntry): boolean {
        if (!this.def.coalesce) return false;
        const idx = this._findCoalescePartner(newEntry.identity);
        if (idx < 0) return false;
        const prev = this._outbox[idx]!;

        const dropPrev = () => {
            this._outbox.splice(idx, 1);
            prev.settle(COALESCED_RESULT);
            // Phase 10: also remove from IDB (best-effort).
            if (this.def.persistOutbox) void this._unpersist(prev);
        };

        // Rule: create + delete → both removed
        if (prev.direction === "create" && newEntry.direction === "delete") {
            dropPrev();
            return true; // also drop new (caller settles new with COALESCED_RESULT)
        }
        // Rule: delete + create → both removed
        if (prev.direction === "delete" && newEntry.direction === "create") {
            dropPrev();
            return true;
        }
        // Rule: update + update → keep latest
        if (prev.direction === "update" && newEntry.direction === "update") {
            dropPrev();
            return false; // new will enqueue
        }
        // Rule: update + delete → drop update
        if (prev.direction === "update" && newEntry.direction === "delete") {
            dropPrev();
            return false;
        }
        // Rule: create + update → merge into create
        if (prev.direction === "create" && newEntry.direction === "update" && this.def.merge) {
            try {
                prev.rawPayload = this.def.merge(prev.rawPayload, newEntry.rawPayload);
                // Phase 10: rewrite the persisted entry's payload.
                if (this.def.persistOutbox) {
                    void this._whenStoreReady().then(store => {
                        if (!store) return;
                        const pid = String(prev.ctx.meta.clientOpId);
                        const newPayload = this.def.serialize
                            ? this.def.serialize(prev.rawPayload as T, prev.ctx)
                            : prev.rawPayload;
                        return store.update(pid, { serializedPayload: newPayload });
                    }).catch(() => {});
                }
                newEntry.settle(COALESCED_RESULT);
                return true; // new is folded into prev
            } catch (e) {
                console.warn(`[IO] resource "${this.name}" merge threw — keeping both ops:`, e);
                return false;
            }
        }
        return false;
    }

    /** Build a queue entry with a settle Promise. */
    private _makeEntry(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        itemId: string | undefined,
        options: IOResourceMutateOptions,
    ): QueueEntry {
        const ctx = this.buildCtx(direction, itemId, options.meta);
        const entry: any = {
            direction, itemId, options, ctx,
            identity: this._identityFor(direction, itemOrPatch, itemId),
            rawPayload: itemOrPatch,
            started: false,
        };
        entry.settled = new Promise<IOResult>((resolve) => { entry.settle = resolve; });
        return entry as QueueEntry;
    }

    /** Enqueue a queue entry; apply coalescing first; start worker if idle. */
    private _enqueue(entry: QueueEntry): Promise<IOResult> {
        if (this._coalesce(entry)) {
            // Already settled inside _coalesce.
            return entry.settled;
        }

        // Phase 10: capacity pre-flight (uses persistedCount + in-memory size).
        // This is approximate (the persisted count updates async after IDB
        // writes), but conservative — better to refuse one extra than to
        // accept past the cap silently.
        if (this.def.persistOutbox) {
            const cap = this.def.persistMaxEntries ?? 5000;
            const pending = this._outbox.length + this._persistedCount;
            if (pending >= cap) {
                const refusal: IOResult = {
                    ok: false, refused: true,
                    reason: "persistent outbox cap reached",
                    code: "W_IO_OUTBOX_FULL",
                    userMessage: `Cannot save: too many pending changes (${pending}/${cap}). Please wait for sync or check connectivity.`,
                };
                this.pipeline.emitQueueEvent_("io:outbox-full", {
                    ownerUid: this.ownerUid, resourceName: this.name, pending,
                });
                this.pipeline.surfaceRefusal_(entry.ctx, refusal as any);
                entry.settle(refusal);
                if (entry.options.rollbackOnAsyncRefuse) this._scheduleRollback();
                return entry.settled;
            }
        }

        this._outbox.push(entry);

        // Fire IDB persist in parallel (worker awaits it before dispatching).
        if (this.def.persistOutbox && !entry.isReplay) {
            entry.persistedPromise = this._persistEntry(entry);
        }

        if (!this._running) {
            // Start the worker on the next microtask so the caller's sync
            // frame finishes (including history push) before we begin.
            Promise.resolve().then(() => this._run());
        }
        return entry.settled;
    }

    /** Worker: drain the outbox FIFO. Pauses when `_offline` is true. */
    private async _run(): Promise<void> {
        if (this._running) return;
        this._running = true;
        try {
            while (this._outbox.length > 0) {
                if (this._offline) {
                    // Don't burn `withRetry` budget while definitively offline.
                    if (!this._stalled) {
                        this._stalled = true;
                        this._emitQueueEvent("io:queue-stalled", {
                            ownerUid: this.ownerUid, resourceName: this.name,
                            pending: this._outbox.length,
                        });
                    }
                    break;
                }

                const entry = this._outbox[0]!;
                entry.started = true;

                const result = await this._executeEntry(entry);
                entry.settle(result);
                this._outbox.shift();

                // Stall / resume detection (network/5xx).
                if (isStallSignal(result)) {
                    if (!this._stalled) {
                        this._stalled = true;
                        this._emitQueueEvent("io:queue-stalled", {
                            ownerUid: this.ownerUid, resourceName: this.name,
                            pending: this._outbox.length + 1,
                        });
                    }
                } else if (this._stalled && result.ok) {
                    this._stalled = false;
                    this._emitQueueEvent("io:queue-resumed", {
                        ownerUid: this.ownerUid, resourceName: this.name,
                    });
                }
            }
        } finally {
            this._running = false;
            if (!this._stalled && this._outbox.length === 0) {
                this._emitQueueEvent("io:queue-empty", {
                    ownerUid: this.ownerUid, resourceName: this.name,
                });
            }
        }
    }

    /** Execute one queue entry: persist-await + dispatch + unpersist + rollback. */
    private async _executeEntry(entry: QueueEntry): Promise<IOResult> {
        // Phase 10: wait for IDB persist before dispatching (crash-safe).
        // If the persist failed (quota/IDB error), short-circuit with refusal.
        if (entry.persistedPromise) {
            const pr = await entry.persistedPromise;
            if (!pr.ok) {
                if (entry.options.rollbackOnAsyncRefuse) this._scheduleRollback();
                return pr;
            }
        }

        let result: IOResult;
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId)) {
            result = { ok: true };
        } else {
            const dispatchCtx: IOContext = {
                ...entry.ctx,
                meta: { ...entry.ctx.meta, phase: "post-commit" },
            };
            const payload = entry.replayPayload !== undefined
                ? entry.replayPayload
                : (entry.direction === "delete"
                    ? undefined
                    : (this.def.serialize ? this.def.serialize(entry.rawPayload as T, dispatchCtx) : entry.rawPayload));
            try {
                result = await this.pipeline.dispatch(dispatchCtx, payload);
            } catch (e: any) {
                result = {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_DISPATCH_THREW",
                };
                this.pipeline.surfaceRefusal_(dispatchCtx, result as any);
            }
        }

        // Phase 10: remove from IDB once dispatch settled (success OR
        // terminal refusal — we don't infinitely re-attempt).
        if (this.def.persistOutbox) {
            await this._unpersist(entry).catch(() => {});
        }

        if (!result.ok && entry.options.rollbackOnAsyncRefuse) {
            try {
                const history = (globalThis as any).APPLICATION_CONTEXT?.history;
                if (history?.undo) await history.undo();
            } catch (e) {
                console.error(`[IO] resource "${this.name}" rollback failed:`, e);
            }
        }
        return result;
    }

    private _emitQueueEvent(name: string, payload: Record<string, unknown>) {
        try {
            (this.pipeline as any).emitQueueEvent_?.(name, payload);
        } catch { /* pipeline may not be ready */ }
    }

    private _pushHistoryEntry(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        itemId: string | undefined,
        options: IOResourceMutateOptions,
    ): void {
        const inverseDirection = (
            direction === "create" ? "delete"
            : direction === "delete" ? "create"
            : "update"
        ) as "create" | "update" | "delete";
        const apply = options.apply!;
        const inverseApply = options.inverseApply!;
        const baseMeta = { ...(options.meta ?? {}) };
        const self = this;

        const redo = () => {
            self._dispatchInternal(direction, itemOrPatch, itemId, {
                ...options,
                meta: { ...baseMeta, fromRedo: true },
                apply, inverseApply,
                skipGuards: true,
                skipHistory: true,
                rollbackOnAsyncRefuse: false,
            });
        };
        const undo = () => {
            self._dispatchInternal(inverseDirection, itemOrPatch, itemId, {
                ...options,
                meta: { ...baseMeta, fromUndo: true },
                apply: inverseApply, inverseApply: apply,
                skipGuards: true,
                skipHistory: true,
                rollbackOnAsyncRefuse: false,
            });
        };

        const history = (globalThis as any).APPLICATION_CONTEXT?.history;
        history?.pushExecuted?.(redo, undo, {
            name: `${this.name}:${direction}`,
            ownerId: this.ownerId,
        });
    }

    /**
     * Internal version that bypasses the public sync wrappers — used by
     * history redo/undo replays. Goes through the same outbox queue
     * (so server ordering is preserved across replays).
     */
    private _dispatchInternal(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        itemId: string | undefined,
        options: IOResourceMutateOptions,
    ): void {
        const ctx = this.buildCtx(direction, itemId, options.meta);
        const r = this._runSyncCore(direction, itemOrPatch, ctx, options);
        if (!r.ok) return;
        const entry = this._makeEntry(direction, itemOrPatch, itemId, options);
        // Replays inherit ctx from the freshly built one (with fromUndo/fromRedo).
        entry.ctx = ctx;
        void this._enqueue(entry);
    }

    // ── Public mutating methods (sync core + .settled) ─────────────────

    create(item: T, options: IOResourceMutateOptions = {}): IOSyncResult<{ id: string }> {
        const ctx = this.buildCtx("create", undefined, options.meta);
        const r = this._runSyncCore("create", item, ctx, options);
        if (!r.ok) return { ...(r as IOResult<{ id: string }>), settled: Promise.resolve(r as IOResult<{ id: string }>) };

        if (options.apply && options.inverseApply && !options.skipHistory) {
            this._pushHistoryEntry("create", item, undefined, options);
        }
        const entry = this._makeEntry("create", item, undefined, options);
        entry.ctx = ctx;
        const settled = this._enqueue(entry) as Promise<IOResult<{ id: string }>>;
        return { ok: true, settled };
    }

    update(itemId: string, patch: Partial<T>, options: IOResourceMutateOptions = {}): IOSyncResult {
        const ctx = this.buildCtx("update", itemId, options.meta);
        const r = this._runSyncCore("update", patch, ctx, options);
        if (!r.ok) return { ...r, settled: Promise.resolve(r) };

        if (options.apply && options.inverseApply && !options.skipHistory) {
            this._pushHistoryEntry("update", patch, itemId, options);
        }
        const entry = this._makeEntry("update", patch, itemId, options);
        entry.ctx = ctx;
        const settled = this._enqueue(entry);
        return { ok: true, settled };
    }

    delete(itemId: string, options: IOResourceMutateOptions = {}): IOSyncResult {
        const ctx = this.buildCtx("delete", itemId, options.meta);
        const r = this._runSyncCore("delete", undefined, ctx, options);
        if (!r.ok) return { ...r, settled: Promise.resolve(r) };

        if (options.apply && options.inverseApply && !options.skipHistory) {
            this._pushHistoryEntry("delete", undefined, itemId, options);
        }
        const entry = this._makeEntry("delete", undefined, itemId, options);
        entry.ctx = ctx;
        const settled = this._enqueue(entry);
        return { ok: true, settled };
    }

    // ── flush / drop ───────────────────────────────────────────────────

    flush(): Promise<IOResult[]> {
        return Promise.all(this._outbox.map(e => e.settled));
    }

    drop(): void {
        const dropped: QueueEntry[] = [];
        const remain: QueueEntry[] = [];
        for (const e of this._outbox) (e.started ? remain : dropped).push(e);
        this._outbox = remain;
        for (const e of dropped) e.settle(DROPPED_RESULT);
    }

    // ── read (still async — fetches from a sink) ──────────────────

    async read(itemId: string, meta?: Record<string, unknown>): Promise<IOResult<T>> {
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId)) return { ok: true };
        const ctx = this.buildCtx("read", itemId, meta);
        const r = await this.pipeline.dispatch(ctx);
        if (!r.ok) return r;
        const payload = (r as any).payload;
        if (payload === undefined || !this.def.deserialize) return r as IOResult<T>;
        try {
            return { ok: true, payload: this.def.deserialize(payload, ctx) };
        } catch (e: any) {
            return { ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_DESERIALIZE" };
        }
    }

    // ── Sync guard-only checks ─────────────────────────────────────────

    canCreate(item: T, meta?: Record<string, unknown>): IOResult {
        const ctx = this.buildCtx("create", undefined, meta);
        const v = this.def.validate?.(item, ctx);
        if (v && !v.ok) return v;
        const ctxPre = { ...ctx, direction: "pre-create" as IODirection };
        return this.pipeline.runGuards(ctxPre, item);
    }

    canUpdate(itemId: string, patch: Partial<T>, meta?: Record<string, unknown>): IOResult {
        const ctx = this.buildCtx("update", itemId, meta);
        const v = this.def.validate?.(patch as T, ctx);
        if (v && !v.ok) return v;
        const ctxPre = { ...ctx, direction: "pre-update" as IODirection };
        return this.pipeline.runGuards(ctxPre, patch);
    }

    canDelete(itemId: string, meta?: Record<string, unknown>): IOResult {
        const ctx = this.buildCtx("delete", itemId, meta);
        const ctxPre = { ...ctx, direction: "pre-delete" as IODirection };
        return this.pipeline.runGuards(ctxPre);
    }

    // ── streamed query (async by nature) ───────────────────────────────

    query(params: Record<string, unknown>, meta?: Record<string, unknown>): AsyncIterable<T> {
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId)) {
            return (async function* () {})();
        }
        const ctx = this.buildCtx("query", undefined, meta);
        const def = this.def;
        const stream = this.pipeline.queryStream(ctx, params);
        return (async function* () {
            for await (const raw of stream) {
                let item: T;
                try {
                    item = def.deserialize ? def.deserialize(raw, ctx) : (raw as T);
                } catch (e: any) {
                    console.warn(`[IO] resource "${def.name}" deserialize failed for one item:`, e);
                    continue;
                }
                if (def.validate) {
                    const v = def.validate(item, ctx);
                    if (v && !v.ok) {
                        console.warn(`[IO] resource "${def.name}" validate refused one queried item:`, v.reason);
                        continue;
                    }
                }
                yield item;
            }
        })();
    }
}
