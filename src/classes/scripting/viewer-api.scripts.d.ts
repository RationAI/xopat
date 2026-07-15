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
    /**
     * Raw OpenSeadragon viewport zoom. This is an INTERNAL rendering value and
     * is NOT the magnification the user sees. To report zoom to the user, use
     * `magnification` (or `getMagnification()`) — never quote `zoom` as "40×".
     */
    zoom: number;
    /**
     * The real on-screen magnification the user sees on the scalebar (e.g.
     * 17.3 for 17.3×), or null when the image has no known native magnification.
     * Prefer this over `zoom` in all user-facing answers.
     */
    magnification?: number | null;
    rotation?: number;
    width: number;
    height: number;
    bounds: ViewerRect;
    containerSize: { width: number; height: number };
    plane?: ViewerPlaneInfo;
};

export type ViewerMagnificationInfo = {
    /** Raw OpenSeadragon viewport zoom (internal; not user-facing). */
    zoom: number;
    /** Current on-screen magnification the user sees (e.g. 17.3 for 17.3×), or null if unknown. */
    magnification: number | null;
    /** Objective magnification at full image resolution (e.g. 40 for a 40× scan), or null if unknown. */
    nativeMagnification: number | null;
    /** Physical size of one image pixel in microns (µm/px), or null when the image is uncalibrated. */
    micronsPerPixel: number | null;
    /** Physical size covered by one on-screen pixel at the current zoom, in microns, or null. */
    micronsPerScreenPixel: number | null;
    /** The exact text rendered on the on-screen scalebar bar, or null. */
    scalebarText: string | null;
};

export type ViewerChannelInfo = {
    name?: string;
    color?: string | number;
};

export type ViewerZStackInfo = {
    /** Number of focal planes on the reference slide (1 means no z-stack). */
    count: number;
    /** Currently active focal-plane index (0-based). */
    index: number;
    /** Physical spacing between planes in microns, when known. */
    spacingUm?: number;
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
     * Retrieves the current viewport state for this script context's viewer: x/y coordinates, the raw
     * OpenSeadragon `zoom`, the user-facing `magnification`, rotation, and active image plane.
     *
     * IMPORTANT: `zoom` is an internal OpenSeadragon value — do NOT present it to the user as the
     * magnification. When the user asks "what is the current zoom/magnification?", answer with
     * `magnification` (e.g. "17.3×"), which matches the scalebar. Use `getMagnification()` for the full
     * magnification/physical-scale breakdown.
     */
    getViewport(): ViewerViewportInfo;

    /**
     * Returns the real, user-facing magnification and physical scale as shown on the viewer's scalebar —
     * the correct source for any question about zoom, magnification, or µm/px. Read from the scalebar, so
     * it matches exactly what the user sees on screen. Fields are null when the image is uncalibrated.
     * Prefer this over `getViewport().zoom` and over guessing from `getMetadata()` micron fields.
     */
    getMagnification(): ViewerMagnificationInfo;

    /**
     * Returns the focal-plane (z-stack) state of this viewer's reference slide, or null when the slide has
     * no z-stack (a single focal plane). Use with `setZDepth` / `stepZDepth` to walk through focal planes.
     */
    getZStack(): ViewerZStackInfo | null;

    /**
     * Sets the active focal plane on this viewer's z-stack slide(s). No-op on slides without a z-stack.
     * The index is clamped to `[0, count-1]`. Swapping planes refetches tiles for the new plane and keeps
     * previously visited planes cached, so stepping back is instant.
     * @param index target focal-plane index (0-based).
     * @returns true if a z-stack slide was present.
     */
    setZDepth(index: number): boolean;

    /**
     * Steps the active focal plane by `delta` (e.g. +1 / -1), clamped to the valid range.
     * @param delta signed number of planes to move.
     * @returns true if a z-stack slide was present.
     */
    stepZDepth(delta: number): boolean;

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