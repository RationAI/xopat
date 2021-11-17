/*
* Bridge between WebGLWrapper and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Based on OpenSeadragonGL plugin
* https://github.com/thejohnhoffer/viaWebGL
*
* TODO: merge this class into webglWrapper
*
*/


OpenSeadragonGL = function(webGLWrapperParams) {
    this.webGLWrapper = new WebGLWrapper(webGLWrapperParams);
    this.upToDateTStamp = Date.now();
    this._shadersLoaded = false;
};

OpenSeadragonGL.prototype = {
    
    /**
     * Runs a callback on each visualisation goal
     * @param {function} call callback to perform on each visualisation goal (its object given as the only parameter)
     */
    foreachVisualisation: function(call) {
        this.webGLWrapper._visualisations.forEach(vis => {
            call(vis);
        });
    },

    /**
     * Get the current visualisaiton goal object
     * @returns current visualisaiton goal object
     */
    currentVisualisation: function() {
        return this.webGLWrapper._visualisations[this.webGLWrapper._program];
    },
    
    /**
     * Set program shaders. Just forwards the call to webGLWrapper, for easier access.
     * @param {string} visualisation program fragment shaders components
     * @return {boolean} true if loaded successfully
     */
    setVisualisation: function(visualisation) {
        if (this._shadersLoaded) {
            console.warn("Invalid action: visualisations have been already loaded.")
            return false;
        }
        return this.webGLWrapper.setVisualisation(visualisation);
    },

    /**
     * Import JSON encoded visualisation parameter, as described in the documentation
     * @param json
     * @return {boolean} true if loaded successfully
     */
    importSettings(json) {
        try {
            let result = true;
            let setup = JSON.parse(json);
            if (Array.isArray(setup)) {
                for (let idx in setup) {
                    result &= this.setVisualisation(setup[i]);
                }
            } else {
                console.warn("Invalid input: parameter visualisation must be an array of objects.");
                return false;
            }
            return result;
        } catch (e) {
            console.warn("Invalid input for visualisation settings.", e);
            return false;
        }
    },

    /**
     * Export JSON-encoded visualisation with all changes
     * that has been made, the visualiser can be initialized
     * with
     * @return JSON-encoded string
     */
    exportSettings() {
        return this.webGLWrapper.exportSettings();
    },

    /**
     * Change visualisation in use
     * @param {integer} visIdx index of the visualisation 
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
    reorder: function(order = null) {
        if (!Array.isArray(order)) {
            this.webGLWrapper.rebuildVisualisation(null);
        } else {
            //webGLWrapper rendering is first in order: first drawn, last in order: last drawn (atop)
            this.webGLWrapper.rebuildVisualisation(order.reverse());
        }
    },

    /**
     * TODO bad design
     * Redraw the scene using cached images.
     * @param {World} world - openSeadragon world instance
     * @param idx index that is being redrawn
     */
    redraw: function(world, idx) {
        var imageTile = world.getItemAt(idx);

        if (!imageTile) {
            alert("The layer data is not available. This error user notification will be implemented later.");
            return;
            //todo somehow notify the user that the data is missing...
        }

        // Raise tstamp to force redraw
        this.upToDateTStamp = Date.now();

        imageTile._drawer.context.clearRect(0, 0, imageTile._drawer.context.canvas.width, imageTile._drawer.context.canvas.height);

        var imageTileNav = this.openSD.navigator.world.getItemAt(idx);
        imageTileNav._drawer.context.clearRect(0, 0, imageTileNav._drawer.context.canvas.width, imageTileNav._drawer.context.canvas.height);

        world.draw();
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
        if (this.webGLWrapper.willUseWebGL(e.image, e)) {
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

            // Render a webGL canvas to an input canvas using cached version
            var output = this.webGLWrapper.toCanvas(e.tile.origData, e);

            // Note: you can comment out clearing if you don't use transparency 
            e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            e.rendered.drawImage(output == null? e.tile.origData : output, 0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
        }
    }
}
