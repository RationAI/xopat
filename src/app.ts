import type { TileLoadFailedEvent } from "openseadragon";
import { BackgroundConfig } from "./classes/background-config";
import { initXOpatLoader } from "./loader";
import { ViewerFaultySourceRegistry } from "./classes/app/viewer-faulty-source-registry";
import { XOpatHistory } from "./classes/history";
import { bootstrapVisualizationHistory } from "./classes/visualization-history";
import { bootstrapLiveConfigSync } from "./classes/app/live-config-sync";
import { ViewerOpenPipeline } from "./classes/app/viewer-open-pipeline";
import { ViewerStateBindingController } from "./classes/app/viewer-state-binding-controller";
import { ViewerVisualizationRuntime } from "./classes/app/viewer-visualization-runtime";
import { ViewerInspectorController } from "./classes/app/viewer-inspector-controller";
import { ApplicationLifecycleController } from "./classes/app/application-lifecycle-controller";
// TODO(live-sessions): re-enable once src/classes/session/* is production-ready.
// Live shared sessions (WebRTC viewport/cursor/visualization sync) are
// currently disabled — see src/SESSION.md. Re-import together with
// `window.SESSION = new SessionSyncController()` below.
// import { SessionSyncController } from "./classes/session/session-sync";
import { bootstrapIOPipeline } from "./classes/io/bootstrap";
import { bootstrapSlideProtocols } from "./classes/slide-protocols";
import { bootstrapVirtualizationDetectors } from "./classes/virtualization-detectors";
import { registerVirtualRegionProtocol } from "./classes/virtual-region-protocol";
import { createApplicationContext } from "./classes/app/application-context";
import { installScalebarUtilities } from "./classes/app/scalebar-utilities";
import { applyInitialUiVisibility } from "./classes/app/ui-visibility";
import { wireNetworkStatusUi } from "./classes/app/network-status-ui";
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

    // `__ORIGIN__` marker → `window.location.origin`. Required for deployments
    // where the deploy script cannot predict which alias will actually serve
    // the iframe (canonical case: Colab's `serve_kernel_port_as_iframe` picks
    // a different alias than `google.colab.kernel.proxyPort(...)` returns).
    // The `/proxy/...` route emits no CORS headers, so the effective `domain`
    // must match the iframe origin or every proxy fetch fails the preflight.
    if (ENV?.client?.domain === "__ORIGIN__") {
        ENV.client.domain = window.location.origin;
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
    const droppedParamPaths: string[] = [];
    // Recurses one level: when the default value is a plain object (e.g. `ui`),
    // children are filtered against that nested allowlist with dotted paths in
    // the dropped-key warning.
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
        !!v && typeof v === "object" && !Array.isArray(v);
    const sanitizeAgainst = (
        raw: Record<string, unknown>,
        defaults: Record<string, unknown>,
        prefix: string
    ): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(raw)) {
            if (!Object.prototype.hasOwnProperty.call(defaults, name)) {
                droppedParamPaths.push(prefix ? `${prefix}.${name}` : name);
                continue;
            }
            const defaultValue = defaults[name];
            if (isPlainObject(defaultValue) && isPlainObject(value)) {
                out[name] = sanitizeAgainst(value, defaultValue, prefix ? `${prefix}.${name}` : name);
            } else {
                out[name] = value;
            }
        }
        return out;
    };
    const sanitizedParams = sanitizeAgainst(
        rawParams,
        defaultSetup as unknown as Record<string, unknown>,
        ""
    ) as XOpatSetup;
    if (droppedParamPaths.length) {
        console.warn(
            `Ignoring unsupported viewer parameters: ${droppedParamPaths.join(", ")}. ` +
            `Only these top-level viewer parameters are allowed: ${allowedParamNames.join(", ")}.`
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

    // Bootstrap the virtualization-detector registry (one slide → many aligned
    // virtual sources). Empty until an optional detector module registers a
    // region-finder; absent that, `TileSource.probeVirtualization()` is a no-op.
    bootstrapVirtualizationDetectors();

    // Register the `virtual-region` slide protocol (cropped sub-source). Must
    // run after SLIDE_PROTOCOLS bootstrap and after OpenSeadragon is loaded
    // (CroppedTileSource extends OpenSeadragon.TileSource).
    registerVirtualRegionProtocol();

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

    initXOpatUI();

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
    // Apply session-declared `params.ui.*` initial visibility. Per-viewer
    // wiring (scaleBar / navigator) runs in loader.ts on each `viewer.open`.
    applyInitialUiVisibility();

    /**
     * Replace share button in static preview mode
     */
    if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
        USER_INTERFACE.AppBar.setBanner(new UI.Badge({
            style: UI.Badge.STYLE.SOFT,
            color: UI.Badge.COLOR.WARNING,
        }, "Exported Session"));
    }

    // Surface network connectivity: an app-bar pill visible only while offline,
    // plus one-shot toasts on genuine transitions. Drives off
    // APPLICATION_CONTEXT.networkStatus so it stays in sync with the IO
    // pipeline's offline handling.
    wireNetworkStatusUi();

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
     *
     * TODO(live-sessions): the shared-session feature (WebRTC mesh sharing
     * viewport / cursor / visualization between peers) is not fully developed
     * and is disabled until the transport + provider story stabilises.
     * Consumers already access this via `window.SESSION?.…` (optional chain),
     * so leaving it `undefined` is safe. Re-instantiate together with the
     * `SessionSyncController` import above and re-enable the
     * `plugins/session-controls/` UI plugin (`enabled: false` in its
     * `include.json`) to bring the feature back.
     */
    // window.SESSION = new SessionSyncController();
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
    viewerInspector.registerInspectorMenu();

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

    (APPLICATION_CONTEXT as any).setVirtualizationMode = async function (
        parentBgId: string,
        mode: VirtualizationMode,
        opts = {}
    ) {
        return viewerOpenPipeline.setVirtualizationMode(parentBgId, mode, opts);
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
        bootstrapLiveConfigSync();
    });

    // Key event handlers - todo create shortcut manager
    $.extend($.scrollTo.defaults, { axis: 'y' });

    // Retrospective faulty-source detection: a source can instantiate fine
    // (its info.json / DZI loads) yet have its individual tile requests fail
    // during viewing. We count *consecutive* per-source failures (reset on any
    // successful tile) and, once the registry's threshold is crossed, mark the
    // source faulty so the navigator title + shader-menu alert surface it —
    // WITHOUT removing the image: OSD keeps requesting tiles (warn-only, the
    // source may recover). The verdict is keyed by source identity, so it
    // survives visualization switches.
    VIEWER_MANAGER.broadcastHandler('tile-load-failed', function (e: TileLoadFailedEvent) {
        if (e.message === "Image load aborted") return;
        const viewer = e.eventSource as any;
        const registry = viewer?.__faultySources;
        if (!registry) return;
        const key = ViewerFaultySourceRegistry.keyForItem(e.tiledImage as any);
        const becameFaulty = registry.recordTileFailure(key, e.message ? String(e.message) : undefined);
        if (becameFaulty) {
            /**
             * Fired once when a tile source crosses from healthy to faulty —
             * either failing instantiation or accumulating too many consecutive
             * tile-request failures. Consumers surface a warning; the image is
             * NOT removed automatically.
             * @property {OpenSeadragon.Viewer} viewer the affected viewer
             * @property {string} key source-identity key in the faulty registry
             * @property {string} error human-readable failure reason
             * @memberOf VIEWER
             * @event source-marked-faulty
             */
            viewer.raiseEvent('source-marked-faulty', { viewer, key, error: registry.getError(key) });
            try {
                viewerStateBindings.refreshViewerVisualizationBindings(viewer, 0);
            } catch (err) {
                console.warn("Failed to refresh navigator after marking source faulty.", err);
            }
        }
    });
    // Reset the consecutive-failure counter on any successful tile load.
    VIEWER_MANAGER.broadcastHandler('tile-loaded', function (e: any) {
        const registry = (e.eventSource as any)?.__faultySources;
        registry?.recordTileSuccess?.(ViewerFaultySourceRegistry.keyForItem(e.tiledImage));
    });

    // Central keyboard-shortcut dispatch (APPLICATION_CONTEXT.shortcuts, see
    // src/SHORTCUTS.md). The manager listens on the viewer manager's re-raised
    // document key events; core commands below register declaratively so users
    // can remap them in the Keymap fullscreen-menu panel.
    APPLICATION_CONTEXT.shortcuts.attach(VIEWER_MANAGER);

    // Viewport focus exchange: copies the current viewport to the clipboard,
    // or — when the clipboard already holds a copied viewport — aligns this
    // viewer to it. Transferable between different viewer windows. Shared by
    // the keymap shortcut and the app-bar Tools menu entry.
    function viewportCopyOrAlign(viewer?: OpenSeadragon.Viewer | null) {
        const v = viewer || VIEWER;
        navigator.clipboard.readText().then(text => {
            let focus: any = {};
            try {
                if (text && text.length < 100) focus = JSON.parse(text);
            } catch (e) {
                //pass
            }
            const px = Number.parseFloat(focus?.point?.x);
            const py = Number.parseFloat(focus?.point?.y);
            const pz = Number.parseFloat(focus?.zoomLevel);
            if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
                // todo maybe zoomTo second arg can be the point directly?
                v.viewport.panTo(new OpenSeadragon.Point(px, py), false);
                v.viewport.zoomTo(pz, undefined, false);
                UTILITIES.copyToClipboard("{}");
            } else {
                UTILITIES.copyToClipboard(JSON.stringify({
                    point: v.viewport.getCenter(),
                    zoomLevel: v.viewport.getZoom(),
                }));
                Dialogs.show($.t('messages.viewportCopied'), 1500, Dialogs.MSG_INFO);
            }
        }).catch(() => {
            Dialogs.show($.t('messages.clipboardBlocked'), 1500, Dialogs.MSG_ERR);
        });
    }

    if (!APPLICATION_CONTEXT.getOption("preventNavigationShortcuts")) {
        const shortcuts = APPLICATION_CONTEXT.shortcuts;
        const canvasScope = { requiresCanvasFocus: true };
        const NAV_PATH = ["keymap.cat.core", "keymap.cat.navigation"];
        const APP_PATH = ["keymap.cat.core", "keymap.cat.application"];
        const VIEW_PATH = ["keymap.cat.core", "keymap.cat.view"];

        function adjustBounds(viewer: OpenSeadragon.Viewer, speedX: number, speedY: number) {
            let bounds = viewer.viewport.getBounds();
            bounds.x += speedX * bounds.width;
            bounds.y += speedY * bounds.height;
            viewer.viewport.fitBounds(bounds);
        }

        const NAV_SPEED = 0.3;
        const registerPan = (dir: string, combo: string, dx: number, dy: number) => shortcuts.register({
            id: `core.viewport.pan${dir}`, titleKey: `keymap.core.pan${dir}`,
            categoryPath: NAV_PATH, defaultCombos: [combo], type: "press", trigger: "up",
            scope: canvasScope, preventDefault: false,
            handler: ({ viewer }) => adjustBounds(viewer || VIEWER, dx, dy),
        });
        registerPan("Up", "ArrowUp", 0, -NAV_SPEED);
        registerPan("Down", "ArrowDown", 0, NAV_SPEED);
        registerPan("Left", "ArrowLeft", -NAV_SPEED, 0);
        registerPan("Right", "ArrowRight", NAV_SPEED, 0);

        const registerZoom = (dir: string, combo: string, factor: number) => shortcuts.register({
            id: `core.viewport.zoom${dir}`, titleKey: `keymap.core.zoom${dir}`,
            categoryPath: NAV_PATH, defaultCombos: [combo], type: "press", trigger: "up",
            scope: canvasScope, preventDefault: false,
            handler: ({ viewer }) => {
                const v = viewer || VIEWER;
                const zoom = v.viewport.getZoom();
                v.viewport.zoomTo(zoom + zoom * factor);
            },
        });
        // Single-character combos match e.key (layout- and numpad-agnostic).
        registerZoom("In", "+", NAV_SPEED * 3);
        registerZoom("Out", "-", -NAV_SPEED * 2);

        const registerRotation = (name: string, combo: string, rotate: (viewport: any) => void) => shortcuts.register({
            id: `core.viewport.${name}`, titleKey: `keymap.core.${name}`,
            categoryPath: NAV_PATH, defaultCombos: [combo], type: "press", trigger: "up",
            scope: canvasScope,
            handler: ({ viewer }) => rotate((viewer || VIEWER).viewport),
        });
        registerRotation("rotateLeft", "Alt+KeyQ", vp => vp.setRotation(vp.getRotation() - 90));
        registerRotation("rotateRight", "Alt+KeyE", vp => vp.setRotation(vp.getRotation() + 90));
        registerRotation("rotateReset", "Alt+KeyR", vp => vp.setRotation(0));

        // Focal-plane (z-stack) navigation. No-op on slides without a z-stack.
        // Also driven by the navigator depth slider and the Alt+wheel gesture
        // (see loader.ts canvas-scroll). Combos `]` / `[` match e.code so they
        // sit next to the bracket keys regardless of layout.
        const registerDepth = (name: string, combo: string, delta: number) => shortcuts.register({
            id: `core.viewport.zDepth${name}`, titleKey: `keymap.core.zDepth${name}`,
            categoryPath: NAV_PATH, defaultCombos: [combo], type: "press", trigger: "up",
            scope: canvasScope,
            handler: ({ viewer }) => ((viewer || VIEWER) as any)?.__depthController?.step(delta),
        });
        registerDepth("Next", "BracketRight", 1);
        registerDepth("Prev", "BracketLeft", -1);

        // Primary+S => global save. trigger "down" (not "up") so preventDefault()
        // suppresses the browser's native "Save page" dialog, which fires on keydown.
        shortcuts.register({
            id: "core.app.save", titleKey: "keymap.core.save",
            categoryPath: APP_PATH, defaultCombos: ["Primary+KeyS"], type: "press", trigger: "down",
            // Async; fire-and-forget — save() manages its own loading UI and toasts.
            handler: () => UTILITIES.save(),
        });
        shortcuts.register({
            id: "core.app.undo", titleKey: "keymap.core.undo",
            categoryPath: APP_PATH, defaultCombos: ["Primary+KeyZ"], type: "press", trigger: "up",
            handler: () => APPLICATION_CONTEXT.history.undo(),
        });
        shortcuts.register({
            id: "core.app.redo", titleKey: "keymap.core.redo",
            categoryPath: APP_PATH, defaultCombos: ["Primary+Shift+KeyZ"], type: "press", trigger: "up",
            handler: () => APPLICATION_CONTEXT.history.redo(),
        });
        shortcuts.register({
            id: "core.app.screenshot", titleKey: "keymap.core.screenshot",
            categoryPath: APP_PATH, defaultCombos: ["Alt+KeyS"], type: "press", trigger: "down",
            handler: () => UTILITIES.makeScreenshot(),
        });
        shortcuts.register({
            id: "core.app.viewportCopy", titleKey: "keymap.core.viewportCopy",
            descriptionKey: "keymap.core.viewportCopyDesc",
            categoryPath: APP_PATH, defaultCombos: ["Alt+KeyW"], type: "press", trigger: "down",
            handler: ({ viewer }) => viewportCopyOrAlign(viewer),
        });

        // ── Peek at background: hold "h" to momentarily hide the visualization
        // overlay in the FOCUSED viewer (only the background image shows); release
        // to restore. Momentary opacity toggle on the flex-renderer's
        // visualization world items — no viewer rebuild / history / events.
        //
        // TODO: toggling opacity on the TiledImage is not ideal — the SAME
        // TiledImage can back both a background and a (non-bg) visualization layer,
        // so hiding it by TiledImage opacity can affect more than the overlay. The
        // correct fix is to set opacity per shader/visualization LAYER rather than
        // per TiledImage. Kept as TiledImage opacity for now (simpler; good enough
        // for the common single-visualization case).
        const peekState = new Map<any, Array<{ item: any; opacity: number }>>();
        shortcuts.register({
            id: "core.view.peek", titleKey: "keymap.core.peek",
            descriptionKey: "keymap.core.peekDesc",
            categoryPath: VIEW_PATH, defaultCombos: ["KeyH"], type: "hold", scope: canvasScope,
            onPress: ({ viewer }) => {
                if (!viewer || !viewer.world) return;
                if (peekState.has(viewer)) return;
                const saved: Array<{ item: any; opacity: number }> = [];
                const n = typeof viewer.world.getItemCount === "function" ? viewer.world.getItemCount() : 0;
                for (let i = 0; i < n; i++) {
                    const item: any = viewer.world.getItemAt(i);
                    if (item && typeof item.getConfig === "function" && item.getConfig("visualization")) {
                        const opacity = typeof item.getOpacity === "function" ? item.getOpacity() : item.opacity;
                        saved.push({ item, opacity });
                        item.setOpacity(0);
                    }
                }
                peekState.set(viewer, saved);
            },
            // Restore all (not just the focused viewer) in case focus changed while
            // held. The manager also fires this on window blur so a window switch
            // while "h" is held never leaves the overlay stuck hidden.
            onRelease: () => {
                for (const saved of peekState.values()) {
                    for (const { item, opacity } of saved) {
                        try { item.setOpacity(opacity); } catch (_) { /* item may be gone (viewer closed) */ }
                    }
                }
                peekState.clear();
            },
        });

        // Escape is a contextual dismiss key (like Enter/Delete in widgets) —
        // deliberately NOT in the keymap registry, so it stays a fixed handler.
        VIEWER_MANAGER.addHandler('key-up', function (e: KeyboardEvent) {
            if (e.key === 'Escape') {
                USER_INTERFACE.Tutorials.hide();
                USER_INTERFACE.DropDown.hide();
            }
        });
    }

    // Surface the utility actions in the app-bar "Tools" menu too, with the
    // live (possibly remapped) shortcut rendered next to the label. Registered
    // outside the preventNavigationShortcuts gate — the menu entries work even
    // when keyboard shortcuts are disabled (they then just show no kbd text).
    {
        const shortcuts = APPLICATION_CONTEXT.shortcuts;
        const toolEntries = [
            {
                id: "core.screenshot", shortcutId: "core.app.screenshot", icon: "ph-camera",
                titleKey: "keymap.core.screenshot",
                action: () => UTILITIES.makeScreenshot(),
            },
            {
                id: "core.viewport-copy", shortcutId: "core.app.viewportCopy", icon: "ph-crosshair-simple",
                titleKey: "keymap.core.viewportCopy", hintKey: "keymap.core.viewportCopyDesc",
                action: () => viewportCopyOrAlign(),
            },
        ];
        const refreshToolEntries = () => {
            for (const entry of toolEntries) {
                const combos = shortcuts.getBinding(entry.shortcutId)?.combos || [];
                USER_INTERFACE.AppBar.Tools.register(entry.id, {
                    label: $.t(entry.titleKey),
                    icon: entry.icon,
                    hint: entry.hintKey ? $.t(entry.hintKey) : undefined,
                    kbd: combos.length ? shortcuts.comboDisplayParts(combos[0]).join("+") : undefined,
                    onClick: entry.action,
                });
            }
        };
        refreshToolEntries();
        shortcuts.addHandler("binding-changed", refreshToolEntries);
        shortcuts.addHandler("bindings-reset", refreshToolEntries);
    }

    // See src/TUTORIALS.md for the selector cookbook used below. Per-viewer
    // panels (right-side menu, shader controls) are keyed by viewer position
    // id, so the `[id$="…"]` suffix selectors target the first/active viewer's
    // element without hard-coding `osd-0` — which makes the walk work
    // unchanged in multi-viewer sessions.
    const withLayers = () => APPLICATION_CONTEXT.config.visualizations.length > 0;

    window.USER_INTERFACE.Tutorials.add("", $.t('tutorials.basic.title'), $.t('tutorials.basic.description'), "ph-compass", [
        { 'next #viewer-container': $.t('tutorials.basic.viewer') },
        { 'next [id$="-right-menu-menu-b-opened-navigator"]': $.t('tutorials.basic.navigator') },
        { 'click [id$="-right-menu-menu-b-opened-shaders"]': $.t('tutorials.basic.openLayers'), runIf: withLayers },
        { 'next [id$="-right-menu-menu-opendiv-shaders"] select[name="shaders"]': $.t('tutorials.basic.visualizationPicker'), runIf: withLayers },
        { 'next [id$="-panel-shaders"]': $.t('tutorials.basic.layers'), runIf: withLayers },
        { 'next [id$="-cache-snapshot"]': $.t('tutorials.basic.cache'), runIf: withLayers },
        { 'next #fullscreen-button': $.t('tutorials.basic.hideUi') },
        { 'next #visual-menu-b-view': $.t('tutorials.basic.viewMenu') },
        { 'next #top-user-buttons-menu-b-tutorial': $.t('tutorials.basic.reopen') },
    ]);

    // Companion tour covering features the basic walk intentionally skips so
    // it stays short. Selectors here are all stable globals.
    window.USER_INTERFACE.Tutorials.add("", $.t('tutorials.view.title'), $.t('tutorials.view.description'), "ph-binoculars", [
        { 'next #osd-0': $.t('tutorials.view.inspector') },
        { 'next #visual-menu-b-edit': $.t('tutorials.view.editMenu') },
        { 'next #osd-0': $.t('tutorials.view.playground') },
        { 'next #fullscreen-button': $.t('tutorials.view.fullscreen') },
    ]);
}

(window as any).initXOpat = initXOpat;
