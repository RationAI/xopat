// OpenSeadragon.TiledImage.prototype._loadTile = function(tile, time ) {
//     function fixImage(image, tileWidth, tileHeight) {
//         if (!image) {
//             return image;
//         }
//
//         let dw = tile.sourceBounds.width / tileWidth,
//             dh = tile.sourceBounds.height / tileHeight;
//
//         //the value is expected to be up to 1 if sizes equal
//         if (dw < 0.999 || dh < 0.999) {
//             let wasContext = false;
//             //hotfix - if some data comes as rendering context 2d
//             if (image instanceof CanvasRenderingContext2D) {
//                 image = image.canvas;
//                 wasContext = true;
//             }
//
//             const canvas = document.createElement('canvas'),
//                 context = canvas.getContext('2d'),
//                 desiredWidth = Math.max(tile.sourceBounds.width, 1),
//                 desiredHeight = Math.max(tile.sourceBounds.height, 1);
//             canvas.width = Math.max(desiredWidth, 1);
//             canvas.height = Math.max(desiredHeight, 1);
//             context.drawImage(image, 0, 0, desiredWidth, desiredHeight, 0, 0, desiredWidth, desiredHeight);
//             return wasContext ? context : canvas;
//         }
//         return image;
//     }
//
//     var _this = this;
//     tile.loading = true;
//     tile.tiledImage = this;
//     if (!this._imageLoader.addJob({
//         src: tile.getUrl(),
//         tile: tile,
//         source: this.source,
//         postData: tile.postData,
//         loadWithAjax: tile.loadWithAjax,
//         ajaxHeaders: tile.ajaxHeaders,
//         crossOriginPolicy: this.crossOriginPolicy,
//         ajaxWithCredentials: this.ajaxWithCredentials,
//         callback: function( data, errorMsg, tileRequest, dataType ){
//             const w = _this.source.getTileWidth(tile.level), h = _this.source.getTileHeight(tile.level);
//             if (Array.isArray(data)) {
//                 // const transformed = data.map(x => fixImage(x, w, h))
//                 // _this._onTileLoad(tile, time, transformed, errorMsg, tileRequest, transformed[0] instanceof CanvasRenderingContext2D ? "context2d" : "image");
//                 // TODO arrays not supported
//                 throw new Error("Arrays not supported with tile fetching!");
//             } else {
//                 const transformed = fixImage(data, w, h);
//                 _this._onTileLoad( tile, time, transformed, errorMsg, tileRequest, transformed instanceof CanvasRenderingContext2D ? "context2d" : "image");
//             }
//
//             _this._onTileLoad( tile, time, data, errorMsg, tileRequest, dataType );
//         },
//         abort: function() {
//             tile.loading = false;
//         }
//     })) {
//         /**
//          * Triggered if tile load job was added to a full queue.
//          * This allows to react upon e.g. network not being able to serve the tiles fast enough.
//          * @event job-queue-full
//          * @memberof OpenSeadragon.Viewer
//          * @type {object}
//          * @property {OpenSeadragon.Tile} tile - The tile that failed to load.
//          * @property {OpenSeadragon.TiledImage} tiledImage - The tiled image the tile belongs to.
//          * @property {number} time - The time in milliseconds when the tile load began.
//          */
//         this.viewer.raiseEvent("job-queue-full", {
//             tile: tile,
//             tiledImage: this,
//             time: time,
//         });
//     }
// };

/**
 * @class EmpaiaStandaloneV3TileSource
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 * @param {object} options configuration either empaia info response or list of these objects
 */
OpenSeadragon.EmpaiaStandaloneV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);
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
                data[0].originalAPI = false;
                return true;
            }
        } else if (url && typeof data === "object") {
            let match = url.match(/^(\/?[^\/].*\/v3\/slides(\/[^\/]+)?)\/info/i);
            if (match) {
                data = data || {};
                data.tilesUrl = match[1];
                // original empaia API did not use query params for slide id, which prevents slashes usage
                data.originalAPI = !url.includes("slide_id=");
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
                originalAPI: data.originalAPI,
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
            originalAPI: data[0].originalAPI,
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

        if (this.originalAPI) {
            // original empaia api keeps the id in the url
            //endpoint slides/[SLIDE]/tile/level/[L]/tile/[X]/[Y]/
            return `${tiles}/tile/level/${level}/tile/${x}/${y}`;
        }

        if (this.multifetch) {
            //endpoint files/tile/level/[L]/tile/[X]/[Y]/?paths=path,list,separated,by,commas
            const query_name = tiles.endsWith("batch") ? "slides" : "paths";
            return `${tiles}/tile/level/${level}/tile/${x}/${y}?${query_name}=${this.fileId}`
        }
        //endpoint slides/tile/level/[L]/tile/[X]/[Y]?slide_id=id
        const query_name = tiles.endsWith("batch") ? "slides" : "slide_id";
        return `${tiles}/tile/level/${level}/tile/${x}/${y}?${query_name}=${this.fileId}`
    }

    async downloadICCProfile() {
        const url = `${this.tilesUrl}/icc_profile?slide_id=${this.fileId}`;
        return fetch(url).then(async res => res.arrayBuffer())
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
};
