/**
 * Within LibEmpationAPI we provide the slide access for the OpenSeadragon.
 * @class OpenSeadragon.EmpationAPIV3TileSource
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.EmpaiaPixelmapV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        // todo fix OSD API here we rely on url string missing check and passing config object
        super(options);
    }

    supports( data, url ){
        //todo fix OSD api and make type a standardized selector (e.g. map to class names)
        return data.type && data.type === "leav3" && data.pixelmap;
    }

    _fail(message) {
        this.raiseEvent('open-failed', {
            message: message,
            source: '[Empaia Plugin Internal URL]'
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

        this.api = EmpationAPI.V3.get();

        const scopeAPI = this.api.scopes[this.api.defaultScopeKey];

        const underlyingSource = VIEWER.tools.referencedImage().tileSource;
        this.maxLevel = underlyingSource.maxLevel;
        this.width = underlyingSource.width;
        this.height = underlyingSource.height;
        this.dimensions = new OpenSeadragon.Point(this.width, this.height);
        this.aspectRatio = underlyingSource.aspectRatio;
        this.pixelmapIds = [];

        Promise.all(
            options.pixelmap.split(',').map(pixelmapId => this._fetchPixelmapInfo.bind(this, scopeAPI, pixelmapId))
        ).then(_ => {
            if (this.pixelmapIds.length === 0) {
                //todo if ids empty:
                this._fail("Failed to load the slide data!");
                this.metadata = {error: "Failed to load the slide data!"};
                return;
            }
            this.ready = true;
            this.raiseEvent('ready', {tileSource: this});
        });
    }

    async _fetchPixelmapInfo(scope, pixelmapId) {
        try {
            const info = await scope.pixelmaps.get(pixelmapId);
            this.pixelmapIds.push(info.id);
            $.extend(this, {
                tileSize: info.tilesize,
                _tileWidth: info.tilesize,
                _tileHeight: info.tilesize,
                minLevel: 0,
                tileOverlap: 0,
            });
        } catch (e) {
            // Invalid ID will cause 404 on tiles
            this.pixelmapIds.push('Invalid pixelmap: ' + e.message);
        }
    }

    getImageMetaAt(index) {
        return this.metadata;
    }

    // getLevelScale( level ) {
    //     level = this.maxLevel-level;
    //     const levels = this.data.levels;
    //     return levels[level].extent.x / levels[0].extent.x;
    // }

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

    downloadTileStart(context) {
        const data = context.postData;
        const scopeAPI = this.api.scopes[this.api.defaultScopeKey];
        Promise.all(
            this.pixelmapIds.map(id => this._fetchPixelmapTile.bind(this, scopeAPI, id, data.level, data.x, data.y))
        ).then(data => {
            context.finish(data, {}, undefined);
        });
    }

    _fetchPixelmapTile(scope, id, level, x, y) {
        return new Promise((resolve) => {

            scope.pixelmaps.getTile(id, level, x, y).then(blob => {
                const img = new Image();
                const objUrl = URL.createObjectURL(blob);
                img.onload = () => {
                    URL.revokeObjectURL(objUrl);
                    resolve(img);
                };
                img.onerror = img.onabort = e => {
                    URL.revokeObjectURL(objUrl);
                    //todo cause?
                    console.warn("Failed to build image from a pixelmap blob!");
                    resolve(this._getFallbackErrorTile(404));
                };
                img.src = objUrl;
            }).catch(e => {
                resolve(this._getFallbackErrorTile(e.statusCode || 500));
            })
        })
    }

    _getFallbackErrorTile(httpErr) {
        //TODO based on error code draw error icon left top corner
        const canvas = document.createElement( 'canvas' );
        canvas.width = this._tileWidth;
        canvas.height = this._tileHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
        //todo warn only in unexpected cases (404 is expected --> sparse)
    }
};
