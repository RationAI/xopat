// Built-in KV drivers — registered by createIOPipeline.
// Each driver mirrors the localStorage interface; the pipeline wraps them
// in a KV handle that handles key prefixing, sanitization, and mirror writes.

/**
 * Build the guard used by the browser-backed drivers.
 *
 * Availability is probed once at registration (`createIOPipeline`), but a
 * `Storage` can also fail LATER: `QuotaExceededError` on a full disk, Safari
 * ITP eviction, a storage-partitioning policy that flips mid-session. On the
 * first throw the driver swaps its own backing store to an in-memory `Map`
 * and keeps serving.
 *
 * The swap happens INSIDE the driver object on purpose. `IOPipeline.kv()`
 * resolves driver ids to concrete objects and the handle keeps that array
 * (`io-kv-handle.ts`), and `AppCache`/`AppCookies` memoize their handle
 * forever — re-registering a replacement under the same id would not reach
 * any of them. Preserving object identity is what makes degradation visible
 * everywhere at once.
 */
function makeDegradableBacking(id: string, onDegrade?: (id: string, e: unknown) => void) {
    let mem: Map<string, string> | null = null;
    const degrade = (e: unknown) => {
        if (mem) return;    // already degraded — report once
        mem = new Map();
        console.warn(`[IO] kv driver "${id}" failed; switching to in-memory for this session.`, e);
        onDegrade?.(id, e);
    };
    return {
        get degraded() { return mem !== null; },
        get mem() { return mem!; },
        /** Run `fn` against the real backend; on throw, degrade and use `fallback`. */
        guard<T>(fn: () => T, fallback: () => T): T {
            if (mem) return fallback();
            try {
                return fn();
            } catch (e) {
                degrade(e);
                return fallback();
            }
        },
    };
}

/** Wrap any `Storage`-shaped object (e.g. window.localStorage) as a KV driver. */
export function makeStorageDriver(opts: {
    id: string;
    label?: string;
    storage: Storage;
    shared?: boolean;
    /** Notified once, the first time the backing store throws. */
    onDegrade?: (id: string, error: unknown) => void;
}): IOKVDriver {
    const s = opts.storage;
    const b = makeDegradableBacking(opts.id, opts.onDegrade);
    return {
        id: opts.id,
        get label() { return b.degraded ? `${opts.label ?? opts.id} (degraded — in-memory)` : opts.label; },
        mode: "sync",
        shared: opts.shared ?? true,
        getItem: (k) => b.guard(() => s.getItem(k), () => b.mem.get(k) ?? null),
        setItem: (k, v) => { b.guard(() => { s.setItem(k, v); }, () => { b.mem.set(k, v); }); },
        removeItem: (k) => { b.guard(() => { s.removeItem(k); }, () => { b.mem.delete(k); }); },
        key: (i) => b.guard(() => s.key(i), () => Array.from(b.mem.keys())[i] ?? null),
        get length() { return b.guard(() => s.length, () => b.mem.size); },
        clear: () => { b.guard(() => { s.clear(); }, () => { b.mem.clear(); }); },
    };
}

/** In-memory fallback driver. Useful when localStorage is unavailable
 *  (private mode, embedded contexts) or when an admin wants to opt out
 *  of any persistence (e.g. `core.kv:cache = ["memory"]`). */
export function makeMemoryDriver(id = "memory"): IOKVDriver {
    const map = new Map<string, string>();
    return {
        id,
        label: "In-memory",
        mode: "sync",
        shared: true,
        getItem: (k) => (map.has(k) ? map.get(k)! : null),
        setItem: (k, v) => { map.set(k, v); },
        removeItem: (k) => { map.delete(k); },
        key: (i) => Array.from(map.keys())[i] ?? null,
        get length() { return map.size; },
        clear: () => { map.clear(); },
    };
}

/**
 * In-memory stand-in for the cookies driver, keeping the `cookies` id and the
 * builder-pattern `with()` so `CookiesFacade.with()` (`src/store.ts`) stays a
 * harmless no-op instead of silently changing shape.
 */
function makeCookiesMemoryFallback(id: string, label: string): IOKVDriver {
    const m = makeMemoryDriver(id);
    m.label = label;
    (m as any).with = function (_o: any) { return this; };
    return m;
}

/**
 * Cookie attributes, as supplied by the deployment (`ENV.client.js_cookie_*`).
 * Same shape js-cookie's `withAttributes` took, so deployment configs and
 * `CookiesFacade.with(...)` call sites are unchanged.
 */
export interface CookieAttributes {
    /** Lifetime in days, or an explicit expiry date. */
    expires?: number | Date | null;
    path?: string | null;
    domain?: string | null;
    secure?: boolean | null;
    sameSite?: string | null;
}

/**
 * `document.cookie` access, replacing the vendored js-cookie 3.0.1.
 *
 * The encoding is deliberately js-cookie's, not a naive
 * `encodeURIComponent`: cookies written by a previous xOpat version must stay
 * readable, so the same RFC-6265-permitted characters are decoded back after
 * escaping. Everything here is called through `makeDegradableBacking().guard`
 * — in a sandboxed iframe with an opaque origin the property access itself
 * throws `SecurityError` (see `src/IO_PIPELINE.md` → "Sandboxed /
 * opaque-origin operation").
 */
const cookieCodec = {
    writeValue: (v: string) => encodeURIComponent(String(v))
        .replace(/%(2[346BF]|3[AC-F]|40|5[BDE]|60|7[BCD])/g, decodeURIComponent),
    writeName: (n: string) => encodeURIComponent(String(n))
        .replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent)
        .replace(/[()]/g, escape),
    read: (s: string) => s.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent),
};

function serializeAttributes(attrs: CookieAttributes): string {
    let out = "";
    let expires = attrs.expires;
    if (typeof expires === "number") {
        expires = new Date(Date.now() + expires * 864e5);
    }
    if (expires instanceof Date) out += "; expires=" + expires.toUTCString();
    if (attrs.path) out += "; path=" + attrs.path;
    if (attrs.domain) out += "; domain=" + attrs.domain;
    // A bare `; secure` flag — a value would be ignored by the browser.
    if (attrs.secure) out += "; secure";
    if (attrs.sameSite) out += "; samesite=" + attrs.sameSite;
    return out;
}

/** Every cookie visible to this document, decoded. */
function readAllCookies(): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = document.cookie ? document.cookie.split("; ") : [];
    for (const part of raw) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const name = part.slice(0, eq);
        let value = part.slice(eq + 1);
        // js-cookie strips the quoting some servers add around values.
        if (value[0] === '"') value = value.slice(1, -1);
        try {
            out[cookieCodec.read(name)] = cookieCodec.read(value);
        } catch {
            // A malformed percent-escape from a foreign writer must not take
            // out every other cookie — skip just that entry.
        }
    }
    return out;
}

function writeCookie(name: string, value: string, attrs: CookieAttributes): void {
    document.cookie = cookieCodec.writeName(name) + "=" + cookieCodec.writeValue(value)
        + serializeAttributes(attrs);
}

/**
 * Cookie-backed driver over `document.cookie`; falls back to an in-memory
 * store when the browser refuses cookies (third-party context, or a
 * sandboxed iframe with an opaque origin, where the access throws
 * `SecurityError`).
 *
 * Replaces the legacy anonymous class previously registered via
 * `XOpatStorage.Cookies.registerClass(...)` in `src/app.ts`.
 *
 * `defaults` are the deployment's `ENV.client.js_cookie_*` policy; the
 * builder-pattern `with(o)` overlays one-shot attributes for the next write,
 * which is what `CookiesFacade.with()` in `src/store.ts` relies on.
 */
export function makeCookiesDriver(id = "cookies", defaults: CookieAttributes = {}): IOKVDriver {
    const Cookies = {
        get: (k?: string) => (k === undefined ? readAllCookies() : readAllCookies()[k]),
        set: (k: string, v: string, o: CookieAttributes) => writeCookie(k, v, { ...defaults, ...o }),
        // Expiring in the past is the only way to delete a cookie, and the
        // path/domain must match the write or the browser keeps the original.
        remove: (k: string) => writeCookie(k, "", { ...defaults, expires: -1 }),
    };
    if (!XOpatStorageAvailability.cookies) {
        // Probed, not assumed: `document.cookie` throws in an opaque origin and
        // silently drops writes in a blocked third-party context.
        return makeCookiesMemoryFallback(id, "Browser cookies (unavailable — in-memory)");
    }
    let setOptions: any = {};
    const b = makeDegradableBacking(id);
    const allCookies = (): Record<string, string> => b.guard(
        () => Cookies.get() || {},
        () => Object.fromEntries(b.mem.entries()));
    return {
        id,
        get label() { return b.degraded ? "Browser cookies (degraded — in-memory)" : "Browser cookies"; },
        mode: "sync",
        shared: true,
        getItem: (k) => b.guard(
            () => { const v = Cookies.get(k); return v === undefined ? null : v; },
            () => b.mem.get(k) ?? null),
        setItem: (k, v) => {
            b.guard(() => { Cookies.set(k, v, setOptions); }, () => { b.mem.set(k, v); });
            setOptions = {};
        },
        removeItem: (k) => { b.guard(() => { Cookies.remove(k); }, () => { b.mem.delete(k); }); },
        key: (i) => Object.keys(allCookies())[i] ?? null,
        get length() { return Object.keys(allCookies()).length; },
        clear: () => {
            const all = allCookies();
            for (const k of Object.keys(all)) {
                b.guard(() => { Cookies.remove(k); }, () => { b.mem.delete(k); });
            }
        },
        // Builder-pattern attach — preserves the legacy `xoCookieStorage.with(opts)` semantics.
        // Callers using the kv handle don't see this; the legacy CookieStorage façade does.
        ...({
            with(o: any) { setOptions = o; return this; },
        } as any),
    };
}

function splitKey(k: string): { owner: string; real: string } {
    const idx = k.indexOf("::");
    if (idx < 0) return { owner: k, real: "" };
    return { owner: k.slice(0, idx), real: k.slice(idx + 2) };
}

/** Reuse the Phase-1 `post-data` sink's POST_DATA-backed storage as
 *  an async KV driver (for `kv:data`). */
export function makePostDataKVDriver(POST_DATA: Record<string, any>): IOKVDriver {
    return {
        id: "post-data",
        label: "Session export (POST_DATA)",
        mode: "async",
        shared: true,
        async getItem(k: string) {
            // The shared bucket layout used by the post-data sink is
            // POST_DATA[ownerId][key]; with `shared:true` the pipeline
            // already prefixes the user key with `<ownerUid>::<sanitized>`.
            // We split that prefix back out for storage.
            const { owner, real } = splitKey(k);
            const bucket = POST_DATA[owner];
            if (!bucket || typeof bucket !== "object") return null;
            const v = bucket[real];
            return v === undefined ? null : v;
        },
        async setItem(k: string, v: string) {
            const { owner, real } = splitKey(k);
            let bucket = POST_DATA[owner];
            if (!bucket || typeof bucket !== "object") bucket = POST_DATA[owner] = {};
            bucket[real] = v;
        },
        async removeItem(k: string) {
            const { owner, real } = splitKey(k);
            const bucket = POST_DATA[owner];
            if (bucket) delete bucket[real];
        },
        async key() { return null; },     // listing not used through this façade
        get length() { return 0; },
        async clear() { /* no-op (per-owner clear handled via SyncKVHandle/AsyncKVHandle) */ },
    };
}
