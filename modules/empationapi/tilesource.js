/**
 * Within LibEmpationAPI we provide the slide access for the OpenSeadragon.
 * @class OpenSeadragon.EmpationAPIV3TileSource
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.EmpationAPIV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        // todo fix OSD API here we rely on url string missing check and passing config object
        super(options);
    }

    supports( data, url ){
        //todo fix OSD api and make type a standardized selector (e.g. map to class names)
        return data.type && data.type === "leav3";
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

        this.format = "jpeg";
        this.api = EmpationAPI.V3.get();
        this.api.slides.slideInfo(options.slide).then(response => {
            let size = response.extent, tile = response.tile_extent;
            //apply necessary - setups internals
            let chosenMq = response.pixel_size_nm;
            if (chosenMq.x === 1000000) chosenMq = null;
            $.extend(this, {
                width: size.x,
                height: size.y,
                tileSize: tile.x,
                maxLevel: response.levels.length-1,
                _tileWidth: tile.x,
                _tileHeight: tile.y,
                dimensions: new OpenSeadragon.Point( size.x, size.y ),
                aspectRatio: size.x / size.y,
                minLevel: 0,
                tileOverlap: 0,
                fileId: response.id,
                tilesUrl: response.tilesUrl,
                innerFormat: response.format,
                multifetch: false,
                ready: true,
                metadata: {
                    micronsX: chosenMq?.x / 1000,
                    micronsY: chosenMq?.y / 1000,
                },
                data: response
            })
            this.raiseEvent('ready', {tileSource: this});
        }).catch(e => {
            this._fail(e);
            this.metadata = {error: "Failed to load the slide data!" + e.message};
        });
    }

    getImageMetaAt(index) {
        return this.metadata;
    }

    getLevelScale( level ) {
        level = this.maxLevel-level;
        const levels = this.data.levels;
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

    downloadTileStart(context) {
        const abort = context.finish.bind(context, null),
            data = context.postData;
        this.api.slides.loadTile(this.fileId, data.level, data.x, data.y, this.format).then(blob => {
            const img = new Image();
            const objUrl = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(objUrl);
                context.finish(img, {}, undefined);
            };
            img.onerror = img.onabort = e => {
                URL.revokeObjectURL(objUrl);
                abort(e);
            };
            img.src = objUrl;
        }).catch(abort);
    }
};
