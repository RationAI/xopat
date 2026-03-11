import type {ScriptApiObject} from "../scripting-manager";


export type ViewerPlaneInfo = {
    z?: number;
    t?: number;
};

export type ViewerViewportInfo = {
    x: number;
    y: number;
    zoom: number;
    plane?: ViewerPlaneInfo;
};

export type ViewerChannelInfo = {
    name?: string;
    color?: string | number;
};

export type ViewerMetadata = {
    width: number;
    height: number;
    micronsPerPixelX?: number | null;
    micronsPerPixelY?: number | null;
    zSpacing?: number | null;
    channels?: ViewerChannelInfo[];
};

export interface ViewerScriptApi extends ScriptApiObject {
    /**
     * Retrieves the current zoom level, x/y coordinates, and active image plane.
     */
    getViewport(): ViewerViewportInfo;

    /**
     * Pans and zooms the viewer to a specific location or depth.
     */
    focusOn(
        x: number,
        y: number,
        zoom?: number,
        plane?: ViewerPlaneInfo
    ): void;

    /**
     * Returns image-specific metadata.
     */
    getMetadata(): ViewerMetadata;

    /**
     * Manually overrides the pixel calibration for the current image.
     */
    setPixelSize(
        width?: number | null,
        height?: number | null,
        zSpacing?: number | null
    ): void;

    /**
     * Updates the names and ARGB colors for image channels.
     */
    setChannelInfo(
        names?: Array<string | null>,
        colors?: Array<string | number | null>
    ): void;
}