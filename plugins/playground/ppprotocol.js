/*
 * Python Playground Protocol
 * This file is meant to be configured manually, e.g. no URL processing happens, configure->url
 * param is not used, configure all image-metadata-unrelated properties manually if you want to set them
 *
 * Based on OpenSeadragon.DziTileSource:
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2013 OpenSeadragon contributors
 * Copyright (C) 2021 RationAI Research Group (Modifications)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

Playground.Protocol = class extends OpenSeadragon.TileSource {
    /**
     * Taken from DZI processing, the same
     */
    constructor(options) {
        super(options);

        let i,
            rect,
            level;

        this._levelRects  = {};
        this.fileFormat   = options.fileFormat;
        this.displayRects = options.displayRects;

        if ( this.displayRects ) {
            for ( i = this.displayRects.length - 1; i >= 0; i-- ) {
                rect = this.displayRects[ i ];
                for ( level = rect.minLevel; level <= rect.maxLevel; level++ ) {
                    if ( !this._levelRects[ level ] ) {
                        this._levelRects[ level ] = [];
                    }
                    this._levelRects[ level ].push( rect );
                }
            }
        }

        if (!this.fileFormat) this.fileFormat = ".jpg";
        if (!this.greyscale) this.greyscale = "";

        let canvas = document.createElement('canvas'),
            context = canvas.getContext('2d');
        canvas.width = options.tileSize;
        canvas.height = options.tileSize;
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillRect(0, 0, options.tileSize, options.tileSize);
        this._emptyPlaceholder = canvas.toDataURL("image/jpeg", 0.1);
    }

    /**
     * Support http://rationai.fi.muni.cz/deepzoom_json/playground
     */
    supports( data, url ){
        var ns;
        if ( data.xmlns ) {
            ns = data.xmlns;
        }
        ns = (ns || '').toLowerCase();
        return ns.indexOf('http://rationai.fi.muni.cz/deepzoom_json/playground') !== -1;
    }

    /**
     * @function
     * @param {Object|XMLDocument} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure( data, url, postData ) {

        function configureFromObject( tileSource, configuration ){
            var imageData     = configuration,
                fileFormat    = imageData.Format,
                sizeData      = imageData.Size,
                dispRectData  = imageData.DisplayRect || [],
                width         = parseInt( sizeData.Width, 10 ),
                height        = parseInt( sizeData.Height, 10 ),
                tileSize      = parseInt( imageData.TileSize, 10 ),
                tileOverlap   = parseInt( imageData.Overlap, 10 ),
                displayRects  = [],
                rectData,
                i;

            for ( i = 0; i < dispRectData.length; i++ ) {
                rectData = dispRectData[ i ].Rect;

                displayRects.push( new OpenSeadragon.DisplayRect(
                    parseInt( rectData.X, 10 ),
                    parseInt( rectData.Y, 10 ),
                    parseInt( rectData.Width, 10 ),
                    parseInt( rectData.Height, 10 ),
                    parseInt( rectData.MinLevel, 10 ),
                    parseInt( rectData.MaxLevel, 10 )
                ));
            }

            return OpenSeadragon.extend(true, {
                width: width, /* width *required */
                height: height, /* height *required */
                tileSize: tileSize, /* tileSize *required */
                tileOverlap: tileOverlap, /* tileOverlap *required */
                minLevel: null, /* minLevel */
                maxLevel: null, /* maxLevel */
                fileFormat: fileFormat, /* fileFormat */
                displayRects: displayRects /* displayRects */
            }, configuration );
        }

        if (typeof data === "string") data = JSON.parse(data);
        if (OpenSeadragon.isPlainObject(data)) return configureFromObject(this, data);
        throw "Configuration is allowed only with JSON (string supported).";
    }

    /**
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     */
    getTileUrl( level, x, y ) {
        return `${this.rootServer}/process/${this.algorithm}?Deepzoom=${this.imageSource}_files/${level}/${x}_${y}.${this.fileFormat}${this.greyscale}`;
    }

    /**
     * Responsible for retrieving the headers which will be attached to the image request for the
     * region specified by the given x, y, and level components.
     * This option is only relevant if {@link OpenSeadragon.Options}.loadTilesWithAjax is set to true.
     * The headers returned here will override headers specified at the Viewer or TiledImage level.
     * Specifying a falsy value for a header will clear its existing value set at the Viewer or
     * TiledImage level (if any).
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @returns {Object}
     */
    getTileAjaxHeaders( level, x, y ) {
        return {'Content-type': 'application/x-www-form-urlencoded', 'credentials': 'include' };
    }

    /**
     * Must use AJAX in order to work, i.e. loadTilesWithAjax : true is set.
     * It should return url-encoded string with the following structure:
     *   key=value&key2=value2...
     * or null in case GET is used instead.
     * @param level
     * @param x
     * @param y
     * @return {string || null} post data to send with tile configuration request
     */
    getTilePostData(level, x, y) {
        this.owner.setStatus(`Loading tile ${level}/${x}-${y}`, {loading: true});
        let data = $.extend({}, this.owner.getPostData());

        data.dx = x;
        data.dy = y;
        data.level = level;
        data.tileSize = this.TileSize;
        return JSON.stringify(data);
    }

    /**
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     */
    tileExists( level, x, y ) {
        var rects = this._levelRects[ level ],
            rect,
            scale,
            xMin,
            yMin,
            xMax,
            yMax,
            i;

        if ((this.minLevel && level < this.minLevel) || (this.maxLevel && level > this.maxLevel)) {
            return false;
        }

        if ( !rects || !rects.length ) {
            return true;
        }

        for ( i = rects.length - 1; i >= 0; i-- ) {
            rect = rects[ i ];

            if ( level < rect.minLevel || level > rect.maxLevel ) {
                continue;
            }

            scale = this.getLevelScale( level );
            xMin = rect.x * scale;
            yMin = rect.y * scale;
            xMax = xMin + rect.width * scale;
            yMax = yMin + rect.height * scale;

            xMin = Math.floor( xMin / this._tileWidth );
            yMin = Math.floor( yMin / this._tileWidth ); // DZI tiles are square, so we just use _tileWidth
            xMax = Math.ceil( xMax / this._tileWidth );
            yMax = Math.ceil( yMax / this._tileWidth );

            if ( xMin <= x && x < xMax && yMin <= y && y < yMax ) {
                return true;
            }
        }

        return false;
    }

    downloadTileStart(context) {
        var dataStore = context.userData,
            image = new Image();

        dataStore.image = image;
        dataStore.request = null;

        var finish = function(error) {
            if (!image) {
                context.finish(null, dataStore.request, "Image load failed: undefined Image instance.");
                return;
            }
            image.onload = image.onerror = image.onabort = null;
            context.finish(error ? null : image, dataStore.request, error);
        };
        image.onload = function () {
            finish();
        };
        image.onabort = image.onerror = function() {
            finish("Image load aborted.");
        };

        const _this = this;
        if (context.loadWithAjax) {
            context.request = OpenSeadragon.makeAjaxRequest({
                url: context.src,
                withCredentials: context.ajaxWithCredentials,
                headers: context.ajaxHeaders,
                responseType: "arraybuffer",
                postData: context.postData,
                success: function(request) {
                    var blb;
                    // Make the raw data into a blob.
                    // BlobBuilder fallback adapted from
                    // http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility
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
                        context.finish("Empty image response.");
                    } else {
                        context.image.src = (window.URL || window.webkitURL).createObjectURL(blb);
                    }
                },
                error: function(request) {
                    if (request.status === 422) {
                        try {
                            let blob = new window.Blob([request.response]);
                            blob.text().then(t => _this.owner.setStatus(t, {loading: false}));
                            context.image.src = _this._emptyPlaceholder;
                        } catch (e) {
                            context.finish(e);
                        }
                    } else {
                        context.finish("Image load aborted - XHR error");
                    }
                }
            });
        } else {
            context.finish(false, "The protocol must use AJAX!.");
        }
    }

    createTileCache(cache, data) {
        cache._data = data;
    }

    destroyTileCache(cache) {
        cache._data = null;
        cache._renderedContext = null;
    }

    getTileCacheData(cache) {
        return cache._data;
    }

    getTileCacheDataAsImage() {
        return cache._data;
    }

    getTileCacheDataAsContext2D(cache) {
        if (!cache._renderedContext) {
            var canvas = document.createElement( 'canvas' );
            canvas.width = this._data.width;
            canvas.height = this._data.height;
            cache._renderedContext = canvas.getContext('2d');
            cache._renderedContext.drawImage( cache._data, 0, 0 );
        }
        return cache._renderedContext;
    }
};


Playground.Fractal = class extends Playground.Protocol {
    /**
     * Taken from DZI processing, the same
     */
    constructor(options) {
        super(options);
    }

    /**
     * Must use AJAX in order to work, i.e. loadTilesWithAjax : true is set.
     * It should return url-encoded string with the following structure:
     *   key=value&key2=value2...
     * or null in case GET is used instead.
     * @param level
     * @param x
     * @param y
     * @return {string || null} post data to send with tile configuration request
     */
    getTilePostData(level, x, y) {
        return {
            dx : x,
            dy: y,
            level: level
        };
    }

    maxIterations =100;

    iterateMandelbrot(refPoint) {
        var squareAndAddPoint = function(z, point) {
            let a = Math.pow(z.a,2)-Math.pow(z.b, 2) + point.a;
            let b = 2*z.a*z.b + point.b;
            z.a = a;
            z.b = b;
        };

        var length = function(z) {
            return Math.sqrt(Math.pow(z.a, 2) + Math.pow(z.b, 2));
        };

        let z = {a: 0, b: 0};
        for(let i=0;i<this.maxIterations;i++){
            squareAndAddPoint(z, refPoint);
            if(length(z)>8) return i/this.maxIterations;
        }
        return 1.0;
    }

    /**
     * Download tile data
     * @param {ImageJob} context job context that you have to call finish(...) on. It also contains abort(...) function
     *   that can be called to abort the job.
     * @param {String} [context.src] - URL of image to download.
     * @param {String} [context.loadWithAjax] - Whether to load this image with AJAX.
     * @param {String} [context.ajaxHeaders] - Headers to add to the image request if using AJAX.
     * @param {String} [context.crossOriginPolicy] - CORS policy to use for downloads
     * @param {String} [context.postData] - HTTP POST data (usually but not necessarily in k=v&k2=v2... form,
     *      see TileSrouce::getPostData) or null
     * @param {Function} [context.callback] - Called once image has been downloaded.
     * @param {Function} [context.abort] - Called when this image job is aborted.
     * @param {Number} [context.timeout] - The max number of milliseconds that this image job may take to complete.
     */
    downloadTileStart(context) {
        let size = this.getTileBounds(context.postData.level, context.postData.dx, context.postData.dy, true);
        let bounds = this.getTileBounds(context.postData.level, context.postData.dx, context.postData.dy, false);
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext('2d');

        size.width = Math.floor(size.width);
        size.height = Math.floor(size.height);

        if (size.width < 1 || size.height < 1) {
            canvas.width = 1;
            canvas.height = 1;
            context.finish(ctx);
            return;
        } else {
            canvas.width = size.width;
            canvas.height = size.height;
        }

        bounds.x = bounds.x*2 - 1;
        bounds.width = bounds.width * 2;

        var imagedata = ctx.createImageData(size.width, size.height);
        for (let x = 0; x < size.width; x++) {

            for (let y = 0; y < size.height; y++) {
                let index = (y * size.width + x) * 4;
                imagedata.data[index] = Math.floor(this.iterateMandelbrot({
                    a: bounds.x + bounds.width * ((x + 1) / size.width),
                    b: bounds.y + bounds.height * ((y + 1) / size.height)
                }) * 255);

                imagedata.data[index+3] = 255;
            }
        }
        ctx.putImageData(imagedata, 0, 0);
        context.finish(ctx);
    }

    createTileCache(cache, data) {
        cache._data = data;
    }

    destroyTileCache(cache) {
        cache._data = null;
    }

    getTileCacheData(cache) {
        return cache._data;
    }

    getTileCacheDataAsImage() {
        throw "Lazy to implement";
    }

    getTileCacheDataAsContext2D(cache) {
        return cache._data;
    }
};



Playground.VectorProtocol = class extends Playground.Protocol {
    /**
     * Download tile data
     * @param {ImageJob} context job context that you have to call finish(...) on. It also contains abort(...) function
     *   that can be called to abort the job.
     * @param {String} [context.src] - URL of image to download.
     * @param {String} [context.loadWithAjax] - Whether to load this image with AJAX.
     * @param {String} [context.ajaxHeaders] - Headers to add to the image request if using AJAX.
     * @param {String} [context.crossOriginPolicy] - CORS policy to use for downloads
     * @param {String} [context.postData] - HTTP POST data (usually but not necessarily in k=v&k2=v2... form,
     *      see TileSrouce::getPostData) or null
     * @param {Function} [context.callback] - Called once image has been downloaded.
     * @param {Function} [context.abort] - Called when this image job is aborted.
     * @param {Number} [context.timeout] - The max number of milliseconds that this image job may take to complete.
     */
    downloadTileStart(context) {
        // Load the tile with an AJAX request if the loadWithAjax option is
        // set. Otherwise load the image by setting the source proprety of the image object.
        const _this = this;
        if (context.loadWithAjax) {
            context.request = OpenSeadragon.makeAjaxRequest({
                url: context.src,
                withCredentials: context.ajaxWithCredentials,
                headers: context.ajaxHeaders,
                responseType: "text",
                postData: context.postData,
                success: function(request) {
                    try {
                        context.data = {
                            geometry: JSON.parse(request.responseText),
                            tileSize: _this.TileSize
                        };
                        context.finish(true);
                    } catch (e) {
                        context.finish(false, e);
                    }
                },
                error: function(request) {
                    context.finish(false, "Image load aborted - XHR error");
                }
            });
        } else {
            context.finish(false, "The protocol must use AJAX!.");
        }
    }

    /**
     * @param {ImageJob} context
     * @param successful true if successful
     * @return {null|*} null to indicate missing data or data object
     *  for example, can return default value if the request was unsuccessful such as default error image
     */
    downloadTileFinish(context, successful) {
        if (!successful) return null;
        return context.data;
    }

    createTileCache(data) {
        this._data = data;
    }

    destroyTileCache() {
        this._data = null;
        this._renderedContext = null;
    }

    getTileCacheData() {
        return this._data;
    }

    tileDataToRenderedContext() {
        console.log(("CREAETED PPPLAYGROUND-VECTOR"));

        if (!this._rasterizer) {
            this._rasterizer = new WebGLModule.Rasterizer();
            this._rasterizer.setDimensions(this._data.tileSize, this._data.tileSize);
        }
        if (!this._renderedContext) {
            let rasterized = this._rasterizer.rasterizePolygons(this._data.geometry);

            var canvas = document.createElement( 'canvas' );
            canvas.width = rasterized.width;
            canvas.height = rasterized.height;
            this._renderedContext = canvas.getContext('2d');
            this._renderedContext.drawImage( rasterized, 0, 0 );
            this._data = null;
        }
        return this._renderedContext;
    }
};

Playground.SelfServingProtocol = class extends Playground.Protocol {
    constructor(options) {
        /**
         * Not possible
         *
         * instead bind to tileLoaded of underlying tile and find surroundings,
         * if not found set is as unfinished
         *
         * bind redraw event (custom) as in bridge, bind custom webgl, modify
         * rendering context of the... basically re-implement OSD bridge
         * .... maybe re-write bridge such that it binds to specific tile (maybe it is already like that)
         * ....
         *
         * support cleaning feature! re-draw context by cached image and delete cached image
         */


        super(options);
        this._map = document.createElement('canvas');
        this._ctx = this._map.getContext('2d');
        this._level = -1;
        this._dx = -1;
        this._mask = [];

        //todo clarify API
        this.tiledImageIndex = options.tiledImageIndex;
        this.osd = options.openSeadragon;
        this.overlap = options.overlap || 255;
    }

    getTileAjaxHeaders( level, x, y ) {
        return {'Content-type': 'multipart/form-data', 'credentials': 'include' };
    }

    getTilePostData(level, x, y) {
        let data = this.owner.getPostData();
        data.dx = x;
        data.dy = y;
        data.level = level;
        let result = new FormData();
        result.append("meta", data);
        result.append("tile", null);
        return result;
    }

    _getTileData(level, x, y) {
        let tiles = this.osd.world.getItemAt(this.tiledImageIndex).lastDrawn;

        let scale = this.getLevelScale(level),
            widthScaled = this.dimensions.x * scale,
            tileWidth = this.getTileWidth(level),
            tileHeight = this.getTileHeight(level);

        if (this._dimx !== window.innerWidth || this._dimy !== window.innerHeight) {
            this._dimx = window.innerWidth;
            this._dimy = window.innerHeight;
            this._map.width = window.innerWidth + 2*this.tileSize;
            this._map.height = window.innerHeight + 2*this.tileSize;
            this._level = -1;
        }

        if (this._level !== level) {
            this._bitArray.clear();
        }

        function drawTile(tile) {
            this._renderEngine.setDimensions(tile.sourceBounds.width, tile.sourceBounds.height);
            let canvas = this._renderEngine.processImage(
                tile.image, tile.sourceBounds, 0, this._currentPixelSize
            );
            tile.annotationCanvas.width = tile.sourceBounds.width;
            tile.annotationCanvas.height = tile.sourceBounds.height;
            tile.annotationCanvasCtx.drawImage(canvas, 0, 0, tile.sourceBounds.width, tile.sourceBounds.height);
        }

        //first control whether tiles are drawn
        for (let dx = -1; dx < 2; dx++)  {
            for (let dy = -1; dy < 2; dy++)  {
                let viewportPos = new OpenSeadragon.Point(
                    (x+dx) * tileWidth / widthScaled,
                    (y+dy) * tileHeight / widthScaled
                );
                //if inside viewport
                if (viewportPos.x >= 0 && viewportPos.x < 1 &&
                    viewportPos.y >= 0 && viewportPos.y < 1 / this.aspectRatio) {

                    for (let i = 0; i < tiles.length; i++) {
                        if (tiles[i].bounds.containsPoint(viewportPos)) {
                            if (!this._bitArray.isFlag(x, y)) {
                                drawTile(tiles[i]);
                                this._bitArray.setFlag(x, y);
                            }
                            break;
                        }
                    }
                }






            }
        }



    }


    // BITWISE MAP OF VISITED AREAS, USE INTEGER FLAGS TO REDUCE THE ARRAY LENGTH
    // (e.g. linear nxn matrix array, each cell stores __bitArray.cells.length__ positions)
    // with javascript, safe to use up to 31 bits (we use 30)
    _bitArray = {

        dimension: 2000,
        arr: [],

        cells: [1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6, 1 << 7, 1 << 8, 1 << 9,
            1 << 10, 1 << 11, 1 << 12, 1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17, 1 << 18, 1 << 19,
            1 << 20, 1 << 21, 1 << 22, 1 << 23, 1 << 24, 1 << 25, 1 << 26, 1 << 27, 1 << 28, 1 << 29],

        isFlag: function (i, j) {
            let idx = i * this.dimension + j;
            let flag = this.arr[Math.floor(idx / this.cells.length)];

            return (flag & this.cells[idx % this.cells.length]) > 0;
        },

        setFlag: function (i, j, flag = true) {
            let idx = i * this.dimension + j;
            if (flag) {
                // |    to add selection (1 on the only place we want to add)
                this.arr[Math.floor(idx / this.cells.length)] = this.arr[Math.floor(idx / this.cells.length)] | this.cells[idx % this.cells.length];
            } else {
                // & ~   to negate the selection (0 on the only place we want to clear) and bit-wise and this mask to arr
                this.arr[Math.floor(idx / this.cells.length)] = this.arr[Math.floor(idx / this.cells.length)] & ~this.cells[idx % this.cells.length];
            }
        },

        clear: function () {
            this.arr = [];
        },
    }
};
