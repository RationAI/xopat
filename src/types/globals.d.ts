export { }; // This line forces TS to treat this as a module

declare global {
    // Runtime-provided globals available throughout the application
    var $: any;
    var APPLICATION_CONTEXT: ApplicationContext;
    var addModule: (id: string, moduleClass: new () => IXOpatModuleSingleton, eager?: boolean) => void;
    var addPlugin: (id: string, pluginClass: new (id: string) => IXOpatPlugin) => void;
    var plugin: (id: string) => IXOpatPlugin | undefined;
    var pluginMeta: (id: string, metaKey: string) => any;
    var singletonModule: (id: string) => IXOpatModuleSingleton | undefined;
    var viewerSingletonModule: (className: string, viewer: ViewerLikeItem) => IXOpatViewerSingletonModule | IXOpatViewerSingleton | undefined;
    var registerViewerSingleton: (singletonClass: XOpatViewerSingletonClass | XOpatViewerSingletonModuleClass, className?: string) => void;
    var requireViewerSingletonPresence: (singletonClass: XOpatViewerSingletonClass) => void;
    var XOpatModuleSingleton: new () => IXOpatModuleSingleton;
    var XOpatPlugin: new (id: string) => IXOpatPlugin;
    var VIEWER_MANAGER: any;
    var VIEWER: OpenSeadragon.Viewer;
    var SESSION: SessionSync;
    /** Slide-protocol registry singleton (URL templates + plugin-registered factories). */
    var SLIDE_PROTOCOLS: SlideProtocolRegistryLike;
    var USER_INTERFACE: any;
    var van: any;
    var UI: any;
    var UTILITIES: XOpatUtilities;
    var xmodules: Record<string, any>;

    // Third-party globals loaded at runtime
    var i18next: any;
    var jqueryI18next: any;
    /** js-cookie library */
    var Cookies: any;
    var Dialogs: any;
    var HttpClient: any;
    var XOpatStorage: any;
    var XOpatUser: any;
    var Stats: any;

    interface Window {
        XOPAT_CSRF_TOKEN?: string;
        $: any;
        APPLICATION_CONTEXT: ApplicationContext;
        VIEWER_MANAGER: any;
        VIEWER: OpenSeadragon.Viewer;
        SESSION: SessionSync;
        SLIDE_PROTOCOLS: SlideProtocolRegistryLike;
        plugin: (id: string) => IXOpatPlugin | undefined;
        pluginMeta: (id: string, metaKey: string) => any;
        singletonModule: (id: string) => IXOpatModuleSingleton | undefined;
        viewerSingletonModule: (className: string, viewer: ViewerLikeItem) => IXOpatViewerSingletonModule | IXOpatViewerSingleton | undefined;
        registerViewerSingleton: (singletonClass: XOpatViewerSingletonClass | XOpatViewerSingletonModuleClass, className?: string) => void;
        requireViewerSingletonPresence: (singletonClass: XOpatViewerSingletonClass) => void;
        xmodules: Record<string, any>;
        HTTPError: any;
        UI: any;
        van: any;
        USER_INTERFACE: any;
        UTILITIES: XOpatUtilities;
        /** xOpat plugin class constructor, set once loader is initialized */
        XOpatPlugin?: any;
        /** xOpat module singleton class constructor, set once loader is initialized */
        XOpatModuleSingleton?: any;
        /** BackgroundConfig class constructor */
        BackgroundConfig: BackgroundConfigConstructor;
        /** HistoryProvider base class */
        HistoryProvider: HistoryProviderConstructor;
        /**
         * xOpat history stack (same name as DOM History for backward compat,
         * but declared with XOpatHistoryConstructor type on Window).
         */
        History: XOpatHistoryConstructor;
        OpenSeadragon: typeof OpenSeadragon;
    }

    namespace OpenSeadragon {
        // ── Viewer instance extensions ──────────────────────────────────────
        interface Viewer {
            /** Unique data-session ID for this viewer instance */
            uniqueId: string;
            /** OSD viewer DOM element id */
            id: string;
            /** Scalebar plugin reference */
            scalebar: any;
            /** Gesture settings for mouse */
            gestureSettingsMouse: any;
            /** Toggle demo/error page overlay */
            toggleDemoPage: (enable: boolean, explainErrorHtml?: string) => void;
            /** Cached UUID used internally */
            __cachedUUID?: string;
            /** Cached initialisation flag */
            __initialized?: boolean;
            /** Get the right-side viewer menu */
            getMenu(): any;
            /** xOpat awaitable event */
            raiseEventAwaiting(eventName: string, eventArgs?: object): Promise<void>;
            /** xOpat: instantiate a tile source class */
            instantiateTileSourceClass(opts: { tileSource: any }): Promise<{ source: any }>;
            /** xOpat: make scalebar for this viewer */
            makeScalebar(options: Record<string, any>): void;
            [key: symbol]: any;
        }

        // ── xOpat-specific viewer events (merged into ViewerEventMap) ───────
        interface ViewerEventMap {
            /**
             * Raised when a background tile source has been resolved to a TileSource instance,
             * before it is added to the viewer world. Awaitable via `raiseEventAwaiting`.
             * @see TileSourceCreatedEvent
             */
            "tile-source-created": TileSourceCreatedEvent & ViewerEvent;
            /**
             * Raised when a tile source fails to resolve or instantiate.
             * Awaitable via `raiseEventAwaiting`.
             * @see TileSourceFailedEvent
             */
            "tile-source-failed": TileSourceFailedEvent & ViewerEvent;
            /**
             * Raised when the rendering system (WebGL shader layers) has been
             * configured and is ready to draw overlays.
             */
            "visualization-ready": { viewer: Viewer } & ViewerEvent;
            /**
             * Raised when a viewer overlay demo/error page is shown or hidden.
             * @property {string} id - Element ID of the overlay div.
             * @property {string | undefined} htmlError - Optional HTML error message.
             * @property {(overlay?: Element | null) => void} show - Call to mount the overlay.
             */
            "show-demo-page": { id: string; htmlError: string | undefined; show: (overlay?: Element | null) => void } & ViewerEvent;
            /**
             * Fire to report a non-fatal warning. The core shows a warning dialog
             * unless `event.preventDefault` is set to `true`.
             * @see ErrorUserEvent
             */
            "warn-user": ErrorUserEvent & ViewerEvent;
            /**
             * Fire to report a fatal error. The core shows an error dialog
             * unless `event.preventDefault` is set to `true`.
             * @see ErrorUserEvent
             */
            "error-user": ErrorUserEvent & ViewerEvent;
            /**
             * Raised by OpenSeadragon when a tiled image fails to be added to the viewer.
             * xOpat uses this to detect HTTP errors (401, 403, 404) and display appropriate dialogs.
             *
             * @event add-item-failed
             * @memberof OpenSeadragon.Viewer
             * @property {OpenSeadragon.Viewer} eventSource - The viewer that raised the event.
             * @property {string | { statusCode?: number }} message - OSD error string, or an object
             *   with a `statusCode` property when the failure was caused by an HTTP response.
             * @property {any} source - The original tile source specifier that failed.
             * @property {object} options - The options object passed to `addTiledImage`.
             */
            "add-item-failed": {
                message: string | { statusCode?: number };
                source: any;
                options: object;
            } & ViewerEvent;
            /** Raised when a screenshot context is ready for export. */
            "screenshot": { context2D: RenderingContext; width: number; height: number } & ViewerEvent;
            "tiled-image-problematic": ViewerEvent & Record<string, any>;
            "visualization-used": ViewerEvent & Record<string, any>;
        }

        interface ViewerManagerEventMap {
            "before-app-init": BeforeAppInitEvent;
            "before-refresh": BeforeRefreshEvent;
            "before-open": BeforeOpenEvent;
            "after-open": AfterOpenEvent;
            "plugin-loaded": PluginLoadedEvent;
            "plugin-failed": PluginFailedEvent;
            "module-singleton-created": ModuleSingletonCreatedEvent;
            "viewer-singleton-created": ViewerSingletonCreatedEvent;
            "viewer-reset": ViewerResetEvent;
            /** Mirrored from IO_PIPELINE: an IO call was refused (sink
             *  tried and returned `{ refused: true }`, or threw). Carries a
             *  user-facing toast automatically. See src/IO_PIPELINE.md. */
            "io:refused": { ctx: IOContext; result: IOResult };
            /** Mirrored from IO_PIPELINE: a bound sink's `accepts(ctx)`
             *  returned false — it opted out before trying. Distinct from
             *  `io:refused` so observers can tell route-skip from
             *  tried-and-failed. */
            "io:rejected-by-accepts": { ctx: IOContext; sinkId: string };
            /** Mirrored from IO_PIPELINE: every bound sink for one
             *  dispatch failed (refused, threw, or declined via accepts).
             *  Signal that data was silently dropped — usually a
             *  misconfigured `ENV.client.io.bindings`. */
            "io:fully-refused": { ctx: IOContext; results: IOResult[] };
            /** Mirrored from IO_PIPELINE: two sinks both accept the
             *  same context. Reserved; not yet emitted. */
            "io:conflict": { ctx: IOContext; sinkIds: string[] };
            /** A per-resource outbox queue has stalled (sink refused
             *  after retries; usually network/5xx). Fires once per stall
             *  episode. UI can show "syncing failed / offline" badge. */
            "io:queue-stalled": { ownerUid: string; resourceName: string; pending: number };
            /** Outbox resumed after a stall (next op succeeded). */
            "io:queue-resumed": { ownerUid: string; resourceName: string };
            /** Outbox drained — last pending op resolved. Useful for
             *  "all changes saved" indicators. */
            "io:queue-empty":   { ownerUid: string; resourceName: string };
            /** Persistent outbox: per-resource cap reached. New ops are
             *  refused with `W_IO_OUTBOX_FULL`. */
            "io:outbox-full":   { ownerUid: string; resourceName: string; pending: number };
            /** Persistent outbox: stale entries pruned on boot or sweep. */
            "io:outbox-pruned": { ownerUid: string; resourceName: string; count: number };
            /** Persistent outbox: navigator.storage usage exceeded 80% of quota. */
            "io:outbox-quota-warn": { usage: number; quota: number; ratio: number };
            /** Persistent outbox: IndexedDB is unavailable; resources fall
             *  back to in-memory queue. Fired once at boot. */
            "io:outbox-unavailable": { reason: string };
            /** Persistent outbox: boot replay finished for one resource. */
            "io:outbox-replayed": { ownerUid: string; resourceName: string; count: number };
        }

        // ── TiledImage extension ────────────────────────────────────────────
        interface TiledImage {
            getConfig(type?: string): any;
            __targetIndex?: number;
        }

        // ── TileSource extension ────────────────────────────────────────────
        interface TileSource {
            url?: string;
            setSourceOptions?(options: SlideSourceOptions): void;
            getMetadata?(): TileSourceMetadata;
            /**
             * User-facing display metadata. Returns an ordered list of card-shaped
             * sections to render in the Slide Information panel. Each `value` must
             * be a primitive (string|number|boolean|null) — no nested objects,
             * no functions, no event queues. Return [] when there is nothing
             * user-relevant to show. See `src/tile-source.ts` for the default.
             */
            getDisplayMetadata?(): TileSourceDisplayMetadata;
        }

        // ── MouseTracker event ───────────────────────────────────────────────
        interface MouseTrackerEvent {
            originalEvent: MouseEvent;
        }

        // ── xOpat runtime extensions to the OpenSeadragon namespace ─────────
        class EmptyTileSource extends TileSource {
            constructor(opts?: { height?: number; width?: number; tileSize?: number });
        }

        class Tools {
            constructor(viewer: Viewer);
        }

        const SUBPIXEL_ROUNDING_OCCURRENCES: {
            readonly NEVER: 0;
            readonly ONLY_AT_REST: 1;
            readonly ALWAYS: 2;
        };

        const ScalebarSizeAndTextRenderer: {
            METRIC_LENGTH: any;
            METRIC_GENERIC: (unit: string, ...args: any[]) => any;
            [key: string]: any;
        };

        const ScalebarLocation: {
            BOTTOM_LEFT: any;
            BOTTOM_RIGHT: any;
            TOP_LEFT: any;
            TOP_RIGHT: any;
        };
    }
}
