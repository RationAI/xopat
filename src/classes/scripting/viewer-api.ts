import type {ScriptApiMetadata} from "./abstract-types";
import type {
    ViewerMetadata,
    ViewerPlaneInfo,
    ViewerScriptApi,
    ViewerViewportInfo
} from "./viewer-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";

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
            "The namespace provides methods to interact with the viewer - navigation, viewport geometry, coordinate conversions, screenshots, tiled images, and metadata. Usually the viewer must be first selected by application.setActiveViewer()."
        );
    }

    protected _getActiveViewer(): OpenSeadragon.Viewer {
        let viewer = VIEWER_MANAGER?.activeViewer;
        if (viewer) return viewer;

        const viewers = VIEWER_MANAGER?.viewers || [];

        if (viewers.length === 1) {
            viewer = viewers[0];
            VIEWER_MANAGER?.setActive?.(viewer);
            return viewer;
        }

        if (!viewers.length) {
            throw new Error("No viewer is available. Open a slide first.");
        }

        throw new Error(
            "No active viewer is selected. First call application.getGlobalInfo() and then application.setActiveViewer(contextId)."
        );
    }

    protected _getTiledImage(index = 0): OpenSeadragon.TiledImage {
        const viewer = this._getActiveViewer();
        const item = viewer.world?.getItemAt?.(index);
        if (!item) {
            throw new Error(`No tiled image found at index ${index}.`);
        }
        return item;
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
        const viewer = this._getActiveViewer();
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
        const viewer = this._getActiveViewer();

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
        const viewer = this._getActiveViewer();
        const item = viewer.world.getItemAt(0);
        const contentSize = item?.getContentSize?.();

        const micronsX = (viewer as any).scalebar?.getReferencedTiledImage?.()?.getWidthInMicrons?.();
        const micronsY = (viewer as any).scalebar?.getReferencedTiledImage?.()?.getHeightInMicrons?.();

        const width = contentSize?.x ?? 0;
        const height = contentSize?.y ?? 0;

        const channels = Array.isArray((viewer as any).channels)
            ? (viewer as any).channels.map((ch: any) => ({
                name: ch?.name,
                color: ch?.color
            }))
            : undefined;

        return {
            width,
            height,
            micronsPerPixelX: micronsX && width ? micronsX / width : null,
            micronsPerPixelY: micronsY && height ? micronsY / height : null,
            zSpacing: (viewer as any).bridge?.getZSpacing?.() ?? null,
            channels
        };
    }

    getTiledImages() {
        const viewer = this._getActiveViewer();
        const count = viewer.world?.getItemCount?.() ?? 0;
        const out = [];

        for (let i = 0; i < count; i++) {
            const item: any = viewer.world.getItemAt(i);
            const contentSize = item?.getContentSize?.();
            const viewportBounds = item?.getBounds?.();
            const clip = item?.getClip?.();

            out.push({
                index: i,
                width: contentSize?.x ?? 0,
                height: contentSize?.y ?? 0,
                opacity: item?.getOpacity?.(),
                clip: clip ? this._rect(clip) : null,
                contentBounds: contentSize ? { x: 0, y: 0, width: contentSize.x, height: contentSize.y } : null,
                viewportBounds: viewportBounds ? this._rect(viewportBounds) : null
            });
        }

        return out;
    }

    windowToViewport(x: number, y: number) {
        const viewer = this._getActiveViewer();
        return this._point(viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y)));
    }

    viewportToWindow(x: number, y: number) {
        const viewer = this._getActiveViewer();
        return this._point(viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(x, y)));
    }

    viewportToImage(x: number, y: number, tiledImageIndex = 0) {
        const item: any = this._getTiledImage(tiledImageIndex);
        return this._point(item.viewportToImageCoordinates(new OpenSeadragon.Point(x, y)));
    }

    imageToViewport(x: number, y: number, tiledImageIndex = 0) {
        const item: any = this._getTiledImage(tiledImageIndex);
        return this._point(item.imageToViewportCoordinates(new OpenSeadragon.Point(x, y)));
    }

    windowToImage(x: number, y: number, tiledImageIndex = 0) {
        const viewer = this._getActiveViewer();
        const item: any = this._getTiledImage(tiledImageIndex);
        const vp = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y));
        return this._point(item.viewportToImageCoordinates(vp));
    }

    imageToWindow(x: number, y: number, tiledImageIndex = 0) {
        const viewer = this._getActiveViewer();
        const item: any = this._getTiledImage(tiledImageIndex);
        const vp = item.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
        return this._point(viewer.viewport.pixelFromPoint(vp));
    }

    getViewportBoundsInImage(tiledImageIndex = 0) {
        const viewer = this._getActiveViewer();
        const item: any = this._getTiledImage(tiledImageIndex);
        const bounds = viewer.viewport.getBounds();

        const topLeft = item.viewportToImageCoordinates(bounds.getTopLeft());
        const bottomRight = item.viewportToImageCoordinates(bounds.getBottomRight());

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
        const viewer: any = this._getActiveViewer();

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