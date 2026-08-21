/**
 * Ambient declaration for `globalThis.XOPAT_SERVER`, the API core installs for
 * every `*.server.{ts,mjs,js}` file in a plugin or module.
 *
 * Server files may not import from core (the loader composes them dynamically),
 * so the surface is reached through the global. Without this file every server
 * module wrote `(globalThis as any).XOPAT_SERVER` and got no completion and no
 * checking on any of it.
 *
 * Kept in sync by hand with `server/node/server-helpers.js` (`createServerHelpers`).
 * See `server/README.md`, `server/STORAGE.md` and `src/AUTH.md`.
 */

declare namespace XOpatServer {
    // ── storage ──────────────────────────────────────────────────────────────

    type Sensitivity = "normal" | "secret";

    interface NamespaceOptions {
        /** Idle lifetime, refreshed on read. */
        ttlMs?: number;
        maxEntries?: number;
        maxBytes?: number;
        /** Reject a single value larger than this (blob namespaces). */
        maxEntryBytes?: number;
        /**
         * `"secret"` refuses a persistent driver unless the operator set
         * `allowPersistentSecrets`. Use it for credentials and tokens.
         */
        sensitivity?: Sensitivity;
        /** Driver ids to use when the operator configured no binding. */
        defaultBindings?: string[];
        /**
         * Store-initiated removals only — `"ttl"`, `"lru"`, `"bytes"`. Your own
         * `delete()`/`clear()` calls do NOT fire it.
         */
        onEvict?(key: string, value: unknown, reason: string): void | Promise<void>;
        /** Front-tier revalidation. Auto-detected from cluster mode. */
        coherency?: "shared" | "single";
    }

    interface EntryStat {
        bytes: number;
        updatedAt: number | null;
        version: string | null;
        length?: number;
        contentType?: string | null;
    }

    interface KVHandle {
        readonly ownerUid: string;
        readonly capabilityId: string;
        readonly persistent: boolean;
        get<T = any>(key: string, defaultValue?: T | null): Promise<T | null>;
        set(key: string, value: any, meta?: { ttlMs?: number }): Promise<void>;
        delete(key: string): Promise<boolean>;
        has(key: string): Promise<boolean>;
        touch(key: string): Promise<boolean>;
        stat(key: string): Promise<EntryStat | null>;
        keys(opts?: { prefix?: string; limit?: number }): Promise<string[]>;
        scan(opts?: { prefix?: string }): AsyncIterable<[string, any]>;
        clear(): Promise<void>;
        /** Per-caller isolation. Pass `XOPAT_SERVER.resolvePrincipal(ctx)`. */
        scoped(principal: string): KVHandle;
    }

    interface LogHandle {
        readonly persistent: boolean;
        append(key: string, entries: any[]): Promise<number>;
        tail(key: string, n: number): Promise<any[]>;
        range(key: string, from?: number, to?: number): Promise<any[]>;
        length(key: string): Promise<number>;
        trim(key: string, keepTail: number): Promise<number>;
        delete(key: string): Promise<boolean>;
        keys(opts?: { prefix?: string; limit?: number }): Promise<string[]>;
        scoped(principal: string): LogHandle;
    }

    interface BlobHandle {
        readonly persistent: boolean;
        put(key: string, source: Buffer | Uint8Array | string | AsyncIterable<any>,
            meta?: { contentType?: string; ttlMs?: number }): Promise<{ bytes: number; etag: string | null }>;
        get(key: string): Promise<Buffer | null>;
        stream(key: string): Promise<NodeJS.ReadableStream | null>;
        stat(key: string): Promise<EntryStat | null>;
        delete(key: string): Promise<boolean>;
        keys(opts?: { prefix?: string; limit?: number }): Promise<string[]>;
        clear(): Promise<void>;
        scoped(principal: string): BlobHandle;
    }

    /** A custom backend (Redis, Postgres, S3…). `kv` is enough — see STORAGE.md. */
    interface Driver {
        id: string;
        supports: Array<"kv" | "log" | "blob">;
        persistent?: boolean;
        shared?: boolean;
        [method: string]: any;
    }

    interface Storage {
        readonly root: string;
        kv(ownerUid: string, namespace: string, options?: NamespaceOptions): KVHandle;
        log(ownerUid: string, namespace: string, options?: NamespaceOptions): LogHandle;
        blob(ownerUid: string, namespace: string, options?: NamespaceOptions): BlobHandle;
        registerDriver(driver: Driver): () => void;
        getDriver(id: string): Driver | undefined;
        listDrivers(): string[];
        sweep(): Promise<{ swept: number; removed: number; leader?: boolean }>;
        stats(): { root: string; namespaces: any[]; drivers: string[] };
    }

    // ── in-process cache ─────────────────────────────────────────────────────

    interface BoundedCache<V = any> {
        readonly name: string;
        readonly size: number;
        readonly bytes: number;
        /** Read + LRU touch + idle-TTL refresh. */
        get(key: string): V | undefined;
        /** Read WITHOUT touching recency or refreshing the TTL. */
        peek(key: string): V | undefined;
        has(key: string): boolean;
        set(key: string, value: V, options?: { ttlMs?: number; bytes?: number }): void;
        touch(key: string): boolean;
        delete(key: string): boolean;
        clear(): void;
        keys(): IterableIterator<string>;
        values(): IterableIterator<V>;
        entries(): IterableIterator<[string, V]>;
        sweep(): number;
        reconfigure(partial: { maxEntries?: number; ttlMs?: number; maxBytes?: number }): void;
        stats(): CacheStats;
        dispose(): void;
    }

    interface CacheStats {
        name: string;
        size: number;
        bytes: number;
        maxEntries: number | null;
        maxBytes: number | null;
        ttlMs: number | null;
        hits: number;
        misses: number;
        evicted: { ttl: number; lru: number; bytes: number };
    }

    interface CacheFactory {
        create<V = any>(options: {
            name: string;
            maxEntries?: number;
            ttlMs?: number;
            maxBytes?: number;
            sizeOf?: (value: V, key: string) => number;
            onEvict?: (key: string, value: V, reason: string) => void | Promise<void>;
            /** 0 disables this cache's own timer. */
            sweepIntervalMs?: number;
        }): BoundedCache<V>;
        stats(): CacheStats[];
    }

    // ── outbound HTTP (SSRF guard) ───────────────────────────────────────────

    interface SafeResponse {
        status: number;
        ok: boolean;
        headers: Record<string, string>;
        arrayBuffer(): Promise<ArrayBuffer>;
        text(): Promise<string>;
        json(): Promise<any>;
    }

    /** Error carrying the RPC-visible `code` + host-free `publicMessage` contract. */
    interface UpstreamError extends Error {
        code: string;
        publicMessage: string;
        cause?: any;
        /**
         * Explicit replay verdict forwarded to the RPC client. Omit when unknown —
         * the client then falls back to its status heuristic. Set `false` for a
         * failure that cannot change on a replay (an upstream 4xx relayed through
         * our own 500, a guard verdict), otherwise the client burns its full retry
         * budget on it.
         */
        retriable?: boolean;
    }

    interface UpstreamErrorConstructor {
        new (message: string, options?: {
            code?: string;
            publicMessage?: string;
            cause?: any;
            retriable?: boolean;
        }): UpstreamError;
    }

    interface Api {
        // Config (deployer ⊕ author tiers). Never read secrets from process.env.
        getSecureRoot(ctx: any): Record<string, any>;
        getSecureModules(ctx: any): Record<string, any>;
        getSecurePlugins(ctx: any): Record<string, any>;
        getSecureModuleConfig(ctx: any, moduleId?: string): Record<string, any>;
        getSecurePluginConfig(ctx: any, pluginId?: string): Record<string, any>;
        getSecureItemConfig(ctx: any, explicitId?: string): Record<string, any>;
        getSecureValue<T = any>(ctx: any, path: string | string[], fallback?: T): T;
        requireSecureValue<T = any>(ctx: any, path: string | string[]): T;
        getProxyConfig(ctx: any, alias: string): any | null;
        getRpcAuthConfig(ctx: any, contextId?: string): any | null;
        /** Canonical operator dev flag. Do not invent per-module debug env vars. */
        isDevMode(ctx: any): boolean;

        // Identity. Never accept a principal from request input.
        resolvePrincipal(ctx: any): string;
        tryResolvePrincipal(ctx: any): string | null;
        requireRpcAuthContext(ctx: any, contextId: string): Promise<{
            contextId: string; matchedKey: string; user: any; principal: string;
        }>;
        RpcAuthContextError: ErrorConstructor;
        verifyJwtToken(token: string, jwtCfg?: Record<string, any>): any;
        normalizePrincipalUser(raw: any, meta?: Record<string, any>): any | null;

        // Server-side state. See server/STORAGE.md.
        storage: Storage;
        cache: CacheFactory;
        StorageConfigError: ErrorConstructor;
        /** Working directory under the runtime cache, for files a module owns. */
        getServerCacheDir(subdir?: string): string;

        // Outbound HTTP. `safeRequest` is TOCTOU-safe — prefer it for untrusted hosts.
        safeRequest(url: string, init?: Record<string, any>): Promise<SafeResponse>;
        safeFetch(url: string, init?: Record<string, any>): Promise<Response>;
        validateUpstreamUrl(url: string, opts?: { allowHosts?: string[]; lookup?: Function }): Promise<URL>;
        SsrfBlockedError: UpstreamErrorConstructor;
        /**
         * Classified transport failure. `code` is UPSTREAM_UNREACHABLE /
         * UPSTREAM_TIMEOUT / UPSTREAM_DNS / UPSTREAM_TLS, `publicMessage` is the
         * host-free summary the RPC layer sends in production (the full `message`,
         * which names the upstream, is dev-mode + log only), `cause` is the
         * original error, `retriable` is the optional replay verdict. All are
         * honoured on ANY thrown error.
         */
        UpstreamRequestError: UpstreamErrorConstructor;

        // Loading sibling server files.
        resolveServerFile(ctx: any, target: string): { item: any; file: string };
        importServerModule(ctx: any, target: string): Promise<any>;
        importServerExport(ctx: any, target: string, exportName?: string): Promise<any>;

        /**
         * Purge state owned by an anonymous `sess:<id>` principal when its
         * browser session dies. Installed after boot, so `register()` cannot see
         * it — subscribe lazily.
         */
        onSessionEvicted?(listener: (sessionId: string) => void): () => void;
    }
}

// Global, not a module export: server files reach this through `globalThis`
// because they may not import from core. No `export {}` here — that would make
// the file a module and take the declarations out of global scope.
declare var XOPAT_SERVER: XOpatServer.Api;
