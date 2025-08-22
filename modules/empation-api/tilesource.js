//TODO: Add this patch/feature to OSD: Empaia data elements are by default padded to full tile size
OpenSeadragon.TiledImage.prototype._loadTile = function(tile, time ) {
    function fixImage(image, tileWidth, tileHeight) {
        // This approach does not treat well tiles that are both shorter and narrower, but does not need tile max w/h
        // let tileAr = tile.sourceBounds.width / tile.sourceBounds.height,
        //     imageAr = image.width / image.height,
        //     d = Math.abs(tileAr - imageAr);
        //
        // console.log(tile.sourceBounds.width, image.width,  tile.sourceBounds.height, image.height)
        //
        // //significant change
        // if (d > 1e-3) {
        //     const canvas = document.createElement('canvas'),
        //         context = canvas.getContext('2d'),
        //         desiredWidth = tileAr > 1 ? image.width : image.width * tileAr,
        //         desiredHeight = tileAr > 1 ? image.height / tileAr : image.height;
        //     canvas.width = desiredWidth;
        //     canvas.height = desiredHeight;
        //     context.drawImage(image, 0, 0, desiredWidth, desiredHeight, 0, 0, desiredWidth, desiredHeight);
        //     return canvas;
        // }
        // Treats tiles correctly, supposing all tiles have the same size (or smaller if they do not fit)
        let dw = tile.sourceBounds.width / tileWidth,
            dh = tile.sourceBounds.height / tileHeight;

        //the value is expected to be up to 1 if sizes equal
        if (dw < 0.999 || dh < 0.999) {
            let wasContext = false;
            //hotfix - if some data comes as rendering context 2d
            if (image instanceof CanvasRenderingContext2D) {
                image = image.canvas;
                wasContext = true;
            }

            const canvas = document.createElement('canvas'),
                context = canvas.getContext('2d'),
                desiredWidth = image.width * dw,
                desiredHeight = image.height * dh;
            canvas.width = desiredWidth;
            canvas.height = desiredHeight;
            context.drawImage(image, 0, 0, desiredWidth, desiredHeight, 0, 0, desiredWidth, desiredHeight);
            return wasContext ? context : canvas;
        }
        return image;
    }

    var _this = this;
    tile.loading = true;
    this._imageLoader.addJob({
        src: tile.getUrl(),
        tile: tile,
        source: this.source,
        postData: tile.postData,
        loadWithAjax: tile.loadWithAjax,
        ajaxHeaders: tile.ajaxHeaders,
        crossOriginPolicy: this.crossOriginPolicy,
        ajaxWithCredentials: this.ajaxWithCredentials,
        callback: function( data, errorMsg, tileRequest ){
            const w = _this.source.getTileWidth(), h = _this.source.getTileHeight();
            if (Array.isArray(data)) {
                _this._onTileLoad(tile, time, data.map(x => fixImage(x, w, h)), errorMsg, tileRequest);
            } else {
                _this._onTileLoad( tile, time, fixImage(data, w, h), errorMsg, tileRequest );
            }
        },
        abort: function() {
            tile.loading = false;
        }
    });
};

/**
 * Within LibEmpationAPI we provide the slide access for the OpenSeadragon.
 * @class OpenSeadragon.EmpationAPIV3TileSource
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.EmpationAPIV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        // todo fix OSD API here we rely on url string missing check and passing config object
        super(options);
        // We handle the multiplexing internally
        this.multiConfigure = true;
    }

    supports( data, url ){
        //todo fix OSD api and make type a standardized selector (e.g. map to class names)
        return data.type && data.type === "leav3" && data.slide;
    }

    _fail(message) {
        this.raiseEvent('open-failed', {
            message: message,
            source: '[EmpationAPI Module Internal URL]'
        });
    }

    configure( data, url, postData ) {
        return {
            url: data
        };
    }

    // getImageInfo(options) {
    //     // TODO consider multi tile support (test performance first)
    //     if (!options || !options.slide) {
    //         this._fail("Invalid usage: slide ID must be provided");
    //         return;
    //     }
    //
    //     if (!OpenSeadragon.EmpationAPIV3TileSource._initializedPreviewHandler) {
    //         OpenSeadragon.EmpationAPIV3TileSource._initializedPreviewHandler = true;
    //         VIEWER.addHandler('get-preview-url', async e => {
    //             if (!e.usesCustomProtocol && e.server === "xo.module://empation-api") {
    //                 return EmpationAPI.V3.get().slides.slideThumbnail(e.image, 500, 500).then(blob => {
    //                     e.imagePreview = blob;
    //                 }).catch(console.error);
    //             }
    //         });
    //     }
    //
    //     this.format = "jpeg";
    //     this.api = EmpationAPI.V3.get();
    //     this.api.slides.slideInfo(options.slide).then(response => {
    //         let size = response.extent, tile = response.tile_extent;
    //         //apply necessary - setups internals
    //         let chosenMq = response.pixel_size_nm;
    //         if (chosenMq.x === 1000000) chosenMq = null;
    //         $.extend(this, {
    //             width: size.x,
    //             height: size.y,
    //             tileSize: tile.x,
    //             maxLevel: response.levels.length-1,
    //             _tileWidth: tile.x,
    //             _tileHeight: tile.y,
    //             dimensions: new OpenSeadragon.Point( size.x, size.y ),
    //             aspectRatio: size.x / size.y,
    //             minLevel: 0,
    //             tileOverlap: 0,
    //             fileId: response.id,
    //             tilesUrl: response.tilesUrl,
    //             innerFormat: response.format,
    //             multifetch: false,
    //             ready: true,
    //             metadata: {
    //                 micronsX: chosenMq?.x / 1000,
    //                 micronsY: chosenMq?.y / 1000,
    //             },
    //             data: response
    //         })
    //         this.raiseEvent('ready', {tileSource: this});
    //     }).catch(e => {
    //         this._fail(e);
    //         this.metadata = {error: "Failed to load the slide data!" + e.message};
    //     });
    // }

    getImageInfo(options) {
        // TODO consider multi tile support (test performance first)
        if (!options || !options.slide) {
            this._fail("Invalid usage: slide ID must be provided");
            return;
        }

        if (!OpenSeadragon.EmpationAPIV3TileSource._initializedPreviewHandler) {
            OpenSeadragon.EmpationAPIV3TileSource._initializedPreviewHandler = true;
            VIEWER.addHandler('get-preview-url', async e => {
                if (!e.usesCustomProtocol && e.server === "xo.module://empation-api") {
                    return EmpationAPI.V3.get().slides.slideThumbnail(e.image, 500, 500).then(blob => {
                        e.imagePreview = blob;
                    }).catch(console.error);
                }
            });
        }

        const slides = options.slide.split(",");

        this.format = "jpeg";
        this.api = EmpationAPI.V3.get();
        Promise.all(
            slides.map(s => this.api.slides.slideInfo.call(this.api.slides, s))
        ).then(data => {
            const result = this.configureFromObject(data);
            $.extend(this, result);
            this.raiseEvent('ready', {tileSource: this});
        }).catch(e => {
            this._fail(e);
            this.metadata = {error: "Failed to load the slide data!" + e.message};
        });
    }

    configureFromObject( images ){
        var width         = Infinity,
            height        = Infinity,
            tileSize      = undefined,
            tileOverlap   = undefined,
            maxLevel      = Infinity,
            levels        = [],
            microns       = {x: Infinity, y: Infinity};

        for (let i = 0; i < images.length; i++) {
            let image = images[i],
                imageWidth = parseInt( image.extent.x, 10 ),
                imageHeight = parseInt( image.extent.y, 10 ),
                imageTileSize = parseInt( image.tile_extent.x, 10 ),
                imageTileOverlap = parseInt( image.tile_extent.y, 10 );

            if (imageWidth < 1 || imageHeight < 1) {
                image.error = "Missing image data.";
                continue;
            }

            if (tileSize === undefined) {
                tileSize = imageTileSize;
            }

            if (tileOverlap === undefined) {
                tileOverlap = imageTileOverlap;
            }

            if (imageTileSize !== tileSize || imageTileOverlap !== tileOverlap) {
                image.error = "Incompatible layer: the rendering might contain artifacts.";
            }

            if (imageWidth < width || imageHeight < height) {
                //possibly experiment with taking maximum
                width = imageWidth;
                height = imageHeight;
            }

            if (microns.x >= 1000000 && image.pixel_size_nm) {
                microns = image.pixel_size_nm;
            }

            const level = image.levels.length-1;
            if (level < maxLevel) {
                levels = image.levels;
                maxLevel = level;
            }
        }

        return {
            width: width, /* width *required */
            height: height, /* height *required */
            tileSize: tileSize, /* tileSize *required */
            tileOverlap: 0, /* tileOverlap *required */
            minLevel: 0, /* minLevel */
            maxLevel: maxLevel, /* maxLevel */
            _tileWidth: tileSize,
            _tileHeight: tileSize,
            dimensions: new OpenSeadragon.Point( width, height ),
            aspectRatio: width / height,
            innerFormat: images[0].format,
            levels: levels,
            multifetch: false,
            ready: true,
            metadata: {
                micronsX: microns?.x / 1000,
                micronsY: microns?.y / 1000,
            },
            data: images
        }
    }

    getMetadata() {
        return this.metadata;
    }

    getLevelScale( level ) {
        level = this.maxLevel-level;
        const levels = this.levels;
        return levels[level].extent.x / levels[0].extent.x;
    }

    getTileUrl( level, x, y ) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
        return `${x}_${y}/${level}//leav3`;
    }

    getTileHashKey( level, x, y, url, ajaxHeaders, post) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
        return `${x}_${y}/${level}//leav3`;
    }

    getTilePostData( level, x, y) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
        return {level, x, y};
    }

    setFormat(format) {
        this.format = format;
    }

    placeholderTile(index, resolve, reject) {
        const canvas = document.createElement('canvas');
        canvas.width = this.getTileWidth();
        canvas.height = this.getTileHeight();
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const img = new Image(canvas.width, canvas.height);
        img.onload = () => {
            //next promise just returns the created object
            this.placeholderTile = (index, ready, _) => ready(index, img, 1);
            resolve(index, img, 1);
        };
        img.onerror = img.onabort = reject;
        img.src = canvas.toDataURL();
    }

    downloadTileStart(context) {
        const abort = context.finish.bind(context, null),
            data = context.postData;

        Promise.all(this.data.map(
            image => this.api.slides.loadTile.call(this.api.slides, image.id, data.level, data.x, data.y, this.format)
        )).then(blobList => {
            const self = this;
            let images = new Array(this.data.length), fails = 0, fills = 0;
            function finish(index, data, failCount=0) {
                images[index] = data;
                fills++;
                fails += failCount;
                if (fills === blobList.length) {
                    if (fails >= images.length) abort("All images failed to load from blob!");
                    else {
                        //reference background must receive non-array
                        const ref = VIEWER.scalebar?.getReferencedTiledImage();

                        //todo dirty we assume the ref is this source tiled image, but it generally does not have to be
                        // hotfix for demo
                        if (!ref || ref.source === self) {
                            context.finish(images[0], {}, undefined);
                        } else {
                            context.finish(images, {}, undefined);
                        }
                    }
                }
            }

            for (let i = 0; i < blobList.length; i++) {
                const img = new Image(),
                    blob = blobList[i];
                const objUrl = URL.createObjectURL(blob);
                img.onload = () => {
                    URL.revokeObjectURL(objUrl);
                    finish(i, img);
                };
                img.onerror = img.onabort = e => {
                    URL.revokeObjectURL(objUrl);
                    console.warn("Failed to load image", e);
                    this.placeholderTile(i, finish, abort);
                };
                img.src = objUrl;
            }
        }).catch(abort);


        // this.api.slides.loadTile(this.fileId, data.level, data.x, data.y, this.format).then(blob => {
        //     const img = new Image();
        //     const objUrl = URL.createObjectURL(blob);
        //     img.onload = () => {
        //         URL.revokeObjectURL(objUrl);
        //         context.finish(img, {}, undefined);
        //     };
        //     img.onerror = img.onabort = e => {
        //         URL.revokeObjectURL(objUrl);
        //         abort(e);
        //     };
        //     img.src = objUrl;
        // }).catch(abort);
    }

    getEmpaiaId(dataIndex = 0) {
        return this.data[dataIndex].id;
    }
};


