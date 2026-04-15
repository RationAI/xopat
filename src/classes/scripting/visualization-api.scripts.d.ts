import type { ScriptApiObject } from "../scripting-manager";

// TODO: Some of the types below are double-defined in the ambient types.
//   this is due to the fact that script types are consumed and fed to the
//   scripting manager, which is not aware of the ambient types. Design a way to pull
//   the ambient types into the scripting manager, so that they can be used in the
//   scripting context.

/**
 * Arbitrary Data identifier such that image server can understand it (most often UUID4 or file paths, but might be an object
 * if certain `TileSource` uses more complex syntax). The value is passed to TileSource::supports() check to select
 * the target protocol handler. Provide a value for your tile source which talks to the server of your choice.
 */
export type DataID = string | Record<string, any>;

/**
 * Data Specification is the virtual representation of the data item. It can either directly specify the data item,
 * or, it can contain a more-broad data specification overriding the default behavior of the data source integration.
 */
export type DataSpecification = DataID | DataOverride;

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
export interface DataOverride {
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
export interface SlideSourceOptions {
    format?: string;
    [key: string]: any;
}

/**
 * @property dataReference index to the `data` array, can be only one unlike in `shaders`, required - marks the target data item others refer to (e.g. in measurements)
 * @property shaders array of optional rendering specification
 * @property protocol deprecated, use DataOverride instead
 * @property name custom tissue name, default the tissue path
 * @property goalIndex preferred visualization index for this background, overrides `activeVisualizationIndex`
 * @property id unique ID for the background, created automatically from data path if not defined
 */
export interface BackgroundItem {
    dataReference: number | DataSpecification;
    shaders?: VisualizationShaderGroupOrLayer[];
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
export interface StandaloneBackgroundItem extends BackgroundItem {
    dataReference: DataSpecification;
}


/**
 * @property shaders array of shader specifications
 * @property protocol deprecated, use DataOverride instead
 * @property name custom tissue name, default the tissue path
 * @property goalIndex preferred visualization index for this background, overrides `activeVisualizationIndex`
 */
export interface VisualizationItem {
    shaders?: Record<string, VisualizationShaderGroupOrLayer>;
    protocol?: string;
    name?: string;
    goalIndex?: number;
    [key: string]: any;
}

export interface VisualizationShaderLayer {
    type?: string;
    id?: string;
    // Data References come from outside, point to data array spec
    dataReferences?: number[];
    // Tiled image references, point to actual TIs loaded at the viewer world
    tiledImages?: number[];
    name?: string;
    [key: string]: any;
}

export interface VisualizationShaderGroup extends VisualizationShaderLayer {
    type: "group";
    // Group layers can nest additional shader layers
    shaders?: Record<string, VisualizationShaderGroupOrLayer>;
    // Group layers can override child execution order
    order?: string[];
}

export type VisualizationShaderGroupOrLayer = VisualizationShaderGroup | VisualizationShaderLayer;

export type VisualizationDocsControl = {
    name: string;
    supportedUiTypes: string[];
    default?: Record<string, any> | null;
    required?: Record<string, any> | null;
};

export type VisualizationDocsShaderSource = {
    index: number;
    description?: string;
    acceptedChannelCounts?: number[] | null;
};

export type VisualizationDocsShader = {
    type: string;
    name: string;
    description?: string;
    preview?: string | null;
    sources: VisualizationDocsShaderSource[];
    controls: VisualizationDocsControl[];
    customParams: Array<{ name: string; usage?: string }>;
};

export type VisualizationDocsModel = {
    version: number;
    generatedAt: string;
    shaders: VisualizationDocsShader[];
    controls: Record<string, Array<{
        name: string;
        glType: string;
        uiType?: string;
        supports?: Record<string, any>;
    }>>;
};

export type VisualizationStateSnapshot = {
    data: DataSpecification[];
    visualizations: VisualizationItem[];
    activeVisualizationIndex?: Array<number | undefined>;
};

export type VisualizationViewportRenderOptions = {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    regionWidth?: number;
    regionHeight?: number;
    maxPixels?: number;
};

export type VisualizationViewportPixelsResult = {
    width: number;
    height: number;
    data: number[];
};

export type VisualizationFirstPassExtractOptions = {
    kind?: "texture" | "stencil";
    layerIndex?: number;
    width?: number;
    height?: number;
};

export type VisualizationLayerSource =
    | VisualizationItem
    | Record<string, VisualizationShaderGroupOrLayer>;

export interface VisualizationScriptApi extends ScriptApiObject {
    /**
     * Lists the shader types that can be used in visualization layers.
     */
    getAvailableShaderTypes(): string[];

    /**
     * Returns the machine-friendly shader documentation model generated by the FlexRenderer shader configurator.
     */
    getShaderDocsModel(): VisualizationDocsModel;

    /**
     * Returns the shader documentation serialized as JSON.
     */
    getShaderDocsJson(pretty?: boolean): string;

    /**
     * Returns the shader documentation serialized as plain text.
     */
    getShaderDocsText(): string;

    /**
     * Returns the persisted visualization list for the current viewer session.
     */
    getVisualizations(): VisualizationItem[];

    /**
     * Returns the current active visualization selection.
     */
    getActiveVisualizationIndex(): Array<number | undefined> | undefined;

    /**
     * Returns the first active visualization entry, when one is selected.
     */
    getActiveVisualization(): VisualizationItem | undefined;

    /**
     * Captures the current visualization-related session state so it can be restored later.
     */
    captureState(): VisualizationStateSnapshot;

    /**
     * Restores a previously captured visualization state.
     * The user is asked for confirmation unless the scripting context bypasses consent dialogs.
     */
    restoreState(snapshot: VisualizationStateSnapshot): Promise<boolean>;

    /**
     * Changes the active visualization selection for the current viewer session.
     * The user is asked for confirmation unless the scripting context bypasses consent dialogs.
     */
    setActiveVisualization(index: number | number[]): Promise<boolean>;

    /**
     * Replaces the full visualization list for the current session.
     * Optional newData entries are appended to the session data array before the viewer reloads.
     */
    replaceVisualizations(
        visualizations: VisualizationItem[],
        activeVizIndex?: number | number[],
        newData?: DataID[]
    ): Promise<boolean>;

    /**
     * Adds a visualization to the current session.
     */
    addVisualization(
        visualization: VisualizationItem,
        options?: {
            makeActive?: boolean;
            newData?: DataID[];
        }
    ): Promise<boolean>;

    /**
     * Applies a partial patch to a persisted visualization entry.
     */
    updateVisualizationAt(
        index: number,
        patch: Partial<VisualizationItem>,
        options?: {
            makeActive?: boolean;
            newData?: DataID[];
        }
    ): Promise<boolean>;

    /**
     * Removes a visualization from the current session.
     */
    removeVisualization(index: number, nextActiveIndex?: number | number[]): Promise<boolean>;

    /**
     * Renders the current viewport with a temporary standalone visualization configuration and returns a PNG data URL.
     * For transient rendering, tiledImages should already resolve against the active viewer, or dataReferences must map to
     * data already present in the current session.
     */
    renderCurrentViewportPng(
        visualization: VisualizationLayerSource,
        options?: VisualizationViewportRenderOptions
    ): Promise<string>;

    /**
     * Renders the current viewport with a temporary standalone visualization configuration and returns raw RGBA pixels.
     */
    renderCurrentViewportPixels(
        visualization: VisualizationLayerSource,
        options?: VisualizationViewportRenderOptions
    ): Promise<VisualizationViewportPixelsResult>;

    /**
     * Extracts a first-pass texture or stencil layer from the active viewer's standalone renderer state.
     */
    extractCurrentFirstPassLayer(
        options?: VisualizationFirstPassExtractOptions
    ): Promise<VisualizationViewportPixelsResult>;
}
