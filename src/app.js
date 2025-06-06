/**
 * @typedef BackgroundItem
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
    const runLoader = initXOpatLoader(PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, VERSION);

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
        AppCache: {
            get() {console.warn("AppCache used before initialization.")},
            set() {console.warn("AppCache used before initialization.")},
        },
        /**
         * Global Application Cookies.
         * @type XOpatStorage.Cookies
         * @memberOf APPLICATION_CONTEXT
         */
        AppCookies: {
            get() {console.warn("AppCookies used before initialization.")},
            set() {console.warn("AppCookies used before initialization.")},
        },
        /**
         * Get sessionName value (fallback refereceId) from the configuration.
         * @return {string|*}
         */
        get sessionName() {
            const config = VIEWER.scalebar.getReferencedTiledImage()?.getBackgroundConfig() || {};
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
        layersAvailable: false,
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
         * @param name;
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
            const bgConfig = VIEWER.scalebar.getReferencedTiledImage()?.getBackgroundConfig();
            if (bgConfig) {
                if (bgConfig.name) return bgConfig.name;
                return UTILITIES.fileNameFromPath(CONFIG.data[bgConfig.dataReference], stripSuffix);
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
                VIEWER.scalebar.getReferencedTiledImage()?.getBackgroundConfig();
            } else {
                config = CONFIG.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex')]
                    || CONFIG.background[0];
            }
            return config ? CONFIG.data[config.dataReference] : "__anonymous__";
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

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./src/error.php?title=${encodeURIComponent('Your browser is not supported.')}
    &description=${encodeURIComponent('ERROR: The visualization requires canvasses in order to work.')}`;
    }

    const headers = $.extend({}, ENV.client.headers, CONFIG.params.headers);
    /**
     * OpenSeadragon Viewer Instance. Note the viewer instance
     * as well as OpenSeadragon namespace can (and is) extended with
     * additional classes and events.
     * todo add type definitions for OSD
     *
     * @namespace VIEWER
     * @type OpenSeadragon.Viewer
     * @see {@link https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html}
     */
    window.VIEWER = OpenSeadragon({
        id: "osd",
        prefixUrl: ENV.openSeadragonPrefix + "images",
        showNavigator: true,
        maxZoomPixelRatio: 2,
        zoomPerClick: 2,
        zoomPerScroll: 1.7,
        blendTime: 0,
        // This is due to annotations (multipolygon brush) that are disabled during animations
        // ease out behavior makes user think they can already start drawing and slows them down
        animationTime: 0,
        showNavigationControl: false,
        navigatorId: "panel-navigator",
        loadTilesWithAjax : true,
        drawer: "canvas",
        ajaxHeaders: headers,
        splitHashDataForPost: true,
        subPixelRoundingForTransparency:
            navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc") ?
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
        debugMode: APPLICATION_CONTEXT.getOption("debugMode", false, false),
        maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount", undefined, false)
    });
    VIEWER.gestureSettingsMouse.clickToZoom = false;
    new OpenSeadragon.Tools(VIEWER);

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
    VIEWER.addHandler('warn-user', e => {
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
    VIEWER.addHandler('error-user', e => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50*e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, -Infinity);
    VIEWER.addHandler('plugin-failed', e => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));
    VIEWER.addHandler('plugin-loaded', e => Dialogs.show($.t('messages.pluginLoadedNamed', {plugin: PLUGINS[e.id].name}), 2500, Dialogs.MSG_INFO));

    let notified = false;
    //todo error? VIEWER.addHandler('tile-load-failed', e => console.log("load filaed", e));
    VIEWER.addHandler('add-item-failed', e => {
        if (notified) return;
        if (e.message && e.message.statusCode) {
            //todo check if the first background
            let title;
            switch (e.message.statusCode) {
                case 401:
                    $("#tissue-title-content").html($.t('main.global.tissue'));
                    Dialogs.show($.t('error.slide.401'),
                        20000, Dialogs.MSG_ERR);
                    XOpatUser.instance().logout(); //todo really logout? maybe request login instead?
                    break;
                case 403:
                    $("#tissue-title-content").html($.t('main.global.tissue'));
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
            console.error('Item failed to load and the event does not contain reliable information to notify user. Notification was bypassed.');
        }
    });


    /*---------------------------------------------------------*/
    /*----------------- MODULE/PLUGIN core API ----------------*/
    /*---------------------------------------------------------*/

    //properties depentend and important to change on bg image load/swap
    //index is the TiledImage index in OSD - usually 0, with stacked bgs the selected background...
    function updateBackgroundChanged(index) {
        //Todo once rewritten, treat always low level item as the reference layer (index == 0)

        //the viewer scales differently-sized layers sich that the biggest rules the visualization
        //this is the largest image layer, or possibly the rendering layers layer
        const tiledImage = VIEWER.world.getItemAt(index);
        const imageData = tiledImage?.getBackgroundConfig() || {};

        const title = $("#tissue-title-header").removeClass('error-container');
        if (Number.isInteger(Number.parseInt(imageData?.dataReference))) {
            const name = imageData.name || UTILITIES.fileNameFromPath(
                APPLICATION_CONTEXT.config.data[imageData.dataReference]
            );
            title.find('#tissue-title-content').html(name);
            title.attr('title', name);
            USER_INTERFACE.toggleDemoPage(false);
        } else if (tiledImage?.source instanceof OpenSeadragon.EmptyTileSource) {
            //todo merge tile sources with layers/background to simplify mapping, now we need to guess where error occurs on error event
            //todo better naming logics
            const name = imageData.name || UTILITIES.fileNameFromPath(
                APPLICATION_CONTEXT.config.data[APPLICATION_CONTEXT.getOption('activeBackgroundIndex')]
                || 'unknown'
            );
            title.addClass('error-container').find('#tissue-title-content').html($.t('main.navigator.faultyTissue', {slide: name}));
            USER_INTERFACE.toggleDemoPage(true);
        } else {
            USER_INTERFACE.toggleDemoPage(false);
        }

        const hasMicrons = !!imageData.microns, hasDimMicrons = !!(imageData.micronsX && imageData.micronsY);
        if (!hasMicrons || !hasDimMicrons) {
            const sourceMeta = typeof tiledImage?.source?.getImageMetaAt === "function" && tiledImage.source.getImageMetaAt();
            if (sourceMeta) {
                if (!hasMicrons) imageData.microns = sourceMeta.microns;
                if (!hasDimMicrons) {
                    imageData.micronsX = sourceMeta.micronsX;
                    imageData.micronsY = sourceMeta.micronsY;
                }
            }
        }

        if (!VIEWER.scalebar) {
            UTILITIES.setImageMeasurements(imageData?.microns, imageData?.micronsX, imageData?.micronsY);
        }
        VIEWER.scalebar.linkReferenceTileSourceIndex(index);
    }

    /**
     * Set current viewer real world measurements. Set undefined values to fallback to pixels.
     * todo rethink namespaces
     * @param microns
     * @param micronsX
     * @param micronsY
     */
    window.UTILITIES.setImageMeasurements = function (microns, micronsX, micronsY) {
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

        VIEWER.makeScalebar({
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
            destroy: !APPLICATION_CONTEXT.getOption("scaleBar", true, false),
            magnification: mag
        });
    };

    let preventedSwap = false;

    /**
     * Change background image if not in stacked mode
     * @param bgIndex
     */
    window.UTILITIES.swapBackgroundImages = function(bgIndex) {
        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            console.error("UTILITIES::swapBackgroundImages not supported in stackedBackground mode!");
            return;
        }
        if (preventedSwap) {
            Dialogs.show($.t('messages.stillLoadingSwap'), 5000, Dialogs.MSG_WARN);
            return;
        }
        let activeBackground = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0, false);
        if (typeof activeBackground === "string") activeBackground = Number.parseInt(activeBackground);
        if (activeBackground === bgIndex) return;
        const image = APPLICATION_CONTEXT.config.background[bgIndex],
            imagePath = APPLICATION_CONTEXT.config.data[image.dataReference],
            sourceUrlMaker = new Function("path,data", "return " +
                (image.protocol || APPLICATION_CONTEXT.env.client.image_group_protocol));

        let prevImage = VIEWER.world.getItemAt(0);
        let url = sourceUrlMaker(APPLICATION_CONTEXT.env.client.image_group_server, imagePath);
        preventedSwap = true;
        VIEWER.addTiledImage({
            tileSource: url,
            index: 0,
            opacity: 1,
            replace: true,
            success: function(e) {
                preventedSwap = false;
                APPLICATION_CONTEXT.setOption('activeBackgroundIndex', bgIndex);
                e.item.getBackgroundConfig = () => APPLICATION_CONTEXT.config.background[bgIndex];
                updateBackgroundChanged(0);
                let previousBackgroundSetup = APPLICATION_CONTEXT.config.background[activeBackground];

                /**
                 * When background image changes (in non-stacked mode), this event fires.
                 * @property {string} backgroundImageUrl - A reference to the World which raised the event.
                 * @property {{}} prevBackgroundSetup - Previous image configuration.
                 * @property {{}} backgroundSetup - New image configuration.
                 * @property {OpenSeadragon.TiledImage} previousTiledImage - Old, Replaced TiledImage
                 * @property {OpenSeadragon.TiledImage} tiledImage - New TiledImage
                 *
                 * @memberOf VIEWER
                 * @event background-image-swap
                 */
                VIEWER.raiseEvent('background-image-swap', {
                    backgroundImageUrl: url,
                    prevBackgroundSetup: previousBackgroundSetup,
                    backgroundSetup: image,
                    previousTiledImage: prevImage,
                    tiledImage: e.item,
                });
                let container = document.getElementById('tissue-preview-container');
                container.children[activeBackground].classList.remove('selected');
                container.children[bgIndex].classList.add('selected');
            },
            error: function(e) {
                preventedSwap = false;
                console.error("Swap Images Failure", e);
                let container = document.getElementById('tissue-preview-container');
                Dialogs.show($.t('messages.swapImagesFail'), 5000, Dialogs.MSG_ERR);
                container.children[bgIndex].classList.remove('selected');
                container.children[activeBackground].classList.add('selected');
            }
        });
    };

    //initialization of UI and handling of background image load errors
    let reopenCounter = -1;
    function handleSyntheticOpenEvent() {
        reopenCounter += 1; //so that immediately the value is set

        let confData = APPLICATION_CONTEXT.config.data,
            confBackground = APPLICATION_CONTEXT.config.background;

        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            let i = 0, selectedImageLayer = 0;
            let imageOpts = [];
            let largestWidth = -1,
                imageNode = $("#image-layer-options");
            //image-layer-options can be missing --> populate menu only if exists
            if (imageNode) {
                for (let idx = confBackground.length - 1; idx >= 0; idx-- ) {
                    const image = confBackground[idx],
                        worldItem =  VIEWER.world.getItemAt(i),
                        configGetter = worldItem?.getBackgroundConfig,
                        referencedImage = configGetter && configGetter();

                    if (image == referencedImage) {
                        //todo not very flexible...
                        if (image.hasOwnProperty("lossless") && image.lossless) {
                            worldItem.source.fileFormat = "png";
                        }
                        let width = worldItem.getContentSize().x;
                        if (width > largestWidth) {
                            largestWidth = width;
                            selectedImageLayer = i;
                        }
                        imageOpts.push(`
    <div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" checked class="form-control"
    onchange="VIEWER.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);" style="margin: 5px;">
    <span class="pr-1" style="color: var(--color-text-tertiary)">${$.t('common.Image')}</span>
    ${image.name ? image.name : UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
    max="1" value="${worldItem.getOpacity()}" step="0.1" onchange="VIEWER.world.getItemAt(${i}).setOpacity(Number.parseFloat(this.value));" style="width: 100%;"></div>`);
                        i++;
                    } else {
                        imageOpts.push(`
    <div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" disabled class="form-control" style="margin: 5px;">
    <span class="pr-1" style="color: var(--color-text-danger)">${$.t('common.Faulty')}</span>
    ${image.name ? image.name : UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
    max="1" value="0" step="0.1" style="width: 100%;" disabled></div>`);
                    }
                }
            }
            imageOpts.push(`<div class="inner-panel-content noselect" id="inner-panel-content-1">
            <div>
                 <span id="images-pin" class="material-icons btn-pointer inline-arrow" onclick="USER_INTERFACE.MainMenu.clickHeader($(this), $(this).parents().eq(1).children().eq(1));" style="padding: 0;"> navigate_next </span>
                 <h3 class="d-inline-block btn-pointer" onclick="USER_INTERFACE.MainMenu.clickHeader($(this.previousElementSibling), $(this).parents().eq(1).children().eq(1));">Images</h3>
            </div>
            <div id="image-layer-options" class="inner-panel-hidden">`);
            imageOpts = imageOpts.reverse();
            imageOpts.push("</div></div>");
            $("#panel-images").html(imageOpts.join("")).css('display', 'block');

            $("#global-tissue-visibility").css("display", "none");

            if (largestWidth === -1) {
                VIEWER.addTiledImage({
                    tileSource : new OpenSeadragon.EmptyTileSource({height: 20000, width: 20000, tileSize: 512}),
                    index: 0,
                    opacity: $("#global-opacity input").val(),
                    replace: false,
                    success: (event) => {
                        event.item.getBackgroundConfig = () => {
                            return undefined;
                        }
                        //standard
                        handleSyntheticEventFinishWithValidData(0, 1);
                    }
                });
            } else {
                handleSyntheticEventFinishWithValidData(selectedImageLayer, i);
            }
            return;
        }


        const activeIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0, false);
        if (confBackground.length > 1) {
            let html = "";
            for (let idx = 0; idx < confBackground.length; idx++ ) {
                const image = confBackground[idx],
                    imagePath = confData[image.dataReference];

                if (APPLICATION_CONTEXT.secure) delete image.protocolPreview;

                const eventArgs = {
                    server: APPLICATION_CONTEXT.env.client.image_group_server,
                    usesCustomProtocol: !!image.protocolPreview,
                    image: imagePath,
                    imagePreview: null,
                };

                //todo potentially buggy - someone might override preview when `protocolPreview` would do otherwise
                VIEWER.tools.raiseAwaitEvent(VIEWER,'get-preview-url', eventArgs).then(() => {
                    let blobUrl;
                    if (!eventArgs.imagePreview) {
                        const previewUrlmaker = new Function("path,data", "return " +
                            (image.protocolPreview || APPLICATION_CONTEXT.env.client.image_group_preview));
                        eventArgs.imagePreview = previewUrlmaker(eventArgs.server, imagePath);
                    } else if (typeof eventArgs.imagePreview !== "string") {
                        //treat as blob
                        blobUrl = eventArgs.imagePreview = URL.createObjectURL(eventArgs.imagePreview);
                    }

                    const img = new Image();
                    img.onload = () => {
                        let child = img;
                        if (img.width < img.height) {
                            child = document.createElement("canvas"),
                                context = child.getContext("2d");
                            child.width = img.height;
                            child.height = img.width;
                            context.setTransform(0,-1, 1,0, 0, child.width/2);
                            context.drawImage(img, 0, 0);
                        }
                        child.style.width = '180px';
                        $(`#tissue-preview-item-${idx}`).append(child);
                        if (blobUrl) URL.revokeObjectURL(blobUrl);
                    };
                    img.onerror = img.onabort = () => {
                        //todo some error image?
                        if (blobUrl) URL.revokeObjectURL(blobUrl);
                    };
                    img.src = eventArgs.imagePreview;
                });

                html += `
    <div id="tissue-preview-item-${idx}" onclick="UTILITIES.swapBackgroundImages(${idx});"
    class="${activeIndex == idx ? 'selected' : ''} pointer position-relative mx-2 my-2 color-bg-canvas overflow-hidden" 
    style="width: 180px; height: 90px; border-bottom: 1px solid var(--color-bg-backdrop); border-radius: 21px;">
    <span class="tissue-label">${image.name ? image.name : UTILITIES.fileNameFromPath(confData[image.dataReference])}</span>
</div>`;
            }

            $("#panel-images").html(`<div id="tissue-preview-container">${html}</div>`);
        } else {
            $("#panel-images").html("").css('display', 'none');
        }

        if (confBackground.length > 0) {
            $("#global-tissue-visibility").css("display", "initial");

            const image = confBackground[activeIndex],
                worldItem =  VIEWER.world.getItemAt(0),
                configGetter = worldItem?.getBackgroundConfig,
                referencedImage = configGetter && configGetter();

            if (image != referencedImage) {
                const dimensions = worldItem?.getContentSize();
                VIEWER.addTiledImage({
                    tileSource : new OpenSeadragon.EmptyTileSource({
                        height: dimensions?.y || 20000,
                        width: dimensions?.x || 20000,
                        tileSize: 512 //can be arbitrary, 512 works well...
                    }),
                    index: 0,
                    opacity: $("#global-opacity input").val(),
                    replace: false,
                    success: (event) => {
                        event.item.getBackgroundConfig = () => {
                            return undefined;
                        }
                        //standard
                        handleSyntheticEventFinishWithValidData(0, 1);
                    }
                });

                return;
            } else {
                //todo not very flexible...
                if (image.hasOwnProperty("lossless") && image.lossless && worldItem) {
                    worldItem.source.fileFormat = "png";
                }
            }
            handleSyntheticEventFinishWithValidData(0, 1);
        } else {
            // We can leave it here, it shows default white image..
            VIEWER.addTiledImage({
                tileSource : new OpenSeadragon.EmptyTileSource({height: 20000, width: 20000, tileSize: 512}),
                index: 0,
                opacity: $("#global-opacity input").val(),
                replace: false,
                success: (event) => {
                    event.item.getBackgroundConfig = () => {
                        return undefined;
                    }
                    //standard
                    handleSyntheticEventFinishWithValidData(0, 1);
                }
            });
            //handleSyntheticEventFinishWithValidData(-1, 0);
        }
    }

    function handleSyntheticEventFinishWithValidData(referenceImage, layerPosition) {
        updateBackgroundChanged(referenceImage);

        const eventOpts = {};


        const seaGL = VIEWER.bridge;
        if (APPLICATION_CONTEXT.config.visualizations.length > 0 && seaGL) {
            const layerWorldItem = VIEWER.world.getItemAt(layerPosition);
            const activeVis = seaGL.visualization();
            if (layerWorldItem) {
                UTILITIES.prepareTiledImage(layerPosition,
                    layerWorldItem, activeVis);

                $("#panel-shaders").css('display', 'block');
                seaGL.initAfterOpen();
            } else {
                //todo action page reload
                Dialogs.show($.t('messages.visualizationDisabled', {name: activeVis.name}), 20000, Dialogs.MSG_ERR);

                $("#panel-shaders").css('display', 'none');

                APPLICATION_CONTEXT.disableVisualization();
                eventOpts.error = $.t('messages.overlaysDisabled');
            }
        }
        handleSyntheticEventFinish(eventOpts);
    }

    let loadTooLongTimeout = null;
    //fired when all TiledImages are on their respective places
    function handleSyntheticEventFinish(opts={}) {

        if (reopenCounter === 0) {

            runLoader();

            let focus = APPLICATION_CONTEXT.getOption("viewport");
            if (focus && focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
                window.VIEWER.viewport.panTo({x: Number.parseFloat(focus.point.x), y: Number.parseFloat(focus.point.y)}, true);
                window.VIEWER.viewport.zoomTo(Number.parseFloat(focus.zoomLevel), null, true);
            }

            if (window.innerHeight < 630 || window.innerWidth < 900) {
                if (window.innerWidth >= 900) {
                    $('#navigator-pin').click();
                }
                USER_INTERFACE.MainMenu.close();
            }

            window.onerror = null;

            try {
                if (window.opener && window.opener.VIEWER) {
                    VIEWER.tools.link( window.opener.VIEWER);
                }
            } catch (e) {
                //pass opener access can throw exception - not available to us
            }

            const firstTimeVisit = APPLICATION_CONTEXT.AppCookies.get("_shadersPin",
                APPLICATION_CONTEXT.getOption("bypassCookies") ? false : null) === null;
            if (!USER_INTERFACE.Errors.active && firstTimeVisit) {
                setTimeout(() => {
                    USER_INTERFACE.Tutorials.show($.t('messages.pluginsWelcome'),
                        $.t('messages.pluginsWelcomeDescription', {tutorial: $.t('tutorials.basic.title')})
                    );
                }, 2000);
            }
        }

        if (USER_INTERFACE.Errors.active) {
            $("#viewer-container").addClass("disabled"); //preventive
        }

        //todo INHERITS OpenSeadragon todo comment - check for API changes in open event in future
        opts.source = VIEWER.world.getItemAt(0)?.source;
        opts.reopenCounter = reopenCounter;
        /**
         * Manual OpenSeadragon open event firing, see OpenSeadragon.Viewer#open
         * It is guaranteed to be called upon app start.
         * @memberOf VIEWER
         * @event open
         */
        VIEWER.raiseEvent('open', opts);
        USER_INTERFACE.Loading.show(false);
        if (loadTooLongTimeout) clearTimeout(loadTooLongTimeout);

        //todo make sure bypassCache and bypassCookies is set to true if this option is true - temporarily
        APPLICATION_CONTEXT.setOption("bypassCacheLoadTime", false);
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

            USER_INTERFACE.AdvancedMenu._build();
            USER_INTERFACE.MainMenu._sync();

            /**
             * First loading of the viewer from a clean state.
             * @memberOf VIEWER
             * @event before-first-open
             */
            await VIEWER.tools.raiseAwaitEvent(VIEWER,'before-first-open', {
                data, background, visualizations, fromLocalStorage: !!CONFIG.__fromLocalStorage
            }).catch(e =>
                {
                    //todo something meaningful
                    console.error(e);
                }
            );
            this.openViewerWith(data, background, visualizations || []);
        } catch (e) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show($.t('error.unknown'), `${$.t('error.reachUs')} <br><code>${e}</code>`, true);
            console.error(e);
        }
    };

    let _allowRecursionReload = true;
    /**
     * Open desired configuration on the current viewer
     * @param data
     * @param background
     * @param visualizations
     */
    APPLICATION_CONTEXT.openViewerWith = function (
        data,
        background,
        visualizations=[],
    ) {
        USER_INTERFACE.Loading.show(true);
        VIEWER.close();

        const isSecureMode = APPLICATION_CONTEXT.secure;
        let renderingWithWebGL = visualizations?.length > 0;
        if (renderingWithWebGL) {
            if (_allowRecursionReload && !window.WebGLModule) {
                _allowRecursionReload = false;
                UTILITIES.loadModules(() => APPLICATION_CONTEXT.openViewerWith(data, background, visualizations), "webgl");
                return;
            }

            if (!window.WebGLModule) {
                console.error("Recursion prevented: webgl module failed to load!");
                //allow to continue...
                Dialogs.show($.t('messages.overlaysLoadFail'), 8000, Dialogs.MSG_ERR);
                renderingWithWebGL = false;
            }
        }
        loadTooLongTimeout = setTimeout(() => Dialogs.show($.t('error.slide.pending'), 15000, Dialogs.MSG_WARN), 8000);

        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
        config.data = data;
        config.background = background;
        config.visualizations = visualizations;

        if (reopenCounter > 0) {
            APPLICATION_CONTEXT.disableVisualization();
        } else {
            /**
             * Fired before visualization is initialized and loaded.
             * @memberOf VIEWER
             * @event before-canvas-reload
             */
            VIEWER.raiseEvent('before-canvas-reload');
        }

        const toOpen = [];
        const opacity = Number.parseFloat($("global-opacity").val()) || 1;
        let openedSources = 0;
        const handleFinishOpenImageEvent = (item, url, index) => {
            openedSources--;
            if (item) {
                /**
                 * Fired before visualization is initialized and loaded.
                 * @event tiled-image-created
                 * @memberOf VIEWER
                 * @property {OpenSeadragon.TiledImage} item
                 * @property {string} url used to create the item
                 * @property {number} index TiledImage index
                 */
                VIEWER.raiseEvent('tiled-image-created', {item, url, index});
            }
            if (openedSources <= 0) handleSyntheticOpenEvent();
        };
        let imageOpenerCreator = (success, userArg=undefined) => {
            return (toOpenLastBgIndex, source, toOpenIndex) => {
                openedSources++;
                window.VIEWER.addTiledImage({
                    tileSource: source,
                    opacity: opacity,
                    success: (event) => {
                        success({userArg, toOpenLastBgIndex, toOpenIndex, event});
                        handleFinishOpenImageEvent(event.item, source, toOpenIndex);
                    },
                    error: () => {
                        handleFinishOpenImageEvent();
                    }
                });
            }
        };

        let imageOpener; //has to set-up correct getBackgroundConfig function
        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            //reverse order: last opened IMAGE is the first visible
            for (let i = background.length-1; i >= 0; i--) {
                const bg = background[i];
                if (isSecureMode) delete bg.protocol;
                const urlmaker = new Function("path,data", "return " + (bg.protocol || APPLICATION_CONTEXT.env.client.image_group_protocol));
                toOpen.push(urlmaker(APPLICATION_CONTEXT.env.client.image_group_server, data[bg.dataReference]));
            }

            imageOpener = imageOpenerCreator(e => {
                const index = e.toOpenLastBgIndex - e.toOpenIndex; //reverse order in toOpen
                e.event.item.getBackgroundConfig = () => {
                    return APPLICATION_CONTEXT.config.background[index];
                };
            });
        } else if (background.length > 0) {
            const selectedIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0, false);
            let selectedImage = background[selectedIndex];
            if (isSecureMode) delete selectedImage.protocol;
            const urlmaker = new Function("path,data", "return " + (selectedImage.protocol || APPLICATION_CONTEXT.env.client.image_group_protocol));
            toOpen.push(urlmaker(APPLICATION_CONTEXT.env.client.image_group_server, data[selectedImage.dataReference]));

            imageOpener = imageOpenerCreator(e => {
                const index = e.userArg;
                e.event.item.getBackgroundConfig = () => {
                    return APPLICATION_CONTEXT.config.background[index];
                };
            }, selectedIndex);
        }

        const openAll = (numOfVisLayersAtTheEnd) => {
            if (toOpen.length < 1) {
                // //todo two places where we need to remove loading screen make clear flow of the initialization!
                // USER_INTERFACE.Loading.show(false);
                // if (loadTooLongTimeout) clearTimeout(loadTooLongTimeout);
                // USER_INTERFACE.Errors.show($.t('error.nothingToRender'), $.t('error.nothingToRenderDetails'), true);
                //
                handleFinishOpenImageEvent();
                return;
            }

            let i = 0;
            let lastValidBgIndex = toOpen.length - numOfVisLayersAtTheEnd - 1;
            for (; i <= lastValidBgIndex; i++) imageOpener(lastValidBgIndex, toOpen[i], i);

            const visOpener = imageOpenerCreator(()=>{});
            for (; i < toOpen.length; i++) visOpener(toOpen.length - 1, toOpen[i], i);
        }

        if (renderingWithWebGL) {
            try {
                UTILITIES.testRendering();
            } catch (e) {
                console.error(e);
                USER_INTERFACE.Errors.show($.t('error.renderTitle'), `${$.t('error.renderDesc')} <br><code>${e}</code>`, true);
            }

            //prepare rendering can disable layers
            APPLICATION_CONTEXT.prepareRendering();
            renderingWithWebGL = APPLICATION_CONTEXT.layersAvailable;
        }

        if (renderingWithWebGL) {
            APPLICATION_CONTEXT.prepareRendering();

            let activeVisIndex = Number.parseInt(APPLICATION_CONTEXT.getOption("activeVisualizationIndex"));
            if (!APPLICATION_CONTEXT.getOption("stackedBackground")) {
                // binding background config overrides active visualization, only if not in stacked mode
                const activeBackgroundSetup = config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0, false)],
                    defaultIndex = Number.parseInt(activeBackgroundSetup?.goalIndex);

                if (defaultIndex >= 0 && defaultIndex < config.visualizations.length) {
                    activeVisIndex = defaultIndex;
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", activeVisIndex);
                }
            }

            VIEWER.bridge.loadShaders(
                activeVisIndex,
                function() {
                    VIEWER.bridge.createUrlMaker(VIEWER.bridge.visualization(), isSecureMode);
                    //const async = APPLICATION_CONTEXT.getOption("fetchAsync");
                    let data = VIEWER.bridge.dataImageSources();
                    //if (async && data.length > 0) data = data[0];
                    toOpen.push(VIEWER.bridge.urlMaker(APPLICATION_CONTEXT.env.client.data_group_server, data));
                    openAll(1);
                }
            );
        } else {
            openAll(0);
        }
    }

    // Initialize middleware before we run scripts initialization
    APPLICATION_CONTEXT.AppCache = new XOpatStorage.Cache({id: ""});
    APPLICATION_CONTEXT.AppCookies = new XOpatStorage.Cookies({id: ""});

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
