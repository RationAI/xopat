// Factory that builds the global `APPLICATION_CONTEXT` object. Extracted from
// src/app.ts to keep the boot script linear and to make the AC's dependencies
// (ENV, CONFIG, the IO pipeline, plugin registry) explicit.
//
// Must be called *after* `bootstrapIOPipeline()` so that the AppCache/AppCookies
// façades (which lazily resolve through `window.IO_PIPELINE`) are functional
// from the very first `getOption()` call.

import { BackgroundConfig } from "../background-config";
import { HttpClient } from "../http-client";
import { ScriptingManager } from "../scripting-manager";
import { NetworkStatus } from "../network-status";

export type CreateApplicationContextOptions = {
    ENV: XOpatCoreConfig;
    CONFIG: XOpatRuntimeConfig;
    PLUGINS: Record<string, XOpatElementItem>;
    /** sessionName fallback parsed from CONFIG.params or ENV.setup */
    sessionName: string | undefined;
    viewerSecureMode: boolean | null | undefined;
    defaultSetup: Readonly<XOpatSetup>;
    ioPipeline: any;
};

/**
 * Options that define the SESSION STRUCTURE (viewer count, slot layout,
 * which background each slot shows). These must always come from the
 * session itself (params / defaults) — never from AppCache, which is
 * keyed per origin and would leak one session's layout into the next
 * (e.g. a cached `activeBackgroundIndex = [0,1]` opening a phantom
 * second viewer for a 1-background session). getOption skips the cache
 * read; setOption skips the cache write AND deletes any stale persisted
 * value so existing installs self-clean.
 */
const SESSION_SCOPED_OPTIONS = new Set<string>(["activeBackgroundIndex"]);

export function createApplicationContext(opts: CreateApplicationContextOptions): ApplicationContext {
    const { ENV, CONFIG, PLUGINS, sessionName, viewerSecureMode, defaultSetup, ioPipeline } = opts;

    const ac = /**@lends APPLICATION_CONTEXT*/ ({
        /**
         * Viewer Configuration direct access.
         * @namespace APPLICATION_CONTEXT.config
         */
        config: {
            /**
             * Get parameters object of the viewer setup.
             * getOption should be preferred over direct params access
             */
            get params(): Readonly<XOpatSetup> {
                return CONFIG.params || {};
            },
            /**
             * Get default (static) parameters of the viewer setup
             */
            get defaultParams(): Readonly<XOpatSetup> {
                return defaultSetup;
            },
            /**
             * Get all the data WSI identifiers list
             */
            get data(): Readonly<DataSpecification[]> {
                return CONFIG.data || [];
            },
            /**
             * Configuration of the 'image group'
             */
            get background(): Readonly<BackgroundItem[]> {
                return (CONFIG.background || []) as BackgroundItem[];
            },
            /**
             * Configuration of the 'data group'
             */
            get visualizations(): Readonly<VisualizationItem[]> {
                return (CONFIG.visualizations || []) as VisualizationItem[];
            },
            /**
             * Startup configuration of plugins
             */
            get plugins(): Readonly<Record<string, XOpatElementItem>> {
                return (CONFIG.plugins || {}) as Record<string, XOpatElementItem>;
            },
        },
        /**
         * Global Application Cache. Should not be used directly: cache is avaialble within
         * plugins as this.cache object.
         */
        AppCache: new XOpatStorage.Cache({ id: "core" }),
        /**
         * Global Application Cookies.
         */
        AppCookies: new XOpatStorage.Cookies({ id: "core" }),
        /**
         * Get sessionName value (fallback refereceId) from the configuration.
         * @return {string|*}
         */
        get sessionName() {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this as unknown as ApplicationContext;
            const config = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background") || {};
            if (config["sessionName"]) return config["sessionName"];
            if (sessionName) return sessionName;
            return self.referencedId();
        },
        /**
         * Check if viewer requires secure mode execution.
         * @type {boolean}
         */
        get secure() {
            return viewerSecureMode;
        },
        /**
         * Get the ENV configuration used to run the viewer.
         * @type xoEnv
         */
        get env() {
            return ENV;
        },
        /**
         * Get the current URL (without data, just the index entry point).
         * @type {string}
         */
        get url() {
            const self = this as unknown as ApplicationContext;
            const domain = self.env.client.domain;
            const raw = !domain.endsWith("/")
                ? domain + "/" + self.env.client.path
                : domain + self.env.client.path;
            // Collapse runs of `/` into a single `/` except after the
            // protocol scheme (`http://`). Misconfigured combinations of
            // trailing-slash domain + leading-slash path otherwise produce
            // `host//path`, which makes server-side route matching like
            // `pathname.startsWith("/proxy/")` silently fail.
            return raw.replace(/([^:])\/{2,}/g, "$1/");
        },
        get settingsMenuId() { return "app-settings"; },
        get pluginsMenuId() { return "app-plugins"; },
        /**
         * Get option, preferred way of accessing the viewer config values.
         * @param name
         * @param defaultValue
         * @param cache
         * @param parse if true, JSON.parse is applied to the value
         * @return {string|*}
         */
        getOption(name: string, defaultValue: any = undefined, cache = true, parse = false) {
            const self = this as unknown as ApplicationContext;
            const builtin = self.config.defaultParams[name];
            if (builtin === undefined) {
                console.warn(`Trying to read non-existing option: only viewer parameters ${Object.keys(self.config.defaultParams)} are supported.`, name);
            }
            const normalize = (value: any) => {
                if (value === "false") return false;
                if (value === "true") return true;
                if (parse && typeof value === "string") {
                    try {
                        return JSON.parse(value);
                    } catch (e) {
                        // todo: how to better recognize we should try not to parse real strings?
                        //pass, just a string
                    }
                }
                return value;
            };
            // Explicit param (URL hash / init payload) wins over cached value:
            // cache is a fallback for when the option was not issued, not an override.
            if (self.config.params[name] !== undefined) {
                return normalize(self.config.params[name]);
            }
            if (cache && self.AppCache && !SESSION_SCOPED_OPTIONS.has(name)) {
                let cached = self.AppCache.get(name);
                if (parse && typeof cached === "string") {
                    const trimmed = cached.trim();
                    if (trimmed === "" || trimmed === "undefined") {
                        self.AppCache.delete(name);
                        return undefined;
                    }
                    try {
                        return JSON.parse(trimmed);
                    } catch (e) {
                        console.warn("Failed to parse option cached value - erasing", cached);
                        self.AppCache.delete(name);
                        cached = undefined;
                    }
                }
                if (cached !== null && cached !== undefined) {
                    if (cached === "false") cached = false;
                    else if (cached === "true") cached = true;
                    return cached;
                }
            }
            return normalize(defaultValue !== undefined ? defaultValue : self.config.defaultParams[name]);
        },
        /**
         * Set option, preferred way of accessing the viewer config values.
         * @param name
         * @param value
         * @param cache
         */
        setOption(name: string, value: any, cache = true) {
            const self = this as unknown as ApplicationContext;
            if (!self.config.defaultParams.hasOwnProperty(name)) {
                console.warn(`Trying to set non-existing option: only viewer parameters ${Object.keys(self.config.defaultParams)} are supported.`, name);
            }
            if (value === undefined) {
                self.AppCache.delete(name);
                delete self.config.params[name];
                return;
            }
            if (typeof value === "object") {
                try {
                    value = JSON.stringify(value);
                } catch (e) {
                    console.warn("Failed to stringify option value", value);
                }
            }
            if (SESSION_SCOPED_OPTIONS.has(name)) {
                // Session-structure option: never persist, and scrub any
                // stale value an older build may have cached.
                if (self.AppCache) self.AppCache.delete(name);
            } else if (cache && self.AppCache) {
                self.AppCache.set(name, value);
            }
            if (value === "false") value = false;
            else if (value === "true") value = true;
            self.config.params[name] = value;
        },
        /**
         * Read a UI visibility flag with precedence:
         *   1. explicit `params.ui[key]` (session JSON wins over cached user pref);
         *      `params.ui === false` is a global override that hides every key,
         *      `params.ui === true` falls through to lower-priority sources,
         *   2. legacy flat `params[key]` (back-compat with old session shape),
         *   3. cached AppCache value (Settings checkbox toggles persist here),
         *   4. `defaultSetup.ui[key]` (or `defaultSetup.ui === false` as a
         *      deployment-wide hide-all default) → legacy flat
         *      `defaultSetup[key]` → `true`.
         * The "explicit > cache" order lets a session author hard-set a boot state
         * without bypassCache; if the session leaves the key unset, the user's
         * last Settings toggle is honored.
         */
        getUiOption(key: keyof XOpatUiSetup): boolean {
            const self = this as unknown as ApplicationContext;
            const params = self.config.params as Record<string, any>;
            const defaults = self.config.defaultParams as Record<string, any>;
            const paramsUi = params.ui;
            if (paramsUi === false) return false;
            if (paramsUi && typeof paramsUi === "object") {
                const v = paramsUi[key];
                if (v !== undefined && v !== null) return !!v;
            }
            const fromParamsFlat = params[key];
            if (fromParamsFlat !== undefined && fromParamsFlat !== null) return !!fromParamsFlat;
            if (self.AppCache) {
                const cached = self.AppCache.get(key);
                if (cached !== undefined && cached !== null) {
                    if (cached === "false") return false;
                    if (cached === "true") return true;
                    return !!cached;
                }
            }
            const defaultsUi = defaults.ui;
            if (defaultsUi === false) return false;
            if (defaultsUi && typeof defaultsUi === "object") {
                const v = defaultsUi[key];
                if (v !== undefined && v !== null) return !!v;
            }
            const fromDefaultsFlat = defaults[key];
            if (fromDefaultsFlat !== undefined && fromDefaultsFlat !== null) return !!fromDefaultsFlat;
            return true;
        },
        /**
         * Read a UI visibility flag as a persistent "default hidden" hint.
         *
         * Originally introduced as a boot-phase-only variant that stripped
         * `params.ui[key]` after the first viewer opened, that design proved
         * timing-fragile: plugin-registered components frequently construct
         * after `setUiBootComplete()` fires, so the flag silently stopped
         * applying. The contract is now a thin pass-through to
         * `getUiOption(key)` — every component honors the flag at its own
         * construction time. Manual user opening still wins for the session
         * because `VisibilityManager` holds the live `_visible` field.
         *
         * The `isUiBootComplete` / `setUiBootComplete` API is retained
         * (inert) so the lifecycle controller and type surface keep
         * compiling — callers can drop them in a follow-up cleanup.
         */
        getInitialUiOption(key: keyof XOpatUiSetup): boolean {
            return (this as unknown as ApplicationContext).getUiOption(key);
        },
        __uiBootComplete: false as boolean,
        isUiBootComplete(): boolean {
            return (this as any).__uiBootComplete === true;
        },
        setUiBootComplete(): void {
            (this as any).__uiBootComplete = true;
        },
        /**
         * Persist a UI visibility flag. Writes to `params.ui[key]` and the
         * AppCache under the legacy flat key (matches existing scaleBar/toolBar
         * checkbox cache shape).
         */
        setUiOption(key: keyof XOpatUiSetup, value: boolean, cache = true) {
            const self = this as unknown as ApplicationContext;
            const params = self.config.params as Record<string, any>;
            if (!params.ui || typeof params.ui !== "object") params.ui = {};
            params.ui[key] = !!value;
            if (cache && self.AppCache) self.AppCache.set(key, !!value);
        },
        setDirty() {
            (this as unknown as ApplicationContext).__cache.dirty = true;
        },
        /**
         * Get the list of all plugin IDs.
         * @return {string[]}
         */
        pluginIds() {
            return Object.keys(PLUGINS);
        },
        /**
         * Get the list of active plugin IDs.
         * @return {string[]}
         */
        activePluginIds() {
            const result = [];

            for (let pid in PLUGINS) {
                if (!PLUGINS.hasOwnProperty(pid)) continue;
                const plugin = PLUGINS[pid];

                if (!plugin!.error && plugin!.instance && (plugin!.loaded || plugin!.permaLoad)) {
                    result.push(pid);
                }
            }
            return result;
        },
        /**
         * Get the current FILE name viewed.
         * @param {boolean} stripSuffix if true and the returned data is read from config.data
         *   field, an attempt to return only filename from the file ID.
         * @return {string}
         */
        referencedName(stripSuffix = false) {
            if (!CONFIG.background || CONFIG.background.length < 0) {
                return undefined;
            }
            const bgConfig = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background");
            if (bgConfig) {
                return UTILITIES.nameFromBGOrIndex(bgConfig, stripSuffix);
            }
            return undefined;
        },
        /**
         * Get the current FILE ID viewed.
         * @return {string}
         */
        referencedId() {
            if (!CONFIG.background || CONFIG.background.length < 0) {
                return "__anonymous__";
            }
            let config;
            if (VIEWER.scalebar) {
                config = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background");
            } else {
                config = CONFIG.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', undefined, true, true)[0]]
                    || CONFIG.background[0];
            }
            return config ? CONFIG.data?.[config.dataReference] : "__anonymous__";
        },
        /**
         * Return the current active visualization (slot 0). Derived from the
         * slot-0 background entry's `visualizationIndex`.
         * @return {*}
         */
        activeVisualizationConfig() {
            const activeBg = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', undefined, true, true);
            const slot0Bg = Array.isArray(activeBg) ? activeBg[0] : activeBg;
            const bg = Number.isInteger(slot0Bg) ? CONFIG.background?.[slot0Bg as number] : undefined;
            const vizIdx = bg?.visualizationIndex;
            return Number.isInteger(vizIdx) ? CONFIG.visualizations?.[vizIdx as number] : undefined;
        },
        /**
         * Get the viewer currently considered active by the viewer manager.
         */
        activeViewer() {
            return window.VIEWER_MANAGER?.get?.() || null;
        },
        /**
         * Get index of the viewer currently considered active by the viewer manager.
         */
        activeViewerIndex() {
            return window.VIEWER_MANAGER?.getActiveIndex?.() ?? -1;
        },
        /**
         * Get unique ID of the viewer currently considered active by the viewer manager.
         */
        activeViewerId() {
            return window.VIEWER_MANAGER?.getActiveUniqueId?.();
        },
        /**
         * Check if a viewer reference resolves to the currently active viewer.
         */
        isActiveViewer(viewerOrUniqueId: ViewerLikeItem) {
            return !!window.VIEWER_MANAGER?.isActive?.(viewerOrUniqueId);
        },
        _dangerouslyAccessConfig() {
            //remove in the future?
            return CONFIG;
        },
        _dangerouslyAccessPlugin(id: string) {
            //remove in the future?
            return PLUGINS[id];
        },
        __cache: {
            dirty: false
        },
        // todo: necessary to keep?
        prepareRendering: () => {
            // Placeholder for prepareRendering
        }
    }) as unknown as ApplicationContext;

    /**
     * Core HTTP Client.
     * @memberof APPLICATION_CONTEXT
     */
    ac.httpClient = new HttpClient({
        baseURL: ac.url,
        auth: { contextId: undefined }
    });

    /**
     * Scripting manager.
     */
    ac.Scripting = ScriptingManager.instance();

    /**
     * Network connectivity source of truth. Consumers subscribe here instead
     * of re-implementing `navigator.onLine` handling (see IOResource, and the
     * offline pill/toasts wired in app.ts).
     * @memberof APPLICATION_CONTEXT
     */
    ac.networkStatus = NetworkStatus.instance();

    // todo maybe dont support this, just call directly the static method
    (ac as any).registerConfig = function registerConfig(bg: BackgroundItem) {
        return BackgroundConfig.from(bg);
    };

    ac.sameBackground = function sameBackground(a: BackgroundItem | BackgroundConfig, b: BackgroundItem | BackgroundConfig) {
        if (a === b) return true;
        if (!a || !b) return false;
        return ac.registerConfig(a).id === ac.registerConfig(b).id;
    };

    (ac as any).io = ioPipeline;

    return ac;
}
