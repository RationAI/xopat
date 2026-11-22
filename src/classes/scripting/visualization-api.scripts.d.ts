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
    /**
     * Canvas clear color while this background is open — hex `#RGB` / `#RGBA` /
     * `#RRGGBB` / `#RRGGBBAA`. Per-background override of `setup.backgroundColor`.
     */
    fill?: string;
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
 *
 * Note: which visualization a slot renders is NOT stored here — it is the per-background
 * `BackgroundItem.visualizationIndex` binding.
 */
export interface VisualizationItem {
    shaders?: Record<string, VisualizationShaderGroupOrLayer>;
    protocol?: string;
    name?: string;
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
    /** See {@link VisualizationRegionRenderOptions.label}. */
    label?: string;
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
    /**
     * False when the LIVE viewport was still streaming tiles as it was read, so parts of the
     * buffer are blank. Present on background/viewport reads, which capture what is on screen and
     * therefore never wait. Treat `false` as "do not measure, cache or describe this as the slide"
     * — settle the view and read again.
     */
    isComplete?: boolean;
};

export type VisualizationRegionRenderOptions = {
    /**
     * Region to render, in FULL-RESOLUTION (level-0) image pixels of the reference world item.
     */
    region: { x: number; y: number; width: number; height: number };
    /**
     * HOW MUCH DETAIL — give exactly ONE of `size`, `magnification`, `targetPixels`.
     *
     * Output bounding box in pixels. The region's aspect ratio is preserved: provide one
     * dimension to derive the other, or both to fit the region inside the box. Small sizes
     * (e.g. 512) are cheap — request only the resolution you need.
     */
    size?: { width?: number; height?: number };
    /**
     * Render at this optical magnification (e.g. 5, 20) — the same number the scalebar shows.
     * Needs a calibrated slide (throws otherwise; use `targetPixels`). A request, not a
     * guarantee: the output is never upsampled past native resolution and never exceeds
     * `maxPixels`, so read the result's `magnification` for what was actually rendered.
     */
    magnification?: number;
    /**
     * Render at whatever resolution fits this output AREA (e.g. 500000 ≈ 700×700). Works on
     * uncalibrated slides. Capped the same way as `magnification`; read the result's `scale`.
     */
    targetPixels?: number;
    /**
     * Which shader layers to render. `"active"` (default) reproduces the user's full live
     * visualization (background + data layers, current control values). `"background"` renders
     * the raw slide image only.
     */
    layers?: "active" | "background";
    /** World item index the region coordinates refer to. Default 0 (the background image). */
    refIndex?: number;
    /** Pixel-count guard; region canvas default 4096*4096, pixel readback default 1024*1024. */
    maxPixels?: number;
    /** See {@link VisualizationViewportRenderOptions.pixelFormat}. */
    pixelFormat?: "array" | "typed";
    /**
     * Budget for the render's tile-load wait (ms, default 10000).
     *
     * The pass drives the missing tiles and waits for them. On timeout it proceeds with whatever
     * loaded and reports `isComplete: false`; it can also end early with `stalled: true` when no
     * further tile could arrive, in which case a larger budget would have changed nothing.
     *
     * Off-screen passes are serialized per viewer, so this is a real cost when several renders are
     * queued — ask for what the render is worth, not for the maximum.
     */
    timeoutMs?: number;
    /**
     * Budget for the wait BEFORE the render starts (ms, unbounded by default).
     *
     * `timeoutMs` measures the render; this measures the wait for a turn at it. Off-screen passes
     * are serialized per viewer AND admitted through the background request scheduler, so a pass
     * can sit for seconds before its own budget starts ticking. A caller that wraps this call in a
     * wall-clock guard has no way to size that guard without a bound on the wait — without one, a
     * queue of cheap renders makes every guard past the first fire, which reads as "the render
     * failed" when nothing was ever rendered.
     *
     * On expiry the call REJECTS before any work is done (and before the capture is announced as
     * started), so nothing is half-produced. Distinguish it by `error.name === "QueueTimeoutError"`.
     */
    queueTimeoutMs?: number;
    /**
     * What {@link renderRegionPng} does when the render came back incomplete. `"throw"` (default)
     * refuses rather than hand back a data URL that cannot carry the flag and looks identical to a
     * real one; `"allow"` returns the partial pixels. Ignored by every API that reports
     * `isComplete` itself.
     */
    onIncomplete?: "throw" | "allow";
    /**
     * DIAGNOSTIC ONLY — a short human-readable reason for this capture (e.g. "explore: survey").
     * It changes nothing about the render; it is carried on the `region-capture` event so the
     * user can see, on the slide itself, which parts were read and why. Keep it under ~60
     * characters; longer values are truncated when displayed.
     */
    label?: string;
};

/** What a region render says about the resolution it actually produced. */
export type VisualizationRegionResolution = {
    /** Output pixels per level-0 image pixel (1 = native resolution, 0.25 = every 4th pixel). */
    scale: number;
    /** Effective optical magnification of the output; null on an uncalibrated slide. */
    magnification: number | null;
};

export type VisualizationRegionPngResult = VisualizationRegionResolution & {
    dataUrl: string;
    width: number;
    height: number;
    isComplete: boolean;
    stalled: boolean;
};

export type VisualizationRegionPixelsResult = VisualizationViewportPixelsResult & VisualizationRegionResolution & {
    /**
     * False when the render did not have every tile of the region — the tile-load wait ran out of
     * `timeoutMs`, or gave up early because no further tile could arrive (see `stalled`).
     *
     * This is the flag that separates "the slide looks like this" from "this is what happened to
     * be in cache". An incomplete raster must not be measured, cached, or described to a model as
     * the region.
     */
    isComplete: boolean;
    /**
     * True when the wait ended because nothing more *could* arrive — no tile of this region was in
     * flight and none had arrived for a while, which is what a permanently missing (404'd) tile
     * looks like: OSD marks it non-existent and drops it from both the draw list and the load
     * candidates, so completeness can never flip.
     *
     * Use it to decide whether retrying is worth anything. `!isComplete && !stalled` means the
     * budget ran out and a longer `timeoutMs` or a smaller region may succeed; `stalled` means it
     * will not. Note that a slide with permanently missing tiles can report `isComplete: true` with
     * holes, so the only fully trustworthy read is `isComplete && !stalled`.
     */
    stalled: boolean;
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

/**
 * One data source of the session, as reported by {@link VisualizationScriptApi.describeData}.
 * `role` says how it is currently used: `background` is the scan itself, `overlay` is rendered
 * by at least one shader layer, `unbound` is declared but not drawn by anything.
 */
export interface VisualizationDataSourceInfo {
    /** Index into `config.data` — the value a shader layer's `dataReferences` carries. */
    dataReference: number;
    /** The deployment's own id/path for this source, when the entry carries one. */
    dataId: string | null;
    /** Stable per-source identity. Prefer this over any URL: DICOMweb shares one baseUrl. */
    tileSourceId: string | null;
    /** Name of the protocol that fetches this entry (e.g. `"dicom"`), when it declares one. */
    protocol: string | null;
    /**
     * Whether the active viewer shows this source: one of its backgrounds, or drawn by the
     * visualization it has selected. The list itself covers the WHOLE session — every viewer.
     */
    inActiveViewer: boolean;
    role: "background" | "overlay" | "unbound";
    /**
     * Whether the source is currently present in the viewer's world. Only a loaded source can
     * be measured: `probeData` on an unloaded one throws.
     */
    loaded: boolean;
    worldIndex: number | null;
    width: number | null;
    height: number | null;
    /** Whatever the tile source publishes about itself (channels, µm/px, vendor fields). */
    metadata: Record<string, any> | null;
    referencedBy: Array<{ visualizationIndex: number; layerId: string; type: string | null }>;
}

export interface VisualizationDataProbeOptions {
    /** Readback cap; the render is downsampled to fit. Default 256×256. */
    maxPixels?: number;
    /** Histogram resolution, 2..64. Default 16. */
    bins?: number;
}

/**
 * Measured value distribution of one data source, as reported by
 * {@link VisualizationScriptApi.probeData}. When `empty` is true the source contributed no
 * visible pixels to the current view and every other field is absent — that is a statement
 * about where the user is looking, not about the data.
 */
export interface VisualizationDataProbe {
    dataReference: number;
    sampledPixels: number;
    opaquePixels: number;
    empty: boolean;
    note?: string;
    /** True when R, G and B agree everywhere sampled: one value per pixel, not colour. */
    looksScalar?: boolean;
    channels?: Array<{
        channel: "r" | "g" | "b" | "a";
        min: number;
        max: number;
        mean: number;
        histogram: number[];
    }>;
    /** The occupied slice of 0..1 — spread thresholds across this, not across the full range. */
    suggestedRange?: { low: number; high: number };
}

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
     * Describes every data source in the session — what it IS, before deciding how to render it.
     *
     * One entry per `config.data` index: `dataReference`, `dataId`, `tileSourceId`, `protocol`,
     * the source's own `metadata` (channels, µm/px, whatever the tile source publishes), pixel
     * `width`/`height`, whether it is currently `loaded` into the viewer world, its `role`
     * (`"background"` = the scan itself | `"overlay"` = rendered by a shader layer |
     * `"unbound"` = present but not rendered), and `referencedBy` — the visualization layers
     * that draw it.
     *
     * The list spans the WHOLE session, not one viewer. To answer for the active viewer, keep
     * the rows with `inActiveViewer: true`. Rows with `loaded: false` carry no metadata and
     * cannot be probed; do not ask the user to identify them by `dataReference`.
     *
     * Call this before proposing a visualization for data you have not inspected. It costs no
     * rendering and answers "what am I even mapping to colour".
     */
    describeData(): VisualizationDataSourceInfo[];

    /**
     * Measures what a data source CONTAINS, by rendering it off-screen through a plain
     * `identity` layer at the current view and reading the pixels back. Never moves the viewport.
     *
     * Use it to place thresholds and pick a palette from the actual value distribution instead
     * of guessing: `channels` carries per-channel `min`/`max`/`mean`/`histogram` (RGBA order),
     * `suggestedRange` is the occupied slice of 0..1 to spread breaks across, and `looksScalar`
     * is true when the source carries one value per pixel rather than colour.
     *
     * `empty: true` means nothing from that source is visible in the current view — the probe
     * says nothing about the source, only about where the user is looking.
     */
    probeData(dataReference: number, options?: VisualizationDataProbeOptions): Promise<VisualizationDataProbe>;

    /**
     * Captures what the user currently sees and returns a vision model's written critique of it.
     *
     * RENDERING QUALITY ONLY. `question` narrows the critique ("is the overlay distinguishable?");
     * the model behind it is instructed to refuse tissue, morphology and diagnosis, so it is not a
     * way to read a specimen. It reads the CURRENT VIEWPORT with overlays — never navigate the
     * viewer or change the visualization to feed it. To look at tissue, render a region
     * (`viewer.captureRegion`).
     *
     * For questions the configuration cannot answer — "is this readable?", "why does the overlay
     * look washed out?" — where the subject is the composite on screen. Prefer `describeData` and
     * `probeData` first: they are cheaper and more precise. Returns `null` when no vision-capable
     * provider is configured, so treat a null as "ask the user" rather than as an error.
     *
     * Sends the rendered view to the configured model provider.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    critiqueCurrentRendering(
        question?: string,
        options?: VisualizationViewportRenderOptions
    ): Promise<string | null>;

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
     *
     * When `ok === true`, `normalized` is exactly the object the mutating call
     * builds internally — pass it straight to `addVisualization` /
     * `updateVisualizationAt` / `replaceVisualizations` instead of writing the
     * literal out a second time. Re-typing a large nested config is pure risk:
     * it is one more chance to introduce a typo (or to lose a character in
     * transit) in a value the runtime has already accepted.
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
     *
     * A single `index` switches the ACTIVE viewer only (see `application.setActiveViewer`);
     * other viewers keep what they show. Pass an array to set several viewers at once — one
     * entry per viewer, in viewer order. The same holds for `makeActive` on
     * `addVisualization` / `updateVisualizationAt`.
     */
    setActiveVisualization(index: number | number[]): Promise<boolean>;

    /**
     * Replaces the full visualization list for the current session.
     * Not for temporarily hiding overlays to look at the slide — render off-screen with
     * `layers: "background"` instead.
     * Optional newData entries are appended to the session data array before the viewer reloads.
     */
    replaceVisualizations(
        visualizations: VisualizationItem[],
        activeVizIndex?: number | number[],
        newData?: DataID[]
    ): Promise<boolean>;

    /**
     * Adds a visualization to the current session.
     *
     * Accepts the `normalized` object returned by `validateProposedVisualization` unchanged —
     * if you dry-ran the config, hand that back rather than repeating the literal.
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
     * Returns the shader layers of the ACTIVE viewer's background — how the slide itself is
     * rendered. A multi-channel slide (fluorescence) is typically drawn entirely by these
     * layers, one per channel, with no visualization at all. Layers are addressed by their
     * position in the returned array.
     *
     * When the user asks to restyle what the slide already shows (channel colours, gamma,
     * a different shader type for a channel), read these FIRST. Adding a visualization
     * instead draws new layers on top of the existing ones — it does not change them.
     */
    getBackgroundShaders(): VisualizationShaderGroupOrLayer[];

    /**
     * Applies a partial patch to background shader layer `index` (a position in
     * `getBackgroundShaders()`) of the active viewer. Same merge rules as
     * `updateVisualizationAt`: changing `type` replaces the layer, anything else merges, and
     * the result is validated against `getSchema()` before it is applied. Undoable.
     *
     * One call changes one layer; restyle several channels with several calls in one script.
     */
    updateBackgroundShaderAt(
        index: number,
        patch: Partial<VisualizationShaderGroupOrLayer>
    ): Promise<boolean>;

    /**
     * Removes a visualization from the current session. A change to the user's session — only
     * when the user asked for it. NOT a way to uncover the slide for a look: an off-screen render
     * with `layers: "background"` shows the scan without any overlay and changes nothing.
     */
    removeVisualization(index: number, nextActiveIndex?: number | number[]): Promise<boolean>;

    /**
     * Renders the current viewport with a temporary standalone visualization configuration and returns a PNG data URL.
     * For transient rendering, tiledImages should already resolve against the active viewer, or dataReferences must map to
     * data already present in the current session.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderCurrentViewportPng(
        visualization: VisualizationLayerSource,
        options?: VisualizationViewportRenderOptions
    ): Promise<string>;

    /**
     * Renders the current viewport with a temporary standalone visualization configuration and returns raw RGBA pixels.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderCurrentViewportPixels(
        visualization: VisualizationLayerSource,
        options?: VisualizationViewportRenderOptions
    ): Promise<VisualizationViewportPixelsResult>;

    /**
     * Renders the current viewport's BACKGROUND image only (no data/visualization overlay) at the live
     * zoom/pan and returns a PNG data URL. Use this to read the raw slide when the overlay must be excluded.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderCurrentBackgroundPng(options?: VisualizationViewportRenderOptions): Promise<string>;

    /**
     * Renders the current viewport's BACKGROUND image only (no data/visualization overlay) and returns raw
     * RGBA pixels ({ width, height, data, isComplete }).
     *
     * This reads the LIVE viewport, so it never waits for tiles: `isComplete` is false whenever the
     * view was still streaming. Check it before measuring or caching anything derived from these
     * pixels — a mask computed over a half-loaded viewport describes the cache, not the slide.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderCurrentBackgroundPixels(options?: VisualizationViewportRenderOptions): Promise<VisualizationViewportPixelsResult>;

    /**
     * Renders an ARBITRARY image region OFF-SCREEN through the flex-renderer pipeline and returns
     * a PNG data URL. Never moves the user's viewport — use this to browse the slide freely
     * (any location, any zoom, small patches) while the user keeps navigating. With
     * `layers: "active"` (default) the output matches exactly what the user would see at that
     * location (active visualization, current control values); `layers: "background"` returns the
     * raw slide. Excludes annotation/DOM overlays (not part of the render pipeline).
     *
     * Return the data URL from your script to view the image yourself on the next step.
     * `viewer.captureRegion` is the same render with the resolution reported alongside.
     *
     * THROWS when the render came back incomplete (some tiles had not loaded), because a data URL
     * cannot carry that and a partial render is indistinguishable from a real one. Pass
     * `onIncomplete: "allow"` to accept partial pixels, or call {@link renderRegionPngDetailed} to
     * receive the flag and decide yourself.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderRegionPng(options: VisualizationRegionRenderOptions): Promise<string>;

    /**
     * {@link renderRegionPng} plus the completeness of the pass that produced it. Never throws on
     * an incomplete render.
     *
     * `stalled` means the tile wait gave up because nothing further could arrive (e.g. the missing
     * tiles 404) rather than because it ran out of time; it is always false on a flex-renderer that
     * does not wait. Only `isComplete && !stalled` is a faithful read of the region.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderRegionPngDetailed(
        options: VisualizationRegionRenderOptions
    ): Promise<VisualizationRegionPngResult>;

    /**
     * Renders an arbitrary image region off-screen and returns raw RGBA pixels plus `isComplete`
     * (false when the render did not have every tile of the region). Never moves the user's
     * viewport. Always check `isComplete` before treating the pixels as the region.
     *
     * PERMISSION: asks the user before reading slide pixels (they may remember the answer for
     * this slide, all slides for a while, or always). Throws when declined — do not retry the
     * same read; ask the user or continue from metadata.
     */
    renderRegionPixels(options: VisualizationRegionRenderOptions): Promise<VisualizationRegionPixelsResult>;

    /**
     * Extracts a first-pass texture or stencil layer from the active viewer's standalone renderer state.
     */
    extractCurrentFirstPassLayer(
        options?: VisualizationFirstPassExtractOptions
    ): Promise<VisualizationViewportPixelsResult>;
}
