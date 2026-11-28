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
// when individual sink calls have variable latency. Where a bound sink
// takes batches (`createMany` / `updateMany` / `deleteMany`), a run of consecutive
// same-direction ops counts as one such step — see `_takeBatch`.
//
// Coalescing (when `def.coalesce: true` AND `def.identityOf` provided):
// before pushing a new entry, the queue checks the latest unstarted
// entry of the same identity and applies these rewrite rules:
//   create + delete → both removed
//   delete + create → both removed
//   update + update → keep latest (patches merged first if def.merge given)
//   update + delete → drop update, keep delete
//   create + update → merge into create's payload (if def.merge given)
// In-flight entries never coalesce. A coalesced-out op always settles with
// `{ coalesced: true }`, and a surviving op inherits its predecessor's slot,
// so ops on other identities never get reordered.
//
// Auto-history replays dispatch the *inverse* op through this same queue. The
// inverse op needs its own wire body — undoing a `delete` re-creates the full
// item (`options.inversePayload`), undoing a `create` deletes by the id derived
// from the payload. `inverseApply` only repairs local state.
//
// Reserved meta keys written by the pipeline (sinks / guards may read):
//   `clientOpId` — stable per-call UUID for sink-side dedup on retry.
//   `fromUndo` / `fromRedo` — auto-history replay flags.
//   `phase: 'post-commit'` — set on the queued dispatch context.

import type { IOPipeline } from "./io-pipeline";
import { OutboxStore, type PersistedOutboxEntry } from "./outbox-store";
import { deploymentKey } from "../app/deployment-key";

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
    /**
     * Where the crash-recovery record of this entry stands: `queued` (waiting
     * for the next write run, or for room under the cap), `writing` (its run is
     * in flight), `written`. Absent: never persisted, or already removed.
     */
    persistState?: "queued" | "writing" | "written";
    resolvePersisted?: (r: IOResult) => void;
    /** The record of a replayed entry has been removed (so it is not removed, and counted, twice). */
    recordRemoved?: boolean;
    /** The entry left the queue while its write was in flight: remove the record once it lands. */
    persistCancelled?: boolean;
    /** A coalesced merge changed the payload while its write was in flight: rewrite it once it lands. */
    persistRewrite?: { payload: unknown };
    /** Phase 10: replay path uses the already-serialized payload directly
     *  (skips `def.serialize` because the persisted form IS the wire form). */
    replayPayload?: unknown;
    /** Phase 10: replay-mode flag — `apply` and `history` are skipped. */
    isReplay?: boolean;
    /** Whether this entry's dispatch attempt has already been counted in IDB. */
    attemptRecorded?: boolean;
    /** Handle to the auto-pushed history entry, when one was pushed. Lets a
     *  post-commit refusal revert exactly this mutation instead of whatever
     *  happens to be on top of the undo stack. */
    historyHandle?: Promise<HistoryEntryHandle | undefined>;
}

/** Outcome of the coalescing pass — see `IOResourceImpl._coalesce`. */
type CoalesceVerdict =
    | { action: "enqueue" }
    | { action: "skip" }
    | { action: "replace"; index: number };

const VERDICT_ENQUEUE: CoalesceVerdict = { action: "enqueue" };
const VERDICT_SKIP: CoalesceVerdict = { action: "skip" };

/**
 * Revert-on-refusal is the default: the destination is authoritative, so a
 * change it refused must not stay on screen. Owners opt out explicitly where
 * flicker is worse than divergence (e.g. a geometry swap mid-edit).
 */
function wantsRollback(options: IOResourceMutateOptions): boolean {
    return options.rollbackOnAsyncRefuse !== false;
}

/** Largest write run (one IndexedDB transaction) and the time `serialize` may take per run. */
const PERSIST_RUN_MAX = 500;
const PERSIST_RUN_BUDGET_MS = 12;

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
    /** `flush()` callers to release if the queue starts holding mid-drain. */
    private _holdWaiters: Array<(r: IOResult) => void> = [];
    /** Auto-incrementing fallback identity when def.identityOf is missing. */
    private _syntheticIdSeq = 0;
    // Phase 10 persistence state.
    /** undefined = not yet attempted; null = attempted and unavailable; OutboxStore otherwise. */
    private _store: OutboxStore | null | undefined = undefined;
    private _storePromise: Promise<OutboxStore | null> | null = null;
    /** Approximate count of persisted entries for this resource (cap pre-flight). */
    private _persistedCount = 0;
    /** Entries owed a crash-recovery record, oldest first. Past the cap they wait here. */
    private _persistQueue: QueueEntry[] = [];
    private _persistScheduled = false;
    private _persistFlushing = false;
    /** Record ids to delete with the next removal run, and who waits for it. */
    private _removeQueue: string[] = [];
    private _removeWaiters: Array<() => void> = [];
    private _wasOverflowing = false;
    /** `code|resource` pairs already reported — see {@link _warnOutboxFailureOnce}. */
    private readonly _warnedOutboxFailures = new Set<string>();
    /**
     * Boot replay completed for this resource — the worker's start gate.
     * Starts `true` for resources with no persistent outbox: there is nothing to
     * replay, so there is nothing to wait behind.
     */
    private _replayDone = true;
    /** Set by the pipeline when offline; worker pauses dispatch. */
    private _offline = false;
    /** A dirty re-check microtask is already scheduled for this tick. */
    private _dirtyCheckQueued = false;
    /** The "outbox full" dialog was shown for the current full episode. */
    private _fullSurfaced = false;
    /** `whenHeadroom()` callers waiting for the queue to drain. */
    private _headroomWaiters: Array<{ need: number; resolve: (ok: boolean) => void }> = [];

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
                // Going offline holds the queue without a queue event, which
                // can flip `hasUnsavedWork()` — let the dirty registry re-read.
                this._notifyDirty();
                if (online && !this._running && this._outbox.length > 0) {
                    Promise.resolve().then(() => this._run());
                }
            });
        } else if (typeof navigator !== "undefined") {
            this._offline = navigator.onLine === false;
        }

        // Same shape, different reason to wait: a sink this resource's binding
        // names may register late (a module that must finish a handshake first).
        // The worker holds meanwhile — see `_bindingsPending` — and this is what
        // lets it go again.
        (this.pipeline as any).addHandler?.("io:sink-registered", () => {
            if (!this._running && this._outbox.length > 0) {
                Promise.resolve().then(() => this._run());
            }
        });

        if (this.def.persistOutbox) {
            // Kick off boot replay in the background. Does not block the ctor:
            // user-issued ops queue normally and the worker holds until replay
            // finishes, so they tail the previous session's ops instead of
            // overtaking them.
            this._replayDone = false;
            // `finally` — a throw here must not leave the gate shut forever, which
            // would freeze every write for this resource for the whole session.
            void this._bootReplay()
                .catch(e => console.warn(`[IO] resource "${this.name}" boot replay failed:`, e))
                .finally(() => this._markReplayDone(0));
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
            // `.catch` BEFORE `.then`: without it a rejected open() becomes an
            // unhandled rejection and the `io:outbox-unavailable` event below
            // never fires, so callers never learn the outbox is gone.
            this._storePromise = OutboxStore.open().catch(e => {
                console.warn("[IO] outbox store failed to open.", e);
                return null;
            }).then(s => {
                this._store = s;
                if (s === null) {
                    // Named: one event per persisted resource fires, and a bare
                    // `{reason}` left a listener unable to tell which — or how many
                    // — resources had lost durability.
                    this._emitQueueEvent("io:outbox-unavailable", {
                        ownerUid: this.ownerUid, resourceName: this.name,
                        reason: "IndexedDB unavailable (private mode, blocked, or opaque origin)",
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
            this._markReplayDone(0);
            // Not a silent return: a consumer waiting on `io:outbox-replayed` to
            // know boot sync finished would otherwise wait forever in exactly the
            // deployments where IndexedDB is unavailable — a sandboxed iframe on an
            // opaque origin, which is a supported shape, not an edge case.
            return;
        }
        const maxAge = this.def.persistMaxAgeMs ?? 7 * 24 * 3600 * 1000;
        const now = Date.now();
        try {
            const pruned = await store.pruneOlderThan(now - maxAge);
            if (pruned > 0) {
                this._emitQueueEvent("io:outbox-pruned", {
                    ownerUid: this.ownerUid, resourceName: this.name, count: pruned,
                });
            }
        } catch (e) {
            console.warn(`[IO] resource "${this.name}" prune failed:`, e);
        }

        let entries: PersistedOutboxEntry[] = [];
        try {
            // Only this deployment's ops. Another deployment's — or an unstamped
            // one — would dispatch, guard-free, into THIS deployment's sinks.
            // They stay put for their own deployment and age out with the prune.
            const own = deploymentKey();
            entries = (await store.listForResource(this.ownerUid, this.name))
                .filter(e => !!own && e.deploymentKey === own);
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
            this._emitQueueEvent("io:outbox-quota-warn", {
                usage: q.usage, quota: q.quota, ratio: q.usage / q.quota,
            });
        }

        this._markReplayDone(entries.length);
    }

    /**
     * Release anything that queued while boot replay was still reading IndexedDB.
     *
     * `_replayDone` used to be written and never read, so a user op issued during
     * boot was dispatched immediately while persisted ops from the previous
     * session were still being listed — the reverse of the order they happened in.
     * The worker is only allowed to start once this has run, which is what makes
     * the documented "strict causal order" true rather than aspirational.
     */
    private _markReplayDone(replayed: number): void {
        if (this._replayDone) return;
        this._replayDone = true;
        this._emitQueueEvent("io:outbox-replayed", {
            ownerUid: this.ownerUid, resourceName: this.name, count: replayed,
        });
        if (this._outbox.length > 0) void this._run();
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
            // Boot replay is the pipeline's own bookkeeping: the user did
            // nothing just now, so a refusal is an event, not a dialog.
            trigger: "system",
            // `identity` is persisted, so a replayed op keeps the same localId the
            // sink correlated on before the reload even if `meta` did not survive.
            meta: { ...meta, clientOpId: persisted.clientOpId, fromReplay: true,
                    ...(persisted.identity && !persisted.identity.startsWith("__synth__::")
                        ? { localId: persisted.identity } : {}) },
        };
        const entry: QueueEntry = {
            direction: persisted.direction,
            identity: persisted.identity,
            rawPayload: persisted.serializedPayload,
            replayPayload: persisted.serializedPayload,
            itemId: persisted.itemId,
            isReplay: true,
            options: {
                // Never roll back a replay: the local state was restored from
                // the bundle/cache, not by this op, and the `inverseApply`
                // closure that could revert it did not survive the reload.
                rollbackOnAsyncRefuse: false,
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
        const verdict = this._coalesce(entry);
        if (verdict.action === "skip") {
            // Coalesced out — settle it and drop the persisted entry.
            entry.settle(COALESCED_RESULT);
            void this._unpersistById(persisted.clientOpId);
            return;
        }
        if (verdict.action === "replace") {
            // Supersedes an earlier persisted op; it is already in IDB under
            // its own clientOpId, so only the slot changes.
            this._outbox[verdict.index] = entry;
        } else {
            this._outbox.push(entry);
        }
        if (!this._running) Promise.resolve().then(() => this._run());
    }

    /**
     * Queue a freshly-enqueued entry for its crash-recovery record. Returns the
     * Promise the worker awaits before dispatching it.
     *
     * Nothing is serialized or written here. A producer may enqueue tens of
     * thousands of ops in one frame; they are written in runs — one IndexedDB
     * transaction per run — by {@link _flushPersist}, and only as many as the cap
     * allows are on disk at a time. The rest keep their place in this queue and
     * are written as the head of the outbox drains.
     */
    private _persistEntry(entry: QueueEntry): Promise<IOResult> {
        entry.persistState = "queued";
        const persisted = new Promise<IOResult>(resolve => { entry.resolvePersisted = resolve; });
        this._persistQueue.push(entry);
        this._schedulePersistFlush();
        return persisted;
    }

    private _schedulePersistFlush(): void {
        if (this._persistScheduled || !this._persistQueue.length) return;
        this._persistScheduled = true;
        Promise.resolve().then(() => {
            this._persistScheduled = false;
            void this._flushPersist();
        });
    }

    private _settlePersist(entry: QueueEntry, state: QueueEntry["persistState"], result: IOResult): void {
        entry.persistState = state;
        const resolve = entry.resolvePersisted;
        entry.resolvePersisted = undefined;
        resolve?.(result);
    }

    private _persistedRecord(entry: QueueEntry): PersistedOutboxEntry {
        return {
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
            rollbackOnAsyncRefuse: wantsRollback(entry.options),
            metaJson: this._safeStringify(entry.ctx.meta),
            deploymentKey: deploymentKey(),
        };
    }

    /**
     * Write queued crash-recovery records, oldest first, in runs.
     *
     * A run is bounded three ways: the room left under the cap, a fixed size,
     * and a time budget for `serialize` (owner code, run here rather than in the
     * producer's frame). Between runs control returns to the event loop.
     */
    private async _flushPersist(): Promise<void> {
        if (this._persistFlushing) return;
        this._persistFlushing = true;
        try {
            const store = await this._whenStoreReady();
            for (;;) {
                if (!store) {
                    // Unavailable → memory-only: nothing to wait for.
                    for (const entry of this._persistQueue.splice(0)) this._settlePersist(entry, undefined, { ok: true });
                    break;
                }
                const room = this._cap() - this._persistedCount;
                if (room <= 0 || !this._persistQueue.length) break;

                const started = Date.now();
                const run: QueueEntry[] = [];
                const records: PersistedOutboxEntry[] = [];
                while (this._persistQueue.length && run.length < room && run.length < PERSIST_RUN_MAX
                    && (run.length === 0 || Date.now() - started < PERSIST_RUN_BUDGET_MS)) {
                    const entry = this._persistQueue.shift()!;
                    try {
                        // `serialize` is owner code. Persistence is best-effort, so a
                        // throw becomes a refusal of this one record and dispatch
                        // still proceeds (see `_awaitPersisted`).
                        records.push(this._persistedRecord(entry));
                        entry.persistState = "writing";
                        run.push(entry);
                    } catch (e: any) {
                        this._settlePersist(entry, undefined, {
                            ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_OUTBOX_WRITE",
                        });
                    }
                }
                if (run.length) {
                    // Reserved before the await, so the cap holds for whoever looks meanwhile.
                    this._persistedCount += run.length;
                    const failures: (IOResult | undefined)[] = new Array(run.length).fill(undefined);
                    const refusal = (e: any): IOResult =>
                        ({ ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_OUTBOX_WRITE" });
                    try {
                        await store.addMany(records);
                    } catch (e: any) {
                        if (run.length === 1) {
                            failures[0] = refusal(e);
                        } else {
                            // One payload that cannot be stored aborts the whole
                            // transaction. Its neighbours must not lose their records
                            // for it: write the run again, one record at a time.
                            for (let i = 0; i < run.length; i++) {
                                try { await store.addMany([records[i]!]); }
                                catch (one: any) { failures[i] = refusal(one); }
                            }
                        }
                    }
                    const lost = failures.reduce((n, f) => n + (f ? 1 : 0), 0);
                    if (lost) this._persistedCount = Math.max(0, this._persistedCount - lost);
                    run.forEach((entry, i) => {
                        const failure = failures[i];
                        if (failure) { this._settlePersist(entry, undefined, failure); return; }
                        this._settlePersist(entry, "written", { ok: true });
                        if (entry.persistCancelled) {
                            // Coalesced out, dropped or dispatched while the write was in flight.
                            void this._unpersist(entry);
                        } else if (entry.persistRewrite) {
                            const { payload } = entry.persistRewrite;
                            entry.persistRewrite = undefined;
                            void store.update(String(entry.ctx.meta.clientOpId), { serializedPayload: payload }).catch(() => {});
                        }
                    });
                }
                if (!this._persistQueue.length) break;
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
        } finally {
            this._persistFlushing = false;
            this._overflowChanged();
        }
    }

    /**
     * Count one dispatch attempt against the persisted entry.
     *
     * Best-effort and deliberately not awaited: the attempt counter is
     * diagnostics, and delaying the dispatch for a bookkeeping write would be the
     * wrong trade. Silent on failure for the same reason.
     */
    private async _bumpAttempt(entry: QueueEntry): Promise<void> {
        const id = entry.ctx.meta?.clientOpId;
        if (!id) return;
        try {
            const store = await this._whenStoreReady();
            await store?.bumpAttempt(String(id));
        } catch { /* diagnostics only */ }
    }

    /**
     * Drop the crash-recovery record of an entry that left the queue (sent,
     * refused for good, coalesced out, dropped). Resolves once it is gone.
     */
    private async _unpersist(entry: QueueEntry): Promise<void> {
        const id = entry.ctx.meta?.clientOpId;
        if (!id) return;
        if (entry.persistState === "queued") {
            // Never written: take it out of the write queue instead.
            const at = this._persistQueue.indexOf(entry);
            if (at >= 0) this._persistQueue.splice(at, 1);
            this._settlePersist(entry, undefined, { ok: true });
            this._overflowChanged();
            return;
        }
        if (entry.persistState === "writing") {
            entry.persistCancelled = true;
            return;
        }
        // A replayed entry was written by the previous session.
        if (entry.persistState !== "written" && !(entry.isReplay && !entry.recordRemoved)) return;
        entry.persistState = undefined;
        entry.recordRemoved = true;
        await this._unpersistById(String(id));
    }

    /** Remove a record by id; removals of one tick share one transaction. */
    private _unpersistById(clientOpId: string): Promise<void> {
        this._removeQueue.push(clientOpId);
        const removed = new Promise<void>(resolve => this._removeWaiters.push(resolve));
        if (this._removeQueue.length === 1) Promise.resolve().then(() => this._flushRemovals());
        return removed;
    }

    private async _flushRemovals(): Promise<void> {
        const ids = this._removeQueue.splice(0);
        const waiters = this._removeWaiters.splice(0);
        try {
            const store = await this._whenStoreReady();
            if (store) {
                await store.removeMany(ids);
                this._persistedCount = Math.max(0, this._persistedCount - ids.length);
            }
        } catch (e) {
            console.warn(`[IO] resource "${this.name}" unpersist failed:`, e);
        } finally {
            for (const wake of waiters) wake();
            // Room under the cap: the next waiting records can be written.
            this._schedulePersistFlush();
            this._wakeHeadroom();
            this._overflowChanged();
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

    /**
     * Revert the local commit of ONE refused op.
     *
     * Deliberately not `history.undo()`: that pops whatever sits on top of the
     * stack — which, because dispatch is queued, is rarely the refused op — and
     * is offered to every `XOpatHistoryProvider` first, any of which may consume
     * it instead. Running the entry's own `inverseApply` reverts exactly the
     * right item, and invalidating its history entry keeps a later user undo
     * from reverting it a second time.
     *
     * No inverse op is dispatched: the forward op never reached the sink, so
     * the server has nothing to undo.
     */
    private async _revertEntry(entry: QueueEntry, result: IOResult): Promise<void> {
        const inverseApply = entry.options.inverseApply;
        if (!inverseApply) {
            if (!this._warnedNoInverse.has(entry.direction)) {
                this._warnedNoInverse.add(entry.direction);
                console.warn(
                    `[IO] resource "${this.name}": a "${entry.direction}" was refused but the `
                    + `call supplied no \`inverseApply\`, so the local change cannot be reverted. `
                    + `Pass one, or set \`rollbackOnAsyncRefuse: false\` to make that explicit.`,
                );
            }
            return;
        }

        const handle = entry.historyHandle ? await entry.historyHandle.catch(() => undefined) : undefined;
        // Already reverted — by a user undo, or by an earlier refusal on the
        // same entry. Reverting twice would apply the inverse to fresh state.
        if (handle && !handle.isActive()) return;

        try {
            inverseApply();
        } catch (e) {
            console.error(`[IO] resource "${this.name}" rollback failed:`, e);
            return;
        }
        handle?.invalidate();
        this._emitQueueEvent("io:reverted", {
            ownerUid: this.ownerUid, resourceName: this.name,
            direction: entry.direction, itemId: entry.itemId,
            ctx: entry.ctx, result,
        });
    }

    private _scheduleRollback(entry: QueueEntry, result: IOResult): void {
        void Promise.resolve().then(() => this._revertEntry(entry, result));
    }

    /**
     * `def.validate`, with a throw turned into a refusal. It is owner code: a
     * throw used to escape `create/update/delete` (and still escaped the `can*`
     * probes and `query`) synchronously, into callers that expect a result.
     */
    private _validate(itemOrPatch: any, ctx: IOContext): IOResult | undefined {
        try {
            return this.def.validate?.(itemOrPatch as T, ctx);
        } catch (e: any) {
            console.error(`[IO] resource "${this.name}" ${ctx.direction}: validate() threw.`, e);
            return { ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_VALIDATE_THREW" };
        }
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
        const v = this._validate(itemOrPatch, ctx);
        if (v && !v.ok) {
            // Surface it, exactly as a guard refusal is surfaced (IO_PIPELINE.md,
            // "Refusal surfacing"). This used to return silently: the caller got
            // `ok: false`, most callers ignore the sync result, and the user saw an
            // annotation that simply never saved with nothing said about it. The
            // `can*` probes call `def.validate` directly and are unaffected.
            this.pipeline.surfaceRefusal_(ctx, v as any);
            return v;
        }

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
                // Surfaced like a validate/guard refusal. Returning it silently
                // meant a local commit that blew up halfway left the user with a
                // half-applied change and no hint that it was never saved.
                console.error(`[IO] resource "${this.name}" ${direction}: local apply() threw; nothing was sent.`, e);
                const refusal: IOResult = {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_APPLY_THREW",
                };
                this.pipeline.surfaceRefusal_(ctx, refusal as any);
                return refusal;
            }
        }
        return { ok: true };
    }

    /**
     * Publish the owner's own identity for this item as `ctx.meta.localId`.
     *
     * A sink that stores remotely has to map "the record the server just created"
     * back to "the object on screen", and on `create` there is nothing else to map
     * with: `ctx.itemId` is absent by design (the id is the server's to assign, and
     * a REST sink would otherwise POST to `/resource/<id>`), and the serialized
     * payload need not carry the owner's local id either. `def.identityOf` already
     * computes exactly that value for coalescing — this just makes it visible.
     *
     * The synthetic fallback is deliberately not published: it is a uniqueness
     * device, not an identity, and a sink correlating on it would key state to a
     * value the owner cannot look up again.
     */
    private _stampLocalId(ctx: IOContext, identity: string): void {
        if (!identity || identity.startsWith("__synth__::")) return;
        if (!ctx.meta) (ctx as any).meta = {};
        (ctx.meta as Record<string, unknown>).localId = identity;
    }

    /** Identity key used for coalescing. Falls back to a synthetic per-call
     *  id when `def.identityOf` is missing or returns nothing. */
    private _identityFor(direction: "create" | "update" | "delete", itemOrPatch: any, itemId: string | undefined): string {
        if (direction !== "create" && itemId !== undefined) return String(itemId);
        try {
            const id = this.def.identityOf?.(itemOrPatch as T);
            if (id !== undefined && id !== null && String(id).length > 0) return String(id);
        } catch { /* ignore */ }
        // A `create` may still carry an explicit id — history replays of a
        // `delete` resurrect the entity under the id it already had, and the
        // caller may not have supplied a payload `identityOf` can read. Using
        // it keeps the entity's identity stable across undo/redo so the pair
        // still coalesces instead of leaking a synthetic key.
        if (itemId !== undefined) return String(itemId);
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
     * same-identity entry.
     *
     *  - `enqueue` — no rule matched; push the new entry normally.
     *  - `skip`    — the new entry is absorbed; the caller settles it.
     *  - `replace` — the new entry supersedes the partner and takes over its
     *                queue slot (never the tail), so ops on *other* identities
     *                keep their relative order.
     */
    private _coalesce(newEntry: QueueEntry): CoalesceVerdict {
        if (!this.def.coalesce) return VERDICT_ENQUEUE;
        const idx = this._findCoalescePartner(newEntry.identity);
        if (idx < 0) return VERDICT_ENQUEUE;
        const prev = this._outbox[idx]!;

        const dropPrev = () => {
            this._outbox.splice(idx, 1);
            prev.settle(COALESCED_RESULT);
            // Phase 10: also remove from IDB (best-effort).
            if (this.def.persistOutbox) void this._unpersist(prev);
        };
        const supersedePrev = (): CoalesceVerdict => {
            prev.settle(COALESCED_RESULT);
            if (this.def.persistOutbox) void this._unpersist(prev);
            return { action: "replace", index: idx };
        };

        // Rule: create + delete → both removed
        if (prev.direction === "create" && newEntry.direction === "delete") {
            dropPrev();
            return VERDICT_SKIP;
        }
        // Rule: delete + create → both removed
        if (prev.direction === "delete" && newEntry.direction === "create") {
            dropPrev();
            return VERDICT_SKIP;
        }
        // Rule: update + update → keep latest; with `merge`, fold the earlier
        // patch in first. Update payloads are partial patches: dropping the
        // earlier one loses its fields (e.g. `{presetID}` then `{layer}`).
        if (prev.direction === "update" && newEntry.direction === "update") {
            if (this.def.merge) {
                try {
                    newEntry.rawPayload = this.def.merge(prev.rawPayload, newEntry.rawPayload);
                } catch (e) {
                    console.warn(`[IO] resource "${this.name}" merge threw — keeping both ops:`, e);
                    return VERDICT_ENQUEUE;
                }
            }
            return supersedePrev();
        }
        // Rule: update + delete → drop update
        if (prev.direction === "update" && newEntry.direction === "delete") {
            return supersedePrev();
        }
        // Rule: create + update → merge into create
        if (prev.direction === "create" && newEntry.direction === "update" && this.def.merge) {
            try {
                // Everything that can throw (`merge`, `serialize` — owner code)
                // runs BEFORE `prev` is touched. Mutating first meant a throwing
                // `serialize` left the patch folded into the create AND, through
                // the catch below, queued as its own update: applied twice.
                const merged = this.def.merge(prev.rawPayload, newEntry.rawPayload);
                const replayed = prev.replayPayload !== undefined;
                const wire = !(replayed || this.def.persistOutbox) ? undefined
                    : (this.def.serialize ? this.def.serialize(merged as T, prev.ctx) : merged);
                prev.rawPayload = merged;
                // A replayed create dispatches `replayPayload`, not `rawPayload`
                // — without this the merged update never reached the wire.
                if (replayed) prev.replayPayload = wire;
                // Phase 10: rewrite the persisted entry's payload.
                // A record still `queued` is serialized from `rawPayload` when
                // its run comes; one being written is rewritten after it lands.
                if (this.def.persistOutbox && prev.persistState === "writing") {
                    prev.persistRewrite = { payload: wire };
                } else if (this.def.persistOutbox && (prev.persistState === "written" || prev.isReplay)) {
                    void this._whenStoreReady().then(store => {
                        if (!store) return;
                        return store.update(String(prev.ctx.meta.clientOpId), { serializedPayload: wire });
                    }).catch(() => {});
                }
                return VERDICT_SKIP; // new is folded into prev
            } catch (e) {
                console.warn(`[IO] resource "${this.name}" merge threw — keeping both ops:`, e);
                return VERDICT_ENQUEUE;
            }
        }
        return VERDICT_ENQUEUE;
    }

    /**
     * Build a queue entry with a settle Promise.
     *
     * `reuseCtx` lets the caller hand in the very ctx the sync core (validate +
     * guards) already ran against, so guards and the sink observe one identical
     * context object instead of two that can drift apart.
     */
    private _makeEntry(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        itemId: string | undefined,
        options: IOResourceMutateOptions,
        reuseCtx?: IOContext,
    ): QueueEntry {
        const ctx = reuseCtx ?? this.buildCtx(direction, itemId, options.meta);
        const identity = this._identityFor(direction, itemOrPatch, itemId);
        this._stampLocalId(ctx, identity);
        const entry: any = {
            direction, itemId, options, ctx,
            identity,
            rawPayload: itemOrPatch,
            started: false,
        };
        entry.settled = new Promise<IOResult>((resolve) => { entry.settle = resolve; });
        return entry as QueueEntry;
    }

    /** Enqueue a queue entry; apply coalescing first; start worker if idle. */
    private _enqueue(entry: QueueEntry): Promise<IOResult> {
        // Re-read after the synchronous enqueue below settles the queue shape —
        // once per tick, so a bulk gesture of N ops costs one re-check, not N.
        if (!this._dirtyCheckQueued) {
            this._dirtyCheckQueued = true;
            queueMicrotask(() => { this._dirtyCheckQueued = false; this._notifyDirty(); });
        }
        const verdict = this._coalesce(entry);
        if (verdict.action === "skip") {
            // Absorbed by a pending same-identity op. Settle centrally so
            // `await result.settled` never hangs, whichever rule matched.
            entry.settle(COALESCED_RESULT);
            return entry.settled;
        }
        if (verdict.action === "replace") {
            // Takes over the superseded entry's slot: the queue length is
            // unchanged (no capacity pre-flight) and cross-identity ordering
            // is preserved, unlike a splice + tail push.
            this._outbox[verdict.index] = entry;
            if (this._shouldPersist(entry)) {
                entry.persistedPromise = this._persistEntry(entry);
            }
            if (!this._running) {
                Promise.resolve().then(() => this._run());
            }
            return entry.settled;
        }

        // The cap (`persistMaxEntries`) bounds what is persisted, not what is
        // accepted: past it an op keeps its place in the queue and waits for its
        // crash-recovery record (see `_persistEntry`), so a change of any size
        // goes through whole instead of having its tail refused and reverted.
        // What is refused is only a queue beyond the memory ceiling.
        // Only where something is actually owed: with nothing bound the worker
        // answers `{ok: true}` without dispatching, so a large synchronous
        // gesture (delete 20 000 annotations) is not a backlog.
        if (this._capped()) {
            const cap = this._ceiling();
            const pending = this._outbox.length;
            if (pending >= cap) {
                const refusal: IOResult = {
                    ok: false, refused: true,
                    reason: "outbox ceiling reached",
                    code: "W_IO_OUTBOX_FULL",
                    userMessage: $.t("error.ioOutboxFull", { pending, cap }),
                };
                this._emitQueueEvent("io:outbox-full", {
                    ownerUid: this.ownerUid, resourceName: this.name, pending,
                });
                // The event and the rollback are per op; the dialog is per
                // episode. A bulk gesture hitting the ceiling would otherwise
                // raise one identical dialog for every op it carried.
                this.pipeline.surfaceRefusal_(entry.ctx, refusal as any, !this._fullSurfaced);
                this._fullSurfaced = true;
                entry.settle(refusal);
                if (wantsRollback(entry.options)) this._scheduleRollback(entry, refusal);
                return entry.settled;
            }
            this._fullSurfaced = false;
        }

        this._outbox.push(entry);

        // Queue the crash-recovery record (the worker awaits it before dispatching).
        if (this._shouldPersist(entry)) {
            entry.persistedPromise = this._persistEntry(entry);
            this._overflowChanged();
        }

        if (!this._running) {
            // Start the worker on the next microtask so the caller's sync
            // frame finishes (including history push) before we begin.
            Promise.resolve().then(() => this._run());
        }
        return entry.settled;
    }

    /**
     * Is this resource's binding waiting for a sink that has not registered yet?
     *
     * Tolerant of a pipeline that predates the predicate — an older host simply
     * never holds, which is the behaviour it had anyway.
     */
    private _bindingsPending(): boolean {
        const p = (this.pipeline as any).bindingsPending;
        return typeof p === "function" && p.call(this.pipeline, this.ownerUid, this.capabilityId) === true;
    }

    /**
     * Should this entry get a crash-recovery record?
     *
     * Not when nothing is bound: the worker answers `{ok: true}` without
     * dispatching and removes the record again, so every operation paid a
     * `serialize` + IndexedDB write + delete for nothing. A PENDING binding is
     * the opposite case — the entry is held, and that is exactly what must
     * survive a reload.
     */
    private _shouldPersist(entry: QueueEntry): boolean {
        if (!this.def.persistOutbox || entry.isReplay) return false;
        return this.pipeline.isEnabled(this.ownerUid, this.capabilityId) || this._bindingsPending();
    }

    /** The answer for a queue that cannot move right now — see {@link flush}. */
    private _heldResult(): IOResult {
        const pending = this._bindingsPending();
        return {
            ok: false, refused: true,
            code: pending ? "W_IO_SINK_NOT_READY" : "W_IO_OFFLINE",
            reason: pending
                ? `${this.name}: the configured destination has not registered yet`
                : `${this.name}: offline`,
            userMessage: $.t(pending ? "error.ioSinkNotReady" : "error.ioOffline",
                { count: this._outbox.length }),
        };
    }

    /** Worker: drain the outbox FIFO. Pauses when `_offline` is true or a bound sink is missing. */
    private async _run(): Promise<void> {
        if (this._running) return;
        // Hold until the previous session's persisted ops have been re-enqueued,
        // otherwise an op issued during boot is dispatched before ops that
        // happened before it. `_markReplayDone` restarts us.
        if (!this._replayDone) return;
        this._running = true;
        try {
            while (this._outbox.length > 0) {
                // Two reasons not to dispatch right now, one mechanism. Offline
                // is transport; pending is destination — the operator bound a
                // sink that has not registered yet (a module still completing a
                // handshake). Dispatching anyway is worse than waiting: with no
                // live sink the pipeline reports `{ok: true}` and the write is
                // gone. Holding keeps the entry, the outbox, and the truth.
                if (this._offline || this._bindingsPending()) {
                    // Don't burn `withRetry` budget while definitively offline.
                    if (!this._stalled) {
                        this._stalled = true;
                        this._emitQueueEvent("io:queue-stalled", {
                            ownerUid: this.ownerUid, resourceName: this.name,
                            pending: this._outbox.length,
                        });
                    }
                    // Release anyone awaiting `flush()`: the hold may have begun
                    // after they checked, and these entries may never settle.
                    if (this._holdWaiters.length) {
                        const held = this._heldResult();
                        for (const wake of this._holdWaiters.splice(0)) wake(held);
                    }
                    this._wakeHeadroom();
                    break;
                }

                // A contiguous prefix, so strict FIFO holds: nothing overtakes.
                // Every member is marked started before the first await, which
                // also takes it out of coalescing — the prefix cannot change
                // under us while the sink call is in flight.
                const batch = this._takeBatch();
                for (const entry of batch) {
                    entry.started = true;
                    // Record the attempt before making it: a crash mid-dispatch must
                    // leave evidence that this op was tried, otherwise `attemptCount`
                    // is 0 forever and a poison entry replayed on every boot is
                    // indistinguishable from a fresh one.
                    if (this.def.persistOutbox && !entry.attemptRecorded) {
                        entry.attemptRecorded = true;
                        void this._bumpAttempt(entry);
                    }
                }

                const results = batch.length === 1
                    ? [await this._executeEntry(batch[0]!)]
                    : await this._executeBatch(batch);
                batch.forEach((entry, i) => entry.settle(results[i]!));
                this._outbox.splice(0, batch.length);
                this._wakeHeadroom();
                this._overflowChanged();

                // Stall / resume detection (network/5xx).
                if (results.some(isStallSignal)) {
                    if (!this._stalled) {
                        this._stalled = true;
                        this._emitQueueEvent("io:queue-stalled", {
                            ownerUid: this.ownerUid, resourceName: this.name,
                            pending: this._outbox.length + batch.length,
                        });
                    }
                } else if (this._stalled && results.some(r => r.ok)) {
                    this._stalled = false;
                    this._emitQueueEvent("io:queue-resumed", {
                        ownerUid: this.ownerUid, resourceName: this.name,
                    });
                }
            }
        } finally {
            this._running = false;
            this._wakeHeadroom();
            if (!this._stalled && this._outbox.length === 0) {
                this._emitQueueEvent("io:queue-empty", {
                    ownerUid: this.ownerUid, resourceName: this.name,
                });
            }
        }
    }

    /** Execute one queue entry: persist-await + dispatch + unpersist + rollback. */
    /**
     * Report a failed outbox write once per `(code, resource)`, with the fix.
     *
     * These failures are almost always *systematic* — a resource whose payload
     * cannot be structured-cloned fails on every single operation, so recording
     * a tour produced one identical warning per step and the actual advice
     * ("declare a serialize()") appeared nowhere. Say it once, say what to do.
     *
     * The write is still ATTEMPTED every time: only the logging is deduped, so
     * a resource that fails on one payload and succeeds on the next keeps its
     * crash-recovery for the ones that work.
     */
    private _warnOutboxFailureOnce(code: string, reason: string): void {
        const key = `${code}|${this.name}`;
        if (this._warnedOutboxFailures.has(key)) return;
        this._warnedOutboxFailures.add(key);
        const hint = code === "W_IO_OUTBOX_WRITE" && /clone/i.test(String(reason ?? ""))
            ? ` The payload is not structured-cloneable — declare a serialize() on this resource `
              + `that returns JSON-safe data (see src/types/io.d.ts, "persistOutbox").`
            : "";
        console.warn(`[IO] resource "${this.name}": outbox persistence is failing (${code}).${hint} `
            + `Dispatch is unaffected; crash-recovery is off for this resource. Reason:`, reason);
    }

    /**
     * The head entry plus the consecutive unstarted same-direction entries
     * behind it, up to what the bound sinks take in one call. With no
     * bulk-capable sink bound for that direction the limit is 1 — the worker
     * then runs exactly the one-op path it always did.
     */
    private _takeBatch(): QueueEntry[] {
        const head = this._outbox[0]!;
        const batch = [head];
        // Tolerant of a pipeline that predates batching: it simply never batches.
        const limit = (this.pipeline as any).batchLimit?.(this.ownerUid, this.capabilityId, head.direction) ?? 1;
        for (let i = 1; i < this._outbox.length && batch.length < limit; i++) {
            const e = this._outbox[i]!;
            if (e.started || e.direction !== head.direction) break;
            // Its crash-recovery record is still waiting — possibly for room under
            // the cap, which only this very batch finishing would free. The worker
            // awaits every member's record, so taking it could never complete.
            if (e.persistState === "queued") break;
            batch.push(e);
        }
        return batch;
    }

    /** Wait for the crash-recovery write; report (never fail on) a miss. */
    private async _awaitPersisted(entry: QueueEntry): Promise<void> {
        // Phase 10: wait for IDB persist before dispatching (crash-safe).
        // Outbox persistence is a best-effort crash-recovery optimization, NOT
        // a gate on the real save. A write failure (quota / structured-clone /
        // IDB error) must not drop the user's op — surface it loudly and fall
        // through to dispatch so the sink still receives the mutation. Rollback
        // stays tied to actual dispatch refusal below, never to a persist miss.
        if (entry.persistedPromise) {
            const pr = await entry.persistedPromise;
            if (!pr.ok) {
                // The EVENT stays per-operation: a listener may legitimately
                // count how many ops lost their crash-recovery record.
                this._emitQueueEvent("io:outbox-write-failed", {
                    ownerUid: this.ownerUid, resourceName: this.name,
                    code: (pr as any).code, reason: (pr as any).reason,
                });
                this._warnOutboxFailureOnce((pr as any).code, (pr as any).reason);
            }
        }
    }

    /**
     * Build what goes on the wire for one entry — or the refusal that stops it
     * from going there.
     */
    private _prepareDispatch(entry: QueueEntry, toast = true):
        { ctx: IOContext; payload: unknown } | { result: IOResult } {
        const dispatchCtx: IOContext = {
            ...entry.ctx,
            meta: { ...entry.ctx.meta, phase: "post-commit" },
        };
        // `serialize` is owner code and can throw (a live object with circular
        // refs, a half-built patch). It used to sit outside any try, so a throw
        // escaped the worker entirely: the entry was never settled, never
        // shifted off `_outbox`, and the worker left through its `finally` with
        // `_running = false` — every later write for that resource then queued
        // behind an op that could never complete. A silent, permanent stall.
        // Its own code, not `W_IO_DISPATCH_THREW`: this is a local defect, and
        // `isStallSignal` must not read it as the network being down.
        try {
            const payload = entry.replayPayload !== undefined
                ? entry.replayPayload
                : (entry.direction === "delete"
                    ? undefined
                    : (this.def.serialize ? this.def.serialize(entry.rawPayload as T, dispatchCtx) : entry.rawPayload));
            return { ctx: dispatchCtx, payload };
        } catch (e: any) {
            const result: IOResult = {
                ok: false, refused: true,
                reason: `serialize() threw for ${this.name}: ${e?.message ?? e}`,
                code: "W_IO_SERIALIZE_THREW",
            };
            console.error(`[IO] resource "${this.name}" serialize() threw; the ${entry.direction} `
                + "was rolled back and nothing was sent.", e);
            this.pipeline.surfaceRefusal_(dispatchCtx, result as any, toast);
            return { result };
        }
    }

    /** Drop the crash-recovery record and revert the local commit of a refused op. */
    private async _finishEntry(entry: QueueEntry, result: IOResult): Promise<void> {
        // Phase 10: remove from IDB once dispatch settled (success OR
        // terminal refusal — we don't infinitely re-attempt).
        if (this.def.persistOutbox) {
            await this._unpersist(entry).catch(() => {});
        }
        if (!result.ok && wantsRollback(entry.options)) {
            await this._revertEntry(entry, result);
        }
    }

    private _dispatchThrew(ctx: IOContext, e: any, toast = true): IOResult {
        const result: IOResult = {
            ok: false, refused: true,
            reason: e?.message ?? String(e),
            code: "W_IO_DISPATCH_THREW",
        };
        this.pipeline.surfaceRefusal_(ctx, result as any, toast);
        return result;
    }

    private async _executeEntry(entry: QueueEntry): Promise<IOResult> {
        await this._awaitPersisted(entry);

        let result: IOResult;
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId)) {
            result = { ok: true };
        } else {
            const prepared = this._prepareDispatch(entry);
            if ("result" in prepared) {
                result = prepared.result;
            } else {
                try {
                    result = await this.pipeline.dispatch(prepared.ctx, prepared.payload);
                } catch (e: any) {
                    result = this._dispatchThrew(prepared.ctx, e);
                }
            }
        }

        await this._finishEntry(entry, result);
        return result;
    }

    /**
     * {@link _executeEntry} for a run of same-direction entries: one sink call
     * for the lot, then each entry is finished on its own result — an item the
     * destination refused is reverted, its neighbours are not.
     */
    private async _executeBatch(batch: QueueEntry[]): Promise<IOResult[]> {
        await Promise.all(batch.map(e => this._awaitPersisted(e)));

        const results: IOResult[] = new Array(batch.length);
        const ctxs: IOContext[] = [];
        const payloads: unknown[] = [];
        const slots: number[] = [];
        let serializeToasted = false;
        batch.forEach((entry, i) => {
            const prepared = this._prepareDispatch(entry, !serializeToasted);
            if ("result" in prepared) { results[i] = prepared.result; serializeToasted = true; return; }
            ctxs.push(prepared.ctx); payloads.push(prepared.payload); slots.push(i);
        });

        if (ctxs.length) {
            let out: IOResult[];
            try {
                out = await this.pipeline.dispatchMany(ctxs, payloads);
            } catch (e: any) {
                out = ctxs.map((ctx, k) => this._dispatchThrew(ctx, e, k === 0));
            }
            // No answer is not a success: an op nobody confirmed stays owed, so
            // it is refused (and reverted) rather than dropped as done.
            slots.forEach((i, k) => {
                results[i] = out[k] ?? {
                    ok: false, refused: true, code: "W_IO_BULK_RESULT",
                    reason: `${this.name}: no result for a batched ${batch[i]!.direction}`,
                };
            });
        }

        // The records of a run go in one removal; reverts stay in order.
        if (this.def.persistOutbox) await Promise.all(batch.map(e => this._unpersist(e).catch(() => {})));
        for (let i = 0; i < batch.length; i++) {
            if (!results[i]!.ok && wantsRollback(batch[i]!.options)) await this._revertEntry(batch[i]!, results[i]!);
        }
        return results;
    }

    private _cap(): number {
        return this.def.persistMaxEntries ?? 5000;
    }

    /** Most ops the queue holds at all, persisted or not. */
    private _ceiling(): number {
        return Math.max(this._cap(), this.def.maxPending ?? 1_000_000);
    }

    /**
     * More ops are queued than the cap lets on disk, and some still wait for
     * their crash-recovery record. Measured on the queue, not on the store's
     * momentary count: between two write runs the count dips under the cap
     * while the tail is as unwritten as before. A lone edit never qualifies —
     * its record is written within the tick.
     */
    private _overflowing(): boolean {
        return this._persistQueue.length > 0 && this._outbox.length > this._cap();
    }

    /** Overflow decides `hasUnsavedWork()`: tell the dirty registry when it flips. */
    private _overflowChanged(): void {
        const now = this._overflowing();
        if (now === this._wasOverflowing) return;
        this._wasOverflowing = now;
        this._notifyDirty();
    }

    /**
     * Ops this resource still owes its destination. Every persisted entry is
     * also in `_outbox`, so the two counts overlap — summing them (as the cap
     * pre-flight used to) reported the outbox full at half its capacity.
     * `_persistedCount` can only exceed the queue transiently, while a removal
     * of a coalesced-out record is still in flight.
     */
    private _pending(): number {
        return Math.max(this._outbox.length, this._persistedCount);
    }

    /** The cap applies: ops are persisted, and a destination (bound or awaited) will receive them. */
    private _capped(): boolean {
        return !!this.def.persistOutbox
            && (this.pipeline.isEnabled(this.ownerUid, this.capabilityId) || this._bindingsPending());
    }

    headroom(): number {
        if (!this._capped()) return Infinity;
        return Math.max(0, this._cap() - this._pending());
    }

    whenHeadroom(count = 1): Promise<boolean> {
        const need = Math.min(Math.max(1, Math.floor(count) || 1), this._cap());
        if (this.headroom() >= need) return Promise.resolve(true);
        if (this._held()) return Promise.resolve(false);
        return new Promise<boolean>(resolve => this._headroomWaiters.push({ need, resolve }));
    }

    /** The queue cannot move right now: offline, or the bound sink is not registered. */
    private _held(): boolean {
        return this._offline || this._bindingsPending();
    }

    /** Release `whenHeadroom()` callers whose room arrived — or who would wait on a held queue. */
    private _wakeHeadroom(): void {
        if (!this._headroomWaiters.length) return;
        const room = this.headroom();
        const held = this._held();
        this._headroomWaiters = this._headroomWaiters.filter(w => {
            if (room >= w.need) { w.resolve(true); return false; }
            if (held) { w.resolve(false); return false; }
            return true;
        });
    }

    private _emitQueueEvent(name: string, payload: Record<string, unknown>) {
        try {
            (this.pipeline as any).emitQueueEvent_?.(name, payload);
        } catch { /* pipeline may not be ready */ }
        // Every queue transition (stalled / resumed / empty) can flip whether
        // this resource holds unsaved work — let the dirty registry re-read it.
        this._notifyDirty();
    }

    /**
     * Ops owed to a destination that would be LOST if the page closed now.
     *
     * A persisted outbox replays on the next boot, so its pending ops are not
     * at risk while the queue moves. They are once it cannot: stalled
     * (offline, 5xx, sink not registered) or the IndexedDB store is gone.
     * A resource without `persistOutbox` holds its queue in memory only.
     */
    hasUnsavedWork(): boolean {
        if (this._pending() === 0) return false;
        // Nothing bound, nothing awaited: the worker answers without
        // dispatching, so these entries are owed to no one.
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId) && !this._bindingsPending()) return false;
        if (!this.def.persistOutbox || this._store === null) return true;
        // Ops past the cap have no crash-recovery record yet: a reload loses them.
        if (this._overflowing()) return true;
        return this._stalled || this._held();
    }

    private _notifyDirty(): void {
        try {
            (this.pipeline as any).resourceDirtyChanged_?.(this, this.ownerUid);
        } catch { /* pipeline may not be ready */ }
    }

    /** One warning per resource+direction — a missing `inversePayload` is a
     *  code-level omission, not a per-call condition. */
    private _warnedInverse = new Set<string>();
    /** Same, for a refusal that cannot be reverted for lack of `inverseApply`. */
    private _warnedNoInverse = new Set<string>();

    /**
     * Payload the inverse op must put on the wire. `inverseApply` repairs
     * local state; the sink needs its own body, and it is NOT the forward
     * one — undoing a `delete` means re-creating the full item, undoing an
     * `update` means sending the reverting patch. Only the inverse of a
     * `create` is content-free (a `delete` addressed by id).
     */
    private _inversePayloadFor(
        direction: "create" | "update" | "delete",
        forwardPayload: any,
        options: IOResourceMutateOptions,
    ): any {
        if (direction === "create") return undefined;
        const supplied = options.inversePayload;
        if (supplied !== undefined) {
            return typeof supplied === "function" ? (supplied as () => unknown)() : supplied;
        }
        if (!this._warnedInverse.has(direction)) {
            this._warnedInverse.add(direction);
            console.warn(
                `[IO] resource "${this.name}": undo of a "${direction}" has no `
                + `\`inversePayload\`. The inverse op reaches the sink without a body `
                + `(an undone delete resurrects an empty record; an undone update `
                + `re-sends the forward patch). Local state is unaffected.`,
            );
        }
        // Degrade, don't refuse: a sink that undeletes by id still works, and
        // an update falls back to today's behaviour rather than dropping the op.
        return direction === "update" ? forwardPayload : undefined;
    }

    private _pushHistoryEntry(
        direction: "create" | "update" | "delete",
        itemOrPatch: any,
        itemId: string | undefined,
        options: IOResourceMutateOptions,
    ): Promise<HistoryEntryHandle | undefined> | undefined {
        const inverseDirection = (
            direction === "create" ? "delete"
            : direction === "delete" ? "create"
            : "update"
        ) as "create" | "update" | "delete";
        const apply = options.apply!;
        const inverseApply = options.inverseApply!;
        const baseMeta = { ...(options.meta ?? {}) };
        const self = this;

        // `create` is dispatched with no itemId (the id is the item's own), so
        // the inverse `delete` would reach the sink unaddressable. Recover it
        // from the payload the same way the coalescing pass does.
        let inverseItemId = itemId;
        if (direction === "create" && inverseItemId === undefined) {
            try {
                const id = this.def.identityOf?.(itemOrPatch as T);
                if (id !== undefined && id !== null && String(id).length > 0) inverseItemId = String(id);
            } catch { /* leave undefined — nothing better available */ }
        }

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
            // Resolved at undo time so a thunk can snapshot current state.
            const inversePayload = self._inversePayloadFor(direction, itemOrPatch, options);
            self._dispatchInternal(inverseDirection, inversePayload, inverseItemId, {
                ...options,
                meta: { ...baseMeta, fromUndo: true },
                apply: inverseApply, inverseApply: apply,
                skipGuards: true,
                skipHistory: true,
                rollbackOnAsyncRefuse: false,
            });
        };

        const history = (globalThis as any).APPLICATION_CONTEXT?.history;
        return history?.pushExecuted?.(redo, undo, {
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
        // Replays inherit ctx from the freshly built one (with fromUndo/fromRedo).
        const entry = this._makeEntry(direction, itemOrPatch, itemId, options, ctx);
        void this._enqueue(entry);
    }

    // ── Public mutating methods (sync core + .settled) ─────────────────

    create(item: T, options: IOResourceMutateOptions = {}): IOSyncResult<{ id: string }> {
        const ctx = this.buildCtx("create", undefined, options.meta);
        const r = this._runSyncCore("create", item, ctx, options);
        if (!r.ok) return { ...(r as IOResult<{ id: string }>), settled: Promise.resolve(r as IOResult<{ id: string }>) };

        const entry = this._makeEntry("create", item, undefined, options, ctx);
        if (options.apply && options.inverseApply && !options.skipHistory) {
            entry.historyHandle = this._pushHistoryEntry("create", item, undefined, options);
        }
        const settled = this._enqueue(entry) as Promise<IOResult<{ id: string }>>;
        return { ok: true, settled };
    }

    update(itemId: string, patch: Partial<T>, options: IOResourceMutateOptions = {}): IOSyncResult {
        const ctx = this.buildCtx("update", itemId, options.meta);
        const r = this._runSyncCore("update", patch, ctx, options);
        if (!r.ok) return { ...r, settled: Promise.resolve(r) };

        const entry = this._makeEntry("update", patch, itemId, options, ctx);
        if (options.apply && options.inverseApply && !options.skipHistory) {
            entry.historyHandle = this._pushHistoryEntry("update", patch, itemId, options);
        }
        const settled = this._enqueue(entry);
        return { ok: true, settled };
    }

    delete(itemId: string, options: IOResourceMutateOptions = {}): IOSyncResult {
        const ctx = this.buildCtx("delete", itemId, options.meta);
        const r = this._runSyncCore("delete", undefined, ctx, options);
        if (!r.ok) return { ...r, settled: Promise.resolve(r) };

        const entry = this._makeEntry("delete", undefined, itemId, options, ctx);
        if (options.apply && options.inverseApply && !options.skipHistory) {
            entry.historyHandle = this._pushHistoryEntry("delete", undefined, itemId, options);
        }
        const settled = this._enqueue(entry);
        return { ok: true, settled };
    }

    // ── flush / drop ───────────────────────────────────────────────────

    /**
     * Await everything currently queued.
     *
     * A held queue must NOT be awaited: `flushAllResources` sits behind the user's
     * Save button with a loading spinner, and an entry waiting for a sink that has
     * not registered yet may never settle — the spinner would spin forever. Answer
     * honestly instead, and leave the work queued rather than dropping it. Same
     * reasoning for `_offline`: "we could not send this now" is a result, not a
     * reason to block the UI indefinitely.
     */
    flush(): Promise<IOResult[]> {
        if (this._outbox.length && (this._offline || this._bindingsPending())) {
            return Promise.resolve([this._heldResult()]);
        }
        if (!this._outbox.length) return Promise.resolve([]);
        // The check above is a snapshot. If the queue starts holding while we
        // wait (connection drops mid-drain), the worker wakes us with the same
        // honest answer instead of leaving the caller on entries that are parked.
        let wake!: (r: IOResult) => void;
        const held = new Promise<IOResult[]>((resolve) => { wake = (r) => resolve([r]); });
        this._holdWaiters.push(wake);
        const drained = Promise.all(this._outbox.map(e => e.settled));
        return Promise.race([drained, held]).finally(() => {
            const i = this._holdWaiters.indexOf(wake);
            if (i >= 0) this._holdWaiters.splice(i, 1);
        });
    }

    drop(): void {
        const dropped: QueueEntry[] = [];
        const remain: QueueEntry[] = [];
        for (const e of this._outbox) (e.started ? remain : dropped).push(e);
        this._outbox = remain;
        for (const e of dropped) {
            e.settle(DROPPED_RESULT);
            // Otherwise the crash-recovery record outlives the drop and the op
            // the caller discarded is replayed on the next boot. The local
            // commit is deliberately left alone: dropping is the caller's
            // decision about what is owed, not a refusal to revert.
            if (this.def.persistOutbox) void this._unpersist(e);
        }
        this._notifyDirty();
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

    // These are questions, not operations: nothing has happened, and nothing
    // will unless the caller goes on to `create/update/delete`. So by default
    // they do NOT surface the refusal — a probe that drives UI enablement (is
    // this row deletable?) would otherwise emit a user-facing error toast on
    // every render. A caller that aborts a *user gesture* on the answer passes
    // `{ surface: true }`, which is the one place the user should hear about it.
    canCreate(item: T, meta?: Record<string, unknown>, options: IOGuardProbeOptions = {}): IOResult {
        const ctx = this.buildCtx("create", undefined, meta);
        const v = this._validate(item, ctx);
        if (v && !v.ok) return v;
        const ctxPre = { ...ctx, direction: "pre-create" as IODirection };
        return this.pipeline.runGuards(ctxPre, item, { surface: options.surface === true });
    }

    canUpdate(itemId: string, patch: Partial<T>, meta?: Record<string, unknown>,
              options: IOGuardProbeOptions = {}): IOResult {
        const ctx = this.buildCtx("update", itemId, meta);
        const v = this._validate(patch, ctx);
        if (v && !v.ok) return v;
        const ctxPre = { ...ctx, direction: "pre-update" as IODirection };
        return this.pipeline.runGuards(ctxPre, patch, { surface: options.surface === true });
    }

    canDelete(itemId: string, meta?: Record<string, unknown>, options: IOGuardProbeOptions = {}): IOResult {
        const ctx = this.buildCtx("delete", itemId, meta);
        const ctxPre = { ...ctx, direction: "pre-delete" as IODirection };
        return this.pipeline.runGuards(ctxPre, undefined, { surface: options.surface === true });
    }

    // ── streamed query (async by nature) ───────────────────────────────

    query(params: Record<string, unknown>, meta?: Record<string, unknown>): AsyncIterable<T> {
        if (!this.pipeline.isEnabled(this.ownerUid, this.capabilityId)) {
            return (async function* () {})();
        }
        const ctx = this.buildCtx("query", undefined, meta);
        const def = this.def;
        const validate = (item: T, c: IOContext) => this._validate(item, c);
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
                    const v = validate(item, ctx);
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
