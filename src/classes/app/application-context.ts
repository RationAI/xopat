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
            if (cache && self.AppCache) {
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
            let value = self.config.params[name] !== undefined
                ? self.config.params[name]
                : (defaultValue !== undefined ? defaultValue : self.config.defaultParams[name]);
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
            if (cache && self.AppCache) self.AppCache.set(name, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            self.config.params[name] = value;
        },
        /**
         * Read a UI visibility flag with precedence:
         *   1. explicit `params.ui[key]` (session JSON wins over cached user pref),
         *   2. legacy flat `params[key]` (back-compat with old session shape),
         *   3. cached AppCache value (Settings checkbox toggles persist here),
         *   4. `defaultSetup.ui[key]` → legacy flat `defaultSetup[key]` → `true`.
         * The "explicit > cache" order lets a session author hard-set a boot state
         * without bypassCache; if the session leaves the key unset, the user's
         * last Settings toggle is honored.
         */
        getUiOption(key: keyof XOpatUiSetup): boolean {
            const self = this as unknown as ApplicationContext;
            const params = self.config.params as Record<string, any>;
            const defaults = self.config.defaultParams as Record<string, any>;
            const fromParamsUi = params.ui?.[key];
            if (fromParamsUi !== undefined && fromParamsUi !== null) return !!fromParamsUi;
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
            const fromDefaultsUi = defaults.ui?.[key];
            if (fromDefaultsUi !== undefined && fromDefaultsUi !== null) return !!fromDefaultsUi;
            const fromDefaultsFlat = defaults[key];
            if (fromDefaultsFlat !== undefined && fromDefaultsFlat !== null) return !!fromDefaultsFlat;
            return true;
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
         * Return the current active visualization
         * @return {*}
         */
        activeVisualizationConfig() {
            return CONFIG.visualizations?.[APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)[0]];
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
