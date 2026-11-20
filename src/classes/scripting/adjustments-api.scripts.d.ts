import type {ScriptApiObject} from "../scripting-manager";

/** How a data item is sampled by the GPU. */
export type AdjustmentSamplingMode = "auto" | "brightfield" | "fluorescence" | "pixelated";

/** Adjustment values keyed by adjustment key (see `listAdjustmentTypes()`). */
export type AdjustmentValueMap = Record<string, number>;

/** One kind of adjustment the viewer offers. */
export interface AdjustmentType {
    /** Key used in every value map, e.g. "brightness". */
    key: string;
    /** Translated label. */
    label: string;
    min: number;
    max: number;
    step: number;
    /** Value at which the adjustment has no effect. */
    identity: number;
    /** On/off adjustment: `min` is off, `max` is on. */
    toggle: boolean;
}

/** A shader layer of the active viewer that can be adjusted. */
export interface AdjustmentLayerInfo {
    /** Layer id — pass it to the other methods. */
    id: string;
    /** Layer name; masked when sensitive data is not granted. */
    title: string;
    /** Shader type, e.g. "identity", "heatmap". */
    type: string;
    /** "background" (the slide itself) or "visualization" (an overlay). */
    role: "background" | "visualization";
    /** Current values of every adjustment. */
    values: AdjustmentValueMap;
    /** True when any value differs from its identity. */
    adjusted: boolean;
}

/** A data item (one entry of the session data list) drawn by the active viewer. */
export interface AdjustmentDataItemInfo {
    /** Index into the session data list, or -1 when unresolved. Pass to `setSampling`. */
    dataReference: number;
    role: "background" | "visualization";
    /** Display label; masked when sensitive data is not granted. */
    label: string;
    sampling: AdjustmentSamplingMode;
    layers: AdjustmentLayerInfo[];
}

/**
 * Display adjustments of the active viewer: levels (black/white point, gamma), brightness,
 * contrast, saturation, hue, white balance and invert per shader layer, plus how each data item
 * is sampled. Changes are live, undoable with the viewer history, and synced to collaborators.
 * Select the viewer for this script context first with `application.setActiveViewer()`.
 */
export interface AdjustmentsScriptApi extends ScriptApiObject {
    /**
     * True when the renderer supports adjustments. When false only `setSampling` has an effect.
     */
    isSupported(): boolean;

    /**
     * The adjustments the viewer offers, with their ranges and identity values.
     */
    listAdjustmentTypes(): AdjustmentType[];

    /**
     * The data items of the active viewer (background first), each with its adjustable layers
     * and their current values.
     */
    listData(): AdjustmentDataItemInfo[];

    /**
     * Current adjustment values of one layer.
     * @param layerId layer id from `listData()`
     */
    getAdjustments(layerId: string): AdjustmentValueMap;

    /**
     * Change adjustments of one layer. Only the given keys change; values are clamped to range.
     * @param layerId layer id from `listData()`
     * @param values e.g. `{ brightness: 0.1, contrast: 0.2 }`
     * @returns false when unsupported or the layer does not exist
     */
    setAdjustments(layerId: string, values: AdjustmentValueMap): boolean;

    /**
     * Change adjustments of every background layer of the active viewer at once — what the user
     * means by "make the slide brighter".
     * @param values e.g. `{ brightness: 0.1 }`
     */
    setBackgroundAdjustments(values: AdjustmentValueMap): boolean;

    /**
     * Remove the adjustments of one layer, or of every layer when omitted.
     * @param layerId layer id from `listData()`
     */
    resetAdjustments(layerId?: string): void;

    /**
     * Set black and white points from the visible data (0.5% / 99.5% percentiles of the current
     * view). Defaults to every background layer.
     * @param layerId layer id from `listData()`; omitted = background
     * @returns the applied `{black, white}`, or null when nothing is visible
     */
    autoLevels(layerId?: string): Promise<{ black: number; white: number } | null>;

    /**
     * Set how a data item is sampled: "brightfield" (smooth), "fluorescence" (keeps sparse bright
     * signal visible when zoomed out), "pixelated" (no interpolation, for label maps), or "auto"
     * (deployment default). Applies to every viewer showing that data.
     * @param dataReference from `listData()`
     */
    setSampling(dataReference: number, mode: AdjustmentSamplingMode): boolean;
}
