// noinspection JSUnresolvedVariable

/**
 * Empty tile source to render in place of faulty layer
 */
class EmptyTileSource extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);
        this.tilesUrl = 'empty';
        this.fileFormat = ".jpg";
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

    //TO-DOCS describe how meta is handled and error property treated
    getImageMetaAt(index) {
        return {error: 'No data available. The layer is empty.'};
    }
    setFormat(format) {
        this.fileFormat = format;
    }

    getTileHashKey(level, x, y, url, ajaxHeaders, postData) {
        return `empty`;
    }

    tileExists( level, x, y ) {
        return true;
    }

    downloadTileStart(context) {
        let size = context.tile.size;
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext('2d');
        if (size.width < 1 || size.height < 1) {
            canvas.width = 1;
            canvas.height = 1;
        } else {
            canvas.width = Math.floor(size.width);
            canvas.height = Math.floor(size.height);
        }
        context.finish(ctx);
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
}

