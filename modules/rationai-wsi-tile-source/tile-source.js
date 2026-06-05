// noinspection JSUnresolvedVariable

/**
 * @class RationaiStandaloneV3TileSource
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 * @param {object} options configuration either empaia info response or list of these objects
 */
OpenSeadragon.RationaiStandaloneV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);

        if (!this.__configuredDownload) {
            this._setDownloadHandler(options.multifetch);
        }

        // Auth (JWT and friends) is owned by the per-source HttpClient stamped
        // by the slide-protocol registry (`__xopatHttpClient`). No more manual
        // `XOpatUser` listener juggling here — the client refreshes secrets on
        // 401 via its own pipeline. Protocols without a registered HttpClient
        // fall back to bare fetch with whatever `ajaxHeaders` OSD passes.
        this._qArgs = "";
        this._dataFormat = "rasterBlob";
        // Initialize so getMetadata() / getDisplayMetadata() always return
        // a usable shape even before _getInfo resolves or when it fails.
        if (!this.metadata) this.metadata = {};
    }

    /**
     * Issue a GET (or whatever `init` says) routed through this source's
     * per-protocol HttpClient when one was stamped by the slide-protocol
     * registry. Falls back to a bare `fetch` for protocols that don't declare
     * an `httpClient` block in env.json — preserves old direct-fetch behaviour
     * for unauthenticated public image servers.
     */
    _fetch(url, init = undefined) {
        const client = this.__xopatHttpClient;
        if (client && typeof client.fetchRaw === "function") {
            return client.fetchRaw(url, init);
        }
        return fetch(url, init);
    }

    /**
     * WSI Server Source Options. For available options see the server documentation.
     * @param {SlideSourceOptions} options
     * @param {?String} options.format - image format, default undefined, 'tiff', 'jpeg', 'png', 'bmp'..
     * @param {?Number} options.quality - image quality, default undefined, 0-100
     * @param {?'all'|Array<number>} options.channels - applies only for 'tiff' format, channels to fetch
     */
    setSourceOptions(options) {
        const params = new URLSearchParams(this._qArgs || '');
        const availableChannels = this.data && this.data.channels;
        const channelCount = Array.isArray(availableChannels) ? availableChannels.length : undefined;
        const format =
            options.format !== undefined
                ? options.format
                : (channelCount !== undefined && channelCount !== 3 && channelCount !== 4 ? 'tiff' : undefined);

        if (format) {
            params.set('image_format', format);
        }
        this._dataFormat = format === 'tiff' ? 'rawTiff' : 'rasterBlob';

        if (options.quality) {
            params.set('image_quality', options.quality);
        }

        const channelsOpt =
            options.channels !== undefined
                ? options.channels
                : (options.image_channels !== undefined ? options.image_channels : 'all');

        const addChannelParam = id => {
            if (id === undefined || id === null) return;
            params.append('image_channels', String(id));
        };

        params.delete('image_channels');

        if (channelsOpt === 'all') {
            // Use all IDs from slide info if available
            if (Array.isArray(availableChannels) && availableChannels.length > 0) {
                for (const ch of availableChannels) {
                    // Channel might be a number or an object
                    if (typeof ch === 'number') {
                        addChannelParam(ch);
                    } else if (typeof ch === 'object') {
                        addChannelParam(
                            ch.id ??
                            ch.channel_id ??
                            ch.index
                        );
                    }
                }
            }
            // else: no channel info known → fall back to server default
        } else if (Array.isArray(channelsOpt)) {
            for (const ch of channelsOpt) {
                addChannelParam(ch);
            }
        }

        this._qArgs = params.toString();
        if (this._qArgs.length > 0) {
            this._qArgs = '&' + this._qArgs;
        }
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @param {(Object|Array<Object>)} data
     * @param {String} url
     */
    supports( data, url ) {
        if (data.url && data.type && data.type === "empaia-standalone") {
            // Auth headers (if any) come from the per-source HttpClient at
            // request time; no need to stamp Authorization on `data.ajaxHeaders` here.
            return true;
        }

        if (!url && !Array.isArray(data) && typeof data !== "object") return false;
        //multi-tile or single tile access
        let match = url.match(/^(\/?[^\/].*\/v3\/files)\/info/i);
        if (match) {
            data = data || [{}];
            data[0].tilesUrl = match[1];
            return true;
        }
        match = url.match(/^(\/?[^\/].*\/v3\/slides)\/info/i);
        if (match) {
            data = data || {};
            data.tilesUrl = match[1];
            return true;
        }
        return false;
    }

    /**
     * @function
     * @param {(Object|XMLDocument)} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure( data, url, postData ) {
        if (data.type === "empaia-standalone" && !data.id) {
            // data.url is set, which will trigger getImageInfo() and call configure second time with real data
            data._handlesOwnImageLoadLogics = true;
            // Placeholder; real slide metadata will be configured after _getInfo resolves.
            data._isVector = false;
            return data;
        }

        // Auth is owned by the per-source HttpClient (`__xopatHttpClient`); no
        // need to materialise an `Authorization` header here.
        if (!Array.isArray(data)) {
            if (!data) {
                this.metadata = {error: "Invalid data: no data available for given url " + url}
                return;
            }

            if (data.format && data.format.toLowerCase().includes('mvt')) {
                // Vector MVT path using WSI-Service tile URL conventions.
                if (!Array.isArray(data.levels) || data.levels.length === 0) {
                    console.error('RationaiStandaloneV3TileSource: MVT slide info missing levels', data);
                    return undefined;
                }
                // data.tilesUrl is set by supports() in the standard flow. In the
                // empaia-standalone flow _getInfo calls configure() with raw server JSON
                // that does not carry tilesUrl, so fall back to extracting it from url.
                const tilesUrl = data.tilesUrl
                    || url?.match(/^(\/?[^\/].*\/v3\/(?:files|slides))/i)?.[1];
                if (!tilesUrl || !data.id) {
                    console.error('RationaiStandaloneV3TileSource: MVT configure missing tilesUrl or id', { tilesUrl, id: data.id });
                    return undefined;
                }
                const tileSize = data.tile_extent?.x || 512;
                const maxLevel = data.levels.length - 1;
                const template = `${tilesUrl}/tile/level/{z}/tile/{x}/{y}?slide_id=${data.id}`;
                const worldSize = Math.pow(2, maxLevel) * tileSize;
                return {
                    _isVector: true,
                    template,
                    scheme: 'xyz',
                    tileSize,
                    minLevel: 0,
                    maxLevel,
                    width: worldSize,
                    height: worldSize,
                    // MVT coordinate extent: 4096 is the Mapbox Vector Tile spec constant
                    // (tile-internal coordinate space). WSI-Service does not expose this
                    // separately; tile_extent is the pixel size, not the MVT extent.
                    extent: 4096,
                    // defaultStyle() lives in flex-renderer; null lets the MVT pipeline apply it.
                    style: data.style || null,
                    useNativeLines: false,
                    // Let the MVT pipeline fall back to FlexDrawer._defaultHttpAdapter.
                    httpAdapter: null,
                    innerFormat: data.format,
                    multifetch: false,
                    fileId: data.id,
                    tilesUrl: tilesUrl,
                    metadata: (() => {
                        const ps = data.pixel_size_nm;
                        const x = ps?.x, y = ps?.y;
                        if (x == null || y == null || x === 1000000 || y === 1000000) return {};
                        return { micronsX: x / 1000, micronsY: y / 1000 };
                    })(),
                    data: data,
                };
            }

            //unset if default value
            let chosenMq = data.pixel_size_nm;
            let size = data.extent, tile = data.tile_extent;
            if (chosenMq.x === 1000000) chosenMq = null;
            return {
                _isVector: false,
                width: size.x,
                height: size.y,
                _tileWidth: tile.x,
                _tileHeight: tile.y,
                tileSize: tile.x,
                maxLevel: data.levels.length-1,
                minLevel: 0,
                tileOverlap: 0,
                fileId: data.id,
                tilesUrl: data.tilesUrl,
                innerFormat: data.format,
                multifetch: false,
                // values returned here get attached to 'this', we return this.metadata in getMetadata()
                metadata: {
                    // empaia stores pixel size in nanometers, we need microns
                    micronsX: chosenMq?.x / 1000,
                    micronsY: chosenMq?.y / 1000,
                },
                data: data
            };
        }

        if (data.length === 0) {
            this.metadata = {error: "Invalid data: no data available for given url " + url}
            return;
        }

        let width         = Infinity,
            height        = Infinity,
            chosenMq      = undefined,
            represent     = undefined,
            tileSizeX      = undefined,
            tileSizeY      = undefined,
            maxLevel      = Infinity,
            tileOverlap   = 0;

        for (let i = 0; i < data.length; i++) {
            let image = data[i],
                imageWidth = parseInt( image.extent.x, 10 ),
                imageHeight = parseInt( image.extent.y, 10 ),
                imageTileSizeX = parseInt( image.tile_extent.x, 10 ),
                imageTileSizeY = parseInt( image.tile_extent.y, 10 );

            if (imageWidth < 1 || imageHeight < 1) {
                image.error = "Missing image data.";
                continue;
            }

            if (tileSizeX === undefined) {
                tileSizeX = imageTileSizeX;
                tileSizeY = imageTileSizeY;
            }

            if (imageTileSizeX !== tileSizeX || imageTileSizeY !== tileSizeY) {
                image.error = "Incompatible layer: the rendering might contain artifacts.";
            }

            if (imageWidth < width || imageHeight < height) {
                //possibly experiment with taking maximum
                width = imageWidth;
                height = imageHeight;
                represent = image;
                chosenMq = image.pixel_size_nm;
            }
            maxLevel = Math.min(maxLevel, image.levels.length);
        }

        //unset if default value
        if (chosenMq.x === 1000000) chosenMq = null;
        return {
            _isVector: false,
            width: width, /* width *required */
            height: height, /* height *required */
            _tileWidth: tileSizeX,
            _tileHeight: tileSizeY,
            tileSize: tileSizeX, /* tileSize *required */
            tileOverlap: tileOverlap, /* tileOverlap *required */
            minLevel: 0, /* minLevel */
            maxLevel: maxLevel-1, /* maxLevel */
            fileId: data.map(image => image.id).join(','),
            innerFormat: data[0].format,
            tilesUrl: data[0].tilesUrl,
            multifetch: true,
            data: represent,
            dataSet: data,
            metadata: {
                micronsX: chosenMq?.x / 1000,
                micronsY: chosenMq?.y / 1000,
            },
        };
    }

    getLevelScale(level) {
        const serverLevel = this.maxLevel - level;
        const levels = this.data.levels;

        const getDS = (lvl, idx) => {
            if (lvl.downsample_factor != null) return Number(lvl.downsample_factor);
            if (lvl.downsample != null)        return Number(lvl.downsample);
            // worst-case fallback
            return Math.pow(2, idx);
        };

        const dsBase = getDS(levels[0], 0);
        const dsHere = getDS(levels[serverLevel], serverLevel);
        return dsBase / dsHere;
    }

    getImageInfo(url) {
        if (!this._handlesOwnImageLoadLogics) return super.getImageInfo(url);

        let match = url.match(/^(\/?[^\/].*\/v3\/files)\/info/i);
        if (match) {
            this._setDownloadHandler(true);
            return this._getInfo(url, match[1]);
        }
        match = url.match(/^(\/?[^\/].*\/v3\/slides)\/info/i);
        if (match) {
            this._setDownloadHandler(false);
            return this._getInfo(url, match[1]);
        }
        throw "The empaia standalone tile source is not configured with a proper URL!";
    }

    _getInfo(url, tilesUrl) {
        this._fetch(url, {
            headers: this.ajaxHeaders || {}
        }).then(async res => {
            const text = await res.text();
            let json;
            try { json = JSON.parse(text) } catch (e) {}
            if (res.status !== 200 || !json) {
                throw new HTTPError("Empaia standalone failed to fetch image info!", json || text, res.error);
            }
            return json;
        }).then(imageInfo => {
            const data = this.configure(imageInfo, url, null);
            // necessary TileSource props that wont get set manually
            data.dimensions  = new OpenSeadragon.Point( data.width, data.height );
            data.aspectRatio = data.width / data.height;
            data.tilesUrl = tilesUrl;
            data.ready = true;
            OpenSeadragon.extend(this, data);
            this.raiseEvent('ready', {tileSource: this});
        }).catch(e => {
            // Capture the error on the source so getMetadata / getDisplayMetadata
            // surface it in the Slide Information panel instead of silently
            // returning undefined.
            this.metadata = { ...(this.metadata || {}), error: (e && (e.message || String(e))) || "Failed to load slide info." };
            this.raiseEvent( 'open-failed', {
                message: e,
                source: url,
                postData: null
            });
        });
    }

    getMetadata() {
        return this.metadata;
    }

    getDisplayMetadata() {
        const m = this.metadata || {};
        if (m.error) return [{ title: "Slide unavailable", description: String(m.error) }];

        const fields = [];
        if (this.width != null && this.height != null) {
            fields.push({ label: "Dimensions", value: `${this.width} × ${this.height} px` });
        }
        const tw = this._tileWidth ?? this.tileSize;
        const th = this._tileHeight ?? this.tileSize;
        if (tw != null) {
            fields.push({ label: "Tile size", value: th != null && th !== tw ? `${tw} × ${th} px` : `${tw} px` });
        }
        if (Number.isFinite(this.maxLevel)) {
            fields.push({ label: "Pyramid levels", value: this.maxLevel + 1 });
        }
        if (Number.isFinite(m.micronsX) && Number.isFinite(m.micronsY)) {
            fields.push({ label: "Pixel size", value: `${Number(m.micronsX).toFixed(3)} × ${Number(m.micronsY).toFixed(3)} µm` });
        }
        if (this.fileId) fields.push({ label: "Slide ID", value: String(this.fileId) });
        if (this.innerFormat) fields.push({ label: "Format", value: String(this.innerFormat) });
        return fields.length ? [{ title: "RationAI slide", fields }] : [];
    }

    /**
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @return {string}
     */
    getTileUrl( level, x, y ) {
        if (this._isVector) {
            // WSI-Service level 0 is the highest resolution; OSD level 0 is the lowest.
            const wsiLevel = this.maxLevel - level;
            const ty = this.scheme === 'tms' ? ((1 << level) - 1 - y) : y;
            return this.template
                .replace('{z}', wsiLevel)
                .replace('{x}', x)
                .replace('{y}', ty);
        }
        return this.getUrl(level, x, y);
    }

    /**
     * More generic for other approaches
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @param {String} tiles optionally, provide tiles URL
     * @return {string}
     */
    getUrl( level, x, y, tiles=this.tilesUrl ) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,

        if (this.multifetch) {
            //endpoint files/tile/level/[L]/tile/[X]/[Y]/?paths=id,list,separated,by,commas
            return `${tiles}/tile/level/${level}/tile/${x}/${y}?paths=${this.fileId}${this._qArgs}`;
        }
        //endpoint slides/tile/level/[L]/tile/[X]/[Y]/?slide_id=id
        return `${tiles}/tile/level/${level}/tile/${x}/${y}?slide_id=${this.fileId}${this._qArgs}`;
    }

    async getThumbnail({ targetWidth = 512 } = {}) {
        targetWidth = Math.min(targetWidth, 500); //default max value
        const res = await this._fetch(
            `${this.tilesUrl}/thumbnail/max_size/${targetWidth}/${targetWidth}?slide_id=${this.fileId}${this._qArgs}`
        );
        return res.blob();
    }

    async getLabel() {
        const targetWidth = 250;
        const res = await this._fetch(
            `${this.tilesUrl}/label/max_size/${targetWidth}/${targetWidth}?slide_id=${this.fileId}${this._qArgs}`
        );
        return res.blob();
    }

    /**
     * @returns {Promise<ArrayBuffer>}
     */
    async downloadICCProfile() {
        const res = await this._fetch(`${this.tilesUrl}/icc_profile?slide_id=${this.fileId}`);
        return res.arrayBuffer();
    }

    _setDownloadHandler(isMultiplex) {

        let blackImage = (context, resolve, reject) => {
            const canvas = document.createElement('canvas');
            canvas.width = context.getTileWidth();
            canvas.height = context.getTileHeight();
            const ctx = canvas.getContext('2d');
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const img = new Image(canvas.width, canvas.height);
            img.onload = () => {
                //next promise just returns the created object
                blackImage = (context, ready, _) => ready(img);
                resolve(img);
            };
            img.onerror = img.onabort = reject;
            img.src = canvas.toDataURL();
        };

        if (isMultiplex) {
            // Override only the raster path; downloadTileStart remains the raster/vector dispatcher.
            this.__cached_rasterDownload = this._rasterDownloadTileStart;
            this._rasterDownloadTileStart = function(context) {
                const abort = context.finish.bind(context, null, undefined);
                if (!context.loadWithAjax) {
                    abort("DeepZoomExt protocol with ZIP does not support fetching data without ajax!");
                }

                var dataStore = context.userData;
                // Auth headers (if any) are injected by the patched
                // `OpenSeadragon.makeAjaxRequest` when this source carries a
                // `__xopatHttpClient`. Nothing to add manually.
                const _this = this;

                dataStore.request = OpenSeadragon.makeAjaxRequest({
                    url: context.src,
                    withCredentials: context.ajaxWithCredentials,
                    headers: context.ajaxHeaders,
                    responseType: "arraybuffer",
                    postData: context.postData,
                    success: async function(request) {
                        var blb;
                        try {
                            blb = new window.Blob([request.response]);
                        } catch (e) {
                            var BlobBuilder = (
                                window.BlobBuilder ||
                                window.WebKitBlobBuilder ||
                                window.MozBlobBuilder ||
                                window.MSBlobBuilder
                            );
                            if (e.name === 'TypeError' && BlobBuilder) {
                                var bb = new BlobBuilder();
                                bb.append(request.response);
                                blb = bb.getBlob();
                            }
                        }
                        // If the blob is empty for some reason consider the image load a failure.
                        if (blb.size === 0) {
                            return abort("Empty image response.");
                        }

                        const {zip, entries} = await unzipit.unzipRaw(blb);
                        Promise.all(
                            Object.entries(entries).map(([name, entry]) => {
                                if (entry.name.endsWith(".err")) {
                                    return new Promise((resolve, reject) => blackImage(_this, resolve, reject));
                                }

                                return new Promise((resolve, reject) => {
                                    entry.blob().then(blob => {
                                        if (blob.size > 0) {
                                            const img = new Image(), url = URL.createObjectURL(blob);
                                            img.onload = () => {
                                                URL.revokeObjectURL(url);
                                                resolve(img);
                                            };
                                            img.onerror = img.onabort = () => {
                                                URL.revokeObjectURL(url);
                                                reject();
                                            };
                                            img.src = url;
                                        } else blackImage(_this, resolve, reject);
                                    });
                                });
                            })
                        ).then(result =>
                            //we return array of promise responses - images
                            // todo does not work well -> fix this
                            context.finish(result, dataStore.request, "image[]")
                        ).catch(
                            abort
                        );
                    },
                    error(request) {
                        abort("Image load aborted - XHR error");
                    }
                });
            }
            //no need to provide downloadTileAbort since we keep the meta structure
            this.__cached_downloadTileAbort = this.downloadTileAbort;
            this.downloadTileAbort = OpenSeadragon.TileSource.prototype.downloadTileAbort;
        } else if (this.__cached_rasterDownload) {
            this._rasterDownloadTileStart = this.__cached_rasterDownload;
            this.downloadTileAbort = this.__cached_downloadTileAbort;
        }
        this.__configuredDownload = true;
    }

    // Single-tile raster download path. Routes through the per-source HttpClient
    // (proxy + CSRF + auth) when present, falls back to bare fetch otherwise.
    // Kept separate from downloadTileStart because this source needs to pass
    // `this._dataFormat` ("rawTiff" for multi-channel TIFF, "rasterBlob"
    // otherwise) to `imageJob.finish`; the prototype patch in `src/tile-source.ts`
    // uses "rasterBlob" unconditionally.
    _rasterDownloadTileStart(imageJob) {
        const controller = new AbortController();
        imageJob.userData.abortController = controller;
        this._fetch(imageJob.src, {
            method: "GET",
            headers: imageJob.ajaxHeaders || {},
            signal: controller.signal,
            body: imageJob.postData || undefined,
        }).then(res => res.blob()).then(data => {
            if (controller.signal.aborted) return;
            if (data.size === 0) imageJob.fail("Empty image response.", null);
            else imageJob.finish(data, null, this._dataFormat);
        }).catch(e => {
            if (controller.signal.aborted) return;
            imageJob.fail('Failed to fetch tile: ' + (e?.message ?? e), null);
        });
    }

    downloadTileAbort(imageJob) {
        imageJob.userData?.abortController?.abort();
    }

    // Lazily installs the shared MVT worker pipeline on this WSI tile source.
    _ensureVectorPipeline() {
        if (this._vectorPipelineInitialized) {
            return true;
        }
        if (this._vectorPipelineFailed) {
            return false;
        }

        const AbstractMVT = OpenSeadragon.FlexRenderer?.MVT?.AbstractTileSource;
        if (!AbstractMVT) {
            return false;
        }

        if (!this.template || !this.scheme || this.extent == null) {
            console.error('RationaiStandaloneV3TileSource: cannot init vector pipeline — missing required fields',
                { template: this.template, scheme: this.scheme, extent: this.extent });
            this._vectorPipelineFailed = true;
            return false;
        }

        try {
            AbstractMVT.prototype._initVectorPipeline.call(this, {
                template:       this.template,
                scheme:         this.scheme,
                extent:         this.extent,
                style:          this.style || null,
                useNativeLines: this.useNativeLines,
                httpAdapter:    this.httpAdapter || null,
            });
        } catch (e) {
            console.error('RationaiStandaloneV3TileSource: vector pipeline init failed', e);
            this._vectorPipelineFailed = true;
            return false;
        }

        if (!this._worker || !this._pending) {
            console.error('RationaiStandaloneV3TileSource: vector pipeline incomplete after init',
                { worker: !!this._worker, pending: !!this._pending });
            this._vectorPipelineFailed = true;
            return false;
        }

        this._vectorPipelineInitialized = true;
        return true;
    }

    downloadTileStart(context) {
        if (this._isVector) {
            const AbstractMVT = OpenSeadragon.FlexRenderer?.MVT?.AbstractTileSource;

            if (!AbstractMVT || !this._ensureVectorPipeline()) {
                const message =
                    "RationaiStandaloneV3TileSource: MVT vector tiles require " +
                    "OpenSeadragon.FlexRenderer.MVT.AbstractTileSource. " +
                    "Ensure flex-renderer.js is loaded.";

                if (typeof context.fail === "function") {
                    context.fail(message);
                } else {
                    context.finish?.(null, undefined, message);
                }
                return;
            }

            AbstractMVT.prototype.downloadTileStart.call(this, context);
            return;
        }

        this._rasterDownloadTileStart(context);
    }

    getTileHashKey(level, x, y, url, ajaxHeaders, postData) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
        return `${x}_${y}/${level}/${this.fileId}`;
    }
};
