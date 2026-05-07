// XOpatStorage — sync/async key-value façades over the unified IO pipeline
// (`window.IO_PIPELINE`). The legacy public surface is preserved:
//   XOpatStorage.Cache    → kv:cache    (sync,  default driver: local-storage)
//   XOpatStorage.Cookies  → kv:cookies  (sync,  default driver: cookies)
//   XOpatStorage.Data     → kv:data     (async, default driver: post-data)
// See src/IO_PIPELINE.md for the full design.

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
    const ac = (globalThis as any).APPLICATION_CONTEXT;
    if (!ac?.getOption) return false;
    // cache=false avoids infinite recursion: getOption itself reads through Cache.
    return !!ac.getOption(flag, false, false);
}

/**
 * Sync façade backing both Cache and Cookies. The KV handle is resolved
 * lazily (façades are constructed in `src/app.ts` before IO_PIPELINE
 * exists) and then cached — admin re-binding at runtime is not
 * supported; call `refresh()` if the binding changes.
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
    /** Force the next operation to re-resolve the binding. */
    refresh(): void { this.handle = null; }
    get<T = any>(key: string, defaultValue?: T): T | string | boolean | null | undefined {
        if (bypassed(this.bypassFlag)) return defaultValue;
        return this.kv().get(key, defaultValue) as any;
    }
    set(key: string, value: any): void {
        if (bypassed(this.bypassFlag)) return;
        this.kv().set(key, value);
    }
    delete(key: string): void { this.kv().delete(key); }
    keys(): string[] { return this.kv().keys() as string[]; }
}

class CacheFacade extends SyncFacade {
    constructor(opts: StorageOptions) { super(opts, "kv:cache", "bypassCache"); }
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
    refresh(): void { this.handle = null; }
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
    /** Async per-owner data store, default-routed to the POST_DATA bucket. */
    Data: DataFacade,
};

(window as any).XOpatStorage = XOpatStorage;
