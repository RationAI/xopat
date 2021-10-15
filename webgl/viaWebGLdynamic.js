/*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~*~
/* Written by Jiří Horák, 2021
/*
/* Based on viaWebGL
/* Built on 2016-9-9
/* http://via.hoff.in
*/
ViaWebGL = function (incoming) {

    //default calls
    this.onFatalError = function (vis) {
        console.error(vis["error"], vis["desc"]);
    }
    this.htmlShaderPartHeader = function (title, html, isVisible, isControllable = true) {
        return `<div class="configurable-border"><div class="shader-part-name">${title}</div>${html}</div>`;
    }
    this.ready = function () { };

    //default values that might come from options and be overwritten later
    this.jsGlLoadedCall = "viaGlLoadedCall";
    this.jsGlDrawingCall = "viaGlDrawingCall";

    this.gl_loaded = function (gl, program) {
        //call pre-defined name of
        this._callString(this.jsGlLoadedCall, program, gl);
    };

    this.gl_drawing = function (gl, tile, e) {
        this._callString(this.jsGlDrawingCall, gl, e);
        //use shaders only for certain tile source
        //todo make this more elegant (move decision into osdGL script)
        return e.tiledImage.source.tilesUrl.indexOf(urlImage) === -1; //use webGL if not urlImage source
    };

    // Assign from incoming terms
    for (var key in incoming) {
        this[key] = incoming[key];
    }

    this.setWebGL();
    //todo move all the settings into corresponding webgl context classes to set uniformly
    this.tile_size = 'u_tile_size';
    this.wrap = this.gl.CLAMP_TO_EDGE;
    this.tile_pos = 'a_tile_pos';
    this.filter = this.gl.NEAREST;
    this.pos = 'a_pos';

    // Private shader management
    this._visualisations = [];
    
    this._textures = [];
    this._programs = [];
    this._program = -1;
    //todo handle textures based on gl version used
    this._texture_names = [];
    this._initialized = false;
    this._cache = [];
};

ViaWebGL.prototype = {
    /**
     * Set program shaders. Vertex shader is set by default a square.
     * @param {object} visualisation visualisation setup
     */
    setVisualisation: function (visualisation) {
        visualisation.url = this.shaderGenerator;
        this._visualisations.push(visualisation);
    },

    /**
     * Rebuild visualisation and update scene
     * @param {array} order order in reverse, ID's of data as defined in setup JSON
     */
    rebuildVisualisation: function (order) {
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
    switchVisualisation: function (i) {
        if (this._program == i) return;
        this.forceSwitchShader(i, true);
    },

    /**
     * Force switch shader (program), will reset even if the specified
     * program is currently active, good if you need 'gl-loaded' to be
     * invoked (e.g. some uniform variables changed)
     * @param {integer} i program index
     */
    forceSwitchShader: function (i, preserveJS = false) {
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
     */
    setDimensions: function(width, height) {
        if (width === this.width && height === this.height) return;

        this.width = width;
        this.height = height;
        this.gl.canvas.width = width;
        this.gl.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    },

    /////////////////////////////////////////////////////////////////////////////////////
    //// YOU PROBABLY WANT TO READ FUNCTIONS BELOW SO YOU KNOW HOW TO SET UP YOUR SHADERS
    //// BUT YOU SHOULD NOT CALL THEM DIRECTLY
    /////////////////////////////////////////////////////////////////////////////////////

    // Setup program variables, each program has at least:
    toBuffers: function (program) {
        this.webGLImplementation.toBuffers(program);
    },

    // Renders canvas using webGL
    // accepts image data to draw (imageElement) and source (string, origin of the tile)
    // returns canvas if webGL was used, null otherwise
    toCanvas: function (imageElement, e) {
        return this.webGLImplementation.toCanvas(imageElement, e);
    },

    // Run handler only to decide whether particular tile uses openGL
    willUseWebGL: function (tile, e) {
        //todo dirty do it differently
        return this['gl_drawing'].call(this, this.gl, tile, e);
    },

    // Must be called before init()
    setCache: function (cache) {
        if (typeof cache !== "object" || this._initialized) {
            console.error("Invalid call of loadCache!");
            return;
        }
        this._cache = cache;
    },

    getCache: function () {
        //global maintained by this script
        return VISUALISAITION_SHADER_CACHE;
    },

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    // Prepare viaGL, must be called before init()
    prepare: function (onPrepared) {
        if (this._prepared) {
            console.error("Already prepared!");
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

        this._prepared = true;
        // Allow for mouse actions on click
        if (this.hasOwnProperty('container') && this.hasOwnProperty('onclick')) {
            this.container.onclick = this[this.onclick].bind(this);
        }

        //cache setup (GLOBAL because of its use in dynamic shader scripts)
        VISUALISAITION_SHADER_CACHE = this._cache;
        delete this._cache;

        // Load the shaders when ready and return the promise
        return Promise.all(
            this._visualisations.map(this.getter.bind(this))
        ).then(
            this.toProgram.bind(this)
        ).then(
            onPrepared
        );
    },

    // Initialize viaGL
    init: function(width, height) {
        if (!this._prepared) {
            console.error("The viaGL was not yet prepared. Call prepare() before init()!");
            return;
        }
        if (this._initialized) {
            console.error("Already initialized!");
            return;
        }
        this._initialized = true;
        this.setDimensions(width, height);
        this.running = true;

        this.forceSwitchShader(null, false);
        this.ready();
    },


    setWebGL: function(options) {
        const canvas = document.createElement('canvas');
        this.gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
        if (this.gl) {
            //WebGL 2.0
            this.webGLImplementation = new WebGL20(this, this.gl);
            return;
        }
        // WebGL 1.0
        this.gl = canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });   
        this.webGLImplementation = new WebGL10(this, this.gl);
    },

    // Get built visualisation
    getter: function (visualisation) {
        const isWebGL2 = this.webGLImplementation.isWebGL2();

        return new Promise(function (done) {

            var bid = new XMLHttpRequest();
            bid.open('POST', visualisation.url, true);
            var postData = new FormData();
            postData.append("shaders", JSON.stringify(visualisation["shaders"]));
            postData.append("params", JSON.stringify(visualisation["params"]));
            postData.append("webgl2", JSON.stringify(isWebGL2));

            bid.send(postData);
            bid.onerror = function () {
                if (bid.status == 200) {
                    return done(bid.response);
                }
                return done(requestURL);
            };
            bid.onload = function () {
                return done(bid.response);
            };
        });
    },

    _loadHtml: function (visId, prevVisId, preserveJS) {
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

    _loadScript: function (visId, prevVisId, preserveJS) {
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
    _callString: function (fn, ...args) {
        try {
            let func = (typeof fn == "string") ? window[fn] : fn;
            if (typeof func == "function") func(...args);
            else this.onException(new Error(`${fn} is Not a function!`));
        } catch (e) {
            console.error(e);
            this.onException(e);
        }
    },

    _buildVisualisation: function (order, visSetup, visualisation, glLoadCall, glDrawingCall) {
        try {
            let data = this.webGLImplementation.generateVisualisation(order, visSetup, visualisation, glLoadCall, glDrawingCall);
            if (data.usableShaders < 1) {
                throw `Empty visualisation: no valid visualisation has been specified.<br><b>Visualisation setup:</b></br> <code>${JSON.stringify(visSetup)}</code><br><b>Dynamic shader data:</b></br><code>${JSON.stringify(visualisation.data)}</code>`;
            }

            visualisation.vertex_shader = data.vertex_shader;
            visualisation.fragment_shader = data.fragment_shader;
            visualisation.js = data.js;
            visualisation.html = data.html;

            delete visualisation.error;
            delete visualisation.desc;
        } catch (error) {
            if (!visualisation.html) visualisation.html = "";
            visualisation.vertex_shader = "";
            visualisation.fragment_shader = "";
            visualisation.js = `function ${glLoadCall}(){} function ${glDrawingCall}(){}`;
            visualisation.error = "Failed to compose visualisation.";
            visualisation.desc = error;
        }
    },

    // Link shaders from strings
    toProgram: function (responses) {

        this._program = 0; //default program

        // Load multiple shaders - visalisations
        for (let i = 0; i < responses.length; i++) {
            var responseData;
            try {
                responseData = JSON.parse(responses[i]);
                if (!responseData || typeof responseData !== "object") {
                    responseData = { error: "" };
                }
            } catch (error) {
                responseData = { error: error.message };
            }

            let vis = this._visualisations[i];
            vis.responseData = responseData;

            if (responseData.hasOwnProperty("error")) {
                //load default JS to not to cause errors
                vis.js = `function ${this.jsGlLoadedCall}(){} function ${this.jsGlDrawingCall}(){}`;
                vis.html = "Invalid visualisation.";
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

    _detachShader: function (program, type) {
        var shader = program[type];
        this.gl.detachShader(program, shader);
        this.gl.deleteShader(shader);
    },

    _visualisationToProgram: function (vis, program, idx) {
        var gl = this.gl,
            ok = function (kind, status, value, sh) {
                if (!gl['get' + kind + 'Parameter'](value, gl[status + '_STATUS'])) {
                    console.log((sh || 'LINK') + ':\n' + gl['get' + kind + 'InfoLog'](value));
                    return false;
                }
                return true;
            },
            err = function (message, description, glLoad, glDraw) {
                vis.js = `function ${glLoad}(){} function ${glDraw}(){}`;
                vis.error = message;
                vis.desc = description;
            };

        this._buildVisualisation(vis.order, vis.responseData, vis, this.jsGlLoadedCall, this.jsGlDrawingCall);

        if (vis.hasOwnProperty("error")) return;

        function useShader(gl, program, data, type) {
            var shader = gl.createShader(gl[type]);
            gl.shaderSource(shader, data);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            program[type] = shader;
            return ok('Shader', 'COMPILE', shader, type);
        }

        // console.log("FRAGMENT", vis["fragment_shader"]);

        if (!useShader(gl, program, vis["vertex_shader"], 'VERTEX_SHADER') ||
            !useShader(gl, program, vis["fragment_shader"], 'FRAGMENT_SHADER')) {
            err("Unable to use this visualisation.", "Compilation of shader failed. For more information, see logs in the console.", this.jsGlLoadedCall, this.jsGlDrawingCall);
            console.warn("VERTEX SHADER", vis["vertex_shader"]);
            console.warn("FRAGMENT SHADER", vis["fragment_shader"]);
            if (idx == this._program) this._program++;
        } else {
            gl.linkProgram(program);
            console.log("FRAGMENT SHADER", vis["fragment_shader"]);
            //todo error here as well...
            if (!ok('Program', 'LINK', program)) {
                err("Unable to use this visualisation.", "Linking of shader failed. For more information, see logs in the console.", this.jsGlLoadedCall, this.jsGlDrawingCall);
            }
        }
        this.visualisationReady(idx, vis);
    }
}