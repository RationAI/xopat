/**
 * Common Error thrown in JSON requests with failures (via fetchJSON(...)
 * The content is not guaranteed to be translated.
 * @class HTTPError
 */
window.HTTPError = class extends Error {
    constructor(message, response, textData) {
        super();
        this.message = message;
        this.response = response;
        this.textData = textData;
        this.statusCode = response && response.status || 500;
    }
};

/**
 * Init loading system in xOpat. Do not use in the viewer, use only if you
 * manually want to reuse plugins/modules elsewhere.
 * IMPORTANT
 * Use:                 const initPlugins = initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, VERSION);
 * call when all ready: initPlugins();
 * @param PLUGINS
 * @param MODULES
 * @param PLUGINS_FOLDER
 * @param MODULES_FOLDER
 * @param POST_DATA can be empty object if no data is supposed to be loaded
 * @param version
 * @param awaitPluginReady if true, returned handler awaits plugins
 * @return {function} initializer function to call once ready
 */
function initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, version, awaitPluginReady=false) {
    if (window.XOpatPlugin) throw "XOpatLoader already initialized!";

    //dummy translation function in case of no translation available
    $.t = $.t || (x => x);

    let REGISTERED_PLUGINS = [];
    let LOADING_PLUGIN = false;

    function showPluginError(id, e) {
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            $(`#load-plugin-${id}`).html("");
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
             * @memberOf VIEWER
             * @event plugin-failed
             */
            window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
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
             * @memberOf VIEWER
             * @event plugin-failed
             */
            window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                id: plugin.id,
                message: $.t('messages.pluginLoadFailedNamed', {plugin: plugin.name}),
            });
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS[id].instance = plugin;
        //clean up possible errors
        showPluginError(id, null);
        return plugin;
    }

    async function initializePlugin(plugin) {
        if (!plugin) return false;
        if (!plugin.pluginReady) return true;
        try {
            await plugin.pluginReady();
            return true;
        } catch (e) {
            console.warn(`Failed to initialize plugin ${plugin.id}.`, e);
            cleanUpPlugin(plugin.id, e);
        }
        return false;
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
     * @return {XOpatModuleSingleton|undefined} module if it is a singleton and already instantiated
     */
    window.singletonModule = function (id) {
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

    function extendIfContains(target, source, ...properties) {
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
            } else if (typeof toLoad === "object") {
                extendIfContains(properties, toLoad,
                    'async', 'crossOrigin', 'defer', 'integrity', 'referrerPolicy', 'src');
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
     * Implements common interface for plugins and modules. Cannot
     * be instantiated as it is hidden in closure. Private, but
     * available in docs due to its API nature.
     * @abstract
     */
    class XOpatElement {

        constructor(id, executionContextName) {
            if (!id) throw `Trying to instantiate an element '${this.constructor.name || this.constructor}' - no id given.`;
            this.__id = id;
            this.__uid = `${executionContextName}.${id}`;
            this.__xoContext = executionContextName;
            this[CACHE_TOKEN] = new XOpatStorage.Cache({id: this.__uid});
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
         *   todo better warn mechanism:
         *      -> simple way of module/plugin level context warns and errors (no feedback)
         *      -> advanced way of event warnings (feedback with E code)
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
             * @memberOf VIEWER
             */

            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event error-user
             * @event error-system
             * @memberOf XOpatElement
             */
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent(notifyUser ? 'error-user' : 'error-system',
                $.extend(e, {originType: this.xoContext, originId: this.id}));
        }

        /**
         * Raise warning event. If the module did register as event source,
         * it is fired on the item instance. Otherwise, it is fired on the VIEWER.
         *   todo better warn mechanism:
         *      -> simple way of module/plugin level context warns and errors (no feedback)
         *      -> advanced way of event warnings (feedback with E code)
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
             * @memberOf VIEWER
             */

            /**
             * Raise event from instance. Instances that register as event source fire on themselves.
             * @property {string} originType `"module"`, `"plugin"` or other type of the source
             * @property {string} originId
             * @event warn-user
             * @event warn-system
             * @memberOf XOpatElement
             */
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent(notifyUser ? 'warn-user' : 'warn-system',
                $.extend(e,
                    {originType: this.xoContext, originId: this.id}));
        }

        /**
         * Initialize IO in the Element - enables use of export/import functions
         * @param {XOpatStorage.StorageOptions?} options where id value is ignored (overridden)
         * @param {string?} [options.exportKey=""] optional export key for the globally exported
         *   data through exportData
         * @return {PostDataStore} data store reference, or false if import failed
         */
        async initPostIO(options = {}) {
            let store = this[STORE_TOKEN];
            if (store) return store;

            options.id = this.uid;
            options.xoType = this.__xoContext;
            const dataStore = this[STORE_TOKEN] = new PostDataStore(options);

            try {
                const exportKey = options.exportKey || "";
                VIEWER.addHandler('export-data', async (e) => {
                    const data = await this.exportData();
                    if (data) {
                        await dataStore.set(exportKey, data);
                    }
                });

                const data = await dataStore.get(exportKey);
                if (data !== undefined) await this.importData(data);

            } catch (e) {
                console.error('IO Failure:', this.constructor.name, e);
                this.error({
                    error: e, code: "W_IO_INIT_ERROR",
                    message: $.t('error.pluginImportFail',
                        {plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
                });
            }
            return dataStore;
        }

        /**
         * Called to export data within 'export-data' event: automatically the post data store object
         * (returned from initPostIO()) is given the output of this method:
         *   `await dataStore.set(options.exportKey || "", await this.exportData());`
         * note: for multiple objects, you can either manually add custom keys to the `dataStore` reference
         * upon the event 'export-data', or simply nest objects to fit a single output
         * @return {Promise<any>}
         */
        async exportData() {}
        /**
         * Called automatically within this.initPostIO if data available
         *  note: parseImportData return value decides if data is parsed data or passed as raw string
         * @param data {(string|*)} data
         */
        async importData(data) {}

        /**
         * TODO: this does not wait once module is fully loaded!
         * @param moduleId
         * @param callback
         * @return {boolean} true if finished immediatelly, false if registered handler for the
         *   future possibility of the module being loaded
         */
        integrateWithSingletonModule(moduleId, callback) {
            const targetModule = singletonModule(moduleId);
            if (targetModule) {
                callback(targetModule);
                return true;
            }
            VIEWER.addHandler('module-singleton-created', e => {
                if (e.id === moduleId) callback(e.module);
            });
            return false;
        }

        /**
         * Set the element as event-source class. Re-uses EventSource API from OpenSeadragon.
         */
        registerAsEventSource(errorBindingOnViewer=true) {
            //consider _errorHandlers that would listen for errors and warnings and provide handling instead of global scope VIEWER (at least for plugins)

            const events = this.__eventSource = new OpenSeadragon.EventSource();
            events.filters = {};
            this.addHandler = events.addHandler.bind(events);
            this.addOnceHandler = events.addOnceHandler.bind(events);
            this.getHandler = events.getHandler.bind(events);
            this.numberOfHandlers = events.numberOfHandlers.bind(events);
            this.raiseEvent = events.raiseEvent.bind(events);
            this.raiseAwaitEvent = VIEWER.tools.raiseAwaitEvent.bind(this, events);
            this.removeAllHandlers = events.removeAllHandlers.bind(events);
            this.removeHandler = events.removeHandler.bind(events);
            this.__errorBindingOnViewer = errorBindingOnViewer;

            this.addFilter = ( eventName, handler, priority ) => {
                let filters = this.filters[ eventName ];
                if ( !filters ) {
                    this.filters[ eventName ] = filters = [];
                }
                if ( handler && OpenSeadragon.isFunction( handler ) ) {
                    let index = filters.length,
                        filter = { handler: handler, priority: priority || 0 };
                    filters[ index ] = filter;
                    while ( index > 0 && filters[ index - 1 ].priority < filters[ index ].priority ) {
                        filters[ index ] = filters[ index - 1 ];
                        filters[ index - 1 ] = filter;
                        index--;
                    }
                }
            };
            this.applyFilter = ( eventName, value ) => {
                let filters = this.filters[ eventName ];
                if ( !filters || !filters.length ) {
                    return null;
                }
                for ( let i = 0; i < length; i++ ) {
                    if ( filters[ i ] ) {
                        value = filters[ i ].handler( value );
                    }
                }
                return value;
            };
            this.removeFilter = ( eventName, handler ) => {
                let filters = this.filters[ eventName ];
                if ( !filters || !OpenSeadragon.isArray( filters ) ) {
                    return;
                }
                this.filters = filters.filter(f => f.handler !== handler);
            };
        }
        /**
         * Add an event handler for a given event. See OpenSeadragon.EventSource::addHandler
         * Note: noop if registerAsEventSource() not called.
         */
        addHandler() {}
        /**
         * Add an event handler to be triggered only once (or X times). See OpenSeadragon.EventSource::addOnceHandler
         * Note: noop if registerAsEventSource() not called.
         */
        addOnceHandler () {}
        /**
         * Get a function which iterates the list of all handlers registered for a given event, calling the handler for each.
         * See OpenSeadragon.EventSource::getHandler
         * Note: noop if registerAsEventSource() not called.
         */
        getHandler () {}
        /**
         * Get the amount of handlers registered for a given event. See OpenSeadragon.EventSource::numberOfHandlers
         * Note: noop if registerAsEventSource() not called.
         */
        numberOfHandlers () {}
        /**
         * Trigger an event, optionally passing additional information. See OpenSeadragon.EventSource::raiseEvent
         * Note: noop if registerAsEventSource() not called.
         */
        raiseEvent () {}
        /**
         * Trigger an event, optionally passing additional information. See OpenSeadragon.EventSource::raiseAwaitEvent.
         * Awaits async handlers.
         * Note: noop if registerAsEventSource() not called.
         */
        raiseAwaitEvent() {}
        /**
         * Remove all event handlers for a given event type. See OpenSeadragon.EventSource::removeAllHandlers
         * Note: noop if registerAsEventSource() not called.
         */
        removeAllHandlers () {}
        /**
         * Remove a specific event handler for a given event. See OpenSeadragon.EventSource::removeHandler
         * Note: noop if registerAsEventSource() not called.
         */
        removeHandler () {}
        /**
         * Remove a specific event handler for a given event. See OpenSeadragon.EventSource::removeHandler
         * Note: noop if registerAsEventSource() not called.
         */
        addFilter () {}
        /**
         * Remove a specific event handler for a given event. See OpenSeadragon.EventSource::removeHandler
         * Note: noop if registerAsEventSource() not called.
         */
        applyFilter () {}
        /**
         * Remove a specific event handler for a given event. See OpenSeadragon.EventSource::removeHandler
         * Note: noop if registerAsEventSource() not called.
         */
        removeFilter () {}
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
         * Root path - the modules folder
         */
        static ROOT = MODULES_FOLDER;

        /**
         * The root of this module folder
         * @return {string}
         * @constructor
         */
        get MODULE_ROOT() {
            if (!MODULES[this.id]) {
                throw new Error("Invalid module - not properly initialized!");
            }
            return MODULES_FOLDER + MODULES[this.id]?.directory
        }
    }

    /**
     * Singleton Module API, ready to run as an instance
     * offering its features to all equally.
     * @class XOpatModuleSingleton
     * @extends XOpatModule
     * @inheritDoc
     */
    window.XOpatModuleSingleton = class extends XOpatModule {
        /**
         * Get instance of the annotations manger, a singleton
         * (only one instance can run since it captures mouse events)
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
        constructor(id) {
            super(id);
            const staticContext = this.constructor;
            if (staticContext.__self) {
                throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
            }
            staticContext.__self = this;

            MODULES[id].instance = this;

            // Await event necessary to fire after instantiation, do in async context
            setTimeout(() => VIEWER.tools.raiseAwaitEvent(VIEWER, 'module-singleton-created', {
                id: id,
                module: this
            }).catch(/*no-op*/));
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
         * Function called once a viewer is fully loaded
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
         */
        setOption(key, value, cache=true) {
            if (cache) this.setLocalOption(key, value);
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
         * todo rename to setCacheOption
         * @param key
         * @param value
         */
        setLocalOption(key, value) {
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
         *   future possibility of plugin being loaded
         */
        integrateWithPlugin(pluginId, callback) {
            const targetPlugin = plugin(pluginId);
            if (targetPlugin) {
                callback(targetPlugin);
                return true;
            }
            VIEWER.addHandler('plugin-loaded', e => {
                if (e.id === pluginId) callback(e.plugin);
            });
            return false;
        }

        static ROOT = PLUGINS_FOLDER;


        /**
         * The root of this plugin folder
         * @return {string}
         * @constructor
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
         * Send requests - both request and response format JSON
         * with POST, the viewer meta is automatically included
         *  - makes the viewer flexible for integration within existing APIs
         * @param url
         * @param postData
         * @param headers
         * @throws HTTPError
         * @return {Promise<string|any>}
         */
        fetch: async function(url, postData=null, headers={}) {
            let method = postData ? "POST" : "GET";
            headers = $.extend({
                'Access-Control-Allow-Origin': '*'
            }, headers);

            const response = await fetch(url, {
                method: method,
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'same-origin',
                headers: headers,
                body: postData ? JSON.stringify(postData) : null
            });

            if (response.status < 200 || response.status > 299) {
                return response.text().then(text => {
                    throw new HTTPError(`Server returned ${response.status}: ${text}`, response, text);
                });
            }

            return response;
        },

        /**
         * Send requests - both request and response format JSON
         * with POST, the viewer meta is automatically included
         *  - makes the viewer flexible for integration within existing APIs
         * @param url
         * @param postData
         * @param headers
         * @throws HTTPError
         * @return {Promise<string|any>}
         */
        fetchJSON: async function(url, postData=null, headers=null) {
            headers = headers || {};
            headers['Content-Type'] = 'application/json';
            const response = await this.fetch(url, postData, headers),
                data = await response.text();
            try {
                return JSON.parse(data);
            } catch (e) {
                throw new HTTPError("Server returned non-JSON data!", response, data);
            }
        },

        /**
         * @param imageFilePath image path
         * @param stripSuffix
         */
        fileNameFromPath: function(imageFilePath, stripSuffix=true) {
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
                 * @memberOf VIEWER
                 * @event module-loaded
                 */
                window.VIEWER && ids.forEach(id => VIEWER.raiseEvent('module-loaded', {id: id}));
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

            if (REGISTERED_PLUGINS === undefined) {
                /**
                 * Before a request to plugin loading is processed at runtime.
                 * @property {string} id plugin id
                 * @memberOf VIEWER
                 * @event before-plugin-load
                 */
                VIEWER.raiseEvent('before-plugin-load', {id: id});
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

                //loaded after page load if REGISTERED_PLUGINS === undefined
                const loadedAfterPluginInit = REGISTERED_PLUGINS === undefined;
                if (loadedAfterPluginInit) {

                    initializePlugin(PLUGINS[id].instance).then(success => {
                        if (!success) {
                            /**
                             * @property {string} id plugin id
                             * @property {string} message
                             * @memberOf VIEWER
                             * @event plugin-failed
                             */
                            window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                                id: plugin.id,
                                message: $.t('messages.pluginLoadFailedNamed', {plugin: PLUGINS[id].name}),
                            });
                            return;
                        }

                        finishPluginLoad();

                        /**
                         * Plugin was loaded dynamically at runtime.
                         * @property {string} id plugin id
                         * @memberOf VIEWER
                         * @event plugin-loaded
                         */
                        VIEWER.raiseEvent('plugin-loaded', {id: id, plugin: PLUGINS[id].instance});
                        onload();
                    }).catch(e => {
                        console.error(e);
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
             * todo OSD v5.0 will support also async events
             *
             * @property {function} setSerializedData callback to call,
             *   accepts 'key' (unique) and 'data' (string) to call with your data when ready
             * @memberOf VIEWER
             * @event export-data
             */
            await VIEWER.tools.raiseAwaitEvent(VIEWER, 'export-data');
            return {app: UTILITIES.serializeAppConfig(withCookies, staticPreview), data: POST_DATA};
        }
    };

    return awaitPluginReady ? async function() {
        //Notify plugins OpenSeadragon is ready
        Promise.all(REGISTERED_PLUGINS.map(plugin => initializePlugin(plugin))).then(() => {
            REGISTERED_PLUGINS = undefined;
        });
    } : function () {
        REGISTERED_PLUGINS.forEach(plugin => initializePlugin(plugin));
        REGISTERED_PLUGINS = undefined;
    }
}
