export { }; // This line forces TS to treat this as a module
// Shared ambient types (BackgroundItem, DataID, ApplicationContext, etc.)
// are declared in src/types/shared.d.ts (no export{}) and hence globally visible.

declare global {
    // Runtime-provided globals available throughout the application
    var $: any;
    var APPLICATION_CONTEXT: ApplicationContext;
    var VIEWER_MANAGER: any;
    var VIEWER: OpenSeadragon.Viewer;
    var USER_INTERFACE: any;
    var van: any;
    var UI: any;
    var UTILITIES: XOpatUtilities;

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
        HTTPError: any;
        UI: any;
        van: any;
        USER_INTERFACE: any;
        UTILITIES: XOpatUtilities;
        /** xOpat plugin class constructor, set once loader is initialized */
        XOpatPlugin?: any;
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
            "plugin-loaded": PluginLoadedEvent;
            "plugin-failed": PluginFailedEvent;
            "module-singleton-created": ModuleSingletonCreatedEvent;
            "viewer-singleton-created": ViewerSingletonCreatedEvent;
            "viewer-reset": ViewerResetEvent;
            "export-data": ExportDataEvent;
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
