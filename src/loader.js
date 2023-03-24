/**
 * Common Error thrown in JSON requests with failures (via fetchJSON(...)
 * The content is not guaranteed to be translated.
 * @type {Window.HTTPError}
 */
window.HTTPError = class extends Error {
    constructor(message, response, textData) {
        super();
        this.message = message;
        this.response = response;
        this.textData = textData;
    }
};

/**
 * IMPORTANT
 * Use:                 const initPlugins = initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, VERSION);
 * call when all ready: initPlugins();
 * @param PLUGINS
 * @param MODULES
 * @param PLUGINS_FOLDER
 * @param MODULES_FOLDER
 * @param version
 * @return {function(...[*]=)} initializer function to call once ready
 */
function initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, version) {
    if (window.XOpatPlugin) throw "XOpatLoader already initialized!";

    //dummy translation function in case of no translation available
    $.t = $.t || (x => x);

    var registeredPlugins = [];
    var LOADING_PLUGIN = false;

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
        delete PLUGINS[id].instance;
        PLUGINS[id].loaded = false;
        PLUGINS[id].error = e;

        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
    }

    function instantiatePlugin(id, PluginClass) {
        if (!id) {
            console.warn("Plugin registered with no id defined!", id);
            return;
        }
        if (!PLUGINS[id]) {
            console.warn("Plugin registered with invalid id: no such id present in 'include.json'.", id);
            return;
        }

        let plugin;
        try {
            let parameters = APPLICATION_CONTEXT.config.plugins[id];
            if (!parameters) {
                parameters = {};
                APPLICATION_CONTEXT.config.plugins[id] = parameters;
            }
            plugin = new PluginClass(id, parameters);
        } catch (e) {
            console.warn(`Failed to instantiate plugin ${PluginClass}.`, e);
            window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                id: id,
                message: $.t('messages.pluginLoadFailed'),
            });
            cleanUpPlugin(id, e);
            return;
        }

        plugin.id = id; //silently set

        let possiblyExisting = PLUGINS[id].instance;
        if (possiblyExisting) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, possiblyExisting);
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

    function initializePlugin(plugin) {
        if (!plugin) return false;
        if (!plugin.pluginReady) return true;
        try {
            plugin.pluginReady();
            return true;
        } catch (e) {
            console.warn(`Failed to initialize plugin ${plugin}.`, e);
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
     */
    window.attachScript = function(pluginId, properties, onload) {
        let errHandler = function (e) {
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
        script.onload = function () {
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
     */
    window.plugin = function(id) {
        return PLUGINS[id]?.instance;
    };

    /**
     * Register plugin. Plugin is instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    window.addPlugin = function(id, PluginClass) {
        let plugin = instantiatePlugin(id, PluginClass);

        if (!plugin) return;

        if (registeredPlugins !== undefined) {
            if (plugin && typeof plugin["pluginReady"] === "function") {
                registeredPlugins.push(plugin);
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

    class XOpatElement {

        constructor(id, executionContextName) {
            if (!id) throw `Trying to instantiate a ${this.constructor.name} - no id given.`;
            this.id = id;
            this.xoContext = executionContextName;
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
         * Raise error event
         * todo make modules use this
         * @param e
         * @param e.code
         * @param e.message
         * @param e.error
         */
        error(e) {
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent('error-user', $.extend(e,
                {originType: this.xoContext, originId: this.id}));
        }

        /**
         * Raise warning event
         * todo make modules use this
         * @param e
         * @param e.code
         * @param e.message
         * @param e.error
         */
        warn(e) {
            (this.__errorBindingOnViewer ? VIEWER : this).raiseEvent('warn-user', $.extend(e,
                {originType: this.xoContext, originId: this.id}));
        }

        /**
         * Initialize IO in the Element - enables use of export/import functions and cache
         * @return {boolean} false if import failed (error thrown and caught)
         */
        async initIO() {
            if (this.__ioInitialized) return false;

            const _this = this;
            VIEWER.addHandler('export-data', async e =>  e.setSerializedData(this.id, await _this.exportData()));
            this.setCache = async (key, value) => {
                const store = APPLICATION_CONTEXT.metadata.persistent();
                if (store) {
                    try {
                        await store.set(_this.id + key, value);
                        return true;
                    } catch (e) {
                        console.warn("Silent failure of cache setter -> delegate to local storage.");
                    }
                }

                localStorage.setItem(this.id + key, value);
                return true;
            };
            this.getCache = async (key, defaultValue=undefined, parse=true) => {
                const store = APPLICATION_CONTEXT.metadata.persistent();
                if (store) {
                    try {
                        return await store.get(_this.id + key, defaultValue);
                    } catch (e) {
                        console.warn("Silent failure of cache getter -> delegate to local storage.");
                    }
                }

                let data = localStorage.getItem(key);
                if (data === null) return defaultValue;
                try {
                    return parse && typeof data === "string" ? JSON.parse(data) : data;
                } catch (e) {
                    console.error(e);
                    this.error({
                        error: e, code: "W_CACHE_IMPORT_ERROR",
                        message: $.t('error.cacheImportFail',
                            {plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
                    });
                    return defaultValue;
                }
            };
            this.__ioInitialized = true;

            try {
                let data = APPLICATION_CONTEXT.getData(this.id);
                if (typeof data === "string" && data) {
                    if (this.willParseImportData()) data = JSON.parse(data);
                    await this.importData(data);
                }
                return true;
            } catch (e) {
                console.error('IO Failure:', this.constructor.name,  e);
                this.error({
                    error: e, code: "W_IO_IMPORT_ERROR",
                    message: $.t('error.pluginImportFail',
                        {plugin: this.id, action: "USER_INTERFACE.highlightElementId('global-export');"})
                });
                return false;
            }
        }

        /**
         * Called to export data, expects serialized object
         * note: for multiple objects, serialize all and export serialized object with different keys
         * @return {Promise<string>}
         */
        async exportData() {}
        /**
         * Called with this.initIO if data available
         *  note: parseImportData return value decides if data is parsed data or passed as raw string
         * @param data {string|*} data
         */
        async importData(data) {}
        /**
         * Decide whether importData gets parsed input
         * @return {boolean}
         */
        willParseImportData() {
            return true;
        }
        /**
         * Set cached value, unlike setOption this value is stored in provided system cache (cookies or user)
         * @param {string} key
         * @param {string} value
         */
        async setCache(key, value) {}
        /**
         * Get cached value, unlike setOption this value is stored in provided system cache (cookies or user)
         * @param {string} key
         * @param {*} defaultValue value to return in case no value is available
         * @param {boolean} parse deserialize if true
         * @return {string|*} return serialized or unserialized data
         */
        async getCache(key, defaultValue=undefined, parse=true) {}

        /**
         * Set the element as event-source class. Re-uses EventSource API from OpenSeadragon.
         */
        initEventSource(errorBindingOnViewer=true) {
            //consider _errorHandlers that would listen for errors and warnings and provide handling instead of global scope VIEWER (at least for plugins)

            const events = this.__eventSource = new OpenSeadragon.EventSource();
            this.addHandler = events.addHandler.bind(events);
            this.addOnceHandler = events.addOnceHandler.bind(events);
            this.getHandler = events.getHandler.bind(events);
            this.numberOfHandlers = events.numberOfHandlers.bind(events);
            this.raiseEvent = events.raiseEvent.bind(events);
            this.removeAllHandlers = events.removeAllHandlers.bind(events);
            this.removeHandler = events.removeHandler.bind(events);
            this.__errorBindingOnViewer = errorBindingOnViewer;
        }
        /**
         * Add an event handler for a given event. See OpenSeadragon.EventSource::addHandler
         * Note: noop if initEventSource() not called.
         */
        addHandler() {}
        /**
         * Add an event handler to be triggered only once (or X times). See OpenSeadragon.EventSource::addOnceHandler
         * Note: noop if initEventSource() not called.
         */
        addOnceHandler () {}
        /**
         * Get a function which iterates the list of all handlers registered for a given event, calling the handler for each.
         * See OpenSeadragon.EventSource::getHandler
         * Note: noop if initEventSource() not called.
         */
        getHandler () {}
        /**
         * Get the amount of handlers registered for a given event. See OpenSeadragon.EventSource::numberOfHandlers
         * Note: noop if initEventSource() not called.
         */
        numberOfHandlers () {}
        /**
         * Trigger an event, optionally passing additional information. See OpenSeadragon.EventSource::raiseEvent
         * Note: noop if initEventSource() not called.
         */
        raiseEvent () {}
        /**
         * Remove all event handlers for a given event type. See OpenSeadragon.EventSource::removeAllHandlers
         * Note: noop if initEventSource() not called.
         */
        removeAllHandlers () {}
        /**
         * Remove a specific event handler for a given event. See OpenSeadragon.EventSource::removeHandler
         * Note: noop if initEventSource() not called.
         */
        removeHandler () {}
    }

    window.XOpatModule = class extends XOpatElement {

        constructor(id) {
            super(id, "module");
        }

        /**
         * Load localization data
         * @param locale the current locale if undefined
         * @param data possibly custom locale data if not fetched from a file
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
            return MODULES[this.id]?.[metaKey] || defaultValue;
        }

        /**
         * Root to the modules folder
         */
        static ROOT = MODULES_FOLDER;
    }

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
        }
    }

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
            return PLUGINS[this.id]?.[metaKey] || defaultValue;
        }

        /**
         * Store the plugin configuration parameters
         * todo: options are not being documented, enforce
         * @param {string} key
         * @param {*} value
         * @param {boolean} cache
         */
        setOption(key, value, cache=true) {
            if (cache) localStorage.setItem(this.id + key, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            APPLICATION_CONTEXT.config.plugins[this.id][key] = value;
        }

        /**
         * Read the plugin configuration parameters
         * @param {string} key
         * @param {*} defaultValue
         * @param {boolean} cache
         * @return {*}
         */
        getOption(key, defaultValue=undefined, cache=true) {
            if (cache) {
                let cached = localStorage.getItem(this.id + key);
                if (cached !== null) return cached;
            }
            let value = APPLICATION_CONTEXT.config.plugins[this.id].hasOwnProperty(key) ?
                APPLICATION_CONTEXT.config.plugins[this.id][key] : defaultValue;
            if (value === "false") value = false;
            else if (value === "true") value = true;
            return value;
        };

        /**
         * Code for global-scope access to this instance
         * @return {string}
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

        static ROOT = PLUGINS_FOLDER;
    };

    window.UTILITIES = {

        /**
         * Send requests - both request and response format JSON
         * with POST, the viewer meta is automatically included
         *  - makes the viewer flexible for integration within existing APIs
         * @param url
         * @param postData
         * @param headers
         * @param metaKeys metadata key list to include
         * @throws HTTPError
         * @return {Promise<string|any>}
         */
        fetch: async function(url, postData=null, headers={}, metaKeys=true) {
            let method = postData ? "POST" : "GET";
            headers = $.extend({
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }, headers);

            if (typeof postData === "object" && postData && metaKeys !== false) {
                if (postData.metadata === undefined) {
                    if (Array.isArray(metaKeys)) {
                        postData.metadata = APPLICATION_CONTEXT.metadata.allWith(metaKeys);
                    } else {
                        postData.metadata = APPLICATION_CONTEXT.metadata.all();
                    }
                }
            }

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
         * @param metaKeys metadata key list to include
         * @throws HTTPError
         * @return {Promise<string|any>}
         */
        fetchJSON: async function(url, postData=null, headers={}, metaKeys=true) {
            const response = await this.fetch(url, postData, headers, metaKeys),
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
            let begin = imageFilePath.lastIndexOf('/')+1;
            if (stripSuffix) {
                let end = imageFilePath.lastIndexOf('.');
                if (end >= 0) return imageFilePath.substr(begin, end - begin);
            }
            return imageFilePath.substr(begin, imageFilePath.length - begin);
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
        loadPlugin: function(id, onload=_=>{}) {
            let meta = PLUGINS[id];
            if (!meta || meta.loaded || meta.instance) return;
            if (window.hasOwnProperty(id)) {
                window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                    id: id,
                    message: $.t('messages.pluginLoadFailed'),
                });
                console.warn("Plugin id collision on global scope", id);
                return;
            }
            if (!Array.isArray(meta.includes)) {
                window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                    id: id,
                    message: $.t('messages.pluginLoadFailed'),
                });
                console.warn("Plugin include invalid.");
                return;
            }

            let successLoaded = function() {
                LOADING_PLUGIN = false;

                //loaded after page load
                if (!initializePlugin(PLUGINS[id].instance)) {
                    window.VIEWER && VIEWER.raiseEvent('plugin-failed', {
                        id: plugin.id,
                        message: $.t('messages.pluginLoadFailedNamed', {plugin: PLUGINS[id].name}),
                    });
                    return;
                }

                if (meta.styleSheet) {  //load css if necessary
                    $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
                }
                meta.loaded = true;
                if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                    let plugins = [];
                    for (let p in PLUGINS) {
                        if (PLUGINS[p].loaded) plugins.push(p);
                    }
                    APPLICATION_CONTEXT._setCookie('_plugins', plugins.join(","));
                }

                VIEWER.raiseEvent('plugin-loaded', {id: id});
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
    };

    return function() {
        //Notify plugins OpenSeadragon is ready
        registeredPlugins.forEach(plugin => initializePlugin(plugin));
        registeredPlugins = undefined;
    }
}
