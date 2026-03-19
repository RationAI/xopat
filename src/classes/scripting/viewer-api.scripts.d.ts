import type {ScriptApiObject} from "../scripting-manager";

export type ViewerPlaneInfo = {
    z?: number;
    t?: number;
};

export type ViewerPoint = {
    x: number;
    y: number;
};

export type ViewerRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ViewerViewportInfo = {
    x: number;
    y: number;
    zoom: number;
    rotation?: number;
    width: number;
    height: number;
    bounds: ViewerRect;
    containerSize: { width: number; height: number };
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

export type ViewerTiledImageInfo = {
    index: number;
    width: number;
    height: number;
    opacity?: number;
    clip?: ViewerRect | null;
    contentBounds?: ViewerRect | null;
    viewportBounds?: ViewerRect | null;
};

export type ViewerScreenshotOptions = {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    regionWidth?: number;
    regionHeight?: number;
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

    getTiledImages(): ViewerTiledImageInfo[];

    /**
     * These methods convert between coord systems in OpenSeadragon.
     * Window: the screen coordinates of the monitor, usually hundreds to thousands.
     * Viewport: the unit coordinates of the viewport, internal use.
     * Image: the pixel coords of the target tiled image, usually thousands to millions.
     */
    windowToViewport(x: number, y: number): ViewerPoint;
    viewportToWindow(x: number, y: number): ViewerPoint;
    viewportToImage(x: number, y: number, tiledImageIndex?: number): ViewerPoint;
    imageToViewport(x: number, y: number, tiledImageIndex?: number): ViewerPoint;
    windowToImage(x: number, y: number, tiledImageIndex?: number): ViewerPoint;
    imageToWindow(x: number, y: number, tiledImageIndex?: number): ViewerPoint;

    getViewportBoundsInImage(tiledImageIndex?: number): ViewerRect;

    /**
     * Takes a screenshot of the current viewport.
     */
    getViewportScreenshot(options?: ViewerScreenshotOptions): string;
}