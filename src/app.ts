import type { TileLoadFailedEvent } from "openseadragon";
import { BackgroundConfig } from "./classes/background-config";
import { initXOpatLoader } from "./loader";
import { InvertedWeakMap } from "./external/data-structures";
import { XOpatHistory } from "./classes/history";
import { bootstrapVisualizationHistory } from "./classes/visualization-history";
import { ViewerOpenPipeline } from "./classes/app/viewer-open-pipeline";
import { ViewerStateBindingController } from "./classes/app/viewer-state-binding-controller";
import { ViewerVisualizationRuntime } from "./classes/app/viewer-visualization-runtime";
import { ViewerInspectorController } from "./classes/app/viewer-inspector-controller";
import { ApplicationLifecycleController } from "./classes/app/application-lifecycle-controller";
import { SessionSyncController } from "./classes/session/session-sync";
import { bootstrapIOPipeline } from "./classes/io/bootstrap";
import { bootstrapSlideProtocols } from "./classes/slide-protocols";
import { createApplicationContext } from "./classes/app/application-context";
import { installScalebarUtilities } from "./classes/app/scalebar-utilities";
import { wireViewerErrorHandlers } from "./classes/app/viewer-error-wiring";
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

    // Configure js-cookie attributes before the IO pipeline's `cookies` KV
    // driver reads `globalThis.Cookies`. If js-cookie is unavailable the
    // driver falls back to in-memory storage.
    if (window.Cookies) {
        Cookies.withAttributes({
            path: ENV.client.js_cookie_path,
            domain: ENV.client.js_cookie_domain || ENV.client.domain,
            expires: ENV.client.js_cookie_expire,
            sameSite: ENV.client.js_cookie_same_site,
            secure: typeof ENV.client.js_cookie_secure === "boolean" ? ENV.client.js_cookie_secure : undefined
        });
        Cookies.remove("test");
    } else {
        console.warn("Cookie.js seems to be blocked. The `cookies` KV driver will fall back to in-memory storage.");
    }

    // Bootstrap the generic IO pipeline before APPLICATION_CONTEXT is built —
    // AppCache/AppCookies façades resolve through `window.IO_PIPELINE` on first
    // use, so the pipeline must exist before any `getOption()` call.
    const IO_PIPELINE = bootstrapIOPipeline(ENV, POST_DATA);

    // Bootstrap the slide-protocol registry. Must precede plugin script eval
    // (which happens later in `initXOpatLoader`) so plugins can register
    // factory protocols (e.g. DICOMWebTileSource) in their constructors.
    bootstrapSlideProtocols(ENV);

    /**
     * @namespace APPLICATION_CONTEXT
     */
    window.APPLICATION_CONTEXT = createApplicationContext({
        ENV,
        CONFIG,
        PLUGINS,
        sessionName: sessionName as string | undefined,
        viewerSecureMode,
        defaultSetup,
        ioPipeline: IO_PIPELINE,
    });
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
    let runLoader: (() => Promise<void> | void) | null = initXOpatLoader(ENV, PLUGINS, MODULES, PLUGINS_FOLDER, MODULES_FOLDER, POST_DATA, VERSION);

    if (ENV.server.devMode) {
        APPLICATION_CONTEXT.setOption("debugMode", true);
    }

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

    wireViewerErrorHandlers(VIEWER_MANAGER);

    /*---------------------------------------------------------*/
    /*----------------- MODULE/PLUGIN core API ----------------*/
    /*---------------------------------------------------------*/

    installScalebarUtilities();

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
                const p = runLoader();
                runLoader = null;
                return p;
            }
            return Promise.resolve();
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
            // Bootstrap-only path — paired with the read in
            // ApplicationLifecycleController.restoreLocalState. See
            // src/IO_PIPELINE.md "Bootstrap exception".
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
    // Defer until viewers have actually been opened so reseedAll() can read
    // viewer.uniqueId without falling into the "no unique ID" warning path
    // in findViewerUniqueId (loader.ts).
    VIEWER_MANAGER.addOnceHandler("after-open", () => {
        bootstrapVisualizationHistory(APPLICATION_CONTEXT.history);
    });

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
