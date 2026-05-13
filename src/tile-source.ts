/**
 * Extending upon OpenSeadragon.TileSource, these properties are usable for advanced integration.
 */

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
    /**
     * Per-source HttpClient, stamped by `SLIDE_PROTOCOLS.resolve(...)` when the
     * resolved protocol declares `httpClient` options (proxy alias, auth ctx, …).
     * When present, both the metadata fetch (via the patched
     * `OpenSeadragon.makeAjaxRequest`) and the per-tile downloads (via
     * `downloadTileStart`) route through it — gaining CSRF, JWT and proxy
     * routing uniformly.
     */
    __xopatHttpClient?: any /* HttpClient */;
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

// Override tile fetching to route through xOpat's HttpClient when the
// TileSource was resolved from a slide protocol that declares one — gaining
// proxy routing, CSRF + JWT injection, and CORS sameness. Falls back to the
// bare-fetch path (with ad-hoc auth headers) when no per-source client is
// stamped, preserving today's behavior for TileSources opened directly
// (e.g. third-party / test paths).
tileSourcePrototype.downloadTileStart = function (this: OpenSeadragonTileSourceWithExtensions, context: OpenSeadragon.ImageJob) {
    const controller = new AbortController();
    context.userData.abortController = controller;

    const url = context.src;
    const method = context.postData ? "POST" : "GET";
    const client = this.__xopatHttpClient;

    (async () => {
        if (controller.signal.aborted) return;

        try {
            let response: Response;
            if (client && typeof client.fetchRaw === "function") {
                // The HttpClient owns auth + CSRF; we only forward OSD's
                // per-request headers (e.g. Content-Type for POST) and the
                // abort signal + body.
                response = await client.fetchRaw(url, {
                    method,
                    headers: context.ajaxHeaders || {},
                    signal: controller.signal,
                    body: context.postData || undefined,
                });
            } else {
                const authHeaders = await APPLICATION_CONTEXT.httpClient._authHeaders(url, method);
                const headers = {
                    ...authHeaders,
                    ...(context.ajaxHeaders || {})
                };
                response = await fetch(url, {
                    method,
                    headers,
                    signal: controller.signal,
                    body: context.postData || undefined,
                });
                if (!response.ok) {
                    context.fail(`HTTP ${method} ${url} failed: ${response.status}`, null);
                    return;
                }
            }

            const blob = await response.blob();
            if (controller.signal.aborted) return;

            if (blob.size === 0) {
                context.fail("[downloadTileStart] Empty image response.", null);
            } else {
                context.finish(blob, null, "rasterBlob");
            }
        } catch (err: any) {
            if (controller.signal.aborted) return;
            context.fail(err?.message ?? String(err), null);
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

// ─── makeAjaxRequest wrapper ────────────────────────────────────────────────
//
// OSD uses `OpenSeadragon.makeAjaxRequest` for the *initial metadata fetch*
// of a tile source (info.json, DZI XML, …). That call happens inside
// `instantiateTileSourceClass` before the TileSource instance exists, so we
// can't dispatch on `this.__xopatHttpClient`. Instead the slide-protocol
// registry exposes:
//   - `getActiveClientForUrl(url)` — set transiently by `withActiveClient(...)`
//     around the resolver-driven instantiate call, or matched against the
//     URL's prefix afterwards (for fetches that escape the wrapped block).
//
// When a client is found, we route via `client.fetchRaw(url, init)` and
// adapt the Response into the XHR-like object OSD's consumers expect:
// `request.response`, `request.responseText`, `request.responseXML`,
// `request.status`, `request.getResponseHeader(name)`, plus `.abort()`.
// When no client is found, we delegate to the original `makeAjaxRequest`.
const _osdNs = window.OpenSeadragon as any;
const _originalMakeAjaxRequest = _osdNs.makeAjaxRequest as (opts: any, onSuccess?: any, onError?: any) => any;

function _findActiveClient(url: string): any /* HttpClient */ | undefined {
    const registry = (window as any).SLIDE_PROTOCOLS;
    if (!registry || typeof registry.getActiveClientForUrl !== "function") return undefined;
    try { return registry.getActiveClientForUrl(url); } catch { return undefined; }
}

function _adaptResponseToXhrLike(res: Response, body: ArrayBuffer | string | null, responseType: string | undefined) {
    // OSD consumers read .response / .responseText / .responseXML / .status.
    const contentType = res.headers.get("content-type") || "";
    let responseText = "";
    let response: any = null;
    let responseXML: Document | null = null;
    if (body instanceof ArrayBuffer) {
        if (responseType === "arraybuffer") {
            response = body;
            responseText = "";
        } else if (responseType === "blob") {
            response = new Blob([body], { type: contentType });
            responseText = "";
        } else {
            // Decode as UTF-8 string for default/empty/text/document responseType.
            try { responseText = new TextDecoder("utf-8").decode(body); } catch { responseText = ""; }
            response = responseText;
        }
    } else if (typeof body === "string") {
        responseText = body;
        response = body;
    }
    if (responseText && (responseType === "document" || /xml/i.test(contentType))) {
        try {
            const parser = new DOMParser();
            responseXML = parser.parseFromString(responseText, "application/xml");
            if (responseType === "document") response = responseXML;
        } catch { responseXML = null; }
    }
    return {
        response,
        responseText,
        responseXML,
        responseType: responseType || "",
        status: res.status,
        statusText: res.statusText,
        readyState: 4,
        getResponseHeader: (name: string) => res.headers.get(name),
        getAllResponseHeaders: () => {
            const lines: string[] = [];
            res.headers.forEach((v, k) => lines.push(`${k}: ${v}`));
            return lines.join("\r\n");
        },
    };
}

_osdNs.makeAjaxRequest = function patchedMakeAjaxRequest(this: any, options: any, onSuccess?: any, onError?: any) {
    // Legacy positional form — defer to original (it emits its own deprecation warning).
    const isObjectForm = options && typeof options === "object" && !Array.isArray(options) && typeof options !== "string";
    if (!isObjectForm) return _originalMakeAjaxRequest.call(this, options, onSuccess, onError);

    const url: string = options.url;
    const client = _findActiveClient(url);
    if (!client || typeof client.fetchRaw !== "function") {
        return _originalMakeAjaxRequest.call(this, options, onSuccess, onError);
    }

    const success = options.success;
    const error = options.error;
    const headers = options.headers || {};
    const postData = options.postData ?? null;
    const responseType: string | undefined = options.responseType || undefined;

    const controller = new AbortController();
    const handle = {
        abort() { controller.abort(); },
        readyState: 1 as number,
    } as any;

    (async () => {
        try {
            const res = await client.fetchRaw(url, {
                method: postData ? "POST" : "GET",
                headers,
                body: postData ?? undefined,
                signal: controller.signal,
            });
            // OSD expects ArrayBuffer/text/Document depending on responseType.
            const wantsBinary = responseType === "arraybuffer" || responseType === "blob";
            const body = wantsBinary ? await res.arrayBuffer() : await res.text();
            if (controller.signal.aborted) return;
            const adapted = _adaptResponseToXhrLike(res, body, responseType);
            Object.assign(handle, adapted);
            if (typeof success === "function") success(handle);
        } catch (err: any) {
            if (controller.signal.aborted) return;
            handle.status = err?.response?.status ?? 0;
            handle.statusText = err?.message ?? "";
            handle.readyState = 4;
            if (typeof error === "function") error(handle, err);
            else console.error("[SLIDE_PROTOCOLS makeAjaxRequest] %s while fetching %s", err?.name, url, err);
        }
    })();

    return handle;
};
