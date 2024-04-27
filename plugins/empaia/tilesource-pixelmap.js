/**
 * Within LibEmpationAPI we provide the slide access for the OpenSeadragon.
 * @class OpenSeadragon.EmpationAPIV3TileSource
 * @extends OpenSeadragon.TileSource
 */
OpenSeadragon.EmpaiaPixelmapV3TileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        // todo fix OSD API here we rely on url string missing check and passing config object
        super(options);
        this._failedCanvasDataCache = {};
    }

    supports( data, url ){
        //todo fix OSD api and make type a standardized selector (e.g. map to class names)
        return data.type && data.type === "leav3" && data.pixelmap;
    }

    _fail(message) {
        throw message;
        //TODO: OSD does not respect this handler see https://github.com/openseadragon/openseadragon/issues/2474
        // this.raiseEvent('open-failed', {
        //     message: message,
        //     source: '[Empaia Plugin Internal URL]'
        // });
    }

    configure( data, url, postData ) {
        return {
            url: data
        };
    }

    getImageInfo(options) {
        // TODO consider multi tile support (test performance first)
        if (!options || !options.pixelmap) {
            this._fail("Invalid usage: slide ID must be provided");
            return;
        }

        this.api = EmpationAPI.V3.get();
        this.pixelmapIds = [];
        //todo dirty __scope_def
        this.api.getScopeUse(...this.api.__scope_def).then(scopes => Promise.all(
                options.pixelmap.split(',').map(pixelmapId => this._fetchPixelmapInfo.call(this, scopes, pixelmapId))
        )).then(async _ => {
            if (this.pixelmapIds.length === 0) {
                //todo if ids empty:
                this._fail("Failed to load the pixelmap data!");
                this.metadata = {error: "Failed to load the pixelmap data!"};
                return;
            }

            try {
                //fetch the relevant slide info and inherit dimensions
                const info = await this.api.slides.slideInfo(this._targetSlide);

                this.maxLevel = info.levels.length-1;
                this.width = info.extent.x;
                this.height = info.extent.y;
                this.dimensions = new OpenSeadragon.Point(this.width, this.height);
                this.aspectRatio = this.width / this.height;
            } catch (e) {
                this._fail("Failed to load the parent slide data!");
                this.metadata = {error: "Failed to load the parent slide data!"};
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
                //todo possibly issue if multiple references used...
                _targetSlide: info.reference_id,
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
        this.api.getScopeUse(...this.api.__scope_def).then(scopes => Promise.all(
            this.pixelmapIds.map(id => this._fetchPixelmapTile.call(this, scopes, id, data.level, data.x, data.y))
        )).then(data => {
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
                    resolve(this._getFallbackErrorTile(500));
                };
                img.src = objUrl;
            }).catch(e => {
                resolve(this._getFallbackErrorTile(e.statusCode));
            })
        })
    }

    _getFallbackErrorTile(httpErr) {
        const key = `${httpErr}-${this._tileWidth}`;
        if (this._failedCanvasDataCache[key]) return this._failedCanvasDataCache[key];

        const canvas = document.createElement( 'canvas' );
        canvas.width = this._tileWidth;
        canvas.height = this._tileHeight;
        const ctx = canvas.getContext('2d');
        ctx.font = '48px Material Icons';
        switch (httpErr) {
            case 404:
                //OK, sparse tree
                break;
            default:
                //todo better icons, also provide either a legend or allow some action (hover/draw text)
                //todo crop if tile size exceeds the dimension (webgl), draw this instead in webgl (or as a postprocess)
                ctx.fillStyle = ctx.strokeStyle = "#cc0000";
                ctx.fillText('warning',20,88);
                ctx.lineWidth = 4;
                ctx.strokeRect(2,2,canvas.width, canvas.height);
                break;
        }
        this._failedCanvasDataCache[key] = canvas;
        return canvas;
    }
};
