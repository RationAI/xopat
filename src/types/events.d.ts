// ── xOpat event types — ambient globals ───────────────────────────────────────
// Strictly-typed event payloads for events raised by VIEWER_MANAGER and the
// OpenSeadragon viewer instances. Consistent with the OSD event documentation
// style (@event, @memberof, @property).

// ── VIEWER_MANAGER events ─────────────────────────────────────────────────────

/**
 * Raised when a new viewer is created and inserted into the grid layout.
 * This event is fired after the viewer has received its initial data load.
 *
 * @event viewer-create
 * @memberof VIEWER_MANAGER
 * @property {OpenSeadragon.Viewer} viewer - The newly created viewer instance.
 * @property {UniqueViewerId} uniqueId - The unique data-session ID of the viewer.
 * @property {number} index - Zero-based index of the viewer slot in the grid.
 */
interface ViewerCreateEvent {
    viewer: OpenSeadragon.Viewer;
    uniqueId: UniqueViewerId;
    index: number;
}

/**
 * Raised when a viewer is removed from the grid layout.
 * Called before the viewer is actually destroyed and all its data cleared.
 *
 * @event viewer-destroy
 * @memberof VIEWER_MANAGER
 * @property {OpenSeadragon.Viewer} viewer - The viewer being destroyed.
 * @property {UniqueViewerId} uniqueId - The unique data-session ID of the viewer.
 * @property {number} index - Zero-based index of the viewer slot in the grid.
 */
interface ViewerDestroyEvent {
    viewer: OpenSeadragon.Viewer;
    uniqueId: UniqueViewerId;
    index: number;
}

/**
 * Raised when a viewer's data is cleared so it can accept new data.
 *
 * @event viewer-reset
 * @memberof VIEWER_MANAGER
 * @property {OpenSeadragon.Viewer} viewer - The viewer being reset.
 * @property {UniqueViewerId} uniqueId - The unique data-session ID of the viewer.
 * @property {number} index - Zero-based index of the viewer slot in the grid.
 */
interface ViewerResetEvent {
    viewer: OpenSeadragon.Viewer;
    uniqueId: string;
    index: number;
}

/**
 * Raised when a plugin script is successfully loaded and instantiated.
 *
 * @event plugin-loaded
 * @memberof VIEWER_MANAGER
 * @property {string} id - The plugin ID as declared in `include.json`.
 * @property {IXOpatPlugin} plugin - The instantiated plugin.
 * @property {boolean} isInitialLoad - True if this is the initial boot load.
 */
interface PluginLoadedEvent {
    id: string;
    plugin: IXOpatPlugin;
    isInitialLoad: boolean;
}

/**
 * Raised when a plugin fails to load or instantiate.
 * A dialog is shown automatically unless `preventDefault` is set.
 *
 * @event plugin-failed
 * @memberof VIEWER_MANAGER
 * @property {string} id - The plugin ID that failed.
 * @property {string} message - Human-readable error message shown to the user.
 */
interface PluginFailedEvent {
    id: string;
    message: string;
}

/**
 * Raised when a singleton module is created for a viewer (or globally).
 *
 * @event module-singleton-created
 * @memberof VIEWER_MANAGER
 * @property {string} id - The module ID.
 * @property {IXOpatModuleSingleton | IXOpatViewerSingletonModule} module - The created singleton.
 * @property {undefined} viewer - Always undefined; use `module.viewer` for viewer-scoped singletons.
 */
interface ModuleSingletonCreatedEvent {
    /** module id */
    id: string;
    module: IXOpatModuleSingleton | IXOpatViewerSingletonModule;
    viewer: undefined;
}

interface ViewerSingletonCreatedEvent {
    id: string;
    module: IXOpatViewerSingleton;
    viewer: OpenSeadragon.Viewer;
}

// ── Viewer broadcast events (raised via broadcastHandler on every viewer) ─────

/**
 * Fire this event to report a warning without explicit handling.
 * Recommended in modules where a plugin should get a chance to handle it.
 * If not handled (`preventDefault` not set), the core shows a warning dialog.
 *
 * @event warn-user
 * @memberof OpenSeadragon.Viewer
 * @property {string} originType - `"module"`, `"plugin"` or other source type.
 * @property {string} originId - Unique component ID, e.g. a plugin ID.
 * @property {string} code - Unique error identifier, e.g. `"W_MY_MODULE_ERROR"`.
 * @property {string} message - Brief human-readable description of the case.
 * @property {boolean} preventDefault - If true, the core will not show the default dialog.
 * @property {unknown} [trace] - Optional data or context object, e.g. an Error instance.
 */
interface ErrorUserEvent {
    originType: "module" | "plugin";
    originId: string;
    code: string;
    message: string;
    preventDefault: boolean;
    trace?: unknown;
}
;
// ── Viewer loading / open events ──────────────────────────────────────────────

/**
 * Raised before the first data open cycle begins. Handlers may modify
 * `event.data`, `event.background`, or `event.visualizations` to override
 * what will be loaded.  Awaitable via `raiseEventAwaiting`.
 *
 * @event before-first-open
 * @memberof VIEWER_MANAGER
 * @property {DataID[]} data - Global data identifiers array.
 * @property {BackgroundItem[]} background - Background configuration array.
 * @property {VisualizationItem[]} visualizations - Visualization configuration array.
 */
interface BeforeFirstOpenEvent {
    data: DataID[];
    background: BackgroundItem[];
    visualizations: VisualizationItem[];
}

/**
 * Raised before any open/reload cycle. Handlers may inspect or modify the
 * incoming data.  Awaitable via `raiseEventAwaiting`.
 *
 * @event before-open
 * @memberof VIEWER_MANAGER
 * @property {DataID[]} data - Global data identifiers array.
 * @property {BackgroundItem[]} background - Background configuration array.
 * @property {VisualizationItem[]} visualizations - Visualization configuration array.
 * @property {number | number[] | null} [bgSpec] - Requested background index selection.
 * @property {number | number[] | null} [vizSpec] - Requested visualization index selection.
 */
interface BeforeOpenEvent {
    data: DataID[];
    background: BackgroundItem[];
    visualizations: VisualizationItem[];
    bgSpec?: number | number[] | null;
    vizSpec?: number | number[] | null;
}

/**
 * Raised after all viewers have been opened and tiles have begun loading.
 * No properties beyond the standard event source.
 *
 * @event after-open
 * @memberof VIEWER_MANAGER
 */
interface AfterOpenEvent {
    // intentionally empty — standard event source only
}

/**
 * Raised when a tile source has been successfully resolved and instantiated,
 * but before the tiled image is added to the viewer world.
 * Awaitable via `raiseEventAwaiting`.
 *
 * @event tile-source-created
 * @memberof OpenSeadragon.Viewer
 * @property {OpenSeadragon.Viewer} viewer - The viewer the tile will be added to.
 * @property {string | object | OpenSeadragon.TileSource} originalSource - The original source specifier.
 * @property {"background" | "visualization"} kind - The kind of layer being opened.
 * @property {number} index - The world index the tile will be inserted at.
 * @property {OpenSeadragon.TileSource} tileSource - The resolved tile source instance.
 * @property {null} error - Always null on success.
 */
interface TileSourceCreatedEvent {
    viewer: OpenSeadragon.Viewer;
    originalSource: string | object | OpenSeadragon.TileSource;
    kind: "background" | "visualization";
    index: number;
    tileSource: OpenSeadragon.TileSource;
    error: null;
}

/**
 * Raised when a tile source fails to resolve or instantiate.
 * Awaitable via `raiseEventAwaiting`.
 *
 * @event tile-source-failed
 * @memberof OpenSeadragon.Viewer
 * @property {OpenSeadragon.Viewer} viewer - The viewer that attempted to open the tile.
 * @property {string | object | OpenSeadragon.TileSource} originalSource - The original source specifier.
 * @property {"background" | "visualization"} kind - The kind of layer that failed.
 * @property {number} index - The world index that would have been used.
 * @property {null} tileSource - Always null on failure.
 * @property {string} error - Human-readable error message.
 */
interface TileSourceFailedEvent {
    viewer: OpenSeadragon.Viewer;
    originalSource: string | object | OpenSeadragon.TileSource;
    kind: "background" | "visualization";
    index: number;
    tileSource: null;
    error: string;
}