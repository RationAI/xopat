import type {ViewportSetup, XOpatCoreConfig, XOpatElementRecord} from "./types/config";
import type {OpenEvent, TileLoadFailedEvent} from "openseadragon";
import { BackgroundConfig } from "./classes/background-config";
import { HttpClient } from "./classes/http-client";
import { initXOpatLoader } from "./loader";
import { InvertedWeakMap } from "./external/data-structures";
import {ScriptingManager} from "./classes/scripting-manager";

// Functions defined in runtime-loaded scripts — declared here for type-check only (todo retype files to TS, replace with imports)
declare function initXOpatUI(): void;
declare function initXOpatLayers(): void;
declare function xOpatParseConfiguration(config: any, i18n?: any, supportsPost?: boolean): any;
declare class ViewerManager { constructor(env: any, config: any);[key: string]: any; }

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
export function initXOpat(PLUGINS: Record<string, XOpatElementRecord>, MODULES: Record<string, XOpatElementRecord>, ENV: XOpatCoreConfig, POST_DATA: any, PLUGINS_FOLDER: string, MODULES_FOLDER: string, VERSION: string, I18NCONFIG: any = {}) {
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
        i18next.init(I18NCONFIG, (err: any, t: any) => {
            if (err) throw err;
            localizeDom();
        });
    }
    POST_DATA = xOpatParseConfiguration(POST_DATA, $.i18n, ENV.server.supportsPost);
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
    const viewerSecureMode = // For safety test string too
        ENV.client.secureMode && (ENV.client.secureMode as unknown as string) !== "false";
    //default parameters not extended by CONFIG.params (would bloat link files)
    CONFIG.params = CONFIG.params || {};
    //optimization allways present
    CONFIG.params.bypassCookies = CONFIG.params.bypassCookies ?? defaultSetup.bypassCookies;
    // todo enforce parsing also other by class models
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

        if (window.Cookies) {
            XOpatStorage.Cookies.registerClass(class {
                getItem(key: string) {
                    return Cookies.get(key) || null;
                }
                setItem(key: string, value: string) {
                    Cookies.set(key, value);
                    if (!Cookies.get(key)) {
                        console.warn("Cookie value too big to store!", key);
                    }
                }
                removeItem(key: string) {
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
                key(index: number) {
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

    /**
     * @namespace APPLICATION_CONTEXT
     */
    window.APPLICATION_CONTEXT = /**@lends APPLICATION_CONTEXT*/ ({
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
             * @return {any[]}
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
         */
        AppCache: new XOpatStorage.Cache({ id: "" }),
        /**
         * Global Application Cookies.
         */
        AppCookies: new XOpatStorage.Cookies({ id: "" }),
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
            if (!domain.endsWith("/")) return domain + "/" + self.env.client.path;
            return domain + self.env.client.path;
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
            let value = self.config.params[name] !== undefined ? self.config.params[name] :
                (defaultValue === undefined ? self.config.defaultParams[name] : defaultValue);
            if (value === "false") return false;
            if (value === "true") return true;
            if (typeof value === "string") {
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
         * Get the current FILE ID viewed.
         * @return {string}
         */
        referencedId() {
            if (CONFIG.background.length < 0) {
                return "__anonymous__";
            }
            let config;
            if (VIEWER.scalebar) {
                config = VIEWER.scalebar.getReferencedTiledImage()?.getConfig("background");
            } else {
                config = CONFIG.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', undefined, true, true)[0]]
                    || CONFIG.background[0];
            }
            return config ? CONFIG.data[config.dataReference] : "__anonymous__";
        },
        /**
         * Return the current active visualization
         * @return {*}
         */
        activeVisualizationConfig() {
            return CONFIG.visualizations[APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)[0]];
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
     * * @memberof APPLICATION_CONTEXT
     * @type {import('./path/to/http-client').HttpClient}
     */
    APPLICATION_CONTEXT.httpClient = new HttpClient({
        baseURL: APPLICATION_CONTEXT.url,
        auth: { contextId: undefined }
    });

    /**
     * Scripting manager.
     */
    APPLICATION_CONTEXT.Scripting = ScriptingManager.instance();

    // todo maybe dont support this, just call directly the static method
    APPLICATION_CONTEXT.registerConfig = function registerConfig(bg: BackgroundItem) {
        return BackgroundConfig.from(bg);
    };

    /**
     *
     * @param {BackgroundItem|BackgroundConfig} a
     * @param b
     * @return {boolean}
     */
    APPLICATION_CONTEXT.sameBackground = function sameBackground(a: BackgroundItem | BackgroundConfig, b: BackgroundItem | BackgroundConfig) {
        if (a === b) return true;
        if (!a || !b) return false;
        return APPLICATION_CONTEXT.registerConfig(a).id === APPLICATION_CONTEXT.registerConfig(b).id;
    };


    initXOpatUI();
    //Prepare xopat core loading utilities and interfaces
    let runLoader: (() => void) | null = initXOpatLoader(ENV, PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, VERSION);


    /*--------------------------------------------------------------*/
    /*------------ Initialization of  new UI -----------------------*/
    /*--------------------------------------------------------------*/

    // todo make some cascading + registration strategy..
    USER_INTERFACE.AppBar.init();
    USER_INTERFACE.FullscreenMenu.init();
    USER_INTERFACE.MobileBottomBar.init();
    UTILITIES.updateTheme(null);

    /**
     * Replace share button in static preview mode
     */
    if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
        USER_INTERFACE.AppBar.setBanner(new UI.Badge({
            style: UI.Badge.STYLE.SOFT,
            color: UI.Badge.COLOR.WARNING,
        }, "Exported Session"));
    }

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location.href = `./src/error.php?title=${encodeURIComponent('Your browser is not supported.')}
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
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event warn-user
     */
    VIEWER_MANAGER.broadcastHandler('warn-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_WARN, false);
    }, null, -Infinity);
    /**
     * Event to fire if you want to avoid explicit error handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires an error dialog with provided message if not handled.
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event error-user
     */
    VIEWER_MANAGER.broadcastHandler('error-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, null, -Infinity);
    VIEWER_MANAGER.broadcastHandler('plugin-failed', (e: PluginFailedEvent) => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));

    let notified = false;
    //todo error?
    VIEWER_MANAGER.broadcastHandler('add-item-failed', (e: OpenSeadragon.ViewerEventMap["add-item-failed"] & OpenSeadragon.ViewerEvent) => {
        if (notified) return;
        const msg = e.message;
        const statusCode = msg && typeof msg !== 'string' ? msg.statusCode : undefined;
        if (statusCode) {
            //todo check if the first background
            switch (statusCode) {
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
     * @param name the wsi name, for dialog message
     */
    UTILITIES.setImageMeasurements = function (viewer: OpenSeadragon.Viewer, microns: number | undefined, micronsX: number | undefined, micronsY: number | undefined, name: string) {
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

        const magMicrons = microns || ((micronsX ?? 0) + (micronsY ?? 0)) / 2;

        // todo try read metadata about magnification and warn if we try to guess
        const values = [4, 2, 2, 4, 1, 10, 0.5, 20, 0.25, 40]; // Micron values at magnification levels
        let index = 0, best = Infinity, mag: number | undefined;
        if (magMicrons) {
            while (index < values.length) {
                const dev = Math.abs(magMicrons - (values[index] ?? 0));
                // Select the best match with the smallest deviation
                if (dev < best && dev <= (values[index] ?? 0)) {
                    best = dev;
                    mag = values[index + 1]; // Adjust to get the corresponding magnification
                }
                index += 2;
            }
            if (mag === undefined) {
                if (magMicrons > 4) {
                    Dialogs.show($.t("error.macroImage", { image: name }), 10000, Dialogs.MSG_WARN);
                } else {
                    console.error("Failed to find matching magnification for microns!", microns);
                }
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
            magnification: mag,
            maxMagnification: 40
        });
        if (!APPLICATION_CONTEXT.getOption("scaleBar", true)) {
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
     * @param {Object} [opts]
     * @param {boolean} [opts.deriveOverlayFromBackgroundGoals]
     *        If true, ignore vizSpec and derive overlays from cfg.background[i].goalIndex.
     * @return {boolean} true if something needed change
     */
    window.UTILITIES.parseBackgroundAndGoal = function (
        bgSpec = undefined,
        vizSpec = undefined,
        { deriveOverlayFromBackgroundGoals = false } = {}
    ) {
        const cfg = APPLICATION_CONTEXT.config;
        let backgrounds = Array.isArray(cfg.background) ? cfg.background : [];
        const vizCount = Array.isArray(cfg.visualizations) ? cfg.visualizations.length : 0;

        let filteredBackgrounds: Array<BackgroundConfig> = backgrounds.filter((bg: any) => {
            if (!(bg instanceof BackgroundConfig)) {
                console.error('Config not of BackgroundConfig instance, filtering out', bg);
                return false;
            }
            return true;
        });
        if (filteredBackgrounds.length !== backgrounds.length) {
            backgrounds = filteredBackgrounds;
            Dialogs.show('Viewer does not show all files - some were not properly configured!', 8000, Dialogs.MSG_WARN);
        }
        // todo also other items should have class models

        const clampIndex = (i: any, max: number): number | undefined =>
            Number.isInteger(i) && i >= 0 && i < max ? i : undefined;

        const normIndexValue = (v: any, max: number) => (v == null ? undefined : clampIndex(v, max));

        // Normalize an index or array of indices; preserves explicit undefined entries (via null/undefined)
        const normalizeIndexArg = (arg: any, max: number) => {
            if (arg == null) return undefined;
            if (Array.isArray(arg)) {
                return arg.map(v => normIndexValue(v, max));
            }
            return clampIndex(arg, max);
        };

        // From a bgArg produce: undefined | number | number[]
        const selectBackgroundIndices = (bgArg: any, bgCount: number) => {
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

        // Build visualization spec
        const buildVis = (visArg: any, bgIndices: number | number[] | undefined) => {
            if (bgIndices === undefined) return undefined;

            const toAlignedArray = (len: number, sourceArray: any[]) => {
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
        const deriveVisFromGoals = (bgIndices: number | number[] | undefined) => {
            const getGoal = (i: number): number | undefined => {
                const g = backgrounds[i] && typeof backgrounds[i].goalIndex === "number"
                    ? backgrounds[i].goalIndex
                    : undefined;
                return clampIndex(g, vizCount);
            };

            if (bgIndices === undefined) return undefined;

            if (Array.isArray(bgIndices)) return bgIndices.map(getGoal);
            return getGoal(bgIndices as number);
        };

        let updated = false;

        // ---------- Handle bgSpec (null => erase; undefined => keep; value => set) ----------
        let effectiveBg;
        if (bgSpec === null) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", undefined);
            updated = true;
            effectiveBg = undefined;
        } else if (bgSpec !== undefined) {
            const newActiveBg = selectBackgroundIndices(bgSpec, backgrounds.length);
            const prevActiveBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, false);
            if (prevActiveBg !== JSON.stringify(newActiveBg)) {
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
                desiredActiveVis = buildVis(vizSpec, bgIndicesForViz);
            } // else: vizSpec === undefined and derive flag is false => keep existing option

            if (typeof desiredActiveVis !== "undefined") {
                const prevActiveVis = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, false);
                if (prevActiveVis !== JSON.stringify(desiredActiveVis)) {
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", desiredActiveVis);
                    updated = true;
                }

                // Persist per-background goalIndex when we have a concrete desiredActiveVis
                if (selectedBgArray.length > 0) {
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

    function handleSyntheticOpenEvent(viewer: OpenSeadragon.Viewer, successLoadedItemCount: number, totalItemCount: number) {
        const world = viewer.world;
        if (world.getItemCount() < 1) {
            viewer.addTiledImage({
                tileSource: new OpenSeadragon.EmptyTileSource({ height: 20000, width: 20000, tileSize: 512 }),
                index: 0,
                replace: false,
                // TODO: OSD has bad type 'Event' which does not reflect the correct syntax
                success: (event: any) => {
                    /**
                     * @this {OpenSeadragon.TiledImage}
                     * @function getConfig
                     * @param {string} [type=undefined]
                     * @memberof OpenSeadragon.TiledImage
                     * @returns {BackgroundItem|VisualizationItem|undefined}
                     */
                    event.item.getConfig = (type: string | undefined) => undefined;
                    viewer.toggleDemoPage(true, totalItemCount > 0 ? $.t('error.invalidDataHtml') : undefined);
                    handleSyntheticEventFinishWithValidData(viewer, 0);
                }
            });
            return;
        }

        if (successLoadedItemCount === 0) {
            viewer.toggleDemoPage(true, totalItemCount > 0 ? $.t('error.invalidDataHtml') : undefined);
        } else {
            viewer.toggleDemoPage(false);
        }
        // else {
        //     // TODO propose fix in OpenSeadragon... also this might be a deadlock
        //     // Fix indexing: OSD has race conditions when we call addTiledImage subsequently with defined indexes
        //     const itemCount = world.getItemCount();
        //     let index = 0, iterations = 0;
        //     while (index < itemCount && iterations < itemCount*itemCount) {
        //         const item = world.getItemAt(index);
        //         if (item.__targetIndex !== index) {
        //             world.setItemIndex(item, item.__targetIndex);
        //             iterations++;
        //         } else {
        //             index++;
        //         }
        //         // Set lossless if required
        //         if (item.getConfig === undefined) {
        //             console.warn(`Item ${item} was specified without a config getter - this is a bug!`);
        //             item.getConfig = type => undefined;
        //         }
        //     }
        // }

        // todo check args, do we need to search for at least one valid reference image?
        handleSyntheticEventFinishWithValidData(viewer, 0);
    }

    function handleSyntheticEventFinishWithValidData(viewer: OpenSeadragon.Viewer, referenceImage: number) {
        const eventOpts: Record<string, any> = {};

        try {
            //Todo once rewritten, treat always low level item as the reference layer (index == 0)

            //the viewer scales differently-sized layers sich that the biggest rules the visualization
            //this is the largest image layer, or possibly the rendering layers layer
            const tiledImage = viewer.world.getItemAt(referenceImage);
            const dataConfig = tiledImage?.getConfig();

            let name: string = "";
            if (Number.isInteger(Number.parseInt(dataConfig?.dataReference))) {
                name = dataConfig.name || UTILITIES.fileNameFromPath(
                    String(APPLICATION_CONTEXT.config.data[dataConfig.dataReference as number] ?? '')
                );
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            } else if (!dataConfig && APPLICATION_CONTEXT.config.background.length > 0) {
                const active = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', undefined, true, true)?.[0];
                name = UTILITIES.fileNameFromPath(String(APPLICATION_CONTEXT.config.data[active ?? 0] ?? 'unknown'));
                viewer.getMenu().getNavigatorTab().setTitle($.t('main.navigator.faultyTissue', { slide: name }), true);
            } else if (!dataConfig) {
                viewer.getMenu().getNavigatorTab().setTitle($.t('main.navigator.faultyViz'), true);
            } else {
                name = dataConfig.name || $.t('common.Image');
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            }

            let microns: number | undefined, micronsX: number | undefined, micronsY: number | undefined;

            if (dataConfig) {
                const data = BackgroundConfig.data(dataConfig);
                // access via dataConfig is deprecated, but we need to keep it for now
                microns = (data as any).microns || dataConfig.microns;
                micronsX = (data as any).micronsX || dataConfig.micronsX;
                micronsY = (data as any).micronsY || dataConfig.micronsY;

                // microns can come both from the background config and the tileSource api
                const hasMicrons = !!microns, hasDimMicrons = !!(micronsX && micronsY);
                if (!hasMicrons || !hasDimMicrons) {
                    const sourceMeta = typeof tiledImage?.source?.getMetadata === "function" && tiledImage.source.getMetadata();
                    if (sourceMeta) {
                        if (!hasMicrons) microns = sourceMeta.microns;
                        if (!hasDimMicrons) {
                            micronsX = sourceMeta.micronsX;
                            micronsY = sourceMeta.micronsY;
                        }
                    }
                }
            }

            UTILITIES.setImageMeasurements(viewer, microns, micronsX, micronsY, name ?? "Unknown");
            viewer.scalebar.linkReferenceTileSourceIndex(referenceImage);

            if (APPLICATION_CONTEXT.config.visualizations.length > 0) {
                viewer.getMenu().getShadersTab().updateVisualizationList(
                    APPLICATION_CONTEXT.config.visualizations,
                    // todo is this accurate?
                    APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)?.[0]
                );
            }
        } catch (e) {
            console.error(e);
        }

        if (runLoader) {
            runLoader();
            runLoader = null;
        }

        if (APPLICATION_CONTEXT.config.visualizations.length > 0) {
            viewer.raiseEvent('visualization-ready', { viewer });
        }

        if (!(viewer as any).__initialized) {
            (viewer as any).__initialized = true;
            eventOpts.firstLoad = true;

            const normalizeViewport = (vp: ViewportSetup) => {
                if (!vp || typeof vp !== "object") return null;
                if (!vp.point || vp.zoomLevel == null) return null;
                return vp;
            };

            const applyViewport = (viewer: OpenSeadragon.Viewer, vp: ViewportSetup) => {
                const v = normalizeViewport(vp);
                if (!v) return false;

                // pan first, then zoom; both immediate to avoid animation race on open
                viewer.viewport.panTo(new OpenSeadragon.Point(v.point!.x, v.point!.y), true);
                viewer.viewport.zoomTo(v.zoomLevel!, undefined, true);
                if (v.rotation != null && Number.isFinite(v.rotation)) {
                    viewer.viewport.setRotation(v.rotation, true);
                }
                return true;
            };

            // Build a stable cache key per viewer+background.
            // Uses background.id when present; otherwise falls back gracefully.
            const viewportCacheKey = (viewer: OpenSeadragon.Viewer) => {
                const bgCfg = viewer.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background");
                const bgId = bgCfg?.id || bgCfg?.dataReference || "unknown-bg";
                return `viewport:${APPLICATION_CONTEXT.sessionName}:${bgId}`;
            };

            // Install throttled caching of viewport changes.
            const installViewportCaching = (viewer: OpenSeadragon.Viewer) => {
                // respect existing bypassCache behaviour
                if (APPLICATION_CONTEXT.getOption("bypassCache", false)) return;

                const key = viewportCacheKey(viewer);

                const snapshot = () => ({
                    zoomLevel: viewer.viewport.getZoom(),
                    point: viewer.viewport.getCenter(),
                    rotation: viewer.viewport.getRotation(),
                });

                const save = UTILITIES.makeThrottled(() => {
                    try {
                        APPLICATION_CONTEXT.AppCache.set(key, snapshot());
                    } catch (e) {
                        console.warn("Failed to cache viewport", e);
                    }
                }, 150);

                const onZoom = () => save();
                const onPan = () => save();
                const onRotate = () => save();

                viewer.addHandler("zoom", onZoom);
                viewer.addHandler("pan", onPan);
                viewer.addHandler("rotate", onRotate);

                viewer.addHandler("destroy", () => {
                    try { save.finish?.(); } catch (_) { }
                    viewer.removeHandler("zoom", onZoom);
                    viewer.removeHandler("pan", onPan);
                    viewer.removeHandler("rotate", onRotate);
                });
            };

            // ---- APPLY STORED VIEWPORT (multi-view aware, backward compatible) ----
            (() => {
                const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(Boolean);
                const focus = APPLICATION_CONTEXT.getOption("viewport", null, true, true);

                // 1) Explicit viewport in params wins (backward compat)
                if (Array.isArray(focus)) {
                    // per-viewer viewport array
                    for (let i = 0; i < viewers.length; i++) {
                        if (focus[i]) applyViewport(viewers[i], focus[i]);
                    }
                } else if (focus && typeof focus === "object") {
                    // old format: one viewport object → apply to all viewers
                    for (const v of viewers) applyViewport(v, focus);
                } else {
                    // 2) Otherwise try per-viewer cache (by background id)
                    for (const v of viewers) {
                        const cached = APPLICATION_CONTEXT.AppCache.get(viewportCacheKey(v));
                        // getOption already does parsing sometimes; cache may be string or object depending on storage
                        const parsed = typeof cached === "string" ? (() => { try { return JSON.parse(cached); } catch { return null; } })() : cached;
                        if (parsed) applyViewport(v, parsed);
                    }
                }

                // 3) Always install caching after we’ve done initial restore
                for (const v of viewers) installViewportCaching(v);
            })();

            // todo needs to trigger valid navigator ID
            // if (window.innerHeight < 630 || window.innerWidth < 900) {
            //     if (window.innerWidth >= 900) {
            //         $('#navigator-pin').click();
            //     }
            // }

            window.onerror = null;

            // todo remove this feature?
            try {
                if (window.opener && (window.opener as any).VIEWER) {
                    ((viewer as any).tools as any).link("external_window");
                    (((window.opener as any).VIEWER as any).tools as any).link("external_window");
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
        background: BackgroundItem[] | BackgroundConfig[] | undefined,
        visualizations: VisualizationItem[] | undefined = undefined) {
        try {
            initXOpatLayers();

            // First step: load plugins that were marked as to be loaded but were not yet loaded
            function loadPluginAwaits(pid: string, hasParams: boolean) {
                return new Promise<void>((resolve) => {
                    UTILITIES.loadPlugin(pid, resolve);
                    if (!hasParams) {
                        //todo consider doing this automatically
                        CONFIG.plugins[pid] = {};
                    }
                });
            }

            const pluginKeys = APPLICATION_CONTEXT.AppCookies.get('_plugins', '').split(',') || [];
            for (let pid in PLUGINS) {
                const hasParams = !!CONFIG.plugins[pid];
                const plugin = PLUGINS[pid]!;
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

            await APPLICATION_CONTEXT.Scripting.ready;

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
            await VIEWER_MANAGER.raiseEventAwaiting('before-first-open', event).catch((e: any) => {
                //todo something meaningful
                console.error(e);
            });
            await this.openViewerWith(event.data, event.background || [], event.visualizations || []);
            // Only after: before, auto-load would trigger many messages..
            VIEWER_MANAGER.addHandler('plugin-loaded', (e: PluginLoadedEvent) => {
                if (!e.isInitialLoad) {
                    Dialogs.show($.t('messages.pluginLoadedNamed', { plugin: PLUGINS[e.id]?.name }), 2500, Dialogs.MSG_INFO);
                }
            });
        } catch (e) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show($.t('error.unknown'), `${$.t('error.reachUs')} <br><code>${e}</code>`, true);
            console.error(e);
        }
        //https://github.com/mrdoob/stats.js
        if (APPLICATION_CONTEXT.getOption("debugMode")) {
            (function () { var script = document.createElement('script'); script.onload = function () { var stats = new (window as any).Stats(); document.body.appendChild(stats.dom); stats.showPanel(1); requestAnimationFrame(function loop() { stats.update(); requestAnimationFrame(loop) }); }; script.src = APPLICATION_CONTEXT.url + 'src/external/stats.js'; document.head.appendChild(script); })()
        }
    };


    /**
     * TODO get rid completely of data array, keep it only on the outer interface level
     *
     * Open desired configuration into one or more viewer instances (no VIEWER global access here).
     * - Calls UTILITIES.parseBackgroundAndGoal to resolve background/overlay selections.
     * - With multiple backgrounds selected, creates multiple viewers (one per bg).
     *
     @param {Array|undefined} data
     @param {Array|undefined} background
     @param {Array|undefined} visualizations
     @param {number|number[]|undefined|null} bgSpec
     @param {number|number[]|undefined|null} vizSpec
     @param {Object} [opts]
     @param {boolean} [opts.deriveOverlayFromBackgroundGoals]
     */
    APPLICATION_CONTEXT.openViewerWith = async function (
        data = undefined,
        background: BackgroundItem[] | undefined = undefined,
        visualizations: VisualizationItem[] | undefined = undefined,
        bgSpec: number | number[] | undefined | null = undefined,
        vizSpec: number | number[] | undefined | null = undefined,
        opts: { deriveOverlayFromBackgroundGoals?: boolean } = {}
    ) {
        USER_INTERFACE.Loading.show(true);

        await VIEWER_MANAGER.raiseEventAwaiting(
            'before-open', { data, background, visualizations, bgSpec, vizSpec }
        ).catch((e: any) => console.warn("Exception in 'before-open' event handler: ", e));

        //todo consider return false if some dialog refuses the reload
        await Dialogs.awaitHidden();

        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
        const existingBackground = Array.isArray(config.background) ? config.background : [];
        const existingVisualizations = Array.isArray(config.visualizations) ? config.visualizations : [];
        const existingData = Array.isArray(config.data) ? config.data : [];
        const normalizedBackground = background === null ? [] : background;
        const normalizedVisualizations = visualizations === null ? [] : visualizations;
        const normalizedData = data === null ? [] : data;
        const isBgSame = normalizedBackground === undefined || (
            Array.isArray(normalizedBackground) &&
            normalizedBackground.length === existingBackground.length &&
            normalizedBackground.every((bg: BackgroundItem, i: number) => APPLICATION_CONTEXT.sameBackground(bg, existingBackground[i]))
        );

        // -- update CONFIG if new values are provided (undefined => keep ; null => erase)
        if (typeof normalizedData !== "undefined") config.data = normalizedData;
        else if (!Array.isArray(config.data)) config.data = existingData;
        if (typeof normalizedBackground !== "undefined") config.background = normalizedBackground;
        else if (!Array.isArray(config.background)) config.background = existingBackground;
        if (typeof normalizedVisualizations !== "undefined") config.visualizations = normalizedVisualizations;
        else if (!Array.isArray(config.visualizations)) config.visualizations = existingVisualizations;

        if (!Array.isArray(config.data)) config.data = [];
        if (!Array.isArray(config.background)) config.background = [];
        if (!Array.isArray(config.visualizations)) config.visualizations = [];

        if (Array.isArray(config.background)) {
            // always call from(...) it will remap data references to indexes
            config.background = config.background.map((bg: any) => BackgroundConfig.from(bg));
        }

        const cfg = APPLICATION_CONTEXT.config;
        const bgs: BackgroundConfig[] = Array.isArray(cfg.background) ? cfg.background : [];
        const vis = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
        const env = APPLICATION_CONTEXT.env;
        const isSecureMode = !!APPLICATION_CONTEXT.secure;

        // 1) Normalize selection via the parser (also persists options as needed)
        UTILITIES.parseBackgroundAndGoal(bgSpec, vizSpec, {
            deriveOverlayFromBackgroundGoals: !!opts.deriveOverlayFromBackgroundGoals
        });

        let activeBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
        let activeViz = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true);

        // Ensure we open at least something if possible
        const bgSpecWasUnset = activeBg === undefined;
        const vizSpecWasUnset = activeViz === undefined;
        if (bgSpecWasUnset && vizSpecWasUnset) {
            if (bgs.length > 0) {
                activeBg = 0;
            } else if (vis.length > 0) {
                activeViz = 0;
            }
        } else {
            if (vizSpecWasUnset && vis.length > 0) {
                activeViz = 0;
            }
        }

        // Always keep arrays
        if (typeof activeBg === "number") {
            activeBg = [activeBg];
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", activeBg);
        }
        if (typeof activeViz === "number") {
            activeViz = [activeViz];
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", activeViz);
        }

        // Build per-viewer plan:
        //     - activeBg is number => single viewer with that bg
        //     - activeBg is array  => N viewers, each with one bg (in order)
        //     - activeBg undefined => single viewer, no bg (blank/error tile)
        const bgPlan = (() => {
            if (Array.isArray(activeBg)) {
                return activeBg.map(idx => ({ type: "single", bgIndices: [idx] }));
            }
            if (Number.isInteger(activeBg)) {
                return [{ type: "single", bgIndices: [activeBg] }];
            }
            return [{ type: "single", bgIndices: [] }];
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
        const bgUrlFromEntry = (bgEntry: BackgroundConfig, dataSpec: DataSpecification | undefined = undefined) => {
            // Resolve DataSpecification & DataID from background
            const spec: DataSpecification | undefined = dataSpec === undefined ? BackgroundConfig.dataSpecification(bgEntry) : dataSpec;
            const isObjectSpec = spec && typeof spec === "object";

            if (isObjectSpec && (spec as DataOverride).tileSource instanceof OpenSeadragon.TileSource) {
                return (spec as DataOverride).tileSource;
            }

            // todo remove protocol from bgEntry once deprecation is complete
            const customProto = isObjectSpec && (spec as DataOverride).protocol ? (spec as DataOverride).protocol : (bgEntry.protocol ? bgEntry.protocol : null);
            const proto = customProto && !isSecureMode ? customProto : env.client.image_group_protocol;
            const make = new Function("path,data", "return " + proto);

            // todo support multiple data references -> payload as array
            return make(env.client.image_group_server, BackgroundConfig.dataFromSpec(spec));
        };

        const openPlaceholder = (viewer: OpenSeadragon.Viewer, errorMessage: any, index: number, originalSource: any, onOpen: (ok: boolean) => void) => {
            viewer.addTiledImage({
                tileSource: {
                    type: "_blank",
                    error:
                        errorMessage ||
                        $.t("error.slide.pending") + " " + $.t("error.slide.imageLoadFail") + " " +
                        (originalSource && originalSource.toString ? originalSource.toString() : "")
                },
                opacity: 0,
                index,
                //Todo: osd event type not
                success: (e: any) => {
                    e.item.__targetIndex = index;
                    /**
                     * @this {OpenSeadragon.TiledImage}
                     * @function getConfig
                     * @param {string} [type=undefined]
                     * @memberof OpenSeadragon.TiledImage
                     * @returns {BackgroundItem|VisualizationItem|undefined}
                     */
                    e.item.getConfig = (type: string | undefined) => undefined;
                    onOpen(false);
                },
                error: (e: any) => {
                    // event.item is not set, only event.source
                    console.error(e);
                    onOpen(false);
                }
            });
        };

        // Helper: open one tile into a viewer with bookkeeping
        const openTile = async (viewer: OpenSeadragon.Viewer, source: any, kind: string, index: number, ctx: any) => {
            // First create a tile source class
            const originalSource = source.source || source;
            const tileSource = await viewer.instantiateTileSourceClass({
                tileSource: originalSource
                // TODO: types in osd v6
            }).then((ev: any) => ev.source).catch((ev: any) => ev.message || String(ev));

            if (typeof tileSource === "string") {
                console.error(`Failed to instantiate tile source for ${kind} ${index}: ${tileSource}`);
                await viewer.raiseEventAwaiting(
                    'tile-source-failed', { viewer, originalSource, kind, index, tileSource: null, error: tileSource }
                ).catch((e: any) => console.warn("Exception in 'tile-source-failed' event handler: ", e));
                return new Promise<boolean>(resolve => openPlaceholder(viewer, tileSource, index, originalSource, resolve));
            }

            await viewer.raiseEventAwaiting(
                'tile-source-created',
                { viewer, originalSource, kind, index, tileSource, error: null }
            ).catch((e: any) => console.warn("Exception in 'tile-source-created' event handler: ", e));
            console.log("Opening tile", kind, index, ctx);

            return new Promise<boolean>((resolve) => {
                viewer.addTiledImage({
                    tileSource,
                    index,
                    // TODO: bad type
                    success: (event: any) => {
                        event.item.__targetIndex = index;

                        // DataSpecification used to construct this tile (if any),
                        // passed from openIntoViewer via ctx.dataForItem.
                        const dataSpec = ctx && typeof ctx.dataForItem === "function"
                            ? ctx.dataForItem(index)
                            : undefined;

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
                            event.item.getConfig = (type: string | undefined) =>
                                !type || type === "background" ? cfg.background[bgIdx] : undefined;
                        } else if (kind === "visualization") {
                            const vIdx = ctx.vizIndexForItem(index);
                            event.item.getConfig = (type: string | undefined) =>
                                !type || type === "visualization" ? cfg.visualizations[vIdx] : undefined;
                        } else {
                            event.item.getConfig = () => undefined;
                        }

                        // Options resolution:
                        //   base: DataOverride.options (if any)
                        //   override/extend: config-level options (bg/viz)
                        const cfgForItem = event.item.getConfig();
                        let options = cfgForItem && cfgForItem.options;

                        if (dataSpec && typeof dataSpec === "object" && dataSpec.options) {
                            options = { ...(dataSpec.options || {}), ...(options || {}) };
                        }

                        if (options !== undefined) {
                            event.item.source.setSourceOptions(options);
                        }
                        resolve(true);
                    },
                    error: (e: any) => {
                        // todo consider event?
                        console.warn(e);
                        // fallback blank item (hidden)
                        openPlaceholder(viewer, e.message || e, index, originalSource, resolve);
                    }
                });
            });
        };

        // Helper: configure shaders/rendering for a viewer + open its images
        const openIntoViewer = async (entry: any, viewerIndex: number) => {
            const viewer = VM.viewers[viewerIndex];
            const isSurgical = isBgSame && viewer.isOpen() && viewer.world.getItemCount() > 0;

            // (A) Identify Backgrounds
            const openedBase: BackgroundConfig[] = [];
            const bgi = entry.bgIndices[0];
            if (Number.isInteger(bgi) && bgs[bgi]) openedBase.push(bgs[bgi]);

            // (B) Decide Visualization Index
            let visIndexForThis: number | undefined = Array.isArray(activeViz)
                ? activeViz[viewerIndex]
                : (Number.isInteger(activeViz) ? (activeViz as number) : undefined);

            const renderingWithWebGL = Array.isArray(vis) && vis.length > 0 && Number.isInteger(visIndexForThis);
            const activeV = renderingWithWebGL ? vis[visIndexForThis as number] : undefined;

            // (C) Build base tileSource list and data mapping
            const toOpen: any[] = [];
            const uniqueOsdWorldIndexes: Map<any, number> = new Map();
            const openedSpecOrder: any[] = [];
            const renderOutput: Record<string, any> = {};

            // Helper: build URL for a visualization data index using DataSpecification + protocols
            const vizUrlFromEntries = (dataIndex: number) => {
                const spec = cfg.data[dataIndex] as DataSpecification;
                const isObjectSpec = spec && typeof spec === "object";

                if (isObjectSpec && (spec as DataOverride).tileSource instanceof OpenSeadragon.TileSource) {
                    return (spec as DataOverride).tileSource;
                }

                // Preferred protocol: DataOverride.protocol, then deprecated activeV.protocol, then default
                const customProto = isObjectSpec && (spec as DataOverride).protocol ? (spec as DataOverride).protocol
                    : (activeV && activeV.protocol ? activeV.protocol : null);

                const proto = (!isSecureMode && customProto) || env.client.data_group_protocol;
                const make = new Function("path,data", "return " + proto);

                // dataId is a single DataID; for viz protocols we keep passing [dataId] to keep backward compat
                return make(env.client.image_group_server, [BackgroundConfig.dataFromSpec(spec)]);
            };

            openedBase.forEach((bg: BackgroundConfig) => {
                const index = bg.dataReference;
                if (!uniqueOsdWorldIndexes.has(index)) {
                    uniqueOsdWorldIndexes.set(index, toOpen.length);
                    toOpen.push(bgUrlFromEntry(bg));
                    openedSpecOrder.push(BackgroundConfig.dataSpecification(bg));
                }
            });

            // (C1) Background shaders, including possible extra dataReferences
            openedBase.forEach((bgRef: BackgroundConfig, bgIndex: number) => {
                let bgShaders: VisualizationShaderLayer[] | undefined = bgRef.shaders;
                if (!bgShaders) {
                    bgShaders = [{ type: "identity" }];
                } else if (!Array.isArray(bgShaders)) {
                    console.warn("Invalid shaders for background: array required.", bgIndex, bgRef, bgShaders);
                    bgShaders = [bgShaders as VisualizationShaderLayer];
                }

                let count = 0;
                // todo bg shaders are not syntactically validated, add checks at the open top level
                for (const shaderCfg of bgShaders) {
                    shaderCfg.id = count < 1 ? bgRef.id : `${bgRef.id}-${count}`;

                    const hasExplicitRefs = Array.isArray(shaderCfg.dataReferences) && shaderCfg.dataReferences.length > 0;

                    if (!hasExplicitRefs) {
                        // DEFAULT:
                        //  - No dataReferences specified on shader
                        //  - Use the base background pyramid as the only tiled image
                        //  - And expose the numeric reference if available
                        const dataIndex = bgRef.dataReference as number;
                        shaderCfg.tiledImages = [uniqueOsdWorldIndexes.get(dataIndex) ?? -1];
                        shaderCfg.name = shaderCfg.name || bgRef.name || BackgroundConfig.data(bgRef);

                    } else {
                        // ADVANCED:
                        //  - Background shader has its own dataReferences
                        //  - Each dataReference is opened exactly once (shared with other shaders)
                        shaderCfg.tiledImages = [];
                        shaderCfg.name = shaderCfg.name || UTILITIES.nameFromBGOrIndex(shaderCfg.dataReferences[0]);

                        for (const dataIndex of shaderCfg.dataReferences!) {
                            if (!uniqueOsdWorldIndexes.has(dataIndex)) {
                                uniqueOsdWorldIndexes.set(dataIndex, toOpen.length);
                                // todo multi support?
                                toOpen.push(bgUrlFromEntry(bgRef, cfg.data[dataIndex]));
                                openedSpecOrder.push(cfg.data[dataIndex]);
                            }
                            shaderCfg.tiledImages.push(uniqueOsdWorldIndexes.get(dataIndex) ?? -1);
                        }
                    }
                    renderOutput[shaderCfg.id] = shaderCfg;
                    count++;
                }
            });

            const firstVizIndex = toOpen.length;

            // (C2) Visualization shaders and their dataReferences
            let shaderConfigMap: Record<string, VisualizationShaderLayer> = {};

            if (renderingWithWebGL && activeV) {
                APPLICATION_CONTEXT.prepareRendering();
                shaderConfigMap = activeV.shaders || {};

                for (const shaderId in shaderConfigMap) {
                    const vizShaderCfg = shaderConfigMap[shaderId];
                    if (!vizShaderCfg) continue;
                    vizShaderCfg.tiledImages = [];

                    const dataRefs = vizShaderCfg.dataReferences || [];
                    const firstSpec = dataRefs.length ? cfg.data[dataRefs[0] ?? 0] : undefined;
                    const firstId = BackgroundConfig.dataFromSpec(firstSpec);
                    vizShaderCfg.name = (vizShaderCfg.name || firstId || shaderId) as string;

                    for (const dataIndex of dataRefs) {
                        if (!uniqueOsdWorldIndexes.has(dataIndex)) {
                            uniqueOsdWorldIndexes.set(dataIndex, toOpen.length);
                            // todo return multi support? or leave as-is? maybe explicit option that plays nice with osd batch queries?
                            toOpen.push(vizUrlFromEntries(dataIndex));
                            // todo apify this
                            openedSpecOrder.push(cfg.data[dataIndex]);
                        }

                        vizShaderCfg.tiledImages.push(uniqueOsdWorldIndexes.get(dataIndex) ?? -1);
                    }
                }

                Object.assign(renderOutput, shaderConfigMap);
            }

            // (D) Execution: Full Reset vs Surgical Update
            if (!isSurgical) {
                VM._resetViewer(viewerIndex);
            } else {
                // Remove only visualization layers that don't match the new 'toOpen' list
                const currentCount = viewer.world.getItemCount();
                for (let i = currentCount - 1; i >= firstVizIndex; i--) {
                    const item = viewer.world.getItemAt(i);
                    const sourceUrl = item.source.url || item.source;
                    // If the existing source isn't in our new visualization list, pull it
                    if (!toOpen.slice(firstVizIndex).some(newSrc => (newSrc.url || newSrc) === sourceUrl)) {
                        viewer.world.removeItem(item);
                    }
                }
            }

            // Configure the drawer
            UTILITIES.applyStoredVisualizationSnapshot(renderOutput);
            if (viewer.drawer?.overrideConfigureAll) {
                viewer.drawer.overrideConfigureAll(renderOutput);
            }

            // (E) Layer Synchronization + data mapping for openTile
            const ctx = {
                bgIndexForItem: (i: number) => entry.bgIndices[0],
                vizIndexForItem: (i: number) => visIndexForThis,
                dataForItem: (i: number) => openedSpecOrder[i]
            };

            let successOpened = 0;
            for (let i = 0; i < toOpen.length; i++) {
                const isBg = i < firstVizIndex;
                const existingItem = isSurgical ? viewer.world.getItemAt(i) : null;

                // Skip if surgically updating and item already exists with same source
                if (existingItem && (existingItem.source.url || existingItem.source) === (toOpen[i].url || toOpen[i])) {
                    successOpened++;
                    continue;
                }

                if (await openTile(viewer, toOpen[i], isBg ? "background" : "visualization", i, ctx)) {
                    successOpened++;
                }
            }

            // Only fire full re-init events if it wasn't a surgical update
            if (!isSurgical) {
                handleSyntheticOpenEvent(viewer, successOpened, toOpen.length);
            } else {
                // TODO - use event reaction instead?
                viewer.getMenu().getShadersTab().updateVisualizationList(
                    APPLICATION_CONTEXT.config.visualizations,
                    APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)?.[0]
                );
                viewer.raiseEvent('visualization-ready', { viewer });
            }
        };

        // Show a gentle “loading too long” message if it drags on
        const loadTooLongTimeout = setTimeout(
            () => Dialogs.show($.t("error.slide.pending"), 15000, Dialogs.MSG_WARN),
            8000
        );

        await Promise.allSettled(bgPlan.map(openIntoViewer)).then(e => {
            for (let promise of e) {
                if (promise.status === "rejected") {
                    // todo how to deal with this within UI?
                    console.error("Failed to open viewer item", promise.reason);
                    Dialogs.show($.t("error.slide.failed"), 15000, Dialogs.MSG_WARN);
                }
            }

            clearTimeout(loadTooLongTimeout);
            USER_INTERFACE.Loading.show(false);
            // todo: maybe dont do this, only if no active viewer is set
            VM.setActive(0);
            // todo a bit ugly, fix later
            setTimeout(() => {
                const vv = VM.viewers[VM.viewers.length - 1];
                if (!vv.isOpen()) {
                    vv.addOnceHandler('open', (e: OpenEvent) => {
                        VIEWER_MANAGER.raiseEvent('after-open');
                    });
                } else {
                    VIEWER_MANAGER.raiseEvent('after-open');
                }
            });
            UTILITIES.syncSessionToUrl(false);
            console.log("Open done:", e);
            if (USER_INTERFACE.Errors.active) {
                $("#viewer-container").addClass("disabled"); //preventive
            }
            //todo make sure bypassCache and bypassCookies is set to true if this option is true - temporarily
            APPLICATION_CONTEXT.setOption("bypassCacheLoadTime", false);
        });
        return true;
    }

    function checkLocalState() {
        const data = sessionStorage.getItem('__xopat_session__');
        sessionStorage.removeItem('__xopat_session__');
        if (data) {
            try {
                return JSON.parse(data);
            } catch (e) {
                console.debug("Failed to restore session!", e);
            }
        }
        return null;
    }

    /**
     * Lightweight update of the visualization layers.
     * @param {VisualizationItem[]} visualizations The new visualizations array
     * @param {Array} [newData=[]] New data identifiers to be appended to the global data array
     * @param {number|number[]} [activeVizIndex] Optional: set the new active visualization index
     */
    APPLICATION_CONTEXT.updateVisualization = async function (visualizations: VisualizationItem[], newData: DataID[] = [], activeVizIndex: number | number[] | undefined = undefined) {
        if (!Array.isArray(visualizations)) {
            throw new Error("Visualizations must be an array.");
        }

        const currentData = [...this.config.data];
        if (newData.length > 0) {
            currentData.push(...newData);
        }


        let vizSpec = activeVizIndex;
        if (vizSpec === undefined) {
            vizSpec = this.getOption("activeVisualizationIndex", 0, true, true);
        }

        return await this.openViewerWith(
            currentData,
            undefined,
            visualizations,
            undefined,
            vizSpec
        );
    };

    // Refresh Page & Storage state are defined here since we have reference to the incoming config
    UTILITIES.storePageState = function (includedPluginsList: Record<string, any> | undefined = undefined) {
        try {
            // Add plugin definition to CONFIG, which is part of POST_DATA entry. Do not change anything if not requested.
            if (includedPluginsList) {
                const pluginRefs = CONFIG.plugins;
                CONFIG.plugins = {};
                for (let plugin in includedPluginsList) {
                    const oldPluginRef = pluginRefs[plugin];
                    if (!pluginRefs[plugin]) {
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
            const plugins = { ...PLUGINS };
            const modules = { ...MODULES };
            for (let id in plugins) {
                delete plugins[id]!.instance;
            }
            for (let id in modules) {
                delete modules[id]!.instance;
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

    function safeStringify(obj: object): string {
        const seenData = new WeakMap();

        return JSON.stringify(obj, function (key, value) {
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

    /**
     * History provider is logics that can stub history steps without actually
     * explicitly putting anything inside history state. For example, user is creating
     * a polygon. 'undo' step can undo individual points, but only changes the internal
     * creation logics state, not pushing anything to the history. Providers override
     * the history API and only IF no provider handles the step, the original history logics fires.
     * @type {Window.HistoryProvider}
     */
    window.HistoryProvider = class XOpatHistoryProvider {
        get importance(): number {
            return 0;
        }
        undo(): boolean {
            throw new Error('Not implemented');
        }
        redo(): boolean {
            throw new Error('Not implemented');
        }
        canUndo(): boolean {
            throw new Error('Not implemented');
        }
        canRedo(): boolean {
            throw new Error('Not implemented');
        }
    };

    const XOpatHistory = class XOpatHistory {
        _buffer: Array<{ forward: () => any; backward: () => void } | null>;
        _buffidx: number;
        _lastValidIndex: number;
        _providers: HistoryProvider[];
        BUFFER_LENGTH: number;

        constructor(size = 99) {
            this._buffer = [];
            // points to the current state in the redo/undo index in circular buffer
            this._buffidx = -1;
            // points to the most recent object in cache, when undo action comes full loop to _lastValidIndex
            // it means the redo action went full circle on the buffer, and we cannot further undo,
            // if we set this index to buffindex, we throw away ability to redo (diverging future)
            this._lastValidIndex = -1;
            this._providers = [];
            this.BUFFER_LENGTH = size;
        }

        /**
         * Outsource history logics to external API
         * @param {HistoryProvider} provider history api provider
         */
        registerProvider(provider: HistoryProvider) {
            this._providers.push(provider);
        }

        /**
         * Set the number of steps possible to go in the past
         * @param {number} value size of the history
         */
        set size(value: number) {
            this.BUFFER_LENGTH = Math.max(2, value);
        }

        /**
         * Push a new action to the history buffer. The function forward is executed immediately -
         * you must not call this method/logics manually.
         * @param {*} forward function to execute the forward (redo) operation, it is executed once upon call
         * @param {*} backward function to execute the backward (undo) operation
         * @return {any} return value of the forward function executed
         */
        push(forward: () => any, backward: () => void): any {
            if (typeof forward !== 'function' || typeof backward !== 'function') {
                throw new Error("Both forward and backward must be functions.");
            }

            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
            this._buffer[this._buffidx] = { forward, backward };
            this._lastValidIndex = this._buffidx;

            return forward();
        }

        /**
         * Go step back in the history.
         */
        undo() {
            if (!this.canUndo()) return;

            for (let historyProvider of this._providers) {
                if (historyProvider.undo()) return;
            }

            const entry = this._buffer[this._buffidx];
            if (!entry) return;
            entry.backward();
            this._buffidx = (this._buffidx - 1 + this.BUFFER_LENGTH) % this.BUFFER_LENGTH;

            if (this._lastValidIndex === this._buffidx) {
                this._buffer[this._lastValidIndex] = null;

                this._lastValidIndex--;
                if (this._lastValidIndex < 0) this._lastValidIndex = this.BUFFER_LENGTH - 1;
            }
        }

        /**
         * Go step forward in the history.
         */
        redo() {
            if (!this.canRedo()) return;

            for (let historyProvider of this._providers) {
                if (historyProvider.redo()) return;
            }

            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
            const entry = this._buffer[this._buffidx];
            if (!entry) return;
            entry.forward();
        }

        /**
         * Check if undo is possible
         * @return {boolean}
         */
        canUndo() {
            for (let historyProvider of this._providers) {
                if (historyProvider.canUndo()) return true;
            }
            return !!this._buffer[this._buffidx];
        }

        /**
         * Check if redo is possible
         * @return {boolean}
         */
        canRedo() {
            for (let historyProvider of this._providers) {
                if (historyProvider.canRedo()) return true;
            }
            return this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex;
        }
    };
    // TODO collision with window.History 
    window.History = XOpatHistory as unknown as (new () => History) & XOpatHistoryConstructor;

    APPLICATION_CONTEXT.history = new XOpatHistory(APPLICATION_CONTEXT.getOption("historySize", 99));

    // Key event handlers - todo create shortcut manager
    $.extend($.scrollTo.defaults, {axis: 'y'});

    let failCount = new InvertedWeakMap();
    VIEWER_MANAGER.broadcastHandler('tile-load-failed', function(e: TileLoadFailedEvent) {
        if (e.message === "Image load aborted") return;
        let index = e.eventSource.world.getIndexOfItem(e.tiledImage);
        let failed = failCount.get(index) || 0;
        const ti = e.tiledImage as any;
        if (!failed || failed != ti) {
            failCount.set(index, ti);
            ti._failedCount = 1;
        } else {
            let d = e.time - ti._failedDate;
            if (d < 500) {
                ti._failedCount++;
            } else {
                ti._failedCount = 1;
            }
            if (ti._failedCount > 5) {
                ti._failedCount = 1;
                //to-docs
                e.worldIndex = index;
                /**
                 * The Viewer might decide to remove faulty TiledImage automatically.
                 * The removal is not done automatically, but this event is fired.
                 * The owner is recommended to remove the tiled image instance.
                 * @property {TiledImage} e
                 * @memberOf VIEWER
                 * @event tiled-image-problematic
                 */
                e.eventSource.raiseEvent('tiled-image-problematic', e);
            }
        }
        ti._failedDate = e.time;
    });

    if (!APPLICATION_CONTEXT.getOption("preventNavigationShortcuts")) {
        function adjustBounds(speedX: number, speedY: number) {
            let bounds = VIEWER.viewport.getBounds();
            bounds.x += speedX*bounds.width;
            bounds.y += speedY*bounds.height;
            VIEWER.viewport.fitBounds(bounds);
        }
        VIEWER_MANAGER.addHandler('key-up', function(e: KeyboardEvent & { focusCanvas: boolean }) {
            if (e.focusCanvas) {
                if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    let zoom = null,
                        speed = 0.3;
                    switch (e.key) {
                        case "Down": // IE/Edge specific value
                        case "ArrowDown":
                            adjustBounds(0, speed);
                            break;
                        case "Up": // IE/Edge specific value
                        case "ArrowUp":
                            adjustBounds(0, -speed);
                            break;
                        case "Left": // IE/Edge specific value
                        case "ArrowLeft":
                            adjustBounds(-speed, 0);
                            break;
                        case "Right": // IE/Edge specific value
                        case "ArrowRight":
                            adjustBounds(speed, 0);
                            break;
                        case "+":
                            zoom = VIEWER.viewport.getZoom();
                            VIEWER.viewport.zoomTo(zoom + zoom * speed * 3);
                            return;
                        case "-":
                            zoom = VIEWER.viewport.getZoom();
                            VIEWER.viewport.zoomTo(zoom - zoom * speed * 2);
                            return;
                        default:
                            return; // Quit when this doesn't handle the key event.
                    }
                }
                //rotation with alt
                if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    switch (e.key) {
                        case "r":
                        case "R":
                            VIEWER.viewport.setRotation(0);
                            return;
                        case "q":
                        case "Q": // Rotate Left
                            VIEWER.viewport.setRotation(VIEWER.viewport.getRotation() - 90);
                            return;
                        case "e":
                        case "E": // Rotate Right
                            VIEWER.viewport.setRotation(VIEWER.viewport.getRotation() + 90);
                            return;
                        default:
                            return;
                    }
                }
            }

            if (e.key === 'Escape') {
                USER_INTERFACE.Tutorials.hide();
                USER_INTERFACE.DropDown.hide();
            }
        });
    }

    // Tutorials... todo to different file
    const withLayers = () => APPLICATION_CONTEXT.config.visualizations.length > 0;
    window.USER_INTERFACE.Tutorials.add("", $.t('tutorials.basic.title'), $.t('tutorials.basic.description'), "foundation", [
        {'next #viewer-container' : $.t('tutorials.basic.1')
        }, {'next #myMenu-opendiv-navigator' : $.t('tutorials.basic.3')
        }, {'next #myMenu-opendiv-navigator' : $.t('tutorials.basic.4'),
            runIf: function() {return APPLICATION_CONTEXT.config.background.length === 1 && withLayers();}
        }, {'next #tissue-title-header' : $.t('tutorials.basic.4a'),
            runIf: function() {return APPLICATION_CONTEXT.config.background.length === 1 && !withLayers();}
        }, {'next #panel-shaders': $.t('tutorials.basic.9'), runIf: withLayers
        }, {'click #shaders-pin': $.t('tutorials.basic.10'), runIf: withLayers
        }, {'next #shaders': $.t('tutorials.basic.11'), runIf: withLayers
        }, {'next #data-layer-options': $.t('tutorials.basic.12'), runIf: withLayers
        }, {'next #cache-snapshot': $.t('tutorials.basic.13'), runIf: withLayers
        }, {'next #left-side-buttons-menu-b-share' : $.t('tutorials.basic.14')
        }, {'next #left-side-buttons-menu-b-tutorial' : $.t('tutorials.basic.15')}], function() {
        if (withLayers()) {
            //prerequisite - pin in default state
            let pin = $("#shaders-pin");
            let container = pin.parents().eq(1).children().eq(1);
            pin.removeClass('pressed');
            container.removeClass('force-visible');
        }
    });
}

(window as any).initXOpat = initXOpat;