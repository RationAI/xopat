/**
 * @typedef BackgroundItem
 * @type {object}
 * @property {number} dataReference index to the `data` array, can be only one unlike in `shaders`
 * @property {?boolean} lossless default `false` if the data should be sent from the server as 'png' or 'jpg'
 * @property {?string} protocol see protocol construction below in advanced details
 * @property {?string} protocolPreview as above, must be able to generate file preview (fetch top-level tile)
 * @property {?OpenSeadragon.TileSource} a tileSource object, can be provided by a plugin or a module, not available through session configuration, not serialized;
 *    the object needs to be deduced from available dataReference and possibly protocol value realtime before the viewer loads
 * @property {?number} microns size of pixel in micrometers, default `undefined`,
 * @property {?number} micronsX horizontal size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property {?number} micronsY vertical size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property {?string} name custom tissue name, default the tissue path
 * @property {?number} goalIndex preferred visualization index for this background, ignored if `stackedBackground=true`, overrides `activeVisualizationIndex` otherwise
 * @property {?string} id unique ID for the background, created automatically from data path if not defined
 */
/**
 * @typedef VisualizationItem
 * @type {object}
 * @property {number} dataReference index to the `data` array, can be only one unlike in `shaders`
 * @property {?boolean} lossless default `false` if the data should be sent from the server as 'png' or 'jpg'
 * @property {?string} protocol see protocol construction below in advanced details
 * @property {?string} protocolPreview as above, must be able to generate file preview (fetch top-level tile)
 * @property {?number} microns size of pixel in micrometers, default `undefined`,
 * @property {?number} micronsX horizontal size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property {?number} micronsY vertical size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property {?string} name custom tissue name, default the tissue path
 * @property {?number} goalIndex preferred visualization index for this background, ignored if `stackedBackground=true`, overrides `activeVisualizationIndex` otherwise
 */

/**
 * @typedef TileSourceMetadata
 * @type object
 * @property {string} [error] error message, if the source should be treated as faulty one
 * @property {number} [microns] pixel size in micrometers (used instead of X+Y variant, chose one)
 * @property {number} [micronsX] pixel size in micrometers in X dimension (used together with micronsY instead of microns)
 * @property {number} [micronsY] pixel size in micrometers in Y dimension
 */

/**
 * Init xOpat Viewer with static configuration data.
 * Split so that one can create different access points - e.g. from PHP or JS sever...
 * This function inits the loading system, the OpenSeadragon Viewer
 * and core rendering-related API and events.
 * @param PLUGINS
 * @param MODULES
 * @param ENV
 * @param POST_DATA
 * @param PLUGINS_FOLDER
 * @param MODULES_FOLDER
 * @param VERSION
 * @param I18NCONFIG
 * @private
 */
function initXopat(PLUGINS, MODULES, ENV, POST_DATA, PLUGINS_FOLDER, MODULES_FOLDER, VERSION, I18NCONFIG={}) {
    const savedState = checkLocalState();
    if (savedState) {
        PLUGINS = savedState.PLUGINS;
        MODULES = savedState.MODULES;
        ENV = savedState.ENV;
        POST_DATA = savedState.POST_DATA;
        PLUGINS_FOLDER = savedState.PLUGINS_FOLDER;
        MODULES_FOLDER = savedState.MODULES_FOLDER;
        VERSION = savedState.VERSION;
        I18NCONFIG = savedState.I18NCONFIG;
    }

    initXopatUI();

    //Setup language and parse config if function provided
    function localizeDom() {
        jqueryI18next.init(i18next, $, {
            tName: 't', // $.t = i18next.t
            i18nName: 'i18n', // $.i18n = i18next
            handleName: 'localize', // $(selector).localize(opts);
            selectorAttr: 'data-i18n', // data-() attribute
            targetAttr: 'i18n-target', // data-() attribute
            optionsAttr: 'i18n-options', // data-() attribute
            useOptionsAttr: false, // see optionsAttr
            parseDefaultValueFromContent: true // parses default values from content ele.val or ele.text
        });
        //clean up
        delete window.jqueryI18next;
        delete window.i18next;
        $('body').localize();
    }
    if (i18next.isInitialized) {
        localizeDom();
    } else {
        I18NCONFIG.fallbackLng = 'en';
        i18next.init(I18NCONFIG, (err, t) => {
            if (err) throw err;
            localizeDom();
        });
    }
    POST_DATA = xOpatParseConfiguration(POST_DATA, $.i18n, ENV.serverStatus.supportsPost);
    let CONFIG = POST_DATA.visualization;
    if (!CONFIG) {
        CONFIG = {
            error: $.t('error.nothingToRender'),
            description: $.t('error.noDetails'),
            details: 'Initial configuration is not defined!'
        };
    }

    if (!window.OpenSeadragon) {
        CONFIG = {
            error: $.t('error.nothingToRender'),
            description: $.t('error.noDetails'),
            details: 'Missing OpenSeadragon library!'
        };
    }

    //Perform initialization based on provided data
    const defaultSetup = Object.freeze(ENV.setup);
    const viewerSecureMode = ENV.client.secureMode && ENV.client.secureMode !== "false";
    //default parameters not extended by CONFIG.params (would bloat link files)
    CONFIG.params = CONFIG.params || {};
    //optimization allways present
    CONFIG.params.bypassCookies = CONFIG.params.bypassCookies ?? defaultSetup.bypassCookies;
    POST_DATA = POST_DATA || {};
    const sessionName = CONFIG.params["sessionName"] || ENV.setup["sessionName"];

    // DEFAULT BROWSER IMPLEMENTATION OF THE COOKIE STORAGE
    if (!XOpatStorage.Cookies.registered()) {
        Cookies.withAttributes({
            path: ENV.client.js_cookie_path,
            domain: ENV.client.js_cookie_domain || ENV.client.domain,
            expires: ENV.client.js_cookie_expire,
            sameSite: ENV.client.js_cookie_same_site,
            secure: typeof ENV.client.js_cookie_secure === "boolean" ? ENV.client.js_cookie_secure : undefined
        });

        Cookies.set("test", "test");
        if (Cookies.get("test") === "test") {
            XOpatStorage.Cookies.registerClass(class {
                getItem(key) {
                    return Cookies.get(key) || null;
                }
                setItem(key, value) {
                    Cookies.set(key, value);
                    if (!Cookies.get(key)) {
                        console.warn("Cookie value too big to store!", key);
                    }
                }
                removeItem(key) {
                    Cookies.remove(key);
                }
                clear() {
                    const allCookies = Cookies.get();
                    for (let key in allCookies) {
                        Cookies.remove(key);
                    }
                }
                get length() {
                    return Object.keys(Cookies.get()).length;
                }
                key(index) {
                    const keys = Object.keys(Cookies.get());
                    return keys[index] || null;
                }
            });
        } else {
            console.warn("Cookie.js seems to be blocked.");
            console.log("Cookies are implemented using local storage. This might be a security vulnerability!");
            XOpatStorage.Cookies.registerInstance(localStorage);
        }
        Cookies.remove("test");
    }

    // DEFAULT BROWSER IMPLEMENTATION OF THE CACHE STORAGE
    if (!XOpatStorage.Cache.registered()) {
        XOpatStorage.Cache.registerInstance(localStorage);
    }

    //Prepare xopat core loading utilities and interfaces
    let runLoader = initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, VERSION);

    /**
     * @namespace APPLICATION_CONTEXT
     */
    window.APPLICATION_CONTEXT = /**@lends APPLICATION_CONTEXT*/ {
        /**
         * Viewer Configuration direct access.
         * @namespace APPLICATION_CONTEXT.config
         */
        config: {
            /**
             * Get parameters object of the viewer setup
             * @type {xoParams}
             */
            get params() { // getOption should be preferred over params access
                return CONFIG.params || {};
            },
            /**
             * Get default (static) parameters of the viewer setup
             * @return {unknown[]}
             */
            get defaultParams() {
                return defaultSetup;
            },
            /**
             * Get all the data WSI identifiers list
             * @type {Array<string>}
             */
            get data() {
                return CONFIG.data || [];
            },
            /**
             * Configuration of the 'image group'
             * @type {Array<BackgroundItem>}
             */
            get background() {
                return CONFIG.background || [];
            },
            /**
             * Configuration of the 'data group'
             * @type {Array<VisualizationItem>}
             */
            get visualizations() {
                return CONFIG.visualizations || [];
            },
            /**
             * Startup configuration of plugins
             * @type {{}}
             */
            get plugins() {
                return CONFIG.plugins || {};
            },
        },
        /**
         * Global Application Cache. Should not be used directly: cache is avaialble within
         * plugins as this.cache object.
         * @type XOpatStorage.Cache
         * @memberOf APPLICATION_CONTEXT
         */
        AppCache: new XOpatStorage.Cache({id: ""}),
        /**
         * Global Application Cookies.
         * @type XOpatStorage.Cookies
         * @memberOf APPLICATION_CONTEXT
         */
        AppCookies: new XOpatStorage.Cookies({id: ""}),
        /**
         * Get sessionName value (fallback refereceId) from the configuration.
         * @return {string|*}
         */
        get sessionName() {
            const config = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background") || {};
            if (config["sessionName"]) return config["sessionName"];
            if (sessionName) return sessionName;
            return this.referencedId();
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
            const domain = this.env.client.domain;
            if (!domain.endsWith("/")) return domain + "/" + this.env.client.path;
            return domain + this.env.client.path;
        },
        get settingsMenuId() { return "app-settings"; },
        get pluginsMenuId() { return "app-plugins"; },
        /**
         * Get option, preferred way of accessing the viewer config values.
         * @param name
         * @param defaultValue
         * @param cache
         * @return {string|*}
         */
        getOption(name, defaultValue=undefined, cache=true) {
            if (cache && this.AppCache) {
                let cached = this.AppCache.get(name);
                if (cached !== null && cached !== undefined) {
                    if (cached === "false") cached = false;
                    else if (cached === "true") cached = true;
                    return cached;
                }
            }
            let value = this.config.params[name] !== undefined ? this.config.params[name] :
                (defaultValue === undefined ? this.config.defaultParams[name] : defaultValue);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            return value;
        },
        /**
         * Set option, preferred way of accessing the viewer config values.
         * @param name
         * @param value
         * @param cache
         */
        setOption(name, value, cache=true) {
            if (cache && this.AppCache) this.AppCache.set(name, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            this.config.params[name] = value;
        },
        setDirty() {
            this.__cache.dirty = true;
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

                if (!plugin.error && plugin.instance && (plugin.loaded || plugin.permaLoad)) {
                    result.push(pid);
                }
            }
            return result;
        },
        /**
         * Get the current FILE name viewed (zero-index item in stacked mode).
         * @param {boolean} stripSuffix if true and the returned data is read from config.data
         *   field, an attempt to return only filename from the file ID.
         * @return {string}
         */
        referencedName(stripSuffix=false) {
            if (CONFIG.background.length < 0) {
                return undefined;
            }
            const bgConfig = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background");
            if (bgConfig) {
                return UTILITIES.nameFromBGOrIndex(bgConfig, stripSuffix);
            }
            return undefined;
        },
        /**
         * Get the current FILE ID viewed (zero-index item in stacked mode).
         * @return {string}
         */
        referencedId() {
            if (CONFIG.background.length < 0) {
                return "__anonymous__";
            }
            let config;
            if (VIEWER.scalebar) {
                VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background");
            } else {
                config = CONFIG.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex')]
                    || CONFIG.background[0];
            }
            return config ? CONFIG.data[config.dataReference] : "__anonymous__";
        },
        /**
         * Return the current active visualization
         * @return {*}
         */
        activeVisualizationConfig() {
            return CONFIG.visualizations[APPLICATION_CONTEXT.getOption("activeVisualizationIndex")];
        },
        _dangerouslyAccessConfig() {
            //remove in the future?
            return CONFIG;
        },
        _dangerouslyAccessPlugin(id) {
            //remove in the future?
            return PLUGINS[id];
        },
        __cache: {
            dirty: false
        }
    };

    /*--------------------------------------------------------------*/
    /*------------ Initialization of  new UI -----------------------*/
    /*--------------------------------------------------------------*/

    // todo make some cascading + registration strategy..
    USER_INTERFACE.TopVisualMenu.init();
    USER_INTERFACE.TopPluginsMenu.init();
    USER_INTERFACE.TopUserMenu.init();
    USER_INTERFACE.TopFullscreenButton.init();
    USER_INTERFACE.FullscreenMenu.init();
    /**
     * Replace share button in static preview mode
     */
    if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
        USER_INTERFACE.TopUserMenu.setBanner(new UI.Badge({
            style: UI.Badge.STYLE.SOFT,
            color: UI.Badge.COLOR.WARNING,
        }, "Exported Session"));
    }

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./src/error.php?title=${encodeURIComponent('Your browser is not supported.')}
    &description=${encodeURIComponent('ERROR: The visualization requires canvasses in order to work.')}`;
    }

    /**
     * Viewer manager for multi-view support
     * @type {Window.ViewerManager}
     */
    window.VIEWER_MANAGER = new ViewerManager(ENV, CONFIG);
    /**
     * OpenSeadragon Viewer Instance. Note the viewer instance
     * as well as OpenSeadragon namespace can (and is) extended with
     * additional classes and events.
     *
     * @namespace VIEWER
     * @type OpenSeadragon.Viewer
     * @see {@link https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html}
     */
    Object.defineProperty(window, "VIEWER", {
        get: window.VIEWER_MANAGER.get.bind(window.VIEWER_MANAGER)
    });

    /**
     * Event to fire if you want to avoid explicit warning handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires a dialog with provided message if not handled.
     * @property {string} originType: `"module"`, `"plugin"` or other type of the source
     * @property {string} originId: unique code component id, e.g. a plugin id
     * @property {string} code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property {string} message: a brief description of the case
     * @property {boolean} preventDefault: if true, the core will not fire default event
     * @property {*} trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf VIEWER
     * @event warn-user
     */
    VIEWER_MANAGER.broadcastHandler('warn-user', e => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50*e.message.length, 15000), 5000), Dialogs.MSG_WARN, false);
    }, -Infinity);
    /**
     * Event to fire if you want to avoid explicit error handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires an error dialog with provided message if not handled.
     * @property {string} originType: `"module"`, `"plugin"` or other type of the source
     * @property {string} originId: unique code component id, e.g. a plugin id
     * @property {string} code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property {string} message: a brief description of the case
     * @property {boolean} preventDefault: if true, the core will not fire default event
     * @property {*} trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf VIEWER
     * @event error-user
     */
    VIEWER_MANAGER.broadcastHandler('error-user', e => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50*e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, -Infinity);
    VIEWER_MANAGER.broadcastHandler('plugin-failed', e => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));
    VIEWER_MANAGER.addHandler('plugin-loaded', e => Dialogs.show($.t('messages.pluginLoadedNamed', {plugin: PLUGINS[e.id].name}), 2500, Dialogs.MSG_INFO));

    let notified = false;
    //todo error? VIEWER.addHandler('tile-load-failed', e => console.log("load filaed", e));
    VIEWER_MANAGER.broadcastHandler('add-item-failed', e => {
        if (notified) return;
        if (e.message && e.message.statusCode) {
            //todo check if the first background
            switch (e.message.statusCode) {
                case 401:
                    e.eventSource.getMenu().getNavigatorTab().setTitle($.t('main.global.tissue'), true);
                    Dialogs.show($.t('error.slide.401'),
                        20000, Dialogs.MSG_ERR);
                    XOpatUser.instance().logout(); //todo really logout? maybe request login instead?
                    break;
                case 403:
                    e.eventSource.getMenu().getNavigatorTab().setTitle($.t('main.global.tissue'), true);
                    Dialogs.show($.t('error.slide.403'),
                        20000, Dialogs.MSG_ERR);
                    break;
                case 404:
                    Dialogs.show($.t('error.slide.404'),
                        20000, Dialogs.MSG_ERR);
                    break;
                default:
                    break;
            }
            notified = true;
        } else {
            // Error is thrown by OSD
            console.info('Item failed to load and the event does not contain reliable information to notify user. Notification was bypassed.');
        }
    });

    /*---------------------------------------------------------*/
    /*----------------- MODULE/PLUGIN core API ----------------*/
    /*---------------------------------------------------------*/

    /**
     * Set current viewer real world measurements. Set undefined values to fallback to pixels.
     * @param {OpenSeadragon.Viewer} viewer
     * @param microns
     * @param micronsX
     * @param micronsY
     */
    window.UTILITIES.setImageMeasurements = function (viewer, microns, micronsX, micronsY) {
        let ppm = microns, ppmX = micronsX, ppmY = micronsY,
            lengthFormatter = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH;
        if (ppmX && ppmY) {
            ppm = undefined; //if both specified, just prefer the specific values
            ppmX = 1e6 / ppmX;
            ppmY = 1e6 / ppmY;
        } else if (!ppm) {
            //else if not anything, just set 1 to measure as pixels
            lengthFormatter = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC.bind(null, "px");
            ppm = 1;
        } else ppm = 1e6 / ppm;

        const magMicrons = microns || (micronsX + micronsY) / 2;

        // todo try read metadata about magnification and warn if we try to guess
        const values = [2.4, 2, 1.2, 4, 0.6, 10, 0.3, 20, 0.15, 40];
        let index = 0, best = Infinity, mag;
        if (magMicrons) {
            while (index < values.length) {
                const dev = Math.abs(magMicrons - values[index]);
                if (dev < best && dev < values[index]) {
                    best = dev;
                    mag = values[index+1]
                }
                index += 2;
            }
        }

        viewer.makeScalebar({
            pixelsPerMeter: ppm,
            pixelsPerMeterX: ppmX,
            pixelsPerMeterY: ppmY,
            sizeAndTextRenderer: lengthFormatter,
            stayInsideImage: false,
            location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
            xOffset: 5,
            yOffset: 10,
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            fontSize: "small",
            barThickness: 2,
            destroy: false,
            magnification: mag
        });
        if(!APPLICATION_CONTEXT.getOption("scaleBar", true)){
            viewer.scalebar.setActive(false);
        }
    };

    /**
     * Parse & set active background(s) and overlay(s).
     * - activeBackgroundIndex: undefined | number | number[]
     * - activeVisualizationIndex: undefined | number | (number|undefined)[]
     *
     * If arg is null => erase (set option to undefined).
     * If arg is undefined => keep the stored option.
     *
     * Modifies the viewer session configuration accordingly. Used mainly internally
     * by openViewerWith(...)
     *
     * @param {Number|Array<number>|undefined|null} [bgSpec=undefined]
     * @param {Number|Array<number>|undefined|null} [vizSpec=undefined]
     * @param {{deriveOverlayFromBackgroundGoals?: boolean}} opts
     *        If true, ignore vizSpec and derive overlays from cfg.background[i].goalIndex
     *        (array in non-stacked; single number in stacked).
     * @return {boolean} true if something needed change
     */
    window.UTILITIES.parseBackgroundAndGoal = function (
        bgSpec = undefined,
        vizSpec = undefined,
        { deriveOverlayFromBackgroundGoals = false } = {}
    ) {
        const stacked = APPLICATION_CONTEXT.getOption("stackedBackground", false, false);
        const cfg = APPLICATION_CONTEXT.config || {};
        const backgrounds = Array.isArray(cfg.background) ? cfg.background : [];
        const vizCount = Array.isArray(cfg.visualizations) ? cfg.visualizations.length : 0;

        const clampIndex = (i, max) =>
            Number.isInteger(i) && i >= 0 && i < max ? i : undefined;

        const normIndexValue = (v, max) => (v == null ? undefined : clampIndex(v, max));

        // Normalize an index or array of indices; preserves explicit undefined entries (via null/undefined)
        const normalizeIndexArg = (arg, max) => {
            if (arg == null) return undefined;
            if (Array.isArray(arg)) {
                return arg.map(v => normIndexValue(v, max));
            }
            return clampIndex(arg, max);
        };

        // From a bgArg produce: undefined | number | number[]
        const selectBackgroundIndices = (bgArg, bgCount) => {
            const norm = normalizeIndexArg(bgArg, bgCount);
            if (norm === undefined) return undefined;
            if (Array.isArray(norm)) {
                const seen = new Set();
                const out = [];
                for (const v of norm) {
                    if (v === undefined) continue;
                    if (!seen.has(v)) {
                        seen.add(v);
                        out.push(v);
                    }
                }
                if (out.length === 0) return undefined;
                return out.length === 1 ? out[0] : out;
            }
            return norm;
        };

        // Build visualization spec for NON-STACKED mode
        const buildVisForNonStacked = (visArg, bgIndices) => {
            if (bgIndices === undefined) return undefined;

            const toAlignedArray = (len, sourceArray) => {
                const out = new Array(len);
                for (let i = 0; i < len; i++) {
                    const raw = sourceArray[i];
                    out[i] = raw === undefined ? undefined : clampIndex(raw, vizCount);
                }
                return out;
            };

            // If a single number: apply it to all selected backgrounds
            if (Number.isInteger(visArg)) {
                if (Array.isArray(bgIndices)) {
                    const idx = clampIndex(visArg, vizCount);
                    return bgIndices.map(() => idx);
                }
                return clampIndex(visArg, vizCount);
            }

            // If an array: align 1:1 to backgrounds (truncate/ignore extra overlays)
            if (Array.isArray(visArg)) {
                const norm = visArg.map(v => (v == null ? undefined : clampIndex(v, vizCount)));
                if (Array.isArray(bgIndices)) return toAlignedArray(bgIndices.length, norm);
                // single bg: take first defined overlay
                const first = norm.find(v => v !== undefined);
                return first === undefined ? undefined : first;
            }

            // visArg undefined => no overlays
            if (Array.isArray(bgIndices)) return bgIndices.map(() => undefined);
            return undefined;
        };

        // Derive overlays from cfg.background[i].goalIndex (used when flag is on)
        const deriveVisFromGoals = (bgIndices) => {
            const getGoal = (i) => {
                const g = backgrounds[i] && typeof backgrounds[i].goalIndex === "number"
                    ? backgrounds[i].goalIndex
                    : undefined;
                return clampIndex(g, vizCount);
            };

            if (bgIndices === undefined) return undefined;

            if (stacked) {
                // Stacked => a single overlay picked from the first selected background
                const firstIdx = Array.isArray(bgIndices) ? bgIndices[0] : bgIndices;
                return getGoal(firstIdx);
            }

            if (Array.isArray(bgIndices)) return bgIndices.map(getGoal);
            return getGoal(bgIndices);
        };

        let updated = false;

        // ---------- Handle bgSpec (null => erase; undefined => keep; value => set) ----------
        let effectiveBg;
        if (bgSpec === null) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", undefined);
            updated = true;
            effectiveBg = undefined;
        } else if (bgSpec === undefined) {
            effectiveBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, false);
        } else {
            const newActiveBg = selectBackgroundIndices(bgSpec, backgrounds.length);
            const prevActiveBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, false);
            if (JSON.stringify(prevActiveBg) !== JSON.stringify(newActiveBg)) {
                APPLICATION_CONTEXT.setOption("activeBackgroundIndex", newActiveBg);
                updated = true;
            }
            effectiveBg = newActiveBg;
        }

        // Always have a convenient array view of selected backgrounds
        const selectedBgArray =
            effectiveBg === undefined ? [] : (Array.isArray(effectiveBg) ? effectiveBg : [effectiveBg]);

        // We will need bgIndices in later logic
        const bgIndicesForViz = effectiveBg === undefined
            ? undefined
            : (Array.isArray(effectiveBg) ? effectiveBg : effectiveBg);

        // ---------- Handle vizSpec / derivation ----------
        if (vizSpec === null) {
            // erase overlays
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", undefined);
            updated = true;
        } else {
            // When derive flag is ON, derive overlays from per-background goalIndex,
            // regardless of whether vizSpec is provided or undefined.
            let desiredActiveVis;
            if (deriveOverlayFromBackgroundGoals) {
                desiredActiveVis = deriveVisFromGoals(bgIndicesForViz);
            } else if (vizSpec !== undefined) {
                if (stacked) {
                    // stacked => only a single overlay is allowed
                    if (Array.isArray(vizSpec)) {
                        const first = vizSpec.find(v => v != null && Number.isInteger(v));
                        desiredActiveVis = first == null ? undefined : clampIndex(first, vizCount);
                    } else {
                        desiredActiveVis = clampIndex(vizSpec, vizCount);
                    }
                } else {
                    desiredActiveVis = buildVisForNonStacked(vizSpec, bgIndicesForViz);
                }
            } // else: vizSpec === undefined and derive flag is false => keep existing option

            if (typeof desiredActiveVis !== "undefined") {
                const prevActiveVis = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, false);
                if (JSON.stringify(prevActiveVis) !== JSON.stringify(desiredActiveVis)) {
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", desiredActiveVis);
                    updated = true;
                }

                // Persist per-background goalIndex in NON-STACKED mode when we have a concrete desiredActiveVis
                if (!stacked && selectedBgArray.length > 0) {
                    if (Array.isArray(desiredActiveVis)) {
                        selectedBgArray.forEach((bgIdx, i) => {
                            const ov = desiredActiveVis[i];
                            if (ov === undefined) return;
                            const b = backgrounds[bgIdx];
                            if (!b) return;
                            if (b.goalIndex !== ov) {
                                b.goalIndex = ov;
                                updated = true;
                            }
                        });
                    } else if (Number.isInteger(desiredActiveVis)) {
                        selectedBgArray.forEach(bgIdx => {
                            const b = backgrounds[bgIdx];
                            if (!b) return;
                            if (b.goalIndex !== desiredActiveVis) {
                                b.goalIndex = desiredActiveVis;
                                updated = true;
                            }
                        });
                    }
                }
            }
        }

        return updated;
    };

    function handleSyntheticOpenEvent(viewer, successLoadedItemCount) {
        const world = viewer.world;
        if (world.getItemCount() < 1) {
            viewer.addTiledImage({
                tileSource : new OpenSeadragon.EmptyTileSource({height: 20000, width: 20000, tileSize: 512}),
                index: 0,
                replace: false,
                success: (event) => {
                    /**
                     * @this {OpenSeadragon.TiledImage}
                     * @function getConfig
                     * @param {string} [type=undefined]
                     * @memberof OpenSeadragon.TiledImage
                     * @returns {BackgroundItem|VisualizationItem|undefined}
                     */
                    event.item.getConfig = type => undefined;
                    //TODO: USER_INTERFACE.toggleDemoPage(true);
                    handleSyntheticEventFinishWithValidData(viewer, 0, 1);
                }
            });
            return;
        }

        if (successLoadedItemCount === 0) {
            viewer.toggleDemoPage(true, $.t('error.invalidDataHtml'));
        } else {
            // TODO propose fix in OpenSeadragon
            // Fix indexing: OSD has race conditions when we call addTiledImage subsequently with defined indexes
            const itemCount = world.getItemCount();
            let index = 0;
            while (index < itemCount) {
                const item = world.getItemAt(index);
                if (item.__targetIndex !== index) {
                    world.setItemIndex(item, item.__targetIndex);
                } else {
                    index++;
                }
                // Set lossless if required
                const conf = item.getConfig("background");
                if (item.source.hasOwnProperty("requireLossless") && conf?.hasOwnProperty("lossless")) {
                    item.source.requireLossless(conf.lossless);
                }
            }
        }

        // todo check args, do we need to search for at least one valid reference image? test stacked mode + X bg overlays
        handleSyntheticEventFinishWithValidData(viewer, 0, 1);
    }

    function handleSyntheticEventFinishWithValidData(viewer, referenceImage, layerPosition) {
        try {
            //Todo once rewritten, treat always low level item as the reference layer (index == 0)

            //the viewer scales differently-sized layers sich that the biggest rules the visualization
            //this is the largest image layer, or possibly the rendering layers layer
            const tiledImage = viewer.world.getItemAt(referenceImage);
            const imageData = tiledImage?.getConfig();

            if (Number.isInteger(Number.parseInt(imageData?.dataReference))) {
                const name = imageData.name || UTILITIES.fileNameFromPath(
                    APPLICATION_CONTEXT.config.data[imageData.dataReference]
                );
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            } else if (!imageData && APPLICATION_CONTEXT.config.background.length > 0) {
                const name = UTILITIES.fileNameFromPath(
                    APPLICATION_CONTEXT.config.data[APPLICATION_CONTEXT.getOption('activeBackgroundIndex')]
                    || 'unknown'
                );
                viewer.getMenu().getNavigatorTab().setTitle($.t('main.navigator.faultyTissue', {slide: name}), true);
            } else if (!imageData) {
                viewer.getMenu().getNavigatorTab().setTitle($.t('main.navigator.faultyViz'), true);
            } else {
                const name = imageData.name || $.t('common.Image');
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            }

            if (imageData) {
                const hasMicrons = !!imageData.microns, hasDimMicrons = !!(imageData.micronsX && imageData.micronsY);
                if (!hasMicrons || !hasDimMicrons) {
                    const sourceMeta = typeof tiledImage?.source?.getMetadata === "function" && tiledImage.source.getMetadata();
                    if (sourceMeta) {
                        if (!hasMicrons) imageData.microns = sourceMeta.microns;
                        if (!hasDimMicrons) {
                            imageData.micronsX = sourceMeta.micronsX;
                            imageData.micronsY = sourceMeta.micronsY;
                        }
                    }
                }
            }

            UTILITIES.setImageMeasurements(viewer, imageData?.microns, imageData?.micronsX, imageData?.micronsY);
            viewer.scalebar.linkReferenceTileSourceIndex(referenceImage);

            const eventOpts = {};

            if (APPLICATION_CONTEXT.config.visualizations.length > 0) {
                let layerWorldItem = viewer.world.getItemAt(layerPosition);
                const activeVis = APPLICATION_CONTEXT.activeVisualizationConfig();
                if (layerWorldItem) {
                    const async = APPLICATION_CONTEXT.getOption("fetchAsync");
                    do {
                        // todo legacy, remove setFormat support....
                        if (layerWorldItem.source.setFormat) {
                            const preferredFormat = APPLICATION_CONTEXT.getOption("preferredFormat");
                            const lossless = activeVis.lossless;
                            const format = lossless ? (async ? "png" : preferredFormat) : (async ? "jpg" : preferredFormat);
                            layerWorldItem.source.setFormat(format);
                        }
                        if (layerWorldItem.source.requireLossless) {
                            layerWorldItem.source.requireLossless(activeVis.lossless);
                        }
                        layerWorldItem = viewer.world.getItemAt(++layerPosition);
                    } while (layerWorldItem);


                    viewer.getMenu().getShadersTab().updateVisualizationList(
                        APPLICATION_CONTEXT.config.visualizations,
                        // todo is this accurate?
                        APPLICATION_CONTEXT.getOption("activeVisualizationIndex")
                    );
                } else {
                    //todo action page reload
                    Dialogs.show($.t('messages.visualizationDisabled', {name: activeVis.name}), 20000, Dialogs.MSG_ERR);
                    eventOpts.error = $.t('messages.overlaysDisabled');
                }
            }
        } catch (e) {
            console.error(e);
        }

        if (runLoader) {
            runLoader();
            runLoader = null;
        }

        if (!viewer.__initialized) {
            viewer.__initialized = true;
            eventOpts.firstLoad = true;

            // todo consider viewport per background
            let focus = APPLICATION_CONTEXT.getOption("viewport");
            if (focus && focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
                viewer.viewport.panTo({x: Number.parseFloat(focus.point.x), y: Number.parseFloat(focus.point.y)}, true);
                viewer.viewport.zoomTo(Number.parseFloat(focus.zoomLevel), null, true);
            }

            // todo needs to trigger valid navigator ID
            if (window.innerHeight < 630 || window.innerWidth < 900) {
                if (window.innerWidth >= 900) {
                    $('#navigator-pin').click();
                }
            }

            window.onerror = null;

            // todo remove this feature?
            try {
                if (window.opener && window.opener.VIEWER) {
                    viewer.tools.link("external_window");
                    window.opener.VIEWER.link("external_window");
                }
            } catch (e) {
                //pass opener access can throw exception - not available to us
            }

            // todo better way of first visit...
            // const firstTimeVisit = APPLICATION_CONTEXT.AppCookies.get("_shadersPin",
            //     APPLICATION_CONTEXT.getOption("bypassCookies") ? false : null) === null;
            // if (!USER_INTERFACE.Errors.active && firstTimeVisit) {
            //     setTimeout(() => {
            //         USER_INTERFACE.Tutorials.show($.t('messages.pluginsWelcome'),
            //             $.t('messages.pluginsWelcomeDescription', {tutorial: $.t('tutorials.basic.title')})
            //         );
            //     }, 2000);
            // }
        } else {
            eventOpts.firstLoad = false;
        }
        //todo INHERITS OpenSeadragon todo comment - check for API changes in open event in future
        eventOpts.source = viewer.world.getItemAt(0)?.source;
        eventOpts.firstLoad = true;
        /**
         * Manual OpenSeadragon open event firing, see OpenSeadragon.Viewer#open
         * It is guaranteed to be called upon app start.
         * @memberOf VIEWER
         * @param {boolean} firstLoad true if this is the first load event for that viewer
         * @event open
         */
        viewer.raiseEvent('open', eventOpts);
    }

    /**
     * Run the first viewer configuration. This method should be called once
     * at the beginning of the app lifecycle.
     * @param data
     * @param background
     * @param visualizations
     * @returns {Promise<void>}
     */
    APPLICATION_CONTEXT.beginApplicationLifecycle = async function (data,
                                                                    background,
                                                                    visualizations=undefined) {
        try {
            initXopatLayers();

            // First step: load plugins that were marked as to be loaded but were not yet loaded
            function loadPluginAwaits(pid, hasParams) {
                return new Promise((resolve) => {
                    UTILITIES.loadPlugin(pid, resolve);
                    if (!hasParams) {
                        //todo consider doing this automatically
                        CONFIG.plugins[pid] = {};
                    }
                });
            }

            const pluginKeys = APPLICATION_CONTEXT.AppCookies.get('_plugins', '').split(',') || [];
            for (let pid in PLUGINS) {
                const hasParams = CONFIG.plugins[pid];
                const plugin = PLUGINS[pid];
                if (
                    (plugin.loaded && !plugin.instance) ||  // load plugin if loaded=true but instance not set
                    (!plugin.loaded && (hasParams || pluginKeys.includes(pid)))
                ) {
                    if (plugin.error) {
                        console.warn("Dynamic plugin loading skipped: ", pid, plugin.error);
                    } else {
                        await loadPluginAwaits(pid, hasParams);
                    }
                }
            }

            /*---------------------------------------------------------*/
            /*------------ Initialization of UI -----------------------*/
            /*---------------------------------------------------------*/

            const event = {
                data, background, visualizations, fromLocalStorage: !!CONFIG.__fromLocalStorage
            };

            /**
             * First loading of the viewer from a clean state.
             * @memberOf VIEWER_MANAGER
             * @event before-first-open
             */
            await VIEWER_MANAGER.raiseEventAwaiting('before-first-open', event).catch(e =>
                {
                    //todo something meaningful
                    console.error(e);
                }
            );
            this.openViewerWith(event.data, event.background || [], event.visualizations || []);
        } catch (e) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show($.t('error.unknown'), `${$.t('error.reachUs')} <br><code>${e}</code>`, true);
            console.error(e);
        }
        //https://github.com/mrdoob/stats.js
        if (APPLICATION_CONTEXT.getOption("debugMode")) {
            (function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);stats.showPanel(1);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src=APPLICATION_CONTEXT.url+'src/external/stats.js';document.head.appendChild(script);})()
        }
    };


    /**
     * Open desired configuration into one or more viewer instances (no VIEWER global access here).
     * - Calls UTILITIES.parseBackgroundAndGoal to resolve background/overlay selections.
     * - In non-stacked mode with multiple backgrounds selected, creates multiple viewers (one per bg).
     * - In stacked mode (or single bg) uses a single viewer.
     *
     * @param {Array|undefined} data
     * @param {Array|undefined} background
     * @param {Array|undefined} visualizations
     * @param {number|number[]|undefined|null} bgSpec
     * @param {number|number[]|undefined|null} vizSpec
     * @param {{deriveOverlayFromBackgroundGoals?: boolean}} [opts]
     */
    APPLICATION_CONTEXT.openViewerWith = async function (
        data = undefined,
        background = undefined,
        visualizations = undefined,
        bgSpec = undefined,
        vizSpec = undefined,
        opts = {}
    ) {
        USER_INTERFACE.Loading.show(true);

        await VIEWER_MANAGER.raiseEventAwaiting(
            'before-open', {data, background, visualizations, bgSpec, vizSpec}
        ).catch(e => console.warn("Exception in 'before-open' event handler: ", e));

        //todo consider return false if some dialog refuses the reload
        await Dialogs.awaitHidden();

        // -- update CONFIG if new values are provided (undefined => keep ; null not expected here)
        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
        if (typeof data !== "undefined") config.data = data;
        if (typeof background !== "undefined") config.background = background;
        if (typeof visualizations !== "undefined") config.visualizations = visualizations;

        const cfg = APPLICATION_CONTEXT.config;
        const bgs = Array.isArray(cfg.background) ? cfg.background : [];
        const vis = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
        const env = APPLICATION_CONTEXT.env;
        const isSecureMode = !!APPLICATION_CONTEXT.secure;
        
        // 1) Normalize selection via the parser (also persists options as needed)
        UTILITIES.parseBackgroundAndGoal(bgSpec, vizSpec, {
            deriveOverlayFromBackgroundGoals: !!opts.deriveOverlayFromBackgroundGoals
        });

        const stacked = APPLICATION_CONTEXT.getOption("stackedBackground", false, false);
        let activeBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, false);
        let activeViz = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, false);

        // Ensure we open at least something if possible
        const bgSpecWasUnset  = activeBg  === undefined;
        const vizSpecWasUnset = activeViz === undefined;
        if (bgSpecWasUnset && vizSpecWasUnset) {
            if (bgs.length > 0) {
                activeBg = 0;
                APPLICATION_CONTEXT.setOption("activeBackgroundIndex", activeBg);
            } else if (vis.length > 0) {
                activeViz = 0;
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", activeViz);
            }
        } else {
            if (vizSpecWasUnset && vis.length > 0) {
                activeViz = 0;
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", activeViz);
            }
        }

        // Build per-viewer plan:
        // - stacked => single viewer, backgrounds = all cfg.background (or empty if none)
        // - non-stacked:
        //     - activeBg is number => single viewer with that bg
        //     - activeBg is array  => N viewers, each with one bg (in order)
        //     - activeBg undefined => single viewer, no bg (blank/error tile)
        const bgPlan = (() => {
            if (stacked) {
                return [{type: "stacked", bgIndices: bgs.map((_, i) => i)}];
            }
            if (Array.isArray(activeBg)) {
                return activeBg.map(idx => ({type: "single", bgIndices: [idx]}));
            }
            if (Number.isInteger(activeBg)) {
                return [{type: "single", bgIndices: [activeBg]}];
            }
            return [{type: "single", bgIndices: []}];
        })();

        // 2) Ensure we have a ViewerManager and correct number of viewers (>= 1)
        const VM = VIEWER_MANAGER;

        const desiredCount = Math.max(1, bgPlan.length);
        // Add missing viewers
        for (let i = 0; i < desiredCount; i++) {
            if (!VM.viewers[i]) VM.add(i);
        }
        // Remove extra viewers, but never below 1 and keep index 0 alive
        for (let i = VM.viewers.length - 1; i >= desiredCount; i--) {
            if (i === 0) continue; // never remove the first viewer
            VM.delete(i);
        }

        // todo duplicated in OSD tools when creating tiled image, make this usable elsewhere
        // Helper: build a tileSource URL for a background entry
        const bgUrlFromEntry = (bgEntry) => {
            if (bgEntry.tileSource instanceof OpenSeadragon.TileSource) {
                return bgEntry.tileSource;
            }
            const proto = !isSecureMode && bgEntry.protocol ? bgEntry.protocol : env.client.image_group_protocol;
            const make = new Function("path,data", "return " + proto);
            const d = cfg.data[bgEntry.dataReference];
            return make(env.client.image_group_server, d);
        };

        // Helper: open one tile into a viewer with bookkeeping
        const openTile = (viewer, source, kind, index, ctx) => {
            console.log("Opening tile", kind, index, ctx);
            return new Promise((resolve) => {
                viewer.addTiledImage({
                    tileSource: source.source || source,
                    index,
                    success: event => {
                        event.item.__targetIndex = index;
                        // Attach contextual config getters for this item
                        if (kind === "background") {
                            const bgIdx = ctx.bgIndexForItem(index);
                            /**
                             * @this {OpenSeadragon.TiledImage}
                             * @function getConfig
                             * @param {string} [type=undefined]
                             * @memberof OpenSeadragon.TiledImage
                             * @returns {BackgroundItem|VisualizationItem|undefined}
                             */
                            event.item.getConfig = type =>
                                !type || type === "background" ? cfg.background[bgIdx] : undefined;
                        } else if (kind === "visualization") {
                            const vIdx = ctx.vizIndexForItem(index);
                            event.item.getConfig = type =>
                                !type || type === "visualization" ? cfg.visualizations[vIdx] : undefined;
                        } else {
                            event.item.getConfig = type => undefined;
                        }
                        resolve(true);
                    },
                    error: (e) => {
                        // fallback blank item (hidden)
                        viewer.addTiledImage({
                            tileSource: {
                                type: "_blank",
                                error:
                                    (e && e.message) ||
                                    $.t("error.slide.pending") +
                                    " " +
                                    $.t("error.slide.imageLoadFail") +
                                    " " +
                                    (source && source.toString ? source.toString() : "")
                            },
                            opacity: 0,
                            index,
                            success: event => {
                                event.item.__targetIndex = index;
                                /**
                                 * @this {OpenSeadragon.TiledImage}
                                 * @function getConfig
                                 * @param {string} [type=undefined]
                                 * @memberof OpenSeadragon.TiledImage
                                 * @returns {BackgroundItem|VisualizationItem|undefined}
                                 */
                                event.item.getConfig = type => undefined;
                                resolve(false);
                            },
                            error: event => {
                                // event.item is not set, only event.source
                                resolve(false);
                            }
                        });
                    }
                });
            });
        };

        // Helper: configure shaders/rendering for a viewer + open its images
        const openIntoViewer = async (entry, viewerIndex) => {
            VM.resetViewer(viewerIndex);
            const viewer = VM.viewers[viewerIndex];

            const toOpen = [];
            const openedBase = [];

            // (A) BACKGROUNDS
            if (entry.type === "stacked") {
                for (const bgi of entry.bgIndices) {
                    const bg = bgs[bgi];
                    if (!bg) continue;
                    if (!bg.id) {
                        bg.id = UTILITIES.generateID(data[bg.dataReference]);
                    } else {
                        bg.id = UTILITIES.sanitizeID(bg.id);
                    }

                    toOpen.push(bgUrlFromEntry(bg));
                    openedBase.push(bg);
                }
            } else {
                const bgi = entry.bgIndices[0];
                if (Number.isInteger(bgi)) {
                    const bg = bgs[bgi];
                    if (bg) {
                        if (!bg.id) {
                            bg.id = UTILITIES.generateID(data[bg.dataReference]);
                        } else {
                            bg.id = UTILITIES.sanitizeID(bg.id);
                        }
                        toOpen.push(bgUrlFromEntry(bg));
                        openedBase.push(bg);
                    }
                }
            }

            // (B) Decide visualization(s) for this viewer
            // stacked: activeViz must be a single number (or undefined)
            // non-stacked:
            //   - if activeViz is number => apply to all viewers
            //   - if array => align by viewerIndex
            let visIndexForThis = undefined;
            if (stacked) {
                if (Number.isInteger(activeViz)) visIndexForThis = activeViz;
            } else {
                if (Array.isArray(activeViz)) {
                    const v = activeViz[viewerIndex];
                    visIndexForThis = Number.isInteger(v) ? v : undefined;
                } else if (Number.isInteger(activeViz)) {
                    visIndexForThis = activeViz;
                }
            }

            const renderingWithWebGL = Array.isArray(vis) && vis.length > 0 && Number.isInteger(visIndexForThis);

            // (C) If rendering with WebGL, prepare renderer and append visualization sources
            let shaderConfigMap = {};
            let numVisLayersAtEnd = 0;

            // Configure renderer (background layers first)
            const renderOutput = {};
            for (let i = 0; i < openedBase.length; i++) {
                const bgRef = openedBase[i];
                // todo this code is duplicated in tools, once adding support for shaders, create api from it
                renderOutput[bgRef.id] = {
                    id: bgRef.id,
                    type: "identity",
                    tiledImages: [i],
                    name: bgRef.name || cfg.data[bgRef.dataReference]
                };
            }

            if (renderingWithWebGL) {
                try {
                    UTILITIES.testRendering();
                } catch (e) {
                    console.error(e);
                    USER_INTERFACE.Errors.show(
                        $.t("error.renderTitle"),
                        `${$.t("error.renderDesc")} <br><code>${e}</code>`,
                        true
                    );
                }

                const vizUrlFromEntries = (dataIndex) => {
                    // todo multiple tilesource support....
                    // if (vis.tileSource instanceof OpenSeadragon.TileSource) {
                    //     return vis.tileSource;
                    // }
                    const proto = !isSecureMode && activeV.protocol ? activeV.protocol : env.client.data_group_protocol;
                    const make = new Function("path,data", "return " + proto);
                    // todo old support for arrays, make this somehow fallback compatible and change it
                    const d = [cfg.data[dataIndex]];
                    return make(env.client.data_group_server, d);
                };

                APPLICATION_CONTEXT.prepareRendering();
                const activeV = vis[visIndexForThis];
                const sourcesToOpen = {};
                const lastBgIndex = toOpen.length;
                let counter = toOpen.length;

                shaderConfigMap = activeV.shaders || {};
                for (const shaderId in shaderConfigMap) {
                    const shaderCfg = shaderConfigMap[shaderId];
                    shaderCfg.tiledImages = [];
                    const refs = (shaderCfg.dataReferences || []).map(vizUrlFromEntries);
                    shaderCfg.name = shaderCfg.name || cfg.data[shaderCfg.dataReferences?.[0]] || shaderId;

                    for (const src of refs) {
                        let idx = sourcesToOpen[src];
                        if (idx === undefined) {
                            sourcesToOpen[src] = idx = counter++;
                            toOpen.push(src);
                        }
                        shaderCfg.tiledImages.push(idx);
                    }
                }

                numVisLayersAtEnd = counter - lastBgIndex;
                Object.assign(renderOutput, shaderConfigMap);
            }

            UTILITIES.applyStoredVisualizationSnapshot(renderOutput);
            if (viewer.drawer && viewer.drawer.overrideConfigureAll) {
                viewer.drawer.overrideConfigureAll(renderOutput);
            }

            // (D) Finally add the images to the viewer world
            if (toOpen.length === 0) {
                // Add a single hidden blank to keep viewer usable
                toOpen.push({type: "_blank"});
            }

            // helpers for contextual getConfig in items
            let lastBgIdx = toOpen.length - numVisLayersAtEnd - 1;
            const ctx = {
                bgIndexForItem: (itemIndex) => {
                    // itemIndex within the sequence [0..lastBgIdx] are backgrounds
                    // map local background order back to cfg.background index
                    if (entry.type === "stacked") {
                         // 0..lastBgIdx
                        return entry.bgIndices[itemIndex];
                    } else {
                        return entry.bgIndices[0];
                    }
                },
                vizIndexForItem: () => visIndexForThis
            };

            // Open backgrounds first, then viz layers
            let idx = 0;
            let successOpened = 0;
            for (; idx <= lastBgIdx; idx++) {
                if (await openTile(viewer, toOpen[idx], "background", idx, ctx) === true) {
                    successOpened++;
                }
            }
            for (; idx < toOpen.length; idx++) {
                if (await openTile(viewer, toOpen[idx], "visualization", idx, ctx) === true) {
                    successOpened++;
                }
            }
            handleSyntheticOpenEvent(viewer, successOpened);
        };

        // 3) Drive all viewers according to plan
        const tasks = bgPlan.map((entry, i) => openIntoViewer(entry, i));

        // Show a gentle “loading too long” message if it drags on
        const loadTooLongTimeout = setTimeout(
            () => Dialogs.show($.t("error.slide.pending"), 15000, Dialogs.MSG_WARN),
            8000
        );

        await Promise.allSettled(tasks).then(() => {
            clearTimeout(loadTooLongTimeout);
            USER_INTERFACE.Loading.show(false);
            // todo: maybe dont do this, only if no active viewer is set
            VM.setActive(0);
            // todo a bit ugly, fix later
            setTimeout(() => {
                const vv = VIEWER_MANAGER.viewers[VIEWER_MANAGER.viewers.length - 1];
                if (!vv.isOpen()) {
                    vv.addOnceHandler('open', e => {
                        VIEWER_MANAGER.raiseEvent('after-open');
                    });
                } else {
                    VIEWER_MANAGER.raiseEvent('after-open');
                }
            });
        }).catch((e) => {
            console.error("Open failed:", e);
            clearTimeout(loadTooLongTimeout);
            USER_INTERFACE.Loading.show(false);
        }).then(() => {
            if (USER_INTERFACE.Errors.active) {
                $("#viewer-container").addClass("disabled"); //preventive
            }
            //todo make sure bypassCache and bypassCookies is set to true if this option is true - temporarily
            APPLICATION_CONTEXT.setOption("bypassCacheLoadTime", false);
        });
        return true;
    }

    initXopatScripts();
    function checkLocalState() {
        const data = sessionStorage.getItem('__xopat_session__');
        sessionStorage.setItem('__xopat_session__', undefined);
        if (data) {
            try {
                return JSON.parse(data);
            } catch (e) {
                console.debug("Failed to restore session!", e);
            }
        }
        return null;
    }

    // Refresh Page & Storage state are defined here since we have reference to the incoming config
    window.UTILITIES.storePageState = function(includedPluginsList=undefined) {
        try {
            // Add plugin definition to CONFIG, which is part of POST_DATA entry. Do not change anything if not requested.
            if (includedPluginsList) {
                const pluginRefs = CONFIG.plugins;
                CONFIG.plugins = {};
                for (let plugin in includedPluginsList) {
                    const oldPluginRef = pluginRefs.plugins[plugin];
                    if (!pluginRefs.plugins[plugin]) {
                        CONFIG.plugins[plugin] = {};
                    } else {
                        // FIXME: if we have configured plugin, and we remove and add this plugin, configuration is lost
                        CONFIG.plugins[plugin] = oldPluginRef;
                    }
                }
            }
            // Make sure the reference is really there
            POST_DATA.visualization = CONFIG;

            // Clean up instance references before serialization
            const plugins = {...PLUGINS};
            const modules = {...MODULES};
            for (let id in plugins) {
                delete plugins[id].instance;
            }
            for (let id in modules) {
                delete modules[id].loaded;
            }
            sessionStorage.setItem('__xopat_session__', safeStringify({
                PLUGINS: plugins, MODULES: modules,
                ENV, POST_DATA, PLUGINS_FOLDER, MODULES_FOLDER, VERSION, I18NCONFIG
            }));
            return true;
        } catch (e) {
            console.error("Failed to store application state!", e);
        }
        return false;
    }

    function safeStringify(obj) {
        const seenData = new WeakMap();

        return JSON.stringify(obj, function(key, value) {
            if (key.startsWith("_") || ["eventSource"].includes(key)) {
                return undefined;
            }
            if (value && typeof value === 'object') {
                if (seenData.has(value)) {
                    return undefined;
                }
                seenData.set(value, true);
            }
            return value;
        });
    }

    if (CONFIG.error) {
        USER_INTERFACE.Errors.show(CONFIG.error, `${CONFIG.description} <br><code>${CONFIG.details}</code>`,
            true);
    }
}
