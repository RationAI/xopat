/*
* Bridge between WebGLModule and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Originally based on OpenSeadragonGL plugin, but you would find little similarities by now.
* NOTE: imagePixelSizeOnScreen needs to be assigned if custom OSD used... not very clean design
*
* TODO always use cache approach, do not rely on events, just program two approaches - with and without cache (setting c2d directly after tile load)
*/

OpenSeadragon.BridgeGL = class {

    constructor(openSeaDragonInstance, webGLEngine, cachedMode=true) {
        let _this  = this;
        this.openSD = openSeaDragonInstance;

        webGLEngine.resetCallback = _ => _this.redraw();
        this._disabled = true; //so that first enable call is executed
        this.webGLEngine = webGLEngine;
        this._refreshTimeStamp = Date.now();
        this._randomDelay = 0;

        if (!cachedMode) {
            this.uid = OpenSeadragon.BridgeGL.getUniqueId();
        }
        this._rendering = new WeakMap();
    }

    static getUniqueId() {
        return (Date.now()).toString(36);
    }

    /**
     * Add OSD World Item index of a TiledImage that is being post-processed
     * @param idx index
     */
    addLayer(idx) {
        let existing = this._rendering[idx];
        let tiledImage = this.openSD.world.getItemAt(idx);
        if (!tiledImage) throw "Invalid index: no Tiled Image with index " + idx;
        if (existing) {
            if (existing == tiledImage) return;
            else this.removeLayer(idx);
        }
        this._rendering[idx] = tiledImage;

        if (!this.uid) {
            //enable on the source by overriding its member functions
            this._bindToTiledImage(idx);
        } else {
            tiledImage._bridgeId = this.uid;
        }
        //else... the other approach is based on events, no need to enable on the element

        tiledImage.__cached_hasTransparency = tiledImage.hasTransparency;
        tiledImage.hasTransparency = function(context2D, url, ajaxHeaders, post) {
            return true; //we always render transparent
        }
    }

    /**
     * Remove TiledImage by it's index
     * @param idx index of the tiled image to remove
     */
    removeLayer(idx) {
        if (!this.uid) {
            const source = this._unbindFromTiledSource(idx);
            if (source) {
                source.hasTransparency = source.__cached_hasTransparency || source.hasTransparency;
                delete source.__cached_hasTransparency;
            } else {
                console.warn("Could not properly remove bindings on TiledImage index", idx);
            }
        }
        delete this._rendering[idx];
    }

    /**
     * Enable binding of the renderer to OSD
     */
    enable() {
        //this is just a placeholder, set on init(...)
    }

    /**
     * Disable binding of the renderer to OSD
     */
    disable() {
        //this is just a placeholder, set on init(...)
    }

    /**
     * Check whether rendering is running
     * @return {boolean} true if binding is active
     */
    disabled() {
        return this._disabled;
    }

    /**
     * Get Tiled Image instance that is being bound to the post-processing engine
     * @param osdItemWorldIndex index of the image, or nothing - in that case first tiled image is returned
     * @return {undefined|OpenSeadragon.TiledImage} tiled image
     */
    getTiledImage(osdItemWorldIndex=-1) {
        if (osdItemWorldIndex < 0) {
            for (let key in this._rendering) {
                if (this._rendering[key]) return this._rendering[key];
            }
            return undefined;
        }
        return this._rendering[osdItemWorldIndex];
    }

    getWorldIndex() {
        for (let key in this._rendering) {
            if (this._rendering[key]) return key;
        }
        return -1;
    }

    /**
     * Runs a callback on each visualisation goal
     * @param {function} call callback to perform on each visualisation goal (its object given as the only parameter)
     */
    foreachVisualisation(call) {
        this.webGLEngine.foreachVisualisation(call);
    }

    /**
     * Get a visualisaiton goal object
     * @returns {object} a visualisaiton goal object
     */
    visualization(index=undefined) {
        return this.webGLEngine.visualization(index || this.webGLEngine.currentVisualisationIndex());
    }

    /**
     * Get the current visualisaiton goal index
     * @returns {number} current visualisaiton goal index
     */
    currentVisualisationIndex() {
        return this.webGLEngine.currentVisualisationIndex();
    }

    /**
     * Set program shaders. Just forwards the call to webGLEngine, for easier access.
     * @param {object} visualisation - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addVisualisation(...visualisation) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualisations have been already loaded.");
            return false;
        }
        return this.webGLEngine.addVisualisation(...visualisation);
    }

    /**
     * Set program data.
     * @param {string} data - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addData(...data) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualisations have been already loaded.");
            return false;
        }
        this.imageData = data;
        return true;
    }

    /**
     * Change visualisation in use
     * @param {number} visIdx index of the visualisation
     */
    switchVisualisation(visIdx) {
        this.webGLEngine.switchVisualisation(visIdx);
    }

    /**
     * Make ViaWebGL download and prepare visualisations,
     * called inside init() if not called manually before
     * (sometimes it is good to start ASAP - more time to load before OSD starts drawing)
     */
    loadShaders(activeVisualizationIdx=0, onPrepared=function(){}) {
        if (this.webGLEngine.isPrepared) return;
        this.webGLEngine.prepare(this.imageData, onPrepared, activeVisualizationIdx);
    }

    /**
     * Reorder shader: will re-generate current visualisation from dynamic data obtained from webGLEngine.shaderGenerator
     * @param {array} order array of strings that refer to ID's in the visualisation
     *   data (e.g. pyramidal tiff paths in our case), first is rendered last (top)
     */
    reorder(order) {
        if (!Array.isArray(order)) {
            this.webGLEngine.rebuildVisualisation(null);
        } else {
            //webGLEngine rendering is first in order: first drawn, last in order: last drawn (atop)
            this.webGLEngine.rebuildVisualisation(order.reverse());
        }
        this.redraw();
    }

    /**
     * Get current timestamp
     * @return {number}
     */
    get timeStamp() {
        if (this._randomDelay < 1) return this._refreshTimeStamp;
        return Math.random() * this._randomDelay + this._refreshTimeStamp;
    }

    /**
     * Get next timestamp which is guaranteed to be higher than or equal to any
     * timestamp set to processed entity
     * @return {number}
     */
    get highestTimestamp() {
        return this._refreshTimeStamp + this._randomDelay + 10;
    }

    /**
     * Invalidate all post-processed results, does not update/draw viewport
     * @param {number} randomDelay - time in milliseconds, tile updates can randomly occur within randomDelay
     *   note: it is not guaranteed to be updated, e.g. if you need to have ALL finished after
     *   the time has elapsed, make sure to call draw() at the end (e.g. setTimer....)
     */
    invalidate(randomDelay=0) {
        // Raise tstamp to force redraw
        this._refreshTimeStamp = Date.now();
        this._randomDelay = Math.max(0, randomDelay);
    }

    /**
     * Draw/update viewport, does not invalidate last post-processed results
     */
    draw() {
        this.openSD.world.draw();
        this.openSD.navigator.world.draw();
    }

    /**
     * Redraw the scene to reflect the latest visualization changes.
     * @param {number} randomDelay - time in milliseconds, tile updates can randomly occur within randomDelay
     *   note: it is not guaranteed to be updated, e.g. if you need to have ALL
     *   tiles updated after 'randomDelay', call draw() after the time has elapsed
     */
    redraw(randomDelay=0) {
        this.invalidate(randomDelay);
        this.draw();
    }

    /**
     * Get IDS of data sources to be fetched from the server at the time
     * @return {Array} array of keys from 'shaders' parameter of the current visualisation goal
     */
    dataImageSources() {
        return this.webGLEngine.getSources();
    }

    /**
     * Get active shader index
     * @return {number}
     */
    activeShaderIndex() {
        return this.webGLEngine._program;
    }

    /**
     * Access to webGL context
     * @returns {WebGLRenderingContext|WebGLRenderingContext} context
     */
    GL() {
        return this.webGLEngine.gl;
    }

    /**
     * Initialize the bridge between OSD and WebGL rendering once 'open' event happens
     * unlike the WebGL's init() can (and should) be called immediately after preparation (loadShaders)
     * - awaits the OSD opening
     *
     * @param {function} layerLoaded callback on load
     * @return {OpenSeadragon.BridgeGL}
     */
    initBeforeOpen(layerLoaded=()=>{}) {
        if (this.webGLEngine.isInitialized) return this;
        this._initSelf();

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
    }

    /**
     * Initialize the bridge between OSD and WebGL immediately
     * like the WebGL's init() must be called once WebGL.prepare() finished
     */
    initAfterOpen() {
        if (this.webGLEngine.isInitialized) return this;

        const _this = this;
        function init() {
            _this._initSelf();
            _this.webGLEngine.init();
        }
        if (!this.webGLEngine.isPrepared) this.loadShaders(init);
        else init();
        return this;
    }

    /**
     * Reset the WebGL module, so that different initialization can be performed
     */
    reset() {
        this.webGLEngine.reset();
    }

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    _initSelf() {
        //if not set manually
        if (!this.imagePixelSizeOnScreen) {
            //if we have OSD TOOLs to-be plugin (?), use it
            if (this.openSD.hasOwnProperty("tools")) {
                this.imagePixelSizeOnScreen =
                    this.openSD.tools.imagePixelSizeOnScreen.bind(this.openSD.tools);
            } else {
                //just some placeholder
                console.error("OpenSeadragon has no Tool extension with 'imagePixelSizeOnScreen' function and this " +
                    "function was not assigned to the bridge instance: pixel ratio difference will be always 1.");
                this.imagePixelSizeOnScreen = _ => 1;
            }
        }

        if (this._shadersLoaded) return;
        this.loadShaders();
        this._shadersLoaded = true;

        //This can be performed only once for now, mode of execution cannot be changed after init(...)

        if (this.uid) { //not a cached version, uses events to evaluate on all tiles
            let tileLoaded = this._tileLoaded.bind(this);
            let tileDrawing = this._tileDrawing.bind(this);

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
        } else { //cached version, overrides the TileSource API to customize cache creation
            this.enable = function(index=-1) {
                if (!this._disabled) return;

                for (let idx in this._rendering) {
                    if (this._rendering[idx]) this._bindToTiledImage(idx);
                }
                this._disabled = false;
            };

            this.disable = function(index=-1) {
                if (this._disabled) return;

                for (let idx in this._rendering) {
                    if (this._rendering[idx]) this._unbindFromTiledSource(idx);
                }
                this._disabled = true;
            };
            this._disabled = false;
        }
    }

    /************** EVENT STRATEGY ******************/

    _tileLoaded(e) {
        if (! e.image) return;

        if (this.uid === e.tiledImage._bridgeId && !e.tile.webglId) {
            e.tile.webglId = this.uid;
            //todo necessary to set?!?! I thougth OSD does this automatically
            e.tile.imageData = e.image;
            e.tile.webglRefresh = 0; // -> will draw immediatelly
            //necessary, the tile is re-drawn upon re-zooming, store the output
            var canvas = document.createElement('canvas');
            canvas.width = e.tile.sourceBounds.width;
            canvas.height = e.tile.sourceBounds.height;
            e.tile.context2D = canvas.getContext('2d');
        }
    }

    _tileDrawing(e) {
        if (e.tile.webglId === this.uid && e.tile.webglRefresh <= this.timeStamp) {
            e.tile.webglRefresh = this.highestTimestamp;

            //todo make it such that it is called just once
            this.webGLEngine.setDimensions( e.tile.sourceBounds.width, e.tile.sourceBounds.height);

            let imageData = e.tile.imageData;

            // Render a webGL canvas to an input canvas using cached version
            let output = this.webGLEngine.processImage(imageData, e.tile.sourceBounds,
                this.openSD.viewport.getZoom(), this.imagePixelSizeOnScreen());

            // Note: you can comment out clearing if you don't use transparency
            e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            e.rendered.drawImage(output == null? imageData : output, 0, 0,
                e.tile.sourceBounds.width, e.tile.sourceBounds.height);
        }
    }

    /************** BINDING (CACHE) STRATEGY ******************/

    _bindToTiledImage(index) {
        let layer = this._rendering[index];
        const _context = this;
        let source = layer.source;

        //necessary to modify hash key so as to force the viewer download the image twice
        source.__cached_getTileHashKey = source.getTileHashKey;
        source.getTileHashKey = function(level, x, y, url, ajaxHeaders, postData) {
            //todo implement instead feature of sharing the data :/
            return source.__cached_getTileHashKey(level, x, y, url, ajaxHeaders, postData) + "_webgl";
        };

        source.__cached_createTileCache = source.createTileCache;
        source.createTileCache = function(cache, data, tile) {
            cache._data = data;
            cache._dim = tile.sourceBounds;
            cache._dim.width = Math.max(cache._dim.width,1);
            cache._dim.height = Math.max(cache._dim.height,1);
        };

        source.__cached_destroyTileCache = source.destroyTileCache;
        source.destroyTileCache = function(cache) {
            cache._data = null;
            cache._renderedContext = null;
        };

        source.__cached_getTileCacheData = source.getTileCacheData;
        source.getTileCacheData = function(cache) {
            return cache._data;
        };

        source.__cached_hasTransparency = source.hasTransparency;
        source.hasTransparency = function(context2D, url, ajaxHeaders, post) {
            return true;
        };

        source.__cached_tileDataToRenderedContext = source.getTileCacheDataAsContext2D;
        source.getTileCacheDataAsContext2D = function (cache) {
            if (!cache._renderedContext) {
                cache.webglRefresh = 0;
                var canvas = document.createElement('canvas');
                canvas.width = cache._dim.width;
                canvas.height = cache._dim.height;
                cache._renderedContext = canvas.getContext('2d');
            }

            if (cache.webglRefresh <= _context.timeStamp) {
                cache.webglRefresh = _context.highestTimestamp;

                //todo make it such that it is called just once
                _context.webGLEngine.setDimensions(cache._dim.width, cache._dim.height);

                // Render a webGL canvas to an input canvas using cached version
                var output = _context.webGLEngine.processImage(cache._data, cache._dim,
                    _context.openSD.viewport.getZoom(), _context.imagePixelSizeOnScreen());

                // Note: you can comment out clearing if you don't use transparency
                cache._renderedContext.clearRect(0, 0, cache._dim.width, cache._dim.height);
                cache._renderedContext.drawImage(output == null ? cache._data : output, 0, 0,
                    cache._dim.width, cache._dim.height);
            }
            return cache._renderedContext;
        };
    }

    _unbindFromTiledSource(index) {
        let source = this._rendering[index];
        if (!source || !source.source) return;
        source = source.source;
        source.hasTransparency = source.__cached_hasTransparency;
        delete source.__cached_hasTransparency;
        source.createTileCache = source.__cached_createTileCache;
        delete source.__cached_createTileCache;
        source.destroyTileCache = source.__cached_destroyTileCache;
        delete source.__cached_destroyTileCache;
        source.getTileCacheData = source.__cached_getTileCacheData;
        delete source.__cached_getTileCacheData;
        source.getTileCacheDataAsContext2D = source.__cached_tileDataToRenderedContext;
        delete source.__cached_tileDataToRenderedContext;
        source.getTileHashKey = source.__cached_getTileHashKey;
        delete source.__cached_getTileHashKey;
        return source;
    }
};
