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

/**
 * Sinks that do NOT produce a user-recoverable artefact for the Save action:
 *  - `file-download` — local file; that's what Export is for, not Save.
 *  - `post-data` / `session-memory` — in-memory fallbacks bound automatically
 *    by `resolveBindings` Rule 5 so the legacy HTML-form export keeps working;
 *    nothing in the Save flow surfaces them to the user.
 *  - `file-upload` — import-only; can't `writeBundle`, listed for correctness.
 *
 * Used by `hasRemoteBundleSinks()` so a deployment with only these bound
 * for bundle-export degrades to Export instead of pretending to persist.
 */
const NON_REMOTE_BUNDLE_SINKS = new Set([
    "file-download",
    "post-data",
    "session-memory",
    "file-upload",
]);

// ── declarative sink support ───────────────────────────────────────────
//
// `IOSink.supports` used to be a bare list of capability kinds that nothing
// ever read. It is now the sink's contract: which kinds, which owners, which
// capabilities, which resources. The pipeline checks it at binding-resolution
// time (`validateBindings`, loud, before any data is at risk) AND at dispatch
// time (as a decline with a reason). A sink that can only store one owner's
// data says so here instead of hiding the rule inside `accepts`.

const patternCache: Map<string, RegExp> = new Map();

/** Anchored glob (`*` = any run of characters). */
function globToRegExp(pattern: string): RegExp {
    let re = patternCache.get(pattern);
    if (!re) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
        re = new RegExp(`^${escaped}$`);
        patternCache.set(pattern, re);
    }
    return re;
}

/** Empty/absent pattern list means "unrestricted". */
export function matchesPattern(value: string, patterns?: string[] | null): boolean {
    if (!patterns || !patterns.length) return true;
    return patterns.some(p => typeof p === "string" && globToRegExp(p).test(value));
}

const supportCache: WeakMap<IOSink, IOSinkSupport> = new WeakMap();

/** Normalize the legacy `IOCapabilityKind[]` short form to `IOSinkSupport`. */
export function sinkSupportOf(sink: IOSink): IOSinkSupport {
    const cached = supportCache.get(sink);
    if (cached) return cached;
    const raw = sink.supports as unknown;
    const normalized: IOSinkSupport = Array.isArray(raw)
        ? { kinds: raw.slice() as IOCapabilityKind[] }
        : { kinds: [], ...(raw as IOSinkSupport ?? {}) };
    if (!Array.isArray(normalized.kinds)) normalized.kinds = [];
    supportCache.set(sink, normalized);
    return normalized;
}

/** The (owner, capability) coordinates a support declaration is checked against. */
interface SupportProbe {
    kind: IOCapabilityKind;
    capabilityId: string;
    ownerId: string;
    ownerUid: string;
    resourceName?: string;
}

/**
 * Human-readable reason the sink cannot serve this probe, or `undefined`
 * when it can. Deliberately phrased for an admin reading a boot warning or
 * a user reading a toast.
 */
function supportMismatch(sink: IOSink, probe: SupportProbe): string | undefined {
    const s = sinkSupportOf(sink);
    if (s.kinds.length && !s.kinds.includes(probe.kind)) {
        return `sink "${sink.id}" serves ${s.kinds.join("/") || "no"} capabilities, not "${probe.kind}"`;
    }
    if (s.owners && !(matchesPattern(probe.ownerId, s.owners) || matchesPattern(probe.ownerUid, s.owners))) {
        return `sink "${sink.id}" only serves owners [${s.owners.join(", ")}], not "${probe.ownerId}"`;
    }
    if (s.capabilities && !matchesPattern(probe.capabilityId, s.capabilities)) {
        return `sink "${sink.id}" only serves capabilities [${s.capabilities.join(", ")}], not "${probe.capabilityId}"`;
    }
    if (s.resources && probe.resourceName !== undefined
        && !matchesPattern(probe.resourceName, s.resources)) {
        return `sink "${sink.id}" only serves resources [${s.resources.join(", ")}], not "${probe.resourceName}"`;
    }
    return undefined;
}

function probeFromContext(ctx: IOContext): SupportProbe {
    return {
        kind: capabilityKindOf(ctx.capabilityId),
        capabilityId: ctx.capabilityId,
        ownerId: ctx.ownerId,
        ownerUid: ctx.ownerUid,
        resourceName: ctx.resourceName,
    };
}

/** Kind inferred from the capability id grammar (`crud:x`, `kv:x`, else bundle). */
function capabilityKindOf(capabilityId: string): IOCapabilityKind {
    if (capabilityId.startsWith("crud:")) return "crud";
    if (capabilityId.startsWith("kv:")) return "kv";
    return "bundle";
}

// ── context templating ─────────────────────────────────────────────────

const FORMAT_MAX_SEGMENT = 128;
const FORMAT_MAX_RAW = 256;
const formatWarned: Set<string> = new Set();

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Reduce one substituted value to a single safe segment. The charset rule
 * (`[A-Za-z0-9._-]`) is what makes the guarantee cheap to state: the value
 * cannot introduce a path segment, escape upward, or inject a URL
 * query/fragment, because every character that could do so is replaced.
 */
function sanitizeSegment(value: string, empty: string): string {
    let v = String(value).replace(CONTROL_CHARS, "").replace(/[^A-Za-z0-9._-]/g, "_");
    if (v.length > FORMAT_MAX_SEGMENT) v = v.slice(0, FORMAT_MAX_SEGMENT);
    if (v === "" || v === "." || v === "..") return empty;
    return v;
}

/**
 * Direction-normalized capability token. `bundle-export` and `bundle-import`
 * both collapse to `bundle`, which is what a template needs to address the
 * same slot on the way out and the way back.
 */
export function capabilityGroupOf(capabilityId: string): string {
    if (!capabilityId) return "";
    if (capabilityId.startsWith("crud:")) return "crud";
    if (capabilityId.startsWith("kv:")) return "kv";
    return capabilityId.replace(/-(export|import)$/, "");
}

/** See `IOPipelineLike.formatPath`. Pure; exported for tests. */
export function formatContextTemplate(
    template: string,
    ctx: IOContext,
    options?: IOFormatOptions,
): string {
    const mode = options?.mode ?? "path";
    const empty = options?.empty ?? "_";
    const values: Record<string, string | undefined> = {
        ownerId: ctx.ownerId,
        ownerUid: ctx.ownerUid,
        xoType: ctx.xoType,
        direction: ctx.direction,
        capabilityId: ctx.capabilityId,
        capabilityGroup: capabilityGroupOf(ctx.capabilityId),
        viewerId: ctx.viewerId ?? "_global",
        backgroundId: ctx.backgroundId ?? "_any",
        key: ctx.key || "_default",
        resourceName: ctx.resourceName,
        itemId: ctx.itemId,
        ...(options?.extra ?? {}),
    };
    return String(template).replace(/\{(\w+)\}/g, (_match, token: string) => {
        if (!Object.prototype.hasOwnProperty.call(values, token)) {
            const warnKey = `${template}::${token}`;
            if (!formatWarned.has(warnKey)) {
                formatWarned.add(warnKey);
                console.warn(`[IO] unknown placeholder "{${token}}" in template "${template}"; substituting "${empty}".`);
            }
            return empty;
        }
        const raw = String(values[token] ?? "");
        if (mode === "raw") {
            const stripped = raw.replace(CONTROL_CHARS, "");
            return stripped.length > FORMAT_MAX_RAW ? stripped.slice(0, FORMAT_MAX_RAW) : stripped;
        }
        return sanitizeSegment(raw, empty);
    });
}

// ── binding targets ────────────────────────────────────────────────────

/** Shared frozen `{}` so `bindingConfig` never allocates on the hot path. */
const EMPTY_BINDING_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({});

function bareBinding(sink: string): IOResolvedBinding {
    return { sink, config: EMPTY_BINDING_CONFIG };
}

/** `"github"` and `{sink:"github", config:{…}}` both normalize to the latter. */
function normalizeBindingTarget(raw: IOBindingTarget): IOResolvedBinding | undefined {
    if (typeof raw === "string") return raw ? bareBinding(raw) : undefined;
    if (!raw || typeof raw !== "object" || typeof raw.sink !== "string" || !raw.sink) return undefined;
    return {
        sink: raw.sink,
        // Frozen: the config is shared across every dispatch for this binding,
        // and a sink mutating it would silently reconfigure the deployment.
        config: raw.config ? Object.freeze({ ...raw.config }) : EMPTY_BINDING_CONFIG,
        ...(raw.label ? { label: raw.label } : {}),
    };
}

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

type BundleScope = "global" | "per-viewer" | "per-viewer-background" | "both" | "all";

function isViewerScoped(s: BundleScope): boolean {
    return s === "per-viewer" || s === "both" || s === "all";
}
function isViewerBackgroundScoped(s: BundleScope): boolean {
    return s === "per-viewer-background" || s === "all";
}
function isGlobalScoped(s: BundleScope): boolean {
    return s === "global" || s === "both" || s === "all";
}

interface OwnerRecord {
    ownerUid: string;
    ownerId: string;
    xoType: "core" | "plugin" | "module";
    exportBundle?: (ctx: IOContext) => Promise<unknown> | unknown;
    importBundle?: (ctx: IOContext, data: unknown) => Promise<void> | void;
    /** `global`                 — exportBundle called once per owner.
     *  `per-viewer`              — once per viewer (ctx.viewerId set).
     *  `per-viewer-background`   — once per (viewer, current background)
     *                              pair (ctx.viewerId + ctx.backgroundId set).
     *                              Slide-change in any viewer fires an
     *                              automatic flush for the previous
     *                              (viewer, background) and a restore for
     *                              the next one via `viewer-open-pipeline`.
     *  `both`                    — global + per-viewer (legacy).
     *  `all`                     — global + per-viewer + per-viewer-background. */
    bundleScope: BundleScope;
    capabilities: Map<string, IOCapability>;
    defaultBindings: Record<string, IOBindingTarget[]>;
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
    /** `<ownerUid>::<capabilityId>` pairs already reported as bound to no driver. */
    private readonly emptyBindingWarned: Set<string> = new Set();
    /** Tracked CRUD resources — populated via `registerResource(...)` from
     *  `defineResource()`. Drained collectively by `flushAllResources()`. */
    private readonly resources: Set<IOResource<any>> = new Set();
    /** Guards keyed by resource name; `"*"` is the wildcard bucket. */
    private readonly guards: Map<string, IOGuardSpec[]> = new Map();
    /** Resolved per-owner bindings cache (invalidated on registerOwner / config change). */
    private readonly bindingCache: Map<string, IOResolvedBinding[]> = new Map();

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
    /**
     * `${uid}|${viewerId}::${backgroundId}` bundles already hydrated this
     * session. Guards the boot double-restore: the viewer-open content pass
     * and the loader's `forceDataImportInitialization` both funnel into
     * `runOneRestore` with the same key, and the second `importBundle`
     * would wipe anything the user changed in between. Cleared on the
     * slide-leave flush and on viewer removal (`clearHydratedFor`) so
     * genuine re-opens re-hydrate.
     */
    private hydratedKeys = new Set<string>();

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
        this.scheduleBindingValidation();
        return () => {
            const cur = this.sinks.get(s.id);
            if (cur === s) this.sinks.delete(s.id);
            this.bindingCache.clear();
        };
    }

    listSinks() { return Array.from(this.sinks.values()); }
    getSink(id: string) { return this.sinks.get(id); }

    // ── resource registry ──────────────────────────────────────────────

    registerResource(resource: IOResource<any>): IODisposer {
        this.resources.add(resource);
        return () => { this.resources.delete(resource); };
    }

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
        this.scheduleBindingValidation();
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
        // Every caller gets a working namespace, registered or not — see
        // ensureOwner(). Without it `resolveBindings` bails on an unknown owner
        // and the handle below silently discards every write.
        const owner = this.ensureOwner(ownerUid);
        // Auto-register the capability so that bindings/inheritance work
        // even when the owner forgot to declare it. Idempotent.
        if (!owner.capabilities.has(capabilityId)) {
            owner.capabilities.set(capabilityId, { id: capabilityId, kind: "kv" });
            this.invalidateBindingCache(ownerUid);
        }

        const driverIds = this.bindingsFor(ownerUid, capabilityId);
        const drivers = driverIds.map(id => this.kvDrivers.get(id)!).filter(Boolean);
        // An owner exists and still resolved to nothing: an admin bound this
        // namespace to no (or an unknown) driver. The handle would read null and
        // drop every write — say so once instead of losing data quietly.
        if (drivers.length === 0) {
            const key = `${ownerUid}::${capabilityId}`;
            if (!this.emptyBindingWarned.has(key)) {
                this.emptyBindingWarned.add(key);
                console.warn(`[IO] '${key}' resolved to no storage driver — reads return null and ` +
                    `writes are discarded. Check ENV.client.io.bindings for this owner/capability.`);
            }
        }
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

    // ── templating ─────────────────────────────────────────────────────

    /** See `IOPipelineLike.formatPath`. */
    formatPath(template: string, ctx: IOContext, options?: IOFormatOptions): string {
        return formatContextTemplate(template, ctx, options);
    }

    /** See `IOPipelineLike.matchesPattern`. */
    matchesPattern(value: string, patterns?: string[] | null): boolean {
        return matchesPattern(value, patterns);
    }

    // ── owner registry ─────────────────────────────────────────────────

    /**
     * The owner record for `ownerUid`, registering it on first use if needed.
     *
     * Owners are normally registered by the `XOpatElement` constructor, so
     * anything that is NOT an element — a core service, a plain-script module
     * with no `XOpatModule` subclass — used to fall off a cliff: `resolveBindings`
     * returns `[]` for an unknown owner, and the resulting handle discards every
     * write and reads back `null`, with no throw and no warning. Storage is not
     * something a caller should have to register for; it should just work.
     *
     * The uid shape mirrors what `XOpatElement` builds (`<module|plugin>.<id>`),
     * so an implicitly-registered owner is indistinguishable from a declared one:
     * `ENV.client.io.bindings["<uid>"]` applies to it, and if the real element is
     * constructed later `registerOwner` upserts rather than replacing, keeping the
     * capabilities registered in the meantime.
     */
    private ensureOwner(ownerUid: string): OwnerRecord {
        const existing = this.owners.get(ownerUid);
        if (existing) return existing;

        const dot = ownerUid.indexOf(".");
        const prefix = dot > 0 ? ownerUid.slice(0, dot) : "";
        const xoType: "core" | "plugin" | "module" =
            prefix === "plugin" || prefix === "module" ? prefix : "core";
        const ownerId = dot > 0 ? ownerUid.slice(dot + 1) : ownerUid;
        console.debug(`[IO] implicitly registering owner '${ownerUid}' on first storage use.`);
        this.registerOwner(ownerUid, { ownerId, xoType });
        return this.owners.get(ownerUid)!;
    }

    registerOwner(
        ownerUid: string,
        info: {
            ownerId: string;
            xoType: "core" | "plugin" | "module";
            bundleScope?: BundleScope;
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
        this.scheduleBindingValidation();
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

    /** Sink ids only — the shape every existing caller expects. */
    bindingsFor(ownerUid: string, capabilityId: string): string[] {
        return this.bindingTargetsFor(ownerUid, capabilityId).map(t => t.sink);
    }

    /** Normalized bindings, including each entry's per-binding config. */
    bindingTargetsFor(ownerUid: string, capabilityId: string): IOResolvedBinding[] {
        const cacheKey = `${ownerUid}::${capabilityId}`;
        const cached = this.bindingCache.get(cacheKey);
        if (cached) return cached;
        const result = this.resolveBindings(ownerUid, capabilityId);
        this.bindingCache.set(cacheKey, result);
        return result;
    }

    /**
     * Per-binding config for one (owner, capability, sink) triple, or `{}`.
     *
     * Sinks pull this themselves from `getOptions(ctx)` rather than having it
     * threaded through every dispatch site. That keeps `runOneBundleExport`,
     * `dispatch`, `queryStream` and the restore path untouched, and works for
     * runtime `.mjs` sinks that never see the bundled core.
     */
    bindingConfig(ownerUid: string, capabilityId: string, sinkId: string): Readonly<Record<string, unknown>> {
        const hit = this.bindingTargetsFor(ownerUid, capabilityId).find(t => t.sink === sinkId);
        return hit?.config ?? EMPTY_BINDING_CONFIG;
    }

    private resolveBindings(ownerUid: string, capabilityId: string): IOResolvedBinding[] {
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
        if (explicit !== undefined) return this.filterRegistered(explicit, isKv, ownerUid, capabilityId);

        // Rule 3: include.json default for this owner.
        const fromInclude = owner.defaultBindings[capabilityId];
        if (fromInclude !== undefined) return this.filterRegistered(fromInclude, isKv, ownerUid, capabilityId);

        // Rule 4 (KV only): inherit from `core` if the admin set one.
        if (isKv && ownerId !== "core") {
            const fromCore = cfg.bindings?.["core"]?.[capabilityId];
            if (fromCore !== undefined) return this.filterRegistered(fromCore, isKv, ownerUid, capabilityId);
        }

        // Rule 5: built-in fallback.
        if (cap?.kind === "bundle") {
            // Slide-aware owners key bundles by ctx.key ("<viewerId>::<backgroundId>").
            // `session-memory` carries them across in-session slide switches;
            // `post-data` ALSO keys by (viewer, background) (see post-data.ts
            // keyFor), so it carries the bundle into the legacy HTML-form session
            // export — without it, slide-aware owners (e.g. annotations) are
            // silently dropped from file export (see IO_PIPELINE.md). `session-memory`
            // is listed FIRST so that on a fresh load its empty read (which clears
            // local state) runs before `post-data` restores the saved payload;
            // reversed, the empty read would wipe the just-restored data.
            if (isViewerBackgroundScoped(owner.bundleScope)) {
                const list: IOResolvedBinding[] = [];
                if (this.sinks.has("session-memory")) list.push(bareBinding("session-memory"));
                if (this.sinks.has("post-data")) list.push(bareBinding("post-data"));
                if (!list.length) {
                    console.warn(
                        `[IO] owner "${ownerId}" uses bundleScope "${owner.bundleScope}" but neither ` +
                        `"session-memory" nor "post-data" sink is registered; bundle export/import will be inert.`,
                    );
                }
                return list;
            }
            return this.sinks.has("post-data") ? [bareBinding("post-data")] : [];
        }
        if (isKv) {
            const ns = capabilityId.slice(3);
            const fb = KV_NAMESPACE_FALLBACK[ns];
            if (fb && this.kvDrivers.has(fb)) return [bareBinding(fb)];
        }
        return [];
    }

    /**
     * Normalize a configured binding list: string → `{sink, config:{}}`,
     * freeze each config, drop entries naming an unregistered sink/driver,
     * and collapse duplicate sink ids (which would make `bindingConfig`
     * ambiguous about which config applies).
     */
    private filterRegistered(
        targets: IOBindingTarget[],
        isKv = false,
        ownerUid?: string,
        capabilityId?: string,
    ): IOResolvedBinding[] {
        const ids: string[] = [];
        const kept: IOResolvedBinding[] = [];
        const seen = new Map<string, number>();
        for (const raw of targets ?? []) {
            const entry = normalizeBindingTarget(raw);
            if (!entry) {
                console.warn(`[IO] ignoring malformed binding entry:`, raw);
                continue;
            }
            ids.push(entry.sink);
            if (!(isKv ? this.kvDrivers.has(entry.sink) : this.sinks.has(entry.sink))) {
                const what = isKv ? "kv driver" : "sink";
                console.warn(`[IO] binding refers to unknown ${what} "${entry.sink}"; dropping.`);
                continue;
            }
            const at = seen.get(entry.sink);
            if (at !== undefined) {
                console.warn(
                    `[IO] "${entry.sink}" is bound twice for ${ownerUid ?? "?"}::${capabilityId ?? "?"}; ` +
                    `keeping the last entry's config.`,
                );
                kept[at] = entry;
                continue;
            }
            seen.set(entry.sink, kept.length);
            kept.push(entry);
        }
        if (ids.length && !kept.length) {
            // An explicitly-configured destination that resolves to nothing is
            // the worst failure mode in this file: for KV it yields a handle
            // over zero drivers, i.e. a store that accepts every write and
            // returns null forever, with no refusal anywhere. Never silent.
            const what = isKv ? "kv driver" : "sink";
            const where = ownerUid && capabilityId ? `${ownerUid}::${capabilityId}` : "an owner";
            console.error(
                `[IO] binding for ${where} names only unregistered ${what}s [${ids.join(", ")}] — ` +
                `${isKv ? "storage will silently discard writes" : "nothing will be persisted"}. ` +
                `Check ENV.client.io.bindings.`,
            );
            this.notifier($.t("error.ioNoDestination", { what: where }), "error");
            if (ownerUid && capabilityId) {
                this.emitInvalidBinding(ownerUid, capabilityId, ids.join(", "),
                    `no registered ${what} among [${ids.join(", ")}]`);
            }
        }
        return kept;
    }

    // ── pre-flight binding validation ──────────────────────────────────

    /**
     * Report every admin binding whose sink has declared it cannot serve it
     * (`IOSinkSupport`). Runs at *config-resolution* time, not dispatch time,
     * so a deployment that routes e.g. `recorder` to an annotations-only sink
     * finds out at boot instead of when the user first hits Save.
     *
     * Debounced through a microtask because sinks, owners and capabilities
     * register in an arbitrary order during startup; validating on every
     * single registration would report mismatches that resolve a tick later.
     */
    private validationScheduled = false;
    private readonly reportedBindingIssues: Set<string> = new Set();

    private scheduleBindingValidation() {
        if (this.validationScheduled) return;
        this.validationScheduled = true;
        Promise.resolve().then(() => {
            this.validationScheduled = false;
            try { this.validateBindings(); }
            catch (e) { console.error("[IO] binding validation threw:", e); }
        });
    }

    /** Public so admin/debug UIs can re-run it on demand. Idempotent. */
    validateBindings(): void {
        for (const [uid, owner] of this.owners) {
            if (owner.disabled) continue;
            for (const cap of owner.capabilities.values()) {
                if (cap.kind === "kv") continue; // kv resolves against drivers, not sinks
                for (const sinkId of this.bindingsFor(uid, cap.id)) {
                    const sink = this.sinks.get(sinkId);
                    if (!sink) continue;
                    const reason = supportMismatch(sink, {
                        kind: cap.kind,
                        capabilityId: cap.id,
                        ownerId: owner.ownerId,
                        ownerUid: uid,
                        resourceName: cap.kind === "crud" ? cap.id.slice(cap.id.indexOf(":") + 1) : undefined,
                    });
                    if (reason) this.emitInvalidBinding(uid, cap.id, sinkId, reason);
                }
            }
        }
    }

    /** Reported at most once per (owner, capability, sink). */
    private emitInvalidBinding(ownerUid: string, capabilityId: string, sinkId: string, reason: string) {
        const key = `${ownerUid}::${capabilityId}::${sinkId}`;
        if (this.reportedBindingIssues.has(key)) return;
        this.reportedBindingIssues.add(key);
        // Operator-facing, and only an operator can fix it: console + event,
        // not a toast. It fires during boot, before i18next has necessarily
        // initialized, and the end user has no action to take.
        console.error(`[IO] invalid binding ${ownerUid} → ${capabilityId} → "${sinkId}": ${reason}`);
        const payload = { ownerUid, capabilityId, sinkId, reason };
        this.bus.raiseEvent("io:invalid-binding", payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:invalid-binding", payload);
        } catch { /* viewer manager may not yet exist */ }
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
    invalidateAll() {
        this.bindingCache.clear();
        // A config change can fix — or introduce — a mismatch, so let every
        // issue be reported once more against the new bindings.
        this.reportedBindingIssues.clear();
        this.scheduleBindingValidation();
    }

    /**
     * Loader hook: called once `VIEWER_MANAGER.forceDataImportInitialization`
     * has dispatched per-viewer restore for every currently-registered owner.
     * After this point, `tryRestoreImport({ ownerUid })` (initIO's catch-up)
     * also iterates per viewer for late-registered (lazy) owners.
     */
    markBootRestoreComplete() { this.bootRestorePending = false; }

    /**
     * Drop hydration guards for a removed viewer. Viewer uniqueIds are
     * data-derived (deterministic), so a future viewer opening the same
     * slide resolves to the SAME id — without this, its restore would be
     * skipped as "already hydrated". Called by the viewer manager on
     * viewer removal.
     */
    clearHydratedFor(viewerId: string) {
        // Keys are `${uid}|${viewerId}::${bgId}` (or `${uid}|${viewerId}`);
        // element uids contain no `|`, so the first `|` is the separator.
        for (const k of Array.from(this.hydratedKeys)) {
            const bundleKey = k.substring(k.indexOf("|") + 1);
            if (bundleKey === viewerId || bundleKey.startsWith(`${viewerId}::`)) {
                this.hydratedKeys.delete(k);
            }
        }
    }

    // ── orchestration: bundle export ───────────────────────────────────

    async flushBundleExport(scope?: { ownerUid?: string; viewerId?: string; backgroundId?: string; skipFileFallback?: boolean }): Promise<IOResult[]> {
        const results: IOResult[] = [];
        const viewers = this.getViewers();
        const skipFileFallback = !!scope?.skipFileFallback;
        for (const [uid, owner] of this.owners) {
            if (scope?.ownerUid && uid !== scope.ownerUid) continue;
            if (owner.disabled) continue;
            for (const cap of owner.capabilities.values()) {
                if (cap.kind !== "bundle") continue;
                if (!cap.id.includes("export")) continue;
                const sinks = this.bindingsFor(uid, cap.id);
                if (!sinks.length) continue;

                // Explicit (viewer, background) — used by `viewer-open-pipeline`
                // when it flushes a vacated slide just before re-opening with new
                // content. Only fires for owners that opted INTO slide-aware
                // scoping; the explicit `backgroundId` is the previous slide id.
                if (scope?.viewerId && scope.backgroundId !== undefined) {
                    if (!isViewerBackgroundScoped(owner.bundleScope)) continue;
                    await this.runOneBundleExport(uid, owner, cap, sinks, scope.viewerId, scope.backgroundId, results, skipFileFallback);
                    // Slide-leave: re-arm hydration for this (viewer, background)
                    // so returning to the slide restores from sinks again.
                    this.hydratedKeys.delete(`${uid}|${this.composeBundleKey(scope.viewerId, scope.backgroundId)}`);
                    continue;
                }

                // Explicit viewerId only — viewer-scoped flush (legacy path).
                if (scope?.viewerId) {
                    await this.runOneBundleExport(uid, owner, cap, sinks, scope.viewerId, undefined, results, skipFileFallback);
                    continue;
                }

                if (isGlobalScoped(owner.bundleScope)) {
                    await this.runOneBundleExport(uid, owner, cap, sinks, undefined, undefined, results, skipFileFallback);
                }
                if (isViewerScoped(owner.bundleScope)) {
                    for (const v of viewers) {
                        await this.runOneBundleExport(uid, owner, cap, sinks, v.uniqueId, undefined, results, skipFileFallback);
                    }
                }
                if (isViewerBackgroundScoped(owner.bundleScope)) {
                    for (const v of viewers) {
                        const bgId = this.resolveCurrentBackgroundId(v.viewer);
                        if (!bgId) continue; // no current slide → nothing to key by
                        await this.runOneBundleExport(uid, owner, cap, sinks, v.uniqueId, bgId, results, skipFileFallback);
                    }
                }
            }
        }
        return results;
    }

    /**
     * Drain every tracked CRUD resource's outbox. Aggregates IOResults across
     * resources so the caller can inspect refusals. Failures in any single
     * resource do not abort the others.
     */
    async flushAllResources(): Promise<IOResult[]> {
        const out: IOResult[] = [];
        await Promise.all(Array.from(this.resources).map(async r => {
            try {
                const res = await r.flush();
                if (Array.isArray(res)) out.push(...res);
            } catch (e: any) {
                out.push({ ok: false, code: "W_IO_RESOURCE_FLUSH_THREW", reason: e?.message ?? String(e) });
            }
        }));
        return out;
    }

    /**
     * True if any owner has at least one **user-recoverable** sink bound for a
     * `bundle-export` capability. "User-recoverable" means a sink that
     * persists somewhere the user can get their data back from — see
     * `NON_REMOTE_BUNDLE_SINKS` for the exclusions (local file, in-memory
     * Rule-5 fallbacks, import-only sinks).
     *
     * The Save UI uses this to decide whether to trigger a remote flush or
     * degrade to the legacy file-download Export. Without the exclusion of
     * `post-data` / `session-memory`, vanilla deployments would always look
     * "remote-bound" because of the resolver's in-memory fallback, and Save
     * would silently no-op while claiming success.
     */
    hasRemoteBundleSinks(ownerUid?: string): boolean {
        for (const [uid, owner] of this.owners) {
            if (ownerUid && uid !== ownerUid) continue;
            if (owner.disabled) continue;
            for (const cap of owner.capabilities.values()) {
                if (cap.kind !== "bundle") continue;
                if (!cap.id.includes("export")) continue;
                for (const sid of this.bindingsFor(uid, cap.id)) {
                    if (!NON_REMOTE_BUNDLE_SINKS.has(sid)) return true;
                }
            }
        }
        return false;
    }

    private resolveCurrentBackgroundId(viewer: any): string | undefined {
        const utils = (window as any).UTILITIES;
        return utils && typeof utils.currentBackgroundIdFor === "function"
            ? utils.currentBackgroundIdFor(viewer)
            : undefined;
    }

    private composeBundleKey(viewerId: string | undefined, backgroundId: string | undefined): string {
        if (viewerId && backgroundId) return `${viewerId}::${backgroundId}`;
        if (viewerId) return viewerId;
        return "";
    }

    private async runOneBundleExport(
        uid: string,
        owner: OwnerRecord,
        cap: IOCapability,
        sinks: string[],
        viewerId: string | undefined,
        backgroundId: string | undefined,
        results: IOResult[],
        skipFileFallback: boolean = false,
    ): Promise<void> {
        const ctx: IOContext = {
            direction: "export",
            capabilityId: cap.id,
            xoType: owner.xoType,
            ownerUid: uid,
            ownerId: owner.ownerId,
            key: this.composeBundleKey(viewerId, backgroundId),
            viewerId,
            backgroundId,
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

        // Export fans out: every gated sink gets the payload, and one refusing
        // does not stop the others (a local file copy is still worth having
        // when the remote refused). `io:fully-refused` fires only if none took it.
        const { picked, declines } = this.selectGatedSinks(sinks, () => ctx);
        const pass = await this.runSinkPass(
            picked,
            (sink) => sink.writeBundle?.(ctx, payload) ?? this.unsupported(sink.id, "writeBundle"),
            { policy: "all", throwCode: "W_IO_SINK_THREW" },
        );
        const dispatchResults: IOResult[] = [...pass.results];
        let succeeded = pass.succeeded;
        results.push(...pass.results);

        if (sinks.length > 0 && succeeded === 0 && !skipFileFallback) {
            // Last-resort: if every bound sink for a bundle-export refused,
            // hand the payload to the built-in `file-download` sink so the
            // user always walks away with their data. Skipped if file-
            // download was already among the bindings (no point retrying it)
            // or if it isn't registered. Failures here surface like any
            // other refusal but don't loop back into this fallback.
            //
            // The user-facing **Save** action passes `skipFileFallback: true`
            // so that a silent local download never substitutes for the
            // remote persistence the deployment is configured for. **Export**
            // (the explicit "give me a file" action) leaves it default-false.
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
            const refusal = this.emitFullyRefused(ctx, dispatchResults, declines);
            // When every sink DECLINED, nothing else recorded a failure — the
            // aggregate would otherwise report a clean export of data that was
            // never written. Sinks that ran and refused already pushed theirs.
            if (!dispatchResults.length) results.push(refusal);
        }
    }

    // ── orchestration: read-and-restore (legacy boot/viewer-open path) ──

    /**
     * For each owner whose bundle-* capabilities are bound to readable
     * sinks (`readBundle`-capable), pull any pre-existing payload
     * and feed it to the owner's `importBundle` hook. Used at boot for
     * global state and on each viewer open for per-viewer state.
     */
    async tryRestoreImport(scope: { ownerUid?: string; viewerId?: string; backgroundId?: string } = {}): Promise<IOResult[]> {
        const results: IOResult[] = [];
        const viewers = this.getViewers();
        for (const [uid, owner] of this.owners) {
            if (scope.ownerUid && uid !== scope.ownerUid) continue;
            if (owner.disabled || !owner.importBundle) continue;
            // sinkId → the capability id that contributed the binding.
            //
            // The union across ALL bundle capabilities is deliberate: it
            // guarantees exactly one `readBundle` per sink and one
            // `importBundle` per payload, which iterating capabilities would
            // double-fire for an owner declaring two import capabilities. But
            // the contributing capability must be REMEMBERED rather than
            // assumed: `runOneRestore` used to hardcode `"bundle-import"`,
            // which makes `bindingConfig` resolve against a capability the
            // sink may not be bound under, and makes `{capabilityId}` in a
            // path template read from a different file than it wrote.
            // Import-kind capabilities win; an export-only binding falls back
            // to its own id.
            const sinks = new Map<string, string>();
            for (const cap of owner.capabilities.values()) {
                if (cap.kind !== "bundle") continue;
                const isImport = cap.id.includes("import");
                for (const tid of this.bindingsFor(uid, cap.id)) {
                    if (isImport || !sinks.has(tid)) sinks.set(tid, cap.id);
                }
            }
            if (sinks.size === 0) continue;

            // Explicit (viewer, background) — slide-change restore after the
            // new content's open settles. Skip owners that didn't opt INTO
            // slide-aware scoping; their state lives across slide swaps.
            if (scope.viewerId !== undefined && scope.backgroundId !== undefined) {
                if (!isViewerBackgroundScoped(owner.bundleScope)) continue;
                await this.runOneRestore(uid, owner, sinks, scope.viewerId, scope.backgroundId, results);
                continue;
            }
            // Explicit viewer scope only — boot-time `forceDataImportInitialization`
            // path. Dispatches per-viewer (legacy semantics); per-viewer-background
            // owners get their boot restore here too, with the current bg id.
            if (scope.viewerId !== undefined) {
                if (isViewerBackgroundScoped(owner.bundleScope)) {
                    const v = viewers.find(x => x.uniqueId === scope.viewerId);
                    const bgId = this.resolveCurrentBackgroundId(v?.viewer);
                    if (bgId) await this.runOneRestore(uid, owner, sinks, scope.viewerId, bgId, results);
                }
                if (isViewerScoped(owner.bundleScope)) {
                    await this.runOneRestore(uid, owner, sinks, scope.viewerId, undefined, results);
                }
                continue;
            }
            // GLOBAL is always safe to restore — there's no other path
            // that handles the "no viewerId" key.
            if (isGlobalScoped(owner.bundleScope)) {
                await this.runOneRestore(uid, owner, sinks, undefined, undefined, results);
            }
            // Per-viewer catch-up is gated on the boot pass having
            // already fired. While pending, the loader's
            // `forceDataImportInitialization` will dispatch per viewer for
            // every currently-registered owner — running it here too
            // would double-fire `importBundle`. Once the boot pass is
            // done, any newly-registered (lazy) owner uses this branch
            // to catch up. Viewers opening AFTER this point still need
            // their own viewer-create handler (out of scope here).
            if (!this.bootRestorePending && isViewerScoped(owner.bundleScope)) {
                for (const v of viewers) {
                    await this.runOneRestore(uid, owner, sinks, v.uniqueId, undefined, results);
                }
            }
            if (!this.bootRestorePending && isViewerBackgroundScoped(owner.bundleScope)) {
                for (const v of viewers) {
                    const bgId = this.resolveCurrentBackgroundId(v.viewer);
                    if (!bgId) continue;
                    await this.runOneRestore(uid, owner, sinks, v.uniqueId, bgId, results);
                }
            }
        }
        return results;
    }

    private async runOneRestore(
        uid: string,
        owner: OwnerRecord,
        sinks: Map<string, string>,
        viewerId: string | undefined,
        backgroundId: string | undefined,
        results: IOResult[],
    ): Promise<void> {
        // Background-scoped restores hydrate at most once per
        // (owner, viewer, background) — see `hydratedKeys`. Viewer-only and
        // global restores keep their existing semantics.
        const guardKey = `${uid}|${this.composeBundleKey(viewerId, backgroundId)}`;
        if (backgroundId !== undefined && this.hydratedKeys.has(guardKey)) return;
        const ctxBase: Omit<IOContext, "meta" | "capabilityId"> = {
            direction: "import",
            xoType: owner.xoType,
            ownerUid: uid,
            ownerId: owner.ownerId,
            key: this.composeBundleKey(viewerId, backgroundId),
            viewerId,
            backgroundId,
        };
        const dispatchResults: IOResult[] = [];
        let succeeded = 0;
        // Restore reads from every gated sink (last non-empty payload wins in
        // the owner's state). Kept as its own loop rather than a `runSinkPass`
        // because each read feeds `owner.importBundle` and an *empty* read is a
        // success that still has work to do — see the wipe case below.
        // Per-sink capability id — see the comment on the `sinks` map.
        const { picked } = this.selectGatedSinks(
            sinks.keys(),
            (tid) => ({ ...ctxBase, capabilityId: sinks.get(tid)!, meta: { sinkId: tid } }),
            (sink) => sink.readBundle ? undefined : `sink "${sink.id}" does not implement "readBundle"`,
        );
        const attempted = picked.length;
        for (const { sink: t, ctx } of picked) {
            try {
                const r = await t.readBundle!(ctx);
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
                    //
                    // Slide-aware owners (bundleScope: per-viewer-background
                    // / all → ctx.backgroundId set) DO need the call even on
                    // empty — they have local UI state (e.g. fabric overlay
                    // for annotations) that survives the OSD world reset and
                    // must be wiped when the new slide carries no payload.
                    // Other scopes have no equivalent state to clear, so the
                    // legacy skip stays.
                    if (ctx.backgroundId !== undefined) {
                        await owner.importBundle!(ctx, payload);
                    }
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
        // Mark hydrated only on success so a transient sink failure
        // (network/auth hiccup at boot) doesn't permanently block hydration.
        // The empty-payload wipe path counts as success — an empty
        // hydration is still a hydration.
        if (backgroundId !== undefined && succeeded > 0) {
            this.hydratedKeys.add(guardKey);
        }
        if (attempted > 0 && succeeded === 0) {
            // Restore-side full refusal stays gated on `attempted`: a sink that
            // declines a READ costs nothing (there is simply nothing to
            // hydrate), unlike a write nobody took. Reported for visibility.
            const anyCapability = sinks.values().next().value ?? "bundle-import";
            this.emitFullyRefused({ ...ctxBase, capabilityId: anyCapability, meta: {} } as IOContext, dispatchResults);
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

        const { picked, declines } = this.selectGatedSinks(sinkIds, () => ctx);
        const pass = await this.runSinkPass(picked, (sink) => {
            const method = pickMethod(sink, ctx.direction);
            // Surface the unsupported case as a refusal rather than leaving it
            // to `emitFullyRefused`: that call skips its own toast when a result
            // already carries a `userMessage`, so an unsurfaced-but-message-
            // bearing refusal would be swallowed by exactly the check meant to
            // prevent double-toasting.
            if (!method) return this.unsupported(sink.id, ctx.direction);
            return Promise.resolve(method.call(sink, ctx, payload));
        }, {
            policy: "until-refusal",
            throwCode: "W_IO_SINK_THREW",
            shortCircuitOn: r => (r as any).code !== "W_IO_UNSUPPORTED",
        });

        // NOTE the condition is `sinkIds.length`, not the number of sinks that
        // ran. Sinks that declined never run, so gating on that meant an
        // all-declined dispatch returned a clean `{ok:true}`: the caller
        // committed an item that no destination ever stored. A write nobody
        // took is a refusal.
        if (sinkIds.length > 0 && pass.succeeded === 0) {
            const refusal = this.emitFullyRefused(ctx, pass.results, declines);
            if (pass.refused) return pass.refused;
            if (pass.last.ok) return refusal;
        }
        return pass.last;
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

        // Query is first-match: one stream, one sink. Selection goes through
        // the shared gate so accept-rejections raise the same visibility events
        // as every other path.
        const { picked, declines } = this.selectGatedSinks(sinkIds, () => ctx,
            (sink) => typeof sink.query === "function" ? undefined : `sink "${sink.id}" does not implement "query"`);
        const chosen = picked[0]?.sink;

        if (!chosen) {
            // Every bound sink declined or lacked `query`. Surface
            // it the same way bundle-export does on full refusal.
            const skipped: IOResult[] = declines.map(reason => ({
                ok: false, refused: true, reason, code: "W_IO_REJECTED_BY_ACCEPTS",
            }));
            this.emitFullyRefused(ctx, skipped, declines);
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

    /**
     * Decide whether one sink takes this dispatch. Two gates, in order:
     *
     *  1. the sink's DECLARATIVE support (`IOSinkSupport`) — statically known
     *     limits, also checked at boot by `validateBindings`;
     *  2. the sink's imperative `accepts(ctx)` — genuinely runtime conditions
     *     (missing config, wrong viewer state), which may now return a reason.
     *
     * A decline is NOT an error on its own: multi-sink routing depends on it
     * (bind `[dicom-sr-annotations, post-data]` and let each take what it
     * serves). It only becomes an error when *nobody* took the dispatch —
     * see the `W_IO_NO_SINK_ACCEPTED` refusal built by `noSinkAccepted`.
     */
    /**
     * Resolve a binding list into the sinks that will actually run, dropping
     * unregistered ids, sinks the caller cannot use, and sinks whose declarative
     * support or `accepts()` declines this context.
     *
     * Every multi-sink path funnels through here so "why did nothing happen?"
     * has one answer and one set of `io:rejected-by-accepts` events, whatever
     * the iteration policy on top (see `runSinkPass`).
     *
     * @param usable optional pre-gate filter (e.g. "must implement readBundle");
     *   returns a decline reason to record, or undefined to keep the sink.
     */
    private selectGatedSinks(
        sinkIds: Iterable<string>,
        ctxFor: (sinkId: string) => IOContext,
        usable?: (sink: IOSink, ctx: IOContext) => string | undefined,
    ): { picked: Array<{ sink: IOSink; ctx: IOContext }>; declines: string[] } {
        const picked: Array<{ sink: IOSink; ctx: IOContext }> = [];
        const declines: string[] = [];
        for (const tid of sinkIds) {
            const sink = this.sinks.get(tid);
            if (!sink) continue;
            const ctx = ctxFor(tid);
            const unusable = usable?.(sink, ctx);
            if (unusable) { declines.push(unusable); continue; }
            const gate = this.gateSink(sink, ctx);
            if (!gate.ok) {
                // Prefer the sink's user-facing wording: this list is what the
                // "nothing stored" toast quotes when nobody took the call.
                declines.push(gate.userMessage ?? gate.reason);
                continue;
            }
            picked.push({ sink, ctx });
        }
        return { picked, declines };
    }

    /**
     * Run one invocation against each gated sink, classifying outcomes the same
     * way everywhere: a returned refusal is surfaced, a thrown error becomes a
     * refusal with `throwCode`, and everything else counts as a success.
     *
     * `policy` is the only thing that differs between the multi-sink paths:
     *
     * | policy | used by | meaning |
     * |---|---|---|
     * | `all`           | bundle export, restore | every gated sink runs; refusals do not stop the rest |
     * | `until-refusal` | CRUD dispatch          | sinks run in binding order until one refuses; that refusal is the result |
     *
     * (Streamed `query` is *first-match* and does not run a pass at all — it
     * picks one sink through `selectGatedSinks` and yields from it.)
     */
    private async runSinkPass(
        picked: Array<{ sink: IOSink; ctx: IOContext }>,
        invoke: (sink: IOSink, ctx: IOContext) => Promise<IOResult | undefined> | IOResult | undefined,
        options: {
            policy: "all" | "until-refusal";
            throwCode: string;
            /** Refusals that must NOT abort the remaining sinks (default: all do).
             *  A sink that cannot perform the op is a misrouted binding, not a
             *  verdict on the data — the next sink still deserves the call. */
            shortCircuitOn?: (r: Extract<IOResult, { ok: false }>) => boolean;
        },
    ): Promise<{ results: IOResult[]; succeeded: number; last: IOResult; refused?: IOResult }> {
        const results: IOResult[] = [];
        let succeeded = 0;
        let last: IOResult = { ok: true };
        for (const { sink, ctx } of picked) {
            let r: IOResult;
            try {
                r = (await invoke(sink, ctx)) ?? { ok: true };
            } catch (e: any) {
                r = this.failure(ctx, e?.message ?? String(e), options.throwCode, e?.userMessage);
                results.push(r);
                last = r;
                continue;   // a throwing sink never short-circuits the others
            }
            results.push(r);
            last = r;
            if (r.ok) { succeeded++; continue; }
            if (r.refused) {
                const refusal = r as Extract<IOResult, { ok: false }>;
                this.surfaceRefusal(ctx, refusal);
                if (options.policy === "until-refusal" && (options.shortCircuitOn?.(refusal) ?? true)) {
                    return { results, succeeded, last, refused: r };
                }
            }
        }
        return { results, succeeded, last };
    }

    private gateSink(t: IOSink, ctx: IOContext): { ok: true } | { ok: false; reason: string; userMessage?: string } {
        const declared = supportMismatch(t, probeFromContext(ctx));
        if (declared) {
            this.emitRejectedByAccepts(ctx, t.id, declared);
            return { ok: false, reason: declared };
        }
        if (!t.accepts) return { ok: true };
        let verdict: boolean | IOAcceptDecision;
        try {
            verdict = t.accepts(ctx);
        } catch (e: any) {
            const reason = `sink "${t.id}" accepts() threw: ${e?.message ?? String(e)}`;
            this.emitRejectedByAccepts(ctx, t.id, reason);
            return { ok: false, reason };
        }
        if (verdict === true || verdict === undefined) return { ok: true };
        if (verdict === false) {
            const reason = `sink "${t.id}" declined (accepts: false)`;
            this.emitRejectedByAccepts(ctx, t.id, reason);
            return { ok: false, reason };
        }
        const reason = verdict.reason || `sink "${t.id}" declined`;
        this.emitRejectedByAccepts(ctx, t.id, reason);
        return { ok: false, reason, userMessage: verdict.userMessage };
    }

    /**
     * The refusal returned when every sink bound to a (owner, capability)
     * declined or failed. Carries the collected reasons so the toast names
     * the actual cause ("sink X only serves owners [annotations]") instead
     * of a generic "no sink accepted".
     */
    private noSinkAccepted(ctx: IOContext, declines: string[], results: IOResult[]): Extract<IOResult, { ok: false }> {
        const detail = [
            ...declines,
            ...results.filter(r => !r.ok).map(r => (r as any).reason).filter(Boolean),
        ];
        const reason = detail.length
            ? `no sink handled ${ctx.direction} for ${ctx.ownerUid}::${ctx.capabilityId}: ${detail.join("; ")}`
            : `no sink handled ${ctx.direction} for ${ctx.ownerUid}::${ctx.capabilityId}`;
        // A read that reaches no sink and a write that reaches no sink are very
        // different news for the user; only the second one lost data.
        const isRead = ctx.direction === "read" || ctx.direction === "import" || ctx.direction === "query";
        const key = detail[0]
            ? (isRead ? "error.ioNothingLoadedWhy" : "error.ioNothingStoredWhy")
            : (isRead ? "error.ioNothingLoaded" : "error.ioNothingStored");
        return {
            ok: false,
            refused: true,
            reason,
            code: "W_IO_NO_SINK_ACCEPTED",
            userMessage: $.t(key, { owner: ctx.ownerId, reason: detail[0] }),
        };
    }

    /** A bound sink opted out of this context (declarative support mismatch
     *  or `accepts` decline). Distinct from `io:refused` so observers can
     *  tell a soft route-skip apart from a tried-and-failed write. */
    private emitRejectedByAccepts(ctx: IOContext, sinkId: string, reason?: string) {
        console.info(`[IO] sink "${sinkId}" declined ${ctx.direction} for ${ctx.ownerUid}::${ctx.capabilityId}${reason ? ` — ${reason}` : ""}`);
        const payload = { ctx, sinkId, reason };
        this.bus.raiseEvent("io:rejected-by-accepts", payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:rejected-by-accepts", payload);
        } catch { /* viewer manager may not yet exist */ }
    }

    /** Every bound sink for one dispatch failed (refused, threw, or
     *  declined). Signal of a misconfigured binding that would otherwise
     *  silently drop data. Emitted at most once per dispatch, and surfaced
     *  to the user — a write nobody accepted is data loss, not a log line. */
    private emitFullyRefused(ctx: IOContext, results: IOResult[], declines: string[] = []) {
        const refusal = this.noSinkAccepted(ctx, declines, results);
        console.warn(`[IO] ${refusal.reason} — data not written. Check ENV.client.io.bindings.`);
        const payload = { ctx, results, declines, result: refusal };
        this.bus.raiseEvent("io:fully-refused", payload);
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm?.raiseEvent) vm.raiseEvent("io:fully-refused", payload);
        } catch { /* viewer manager may not yet exist */ }
        // Don't double-toast: an individual sink that already surfaced its own
        // user-facing refusal (e.g. "GitHub rejected the access token") has
        // said the useful thing already. Only speak up when nothing did.
        const alreadySurfaced = results.some(r => !r.ok && (r as any).userMessage);
        if (!alreadySurfaced) this.surfaceRefusal(ctx, refusal);
        return refusal;
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
            // A binding pointing at a sink that cannot perform the operation
            // is an admin mistake that costs data. Without a userMessage this
            // refusal stays at warn level in `surfaceRefusal` and nobody sees
            // it until someone reads the console.
            userMessage: $.t("error.ioUnsupported", { sink: sinkId, operation: op }),
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
