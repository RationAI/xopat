// ── Shared ambient types — visible in all files (no export{} here) ───────────

/**
 * Arbitrary Data identifier such that image server can understand it (most often UUID4 or file paths, but might be an object
 * if certain `TileSource` uses more complex syntax). The value is passed to TileSource::supports() check to select
 * the target protocol handler. Provide a value for your tile source which talks to the server of your choice.
 */
type DataID = string | Record<string, any>;

/**
 * Data Specification is the virtual representation of the data item. It can either directly specify the data item,
 * or, it can contain a more-broad data specification overriding the default behavior of the data source integration.
 */
type DataSpecification = DataID | DataOverride;

/**
 * A more holistic data specification, which can provide custom options for the target protocol (underlying TileSource API),
 * and override the default fetching behavior (e.g. to use a custom data source).
 * @property dataID actual data value, required - its presence is used to identify this object is DataOverride type
 * @property options passed to the data source integration logics - TileSource class
 * @property microns size of pixel in micrometers, default `undefined`,
 * @property micronsX horizontal size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property micronsY vertical size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property protocol Name of a protocol registered in `window.SLIDE_PROTOCOLS` (always safe, including secure mode).
 *    In non-secure mode the value may alternatively be a raw backtick-template URL string (legacy compatibility,
 *    discouraged) — rejected in secure mode with a warning.
 * @property tileSource DEPRECATED: a pre-built tileSource object. Kept for one deprecation cycle; plugins should
 *    register a factory protocol with `SLIDE_PROTOCOLS.register({ id, createTileSource })` and reference it via
 *    `protocol` instead. The pre-built TileSource is not serializable and breaks URL/POST roundtripping.
 */
interface DataOverride {
    dataID: DataID;
    options?: SlideSourceOptions;
    microns?: number;
    micronsX?: number;
    micronsY?: number;
    protocol?: string;
    tileSource?: OpenSeadragon.TileSource;
    /**
     * By default enabled, allows turning off data sampling interpolation.
     */
    imageSmoothingEnabled?: boolean;
    /**
     * Present when this spec resolves a *virtual* (cropped) source via the
     * `virtual-region` protocol. Carries the crop + alignment so the
     * `virtual-region` factory can wrap the parent (resolved from `dataID`).
     * Threaded onto BOTH a virtual child's background image spec and — at
     * resolution time — every visualization data layer of that child, so the
     * whole co-registered stack crops together. See the virtual-viewports plan.
     */
    croppingContext?: VirtualCroppingContext;
}

/**
 * A rectangular sub-region of a slide, expressed as RELATIVE fractions (0..1)
 * of the source's own full-resolution dimensions — NOT absolute pixels. Using
 * fractions lets co-registered sources of different resolution but the same
 * aspect ratio (e.g. a low-res overlay vs the H&E background) crop to the same
 * proportional region and overlap. Each `CroppedTileSource` converts these
 * fractions to pixels against its own parent.
 */
interface VirtualRegionRect {
    /** Left edge as a fraction of width (0..1). */
    x: number;
    /** Top edge as a fraction of height (0..1). */
    y: number;
    /** Width as a fraction of full width (0..1). */
    w: number;
    /** Height as a fraction of full height (0..1). */
    h: number;
}

/**
 * Affine that maps a region into the shared *registration frame* so multiple
 * virtual sources of the same physical slide can be aligned (rendered atop one
 * another, or carry overlays across render modes).
 */
interface VirtualRegionTransform {
    /** Translation in registration-frame pixels (applied after rotation/flip). */
    dx: number;
    dy: number;
    /** Clockwise rotation in degrees about the region origin. */
    rotation: number;
    /** Horizontal flip of the region about its own vertical axis. */
    flip: boolean;
}

/**
 * The spatial descriptor a virtual (cropped) source carries: `region` crops the
 * parent; `transform` aligns the crop into the registration frame shared by all
 * siblings.
 */
interface VirtualCroppingContext {
    region: VirtualRegionRect;
    transform: VirtualRegionTransform;
}

/** One region produced by a virtualization probe. */
interface VirtualRegion extends VirtualCroppingContext {
    /** Stable per-region id; suffix used to build the child background id. */
    id: string;
}

/**
 * Result of `TileSource.probeVirtualization()` — a slide-wide spatial partition
 * the background owns; every co-registered source above the background inherits
 * it. A `null` return (not this type) means "no virtualization for this source".
 */
interface VirtualDecomposition {
    /** Detector that produced this decomposition (provenance / re-probe routing). */
    detectorId: string;
    /**
     * The parent the regions crop from, referenced the standard way: an index
     * into `config.data` (preferred — enables cross-referencing) or the `DataID`
     * value. When omitted, it defaults to the `dataReference` of the background
     * that owns this decomposition.
     */
    dataReference?: number | DataID;
    regions: VirtualRegion[];
}

/** Render policy for a virtualized parent background. */
type VirtualizationMode = "none" | "sidebyside" | "overlaid";

/**
 * Ggeneric value map, where some values are already pre-defined:
 * @property format the desired format to use, can be arbitrary but when sources can, it's optimal to support
 *   browser-standard values like png, tiff, jpeg/jpg
 */
interface SlideSourceOptions {
    format?: string;
    [key: string]: any;
}

/**
 * Slide Metadata
 * @property info - info object that is used to store all information about the slide a user should see, if not provided, the whole return value is treated also as user info.
 * @property error - error, if present, the slide is treated as errorenous with the cause taken as the value
 * @property microns - The microns in average.
 * @property micronsX - The pixel size in X direction, can be used instead of microns.
 * @property micronsY - The pixel size in Y direction, can be used instead of microns.
 */
interface TileSourceMetadata {
    info?: object;
    error?: string;
    microns?: number;
    micronsX?: number;
    micronsY?: number;
}

/**
 * One displayable scalar inside a {@link TileSourceDisplaySection}. The renderer
 * formats `value` directly — no functions, no nested objects.
 */
interface TileSourceDisplayField {
    label: string;
    value: string | number | boolean | null;
}

/**
 * One card in the Slide Information panel. `fields` renders as a key/value
 * grid; `description` renders as a paragraph; either or both may be set.
 */
interface TileSourceDisplaySection {
    title?: string;
    description?: string;
    fields?: TileSourceDisplayField[];
}

/**
 * Ordered list of cards returned by `TileSource.getDisplayMetadata()`. Tightens
 * the user-facing shape so the slide-info panel never has to introspect raw
 * TileSource instances. See `src/tile-source.ts` for the default and contract.
 */
type TileSourceDisplayMetadata = TileSourceDisplaySection[];
/**
 * @property dataReference index to the `data` array, can be only one unlike in `shaders`, required - marks the target data item others refer to (e.g. in measurements)
 * @property shaders array of optional rendering specification
 * @property protocol deprecated on background object. Name of a protocol registered in `window.SLIDE_PROTOCOLS`. In non-secure mode the value may
 *    also be a raw backtick-template URL string (legacy compatibility, discouraged).
 * @property name custom tissue name, default the tissue path
 * @property sessionName overrides the global params.sessionName for this background
 * @property visualizationIndex the per-background visualization selection — the index into `config.visualizations`
 *    that this background renders. Authoritative source of truth for per-viewer viz binding; viewer slot k displays
 *    `config.background[activeBackgroundIndex[k]].visualizationIndex`. `null` means "no overlay for this background".
 *    Slot reordering / insertion / deletion preserves the bg→viz binding.
 * @property id unique ID for the background, created automatically from data path if not defined
 */
interface BackgroundItem {
    dataReference: number | DataSpecification;
    shaders?: VisualizationShaderGroupOrLayer[];
    lossless?: boolean;
    protocol?: string;
    microns?: number;
    micronsX?: number;
    micronsY?: number;
    name?: string;
    sessionName?: string;
    visualizationIndex?: number | null;
    id?: string;
    options?: SlideSourceOptions;
    /**
     * Present on a *parent* background that owns a stored decomposition
     * (probe-then-persist). Drives `expandVirtualBackgrounds` to materialize
     * first-class child backgrounds, one per region.
     */
    virtualization?: VirtualDecomposition;
    /**
     * Render policy for a virtualized parent. Runtime-switchable via
     * `setVirtualizationMode`; defaults to `"none"`.
     */
    virtualizationMode?: VirtualizationMode;
    /**
     * Present on an *expanded child*: the id of the parent background it was
     * derived from. Used to detect already-expanded children (idempotency) and
     * to group siblings.
     */
    virtualOf?: string;
    /**
     * Present on an expanded child: the crop + alignment this child renders.
     * Read by the open pipeline to crop the child's visualization data layers
     * to the same region as its background image.
     */
    croppingContext?: VirtualCroppingContext;
    [key: string]: any;
}

/**
 * Like BackgroundItem, but instead of dataReference, it contains a DataSpecification object.
 * @property dataReference actual value of the data item. Used when processing offscreen data for
 * session-unrelated things (such as thumbnail preview for custom data).
 */
interface StandaloneBackgroundItem extends BackgroundItem {
    dataReference: DataSpecification;
}


/**
 * @property shaders array of shader specifications
 * @property protocol deprecated on visualization object.  Name of a protocol registered in `window.SLIDE_PROTOCOLS`. In non-secure mode the value may
 *    also be a raw backtick-template URL string (legacy compatibility, discouraged).
 * @property name custom tissue name, default the tissue path
 * @property goalIndex preferred visualization index when this item is selected
 */
interface VisualizationItem {
    shaders: Record<string, VisualizationShaderGroupOrLayer>;
    lossless?: boolean;
    protocol?: string;
    name?: string;
    goalIndex?: number;
    [key: string]: any;
}

interface VisualizationShaderLayer {
    type?: string;
    id?: string;
    // Data References come from outside, point to data array spec
    dataReferences?: number[];
    // Tiled image references, point to actual TIs loaded at the viewer world
    tiledImages?: number[];
    name?: string;
    [key: string]: any;
}

interface VisualizationShaderGroup extends VisualizationShaderLayer {
    type: "group";
    // Group layers can nest additional shader layers
    shaders?: Record<string, VisualizationShaderGroupOrLayer>;
    // Group layers can override child execution order
    order?: string[];
}

type VisualizationShaderGroupOrLayer = VisualizationShaderLayer | VisualizationShaderGroup;

// ── BackgroundConfig ─────────────────────────────────────────────────────────
interface BackgroundConfigConstructor {
    new(data: BackgroundItem, guard: symbol): BackgroundConfig;
    from(config: BackgroundItem, registerAsSource?: boolean): BackgroundConfig;
    data(item: BackgroundItem): DataID | undefined;
    dataSpecification(item: BackgroundItem): DataSpecification | undefined;
    dataFromSpec(spec: DataSpecification | null | undefined): DataID | undefined;
    dataFromDataId(dataId: number | DataID): DataID | undefined;
    processId(id: string | undefined, context: BackgroundItem): string;
}

interface BackgroundConfig extends BackgroundItem {
    readonly id: string;
    _rawValue: DataID | null;
    _raw: any;
    toJSON(): BackgroundItem & { dataReference: number | DataID };
}

// ── HistoryProvider ──────────────────────────────────────────────────────────
interface HistoryProviderConstructor {
    new(): HistoryProvider;
}

interface HistoryProvider {
    readonly importance: number;
    undo(): Promise<boolean>;
    redo(): Promise<boolean>;
    canUndo(): boolean;
    canRedo(): boolean;
}

// ── XOpatHistory ─────────────────────────────────────────────────────────────
/**
 * Metadata stored alongside a history entry.
 * @property name  Human-readable label shown in the UI, e.g. "Create annotation".
 *   The app bar renders this as "Undo {{name}}" / "Redo {{name}}".
 * @property type  Optional machine-readable action identifier (e.g. "annotations.import").
 *   Useful for programmatic history inspection or analytics.
 */
interface HistoryEntryMeta {
    /** Human-readable label displayed in "Undo {{name}}" / "Redo {{name}}" UI. */
    name?: string;
    /** Machine-readable action identifier, e.g. "annotations.import". */
    type?: string;
    [key: string]: any;
}

interface HistoryProviderConstructor {
    new(): HistoryProvider;
}

interface HistoryProvider {
    readonly importance: number;
    undo(): Promise<boolean>;
    redo(): Promise<boolean>;
    canUndo(): boolean;
    canRedo(): boolean;
    reset?(): Promise<void>;
}

interface XOpatHistoryConstructor {
    new(size?: number): XOpatHistory;
}

interface XOpatHistory extends OpenSeadragon.EventSource {
    BUFFER_LENGTH: number;
    _buffer: Array<{ forward: () => any; backward: () => any; meta?: HistoryEntryMeta } | null>;
    _buffidx: number;
    _lastValidIndex: number;
    _providers: HistoryProvider[];
    _recordingDepth: number;
    _queue: Promise<any>;
    _busyCount: number;
    _queuedCount: number;

    set size(value: number);

    registerProvider(provider: HistoryProvider): () => boolean;
    unregisterProvider(provider: HistoryProvider): boolean;

    hasStackUndo(): boolean;
    hasStackRedo(): boolean;
    hasAnyStackHistory(): boolean;

    /** Returns the meta of the entry that would be undone next, or undefined. */
    currentUndoMeta(): HistoryEntryMeta | undefined;
    /** Returns the meta of the entry that would be redone next, or undefined. */
    currentRedoMeta(): HistoryEntryMeta | undefined;

    clear(options?: {
        resetProviders?: boolean;
        reason?: string;
        [key: string]: any;
    }): Promise<void>;

    push(
        forward: () => any,
        backward: () => any,
        meta?: HistoryEntryMeta
    ): Promise<any>;

    pushExecuted(
        forward: () => any,
        backward: () => any,
        meta?: HistoryEntryMeta
    ): Promise<void>;

    readonly isRecordingEnabled: boolean;
    withoutRecording<T>(operation: () => Promise<T> | T): Promise<T>;

    undo(): Promise<boolean>;
    redo(): Promise<boolean>;
    canUndo(): boolean;
    canRedo(): boolean;

    isBusy(): boolean;
    pendingCount(): number;
    whenIdle(): Promise<void>;
}

type ViewerOpenOptions = {
    deriveOverlayFromBackgroundGoals?: boolean;
    dataMode?: "replace" | "merge" | "merge-exact";
    backgroundMode?: "replace" | "merge" | "merge-exact";
    historyMode?: "auto" | "skip" | "visualization-step" | "content-switch" | "reset-history";
    fromHistory?: boolean;
    preserveHistoryOnBackgroundChange?: boolean;
    warnOnHistoryBoundary?: boolean;
    historyLabel?: string;
    strictVisualization?: boolean;
    skipVisualizationCapabilityCheck?: boolean;
    suppressDialogsOnVisualizationFailure?: boolean;
};

type ViewerSelectionPatch = {
    backgroundIndex?: number | null;
    visualizationIndex?: number | null;
};

interface ApplicationContext {
    config: ApplicationContextConfig;
    AppCache: any;
    AppCookies: any;
    Scripting: any;
    httpClient: any;
    history: XOpatHistory;
    /** Core network connectivity source of truth (`classes/network-status.ts`). */
    networkStatus: NetworkStatusLike;
    /** Central keyboard-shortcut registry + dispatcher (`classes/app/shortcut-manager.ts`). See src/SHORTCUTS.md. */
    shortcuts: ShortcutManagerLike;
    readonly sessionName: string;
    readonly secureMode: boolean;
    readonly env: any;
    readonly url: string;
    readonly settingsMenuId: string;
    readonly pluginsMenuId: string;
    getOption(name: string, defaultValue?: any, cache?: boolean, parse?: boolean): any;
    setOption(name: string, value: any, cache?: boolean): void;
    /** Read a UI initial-visibility flag with the full fallback chain (params.ui → legacy flat → defaults → true). */
    getUiOption(key: keyof XOpatUiSetup): boolean;
    /** Persist a UI initial-visibility flag into params.ui[key] (and AppCache under the legacy key). */
    setUiOption(key: keyof XOpatUiSetup, value: boolean, cache?: boolean): void;
    /**
     * Boot-phase-only variant of {@link getUiOption}: honors `params.ui[key]`
     * only until {@link setUiBootComplete} is called. After boot, components
     * created later (toolbars, viewers, …) fall through to AppCache/defaults
     * instead of being silently force-hidden by a session flag.
     */
    getInitialUiOption(key: keyof XOpatUiSetup): boolean;
    /** True once the initial viewer has opened — `getInitialUiOption` flips after this. */
    isUiBootComplete(): boolean;
    /** Idempotently flips the boot-phase gate; called by the lifecycle controller. */
    setUiBootComplete(): void;
    setDirty(): void;
    pluginIds(): string[];
    activePluginIds(): string[];
    referencedName(stripSuffix?: boolean): string | undefined;
    referencedId(): string;
    activeVisualizationConfig(): VisualizationItem | undefined;
    registerConfig(bg: BackgroundItem): BackgroundConfig;
    sameBackground(a: BackgroundItem | BackgroundConfig, b: BackgroundItem | BackgroundConfig): boolean;
    generateID(seed: string): string;
    serializeApp(withCookies?: boolean, staticPreview?: boolean): any;
    prepareRendering(): void;
    beginApplicationLifecycle(data: DataID[], background: BackgroundItem[], visualizations?: VisualizationItem[]): Promise<void>;
    openViewerWith(
        data?: DataID[],
        background?: BackgroundItem[],
        visualizations?: VisualizationItem[],
        bgSpec?: number | Array<number | undefined> | null,
        vizSpec?: number | Array<number | undefined> | null,
        opts?: ViewerOpenOptions
    ): Promise<boolean>;
    replaceVisualizations(visualizations: VisualizationItem[], newData?: DataID[], activeVizIndex?: number | number[]): Promise<boolean>;
    updateVisualization(visualizations: VisualizationItem[], newData?: DataID[], activeVizIndex?: number | number[]): Promise<boolean>;
    updateViewerSelection(
        viewerIndex: number,
        selection: ViewerSelectionPatch,
        opts?: ViewerOpenOptions
    ): Promise<boolean>;
    _dangerouslyAccessConfig(): any;
    _dangerouslyAccessPlugin(id: string): any;
    __cache: { dirty: boolean };
}

// ── APPLICATION_CONTEXT ───────────────────────────────────────────────────────
interface ApplicationContextConfig {
    readonly params: Record<string, any>;
    readonly defaultParams: Record<string, any>;
    readonly data: DataID[];
    readonly background: BackgroundConfig[];
    readonly visualizations: VisualizationItem[];
    readonly plugins: Record<string, any>;
}

interface ApplicationContext {
    config: ApplicationContextConfig;
    // TODO: proper types
    AppCache: any;
    AppCookies: any;
    Scripting: any;
    httpClient: any;
    history: XOpatHistory;
    /** Core network connectivity source of truth (`classes/network-status.ts`). */
    networkStatus: NetworkStatusLike;
    /** Core auth broker — "require login" registry over XOpatUser (`classes/auth/xopat-auth.ts`). See src/AUTH.md. */
    auth: XOpatAuthLike;
    /** Central keyboard-shortcut registry + dispatcher (`classes/app/shortcut-manager.ts`). See src/SHORTCUTS.md. */
    shortcuts: ShortcutManagerLike;
    /**
     * Canonical scene snapshot/restore (`classes/app/canonical-scene.ts`) — THE
     * stable interface for capturing and re-applying the full viewer session.
     * Full-state snapshot/restore must go through this, never hand-rolled
     * config clones; `openViewerWith` remains the apply primitive for targeted
     * switches.
     */
    scene: XOpatSceneApi;
    readonly sessionName: string;
    readonly secureMode: boolean;
    readonly env: any;
    readonly url: string;
    readonly settingsMenuId: string;
    readonly pluginsMenuId: string;
    getOption(name: string, defaultValue?: any, cache?: boolean, parse?: boolean): any;
    setOption(name: string, value: any, cache?: boolean): void;
    /** Read a UI initial-visibility flag with the full fallback chain (params.ui → legacy flat → defaults → true). */
    getUiOption(key: keyof XOpatUiSetup): boolean;
    /** Persist a UI initial-visibility flag into params.ui[key] (and AppCache under the legacy key). */
    setUiOption(key: keyof XOpatUiSetup, value: boolean, cache?: boolean): void;
    /**
     * Boot-phase-only variant of {@link getUiOption}: honors `params.ui[key]`
     * only until {@link setUiBootComplete} is called. After boot, components
     * created later (toolbars, viewers, …) fall through to AppCache/defaults
     * instead of being silently force-hidden by a session flag.
     */
    getInitialUiOption(key: keyof XOpatUiSetup): boolean;
    /** True once the initial viewer has opened — `getInitialUiOption` flips after this. */
    isUiBootComplete(): boolean;
    /** Idempotently flips the boot-phase gate; called by the lifecycle controller. */
    setUiBootComplete(): void;
    setDirty(): void;
    pluginIds(): string[];
    activePluginIds(): string[];
    referencedName(stripSuffix?: boolean): string | undefined;
    referencedId(): string;
    activeVisualizationConfig(): VisualizationItem | undefined;
    registerConfig(bg: BackgroundItem): BackgroundConfig;
    sameBackground(a: BackgroundItem | BackgroundConfig, b: BackgroundItem | BackgroundConfig): boolean;
    generateID(seed: string): string;
    serializeApp(withCookies?: boolean, staticPreview?: boolean): any;
    prepareRendering(): void;
    beginApplicationLifecycle(data: DataID[], background: BackgroundItem[], visualizations?: VisualizationItem[]): Promise<void>;
    openViewerWith(
        data?: DataID[],
        background?: BackgroundItem[],
        visualizations?: VisualizationItem[],
        bgSpec?: number | Array<number | undefined> | null,
        vizSpec?: number | Array<number | undefined> | null,
        opts?: ViewerOpenOptions
    ): Promise<boolean>;
    replaceVisualizations(visualizations: VisualizationItem[], newData?: DataID[], activeVizIndex?: number | number[]): Promise<boolean>;
    updateVisualization(visualizations: VisualizationItem[], newData?: DataID[], activeVizIndex?: number | number[]): Promise<boolean>;
    updateViewerSelection(
        viewerIndex: number,
        selection: ViewerSelectionPatch,
        opts?: ViewerOpenOptions
    ): Promise<boolean>;
    _dangerouslyAccessConfig(): any;
    _dangerouslyAccessPlugin(id: string): any;
    __cache: { dirty: boolean };
}

/**
 * One JSON shape fully describing a viewer session — data, per-slot
 * backgrounds (with per-bg visualization binding + live shader state merged
 * in), visualizations, active slot selection, and optional per-viewer
 * viewports. Mirrors `CanonicalScene` in `classes/app/canonical-scene.ts`.
 */
interface CanonicalSceneLike {
    version: 1;
    data: any[];
    background: any[];
    visualizations: any[];
    activeBackgroundIndex?: Array<number | undefined>;
    viewers?: Array<{ uniqueId: string; viewport?: ViewportSetup }>;
}

/** Public surface of `APPLICATION_CONTEXT.scene` (see `classes/app/canonical-scene.ts`). */
interface XOpatSceneApi {
    /** Snapshot the current session; `includeViewport` adds per-viewer pan/zoom/rotation. */
    serialize(opts?: { includeViewport?: boolean }): CanonicalSceneLike;
    /** Single-viewer slice (playground Apply). */
    serializeFromViewer(
        viewer: OpenSeadragon.Viewer,
        init?: { background?: any[]; visualization?: any },
        live?: any,
    ): { background: any[]; visualization: any };
    /** Re-apply a snapshot via the open pipeline; restores viewports when present. */
    deserialize(
        scene: CanonicalSceneLike,
        opts?: {
            historyMode?: "auto" | "skip" | "content-switch" | "visualization-step" | "reset-history";
            historyLabel?: string;
        },
    ): Promise<void>;
    /** The blessed per-viewer viewport getter (`{ zoomLevel, point, rotation }`). */
    snapshotViewport(viewer: OpenSeadragon.Viewer): ViewportSetup | undefined;
    /** The blessed per-viewer viewport setter; returns false on invalid input. */
    applyViewport(viewer: OpenSeadragon.Viewer, viewport: ViewportSetup | null | undefined, animate?: boolean): boolean;
}

/**
 * Central keyboard-shortcut registry + dispatcher surface — runtime class is
 * `ShortcutManager` (`src/classes/app/shortcut-manager.ts`), an
 * OpenSeadragon.EventSource raising `shortcut-registered`,
 * `shortcut-unregistered`, `binding-changed` and `bindings-reset`.
 * See src/SHORTCUTS.md.
 */
interface ShortcutManagerLike {
    register(spec: {
        id: string;
        titleKey: string;
        descriptionKey?: string;
        categoryPath: string[];
        defaultCombos: string[];
        owner?: string;
        type: "press" | "hold";
        trigger?: "down" | "up";
        scope?: { requiresCanvasFocus?: boolean; allowInInputs?: boolean };
        preventDefault?: boolean;
        handler?: (ctx: { event: KeyboardEvent | null; viewer: any; shortcutId: string }) => void;
        onPress?: (ctx: { event: KeyboardEvent | null; viewer: any; shortcutId: string }) => void;
        onRelease?: (ctx: { event: KeyboardEvent | null; viewer: any; shortcutId: string }) => void;
    }): { unregister(): void };
    unregister(id: string): void;
    unregisterAll(owner: string): void;
    getBinding(id: string): { combos: string[]; isDefault: boolean; suppressed: string[] } | null;
    list(): any[];
    findConflicts(combo: string, excludeId?: string): string[];
    setUserBinding(id: string, combos: string[] | null): void;
    resetToDefault(id: string): void;
    resetAllToDefaults(): void;
    /** Binding-aware event matching for registrants that keep their own key loop. */
    eventMatches(id: string, e: KeyboardEvent): boolean;
    eventMatchesToken(id: string, e: KeyboardEvent): boolean;
    /** Canonical combo of a live key event (null for pure-modifier presses). */
    comboFromEvent(e: KeyboardEvent): string | null;
    /** Human-readable chip labels of a canonical combo. */
    comboDisplayParts(combo: string): string[];
    isValidCombo(combo: string): boolean;
    attach(viewerManager: any): void;
    addHandler(eventName: string, handler: (e: any) => void, userData?: any, priority?: number): void;
    removeHandler(eventName: string, handler: (e: any) => void): void;
}

/**
 * Core auth broker surface (`classes/auth/xopat-auth.ts`). A feature declares a
 * login context with {@link configureContext}, then gates on {@link isAuthenticated}
 * / triggers {@link login}. Auth methods (OIDC now, SAML later) register via
 * {@link registerBroker}. See src/AUTH.md.
 */
interface XOpatAuthLike {
    registerBroker(method: string, broker: any): void;
    hasBroker(method: string): boolean;
    hasContext(contextId: string): boolean;
    getContextConfig(contextId: string): any;
    configureContext(cfg: { contextId: string; method: string; config?: any; serviceName?: string; tokenForServer?: string; [k: string]: any }): Promise<void>;
    initContext(contextId: string): Promise<void>;
    isAuthenticated(contextId: string): boolean;
    getToken(contextId: string): any;
    login(contextId: string): Promise<boolean>;
    logout(contextId: string): Promise<void>;
    onChange(cb: (contextId: string) => void): () => void;
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
interface XOpatUtilities {
    fileNameFromPath(imageFilePath: string, stripSuffix?: boolean): string;
    nameFromBGOrIndex(indexOrItem: number | BackgroundItem | BackgroundConfig, stripSuffix?: boolean): string;
    currentBackgroundIdFor(viewer: OpenSeadragon.Viewer | undefined): string | undefined;
    stripSuffix(path: string): string;

    loadModules(onload?: () => void, ...ids: string[]): void;
    loadPlugin(id: string, onload?: ((...args: any[]) => any) | undefined, force?: boolean): void;
    isLoaded(id: string, isPlugin?: boolean): boolean | IXOpatPlugin | undefined;

    serializeApp(
        includedPluginsList?: string[],
        withCookies?: boolean,
        staticPreview?: boolean
    ): Promise<{ app: string; data: Record<string, any> }>;

    serializeAppConfig(withCookies?: boolean, staticPreview?: boolean): string;

    getForm(
        customAttributes?: string,
        includedPluginsList?: string[],
        withCookies?: boolean
    ): Promise<string>;

    export(): Promise<void>;

    generateID(input: any, size?: number): string;
    sanitizeID(input: any): string;
    uuid4(): string;

    copyToClipboard(content: string, alert?: boolean): void;
    copyUrlToClipboard(): void;
    makeScreenshot(): void;

    makeThrottled<T extends (...args: any[]) => any>(
        fn: T,
        delay: number
    ): T & { finish(): void };

    sleep(ms?: number): Promise<void>;
    updateTheme(theme: string | null): void;

    syncSessionToUrl(withCookies?: boolean): boolean;

    applyStoredVisualizationSnapshot(renderOutput: Record<string, any>): void;

    syncViewerConfigFromRenderer(viewer: OpenSeadragon.Viewer): void;

    /** Debounced (~1s) UTILITIES.syncSessionToUrl so reload preserves edits. */
    scheduleSessionUrlSync(): void;

    setImageMeasurements(
        viewer: OpenSeadragon.Viewer,
        microns: number | undefined,
        micronsX: number | undefined,
        micronsY: number | undefined,
        name: string | undefined
    ): void;

    parseBackgroundSelection(
        bgSpec?: number | Array<number | undefined> | null
    ): boolean;

    toggleVisualizationInspector(enabled?: boolean): boolean;

    toggleValueInspector(enabled?: boolean): boolean;

    setVisualizationInspectorRadius(radiusPx: number): number;

    adjustVisualizationInspectorRadius(deltaPx: number): number;

    setVisualizationInspectorMode(mode: string): string;

    storePageState(includedPluginsList?: Record<string, any>): boolean;

    setIsCanvasFocused(focused: boolean | OpenSeadragon.Viewer | null): void;

    [key: string]: any;
}

