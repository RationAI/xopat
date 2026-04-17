// noinspection JSUnresolvedVariable

/**
 * Single image tile source to render as a single image.
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.PreviewSlideSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        console.assert(options.image instanceof HTMLImageElement, "PreviewSlideSource requires image within the constructor!");
        const img = options.image;
        options.ready = true;
        options.width = img.naturalWidth || img.width || 256;
        options.height = img.naturalHeight || img.height || 256;
        // Single-tile pyramid
        options.tileWidth = options.width;
        options.tileHeight = options.height;
        options.minLevel = 0;
        options.maxLevel = 0;
        super(options);
        this.tilesUrl = options.image.src;
    }

    supports( data, url ){
        return false; //we want explicit use
    }

    configure( data, url, postData ){
        return {};
    }

    getTileUrl( level, x, y ) {
        return this.tilesUrl;
    }

    /**
     * Retrieve image metadata for given image index - tilesources can fetch data or data-arrays.
     * @param index index of the data if tilesource supports multi data fetching
     * @return {TileSourceMetadata}
     */
    getMetadata() {
        return {};
    }

    tileExists( level, x, y ) {
        return level === 0 && x === 0 && y === 0;
    }

    downloadTileStart(context) {
        context.finish(this.image, null, "image");
    }

    downloadTileAbort(context) {
        //pass
    }
};

