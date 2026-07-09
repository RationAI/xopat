import type {ScriptApiMetadata} from "./abstract-types";
import type {
    ViewerMetadata,
    ViewerPlaneInfo,
    ViewerScriptApi,
    ViewerViewportInfo
} from "./viewer-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";


// todo consider providing this as a real base class so people can reuse this, or support dependency between namespaces
export class XOpatViewerScriptApi extends XOpatScriptingApi implements ViewerScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatViewerScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => {
                const res = await fetch(APPLICATION_CONTEXT.url + "src/classes/scripting/viewer-api.scripts.d.ts");
                if (!res.ok) throw new Error("Failed to load viewer-api.scripts.d.ts");
                return await res.text();
            }
        }
    };

    constructor(namespace: string) {
        super(
            namespace,
            "Viewer Interface",
            "The namespace provides methods to interact with the viewer bound to the current script context - navigation, viewport geometry, coordinate conversions, screenshots, tiled images, and metadata. Usually the viewer must be first selected for this script context by application.setActiveViewer()."
        );
    }

    protected _getTiledImage(index = 0): OpenSeadragon.TiledImage {
        const viewer = this.activeViewer;
        const item = viewer.world?.getItemAt?.(index);
        if (!item) {
            throw new Error(`No tiled image found at index ${index}.`);
        }
        return item;
    }

    /**
     * If the tiled image is a virtual-region crop, return its source (which
     * exposes the region↔parent coordinate mapping); otherwise null. Scripted
     * image coordinates are reported in PARENT-GLOBAL pixels so the slide split
     * is transparent — a script reads/writes the un-split slide's coordinates
     * regardless of which region the viewer happens to show.
     */
    protected _croppedSourceOf(item: any): any {
        const s = item?.source;
        return s && typeof s.getParentId === "function" && s.getParentId() ? s : null;
    }

    protected _point(p: OpenSeadragon.Point | { x: number; y: number } | undefined | null) {
        return { x: p?.x ?? 0, y: p?.y ?? 0 };
    }

    protected _rect(r: OpenSeadragon.Rect | { x: number; y: number; width: number; height: number } | undefined | null) {
        return {
            x: r?.x ?? 0,
            y: r?.y ?? 0,
            width: r?.width ?? 0,
            height: r?.height ?? 0
        };
    }

    getViewport(): ViewerViewportInfo {
        const viewer = this.activeViewer;
        const center = viewer.viewport.getCenter();
        const zoom = viewer.viewport.getZoom();
        const bounds = viewer.viewport.getBounds();
        const containerSize = viewer.viewport.getContainerSize();

        return {
            x: center.x,
            y: center.y,
            zoom,
            rotation: viewer.viewport.getRotation?.() ?? 0,
            width: bounds.width,
            height: bounds.height,
            bounds: this._rect(bounds),
            containerSize: {
                width: containerSize?.x ?? 0,
                height: containerSize?.y ?? 0
            },
            plane: {
                z: (viewer as any).bridge?.getZ?.(),
                t: (viewer as any).bridge?.getT?.()
            }
        };
    }

    focusOn(x: number, y: number, zoom?: number, plane?: ViewerPlaneInfo): void {
        const viewer = this.activeViewer;

        if (plane?.z !== undefined) {
            (viewer as any).bridge?.setZ?.(plane.z);
        }
        if (plane?.t !== undefined) {
            (viewer as any).bridge?.setT?.(plane.t);
        }

        viewer.viewport.panTo(new OpenSeadragon.Point(x, y));

        if (zoom !== undefined) {
            viewer.viewport.zoomTo(zoom);
        }

        viewer.viewport.applyConstraints();
    }

    getMetadata(): ViewerMetadata {
        const viewer = this.activeViewer;
        const item: any = viewer.world.getItemAt(0);
        const contentSize = item?.getContentSize?.();

        const referenced = (viewer as any).scalebar?.getReferencedTiledImage?.();
        const micronsX = referenced?.getWidthInMicrons?.();
        const micronsY = referenced?.getHeightInMicrons?.();

        // micronsPerPixel is the µm ÷ pixel ratio of the REFERENCED item — for a
        // virtual-region crop that ratio is the parent's (microns are propagated
        // and width is region-local, so the ratio is preserved). Report width /
        // height as the PARENT's full dimensions so scripts see the un-split slide.
        const regionW = contentSize?.x ?? 0;
        const regionH = contentSize?.y ?? 0;
        const micronsPerPixelX = micronsX && regionW ? micronsX / regionW : null;
        const micronsPerPixelY = micronsY && regionH ? micronsY / regionH : null;

        const cropped = this._croppedSourceOf(item);
        const parentDims = cropped?.getParentDimensions?.();
        const width = parentDims?.x ?? regionW;
        const height = parentDims?.y ?? regionH;

        const channels = Array.isArray((viewer as any).channels)
            ? (viewer as any).channels.map((ch: any) => ({
                name: ch?.name,
                color: ch?.color
            }))
            : undefined;

        return {
            width,
            height,
            micronsPerPixelX,
            micronsPerPixelY,
            zSpacing: (viewer as any).bridge?.getZSpacing?.() ?? null,
            channels
        };
    }

    getTiledImages() {
        const viewer = this.activeViewer;
        const count = viewer.world?.getItemCount?.() ?? 0;
        const out = [];

        for (let i = 0; i < count; i++) {
            const item: any = viewer.world.getItemAt(i);
            const contentSize = item?.getContentSize?.();
            const viewportBounds = item?.getBounds?.();
            const clip = item?.getClip?.();

            // For a virtual-region crop, place contentBounds in PARENT-GLOBAL
            // coords (the crop's rect within the parent) so scripts see where
            // this cut sits in the un-split slide.
            const cropped = this._croppedSourceOf(item);
            let contentBounds = contentSize ? { x: 0, y: 0, width: contentSize.x, height: contentSize.y } : null;
            const regionPx = cropped?.getRegionPx?.();
            if (regionPx) contentBounds = { x: regionPx.x, y: regionPx.y, width: regionPx.w, height: regionPx.h };

            out.push({
                index: i,
                width: contentSize?.x ?? 0,
                height: contentSize?.y ?? 0,
                opacity: item?.getOpacity?.(),
                clip: clip ? this._rect(clip) : null,
                contentBounds,
                viewportBounds: viewportBounds ? this._rect(viewportBounds) : null
            });
        }

        return out;
    }

    windowToViewport(x: number, y: number) {
        const viewer = this.activeViewer;
        return this._point(viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y)));
    }

    viewportToWindow(x: number, y: number) {
        const viewer = this.activeViewer;
        return this._point(viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(x, y)));
    }

    viewportToImage(x: number, y: number, tiledImageIndex = 0) {
        const item: any = this._getTiledImage(tiledImageIndex);
        let p: any = item.viewportToImageCoordinates(new OpenSeadragon.Point(x, y));
        const cropped = this._croppedSourceOf(item);
        if (cropped) p = cropped.toParentImageCoordinates(p);
        return this._point(p);
    }

    imageToViewport(x: number, y: number, tiledImageIndex = 0) {
        const item: any = this._getTiledImage(tiledImageIndex);
        const cropped = this._croppedSourceOf(item);
        const local = cropped ? cropped.fromParentImageCoordinates({ x, y }) : { x, y };
        return this._point(item.imageToViewportCoordinates(new OpenSeadragon.Point(local.x, local.y)));
    }

    windowToImage(x: number, y: number, tiledImageIndex = 0) {
        const viewer = this.activeViewer;
        const item: any = this._getTiledImage(tiledImageIndex);
        const vp = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y));
        let p: any = item.viewportToImageCoordinates(vp);
        const cropped = this._croppedSourceOf(item);
        if (cropped) p = cropped.toParentImageCoordinates(p);
        return this._point(p);
    }

    imageToWindow(x: number, y: number, tiledImageIndex = 0) {
        const viewer = this.activeViewer;
        const item: any = this._getTiledImage(tiledImageIndex);
        const cropped = this._croppedSourceOf(item);
        const local = cropped ? cropped.fromParentImageCoordinates({ x, y }) : { x, y };
        const vp = item.imageToViewportCoordinates(new OpenSeadragon.Point(local.x, local.y));
        return this._point(viewer.viewport.pixelFromPoint(vp));
    }

    getViewportBoundsInImage(tiledImageIndex = 0) {
        const viewer = this.activeViewer;
        const item: any = this._getTiledImage(tiledImageIndex);
        const bounds = viewer.viewport.getBounds();

        let topLeft: any = item.viewportToImageCoordinates(bounds.getTopLeft());
        let bottomRight: any = item.viewportToImageCoordinates(bounds.getBottomRight());
        const cropped = this._croppedSourceOf(item);
        if (cropped) {
            topLeft = cropped.toParentImageCoordinates(topLeft);
            bottomRight = cropped.toParentImageCoordinates(bottomRight);
        }

        return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y
        };
    }

    getViewportScreenshot(options?: {
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        regionWidth?: number;
        regionHeight?: number;
    }): string {
        const viewer: any = this.activeViewer;

        if (!viewer?.drawer?.canvas) {
            throw new Error("No viewport canvas is available.");
        }

        const focus = (options?.regionWidth && options?.regionHeight)
            ? new OpenSeadragon.Rect(
                options?.x ?? 0,
                options?.y ?? 0,
                options.regionWidth,
                options.regionHeight
            )
            : undefined;

        const ctx = viewer.tools?.screenshot?.(
            false,
            {
                x: options?.width ?? viewer.drawer.canvas.width,
                y: options?.height ?? viewer.drawer.canvas.height
            },
            focus
        );

        const canvas = ctx?.canvas;
        if (!canvas || typeof canvas.toDataURL !== "function") {
            throw new Error("Failed to create viewport screenshot.");
        }

        return canvas.toDataURL("image/png");
    }
}