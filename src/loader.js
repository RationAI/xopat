/**
 * @typedef {Object} XOpatElementRecord
 * @property {string} id
 * @property {string} [name]
 * @property {string} [directory]
 * @property {Array<string>} [includes]
 * @property {boolean} [permaLoad]
 * @property {*} [instance]
 * @property {boolean} [loaded]
 * @property {*} [error]
 */

/**
 * @typedef {string} UniqueViewerId
 * Unique ID per viewer session. Accessed as `viewer.uniqueId`. Related to any data-like
 * function and logics. Do not mix with `ViewerId` type (`viewer.id`).
 */

/**
 * @typedef {string} ViewerId
 * ID per viewer instance. Accessed as `viewer.id`. Related to any UI-like
 * function and logics when we don't care about the particular viewer instance, but position.
 */

/**
 * @typedef {OpenSeadragon.Viewer|UniqueViewerId} ViewerLikeItem
 * Viewer or unique viewer ID. Syntax sugar for methods that usually accept both parameters.
 */

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
 *
 * @param ENV
 * @param {Object<string, XOpatElementRecord>} PLUGINS
 * Registry object of plugins keyed by plugin id (from include.json).
 * @param {Object<string, XOpatElementRecord>} MODULES
 * Registry object of modules keyed by module id (from include.json).
 * @param {string} PLUGINS_FOLDER - Base URL or path where plugin folders reside (trailing slash optional).
 * @param {string} MODULES_FOLDER - Base URL or path where module folders reside (trailing slash optional).
 * @param {Object<string, any>} POST_DATA - Payload forwarded to API calls; can be an empty object if no data is required.
 * @param {string} version - Version string of the running build.
 * @returns {function(): Promise<void>} A function to be called once the host app is ready. You can await the handler if you like.
 */
function initXOpatLoader(ENV, PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, version) {
    if (window.XOpatPlugin) throw "XOpatLoader already initialized!";

    //dummy translation function in case of no translation available
    $.t = $.t || (x => x);

    /**
     * @type {XOpatElement[]}
     */
    let REGISTERED_ELEMENTS = [];
    /**
     * @type {XOpatPlugin[]}
     */
    let REGISTERED_PLUGINS = [];
    let LOADING_PLUGIN = false;
    const REQUIRED_SINGLETONS = new Set();

    function pluginsWereInitialized() {
        return REGISTERED_PLUGINS === undefined;
    }

    window.showPluginError = function (id, e, loaded=undefined) {
        // todo should access vanjs component instead
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            if (loaded) $(`#load-plugin-${id}`).html("");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">${$.t('messages.pluginRemoved')}<br><code>[${e}]</code></div>`);
        $(`#load-plugin-${id}`).html(`<button disabled class="btn">${$.t('common.Failed')}</button>`);
    }

    function cleanUpScripts(id) {
        $(`#script-section-${id}`).remove();
        LOADING_PLUGIN = false;
    }

    function cleanUpPlugin(id, e=$.t('error.unknown')) {
        if (PLUGINS[id]) {
            delete PLUGINS[id].instance;
            PLUGINS[id].loaded = false;
            PLUGINS[id].error = e;
        }

        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
    }

    function instantiatePlugin(id, PluginClass) {
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
                message: $.t('messages.pluginLoadFailedNamed', {plugin: id}),
            });
            cleanUpPlugin(id, e);
            return;
        }

        plugin.id = id; //silently set

        let possiblyExisting = PLUGINS[id].instance;
        if (possiblyExisting) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, possiblyExisting);
            /**
             * @property {string} id plugin id
             * @property {string} message
             * @memberof VIEWER_MANAGER
             * @event plugin-failed
             */
            VIEWER_MANAGER.raiseEvent('plugin-failed', {
                id: plugin.id,
                message: $.t('messages.pluginLoadFailedNamed', {plugin: plugin.name}),
            });
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS[id].instance = plugin;
        PLUGINS[id].__ready = false;
        //clean up possible errors
        showPluginError(id, null);
        return plugin;
    }

    async function initializePlugin(plugin) {
        if (!plugin) {
            console.warn("Attempt to initialize undefined plugin.");
            return false;
        }

        try {
            if (typeof plugin.pluginReady === "function") {
                await plugin.pluginReady();
            }
            PLUGINS[plugin.id].__ready = true;
            /**
             * Plugin was loaded dynamically at runtime.
             * @property {string} id plugin id
             * @memberof VIEWER_MANAGER
             * @event plugin-loaded
             */
            VIEWER_MANAGER.raiseEvent('plugin-loaded', {id: plugin.id, plugin: plugin});
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
                message: $.t('messages.pluginLoadFailedNamed', {plugin: PLUGINS[plugin.id].name}),
            });
            console.warn(`Failed to initialize plugin ${plugin.id}.`, e);
            cleanUpPlugin(plugin.id, e);
            return false;
        }
    }

    /**
     * Load a script at runtime. Plugin is REMOVED from the viewer
     * if the script is faulty
     *
     * Enhancement: use Premise API instead
     * @param pluginId plugin that uses particular script
     * @param properties script attributes to set
     * @param onload function to call on success
     * @global
     */
    window.attachScript = function(pluginId, properties, onload) {
        let errHandler = function(e) {
            window.onerror = null;
            if (LOADING_PLUGIN) {
                cleanUpPlugin(pluginId, e);
            } else {
                cleanUpScripts(pluginId);
            }
        };

        if (!properties.hasOwnProperty('src')) {
            errHandler($.t('messages.pluginScriptSrcMissing'));
            return;
        }

        let container = document.getElementById(`script-section-${pluginId}`);
        if (!container) {
            container = document.createElement("div");
            container.id = "script-section-" + pluginId;
            document.body.append(container);
        }
        let script = document.createElement("script");
        for (let key in properties) {
            if (key === 'src') continue;
            script[key] = properties[key];
        }
        script.async = false;
        script.onload = function() {
            window.onerror = null;
            onload();
        };
        script.onerror = errHandler;
        window.onerror = errHandler;
        script.src = properties.src;
        container.append(script);
        return true;
    };

    /**
     * Get plugin.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @global
     */
    window.plugin = function(id) {
        return PLUGINS[id]?.instance;
    };

    /**
     * Get one of allowed plugin meta keys
     * @param id
     * @param {string} metaKey one of "name", "description", "author", "version", "icon"
     */
    window.pluginMeta = function(id, metaKey) {
        return ["name", "description", "author", "version", "icon"].includes(metaKey) ? PLUGINS[id]?.[metaKey] : undefined;
    }

    /**
     * Get a module singleton reference if instantiated.
     * @param id module id
     * @param {ViewerLikeItem} [viewer] if provided, viewer-context-dependent instance (XOpatViewerSingleton) is fetched
     * @return {XOpatModuleSingleton|XOpatViewerSingletonModule|undefined} module if it is a singleton and already instantiated
     */
    window.singletonModule = function (id, viewer = undefined) {
        if (viewer !== undefined) {
            return VIEWER_MANAGER._getSingleton(id, viewer);
        }
        return MODULES[id]?.instance;
    };

    /**
     * Register plugin. Plugin can be instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     * @global
     */
    window.addPlugin = function(id, PluginClass) {
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
     * @param {XOpatViewerSingleton} SingletonClass
     */
    window.requireViewerSingletonPresence = function (SingletonClass) {
        if (!(SingletonClass.prototype instanceof XOpatViewerSingleton)) {
            console.error("Invalid singleton class", SingletonClass);
            return;
        }
        REQUIRED_SINGLETONS.add(SingletonClass);
        if (window.VIEWER_MANAGER) {
            for (let v of VIEWER_MANAGER.viewers) {
                if (v.isOpen() && !this._getSingleton(SingletonClass.IDD, v)) {
                    SingletonClass.instance(v);
                }
            }
        }
    }

    function extendWith(target, source, ...properties) {
        for (let property of properties) {
            if (source.hasOwnProperty(property)) target[property] = source[property];
        }
    }

    function chainLoad(id, sources, index, onSuccess, folder=PLUGINS_FOLDER) {
        if (index >= sources.includes.length) {
            onSuccess();
        } else {
            let toLoad = sources.includes[index],
                properties = {};
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

            attachScript(id, properties,
                _ => chainLoad(id, sources, index+1, onSuccess, folder));
        }
    }

    function chainLoadModules(moduleList, index, onSuccess) {
        if (index >= moduleList.length) {
            onSuccess();
            return;
        }
        let module = MODULES[moduleList[index]];
        if (!module || module.loaded) {
            chainLoadModules(moduleList, index+1, onSuccess);
            return;
        }

        function loadSelf() {
            //load self files and continue loading from modulelist
            chainLoad(module.id + "-module", module, 0,
                function() {
                    if (module.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${module.styleSheet}' type='text/css'/>`);
                    }
                    module.loaded = true;
                    chainLoadModules(moduleList, index+1, onSuccess);
                }, MODULES_FOLDER);
        }

        //first dependencies, then self
        chainLoadModules(module.requires || [], 0, loadSelf);
    }

    async function _getLocale(id, path, directory, data, locale) {
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

    // ability to inherit from mutliple classes https://github.com/rse/aggregation/blob/master/src/aggregation-es6.js
    const All = (base, ...mixins) => {
        // Build a linearized, duplicate-free list of mixin classes,
        // ordered from closest-to-base -> most-derived
        const linearize = (base, mixins) => {
            const seen = new Set();
            const out = [];

            const visit = (K) => {
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

        // Copy property helpers (skip problematic keys)
        const copyProps = (target, source) => {
            if (!source) return;
            for (const key of Object.getOwnPropertyNames(source)) {
                if (/^(?:initializer|constructor|prototype|arguments|caller|name|bind|call|apply|toString|length)$/.test(key))
                    continue;
                Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
            }

            for (const key of Object.getOwnPropertySymbols(source)) {
                Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
            }
        };

        class Aggregate extends base {
            constructor (...args) {
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

        return Aggregate;
    };

    // POST DATA STORAGE - Always implemented via POST, support static IO.
    /**
     * @extends XOpatStorage.Data
     * @type {PostDataStore}
     */
    class PostDataStore extends XOpatStorage.Data {
        /**
         * @param options the options used in super class XOpatStorage.Data
         * @param options.xoType type of the owner
         */
        constructor(options) {
            super({...options,
                id: (options.id || "").split(".").filter((v, i) => i > 0).join(".")});
            if (options.xoType !== "plugin" && options.xoType !== "module") throw "Invalid xoType for PostDataStore!";
            this.contextType = options.xoType;
            //write target
            this.__storage._withReference(this.contextType);
        }

        /**
         * The ability to export all relevant data is used mainly with current session exports/shares.
         * This is used for immediate static export of the current state.
         * @return {Promise<string>} serialized data
         */
        async export() {
            const exports = {};
            //bit dirty, but we rely on keys implementation as we hardcode storage driver
            for (let key of this.__storage._keys()) {
                if (key.startsWith(this.id)) {
                    exports[key] = await this.__storage.get(key);
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
         * @param Class ignored argument, this class hardcodes POST DATA 'driver'
         */
        static register(Class) {
            super.registerClass(class extends XOpatStorage.AsyncStorage {
                async getItem(key) {
                    let storage = POST_DATA[this.ref];
                    // backward non-namespaced compatibility
                    return POST_DATA[key] || (storage && storage[key]);
                }
                async setItem(key, value) {
                    let storage = POST_DATA[this.ref];
                    if (!storage) {
                        storage = POST_DATA[this.ref] = {};
                    }
                    storage[key] = value;
                }
                async removeItem(key) {
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
                get length() {
                    let storage = POST_DATA[this.ref];
                    return Object.keys(storage || {}).length;
                }
                async key(index) {
                    let storage = POST_DATA[this.ref];
                    return Object.keys(storage || {})[index];
                }
                _keys() { //internal loader use
                    let storage = POST_DATA[this.ref];
                    return Object.keys(storage || {});
                }
                _withReference(ref) {  //internal loader use
                    this.ref = ref;
                }
            });
        }
    }
    PostDataStore.register(null);
    const STORE_TOKEN = Symbol("XOpatElementDataStore");
    const CACHE_TOKEN = Symbol("XOpatElementCacheStore");

    /**
     * @typedef {string} XOpatElementID
     * Element ID unique to instance, either plugin or module id.
     */

    /**
     * Implements common interface for plugins and modules. Cannot
     * be instantiated as it is hidden in closure. Private, but
     * available in docs due to its API nature.
     * @extends OpenSeadragon.EventSource
     * @abstract
     */
    class XOpatElement extends OpenSeadragon.EventSource {

        /**
         * @param {XOpatElementID} id
         * @param {('plugin'|'module')} executionContextName
         */
        constructor(id, executionContextName) {
            super();

            if (!id) throw `Trying to instantiate an element '${this.constructor.name || this.constructor}' - no id given.`;
            this.__id = id;
            this.__uid = `${executionContextName}.${id}`;
            this.__xoContext = executionContextName;

            /**
             * @type {string} id element identifier
             * @memberof XOpatElement
             */
            this.constructor.id = id;

            this[CACHE_TOKEN] = new XOpatStorage.Cache({id: this.__uid});
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
        getLocaleFile(locale) {
            return `locales/${locale}.json`;
        }

        /**
         * Translate the string in given element context
         * @param key
         * @param options
         * @return {*}
         */
        t(key, options={}) {
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
        error(e, notifyUser=true) {
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
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent(notifyUser ? 'error-user' : 'error-system',
                $.extend(e, {originType: this.xoContext, originId: this.id}));
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
        warn(e, notifyUser) {
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
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent(notifyUser ? 'warn-user' : 'warn-system',
                $.extend(e,
                    {originType: this.xoContext, originId: this.id}));
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
        async initPostIO(options = {}) {
            if (typeof this.getOption === "function" && this.getOption('ignorePostIO', false)) {
                return;
            }

            options.id = this.uid;
            options.xoType = this.__xoContext;
            if (options.inViewerContext === undefined) {
                options.inViewerContext = true;
            }
            let store = this[STORE_TOKEN];
            if (!store) {
                this[STORE_TOKEN] = store = new PostDataStore(options);
            }

            const vanillaExportKey = (options.exportKey || "").replace("::", "");

            try {
                VIEWER_MANAGER.addHandler('export-data', async (e) => {
                    const data = await this.exportData(vanillaExportKey);
                    if (data) {
                        await store.set(vanillaExportKey, data);
                    }

                    if (options.inViewerContext) {
                        const exportKey = vanillaExportKey + "::";
                        for (let v of VIEWER_MANAGER.viewers) {
                            const contextID = findViewerUniqueId(v);
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
                        {plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
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
        async exportData(key) {}
        /**
         * Works the same way as @exportData, but for the viewer context.
         * @param viewer {OpenSeadragon.Viewer} the target viewer
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param viewerTargetID {string} the viewer contextual ID it was exported with, default empty string
         * @return {Promise<any>}
         */
        async exportViewerData(viewer, key, viewerTargetID) {
            return {};
        }
        /**
         * Called automatically within this.initPostIO if data available
         * note: parseImportData return value decides if data is parsed data or passed as raw string
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param data {any} data
         */
        async importData(key, data) {}
        /**
         * Works the same way as @importData, but for the viewer context.
         * @param viewer {OpenSeadragon.Viewer} the target viewer
         * @param key {string} the data contextual ID it was exported with, default empty string
         * @param viewerTargetID {string} the viewer contextual ID it was exported with, default empty string
         * @param data {any} data
         */
        async importViewerData(viewer, key, viewerTargetID, data) {}

        /**
         * Get context of viewer that is suitable for storing viewer-related data.
         * @param id
         * @return {{}|undefined}
         */
        getViewerContext(id) {
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
        integrateWithSingletonModule(moduleId, callback, viewer = undefined) {
            const targetModule = singletonModule(moduleId);
            if (targetModule) {
                callback(targetModule);
                return true;
            }
            VIEWER_MANAGER.addHandler('module-singleton-created', e => {
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
        registerViewerMenu(getter) {
            const insert = (content, menuComponent) => {
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

            const updateMenu = (viewer) => {
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
            VIEWER_MANAGER.broadcastHandler('open', (e) => updateMenu(e.eventSource));
            // 2. Hook into viewer reset (clearing data) to potentially remove the menu 'viewer-reset' is a ViewerManager event
            VIEWER_MANAGER.addHandler('viewer-reset', (e) => updateMenu(e.viewer));

            VIEWER_MANAGER.viewers.forEach(v => {
                // Update regardless of state, logic inside handles null/removal
                updateMenu(v);
            });
        }
    }

    /**
     * Basic Module API. Modules do not have to inherit from XOpatModule, but
     * they loose the integration support.
     * @class XOpatModule
     * @extends XOpatElement
     * @inheritDoc
     */
    window.XOpatModule = class extends XOpatElement {

        constructor(id) {
            super(id, "module");
            this.__o = {};
        }

        /**
         * Load localization data
         * @param locale the current locale if undefined
         * @param data possibly custom locale data if not fetched from a file
         * @return {Promise}
         */
        async loadLocale(locale=undefined, data=undefined) {
            return await _getLocale(this.id, MODULES_FOLDER, MODULES[this.id]?.directory,
                data || this.getLocaleFile(locale || $.i18n.language), locale);
        }

        /**
         * Read static metadata - include.json contents and additional meta attached at runtime
         * @param metaKey key to read
         * @param defaultValue
         * @return {undefined|*}
         */
        getStaticMeta(metaKey, defaultValue) {
            if (metaKey === "instance") return undefined;
            const value = MODULES[this.id]?.[metaKey];
            if (value === undefined) return defaultValue;
            return value;
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
        getOption(optionKey, defaultValue, cache=true) {
            //options are stored only for plugins, so we store them at the lowest level
            let value = cache ? this.cache.get(optionKey, null) : null;
            if (value === null) {
                value = this.__o[optionKey];
            }
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
        setOption(key, value, cache=true) {
            if (cache) this.setCacheOption(key, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            APPLICATION_CONTEXT.config.plugins[this.id][key] = value;
        }

        /**
         * Ability to cache a value locally into the browser,
         * the value can be retrieved using this.getOption(...)
         * @param {string} key
         * @param value
         */
        setCacheOption(key, value) {
            this.cache.set(key, value);
        }

        /**
         * Base URL/path to the modules folder.
         * Useful for resolving module-relative assets.
         * @type {string}
         * @public
         */
        static ROOT = MODULES_FOLDER;

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
    window.XOpatModuleSingleton = class extends XOpatModule {
        /**
         * Get instance of the annotations manger, a singleton
         * (only one instance can run since it captures mouse events).
         * @static
         * @return {XOpatModuleSingleton} manager instance
         */
        static instance() {
            //this calls sub-class constructor, no args required
            this.__self = this.__self || new this();
            return this.__self;
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
         * @param {string} id  The ID must be the module id defined in configuration.
         */
        constructor(id) {
            super(id);
            const staticContext = this.constructor;
            if (staticContext.__self) {
                throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
            }
            staticContext.__self = this;

            MODULES[id].instance = this;

            // Await event necessary to fire after instantiation, do in async context
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
     * @class XOpatViewerSingleton
     * @extends OpenSeadragon.EventSource
     * @inheritDoc
     */
    window.XOpatViewerSingleton = class extends OpenSeadragon.EventSource {
        /**
         * Destroy. This method must be called if overridden.
         */
        destroy() {
            const state = this.constructor.__getBroadcastState?.();
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
         * Get instance of the annotations manger, a singleton
         * (only one instance can run since it captures mouse events).
         * @param {ViewerLikeItem} viewerOrUniqueId
         * @static
         * @return {XOpatModuleSingleton} manager instance
         */
        static instance(viewerOrUniqueId) {
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
        static instantiated(viewerOrUniqueId) {
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
        constructor(viewer) {
            // id ignored, only to be compatible with XOpatElement
            if (viewer === undefined) {
                throw new Error("Viewer must be provided to create a viewer-singleton!");
            }
            super();

            // throws if exists
            VIEWER_MANAGER._attachSingleton(this.constructor.IID, this, viewer);

            /**
             * @type {OpenSeadragon.Viewer}
             * @member viewer
             * @memberOf XOpatViewerSingletonModule
             */
            Object.defineProperty(this, 'viewer', {
                get: () => viewer,
            });

            this.constructor.__attachAllHandlersToInstance(this);

            // Await event necessary to fire after instantiation, do in async context
            /**
             * Singleton was instantiated
             * @property {string} id
             * @property {XOpatViewerSingleton} singleton
             * @memberof VIEWER_MANAGER
             * @event viewer-singleton-created
             */
            setTimeout(() => VIEWER_MANAGER.raiseEventAwaiting('viewer-singleton-created', {
                id: this.constructor.IID,
                module: this,
                viewer: viewer
            }).catch(/*no-op*/));
        }

        /**
         * JS String to use in DOM callbacks to access self instance.
         * @type {string}
         */
        get THIS() {
            const id = this.constructor.IID;
            //memoize
            Object.defineProperty(this, "THIS", {
                value: `singletonModule('${id}', '${this.viewer.uniqueId}')`,
                writable: false,
            });
            return `singletonModule('${id}', '${this.viewer.uniqueId}')`;
        }

        /**
         * Get all instances of the singleton from all active viewers.
         * @return {XOpatViewerSingletonModule[]}
         */
        get instances() {
            return VIEWER_MANAGER._getSingletons(this.constructor.IID);
        }

        static instances() {
            return VIEWER_MANAGER._getSingletons(this.IID);
        }

        /**
         * Attach a class-wide handler to all current and future instances of this subclass.
         * Handler is called as handler.call(emittingInst, emittingInst, event, ...args)
         */
        static broadcastHandler(eventName, handler, ...args) {
            const state = this.__getBroadcastState();
            if (!state.has(eventName)) state.set(eventName, new Map());
            const perHandler = state.get(eventName);

            if (perHandler.has(handler)) return; // idempotent

            const record = { args, wrappers: new Map() };
            perHandler.set(handler, record);

            // Attach immediately to instances that are already event sources
            for (const inst of this.instances()) {
                const wrapper = (e) => handler.call(inst, inst, e, ...args);
                record.wrappers.set(inst, wrapper);
                inst.addHandler(eventName, wrapper);
            }
        }

        /**
         * Remove a previously added class-wide handler from all instances of this subclass.
         */
        static cancelBroadcast(eventName, handler) {
            const state = this.__getBroadcastState();
            const perHandler = state.get(eventName);
            if (!perHandler) return;

            const record = perHandler.get(handler);
            if (!record) return;

            for (const [inst, wrapper] of record.wrappers.entries()) {
                try { inst.removeHandler(eventName, wrapper); } catch (_) { /* no-op */ }
            }
            perHandler.delete(handler);
            if (perHandler.size === 0) state.delete(eventName);
        }

        /**
         * Attach every broadcast handler registered on this subclass to a particular instance.
         * Called after the instance becomes an event source.
         * @private
         */
        static __attachAllHandlersToInstance(inst) {
            const state = this.__getBroadcastState();

            for (const [eventName, perHandler] of state.entries()) {
                for (const [origHandler, record] of perHandler.entries()) {
                    if (record.wrappers.has(inst)) continue;
                    const wrapper = (e) => origHandler.call(inst, inst, e, ...record.args);
                    record.wrappers.set(inst, wrapper);
                    inst.addHandler(eventName, wrapper);
                }
            }
        }

        /**
         * Per-subclass state: { Map<eventName, Map<fn, {args:any[], wrappers: Map<inst, fn> }> }
         * (Own property on the subclass, so subclasses don't share.)
         */
        static __getBroadcastState() {
            if (!Object.prototype.hasOwnProperty.call(this, "__broadcastState")) {
                Object.defineProperty(this, "__broadcastState", {
                    value: new Map(),
                    writable: false, enumerable: false, configurable: false
                });
            }
            return this.__broadcastState;
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
    window.XOpatViewerSingletonModule = class extends All(XOpatModule, XOpatViewerSingleton) {

        constructor(id, viewer) {
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
        async initPostIO(options = {}) {
            if (typeof this.getOption === "function" && this.getOption('ignorePostIO', false)) {
                return;
            }

            options.id = this.uid;
            options.xoType = this.__xoContext;
            let store = this[STORE_TOKEN];
            if (!store) {
                this[STORE_TOKEN] = store = new PostDataStore(options);
            }

            const vanillaExportKey = (options.exportKey || "").replace("::", "");

            try {
                const exportKey =  vanillaExportKey + "::";
                VIEWER_MANAGER.addHandler('export-data', async (e) => {
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
                        {plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
                });
            }
            return store;
        }
    }

    /**
     * xOpat Plugin API. Plugins must have a parent class that
     * is registered and inherits from XOpatPlugin.
     * JS String to use in DOM callbacks to access self instance.
     * @class
     * @extends XOpatElement
     * @inheritDoc
     */
    window.XOpatPlugin = class extends XOpatElement {

        constructor(id) {
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
        async loadLocale(locale=undefined, data=undefined) {
            return await _getLocale(this.id, PLUGINS_FOLDER, PLUGINS[this.id]?.directory,
                data || this.getLocaleFile(locale || $.i18n.language), locale)
        }

        /**
         * Read static metadata - include.json contents and additional meta attached at runtime
         * @param metaKey key to read
         * @param defaultValue
         * @return {undefined|*}
         */
        getStaticMeta(metaKey, defaultValue) {
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
        setOption(key, value, cache=true) {
            if (cache) this.setCacheOption(key, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            APPLICATION_CONTEXT.config.plugins[this.id][key] = value;
        }

        /**
         * Read the plugin online configuration parameters/options.
         * The defaultValue is read from a static configuration if not provided.
         * Note that this behavior will read static values such as 'permaLoad', 'includes' etc..
         * @param {string} key
         * @param {*} defaultValue
         * @param {boolean} cache
         * @memberof XOpatPlugin
         * @return {*}
         */
        getOption(key, defaultValue=undefined, cache=true) {
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
         * Ability to cache a value locally into the browser,
         * the value can be retrieved using this.getOption(...)
         * @param {string} key
         * @param value
         */
        setCacheOption(key, value) {
            this.cache.set(key, value);
        }

        /**
         * Read plugin configuration value - either from a static configuration or dynamic one.
         * More generic function that reads any option available (configurable via dynamic JSON or include.json)
         * @param {string} optKey dynamic param key, overrides anything
         * @param {string} staticKey static param key, used if dynamic value is undefined
         * @param {any} defaultValue
         * @param {boolean} cache
         */
        getOptionOrConfiguration(optKey, staticKey, defaultValue=undefined, cache=true) {
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
        integrateWithPlugin(pluginId, callback) {
            const targetPlugin = plugin(pluginId);
            if (targetPlugin &&  PLUGINS[pluginId].__ready) {
                callback(targetPlugin);
                return true;
            }
            VIEWER_MANAGER.addHandler('plugin-loaded', e => {
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
    }

    /**
     * @namespace UTILITIES
     */
    window.UTILITIES = /** @lends UTILITIES */ {
        /**
         * @param imageFilePath image path
         * @param stripSuffix
         */
        fileNameFromPath: function(imageFilePath, stripSuffix=true) {
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
         * @param {BackgroundItem|number|StandaloneBackgroundItem} indexOrItem
         * @param {boolean} [stripSuffix=true]
         */
        nameFromBGOrIndex: function (indexOrItem, stripSuffix = true) {
            // todo some error if not a string, that name must be provided etc...
            const item = typeof indexOrItem === "number" ? APPLICATION_CONTEXT.config.background[indexOrItem] : indexOrItem;
            if (!item) return "unknown";
            if (item.name) return name;
            let path = APPLICATION_CONTEXT.config.data[item.dataReference];
            if (!path && typeof item.dataReference !== "number") {
                path = item.dataReference;
            }

            if (typeof path === "string") {
                return this.fileNameFromPath(path, stripSuffix);
            }
            if (typeof path === "object") {
                // todo some stragtegy?
                return path.name || path.label || path.title || path[Object.keys(path)[0]];
            }
            console.warn("Background item has no parseable path and name is not set! This makes the slide unnameable!");
            return "undefined";
        },

        /**
         * Strip path suffix
         * @param {string} path
         * @return {string}
         */
        stripSuffix: function (path) {
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
        loadModules: function(onload=_=>{}, ...ids) {
            LOADING_PLUGIN = false;
            chainLoadModules(ids, 0, () => {
                /**
                 * Module loaded event. Fired only with dynamic loading.
                 * @property {string} id module id
                 * @memberof VIEWER_MANAGER
                 * @event module-loaded
                 */
                ids.forEach(id => VIEWER_MANAGER.raiseEvent('module-loaded', {id: id}));
                onload && onload();
            });
        },

        /**
         * Load a plugin at runtime
         * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
         * @param id plugin to load
         * @param onload function to call on successful finish
         */
        loadPlugin: function(id, onload=_=>{}, force) {
            let meta = PLUGINS[id];
            if (!meta || (meta.loaded && meta.instance)) return;
            if (!Array.isArray(meta.includes)) {
                meta.includes = [];
            }

            if (pluginsWereInitialized()) {
                /**
                 * Before a request to plugin loading is processed at runtime.
                 * @property {string} id plugin id
                 * @memberof VIEWER_MANAGER
                 * @event before-plugin-load
                 */
                VIEWER_MANAGER.raiseEvent('before-plugin-load', {id: id});
            }

            let successLoaded = function() {
                LOADING_PLUGIN = false;

                function finishPluginLoad() {
                    if (meta.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
                    }
                    meta.loaded = true;
                    if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                        let plugins = [];
                        for (let p in PLUGINS) {
                            if (PLUGINS[p].loaded) plugins.push(p);
                        }
                        APPLICATION_CONTEXT.AppCookies.set('_plugins', plugins.join(","));
                    }
                }

                if (pluginsWereInitialized()) {
                    initializePlugin(PLUGINS[id].instance).then(success => {
                        if (success) {
                            finishPluginLoad();
                        }
                        onload();
                    });
                    return;
                }
                finishPluginLoad();
                onload();
            };
            LOADING_PLUGIN = true;
            chainLoadModules(meta.modules || [], 0, _ => chainLoad(id, meta, 0, successLoaded));
        },

        /**
         * Check whether component is loaded
         * @param {string} id component id
         * @param {boolean} isPlugin true if check for plugins
         */
        isLoaded: function (id, isPlugin=false) {
            if (isPlugin) {
                let plugin = PLUGINS[id];
                return plugin.loaded && plugin.instance;
            }
            return MODULES[id].loaded;
        },

        /**
         * Serialize the Viewer
         * @param includedPluginsList
         * @param withCookies
         * @param staticPreview Whether to mark the serialized app as static or not
         * @return {Promise<{app: string, data: {}}>}
         */
        serializeApp: async function(includedPluginsList=undefined, withCookies=false, staticPreview=false) {
            //reconstruct active plugins
            let pluginsData = APPLICATION_CONTEXT.config.plugins;
            let includeEvaluator = includedPluginsList ?
                (p, o) => includedPluginsList.includes(p) :
                (p, o) => o.loaded || o.permaLoad;

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
             * @property {function} setSerializedData callback to call,
             * accepts 'key' (unique) and 'data' (string) to call with your data when ready
             * @memberof VIEWER_MANAGER
             * @event export-data
             */
            await VIEWER_MANAGER.raiseEventAwaiting('export-data');
            return {app: UTILITIES.serializeAppConfig(withCookies, staticPreview), data: POST_DATA};
        }
    };

    /**
     * Focusing all key press events and forwarding to OSD
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer = true;
    function getIsViewerFocused() {
        // TODO TEST!!!
        const focusedElement = document.activeElement;
        const focusTyping = focusedElement.tagName === 'INPUT' ||
            focusedElement.tagName === 'TEXTAREA' ||
            focusedElement.isContentEditable;
        return focusTyping ? null : focusOnViewer;
    }
    /**
     * Allows changing focus state artificially
     * @param {boolean} focused
     */
    UTILITIES.setIsCanvasFocused = function(focused) {
        focusOnViewer = focused;
    };
    document.addEventListener('keydown', function(e) {
        e.focusCanvas = getIsViewerFocused();
        /**
         * @property {KeyboardEvent} e
         * @property {Viewer} e.focusCanvas the viewer this event belongs to
         * @memberof Viewer_MANAGER
         * @event keydown
         */
        VIEWER_MANAGER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function(e) {
        e.focusCanvas = getIsViewerFocused();
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
     * @param {OpenSeadragon.Viewer} viewer
     * @return {UniqueViewerId}
     */
    function findViewerUniqueId(viewer) {
        let result = viewer.__cachedUUID;
        if (result) return result;
        let firstItem = null;
        for (let itemIndex = 0; itemIndex < viewer.world.getItemCount(); itemIndex++) {
            const item = viewer.world.getItemAt(itemIndex);
            const config = item?.getConfig("background");
            if (config) {
                viewer.__cachedUUID = config.id;
                return config.id;
            }
            if (!firstItem) {
                firstItem = item;
            }
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
        get: function() {
            return findViewerUniqueId(this);
        }
    });

    /**
     * @property {function} getMenu
     * @method
     * @memberof OpenSeadragon.Viewer
     * @return {RightSideViewerMenu|undefined}
     */
    OpenSeadragon.Viewer.prototype.getMenu = function() {
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
     * @property {object} CONFIG - Application configuration.
     * @property {OpenSeadragon.Viewer[]} viewers - Ordered list of instantiated viewer instances.
     * @property {Record<string, Record<Function, any[]>>} broadcastEvents - Map of eventName to handlers+args registered for broadcasting.
     * @property {OpenSeadragon.Viewer|null} active - Currently active viewer or null if none.
     * @property {UI.StretchGrid} layout - Grid layout where viewers are mounted.
     */
    window.ViewerManager = class extends OpenSeadragon.EventSource {
        /**
         * Create a ViewerManager.
         * @param {object} CONFIG - Configuration bag; must contain params.headers etc. used to configure viewers.
         */
        constructor(CONFIG) {
            super();
            this.CONFIG = CONFIG;
            this.menu = null;
            this.viewers = [];
            this.viewerMenus = {};
            this.broadcastEvents = {};
            this.active = null;
            this._singletonsKey = Symbol('singletons');

            // layout container
            this.layout = new UI.StretchGrid({ cols: 2, gap: "2px" });
            this.layout.attachTo(document.getElementById("osd")); // attach once

            // add initial viewer
            this.add(0);
            this.setActive(0);
        }

        /** @private */
        _wire(v) {
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
         * @param {number|string|OpenSeadragon.Viewer} v - Index into the viewers array, unique ID, or a viewer instance.
         * @returns {void}
         */
        setActive(v) {
            if (typeof v === "number") v = this.viewers[v];
            if (typeof v === "string") v = this.getViewer(v);
            if (this.active === v) return;
            this.active = v;
            // optional: add a CSS class to highlight active container
            this.viewers.forEach((vw) =>
                vw.container.classList.toggle("active", vw === this.active)
            );
        }

        /**
         * Get the currently active viewer instance.
         * @returns {OpenSeadragon.Viewer|null} Active viewer or null if none.
         */
        get() {
            return this.active;
        }

        /**
         * Get viewer by ID. This method is usable only when the viewer the viewer is already loaded.
         * @param {UniqueViewerId} uniqueId
         * @param _warn private arg
         * @return OpenSeadragon.Viewer
         */
        getViewer(uniqueId, _warn=true) {
            let viewer;
            if (uniqueId.startsWith("osd-")) {
                viewer = this.viewers.find(v => v.id === uniqueId);
                if (_warn) {
                    console.warn(`Viewer with id ${uniqueId} not found, provided id is not UniqueViewerId: using ${viewer.id} for ${viewer.uniqueId} viewer detection. This might result in unexpected behavior.`);
                }
            } else {
                viewer = this.viewers.find(v => v.uniqueId === uniqueId);
            }
            return viewer;
        }

        /**
         * Get viewer reference for the configuration object
         * @param {BackgroundItem|StandaloneBackgroundItem|VisualizationItem} config
         */
        getViewerForConfig(config) {
            // todo consider: if (config.__cachedRef)

            if (!config) return undefined;

            let data = APPLICATION_CONTEXT.config.data;
            let receivedData = config.dataReference;
            if (typeof receivedData === "number") {
                receivedData = data[receivedData];
            }

            // non-strict comparator
            let comparator = typeof receivedData === "object" ?
                (a, b) =>  typeof a === "object" && Object.keys(a).every(x => !b[x] || a[x] == b[x])
                : (a, b) => a == b;

            for (let viewer of this.viewers) {
                for (let index = 0; index < viewer.world.getItemCount(); index++) {
                    const item = viewer.world.getItemAt(index);
                    const conf = item?.getConfig();
                    if (conf) {
                        const activeDataEl = data[conf.dataReference];
                        if (comparator(receivedData, activeDataEl)) {
                            return viewer;
                        }
                    }
                }
            }
            return undefined;
        }

        /**
         *
         * @param {UniqueViewerId} uniqueId
         * @param _warn private arg
         * @return number
         */
        getViewerIndex(uniqueId, _warn=true) {
            let index = this.viewers.findIndex(v => v.uniqueId === uniqueId);
            if (index < 0) {
                index = this.viewers.findIndex(v => v.id === uniqueId);
                if (index && _warn) {
                    console.warn(`Viewer with id ${uniqueId} not found, using fallback ${index.id} for ${index.uniqueId}`);
                }
            }
            return index;
        }

        /**
         * Helper method to get viewer instance from viewer-like argument.
         * @param {OpenSeadragon.Viewer|UniqueViewerId} viewerOrUniqueId
         * @return {*|OpenSeadragon.Viewer}
         */
        ensureViewer(viewerOrUniqueId) {
            if (!viewerOrUniqueId) throw new Error("No viewer or viewer id provided!");
            if (typeof viewerOrUniqueId === "string") {
                return this.getViewer(viewerOrUniqueId);
            }
            return viewerOrUniqueId;
        }

        /**
         * Create or replace a viewer at the given index and mount it into the grid layout.
         * Replaces existing viewer if present at that index.
         * @param {number} index - Zero-based viewer slot index.
         * @returns {void}
         */
        add(index) {
            if (this.viewers[index]) this.delete(index);

            // make a unique cell inside the grid
            const cellId = `osd-${index}`;
            const navigatorId = cellId + "-navigator";
            const cell = this.layout.attachCell(cellId, index);
            this.menu = new UI.RightSideViewerMenu(cellId, navigatorId);
            // todo think of a better way of hosting menu within the viewer
            cell.append(this.menu.create());
            this.menu.onLayoutChange({width: window.innerWidth});
            this.viewerMenus[cellId] = this.menu;

            const viewer = OpenSeadragon($.extend(
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
                            // todo: support debug in some reasonable way
                            // debug: window.APPLICATION_CONTEXT.getOption("webglDebugMode") || false,
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
                            OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                            OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
                    debugMode: APPLICATION_CONTEXT.getOption("debugMode", false, false),
                    maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount", undefined, false)
                }
            ));

            $(viewer.element).on('contextmenu', function(event) {
                event.preventDefault();
            });

            for (let event in this.broadcastEvents) {
                const eventList = this.broadcastEvents[event];
                for (let handler in eventList) {
                    const hData = eventList[handler];
                    viewer.addHandler(event, hData[0], ...hData[1]);
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

            viewer.addHandler('navigator-scroll', function(e) {
                viewer.viewport.zoomBy(e.scroll / 2 + 1); //accelerated zoom
                viewer.viewport.applyConstraints();
            });

            // todo move the initialization elsewhere... or restructure code a bit.... make this research config
            viewer.addHandler('open', e => {
                for (let SingletonClass of REQUIRED_SINGLETONS) {
                    try {
                        if (!this._getSingleton(SingletonClass.IDD, viewer)) {
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
                        userData: 'pixelTracker',
                        element: "viewer-container",
                        moveHandler: function (e) {
                            // if we are the main active viewer
                            if (VIEWER === viewer) {
                                const now = Date.now();
                                if (now - last < DELAY) return;
                                last = now;
                                const image = viewer.scalebar.getReferencedTiledImage() || viewer.world.getItemAt(0);
                                if (!image) return;
                                const screen = new OpenSeadragon.Point(e.originalEvent.x, e.originalEvent.y);
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
                    function getPixelData(screen, viewportPosition, tiledImage) {
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
                        this.raiseEvent('viewer-create', {viewer, uniqueId: viewer.uniqueId, index });
                    }
                }

                // Every load event, update data
                (async function() {
                    // Find all imports that fit to the target viewer and import to the plugin
                    const contextID = findViewerUniqueId(viewer);

                    for (let element of REGISTERED_ELEMENTS) {
                        if (typeof element.getOption === "function" && element.getOption('ignorePostIO', false)) {
                            return;
                        }

                        const store = element[STORE_TOKEN];
                        if (!store) continue;

                        for (let key of await store.keys()) {
                            const keyParts = key.split("::");
                            if (keyParts.length < 2 || keyParts[1] !== contextID) continue;
                            const data = await store?.get(key);
                            try {
                                if (data !== undefined) await element.importViewerData(viewer, key, contextID, data);
                            } catch (e) {
                                console.error('IO Failure:', element.constructor.name, e);
                                element.error({
                                    error: e, code: "W_IO_INIT_ERROR",
                                    message: $.t('error.pluginImportFail',
                                        {plugin: element.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
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
            viewer.addHandler('canvas-key', function(e) {
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
            viewer.toggleDemoPage = (enable, explainErrorHtml = undefined) => {
                const id = "demo-ad-" + viewer.id;

                if (enable) {
                    const {h1, br, img, p, div} = van.tags;
                    // todo ensure the outer div always has ID, even when someone added ID from outside
                    let toSet = div({ id: id },
                        h1("xOpat - The WSI Viewer"),
                        p("The viewer is missing the target data to view; this might happen, if"),
                        div({innerHTML: explainErrorHtml || $.t('error.defaultDemoHtml')}),
                        br(), br(),
                        p({ class:"text-small mx-6 text-center" },
                            "xOpat: a web based, NO-API oriented WSI Viewer with enhanced rendering of high resolution images overlaid, fully modular and customizable."),
                        img({ src:"docs/assets/xopat-banner.png", style:"width:80%;display:block;margin:0 auto;" })
                    );
                    const doOverlay = (overlay) => {
                        if (!toSet) return;
                        viewer.addOverlay(overlay || toSet, new OpenSeadragon.Rect(0, 0, 1, 1));
                        toSet = null;
                    };

                    viewer.raiseEvent('show-demo-page', {
                        id: id,
                        show: doOverlay,
                    });

                    doOverlay();
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
         * @param {string} eventName - The OpenSeadragon event name.
         * @param {Function} handler - Event handler function.
         * @param {...any} args - Optional extra arguments passed to OpenSeadragon.addHandler.
         * @returns {void}
         */
        broadcastHandler(eventName, handler, ...args) {
            let eventList = this.broadcastEvents[eventName];
            if (!eventList) {
                eventList = this.broadcastEvents[eventName] = {};
            }
            eventList[handler] = [handler, args];
            for (let v of this.viewers) {
                v.addHandler(eventName, handler, ...args);
            }
        }

        /**
         * Remove a previously broadcasted handler from all viewers and future creations.
         * If the handler was not registered, this is a no-op.
         * @param {string} eventName - The OpenSeadragon event name.
         * @param {Function} handler - The same handler function reference used in broadcastHandler.
         * @returns {void}
         */
        cancelBroadcast(eventName, handler) {
            let eventList = this.broadcastEvents[eventName];
            if (eventList) {
                delete eventList[handler];
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
        getMenu(viewerOrId) {
            let viewer = null;
            if (typeof viewerOrId === "string") {
                viewer = this.getViewer(viewerOrId, false);
            } else {
                viewer = viewerOrId;
            }
            return this.viewerMenus[viewer?.id];
        }

        /**
         * Get singleton for particular viewer. This works only for existing isntances - prefer using
         * @param {string} singletonId
         * @param {ViewerLikeItem} viewerOrUniqueId
         * @return {XOpatViewerSingleton|undefined} menu instance or undefined if not found and SingletonClass not specified
         * @private
         */
        _getSingleton(singletonId, viewerOrUniqueId) {
            let viewer = this.ensureViewer(viewerOrUniqueId);
            return singletonId !== undefined ? viewer[this._singletonsKey]?.[singletonId] : undefined;
        }

        /**
         * @private
         */
        _attachSingleton(singletonId, singletonModule, viewerOrUniqueId) {
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
        _getSingletons(singletonId) {
            return this.viewers.map(v => v[this._singletonsKey]?.[singletonId]).filter(Boolean);
        }

        /**
         * Destroy and remove the viewer at a given index and detach its grid cell.
         * Does nothing if no viewer exists at the index.
         * @param {number} index - Zero-based viewer slot index.
         * @returns {void}
         */
        delete(index) {
            const viewer = this.viewers[index];
            if (!viewer) return;

            /**
             * Raised when an existing viewer is removed from the grid layout. Called before the viewer
             * is actually removed along with all its data.
             * @param {OpenSeadragon.Viewer} viewer
             * @param {string} uniqueId
             * @param {Number} index
             * @event viewer-destroy
             * @memberof VIEWER_MANAGER
             */
            this.raiseEvent('viewer-destroy', {viewer, uniqueId: viewer.uniqueId, index });

            try {
                const menu = this.viewerMenus[viewer.id];
                if (menu) {
                    menu.destroy();
                    this.viewerMenus[viewer.id] = null;
                }

                delete viewer.__cachedUUID;
                viewer.destroy();
                this.viewers.splice(index, 1);
                this.layout.removeAt(index);

                //todo check if viewer has data and if yes prompt user and export if possible
                // explicitly clean store
                for (let key in viewer[STORE_TOKEN]) {
                    const store = viewer[STORE_TOKEN][key];
                    for (let pKey in store) {
                        delete store[pKey];
                    }
                    delete viewer[STORE_TOKEN][key];
                }
            } catch (_) {}
        }

        /**
         * Reset viewer at index to be able to accept new data.
         * @param index
         */
        resetViewer(index) {
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
                     * @param {OpenSeadragon.Viewer} viewer
                     * @param {string} uniqueId
                     * @param {Number} index
                     * @event viewer-reset
                     * @memberof VIEWER_MANAGER
                     */
                    this.raiseEvent('viewer-reset', {viewer: v, uniqueId: v.uniqueId, index });
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
                VIEWER_MANAGER.raiseEvent('viewer-create', {viewer: v, uniqueId: v.uniqueId, index: i });
            }
        }
    }

    return function() {
        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            let plugin = PLUGINS[pid];
            if (plugin) {
                showPluginError(plugin.id, plugin.error, plugin.loaded);
            }
        }

        return Promise.all(REGISTERED_PLUGINS.map(plugin => initializePlugin(plugin))).then(() => {
            REGISTERED_PLUGINS = undefined;
        }).then(callDeployedViewerInitialized);
    };
}