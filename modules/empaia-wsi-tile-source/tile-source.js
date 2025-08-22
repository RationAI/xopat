// noinspection JSUnresolvedVariable

/**
 * @class EmpaiaStandaloneV3TileSource
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 * @param {object} options configuration either empaia info response or list of these objects
 */
OpenSeadragon.EmpaiaStandaloneV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);

        // if (!this.__configuredDownload) {
        //     this._setDownloadHandler(options.multifetch);
        // }
    }


    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @param {(Object|Array<Object>)} data
     * @param {String} url
     */
    supports( data, url ) {
        if (url && Array.isArray(data)) {
            //multi-tile or single tile access, batch is old name on the api
            let match = url.match(/^(\/?[^\/].*\/v3\/)(files|batch)\/info/i);
            if (match) {
                data = data || [{}];
                data[0].tilesUrl = match[1] + match[2];
                return true;
            }
        } else if (url && typeof data === "object") {
            let match = url.match(/^(\/?[^\/].*\/v3\/slides)\/info/i);
            if (match) {
                data = data || {};
                data.tilesUrl = match[1];
                return true;
            }
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
        if (!Array.isArray(data)) {
            if (!data) {
                this.metadata = {error: "Invalid data: no data available for given url " + url}
                return;
            }

            //unset if default value
            let chosenMq = data.pixel_size_nm;
            let size = data.extent, tile = data.tile_extent;
            if (chosenMq.x === 1000000) chosenMq = null;
            return {
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
                metadata: {
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

    getLevelScale( level ) {
        level = this.maxLevel-level;
        const levels = this.data.levels;
        return levels[level].extent.x / levels[0].extent.x;
    }

    _getInfo(url, tilesUrl) {
        fetch(url).then(async res => {
            const text = await res.text();
            const json = JSON.parse(text);
            if (res.status !== 200) {
                throw new HTTPError("Empaia standalone failed to fetch image info!", json, res.error);
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

    /**
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @return {string}
     */
    getTileUrl( level, x, y ) {
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
            //endpoint files/tile/level/[L]/tile/[X]/[Y]/?paths=path,list,separated,by,commas
            const query_name = tiles.endsWith("batch") ? "slides" : "paths";
            return `${tiles}/tile/level/${level}/tile/${x}/${y}?${query_name}=${this.fileId}`
        }
        //endpoint slides/[SLIDE]/tile/level/[L]/tile/[X]/[Y]/
        const query_name = tiles.endsWith("batch") ? "slides" : "slide_id";
        return `${tiles}/tile/level/${level}/tile/${x}/${y}?${query_name}=${this.fileId}`
    }


    // Todo multiplex not supported for now, OSD needs to have grouping mechanism on requests
    // _setDownloadHandler(isMultiplex) {
    //
    //     let blackImage = (context, resolve, reject) => {
    //         const canvas = document.createElement('canvas');
    //         canvas.width = context.getTileWidth();
    //         canvas.height = context.getTileHeight();
    //         const ctx = canvas.getContext('2d');
    //         ctx.fillRect(0, 0, canvas.width, canvas.height);
    //
    //         const img = new Image(canvas.width, canvas.height);
    //         img.onload = () => {
    //             //next promise just returns the created object
    //             blackImage = (context, ready, _) => ready(img);
    //             resolve(img);
    //         };
    //         img.onerror = img.onabort = reject;
    //         img.src = canvas.toDataURL();
    //     };
    //
    //     if (isMultiplex) {
    //         this.__cached_downloadTileStart = this.downloadTileStart;
    //         this.downloadTileStart = function(context) {
    //             const abort = context.fail.bind(context, "Image load aborted!");
    //             if (!context.loadWithAjax) {
    //                 abort("DeepZoomExt protocol with ZIP does not support fetching data without ajax!");
    //             }
    //
    //             var dataStore = context.userData;
    //             const _this = this;
    //
    //             dataStore.request = OpenSeadragon.makeAjaxRequest({
    //                 url: context.src,
    //                 withCredentials: context.ajaxWithCredentials,
    //                 headers: context.ajaxHeaders,
    //                 responseType: "arraybuffer",
    //                 postData: context.postData,
    //                 success: async function(request) {
    //                     var blb;
    //                     try {
    //                         blb = new window.Blob([request.response]);
    //                     } catch (e) {
    //                         var BlobBuilder = (
    //                             window.BlobBuilder ||
    //                             window.WebKitBlobBuilder ||
    //                             window.MozBlobBuilder ||
    //                             window.MSBlobBuilder
    //                         );
    //                         if (e.name === 'TypeError' && BlobBuilder) {
    //                             var bb = new BlobBuilder();
    //                             bb.append(request.response);
    //                             blb = bb.getBlob();
    //                         }
    //                     }
    //                     // If the blob is empty for some reason consider the image load a failure.
    //                     if (blb.size === 0) {
    //                         return abort("Empty image response.");
    //                     }
    //
    //                     const {zip, entries} = await unzipit.unzipRaw(blb);
    //                     Promise.all(
    //                         Object.entries(entries).map(([name, entry]) => {
    //                             if (entry.name.endsWith(".err")) {
    //                                 return new Promise((resolve, reject) => blackImage(_this, resolve, reject));
    //                             }
    //
    //                             return new Promise((resolve, reject) => {
    //                                 entry.blob().then(blob => {
    //                                     if (blob.size > 0) {
    //                                         const img = new Image(), url = URL.createObjectURL(blob);
    //                                         img.onload = () => {
    //                                             URL.revokeObjectURL(url);
    //                                             resolve(img);
    //                                         };
    //                                         img.onerror = img.onabort = () => {
    //                                             URL.revokeObjectURL(url);
    //                                             reject();
    //                                         };
    //                                         img.src = url;
    //                                     } else blackImage(_this, resolve, reject);
    //                                 });
    //                             });
    //                         })
    //                     ).then(result =>
    //                         //we return array of promise responses - images
    //                         context.finish(result, dataStore.request, "image")
    //                     ).catch(
    //                         abort
    //                     );
    //                 },
    //                 error(request) {
    //                     abort("Image load aborted - XHR error");
    //                 }
    //             });
    //         }
    //         //no need to provide downloadTileAbort since we keep the meta structure
    //         this.__cached_downloadTileAbort = this.downloadTileAbort;
    //         this.downloadTileAbort = OpenSeadragon.TileSource.prototype.downloadTileAbort;
    //     } else if (this.__cached_downloadTileStart) {
    //         this.downloadTileStart = this.__cached_downloadTileStart;
    //         this.downloadTileAbort = this.__cached_downloadTileAbort;
    //     }
    //     this.__configuredDownload = true;
    // }

    getTileHashKey(level, x, y, url, ajaxHeaders, postData) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
        return `${x}_${y}/${level}/${this.fileId}`;
    }

    getTileCacheDataAsContext2D(cacheObject) {
        //hotfix: in case the cacheObject._data object arrives as array, fix it (webgl drawing did not get called)
        //todo will be replaced by the cache overhaul in OpenSeadragon
        if (!cacheObject._renderedContext) {
            if (Array.isArray(cacheObject._data)) {
                cacheObject._data = cacheObject._data[0];
            } else if (Array.isArray(cacheObject.data)) {
                cacheObject.data = cacheObject.data[0];
            }
        }
        return super.getTileCacheDataAsContext2D(cacheObject);
    }
};
