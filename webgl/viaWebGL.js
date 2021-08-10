/*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~
/* viaWebGL
/* Set shaders on Image or Canvas with WebGL
/* Built on 2016-9-9
/* http://via.hoff.in
/*
/* CHANGES MADE BY
/* Jiří Horák, 2021
*/
ViaWebGL = function(incoming) {

    /* Custom WebGL API calls
    ~*~*~*~*~*~*~*~*~*~*~*~*/
    this['gl-drawing'] = function(e) { return e; };
    this['gl-loaded'] = function(e) { return e; };
    this.ready = function(e) { return e; };

    var gl = this.maker();
    this.flat = document.createElement('canvas').getContext('2d');
    this.tile_size = 'u_tile_size';

    // Private shader management
    this._shaders = [];
    this._programs = [];
    this._program = -1;

    this.wrap = gl.CLAMP_TO_EDGE;
    this.tile_pos = 'a_tile_pos';
    this.filter = gl.NEAREST;
    this.pos = 'a_pos';
    this.height = 128;
    this.width = 128;
    this.on = 0;
    this.gl = gl;
    
    // Assign from incoming terms
    for (var key in incoming) {
        this[key] = incoming[key];
    }
};

ViaWebGL.prototype = {
    /**
     * Set program shaders.
     * @param {string} vertexShader program vertex shader, recommended is to use the same one
     *  for all programs but if you need different...
     * @param {string} fragmentShader program fragment shader
     */
    setShaders: function(vertexShader, fragmentShader) {
        this._shaders.push(vertexShader);
        this._shaders.push(fragmentShader);
    },     

    /**
     * Switch to program at index: this is the index (order) in which
     * setShaders(...) was called. If you want to switch to shader that
     * has been set with second setShaders(...) call, pass i=1.
     * @param {integer} i program index
     */
    switchShader: function(i) {
        if (this._program == i) return;
        this.forceSwitchShader(i);
    },
    
    /**
     * Force switch shader (program), will reset even if the specified
     * program is currently active, good if you need 'gl-loaded' to be
     * invoked (e.g. some uniform variables changed)
     * @param {integer} i program index
     */
    forceSwitchShader: function(i) {
        if (i >= this._programs.length) {
            console.error("Invalid shader index.");
        } else {
            this.toBuffers(this._programs[i]);
        }   
        this._program = i;
    },
    
    /**
     * Change the dimensions, useful for borders, used by openSeadragonGL
     * @param {integer} width 
     * @param {integer} height 
     */
    setDimensions: function(width, height) {
        this.gl.canvas.width = width;
        this.gl.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    },

    /////////////////////////////////////////////////////////////////////////////////////
    //// YOU PROBABLY WANT TO READ FUNCTIONS BELOW SO YOU KNOW HOW TO SET UP YOUR SHADERS
    //// BUT YOU SHOULD NOT CALL THEM DIRECTLY
    /////////////////////////////////////////////////////////////////////////////////////

    // Setup program variables, each program has at least:

    // FRAGMENT SHADER
    //      precision mediump float;
    //      uniform sampler2D u_tile;
    //      uniform vec2 u_tile_size;
    //      varying vec2 v_tile_pos;
    // VERTEX SHADER (ommited, you probably don't want to touch that shader anyway)
    toBuffers: function(program) {

        // Allow for custom loading
        this.gl.useProgram(program);
        this['gl-loaded'].call(this, program, this.gl);

        // Unchangeable square array buffer fills viewport with texture
        var boxes = [[-1, 1,-1,-1, 1, 1, 1,-1], [0, 1, 0, 0, 1, 1, 1, 0]];
        var buffer = new Float32Array([].concat.apply([], boxes));
        var bytes = buffer.BYTES_PER_ELEMENT;
        var gl = this.gl;
        var count = 4;

        // Get uniform term
        var tile_size = gl.getUniformLocation(program, this.tile_size);
        gl.uniform2f(tile_size, gl.canvas.height, gl.canvas.width);

        // Get attribute terms
        this.att = [this.pos, this.tile_pos].map(function(name, number) {

            var index = Math.min(number, boxes.length-1);
            var vec = Math.floor(boxes[index].length/count);
            var vertex = gl.getAttribLocation(program, name);

            return [vertex, vec, gl.FLOAT, 0, vec*bytes, count*index*vec*bytes];
        });
        // Get texture
        this.tex = {
            texParameteri: [
                [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrap],
                [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrap],
                [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter],
                [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter]
            ],
            texImage2D: [gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE],
            bindTexture: [gl.TEXTURE_2D, gl.createTexture()],
            drawArrays: [gl.TRIANGLE_STRIP, 0, count],
            pixelStorei: [gl.UNPACK_FLIP_Y_WEBGL, 1]
        };
        // Build the position and texture buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    },
    
    // Renders canvas using webGL
    // accepts image data to draw (tile) and source (string, origin of the tile)
    //
    // returns canvas if webGL was used, null otherwise
    toCanvas: function(tile, e) {
    
        // Allow for custom drawing in webGL and possibly avoid using webGL at all
        // TODO move this functionality to tile-loaded to decide once! (but what about canMixShaders? it is important there)
        if (! this['gl-drawing'].call(this, tile, e)) {
            return null;
        }

        var gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);  

        // Set Attributes for GLSL
        this.att.map(function(x){
            gl.enableVertexAttribArray(x.slice(0,1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        // Set Texture for GLSL
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture.apply(gl, this.tex.bindTexture);
        gl.pixelStorei.apply(gl, this.tex.pixelStorei);

        // Apply texture parameters
        this.tex.texParameteri.map(function(x){
            gl.texParameteri.apply(gl, x);
        });
        // Send the tile into the texture.
        var output = this.tex.texImage2D.concat([tile]);
        gl.texImage2D.apply(gl, output);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this.tex.drawArrays);

        // Apply to container if needed
        if (this.container) {
            this.container.appendChild(this.gl.canvas);
        }
        return this.gl.canvas;
    },

    // Run handler only to decide whether particular tile uses openGL
    willUseCanvas: function(tile, e) {
        return this['gl-drawing'].call(this, tile, e);
    },

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    // Initialize viaGL
    init: function() {
        if (this._shaders.length < 2) {
            console.error("No shaders specified!");
            return;
        }

        // Allow for mouse actions on click
        if (this.hasOwnProperty('container') && this.hasOwnProperty('onclick')) {
            this.container.onclick = this[this.onclick].bind(this);
        }

        this.setDimensions(this.width, this.height);

        // Load the shaders when ready and return the promise
        var step = [this._shaders.map(this.getter)];
        step.push(this.toProgram.bind(this), this.toBuffers.bind(this));
        return Promise.all(step[0]).then(step[1]).then(step[2]).then(this.ready);
    },
    // Make a canvas
    maker: function(options){
        return this.context(document.createElement('canvas'));
    },
    context: function(a){
        return a.getContext('experimental-webgl', { premultipliedAlpha: false,  alpha: true }) 
                || a.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    },
    // Get a file as a promise
    getter: function(where) {
        return new Promise(function(done){
            // Return if not a valid filename
            if (where.slice(-4) != 'glsl') {
                return done(where);
            }
            var bid = new XMLHttpRequest();
            var win = function(){
                if (bid.status == 200) {
                    return done(bid.response);
                }
                return done(where);
            };
            bid.open('GET', where, true);
            bid.onerror = bid.onload = win;
            bid.send();
        });
    },
    // Link shaders from strings
    toProgram: function(files) {
        
        var gl = this.gl;
        var ok = function(kind,status,value,sh) {
            if (!gl['get'+kind+'Parameter'](value, gl[status+'_STATUS'])){
                console.log((sh||'LINK')+':\n'+gl['get'+kind+'InfoLog'](value));
            }
            return value;
        }

        // Load multiple shaders
        for (let i = 0; i < files.length; i += 2) {        
            let program = gl.createProgram();
            for (let shId = 0; shId < 2; shId += 1) {
                //we saved odd positions vertex, even positions fragment shaders
                var sh = ['VERTEX_SHADER', 'FRAGMENT_SHADER'][shId]; 
                var shader = gl.createShader(gl[sh]);
                gl.shaderSource(shader, files[i+shId]);
                gl.compileShader(shader);
                gl.attachShader(program, shader);
                ok('Shader','COMPILE',shader,sh);
            }
            
            gl.linkProgram(program);
            this._programs.push(program);
        }  
        //default program is the first one      
        return ok('Program','LINK',this._programs[0]);
    },
}