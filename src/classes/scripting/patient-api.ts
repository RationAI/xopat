import type {ScriptApiMetadata} from "./abstract-types";
import type {PatientMetadata, PatientScriptApi, SlidePaths} from "./patient-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";
import {fetchDtsCached} from "./dts-fetch";


/**
 * Isolated scripting namespace for identifying / patient-sensitive slide information.
 *
 * This data is deliberately kept out of the general `viewer` / `application` namespaces (and out of
 * the default assistant live-context) so it can be granted/revoked independently. It is sourced from
 * the generic {@link OpenSeadragon.TileSource.getSensitiveMetadata} contract (patient metadata), the
 * physical slide label image, and the raw path / filename / session information moved out of the
 * `application` namespace.
 *
 * Everything resolves context-bound from the active viewer — never `window.VIEWER`.
 */
export class XOpatPatientScriptApi extends XOpatScriptingApi implements PatientScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatPatientScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: () => fetchDtsCached(APPLICATION_CONTEXT.url + "src/classes/scripting/patient-api.scripts.d.ts")
        }
    };

    constructor(namespace: string) {
        super(
            namespace,
            "Patient / Sensitive Data",
            "Identifying, patient-sensitive slide information (patient metadata, the physical slide label image, and raw paths / filenames) that is kept out of the general viewer and application namespaces. Select the viewer for this script context first with application.setActiveViewer().",
            true // sensitive — withheld from "grant everything but patient data" defaults
        );
    }

    /** Primary tiled image source for the context-bound viewer (scalebar-referenced, else world[0]). */
    protected _getSource(): any {
        const viewer: any = this.activeViewer;
        const item =
            viewer?.scalebar?.getReferencedTiledImage?.() ||
            (viewer?.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null);
        return item?.source ?? null;
    }

    /**
     * Normalize a TileSource ImageLike (string URL/data-URL, HTMLImageElement, Canvas,
     * CanvasRenderingContext2D, or Blob) into a PNG data-URL string. Returns null on failure.
     */
    protected async _imageLikeToDataUrl(image: any): Promise<string | null> {
        if (!image) return null;

        // Already a URL / data URL.
        if (typeof image === "string") return image;

        try {
            let canvas: HTMLCanvasElement | null = null;

            if (image instanceof HTMLCanvasElement) {
                canvas = image;
            } else if (image?.canvas instanceof HTMLCanvasElement) {
                // CanvasRenderingContext2D
                canvas = image.canvas;
            } else if (image instanceof Blob) {
                const bitmap = await createImageBitmap(image);
                canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
            } else if (image instanceof HTMLImageElement) {
                canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                canvas.getContext("2d")?.drawImage(image, 0, 0);
            }

            if (!canvas || typeof canvas.toDataURL !== "function") return null;
            return canvas.toDataURL("image/png");
        } catch (_) {
            return null;
        }
    }

    getPatientMetadata(): PatientMetadata {
        const source = this._getSource();
        let meta: unknown;
        try {
            meta = source?.getSensitiveMetadata?.();
        } catch (_) {
            meta = undefined;
        }
        return (meta && typeof meta === "object") ? meta as PatientMetadata : {};
    }

    async getSlideLabelImage(): Promise<string | null> {
        const source = this._getSource();
        if (typeof source?.getLabel !== "function") return null;
        try {
            return await this._imageLikeToDataUrl(await source.getLabel());
        } catch (_) {
            return null;
        }
    }

    async getSlideThumbnail(): Promise<string | null> {
        const source = this._getSource();
        if (typeof source?.getThumbnail !== "function") return null;
        try {
            return await this._imageLikeToDataUrl(await source.getThumbnail());
        } catch (_) {
            return null;
        }
    }

    getSlidePaths(): SlidePaths {
        const viewer: any = this.activeViewer;
        const config = APPLICATION_CONTEXT?.config;

        const firstItem =
            viewer?.scalebar?.getReferencedTiledImage?.() ||
            (viewer?.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null);

        const bgConfig = firstItem?.getConfig?.("background");
        const dataOf = (ref: unknown): string | null =>
            (typeof ref === "number" ? (config?.data?.[ref] ?? null) : null) as string | null;

        const backgroundDataPath = dataOf(bgConfig?.dataReference);

        let serverPath: string | null = backgroundDataPath;
        if (!serverPath) {
            const itemConfig = firstItem?.getConfig?.();
            serverPath =
                dataOf(itemConfig?.dataReference) ||
                (typeof firstItem?.source?.url === "string" ? firstItem.source.url : null);
        }

        const worldDataPaths: (string | null)[] = [];
        const itemCount = viewer?.world?.getItemCount?.() ?? 0;
        for (let i = 0; i < itemCount; i++) {
            const item = viewer.world.getItemAt(i);
            const itemBg = item?.getConfig?.("background");
            worldDataPaths.push(dataOf(itemBg?.dataReference));
        }

        const fileName = serverPath ? UTILITIES.fileNameFromPath(serverPath, true) : null;

        return {
            serverPath,
            backgroundDataPath,
            worldDataPaths,
            fileName,
            sessionName: APPLICATION_CONTEXT.sessionName ?? null,
        };
    }
}
