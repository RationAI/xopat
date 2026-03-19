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
 * and override the default fetching behavior (e.g. to use a custom data source). Usage of this object is not allowed in secure mode.
 * @property dataID actual data value, required - its presence is used to identify this object is DataOverride type
 * @property options passed to the data source integration logics - TileSource class
 * @property microns size of pixel in micrometers, default `undefined`,
 * @property micronsX horizontal size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property micronsY vertical size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
 * @property protocol see protocol construction in README.md in advanced details - TODO, standardize this and document here, problem with data[] vs data...
 * @property tileSource a tileSource object, can be provided by a plugin or a module, not available through session configuration, not serialized;
 *    the object needs to be deduced from available dataReference and possibly protocol value realtime before the viewer loads
 */
interface DataOverride {
    dataID: DataID;
    options?: SlideSourceOptions;
    microns?: number;
    micronsX?: number;
    micronsY?: number;
    protocol?: string;
    tileSource?: OpenSeadragon.TileSource;
}

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
 * @property dataReference index to the `data` array, can be only one unlike in `shaders`, required - marks the target data item others refer to (e.g. in measurements)
 * @property shaders array of optional rendering specification
 * @property protocol deprecated, use DataOverride instead
 * @property name custom tissue name, default the tissue path
 * @property goalIndex preferred visualization index for this background, overrides `activeVisualizationIndex`
 * @property id unique ID for the background, created automatically from data path if not defined
 */
interface BackgroundItem {
    dataReference: number | DataSpecification;
    shaders?: VisualizationShaderLayer[];
    protocol?: string;
    name?: string;
    goalIndex?: number;
    id?: string;
    options?: SlideSourceOptions;
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
 * @property protocol deprecated, use DataOverride instead
 * @property name custom tissue name, default the tissue path
 * @property goalIndex preferred visualization index for this background, overrides `activeVisualizationIndex`
 */
interface VisualizationItem {
    shaders?: Record<string, VisualizationShaderLayer>;
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
    undo(): boolean;
    redo(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
}

// ── XOpatHistory ─────────────────────────────────────────────────────────────
interface XOpatHistoryConstructor {
    new(size?: number): XOpatHistory;
}

interface XOpatHistory {
    BUFFER_LENGTH: number;
    _buffer: Array<{ forward: () => any; backward: () => void } | null>;
    _buffidx: number;
    _lastValidIndex: number;
    _providers: HistoryProvider[];

    set size(value: number);
    registerProvider(provider: HistoryProvider): void;
    push(forward: () => any, backward: () => void): any;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
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
    readonly sessionName: string;
    readonly secure: boolean;
    readonly env: any;
    readonly url: string;
    readonly settingsMenuId: string;
    readonly pluginsMenuId: string;
    getOption(name: string, defaultValue?: any, cache?: boolean, parse?: boolean): any;
    setOption(name: string, value: any, cache?: boolean): void;
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
        bgSpec?: number | number[] | null,
        vizSpec?: number | number[] | null,
        opts?: { deriveOverlayFromBackgroundGoals?: boolean }
    ): Promise<boolean>;
    updateVisualization(visualizations: VisualizationItem[], newData?: DataID[], activeVizIndex?: number | number[]): Promise<boolean>;
    _dangerouslyAccessConfig(): any;
    _dangerouslyAccessPlugin(id: string): any;
    __cache: { dirty: boolean };
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
interface XOpatUtilities {
    fileNameFromPath(imageFilePath: string, stripSuffix?: boolean): string;
    nameFromBGOrIndex(indexOrItem: number | BackgroundItem | BackgroundConfig, stripSuffix?: boolean): string;
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

    setImageMeasurements(
        viewer: OpenSeadragon.Viewer,
        microns: number | undefined,
        micronsX: number | undefined,
        micronsY: number | undefined,
        name: string | undefined
    ): void;

    parseBackgroundAndGoal(
        bgSpec?: number | number[] | null,
        vizSpec?: number | number[] | null,
        opts?: { deriveOverlayFromBackgroundGoals?: boolean }
    ): boolean;

    storePageState(includedPluginsList?: Record<string, any>): boolean;

    setIsCanvasFocused(focused: boolean | OpenSeadragon.Viewer | null): void;

    [key: string]: any;
}