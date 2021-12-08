/*
* Bridge between WebGLWrapper and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Based on OpenSeadragonGL plugin
* https://github.com/thejohnhoffer/viaWebGL
*
* TODO: THIS is probably going to be a OSD drawing strategy class..
*  merge this class into webglWrapper
*
*/

//todo layerIndex replace with tileSource itself
OpenSeadragonGL = function(webGLWrapperParams, useEvaluator) {
    let _this  = this;
    webGLWrapperParams.resetCallback = function () {
        _this.redraw(layerIndex);
    }

    this.refresh = -1;

    this.webGLWrapper = new WebGLWrapper(webGLWrapperParams);
    this.upToDateTStamp = Date.now();
    this._shadersLoaded = false;

    //todo instead bind this to specific drawing policy on a tilesource
    this.useEvaluator = useEvaluator;
};

OpenSeadragonGL.prototype = {

    setLayerIndex: function(idx) {
        this.refresh = idx;
    },
    
    /**
     * Runs a callback on each visualisation goal
     * @param {function} call callback to perform on each visualisation goal (its object given as the only parameter)
     */
    foreachVisualisation: function(call) {
        this.webGLWrapper.foreachVisualisation(call);
    },

    /**
     * Get the current visualisaiton goal object
     * @returns current visualisaiton goal object
     */
    currentVisualisation: function() {
        return this.webGLWrapper.currentVisualisation();
    },
    
    /**
     * Set program shaders. Just forwards the call to webGLWrapper, for easier access.
     * @param {object} visualisation - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addVisualisation: function(...visualisation) {
        if (this._shadersLoaded) {
            console.warn("Invalid action: visualisations have been already loaded.")
            return false;
        }
        return this.webGLWrapper.addVisualisation(...visualisation);
    },

    /**
     * Set program data.
     * @param {string} data - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addData: function(...data) {
        if (this._shadersLoaded) {
            console.warn("Invalid action: visualisations have been already loaded.")
            return false;
        }
        this.webGLWrapper.addData(...data);
        return true;
    },

    /**
     * Change visualisation in use
     * @param {number} visIdx index of the visualisation
     */
    switchVisualisation: function(visIdx) {
        this.webGLWrapper.switchVisualisation(visIdx);
    },

    /**
     * Make ViaWebGL download and prepare visualisations,
     * called inside init() if not called manually before
     * (sometimes it is good to start ASAP - more time to load before OSD starts drawing)
     */
    loadShaders: function(onPrepared=function(){}) {
        if (this._shadersLoaded) return;
        this.webGLWrapper.prepare(onPrepared);
        this._shadersLoaded = true;
    },

    /**
     * Reorder shader: will re-generate current visualisation from dynamic data obtained from webGLWrapper.shaderGenerator
     * @param {array} order array of strings that refer to ID's in the visualisation data (pyramidal tiff paths in our case)
     */
    reorder: function(order) {
        if (!Array.isArray(order)) {
            this.webGLWrapper.rebuildVisualisation(null);
        } else {
            //webGLWrapper rendering is first in order: first drawn, last in order: last drawn (atop)
            this.webGLWrapper.rebuildVisualisation(order.reverse());
        }
        this.redraw();
    },

    /**
     * TODO bad design
     * Redraw the scene using cached images.
     */
    redraw: function() {
        var imageTile = this.openSD.world.getItemAt(this.refresh);

        if (!imageTile) {
            alert("The layer data is not available. This error user notification will be implemented later.");
            return;
            //todo somehow notify the user that the data is missing...
        }

        // Raise tstamp to force redraw
        this.upToDateTStamp = Date.now();

        imageTile._drawer.context.clearRect(0, 0, imageTile._drawer.context.canvas.width, imageTile._drawer.context.canvas.height);

        let imageTileNav = this.openSD.navigator.world.getItemAt(this.refresh);
        imageTileNav._drawer.context.clearRect(0, 0, imageTileNav._drawer.context.canvas.width, imageTileNav._drawer.context.canvas.height);

        this.openSD.world.draw();
        this.openSD.navigator.world.draw();
    },

    /**
     * Get IDS of data sources to be fetched from the server at the time
     * @return {Array} array of keys from 'shaders' parameter of the current visualisation goal
     */
    dataImageSources: function() {
        return this.webGLWrapper.getSources();
    },

    activeShaderIndex: function() {
        return this.webGLWrapper._program;
    },

    /**
     * Access to webGL context
     * @returns webGL context
     */
    GL: function() {
        return this.webGLWrapper.gl;
    },

    // Add your own button to OSD controls
    button: function(terms) {
        var name = terms.name || 'tool';
        var prefix = terms.prefix || this.openSD.prefixUrl;
        if (!terms.hasOwnProperty('onClick')){
            console.error("The specified button does not have 'onClick' property and will do nothing. Removed.")
            return;
        }
        terms.onClick = terms.onClick.bind(this);
        terms.srcRest = terms.srcRest || prefix+name+'_rest.png';
        terms.srcHover = terms.srcHover || prefix+name+'_hover.png';
        terms.srcDown = terms.srcDown || prefix+name+'_pressed.png';
        terms.srcGroup = terms.srcGroup || prefix+name+'_grouphover.png';
        // Replace the current controls with the same controls plus a new button
        this.openSD.clearControls().buttons.buttons.push(new OpenSeadragon.Button(terms));
        var toolbar = new OpenSeadragon.ButtonGroup({buttons: this.openSD.buttons.buttons});
        this.openSD.addControl(toolbar.element,{anchor: OpenSeadragon.ControlAnchor.TOP_LEFT});
    },        

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////


    init: function(openSeaDragonInstance) {  
        this.openSD = openSeaDragonInstance;
        if (!this._shadersLoaded) {
            this.loadShaders();
        }
    
        var tileLoaded = this._tileLoaded.bind(this);
        var tileDrawing = this._tileDrawing.bind(this);

        this.openSD.addHandler('tile-drawing', tileDrawing);
        this.openSD.addHandler('tile-loaded', tileLoaded);

        this.openSD.navigator.addHandler('tile-drawing', tileDrawing);
        this.openSD.navigator.addHandler('tile-loaded', tileLoaded);
         
        let _this = this;
        this.openSD.addHandler('open', function(e) {
            _this.webGLWrapper.init(_this.openSD.source.getTileWidth(),_this.openSD.source.getTileWidth());
        });
 
        return this;
    },

    _tileLoaded: function(e) {

        if (! e.image) return;

        if (!this.useEvaluator || this.useEvaluator(e)) {
            e.tile.webglRefresh = 0; // -> will draw immediatelly
            e.tile.origData = e.image;    
            
            //necessary, the tile is re-drawn upon re-zooming, store the output
            var canvas = document.createElement( 'canvas' )
            canvas.width = e.tile.sourceBounds.width;
            canvas.height = e.tile.sourceBounds.height; 
            e.tile.context2D = canvas.getContext('2d');
            delete e.image;
        }
    },

    _tileDrawing: function(e) {
        if (e.tile.webglRefresh <= this.upToDateTStamp) {
            e.tile.webglRefresh = this.upToDateTStamp + 1;


            let imageTileSource = PLUGINS.imageLayer();
            let dx = imageTileSource.imageToWindowCoordinates(new OpenSeadragon.Point(1, 0)).x -
                imageTileSource.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0)).x;

            // Render a webGL canvas to an input canvas using cached version

            var output = this.webGLWrapper.processImage(e.tile.origData, e.tile.sourceBounds, this.openSD.viewport.getZoom(), dx);

            // Note: you can comment out clearing if you don't use transparency 
            e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            e.rendered.drawImage(output == null? e.tile.origData : output, 0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
        }
    }
}
