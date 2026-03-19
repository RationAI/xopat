import type { XOpatCoreConfig, XOpatElementRecord } from "./types/config";
import { type StorageLike, type AsyncStorageLike, XOpatStorage } from "./store";
import type { OpenEvent } from "openseadragon";

import { HTTPError } from "./classes/http-client";
import { BackgroundConfig } from "./classes/background-config";
import type { ImageLike } from "./types/misc";

/** Token symbols for internal element storage */
const STORE_TOKEN = Symbol("XOpatElementDataStore");
const CACHE_TOKEN = Symbol("XOpatElementCacheStore");

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

    function pluginsWereInitialized() {
        return REGISTERED_PLUGINS === undefined;
    }

    const showPluginError = (window as any).showPluginError = function (id: string, e: unknown, loaded: boolean | undefined = undefined) {
        // todo should access vanjs component instead
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            if (loaded) $(`#load-plugin-${id}`).html("");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">${$.t('messages.pluginRemoved')}<br><code>[${e}]</code></div>`);
        $(`#load-plugin-${id}`).html(`<button disabled class="btn">${$.t('common.Failed')}</button>`);
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

        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
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

        let plugin;
        try {
            if (!APPLICATION_CONTEXT.config.plugins[id]) {
                APPLICATION_CONTEXT.config.plugins[id] = {};
            }
            plugin = new PluginClass(id);
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

    async function initializePlugin(plugin: IXOpatPlugin) {
        if (!plugin) {
            console.warn("Attempt to initialize undefined plugin.");
            return false;
        }

        try {
            if (typeof plugin.pluginReady === "function") {
                await plugin.pluginReady();
            }
            PLUGINS[plugin.id]!.__ready = true;

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
     * Get one of allowed plugin meta keys
     */
    const pluginMeta = (window as any).pluginMeta = function (id: string, metaKey: string) {
        return ["name", "description", "author", "version", "icon"].includes(metaKey) ? PLUGINS[id]?.[metaKey] : undefined;
    }

    /**
     * Get a module singleton reference if instantiated.
     * @param id module id
     * @param viewer if provided, viewer-context-dependent instance (XOpatViewerSingleton) is fetched
     */
    const singletonModule = (window as any).singletonModule = function (id: string, viewer?: ViewerLikeItem) {
        if (viewer !== undefined) {
            return VIEWER_MANAGER._getSingleton(id, viewer);
        }
        return MODULES[id]?.instance;
    };

    /**
     * Register plugin. Plugin can be instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    const addPlugin = (window as any).addPlugin = function (id: string, PluginClass: XOpatPluginClass) {
        let plugin = instantiatePlugin(id, PluginClass);
        if (!plugin) return;

        if (REGISTERED_PLUGINS !== undefined) {
            if (plugin && typeof plugin["pluginReady"] === "function") {
                REGISTERED_PLUGINS.push(plugin);
            }
        } //else do not initialize plugin, wait untill all files loaded dynamically
    };

    /**
     * Force the SingletonClass class definition to be instantiated automatically per active viewer.
     */
    const requireViewerSingletonPresence = (window as any).requireViewerSingletonPresence = function (SingletonClass: XOpatViewerSingletonClass) {
        if (!(SingletonClass.prototype instanceof XOpatViewerSingleton)) {
            console.error("Invalid singleton class", SingletonClass);
            return;
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
        if (index >= sources.includes.length) {
            onSuccess();
        } else {
            let toLoad = sources.includes[index],
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

    async function _getLocale(id: string, path: string, directory: string | undefined, data: any, locale: string | undefined) {
        if (!$.i18n) return;
        if (!locale) locale = $.i18n.language;

        if (typeof data === "string" && directory) {
            await fetch(`${path}${directory}/${data}`).then(response => {
                if (!response.ok) {
                    throw new HTTPError("HTTP error " + response.status, response, '');
                }
                return response.json();
            }).then(json => {
                $.i18n.addResourceBundle(locale, id, json);
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

    // POST DATA STORAGE - Always implemented via POST, support static IO.
    /**
     * @extends XOpatStorage.Data
     * @type {PostDataStore}
     */
    class PostDataStore extends XOpatStorage.Data {
        /** Internal context type (plugin or module) */
        contextType!: XOpatExecutionContext;

        /**
         * @param options the options used in super class XOpatStorage.Data
         * @param options.xoType type of the owner
         */
        constructor(options: PostDataStoreOptions) {
            // IDs are split by '.' and the first segment is removed to match original logic
            super({
                ...options,
                id: (options.id || "").split(".").filter((_, i) => i > 0).join(".")
            });

            if (options.xoType !== "plugin" && options.xoType !== "module") {
                throw "Invalid xoType for PostDataStore!";
            }

            this.contextType = options.xoType;

            // Accessing the internal storage reference
            // Cast to any to access internal _withReference if it's not in the public interface
            (this.getStore() as any)._withReference(this.contextType);
        }

        /**
         * The ability to export all relevant data is used mainly with current session exports/shares.
         * This is used for immediate static export of the current state.
         * @return {Promise<string>} serialized data
         */
        async export() {
            const exports: Record<string, any> = {};
            const storage = this.__storage as any;
            //bit dirty, but we rely on keys implementation as we hardcode storage driver
            for (let key of storage._keys() as string[]) {
                if (key.startsWith(this.id)) {
                    exports[key] = await storage.get(key);
                }
            }
            try {
                return JSON.stringify(exports);
            } catch (e) {
                console.error("Error exporting post data for ", this.id, e);
                return undefined;
            }
        }

        /**
         * Class argument is unused — this class hardcodes POST DATA 'driver'.
         */
        static register(Class: new () => StorageLike | AsyncStorageLike) {
            super.registerClass(class extends XOpatStorage.AsyncStorage {
                ref!: string;
                async getItem(key: string) {
                    let storage = POST_DATA[this.ref] as Record<string, unknown>;
                    // backward non-namespaced compatibility
                    return POST_DATA[key] || (storage && storage[key]);
                }
                async setItem(key: string, value: any) {
                    let storage = POST_DATA[this.ref];
                    if (!storage) {
                        storage = POST_DATA[this.ref] = {};
                    }
                    storage[key] = value;
                }
                async removeItem(key: string) {
                    delete POST_DATA[key];
                    let storage = POST_DATA[this.ref];
                    if (storage) {
                        delete storage[key];
                    }
                }
                async clear() {
                    if (POST_DATA[this.ref]) {
                        POST_DATA[this.ref] = {};
                    }
                }
                get length(): Promise<number> {
                    let storage = POST_DATA[this.ref];
                    return Promise.resolve(Object.keys(storage || {}).length);
                }
                async key(index: number): Promise<string> {
                    let storage = POST_DATA[this.ref];
                    return Object.keys(storage || {})[index] ?? "";
                }
                _keys(): string[] { //internal loader use
                    let storage = POST_DATA[this.ref];
                    return Object.keys(storage || {});
                }
                _withReference(ref: string) {  //internal loader use
                    this.ref = ref;
                }
            } as any);
        }
    }
    // We hardcode internal storage driver for PostDataStore
    PostDataStore.register(null as any);

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
        constructor(id: XOpatElementID, executionContextName: XOpatExecutionContext) {
            super();

            if (!id) throw `Trying to instantiate an element '${this.constructor.name || this.constructor}' - no id given.`;
            this.__id = id;
            this.__uid = `${executionContextName}.${id}`;
            this.__xoContext = executionContextName;

            this[CACHE_TOKEN] = new XOpatStorage.Cache({ id: this.__uid });
            REGISTERED_ELEMENTS.push(this);
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
         * @return {XOpatStorage.Cache} cache interface
         */
        get cache() {
            return this[CACHE_TOKEN];
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
         * @return {PostDataStore}
         */
        get POSTStore() {
            return this[STORE_TOKEN];
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
         * Initialize IO in the Element - enables use of export/import functions. Can be initialized
         * multiple times for multiple individual items (exportKey should differ!)
         * @param {XOpatStorage.StorageOptions?} options where id value is ignored (overridden)
         * @param {string?} [options.exportKey=""] optional export key for the globally exported data through exportData
         * @param {boolean} [options.inViewerContext=true] if true, the POST IO depends on the viewer context and
         * runs IO wrt. viewer lifecycle
         * @return {PostDataStore} data store reference, or false if import failed
         */
        async initPostIO(options: Partial<PostDataStoreOptions> = {}) {
            if (typeof this.getOption === "function" && this.getOption('ignorePostIO', false)) {
                return;
            }

            options.id = this.uid;
            options.xoType = this.__xoContext as XOpatExecutionContext;
            if (options.inViewerContext === undefined) {
                options.inViewerContext = true;
            }
            let store = this[STORE_TOKEN];
            if (!store) {
                this[STORE_TOKEN] = store = new PostDataStore(options as PostDataStoreOptions);
            }

            const vanillaExportKey = (options.exportKey || "").replace("::", "");

            try {
                VIEWER_MANAGER.addHandler('export-data', async () => {
                    const data = await this.exportData(vanillaExportKey);
                    if (data) {
                        await store.set(vanillaExportKey, data);
                    }

                    if (options.inViewerContext) {
                        const exportKey = vanillaExportKey + "::";
                        for (let v of VIEWER_MANAGER.viewers) {
                            const contextID = findViewerUniqueId(v) ?? "__unknown_viewer_ref__";
                            const viewerData = await this.exportViewerData(v, vanillaExportKey, contextID);
                            if (data) {
                                await store.set(exportKey + contextID, viewerData);
                            }
                        }
                    }
                });

                const data = await store.get(vanillaExportKey);
                if (data !== undefined) await this.importData(vanillaExportKey, data);

            } catch (e) {
                console.error('IO Failure:', this.constructor.name, e);
                this.error({
                    error: e, code: "W_IO_INIT_ERROR",
                    message: $.t('error.pluginImportFail',
                        { plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');" })
                });
            }
            return store;
        }

        /**
         * Called to export data within 'export-data' event: automatically the post data store object
         * (returned from initPostIO()) is given the output of this method:
         * `await dataStore.set(options.exportKey || "", await this.exportData());`
         * note: for multiple objects, you can either manually add custom keys to the `dataStore` reference
         * upon the event 'export-data', or simply nest objects to fit a single output
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @return {Promise<any>}
         */
        async exportData(key: string): Promise<any> { }
        /**
         * Works the same way as @exportData, but for the viewer context.
         * @param viewer {OpenSeadragon.Viewer} the target viewer
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param viewerTargetID {string} the viewer contextual ID it was exported with, default empty string
         * @return {Promise<any>}
         */
        async exportViewerData(viewer: OpenSeadragon.Viewer, key: string, viewerTargetID: string): Promise<any> {
            return {};
        }
        /**
         * Called automatically within this.initPostIO if data available
         * note: parseImportData return value decides if data is parsed data or passed as raw string
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param data {any} data
         */
        async importData(key: string, data: any): Promise<void> { }
        /**
         * Works the same way as @importData, but for the viewer context.
         * @param viewer {OpenSeadragon.Viewer} the target viewer
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param viewerTargetID {string} the viewer contextual ID it was exported with, default empty string
         * @param data {any} data
         */
        async importViewerData(viewer: OpenSeadragon.Viewer, key: string, viewerTargetID: string, data: any): Promise<void> { }

        /**
         * Get context of viewer that is suitable for storing viewer-related data.
         * @param id
         * @return {{}|undefined}
         */
        getViewerContext(id: UniqueViewerId) {
            const viewer = VIEWER_MANAGER.getViewer(id);
            if (!viewer) {
                console.warn("No viewer with id " + id);
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
         * TODO: this does not wait once module is fully loaded!
         * @param {string} moduleId
         * @param {{ (module: XOpatModuleSingleton | XOpatViewerSingletonModule): void }} callback
         * @param {ViewerLikeItem} [viewer] - if defined, XOpatViewerSingletonModule is listened for given
         * the desired viewer in question, otherwise global XOpatModuleSingleton
         * @return {boolean} true if finished immediatelly, false if registered handler for the
         * future possibility of the module being loaded
         */
        integrateWithSingletonModule(moduleId: string, callback: (module: any) => void, viewer: ViewerLikeItem | undefined = undefined) {
            const targetModule = singletonModule(moduleId);
            if (targetModule) {
                callback(targetModule);
                return true;
            }
            VIEWER_MANAGER.addHandler('module-singleton-created', (e: ModuleSingletonCreatedEvent) => {
                if (viewer) {
                    viewer = VIEWER_MANAGER.ensureViewer(viewer);
                    // call also if viewer event arg undefined -> user might missed the usage
                    if (e.id === moduleId && (e.viewer === viewer || e.viewer) === undefined) callback(e.module);
                } else {
                    if (e.id === moduleId) callback(e.module);
                }
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
         * Uses viewer.id because the server RPC currently expects the transport viewer id.
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

        constructor(id: string) {
            super(id, "module");
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
            return value;
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
            Ctor.__self = Ctor.__self || new Ctor();
            return Ctor.__self;
        }

        /**
         * Check if instantiated
         * @return {boolean}
         */
        static instantiated() {
            return this.__self && true; //retype
        }

        static __self = undefined;


        /**
         * Create singleton with ID of the module.
         * The ID must be the module id defined in configuration.
         */
        constructor(id: string) {
            super(id);
            const staticContext = (this.constructor as any);
            if (staticContext.__self) {
                throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
            }
            staticContext.__self = this;

            const modRef = MODULES[id];
            if (!modRef) {
                throw `Trying to instantiate a module that is not registered!`;
            }
            modRef.instance = this;

            // Await event necessary to fire after instantiation, do in async context
            /**
             * Module singleton was instantiated
             * @memberof VIEWER_MANAGER
             * @event module-singleton-created
             */
            setTimeout(() => VIEWER_MANAGER.raiseEventAwaiting('module-singleton-created', {
                id: id,
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
                        const wrapper = record.wrappers.get(this);
                        if (wrapper) {
                            try { this.removeHandler(eventName, wrapper); } catch (_) { /* ignore */ }
                        }
                        record.wrappers.delete(this);
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
            return value || new this(VIEWER_MANAGER.ensureViewer(viewerOrUniqueId));
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

            // throws if exists
            VIEWER_MANAGER._attachSingleton(Self.IID, this, viewer);

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
                id: Self.IID,
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

            const record = { userData, priority, instances: new Set<OpenSeadragon.Viewer>() };
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
        static __getBroadcastState(): Map<string, Map<OpenSeadragon.EventHandler<any>, { priority: number, userData: any, instances: Set<XOpatViewerSingleton> }>> {
            if (!Object.prototype.hasOwnProperty.call(this, "__broadcastState")) {
                Object.defineProperty(this, "__broadcastState", {
                    value: new Map(),
                    writable: false, enumerable: false, configurable: false
                });
            }
            return (this as any).__broadcastState as Map<string, Map<OpenSeadragon.EventHandler<any>, { priority: number, userData: any, instances: Set<XOpatViewerSingleton> }>>;
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

        /**
         * Initialize IO in the Element - enables use of export/import functions. Redefinition
         * of the element base implementation, exports primarily to the viewer it encapsulates.
         * @param {XOpatStorage.StorageOptions?} options where id value is ignored (overridden)
         * @param {string?} [options.exportKey=""] optional export key for the globally exported data through exportData
         * @return {PostDataStore} data store reference, or false if import failed
         */
        async initPostIO(options: Partial<PostDataStoreOptions> = {}) {
            if (typeof this.getOption === "function" && this.getOption('ignorePostIO', false)) {
                return;
            }

            options.id = this.uid;
            options.xoType = this.__xoContext as XOpatExecutionContext;
            let store = this[STORE_TOKEN];
            if (!store) {
                this[STORE_TOKEN] = store = new PostDataStore(options as PostDataStoreOptions);
            }

            const vanillaExportKey = (options.exportKey || "").replace("::", "");

            try {
                const exportKey = vanillaExportKey + "::";
                VIEWER_MANAGER.addHandler('export-data', async () => {
                    const data = await this.exportData(vanillaExportKey);
                    if (data) {
                        console.warn("Xopat Module Viewer Singleton should not export to a global context, instead, it should export to a viewer context!");
                        await store.set(vanillaExportKey, data);
                    }

                    const contextID = this.viewer.uniqueId;
                    const viewerData = await this.exportViewerData(this.viewer, vanillaExportKey, contextID);
                    if (data) {
                        await store.set(vanillaExportKey + "::" + contextID, viewerData);
                    }
                });

                // fallback compatibility, import fo all viewers (importing to just one would make repeated re-import)
                const data = await store.get(exportKey);
                if (data !== undefined) await this.importData(exportKey, data);

            } catch (e) {
                console.error('IO Failure:', this.constructor.name, e);
                this.error({
                    error: e, code: "W_IO_INIT_ERROR",
                    message: $.t('error.pluginImportFail',
                        { plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');" })
                });
            }
            return store;
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

        constructor(id: string) {
            super(id, "plugin");
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
            return value;
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
                    if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                        let plugins = [];
                        for (let p in PLUGINS) {
                            if (PLUGINS[p]?.loaded) plugins.push(p);
                        }
                        APPLICATION_CONTEXT.AppCookies.set('_plugins', plugins.join(","));
                    }
                }

                if (pluginsWereInitialized()) {
                    initializePlugin(PLUGINS[id]?.instance).then(success => {
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

            /**
             * Event to export your data within the viewer lifecycle
             * Event handler can by <i>asynchronous</i>, the event can wait.
             *
             * @memberof VIEWER_MANAGER
             * @event export-data
             */
            await VIEWER_MANAGER.raiseEventAwaiting('export-data');
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
         */
        export: async function () {

            let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualization export</title></head>
<body><!--Todo errors might fail to be stringified - cyclic structures!-->
<div>Errors (if any): <pre>${(console as any).appTrace.join("")}</pre></div>
${await UTILITIES.getForm()}
</body></html>`;

            UTILITIES.downloadAsFile("export.html", doc);
            APPLICATION_CONTEXT.__cache.dirty = false;
        },

        /**
         * Clone the viewer to a new window, only two windows can be shown at the time.
         */
        clone: async function () {
            if (window.opener) {
                return;
            }

            let ctx = Dialogs.getModalContext('synchronized-view');
            if (ctx) {
                ctx.window.focus();
                return;
            }
            let x = window.innerWidth / 2, y = window.innerHeight;
            window.resizeTo(x, y);
            Dialogs._showCustomModalImpl('synchronized-view', "Loading...",
                await UTILITIES.getForm(), `width=${x},height=${y}`);
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
            let ctx = Dialogs.getModalContext('__xopat__debug__window__');
            if (ctx) {
                ctx.window.focus();
                return ctx.window;
            }

            Dialogs.showCustomModal('__xopat__debug__window__', 'Debugging Window', 'Debugging Window', html);
            const window = Dialogs.getModalContext('__xopat__debug__window__')?.window;
            if (!window) {
                return null;
            }

            return window;
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

            if (staticPreview) data.params.isStaticPreview = true;
            if (!withCookies) data.params.bypassCookies = true;
            data.params.bypassCacheLoadTime = true;

            const snapshotViewport = (viewer: OpenSeadragon.Viewer) => ({
                zoomLevel: viewer.viewport.getZoom(),
                point: viewer.viewport.getCenter(),
                rotation: viewer.viewport.getRotation(),
            });
            const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(Boolean);
            if (viewers.length <= 1) {
                const v = viewers[0] || VIEWER;
                data.params.viewport = snapshotViewport(v);
            } else {
                data.params.viewport = viewers.map(snapshotViewport);
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
        }
    };

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

    function findViewerUniqueId(viewer: OpenSeadragon.Viewer): UniqueViewerId | undefined {
        let result = viewer.__cachedUUID;
        if (result) return result;
        let firstItem = null;
        for (let itemIndex = 0; itemIndex < viewer.world.getItemCount(); itemIndex++) {
            const item: OpenSeadragon.TiledImage = viewer.world.getItemAt(itemIndex);
            const config = item?.getConfig("background");
            if (config) {
                viewer.__cachedUUID = config.id;
                return config.id;
            }
            if (!firstItem) {
                firstItem = item;
            }
        }

        // Valid state - nothing opened
        if (viewer.world.getItemCount() === 1 && firstItem && firstItem.source instanceof OpenSeadragon.EmptyTileSource) {
            return '__empty__';
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
         * @param {object} CONFIG - Configuration bag; must contain params.headers etc. used to configure viewers.
         */
        constructor(CONFIG: typeof APPLICATION_CONTEXT.config) {
            super();
            this.CONFIG = CONFIG;
            this.menu = null;
            this.viewers = [];
            this.viewerMenus = {};
            this.broadcastEvents = {} as typeof this.broadcastEvents;
            this.active = null;
            this._singletonsKey = Symbol('singletons');

            // layout container
            this.layout = new UI.StretchGrid({ cols: 2, gap: "2px" });
            this.layout.attachTo(document.getElementById("osd")); // attach once

            // add initial viewer
            this.add(0);
            this.setActive(0);
        }

        _wire(v: OpenSeadragon.Viewer) {
            const el = v.container;
            el.tabIndex = 0;

            //todo maybe rely on OSD events. Also, prevent changing the focus when a mouse is dragged and exits the area
            const set = () => this.setActive(v);
            el.addEventListener("pointerdown", set);
            el.addEventListener("mouseenter", set);
            el.addEventListener("focusin", set);
            v.addHandler("canvas-enter", set);
            v.addHandler("canvas-press", set);

            v.addOnceHandler &&
                v.addOnceHandler("destroy", () => {
                    if (this.active === v) {
                        this.active = this.viewers.find((x) => x !== v) || null;
                    }
                    this.viewers = this.viewers.filter((x) => x !== v);
                });
        }

        /**
         * Set the active viewer.
         * @param v - Index into the viewers array, unique ID, or a viewer instance.
         * @returns {void}
         */
        setActive(v: number | string | OpenSeadragon.Viewer | undefined) {
            if (typeof v === "number") v = this.viewers[v];
            if (typeof v === "string") v = this.getViewer(v);
            if (!v || this.active === v) return;
            this.active = v as OpenSeadragon.Viewer;
            // optional: add a CSS class to highlight active container
            this.viewers.forEach((vw: OpenSeadragon.Viewer) =>
                vw.container.classList.toggle("active", vw === this.active)
            );
        }

        /**
         * Get the currently active viewer instance.
         */
        get() {
            return this.active;
        }

        /**
         * Get viewer by ID. This method is usable only when the viewer the viewer is already loaded.
         */
        getViewer(uniqueId: string, _warn = true): OpenSeadragon.Viewer | undefined {
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
         * Helper method to get viewer instance from viewer-like argument.
         */
        ensureViewer(viewerOrUniqueId: ViewerLikeItem): OpenSeadragon.Viewer {
            if (!viewerOrUniqueId) throw new Error("No viewer or viewer id provided!");
            if (typeof viewerOrUniqueId === "string") {
                return this.getViewer(viewerOrUniqueId)!;
            }
            return viewerOrUniqueId;
        }

        /**
         * Create or replace a viewer at the given index and mount it into the grid layout.
         * Replaces existing viewer if present at that index.
         */
        add(index: number) {
            if (this.viewers[index]) this.delete(index);

            // make a unique cell inside the grid
            const cellId = `osd-${index}`;
            const navigatorId = cellId + "-navigator";
            const cell = this.layout.attachCell(cellId, index);
            this.menu = new UI.RightSideViewerMenu(cellId, navigatorId);
            // todo think of a better way of hosting menu within the viewer
            cell.append(this.menu.create());
            this.menu.onLayoutChange({ width: window.innerWidth });
            this.viewerMenus[cellId] = this.menu;

            const viewer = window.OpenSeadragon($.extend(
                true,
                ENV.openSeadragonConfiguration,
                ENV.client.osdOptions,
                {
                    id: cellId, // mount into that grid cell
                    navigatorId: navigatorId,
                    prefixUrl: ENV.openSeadragonPrefix + "images",
                    loadTilesWithAjax: true,
                    drawer: 'flex-renderer',
                    drawerOptions: {
                        'flex-renderer': {
                            webGlPreferredVersion: APPLICATION_CONTEXT.getOption("webGlPreferredVersion"),
                            backgroundColor: APPLICATION_CONTEXT.getOption("background"),
                            debug: !!APPLICATION_CONTEXT.getOption("webglDebugMode"),
                            interactive: true,
                            htmlHandler: (shaderLayer, shaderConfig) => {
                                viewer.getMenu().getShadersTab().createLayer(viewer, shaderLayer, shaderConfig);
                            },
                            htmlReset: () => viewer.getMenu().getShadersTab().clearLayers()
                        }
                    },
                    splitHashDataForPost: true,
                    subPixelRoundingForTransparency:
                        navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc") ?
                            window.OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                            window.OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
                    debugMode: APPLICATION_CONTEXT.getOption("debugMode", false, false),
                    maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount", undefined, false)
                }
            ));

            $(viewer.element).on('contextmenu', function (event: Event) {
                event.preventDefault();
            });

            for (let event in this.broadcastEvents) {
                const eventList = this.broadcastEvents[event];
                for (let handler of eventList!.keys()) {
                    const hData = eventList!.get(handler);
                    viewer.addHandler(event, handler, hData.userData, hData.priority);
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
                    try {
                        if (!this._getSingleton(SingletonClass.IID, viewer)) {
                            SingletonClass.instance(viewer);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }

                if (e.firstLoad) {
                    const DELAY = 90;
                    let last = 0;
                    new OpenSeadragon.MouseTracker({
                        element: "viewer-container",
                        moveHandler: function (e) {
                            // if we are the main active viewer
                            if (VIEWER === viewer) {
                                const now = Date.now();
                                if (now - last < DELAY) return;
                                last = now;
                                const image = viewer.scalebar.getReferencedTiledImage() || viewer.world.getItemAt(0);
                                if (!image) return;
                                const screen = new OpenSeadragon.Point((e.originalEvent as MouseEvent).x, (e.originalEvent as MouseEvent).y);
                                const position = image.windowToImageCoordinates(screen);

                                let result = [`${Math.round(position.x)}, ${Math.round(position.y)} px`];
                                const hasBg = APPLICATION_CONTEXT.config.background.length > 0;
                                let tidx = 0;

                                const viewport = VIEWER.viewport.windowToViewportCoordinates(screen);
                                if (hasBg) {
                                    const pixel = getPixelData(screen, viewport, tidx);
                                    if (pixel) {
                                        result.push(`tissue: R${pixel[0]} G${pixel[1]} B${pixel[2]}`)
                                    } else {
                                        result.push(`tissue: -`)
                                    }
                                    tidx++;
                                }

                                // TODO return overlay info logging
                                // if (vis) {
                                //     const pixel = getPixelData(screen, viewport, tidx);
                                //     if (pixel) {
                                //         result.push(`overlay: R${pixel[0]} G${pixel[1]} B${pixel[2]}`)
                                //     } else {
                                //         result.push(`overlay: -`)
                                //     }
                                // }
                                USER_INTERFACE.Status.show(result.join("<br>"));
                            }
                        }
                    });

                    /**
                     * @param screen
                     * @param viewportPosition
                     * @param {number|OpenSeadragon.TiledImage} tiledImage
                     */
                    function getPixelData(screen: any, viewportPosition: any, tiledImage: any) {
                        // todo fix this
                        return;
                        function changeTile() {
                            let tiles = tiledImage.lastDrawn;
                            //todo verify tiles order, need to ensure we prioritize higher resolution!!!
                            for (let i = 0; i < tiles.length; i++) {
                                if (tiles[i].bounds.containsPoint(viewportPosition)) {
                                    return tiles[i];
                                }
                            }
                            return undefined;
                        }

                        if (Number.isInteger(tiledImage)) {
                            tiledImage = viewer.world.getItemAt(tiledImage);
                            if (!tiledImage) {
                                //some error since we are missing the tiled image
                                return undefined;
                            }
                        }
                        let tile;
                        tile = changeTile();
                        if (!tile) return undefined;

                        // get position on a current tile
                        let x = screen.x - tile.position.x;
                        let y = screen.y - tile.position.y;

                        //todo: reads canvas context out of the result, not the original data
                        let canvasCtx = tile.getCanvasContext();
                        let relative_x = Math.round((x / tile.size.x) * canvasCtx.canvas.width);
                        let relative_y = Math.round((y / tile.size.y) * canvasCtx.canvas.height);
                        return canvasCtx.getImageData(relative_x, relative_y, 1, 1).data;
                    }

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

                // Every load event, update data
                (async function () {
                    // Find all imports that fit to the target viewer and import to the plugin
                    const contextID = findViewerUniqueId(viewer);

                    for (let element of REGISTERED_ELEMENTS) {
                        if (typeof element.getOption === "function" && element.getOption('ignorePostIO', false)) {
                            return;
                        }

                        const store = (element as any)[STORE_TOKEN];
                        if (!store) continue;

                        for (let key of await store.keys()) {
                            const keyParts = key.split("::");
                            if (keyParts.length < 2 || keyParts[1] !== contextID) continue;
                            const data = await store?.get(key);
                            try {
                                if (data !== undefined) await element.importViewerData(viewer, key, contextID!, data);
                            } catch (e) {
                                console.error('IO Failure:', element.constructor.name, e);
                                element.error({
                                    error: e, code: "W_IO_INIT_ERROR",
                                    message: $.t('error.pluginImportFail',
                                        { plugin: element.id, action: "USER_INTERFACE.highlightElementId('global-export');" })
                                });
                            }
                        }
                    }
                })();
            });

            viewer.addHandler('destroy', () => {
                const singletons = viewer[this._singletonsKey];
                if (singletons) {
                    for (let singletonId in singletons) {
                        singletons[singletonId].destroy();
                    }
                    viewer[this._singletonsKey] = null;
                }
            })

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
         * Get singleton for particular viewer. This works only for existing isntances - prefer using
         * @param {string} singletonId
         * @param {ViewerLikeItem} viewerOrUniqueId
         * @return {XOpatViewerSingleton|undefined} menu instance or undefined if not found and SingletonClass not specified
         * @private
         */
        _getSingleton(singletonId: string, viewerOrUniqueId: ViewerLikeItem) {
            let viewer = this.ensureViewer(viewerOrUniqueId);
            return singletonId !== undefined ? viewer[this._singletonsKey]?.[singletonId] : undefined;
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
            this.raiseEvent('viewer-destroy', { viewer, uniqueId: viewer.uniqueId, index: removeIndex });

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
                viewer.destroy();
            } catch (e) {
                console.warn('Viewer destroy failed', e);
            }

            try {
                this.layout.removeAt(removeIndex);
            } catch (e) {
                console.warn('Viewer layout removal failed', e);
            }

            if (slotIndex >= 0) {
                this.viewers.splice(slotIndex, 1);
            }

            if (this.active === viewer) {
                this.active = this.viewers[0] || null;
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

            try {
                // Clear all items
                delete viewer.__cachedUUID;
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
            } catch (e) {
                console.warn("Viewer reset failed - will recreate. Cause:", e);
                this.add(index); //recreate force
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

        return Promise.all(REGISTERED_PLUGINS!.map(plugin => initializePlugin(plugin))).then(() => {
            REGISTERED_PLUGINS = undefined;
        }).then(callDeployedViewerInitialized);
    };
}