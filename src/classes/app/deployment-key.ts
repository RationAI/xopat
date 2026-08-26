// The deployment cache key — one identity for "which deployment configuration
// is this browser state from".
//
// Two boot-time caches and the plugin-autoload cookie survive a reload, and all
// three are ORIGIN-scoped by the browser. Origins are routinely shared between
// deployments (every env file served from `localhost`), so without a key a
// session captured under one env replays under another: unresolvable data
// references, and plugins the new deployment never asked for.
//
// What the key currently scopes (deliberately narrow — see src/IO_PIPELINE.md):
//   - `xoSessionCache`      (src/parse-input.js)
//   - `__xopat_session__`   (src/app.ts + application-lifecycle-controller.ts)
//   - the `_plugins` autoload cookie (src/loader.ts + the same controller)
// It does NOT scope `kv:*` (AppCache/AppCookies/plugin caches). Those stay
// keyed by `<ownerUid>::<key>` only.
//
// Loaded from `src/store.ts` so it lands in `dist/store.js`, the FIRST app
// script on the page (`src/config.json` → `js.src.loader`). That is what lets
// `src/parse-input.js` — a plain script with no import machinery — read the key
// off `window`.

/** Deterministic JSON: object keys sorted, so two equal configs hash equal. */
function stableStringify(value: any): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort()
        .map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(",")}}`;
}

/**
 * FNV-1a — short, stable, dependency-free. Not a security primitive; this only
 * has to separate configurations, not resist collisions.
 */
function fnv1a(str: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/** Ids of a plugin/module registry that this deployment actually ships. */
function enabledIds(registry: Record<string, any> | undefined | null): string[] {
    return Object.keys(registry || {})
        .filter(id => registry![id] && (registry as any)[id].enabled !== false)
        .sort();
}

/** Storage-safe: the key ends up inside cookie names and JSON stamps. */
function sanitize(key: string): string {
    return String(key).replace(/[^A-Za-z0-9._\-]/g, "_");
}

let _cached: string | null = null;

/**
 * Resolve the deployment cache key.
 *
 * An operator pins it explicitly with `core.client.<active>.cacheKey`, which is
 * the point of the knob: a production deployment keeps one key forever and
 * never invalidates its users' caches on an unrelated config edit, while a
 * developer gives each env file its own key (or simply lets the fingerprint
 * below do it) so switching envs flushes.
 *
 * Without an explicit key the fingerprint covers exactly the configuration that
 * decides whether a cached session's data references can still RESOLVE. Themes,
 * UI flags and viewport defaults are deliberately excluded: including them would
 * throw the user's session away on every cosmetic tweak.
 *
 * @param ENV the served deployment config (`XOpatCoreConfig` — the `core` block)
 * @param PLUGINS the served plugin registry. NOT `ENV.plugins`: the browser is
 *   handed the plugin/module registries as separate arguments, so `ENV.plugins`
 *   is always `undefined` and fingerprinting it silently produced a constant.
 * @param MODULES the served module registry
 */
export function resolveDeploymentKey(
    ENV: any,
    PLUGINS?: Record<string, any>,
    MODULES?: Record<string, any>
): string {
    const env = ENV || {};
    const client = env.client || {};

    // Operator override. `sessionCacheKey` is the historical spelling, kept
    // working for deployments that already set it.
    const explicit = client.cacheKey ?? client.sessionCacheKey ?? env.setup?.sessionCacheKey;
    if (typeof explicit === "string" && explicit) return sanitize(explicit);

    return "v3-" + fnv1a(stableStringify({
        domain: client.domain || "",
        path: client.path || "",
        name: env.name || "",
        version: env.version || "",
        activeClient: env.active_client || "",
        // What SLIDE_PROTOCOLS is bootstrapped from.
        protocols: client.slide_protocols ?? null,
        defaultBackground: client.default_background_protocol || "",
        defaultVisualization: client.default_visualization_protocol || "",
        legacy: [
            client.image_group_server, client.image_group_protocol,
            client.data_group_server, client.data_group_protocol,
        ].map((x: any) => x ?? ""),
        // Factory protocols (e.g. "dicom") are registered by plugins, so a
        // session referencing one is invalid where that plugin is not part of
        // the deployment.
        plugins: enabledIds(PLUGINS),
        modules: enabledIds(MODULES),
    }));
}

/**
 * Compute the key once and remember it. Called from `initXOpat` with the
 * *served* configuration, before anything reads a persisted cache.
 */
export function initDeploymentKey(
    ENV: any,
    PLUGINS?: Record<string, any>,
    MODULES?: Record<string, any>
): string {
    _cached = resolveDeploymentKey(ENV, PLUGINS, MODULES);
    (window as any).XOPAT_DEPLOYMENT_KEY = _cached;
    return _cached;
}

/**
 * The key computed by `initDeploymentKey`. Callers on the boot path run after
 * it; the empty string means "not computed yet", which every consumer treats as
 * an unscoped (and therefore refused) entry rather than a match.
 */
export function deploymentKey(): string {
    return _cached ?? (window as any).XOPAT_DEPLOYMENT_KEY ?? "";
}

/**
 * Name of the plugin-autoload cookie for this deployment.
 *
 * The key carries the deployment, rather than the value carrying a stamp, so
 * two deployments open on one origin keep independent autoload lists instead of
 * overwriting each other's.
 */
export function pluginsCookieKey(): string {
    return `_plugins.${deploymentKey()}`;
}

/** The pre-scoping cookie name, deleted once on first boot after the upgrade. */
export const LEGACY_PLUGINS_COOKIE = "_plugins";

(window as any).XOpatDeploymentKey = {
    resolve: resolveDeploymentKey,
    init: initDeploymentKey,
    get: deploymentKey,
    pluginsCookieKey,
};
