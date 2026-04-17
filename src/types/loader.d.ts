// ── xOpat Element system types — ambient globals ─────────────────────────────
// Types shared between loader.ts, app.ts, and any code that deals with
// xOpat plugins, modules, and viewer singletons.
// Note: no top-level import/export — this file must remain an ambient script.


// ── Viewer ID types ───────────────────────────────────────────────────────────

/**
 * Unique ID per viewer data-session. Accessed as `viewer.uniqueId`.
 * Related to any data-like function and logics.
 * Do not mix with {@link ViewerId} (`viewer.id`).
 */
type UniqueViewerId = string;

/**
 * ID per viewer container slot. Accessed as `viewer.id`.
 * Related to UI-like functions where we don't care about the particular
 * viewer instance, but its screen position.
 */
type ViewerId = string;

/**
 * Syntax sugar for methods that accept either a viewer instance or its
 * unique session ID.
 */
type ViewerLikeItem = OpenSeadragon.Viewer | UniqueViewerId;

// ── Element identity types ────────────────────────────────────────────────────

/** Element ID unique to instance — either a plugin ID or a module ID. */
type XOpatElementID = string;

/** Execution context of an xOpat element. */
type XOpatExecutionContext = "plugin" | "module";

// ── Error / event types ───────────────────────────────────────────────────────

/**
 * Error event object passed to `element.error()` / `element.warn()`.
 */
type XOpatErrorEvent = {
    code: string;
    message: string;
    error?: any;
};

// ── Store options ─────────────────────────────────────────────────────────────

/**
 * Options for PostDataStore, extending the base StorageOptions.
 * @property {string} id - Storage namespace id (see StorageOptions).
 * @property {XOpatExecutionContext} xoType - Owner type: 'plugin' or 'module'.
 * @property {boolean} [inViewerContext] - If true, POST IO depends on viewer context.
 * @property {string} [exportKey] - Optional export key for globally exported data.
 */
type PostDataStoreOptions = {
    /** Storage namespace id (mirrors StorageOptions.id) */
    id: string;
    /** Schema for key validation) */
    schema?: StorageSchema;
    /** If true, unknown keys throw in strict mode */
    strictSchema?: boolean;
    /** Owner type: 'plugin' or 'module' */
    xoType: XOpatExecutionContext;
    /** If true, the POST IO depends on viewer context */
    inViewerContext?: boolean;
    /** Optional export key for globally exported data */
    exportKey?: string;
};

/** Getter that returns a named UI item for a viewer menu tab. */
type UINamedItemGetter = (viewer: OpenSeadragon.Viewer) => any;


type XOpatServerCallOptions = {
    viewerId?: string;
    contextId?: string;
    httpClient?: any;
    silent?: boolean;
};

type XOpatServerErrorPayload = {
    kind: "plugin" | "module";
    id: string;
    method: string;
    args: any[];
    error: any;
};


// ── PostDataStore (async key-value store for plugin/module data) ──────────────

/**
 * Async key-value store for plugin/module persistent data backed by POST IO.
 * @see XOpatStorage
 */
interface PostDataStore {
    get(key: string, defaultValue?: any): Promise<any>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<Array<string | null>>;
}

// ── Base element interfaces ───────────────────────────────────────────────────


/**
 * Base interface for all xOpat elements (plugins and modules).
 * Extends OpenSeadragon.EventSource with xOpat-specific lifecycle and I/O API.
 *
 * @interface IXOpatElement
 * @extends OpenSeadragon.EventSource
 */
interface IXOpatElement extends OpenSeadragon.EventSource {
    __id: string;
    __uid: string;
    __xoContext: XOpatExecutionContext;

    /** Element ID as defined in `include.json` */
    readonly id: XOpatElementID;
    /** Unique runtime instance ID */
    readonly uid: string;
    /** Execution context: 'plugin' | 'module' */
    readonly xoContext: XOpatExecutionContext;
    /** Per-element synchronous cache */
    readonly cache: InstanceType<typeof XOpatStorage.Cache>;
    /** Async POST data store for this element */
    readonly POSTStore: PostDataStore;

    /** Return localisation file URL for the given locale. */
    getLocaleFile(locale: string): string;
    /** Translate a key using the element's locale bundle. */
    t(key: string, options?: Record<string, any>): any;

    /**
     * Report an error to the user.
     * @param e - Error details
     * @param notifyUser - If true, shows a user-facing error dialog
     */
    error(e: XOpatErrorEvent, notifyUser?: boolean): void;
    /**
     * Report a warning to the user.
     * @param e - Warning details
     * @param notifyUser - If true, shows a user-facing warning dialog
     */
    warn(e: XOpatErrorEvent, notifyUser: boolean): void;

    /** Initialize the POST IO store for this element. */
    initPostIO(options?: Partial<PostDataStoreOptions>): Promise<PostDataStore | undefined>;

    /** Export data by key (global context). */
    exportData(key: string): Promise<any>;
    /** Export viewer-scoped data. */
    exportViewerData(viewer: OpenSeadragon.Viewer, key: string, viewerTargetID: string): Promise<any>;
    /** Import data by key (global context). */
    importData(key: string, data: any): Promise<void>;
    /** Import viewer-scoped data. */
    importViewerData(viewer: OpenSeadragon.Viewer, key: string, viewerTargetID: string, data: any): Promise<void>;

    /** Get the viewer-specific context map for the given viewer session ID. */
    getViewerContext(id: UniqueViewerId): Record<string, any> | undefined;

    /**
     * Register a callback to run when a singleton module is available for the given viewer.
     * @param moduleId - Module ID to integrate with
     * @param callback - Called with the module instance once available
     * @param viewer - Optional viewer scope (defaults to all viewers)
     * @returns true if synchronously resolved
     */
    integrateWithSingletonModule(
        moduleId: string,
        callback: (module: IXOpatModuleSingleton) => void,
    ): boolean;

    /**
     * Register a callback to run when a singleton module is available for the given viewer.
     * @param className - The class name of the viewer singleton. Unlike singleton modules, viewer singletons are recognized by unique class name.
     * @param callback - Called with the module instance once available
     * @param viewer - Optional viewer scope (defaults to all viewers)
     * @returns true if synchronously resolved
     */
    integrateWithViewerSingletonModule(
        className: string,
        viewer: ViewerLikeItem,
        callback: (module: IXOpatViewerSingletonModule) => void,
    ): boolean;

    /** Register a named tab getter for the viewer right-side menu. */
    registerViewerMenu(getter: UINamedItemGetter): void;

    getOption(key: string, defaultValue?: any, cache?: boolean): any;
    setOption(key: string, value: any, cache?: boolean): void;
}

// ── Module interfaces ─────────────────────────────────────────────────────────

/**
 * Interface for xOpat modules (shared, non-instanced components).
 * @interface IXOpatModule
 * @extends IXOpatElement
 */
interface IXOpatModule extends IXOpatElement {
    /** Load a locale bundle for the given locale string. */
    loadLocale(locale?: string, data?: any): Promise<void>;
    /** Get a static metadata value (from `include.json`). */
    getStaticMeta(metaKey: string, defaultValue?: any): any;
    /** Get a module option from cache or config. */
    getOption(optionKey: string, defaultValue: any, cache?: boolean): any;
    /** Set a module option, optionally caching it. */
    setOption(key: string, value: any, cache?: boolean): void;

    /** Absolute root path for this module's files. */
    readonly MODULE_ROOT: string;
}

/**
 * Interface for singleton modules (loaded once, shared across all viewers).
 * @interface IXOpatModuleSingleton
 * @extends IXOpatModule
 */
interface IXOpatModuleSingleton extends IXOpatModule {
    /** Module singleton identifier string. */
    readonly THIS: string;
}

// ── Viewer singleton interfaces ───────────────────────────────────────────────

/**
 * Interface for viewer-scoped singletons (one instance per viewer).
 * These are registered via `VIEWER_MANAGER` and destroyed when the viewer is destroyed.
 *
 * @interface IXOpatViewerSingleton
 * @extends OpenSeadragon.EventSource
 */
interface IXOpatViewerSingleton extends OpenSeadragon.EventSource {
    /** The viewer this singleton is bound to. */
    readonly viewer: OpenSeadragon.Viewer;
    /** Singleton identifier string. */
    readonly THIS: string;
    /** All instances of this singleton class across all active viewers. */
    readonly instances: IXOpatViewerSingleton[];

    /** Clean up and release this singleton. Called automatically on viewer destroy. */
    destroy(): void;
}

/**
 * Interface for modules that are also viewer-scoped singletons.
 * Combines module functionality with per-viewer lifecycle management.
 *
 * @interface IXOpatViewerSingletonModule
 * @extends IXOpatModule
 * @extends IXOpatViewerSingleton
 */
interface IXOpatViewerSingletonModule extends IXOpatModule, IXOpatViewerSingleton {
    destroy(): void;
    initPostIO(options?: Partial<PostDataStoreOptions>): Promise<PostDataStore | undefined>;
}

// ── Plugin interfaces ─────────────────────────────────────────────────────────

/**
 * Interface for xOpat plugins (user-facing, instanced components).
 * Plugins are loaded dynamically and registered with `VIEWER_MANAGER`.
 *
 * @interface IXOpatPlugin
 * @extends IXOpatElement
 */
interface IXOpatPlugin extends IXOpatElement {
    /** Called after all plugins have been loaded and initialized. */
    pluginReady(): Promise<void> | void;
    /** Load a locale bundle for the given locale string. */
    loadLocale(locale?: string, data?: any): Promise<void>;
    /** Get a static metadata value (from `include.json`). */
    getStaticMeta(metaKey: string, defaultValue?: any): any;

    /** Set a plugin option, optionally caching it. */
    setOption(key: string, value: any, cache?: boolean): void;
    /** Get a plugin option from cache or config. */
    getOption(key: string, defaultValue?: any, cache?: boolean): any;
    /**
     * Get a value first from plugin options, then from static metadata, then from default.
     */
    getOptionOrConfiguration(optKey: string, staticKey: string, defaultValue?: any, cache?: boolean): any;

    /** Plugin class identifier string. */
    readonly THIS: string;
    /** Absolute root path for this plugin's files. */
    readonly PLUGIN_ROOT: string;

    /**
     * Register a callback to run when another plugin is active.
     * @returns true if synchronously resolved (other plugin already active)
     */
    integrateWithPlugin(pluginId: string, callback: (plugin: IXOpatPlugin) => void): boolean;
}

// ── Static class shapes ───────────────────────────────────────────────────────

/**
 * Constructor shape for XOpatViewerSingleton subclasses.
 * Used internally by the loader to manage singleton lifecycle.
 */
interface XOpatViewerSingletonClass extends IXOpatViewerSingleton {
    new (viewer: OpenSeadragon.Viewer): IXOpatViewerSingleton;
    /** Unique identifier for this singleton class. Used as the registry key. */
    readonly IID: string;
    /** Get or create the singleton instance for the given viewer. */
    instance(viewer: ViewerLikeItem): IXOpatViewerSingleton | undefined;
    instantiated(viewer: ViewerLikeItem): boolean;
    instances(): IXOpatViewerSingleton[];
    broadcastHandler(eventName: string, handler: Function, ...args: any[]): void;
    cancelBroadcast(eventName: string, handler: Function): void;
}

interface XOpatViewerSingletonModuleClass extends IXOpatViewerSingletonModule {
    new (id: string, viewer: OpenSeadragon.Viewer): IXOpatViewerSingletonModule;
    readonly IID: string;
    instance(viewer: ViewerLikeItem): IXOpatViewerSingletonModule | undefined;
    instantiated(viewer: ViewerLikeItem): boolean;
    instances(): IXOpatViewerSingletonModule[];
    broadcastHandler(eventName: string, handler: Function, ...args: any[]): void;
    cancelBroadcast(eventName: string, handler: Function): void;
}

/**
 * Constructor shape for generic xOpat element classes.
 */
interface XOpatElementClass extends IXOpatElement {
    new(...args: any[]): IXOpatElement;
    readonly id?: string;
}

/**
 * Constructor shape for xOpat plugin classes.
 */
interface XOpatPluginClass extends IXOpatPlugin {
    new(id: string): IXOpatPlugin;
    /** Plugin ID as declared in `include.json`. */
    readonly id: string;
    /** Absolute root path for this plugin's files. */
    readonly ROOT: string;
}
