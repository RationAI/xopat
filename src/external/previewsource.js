// noinspection JSUnresolvedVariable

/**
 * Single image tile source to render as a single image.
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.PreviewSlideSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        console.assert(options.image instanceof HTMLImageElement, "PreviewSlideSource requires image within the constructor!");
        options.ready = true;
        options.height = image.height || 256;
        options.width = image.width || 256;
        options.tileWidth = image.width || 256;
        options.tileHeight = image.height || 256;
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

