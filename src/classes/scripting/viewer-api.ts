import type {ScriptApiMetadata} from "./abstract-types";
import type {ViewerMetadata, ViewerPlaneInfo, ViewerScriptApi, ViewerViewportInfo} from "./viewer-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";

export class XOpatViewerScriptApi extends XOpatScriptingApi implements ViewerScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatViewerScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => (await fetch(APPLICATION_CONTEXT.url + "src/classes/scripting/viewer-api.scripts.d.ts").then(x => x.ok ? x.text() : ""))
        }
    };

    constructor(namespace: string) {
        super(namespace, "Viewer Interface", "The namespace provides methods to interact with the viewer - navigation, getting viewport data, and metadata. Usually the viewer must be first selected by application.setActiveViewer().");
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
            throw new Error(
                "No viewer is available. Open a slide first."
            );
        }

        throw new Error(
            "No active viewer is selected. First call application.getGlobalInfo() and then application.setActiveContext(contextId)."
        );
    }

    getViewport(): ViewerViewportInfo {
        const viewer = this._getActiveViewer();
        const center = viewer.viewport.getCenter();
        const zoom = viewer.viewport.getZoom();

        return {
            x: center.x,
            y: center.y,
            zoom,
            plane: {
                z: (viewer as any).bridge?.getZ?.(),
                t: (viewer as any).bridge?.getT?.()
            }
        };
    }

    focusOn(
        x: number,
        y: number,
        zoom?: number,
        plane?: ViewerPlaneInfo
    ): void {
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

    setPixelSize(
        width?: number | null,
        height?: number | null,
        zSpacing?: number | null
    ): void {
        const viewer = this._getActiveViewer();
        const item = viewer.world.getItemAt(0);

        if (item?.source) {
            if (width != null) (item.source as any).micronsX = width;
            if (height != null) (item.source as any).micronsY = height;
            if (zSpacing != null) (item.source as any).zSpacing = zSpacing;
        }
    }

    setChannelInfo(
        names?: Array<string | null>,
        colors?: Array<string | number | null>
    ): void {
        const viewer = this._getActiveViewer();
        const channels = (viewer as any).channels;

        if (!Array.isArray(channels)) return;

        if (Array.isArray(names)) {
            names.forEach((name, i) => {
                if (channels[i] && name != null) {
                    channels[i].name = name;
                }
            });
        }

        if (Array.isArray(colors)) {
            colors.forEach((color, i) => {
                if (channels[i] && color != null) {
                    channels[i].color = color;
                }
            });
        }
    }
}