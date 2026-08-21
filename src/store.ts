// XOpatStorage — sync/async key-value façades over the unified IO pipeline
// (`window.IO_PIPELINE`). The legacy public surface is preserved:
//   XOpatStorage.Cache    → kv:cache    (sync,  default driver: local-storage)
//   XOpatStorage.Cookies  → kv:cookies  (sync,  default driver: cookies)
//   XOpatStorage.Session  → kv:session  (sync,  default driver: session-storage)
//   XOpatStorage.Data     → kv:data     (async, default driver: post-data)
// See src/IO_PIPELINE.md for the full design.
//
// This file also owns `XOpatStorageAvailability`, the single canonical probe
// for browser-storage usability. It lives here because `dist/store.js` is the
// FIRST app script loaded (`src/config.json` → `js.src.loader`), so the probe
// is available to `src/parse-input.js`, `dist/app.js`, `ui/**` and modules
// with no import and no extra script tag.

export type StorageSchemaElement = {
    _deprecated: Array<string> | undefined;
};

export type StorageSchema = Record<string, StorageSchemaElement>;

export type StorageOptions = {
    /** Owner uid (legacy: `id`). The empty string means "core". */
    id: string;
    schema?: StorageSchema;
    strictSchema?: boolean;
};

/** Interface for synchronous storage (Storage-shaped, used by KV drivers). */
export interface StorageLike {
    readonly length: number;
    clear(): void;
    getItem(key: string): string | null;
    key(index: number): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
}

/** Interface for asynchronous storage (Promise-returning Storage shape). */
export interface AsyncStorageLike {
    readonly length: Promise<number>;
    clear(): Promise<void>;
    getItem(key: string): Promise<any>;
    key(index: number): Promise<string | null>;
    removeItem(key: string): Promise<void>;
    setItem(key: string, value: string): Promise<void>;
}

/** Interface for cookies — Storage-shaped plus a builder-pattern option setter. */
export interface CookieStorageLike extends StorageLike {
    with(options: object): CookieStorageLike;
}

/** Base class for sync KV drivers. Existing custom drivers extend these. */
export class xoStorage implements StorageLike {
    get length(): number { throw `${this.constructor.name}::length must be implemented!`; }
    clear(): void { throw `${this.constructor.name}::clear must be implemented!`; }
    getItem(_key: string): any { throw `${this.constructor.name}::getItem must be implemented!`; }
    key(_index: number): string | null { throw `${this.constructor.name}::key must be implemented!`; }
    removeItem(_key: string): void { throw `${this.constructor.name}::removeItem must be implemented!`; }
    setItem(_key: string, _value: string): void { throw `${this.constructor.name}::setItem must be implemented!`; }
}

export class xoCookieStorage extends xoStorage {
    with(_options: object): xoCookieStorage {
        throw `${this.constructor.name}::with must be implemented!`;
    }
}

export class xoAsyncStorage implements AsyncStorageLike {
    get length(): Promise<number> { throw `${this.constructor.name}::length must be implemented!`; }
    async clear(): Promise<void> { throw `${this.constructor.name}::clear must be implemented!`; }
    async getItem(_key: string): Promise<any> { throw `${this.constructor.name}::getItem must be implemented!`; }
    async key(_index: number): Promise<string | null> { throw `${this.constructor.name}::key must be implemented!`; }
    async removeItem(_key: string): Promise<void> { throw `${this.constructor.name}::removeItem must be implemented!`; }
    async setItem(_key: string, _value: string): Promise<void> { throw `${this.constructor.name}::setItem must be implemented!`; }
}

// ── Browser-storage availability probe ─────────────────────────────────────
//
// In a sandboxed iframe without `allow-same-origin` (the EMPAIA Workbench
// embedding) the document has an OPAQUE ORIGIN. There, reading the
// `window.localStorage` / `window.sessionStorage` PROPERTY throws
// `SecurityError` — so `if (window.localStorage)` is a throw site, not a
// feature detection. `document.cookie` throws on write, and the bare
// `indexedDB` identifier throws on read.
//
// Everything that must touch those APIs asks here first. Results are memoized:
// the probe writes, so it must not run on every call.

export type BrowserStorageKind = "localStorage" | "sessionStorage" | "cookies" | "indexedDB";

export type StorageProbeResult = { ok: boolean; reason?: string };

const STORAGE_PROBE_KEY = "__xopat_storage_probe__";

const _storageProbes: Partial<Record<BrowserStorageKind, StorageProbeResult>> = {};

function probeWebStorage(kind: "localStorage" | "sessionStorage"): StorageProbeResult {
    try {
        // The property read is the throw site in an opaque origin.
        const s: Storage | undefined = (window as any)[kind];
        if (!s) return { ok: false, reason: "absent" };
        // The round-trip matters: Safari private mode and partitioned storage
        // expose the object but reject or silently drop writes.
        s.setItem(STORAGE_PROBE_KEY, "1");
        const ok = s.getItem(STORAGE_PROBE_KEY) === "1";
        s.removeItem(STORAGE_PROBE_KEY);
        return ok ? { ok: true } : { ok: false, reason: "write dropped" };
    } catch (e: any) {
        return { ok: false, reason: String(e?.name || e) };
    }
}

function probeCookies(): StorageProbeResult {
    try {
        document.cookie = `${STORAGE_PROBE_KEY}=1;SameSite=Lax;path=/`;
        const ok = document.cookie.indexOf(`${STORAGE_PROBE_KEY}=`) >= 0;
        // Expire the probe regardless of the verdict.
        document.cookie = `${STORAGE_PROBE_KEY}=;Max-Age=0;path=/`;
        // A third-party context that drops the write silently is a legitimate
        // `false`, not an error.
        return ok ? { ok: true } : { ok: false, reason: "write dropped" };
    } catch (e: any) {
        return { ok: false, reason: String(e?.name || e) };
    }
}

function probeIndexedDB(): StorageProbeResult {
    try {
        // The bare identifier read is the throw site. Opening a database is
        // async and therefore not part of a sync probe — `outbox-store.ts`
        // still guards the `open()` call itself.
        const ok = typeof indexedDB !== "undefined" && !!indexedDB;
        return ok ? { ok: true } : { ok: false, reason: "absent" };
    } catch (e: any) {
        return { ok: false, reason: String(e?.name || e) };
    }
}

function probeStorage(kind: BrowserStorageKind): StorageProbeResult {
    const cached = _storageProbes[kind];
    if (cached) return cached;
    const result = kind === "cookies" ? probeCookies()
        : kind === "indexedDB" ? probeIndexedDB()
        : probeWebStorage(kind);
    _storageProbes[kind] = result;
    return result;
}

/**
 * Canonical browser-storage availability. Never throws.
 *
 * Deployments that want to opt out of browser storage regardless of
 * availability bind the KV capabilities to the `memory` driver in
 * `ENV.client.<active>.io.bindings.core` — see `src/IO_PIPELINE.md`.
 * There is deliberately no `setup.*` flag: that surface is session/URL
 * overridable (AGENTS.md §7), and this one is operator policy.
 *
 * @namespace XOpatStorageAvailability
 */
export const XOpatStorageAvailability = {
    /** Memoized per-API verdict. */
    check(kind: BrowserStorageKind): boolean { return probeStorage(kind).ok; },
    /**
     * Record that an API which *probed* as available turned out not to be.
     *
     * Some failures cannot be detected synchronously: `indexedDB` is a readable
     * identifier in a sandboxed iframe and only `open()` throws `SecurityError`.
     * The first consumer to learn that reports it here, so the verdict is shared
     * instead of every other consumer rediscovering it — and so `degraded` /
     * `opaqueOrigin` describe reality.
     */
    recordFailure(kind: BrowserStorageKind, error?: unknown): void {
        const reason = String((error as any)?.name || error || "unavailable");
        _storageProbes[kind] = { ok: false, reason };
    },
    get localStorage(): boolean { return probeStorage("localStorage").ok; },
    get sessionStorage(): boolean { return probeStorage("sessionStorage").ok; },
    get cookies(): boolean { return probeStorage("cookies").ok; },
    get indexedDB(): boolean { return probeStorage("indexedDB").ok; },
    /** True for an opaque origin — a sandboxed iframe without `allow-same-origin`. */
    get opaqueOrigin(): boolean {
        try {
            if ((window as any).origin === "null" || location.origin === "null") return true;
        } catch (e) {
            return true;
        }
        return !this.localStorage && !this.sessionStorage && !this.cookies;
    },
    /** True when any of localStorage / sessionStorage / cookies is unusable. */
    get degraded(): boolean {
        return !this.localStorage || !this.sessionStorage || !this.cookies;
    },
    /** Diagnostics: the full per-API verdict with failure reasons. */
    report(): Record<BrowserStorageKind, StorageProbeResult> {
        return {
            localStorage: probeStorage("localStorage"),
            sessionStorage: probeStorage("sessionStorage"),
            cookies: probeStorage("cookies"),
            indexedDB: probeStorage("indexedDB"),
        };
    },
};

(window as any).XOpatStorageAvailability = XOpatStorageAvailability;

function pipeline(): any {
    const p = (globalThis as any).IO_PIPELINE;
    if (!p) {
        throw "XOpatStorage: IO_PIPELINE is not initialized yet — make sure initXOpatLoader has been called.";
    }
    return p;
}

function ownerUidOf(opts: StorageOptions): string {
    if (!opts || opts.id === undefined) throw "XOpatStorage: invalid configuration: missing options.id!";
    return opts.id || "core";
}

function bypassed(flag: string): boolean {
    if (!flag) return false;    // façade without an opt-out flag (Session)
    const ac = (globalThis as any).APPLICATION_CONTEXT;
    if (!ac?.getOption) return false;
    // cache=false avoids infinite recursion: getOption itself reads through Cache.
    return !!ac.getOption(flag, false, false);
}

/**
 * Sync façade backing Cache, Cookies and Session. The KV handle is resolved
 * lazily (façades are constructed in `src/app.ts` before IO_PIPELINE exists)
 * and then cached — admin re-binding at runtime is not supported.
 *
 * A driver that becomes unusable mid-session does NOT invalidate this handle:
 * degradation happens inside the driver object (see `io/kv-drivers.ts`), which
 * keeps its identity, so already-resolved handles keep working.
 */
class SyncFacade {
    protected uid: string;
    private capability: string;
    private bypassFlag: string;
    private handle: IOKVHandle | null = null;
    constructor(opts: StorageOptions, capability: string, bypassFlag: string) {
        this.uid = ownerUidOf(opts);
        this.capability = capability;
        this.bypassFlag = bypassFlag;
    }
    protected kv(): IOKVHandle {
        return this.handle ??= pipeline().kv(this.uid, this.capability);
    }
    get<T = any>(key: string, defaultValue?: T): T | string | boolean | null | undefined {
        if (bypassed(this.bypassFlag)) return defaultValue;
        return this.kv().get(key, defaultValue) as any;
    }
    set(key: string, value: any): void {
        if (bypassed(this.bypassFlag)) return;
        this.kv().set(key, value);
    }
    delete(key: string): void {
        if (bypassed(this.bypassFlag)) return;
        this.kv().delete(key);
    }
    keys(): string[] {
        if (bypassed(this.bypassFlag)) return [];
        return this.kv().keys() as string[];
    }
    /**
     * `Storage`-shaped adapter over the bound KV handle, for third-party
     * libraries that require a real `Storage` (oidc-client-ts'
     * `WebStorageStateStore`). The handle exposes `keys()` but neither
     * `key(i)` nor `length`, so both are derived from it.
     *
     * Deliberately NOT bypass-gated: this is a driver-level view, and a
     * library holding auth state must keep working when a user turns the
     * cache off. Deliberately not memoized either — it is a thin view.
     */
    getStore(): StorageLike {
        const kv = () => this.kv();
        return {
            get length(): number { return (kv().keys() as string[]).length; },
            key: (i: number) => (kv().keys() as string[])[i] ?? null,
            getItem: (k: string) => kv().getItem(k) as string | null,
            setItem: (k: string, v: string) => { kv().setItem(k, v); },
            removeItem: (k: string) => { kv().removeItem(k); },
            clear: () => { kv().clear(); },
        };
    }
}

class CacheFacade extends SyncFacade {
    constructor(opts: StorageOptions) { super(opts, "kv:cache", "bypassCache"); }
}

class SessionFacade extends SyncFacade {
    // No bypass flag: tab-scoped state (auth round-trips) is not a persistence
    // preference. `bypassCache` must not silently break a login redirect.
    constructor(opts: StorageOptions) { super(opts, "kv:session", ""); }
}

class CookiesFacade extends SyncFacade {
    constructor(opts: StorageOptions) { super(opts, "kv:cookies", "bypassCookies"); }
    /** Forward to the cookies driver's per-call option setter, if present. */
    with(options: object): this {
        const d: any = pipeline().getKVDriver("cookies");
        if (typeof d?.with === "function") d.with(options);
        return this;
    }
}

class DataFacade {
    private uid: string;
    private handle: IOKVHandle | null = null;
    constructor(opts: StorageOptions) { this.uid = ownerUidOf(opts); }
    private kv(): IOKVHandle {
        return this.handle ??= pipeline().kv(this.uid, "kv:data", { sync: false });
    }
    async get<T = any>(key: string, defaultValue?: T): Promise<T | string | boolean | null | undefined> {
        return (await this.kv().get(key, defaultValue)) as any;
    }
    async set(key: string, value: any): Promise<void> { await this.kv().set(key, value); }
    async delete(key: string): Promise<void> { await this.kv().delete(key); }
    async keys(): Promise<Array<string>> { return (await this.kv().keys()) as string[]; }
}

/**
 * Storage Namespace for xOpat.
 *
 * @namespace XOpatStorage
 */
export const XOpatStorage = {
    Storage: xoStorage,
    AsyncStorage: xoAsyncStorage,
    CookieStorage: xoCookieStorage,
    /** Sync per-owner cache, default-routed to localStorage. */
    Cache: CacheFacade,
    /** Sync per-owner cookies, default-routed to the browser cookie jar. */
    Cookies: CookiesFacade,
    /** Sync per-owner tab-scoped store, default-routed to sessionStorage. */
    Session: SessionFacade,
    /** Async per-owner data store, default-routed to the POST_DATA bucket. */
    Data: DataFacade,
};

(window as any).XOpatStorage = XOpatStorage;
