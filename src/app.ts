import type { TileLoadFailedEvent } from "openseadragon";
import { BackgroundConfig } from "./classes/background-config";
import { HttpClient } from "./classes/http-client";
import { initXOpatLoader } from "./loader";
import { InvertedWeakMap } from "./external/data-structures";
import { ScriptingManager } from "./classes/scripting-manager";
import { XOpatHistory } from "./classes/history";
import { ViewerOpenPipeline } from "./classes/app/viewer-open-pipeline";
import { ViewerStateBindingController } from "./classes/app/viewer-state-binding-controller";
import { ViewerVisualizationRuntime } from "./classes/app/viewer-visualization-runtime";
import { ViewerInspectorController } from "./classes/app/viewer-inspector-controller";
import { ApplicationLifecycleController } from "./classes/app/application-lifecycle-controller";
import { SessionSyncController } from "./classes/session/session-sync";
// Side-effect import: registers `window.PLAYGROUND` so `requireVisualizationReview` can open
// the Visualization Playground for script-driven mutations. Without this import the playground
// never wires up and visualization mutations fall back to a plain yes/no consent dialog.
import "./classes/playground/playground-service";

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
export function initXOpat(PLUGINS: Record<string, XOpatElementItem>, MODULES: Record<string, XOpatElementItem>, ENV: XOpatCoreConfig, POST_DATA: Record<string, unknown>, PLUGINS_FOLDER: string, MODULES_FOLDER: string, VERSION: string, I18NCONFIG: Record<string, unknown> = {}) {
    const savedState = ApplicationLifecycleController.restoreLocalState();
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
    POST_DATA = xOpatParseConfiguration(POST_DATA, $.i18n, ENV.server.supportsPost) as Record<string, unknown>;
    let CONFIG = POST_DATA.visualization as XOpatRuntimeConfig;
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
    const rawParams = (CONFIG.params || {}) as Record<string, unknown>;
    const allowedParamNames = Object.keys(defaultSetup) as Array<keyof XOpatSetup>;
    const sanitizedParams = {} as XOpatSetup;
    const droppedParamNames: string[] = [];
    for (const [name, value] of Object.entries(rawParams)) {
        if (Object.prototype.hasOwnProperty.call(defaultSetup, name)) {
            (sanitizedParams as Record<string, unknown>)[name] = value;
        } else {
            droppedParamNames.push(name);
        }
    }
    if (droppedParamNames.length) {
        console.warn(
            `Ignoring unsupported viewer parameters: ${droppedParamNames.join(", ")}. ` +
            `Only these viewer parameters are allowed: ${allowedParamNames.join(", ")}.`
        );
    }
    CONFIG.params = sanitizedParams;
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

    if (ENV.server.devMode) {
        APPLICATION_CONTEXT.setOption("debugMode", true);
    }

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

    // todo make sure our globals dont get out of hand...
    (window as any).LAYOUT = new UI.MainLayout({
        id: "viewer-container",
        position: "right",
        initialWidth: 360,
        maxWidth:  APPLICATION_CONTEXT.getOption("globalMenuMaxWidth", undefined, false, true),
        collapseBreakpointPx: APPLICATION_CONTEXT.getOption("maxMobileWidthPx", undefined, false, true),
        toolbarEmbeddingWide: false,
        toolbarEmbeddingPosition: "below",
    });
    // Attach once (replaces your static HTML wrapper)
    (window as any).LAYOUT.attachTo(document.getElementById("middle-container"));


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
     * Live-collaboration session singleton. See src/SESSION.md.
     * Instantiated here so providers can lazily reach VIEWER_MANAGER
     * once they subscribe (i.e. once a session actually starts).
     */
    window.SESSION = new SessionSyncController();
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
                // single bg: preserve an explicit cleared selection (`[undefined]`)
                // so callers can distinguish "show none" from "leave unchanged".
                if (norm.length > 0) return [norm[0]];
                return undefined;
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

        const normalizeStoredBackgroundSelection = (value: any): number[] | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                const filtered = value
                    .map((v: any) => clampIndex(v, backgrounds.length))
                    .filter((v: any) => Number.isInteger(v));
                return filtered.length > 0 ? filtered : undefined;
            }
            const normalized = clampIndex(value, backgrounds.length);
            return normalized === undefined ? undefined : [normalized];
        };

        const normalizeStoredVisualizationSelection = (value: any): Array<number | undefined> | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                return value.map((v: any) => clampIndex(v, vizCount));
            }
            const normalized = clampIndex(value, vizCount);
            return normalized === undefined ? undefined : [normalized];
        };

        let updated = false;

        // ---------- Handle bgSpec (null => erase; undefined => keep; value => set) ----------
        let effectiveBg = normalizeStoredBackgroundSelection(
            APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
        );
        if (bgSpec === null) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", undefined);
            updated = true;
            effectiveBg = undefined;
        } else if (bgSpec !== undefined) {
            const newActiveBg = selectBackgroundIndices(bgSpec, backgrounds.length);
            const normalizedActiveBg = normalizeStoredBackgroundSelection(newActiveBg);
            const prevActiveBg = normalizeStoredBackgroundSelection(
                APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
            );
            if (JSON.stringify(prevActiveBg) !== JSON.stringify(normalizedActiveBg)) {
                APPLICATION_CONTEXT.setOption("activeBackgroundIndex", normalizedActiveBg);
                updated = true;
            }
            effectiveBg = normalizedActiveBg;
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
            const prevActiveVis = normalizeStoredVisualizationSelection(
                APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
            );
            if (prevActiveVis !== undefined) {
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", undefined);
                updated = true;
            }
            selectedBgArray.forEach((bgIdx) => {
                const b = backgrounds[bgIdx];
                if (!b) return;
                if (b.goalIndex !== undefined) {
                    b.goalIndex = undefined;
                    updated = true;
                }
            });
        } else {
            // When derive flag is ON, derive overlays from per-background goalIndex,
            // regardless of whether vizSpec is provided or undefined.
            let desiredActiveVis: undefined | (number | undefined)[] | number;
            if (deriveOverlayFromBackgroundGoals) {
                desiredActiveVis = deriveVisFromGoals(bgIndicesForViz);
            } else if (vizSpec !== undefined) {
                desiredActiveVis = buildVis(vizSpec, bgIndicesForViz);
            } // else: vizSpec === undefined and derive flag is false => keep existing option

            if (typeof desiredActiveVis !== "undefined") {
                const normalizedActiveVis = normalizeStoredVisualizationSelection(desiredActiveVis);
                const prevActiveVis = normalizeStoredVisualizationSelection(
                    APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
                );
                if (JSON.stringify(prevActiveVis) !== JSON.stringify(normalizedActiveVis)) {
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", normalizedActiveVis);
                    updated = true;
                }
                desiredActiveVis = normalizedActiveVis;

                // Persist per-background goalIndex when we have a concrete desiredActiveVis
                if (selectedBgArray.length > 0) {
                    if (Array.isArray(desiredActiveVis)) {
                        selectedBgArray.forEach((bgIdx, i) => {
                            const ov = (desiredActiveVis as Array<number>)[i];
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

    const cloneRuntimeState = <T>(value: T): T => {
        if (value === undefined || value === null) {
            return value;
        }

        try {
            return JSON.parse(safeStringify(value));
        } catch (e) {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (e2) {
                return value;
            }
        }
    };

    const installDebugStats = () => {
        if (!APPLICATION_CONTEXT.getOption("debugMode")) {
            return;
        }
        (function () { var script = document.createElement('script'); script.onload = function () { var stats = new (window as any).Stats(); document.body.appendChild(stats.dom); stats.showPanel(1); stats.dom.style.top = '35px'; stats.dom.style.zIndex = '99'; requestAnimationFrame(function loop() { stats.update(); requestAnimationFrame(loop) }); }; script.src = APPLICATION_CONTEXT.url + 'src/external/stats.js'; document.head.appendChild(script); })();
    };

    const applicationLifecycle = new ApplicationLifecycleController(
        APPLICATION_CONTEXT,
        cloneRuntimeState
    );
    const viewerInspector = new ViewerInspectorController(
        APPLICATION_CONTEXT,
        () => APPLICATION_CONTEXT._dangerouslyAccessConfig()
    );
    viewerInspector.registerViewerHooks(VIEWER_MANAGER);
    viewerInspector.registerUtilities();

    APPLICATION_CONTEXT.beginApplicationLifecycle = async function (
        data,
        background: BackgroundItem[] | BackgroundConfig[] | undefined,
        visualizations: VisualizationItem[] | undefined = undefined
    ) {
        await applicationLifecycle.beginApplicationLifecycle(data, background, visualizations, initXOpatLayers, PLUGINS);
        installDebugStats();
    };

    APPLICATION_CONTEXT.replaceVisualizations = async function (
        visualizations: VisualizationItem[],
        newData: DataID[] = [],
        activeVizIndex: number | number[] | undefined = undefined
    ) {
        return applicationLifecycle.replaceVisualizationSet(visualizations, newData, activeVizIndex);
    };

    APPLICATION_CONTEXT.updateVisualization = async function (
        visualizations: VisualizationItem[],
        newData: DataID[] = [],
        activeVizIndex: number | number[] | undefined = undefined
    ) {
        return applicationLifecycle.replaceVisualizationSet(visualizations, newData, activeVizIndex);
    };

    const visualizationRuntime = new ViewerVisualizationRuntime(APPLICATION_CONTEXT);
    const viewerStateBindings = new ViewerStateBindingController(APPLICATION_CONTEXT);
    const viewerOpenPipeline = new ViewerOpenPipeline({
        appContext: APPLICATION_CONTEXT,
        env: APPLICATION_CONTEXT.env,
        viewerManager: VIEWER_MANAGER,
        getConfig: () => APPLICATION_CONTEXT._dangerouslyAccessConfig(),
        cloneRuntimeState,
        safeStringify,
        runLoaderOnce: () => {
            if (runLoader) {
                runLoader();
                runLoader = null;
            }
        },
        visualizationRuntime,
        stateBindings: viewerStateBindings,
    });

    APPLICATION_CONTEXT.openViewerWith = async function (
        data = undefined,
        background: BackgroundItem[] | undefined = undefined,
        visualizations: VisualizationItem[] | undefined = undefined,
        bgSpec: number | number[] | undefined | null = undefined,
        vizSpec: number | number[] | undefined | null = undefined,
        opts = {}
    ) {
        return viewerOpenPipeline.openViewerWith(data, background, visualizations, bgSpec, vizSpec, opts);
    };

    APPLICATION_CONTEXT.updateViewerSelection = async function (
        viewerIndex: number,
        selection: {
            backgroundIndex?: number | null;
            visualizationIndex?: number | null;
        },
        opts = {}
    ) {
        return viewerOpenPipeline.updateViewerSelection(viewerIndex, selection, opts);
    };

    // Refresh Page & Storage state are defined here since we have reference to the incoming config
    UTILITIES.storePageState = function (includedPluginsList: Record<string, any> | undefined = undefined) {
        try {
            // Add plugin definition to CONFIG, which is part of POST_DATA entry. Do not change anything if not requested.
            if (includedPluginsList) {
                const pluginRefs = CONFIG.plugins || {};
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

    APPLICATION_CONTEXT.history = new XOpatHistory(APPLICATION_CONTEXT.getOption("historySize", 99));

    // Key event handlers - todo create shortcut manager
    $.extend($.scrollTo.defaults, { axis: 'y' });

    let failCount = new InvertedWeakMap();
    VIEWER_MANAGER.broadcastHandler('tile-load-failed', function (e: TileLoadFailedEvent) {
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
            bounds.x += speedX * bounds.width;
            bounds.y += speedY * bounds.height;
            VIEWER.viewport.fitBounds(bounds);
        }

        function isEditableTarget(target: EventTarget | null) {
            const el = target instanceof HTMLElement ? target : document.activeElement;
            return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
                el instanceof HTMLSelectElement || (el as any).isContentEditable);
        }

        VIEWER_MANAGER.addHandler('key-up', function (e: KeyboardEvent & { focusCanvas: boolean }) {
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
                            e.preventDefault();
                            return;
                        case "q":
                        case "Q": // Rotate Left
                            VIEWER.viewport.setRotation(VIEWER.viewport.getRotation() - 90);
                            e.preventDefault();
                            return;
                        case "e":
                        case "E": // Rotate Right
                            VIEWER.viewport.setRotation(VIEWER.viewport.getRotation() + 90);
                            e.preventDefault();
                            return;
                        default:
                            return;
                    }
                }
            }

            if (e.ctrlKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
                if (isEditableTarget(e.target)) return;
                e.preventDefault();

                return e.shiftKey ? APPLICATION_CONTEXT.history.redo() : APPLICATION_CONTEXT.history.undo();
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
        {
            'next #viewer-container': $.t('tutorials.basic.1')
        }, {
            'next #myMenu-opendiv-navigator': $.t('tutorials.basic.3')
        }, {
            'next #myMenu-opendiv-navigator': $.t('tutorials.basic.4'),
            runIf: function () { return APPLICATION_CONTEXT.config.background.length === 1 && withLayers(); }
        }, {
            'next #tissue-title-header': $.t('tutorials.basic.4a'),
            runIf: function () { return APPLICATION_CONTEXT.config.background.length === 1 && !withLayers(); }
        }, {
            'next #panel-shaders': $.t('tutorials.basic.9'), runIf: withLayers
        }, {
            'click #shaders-pin': $.t('tutorials.basic.10'), runIf: withLayers
        }, {
            'next #shaders': $.t('tutorials.basic.11'), runIf: withLayers
        }, {
            'next #data-layer-options': $.t('tutorials.basic.12'), runIf: withLayers
        }, {
            'next #cache-snapshot': $.t('tutorials.basic.13'), runIf: withLayers
        }, {
            'next #left-side-buttons-menu-b-share': $.t('tutorials.basic.14')
        }, { 'next #left-side-buttons-menu-b-tutorial': $.t('tutorials.basic.15') }], function () {
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
