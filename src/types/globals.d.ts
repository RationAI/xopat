export { }; // This line forces TS to treat this as a module

declare global {
    // Runtime-provided globals available throughout the application
    /**
     * The translation namespace — NOT jQuery. jQuery is no longer shipped;
     * `$` is a plain object installed by `classes/app/i18n-dom.ts` and is not
     * callable. `$.t('key')` stays the way every call site reads a locale
     * string (AGENTS.md §3); `$.i18n` is the raw i18next instance.
     */
    var $: {
        t(key: string, options?: Record<string, any>): string;
        i18n?: any;
    };
    var APPLICATION_CONTEXT: ApplicationContext;
    var addModule: (id: string, moduleClass: new () => IXOpatModuleSingleton, eager?: boolean) => void;
    var addPlugin: (id: string, pluginClass: new (id: string) => IXOpatPlugin) => void;
    var plugin: (id: string) => IXOpatPlugin | undefined;
    var pluginMeta: (id: string, metaKey: string) => any;
    var moduleMeta: (id: string, metaKey: string) => any;
    /** True for a `"%key%"` metadata value that could not be resolved. */
    var isUnresolvedMetaRef: (value: any) => boolean;
    /** Resolved element name for user-facing messages, falls back to the id. */
    var elementName: (kind: "plugins" | "modules", id: string) => string;
    /** Load the locale bundle of a not-yet-loaded element so its `%key%` metadata resolves. */
    var loadElementLocale: (kind: "plugins" | "modules", id: string, locale?: string) => Promise<void>;
    /** Locale bundle required to render an element's metadata, or undefined if nothing to fetch. */
    var ensureElementMeta: (kind: "plugins" | "modules", id: string) => Promise<void> | undefined;
    /** Human readable reason the element cannot run against this app version, or null. */
    var elementIncompatibility: (kind: "plugins" | "modules", id: string) => string | null;
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
    var Dialogs: any;
    var HttpClient: any;
    var XOpatStorage: any;
    /**
     * Canonical browser-storage availability probe (see `src/store.ts`).
     * Installed by `dist/store.js`, the first app script — so it is safe to
     * read from `src/parse-input.js` and anything loaded after it.
     */
    var XOpatStorageAvailability: {
        check(kind: "localStorage" | "sessionStorage" | "cookies" | "indexedDB"): boolean;
        /** Report an API that probed as available but failed asynchronously. */
        recordFailure(kind: "localStorage" | "sessionStorage" | "cookies" | "indexedDB", error?: unknown): void;
        readonly localStorage: boolean;
        readonly sessionStorage: boolean;
        readonly cookies: boolean;
        readonly indexedDB: boolean;
        readonly opaqueOrigin: boolean;
        readonly degraded: boolean;
        report(): Record<string, { ok: boolean; reason?: string }>;
    };
    var XOpatUser: any;
    var Stats: any;

    interface Window {
        XOPAT_CSRF_TOKEN?: string;
        /**
         * Identity of the deployment being served, computed once in `initXOpat`
         * from the served ENV + element registries. Scopes the boot session
         * caches and the plugin-autoload cookie, and stamps every session this
         * viewer serializes. See `src/classes/app/deployment-key.ts`.
         */
        XOPAT_DEPLOYMENT_KEY?: string;
        /**
         * Present only under `core.server.security.cookielessSessions` — the
         * embedded-viewer fallback for a frame with no usable cookie jar.
         * Echoed back as `X-XOPAT-Session`; see `src/classes/http-client.ts`.
         */
        XOPAT_SESSION_ID?: string;
        $: any;
        APPLICATION_CONTEXT: ApplicationContext;
        VIEWER_MANAGER: any;
        VIEWER: OpenSeadragon.Viewer;
        SESSION: SessionSync;
        SLIDE_PROTOCOLS: SlideProtocolRegistryLike;
        plugin: (id: string) => IXOpatPlugin | undefined;
        pluginMeta: (id: string, metaKey: string) => any;
        moduleMeta: (id: string, metaKey: string) => any;
        isUnresolvedMetaRef: (value: any) => boolean;
        elementName: (kind: "plugins" | "modules", id: string) => string;
        loadElementLocale: (kind: "plugins" | "modules", id: string, locale?: string) => Promise<void>;
        ensureElementMeta: (kind: "plugins" | "modules", id: string) => Promise<void> | undefined;
        elementIncompatibility: (kind: "plugins" | "modules", id: string) => string | null;
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

    /** Minimal shape of the `APPLICATION_CONTEXT.networkStatus` singleton (`classes/network-status.ts`). */
    interface NetworkStatusLike {
        /** true when the browser reports being online. */
        readonly isOnline: boolean;
        /** true when the browser reports being offline. */
        readonly isOffline: boolean;
        addHandler(eventName: "network-status-changed", handler: (e: { online: boolean }) => void): void;
        removeHandler(eventName: "network-status-changed", handler: (e: { online: boolean }) => void): void;
        raiseEvent(eventName: string, eventArgs?: object): void;
    }

    /**
     * Minimal shape of the `APPLICATION_CONTEXT.tutorials` singleton
     * (`classes/app/tutorial/`). Step authoring is documented in
     * `src/TUTORIALS.md`; a step is `{"<next|click|…> <css-selector>": "html",
     * runIf?: () => boolean}` plus the optional per-step knobs.
     */
    interface TourEngineLike {
        /** True while a tour is on screen. */
        readonly isRunning: boolean;
        /** Start a tour. `hooks` mirror the former EnjoyHint constructor options. */
        run(steps: Record<string, any>[], hooks?: {
            onStart?: () => void;
            onEnd?: () => void;
            onSkip?: () => void;
            onNext?: () => void;
            backgroundColor?: string;
        }): void;
        /** Abort the running tour without firing `onEnd`. */
        stop(): void;
        /** Fire a `custom`-event step's trigger, or `"next"` / `"skip"`. */
        trigger(eventName: string): void;
        getCurrentStep(): number;
        setCurrentStep(step: number): void;
    }

    /** Per-origin admission gate for background HTTP (`classes/app/request-scheduler.ts`). */
    interface RequestSchedulerLike {
        /**
         * Acquire a background slot for `origin`; resolves with an idempotent
         * `release()`. If `signal` aborts while queued, rejects and frees the slot.
         */
        acquire(origin: string, opts?: { signal?: AbortSignal; jumpQueue?: boolean }): Promise<() => void>;
        /** Per-origin background occupancy snapshot (debug/verify). */
        stats(): Record<string, { inFlight: number; queued: number; bgLimit: number; busy: boolean }>;
    }

    /**
     * One channel of the client logging broker (`classes/app/logging.ts`).
     * Same shape as the server's `XOPAT_SERVER.log(channel)`. See src/LOGGING.md.
     */
    interface ClientLoggerLike {
        readonly channel: string;
        trace(...args: any[]): any;
        debug(...args: any[]): any;
        info(...args: any[]): any;
        warn(...args: any[]): any;
        error(...args: any[]): any;
        /**
         * Payload-bearing record (prompts, message bodies, script results).
         * Emitted only when the deployment allowed it AND the channel is at
         * `trace` — on real data these are PHI.
         */
        sensitive(...args: any[]): any;
        /** Returns a stop function that emits `durationMs`. */
        time(label: string, level?: "trace" | "debug" | "info" | "warn" | "error"): (fields?: Record<string, any>) => any;
        child(sub: string): ClientLoggerLike;
        isEnabled(level: "trace" | "debug" | "info" | "warn" | "error"): boolean;
        level(): string;
    }

    /** The client logging broker itself (`classes/app/logging.ts`). */
    interface ClientLoggingLike {
        /**
         * This browser sitting (`cs_…`), minted at boot. A correlation token, not
         * an identity: it groups one page-load's records so a session can be
         * reconstructed without logging who the person is.
         */
        readonly sessionId: string;
        log(channel: string): ClientLoggerLike;
        /** Re-read `env.client.logging`. */
        configure(rawConfig: any): void;
        /** Buffered records, newest last. */
        getEntries(query?: { afterId?: number; limit?: number; minLevel?: string; channel?: string; search?: string }): any[];
        /** Push queued records to the server now (also runs on page hide). */
        flush(): Promise<void>;
        stats(): Record<string, any>;
    }

    /** Rectangle in full-resolution (level-0) image pixels of a reference world item. */
    interface RegionCaptureRect {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    /**
     * Payload of the viewer-level `region-capture` event — raised whenever something reads
     * pixels out of that viewer (off-screen region render, viewport/background extract,
     * on-screen composite grab). See `src/EVENTS.md`.
     */
    interface RegionCaptureEvent {
        /** Stable id across the three phases of one capture. */
        captureId: string;
        phase: "queued" | "start" | "end";
        /** `region` reads a rectangle of the slide; `viewport` reads whatever is on screen. */
        kind: "region" | "viewport";
        /** Level-0 image pixels of `refIndex`. Absent for `kind: "viewport"`. */
        region?: RegionCaptureRect;
        /** World-item index the `region` coordinates belong to (default 0). */
        refIndex?: number;
        /**
         * Free-form diagnostic label describing WHY the capture happened (e.g. "explore: survey").
         * Possibly attacker-influenced (a session-supplied script may set it) — render with
         * `textContent`, never as HTML.
         */
        label?: string;
        /** `phase: "end"` only — whether the capture produced pixels. */
        ok?: boolean;
        /** `phase: "end"` only — failure message when `ok` is false. */
        error?: string;
    }

    /** What a capture site declares; the phases/outcome fields are filled in by the announcer. */
    type CaptureAnnouncement = Omit<RegionCaptureEvent, "captureId" | "phase" | "ok" | "error">;

    /**
     * Draws `region-capture` events as OSD overlays on the viewer they came from, so
     * off-screen LLM/analysis reads are visible and auditable
     * (`classes/app/capture-indicator.ts`).
     */
    interface CaptureIndicatorLike {
        /**
         * "off" (nothing rendered) | "flash" (in-flight only) | "trail" (markers accumulate
         * during a run and clear themselves once capturing goes idle).
         */
        readonly mode: "off" | "flash" | "trail";
        /** `persist: false` changes the mode for this session only (hide-UI button). */
        setMode(mode: "off" | "flash" | "trail", opts?: { persist?: boolean }): void;
        /** Follow the viewer grid; idempotent. */
        attachViewerManager(viewerManager: any): void;
        /** Add the on/off switch to the app bar's View menu; idempotent. */
        registerViewToggle(): void;
        /**
         * Bounded, newest-last history of captures for one viewer. Independent of what is
         * currently drawn — markers clear themselves when capturing goes idle, the record does not.
         */
        getLog(viewer: any): Array<RegionCaptureEvent & { t: number; hits: number }>;
        /** Drop the rendered markers AND the log for one viewer, or for all when omitted. */
        clear(viewer?: any): void;
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
            /** True once `__cachedUUID` holds the authoritative explicit per-slot background id. */
            __uuidExplicit?: boolean;
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
            /**
             * Fired once when a tile source crosses from healthy to faulty
             * (instantiation failure or too many consecutive tile-request
             * failures). Warn-only: the tiled image is NOT removed.
             */
            "source-marked-faulty": { viewer: OpenSeadragon.Viewer; key: string; error?: string } & ViewerEvent;
            "visualization-used": ViewerEvent & Record<string, any>;
        }

        interface ViewerManagerEventMap {
            "before-app-init": BeforeAppInitEvent;
            "before-refresh": BeforeRefreshEvent;
            "before-open": BeforeOpenEvent;
            "after-open": AfterOpenEvent;
            "get-preview-url": GetPreviewUrlEvent;
            "get-preview-shader": GetPreviewShaderEvent;
            "plugin-loaded": PluginLoadedEvent;
            "plugin-failed": PluginFailedEvent;
            "module-failed": ModuleFailedEvent;
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
            /** Mirrored from IO_PIPELINE: a sink-providing module claimed
             *  `(owner, capability)` at runtime (Rule 2.5). `targets` is the
             *  merged list across every claimant for that pair. An explicit
             *  `ENV.client.io.bindings` entry still overrides it. */
            "io:binding-claimed": {
                owner: string; capabilityId: string; claimantUid: string;
                targets: IOBindingTarget[];
            };
            /** Mirrored from IO_PIPELINE: every bound sink for one
             *  dispatch failed (refused, threw, or declined via accepts).
             *  Signal that data was silently dropped — usually a
             *  misconfigured `ENV.client.io.bindings`. */
            "io:fully-refused": { ctx: IOContext; results: IOResult[] };
            /** Mirrored from IO_PIPELINE: a post-commit refusal was reverted —
             *  the op's `inverseApply` ran and its history entry was dropped. */
            "io:reverted": {
                ownerUid: string; resourceName: string;
                direction: "create" | "update" | "delete";
                itemId?: string; ctx: IOContext; result: IOResult;
            };
            /** A sink registered. Resources holding writes for a binding that
             *  named it may resume — a sink is allowed to appear well after
             *  boot (a module that must complete a handshake first). */
            "io:sink-registered": { sinkId: string };
            /** A per-resource outbox queue has stalled: the sink refused after
             *  retries (usually network/5xx), the browser is offline, or a
             *  configured sink has not registered yet. Fires once per stall
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
            "io:outbox-unavailable": { ownerUid: string; resourceName: string; reason: string };
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
            /**
             * Apply per-slide source options. xOpat may call this TWICE with the
             * same object — synchronously before the metadata request for sources
             * the slide-protocol registry constructed itself, and again after the
             * item is added to the world. Implementations must be idempotent and
             * must not assume metadata (`this.data`) exists. Full contract in
             * `src/tile-source.ts`.
             */
            setSourceOptions?(options: SlideSourceOptions): void;
            /** Per-source HttpClient stamped by `SLIDE_PROTOCOLS.resolve(...)`. */
            __xopatHttpClient?: any /* HttpClient */;
            /** `open-failed` message recorded before the open pipeline subscribed. */
            __xopatOpenFailure?: string;
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
        // Implementations live in `src/classes/tile-sources/*.ts`, registered on
        // the OpenSeadragon namespace as plain core scripts (config.json `js.src.app`).

        /** Placeholder source for a faulty / empty layer. `src/classes/tile-sources/empty-tile-source.ts`. */
        class EmptyTileSource extends TileSource {
            constructor(opts?: {
                height?: number; width?: number; tileSize?: number;
                /** Surfaced through `getMetadata().error` — marks the layer faulty. */
                error?: string;
            });
            /** Solid colour the synthesized tiles are filled with. */
            setColor(color: string): void;
        }

        /** Single already-decoded image rendered as a one-tile pyramid. `src/classes/tile-sources/preview-slide-source.ts`. */
        class PreviewSlideSource extends TileSource {
            constructor(opts: { image: HTMLImageElement });
        }

        /** RationAI DeepZoom `ImageArray` extension. `src/classes/tile-sources/extended-dzi-tile-source.ts`. */
        class ExtendedDziTileSource extends TileSource {
            tilesUrl: string;
            fileFormat: string;
            /** Tile URL builder that accepts an explicit tiles root. */
            getUrl(level: number, x: number, y: number, tiles?: string): string;
            getPostData(level: number, x: number, y: number, data?: string): string | null;
            /** Legacy: switch the tile transfer format; `"zip"` swaps in the unzipit download path. */
            setFormat(format: string): void;
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
