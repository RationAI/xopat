/**
 * Extending upon OpenSeadragon.TileSource, these properties are usable for advanced integration.
 *
 * `TileSource.prototype.tryInjectPreviewLevel` — the generic synthetic
 * preview-level extension — is registered by `src/classes/preview-level.ts`,
 * loaded as its own core script right after this one (config.json `js.src`).
 */

declare const APPLICATION_CONTEXT: {
    httpClient: {
        _authHeaders(url: string, method: string): Promise<Record<string, string>>;
    };
};

type TileSourceMetadata = Record<string, unknown>;
type SlideSourceOptions = Record<string, unknown>;

type TileSourceDisplayField = { label: string; value: string | number | boolean | null };
type TileSourceDisplaySection = { title?: string; description?: string; fields?: TileSourceDisplayField[] };
type TileSourceDisplayMetadata = TileSourceDisplaySection[];


type OpenSeadragonTileSourceWithExtensions = OpenSeadragon.TileSource & {
    getMetadata(): TileSourceMetadata | undefined;
    getSensitiveMetadata(): TileSourceMetadata | undefined;
    getDisplayMetadata(): TileSourceDisplayMetadata;
    setSourceOptions(options: SlideSourceOptions): void;
    getThumbnail(): Promise<ImageLike | undefined>;
    getLabel(): Promise<ImageLike | undefined>;
    getConfig(type?: string): any;
    /**
     * Optionally report that this source decomposes into multiple aligned
     * sub-regions (a slide-wide spatial partition). Returns a
     * `VirtualDecomposition` (see app.d.ts) or `null` when the source does not
     * virtualize. The default delegates to `window.VIRTUALIZATION_DETECTORS`;
     * subclasses with native knowledge (e.g. a multi-region DICOM source) may
     * override to return their decomposition directly. See the virtual-viewports plan.
     */
    probeVirtualization(): Promise<any /* VirtualDecomposition | null */>;
    /**
     * Inject a synthetic single-tile coarsest pyramid level backed by
     * `getThumbnail()`, so slides whose real coarsest level is large (>2k px,
     * several tiles) paint on first open from at most one (cached) preview
     * request. Implemented in `src/classes/preview-level.ts`; any source
     * implementing `getThumbnail()` is eligible automatically. Idempotent;
     * returns true when the level is (already) injected. Opt out with
     * `__noPreviewLevel = true` (e.g. thumbnails not depicting the full
     * extent, or sources that change their level *count* in place).
     */
    tryInjectPreviewLevel(): boolean;
    __noPreviewLevel?: boolean;
    tileSourceId?: string;
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
 *
 * This method must return ONLY non-identifying, technical metadata (dimensions, tile size, pyramid
 * depth, pixel size via `micronsX/Y`/`microns`, channels, `error`, protocol-technical ids). Any
 * patient-identifying / PHI information belongs in {@link getSensitiveMetadata} instead — it must
 * never appear here, in `getDisplayMetadata()`, or in the general scripting namespaces.
 * @memberOf OpenSeadragon.TileSource
 * @function getMetadata
 */
tileSourcePrototype.getMetadata = function (): TileSourceMetadata { return {}; };

/**
 * Extension of OpenSeadragon: Retrieve identifying / patient-sensitive slide metadata.
 *
 * Sensitivity is a generic TileSource concern (not DICOM-only): any source that carries identifying
 * information must expose it here, kept strictly separate from {@link getMetadata}. This is the single
 * integration point for **all** patient / clinical records — anything that identifies a person or
 * discloses their clinical picture belongs here, e.g.:
 *   - patient identity: name, id, sex / gender, birth-date, age
 *   - clinical record: biopsy history, diagnosis, clinical history, and any other clinical notes
 *   - study / acquisition: accession number, institution, referring / performing physician,
 *     study & series descriptions, protocol UIDs
 *   - provenance: raw source paths / filenames (which routinely embed the above)
 *
 * The value is an arbitrary (possibly nested) key-value object; the default returns `undefined` (no
 * sensitive data). It is reachable only through:
 *   - the isolated `patient` scripting namespace (`patient.getPatientMetadata()`), never the general
 *     `viewer` / `application` namespaces or the default assistant context, and
 *   - human-facing UI that explicitly opts in — the Slide Information panel (`slide-info`) reads this
 *     getter to render a dedicated "Clinical information" card for the clinician.
 * It is never merged into {@link getMetadata} or `getDisplayMetadata()`.
 * @memberOf OpenSeadragon.TileSource
 * @function getSensitiveMetadata
 * @return {TileSourceMetadata|undefined}
 */
tileSourcePrototype.getSensitiveMetadata = function (): TileSourceMetadata | undefined { return undefined; };

/**
 * Extension of OpenSeadragon: User-facing display metadata for the Slide Information panel.
 * Returns an ordered list of card-shaped sections. Each `value` must be a primitive — no
 * nested objects, no functions, no internal handler queues. Return [] when there is
 * nothing user-relevant to show; the panel falls back to its own "no metadata" notice.
 *
 * The default reads safe scalars off the TileSource itself (dimensions, tile size, pyramid
 * depth) and folds in pixel size / error from `getMetadata()` when present. Subclasses
 * should override to add domain-specific fields (slide id, channels, …).
 *
 * @memberOf OpenSeadragon.TileSource
 * @function getDisplayMetadata
 */
tileSourcePrototype.getDisplayMetadata = function (this: OpenSeadragonTileSourceWithExtensions): TileSourceDisplayMetadata {
    const self = this as any;
    const fields: TileSourceDisplayField[] = [];

    if (self.width != null && self.height != null) {
        fields.push({ label: "Dimensions", value: `${self.width} × ${self.height} px` });
    }
    const tw = self._tileWidth ?? self.tileSize;
    const th = self._tileHeight ?? self.tileSize;
    if (tw != null) {
        fields.push({ label: "Tile size", value: th != null && th !== tw ? `${tw} × ${th} px` : `${tw} px` });
    }
    if (Number.isFinite(self.maxLevel)) {
        fields.push({ label: "Pyramid levels", value: (self.maxLevel as number) + 1 });
    }

    let meta: TileSourceMetadata | undefined;
    try { meta = this.getMetadata?.(); } catch { meta = undefined; }
    const m = meta as any;

    if (m?.micronsX != null || m?.micronsY != null) {
        const x = m.micronsX ?? m.microns;
        const y = m.micronsY ?? m.microns;
        if (Number.isFinite(x) && Number.isFinite(y)) {
            fields.push({ label: "Pixel size", value: `${Number(x).toFixed(3)} × ${Number(y).toFixed(3)} µm` });
        }
    } else if (Number.isFinite(m?.microns)) {
        fields.push({ label: "Pixel size", value: `${Number(m.microns).toFixed(3)} µm` });
    }

    if (m?.error) {
        return [{ title: "Slide unavailable", description: String(m.error) }];
    }

    return fields.length ? [{ title: "Slide", fields }] : [];
};

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

/**
 * Extension of OpenSeadragon: probe whether this source splits into multiple
 * aligned virtual sub-sources. Default delegates to the optional
 * `window.VIRTUALIZATION_DETECTORS` registry (supplied by a detector module);
 * absent that module, sources never virtualize and this returns `null`.
 * @memberOf OpenSeadragon.TileSource
 * @function probeVirtualization
 * @return {Promise<VirtualDecomposition|null>}
 */
tileSourcePrototype.probeVirtualization = async function (this: OpenSeadragonTileSourceWithExtensions): Promise<any> {
    const registry = (window as any).VIRTUALIZATION_DETECTORS;
    if (!registry || typeof registry.detect !== "function") return null;
    try {
        return await registry.detect(this);
    } catch (e) {
        console.warn("[probeVirtualization] detector failed:", e);
        return null;
    }
};

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
