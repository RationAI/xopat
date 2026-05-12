// Generic IO/persistence pipeline.
// See src/IO_PIPELINE.md for the design. Ambient public types live in
// src/types/io.d.ts (IOCapability, IOContext, IOSink, IOResult,
// IOKVDriver, IOKVHandle, …).

import { SyncKVHandle, AsyncKVHandle } from "./io-kv-handle";

/**
 * Thrown by the pipeline for fatal IO setup mistakes (e.g. binding a sync
 * KV handle to an async driver). Recoverable refusals do NOT throw — they
 * return `IOResult` with `refused: true`.
 */
export class IOError extends Error {
    code: string;
    constructor(message: string, code: string) {
        super(message);
        this.name = "IOError";
        this.code = code;
    }
}

/** Default driver per kv namespace. Used as the rule-5 fallback in
 *  `resolveBindings`. Drivers actually registered are checked at runtime. */
const KV_NAMESPACE_FALLBACK: Record<string, string> = {
    "cache": "local-storage",
    "cookies": "cookies",
    "session": "session-storage",
    "data": "post-data",
};

type Handler = (event: any) => void;

class EventBus {
    private readonly handlers: Map<string, Set<Handler>> = new Map();

    addHandler(eventName: string, handler: Handler) {
        let set = this.handlers.get(eventName);
        if (!set) {
            set = new Set();
            this.handlers.set(eventName, set);
        }
        set.add(handler);
    }

    removeHandler(eventName: string, handler: Handler) {
        this.handlers.get(eventName)?.delete(handler);
    }

    raiseEvent(eventName: string, data: any = {}) {
        const set = this.handlers.get(eventName);
        if (!set) return;
        for (const h of Array.from(set)) {
            try { h(data); }
            catch (e) { console.error(`[IO] handler for "${eventName}" threw:`, e); }
        }
    }
}

interface OwnerRecord {
    ownerUid: string;
    ownerId: string;
    xoType: "core" | "plugin" | "module";
    exportBundle?: (ctx: IOContext) => Promise<unknown> | unknown;
    importBundle?: (ctx: IOContext, data: unknown) => Promise<void> | void;
    /** `global`     — exportBundle called once per owner.
     *  `per-viewer` — exportBundle called once per viewer (ctx.viewerId set).
     *  `both`       — both (preserves legacy `inViewerContext: true` behaviour). */
    bundleScope: "global" | "per-viewer" | "both";
    capabilities: Map<string, IOCapability>;
    defaultBindings: Record<string, string[]>;
    /** include.json hard-disable. */
    disabled: boolean;
}

export interface IOPipelineOptions {
    /** Reference to the global POST_DATA dict so the post-data sink
     *  can preserve the legacy HTML-form session export. */
    POST_DATA: Record<string, any>;
    /** Lazy getter for app-level IO config (in ENV.client.io). */
    getConfig: () => IOConfigBlock | undefined;
    /** Lazy getter for active viewers (uniqueId required); used to expand
     *  per-viewer bundle exports. Returns [] when none active. */
    getViewers?: () => Array<{ uniqueId: string; viewer?: any }>;
    /** Lazy getter for the user-facing notifier; defaults to console. */
    notify?: (message: string, level: "info" | "warn" | "error") => void;
}

/**
 * The pipeline orchestrator. Singleton, exposed as `window.IO_PIPELINE`
 * and aliased on `APPLICATION_CONTEXT.io`.
 */
export class IOPipeline implements IOPipelineLike {
    private readonly bus = new EventBus();
    private readonly sinks: Map<string, IOSink> = new Map();
    private readonly kvDrivers: Map<string, IOKVDriver> = new Map();
    private readonly owners: Map<string, OwnerRecord> = new Map();
    /** Guards keyed by resource name; `"*"` is the wildcard bucket. */
    private readonly guards: Map<string, IOGuardSpec[]> = new Map();
    /** Resolved per-owner bindings cache (invalidated on registerOwner / config change). */
    private readonly bindingCache: Map<string, string[]> = new Map();

    public readonly POST_DATA: Record<string, any>;
    private readonly getConfig: () => IOConfigBlock | undefined;
    private readonly getViewers: () => Array<{ uniqueId: string; viewer?: any }>;
    private readonly notifier: (m: string, l: "info" | "warn" | "error") => void;
    /**
     * True until the loader's boot-time `forceDataImportInitialization`
     * fires and the host calls `markBootRestoreComplete()`. While pending,
     * `tryRestoreImport({ ownerUid })` (initIO's catch-up) only restores
     * GLOBAL bundles and trusts the boot pass to dispatch per-viewer.
     * After the boot pass, late-registered owners (lazy singletons) get
     * per-viewer catch-up directly from their `initIO`.
     */
    private bootRestorePending = true;

    constructor(options: IOPipelineOptions) {
        this.POST_DATA = options.POST_DATA;
        this.getConfig = options.getConfig;
        this.getViewers = options.getViewers ?? (() => []);
        this.notifier = options.notify ?? ((m, l) => {
            const fn = l === "error" ? console.error : l === "warn" ? console.warn : console.info;
            fn(`[IO] ${m}`);
        });
    }

    // ── capability registry ───────────────────────────────────────────

    registerCapability(ownerUid: string, cap: IOCapability): IODisposer {
        const owner = this.owners.get(ownerUid);
        if (!owner) {
            console.warn(`[IO] registerCapability: owner "${ownerUid}" not registered yet.`);
            return () => {};
        }
        owner.capabilities.set(cap.id, cap);
        this.invalidateBindingCache(ownerUid);
        return () => {
            const o = this.owners.get(ownerUid);
            if (o) o.capabilities.delete(cap.id);
            this.invalidateBindingCache(ownerUid);
        };
    }

    listCapabilities(ownerUid?: string) {
        const out: Array<{ ownerUid: string; capability: IOCapability }> = [];
        for (const [uid, owner] of this.owners) {
            if (ownerUid && uid !== ownerUid) continue;
            for (const cap of owner.capabilities.values()) {
                out.push({ ownerUid: uid, capability: cap });
            }
        }
        return out;
    }

    // ── sink registry ──────────────────────────────────────────────────

    registerSink(s: IOSink): IODisposer {
        if (this.sinks.has(s.id)) {
            console.warn(`[IO] sink "${s.id}" already registered; replacing.`);
        }
        this.sinks.set(s.id, s);
        this.bindingCache.clear();
        return () => {
            const cur = this.sinks.get(s.id);
            if (cur === s) this.sinks.delete(s.id);
            this.bindingCache.clear();
        };
    }

    listSinks() { return Array.from(this.sinks.values()); }
    getSink(id: string) { return this.sinks.get(id); }

    // ── Guard registry (abortable CRUD pre-action hooks) ───────────────

    registerGuard(spec: IOGuardSpec): IODisposer {
        if (!spec.handler) throw "[IO] registerGuard: missing handler";
        const bucket = spec.resource;
        let list = this.guards.get(bucket);
        if (!list) { list = []; this.guards.set(bucket, list); }
        list.push(spec);
        // Keep sorted descending by priority so runGuards can iterate in
        // order without sorting on every dispatch.
        list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        return () => {
            const cur = this.guards.get(bucket);
            if (!cur) return;
            const i = cur.indexOf(spec);
            if (i >= 0) cur.splice(i, 1);
            if (cur.length === 0) this.guards.delete(bucket);
        };
    }

    listGuards(): IOGuardSpec[] {
        const out: IOGuardSpec[] = [];
        for (const list of this.guards.values()) out.push(...list);
        return out;
    }

    /**
     * Run all matching guards for a `pre-*` direction synchronously. First
     * refusal wins; pipeline emits `io:refused` (via `surfaceRefusal`) so
     * observers and the user-facing toast layer behave the same as
     * sink refusals. Owner-disable in `ENV.client.io.disabled` silences a
     * guard's owner.
     *
     * Sync-only: handlers must return an `IOResult` directly. Async checks
     * (server permission, confirm dialog) belong in a separate async-guard
     * registry whose refusal triggers the post-commit rollback path.
     */
    runGuards(ctx: IOContext, payload?: unknown): IOResult {
        const resourceName = ctx.resourceName ?? "";
        const cfg = this.getConfig() ?? {};
        const disabled = cfg.disabled ?? [];

        const direct = this.guards.get(resourceName) ?? [];
        const wild = this.guards.get("*") ?? [];
        const merged: IOGuardSpec[] = mergeByPriority(direct, wild);

        for (const g of merged) {
            if (g.direction !== "*" && g.direction !== ctx.direction) continue;
            if (disabled.includes(g.ownerId)) continue;
            try {
                const r = g.handler(ctx, payload);
                if (r && !r.ok) {
                    this.surfaceRefusal(ctx, r as Extract<IOResult, { ok: false }>);
                    return r;
                }
            } catch (e: any) {
                const r: IOResult = {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_GUARD_THREW",
                };
                this.surfaceRefusal(ctx, r as Extract<IOResult, { ok: false }>);
                return r;
            }
        }
        return { ok: true };
    }

    // ── KV driver registry ─────────────────────────────────────────────

    registerKVDriver(d: IOKVDriver): IODisposer {
        if (this.kvDrivers.has(d.id)) {
            console.warn(`[IO] kv driver "${d.id}" already registered; replacing.`);
        }
        this.kvDrivers.set(d.id, d);
        this.bindingCache.clear();
        return () => {
            const cur = this.kvDrivers.get(d.id);
            if (cur === d) this.kvDrivers.delete(d.id);
            this.bindingCache.clear();
        };
    }

    listKVDrivers() { return Array.from(this.kvDrivers.values()); }
    getKVDriver(id: string) { return this.kvDrivers.get(id); }

    /**
     * Build a KV handle for `(ownerUid, capabilityId)`. The handle wraps
     * one or more drivers (per the resolved binding) and applies key
     * prefixing on shared drivers. Throws if the caller asks for a sync
     * handle (`options.sync !== false`) and any bound driver is async.
     */
    kv(ownerUid: string, capabilityId: string, options: { sync?: boolean } = {}): IOKVHandle {
        // Auto-register the capability so that bindings/inheritance work
        // even when the owner forgot to declare it. Idempotent.
        const owner = this.owners.get(ownerUid);
        if (owner && !owner.capabilities.has(capabilityId)) {
            owner.capabilities.set(capabilityId, { id: capabilityId, kind: "kv" });
            this.invalidateBindingCache(ownerUid);
        }

        const driverIds = this.bindingsFor(ownerUid, capabilityId);
        const drivers = driverIds.map(id => this.kvDrivers.get(id)!).filter(Boolean);
        const wantsSync = options.sync !== false; // default sync

        if (wantsSync) {
            const asyncDrivers = drivers.filter(d => d.mode === "async").map(d => d.id);
            if (asyncDrivers.length > 0) {
                throw new IOError(
                    `[IO] sync KV handle for "${ownerUid}::${capabilityId}" cannot use async driver(s): ${asyncDrivers.join(", ")}. ` +
                    `Bind to a sync driver or use kv:data (or another async namespace) for asynchronous backends.`,
                    "W_IO_KV_SYNC_ASYNC_MISMATCH",
                );
            }
            return new SyncKVHandle({
                pipeline: this, ownerUid, ownerId: owner?.ownerId ?? ownerUid,
                xoType: owner?.xoType ?? "core", capabilityId, drivers,
            });
        }
        return new AsyncKVHandle({
            pipeline: this, ownerUid, ownerId: owner?.ownerId ?? ownerUid,
            xoType: owner?.xoType ?? "core", capabilityId, drivers,
        });
    }

    /**
     * Replace any character outside `[A-Za-z0-9._-]` with `_`. Empty input
     * is rejected (returns `_`). Used internally before key prefixing on
     * shared drivers; exported so authors can pre-test their keys.
     */
    sanitizeKey(s: string): string {
        if (!s) return "_";
        return String(s).replace(/[^A-Za-z0-9._\-]/g, "_");
    }

    // ── owner registry ─────────────────────────────────────────────────

    registerOwner(
        ownerUid: string,
        info: {
            ownerId: string;
            xoType: "core" | "plugin" | "module";
            bundleScope?: "global" | "per-viewer" | "both";
        } & IOOwnerBundleHooks,
    ): IODisposer {
        const existing = this.owners.get(ownerUid);
        const record: OwnerRecord = existing ?? {
            ownerUid,
            ownerId: info.ownerId,
            xoType: info.xoType,
            bundleScope: "global",
            capabilities: new Map(),
            defaultBindings: {},
            disabled: false,
        };
        record.ownerId = info.ownerId;
        record.xoType = info.xoType;
        if (info.bundleScope) record.bundleScope = info.bundleScope;
        if (info.exportBundle) record.exportBundle = info.exportBundle;
        if (info.importBundle) record.importBundle = info.importBundle;
        // Auto-register bundle-* capabilities when the matching hook is
        // supplied (mirrors kv() and defineResource()). Idempotent: an
        // explicit declaration via include.json or options.capabilities
        // upgrades these to a richer descriptor.
        if (record.exportBundle && !record.capabilities.has("bundle-export")) {
            record.capabilities.set("bundle-export", { id: "bundle-export", kind: "bundle" });
        }
        if (record.importBundle && !record.capabilities.has("bundle-import")) {
            record.capabilities.set("bundle-import", { id: "bundle-import", kind: "bundle" });
        }
        this.owners.set(ownerUid, record);
        this.invalidateBindingCache(ownerUid);
        return () => {
            if (this.owners.get(ownerUid) === record) this.owners.delete(ownerUid);
            this.invalidateBindingCache(ownerUid);
        };
    }

    /**
     * Apply an include.json `io` block to an owner. Called by the loader
     * once it knows the owner's uid and has parsed include.json.
     */
    applyIncludeBlock(ownerUid: string, block: IOIncludeBlock | undefined): void {
        const owner = this.owners.get(ownerUid);
        if (!owner) return;
        if (block === false) { owner.disabled = true; return; }
        if (block === undefined || block === true) return;
        const caps = block.capabilities ?? [];
        for (const c of caps) {
            const cap: IOCapability =
                typeof c === "string"
                    ? { id: c, kind: c.startsWith("crud:") ? "crud" : "bundle" }
                    : c;
            owner.capabilities.set(cap.id, cap);
        }
        if (block.defaultBindings) {
            owner.defaultBindings = { ...owner.defaultBindings, ...block.defaultBindings };
        }
        this.invalidateBindingCache(ownerUid);
    }

    // ── binding resolution ─────────────────────────────────────────────

    bindingsFor(ownerUid: string, capabilityId: string): string[] {
        const cacheKey = `${ownerUid}::${capabilityId}`;
        const cached = this.bindingCache.get(cacheKey);
        if (cached) return cached;
        const result = this.resolveBindings(ownerUid, capabilityId);
        this.bindingCache.set(cacheKey, result);
        return result;
    }

    private resolveBindings(ownerUid: string, capabilityId: string): string[] {
        const owner = this.owners.get(ownerUid);
        if (!owner) return [];
        if (owner.disabled) return [];

        const cfg = this.getConfig() ?? {};
        const ownerId = owner.ownerId;
        const cap = owner.capabilities.get(capabilityId);
        const isKv = capabilityId.startsWith("kv:") || cap?.kind === "kv";

        // Rule 1: admin disabled (whole-owner OR per-capability).
        if (cfg.disabled?.includes(ownerId) || cfg.disabled?.includes(ownerUid)) return [];
        const dc = cfg.disabledCapabilities;
        if (dc && dc.length) {
            for (const tuple of dc) {
                if (!tuple) continue;
                const [o, c] = tuple;
                if (c !== capabilityId) continue;
                if (o === ownerId || o === ownerUid) return [];
            }
        }

        // Rule 2: explicit admin binding.
        const explicit = cfg.bindings?.[ownerId]?.[capabilityId]
                      ?? cfg.bindings?.[ownerUid]?.[capabilityId];
        if (explicit !== undefined) return this.filterRegistered(explicit, isKv);

        // Rule 3: include.json default for this owner.
        const fromInclude = owner.defaultBindings[capabilityId];
        if (fromInclude !== undefined) return this.filterRegistered(fromInclude, isKv);

        // Rule 4 (KV only): inherit from `core` if the admin set one.
        if (isKv && ownerId !== "core") {
            const fromCore = cfg.bindings?.["core"]?.[capabilityId];
            if (fromCore !== undefined) return this.filterRegistered(fromCore, isKv);
        }

        // Rule 5: built-in fallback.
        if (cap?.kind === "bundle") {
            return this.sinks.has("post-data") ? ["post-data"] : [];
        }
        if (isKv) {
            const ns = capabilityId.slice(3);
            const fb = KV_NAMESPACE_FALLBACK[ns];
            if (fb && this.kvDrivers.has(fb)) return [fb];
        }
        return [];
    }

    private filterRegistered(ids: string[], isKv = false): string[] {
        return ids.filter(id => {
            if (isKv ? this.kvDrivers.has(id) : this.sinks.has(id)) return true;
            const what = isKv ? "kv driver" : "sink";
            console.warn(`[IO] binding refers to unknown ${what} "${id}"; dropping.`);
            return false;
        });
    }

    isEnabled(ownerUid: string, capabilityId?: string): boolean {
        const owner = this.owners.get(ownerUid);
        if (!owner || owner.disabled) return false;
        if (capabilityId) return this.bindingsFor(ownerUid, capabilityId).length > 0;
        for (const capId of owner.capabilities.keys()) {
            if (this.bindingsFor(ownerUid, capId).length > 0) return true;
        }
        return false;
    }

    sinkOverrides(sinkId: string): Record<string, unknown> {
        return this.getConfig()?.sinkOverrides?.[sinkId] ?? {};
    }

    private invalidateBindingCache(ownerUid: string) {
        for (const k of Array.from(this.bindingCache.keys())) {
            if (k.startsWith(ownerUid + "::")) this.bindingCache.delete(k);
        }
    }

    /** Force a full cache clear; the loader calls this when app config changes. */
    invalidateAll() { this.bindingCache.clear(); }

    /**
     * Loader hook: called once `VIEWER_MANAGER.forceDataImportInitialization`
     * has dispatched per-viewer restore for every currently-registered owner.
     * After this point, `tryRestoreImport({ ownerUid })` (initIO's catch-up)
     * also iterates per viewer for late-registered (lazy) owners.
     */
    markBootRestoreComplete() { this.bootRestorePending = false; }

    // ── orchestration: bundle export ───────────────────────────────────

    async flushBundleExport(scope?: { ownerUid?: string; viewerId?: string }): Promise<IOResult[]> {
        const results: IOResult[] = [];
        const viewers = this.getViewers();
        for (const [uid, owner] of this.owners) {
            if (scope?.ownerUid && uid !== scope.ownerUid) continue;
            if (owner.disabled) continue;
            for (const cap of owner.capabilities.values()) {
                if (cap.kind !== "bundle") continue;
                if (!cap.id.includes("export")) continue;
                const sinks = this.bindingsFor(uid, cap.id);
                if (!sinks.length) continue;

                if (scope?.viewerId) {
                    await this.runOneBundleExport(uid, owner, cap, sinks, scope.viewerId, results);
                    continue;
                }

                if (owner.bundleScope === "global" || owner.bundleScope === "both") {
                    await this.runOneBundleExport(uid, owner, cap, sinks, undefined, results);
                }
                if (owner.bundleScope === "per-viewer" || owner.bundleScope === "both") {
                    for (const v of viewers) {
                        await this.runOneBundleExport(uid, owner, cap, sinks, v.uniqueId, results);
                    }
                }
            }
        }
        return results;
    }

    private async runOneBundleExport(
        uid: string,
        owner: OwnerRecord,
        cap: IOCapability,
        sinks: string[],
        viewerId: string | undefined,
        results: IOResult[],
    ): Promise<void> {
        const ctx: IOContext = {
            direction: "export",
            capabilityId: cap.id,
            xoType: owner.xoType,
            ownerUid: uid,
            ownerId: owner.ownerId,
            key: "",
            viewerId,
            meta: {},
        };
        let payload: unknown = undefined;
        try {
            payload = owner.exportBundle ? await owner.exportBundle(ctx) : undefined;
        } catch (e: any) {
            results.push(this.failure(ctx, e?.message ?? String(e), "W_IO_EXPORT_THREW", e?.userMessage));
            return;
        }
        if (payload === undefined || payload === null) return;

        // Track per-dispatch outcomes so we can emit `io:fully-refused`
        // when no sink handled the call. `attempted` counts only
        // sinks that actually ran (i.e. did not opt out via
        // `accepts: false`); `succeeded` counts ok results.
        const dispatchResults: IOResult[] = [];
        let attempted = 0;
        let succeeded = 0;
        for (const tid of sinks) {
            const t = this.sinks.get(tid)!;
            if (t.accepts && !t.accepts(ctx)) {
                this.emitRejectedByAccepts(ctx, tid);
                continue;
            }
            attempted++;
            try {
                const r = (await t.writeBundle?.(ctx, payload)) ?? this.unsupported(t.id, "writeBundle");
                results.push(r);
                dispatchResults.push(r);
                if (r.ok) succeeded++;
                else if (r.refused) this.surfaceRefusal(ctx, r);
            } catch (e: any) {
                const r = this.failure(ctx, e?.message ?? String(e), "W_IO_SINK_THREW", e?.userMessage);
                results.push(r);
                dispatchResults.push(r);
            }
        }
        if (sinks.length > 0 && succeeded === 0) {
            // Last-resort: if every bound sink for a bundle-export refused,
            // hand the payload to the built-in `file-download` sink so the
            // user always walks away with their data. Skipped if file-
            // download was already among the bindings (no point retrying it)
            // or if it isn't registered. Failures here surface like any
            // other refusal but don't loop back into this fallback.
            const FALLBACK_ID = "file-download";
            const isExport = cap.id.includes("export");
            const fallback = isExport && !sinks.includes(FALLBACK_ID)
                ? this.sinks.get(FALLBACK_ID)
                : undefined;
            if (fallback?.writeBundle) {
                try {
                    const r = await fallback.writeBundle(ctx, payload);
                    results.push(r);
                    dispatchResults.push(r);
                    if (r.ok) {
                        this.notifier(
                            `${ctx.ownerId}: remote sinks refused; downloaded a local copy as fallback.`,
                            "warn",
                        );
                        succeeded++;
                    } else if (r.refused) {
                        this.surfaceRefusal(ctx, r);
                    }
                } catch (e: any) {
                    const r = this.failure(ctx, e?.message ?? String(e), "W_IO_FALLBACK_THREW", e?.userMessage);
                    results.push(r);
                    dispatchResults.push(r);
                }
            }
        }
        if (sinks.length > 0 && succeeded === 0) {
            this.emitFullyRefused(ctx, dispatchResults);
        }
    }

    // ── orchestration: read-and-restore (legacy boot/viewer-open path) ──

    /**
     * For each owner whose bundle-* capabilities are bound to readable
     * sinks (`readBundle`-capable), pull any pre-existing payload
     * and feed it to the owner's `importBundle` hook. Used at boot for
     * global state and on each viewer open for per-viewer state.
     */
    async tryRestoreImport(scope: { ownerUid?: string; viewerId?: string } = {}): Promise<IOResult[]> {
        const results: IOResult[] = [];
        const viewers = this.getViewers();
        for (const [uid, owner] of this.owners) {
            if (scope.ownerUid && uid !== scope.ownerUid) continue;
            if (owner.disabled || !owner.importBundle) continue;
            const sinks = new Set<string>();
            for (const cap of owner.capabilities.values()) {
                if (cap.kind !== "bundle") continue;
                for (const tid of this.bindingsFor(uid, cap.id)) sinks.add(tid);
            }
            if (sinks.size === 0) continue;

            // Explicit viewer scope: caller picked the dispatch granularity
            // (e.g. forceDataImportInitialization on viewer open).
            if (scope.viewerId !== undefined) {
                await this.runOneRestore(uid, owner, sinks, scope.viewerId, results);
                continue;
            }
            // GLOBAL is always safe to restore — there's no other path
            // that handles the "no viewerId" key.
            if (owner.bundleScope === "global" || owner.bundleScope === "both") {
                await this.runOneRestore(uid, owner, sinks, undefined, results);
            }
            // Per-viewer catch-up is gated on the boot pass having
            // already fired. While pending, the loader's
            // `forceDataImportInitialization` will dispatch per viewer for
            // every currently-registered owner — running it here too
            // would double-fire `importBundle`. Once the boot pass is
            // done, any newly-registered (lazy) owner uses this branch
            // to catch up. Viewers opening AFTER this point still need
            // their own viewer-create handler (out of scope here).
            if (!this.bootRestorePending &&
                (owner.bundleScope === "per-viewer" || owner.bundleScope === "both")) {
                for (const v of viewers) {
                    await this.runOneRestore(uid, owner, sinks, v.uniqueId, results);
                }
            }
        }
        return results;
    }

    private async runOneRestore(
        uid: string,
        owner: OwnerRecord,
        sinks: Set<string>,
        viewerId: string | undefined,
        results: IOResult[],
    ): Promise<void> {
        const ctxBase: Omit<IOContext, "meta"> = {
            direction: "import",
            capabilityId: "bundle-import",
            xoType: owner.xoType,
            ownerUid: uid,
            ownerId: owner.ownerId,
            key: "",
            viewerId,
        };
        const dispatchResults: IOResult[] = [];
        let attempted = 0;
        let succeeded = 0;
        for (const tid of sinks) {
            const t = this.sinks.get(tid);
            if (!t?.readBundle) continue;
            const ctx: IOContext = { ...ctxBase, meta: { sinkId: tid } };
            if (t.accepts && !t.accepts(ctx)) {
                this.emitRejectedByAccepts(ctx, tid);
                continue;
            }
            attempted++;
            try {
                const r = await t.readBundle(ctx);
                if (!r.ok) {
                    results.push(r);
                    dispatchResults.push(r);
                    if (r.refused) this.surfaceRefusal(ctx, r);
                    continue;
                }
                const payload = (r as any).payload;
                if (payload === undefined || payload === null) {
                    // Non-error empty read still counts as a successful
                    // attempt — admin's binding worked, there just was
                    // nothing stored yet.
                    succeeded++;
                    continue;
                }
                await owner.importBundle!(ctx, payload);
                results.push({ ok: true });
                dispatchResults.push({ ok: true });
                succeeded++;
            } catch (e: any) {
                const r = this.failure(ctx, e?.message ?? String(e), "W_IO_RESTORE_THREW", e?.userMessage);
                results.push(r);
                dispatchResults.push(r);
            }
        }
        if (attempted > 0 && succeeded === 0) {
            this.emitFullyRefused({ ...ctxBase, meta: {} } as IOContext, dispatchResults);
        }
    }

    // ── orchestration: bundle import (caller-supplied data) ─────────────

    async importBundle(rawData: unknown, scope?: { ownerUid?: string }): Promise<IOResult[]> {
        const results: IOResult[] = [];
        for (const [uid, owner] of this.owners) {
            if (scope?.ownerUid && uid !== scope.ownerUid) continue;
            if (owner.disabled) continue;
            const importCap = Array.from(owner.capabilities.values())
                .find(c => c.kind === "bundle" && c.id.includes("import"));
            if (!importCap) continue;
            const ctx: IOContext = {
                direction: "import",
                capabilityId: importCap.id,
                xoType: owner.xoType,
                ownerUid: uid,
                ownerId: owner.ownerId,
                key: "",
                meta: {},
            };
            try {
                if (owner.importBundle) {
                    await owner.importBundle(ctx, rawData);
                    results.push({ ok: true });
                }
            } catch (e: any) {
                const r = this.failure(ctx, e?.message ?? String(e), "W_IO_IMPORT_THREW", e?.userMessage);
                results.push(r);
            }
        }
        return results;
    }

    // ── orchestration: per-element CRUD ────────────────────────────────

    async dispatch(ctx: IOContext, payload?: unknown): Promise<IOResult> {
        const sinkIds = this.bindingsFor(ctx.ownerUid, ctx.capabilityId);
        if (!sinkIds.length) return { ok: true }; // inert by design
        const dispatchResults: IOResult[] = [];
        let attempted = 0;
        let succeeded = 0;
        let last: IOResult = { ok: true };
        for (const tid of sinkIds) {
            const t = this.sinks.get(tid);
            if (!t) continue;
            if (t.accepts && !t.accepts(ctx)) {
                this.emitRejectedByAccepts(ctx, tid);
                continue;
            }
            attempted++;
            const method = pickMethod(t, ctx.direction);
            if (!method) {
                last = this.unsupported(t.id, ctx.direction);
                dispatchResults.push(last);
                continue;
            }
            try {
                const r = await Promise.resolve(method.call(t, ctx, payload));
                last = r ?? { ok: true };
                dispatchResults.push(last);
                if (last.ok) {
                    succeeded++;
                } else if (last.refused) {
                    this.surfaceRefusal(ctx, last);
                    // CRUD short-circuits: the first refusal aborts the
                    // dispatch. Emit `io:fully-refused` only if no earlier
                    // sink had succeeded (consistent with bundle path).
                    if (succeeded === 0) this.emitFullyRefused(ctx, dispatchResults);
                    return last;
                }
            } catch (e: any) {
                last = this.failure(ctx, e?.message ?? String(e), "W_IO_SINK_THREW", e?.userMessage);
                dispatchResults.push(last);
            }
        }
        if (attempted > 0 && succeeded === 0) {
            this.emitFullyRefused(ctx, dispatchResults);
        }
        return last;
    }

    // ── orchestration: streamed query (on-the-fly hydration) ───────────

    /**
     * Stream raw items from the first bound sink whose `query` method
     * is defined and whose `accepts(ctx)` (if defined) returns true. The
     * pipeline does NOT apply per-item deserialization — the
     * `IOResource.query` wrapper does that. We surface accept-rejections
     * and full-refusal so misconfigured admin bindings stay loud.
     */
    queryStream(ctx: IOContext, params: unknown): AsyncIterable<unknown> {
        const sinkIds = this.bindingsFor(ctx.ownerUid, ctx.capabilityId);
        const self = this;

        if (!sinkIds.length) {
            // No binding → empty stream. Not a misconfiguration; same
            // inert semantics as CRUD when nothing is bound.
            return (async function* () {})();
        }

        // Pick the first sink that can serve this query, recording
        // accept-rejections / unsupported-method skips so visibility
        // events still fire.
        let chosen: IOSink | undefined;
        const skipped: IOResult[] = [];
        for (const tid of sinkIds) {
            const t = this.sinks.get(tid);
            if (!t) continue;
            if (typeof t.query !== "function") continue;
            if (t.accepts && !t.accepts(ctx)) {
                this.emitRejectedByAccepts(ctx, tid);
                skipped.push({
                    ok: false, refused: true,
                    reason: `sink "${tid}" declined via accepts`,
                    code: "W_IO_REJECTED_BY_ACCEPTS",
                });
                continue;
            }
            chosen = t;
            break;
        }

        if (!chosen) {
            // Every bound sink declined or lacked `query`. Surface
            // it the same way bundle-export does on full refusal.
            this.emitFullyRefused(ctx, skipped);
            return (async function* () {})();
        }

        // Wrap the sink's iterable so consumer-side errors don't
        // crash the pipeline and so abort signals propagate naturally
        // through `for await` early-exit (return()/throw() on the
        // underlying generator).
        return (async function* () {
            try {
                for await (const item of chosen!.query!(ctx, params)) {
                    yield item;
                }
            } catch (e: any) {
                if ((e as any)?.name === "AbortError") return;
                self.surfaceRefusal(ctx, {
                    ok: false, refused: true,
                    reason: e?.message ?? String(e),
                    code: "W_IO_QUERY_THREW",
                });
                throw e;
            }
        })();
    }

    // ── refusal/conflict events ────────────────────────────────────────

    addHandler(eventName: string, handler: Handler) { this.bus.addHandler(eventName, handler); }
    removeHandler(eventName: string, handler: Handler) { this.bus.removeHandler(eventName, handler); }

    /**
     * Public for `IOResource` to surface post-commit refusals from the
     * queued dispatch path. Plugins should NOT call this directly — return
     * a refusal IOResult from a sink/guard instead.
     */
    surfaceRefusal_(ctx: IOContext, r: Extract<IOResult, { ok: false }>) {
        this.surfaceRefusal(ctx, r);
    }

    /**
     * Public for `IOResource` to emit per-queue lifecycle events
     * (`io:queue-stalled`, `io:queue-resumed`, `io:queue-empty`).
     */
    emitQueueEvent_(name: string, payload: Record<string, unknown>) {
        this.bus.raiseEvent(name, payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent(name, payload);
        } catch { /* viewer manager may not yet exist */ }
    }

    private surfaceRefusal(ctx: IOContext, r: Extract<IOResult, { ok: false }>) {
        this.bus.raiseEvent("io:refused", { ctx, result: r });
        const msg = r.userMessage ?? r.reason;
        if (msg) {
            // A `userMessage` is the sink author's signal that this refusal
            // is meant to be shown to the user (e.g. "GitHub rejected the
            // access token"). Treat that as an error; bare refusals without
            // a user message stay at warn so soft-route logs don't escalate.
            const level: "warn" | "error" = r.userMessage ? "error" : "warn";
            this.notifier(msg, level);
        }
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:refused", { ctx, result: r });
        } catch { /* viewer manager may not yet exist */ }
    }

    /** A bound sink opted out of this context via `accepts(ctx) → false`.
     *  Distinct from `io:refused` so observers can tell a soft route-skip
     *  apart from a tried-and-failed write. Emitted once per (ctx, sink). */
    private emitRejectedByAccepts(ctx: IOContext, sinkId: string) {
        console.info(`[IO] sink "${sinkId}" declined ${ctx.direction} for ${ctx.ownerUid}::${ctx.capabilityId} (accepts: false)`);
        const payload = { ctx, sinkId };
        this.bus.raiseEvent("io:rejected-by-accepts", payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:rejected-by-accepts", payload);
        } catch { /* viewer manager may not yet exist */ }
    }

    /** Every bound sink for one dispatch failed (refused, threw, or
     *  declined via accepts). Signal of a misconfigured binding that
     *  silently dropped data. Emitted at most once per dispatch. */
    private emitFullyRefused(ctx: IOContext, results: IOResult[]) {
        console.warn(`[IO] no sink accepted ${ctx.direction} for ${ctx.ownerUid}::${ctx.capabilityId} — data not written. Check ENV.client.io.bindings.`);
        const payload = { ctx, results };
        this.bus.raiseEvent("io:fully-refused", payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:fully-refused", payload);
        } catch { /* viewer manager may not yet exist */ }
    }

    private failure(ctx: IOContext, reason: string, code: string, userMessage?: string): IOResult {
        // `userMessage`, when supplied (typically by an owner that wraps its
        // exception with a `userMessage` property), escalates the resulting
        // toast in `surfaceRefusal` to error-level so user-facing failures
        // are clearly distinguished from internal warnings.
        const r: IOResult = userMessage
            ? { ok: false as const, refused: true as const, reason, code, userMessage }
            : { ok: false as const, refused: true as const, reason, code };
        this.surfaceRefusal(ctx, r);
        return r;
    }

    private unsupported(sinkId: string, op: string): IOResult {
        return {
            ok: false,
            refused: true,
            reason: `sink "${sinkId}" does not implement "${op}"`,
            code: "W_IO_UNSUPPORTED",
        };
    }
}

/**
 * Two-way merge of pre-sorted (descending priority) guard lists. Keeps
 * the descending order so callers can iterate without re-sorting. Stable
 * relative to the input list order on equal priorities.
 */
function mergeByPriority(a: IOGuardSpec[], b: IOGuardSpec[]): IOGuardSpec[] {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    const out: IOGuardSpec[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        const ai = a[i]!;
        const bj = b[j]!;
        const pa = ai.priority ?? 0;
        const pb = bj.priority ?? 0;
        if (pa >= pb) { out.push(ai); i++; }
        else { out.push(bj); j++; }
    }
    while (i < a.length) out.push(a[i++]!);
    while (j < b.length) out.push(b[j++]!);
    return out;
}

function pickMethod(t: IOSink, direction: IODirection):
    ((ctx: IOContext, payload: unknown) => any) | undefined {
    switch (direction) {
        case "create": return t.create as any;
        case "read":   return t.read   as any;
        case "update": return t.update as any;
        case "delete": return t.delete as any;
        case "export": return t.writeBundle as any;
        case "import": return t.readBundle as any;
        default: return undefined;
    }
}
