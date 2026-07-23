/**
 * URL-keyed in-flight/done cache for scripting `.d.ts` declaration fetches.
 *
 * Two namespaces may share one physical declaration file (annotations read +
 * write both point at common-types.d.ts) — the cache collapses those into a
 * single request. A `?v=<app version>` cache-buster is appended so the static
 * server can respond with long-lived immutable cache headers instead of
 * `no-store` (it only does so for versioned URLs).
 */
const _dtsFetchCache = new Map<string, Promise<string>>();

export function fetchDtsCached(url: string): Promise<string> {
    const cached = _dtsFetchCache.get(url);
    if (cached) return cached;

    // Production bake: the server inlines convention-located declaration files
    // into the page as `window.XOPAT_BAKED_DTS` keyed by app-relative path (see
    // server/node/index.js getBakedDtsRegistry + the PHP mirror in init.php).
    // A hit costs zero requests; a miss falls through to the cached fetch.
    const baked = (globalThis as any).XOPAT_BAKED_DTS;
    if (baked) {
        const base = (globalThis as any).APPLICATION_CONTEXT?.url || "";
        const key = base && url.startsWith(base) ? url.slice(base.length) : url;
        if (typeof baked[key] === "string") {
            const resolved = Promise.resolve(baked[key] as string);
            _dtsFetchCache.set(url, resolved);
            return resolved;
        }
    }

    const version = (globalThis as any).APPLICATION_CONTEXT?.env?.version;
    const target = version && !url.includes("?")
        ? `${url}?v=${encodeURIComponent(String(version))}`
        : url;

    const promise = fetch(target, { credentials: "same-origin" }).then(response => {
        if (!response.ok) {
            throw new Error(`Failed to load dtypes from '${url}'.`);
        }
        return response.text();
    }).catch(e => {
        _dtsFetchCache.delete(url);
        throw e;
    });
    _dtsFetchCache.set(url, promise);
    return promise;
}
