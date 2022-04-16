EmptyTileSource = function( width, height ) {
    this.width = width;
    this.height = height;
    let options = this.configure();
    this.tilesUrl     = options.tilesUrl;
    this.fileFormat   = options.fileFormat;

    this.image = document.createElement("img");
    let canvas = document.createElement("canvas");
    canvas.width = options.tileSize;
    canvas.height = options.tileSize;
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.image.url = canvas.toDataURL('image/png');

    $.TileSource.apply( this, [ options ] );
};

OpenSeadragon.extend( EmptyTileSource.prototype, OpenSeadragon.TileSource.prototype, {

    supports: function( data, url ){
        return true;
    },

    configure: function( data, url, postData ) {
        return {
            width: this.width,
            height: this.height,
            tileSize: 256,
            tileOverlap: 0,
            minLevel: null,
            maxLevel: null,
            tilesUrl: "empty",
            fileFormat: ".png"
        };
    },

    getTileUrl: function( level, x, y ) {
        return "empty";
    },

    downloadTileStart(context) {
        context.finish(true, "");
    },

    downloadTileFinish(context, successful) {
        if (!successful) return null;
        return context.data;
    }
});

