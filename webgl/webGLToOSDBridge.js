/*
* Bridge between WebGLWrapper and OSD. Registers appropriate callbacks.
* Written by Jiří Horák, 2021
*
* Based on OpenSeadragonGL plugin
* https://github.com/thejohnhoffer/viaWebGL
*/


openSeadragonGL = function(webGLWrapperParams) {
    this.webGLWrapper = new WebGLWrapper(webGLWrapperParams);
    this.upToDateTStamp = Date.now();
    this._shadersLoaded = false;
};

openSeadragonGL.prototype = {
    
    foreachVisualisation: function(call) {
        this.webGLWrapper._visualisations.forEach(vis => {
            call(vis);
        });
    },

    currentVisualisation: function() {
        return this.webGLWrapper._visualisations[this.webGLWrapper._program];
    },
    
    /**
     * Set program shaders. Just forwards the call to webGLWrapper, for easier access.
     * @param {string} visualisation program fragment shaders components
     */
    setVisualisation: function(visualisation) {
        if (this._shadersLoaded) {
            console.warn("Invalid action: visualisation has been already loaded.")
            return;
        }

        this.webGLWrapper.setVisualisation(visualisation);
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
     * @param {array} order array of strings that refer to ID's in the visualisation data
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
     * Redraw the scene using cached images.
     * @param {World} world - openSeadragon world instance
     */
    redraw: function(world, idx) {
        var imageTile = world.getItemAt(idx);

        // Raise tstamp to force redraw
        this.upToDateTStamp = Date.now();

        imageTile._drawer.context.clearRect(0, 0, imageTile._drawer.context.canvas.width, imageTile._drawer.context.canvas.height);
        console.log(this.openSD.navigator);

        var imageTileNav = this.openSD.navigator.world.getItemAt(idx);
        imageTileNav._drawer.context.clearRect(0, 0, imageTileNav._drawer.context.canvas.width, imageTileNav._drawer.context.canvas.height);

        world.draw();
        this.openSD.navigator.world.draw();
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
            
            //necessary, the tile might be re-drawn upon re-zooming
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
    },


    // Possible solution to not to store the webGL output at all but to always generate it
    // Contains 
    _tileLoaded2: function(e) {
        if (! e.image) return;
        if (this.webGLWrapper.willUseWebGL(e.image, e)) {
            e.tile.origData = e.image;    
            e.tile.context2D = this.webGLWrapper.gl;
            delete e.image;
        }
    },

    _tileDrawing2: function(e) {
        this.webGLWrapper.toCanvas(e.tile.origData, e);
    }
}
