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
 * @property visualizationIndex visualization to render when this background is mounted (per-bg viz binding; `null` for no overlay).
 *           Slot k renders `visualizations[background[activeBackgroundIndex[k]].visualizationIndex]`. Survives slot reordering.
 *           Legacy `goalIndex` is accepted on read and folded into this field.
 * @property id unique ID for the background, created automatically from data path if not defined
 */
export interface BackgroundItem {
    dataReference: number | DataSpecification;
    shaders?: VisualizationShaderGroupOrLayer[];
    protocol?: string;
    name?: string;
    visualizationIndex?: number | null;
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

/**
 * The renderer-published JSON Schema 2020-12 document describing every valid visualization
 * config. Returned by `visualization.getSchema()`. Consumers (LLMs, validators, type generators)
 * read it as the single source of truth for layer shapes and for discovering which layer types,
 * params, examples, and validation hints are available before mutating visualization state.
 *
 * Top-level keys: standard JSON Schema fields (`$schema`, `$id`, `type`, `properties`,
 * `additionalProperties`, `required`) plus `$defs.shaderLayers.<type>` (one full layer schema
 * per registered shader). Each `$defs.shaderLayers.<type>` carries `examples` (full ready-to-use
 * layers), `x-intent` (one-line shader purpose), `x-expects` (data-shape hints), `x-sources`
 * (channel-count expectations), and `x-controlCouplings` (informational coupling rules; the
 * renderer enforces them at runtime). The slim accessor returned by `getSchema()` strips
 * `$defs.uiControlEnvelopes` (typedef catalog) since the per-shader examples already encode
 * valid envelope values.
 */
export type VisualizationConfigSchema = Record<string, any>;

/**
 * Transit shape used by scripting APIs that propose / restore a visualization
 * set. `activeVisualizationIndex` is a back-compat hint — `replaceVisualizations`
 * / `addVisualization` / `updateVisualizationAt` fold it into the corresponding
 * `background[i].visualizationIndex` field via the open pipeline. Persistent
 * storage of this state lives on bg entries, not at the snapshot top level.
 */
export type VisualizationStateSnapshot = {
    data: DataSpecification[];
    visualizations: VisualizationItem[];
    /** @deprecated Folded into `background[i].visualizationIndex` on apply. */
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
    /**
     * Representation of the returned RGBA buffer.
     *  - `"array"` (default): a plain `number[]`, JSON-friendly for scripts.
     *  - `"typed"`: the raw `Uint8ClampedArray`, returned without copying.
     *
     * Prefer `"typed"` for in-process pixel work. Boxing a viewport-sized buffer into
     * a `number[]` costs roughly 75x the time and 19x the memory of the typed buffer
     * (a 1500x800 @DPR2 frame measures ~520ms and ~344MB), and it defeats typed-array
     * fast paths in every loop that reads it afterwards.
     */
    pixelFormat?: "array" | "typed";
};

export type VisualizationViewportPixelsResult = {
    width: number;
    height: number;
    /**
     * RGBA pixels, 4 bytes per pixel, row-major from the top-left.
     * A plain `number[]` by default; a `Uint8ClampedArray` when the request passed
     * `pixelFormat: "typed"`. Index the same way either way.
     */
    data: number[] | Uint8ClampedArray;
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
     * Returns the renderer-published JSON Schema 2020-12 document describing every valid
     * visualization config. ONE-CALL discovery: cache the result for the rest of the session.
     *
     * Discovery guidance:
     * - inspect `schema.$defs.shaderLayers` to enumerate available layer types
     * - read `x-intent`, `x-expects`, and `x-controlCouplings` on candidate types before choosing
     * - copy `schema.$defs.shaderLayers[type].examples[0]` as the structural starting point
     * - set only params that exist on the chosen type; different layer types expose different controls
     * - if the schema evidence is ambiguous, inspect more viewer state or ask a clarification question instead of guessing
     *
     * Submitted layers are AJV-validated against the same schema before the user is asked to
     * review; on failure the error message includes JSON Pointer paths (e.g.
     * `/shaders/L1/params/color`) pointing at the offending field plus what was expected.
     */
    getSchema(): VisualizationConfigSchema;

    /**
     * Returns the persisted visualization list for the current viewer session.
     */
    getVisualizations(): VisualizationItem[];

    /**
     * Returns the active-visualization selection, intersected with the actual
     * visualization list. Entries that fall outside the list become
     * `undefined`; the whole result is `undefined` when no entry is valid (in
     * particular when `getVisualizations()` is empty). Pair with
     * `getVisualizations()` / `getActiveVisualization()` rather than treating
     * a non-undefined cursor as proof that a visualization exists.
     */
    getActiveVisualizationIndex(): Array<number | undefined> | undefined;

    /**
     * Returns the first active visualization entry, when one is selected.
     */
    getActiveVisualization(): VisualizationItem | undefined;

    /**
     * Dry-run validator. Runs the same JSON-Schema and coupling checks as
     * `addVisualization` / `updateVisualizationAt` / `replaceVisualizations`
     * without mutating state or opening the playground review.
     *
     * Call this BEFORE any visualization-mutating method. If `result.ok ===
     * false`, fix the reported errors first — the mutating call would fail
     * with the same set otherwise. Couplings are cross-field rules (e.g. a
     * colormap's `color.steps` must equal `threshold.breaks.length + 1`)
     * that AJV alone cannot express; they only surface here, so dry-run
     * is the only way to catch them up front.
     */
    validateProposedVisualization(viz: any): {
        ok: boolean;
        normalized?: VisualizationItem;
        schemaErrors: string[];
        couplingViolations: Array<{
            coupling: string;
            layerType?: string;
            layerPath?: string;
            controls?: string[];
            expected?: any;
            actual?: any;
            message: string;
        }>;
    };

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
     * Renders the current viewport's BACKGROUND image only (no data/visualization overlay) at the live
     * zoom/pan and returns a PNG data URL. Use this to read the raw slide when the overlay must be excluded.
     */
    renderCurrentBackgroundPng(options?: VisualizationViewportRenderOptions): Promise<string>;

    /**
     * Renders the current viewport's BACKGROUND image only (no data/visualization overlay) and returns raw
     * RGBA pixels ({ width, height, data }).
     */
    renderCurrentBackgroundPixels(options?: VisualizationViewportRenderOptions): Promise<VisualizationViewportPixelsResult>;

    /**
     * Extracts a first-pass texture or stencil layer from the active viewer's standalone renderer state.
     */
    extractCurrentFirstPassLayer(
        options?: VisualizationFirstPassExtractOptions
    ): Promise<VisualizationViewportPixelsResult>;
}
