/**
 * Extending upon OpenSeadragon.TileSource, these properties are usable for advanced integration.
 */
import type {ImageLike} from "./types/misc";

declare const APPLICATION_CONTEXT: {
    httpClient: {
        _authHeaders(url: string, method: string): Promise<Record<string, string>>;
    };
};

type TileSourceMetadata = Record<string, unknown>;
type SlideSourceOptions = Record<string, unknown>;


type OpenSeadragonTileSourceWithExtensions = OpenSeadragon.TileSource & {
    getMetadata(): TileSourceMetadata | undefined;
    setSourceOptions(options: SlideSourceOptions): void;
    getThumbnail(): Promise<ImageLike | undefined>;
    getLabel(): Promise<ImageLike | undefined>;
    getConfig(type?: string): any;
};

const tileSourcePrototype = window.OpenSeadragon.TileSource.prototype as OpenSeadragonTileSourceWithExtensions;


/**
 * Extension of OpenSeadragon: Retrieve slide metadata. Can be arbitrary key-value list, even nested.
 * Some properties, hovewer, have a special meaning. These are documented in the return function.
 * @memberOf OpenSeadragon.TileSource
 * @function getMetadata
 */
tileSourcePrototype.getMetadata = function (): TileSourceMetadata { return {}; };

/**
 * Set source options.
 * @memberOf OpenSeadragon.TileSource
 * @function setSourceOptions
 * @param {SlideSourceOptions} options
 */
tileSourcePrototype.setSourceOptions = function (options: SlideSourceOptions): SlideSourceOptions | undefined { return undefined; };

/**
 * Extension of OpenSeadragon: Retrieve slide thumbnail. This can simplify the
 * slide preview generation, instead of trying to re-construct it from the lowest-resolution level.
 * Returns a promise that resolves to an image-like object.
 * @memberOf OpenSeadragon.TileSource
 * @function getThumbnail
 * @return {Promise<string|HTMLImageElement|CanvasRenderingContext2D|HTMLCanvasElement|Blob|undefined>}
 */
tileSourcePrototype.getThumbnail = function (): Promise<ImageLike | undefined> { return Promise.resolve(undefined); };

/**
 * Extension of OpenSeadragon: Retrieve slide label.
 * @memberOf OpenSeadragon.TileSource
 * @function getLabel
 * @return {Promise<string|HTMLImageElement|CanvasRenderingContext2D|HTMLCanvasElement|Blob|undefined>}
 */
tileSourcePrototype.getLabel = function (): Promise<ImageLike | undefined> { return Promise.resolve(undefined); };

// override tile fetching to use the core http client
tileSourcePrototype.downloadTileStart = function (context: OpenSeadragon.ImageJob) {
    const controller = new AbortController();
    context.userData.abortController = controller;

    const url = context.src;
    const method = context.postData ? "POST" : "GET";

    (async () => {
        if (controller.signal.aborted) return;

        const authHeaders = await APPLICATION_CONTEXT.httpClient._authHeaders(url, method);
        const headers = {
            ...authHeaders,
            ...(context.ajaxHeaders || {})
        };

        const init: RequestInit = {
            method,
            headers,
            signal: controller.signal,
            body: context.postData || undefined
        };

        // 2. Perform a single Request
        // TODO: here we do manual fetch -> we should use the client, but then we would not
        //  use the osd headers correctly. Once we update openseadragon to better support
        //  this, we will configure OSD to use the client and throw away this poatch.
        const response = await fetch(url, init);

        // 3. Fail immediately if not successful
        if (!response.ok) {
            context.fail(`HTTP ${method} ${url} failed: ${response.status}`, null);
            return;
        }

        // 4. Process Successful Response into a Blob
        const blob = await response.blob();
        if (controller.signal.aborted) return;

        if (blob.size === 0) {
            context.fail("[downloadTileStart] Empty image response.", null);
        } else {
            context.finish(blob, null, "rasterBlob");
        }
    })();
};

/**
 * Patch: OpenSeadragon Tile Download Abort
 * Intercepts the request abortion and delegates it to the Fetch AbortController.
 */
tileSourcePrototype.downloadTileAbort = function (context: OpenSeadragon.ImageJob) {
    if (context.userData && context.userData.abortController) {
        context.userData.abortController.abort();
        context.userData.abortController = null;
    }
};
