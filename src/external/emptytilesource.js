// noinspection JSUnresolvedVariable

/**
 * @typedef OpenSeadragon.TileSource
 * Empty tile source to render in place of faulty layer
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.EmptyTileSource = class EmptyTileSource extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);
        this.tilesUrl = 'empty';
        this.fileFormat = ".jpg";
        this.color = "rgba(0,0,0,0)";
    }
    supports( data, url ){
        return false; //we want explicit use
    }

    configure( data, url, postData ){
        return {};
    }

    getTileUrl( level, x, y ) {
        return 'empty';
    }

    /**
     * Retrieve image metadata for given image index - tilesources can fetch data or data-arrays.
     * @param index index of the data if tilesource supports multi data fetching
     * @return {TileSourceMetadata}
     */
    getMetadata() {
        return {error: 'No data available. The layer is empty.'};
    }
    setFormat(format) {
        this.fileFormat = format;
    }
    setColor(color) {
        this.color = color;
    }

    getTileHashKey(level, x, y, url, ajaxHeaders, postData) {
        return `empty`;
    }

    tileExists( level, x, y ) {
        return true;
    }

    downloadTileStart(context) {
        let size = context.tile.size || {x: 0, y: 0};
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext('2d');
        if (size.x < 1 || size.y < 1) {
            canvas.width = 512;
            canvas.height = 512;
        } else {
            canvas.width = Math.floor(size.x);
            canvas.height = Math.floor(size.y);
        }
        ctx.fillStyle = this.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        context.finish(ctx, null, "context2d");
    }

    downloadTileAbort(context) {
        //pass
    }

    createTileCache(cache, data) {
        cache._data = data;
    }

    destroyTileCache(cache) {
        cache._data = null;
        cache._image = null;
    }

    getTileCacheData(cache) {
        return cache._data;
    }

    getTileCacheDataAsImage(cache) {
        if (!cache._image) {
            cache._image = new Image();
            cache._image.src = this._data.canvas.toDataURL();
        }
        return cache._image;
    }

    getTileCacheDataAsContext2D(cache) {
        return cache._data;
    }
};

