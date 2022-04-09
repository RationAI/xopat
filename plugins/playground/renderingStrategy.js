Playground.ServerPixelStrategy = class {
    constructor(context) {
        this.context = context;
        this.layerIndex = -1;

        if (!this.context.webGLEngine) this.context.createWebGLEngine();

        this.seaGL = new OpenSeadragonToGLBridge(this.context.webglEngine, "pixels");
    }

    prepareVisualization(visualization, source, imageCount) {
        this.seaGL.reset();
        this.seaGL.addVisualisation(visualization);

        //todo allow just not setting at all if not needed
        this.seaGL.addData(...new Array(imageCount).fill("_g_"));
    }

    initVisualization(onloaded) {
        const _this = this;
        this.seaGL.loadShaders(function() {
            _this.seaGL.initAfterOpen(VIEWER); //bind OSD
            onloaded();
        });
    }

    load(jsonConfig, data, algorithmId, isPixels) {
        let options = Playground.Protocol.prototype.configure(jsonConfig, "", null);

        //todo set default?
        options.rootServer = this.context.setup.server;
        options.imageSource = data;
        options.algorithm = algorithmId;
        options.owner = this.context;
        //todo if json says render pixel render pixel, else geometry
        this._addTileSource(isPixels ? new Playground.Protocol(options) : new Playground.VectorProtocol(options));
    }

    refresh() {
        let src = this._findSelfSource();
        if (!src) return;
        src.reset();
    }

    disable() {
        this._cachedTiledImage = this._removePixelRenderingLayer();
    }

    enable() {
        if (this._cachedTiledImage) {
            VIEWER.world.addItem(this._cachedTiledImage);
        }
        delete this._cachedTiledImage;
    }

    clear() {
        this._removePixelRenderingLayer();
    }

    _addTileSource(tileSource) {
        if (this.layerIndex < 0) {
            let src = this._findSelfSource();
            tileSource = tileSource || src;
        }
        if (tileSource){
            let size = tileSource.getTileSize();
            this.seaGL.webGLEngine.setDimensions(size, size);
        }

        const _this = this;
        if (this.layerIndex >= 0) {
            if (!tileSource) tileSource = VIEWER.world.getItemAt(this.layerIndex);
            this.seaGL.removeLayer(this.layerIndex);

            VIEWER.addTiledImage({
                tileSource: tileSource,
                index: this.layerIndex,
                opacity: 1,
                replace: true,
                success: function () {
                    _this._findSelfSource();
                    _this.seaGL.addLayer(_this.layerIndex);
                }
            });
        } else {
            if (!tileSource) return; //nothing to add

            VIEWER.addTiledImage({
                tileSource : tileSource,
                opacity: 1,
                success: function () {
                    _this._findSelfSource();
                    _this.seaGL.addLayer(_this.layerIndex);
                }
            });
        }
    }

    _findSelfSource() {
        let items = VIEWER.world._items;
        for (let i = 0; i < items.length; i++) {
            let src = items[i];
            if (src.source instanceof Playground.Protocol) {
                this.layerIndex = i;
                return src;
            }
        }
    }

    get source() {
        if (this.layerIndex < 0) return this._findSelfSource();
        return VIEWER.world.getItemAt(this.layerIndex).source;
    }

    _removePixelRenderingLayer() {
        //todo also should remove controls etc...
        let currentSource = undefined;
        if (this.layerIndex < 0) this._findSelfSource();
        try {
            if (!this.layerIndex || this.layerIndex < 0) return;
            currentSource = VIEWER.world.getItemAt(this.layerIndex);
            if (currentSource) VIEWER.world.removeItem(currentSource);
        } catch (e) {
            //scan otherwise... something went wrong
            let items = VIEWER.world._items;
            for (let i = 0; i < items.length; i++) {
                let src = items[i];
                if (src.source instanceof Playground.Protocol) {
                    VIEWER.world.removeItem(src);
                }
            }
        }
        this.layerIndex = -1;
        return currentSource;
    }
};

// //todo manual fetch update         this.owner.messageStatus.innerHTML ...
// Playground.ServerVectorStrategy = class {
//     constructor(context) {
//         this.context = context;
//         if (!this.context.vectorCanvas) this.context.createVectorCanvas();
//     }
//
//     load(jsonConfig, data, algorithmId) {
//         let options = Playground.Protocol.prototype.configure(jsonConfig, "", null);
//         options.rootServer = this.context.setup.server;
//         options.imageSource = data;
//         options.algorithm = algorithmId;
//         options.owner = this.context;
//
//
//         let image = new $.TiledImage({
//             viewer: _this,
//             source: queueItem.tileSource,
//             viewport: _this.viewport,
//             drawer: _this.drawer,
//             tileCache: _this.tileCache,
//             imageLoader: _this.imageLoader,
//             x: queueItem.options.x,
//             y: queueItem.options.y,
//             width: queueItem.options.width,
//             height: queueItem.options.height,
//             fitBounds: queueItem.options.fitBounds,
//             fitBoundsPlacement: queueItem.options.fitBoundsPlacement,
//             clip: queueItem.options.clip,
//             placeholderFillStyle: queueItem.options.placeholderFillStyle,
//             opacity: queueItem.options.opacity,
//             preload: queueItem.options.preload,
//             degrees: queueItem.options.degrees,
//             flipped: queueItem.options.flipped,
//             compositeOperation: queueItem.options.compositeOperation,
//             springStiffness: _this.springStiffness,
//             animationTime: _this.animationTime,
//             minZoomImageRatio: _this.minZoomImageRatio,
//             wrapHorizontal: _this.wrapHorizontal,
//             wrapVertical: _this.wrapVertical,
//             immediateRender: _this.immediateRender,
//             blendTime: _this.blendTime,
//             alwaysBlend: _this.alwaysBlend,
//             minPixelRatio: _this.minPixelRatio,
//             smoothTileEdgesMinZoom: _this.smoothTileEdgesMinZoom,
//             iOSDevice: _this.iOSDevice,
//             crossOriginPolicy: queueItem.options.crossOriginPolicy,
//             ajaxWithCredentials: queueItem.options.ajaxWithCredentials,
//             loadTilesWithAjax: queueItem.options.loadTilesWithAjax,
//             ajaxHeaders: queueItem.options.ajaxHeaders,
//             debugMode: _this.debugMode,
//             subPixelRoundingForTransparency: _this.subPixelRoundingForTransparency
//         });
//
//         //todo if json says render pixel render pixel, else geometry
//         this._addTileSource(new Playground.Protocol(options));
//     }
//
//     refresh() {
//         let src = this._findSelfSource();
//         if (!src) return;
//         src.reset();
//     }
//
//     clear() {
//         this._removePixelRenderingLayer();
//     }
//
//     _addTileSource(tileSource) {
//         if (this.layerIndex < 0) {
//             let src = this._findSelfSource();
//             tileSource = tileSource || src;
//         }
//         if (tileSource){
//             let size = tileSource.getTileSize();
//             this.seaGL.webGLEngine.setDimensions(size, size);
//         }
//
//         if (this.layerIndex >= 0) {
//             if (!tileSource) tileSource = VIEWER.world.getItemAt(this.layerIndex);
//
//             VIEWER.addTiledImage({
//                 tileSource: tileSource,
//                 index: this.layerIndex,
//                 opacity: 1,
//                 replace: true
//             });
//         } else {
//             if (!tileSource) return; //nothing to add
//
//             VIEWER.addTiledImage({
//                 tileSource : tileSource,
//                 opacity: 1
//             });
//             this._findSelfSource();
//         }
//
//         //todo move layerIndex to seaGL completely
//         if (this.layerIndex >= 0) {
//             this.seaGL.addLayer(this.layerIndex);
//         }
//     }
//
//     _findSelfSource() {
//         let items = VIEWER.world._items;
//         for (let i = 0; i < items.length; i++) {
//             let src = items[i];
//             if (src.source instanceof Playground.Protocol) {
//                 this.layerIndex = i;
//                 return src;
//             }
//         }
//     }
//
//     _removePixelRenderingLayer() {
//         //todo also should remove controls etc...
//         let currentSource = undefined;
//         if (this.layerIndex < 0) this._findSelfSource();
//         try {
//             if (!this.layerIndex || this.layerIndex < 0) return;
//             currentSource = VIEWER.world.getItemAt(this.layerIndex);
//             if (currentSource) VIEWER.world.removeItem(currentSource);
//         } catch (e) {
//             //scan otherwise... something went wrong
//             let items = VIEWER.world._items;
//             for (let i = 0; i < items.length; i++) {
//                 let src = items[i];
//                 if (src.source instanceof Playground.Protocol) {
//                     VIEWER.world.removeItem(src);
//                 }
//             }
//         }
//         this.layerIndex = -1;
//         return currentSource;
//     }
// };

Playground.LocalStrategy = class {
    constructor(context) {
        this.context = context;
        if (!this.context.webGLEngine) this.context.createWebGLEngine();
        this.engine = context.webglEngine;
        this.uid = Date.now();
    }

    prepareVisualization(visualization, souce, imageCount) {
        this.engine.reset();
        this.engine.addVisualisation(visualization);
        this._sourcesCount = imageCount;
        this._source = souce;
    }

    initVisualization(onloaded) {
        this.engine.prepare(new Array(this._sourcesCount).fill("_g_"), function () {
            this.engine.init();
            onloaded();
        });
    }

    load(jsonConfig, data, algorithmId, isPixels) {
        tilesMatrix
    }

    refresh() {

    }

    clear() {

    }

    _loadTile(e) {
        if (! e.image) return;

        if (e.tile.url.contains(this._source)) {
            e.tile.playgroundId = this.uid;
            e.tile.playgroundRefresh = 0; // -> will draw immediatelly

            //necessary, the tile is re-drawn upon re-zooming, store the output
            var canvas = document.createElement('canvas');
            canvas.width = e.tile.sourceBounds.width;
            canvas.height = e.tile.sourceBounds.height;
            e.tile.context2D = canvas.getContext('2d');
        }
    }

    _drawTile(e) {

    }

};

Playground.LocalStrategy.TiledImage = class extends OpenSeadragon.TiledImage {

};
