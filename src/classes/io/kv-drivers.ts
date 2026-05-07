// Built-in KV drivers — registered by createIOPipeline.
// Each driver mirrors the localStorage interface; the pipeline wraps them
// in a KV handle that handles key prefixing, sanitization, and mirror writes.

/** Wrap any `Storage`-shaped object (e.g. window.localStorage) as a KV driver. */
export function makeStorageDriver(opts: {
    id: string;
    label?: string;
    storage: Storage;
    shared?: boolean;
}): IOKVDriver {
    const s = opts.storage;
    return {
        id: opts.id,
        label: opts.label,
        mode: "sync",
        shared: opts.shared ?? true,
        getItem: (k) => s.getItem(k),
        setItem: (k, v) => { s.setItem(k, v); },
        removeItem: (k) => { s.removeItem(k); },
        key: (i) => s.key(i),
        get length() { return s.length; },
        clear: () => { s.clear(); },
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
 * Cookie-backed driver. Adapter over the existing `js-cookie` library
 * (or whatever the host provides at `window.Cookies`); falls back to a
 * memory driver if `Cookies` is unavailable.
 *
 * Replaces the legacy anonymous class previously registered via
 * `XOpatStorage.Cookies.registerClass(...)` in `src/app.ts`.
 */
export function makeCookiesDriver(id = "cookies"): IOKVDriver {
    const Cookies: any = (globalThis as any).Cookies;
    if (!Cookies) {
        console.warn("[IO] js-cookie unavailable; cookies KV driver falls back to memory.");
        const m = makeMemoryDriver(id);
        m.label = "Cookies (fallback: memory)";
        return m;
    }
    let setOptions: any = {};
    return {
        id,
        label: "Browser cookies",
        mode: "sync",
        shared: true,
        getItem: (k) => {
            const v = Cookies.get(k);
            return v === undefined ? null : v;
        },
        setItem: (k, v) => { Cookies.set(k, v, setOptions); setOptions = {}; },
        removeItem: (k) => { Cookies.remove(k); },
        key: (i) => Object.keys(Cookies.get() || {})[i] ?? null,
        get length() { return Object.keys(Cookies.get() || {}).length; },
        clear: () => {
            const all = Cookies.get() || {};
            for (const k of Object.keys(all)) Cookies.remove(k);
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
