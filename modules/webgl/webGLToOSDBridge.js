/*
* Bridge between WebGLModule and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Based on OpenSeadragonGL plugin
* https://github.com/thejohnhoffer/viaWebGL
*
* NOTE: imagePixelSizeOnScreen needs to be assigned if custom OSD used... TODO revise API
*
* TODO: create OSD wrapper more tightly connected, revise the API...
*/

OpenSeadragonToGLBridge = function(webGLEngine, mode="cache") {
    let _this  = this;
    webGLEngine.resetCallback = _ => _this.redraw();
    this._disabled = true; //so that first enable call is executed
    this.webGLEngine = webGLEngine;
    this.upToDateTStamp = Date.now();

    if (mode !== "cache") {
        this.uid = OpenSeadragonToGLBridge.getUniqueId();
    }
    this._rendering = new WeakMap();
};

OpenSeadragonToGLBridge.getUniqueId = function() {
    return (Date.now()).toString(36);
};

OpenSeadragonToGLBridge.prototype = {

    addLayer: function(idx) {
        let existing = this._rendering[idx];
        let layer = this.openSD.world.getItemAt(idx);
        if (existing) {
            if (existing == layer) return;
            else this.removeLayer(idx);
        }

        if (!this.uid) {
            const _context = this;
            let source = layer.source;
            source.__cached_createTileCache = source.createTileCache;
            source.createTileCache = function(data, tile) {
                //dirty but we need to always say 'YES'
                tile._hasTransparencyChannel = function () {
                    return true;
                };

                this._data = data;
                this._dim = tile.sourceBounds;
                this._dim.width = Math.max(this._dim.width,1);
                this._dim.height = Math.max(this._dim.height,1);
            };

            source.__cached_destroyTileCache = source.destroyTileCache;
            source.destroyTileCache = function() {
                this._data = null;
                this._renderedContext = null;
            };

            source.__cached_getTileCacheData = source.getTileCacheData;
            source.getTileCacheData = function() {
                return this._data;
            };

            source.__cached_tileDataToRenderedContext = source.tileDataToRenderedContext;
            source.tileDataToRenderedContext = function () {
                if (!this._renderedContext) {
                    this.webglRefresh = 0;
                    var canvas = document.createElement('canvas');
                    canvas.width = this._dim.width;
                    canvas.height = this._dim.height;
                    this._renderedContext = canvas.getContext('2d');
                }

                if (this.webglRefresh <= _context.upToDateTStamp) {
                    this.webglRefresh = _context.upToDateTStamp + 1;

                    //todo keep?
                    _context.webGLEngine.setDimensions(this._dim.width, this._dim.height);

                    // Render a webGL canvas to an input canvas using cached version
                    var output = _context.webGLEngine.processImage(this._data, this._dim,
                        _context.openSD.viewport.getZoom(), _context.imagePixelSizeOnScreen());

                    // Note: you can comment out clearing if you don't use transparency
                    this._renderedContext.clearRect(0, 0, this._dim.width, this._dim.height);
                    this._renderedContext.drawImage(output == null ? this._data : output, 0, 0,
                        this._dim.width, this._dim.height);
                }
                return this._renderedContext;
            };
        }
        this._rendering[idx] = layer;
    },

    hasImageAssigned: function(tiledImage) {
        for (let key in this._rendering) {
            if (this._rendering[key] == tiledImage) return true;
        }
        return false;
    },

    removeLayer: function(idx) {
        if (!this.uid) {
            let source = this._rendering[idx];
            if (!source || !source.source) return;
            source = source.source;
            source.createTileCache = source.__cached_createTileCache;
            delete source.__cached_createTileCache;
            source.destroyTileCache = source.__cached_destroyTileCache;
            delete source.__cached_destroyTileCache;
            source.getTileCacheData = source.__cached_getTileCacheData;
            delete source.__cached_getTileCacheData;
            source.tileDataToRenderedContext = source.__cached_tileDataToRenderedContext;
            delete source.__cached_tileDataToRenderedContext;
        }
        delete this._rendering[idx];
    },

    disabled() {
        return this._disabled;
    },

    //todo better policy, support for multiple
    getTiledImage: function() {
        for (let key in this._rendering) {
            return this._rendering[key];
        }
        return undefined;
    },

    /**
     * Runs a callback on each visualisation goal
     * @param {function} call callback to perform on each visualisation goal (its object given as the only parameter)
     */
    foreachVisualisation: function(call) {
        this.webGLEngine.foreachVisualisation(call);
    },

    /**
     * Get the current visualisaiton goal object
     * @returns current visualisaiton goal object
     */
    currentVisualisation: function() {
        return this.webGLEngine.currentVisualisation();
    },

    /**
     * Set program shaders. Just forwards the call to webGLEngine, for easier access.
     * @param {object} visualisation - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addVisualisation: function(...visualisation) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualisations have been already loaded.");
            return false;
        }
        return this.webGLEngine.addVisualisation(...visualisation);
    },

    /**
     * Set program data.
     * @param {string} data - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addData: function(...data) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualisations have been already loaded.");
            return false;
        }
        this.imageData = data;
        return true;
    },

    /**
     * Change visualisation in use
     * @param {number} visIdx index of the visualisation
     */
    switchVisualisation: function(visIdx) {
        this.webGLEngine.switchVisualisation(visIdx);
    },

    /**
     * Make ViaWebGL download and prepare visualisations,
     * called inside init() if not called manually before
     * (sometimes it is good to start ASAP - more time to load before OSD starts drawing)
     */
    loadShaders: function(onPrepared=function(){}) {
        if (this.webGLEngine.isPrepared) return;
        this.webGLEngine.prepare(this.imageData, onPrepared);
    },

    /**
     * Reorder shader: will re-generate current visualisation from dynamic data obtained from webGLEngine.shaderGenerator
     * @param {array} order array of strings that refer to ID's in the visualisation data (pyramidal tiff paths in our case)
     */
    reorder: function(order) {
        if (!Array.isArray(order)) {
            this.webGLEngine.rebuildVisualisation(null);
        } else {
            //webGLEngine rendering is first in order: first drawn, last in order: last drawn (atop)
            this.webGLEngine.rebuildVisualisation(order.reverse());
        }
        this.redraw();
    },

    /**
     * Redraw the scene using cached images.
     */
    redraw: function() {
        // var imageTile = this.getTiledImage();
        // if (!imageTile) return;

        // Raise tstamp to force redraw
        this.upToDateTStamp = Date.now();
        this.openSD.world.draw();
        this.openSD.navigator.world.draw();
    },

    /**
     * Get IDS of data sources to be fetched from the server at the time
     * @return {Array} array of keys from 'shaders' parameter of the current visualisation goal
     */
    dataImageSources: function() {
        return this.webGLEngine.getSources();
    },

    activeShaderIndex: function() {
        return this.webGLEngine._program;
    },

    /**
     * Access to webGL context
     * @returns webGL context
     */
    GL: function() {
        return this.webGLEngine.gl;
    },

    refreshMissingSources: function() {
        //todo remove
        let programIdx = this.webGLEngine.getCurrentProgramIndex(),
            curVis = this.webGLEngine._visualisations[programIdx],
            tileSource =  this.openSD.world.getItemAt(1).source;
        layersLoop: for (let lId in curVis.shaders) {
            if (!curVis.shaders.hasOwnProperty(lId)) continue;
            let layer = curVis.shaders[lId];
            layer.missingDataSources = false;
            for (let id of layer.dataReferences) {
                //todo hardcoded reading of values of particular implementation, maybe check whether array and then treat as array
               //todo also displayRects might not exist -> just do not inspect in that case?
                if (!tileSource.displayRects[id] || tileSource.displayRects[id].Width == 0 || tileSource.displayRects.Height == 0) {
                    layer.missingDataSources = true;
                    continue layersLoop;
                }
            }
        }
    },

    /**
     * Initialize the bridge between OSD and WebGL rendering once 'open' event happens
     * unlike the WebGL's init() can (and should) be called immediately after preparation (loadShaders)
     * - awaits the OSD opening
     *
     * @param openSeaDragonInstance OSD viewer instance to bind to
     * @param layerLoaded
     * @return {OpenSeadragonToGLBridge}
     */
    initBeforeOpen: function(openSeaDragonInstance, layerLoaded=()=>{}) {
        if (this.webGLEngine.isInitialized) return this;
        this._initSelf(openSeaDragonInstance);

        let _this = this;
        let handler = function(e) {
            function init() {
                _this.webGLEngine.init();
                layerLoaded();
                _this.openSD.removeHandler('open', handler);
            }

            if (!_this.webGLEngine.isPrepared) _this.loadShaders(init);
            else init();
        };

        this.openSD.addHandler('open', handler);
        return this;
    },

    /**
     * Initialize the bridge between OSD and WebGL immediately
     * like the WebGL's init() must be called once WebGL.prepare() finished
     *
     * @param openSeaDragonInstance OSD viewer instance to bind to
     */
    initAfterOpen: function(openSeaDragonInstance) {
        if (this.webGLEngine.isInitialized) return this;

        const _this = this;
        function init() {
            _this._initSelf(openSeaDragonInstance);
            _this.webGLEngine.init();
        }
        if (!this.webGLEngine.isPrepared) this.loadShaders(init);
        else init();
        return this;
    },

    /**
     * Reset the WebGL module, so that different initialization can be performed
     */
    reset: function() {
        this.webGLEngine.reset();
    },

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    _initSelf: function(openSeaDragonInstance) {
        this.openSD = openSeaDragonInstance;

        if (!this._shadersLoaded) {
            this.loadShaders();
            this._shadersLoaded = true;
        }

        //todo?
        // openSeaDragonInstance.addHandler('remove-item', function (e) {
        //
        // });

        //if not set manually
        if (!this.imagePixelSizeOnScreen) {
            //if we have OSD TOOLs to-be plugin (?), use it
            if (openSeaDragonInstance.hasOwnProperty("tools")) {
                this.imagePixelSizeOnScreen =
                    openSeaDragonInstance.tools.imagePixelSizeOnScreen.bind(openSeaDragonInstance.tools);
            } else {
                //just some placeholder
                console.error("OpenSeadragon has no Tool extension with 'imagePixelSizeOnScreen' function and this " +
                    "function was not assigned to the bridge instance: pixel ratio difference will be always 1.");
                this.imagePixelSizeOnScreen = _ => 1;
            }
        }

        if (this.uid) { //not a cached version
            let tileLoaded = this._tileLoaded.bind(this);
            let tileDrawing = this._tileDrawing.bind(this);

            //todo allow option binding to main viewer only?
            this.enable = function () {
                if (!this._disabled) return;
                this._disabled = false;
                this.openSD.addHandler('tile-drawing', tileDrawing);
                this.openSD.addHandler('tile-loaded', tileLoaded);
                this.openSD.navigator.addHandler('tile-drawing', tileDrawing);
                this.openSD.navigator.addHandler('tile-loaded', tileLoaded);
            };

            this.disable = function () {
                if (this._disabled) return;
                this._disabled = true;
                this.openSD.removeHandler('tile-drawing', tileDrawing);
                this.openSD.removeHandler('tile-loaded', tileLoaded);
                this.openSD.navigator.removeHandler('tile-drawing', tileDrawing);
                this.openSD.navigator.removeHandler('tile-loaded', tileLoaded);
            };
            this.enable();
        } else {
            this.enable = this.disable = function () {
                console.error("Not yet implemented");
            };
            this._disabled = false;
        }
    },

    _tileLoaded: function(e) {
        if (! e.image) return;

        //todo does not work on navigator
        if (this.hasImageAssigned(e.tiledImage) && !e.tile.webglId) {
            e.tile.webglId = this.uid;
            e.tile.webglRefresh = 0; // -> will draw immediatelly
            //todo try using OSD image cache instead

            //necessary, the tile is re-drawn upon re-zooming, store the output
            var canvas = document.createElement('canvas');
            canvas.width = e.tile.sourceBounds.width;
            canvas.height = e.tile.sourceBounds.height;
            e.tile.context2D = canvas.getContext('2d');
        }
    },

    _tileDrawing: function(e) {
        if (e.tile.webglId !== this.uid) return;
        if (e.tile.webglRefresh <= this.upToDateTStamp) {
            e.tile.webglRefresh = this.upToDateTStamp + 1;

            //todo might not be necessary
            this.webGLEngine.setDimensions( e.tile.sourceBounds.width, e.tile.sourceBounds.height);

            let imageData = e.tile.image || e.tile.cacheImageRecord.getImage();

            // Render a webGL canvas to an input canvas using cached version
            let output = this.webGLEngine.processImage(imageData, e.tile.sourceBounds,
                this.openSD.viewport.getZoom(), this.imagePixelSizeOnScreen());

            // Note: you can comment out clearing if you don't use transparency
            e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            e.rendered.drawImage(output == null? imageData : output, 0, 0,
                e.tile.sourceBounds.width, e.tile.sourceBounds.height);
        }
    }
};
