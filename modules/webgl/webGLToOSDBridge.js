/**
* Bridge between WebGLModule and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Originally based on OpenSeadragonGL plugin, but you would find little similarities by now.
* NOTE: imagePixelSizeOnScreen needs to be assigned if custom OSD used... not very clean design
* @class OpenSeadragon.BridgeGL
*/
window.OpenSeadragon.BridgeGL = class {

    constructor(openSeaDragonInstance, webGLEngine, cachedMode=true) {
        let _this  = this;
        this.openSD = openSeaDragonInstance;

        const originalReset = webGLEngine.resetCallback;
        webGLEngine.resetCallback = _ => {
            _this.clear();
            _this.redraw();
            originalReset();
        };
        this._disabled = true; //so that first enable call is executed
        this.webGLEngine = webGLEngine;
        this._refreshTimeStamp = Date.now();
        this._randomDelay = 0;

        if (!cachedMode) {
            this.uid = OpenSeadragon.BridgeGL.getUniqueId();
        }
        //todo probably bad implementation, weakmap does not count reference for _KEYS_
        this._rendering = new WeakMap();
        this.imageData = undefined;
    }

    static getUniqueId() {
        return (Date.now()).toString(36);
    }

    get isMultiplex() {
        return false;
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
            tiledImage.source._bridgeId = this.uid;
            tiledImage.source.__cached_hasTransparency = tiledImage.source.hasTransparency;
            tiledImage.source.hasTransparency = function(context2D, url, ajaxHeaders, post) {
                return true; //we always render transparent
            }
        }
    }

    /**
     * Remove TiledImage by it's index
     * @param idx index of the tiled image to remove
     */
    removeLayer(idx) {
        if (!this.uid) {
            const source = this._unbindFromTiledSource(idx);
            if (!source) {
                console.warn("Could not properly remove bindings on TiledImage index", idx);
            }
        } else {
            let source = this._rendering[idx];
            if (!source) {
                console.warn("Could not properly remove bindings on TiledImage index", idx);
            } else {
                delete tiledImage.source._bridgeId;
                source.hasTransparency = source.__cached_hasTransparency;
                delete source.__cached_hasTransparency;
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
     * Runs a callback on each visualization goal
     * @param {function} call callback to perform on each visualization goal (its object given as the only parameter)
     */
    foreachVisualization(call) {
        this.webGLEngine.foreachVisualization(call);
    }

    /**
     * Get a visualizaiton goal object
     * @returns {object} a visualizaiton goal object
     */
    visualization(index=undefined) {
        return this.webGLEngine.visualization(index === undefined ? this.webGLEngine.currentVisualizationIndex() : index);
    }

    /**
     * Get the current visualizaiton goal index
     * @returns {number} current visualizaiton goal index
     */
    currentVisualizationIndex() {
        return this.webGLEngine.currentVisualizationIndex();
    }

    /**
     * Set program shaders. Just forwards the call to webGLEngine, for easier access.
     * @param {object} visualization - objects that define the visualization (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addVisualization(...visualization) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualizations have been already loaded.");
            return false;
        }
        return this.webGLEngine.addVisualization(...visualization);
    }

    /**
     * Set program data.
     * @param {string} data - objects that define the visualization (see Readme)
     * @return {boolean} true if loaded successfully
     */
    setData(...data) {
        if (this.webGLEngine.isPrepared) {
            console.warn("Invalid action: visualizations have been already loaded.");
            return false;
        }
        this.imageData = data.length === 0 ? undefined : data;
        return true;
    }

    /**
     * Change visualization in use
     * @param {number} visIdx index of the visualization
     */
    switchVisualization(visIdx) {
        this.webGLEngine.switchVisualization(visIdx);
    }

    /**
     * Make ViaWebGL prepare visualizations,
     * called inside init() if not called manually before
     * (sometimes it is good to start ASAP - more time to load before OSD starts drawing)
     */
    loadShaders(activeVisualizationIdx=0, onPrepared=function(){}) {
        if (this.webGLEngine.isPrepared) {
            onPrepared();
            return;
        }
        this.webGLEngine.prepare(this.imageData, onPrepared, activeVisualizationIdx);
    }

    /**
     * Reorder shader: will re-generate current visualization from dynamic data obtained from webGLEngine.shaderGenerator
     * @param {array} order array of strings that refer to ID's in the visualization
     *   data (e.g. pyramidal tiff paths in our case), first is rendered last (top)
     */
    reorder(order=undefined) {
        if (!Array.isArray(order)) {
            this.webGLEngine.rebuildVisualization(null);
        } else {
            //webGLEngine rendering is first in order: first drawn, last in order: last drawn (atop)
            this.webGLEngine.rebuildVisualization(order.reverse());
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
     * Clear the canvas - necessary for transparent items to render correctly
     *  - done automatically on shader render updates
     */
    clear() {
        this.openSD.drawer._clear();
        this.openSD.navigator.drawer._clear();
    }

    /**
     * Draw/update viewport, does not invalidate last post-processed results
     */
    draw() {
        //Necessary to clear if underlying image is hidden, todo: when refactoring, optimize this
        this.openSD.drawer._clear();
        this.openSD.navigator.drawer._clear();
        this.openSD.world.draw();
        this.openSD.navigator.world.draw();
    }

    /**
     * Redraw the scene to reflect the latest visualization changes.
     * @param {number} randomDelay - time in milliseconds, tile updates can randomly occur within randomDelay
     *   note: viewport canvas is not guaranteed to be updated, e.g. if you need to have ALL
     *   tiles updated after 'randomDelay', call draw() after the time has elapsed
     */
    redraw(randomDelay=0) {
        this.invalidate(randomDelay);
        this.draw();
    }

    /**
     * Get IDS of data sources to be fetched from the server at the time
     * @return {Array} array of keys from 'shaders' parameter of the current visualization goal
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
     * @param {number} withActiveIndex index of the visualization to load as first, default 0
     * @return {OpenSeadragon.BridgeGL}
     */
    initBeforeOpen(layerLoaded=()=>{}, withActiveIndex=0) {
        if (this.webGLEngine.isInitialized) return this;
        this._initSelf();

        let _this = this;
        let handler = function(e) {
            function init() {
                _this.webGLEngine.init();
                layerLoaded();
                _this.openSD.removeHandler('open', handler);
            }
            _this.loadShaders(withActiveIndex, init);
        };

        this.openSD.addHandler('open', handler);
        return this;
    }

    /**
     * Initialize the bridge between OSD and WebGL immediately, loadShaders(...) must be called manually in this case.
     * like the WebGL's init() must be called once WebGL.prepare() finished
     */
    initAfterOpen() {
        if (this.webGLEngine.isInitialized) return this;
        if (!this.webGLEngine.isPrepared) {
            throw "BridgeGL::loadShaders() must be called before using initAfterOpen!";
        }
        this._initSelf();
        this.webGLEngine.init();
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
                    this.openSD.scalebar.imagePixelSizeOnScreen.bind(this.openSD.scalebar);
            } else {
                //just some placeholder
                console.error("OpenSeadragon has no Tool extension with 'imagePixelSizeOnScreen' function and this " +
                    "function was not assigned to the bridge instance: pixel ratio difference will be always 1.");
                this.imagePixelSizeOnScreen = _ => 1;
            }
        }


        if (this._initBounded) return;
        this.loadShaders(0, this._initFinish.bind(this)); //just to be safe, should be already loaded at this time, consider throwing instead
    }

    _initFinish() {
        //This can be performed only once for now, mode of execution cannot be changed after init(...)
        this._initBounded = true;
        if (this.uid) { //not a cached version, uses events to evaluate on all tiles
            let tileLoaded = this._tileLoaded.bind(this);
            let tileDrawing = this._tileDrawing.bind(this);

            this.enable = function() {
                if (!this._disabled) return;
                this._disabled = false;
                this.openSD.addHandler('tile-drawing', tileDrawing);
                this.openSD.addHandler('tile-loaded', tileLoaded);
                this.openSD.navigator.addHandler('tile-drawing', tileDrawing);
                this.openSD.navigator.addHandler('tile-loaded', tileLoaded);
            };

            this.disable = function() {
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
        if (! e.data) return;

        if (this.uid === e.tiledImage.source._bridgeId && !e.tile.webglId) {
            e.tile.webglId = this.uid;
            //will draw immediatelly
            e.tile.webglRefresh = 0;
            //we set context2D manually, the cache is NOT created
            e.tile.__data = e.data;
            //necessary, the tile is re-drawn upon re-zooming, store the output
            let canvas = document.createElement('canvas');
            canvas.width = e.tile.sourceBounds.width;
            canvas.height = e.tile.sourceBounds.height;
            e.tile.context2D = canvas.getContext('2d');
        }
    }

    _tileDrawing(e) {
        if (e.tile.webglId === this.uid && e.tile.webglRefresh <= this.timeStamp) {
            e.tile.webglRefresh = this.highestTimestamp;

            //noop if equal
            this.webGLEngine.setDimensions(e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            let imageData = e.tile.__data;
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
            delete cache._data;
            delete cache._dim;
            delete cache._renderedContext;
        };

        source.__cached_getTileCacheData = source.getTileCacheData;
        source.getTileCacheData = function(cache) {
            return cache._data;
        };

        source.__cached_hasTransparency = source.hasTransparency;
        source.hasTransparency = function(context2D, url, ajaxHeaders, post) {
            return true;
        };

        source.__cached_tileDataToIamge = source.getTileCacheDataAsImage;
        source.getTileCacheDataAsImage = function(cache) {
            throw "WebGL Postprocessing works only with canvasses for now!";
        };

        source.__cached_tileDataToRenderedContext = source.getTileCacheDataAsContext2D;
        source.getTileCacheDataAsContext2D = function(cache) {
            if (!cache._renderedContext) {
                cache.webglRefresh = 0;
                var canvas = document.createElement('canvas');
                canvas.width = cache._dim.width;
                canvas.height = cache._dim.height;
                cache._renderedContext = canvas.getContext('2d');
            }

            if (cache.webglRefresh <= _context.timeStamp) {
                cache.webglRefresh = _context.highestTimestamp;

                //noop if equal
                _context.webGLEngine.setDimensions(cache._dim.width, cache._dim.height);
                // Render a webGL canvas to an input canvas using cached version
                const output = _context.webGLEngine.processImage(cache._data, cache._dim,
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
        source.getTileCacheDataAsImage = source.__cached_tileDataToIamge;
        delete source.__cached_tileDataToIamge;
        source.getTileCacheDataAsContext2D = source.__cached_tileDataToRenderedContext;
        delete source.__cached_tileDataToRenderedContext;
        source.getTileHashKey = source.__cached_getTileHashKey;
        delete source.__cached_getTileHashKey;
        return source;
    }
};

//
// window.OpenSeadragon.BridgeGLMultiplex = class {
//
//     constructor(openSeaDragonInstance, cachedMode=true) {
//         let _this  = this;
//         this.openSD = openSeaDragonInstance;
//
//         this._disabled = true; //so that first enable call is executed
//         this.webGLEngineList = [];
//         this._refreshTimeStampList = {};
//         this._randomDelayList = {};
//         this._visualizations = [];
//         this._activeIndex = 0;
//
//         if (!cachedMode) {
//             this.uid = OpenSeadragon.BridgeGL.getUniqueId();
//         }
//         this._rendering = new WeakMap();
//         this.imageData = undefined;
//     }
//
//     get webGLEngine() {
//         if (this.webGLEngineList.length < 1) return {};
//         return this.webGLEngineList[0];
//     }
//
//     get isMultiplex() {
//         return true;
//     }
//
//     /**
//      * Add OSD World Item index of a TiledImage that is being post-processed
//      * @param idx index
//      * @param webglOptions
//      */
//     addLayer(idx, webglOptions) {
//         let existing = this._rendering[idx];
//         let tiledImage = this.openSD.world.getItemAt(idx);
//         if (!tiledImage) throw "Invalid index: no Tiled Image with index " + idx;
//         if (existing) {
//             if (existing == tiledImage) return;
//             else this.removeLayer(idx);
//         }
//         this._rendering[idx] = tiledImage;
//
//         if (!this.webGLEngineList[idx]) {
//             this.webGLEngineList[idx] = new WebGLModule(webglOptions);
//         } else {
//             //todo bit dirty
//             $.extend(true, this.webGLEngineList[idx], webglOptions);
//             this.webGLEngineList[idx].reset();
//         }
//         this._refreshTimeStampList[idx] = Date.now();
//         this._randomDelayList[idx] = 0;
//
//         const engine = this.webGLEngineList[idx];
//         //add visualization shader
//         this._visualizations.forEach(vis => {
//             const newVis = {...vis, shaders: {}};
//             let entry = Object.entries(vis.shaders).find((e, i) => i === idx);
//             if (entry) newVis.shaders[entry[0]] = newVis.shaders[entry[1]];
//             engine.addVisualization(newVis);
//         });
//
//         if (!this.uid) {
//             //enable on the source by overriding its member functions
//             this._bindToTiledImage(idx);
//         } else {
//             tiledImage.source._bridgeId = this.uid;
//             tiledImage.source.__cached_hasTransparency = tiledImage.source.hasTransparency;
//             tiledImage.source.hasTransparency = function(context2D, url, ajaxHeaders, post) {
//                 return true; //we always render transparent
//             }
//             tiledImage.__bridgeIndex = idx;
//         }
//     }
//
//     /**
//      * Remove TiledImage by it's index
//      * @param idx index of the tiled image to remove
//      */
//     removeLayer(idx) {
//         if (!this.uid) {
//             const source = this._unbindFromTiledSource(idx);
//             if (!source) {
//                 console.warn("Could not properly remove bindings on TiledImage index", idx);
//             }
//         } else {
//             let source = this._rendering[idx];
//             if (!source) {
//                 console.warn("Could not properly remove bindings on TiledImage index", idx);
//             } else {
//                 delete tiledImage.source._bridgeId;
//                 source.hasTransparency = source.__cached_hasTransparency;
//                 delete source.__cached_hasTransparency;
//                 delete source.__bridgeIndex;
//             }
//         }
//         delete this._rendering[idx];
//         //do not delete other lists since we keep them for the next layer set session
//     }
//
//     /**
//      * Enable binding of the renderer to OSD
//      */
//     enable() {
//         //this is just a placeholder, set on init(...)
//     }
//
//     /**
//      * Disable binding of the renderer to OSD
//      */
//     disable() {
//         //this is just a placeholder, set on init(...)
//     }
//
//     /**
//      * Check whether rendering is running
//      * @return {boolean} true if binding is active
//      */
//     disabled() {
//         return this._disabled;
//     }
//
//     /**
//      * Get Tiled Image instance that is being bound to the post-processing engine
//      * @param osdItemWorldIndex index of the image, or nothing - in that case first tiled image is returned
//      * @return {undefined|OpenSeadragon.TiledImage} tiled image
//      *
//      * todo problematic, now we have multiple tile images --> what about for each tiled image
//      */
//     getTiledImage(osdItemWorldIndex=-1) {
//         if (osdItemWorldIndex < 0) {
//             for (let key in this._rendering) {
//                 if (this._rendering[key]) return this._rendering[key];
//             }
//             return undefined;
//         }
//         return this._rendering[osdItemWorldIndex];
//     }
//
//     getWorldIndex() {
//         for (let key in this._rendering) {
//             if (this._rendering[key]) return key;
//         }
//         return -1;
//     }
//
//     /**
//      * Runs a callback on each visualization goal
//      * @param {function} call callback to perform on each visualization goal (its object given as the only parameter)
//      */
//     foreachVisualization(call) {
//         for (let engine of this.webGLEngineList) {
//             if (engine?.isPrepared) {
//                 engine.foreachVisualization(call);
//             }
//         }
//     }
//
//     /**
//      * Get a visualizaiton goal object
//      * @returns {object} a visualizaiton goal object
//      */
//     visualization(index=undefined) {
//         return this._visualizations(index || this.webGLEngine.currentVisualizationIndex());
//     }
//
//     /**
//      * Get the current visualizaiton goal index
//      * @returns {number} current visualizaiton goal index
//      */
//     currentVisualizationIndex() {
//         //same for all engines
//         //topdo engines have just one
//         return this.webGLEngine.currentVisualizationIndex();
//     }
//
//     /**
//      * Set program shaders. Just forwards the call to webGLEngine, for easier access.
//      * @param {object} visualization - objects that define the visualization (see Readme)
//      * @return {boolean} true if loaded successfully
//      */
//     addVisualization(...visualization) {
//         if (this.webGLEngine) {
//             console.warn("Invalid action: visualizations can be attached before layers are added only.");
//             return false;
//         }
//         this._visualizations.push(...visualization);
//     }
//
//     /**
//      * Set program data.
//      * @param {string} data - objects that define the visualization (see Readme)
//      * @return {boolean} true if loaded successfully
//      */
//     setData(...data) {
//         if (this.webGLEngine.isPrepared) {
//             console.warn("Invalid action: visualizations have been already loaded.");
//             return false;
//         }
//         this.imageData = data.length === 0 ? undefined : data;
//         return true;
//     }
//
//     /**
//      * Change visualization in use
//      * @param {number} visIdx index of the visualization
//      */
//     switchVisualization(visIdx) {
//         //todo inactive renderers?
//
//         //todo need to re-change layers
//
//         // for (let key in this.webGLEngineList) {
//         //     this.webGLEngineList[key].switchVisualization(visIdx);
//         // }
//     }
//
//     /**
//      * Make ViaWebGL download and prepare visualizations,
//      * called inside init() if not called manually before
//      * (sometimes it is good to start ASAP - more time to load before OSD starts drawing)
//      */
//     loadShaders(activeVisualizationIdx=0, onPrepared=function(){}) {
//         if (this.webGLEngine.isPrepared) {
//             onPrepared();
//             return;
//         }
//         let guard = this.webGLEngineList.length;
//         for (let engine of this.webGLEngineList) {
//             engine.prepare(this.imageData, () => {
//                 guard--;
//                 if (guard < 1) onPrepared();
//             }, activeVisualizationIdx);
//         }
//     }
//
//
//
//
//
//
//
//
//
//     with(index) {
//         this._activeIndex = index;
//         return this;
//     }
//
//
//     /**
//      * Reorder shader: will re-generate current visualization from dynamic data obtained from webGLEngine.shaderGenerator
//      * @param {array} order array of strings that refer to ID's in the visualization
//      *   data (e.g. pyramidal tiff paths in our case), first is rendered last (top)
//      */
//     reorder(order=undefined) {
//         //todo support? reorder in viewer?
//         //not supported for now
//         // if (!Array.isArray(order)) {
//         //     this.webGLEngine.rebuildVisualization(null);
//         // } else {
//         //     //webGLEngine rendering is first in order: first drawn, last in order: last drawn (atop)
//         //     this.webGLEngine.rebuildVisualization(order.reverse());
//         // }
//         this.redraw();
//     }
//
//     /**
//      * Get current timestamp
//      * @return {number}
//      */
//     get timeStamp() {
//         if (this._randomDelayList[this._activeIndex] < 1) return this._refreshTimeStampList[this._activeIndex];
//         return Math.random() * this._randomDelayList[this._activeIndex] + this._refreshTimeStampList[this._activeIndex];
//     }
//
//     /**
//      * Get next timestamp which is guaranteed to be higher than or equal to any
//      * timestamp set to processed entity
//      * @return {number}
//      */
//     get highestTimestamp() {
//         return this._refreshTimeStampList[this._activeIndex] + this._randomDelayList[this._activeIndex] + 10;
//     }
//
//     /**
//      * Invalidate all post-processed results, does not update/draw viewport
//      * @param {number} randomDelay - time in milliseconds, tile updates can randomly occur within randomDelay
//      *   note: it is not guaranteed to be updated, e.g. if you need to have ALL finished after
//      *   the time has elapsed, make sure to call draw() at the end (e.g. setTimer....)
//      */
//     invalidate(randomDelay=0) {
//         // Raise tstamp to force redraw
//         this._refreshTimeStampList[this._activeIndex] = Date.now();
//         this._randomDelayList[this._activeIndex] = Math.max(0, randomDelay);
//     }
//
//     /**
//      * Clear the canvas - necessary for transparent items to render correctly
//      *  - done automatically on shader render updates
//      */
//     clear() {
//         this.openSD.drawer._clear();
//         this.openSD.navigator.drawer._clear();
//     }
//
//     /**
//      * Draw/update viewport, does not invalidate last post-processed results
//      */
//     draw() {
//         this.openSD.world.draw();
//         this.openSD.navigator.world.draw();
//     }
//
//     /**
//      * Redraw the scene to reflect the latest visualization changes.
//      * @param {number} randomDelay - time in milliseconds, tile updates can randomly occur within randomDelay
//      *   note: viewport canvas is not guaranteed to be updated, e.g. if you need to have ALL
//      *   tiles updated after 'randomDelay', call draw() after the time has elapsed
//      */
//     redraw(randomDelay=0, index=undefined) {
//         if (index === undefined) {
//             for (let i = 0; i < this.webGLEngineList.length; i++) {
//                 this.with(i).invalidate(randomDelay);
//             }
//         } else {
//             this.with(index).invalidate(randomDelay);
//         }
//         this.draw();
//     }
//
//     /**
//      * Get IDS of data sources to be fetched from the server at the time
//      * @return {Array} array of keys from 'shaders' parameter of the current visualization goal
//      */
//     dataImageSources() {
//         return this.webGLEngineList.reduce((acc, item) => {
//             acc.push(...item.getSources());
//         }, []);
//     }
//
//     /**
//      * Get active shader index
//      * @return {number}
//      */
//     activeShaderIndex() {
//         return this.webGLEngine._program;
//     }
//
//     /**
//      * Access to webGL context
//      * @returns {WebGLRenderingContext|WebGLRenderingContext} context
//      */
//     GL(index=undefined) {
//         if (index === undefined) return this.webGLEngine.gl;
//         return this.webGLEngineList[index].gl;
//     }
//
//     /**
//      * Initialize the bridge between OSD and WebGL rendering once 'open' event happens
//      * unlike the WebGL's init() can (and should) be called immediately after preparation (loadShaders)
//      * - awaits the OSD opening
//      *
//      * @param {function} layerLoaded callback on load
//      * @param {number} withActiveIndex index of the visualization to load as first, default 0
//      * @return {OpenSeadragon.BridgeGL}
//      */
//     initBeforeOpen(layerLoaded=()=>{}, withActiveIndex=0) {
//         if (this.webGLEngine.isInitialized) return this;
//         this._initSelf();
//
//         let _this = this;
//         let handler = function(e) {
//             function init() {
//                 _this.webGLEngineList.forEach(e => e.init());
//                 layerLoaded();
//                 _this.openSD.removeHandler('open', handler);
//             }
//             _this.loadShaders(withActiveIndex, init);
//         };
//
//         this.openSD.addHandler('open', handler);
//         return this;
//     }
//
//     /**
//      * Initialize the bridge between OSD and WebGL immediately, loadShaders(...) must be called manually in this case.
//      * like the WebGL's init() must be called once WebGL.prepare() finished
//      */
//     initAfterOpen() {
//         if (this.webGLEngine.isInitialized) return this;
//         if (!this.webGLEngine.isPrepared) {
//             throw "BridgeGL::loadShaders() must be called before using initAfterOpen!";
//         }
//         this._initSelf();
//         this.webGLEngineList.forEach(e => e.init());
//         return this;
//     }
//
//     /**
//      * Reset the WebGL module, so that different initialization can be performed
//      */
//     reset() {
//         this.webGLEngineList.forEach(e => e.reset());
//     }
//
//     //////////////////////////////////////////////////////////////////////////////
//     ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
//     //////////////////////////////////////////////////////////////////////////////
//
//     _initSelf() {
//         //if not set manually
//         if (!this.imagePixelSizeOnScreen) {
//             //if we have OSD TOOLs to-be plugin (?), use it
//             if (this.openSD.hasOwnProperty("tools")) {
//                 this.imagePixelSizeOnScreen =
//                     this.openSD.scalebar.imagePixelSizeOnScreen.bind(this.openSD.scalebar);
//             } else {
//                 //just some placeholder
//                 console.error("OpenSeadragon has no Tool extension with 'imagePixelSizeOnScreen' function and this " +
//                     "function was not assigned to the bridge instance: pixel ratio difference will be always 1.");
//                 this.imagePixelSizeOnScreen = _ => 1;
//             }
//         }
//
//         if (this._initBounded) return;
//         this.loadShaders(0, this._initFinish.bind(this)); //just to be safe, should be already loaded at this time, consider throwing instead
//     }
//
//     _initFinish() {
//         //This can be performed only once for now, mode of execution cannot be changed after init(...)
//         this._initBounded = true;
//         if (this.uid) { //not a cached version, uses events to evaluate on all tiles
//             let tileLoaded = this._tileLoaded.bind(this);
//             let tileDrawing = this._tileDrawing.bind(this);
//
//             this.enable = function() {
//                 if (!this._disabled) return;
//                 this._disabled = false;
//                 this.openSD.addHandler('tile-drawing', tileDrawing);
//                 this.openSD.addHandler('tile-loaded', tileLoaded);
//                 this.openSD.navigator.addHandler('tile-drawing', tileDrawing);
//                 this.openSD.navigator.addHandler('tile-loaded', tileLoaded);
//             };
//
//             this.disable = function() {
//                 if (this._disabled) return;
//                 this._disabled = true;
//                 this.openSD.removeHandler('tile-drawing', tileDrawing);
//                 this.openSD.removeHandler('tile-loaded', tileLoaded);
//                 this.openSD.navigator.removeHandler('tile-drawing', tileDrawing);
//                 this.openSD.navigator.removeHandler('tile-loaded', tileLoaded);
//             };
//             this.enable();
//         } else { //cached version, overrides the TileSource API to customize cache creation
//             this.enable = function(index=-1) {
//                 if (!this._disabled) return;
//
//                 for (let idx in this._rendering) {
//                     if (this._rendering[idx]) this._bindToTiledImage(idx);
//                 }
//                 this._disabled = false;
//             };
//
//             this.disable = function(index=-1) {
//                 if (this._disabled) return;
//
//                 for (let idx in this._rendering) {
//                     if (this._rendering[idx]) this._unbindFromTiledSource(idx);
//                 }
//                 this._disabled = true;
//             };
//             this._disabled = false;
//         }
//     }
//
//     /************** EVENT STRATEGY ******************/
//
//     _tileLoaded(e) {
//         if (! e.data) return;
//
//         if (this.uid === e.tiledImage.source._bridgeId && !e.tile.webglId) {
//             e.tile.webglId = this.uid;
//             //will draw immediatelly
//             e.tile.webglRefresh = 0;
//             //we set context2D manually, the cache is NOT created
//             e.tile.__data = e.data;
//             //necessary, the tile is re-drawn upon re-zooming, store the output
//             let canvas = document.createElement('canvas');
//             canvas.width = e.tile.sourceBounds.width;
//             canvas.height = e.tile.sourceBounds.height;
//             e.tile.context2D = canvas.getContext('2d');
//         }
//     }
//
//     _tileDrawing(e) {
//         if (e.tile.webglId === this.uid && e.tile.webglRefresh <= this.with(index).timeStamp) {
//             e.tile.webglRefresh = this.with(index).highestTimestamp;
//
//             const idx = e.tiledImage.__bridgeIndex;
//             const engine = this.webGLEngineList[idx];
//
//             //noop if equal
//             engine.setDimensions(e.tile.sourceBounds.width, e.tile.sourceBounds.height);
//             let imageData = e.tile.__data;
//             // Render a webGL canvas to an input canvas using cached version
//             let output = engine.processImage(imageData, e.tile.sourceBounds,
//                 this.openSD.viewport.getZoom(), this.imagePixelSizeOnScreen());
//
//             // Note: you can comment out clearing if you don't use transparency
//             e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
//             e.rendered.drawImage(output == null? imageData : output, 0, 0,
//                 e.tile.sourceBounds.width, e.tile.sourceBounds.height);
//         }
//     }
//
//     /************** BINDING (CACHE) STRATEGY ******************/
//
//     _bindToTiledImage(index) {
//         const _context = this,
//             layer = this._rendering[index],
//             source = layer.source;
//
//         //necessary to modify hash key so as to force the viewer download the image twice
//         source.__cached_getTileHashKey = source.getTileHashKey;
//         source.getTileHashKey = function(level, x, y, url, ajaxHeaders, postData) {
//             return source.__cached_getTileHashKey(level, x, y, url, ajaxHeaders, postData) + "_webgl";
//         };
//
//         source.__cached_createTileCache = source.createTileCache;
//         source.createTileCache = function(cache, data, tile) {
//             cache._data = data;
//             cache._dim = tile.sourceBounds;
//             cache._dim.width = Math.max(cache._dim.width,1);
//             cache._dim.height = Math.max(cache._dim.height,1);
//             cache._engine = _context.webGLEngineList[index];
//         };
//
//         source.__cached_destroyTileCache = source.destroyTileCache;
//         source.destroyTileCache = function(cache) {
//             delete cache._data;
//             delete cache._engine;
//             delete cache._renderedContext;
//             delete cache._dim;
//         };
//
//         source.__cached_getTileCacheData = source.getTileCacheData;
//         source.getTileCacheData = function(cache) {
//             return cache._data;
//         };
//
//         source.__cached_hasTransparency = source.hasTransparency;
//         source.hasTransparency = function(context2D, url, ajaxHeaders, post) {
//             return true;
//         };
//
//         source.__cached_tileDataToIamge = source.getTileCacheDataAsImage;
//         source.getTileCacheDataAsImage = function(cache) {
//             throw "WebGL Postprocessing works only with canvasses for now!";
//         };
//
//         source.__cached_tileDataToRenderedContext = source.getTileCacheDataAsContext2D;
//         source.getTileCacheDataAsContext2D = function(cache) {
//             if (!cache._renderedContext) {
//                 cache.webglRefresh = 0;
//                 var canvas = document.createElement('canvas');
//                 canvas.width = cache._dim.width;
//                 canvas.height = cache._dim.height;
//                 cache._renderedContext = canvas.getContext('2d');
//             }
//
//             if (cache.webglRefresh <= _context.with(index).timeStamp) {
//                 cache.webglRefresh = _context.with(index).highestTimestamp;
//
//
//                 //noop if equal
//                 cache._engine.setDimensions(cache._dim.width, cache._dim.height);
//                 // Render a webGL canvas to an input canvas using cached version
//                 const output = cache._engine.processImage(cache._data, cache._dim,
//                     _context.openSD.viewport.getZoom(), _context.imagePixelSizeOnScreen());
//
//                 // Note: you can comment out clearing if you don't use transparency
//                 cache._renderedContext.clearRect(0, 0, cache._dim.width, cache._dim.height);
//                 cache._renderedContext.drawImage(output == null ? cache._data : output, 0, 0,
//                     cache._dim.width, cache._dim.height);
//             }
//             return cache._renderedContext;
//         };
//     }
//
//     _unbindFromTiledSource(index) {
//         let source = this._rendering[index];
//         if (!source || !source.source) return;
//         source = source.source;
//         source.hasTransparency = source.__cached_hasTransparency;
//         delete source.__cached_hasTransparency;
//         source.createTileCache = source.__cached_createTileCache;
//         delete source.__cached_createTileCache;
//         source.destroyTileCache = source.__cached_destroyTileCache;
//         delete source.__cached_destroyTileCache;
//         source.getTileCacheData = source.__cached_getTileCacheData;
//         delete source.__cached_getTileCacheData;
//         source.getTileCacheDataAsImage = source.__cached_tileDataToIamge;
//         delete source.__cached_tileDataToIamge;
//         source.getTileCacheDataAsContext2D = source.__cached_tileDataToRenderedContext;
//         delete source.__cached_tileDataToRenderedContext;
//         source.getTileHashKey = source.__cached_getTileHashKey;
//         delete source.__cached_getTileHashKey;
//         return source;
//     }
//
// }
