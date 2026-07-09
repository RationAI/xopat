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
     * Retrieves the current zoom level, x/y coordinates, and active image plane for this script context's viewer.
     */
    getViewport(): ViewerViewportInfo;

    /**
     * Pans and zooms this script context's viewer to a specific location or depth.
     * IMPORTANT: `x` and `y` are OpenSeadragon VIEWPORT coordinates (x is in 0..1 across the slide width),
     * NOT image pixels. To navigate to an image-pixel location use `focusOnImage(...)`, and to frame an
     * image-space rectangle (e.g. an annotation) use `frameImageRegion(...)`; or convert first with
     * `imageToViewport(...)`.
     */
    focusOn(
        x: number,
        y: number,
        zoom?: number,
        plane?: ViewerPlaneInfo
    ): void;

    /**
     * Pans (and optionally zooms) the viewer to an IMAGE-PIXEL location — the convenient counterpart to
     * `focusOn`. Coordinates are in the tiled image's pixel space (annotation points, pathology results, and
     * `getMetadata()` dimensions are all in this space).
     * @param imageX image-pixel x.
     * @param imageY image-pixel y.
     * @param zoom optional zoom level.
     * @param tiledImageIndex which tiled image's pixel space (default 0 = the full-resolution background slide).
     */
    focusOnImage(imageX: number, imageY: number, zoom?: number, tiledImageIndex?: number): void;

    /**
     * Frames an IMAGE-SPACE rectangle (e.g. an annotation's or pathology result's `bounds`) so the whole region
     * fits in the viewport. Prefer this to `focusOn` when you want to "go to" a detected region.
     * @param rect image-pixel rectangle `{ x, y, width, height }`.
     * @param options `padding` (fraction of the rect added around it, default 0.1) and `tiledImageIndex`
     *   (default 0 = full-resolution background slide).
     */
    frameImageRegion(
        rect: ViewerRect,
        options?: { padding?: number; tiledImageIndex?: number }
    ): void;

    /**
     * Returns image-specific metadata.
     */
    getMetadata(): ViewerMetadata;

    getTiledImages(): ViewerTiledImageInfo[];

    /**
     * These methods convert between coord systems in OpenSeadragon for the viewer bound to this script context.
     * Window: the screen coordinates of the monitor, usually hundreds to thousands.
     * Viewport: the unit coordinates of the viewport, internal use.
     * Image: the pixel coords of the target tiled image, usually thousands to millions.
     *
     * Image coordinates are always reported in the PARENT slide's pixel space. When the viewer shows a
     * virtual-region crop (slide split), the split is transparent: these methods take/return the un-split
     * parent's global image coordinates, not the region-local ones.
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