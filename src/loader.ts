import type { XOpatCoreConfig, XOpatElementRecord } from "./types/config";
import { XOpatStorage } from "./store";
import type { OpenEvent, ViewerEventMap } from "openseadragon";

import { HTTPError, createHttpClientAdapter } from "./classes/http-client";
import { BackgroundConfig } from "./classes/background-config";
import { parseVersion, satisfies } from "./classes/app/semver";
import { ViewerShaderSourceController } from "./classes/app/viewer-shader-source-controller";
import { ViewerFaultySourceRegistry } from "./classes/app/viewer-faulty-source-registry";
import { ViewerDepthController } from "./classes/app/viewer-depth-controller";
import { ViewerJoystickController } from "./classes/app/viewer-joystick-controller";
import { CanvasContextMenu } from "./classes/app/canvas-context-menu";
import { installEventIsolation, withHandlerOwner, removeHandlersOwnedBy } from "./classes/app/event-isolation";
import { serializeScene, mergeViewerLiveIntoConfig, snapshotViewport } from "./classes/app/canonical-scene";
import type { IOPipeline } from "./classes/io";
import { IOResourceImpl } from "./classes/io";


/** Token symbol for per-element synchronous cache. */
const CACHE_TOKEN = Symbol("XOpatElementCacheStore");
/** Token symbol for per-element synchronous cookies façade (lazy). */
const COOKIES_TOKEN = Symbol("XOpatElementCookiesStore");
/** Token symbol for per-element async data façade (lazy). */
const DATA_TOKEN = Symbol("XOpatElementDataStore");
/** Symbol where each element keeps the disposer that removes it from IO_PIPELINE on destroy. */
const IO_DISPOSE_TOKEN = Symbol("XOpatElementIODisposer");
/** Symbol where each element keeps the disposer that removes its declared rights-capabilities + guards. */
const RIGHTS_DISPOSE_TOKEN = Symbol("XOpatElementRightsDisposer");
/** Per-viewer scratch map keyed by element uid (used by getViewerContext). */
const STORE_TOKEN = Symbol("XOpatViewerScratchStore");

/**
 * Walk an owner's include.json metadata, declare every rights-capability it
 * exposes (explicit + IO-derived), and register the IO guards that enforce
 * IO-derived ones. Returns a single disposer.
 *
 * - `meta.capabilities[]` (top-level)  → explicit, declared verbatim.
 * - `meta.io.capabilities[]`           → auto-derived per the rules in
 *   `src/USER_ROLES.md` §2b. Guards are mounted on `IO_PIPELINE` for each
 *   `pre-create` / `pre-update` / `pre-delete` direction of every CRUD cap,
 *   and on bundle export/import via the same registerGuard façade
 *   (the pipeline forwards those through the same dispatch).
 *
 * Skips silently when:
 * - `meta` is missing (owner registered without include.json metadata),
 * - `meta.capabilities` / `meta.io.capabilities` are absent / not arrays.
 *
 * Defensive: every `XOpatUser.declareCapability` call is independent — a single
 * malformed entry will not block the others.
 */
function registerOwnerRights(ownerId: string, meta: any): () => void {
    if (!meta) return () => undefined;
    const guards: Array<() => void> = [];
    const pipeline: any = (window as any).IO_PIPELINE;

    const declare = (cap: { id: string; default: "allow" | "deny"; label?: string; description?: string }) => {
        (window as any).XOpatUser.declareCapability({ ...cap, declaredBy: ownerId });
    };

    // 1. Explicit capabilities (top-level `capabilities` array)
    const explicit = Array.isArray(meta.capabilities) ? meta.capabilities : [];
    for (const cap of explicit) {
        if (!cap || typeof cap.id !== "string") continue;
        const dflt: "allow" | "deny" = cap.default === "deny" ? "deny" : "allow";
        declare({ id: cap.id, default: dflt, label: cap.label, description: cap.description });
    }

    // 2. IO-derived capabilities (from `io.capabilities[]`)
    const ioBlock = meta.io;
    const ioCaps: any[] = ioBlock && typeof ioBlock === "object" && Array.isArray(ioBlock.capabilities)
        ? ioBlock.capabilities : [];

    for (const rawCap of ioCaps) {
        // Normalize: `io.capabilities` accepts strings (just an id) per IOIncludeBlock.
        const cap = typeof rawCap === "string" ? { id: rawCap } : rawCap;
        if (!cap || typeof cap.id !== "string") continue;

        // Rights opt-out
        if (cap.rights === false) continue;

        const rightsOpts = (cap.rights && typeof cap.rights === "object") ? cap.rights : {};
        const dflt: "allow" | "deny" = rightsOpts.default === "deny" ? "deny" : "allow";
        const baseLabel = rightsOpts.label ?? cap.label;

        // Infer kind: explicit, else infer from id prefix.
        let kind: "bundle" | "crud" | "kv" = cap.kind;
        if (!kind) {
            if (cap.id.startsWith("crud:")) kind = "crud";
            else if (cap.id.startsWith("kv:")) kind = "kv";
            else if (cap.id === "bundle-export" || cap.id === "bundle-import") kind = "bundle";
            else continue; // unknown shape — skip silently
        }

        if (kind === "kv") continue; // kv is transparent infra; never auto-gated

        if (kind === "bundle") {
            const rightsCapId = `${ownerId}.${cap.id}`; // e.g. annotations.bundle-export
            declare({ id: rightsCapId, default: dflt, label: baseLabel });
            // Bundle guard: refuse pre-{export,import} via the same IO guard façade.
            // The pipeline only models pre-* for CRUD currently; bundle gating uses
            // the runtime check inside the dispatch path via XOpatUser.can — sinks
            // can also consult it. For now the declared capability is sufficient
            // surface for the owner's own exportBundle to query
            // `XOpatUser.instance().can('<ownerId>.bundle-*')` if it wants.
            continue;
        }

        // CRUD
        // For `crud:annotation` the resource name is everything after the colon.
        const colonIdx = cap.id.indexOf(":");
        const resourceName = colonIdx >= 0 ? cap.id.slice(colonIdx + 1) : cap.id;

        const directions: Array<"create" | "read" | "update" | "delete"> =
            Array.isArray(rightsOpts.directions) && rightsOpts.directions.length
                ? rightsOpts.directions.filter((d: any) => d === "create" || d === "read" || d === "update" || d === "delete")
                : ["create", "read", "update", "delete"];

        for (const dir of directions) {
            const rightsCapId = `${ownerId}.${cap.id}.${dir}`;
            declare({ id: rightsCapId, default: dflt, label: baseLabel });

            // Read has no pre-* phase in the pipeline today; just the declaration.
            if (dir === "read") continue;

            // Register a guard that refuses when the user lacks this capability.
            // Priority intentionally high (10_000) so the role check short-circuits
            // BEFORE domain validation runs — denied users don't see misleading
            // "validation failed" messages when the real reason is permission.
            if (pipeline && typeof pipeline.registerGuard === "function") {
                const dispose = pipeline.registerGuard({
                    ownerId: `rights:${ownerId}`,
                    resource: resourceName,
                    direction: `pre-${dir}`,
                    priority: 10_000,
                    label: `rights-gate:${rightsCapId}`,
                    handler: (_ctx: any) => {
                        const user = (window as any).XOpatUser?.instance?.();
                        if (!user) return { ok: true };
                        if (user.can(rightsCapId)) return { ok: true };
                        return {
                            ok: false,
                            refused: true,
                            reason: `rights: capability "${rightsCapId}" denied for current roles [${user.currentRoles().join(", ") || "—"}]`,
                            userMessage: $.t?.("user.roles.refused", { capability: rightsCapId }) || "You do not have permission to perform this action.",
                            code: "W_PERM_DENIED",
                        };
                    },
                });
                if (typeof dispose === "function") guards.push(dispose);
            }
        }
    }

    return () => {
        for (const d of guards) {
            try { d(); } catch (e) { console.error(e); }
        }
        (window as any).XOpatUser?.undeclareCapabilities?.(ownerId);
    };
}

export class XOpatServerCallError extends Error {
    code?: string;
    status?: number;
    details?: any;
    cause?: any;

    constructor(message: string, init?: Partial<XOpatServerCallError>) {
        super(message);
        this.name = "XOpatServerCallError";
        if (init) Object.assign(this, init);
    }
}

/**
 * Initialize the xOpat loading system. This sets up the runtime environment for
 * loading modules and plugins and returns an initializer you call when the host
 * application (e.g., the viewer) is ready.
 *
 * Notes:
 * - Do not call this inside the viewer; use it if you want to reuse plugins/modules elsewhere.
 * - Example usage:
 * const initPlugins = initXOpatLoader(ENV, PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, VERSION, true);
 * await initPlugins();
 */
export function initXOpatLoader(ENV: XOpatCoreConfig, PLUGINS: Record<string, XOpatElementRecord>, MODULES: Record<string, XOpatElementRecord>, PLUGINS_FOLDER: string, MODULES_FOLDER: string, POST_DATA: Record<string, any>, version: string): () => Promise<void> {
    if (window.XOpatPlugin) throw "XOpatLoader already initialized!";

    //dummy translation function in case of no translation available
    $.t = $.t || ((x: any) => String(x).split(".").findLast(Boolean));


    let REGISTERED_ELEMENTS: IXOpatElement[] = [];
    let REGISTERED_PLUGINS: IXOpatPlugin[] | undefined = [];
    let LOADING_PLUGIN = false;
    const REQUIRED_SINGLETONS = new Set<any>();

    // The IO pipeline is now bootstrapped earlier (in src/app.ts, via
    // bootstrapIOPipeline) so that AppCache/AppCookies are functional from the
    // first `getOption()` call. The loader just consumes the global. Plugins
    // and modules still register capabilities and bundle hooks via
    // `this.initIO(...)` / `this.defineResource(...)`; administrators bind
    // capabilities to sinks in `ENV.client.io` (server-injected, NOT
    // URL-modifiable). See src/IO_PIPELINE.md.
    const IO_PIPELINE: IOPipeline = (window as any).IO_PIPELINE;
    if (!IO_PIPELINE) {
        throw "XOpatLoader: IO_PIPELINE was not bootstrapped before initXOpatLoader. Call bootstrapIOPipeline(ENV, POST_DATA) first.";
    }

    // Seed the roles & capabilities subsystem with deployment env before any
    // plugin/module mounts. After this call, capability declarations made by
    // `XOpatElement` constructors are resolved against this role catalog, and
    // the deployment default is applied to the user singleton at construction.
    // See src/USER_ROLES.md.
    (window as any).XOpatUser?.configureRoles?.((ENV as any)?.core?.roles);

    function pluginsWereInitialized() {
        return REGISTERED_PLUGINS === undefined;
    }

    let _versionCheckWarned = false;

    /**
     * Verify an element's `engines.xopat` range against the running app version.
     * The check is skipped - not failed - when the deployment does not report a
     * usable version, since refusing on an unknowable version would break
     * development builds that legitimately ship `version: null`.
     * @return a human readable reason when the element must not load, else null
     */
    function incompatibilityReason(record: XOpatElementRecord | undefined): string | null {
        const range = record?.engines?.xopat;
        if (!range) return null;

        const version = APPLICATION_CONTEXT.env?.version;
        if (!parseVersion(version)) {
            if (!_versionCheckWarned) {
                _versionCheckWarned = true;
                console.warn(`Deployment reports no usable version ('${version}'): 'engines' declarations are ignored.`);
            }
            return null;
        }
        // plain text: the reason is rendered both as a DOM text node (plugin list)
        // and through an escaping HTML sink (showPluginError)
        return satisfies(version!, range) ? null
            : $.t('messages.incompatibleVersion', { range, version, interpolation: { escapeValue: false } });
    }

    /**
     * Why a plugin or module cannot run in this deployment, if it cannot: for UI
     * that lists elements it does not load itself.
     * @param kind "plugins" or "modules"
     * @param id element id
     * @return human readable reason, or null when the element is compatible
     */
    (window as any).elementIncompatibility = function (kind: "plugins" | "modules", id: string) {
        const record = kind === "plugins" ? PLUGINS[id] : MODULES[id];
        return incompatibilityReason(record) || (kind === "plugins" ? moduleChainIncompatibility(record?.modules) : null);
    };

    /**
     * Walk a module dependency closure and report the first module that cannot run
     * against this app version, so a plugin refuses up front instead of dying later
     * on a missing singleton.
     */
    function moduleChainIncompatibility(moduleList: string[] | undefined, seen = new Set<string>()): string | null {
        for (const moduleId of moduleList || []) {
            if (seen.has(moduleId)) continue;
            seen.add(moduleId);

            const record = MODULES[moduleId];
            const reason = incompatibilityReason(record);
            if (reason) return $.t('messages.moduleIncompatibleNamed', { module: record?.name || moduleId, reason });
            const deep = moduleChainIncompatibility(record?.requires, seen);
            if (deep) return deep;
        }
        return null;
    }

    function setPluginLoadStatus(id: string, status: "idle" | "loading" | "loaded" | "failed") {
        const buttonContainer = $(`#load-plugin-${id}`);
        if (!buttonContainer.length) return;

        if (status === "idle") {
            buttonContainer.html(`<button class="btn btn-sm" onclick="UTILITIES.loadPlugin('${id}'); return false;">${$.t('common.Load')}</button>`);
            return;
        }

        if (status === "loading") {
            buttonContainer.html(
                `<button disabled class="btn btn-sm">` +
                `<span class="loading loading-spinner loading-xs"></span>${$.t('common.Loading')}` +
                `</button>`
            );
            return;
        }

        if (status === "loaded") {
            buttonContainer.html(`<button disabled class="btn btn-sm">${$.t('common.Loaded')}</button>`);
            return;
        }

        buttonContainer.html(`<button disabled class="btn btn-sm">${$.t('common.Failed')}</button>`);
    }

    /** Escape text destined for an HTML sink. Error texts come from plugin code and server records. */
    function escapeHtml(value: unknown) {
        return String(value).replace(/[&<>"']/g, char =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
    }

    const showPluginError = (window as any).showPluginError = function (id: string, e: unknown, loaded: boolean | undefined = undefined) {
        // todo should access vanjs component instead
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            setPluginLoadStatus(id, loaded ? "loaded" : "idle");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">${$.t('messages.pluginRemoved')}<br><code>[${escapeHtml(e)}]</code></div>`);
        setPluginLoadStatus(id, "failed");
    }

    function cleanUpScripts(id: string) {
        $(`#script-section-${id}`).remove();
        LOADING_PLUGIN = false;
    }

    function cleanUpPlugin(id: string, e: any = $.t('error.unknown')) {
        if (PLUGINS[id]) {
            delete PLUGINS[id].instance;
            PLUGINS[id].loaded = false;
            PLUGINS[id].error = e;
        }

        // A dead plugin left wired keeps firing on events it can no longer service.
        removeHandlersOwnedBy(id);
        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
    }

    /**
     * Module counterpart of `cleanUpPlugin`: quarantine a module whose construction
     * threw. Without this the singleton stays registered while half-built, its
     * handlers keep running against missing state, and every later `instance()`
     * silently hands out the broken object.
     */
    function cleanUpModule(id: string, e: any = $.t('error.unknown')) {
        const modRef = MODULES[id];
        if (modRef) {
            delete modRef.instance;
            modRef.loaded = false;
            modRef.error = e;
        }

        const ModuleClass = ((window as any).xmodules || {})[id];
        if (ModuleClass) {
            ModuleClass.__failed = e;
            // The singleton constructor assigns `__self` before its body finishes, so a
            // throw halfway leaves a half-built instance cached. Drop it.
            ModuleClass.__self = undefined;
        }

        removeHandlersOwnedBy(id);

        /**
         * @property {string} id module id
         * @property {string} message
         * @memberof VIEWER_MANAGER
         * @event module-failed
         */
        VIEWER_MANAGER.raiseEvent('module-failed', {
            id: id,
            message: $.t('error.moduleFailed', { module: MODULES[id]?.name || id }),
        } as ModuleFailedEvent);
    }

    function instantiatePlugin(id: string, PluginClass: XOpatPluginClass) {
        if (!id) {
            console.error("Plugin registered with no id defined!", id);
            return;
        }
        if (!PLUGINS[id]) {
            console.error("Plugin registered with invalid id: no such id present in 'include.json'.", id);
            return;
        }

        // Also guards plugins whose scripts the server already shipped (permaLoad):
        // by refusing construction, incompatible code never wires itself in.
        const incompatible = incompatibilityReason(PLUGINS[id]);
        if (incompatible) {
            console.warn(`Plugin ${id} refused:`, incompatible);
            VIEWER_MANAGER.raiseEvent('plugin-failed', {
                id: id,
                message: $.t('messages.pluginLoadFailedNamed', { plugin: PLUGINS[id].name || id }),
            } as PluginFailedEvent);
            cleanUpPlugin(id, incompatible);
            return;
        }

        let plugin;
        try {
            if (!APPLICATION_CONTEXT.config.plugins[id]) {
                APPLICATION_CONTEXT.config.plugins[id] = {};
            }
            plugin = withHandlerOwner(id, () => new PluginClass(id));
        } catch (e) {
            console.warn(`Failed to instantiate plugin ${PluginClass}.`, e);
            /**
             * @property {string} id plugin id
             * @property {string} message
             * @memberof VIEWER_MANAGER
             * @event plugin-failed
             */
            VIEWER_MANAGER.raiseEvent('plugin-failed', {
                id: id,
                message: $.t('messages.pluginLoadFailedNamed', { plugin: id }),
            } as PluginFailedEvent);
            cleanUpPlugin(id, e);
            return;
        }

        plugin.__id = id; //silently set even if user did not properly set it

        let possiblyExisting = PLUGINS[id].instance;
        if (possiblyExisting) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, possiblyExisting);
            /**
             * @property id plugin id
             * @property message
             * @memberof VIEWER_MANAGER
             * @event plugin-failed
             */
            VIEWER_MANAGER.raiseEvent('plugin-failed', {
                id: plugin.id,
                message: $.t('messages.pluginLoadFailedNamed', { plugin: PLUGINS[id].name }),
            } as PluginFailedEvent);
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS[id].instance = plugin;
        PLUGINS[id].__ready = false;
        //clean up possible errors
        showPluginError(id, null);
        return plugin;
    }

    async function initializePlugin(plugin: IXOpatPlugin, outsideLoad: boolean = true) {
        if (!plugin) {
            console.warn("Attempt to initialize undefined plugin.");
            return false;
        }

        try {
            if (typeof plugin.pluginReady === "function") {
                // Note: only handlers registered synchronously by pluginReady are
                // attributed — anything wired from an awaited continuation lands
                // outside the owner scope and falls back to stack-based guessing.
                await withHandlerOwner(plugin.id, () => plugin.pluginReady!());
            }
            PLUGINS[plugin.id]!.__ready = true;

            // Note: dynamically loaded plugins no longer need an extra
            // `forceDataImportInitialization` here — their own `initIO`
            // catch-up (post-boot) iterates open viewers for per-viewer
            // bundles. Calling forceDataImportInitialization again would
            // double-fire `importBundle` for every previously-restored
            // owner.

            /**
             * Plugin was loaded dynamically at runtime.
             * @memberof VIEWER_MANAGER
             * @event plugin-loaded
             */
            VIEWER_MANAGER.raiseEvent('plugin-loaded', { id: plugin.id, plugin: plugin, isInitialLoad: REGISTERED_PLUGINS !== undefined });
            return true;
        } catch (e) {
            /**
             * @property {string} id plugin id
             * @property {string} message
             * @memberof VIEWER_MANAGER
             * @event plugin-failed
             */
            VIEWER_MANAGER.raiseEvent('plugin-failed', {
                id: plugin.id,
                message: $.t('messages.pluginLoadFailedNamed', { plugin: PLUGINS[plugin.id]?.name }),
            } as PluginFailedEvent);
            console.warn(`Failed to initialize plugin ${plugin.id}.`, e);
            cleanUpPlugin(plugin.id, e);
            return false;
        }
    }

    interface ScriptProperties extends Record<string, any> {
        src: string;
        async?: boolean;
        type?: string;
        defer?: boolean;
        crossOrigin?: string;
        integrity?: string;
        referrerPolicy?: string;
    }

    /**
     * Load a script at runtime. Plugin is REMOVED from the viewer
     * if the script is faulty
     * @global
     */
    const attachScript = (window as any).attachScript = function (
        pluginId: string,
        properties: ScriptProperties,
        onload: () => void
    ): boolean {
        let errHandler = function (e: any) {
            window.onerror = null;
            // LOADING_PLUGIN is captured from the loader closure
            if (LOADING_PLUGIN) {
                cleanUpPlugin(pluginId, e);
            } else {
                cleanUpScripts(pluginId);
            }
        };

        if (!properties.hasOwnProperty('src')) {
            errHandler($.t('messages.pluginScriptSrcMissing'));
            return false; // Return false to match original logical flow on failure
        }

        let container = document.getElementById(`script-section-${pluginId}`);
        if (!container) {
            container = document.createElement("div");
            container.id = "script-section-" + pluginId;
            document.body.append(container);
        }

        let script = document.createElement("script") as HTMLScriptElement;
        for (let key in properties) {
            if (key === 'src') continue;
            script[key] = properties[key];
        }

        script.async = false;
        script.onload = function () {
            window.onerror = null;
            onload && onload();
        };

        script.onerror = errHandler;
        window.onerror = errHandler;
        script.src = properties.src;

        container.append(script);
        return true;
    };

    /**
     * Get plugin.
     * @global
     */
    const plugin = (window as any).plugin = function (id: string) {
        return PLUGINS[id]?.instance;
    };

    /**
     * Presentation metadata any code may read about a plugin. Everything else in
     * the include.json record is either internal wiring or deployment config.
     */
    const PUBLIC_META_KEYS = ["name", "description", "longDescription", "author", "version", "icon",
        "stability", "categories", "keywords", "homepage", "repository", "bugs", "docsUrl", "license", "engines"];

    /** Meta values that may carry a `%key%` translation reference. */
    const LOCALIZABLE_META_KEYS = ["name", "description", "longDescription"];

    /**
     * Resolve a `"%key%"` meta value against the element's own i18next namespace
     * (its id, see `_getLocale`). Plain strings pass through untouched.
     *
     * `$.t` never fails — a missing key comes back as the key's last segment —
     * so `exists` decides, and an unresolved reference degrades to the raw
     * include.json value rather than to a misleading word.
     */
    function resolveMetaText(id: string, value: any) {
        const key = typeof value === "string" && value.length > 2 && value.startsWith("%") && value.endsWith("%")
            ? value.slice(1, -1) : undefined;
        if (!key) return value;
        return $.i18n?.exists(key, {ns: id}) ? $.t(key, {ns: id}) : value;
    }

    /**
     * Get one of allowed plugin meta keys. Localizable keys are resolved against
     * the plugin's locale bundle - call `loadElementLocale` first if the plugin
     * is not loaded yet, otherwise the raw `%key%` reference is returned.
     */
    const pluginMeta = (window as any).pluginMeta = function (id: string, metaKey: string) {
        if (!PUBLIC_META_KEYS.includes(metaKey)) return undefined;
        const value = PLUGINS[id]?.[metaKey];
        return LOCALIZABLE_META_KEYS.includes(metaKey) ? resolveMetaText(id, value) : value;
    }

    /**
     * Read a module's resolved static config (ENV `modules[<id>]` merged with its
     * include.json) — the same source `XOpatModule.getStaticMeta` reads, but usable
     * by plain module scripts that are not XOpatElement instances (e.g. the
     * oidc-client-ts auth broker). Deployment-trusted config only; no secrets.
     */
    const moduleMeta = (window as any).moduleMeta = function (id: string, metaKey: string) {
        const value = MODULES[id]?.[metaKey];
        return LOCALIZABLE_META_KEYS.includes(metaKey) ? resolveMetaText(id, value) : value;
    }

    /**
     * Load the locale bundle of a plugin or module that is not (yet) instantiated,
     * so that its `%key%` metadata resolves - e.g. to list plugins the user has not
     * loaded. Loaded elements get this via `XOpatElement.loadLocale`. Idempotent.
     * @param kind "plugins" or "modules"
     * @param id element id
     * @param locale defaults to the active language
     */
    const loadElementLocale = (window as any).loadElementLocale = async function (
        kind: "plugins" | "modules", id: string, locale?: string) {
        const isPlugin = kind === "plugins";
        const record = isPlugin ? PLUGINS[id] : MODULES[id];
        if (!record?.directory) return;
        try {
            await _getLocale(id, isPlugin ? PLUGINS_FOLDER : MODULES_FOLDER, record.directory,
                `locales/${locale || $.i18n?.language}.json`, locale);
        } catch (e) {
            //an element without locales for the active language is legal: metadata stays raw
            console.debug(`No '${locale || $.i18n?.language}' locale for ${kind} ${id}.`, e);
        }
    }

    /**
     * Get a module singleton reference if instantiated or instantiate it if available.
     * @param id module id
     */
    const singletonModule = (window as any).singletonModule = function (id: string) {
        let instance = MODULES[id]?.instance;
        if (!instance) {
            const exportsObj = (window as any).xmodules?.[id] || (window as any).xmodules?.[id.replace(/-/g, '')];
            const Ctor = exportsObj?.default || exportsObj;
            if (Ctor && typeof Ctor.instance === 'function') {
                instance = Ctor.instance();
            }
        }
        return instance;
    };

    /**
     * Get a viewer module singleton reference if instantiated or instantiate it if available.
     * @param className module className, name of the class as a string, e.g. "MyViewerModule" if default, or custom name if registered as such
     * @param viewer which viewer-context-dependent instance (XOpatViewerSingleton) is fetched
     */
    const viewerSingletonModule = (window as any).viewerSingletonModule = function (className: string, viewer: ViewerLikeItem) {
        const id = "ViewerInstance::" + className;
        let instance = VIEWER_MANAGER._getSingleton(id, viewer);
        if (!instance) {
            const exportsObj = (window as any).xmodules?.[id] || (window as any).xmodules?.[id.replace(/-/g, '')];
            const Ctor = exportsObj?.default || exportsObj;
            if (Ctor && typeof Ctor.instance === 'function') {
                instance = Ctor.instance(viewer);
            }
        }
        return instance;
    };

    /**
     * Register plugin. Plugin can be instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    const addPlugin = (window as any).addPlugin = function (id: string, PluginClass: XOpatPluginClass) {
        (PluginClass as any).$id = id;
        let plugin = instantiatePlugin(id, PluginClass);
        if (!plugin) return;

        if (REGISTERED_PLUGINS !== undefined) {
            if (plugin && typeof plugin["pluginReady"] === "function") {
                REGISTERED_PLUGINS.push(plugin);
            }
        } //else do not initialize plugin, wait untill all files loaded dynamically
    };

    /**
     * Register a module globally. This ensures the module class is present in
     * `window.xmodules`, allowing dynamic lazy-instantiation across the system.
     * Strongly recommended for all modules.
     * @param id module id
     * @param ModuleClass class/class-like-function to register (not an instance!)
     * @param eager if true, force `ModuleClass.instance()` immediately so the
     *   constructor runs at script-load time. Use for sink/registrar singletons
     *   whose constructor must populate global state (e.g. `IO_PIPELINE.registerSink`)
     *   before owner modules resolve bindings against it. Default false.
     */
    (window as any).addModule = function addModule(id: string, ModuleClass: any, eager: boolean = false) {
        if (!id || !ModuleClass) return;

        // Refuse registration rather than let an incompatible module hand out
        // singletons; dependents fail with a reported module-failed instead.
        const incompatible = incompatibilityReason(MODULES[id]);
        if (incompatible) {
            console.warn(`Module ${id} refused:`, incompatible);
            cleanUpModule(id, incompatible);
            return;
        }

        if (!MODULES[id]) {
            const known = Object.keys(MODULES);
            const guess = known.find(k => k.toLowerCase() === id.toLowerCase() || k.startsWith(id) || id.startsWith(k));
            console.warn(
                `[loader] addModule("${id}", ${ModuleClass.name || "<anon>"}) registered an id that does not match any include.json. ` +
                `Singleton instantiation will throw "module not registered". ` +
                (guess ? `Did you mean "${guess}"?` : `Known module ids: ${known.join(", ")}`)
            );
        }
        ModuleClass.$id = id;
        const xmods = (window as any).xmodules = (window as any).xmodules || {};
        xmods[id] = ModuleClass;
        if (eager && typeof ModuleClass.instance === "function") {
            try { withHandlerOwner(id, () => ModuleClass.instance()); }
            catch (e) {
                console.error(`[loader] eager init of module "${id}" failed:`, e);
                cleanUpModule(id, e);
            }
        }
    };

    /**
     * Register viewer singleton globally.
     * @param SingletonClass The viewer singleton class
     * @param className The class name representing this viewer singleton, optional, can override the default usage of
     *   the name of the class as a string, e.g. "MyViewerModule"
     */
    const registerViewerSingleton = (window as any).registerViewerSingleton = function (SingletonClass: any, className?: string) {
        if (!SingletonClass) return;
        const id = "ViewerInstance::" + (className || SingletonClass.name || String(SingletonClass));
        SingletonClass.$className = className;
        SingletonClass.$id = id;
        let xmods = (window as any).xmodules = (window as any).xmodules || {};
        xmods[id] = SingletonClass;
    };

    /**
     * Force the SingletonClass class definition to be instantiated automatically per active viewer.
     */
    const requireViewerSingletonPresence = (window as any).requireViewerSingletonPresence = function (SingletonClass: XOpatViewerSingletonClass) {
        if (!(SingletonClass.prototype instanceof XOpatViewerSingleton)) {
            console.error("Invalid singleton class", SingletonClass);
            return;
        }
        if (!(SingletonClass as any).$id) {
            registerViewerSingleton(SingletonClass);
        }
        REQUIRED_SINGLETONS.add(SingletonClass);
        if (window.VIEWER_MANAGER) {
            for (let v of VIEWER_MANAGER.viewers) {
                if (v.isOpen() && !this._getSingleton(SingletonClass.IID, v)) {
                    SingletonClass.instance(v);
                }
            }
        }
    }

    function extendWith(target: Record<string, any>, source: Record<string, any>, ...properties: string[]) {
        for (let property of properties) {
            if (source.hasOwnProperty(property)) target[property] = source[property];
        }
    }

    function chainLoad(id: string, sources: XOpatElementRecord, index: number, onSuccess: () => void, folder: string = PLUGINS_FOLDER) {
        // In production the server may attach a `prodIncludes` overlay: foldable
        // files collapsed into a single index.min.js, non-foldable entries kept
        // in place. Fall back to the canonical `includes` in dev / when no min
        // artifact exists. Same entry shapes, so the per-entry handling below is
        // reused unchanged. See server/templates/javascript/utils.js.
        const list = sources.prodIncludes ?? sources.includes;
        if (index >= list.length) {
            onSuccess();
        } else {
            let toLoad = list[index],
                properties: Partial<ScriptProperties> = {};
            if (typeof toLoad === "string") {
                properties.src = `${folder}${sources.directory}/${toLoad}?v=${version}`;
                if (toLoad.endsWith(".mjs")) {
                    properties.type = "module";
                }
            } else if (typeof toLoad === "object") {
                extendWith(properties, toLoad,
                    'async', 'crossOrigin', 'defer', 'integrity', 'referrerPolicy', 'src', 'type'
                );
            } else {
                throw "Invalid dependency: invalid type " + (typeof toLoad);
            }

            attachScript(id, properties as ScriptProperties, () => chainLoad(id, sources, index + 1, onSuccess, folder));
        }
    }

    function chainLoadModules(moduleList: string[], index: number, onSuccess: () => void) {
        if (index >= moduleList.length) {
            onSuccess();
            return;
        }
        let module = MODULES[moduleList[index] ?? ""];
        if (!module || module.loaded) {
            chainLoadModules(moduleList, index + 1, onSuccess);
            return;
        }

        function loadSelf() {
            //load self files and continue loading from modulelist
            chainLoad(module!.id + "-module", module!, 0,
                function () {
                    if (module!.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${module!.styleSheet}' type='text/css'/>`);
                    }
                    module!.loaded = true;
                    chainLoadModules(moduleList, index + 1, onSuccess);
                }, MODULES_FOLDER);
        }

        //first dependencies, then self
        chainLoadModules(module!.requires || [], 0, loadSelf);
    }

    /** Bundle fetches in flight or already registered, keyed by `<locale>::<id>::<file>`. */
    const _localeBundles: Record<string, Promise<void>> = {};

    async function _getLocale(id: string, path: string, directory: string | undefined, data: any, locale: string | undefined) {
        if (!$.i18n) return;
        if (!locale) locale = $.i18n.language;

        if (typeof data === "string" && directory) {
            const cacheKey = `${locale}::${id}::${data}`;
            if (_localeBundles[cacheKey]) return _localeBundles[cacheKey];
            if ($.i18n.hasResourceBundle(locale, id)) return;

            return _localeBundles[cacheKey] = fetch(`${path}${directory}/${data}`).then(response => {
                if (!response.ok) {
                    throw new HTTPError("HTTP error " + response.status, response, '');
                }
                return response.json();
            }).then(json => {
                $.i18n.addResourceBundle(locale, id, json);
            }).catch(e => {
                delete _localeBundles[cacheKey];
                throw e;
            });
        } else if (data) {
            $.i18n.addResourceBundle(locale, id, data);
        } else {
            throw "Invalid translation for item " + id;
        }
    }

    /**
     * Ability to inherit from multiple classes.
     * Build a linearized, duplicate-free list of mixin classes, ordered from closest-to-base -> most-derived.
     * @param base The base class to extend
     * @param mixins Additional classes to aggregate into the base
     */
    const All = (base: new (...args: any[]) => any, ...mixins: (new (...args: any[]) => any)[]) => {

        const linearize = (base: any, mixins: any[]) => {
            const seen = new Set();
            const out: any[] = [];

            const visit = (K: any) => {
                if (!K || K === base || K === Object) return;
                const superK = Object.getPrototypeOf(K);
                visit(superK);                 // ensure superclasses come first
                if (!seen.has(K)) {
                    seen.add(K);
                    out.push(K);                  // add each class exactly once
                }
            };

            for (const M of mixins) visit(M);
            return out;
        };

        const linear = linearize(base, mixins);

        /**
         * Copy property helpers (skip problematic keys)
         * @param target Destination object
         * @param source Source object to copy properties from
         */
        const copyProps = (target: any, source: any) => {
            if (!source) return;
            for (const key of Object.getOwnPropertyNames(source)) {
                if (/^(?:initializer|constructor|prototype|arguments|caller|name|bind|call|apply|toString|length)$/.test(key))
                    continue;
                Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!);
            }

            for (const key of Object.getOwnPropertySymbols(source)) {
                Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!);
            }
        };

        class Aggregate extends (base as any) {
            constructor(...args: any[]) {
                super(...args);                 // call base constructor once

                // Call each initializer once, in base->derived order
                for (const K of linear) {
                    const init = K?.prototype?.initializer;
                    if (typeof init === "function") init.apply(this, args);
                }
            }
        }

        // Copy statics and prototypes once, in base->derived order
        for (const K of linear) {
            copyProps(Aggregate.prototype, K.prototype);
            copyProps(Aggregate, K);
        }

        return Aggregate as any;
    };

    /**
     * Implements common interface for plugins and modules. Cannot
     * be instantiated as it is hidden in closure. Private, but
     * available in docs due to its API nature.
     * @extends OpenSeadragon.EventSource
     * @abstract
     */
    class XOpatElement extends OpenSeadragon.EventSource implements IXOpatElement {
        __id: string;
        __uid: string;
        __xoContext: XOpatExecutionContext;
        // Allow symbol-keyed storage (STORE_TOKEN, CACHE_TOKEN)
        [key: symbol]: any;

        /**
         * @param {XOpatElementID} id
         * @param {('plugin'|'module')} executionContextName
         */
        constructor(id: XOpatElementID | undefined, executionContextName: XOpatExecutionContext) {
            super();

            id = id || (this.constructor as any).$id;
            if (!id) throw `Trying to instantiate an element '${this.constructor.name || this.constructor}' - no id given.`;
            this.__id = id;
            this.__uid = `${executionContextName}.${id}`;
            this.__xoContext = executionContextName;

            this[CACHE_TOKEN] = new XOpatStorage.Cache({ id: this.__uid });
            REGISTERED_ELEMENTS.push(this);

            // Auto-register with the IO pipeline so include.json `io` block
            // declarations apply, and so resources/capabilities can be added
            // later via initIO()/defineResource(). No bundle hooks yet.
            this[IO_DISPOSE_TOKEN] = IO_PIPELINE.registerOwner(this.__uid, {
                ownerId: this.__id,
                xoType: this.__xoContext,
            });
            const meta = (executionContextName === "plugin" ? PLUGINS : MODULES)[id];
            const ioBlock = meta && (meta as any).io;
            if (ioBlock !== undefined) IO_PIPELINE.applyIncludeBlock(this.__uid, ioBlock);

            // Roles & capabilities: declare any rights-capabilities the owner exposes,
            // and auto-derive matching ones from `io.capabilities[]`. Guard disposers
            // are kept so they can be released if the owner is ever torn down.
            // See src/USER_ROLES.md.
            this[RIGHTS_DISPOSE_TOKEN] = registerOwnerRights(this.__id, meta);
        }

        /**
         * @return {string} id element identifier
         */
        get id() {
            return this.__id;
        }

        /**
         * @return {string} id unique element identifier in the application
         */
        get uid() {
            return this.__uid;
        }

        /**
         * @return {string}  context ID (plugin/module)
         */
        get xoContext() {
            return this.__xoContext;
        }

        /**
         * @return {XOpatStorage.Cache} sync per-element cache (kv:cache).
         * Default driver: localStorage; admin-redirectable via app config.
         */
        get cache() {
            return this[CACHE_TOKEN];
        }

        /**
         * Sync per-element cookies façade (kv:cookies). Default driver:
         * browser cookie jar; admin-redirectable. Lazy.
         */
        get cookies() {
            let c = this[COOKIES_TOKEN];
            if (!c) {
                c = this[COOKIES_TOKEN] = new XOpatStorage.Cookies({ id: this.__uid });
            }
            return c;
        }

        /**
         * Async per-element data store (kv:data). Default driver:
         * post-data; admin-redirectable to http-rest, indexeddb, etc. Lazy.
         */
        get data() {
            let d = this[DATA_TOKEN];
            if (!d) {
                d = this[DATA_TOKEN] = new XOpatStorage.Data({ id: this.__uid });
            }
            return d;
        }

        /**
         * Unlike plugins, options for modules are limited to an internal option map. Note that unlike
         * plugin, these values are not exported nor shared between sessions (unless cache takes action)!
         * @param {string} optionKey
         * @param {*} defaultValue
         * @param {boolean} cache
         * @memberof XOpatModule
         * @return {*}
         */
        getOption(optionKey: string, defaultValue: any, cache = true) {
            //options are stored only for plugins, so we store them at the lowest level
            let value = cache ? this.cache.get(optionKey, null) : null;
            if (value === "false") value = false;
            else if (value === "true") value = true;
            return value;
        }

        /**
         * Store the module online configuration parameters/options - but note that unlike
         * plugin, these values are not exported nor shared between sessions (unless cache takes action)!
         * @param {string} key
         * @param {*} value
         * @param {boolean} cache
         */
        setOption(key: string, value: any, cache = true) {
            if (cache) this.cache.set(key, value);
        }

        /**
         * Relative locale file location as locales/[locale].json.
         * Override for custom locales file location.
         * @param locale
         * @return {string} relative file path
         */
        getLocaleFile(locale: string): string {
            return `locales/${locale}.json`;
        }

        /**
         * Translate the string in given element context
         * @param key
         * @param options
         * @return {*}
         */
        t(key: string, options: Record<string, any> = {}) {
            options.ns = this.id;
            return $.t(key, options);
        }

        /**
         * Roles & capabilities — sugar over `XOpatUser.instance().can(...)`.
         * Returns `true` when the current user is granted the capability.
         * Unknown capability ids default to allow.
         * See src/USER_ROLES.md.
         */
        can(capabilityId: string): boolean {
            return (window as any).XOpatUser?.instance?.()?.can(capabilityId) ?? true;
        }

        /**
         * Subscribe to changes in a single capability's effective value. The
         * `handler` is invoked synchronously with the current state at
         * subscription time AND on every subsequent change. Returns a
         * `dispose` function.
         *
         * Typical use:
         * ```
         * this.onCapabilityChange('annotations.crud:annotation.delete', enabled => {
         *     deleteBtn.classList.toggle('hidden', !enabled);
         * });
         * ```
         */
        onCapabilityChange(capabilityId: string, handler: (enabled: boolean) => void): () => void {
            const user = (window as any).XOpatUser?.instance?.();
            // Initial value
            try { handler(user?.can(capabilityId) ?? true); }
            catch (e) { console.error(e); }
            if (!user) return () => undefined;
            const wrapped = (e: any) => {
                const changed: string[] | undefined = e?.changed;
                if (!Array.isArray(changed) || changed.includes(capabilityId)) {
                    try { handler(user.can(capabilityId)); }
                    catch (err) { console.error(err); }
                }
            };
            user.addHandler('capabilities-changed', wrapped);
            return () => user.removeHandler('capabilities-changed', wrapped);
        }

        /**
         * Raise error event. If the module did register as event source,
         * it is fired on the item instance. Otherwise, it is fired on the VIEWER.
         * todo better warn mechanism:
         * -> simple way of module/plugin level context warns and errors (no feedback)
         * -> advanced way of event warnings (feedback with E code)
         * @param e
         * @param e.code
         * @param e.message
         * @param e.error
         * @param {boolean} notifyUser fires error-user if true, error-system otherwise.
         */
        error(e: XOpatErrorEvent, notifyUser = true) {
            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event error-user
             * @event error-system
             * @memberof OpenSeadragon.Viewer
             */

            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event error-user
             * @event error-system
             * @memberof XOpatElement
             */
            this.raiseEvent(notifyUser ? 'error-user' : 'error-system',
                $.extend(e, { originType: this.xoContext, originId: this.id }));
        }

        /**
         * Raise warning event. If the module did register as event source,
         * it is fired on the item instance. Otherwise, it is fired on the VIEWER.
         * todo better warn mechanism:
         * -> simple way of module/plugin level context warns and errors (no feedback)
         * -> advanced way of event warnings (feedback with E code)
         * @param e
         * @param e.code
         * @param e.message
         * @param e.error
         * @param {boolean} notifyUser fires error-user if true, error-system otherwise.
         */
        warn(e: XOpatErrorEvent, notifyUser: boolean) {
            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event warn-user
             * @event warn-system
             * @memberof OpenSeadragon.Viewer
             */

            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event warn-user
             * @event warn-system
             * @memberof XOpatElement
             */
            this.raiseEvent(notifyUser ? 'warn-user' : 'warn-system',
                $.extend(e,
                    { originType: this.xoContext, originId: this.id }));
        }

        /**
         * Initialize this element's participation in the generic IO/persistence
         * pipeline. Optional. Without this call, the element is registered with
         * the pipeline (so include.json `io` declarations apply) but has no
         * bundle hooks — meaning bundle-export/import capabilities, even when
         * declared, will produce no payload.
         *
         * @param options.capabilities  capabilities to declare in addition to
         *   any declared in include.json. Each is `{ id, kind: 'bundle'|'crud' }`.
         * @param options.exportBundle  hook called by the pipeline when a
         *   bundle-export capability is bound to a sink. Return the
         *   serialized payload (string/Blob/object). Inspect `ctx.viewerId`
         *   for per-viewer dispatch.
         * @param options.importBundle  hook called by the pipeline when a
         *   bundle-import is requested for this owner.
         * @param options.bundleScope   `'global' | 'per-viewer' |
         *   'per-viewer-background' | 'both' | 'all'`. Defaults to `'global'`.
         *   `'both'` matches the legacy `inViewerContext: true` behavior (one
         *   global call + one per active viewer). `'per-viewer-background'`
         *   opts the owner into slide-aware lifecycle: flush-on-leave and
         *   restore-on-enter per (viewer, background) pair, driven by
         *   `viewer-open-pipeline` on slide change. `'all'` = global +
         *   per-viewer + per-viewer-background. See src/IO_PIPELINE.md.
         * @param options.ignore        opt-out at runtime (equivalent to
         *   the old `ignorePostIO` option).
         */
        async initIO(options: {
            capabilities?: IOCapability[];
            exportBundle?: (ctx: IOContext) => Promise<unknown> | unknown;
            importBundle?: (ctx: IOContext, data: unknown) => Promise<void> | void;
            bundleScope?: "global" | "per-viewer" | "per-viewer-background" | "both" | "all";
            ignore?: boolean;
        } = {}): Promise<void> {
            if (options.ignore || (typeof this.getOption === "function" && this.getOption("ignorePostIO", false))) {
                IO_PIPELINE.applyIncludeBlock(this.__uid, false);
                return;
            }
            IO_PIPELINE.registerOwner(this.__uid, {
                ownerId: this.__id,
                xoType: this.__xoContext,
                bundleScope: options.bundleScope,
                exportBundle: options.exportBundle,
                importBundle: options.importBundle,
            });
            for (const cap of options.capabilities ?? []) {
                IO_PIPELINE.registerCapability(this.__uid, cap);
            }
            // Pull any pre-existing global payload from bound bundle sinks
            // immediately so the owner can rehydrate before any user
            // interaction.
            if (options.importBundle) {
                try {
                    await IO_PIPELINE.tryRestoreImport({ ownerUid: this.__uid });
                } catch (e) {
                    console.error("IO Failure (initIO restore):", this.constructor.name, e);
                    this.error({
                        error: e, code: "W_IO_INIT_ERROR",
                        message: $.t("error.pluginImportFail",
                            { plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');" }),
                    });
                }
            }
        }

        /**
         * Declare that this element supports a `bundle-*` or `crud:*` capability.
         * Equivalent to passing it via `initIO({ capabilities: [...] })` or
         * declaring it in include.json's `io.capabilities`.
         */
        defineCapability(cap: IOCapability): void {
            IO_PIPELINE.registerCapability(this.__uid, cap);
        }

        /**
         * Declare a per-element CRUD resource (e.g. `'annotation'`, `'preset'`).
         * Returns a façade with `create/read/update/delete` that dispatch
         * through the pipeline. CRUD is inert (no-op success) until an admin
         * binds the matching `crud:<name>` capability to a sink.
         */
        defineResource<T>(def: IOResourceDef<T>): IOResource<T> {
            IO_PIPELINE.registerCapability(this.__uid, {
                id: `crud:${def.name}`,
                kind: "crud",
                schema: def.schema,
                label: def.name,
            });
            const resource = new IOResourceImpl<T>({
                ownerUid: this.__uid,
                ownerId: this.__id,
                xoType: this.__xoContext,
                pipeline: IO_PIPELINE,
                def,
            });
            // Track in the pipeline so `flushAllResources()` (used by the
            // Save action) can drain every CRUD outbox in one call.
            IO_PIPELINE.registerResource(resource);
            return resource;
        }

        /**
         * IO façade exposed to plugin/module code. `flush()` triggers a
         * bundle export for this element (programmatic equivalent of the
         * user-facing "Export" button); `capabilities()` lists what this
         * element advertises; `isEnabled()` reports whether any binding
         * for the given capability is active.
         */
        get io() {
            const uid = this.__uid;
            return {
                flush: (scope?: { capabilityId?: string; viewerId?: string; backgroundId?: string }) =>
                    IO_PIPELINE.flushBundleExport({ ownerUid: uid, viewerId: scope?.viewerId, backgroundId: scope?.backgroundId }),
                capabilities: () => IO_PIPELINE.listCapabilities(uid).map(x => x.capability),
                isEnabled: (capabilityId?: string) => IO_PIPELINE.isEnabled(uid, capabilityId),
            };
        }

        /**
         * Get context of viewer that is suitable for storing viewer-related data.
         * @param id
         * @return {{}|undefined}
         */
        getViewerContext(id: UniqueViewerId) {
            const viewer = VIEWER_MANAGER.getViewer(id);
            if (!viewer) {
                // During slide-switch transitions, deferred UI work (RAFs,
                // pending re-renders) can still hold the previous viewer's
                // uniqueId in closure after that id has been retired. Callers
                // must already treat undefined as "skip this work", so a debug
                // line is enough — a console.warn here was historically loud
                // and uninformative.
                console.debug("No viewer with id " + id);
                return undefined;
            }
            let store = viewer[STORE_TOKEN];
            if (!store) {
                viewer[STORE_TOKEN] = store = {};
            }
            let elementStore = store[this.uid];
            if (!elementStore) {
                store[this.uid] = elementStore = {};
            }
            return elementStore;
        }

        /**
         * Integrate conditionally with a singleton module object.
         * @param moduleId the module id, must be known
         * @param callback function to call with the module object
         * TODO: this does not wait once module is fully loaded!
         */
        integrateWithSingletonModule(moduleId: string, callback: (module: IXOpatModuleSingleton) => void) {
            const targetModule = singletonModule(moduleId);
            if (targetModule) {
                callback(targetModule);
                return true;
            }
            VIEWER_MANAGER.addHandler('module-singleton-created', (e: ModuleSingletonCreatedEvent) => {
                if (e.id === moduleId) callback(e.module);
            });
            return false;
        }

        /**
         * Integrate conditionally with a viewer singleton object.
         * @param className name of the class as a string, e.g. "MyViewerModule" if default, or custom name if registered as such
         * @param viewer the viewer the singleton exists for (if it exists)
         * @param callback function to call with the module object
         * TODO: this does not wait once module is fully loaded!
         */
        integrateWithViewerSingletonModule(className: string, viewer: ViewerLikeItem, callback: (module: IXOpatViewerSingletonModule) => void) {
            const targetModule = viewerSingletonModule(className, viewer);
            if (targetModule) {
                callback(targetModule);
                return true;
            }

            const id = "ViewerInstance::" + className;
            VIEWER_MANAGER.addHandler('module-singleton-created', (e: ModuleSingletonCreatedEvent) => {
                viewer = VIEWER_MANAGER.ensureViewer(viewer);
                if (e.id === id && e.viewer === viewer) callback(e.module as IXOpatViewerSingletonModule);
            });
            return false;
        }

        /**
         * Register a menu item that attaches to every active viewer's right-side menu.
         * The menu is automatically managed: created on viewer open, updated on content change,
         * and removed on destroy/reset.
         *
         * todo move all UI to UI
         *
         * @param {UINamedItemGetter} getter receives the viewer instance as a single instance, supports
         *   async functions too
         */
        registerViewerMenu(getter: UINamedItemGetter) {
            const insert = (content: any, menuComponent: any) => {
                if (!content) {
                    return;
                }

                const id = content.id;

                // Ensure ID uniqueness per plugin/module
                const menuId = `${this.id}-${id}`;
                const internalMenu = menuComponent.menu;
                const exists = menuId in internalMenu.tabs;

                // Delete to replace (update)
                if (exists) internalMenu.deleteTab(menuId);

                content.id = menuId;

                try {
                    internalMenu.addTab(content, this.id);
                } catch (e) {
                    console.error(`Failed to add viewer menu tab for ${this.id}`, e);
                }
            };

            const updateMenu = (viewer: OpenSeadragon.Viewer) => {
                const menuComponent = VIEWER_MANAGER.getMenu(viewer);
                // If menu not available (e.g. headless or destroyed), skip
                if (!menuComponent || !menuComponent.menu) return;

                let content = null;
                try {
                    content = getter(viewer);

                    if (content instanceof Promise) {
                        content.then(conf => insert(conf, menuComponent)).catch(e => {
                            console.error(`Error in viewer menu builder (async) for ${this.id}:`, e);
                        });
                    } else {
                        insert(content, menuComponent);
                    }
                } catch (e) {
                    console.error(`Error in viewer menu builder for ${this.id}:`, e);
                }
            };

            // 1. Hook into all future 'open' events (covers content changes) 'open' is an OSD event broadcasted to all viewers
            VIEWER_MANAGER.broadcastHandler('open', (e: OpenEvent) => updateMenu(e.eventSource));
            // 2. Hook into viewer reset (clearing data) to potentially remove the menu 'viewer-reset' is a ViewerManager event
            VIEWER_MANAGER.addHandler('viewer-reset', (e: ViewerResetEvent) => updateMenu(e.viewer));

            VIEWER_MANAGER.viewers.forEach((v: OpenSeadragon.Viewer) => {
                // Update regardless of state, logic inside handles null/removal
                updateMenu(v);
            });
        }

        setCacheOption() {
            console.warn("XOpatModule.setCacheOption() is deprecated. Use XOpatModule.cache.set() instead.");
            this.cache.set(...arguments);
        }

        /**
         * Returns the low-level RPC scope for this plugin/module.
         * Uses the element execution context and id automatically.
         */
        protected _serverScope() {
            const root = (window as any).xserver;
            if (!root) {
                throw new Error("Server RPC runtime is not available.");
            }

            const scope = root?.[this.xoContext]?.[this.id];
            if (!scope) {
                throw new Error(`Server RPC scope '${this.xoContext}.${this.id}' is not available.`);
            }
            return scope;
        }

        /**
         * Infer current viewer id if available.
         * Uses viewer.id because the server RPC currently expects the sink viewer id.
         */
        protected _defaultServerViewerId(): string | undefined {
            try {
                return (window as any).VIEWER?.id || undefined;
            } catch {
                return undefined;
            }
        }

        /**
         * Normalize any RPC/client/network failure into a consistent error object.
         */
        protected _normalizeServerError(
            method: string,
            args: any[],
            error: any
        ): XOpatServerCallError {
            if (error instanceof XOpatServerCallError) {
                return error;
            }

            const normalized = new XOpatServerCallError(
                error?.message || `Server call '${this.xoContext}.${this.id}.${method}()' failed.`,
                {
                    code: error?.code || "RPC_CALL_FAILED",
                    status: error?.status,
                    details: error?.details,
                    cause: error,
                }
            );

            const payload: XOpatServerErrorPayload = {
                kind: this.xoContext as "plugin" | "module",
                id: this.id,
                method,
                args,
                error: normalized,
            };

            try {
                this.raiseEvent("server-error", payload);
            } catch (_) {
                // ignore event dispatch failures
            }

            console.error(`[xOpat server] ${this.xoContext}.${this.id}.${method} failed`, payload);
            return normalized;
        }

        /**
         * Call a server method for this element with unified error handling.
         */
        async callServer<T = any>(
            method: string,
            payload?: any,
            options: XOpatServerCallOptions = {}
        ): Promise<T> {
            const scope = this._serverScope();
            const fn = scope?.[method];

            if (typeof fn !== "function") {
                throw new Error(`Server method '${this.xoContext}.${this.id}.${method}' is not available.`);
            }

            try {
                return await fn(payload, {
                    viewerId: options.viewerId,
                    contextId: options.contextId,
                    httpClient: options.httpClient || APPLICATION_CONTEXT.httpClient
                });
            } catch (error: any) {
                this.raiseEvent?.("server-error", {
                    kind: this.xoContext,
                    id: this.id,
                    method,
                    payload,
                    error
                });
                throw error;
            }
        }

        /**
         * Ergonomic proxy so callers can do:
         *   await this.server().getChatMessages({...})
         * or
         *   await this.server({ contextId: "jwt" }).getChatMessages({...})
         */
        server(defaultOptions: XOpatServerCallOptions = {}) {
            return new Proxy({}, {
                get: (_, prop) => {
                    if (typeof prop !== "string") return undefined;

                    return async (payload?: any, callOptions: XOpatServerCallOptions = {}) => {
                        return await this.callServer(prop, payload, {
                            ...defaultOptions,
                            ...callOptions,
                            httpClient: callOptions.httpClient || defaultOptions.httpClient
                        });
                    };
                }
            }) as Record<string, (payload?: any, callOptions?: XOpatServerCallOptions) => Promise<any>>;
        }
    }


    /**
     * Basic Module API. Modules do not have to inherit from XOpatModule, but
     * they loose the integration support.
     * @class XOpatModule
     * @extends XOpatElement
     * @inheritDoc
     */
    const XOpatModule = (window as any).XOpatModule = class extends XOpatElement implements IXOpatModule {

        constructor() {
            super(undefined, "module");
        }

        /**
         * Load localization data
         * @param locale the current locale if undefined
         * @param data possibly custom locale data if not fetched from a file
         * @return {Promise}
         */
        async loadLocale(locale = undefined, data = undefined) {
            return await _getLocale(this.id, MODULES_FOLDER, MODULES[this.id]?.directory,
                data || this.getLocaleFile(locale || $.i18n.language), locale);
        }

        /**
         * Read static metadata - include.json contents and additional meta attached at runtime
         * @param metaKey key to read
         * @param defaultValue
         * @return {undefined|*}
         */
        getStaticMeta(metaKey: string, defaultValue?: any) {
            if (metaKey === "instance") return undefined;
            const value = MODULES[this.id]?.[metaKey];
            if (value === undefined) return defaultValue;
            //name/description/... may reference this module's locale bundle
            return LOCALIZABLE_META_KEYS.includes(metaKey) ? resolveMetaText(this.id, value) : value;
        }

        /**
         * Read a runtime option (getOption) if set, otherwise the static
         * include.json/ENV configuration value (getStaticMeta). Mirror of
         * `XOpatPlugin.getOptionOrConfiguration` so modules can use the same
         * pattern — previously this lived only on plugins, and calling it on a
         * module threw "getOptionOrConfiguration is not a function".
         * @param optKey runtime option key (getOption)
         * @param staticKey static metadata key (getStaticMeta)
         * @param defaultValue
         * @param cache
         * @return {undefined|*}
         */
        getOptionOrConfiguration(optKey: string, staticKey: string, defaultValue: any = undefined, cache = true) {
            const value = this.getOption(optKey, undefined, cache);
            return value === undefined || value === null ? this.getStaticMeta(staticKey, defaultValue) : value;
        }

        /**
         * Base URL/path to the modules folder.
         * Useful for resolving module-relative assets.
         * @type {string}
         * @public
         */
        static ROOT: string = MODULES_FOLDER;

        /**
         * Absolute root path/URL of this module's directory.
         * Combines the global MODULES_FOLDER with this module's subdirectory.
         * @returns {string}
         * @public
         * @memberof XOpatModule#
         */
        get MODULE_ROOT() {
            if (!MODULES[this.id]) {
                throw new Error("Invalid module - not properly initialized!");
            }
            return MODULES_FOLDER + MODULES[this.id]?.directory
        }
    }

    /**
     * Singleton Module API, to provide one system-wide global instance.
     * offering its features to all equally.
     * TODO rename to XOpatSingletonModule
     * @class XOpatModuleSingleton
     * @extends XOpatModule
     * @inheritDoc
     */
    const XOpatModuleSingleton = (window as any).XOpatModuleSingleton = class extends XOpatModule implements IXOpatModuleSingleton {
        /**
         * Get instance of the singleton
         * (only one instance can run since it captures mouse events).
         * @static
         * @return {XOpatModuleSingleton} manager instance
         */
        static instance() {
            //this calls sub-class constructor, no args required
            const Ctor = this as any;
            if (Ctor.__failed) {
                throw `Module '${Ctor.$id}' failed to load and was disabled: ${Ctor.__failed}`;
            }
            if (Ctor.__self) return Ctor.__self;

            try {
                return Ctor.__self = withHandlerOwner(Ctor.$id, () => new Ctor());
            } catch (e) {
                // The constructor assigns `__self` on entry (so nested instance() calls
                // resolve), which means a throw halfway through leaves a half-built
                // singleton cached — callers would then get an object missing whatever
                // the constructor never got to set up, and blow up far from the cause.
                // Quarantine instead: drop the instance, tear the module's handlers
                // down, notify, and make every later instance() fail loudly.
                Ctor.__failed = e;
                Ctor.__self = undefined;
                cleanUpModule(Ctor.$id, e);
                throw e;
            }
        }

        /**
         * Check if instantiated
         * @return {boolean}
         */
        static instantiated() {
            return this.__self && true; //retype
        }

        static __self = undefined;

        /** Set to the construction error once the module is quarantined; blocks re-instantiation. */
        static __failed = undefined;


        /**
         * Create singleton with ID of the module.
         * The ID must be the module id defined in configuration.
         */
        constructor() {
            super();
            const staticContext = (this.constructor as any);
            if (staticContext.__self) {
                throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
            }
            staticContext.__self = this;

            const modRef = MODULES[this.id];
            if (!modRef) {
                throw `Trying to instantiate a module that is not registered! id="${this.id}" (class ${staticContext.name}). ` +
                    `Check that addModule("<id>", ${staticContext.name}) uses the same id as include.json. ` +
                    `Known module ids: ${Object.keys(MODULES).join(", ")}`;
            }
            modRef.instance = this;

            const exportedClass = ((window as any).xmodules || {})[this.id];
            if (!exportedClass) {
                console.warn(`Module '${this.id}' is missing from window.xmodules! Ensure you registered it via addModule('${this.id}', ClassName).`);
            }

            // Await event necessary to fire after instantiation, do in async context
            /**
             * Module singleton was instantiated
             * @memberof VIEWER_MANAGER
             * @event module-singleton-created
             */
            setTimeout(() => VIEWER_MANAGER.raiseEventAwaiting('module-singleton-created', {
                id: this.id,
                module: this,
                viewer: undefined
            }).catch(/*no-op*/));
        }

        /**
         * JS String to use in DOM callbacks to access self instance.
         * @type {string}
         */
        get THIS() {
            if (!this.id) return "__undefined__";
            //memoize
            Object.defineProperty(this, "THIS", {
                value: `singletonModule('${this.id}')`,
                writable: false,
            });
            return `singletonModule('${this.id}')`;
        }
    }

    /**
     * Singleton Viewer API, to provide one system-wide global instance per viewer,
     * offering its features to all equally. One distinct thing from all other elements
     * is that this component has full lifecycle including destruction - it lives
     * as long as a particular viewer sub-window is alive, and it should handle its
     * destruction using destroy() method.
     * @inheritDoc
     */
    const XOpatViewerSingleton = (window as any).XOpatViewerSingleton = class extends window.OpenSeadragon.EventSource implements IXOpatViewerSingleton {
        /**
         * Destroy. This method must be called if overridden.
         */
        destroy() {
            const state = (this.constructor as any).__getBroadcastState?.();
            if (state) {
                for (const [eventName, perHandler] of state.entries()) {
                    for (const [, record] of perHandler.entries()) {
                        const wrappers = record?.wrappers;
                        if (!wrappers?.get || !wrappers?.delete) {
                            continue;
                        }
                        const wrapper = wrappers.get(this);
                        if (wrapper) {
                            try { this.removeHandler(eventName, wrapper); } catch (_) { /* ignore */ }
                        }
                        wrappers.delete(this);
                    }
                }
            }
        }

        /**
         * Get instance of the singleton
         * (only one instance can run since it captures mouse events).
         * @static
         * @return {XOpatModuleSingleton} manager instance
         */
        static instance(viewerOrUniqueId: ViewerLikeItem) {
            if (viewerOrUniqueId === undefined) {
                console.error("The viewer instance needs a viewer argument to obtain the instance, unlike the global singleton.");
                return undefined;
            }
            // we use ID as this.name - it will not find itself unless registered, and registers itself with a correct ID
            const value = VIEWER_MANAGER._getSingleton(this.IID, viewerOrUniqueId);
            if (value) return value;
            const viewer = VIEWER_MANAGER.ensureViewer(viewerOrUniqueId);
            if (!viewer) return undefined;
            try {
                return new this(viewer);
            } catch (e) {
                // Registration happens in the base constructor (via
                // _attachSingleton) BEFORE the subclass body runs — a throwing
                // subclass constructor would otherwise leave a half-built,
                // poisoned instance registered that every later instance()
                // call returns instead of retrying construction.
                VIEWER_MANAGER._detachSingleton(this.IID, viewer);
                throw e;
            }
        }

        /**
         * Check if instantiated for a particular viewer
         * @param {ViewerLikeItem} viewerOrUniqueId
         * @return {boolean}
         */
        static instantiated(viewerOrUniqueId: ViewerLikeItem) {
            // not passing this as a third option avoids instantiation
            return !!VIEWER_MANAGER._getSingleton(this.IID, viewerOrUniqueId);
        }

        /**
         * Viewer Instance ID. Unique ID of the class (shared among instances of this singleton).
         * @return {string}
         * @constructor
         */
        static get IID() {
            const iid = (this as any).$id;
            if (iid) return iid;
            console.warn(`IID not set - defaulting to ViewerInstance::${this.name} - this is a bug, registration of component not performed!`);
            return "ViewerInstance::" + this.name;
        }

        /**
         * Create singleton.
         * @param {OpenSeadragon.Viewer} viewer
         */
        constructor(viewer: OpenSeadragon.Viewer) {
            // id ignored, only to be compatible with XOpatElement
            if (viewer === undefined) {
                throw new Error("Viewer must be provided to create a viewer-singleton!");
            }
            super();

            const Self = this.constructor as XOpatViewerSingletonClass;
            const iid = Self.IID;

            const exportedClass = ((window as any).xmodules || {})[iid];
            if (!exportedClass) {
                console.warn(`Viewer Singleton '${iid}' is missing from window.xmodules! Ensure you registered it via registerViewerSingleton('${(Self as any).$className || Self.name}', ClassName).`);
            }

            // throws if exists
            VIEWER_MANAGER._attachSingleton(iid, this, viewer);

            /**
             * @type {OpenSeadragon.Viewer}
             * @member viewer
             * @memberOf XOpatViewerSingletonModule
             */
            Object.defineProperty(this, 'viewer', {
                get: () => viewer,
            });

            (this.constructor as any).__attachAllHandlersToInstance(this);

            // Await event necessary to fire after instantiation, do in async context
            /**
             * Singleton was instantiated
             * @property {string} id
             * @property {XOpatViewerSingleton} singleton
             * @memberof VIEWER_MANAGER
             * @event viewer-singleton-created
             */
            setTimeout(() => VIEWER_MANAGER.raiseEventAwaiting('viewer-singleton-created', {
                id: iid,
                module: this,
                viewer: viewer
            }).catch(/*no-op*/));
        }

        /**
         * Get the viewer this singleton is attached to.
         * @type {OpenSeadragon.Viewer}
         */
        get viewer(): OpenSeadragon.Viewer {
            // viewer is set via Object.defineProperty in constructor
            return (this as any).__viewer;
        }

        /**
         * JS String to use in DOM callbacks to access self instance.
         * @type {string}
         */
        get THIS() {
            const id = (this.constructor as any).IID;
            //memoize
            Object.defineProperty(this, "THIS", {
                value: `singletonModule('${id}', '${this.viewer.uniqueId}')`,
                writable: false,
            });
            return `singletonModule('${id}', '${this.viewer.uniqueId}')`;
        }

        /**
         * Get all instances of the singleton from all active viewers.
         */
        get instances(): IXOpatViewerSingleton[] {
            return VIEWER_MANAGER._getSingletons((this.constructor as any).IID);
        }

        /**
         * Get all instances of the singleton from all active viewers.
         */
        static instances(): IXOpatViewerSingleton[] {
            return VIEWER_MANAGER._getSingletons((this as any).IID);
        }

        /**
         * Attach a class-wide handler to all current and future instances of this subclass.
         * Handler is called as handler.call(emittingInst, emittingInst, event, ...args)
         */
        static broadcastHandler(eventName: string, handler: OpenSeadragon.EventHandler<any>, userData: any, priority: number) {
            const state = this.__getBroadcastState();
            if (!state.has(eventName)) state.set(eventName, new Map());
            const perHandler = state.get(eventName);

            if (!perHandler) return;
            if (perHandler.has(handler)) return; // idempotent

            const record = { userData, priority, instances: new Set<IXOpatViewerSingleton>() };
            perHandler!.set(handler, record);

            // Attach immediately to instances that are already event sources
            for (const inst of this.instances()) {
                record.instances.add(inst);
                inst.addHandler(eventName, handler, userData, priority);
            }
        }

        /**
         * Remove a previously added class-wide handler from all instances of this subclass.
         */
        static cancelBroadcast(eventName: string, handler: OpenSeadragon.EventHandler<any>) {
            const state = this.__getBroadcastState();
            const perHandler = state.get(eventName);
            if (!perHandler) return;

            const record = perHandler.get(handler);
            if (!record) return;

            for (const inst of record.instances) {
                try { inst.removeHandler(eventName, handler); } catch (_) { /* no-op */ }
            }
            perHandler.delete(handler);
            if (perHandler.size === 0) state.delete(eventName);
        }

        /**
         * Attach every broadcast handler registered on this subclass to a particular instance.
         * Called after the instance becomes an event source.
         * @private
         */
        static __attachAllHandlersToInstance(inst: OpenSeadragon.EventSource) {
            const state = this.__getBroadcastState();

            for (const [eventName, perHandler] of state.entries()) {
                for (const [origHandler, record] of perHandler.entries()) {
                    inst.addHandler(eventName, origHandler, record.userData, record.priority);
                }
            }
        }

        /**
         * Per-subclass state:
         * (Own property on the subclass, so subclasses don't share.)
         */
        static __getBroadcastState(): Map<string, Map<OpenSeadragon.EventHandler<any>, { priority: number, userData: any, instances: Set<IXOpatViewerSingleton> }>> {
            if (!Object.prototype.hasOwnProperty.call(this, "__broadcastState")) {
                Object.defineProperty(this, "__broadcastState", {
                    value: new Map(),
                    writable: false, enumerable: false, configurable: false
                });
            }
            return (this as any).__broadcastState as Map<string, Map<OpenSeadragon.EventHandler<any>, { priority: number, userData: any, instances: Set<IXOpatViewerSingleton> }>>;
        }
    }

    /**
     * Singleton Module API as a viewer module, to provide one system-wide global instance per viewer,
     * offering its features to all equally. One distinct thing from all other elements
     * is that this component has full lifecycle including destruction - it lives
     * as long as a particular viewer sub-window is alive, and it should handle its
     * destruction using destroy() method.
     *
     * The class is basically joint logics of XOpatModule and XOpatModuleSingleton
     * @class XOpatViewerSingletonModule
     * @extends XOpatModule
     * @extends XOpatModuleSingleton
     * @inheritDoc
     */
    const XOpatViewerSingletonModule = (window as any).XOpatViewerSingletonModule = class extends All(XOpatModule, XOpatViewerSingleton) {

        constructor(id: string, viewer: OpenSeadragon.Viewer) {
            super(id, viewer);

            /**
             * Module singleton was instantiated
             * @property {string} id module id
             * @property {XOpatModuleSingleton|XOpatViewerSingletonModule} module
             * @memberof VIEWER_MANAGER
             * @event module-singleton-created
             */
            setTimeout(() => VIEWER_MANAGER.raiseEventAwaiting('module-singleton-created', {
                id: id,
                module: this,
                viewer: viewer
            }).catch(/*no-op*/));
        }

        /**
         * Destructor. When overridden, super call must be issued!
         */
        destroy() {
            super.destroy();
        }

    } as unknown as XOpatViewerSingletonModuleClass;

    /**
     * xOpat Plugin API. Plugins must have a parent class that
     * is registered and inherits from XOpatPlugin.
     * JS String to use in DOM callbacks to access self instance.
     * @class
     * @extends XOpatElement
     * @inheritDoc
     */
    const XOpatPlugin = (window as any).XOpatPlugin = class XOpatPlugin extends XOpatElement implements IXOpatPlugin {

        constructor() {
            super(undefined, "plugin");
        }

        /**
         * Lifecycle hook called once a viewer is fully loaded and ready.
         * Override in your plugin to perform async initialization.
         * @returns {Promise<void>|void}
         */
        async pluginReady() {
        }

        /**
         * Load localization data
         * @param locale the current locale if undefined
         * @param data possibly custom locale data if not fetched from a file
         */
        async loadLocale(locale = undefined, data = undefined) {
            return await _getLocale(this.id, PLUGINS_FOLDER, PLUGINS[this.id]?.directory,
                data || this.getLocaleFile(locale || $.i18n.language), locale)
        }

        /**
         * Read static metadata - include.json contents and additional meta attached at runtime
         * @param metaKey key to read
         * @param defaultValue
         * @return {undefined|*}
         */
        getStaticMeta(metaKey: string, defaultValue?: any) {
            if (metaKey === "instance") return undefined;
            const value = PLUGINS[this.id]?.[metaKey];
            if (value === undefined) return defaultValue;
            //name/description/... may reference this plugin's locale bundle
            return LOCALIZABLE_META_KEYS.includes(metaKey) ? resolveMetaText(this.id, value) : value;
        }

        /**
         * Store the plugin online configuration parameters/options
         * todo: options are not being documented, enforce
         * @param {string} key
         * @param {*} value
         * @param {boolean} cache
         * @memberof XOpatPlugin
         */
        setOption(key: string, value: any, cache = true) {
            if (cache) this.cache.set(key, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            APPLICATION_CONTEXT.config.plugins[this.id][key] = value;
        }

        /**
         * Read the plugin online configuration parameters/options.
         * The defaultValue is read from a static configuration if not provided.
         * Note that this behavior will read static values such as 'permaLoad', 'includes' etc..
         * @memberof XOpatPlugin
         */
        getOption(key: string, defaultValue: any = undefined, cache = true) {
            //todo allow APPLICATION_CONTEXT.getOption(...cache...) to disable cache globally

            //options are stored only for plugins, so we store them at the lowest level
            let value = cache ? this.cache.get(key, null) : null;
            if (value === null) {
                // read default value from static context if exists
                if (defaultValue === undefined && key !== "instance") {
                    defaultValue = PLUGINS[this.id]?.[key];
                }

                value = APPLICATION_CONTEXT.config.plugins[this.id].hasOwnProperty(key) ?
                    APPLICATION_CONTEXT.config.plugins[this.id][key] : defaultValue;
            }
            if (value === "false") value = false;
            else if (value === "true") value = true;
            return value;
        }

        /**
         * Read plugin configuration value - either from a static configuration or dynamic one.
         * More generic function that reads any option available (configurable via dynamic JSON or include.json)
         * @param {string} optKey dynamic param key, overrides anything
         * @param {string} staticKey static param key, used if dynamic value is undefined
         * @param {any} defaultValue
         * @param {boolean} cache
         */
        getOptionOrConfiguration(optKey: string, staticKey: string, defaultValue: any = undefined, cache = true) {
            const value = this.getOption(optKey, undefined, cache);
            return value === undefined ? this.getStaticMeta(staticKey, defaultValue) : value;
        }

        /**
         * JS String to use in DOM callbacks to access self instance.
         * @type {string}
         */
        get THIS() {
            if (!this.id) return "__undefined__";
            //memoize
            Object.defineProperty(this, "THIS", {
                value: `plugin('${this.id}')`,
                writable: false,
            });
            return `plugin('${this.id}')`;
        }

        /**
         * To simplify plugin interaction, you can register a callback executed
         * when a certain plugin gets loaded into the system.
         * @param {string} pluginId
         * @param {function} callback that receives the plugin instance
         * @return {boolean} true if finished immediatelly, false if registered handler for the
         * future possibility of plugin being loaded
         */
        integrateWithPlugin(pluginId: string, callback: (plugin: XOpatPlugin) => void) {
            const targetPlugin = plugin(pluginId);
            if (targetPlugin && PLUGINS[pluginId]?.__ready) {
                callback(targetPlugin);
                return true;
            }
            // TODO: consider async event that awaits loading handlers -> this could help e.g. delaying slide opening
            VIEWER_MANAGER.addHandler('plugin-loaded', (e: PluginLoadedEvent) => {
                if (e.id === pluginId) callback(e.plugin);
            });
            return false;
        }

        /**
         * Base URL/path to the plugins folder.
         * Useful for resolving plugin-relative assets.
         * @type {string}
         * @public
         */
        static ROOT = PLUGINS_FOLDER;

        /**
         * Absolute root path/URL of this plugin's directory.
         * Combines the global PLUGINS_FOLDER with this plugin's subdirectory.
         * @returns {string}
         * @public
         * @memberof XOpatPlugin#
         */
        get PLUGIN_ROOT() {
            if (!PLUGINS[this.id]) {
                throw new Error("Invalid module - not properly initialized!");
            }
            return PLUGINS_FOLDER + PLUGINS[this.id]?.directory
        }
    };

    function isImageLikeString(value: unknown): value is string {
        if (typeof value !== "string") return false;

        const s = value.trim();

        return (
            /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(s) ||
            /^blob:/i.test(s) ||
            /^https?:\/\//i.test(s) ||
            /^\/[^/]/.test(s) ||
            /^\.\.?\//.test(s)
        );
    }

    async function loadImageElement(src: string): Promise<HTMLImageElement> {
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image source: ${src.slice(0, 120)}`));
            img.src = src;
        });
    }

    async function blobToDataUrl(blob: Blob): Promise<string> {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read Blob as data URL."));
            reader.readAsDataURL(blob);
        });
    }

    function canvasToDataUrl(canvas: HTMLCanvasElement, mimeType = "image/png", quality?: number): string {
        return canvas.toDataURL(mimeType, quality);
    }

    const _alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
    const _alphaset = new Set(_alphabet.split(''));

    /**
     * @namespace UTILITIES
     */
    const UTILITIES = (window as any).UTILITIES = /** @lends UTILITIES */ {
        /**
         * @param imageFilePath image path
         * @param stripSuffix
         */
        fileNameFromPath: function (imageFilePath: string, stripSuffix = true) {
            if (typeof imageFilePath !== 'string') {
                console.error("fileNameFromPath: invalid argument type. This often happens when configuration" +
                    "specifies non-string data item, but fails to set the 'name' attribute.");
                return "error";
            }

            let begin = imageFilePath.lastIndexOf('/');
            if (begin === -1) return imageFilePath;
            begin++;
            if (stripSuffix) {
                let end = imageFilePath.lastIndexOf('.');
                if (end >= 0) return imageFilePath.substr(begin, end - begin);
            }
            return imageFilePath.substr(begin, imageFilePath.length - begin);
        },

        /**
         * Parse BG Item Name Safely
         */
        nameFromBGOrIndex: function (indexOrItem: number | BackgroundItem | BackgroundConfig, stripSuffix = true): string {
            // todo some error if not a string, that name must be provided etc...
            const isIndex = typeof indexOrItem === 'number';
            const item = BackgroundConfig.dataFromDataId(isIndex ? indexOrItem : indexOrItem.dataReference) as DataID;
            if (!item) return "unknown";
            if (!isIndex && indexOrItem.name) return indexOrItem.name;

            if (typeof item === "string") {
                return this.fileNameFromPath(item, stripSuffix);
            }
            if (typeof item === "object") {
                // we have data item, try to find anything that resembles a name
                const name = item.name || item.label || item.title;
                if (typeof name === "string") return name;
                if (typeof item.dataID === "string") {
                    return this.fileNameFromPath(item.dataID, stripSuffix);
                }
                const object = item.dataID || item;
                for (const key in object) {
                    if (typeof object[key] === "string") return object[key];
                }
            }
            console.warn("Background item has no parseable path and name is not set! This makes the slide unnameable!");
            return "undefined";
        },

        /**
         * Return the background id currently bound to the viewer's first
         * displayed slide. Mirrors the scalebar/world-item-0 lookup pattern
         * used by `findViewerUniqueId` and `application-context.referencedId`.
         * Used by the IO pipeline's per-viewer-background dispatch and by the
         * viewer-open-pipeline slide-change flush/restore hooks.
         */
        currentBackgroundIdFor: function (viewer: OpenSeadragon.Viewer | undefined): string | undefined {
            if (!viewer) return undefined;
            const item = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
            const bg = item?.getConfig?.("background");
            if (typeof bg?.id !== "string") return undefined;
            // Virtual-region children key IO by the parent slide (see
            // explicitSlotBackgroundId) so all modes share one bundle.
            return typeof bg.virtualOf === "string" ? bg.virtualOf : bg.id;
        },

        /**
         * Strip path suffix
         * @param {string} path
         * @return {string}
         */
        stripSuffix: function (path: string) {
            let end = path.lastIndexOf('.');
            if (end >= 0) return path.substr(0, end);
            return path;
        },

        /**
         * Load modules at runtime
         * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
         * @param onload function to call on successful finish
         * @param ids all modules id to be loaded (rest parameter syntax)
         */
        loadModules: function (onload?: (() => void), ...ids: string[]) {
            LOADING_PLUGIN = false;
            chainLoadModules(ids, 0, () => {
                /**
                 * Module loaded event. Fired only with dynamic loading.
                 * @property {string} id module id
                 * @memberof VIEWER_MANAGER
                 * @event module-loaded
                 */
                ids.forEach(id => VIEWER_MANAGER.raiseEvent('module-loaded', { id: id }));
                onload && onload();
            });
        },

        /**
         * Load a plugin at runtime
         * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
         */
        loadPlugin: function (id: string, onload?: (...args: any[]) => any, force?: boolean) {
            let meta = PLUGINS[id];
            if (!meta || (meta.loaded && meta.instance)) return;
            if (meta && !Array.isArray(meta.includes)) {
                meta.includes = [];
            }

            const incompatible = incompatibilityReason(meta) || moduleChainIncompatibility(meta.modules);
            if (incompatible) {
                showPluginError(id, incompatible);
                return;
            }

            setPluginLoadStatus(id, "loading");
            $(`#error-plugin-${id}`).html("");

            if (pluginsWereInitialized()) {
                /**
                 * Before a request to plugin loading is processed at runtime.
                 * @property {string} id plugin id
                 * @memberof VIEWER_MANAGER
                 * @event before-plugin-load
                 */
                VIEWER_MANAGER.raiseEvent('before-plugin-load', { id: id });
            }

            let successLoaded = function () {
                LOADING_PLUGIN = false;

                function finishPluginLoad() {
                    if (meta?.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
                    }
                    if (meta) meta.loaded = true;
                    showPluginError(id, null, true);
                    if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                        let plugins = [];
                        for (let p in PLUGINS) {
                            if (PLUGINS[p]?.loaded) plugins.push(p);
                        }
                        APPLICATION_CONTEXT.AppCookies.set('_plugins', plugins.join(","));
                    }
                }

                if (pluginsWereInitialized()) {
                    initializePlugin(PLUGINS[id]?.instance, true).then(success => {
                        if (success) {
                            finishPluginLoad();
                        }
                        onload && onload();
                    });
                    return;
                }
                finishPluginLoad();
                onload && onload();
            };
            LOADING_PLUGIN = true;
            chainLoadModules(meta!.modules || [], 0, () => chainLoad(id, meta!, 0, successLoaded));
        },

        /**
         * Check whether component is loaded
         * @param {string} id component id
         * @param {boolean} isPlugin true if check for plugins
         */
        isLoaded: function (id: string, isPlugin = false) {
            if (isPlugin) {
                let p = PLUGINS[id];
                return p?.loaded && p?.instance;
            }
            return MODULES[id]?.loaded;
        },

        /**
         * Serialize the Viewer
         * @param includedPluginsList
         * @param withCookies
         * @param staticPreview Whether to mark the serialized app as static or not
         * @return {Promise<{app: string, data: {}}>}
         */
        serializeApp: async function (includedPluginsList: string[] | undefined = undefined, withCookies = false, staticPreview = false): Promise<{ app: string, data: Record<string, any> }> {
            //reconstruct active plugins
            let pluginsData = APPLICATION_CONTEXT.config.plugins;
            let includeEvaluator = includedPluginsList ?
                (p: string, o: any) => includedPluginsList.includes(p) :
                (p: string, o: any) => o.loaded || o.permaLoad;

            for (let pid of APPLICATION_CONTEXT.pluginIds()) {
                const plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid);

                if (!includeEvaluator(pid, plugin)) {
                    delete pluginsData[pid];
                } else if (!pluginsData.hasOwnProperty(pid)) {
                    pluginsData[pid] = {};
                }
            }

            // Drive the generic IO pipeline: every owner with a bundle-export
            // capability bound to a sink contributes its payload. The
            // built-in `post-data` sink writes into POST_DATA, preserving
            // the legacy HTML-form session export shape. See src/IO_PIPELINE.md.
            await IO_PIPELINE.flushBundleExport();
            return { app: UTILITIES.serializeAppConfig(withCookies, staticPreview), data: POST_DATA };
        },

        generateID: function (input: any, size = 12) {
            if (!Number.isFinite(size) || size <= 0) return '';
            input = String(input);
            const alphLen = _alphabet.length;
            const mask = (2 << (31 - Math.clz32((alphLen - 1) | 1))) - 1;
            let h = 0x811c9dc5;
            for (let i = 0; i < input.length; i++) {
                h ^= input.charCodeAt(i);
                h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
            }
            function rand32() {
                h ^= h << 13; h >>>= 0;
                h ^= h >>> 17; h >>>= 0;
                h ^= h << 5; h >>>= 0;
                return h >>> 0;
            }
            let id = '';
            while (id.length < size) {
                let r = rand32();
                // consume 4 bytes per iteration
                for (let k = 0; k < 4 && id.length < size; k++) {
                    const b = r & 0xff; r >>>= 8;
                    const idx = b & mask;
                    if (idx < alphLen) id += _alphabet[idx];
                }
            }
            if (id.startsWith("osd-")) {
                while (id.length < size + 4) {
                    let r = rand32();
                    for (let k = 0; k < 4 && id.length < size; k++) {
                        const b = r & 0xff; r >>>= 8;
                        const idx = b & mask;
                        if (idx < alphLen) id += _alphabet[idx];
                    }
                }
                return id.slice(4, size + 4);
            }
            return id.slice(0, size);
        },

        sanitizeID: function (input: any) {
            if (input == null) return '';
            const s = String(input);
            let out = [];
            for (const ch of s) {
                out.push(_alphaset.has(ch) ? ch : '-');
            }
            // ensure ID does not have reserved 'osd-' prefix
            if (out.length > 3 && out[0] === 'o' && out[1] === 's' && out[2] === 'd' && out[3] === '-') {
                out[3] = "_";
            }
            return out.join('');
        },

        /**
         * Copy content to the user clipboard.
         */
        copyToClipboard: function (content: string, alert: boolean = true) {
            // todo try         navigator.clipboard?.writeText(content).catch(() => {}); on catch go this old way
            let $temp = $("<input>");
            $("body").append($temp);
            $temp.val(content).select();
            document.execCommand("copy");
            $temp.remove();
            if (alert) Dialogs.show($.t('messages.valueCopied'), 3000, Dialogs.MSG_INFO);
        },

        /**
         * Export only the viewer direct link (without data) to the clipboard.
         */
        copyUrlToClipboard: function () {
            const data = UTILITIES.serializeAppConfig();
            UTILITIES.copyToClipboard(APPLICATION_CONTEXT.url + "#" + encodeURIComponent(data));
        },

        /**
         * Update the viewer URL with the current session data. Returns true if the URL was updated.
         */
        syncSessionToUrl: function syncSessionToUrl(withCookies: boolean = false) {
            try {
                const data = UTILITIES.serializeAppConfig();
                history.replaceState(history.state, "", APPLICATION_CONTEXT.url + "#" + encodeURIComponent(data));
                return true;
            } catch (e) {
                console.warn("syncSessionToUrl failed:", e);
                return false;
            }
        },

        /**
         * Create a screenshot of the current viewer viewport and open it in a new tab.
         * @returns {void}
         */
        makeScreenshot: function () {
            // todo OSD v5.0 ensure we can copy the canvas among drawers
            const canvas = document.createElement("canvas"),
                viewportCanvas = VIEWER.drawer.canvas, width = viewportCanvas.width, height = viewportCanvas.height;
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d") as CanvasRenderingContext2D;
            context.drawImage(viewportCanvas, 0, 0);
            //todo make this awaiting in OSD v5.0
            VIEWER.raiseEvent('screenshot', {
                context2D: context,
                width: width,
                height: height
            });
            //show result in a new window
            canvas.toBlob((blob: Blob | null) => {
                const url = blob && URL.createObjectURL(blob);
                if (url === null) return;
                window.open(url, '_blank');
                URL.revokeObjectURL(url);
            });
        },

        /**
         * UUID4 Generator, Copied from cornerstone.js
         */
        uuid4: function () {
            if (typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            // Fallback for environments where crypto.randomUUID is not available
            return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: string) => {
                const cNum = parseInt(c, 10);
                return (
                    cNum ^
                    ((crypto.getRandomValues(new Uint8Array(1))[0] as number) & (15 >> (cNum / 4)))
                ).toString(16);
            });
        },

        /**
         * Export the current viewer session as a self-contained HTML file.
         * When opened, it automatically loads the saved session.
         *
         * This is the explicit "give me a file" action. For the adaptive
         * persistence flow (remote sinks when configured, file when not),
         * see `UTILITIES.save()`.
         */
        export: async function () {
            // `getForm()` awaits `IO_PIPELINE.flushBundleExport()` which can
            // round-trip to remote sinks (github, http-rest, …) for several
            // seconds. Show the global loading UI so the user knows we're
            // working and can't trigger duplicate exports.
            const showLoading = USER_INTERFACE?.Loading?.show;
            try { showLoading?.(true); } catch (_) { /* no-op */ }
            try {
                const doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualization export</title></head>
<body><!--Todo errors might fail to be stringified - cyclic structures!-->
<div>Errors (if any): <pre>${(console as any).appTrace.join("")}</pre></div>
${await UTILITIES.getForm()}
</body></html>`;

                UTILITIES.downloadAsFile("export.html", doc);
                APPLICATION_CONTEXT.__cache.dirty = false;
            } finally {
                try { showLoading?.(false); } catch (_) { /* no-op */ }
            }
        },

        /**
         * Persist the current viewer session to **configured backends** when
         * any remote sink is bound for `bundle-export`. If nothing remote is
         * configured, falls back to `UTILITIES.export()` so the user is never
         * left without a way to keep their work.
         *
         * Flow:
         *   1. Emit `save-all` on `VIEWER_MANAGER` so plugins can hook last-
         *      minute persistence (mirror of the per-viewer `save-annotations`
         *      pattern).
         *   2. Drain every CRUD resource's outbox via
         *      `IO_PIPELINE.flushAllResources()` so pending per-element edits
         *      settle before we snapshot bundles.
         *   3. Dispatch bundles via
         *      `flushBundleExport({ skipFileFallback: true })` so a remote
         *      refusal surfaces as an error instead of silently producing a
         *      local file (that's what Export is for).
         *   4. Surface the outcome via the global toast / notifier.
         */
        save: async function () {
            // Case A — nothing configured remotely. Auto-degrade to Export
            // (the user wanted a "save" verb and otherwise gets nothing
            // visible), but tell them what we're doing so the file download
            // isn't a surprise.
            if (!IO_PIPELINE.hasRemoteBundleSinks()) {
                Dialogs.show($.t("main.bar.saveDegradedToExport"), 5000, Dialogs.MSG_INFO);
                return UTILITIES.export();
            }

            const showLoading = USER_INTERFACE?.Loading?.show;
            try { showLoading?.(true); } catch (_) { /* no-op */ }
            try {
                try {
                    VIEWER_MANAGER?.raiseEvent?.("save-all", { source: "global-save" });
                } catch (_) { /* best-effort lifecycle hook */ }

                const crudResults = await IO_PIPELINE.flushAllResources();
                const bundleResults = await IO_PIPELINE.flushBundleExport({ skipFileFallback: true });

                const all = [...crudResults, ...bundleResults];
                const refused = all.filter(r => !r.ok);
                if (refused.length === 0) {
                    // Case B — happy path, everything persisted.
                    Dialogs.show($.t("main.bar.saveOk"), 3000, Dialogs.MSG_SUCCESS);
                    APPLICATION_CONTEXT.__cache.dirty = false;
                } else if (refused.length === all.length) {
                    // Case C — every destination refused. Don't silently fall
                    // back to file-download (that's Export's job), but DO
                    // remind the user that Export is their escape hatch.
                    Dialogs.show($.t("main.bar.saveFailed"), 8000, Dialogs.MSG_ERR);
                } else {
                    // Case D — some destinations refused. The other ones got
                    // through; mark the session clean BUT recommend Export so
                    // the user has a complete local copy of whatever the
                    // remote refused to take.
                    Dialogs.show($.t("main.bar.savePartial"), 6000, Dialogs.MSG_WARN);
                    APPLICATION_CONTEXT.__cache.dirty = false;
                }
            } finally {
                try { showLoading?.(false); } catch (_) { /* no-op */ }
            }
        },

        /**
         * Clone the viewer to a new window, only two windows can be shown at the time.
         */
        clone: async function () {
            console.error('This method is not working properly, exitting..');
            return;

            if (window.opener) {
                return;
            }

            let ctx = UI.FloatingWindow.getExternal('synchronized-view');
            if (ctx) {
                ctx.focus();
                return;
            }
            let x = window.innerWidth / 2, y = window.innerHeight;
            window.resizeTo(x, y);
            const result = UI.FloatingWindow.openExternal({
                id: 'synchronized-view',
                title: "Loading...",
                width: x,
                height: y,
                externalProps: {
                    content: await UTILITIES.getForm(),
                }
            });
            if (!result?.context) {
                Dialogs.show($.t('messages.modalWindowBlocked', {
                    title: "Loading...",
                    action: "UTILITIES.clone(); Dialogs.hide();"
                }), 15000, Dialogs.MSG_WARN);
            }
        },

        setDirty: () => APPLICATION_CONTEXT.__cache.dirty = true,

        /**
         * Refresh the page and reload the viewer, optionally limiting which plugins are included.
         * @param {string[]|undefined} [includedPluginsList] - IDs of plugins to include; current active if omitted.
         * @returns {Promise<void>}
         */
        refreshPage: async function (includedPluginsList: string[] | undefined = undefined) {
            if (APPLICATION_CONTEXT.__cache.dirty) {
                Dialogs.show($.t('messages.warnPageReload', {
                    onExport: "UTILITIES.export();",
                    onRefresh: "APPLICATION_CONTEXT.__cache.dirty = false; UTILITIES.refreshPage();"
                }), 15000, Dialogs.MSG_WARN);
                return;
            }

            if (!UTILITIES.storePageState(includedPluginsList)) {
                Dialogs.show($.t('messages.warnPageReloadFailed'), 4000, Dialogs.MSG_WARN);
                USER_INTERFACE.Loading.show(true);
                await UTILITIES.sleep(3800);
            }
            window.location.replace(APPLICATION_CONTEXT.url);
        },

        /**
         * Download a string as a file via a temporary link element.
         */
        downloadAsFile: function (filename: string, content: string) {
            let data = new Blob([content], { type: 'text/plain' });
            let downloadURL = window.URL.createObjectURL(data);
            let elem = document.getElementById('link-download-helper') as HTMLAnchorElement;
            elem.href = downloadURL;
            elem.setAttribute('download', filename);
            elem.click();
            URL.revokeObjectURL(downloadURL);
        },

        /**
         * Open a file picker and read the selected file, then call the provided callback with the result.
         * @param onUploaded - Callback invoked with file contents.
         * @param accept - Accept attribute (e.g., "image/png, image/jpeg").
         *   See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#unique_file_type_specifiers
         * @param mode - Read as text or as ArrayBuffer.
         */
        uploadFile: async function (onUploaded: (arg0: (string | ArrayBuffer)) => void, accept = ".json", mode = "text") {
            const uploader = $("#file-upload-helper");
            uploader.attr('accept', accept);
            uploader.on('change', (e: JQuery.ChangeEvent) => {
                UTILITIES.readFileUploadEvent(e, mode).then(onUploaded as any).catch(onUploaded);
                uploader.val('');
                uploader.off('change');
            });
            uploader.trigger("click");
        },

        /**
         * Handle an input[type=file] change event and read the selected file.
         * @param {Event} e - Change event from a file input.
         * @param {("text"|"bytes")} [mode="text"] - Read as text or as ArrayBuffer.
         * @returns {Promise<string|ArrayBuffer>} Resolves with file contents.
         */
        readFileUploadEvent: function (e: Event, mode = "text") {
            return new Promise((resolve, reject) => {
                let file = e.currentTarget.files?.[0];
                if (!file) return reject("Invalid input file: no file.");
                const fileReader = new FileReader();
                fileReader.onload = ev => resolve(ev.target?.result as string | ArrayBuffer);

                if (mode === "text") fileReader.readAsText(file);
                else if (mode === "bytes") fileReader.readAsArrayBuffer(file);
                else throw "Invalid read file mode " + mode;
            });
        },

        //TODO: make this a normal standard UI api (open / focus / inline)
        /**
         * Open or focus a simple debugging window rendered via Dialogs.
         * @param {string} [html=""] - Optional HTML content to insert.
         * @returns {Window|null} Window object of the debugging modal, or null if failed.
         */
        openDebuggingWindow: function (html: string = '') {
            let ctx = UI.FloatingWindow.getExternal('__xopat__debug__window__');
            if (ctx) {
                ctx.focus();
                return ctx.context?.window || null;
            }

            const result = UI.FloatingWindow.openExternal({
                id: '__xopat__debug__window__',
                title: 'Debugging Window',
                width: 450,
                height: 250,
                externalProps: {
                    content: html,
                }
            });
            const childWindow = result.context?.window;
            if (!childWindow) {
                return null;
            }

            return childWindow;
        },

        /**
         * Check if value is a image-like interpretable object (type ImageLike)
         */
        isImageLike: function (value: unknown): value is ImageLike {
            return (
                value instanceof HTMLImageElement ||
                value instanceof HTMLCanvasElement ||
                value instanceof CanvasRenderingContext2D ||
                value instanceof Blob ||
                isImageLikeString(value)
            );
        },

        /**
         * Convert image-like object to an HTMLImageElement or HTMLCanvasElement for DOM rendering.
         */
        imageLikeToImage: async function (imageLike: ImageLike): Promise<HTMLImageElement | HTMLCanvasElement> {
            if (imageLike instanceof HTMLImageElement) return imageLike;
            if (imageLike instanceof HTMLCanvasElement) return imageLike;
            if (imageLike instanceof CanvasRenderingContext2D) return imageLike.canvas;

            if (imageLike instanceof Blob) {
                return await (OpenSeadragon as any).converter.convert({}, imageLike, "rasterBlob", "image");
            }

            if (typeof imageLike === "string") {
                const src = imageLike.trim();

                if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(src)) {
                    return await loadImageElement(src);
                }

                if (/^blob:/i.test(src) || /^https?:\/\//i.test(src) || /^\/[^/]/.test(src) || /^\.\.?\//.test(src)) {
                    return await loadImageElement(src);
                }

                throw new Error("String value is not a supported image source.");
            }

            throw new Error("Invalid imageLike type.");
        },

        /**
         * Convert image-like object to a data url
         */
        imageLikeToDataUrl: async function (
            imageLike: ImageLike,
            options?: { mimeType?: string; quality?: number }
        ): Promise<string> {
            const mimeType = options?.mimeType || "image/png";

            if (typeof imageLike === "string") {
                const src = imageLike.trim();

                if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(src)) {
                    return src;
                }

                if (/^blob:/i.test(src) || /^https?:\/\//i.test(src) || /^\/[^/]/.test(src) || /^\.\.?\//.test(src)) {
                    const image = await loadImageElement(src);
                    const canvas = document.createElement("canvas");
                    canvas.width = image.naturalWidth || image.width;
                    canvas.height = image.naturalHeight || image.height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) throw new Error("Failed to create canvas context.");
                    ctx.drawImage(image, 0, 0);
                    return canvasToDataUrl(canvas, mimeType, options?.quality);
                }

                throw new Error("String value is not a supported image source.");
            }

            if (imageLike instanceof HTMLCanvasElement) {
                return canvasToDataUrl(imageLike, mimeType, options?.quality);
            }

            if (imageLike instanceof CanvasRenderingContext2D) {
                return canvasToDataUrl(imageLike.canvas, mimeType, options?.quality);
            }

            if (imageLike instanceof HTMLImageElement) {
                const canvas = document.createElement("canvas");
                canvas.width = imageLike.naturalWidth || imageLike.width;
                canvas.height = imageLike.naturalHeight || imageLike.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Failed to create canvas context.");
                ctx.drawImage(imageLike, 0, 0);
                return canvasToDataUrl(canvas, mimeType, options?.quality);
            }

            if (imageLike instanceof Blob) {
                if (imageLike.type.startsWith("image/")) {
                    return await blobToDataUrl(imageLike);
                }

                const image = await UTILITIES.imageLikeToImage(imageLike);
                if (image instanceof HTMLCanvasElement) {
                    return canvasToDataUrl(image, mimeType, options?.quality);
                }

                const canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Failed to create canvas context.");
                ctx.drawImage(image, 0, 0);
                return canvasToDataUrl(canvas, mimeType, options?.quality);
            }

            throw new Error("Invalid imageLike type.");
        },

        /**
         * Get the date as ISO string (DD/MM/YYYY by default).
         */
        todayISO: function (separator: string = "/") {
            return new Date().toJSON().slice(0, 10).split('-').reverse().join(separator);
        },

        /**
         * Get the current date in ISO order (YYYY/MM/DD by default).
         */
        todayISOReversed: function (separator: string = "/") {
            return new Date().toJSON().slice(0, 10).split('-').join(separator);
        },

        /**
         * Safely coerce various JSON-like values into a boolean.
         * Treats strings as true unless they equal "false" (case-insensitive) or are empty.
         * Numbers are coerced by JavaScript truthiness, undefined falls back to defaultValue.
         */
        isJSONBoolean: function (value: any, defaultValue: boolean) {
            return (defaultValue && value === undefined) || (value && (typeof value !== "string" || value.trim().toLocaleLowerCase() !== "false"));
        },

        /**
         * Convert a function into a throttled version that executes at most once per delay ms.
         * Usage:
         *   const throttled = UTILITIES.makeThrottled(fn, 60);
         *   throttled.finish(); // flush pending call immediately
         * @returns Throttled function with an extra method finish():void to flush the last pending call.
         */
        makeThrottled: function (callback: Function, delay: number) {
            let lastCallTime = 0;
            let timeoutId: null | number = null;
            let pendingArgs: null | any[] = null;

            const invoke = () => {
                timeoutId = null;
                lastCallTime = Date.now();
                if (pendingArgs) {
                    callback(...pendingArgs);
                    pendingArgs = null;
                }
            };

            const wrapper = (...args: any[]) => {
                const now = Date.now();

                if (!lastCallTime || now - lastCallTime >= delay) {
                    // Execute immediately if outside the throttling window
                    lastCallTime = now;
                    callback(...args);
                } else {
                    // Skip this call but store arguments for the next possible execution
                    pendingArgs = args;

                    if (!timeoutId) {
                        timeoutId = setTimeout(invoke, delay - (now - lastCallTime));
                    }
                }
            };

            wrapper.finish = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    invoke();
                }
            };

            return wrapper;
        },

        /**
         * Sleep for a given number of milliseconds.
         */
        sleep: async function (ms: number | undefined = undefined) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * Set the App theme
         * @param {?string} theme primer_css theme
         */
        updateTheme: USER_INTERFACE.Tools.changeTheme,

        /**
         * Create a serialized viewer configuration JSON string for export or sharing.
         * @param {boolean} [withCookies=false] - Include cookies in the params.
         * @param {boolean} [staticPreview=false] - Produce a static preview configuration.
         * @returns {string} JSON string representing the current application configuration.
         */
        serializeAppConfig: function (withCookies = false, staticPreview = false) {
            //TODO consider bypassCache etc...

            //delete unnecessary data, copy params so that overrides do not affect current session
            const data = { ...APPLICATION_CONTEXT.config } as any;
            data.params = { ...APPLICATION_CONTEXT.config.params };
            delete data.defaultParams;

            // Merge live shader cache/state from every viewer's renderer back into
            // the structural background+visualizations. The renderer keeps its own
            // copies of shader configs and no longer mutates APPLICATION_CONTEXT.config,
            // so without this the export drops user edits (opacity, colormap, …).
            // serializeScene() handles multi-viewport, implicit-identity backgrounds,
            // structural appends, and sanitized-id mapping. Active indices are already
            // covered by data.params via setOption.
            const scene = serializeScene();
            data.background = scene.background;
            data.visualizations = scene.visualizations;

            if (staticPreview) data.params.isStaticPreview = true;
            if (!withCookies) data.params.bypassCookies = true;
            data.params.bypassCacheLoadTime = true;

            // Canonical viewport snapshot (same ViewportSetup shape params.viewport expects).
            const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(Boolean);
            if (viewers.length <= 1) {
                const v = viewers[0] || VIEWER;
                data.params.viewport = snapshotViewport(v);
            } else {
                data.params.viewport = viewers.map((v: OpenSeadragon.Viewer) => snapshotViewport(v));
            }

            for (const [k, v] of Object.entries(data.params)) {
                if (typeof v === "string") {
                    const s = v.trim();
                    // cheap + safe: only try objects/arrays
                    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
                        try { data.params[k] = JSON.parse(s); } catch (_) { }
                    }
                }
            }

            //by default omit underscore or any rendering entities using the replacer below
            return JSON.stringify(data, OpenSeadragon.FlexRenderer.jsonReplacer);
        },

        /**
         * Merge one viewer's live renderer state (shader type/cache/state,
         * layer order) back into APPLICATION_CONTEXT.config, scoped to the
         * bg entry + visualization that viewer renders. Used by code paths
         * that mutate renderer configs without firing renderer events
         * (e.g. importLiveVisualization's rebuild) so the structural config
         * keeps mirroring the renderer; live-config-sync.ts covers evented
         * edits automatically.
         * @param {OpenSeadragon.Viewer} viewer
         */
        syncViewerConfigFromRenderer: function (viewer: OpenSeadragon.Viewer) {
            mergeViewerLiveIntoConfig(viewer, APPLICATION_CONTEXT._dangerouslyAccessConfig());
        },

        /**
         * Get an auto-submitting HTML form+script that redirects to the viewer with current session data.
         * @param customAttributes - Extra raw HTML attributes or inputs to include in the form.
         * @param includedPluginsList - Plugin IDs to include; defaults to current active set.
         * @param withCookies - Include cookies in export payload.
         */
        getForm: async function (customAttributes: string = "", includedPluginsList: string[] | undefined = undefined, withCookies: boolean = false) {
            const url = (APPLICATION_CONTEXT.url.startsWith('http') ? "" : "http://") + APPLICATION_CONTEXT.url;

            if (!APPLICATION_CONTEXT.env.server.supportsPost) {
                return `
    <form method="POST" id="redirect" action="${url}#${encodeURI(UTILITIES.serializeAppConfig(withCookies, true))}">
        <input type="hidden" id="visualization" name="visualization">
        ${customAttributes}
        <input type="submit" value="">
        </form>
    <script type="text/javascript">const form = document.getElementById("redirect").submit();<\/script>`;
            }

            const { app, data } = await UTILITIES.serializeApp(includedPluginsList, withCookies, true);
            data.visualization = app;

            let form = `
    <form method="POST" id="redirect" action="${url}">
        ${customAttributes}
        <input type="submit" value="">
    </form>
    <script type="text/javascript">
        const form = document.getElementById("redirect");
        let node;`;

            function addExport(key: string, data: any) {
                form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", "${key}");
node.setAttribute("value", JSON.stringify(${JSON.stringify(data)}));
form.appendChild(node);`;
            }

            for (let id in data) {
                // dots seem to be reserved names therefore use IDs differently
                const sets = id.split('.'), dataItem = data[id];
                // namespaced export within "modules" and "plugins"
                if (sets.length === 1) {
                    //handpicked allowed namespaces
                    if (id === "visualization") {
                        addExport(id, dataItem);
                    } else if (id === "module" || id === "plugin") {
                        if (typeof dataItem === "object") {  //nested object
                            for (let nId in dataItem) addExport(`${id}[${nId}]`, dataItem[nId]);
                        } else {  //plain
                            addExport(id, dataItem);
                        }
                    } else {
                        console.error("Only 'visualization', 'module' and 'plugin' is allowed top-level object. Not included in export. Used:", id);
                    }
                } else if (sets.length > 1) {
                    //namespaced in id, backward compatibility
                    addExport(`${sets.shift()}[${sets.join('.')}]`, dataItem);
                }
            }

            return `${form}
form.submit();
<\/script>`;
        },

        /**
         * Allows changing focus state artificially
         */
        setIsCanvasFocused: function (focused: boolean) {
            focusOnViewer = focused;
        },

        /**
         * Sync live multi-view selection back into session params so export can directly
         * serialize APPLICATION_CONTEXT.config.params without reconstructing viewer state.
         *
         * Note: activeBackgroundIndex currently cannot represent blank viewer slots, so only
         * viewers with a resolved background are persisted.
         */
        syncOpenedViewersToSession: function () {
            const viewers = (VIEWER_MANAGER.viewers || []).filter(Boolean);
            const backgrounds = Array.isArray(APPLICATION_CONTEXT.config.background) ? APPLICATION_CONTEXT.config.background : [];
            const visualizations = Array.isArray(APPLICATION_CONTEXT.config.visualizations) ? APPLICATION_CONTEXT.config.visualizations : [];

            const getBackgroundConfig = (viewer: OpenSeadragon.Viewer) => {
                const ref = viewer.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background");
                if (ref) return ref;

                const count = viewer.world?.getItemCount?.() || 0;
                for (let i = 0; i < count; i++) {
                    const cfg = viewer.world.getItemAt(i)?.getConfig?.("background");
                    if (cfg) return cfg;
                }
                return undefined;
            };

            const getVisualizationConfig = (viewer: OpenSeadragon.Viewer) => {
                const count = viewer.world?.getItemCount?.() || 0;
                for (let i = 0; i < count; i++) {
                    const cfg = viewer.world.getItemAt(i)?.getConfig?.("visualization");
                    if (cfg) return cfg;
                }
                return undefined;
            };

            const findVisualizationIndex = (vizCfg: any) => {
                if (!vizCfg) return undefined;
                const idx = visualizations.findIndex((viz: any) =>
                    viz === vizCfg ||
                    (viz?.id !== undefined && vizCfg?.id !== undefined && viz.id === vizCfg.id)
                );
                return idx >= 0 ? idx : undefined;
            };

            const resolved = viewers
                .map((viewer: OpenSeadragon.Viewer) => {
                    const bgCfg = getBackgroundConfig(viewer);
                    // Identity first: `configureOpenedItem` stores
                    // `cfg.background[bgIdx]` directly on the tile via
                    // `getConfig("background")`, so the viewer's bg is a
                    // live reference into this array. `sameBackground`
                    // (id-equality) collapses distinct slots that share a
                    // `dataReference` — every viewer would resolve to the
                    // first matching index and the per-slot
                    // `visualizationIndex` write below would overwrite
                    // slot 0 for both. Reference equality picks the
                    // correct slot; fall back to id-equality only if no
                    // direct reference is found.
                    let bgIndex = bgCfg
                        ? backgrounds.findIndex((bg: BackgroundItem | BackgroundConfig) => bg === bgCfg)
                        : -1;
                    if (bgIndex < 0 && bgCfg) {
                        bgIndex = backgrounds.findIndex((bg: BackgroundItem | BackgroundConfig) => APPLICATION_CONTEXT.sameBackground(bg, bgCfg));
                    }
                    const vizIndex = findVisualizationIndex(getVisualizationConfig(viewer));
                    return {
                        bgIndex: bgIndex >= 0 ? bgIndex : undefined,
                        vizIndex,
                    };
                })
                .filter(({ bgIndex, vizIndex }: { bgIndex: number | undefined, vizIndex: number | undefined }) => bgIndex !== undefined || vizIndex !== undefined);

            const activeBackgroundIndex = resolved
                .map(({ bgIndex }: { bgIndex: number | undefined }) => bgIndex)
                .filter((value: number | undefined) => Number.isInteger(value));

            APPLICATION_CONTEXT.setOption(
                "activeBackgroundIndex",
                activeBackgroundIndex.length > 0 ? activeBackgroundIndex : undefined,
            );

            // Per-viewer viz selection lives on each background entry as
            // `visualizationIndex`. Sync ONLY positive findings: the absence
            // of a viz-tagged world item is NOT evidence of "no
            // visualization" — a visualization whose shaders reference only
            // data the background already opened shares the bg tiled image,
            // so no separate viz tile ever exists. Writing `null` on absence
            // clobbered the freshly-applied selection at the end of every
            // open, which made the next viz-switch diff a noop and left the
            // old shader stack rendering (sticky-shader bug). The bg entry's
            // `visualizationIndex` is maintained authoritatively by the open
            // pipeline's vizSpec fold; clearing it is the fold's job.
            resolved.forEach(({ bgIndex, vizIndex }: { bgIndex: number | undefined, vizIndex: number | undefined }) => {
                if (!Number.isInteger(bgIndex)) return;
                const bg: any = backgrounds[bgIndex as number];
                if (!bg) return;
                if (Number.isInteger(vizIndex)) {
                    bg.visualizationIndex = vizIndex as number;
                }
            });
        },

        getViewerIOContext: function (viewerOrUniqueId: any, stripSuffix = true) {
            if (!viewerOrUniqueId || !window.VIEWER_MANAGER) return undefined;

            let viewer: any;
            try {
                viewer = VIEWER_MANAGER.ensureViewer(viewerOrUniqueId);
            } catch (_) {
                return undefined;
            }
            if (!viewer) return undefined;

            const index = VIEWER_MANAGER.getViewerSlotIndex?.(viewer);
            const refItem = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
            const bgConfig = refItem?.getConfig?.('background') || {};
            const itemConfig = refItem?.getConfig?.() || {};
            const dataRef = itemConfig?.dataReference ?? bgConfig?.dataReference;
            const dataRegistry = APPLICATION_CONTEXT?.config?.data || [];
            const dataSpec = Number.isInteger(Number.parseInt(dataRef))
                ? dataRegistry[dataRef]
                : dataRef;

            const fileName = typeof dataSpec === 'string' ? this.fileNameFromPath(dataSpec, stripSuffix) : '';
            const uniqueId = String(viewer.uniqueId || '');
            const title = bgConfig?.name || itemConfig?.name || fileName || uniqueId || `Viewer ${Number.isInteger(index) ? index + 1 : 1}`;
            const label = `${title}${uniqueId && uniqueId !== title ? ` (${uniqueId})` : ''}`;

            return {
                viewer,
                index: Number.isInteger(index) ? index : -1,
                uniqueId,
                title,
                label,
                fileName,
                bgConfig,
                itemConfig,
                fileToken: uniqueId ? encodeURIComponent(uniqueId) : '',
            };
        },

        getOpenedViewerIOContexts: function (stripSuffix = true) {
            const viewers = Array.isArray(window.VIEWER_MANAGER?.viewers) ? VIEWER_MANAGER.viewers.filter(Boolean) : [];
            return viewers
                .map((viewer: any) => this.getViewerIOContext(viewer, stripSuffix))
                .filter(Boolean);
        },

        parseExportFileName: function (fileName: string) {
            const cleanName = String(fileName || '').trim();
            const withoutExt = cleanName.replace(/\.[^.]+$/, '');
            const exportPattern = /^(.*?)-(\d{4}-\d{2}-\d{2})-(all|annotations|presets)(-selection)?$/i;
            const exportMatch = withoutExt.match(exportPattern);
            const stem = exportMatch ? exportMatch[1] : withoutExt;
            const viewerMatch = stem?.match(/^(.*)--viewer-([^/]+)$/);

            return {
                fileName: cleanName,
                withoutExt,
                stem,
                stemWithoutViewer: viewerMatch ? viewerMatch[1] : stem,
                viewerToken: viewerMatch ? viewerMatch[2] : undefined,
                date: exportMatch ? exportMatch[2] : undefined,
                kind: exportMatch ? exportMatch[3] : undefined,
                selectionSuffix: exportMatch ? exportMatch[4] : undefined,
            };
        },

        resolveOpenedViewerFromExportFileName: function (fileName: string) {
            const meta = this.parseExportFileName(fileName);
            const targets = this.getOpenedViewerIOContexts();

            if (!targets.length) {
                return {
                    target: null,
                    reason: 'No open viewers available.',
                    targets,
                    meta,
                };
            }

            if (meta.viewerToken) {
                try {
                    const uniqueId = decodeURIComponent(meta.viewerToken);
                    const viewer = VIEWER_MANAGER.getViewer(uniqueId, false);
                    if (viewer) {
                        return {
                            target: this.getViewerIOContext(viewer),
                            reason: `Matched "${fileName}" to viewer ${uniqueId}.`,
                            targets,
                            meta,
                            matchedBy: 'viewer-token',
                        };
                    }
                    return {
                        target: null,
                        reason: `This file targets viewer ${uniqueId}, but that viewer is not currently open.`,
                        targets,
                        meta,
                        matchedBy: 'viewer-token',
                    };
                } catch (error) {
                    return {
                        target: null,
                        reason: `The viewer target encoded in "${fileName}" could not be decoded.`,
                        targets,
                        meta,
                        matchedBy: 'viewer-token',
                        error,
                    };
                }
            }

            return {
                target: null,
                reason: `No explicit viewer target was found in "${fileName}".`,
                targets,
                meta,
            };
        }
    };

    // Tab-close guard for unsaved state. Any module that flips the dirty
    // flag via APPLICATION_CONTEXT.setDirty() (annotations, viewer-open
    // pipeline, inspector controllers, ...) gets the browser's native
    // "Leave site?" prompt for free. Modern browsers ignore custom
    // messages; both setters are still required for the prompt to show.
    // Embeddings that drive the viewer programmatically (e.g. notebooks)
    // can suppress the prompt entirely with params.bypassCloseConfirmation —
    // in that case we skip registering the listener altogether.
    if (!APPLICATION_CONTEXT.getOption('bypassCloseConfirmation')) {
        window.addEventListener('beforeunload', (event) => {
            if (!APPLICATION_CONTEXT.__cache.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    /**
     * Focuses all key press events and forwarding to OSD,
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer: boolean | OpenSeadragon.Viewer | null = true;
    function getIsViewerFocused() {
        // TODO TEST!!!
        const focusedElement = document.activeElement as HTMLElement | null;
        if (!focusedElement) return focusOnViewer;
        const focusTyping = focusedElement.tagName === 'INPUT' ||
            focusedElement.tagName === 'TEXTAREA' ||
            (focusedElement as HTMLElement).isContentEditable;
        return focusTyping ? null : focusOnViewer;
    }

    document.addEventListener('keydown', function (e) {
        (e as any).focusCanvas = getIsViewerFocused();
        /**
         * @property {KeyboardEvent} e
         * @property {Viewer} e.focusCanvas the viewer this event belongs to
         * @memberof Viewer_MANAGER
         * @event keydown
         */
        VIEWER_MANAGER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function (e) {
        (e as any).focusCanvas = getIsViewerFocused();
        /**
         * @property {KeyboardEvent} e
         * @property {Viewer} e.focusCanvas the viewer this event belongs to
         * @memberof Viewer_MANAGER
         * @event key-up
         */
        VIEWER_MANAGER.raiseEvent('key-up', e);
    });
    //consider global mouseup/down events. or maybe not - clicking is
    // contextual and is enough to implement listeners on elements (unlike key hits)...
    // document.addEventListener('mouseup', function(e) {
    //     e.focusCanvas = focusOnViewer;
    //     VIEWER.raiseEvent('mouse-up', e);
    // });

    /**
     * Resolve the explicit, author-given background id for a viewer's SLOT,
     * i.e. `config.background[activeBackgroundIndex[slot]].id`. This is the
     * authoritative identity: two viewports backed by the same data but mounted
     * on distinct background entries (distinct `id`s) must get distinct unique
     * ids, regardless of which `getConfig("background")` happens to be attached
     * to the (potentially shared) world item. Returns undefined when the slot
     * or the per-slot selection can't be resolved yet (boot/transient), so the
     * caller falls back to the world-item lookup.
     */
    function explicitSlotBackgroundId(viewer: OpenSeadragon.Viewer): string | undefined {
        try {
            const vm: any = (window as any).VIEWER_MANAGER;
            const slot: number = vm?.viewers?.indexOf?.(viewer) ?? -1;
            if (!(slot >= 0)) return undefined;
            const sel = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
            const arr: any[] | null = Array.isArray(sel) ? sel : (Number.isInteger(sel) ? [sel] : null);
            if (!arr) return undefined;
            const idx = arr[slot];
            const backgrounds: any[] = Array.isArray(APPLICATION_CONTEXT.config.background) ? APPLICATION_CONTEXT.config.background : [];
            const bg = Number.isInteger(idx) ? backgrounds[idx as number] : undefined;
            if (!bg || typeof bg.id !== "string") return undefined;
            // Virtual-region children resolve to their parent slide so identity
            // (uniqueId / IO bundle key) is the un-split parent in EVERY mode —
            // side-by-side selects child indices, but their data must still flow
            // to the parent. `virtualOf` is the parent BACKGROUND id (the IO
            // keying axis), not the parent data id.
            return typeof bg.virtualOf === "string" ? bg.virtualOf : bg.id;
        } catch (_e) {
            return undefined;
        }
    }

    function findViewerUniqueId(viewer: OpenSeadragon.Viewer): UniqueViewerId | undefined {
        // Once we've locked the authoritative (explicit per-slot) id, reuse it.
        if (viewer.__cachedUUID && viewer.__uuidExplicit) return viewer.__cachedUUID;

        // Empty world is transient during reset/boot — return undefined
        // silently instead of the warn+auto-generate path below.
        if (!viewer.world || viewer.world.getItemCount() === 0) return viewer.__cachedUUID || undefined;

        // Authoritative: the explicit per-slot background id. Honours distinct
        // author-assigned `id`s even when two slots share the same data (whose
        // shared world-item config would otherwise collapse both to one id).
        // Re-attempted until it resolves (the per-slot selection may commit
        // slightly after the first read), then locked via `__uuidExplicit` so
        // a transient boot-time fallback id cannot shadow it.
        const explicit = explicitSlotBackgroundId(viewer);
        if (explicit) {
            viewer.__uuidExplicit = true;
            return (viewer.__cachedUUID = explicit);
        }

        // Non-authoritative fallback (kept cached as before for stability).
        if (viewer.__cachedUUID) return viewer.__cachedUUID;

        let result = viewer.__cachedUUID;
        let firstItem = null;
        for (let itemIndex = 0; itemIndex < viewer.world.getItemCount(); itemIndex++) {
            const item: OpenSeadragon.TiledImage = viewer.world.getItemAt(itemIndex);
            const config = item?.getConfig("background");
            if (config) {
                // Same parent redirect as explicitSlotBackgroundId (virtual children → parent).
                const id = typeof config.virtualOf === "string" ? config.virtualOf : config.id;
                viewer.__cachedUUID = id;
                return id;
            }
            if (!firstItem) {
                firstItem = item;
            }
        }

        // Valid state - nothing opened. Cache so subsequent reads stay stable
        // across transient empty-world windows (e.g. _resetViewer raise).
        if (viewer.world.getItemCount() === 1 && firstItem && firstItem.source instanceof OpenSeadragon.EmptyTileSource) {
            return viewer.__cachedUUID = '__empty__';
        }

        const path = APPLICATION_CONTEXT.config.data[firstItem?.getConfig()?.dataReference]
            || firstItem?.source.url || "--unknown--";
        result = viewer.__cachedUUID = UTILITIES.generateID(path);
        console.warn('Viewer has no unique ID! Attempt to create one.', result);
        return result;
    }

    /**
     * @property {UniqueViewerId} uniqueId
     * @memberof OpenSeadragon.Viewer
     */
    Object.defineProperty(OpenSeadragon.Viewer.prototype, "uniqueId", {
        get: function () {
            return findViewerUniqueId(this);
        }
    });

    /**
     * @property {function} getMenu
     * @method
     * @memberof OpenSeadragon.Viewer
     * @return {RightSideViewerMenu|undefined}
     */
    OpenSeadragon.Viewer.prototype.getMenu = function () {
        return VIEWER_MANAGER.getMenu(this);
    };

    /**
     * Monkey-patches drawer/renderer methods to log the flex-renderer init/reload sequence.
     * Enabled by APPLICATION_CONTEXT.getOption("webglDebugMode").
     * Each log line is tagged with [flex:<drawer>] so the full transcript is grep-friendly.
     */
    function installFlexRendererDiagnostics(viewer: OpenSeadragon.Viewer) {
        const seq = (() => { let i = 0; return () => String(++i).padStart(3, "0"); })();
        const log = (tag: string, msg: string, data?: any) => {
            if (data !== undefined) console.log(`[flex:${tag}] #${seq()} ${msg}`, data);
            else console.log(`[flex:${tag}] #${seq()} ${msg}`);
        };

        const instrumentDrawer = (drawer: any, tag: string) => {
            if (!drawer || drawer.__xopatInstrumented) return;
            drawer.__xopatInstrumented = true;

            const summarize = () => ({
                worldCount: drawer.viewer?.world?.getItemCount?.() ?? null,
                canvas: drawer.canvas ? `${drawer.canvas.width}x${drawer.canvas.height}` : null,
                configuredExternally: drawer._configuredExternally,
                suspendDepth: drawer._suspendRenderingDepth,
                pendingRebuild: !!drawer._pendingRebuildRequest,
                shaders: Object.keys(drawer.renderer?._shaders || {}),
                shaderOrder: drawer.renderer?._shadersOrder,
            });

            const wrap = (name: string, extra?: (args: any[]) => any) => {
                const orig = drawer[name];
                if (typeof orig !== "function") return;
                drawer[name] = function (...args: any[]) {
                    log(tag, `${name} CALL`, { args: extra ? extra(args) : args, state: summarize() });
                    try {
                        const r = orig.apply(this, args);
                        log(tag, `${name} RET`, { state: summarize() });
                        return r;
                    } catch (e) {
                        log(tag, `${name} THREW`, { error: String(e), state: summarize() });
                        throw e;
                    }
                };
            };

            wrap("overrideConfigureAll", args => ({
                shaderIds: args[0] ? Object.keys(args[0]) : null,
                order: args[1],
            }));
            wrap("tiledImageCreated", args => ({
                idx: drawer.viewer?.world?.getIndexOfItem?.(args[0]),
                priorShaderId: args[0]?.__shaderConfig?.id,
            }));
            wrap("configureTiledImage", args => ({
                shaderId: args[1]?.id,
                shaderType: args[1]?.type,
            }));
            wrap("_requestRebuild", args => ({ timeout: args[0], force: args[1], bypassSuspend: args[2] }));
            wrap("suspendRendering", args => ({ reason: args[0] }));
            wrap("resumeRendering", args => ({ reason: args[0] }));

            // Classify each incoming shader-source-request so we can tell
            // whether the library short-circuited (int/descriptor) or fell
            // through to our resolver.
            const originalHandleShaderSourceRequest = drawer._handleShaderSourceRequest;
            if (typeof originalHandleShaderSourceRequest === "function") {
                drawer._handleShaderSourceRequest = function (request: any = {}) {
                    const entry = request.entry;
                    let branch = "resolver";
                    const directInt = Number.parseInt(entry, 10);
                    if (Number.isFinite(directInt) && String(directInt) === String(entry).trim()) {
                        branch = "integer";
                    } else if (entry && typeof entry === "object" && (
                        entry.tileSource !== undefined ||
                        entry.source !== undefined ||
                        entry.open !== undefined ||
                        entry.openOptions !== undefined
                    )) {
                        branch = "descriptor";
                    } else if (entry && typeof entry === "object" && entry.__xopatSourceRef) {
                        branch = "resolver(token)";
                    }
                    log(tag, "shader-source-request", {
                        branch,
                        shaderId: request.shaderId,
                        sourceIndex: request.sourceIndex,
                        reason: request.reason,
                        entryType: entry === null ? "null" : typeof entry,
                        loadKey: entry && entry.loadKey,
                    });
                    return originalHandleShaderSourceRequest.apply(this, arguments as any);
                };
            }

            const r = drawer.renderer;
            if (r) {
                r.addHandler("program-used", (e: any) => {
                    log(tag, "event program-used", {
                        name: e.name,
                        shaderIds: Object.keys(e.shaderLayers || {}),
                        state: summarize(),
                    });
                });
                r.addHandler("html-controls-created", (e: any) => {
                    log(tag, "event html-controls-created", {
                        shaderIds: Object.keys(e.shaderLayers || {}),
                    });
                });
                r.addHandler("visualization-change", (e: any) => {
                    log(tag, "event visualization-change", {
                        reason: e.reason,
                        order: e.snapshot?.order,
                    });
                });
            }

            // Observe world changes for this drawer's viewer
            drawer.viewer?.world?.addHandler("add-item", (e: any) => {
                log(tag, "world add-item", {
                    idx: drawer.viewer.world.getIndexOfItem(e.item),
                    count: drawer.viewer.world.getItemCount(),
                });
            });
            drawer.viewer?.world?.addHandler("remove-item", (e: any) => {
                log(tag, "world remove-item", {
                    count: drawer.viewer.world.getItemCount(),
                });
            });
        };

        instrumentDrawer(viewer.drawer, "main");
        // Navigator drawer is sometimes created later; retry a few frames.
        let attempts = 0;
        const waitForNav = () => {
            const nd = (viewer.navigator as any)?.drawer;
            if (nd) {
                instrumentDrawer(nd, "nav");
            } else if (attempts++ < 30) {
                setTimeout(waitForNav, 50);
            } else {
                log("main", "navigator drawer never appeared (instrumentation skipped)");
            }
        };
        waitForNav();

        // Surface GL errors from either context so they're interleaved with the log.
        const tapGl = (gl: any, tag: string) => {
            if (!gl || gl.__xopatErrorTapInstalled) return;
            gl.__xopatErrorTapInstalled = true;
            const origGetError = gl.getError.bind(gl);
            // Can't easily hook every gl call; instead poll briefly around events below.
            (gl as any).__xopatGetError = origGetError;
        };
        tapGl(viewer.drawer?._gl, "main-gl");
        tapGl((viewer.navigator as any)?.drawer?._gl, "nav-gl");

        log("main", "instrumentation installed", {
            webglDebugMode: true,
            showNavigator: !!viewer.navigator,
        });
    }

    // 2) Manager that tracks the active viewer
    /**
     * Manages one or more OpenSeadragon viewers, keeps track of the active viewer,
     * and provides utilities to broadcast event handlers to all viewers.
     * The manager also owns the grid layout used to mount individual viewers.
     *
     * WARNING: Viewer `viewer.id` is not unique, it is just a string that is used to identify the viewer.
     * To reference an unique data session within the viewer, use viewer.uniqueId!
     * Viewer.id is not used publicly in the ViewerManager API at all.
     *
     * Exposed API is intended for application integration (e.g., via VIEWER_MANAGER in app.js).
     *
     * @class ViewerManager
     * @extends OpenSeadragon.EventSource
     * @property CONFIG - Application configuration - the input config from the viewer session initialization.
     * @property viewers - Ordered list of instantiated viewer instances.
     * @property broadcastEvents - Map of eventName to handlers+args registered for broadcasting.
     * @property active - Currently active viewer or null if none.
     * @property layout - Grid layout where viewers are mounted.
     */
    const ViewerManager = (window as any).ViewerManager = class extends OpenSeadragon.EventSource {
        CONFIG: typeof APPLICATION_CONTEXT.config;
        menu: any;
        viewers: OpenSeadragon.Viewer[];
        viewerMenus: Record<string, any>;
        broadcastEvents: Record<keyof OpenSeadragon.ViewerEventMap, Map<Function, any>>;
        active: OpenSeadragon.Viewer | null;
        layout: any;
        _singletonsKey: symbol;

        /**
         * Create a ViewerManager.
         * @param {object} CONFIG - Configuration bag with sanitized viewer params and session data.
         */
        constructor(CONFIG: typeof APPLICATION_CONTEXT.config) {
            super();
            // Before anything can subscribe: a throwing global-event handler must not
            // abort the raiseEvent dispatch loop and take the rest of the app with it.
            installEventIsolation(this, "VIEWER_MANAGER");
            this.CONFIG = CONFIG;
            this.menu = null;
            this.viewers = [];
            // Monotonic, never-reused grid-cell id counter. Cell ids MUST NOT be
            // derived from the (spliced, drifting) viewers array index — two live
            // viewers would then collide on `osd-<index>` and leave an empty ghost
            // grid cell (white area). See `add()`.
            this._cellSeq = 0;
            this.viewerMenus = {};
            this.broadcastEvents = {} as typeof this.broadcastEvents;
            this.active = null;
            this._singletonsKey = Symbol('singletons');

            // uniqueIds we have already warned about sharing across viewports.
            // See _warnOnDuplicateUniqueId — keyed by uniqueId, cleared on destroy
            // once fewer than two viewports share it so re-duplication re-warns.
            this._dupWarnedUids = new Set();
            // Generic, viewer-wide IO-collision guard. Two viewports opened on the
            // same data source share a uniqueId, and the IO pipeline scopes
            // per-viewer state by uniqueId — so both write to the same sink. Warn
            // once when that happens (affects any IO-capable plugin, not just one).
            this.addHandler('viewer-create', (e: any) => this._warnOnDuplicateUniqueId(e?.viewer));
            this.addHandler('viewer-destroy', (e: any) => {
                const uid = e?.uniqueId;
                if (!uid) return;
                // viewer-destroy fires before the viewer leaves this.viewers, so
                // exclude the departing one when counting the survivors.
                const remaining = this.viewers.filter((v: any) => v && v !== e.viewer && v.uniqueId === uid).length;
                if (remaining < 2) this._dupWarnedUids.delete(uid);
            });

            // layout container
            this.layout = new UI.StretchGrid({ cols: "auto", gap: "2px" });
            this.layout.attachTo(document.getElementById("osd")); // attach once

            // add initial viewer
            this.add(0, false);
            // this.setActive(0, 'initial');
            (window as any).LAYOUT.bindViewerManager?.();
            (window as any).LAYOUT.syncActiveViewerMobile?.();
        }

        _resolveViewer(v: number | string | OpenSeadragon.Viewer | undefined | null) {
            if (typeof v === "number") return this.viewers[v] || null;
            if (typeof v === "string") return this.getViewer(v) || null;
            return v || null;
        }

        /**
         * Warn (once) when a viewer shares its data-derived uniqueId with another
         * open viewport. Because the IO pipeline scopes per-viewer persistence by
         * uniqueId, two such viewports auto-save/export to the same sink and can
         * overwrite each other — a viewer-wide problem for any IO-capable plugin.
         * @param {OpenSeadragon.Viewer} viewer the freshly-created viewer
         */
        _warnOnDuplicateUniqueId(viewer: OpenSeadragon.Viewer | undefined | null) {
            const uid = (viewer as any)?.uniqueId;
            if (!uid || uid === '__empty__') return;
            const sharing = this.viewers.filter((v: any) => v && v.uniqueId === uid);
            if (sharing.length < 2) return;
            if (this._dupWarnedUids.has(uid)) return;
            this._dupWarnedUids.add(uid);

            const slots = sharing.map((v: any) => v.id).filter(Boolean).join(', ');
            Dialogs.show($.t('messages.viewerDuplicateDataSource', { slots }), 12000, Dialogs.MSG_WARN);
        }

        _syncActiveViewState() {
            this.viewers.forEach((vw: OpenSeadragon.Viewer, index: number) => {
                const isActive = vw === this.active;
                vw.container.classList.add("xo-viewer-host");
                vw.container.classList.toggle("active", isActive);
                vw.container.classList.toggle("xo-active-viewer", isActive);
                vw.container.setAttribute("data-viewer-index", String(index + 1));
                vw.container.setAttribute("data-active-viewer", isActive ? "true" : "false");
                vw.container.setAttribute("aria-current", isActive ? "true" : "false");
            });
        }

        _commitActive(v: OpenSeadragon.Viewer | null, reason = 'manager') {
            const previousViewer = this.active;
            if (previousViewer === v) {
                this._syncActiveViewState();
                return false;
            }

            this.active = v;
            this._syncActiveViewState();

            /**
             * Raised whenever the manager changes which viewer is considered active.
             * @param {OpenSeadragon.Viewer|null} viewer
             * @param {OpenSeadragon.Viewer|null} previousViewer
             * @param {string|undefined} uniqueId
             * @param {string|undefined} previousUniqueId
             * @param {number} index
             * @param {number} previousIndex
             * @param {string} reason
             * @event active-viewer-changed
             * @memberof VIEWER_MANAGER
             */
            this.raiseEvent('active-viewer-changed', {
                viewer: v,
                previousViewer,
                uniqueId: v?.uniqueId,
                previousUniqueId: previousViewer?.uniqueId,
                index: v ? this.viewers.indexOf(v) : -1,
                previousIndex: previousViewer ? this.viewers.indexOf(previousViewer) : -1,
                reason,
            });
            return true;
        }

        _wire(v: OpenSeadragon.Viewer) {
            const el = v.container;
            el.tabIndex = 0;

            //todo maybe rely on OSD events. Also, prevent changing the focus when a mouse is dragged and exits the area
            const set = () => this.setActive(v, 'interaction');
            // Side menus (and other UI overlays) are appended to the same cell
            // as the OSD container, so DOM gestures on them bubble up to
            // v.container. On mobile the side menu lives over the viewer and
            // taps on its controls would otherwise be captured as "focus this
            // viewer" — swallowing the click before the menu can act on it.
            // OSD's canvas-enter/canvas-press still cover real canvas gestures.
            const setFromDom = (e: Event) => {
                const target = e.target;
                if (target instanceof Element && target.closest('.ui-menu, .right-side-menu')) {
                    return;
                }
                set();
            };
            el.addEventListener("pointerdown", setFromDom);
            el.addEventListener("mouseenter", set);
            el.addEventListener("focusin", setFromDom);
            v.addHandler("canvas-enter", set);
            v.addHandler("canvas-press", set);

            v.addOnceHandler &&
            v.addOnceHandler("destroy", () => {
                if ((v as any).__managerDeleting) return;

                const wasActive = this.active === v;
                this.viewers = this.viewers.filter((x) => x !== v);

                if (wasActive) {
                    this._commitActive(this.viewers[0] || null, 'destroy');
                } else {
                    this._syncActiveViewState();
                }
            });
        }

        /**
         * Set the active viewer.
         * @param v - Index into the viewers array, unique ID, or a viewer instance.
         * @param reason - Why the active viewer is being changed.
         * @returns {boolean}
         */
        setActive(v: number | string | OpenSeadragon.Viewer | undefined, reason = 'manual') {
            const viewer = this._resolveViewer(v);
            if (!viewer) return false;
            return this._commitActive(viewer as OpenSeadragon.Viewer, reason);
        }

        /**
         * Get the currently active viewer instance.
         */
        get() {
            return this.active;
        }

        /**
         * Get the currently active viewer index.
         */
        getActiveIndex() {
            return this.active ? this.viewers.indexOf(this.active) : -1;
        }

        /**
         * Get the currently active viewer unique ID.
         */
        getActiveUniqueId() {
            return this.active?.uniqueId;
        }

        /**
         * Check if the provided viewer reference resolves to the current active viewer.
         */
        isActive(viewerOrUniqueId: ViewerLikeItem) {
            return !!viewerOrUniqueId && this._resolveViewer(viewerOrUniqueId) === this.active;
        }

        /**
         * Get viewer by ID. This method is usable only when the viewer the viewer is already loaded.
         * Honors the documented contract that callers may pass a transient `undefined` —
         * see `getViewerContext` for the slide-switch / RAF-deferred case.
         *
         * Note: `uniqueId` is data-derived (from `BackgroundConfig.id`), so when
         * multiple viewports are opened against the same slide they share the
         * same `uniqueId` and this method returns the **first** match. Callers
         * needing a specific viewport must keep the viewer reference directly,
         * or pass the OSD cellId (e.g. `osd-1`) which routes via the `v.id`
         * fallback.
         */
        getViewer(uniqueId: string | undefined, _warn = true): OpenSeadragon.Viewer | undefined {
            if (typeof uniqueId !== "string" || !uniqueId) return undefined;
            let viewer: OpenSeadragon.Viewer | undefined;
            if (uniqueId.startsWith("osd-")) {
                viewer = this.viewers.find(v => v.id === uniqueId);
                if (_warn && !viewer) {
                    console.warn(`Viewer with id ${uniqueId} not found, provided id is not UniqueViewerId. This might result in unexpected behavior.`);
                }
            } else {
                viewer = this.viewers.find(v => v.uniqueId === uniqueId);
            }
            return viewer;
        }

        /**
         * Get viewer reference for the configuration object
         */
        getViewerForConfig(config: any) {
            if (!config) return undefined;

            const dataRegistry = APPLICATION_CONTEXT.config.data;
            let receivedData = config.dataReference;

            // If it's a number, resolve it from the registry.
            // If it's already an object/string (Standalone), use it as is.
            if (typeof receivedData === "number") {
                receivedData = dataRegistry[receivedData];
            }

            if (!receivedData) return undefined;

            // Robust comparator for objects (UIDs) vs strings (Paths)
            let comparator = (a: any, b: any) => {
                if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
                    // Check if all keys in A match B (e.g. studyUID and seriesUID)
                    const keysA = Object.keys(a);
                    if (keysA.length === 0) return false;
                    return keysA.every(x => a[x] == b[x]);
                }
                return a === b;
            };

            for (let viewer of this.viewers) {
                // world.getItemAt(0) is usually the background layer
                for (let index = 0; index < viewer.world.getItemCount(); index++) {
                    const item = viewer.world.getItemAt(index);
                    const conf = item?.getConfig();
                    if (conf) {
                        let activeDataEl = conf.dataReference;
                        // If the viewer's internal config uses a numeric index, resolve it
                        if (typeof activeDataEl === "number") {
                            activeDataEl = dataRegistry[activeDataEl];
                        }

                        if (activeDataEl && comparator(receivedData, activeDataEl)) {
                            return viewer;
                        }
                    }
                }
            }
            return undefined;
        }

        /**
         * String-id slot lookup. Returns the slot index of the FIRST viewer
         * whose `uniqueId` (or `id`/cellId fallback) matches. Because
         * `uniqueId` is data-derived (see `findViewerUniqueId`), two viewports
         * opened against the same slide intentionally share `uniqueId` and
         * therefore this method cannot distinguish them. For per-viewer-instance
         * slot routing (selection slots, replay markers, per-viewer cursors),
         * use {@link getViewerSlotIndex} with the viewer reference instead.
         */
        getViewerIndex(uniqueId: string, _warn = true): number {
            let index = this.viewers.findIndex(v => v.uniqueId === uniqueId);
            if (index < 0) {
                index = this.viewers.findIndex(v => v.id === uniqueId);
                const fallback = this.viewers[index];
                if (fallback && _warn) {
                    console.warn(`Viewer with id ${uniqueId} not found, using fallback ${fallback.id} for ${fallback.uniqueId}`);
                }
            }
            return index;
        }

        /**
         * Slot index of a specific viewer instance. Unlike
         * {@link getViewerIndex}, this is per-viewer-instance and is *not*
         * fooled by viewers that share a data-derived `uniqueId` (i.e. multiple
         * viewports opening the same slide). Always prefer this when routing
         * per-viewer selection slots such as `activeBackgroundIndex` /
         * `activeVisualizationIndex`.
         */
        getViewerSlotIndex(viewer: OpenSeadragon.Viewer | undefined | null): number {
            if (!viewer) return -1;
            return this.viewers.indexOf(viewer);
        }

        /**
         * Helper method to get viewer instance from viewer-like argument.
         * Returns undefined if a string id is given and no viewer is registered
         * under that id (this happens during slide-switch transitions when an
         * older viewer's id is still held in closure by a UI subsystem). Callers
         * MUST treat undefined as "viewer is gone, skip this work".
         */
        ensureViewer(viewerOrUniqueId: ViewerLikeItem): OpenSeadragon.Viewer | undefined {
            if (!viewerOrUniqueId) throw new Error("No viewer or viewer id provided!");
            if (typeof viewerOrUniqueId === "string") {
                return this.getViewer(viewerOrUniqueId);
            }
            return viewerOrUniqueId;
        }

        /**
         * Create or replace a viewer at the given index and mount it into the grid layout.
         * Replaces existing viewer if present at that index.
         */
        /**
         * Tear down a grid cell + its right-menu that `add()` created before the
         * viewer failed to construct. Without this the cell is orphaned (present
         * in the DOM / layout, absent from `this.viewers`), invisible to every
         * slot-keyed lifecycle decision, and collides with the next `add`.
         */
        _discardOrphanCell(cellId: string) {
            const menu = this.viewerMenus[cellId];
            if (menu) {
                try { menu.destroy?.(); } catch (e) { console.warn('Orphan viewer menu destroy failed', e); }
                delete this.viewerMenus[cellId];
            }
            try { this.layout.removeById(cellId); } catch (e) { console.warn('Orphan cell removal failed', e); }
        }

        add(index: number, setActive = true) {
            if (this.viewers[index]) this.delete(index);

            // Cell id is a monotonic, never-reused token — NOT `osd-${index}`.
            // The viewers array is spliced (indices shift), so an index-derived
            // id collides after a delete+add and leaves a duplicate empty cell.
            const cellId = `osd-${this._cellSeq++}`;
            const navigatorId = cellId + "-navigator";
            const cell = this.layout.attachCell(cellId, index);
            this.menu = new UI.RightSideViewerMenu(cellId, navigatorId);
            // todo think of a better way of hosting menu within the viewer
            cell.append(this.menu.create());
            this.menu.onLayoutChange({ width: window.innerWidth });
            this.viewerMenus[cellId] = this.menu;

            const preferredWebGlVersion = APPLICATION_CONTEXT.getOption("webGlPreferredVersion");
            const flexDrawerOptions = {
                webGlPreferredVersion: preferredWebGlVersion,
                backgroundColor: APPLICATION_CONTEXT.getOption("backgroundColor"),
                debug: !!APPLICATION_CONTEXT.getOption("webglDebugMode"),
                // Share a single WebGL context across every FlexRenderer instance on the page
                // (main viewer, navigator, standalone drawers, isolated playground viewers).
                // Browsers cap concurrent WebGL contexts at ~16; on hosts like Jupyter that
                // spawn several viewers per cell we'd otherwise crash with "out of contexts"
                // and lose the oldest contexts to GC. FlexRenderer reuses the matching entry
                // when key + webGLPreferredVersion + canvasOptions agree.
                // TODO: temporarily disabled until fixed
                // sharedContextKey: "xopat-flex-renderer",
                interactive: true,
                htmlHandler: (shaderLayer, shaderConfig, htmlContext) => {
                    // Same teardown window as `htmlReset` below: a rebuild walking
                    // a placeholder/faulty layer can fire after `VIEWER_MANAGER.delete`
                    // cleared the menu slot, so `viewer.getMenu()` is undefined.
                    // Optional-chain instead of throwing an uncaught error.
                    viewer.getMenu()?.getShadersTab?.()?.createLayer?.(viewer, shaderLayer, shaderConfig, htmlContext);
                },
                // Invoked from inside `FlexRenderer.destroy()` during
                // `viewer.destroy()` — by that point `VIEWER_MANAGER.delete`
                // has already cleared the menu slot, so `viewer.getMenu()`
                // returns undefined. No-op cleanly instead of throwing
                // (the surrounding try/catch only logged a warning anyway).
                htmlReset: () => viewer.getMenu()?.getShadersTab?.()?.clearLayers?.(),
                httpAdapter: createHttpClientAdapter(),
            };

            const flexRendererClass = (window.OpenSeadragon as any).FlexRenderer;
            const renderingCapability = flexRendererClass && typeof flexRendererClass.ensureRuntimeSupport === "function"
                ? flexRendererClass.ensureRuntimeSupport({
                    webGLPreferredVersion: preferredWebGlVersion,
                    debug: !!APPLICATION_CONTEXT.getOption("webglDebugMode"),
                    throwOnFailure: false,
                })
                : { ok: false, error: "FlexRenderer self-test is not available." };
            (APPLICATION_CONTEXT as any).__renderingCapability = renderingCapability;

            const viewerOptions: Record<string, any> = {
                id: cellId, // mount into that grid cell
                navigatorId: navigatorId,
                prefixUrl: ENV.openSeadragonPrefix + "images",
                loadTilesWithAjax: true,
                splitHashDataForPost: true,
                subPixelRoundingForTransparency:
                    navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc") ?
                        window.OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                        window.OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
                debugMode: APPLICATION_CONTEXT.getOption("debugMode", false, false),
                maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount", undefined, false)
            };

            if (!renderingCapability.ok) {
                // The FlexRenderer self-test failed (WebGL2 unavailable or a
                // GPU/driver capability mismatch — seen on some mobile browsers).
                // No alternative renderer can drive the visualization pipeline, so
                // a viewer built here would fail to create any drawer, throw out of
                // `new ViewerManager()`, and cascade into an opaque "Unknown error"
                // with an endless spinner. Abort viewer creation instead and let
                // `beginApplicationLifecycle` report the cause cleanly (it reads
                // APPLICATION_CONTEXT.__renderingCapability, set just above).
                console.error('FlexRenderer runtime self-test failed; cannot create a viewer.', renderingCapability.error || renderingCapability);
                this._discardOrphanCell(cellId);
                return;
            }
            viewerOptions.drawer = 'flex-renderer';
            viewerOptions.drawerOptions = {
                'flex-renderer': flexDrawerOptions
            };

            let viewer: OpenSeadragon.Viewer;
            try {
                viewer = window.OpenSeadragon($.extend(
                    true,
                    ENV.openSeadragonConfiguration,
                    ENV.client.osdOptions,
                    viewerOptions
                ));
            } catch (e) {
                // The predictive self-test above passed (WebGL2 is present), but the
                // actual drawer/shader-program construction threw at runtime — most
                // commonly because the GPU advertises WebGL2 yet its fragment-uniform
                // budget (MAX_FRAGMENT_UNIFORM_VECTORS) is too small for the shader
                // pipeline. This is observed on low-end / older mobile GPUs.
                //
                // ensureRuntimeSupport() only predicts failures; it does not probe the
                // uniform budget, so it cannot catch this case. Left unguarded the throw
                // escapes `new ViewerManager()` (this.add(0) in the constructor) and
                // aborts initXOpat *before* `window.VIEWER_MANAGER` (app.ts) and
                // `APPLICATION_CONTEXT.beginApplicationLifecycle` are assigned, which then
                // cascades into opaque "Can't find variable: VIEWER_MANAGER" /
                // "beginApplicationLifecycle is not a function" failures across every
                // plugin and the DOMContentLoaded bootstrap.
                //
                // Degrade exactly like the self-test failure: record an `ok:false`
                // verdict so beginApplicationLifecycle reports the cause cleanly and
                // stops the loading spinner instead of leaving a broken half-booted app.
                const error = (e as any)?.message || e;
                (APPLICATION_CONTEXT as any).__renderingCapability = {
                    ok: false,
                    error: String(error || "WebGL renderer initialization failed."),
                };
                console.error('FlexRenderer viewer creation failed; cannot create a viewer.', e);
                this._discardOrphanCell(cellId);
                return;
            }
            (viewer as any).__renderingCapability = renderingCapability;

            // Install before the first `addHandler` below: everything registered
            // afterwards — core wiring, `broadcastHandler`, viewer singletons, and
            // plugins/modules calling `viewer.addHandler` directly — runs isolated,
            // so a faulting handler cannot abort `updateOnce` and kill the render loop.
            installEventIsolation(viewer, `viewer:${cellId}`);

            // Per-viewer broker for shader source (time-series) rebind requests.
            // The resolver must be installed on the drawer's options so the
            // flex-renderer dispatches scrub requests into xOpat instead of
            // blindly appending to viewer.world.
            const shaderSourceController = new ViewerShaderSourceController(viewer);
            (viewer as any).__shaderSourceController = shaderSourceController;
            // Per-viewer persisted faulty-source verdicts (see registry doc).
            (viewer as any).__faultySources = new ViewerFaultySourceRegistry(
                APPLICATION_CONTEXT.getOption("faultyTileThreshold", 5)
            );
            // Per-viewer focal-plane (z-stack) navigator. Swaps the active plane
            // on the reference tiled image without re-entering the open pipeline.
            (viewer as any).__depthController = new ViewerDepthController(viewer);
            // Per-viewer joystick navigation (mode toggled via the
            // core.viewport.toggleJoystick shortcut). No-op until the mode is on.
            (viewer as any).__joystickController = new ViewerJoystickController(viewer);
            const attachResolver = (drawer: any) => {
                if (!drawer || drawer.__xopatShaderResolverAttached) return;
                drawer.options = drawer.options || {};
                drawer.options.shaderSourceResolver = shaderSourceController.resolver;
                drawer.__xopatShaderResolverAttached = true;
            };
            attachResolver(viewer.drawer);
            let navResolverAttempts = 0;
            const waitForNavResolver = () => {
                const nd = (viewer.navigator as any)?.drawer;
                if (nd) {
                    attachResolver(nd);
                } else if (navResolverAttempts++ < 30) {
                    setTimeout(waitForNavResolver, 50);
                }
            };
            waitForNavResolver();

            if (APPLICATION_CONTEXT.getOption("webglDebugMode")) {
                installFlexRendererDiagnostics(viewer);
            }

            viewer.makeScalebar({
                pixelsPerMeter: 1,
                sizeAndTextRenderer: OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC.bind(null, "px"),
                stayInsideImage: false,
                location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
                xOffset: 5,
                yOffset: 10,
                backgroundColor: "rgba(255, 255, 255, 0.5)",
                fontSize: "small",
                barThickness: 2,
                destroy: false
            });
            if (!APPLICATION_CONTEXT.getInitialUiOption("scaleBar")) {
                viewer.scalebar.setActive(false);
            }

            // Opt the scalebar into AppBar.Chrome so the hide-UI button toggles it
            // alongside the rest of the chrome. Per-viewer id keeps multi-viewport
            // snapshot/restore correct. Live `_active` read avoids touching the
            // AppCache-backed VisibilityManager state used by the Settings checkbox.
            const scalebarChromeKey = `scalebar::${(viewer as any).uniqueId ?? index}`;
            (window as any).USER_INTERFACE?.AppBar?.Chrome?.register?.(scalebarChromeKey, {
                is:  () => !!(viewer as any).scalebar?._active,
                on:  () => (viewer as any).scalebar?.setActive(true),
                off: () => (viewer as any).scalebar?.setActive(false),
            });
            viewer.addOnceHandler?.("destroy", () => {
                (window as any).USER_INTERFACE?.AppBar?.Chrome?.unregister?.(scalebarChromeKey);
            });

            // Navigator visibility is owned by the right-side viewer
            // menu's "navigator" tab (rightSideViewerMenu.mjs) — closing
            // that tab is what hides the OSD navigator element. The tab
            // itself reads `getUiOption("navigator")` at boot for its
            // default open/closed state. No display-style hack here.

            // Canvas right-click → CanvasContextMenu registry → window.DropDown.
            // Plugins/modules contribute items via CanvasContextMenu.register(...);
            // when no provider returns items, no menu opens (parity with previous behavior).
            $(viewer.element).on('contextmenu', function (event: any) {
                const orig: MouseEvent = event.originalEvent || event;
                // Inner overlay (board panel, plugin HUD, …) already claimed this
                // contextmenu by calling preventDefault — don't double-open.
                if (orig.defaultPrevented) return;
                // Only fire on the OSD canvas surface; UI overlays appended to the
                // grid cell live outside viewer.canvas.
                const canvasEl: HTMLElement | undefined = (viewer as any).canvas;
                const target = orig.target as Node | null;
                if (canvasEl && target && !canvasEl.contains(target)) return;
                event.preventDefault();
                let osdPos: { x: number; y: number } = { x: 0, y: 0 };
                let pixelPos: { x: number; y: number } = { x: 0, y: 0 };
                try {
                    const rect = (viewer.element as HTMLElement).getBoundingClientRect();
                    const offsetX = orig.clientX - rect.left;
                    const offsetY = orig.clientY - rect.top;
                    const Pt = (window as any).OpenSeadragon?.Point;
                    if (Pt && viewer.viewport) {
                        const vp = viewer.viewport.pointFromPixel(new Pt(offsetX, offsetY));
                        osdPos = { x: vp.x, y: vp.y };
                        const tiledImage = viewer.world?.getItemAt?.(0);
                        if (tiledImage && typeof tiledImage.viewportToImageCoordinates === "function") {
                            const ip = tiledImage.viewportToImageCoordinates(vp);
                            pixelPos = { x: ip.x, y: ip.y };
                        } else {
                            pixelPos = osdPos;
                        }
                    }
                } catch (e) {
                    // best-effort: still hand the event to providers without coordinates
                }
                CanvasContextMenu.open({
                    event: orig,
                    viewer,
                    osdPosition: osdPos,
                    pixelPosition: pixelPos,
                    source: 'canvas',
                });
            });

            for (let event in this.broadcastEvents) {
                const eventList = this.broadcastEvents[event as keyof ViewerEventMap];
                for (let handler of eventList!.keys()) {
                    const hData = eventList!.get(handler);
                    viewer.addHandler(event as keyof ViewerEventMap, handler, hData.userData, hData.priority);
                }
            }

            // let _lastScroll = Date.now(), _scrollCount = 0, _currentScroll;
            // /**
            //  * From https://github.com/openseadragon/openseadragon/issues/1690
            //  * brings better zooming behaviour
            //  */
            // window.VIEWER.addHandler("canvas-scroll", function(e) {
            //     if (Math.abs(e.originalEvent.deltaY) < 100) {
            //         // touchpad has lesser values, do not change scroll behavior for touchpads
            //         VIEWER.zoomPerScroll = 0.5;
            //         _scrollCount = 0;
            //         return;
            //     }
            //
            //     _currentScroll = Date.now();
            //     if (_currentScroll - _lastScroll < 400) {
            //         _scrollCount++;
            //     } else {
            //         _scrollCount = 0;
            //         VIEWER.zoomPerScroll = 1.2;
            //     }
            //
            //     if (_scrollCount > 2 && VIEWER.zoomPerScroll <= 2.5) {
            //         VIEWER.zoomPerScroll += 0.2;
            //     }
            //     _lastScroll = _currentScroll;
            // });

            viewer.addHandler('navigator-scroll', function (e) {
                viewer.viewport.zoomBy(e.scroll / 2 + 1); //accelerated zoom
                viewer.viewport.applyConstraints();
            });

            // todo move the initialization elsewhere... or restructure code a bit.... make this research config
            viewer.addHandler('open', (e: any) => {
                for (let SingletonClass of REQUIRED_SINGLETONS) {
                    // A singleton whose constructor already threw is not retried: the
                    // `open` event fires on every slide load, so retrying would re-run a
                    // known-broken constructor (and re-register its handlers) each time.
                    if ((SingletonClass as any).__failed) continue;
                    try {
                        if (!this._getSingleton(SingletonClass.IID, viewer)) {
                            withHandlerOwner(SingletonClass.$id || SingletonClass.IID,
                                () => SingletonClass.instance(viewer));
                        }
                    } catch (e) {
                        (SingletonClass as any).__failed = e;
                        console.error(`[loader] viewer singleton "${SingletonClass.IID}" failed to initialize; disabled.`, e);
                        removeHandlersOwnedBy(SingletonClass.$id || SingletonClass.IID);
                    }
                }

                if (e.firstLoad) {
                    // call here only when ready, otherwise the event is called after plugin initialization
                    if (pluginsWereInitialized()) {
                        /**
                         * Raised when a new viewer comes into the play. Index is the index-position on the screen.
                         * @param {OpenSeadragon.Viewer} viewer
                         * @param {UniqueViewerId} uniqueId
                         * @param {Number} index
                         * @event viewer-create
                         * @memberof VIEWER_MANAGER
                         */
                        this.raiseEvent('viewer-create', { viewer, uniqueId: viewer.uniqueId, index });
                    }
                }
            });

            viewer.addHandler('destroy', () => {
                const singletons = viewer[this._singletonsKey];
                if (singletons) {
                    for (let singletonId in singletons) {
                        singletons[singletonId].destroy();
                    }
                    viewer[this._singletonsKey] = null;
                }
                (viewer as any).__joystickController?.destroy?.();
            })

            // todo: consider wiring these events later as we access viewerUniqueID too early
            viewer.addHandler('canvas-enter', function (e) {
                focusOnViewer = e.eventSource;
            });
            viewer.addHandler('canvas-exit', function (e) {
                focusOnViewer = null;
            });
            viewer.addHandler('canvas-key', function (e) {
                focusOnViewer = e.eventSource;
                e.preventDefaultAction = true;
            });

            viewer.gestureSettingsMouse.clickToZoom = false;

            // Scroll-to-zoom policy. Three independent, composable options:
            //  - scrollRequiresCtrl: gate scroll-to-zoom behind Ctrl/Cmd so plain
            //    wheel falls through to the host page (notebook / scrollable-host
            //    embeddings). Uses OSD's canvas-scroll contract — preventDefaultAction
            //    skips the zoom, preventDefault=false lets the browser propagate.
            //  - snapZoomToMagnification: when the slide has a resolved native
            //    magnification, jump between standard magnification stops (5x/10x/
            //    20x/40x…) instead of scaling continuously. Uncalibrated slides
            //    (no scalebar magnification) keep continuous zoom. On by default.
            //  - reverseScroll: invert the zoom direction. OSD reads the raw wheel
            //    delta off the original event (not the event-args), so flipping
            //    e.scroll is ignored; we take over the zoom and negate the factor.
            const scrollRequiresCtrl = APPLICATION_CONTEXT.getOption('scrollRequiresCtrl');
            const reverseScroll = APPLICATION_CONTEXT.getOption('reverseScroll');
            const snapZoomToMagnification = APPLICATION_CONTEXT.getOption('snapZoomToMagnification');
            if (scrollRequiresCtrl || reverseScroll || snapZoomToMagnification) {
                let lastHintAt = 0;
                // Debounce magnification jumps so inertial/trackpad scroll (many
                // tiny canvas-scroll events per gesture) advances one level, not five.
                let lastJumpAt = 0;
                viewer.addHandler('canvas-scroll', (e: any) => {
                    const orig = e.originalEvent as WheelEvent | undefined;
                    if (scrollRequiresCtrl) {
                        if (orig && !orig.ctrlKey && !orig.metaKey) {
                            e.preventDefaultAction = true;
                            e.preventDefault = false;
                            const now = Date.now();
                            if (now - lastHintAt > 8000) {
                                lastHintAt = now;
                                Dialogs.show($.t('messages.scrollRequiresCtrl'), 3000, Dialogs.MSG_INFO);
                            }
                            return;
                        }
                    }

                    const source = e.eventSource;
                    const vp = source?.viewport;
                    const gs = source?.gestureSettingsByDeviceType('mouse');
                    if (!vp || !gs || !gs.scrollToZoom) return;

                    // Alt+wheel is reserved for z-stack focal-plane stepping
                    // (handler below); leave it for that path / OSD default.
                    const altHeld = !!(orig && orig.altKey);

                    // Magnification-snap: only when a native magnification is
                    // resolved for the current image (calibrated slide).
                    const scalebar = source.scalebar;
                    if (snapZoomToMagnification && !altHeld && scalebar?.magnification) {
                        const now = Date.now();
                        if (now - lastJumpAt < 150) {
                            e.preventDefaultAction = true;
                            return;
                        }
                        const zoomIn = reverseScroll ? e.scroll < 0 : e.scroll > 0;
                        const curMag = scalebar.getMagnification();
                        const nextMag = scalebar.nextMagnificationStop(curMag, zoomIn ? 1 : -1);
                        const target = scalebar.viewportZoomForMagnification(nextMag);
                        if (target !== undefined) {
                            e.preventDefaultAction = true;
                            lastJumpAt = now;
                            const position = vp.flipped
                                ? new OpenSeadragon.Point(vp.getContainerSize().x - e.position.x, e.position.y)
                                : e.position;
                            vp.zoomTo(target, gs.zoomToRefPoint ? vp.pointFromPixel(position, true) : null);
                            vp.applyConstraints();
                        }
                        return;
                    }

                    if (reverseScroll) {
                        e.preventDefaultAction = true;
                        const position = vp.flipped
                            ? new OpenSeadragon.Point(vp.getContainerSize().x - e.position.x, e.position.y)
                            : e.position;
                        const factor = Math.pow(source.zoomPerScroll, -e.scroll);
                        vp.zoomBy(factor, gs.zoomToRefPoint ? vp.pointFromPixel(position, true) : null);
                        vp.applyConstraints();
                    }
                });
            }

            // Alt + wheel → change focal plane (z-stack) instead of zooming,
            // when the source viewer shows a multi-plane slide. Derives the
            // viewer from the event source (multi-viewport safe) and only claims
            // the wheel when a z-stack is actually present, so plain slides keep
            // normal scroll-to-zoom.
            viewer.addHandler('canvas-scroll', (e: any) => {
                const orig = e.originalEvent as WheelEvent | undefined;
                if (!orig || !orig.altKey) return;
                const depth = (e.eventSource as any)?.__depthController;
                if (!depth?.hasZStack?.()) return;
                e.preventDefaultAction = true;
                depth.step(e.scroll > 0 ? 1 : -1);
            });

            new OpenSeadragon.Tools(viewer);
            this.menu.init(viewer);

            /**
             * Show demo page with error message
             * todo move to utils
             * @param enable
             * @param [explainErrorHtml=undefined]
             */
            viewer.toggleDemoPage = (enable: boolean, explainErrorHtml: string | undefined = undefined) => {
                const id = "demo-ad-" + viewer.id;

                if (enable) {
                    const { h1, br, img, p, div } = van.tags;
                    // todo ensure the outer div always has ID, even when someone added ID from outside
                    let toSet = div({ id: id },
                        h1("xOpat - The WSI Viewer"),
                        p("The viewer is missing the target data to view; this might happen, if"),
                        div({ innerHTML: explainErrorHtml || $.t('error.defaultDemoHtml') }),
                        br(), br(),
                        p({ class: "text-small mx-6 text-center" },
                            "xOpat: a web based, NO-API oriented WSI Viewer with enhanced rendering of high resolution images overlaid, fully modular and customizable."),
                        img({ src: "docs/assets/xopat-banner.png", style: "width:80%;display:block;margin:0 auto;" })
                    );
                    const doOverlay = (overlay?: Element | null) => {
                        if (!toSet) return;
                        viewer.addOverlay(overlay || toSet, new OpenSeadragon.Rect(0, 0, 1, 1));
                        toSet = null;
                    };

                    /**
                     * @event show-demo-page
                     */
                    viewer.raiseEvent('show-demo-page', {
                        id: id,
                        htmlError: explainErrorHtml,
                        show: doOverlay,
                    });

                    doOverlay(undefined);
                } else {
                    const overlay = document.getElementById(id);
                    if (overlay) viewer.removeOverlay(overlay);
                }
            };

            this.viewers.splice(index, 0, viewer);
            this._wire(viewer);

            if (setActive) {
                if (!this.active) {
                    this._commitActive(viewer, 'add');
                } else {
                    this._syncActiveViewState();
                }
            }
        }

        /**
         * Add an event handler for a given event to all current and future viewers.
         * The handler is also remembered and applied to any viewer created later via add().
         *
         * TODO: Supports only viewer events, not events that bound to other instances. Make this design more generic.
         */
        broadcastHandler(eventName: keyof OpenSeadragon.ViewerEventMap, handler: OpenSeadragon.EventHandler<any>, userData: any, priority: number) {
            let eventList = this.broadcastEvents[eventName];
            if (!eventList) {
                eventList = this.broadcastEvents[eventName] = new Map();
            }
            eventList.set(handler, { userData, priority });
            for (let v of this.viewers) {
                v.addHandler(eventName, handler, userData, priority);
            }
        }

        /**
         * Remove a previously broadcasted handler from all viewers and future creations.
         * If the handler was not registered, this is a no-op.
         * @param {string} eventName - The OpenSeadragon event name.
         * @param {Function} handler - The same handler function reference used in broadcastHandler.
         * @returns {void}
         */
        cancelBroadcast(eventName: string, handler: Function) {
            let eventList = this.broadcastEvents[eventName];
            if (eventList) {
                eventList.delete(handler);
            }
            for (let v of this.viewers) {
                v.removeHandler(eventName, handler);
            }
        }

        /**
         * Get viewer-driven menu: right menu that open tabs for each viewer.
         * @param {string|OpenSeadragon.Viewer} viewerOrId any viewer ID or viewer instance itself
         * @return {RightSideViewerMenu|undefined} menu instance or undefined if not found
         */
        getMenu(viewerOrId: ViewerLikeItem) {
            let viewer = null;
            if (typeof viewerOrId === "string") {
                viewer = this.getViewer(viewerOrId, false);
            } else {
                viewer = viewerOrId;
            }
            return viewer?.id ? this.viewerMenus[viewer.id] : undefined;
        }

        /**
         * For each currently open viewer, ask the IO pipeline to restore
         * any pre-existing per-viewer bundle data via bound sinks
         * (legacy: this pulled from POST_DATA::<viewerUniqueId>). Owners
         * that registered an `importBundle` hook receive the payload.
         */
        async forceDataImportInitialization() {
            for (let viewer of this.viewers) {
                const contextID = findViewerUniqueId(viewer);
                if (!contextID) {
                    console.warn("Viewer has no unique ID, skipping plugin data initialization");
                    continue;
                }
                try {
                    await IO_PIPELINE.tryRestoreImport({ viewerId: contextID });
                } catch (e) {
                    console.error('IO Failure:', e);
                }
            }
            // Unlocks per-viewer catch-up inside `initIO` for owners that
            // register AFTER this pass (lazy singletons instantiated on
            // first user interaction). See IOPipeline.bootRestorePending.
            IO_PIPELINE.markBootRestoreComplete();
        }

        /**
         * Get singleton for particular viewer. This works only for existing isntances - prefer using
         * @param {string} singletonId
         * @param {ViewerLikeItem} viewerOrUniqueId
         * @return {XOpatViewerSingleton|undefined} menu instance or undefined if not found and SingletonClass not specified
         * @private
         */
        _getSingleton(singletonId: string, viewerOrUniqueId: ViewerLikeItem) {
            if (singletonId === undefined) return undefined;
            const viewer = this.ensureViewer(viewerOrUniqueId);
            return viewer?.[this._singletonsKey]?.[singletonId];
        }

        /**
         * @private
         */
        _attachSingleton(singletonId: string, singletonModule: InstanceType<typeof XOpatViewerSingleton>, viewerOrUniqueId: ViewerLikeItem) {
            let viewer = this.ensureViewer(viewerOrUniqueId);
            let singletons = viewer[this._singletonsKey];
            if (!singletons) {
                singletons = viewer[this._singletonsKey] = {};
            }
            if (!(singletonModule instanceof XOpatViewerSingleton)) {
                console.error("Viewer singleton must be instance of XOpatViewerSingleton");
            }
            if (singletons[singletonId]) {
                throw `Trying to instantiate a singleton. Instead, use ${singletonModule.constructor.name}::instance(viewer).`;
            }
            singletons[singletonId] = singletonModule;
            return singletonModule;
        }

        /**
         * Remove a registered viewer singleton. Used to roll back registration
         * when a singleton subclass constructor throws after the base class
         * already attached the instance (see XOpatViewerSingleton.instance()).
         * @private
         */
        _detachSingleton(singletonId: string, viewerOrUniqueId: ViewerLikeItem) {
            const viewer = this.ensureViewer(viewerOrUniqueId);
            const singletons = viewer?.[this._singletonsKey];
            if (singletons && singletonId in singletons) {
                delete singletons[singletonId];
            }
        }

        /**
         * @private
         */
        _getSingletons(singletonId: string): IXOpatViewerSingleton[] {
            return this.viewers.map(v => v[this._singletonsKey]?.[singletonId]).filter(Boolean) as IXOpatViewerSingleton[];
        }

        /**
         * Destroy and remove the viewer at a given index and detach its grid cell.
         * Does nothing if no viewer exists at the index.
         * @param {number} index - Zero-based viewer slot index.
         * @returns {void}
         */
        delete(index: number) {
            const viewer = this.viewers[index];
            if (!viewer) return;

            const slotIndex = this.viewers.indexOf(viewer);
            const removeIndex = slotIndex >= 0 ? slotIndex : index;

            /**
             * Raised when an existing viewer is removed from the grid layout. Called before the viewer
             * is actually removed along with all its data.
             * @param {OpenSeadragon.Viewer} viewer
             * @param {string} uniqueId
             * @param {Number} index
             * @event viewer-destroy
             * @memberof VIEWER_MANAGER
             */
            const destroyedUniqueId = viewer.uniqueId;
            this.raiseEvent('viewer-destroy', { viewer, uniqueId: destroyedUniqueId, index: removeIndex });

            // Re-arm bundle hydration for this viewer id: uniqueIds are
            // data-derived, so a future viewer opening the same slide gets
            // the SAME id and must restore from sinks again.
            if (destroyedUniqueId) {
                IO_PIPELINE.clearHydratedFor(destroyedUniqueId);
            }

            const menu = this.viewerMenus[viewer.id];
            if (menu) {
                try {
                    menu.destroy?.();
                } catch (e) {
                    console.warn('Viewer menu destroy failed', e);
                }
                delete this.viewerMenus[viewer.id];
            }

            try {
                delete viewer.__cachedUUID;
                delete viewer.__uuidExplicit;
                (viewer as any).__managerDeleting = true;
                viewer.destroy();
            } catch (e) {
                console.warn('Viewer destroy failed', e);
            }

            try {
                // Remove by the viewer's OWN cell id, not by array position:
                // positions drift (splice) and a position-based removal can strip
                // the wrong cell / leave a ghost when ids ever collide.
                this.layout.removeById(viewer.id);
            } catch (e) {
                console.warn('Viewer layout removal failed', e);
            }

            if (slotIndex >= 0) {
                this.viewers.splice(slotIndex, 1);
            }

            if (this.active === viewer) {
                this._commitActive(this.viewers[0] || null, 'delete');
            } else {
                this._syncActiveViewState();
            }

            const stores = (viewer as any)[STORE_TOKEN];
            if (stores) {
                for (let key in stores) {
                    const store = stores[key];
                    if (!store) continue;
                    for (let pKey in store) {
                        delete store[pKey];
                    }
                    delete stores[key];
                }
            }
        }

        /**
         * Reset viewer at index to be able to accept new data.
         * @private
         */
        _resetViewer(index: number) {
            const viewer = this.viewers[index];
            if (!viewer) return;

            // Suspend the flex-drawer (depth-counted, so it nests safely inside
            // an open-pipeline transaction) before removing world items: each
            // remove-item schedules an async rebuild, and running it against a
            // half-torn-down world crashes `runRebuild`. Any reset path is now
            // protected, not only those wrapped by `beginViewerRenderTransaction`.
            const drawer: any = (viewer as any).drawer;
            const navigatorDrawer: any = (viewer as any).navigator?.drawer;
            try { drawer?.suspendRendering?.("xopat-reset"); } catch (e) { console.warn("Flex drawer suspendRendering failed.", e); }
            try { navigatorDrawer?.suspendRendering?.("xopat-reset"); } catch (e) { console.warn("Navigator flex drawer suspendRendering failed.", e); }

            try {
                // Clear all items
                if (viewer.world && viewer.world.getItemCount() > 0) {
                    const count = viewer.world.getItemCount();
                    for (let i = count - 1; i >= 0; i--) {
                        const it = viewer.world.getItemAt(i);
                        try {
                            viewer.world.removeItem(it);
                        } catch (_) {
                        }
                    }
                    /**
                     * Raised when an existing viewer is removed from the grid layout. Called before the viewer
                     * is actually removed along with all its data.
                     * @event viewer-reset
                     * @memberof VIEWER_MANAGER
                     */
                    this.raiseEvent('viewer-reset', { viewer: viewer, uniqueId: viewer.uniqueId, index });
                } // else no need to call reset, not opened

                delete viewer.__cachedUUID;
                delete viewer.__uuidExplicit;
            } catch (e) {
                console.warn("Viewer reset failed - will recreate. Cause:", e);
                this.add(index); //recreate force
            } finally {
                try { navigatorDrawer?.resumeRendering?.("xopat-reset"); } catch (e) { console.warn("Navigator flex drawer resumeRendering failed.", e); }
                try { drawer?.resumeRendering?.("xopat-reset"); } catch (e) { console.warn("Flex drawer resumeRendering failed.", e); }
            }
        };
    }

    function callDeployedViewerInitialized() {
        for (let i = 0; i < VIEWER_MANAGER.viewers.length; i++) {
            const v = VIEWER_MANAGER.viewers[i];
            if (v.isOpen()) {
                /**
                 * Raised when a new viewer comes into the play. Index is the index-position on the screen.
                 * @param {OpenSeadragon.Viewer} viewer
                 * @param {string} uniqueId
                 * @param {Number} index
                 * @event viewer-create
                 * @memberof VIEWER_MANAGER
                 */
                VIEWER_MANAGER.raiseEvent('viewer-create', { viewer: v, uniqueId: v.uniqueId, index: i });
            }
        }
    }

    return function () {
        $("body")
            .append("<a id='link-download-helper' class='hidden'></a>")
            .parent().append("<input id='file-upload-helper' type='file' style='visibility: hidden !important; width: 1px; height: 1px'/>");

        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            let plugin = PLUGINS[pid];
            if (plugin) {
                showPluginError(plugin.id, plugin.error, plugin.loaded);
            }
        }

        return Promise.all(REGISTERED_PLUGINS!.map(plugin => initializePlugin(plugin, false))).then(() => {
            REGISTERED_PLUGINS = undefined;
        }).then(() => VIEWER_MANAGER.forceDataImportInitialization()).then(callDeployedViewerInitialized);
    };
}
