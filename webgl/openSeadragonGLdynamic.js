/*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~
/* openSeadragonGL - Set Shaders in OpenSeaDragon with viaWebGL
/*
/* CHANGES MADE BY
/* Jiří Horák, 2021
*/
openSeadragonGL = function(openSD, viaGLParams) {

    /* OpenSeaDragon API calls
    ~*~*~*~*~*~*~*~*~*~*~*~*/
    this.interface = {
        //note: does not support switching off (e.g. if shader was used and suddenly it is switched off, it will break)
        'tile-loaded': function(e) { 
            if (! e.image) return;
            
            if (this.viaGL.willUseCanvas(e.image, e)) {
                e.tile.webglRefresh = 0; // -> will draw immediatelly
                e.tile.origData = e.image;      
                var canvas = document.createElement( 'canvas' )
                canvas.width = e.tile.sourceBounds.width;
                canvas.height = e.tile.sourceBounds.height; 
                e.tile.context2D = canvas.getContext('2d');
                delete e.image;
            }
        }
    };
    this.defaults = {
        'tile-loaded': function(callback, e) {
            callback(e);
        }
    };

    this.openSD = openSD;
    this.viaGL = new ViaWebGL(viaGLParams);
    this.upToDateTStamp = Date.now();
};

openSeadragonGL.prototype = {
    
    foreachVisualisation: function(call) {
        this.viaGL._visualisations.forEach(vis => {
            call(vis);
        });
    },

    currentVisualisation: function() {
        return this.viaGL._visualisations[this.viaGL._program];
    },
    
    /**
     * Set program shaders. Just forwards the call to viaGL, for easier access.
     * @param {string} visualisation program fragment shaders components
     */
    setVisualisation: function(visualisation) {
        this.viaGL.setVisualisation(visualisation);
    },

    /**
     * Change visualisation in use
     * @param {integer} visIdx index of the visualisation 
     */
    switchVisualisation: function(visIdx) {
        this.viaGL.switchVisualisation(visIdx);
    },

    /**
     * Reorder shader: will re-generate current visualisation from dynamic data obtained from viaGL.shaderGenerator
     * @param {array} order array of strings that refer to ID's in the visualisation data
     */
    reorder: function(order = null) {
        if (!Array.isArray(order)) {
            this.viaGL.rebuildVisualisation(null);
        } else {
            //viaGL rendering is first in order: first drawn, last in order: last drawn (atop)
            this.viaGL.rebuildVisualisation(order.reverse());
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
        world.draw();
    },

    /**
     * Access to webGL context
     * @returns webGL context
     */
    GL: function() {
        return this.viaGL.gl;
    },

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    // Map to viaWebGL and openSeadragon
    init: function() {
        // Instead of choosing loaded/drawing, always use loaded
        this.addHandler('tile-loaded');

        var open = this.merger.bind(this);
        this.openSD.addHandler('open',open);
        return this;
    },
    // User adds events
    addHandler: function(key,custom) {
        if (key in this.defaults){
            this[key] = this.defaults[key];
        }
        if (typeof custom === 'function') {
            this[key] = custom;
        }
    },

    // Merge with viaGL
    merger: function(e) {
        // Take GL height and width from OpenSeaDragon
        this.width = this.openSD.source.getTileWidth();
        this.height = this.openSD.source.getTileHeight();
        // Add all viaWebGL properties
        for (var key of this.and(this.viaGL)) {
            this.viaGL[key] = this[key];
        }
        this.viaGL.init().then(this.adder.bind(this));
    },
    // Add all seadragon properties
    adder: function(e) {
        for (var key of this.and(this.defaults)) {
            var handler = this[key].bind(this);
            var interface = this.interface[key].bind(this);
            // Add all openSeadragon event handlers

            //todo fix?
            this.openSD.addHandler(key, function(e) {
                handler.call(this, interface, e);
            });
        }

        //hardcoded handler for re-drawing elements from cache
        var cacheHandler = function(e) {
            if (e.tile.webglRefresh <= this.upToDateTStamp) {
                e.tile.webglRefresh = this.upToDateTStamp + 1;

                // Render a webGL canvas to an input canvas using cached version
                var output = this.viaGL.toCanvas(e.tile.origData, e);
        
                // Note: you can comment out clearing if you don't use transparency 
                e.rendered.clearRect(0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
                e.rendered.drawImage(output == null? e.tile.origData : output, 0, 0, e.tile.sourceBounds.width, e.tile.sourceBounds.height);
            }
        }.bind(this);
        this.openSD.addHandler('tile-drawing', cacheHandler);
    },

    // Joint keys
    and: function(obj) {
      return Object.keys(obj).filter(Object.hasOwnProperty,this);
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
    }
}
