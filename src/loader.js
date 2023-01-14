/**
 * Common Error thrown in JSON requests with failures (via fetchJSON(...)
 * The content is not guaranteed to be translated.
 * @type {Window.HTTPError}
 *
 * todo make possible for JS to load without relying on PHP
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
 * Use:                  const runLoader = initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, VERSION);
 * call once when ready: runLoader();
 * @param PLUGINS
 * @param MODULES
 * @param PLUGINS_FOLDER
 * @param MODULES_FOLDER
 * @param version
 * @return {function(...[*]=)} initializer function to call once ready
 */
function initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, version) {
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
            PluginClass.prototype.staticData = function(metaKey) {
                if (metaKey === "instance") return undefined;
                return PLUGINS[id]?.[metaKey];
            };
            PluginClass.prototype.getLocaleFile = function(locale) {
                return `locales/${locale}.json`;
            };
            PluginClass.prototype.localize = function (locale=undefined, data=undefined) {
                return UTILITIES.loadPluginLocale(id, locale, data || this.getLocaleFile(locale || $.i18n.language));
            };
            PluginClass.prototype.t = function (key, options={}) {
                options.ns = id;
                return $.t(key, options);
            };

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
        plugin.setOption = function(key, value, cookies=true) {
            if (cookies) APPLICATION_CONTEXT._setCookie(key, value);
            APPLICATION_CONTEXT.config.plugins[id][key] = value;
        };
        plugin.getOption = function(key, defaultValue=undefined) {
            let cookie = APPLICATION_CONTEXT._getCookie(key);
            if (cookie !== undefined) return cookie;
            let value = APPLICATION_CONTEXT.config.plugins[id].hasOwnProperty(key) ?
                APPLICATION_CONTEXT.config.plugins[id][key] : defaultValue;
            if (value === "false") value = false; //true will eval to true anyway
            return value;
        };

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
                    if (typeof module.attach === "string" && window[module.attach]) {
                        window[module.attach].metadata = module;
                    }
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

    window.UTILITIES = {
        /**
         * Load localization data for plugin
         *  @param id
         *  @param locale the current locale if undefined
         *  @param data string to a file name relative to the plugin folder or a data containing the translation
         */
        loadPluginLocale: function(id, locale=undefined, data=undefined) {
            return _getLocale(id, PLUGINS_FOLDER, PLUGINS[id]?.directory, data, locale);
        },

        /**
         * Load localization data for module
         *  @param id
         *  @param locale the current locale if undefined
         *  @param data string to a file name relative to the module folder or a data containing the translation
         */
        loadModuleLocale: function(id, locale=undefined, data=undefined) {
            return _getLocale(id, MODULES_FOLDER, MODULES[id]?.directory, data, locale)
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
        for (let modID in MODULES) {
            const module = MODULES[modID];
            if (module && module.loaded && typeof module.attach === "string" && window[module.attach]) {
                window[module.attach].metadata = module;
            }
        }

        //Notify plugins OpenSeadragon is ready
        registeredPlugins.forEach(plugin => initializePlugin(plugin));
        registeredPlugins = undefined;
    }
}