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
    
    //default calls
    this.onFatalError = function(vis) {
        console.error(vis["error"], vis["desc"]);
    }
    this.htmlShaderPartHeader = function(key, data, isVisible) {
        return `<div class="configurable-border"><div class="shader-part-name">${key}</div>${data[key]["html"]}</div>`;
    }
    this.ready = function() { };

    //default values that might come from options and be overwritten later
    this.jsGlLoadedCall = "viaGlLoadedCall";
    this.jsGlDrawingCall = "viaGlDrawingCall";

    var gl = this.maker();
    this.running = true;
    this.tile_size = 'u_tile_size';

    // Private shader management
    this._visualisations = [];
    
    this._textures = [];
    this._programs = [];
    this._program = -1;
    this._texture_names = [];
    this._initialized = false;
    this._cache = [];

    this.wrap = gl.CLAMP_TO_EDGE;
    this.tile_pos = 'a_tile_pos';
    this.filter = gl.NEAREST;
    this.pos = 'a_pos';
    this.height = 128;
    this.width = 128;
    this.on = 0;
    this.gl = gl;
    // maximum textures applied at once: how many different layers are supported
    this.max_textures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    
    this.gl_loaded = function (program, gl) {
        //call pre-defined name of
        this._callString(this.jsGlLoadedCall, program, gl);
    };
  
    this.gl_drawing = function (tile, e) {
        this._callString(this.jsGlDrawingCall, gl, e);
        //use shaders only for certain tile source
        //todo make this more elegant (move decision into osdGL script)
        return e.tiledImage.source.tilesUrl.indexOf(urlImage) === -1; //use webGL if not urlImage source
    };

    // Assign from incoming terms
    for (var key in incoming) {
        this[key] = incoming[key];
    }

    this.texture.init(gl, this.max_textures);
};

ViaWebGL.prototype = {
    /**
     * Set program shaders. Vertex shader is set by default a square.
     * @param {object} visualisation visualisation setup
     */
    setVisualisation: function(visualisation) {
        visualisation.url = this.shaderGenerator;
        this._visualisations.push(visualisation);
    }, 

    /**
     * Rebuild visualisation and update scene
     * @param {array} order order in reverse, ID's of data as defined in setup JSON
     */
    rebuildVisualisation: function(order) {
        var vis = this._visualisations[this._program],
            program = this._programs[this._program];

        if (order) {
            vis.order = order;
        }
        //must remove before attaching new
        this._detachShader(program, "VERTEX_SHADER");
        this._detachShader(program, "FRAGMENT_SHADER");
        this._visualisationToProgram(vis, program, this._program);
        this.forceSwitchShader(null, true);
    },
    
    /**
     * Switch to program at index: this is the index (order) in which
     * setShaders(...) was called. If you want to switch to shader that
     * has been set with second setShaders(...) call, pass i=1.
     * @param {integer} i program index
     */
    switchVisualisation: function(i) {
        if (this._program == i) return;
        this.forceSwitchShader(i, true);
    },
    
    /**
     * Force switch shader (program), will reset even if the specified
     * program is currently active, good if you need 'gl-loaded' to be
     * invoked (e.g. some uniform variables changed)
     * @param {integer} i program index
     */
    forceSwitchShader: function(i, preserveJS = false) {
        if (!i) i = this._program;

        if (i >= this._programs.length) {
            console.error("Invalid shader index.");
        } else if (this._visualisations[i].hasOwnProperty("error") || !this._programs[i]) {
            this._loadHtml(i, this._program, preserveJS);
            this._loadScript(i, this._program, preserveJS);
            this._program = i;
            this.onFatalError(this._visualisations[i]);
            this.running = false;
        } else {
            this.running = true;
            this._loadHtml(i, this._program, preserveJS);
            this._loadScript(i, this._program, preserveJS);
            this._program = i;
            this.toBuffers(this._programs[i]);
        }
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
        if (!this.running) return;

        // Allow for custom loading
        this.gl.useProgram(program);
        this.visualisationInUse(this._visualisations[this._program]);
        this['gl_loaded'].call(this, program, this.gl);

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
        this._att = [this.pos, this.tile_pos].map(function(name, number) {

            var index = Math.min(number, boxes.length-1);
            var vec = Math.floor(boxes[index].length/count);
            var vertex = gl.getAttribLocation(program, name);

            return [vertex, vec, gl.FLOAT, 0, vec*bytes, count*index*vec*bytes];
        });

        this.texture.toBuffers(gl, this.wrap, this.filter);
        
        this._drawArrays = [gl.TRIANGLE_STRIP, 0, count];

        // Build the position and texture buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    },
    
    // Renders canvas using webGL
    // accepts image data to draw (tile) and source (string, origin of the tile)
    //
    // returns canvas if webGL was used, null otherwise
    toCanvas: function(tile, e) {
        if (!this.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        // TODO move this decision to tile-loaded to decide once!
        if (! this['gl_drawing'].call(this, tile, e)) {
            return null;
        }

        var gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);  

        // Set Attributes for GLSL
        this._att.map(function(x){
            gl.enableVertexAttribArray(x.slice(0,1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        // Upload textures
        this.texture.toCanvas(this._visualisations[this._program], tile, this._programs[this._program], this.gl);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this._drawArrays);

        // Apply to container if needed
        if (this.container) {
            this.container.appendChild(this.gl.canvas);
        }

        this.texture.freeTextures();
        return this.gl.canvas;
    },

    // Run handler only to decide whether particular tile uses openGL
    willUseCanvas: function(tile, e) {
        //todo dirty do it differently
        return this['gl_drawing'].call(this, tile, e);
    },

    // Must be called before init()
    setCache: function(cache) {
        if (typeof cache !== "object" || this._initialized) {
            console.error("Invalid call of loadCache!");
            return;
        }
        this._cache = cache;
    },

    getCache: function() {
        //global maintained by this script
        return VISUALISAITION_SHADER_CACHE;
    },

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    // Initialize viaGL
    init: function() {
        if (this._initialized) {
            console.error("Already initialized!");
            return;
        }
    
        if (this._visualisations.length < 1) {
            //todo show GUI error instead
            console.error("No visualisation specified!");
            return;
        }

        if (!this.shaderGenerator) {
            console.error("No shader source generator defined.");
            return;
        }

        this._initialized = true;
        // Allow for mouse actions on click
        if (this.hasOwnProperty('container') && this.hasOwnProperty('onclick')) {
            this.container.onclick = this[this.onclick].bind(this);
        }
        this.setDimensions(this.width, this.height);

        //cache setup
        var s = document.createElement("script");
        s.type = "text/javascript";
        s.text = `
        var VISUALISAITION_SHADER_CACHE = ${JSON.stringify(this._cache)};
        `;
        document.body.appendChild(s);
        delete this._cache;

        // Load the shaders when ready and return the promise
        var step = [this._visualisations.map(this.getter)];
        
        step.push(this.toProgram.bind(this));
        step.push(this.forceSwitchShader.bind(this, null, false)); //default program left on _program variable value
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
    // Get built visualisation
    getter: function(visualisation) {        
        
        return new Promise(function(done){

            var bid = new XMLHttpRequest();
            bid.open('POST', visualisation.url, true);
            var postData = new FormData();
            postData.append("shaders", JSON.stringify(visualisation["shaders"]));
            postData.append("params", JSON.stringify(visualisation["params"]));
            bid.send(postData);
            bid.onerror = function() {
                if (bid.status == 200) {
                    return done(bid.response);
                }
                return done(requestURL);
            };
            bid.onload = function() {
                return done(bid.response);
            };
        });
    },

    _loadHtml: function(visId, prevVisId, preserveJS) {
        var htmlControls = document.getElementById(this.htmlControlsId);
        // if (preserveJS) {
        //     if (visId == prevVisId) return;
        //     let oldHtmlText = htmlControls ? htmlControls.innerHTML : false;
        //     if (oldHtmlText) {
        //         this._visualisations[prevVisId]["html"] = oldHtmlText;
        //     }
        // } 
        htmlControls.innerHTML = this._visualisations[visId]["html"];
    },

    _loadScript: function(visId, prevVisId, preserveJS) {
        var forScript = document.getElementById(this.scriptId);
        // if (preserveJS) {
        //     if (visId == prevVisId) return;
        //     let oldScriptText = forScript.firstChild ? forScript.firstChild.text : false;
        //     if (oldScriptText) {
        //         this._visualisations[prevVisId]["js"] = oldScriptText;
        //     }
        // } 
        forScript.innerHTML = "";
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.text = this._visualisations[visId]["js"];
        forScript.appendChild(script);            
    },

    // https://stackoverflow.com/questions/359788/how-to-execute-a-javascript-function-when-i-have-its-name-as-a-string
    _callString: function(fn, ...args) {
        try {
            let func = (typeof fn =="string")?window[fn]:fn;
            if (typeof func == "function") func(...args);
            else this.onException(new Error(`${fn} is Not a function!`));
        } catch (e) {
            console.error(e);
            this.onException(e);
        }
     
    },

    _buildVisualisation: function(order, visSetup, visualisation, glLoadCall, glDrawingCall) {
        try {
            var definition = "", execution = "", html = "", js = "", glload = "", gldraw = "", _this = this;

            order.forEach(dataId => {
                

                if (visSetup[dataId].error) {
                    html = `<div class="configurable-border shader-part-error" data-id="${dataId}"><div class="shader-part-name">${dataId}</div>${visSetup[dataId]["error"]}</div>${html}`;
                    console.warn(visSetup[dataId]["error"], visSetup[dataId]["desc"]);

                } else if (visSetup[dataId].definition && visSetup[dataId].execution && visSetup[dataId].sampler2D) {
                    let visible = false;
                    if (visSetup[dataId].visible == 1) {
                        definition += visSetup[dataId]["definition"];
                        execution += visSetup[dataId]["execution"];
                        glload += visSetup[dataId]["glLoaded"];
                        gldraw += visSetup[dataId]["glDrawing"]; 
                        visible = true;
                    }
                    //reverse order append to show first the last drawn element (top)
                    html = _this.htmlShaderPartHeader(dataId, visSetup, visible) + html;
                    js += visSetup[dataId]["js"];
                } else {
                    html = `<div class="configurable-border shader-part-error" data-id="${dataId}"><div class="shader-part-name">${dataId}</div>This data cannot be displayed: invalid visualisation type.</div>${html}`;
                    console.warn("Invalid shader part.", "Missing one of the required elements.", visSetup[dataId]);
                }
            });

            // if (execution === "" || definition === "") {
            //     throw "Empty visualisation or there is no part of the valid.";
            // } 

        var fragment_shader = `
precision mediump float;
uniform vec2 u_tile_size;
varying vec2 v_tile_pos;
//linear blending of colors based on float 'ratio'
vec4 blend(vec4 a, vec4 b, float ratio) {
    return ratio * a + (1.0-ratio) * b;
}
//mixing the show color
//shader parts should not touch gl_FragColor but rather send the
//output using show(...)
void show(vec4 color) {
    gl_FragColor = color.a * color + (1.0-color.a) * gl_FragColor;
}

bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

${definition}

void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);

    ${execution}
}`;

var jsscript = `
function saveCache(key, value) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}")) {
        VISUALISAITION_SHADER_CACHE["${visualisation.name}"] = {};
    }
    VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key] = value;
}
function loadCache(key, defaultValue) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}") ||
        !VISUALISAITION_SHADER_CACHE["${visualisation.name}"].hasOwnProperty(key)) {
        return defaultValue;
    }
    return VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key];
}

//user input might do wild things, use try-catch
try {
    ${js}

    function ${glLoadCall}(program, gl) {
        ${glload}
    }
    
    function ${glDrawingCall}(gl, e) {
        ${gldraw}
    }
} catch (error) {
    console.error(error.message);
    //todo try if error outside functions
}
`;
    
    var vertex_shader = `
    attribute vec4 a_pos;
    attribute vec2 a_tile_pos;
    varying vec2 v_tile_pos;
    
    void main() {
      v_tile_pos = a_tile_pos;
      gl_Position = a_pos;
    }
`;
            visualisation.vertex_shader = vertex_shader;
            visualisation.fragment_shader = fragment_shader;
            visualisation.js = jsscript;
            visualisation.html = html;
            delete visualisation.error;            
            delete visualisation.desc;
        } catch (error) { 
            visualisation.vertex_shader = "";
            visualisation.fragment_shader = "";
            visualisation.js = `function ${glLoadCall}(){} function ${glDrawingCall}(){}`;
            visualisation.html = "";
            visualisation.error = "Failed to compose visualisation.";
        }
    },

    // Link shaders from strings
    toProgram: function(responses) {

        this._program = 0; //default program

        // Load multiple shaders - visalisations
        for (let i = 0; i < responses.length; i++) { 
            var responseData;
            try {
                responseData = JSON.parse(responses[i]);
                if (!responseData || typeof responseData !== "object") {
                    responseData = {error: ""}; 
                } 
            } catch (error) { 
                responseData = {error: error.message}; 
            }

            let vis = this._visualisations[i];
            vis.responseData = responseData;
            
            if (responseData.hasOwnProperty("error")) {
                //load default JS to not to cause errors
                vis.js = `function ${this.jsGlLoadedCall}(){} function ${this.jsGlDrawingCall}(){}`;
                vis.error = responseData.error;
                vis.desc = responseData.desc;
                this._programs.push(null); //no program
                if (i == this._program) this._program++;
                continue;
            }

            let program = this.gl.createProgram();
            this._programs.push(program); //preventive, will possibly
            vis.order = Object.keys(vis.responseData);
            this._visualisationToProgram(vis, program, i);            
        }
        //if all invalid go back  
        if (this._program >= this._programs.length) this._program = 0;

        return this._programs[0];
    },

    _detachShader: function(program, type) {
        var shader = program[type];
        this.gl.detachShader(program, shader);
        this.gl.deleteShader(shader);
    },

    _visualisationToProgram: function(vis, program, idx) {
        var gl = this.gl,
            ok = function(kind,status,value,sh) {
                if (!gl['get'+kind+'Parameter'](value, gl[status+'_STATUS'])){
                    console.log((sh||'LINK')+':\n'+gl['get'+kind+'InfoLog'](value));
                    return false;
                }
                return true;
            },
            err = function(message, description, glLoad, glDraw) {
                vis.js = `function ${glLoad}(){} function ${glDraw}(){}`;
                vis.error = message;
                vis.desc = description;
                vis.html = "Invalid visualisation.";
        };

        this._buildVisualisation(vis.order, vis.responseData, vis, this.jsGlLoadedCall, this.jsGlDrawingCall);

        function useShader(gl, program, data, type) {
            var shader = gl.createShader(gl[type]);
            gl.shaderSource(shader, data);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            program[type] = shader;
            return ok('Shader','COMPILE', shader, type);
        }

        // console.log("FRAGMENT", vis["fragment_shader"]);

        if (!useShader(gl, program, vis["vertex_shader"], 'VERTEX_SHADER') ||
            !useShader(gl, program, vis["fragment_shader"], 'FRAGMENT_SHADER')) {
            err("Unable to use this visualisation.", "Compilation of shader failed. For more information, see logs in the console.", this.jsGlLoadedCall, this.jsGlDrawingCall);
            if (idx == this._program) this._program++;
        } else {
            gl.linkProgram(program);
            //todo error here as well...
            if (!ok('Program','LINK',program)) {
                err("Unable to use this visualisation.", "Linking of shader failed. For more information, see logs in the console.", this.jsGlLoadedCall, this.jsGlDrawingCall);
            }
        }
        this.visualisationReady(i, vis);
    },

    texture: {
        // Get texture

        init: function(gl, maxTextureUnits) {
             this._units = [];
            // for (let i = 0; i < maxTextureUnits; i++) {
            //     this._units.push({
            //         bindConstant: `TEXTURE${i}`,
            //         bindPointer: gl.createTexture(),
            //     });
            // }
        },
        
        toBuffers: function(gl, wrap, filter, visualisation) {
            this.texParameteri = [
                [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap],
                [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap],
                [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter],
                [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter]
            ];
            this.texImage2D = [gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE];
            this.pixelStorei = [gl.UNPACK_FLIP_Y_WEBGL, 1];
            //todo dirty...
            //this.init(this.gl, this._units.length);
           
        },

        toCanvas: function(visualisation, tile, program, gl) {

        
            //todo bind textures by data name
            let samplerNames = [];

            visualisation.order.forEach(key => {
                samplerNames.push(visualisation.responseData[key].sampler2D);
            })

            // if (this._units.length != 0) {
            //     console.error("Unfreed texture units.");
            // }
            for (let i = 0; i < samplerNames.length; i++) {
                if (i > this.maxTextureUnits) return;

                // Bind pointer
                //gl.bindTexture(gl.TEXTURE_2D, this._units[i].bindPointer);
                let bindPtr = gl.createTexture();
                //this._units.push(bindPtr);
                let bindConst =  `TEXTURE${i}`;
                gl.bindTexture(gl.TEXTURE_2D, bindPtr);

                // Apply texture parameters
                this.texParameteri.map(function(x){
                    gl.texParameteri.apply(gl, x);
                });
                gl.pixelStorei.apply(gl, this.pixelStorei);

                // Send the tile into the texture.
                var output = this.texImage2D.concat([tile]);
                gl.texImage2D.apply(gl, output);

                //TODO why not simultaneously in tutorial?

                // Bind texture unit
                let location = gl.getUniformLocation(program, samplerNames[i]);
                gl.uniform1i(location, i);
                //gl.activeTexture(gl[this._units[i].bindConstant]); //TEXTURE[i]
                gl.activeTexture(gl[bindConst]);
                //gl.bindTexture(gl.TEXTURE_2D, this._units[i].bindPointer);
                gl.bindTexture(gl.TEXTURE_2D, bindPtr); //why twice?
            }
        },

        freeTextures: function() {
             this._units.forEach(tex => this.gl.deleteTexture(tex));
             //this._units = [];
        }
    }
}