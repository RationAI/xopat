/*
* Wrapping the funcionality of WebGL to be suitable for the visualisation.
* Written by Jiří Horák, 2021
*
* Originally based on viaWebGL (and almost nothing-alike as of now)
* Built on 2016-9-9
* http://via.hoff.in
*/

class WebGLWrapper {
    constructor(incomingOptions) {
        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Default values overrideable from incomingOptions  /////////////////
        /////////////////////////////////////////////////////////////////////////////////
        this.uniqueId = "";
        this.ready = function () { };
        this.authorization = {};

        this.htmlShaderPartHeader = function (title, html, dataId, isVisible, layer, isControllable = true) {
            return `<div class="configurable-border"><div class="shader-part-name">${title}</div>${html}</div>`;
        }
        this.resetCallback = function () { };
        //called once a visualisation is compiled and linked (might not happen)
        this.visualisationReady = function(i, visualisation) { }
        //called once a visualisation is switched to (including first run)
        this.visualisationInUse = function(visualisation) { }
        this.visualisationChanged = function(oldVis, newVis) { }
        //called when the module has longer time to process stuff, user can react by GUI update for example
        this.notifyWorkStarted = function () { }
        this.notifyWorkFinished = function () { }
        //called when exception (usually some missing function) occurs
        this.onError = function(error) {
            console.warn("An error has occurred:", error);
        }
        //called when key functionality fails
        this.onFatalError = function (vis) {
            console.error(vis["error"], vis["desc"]);
        }

        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Incoming Values ///////////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////////

        // Assign from incoming terms
        for (let key in incomingOptions) {
            if (incomingOptions.hasOwnProperty(key)) {
                this[key] = incomingOptions[key];
            }
        }

        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Internals /////////////////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////////

        try {
            WebGLWrapper.GlContextFactory.init(this, "1.0");
            //WebGLWrapper.GlContextFactory.init(this, "2.0", "1.0");
        } catch (e) {
            this.onFatalError({error: "Unable to initialize the visualisation.", desc: e});
            return;
        }

        this.gl_loaded = function (gl, program, vis) {
            this._eachValidVisibleVisualizationLayer(vis, layer => layer._renderContext.glLoaded(program, gl));
        };

        this.gl_drawing = function (gl, program, vis, bounds) {
            this._eachValidVisibleVisualizationLayer(vis, layer => layer._renderContext.glDrawing(program, bounds, gl));
        };

        this._visualisations = [];
        this._programs = {};
        this._program = -1;
        this._initialized = false;
        this._workingNotified = false;
    }

    /**
     * Set program shaders. Vertex shader is set by default a square.
     * @param {object} visualisations - objects that define the visualisation (see Readme)
     * @return {boolean} true if loaded successfully
     */
    addVisualisation(...visualisations) {
          if (this._prepared) {
            console.error("New visualisation cannot be introduced after the visualiser was prepared.");
            return false;
        }
        for (let vis of visualisations) {
            if (!vis.hasOwnProperty("params")) {
                vis.params = {};
            }
            this._visualisations.push(vis);
        }
        return true;
    }

    /**
     * Runs a callback on each visualisation goal
     * @param {function} call callback to perform on each visualisation goal (its object given as the only parameter)
     */
    foreachVisualisation(call) {
        this._visualisations.forEach(vis => call(vis));
    }

    /**
     * Rebuild visualisation and update scene
     * @param {array} order order in reverse, ID's of data as defined in setup JSON
     */
    rebuildVisualisation(order, onFinished) {
        let vis = this._visualisations[this._program];

        if (order) {
            vis.order = order;
        }
        if (this._programs.hasOwnProperty(this._program)) {
            //must remove before attaching new
            let program = this._programs[this._program];
            this._detachShader(program, "VERTEX_SHADER");
            this._detachShader(program, "FRAGMENT_SHADER");
        }
        this._visualisationToProgram(vis, this._program).then(
           this._forceSwitchShader.bind(this, this._program)
        ).then(
            onFinished
        );
    }

    /**
     * Switch to program at index: this is the index (order) in which
     * setShaders(...) was called. If you want to switch to shader that
     * has been set with second setShaders(...) call, pass i=1.
     * @param {Number} i program index or null if you wish to re-initialize the current one
     */
    switchVisualisation(i, onFinished) {
        if (this._program === i) return;
        this.visualisationChanged(this._visualisations[this._program], this._visualisations[i]);
        this._forceSwitchShader(i).then(
            onFinished
        );
    }

    /**
     * Change the dimensions, useful for borders, used by openSeadragonGL
     */
    setDimensions(width, height) {
        if (width === this.width && height === this.height) return;

        this.width = width;
        this.height = height;
        this.gl.canvas.width = width;
        this.gl.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    /**
     * Get a list of image pyramids used to compose the current visualisation goal
     */
    getSources() {
        return this._visualisations[this._program].dziExtendedUrl;
    }

    /**
     * Renders data using WebGL
     * @param {<img>} imageElement image data
     * @param tileDimension expected dimension of the output (canvas)
     * @param zoomLevel value passed to the shaders as zoom_level
     * @param pixelSize value passed to the shaders as pixel_size_in_fragments
     * @returns canvas (with transparency) with the data rendered based on current program
     *          null if willUseWebGL(imageElement, e) would return false
     */
    processImage(imageElement, tileDimension, zoomLevel, pixelSize) {
        return this.webGLImplementation.toCanvas(this._programs[this._program],  this._visualisations[this._program],
            imageElement, tileDimension, zoomLevel, pixelSize);
    }

    supportsHtmlControls() {
        return typeof this.htmlControlsId === "string" && this.htmlControlsId.length > 0;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    //// YOU PROBABLY WANT TO READ FUNCTIONS BELOW SO YOU KNOW HOW TO SET UP YOUR SHADERS
    //// BUT YOU SHOULD NOT CALL THEM DIRECTLY
    /////////////////////////////////////////////////////////////////////////////////////

    exportSettings() {
        //export all except eventSource or private props: automatically attached by OpenSeadragon event engine; or generated data
        let forbidden = ["eventSource"];
        return JSON.stringify(this._visualisations,
            (key, value) => key.startsWith("_") || forbidden.includes(key) ? undefined : value);
    }

    /**
     * Prepares the WebGL wrapper for being initialized. More concretely,
     * each visualisation is prepared by downloading all necessary files (e.g. shaders),
     * shaders are compiled and other WebGL structures initialized. It is separated from
     * initialization as this must be finished before OSD is ready (we must be ready to draw when the data comes).
     * The idea is to open the protocol for OSD in onPrepared.
     * Shaders are fetched from `visualisation.url` parameter.
     *
     * @param {number} visIndex index of the initial visualisation
     * @param {function} onPrepared callback to execute after succesfull preparing.
     */
    prepare(onPrepared, visIndex=0) {
        if (this._prepared) {
            console.error("Already prepared!");
            return;
        }

        if (this._visualisations.length < 1) {
            console.error("No visualisation specified!");
            this.onFatalError({error: "No visualisation specified!",
                desc: "::prepare() called with no visualisation set."});
            return;
        }
        this._program = visIndex;

        this._prepared = true;
        if (this._program >= this._visualisations.length) this._program = 0;

        this._visualisationToProgram(this._visualisations[visIndex], visIndex).then(
            onPrepared
        );
    }

    /**
     * Initialization. It is separated from preparation as this must be
     * called after OSD is ready. Must be performed after
     * all the prepare() strategy finished: e.g. as onPrepared. Or use prepareAndInit();
     * @param {int} width width of the first tile going to be drawn
     * @param {int} height height of the first tile going to be drawn
     */
    init(width, height) {
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

        this._forceSwitchShader(null).then(
            this.ready.bind(this)
        );
    }

    prepareAndInit() {
        let _this = this;
        this.prepare(() => {
            _this.init(1, 1);
        });
    }

    //////////////////////////////////////////////////////////////////////////////
    ///////////// YOU PROBABLY DON'T WANT TO READ/CHANGE FUNCTIONS BELOW
    //////////////////////////////////////////////////////////////////////////////

    /**
     * @private
     * Prepare for a certain program to use, call before this program is used for rendering
     * @param {WebGLProgram} program current program to use
     * @param currentVisualisation current visualisation data structure
     */
    _toBuffers(program, currentVisualisation) {
        this.webGLImplementation.toBuffers(program, currentVisualisation);
    }

    /**
     * @private
     * Force switch shader (program), will reset even if the specified
     * program is currently active, good if you need 'gl-loaded' to be
     * invoked (e.g. some uniform variables changed)
     * @param {Number} i program index or null if you wish to re-initialize the current one
     */
    async _forceSwitchShader(i) {
        if (!i) i = this._program;

        if (i >= this._visualisations.length) {
            console.error("Invalid visualisation index " + i);
            return;
        }

        let target = this._visualisations[i];
        if (!this._programs.hasOwnProperty(i)) {
            await this._visualisationToProgram(target, i);
        }

        this._program = i;
        if (target.hasOwnProperty("error")) {
            if (this.supportsHtmlControls()) this._loadHtml(i, this._program);
            this.onFatalError(target);
            this.running = false;
        } else {
            this.running = true;
            if (this.supportsHtmlControls()) this._loadHtml(i, this._program);
            this._loadScript(i, this._program);
            this._toBuffers(this._programs[i], target);
        }
    }

    _loadHtml(visId) {
        var htmlControls = document.getElementById(this.htmlControlsId);
        htmlControls.innerHTML = this._visualisations[visId]._built["html"];
    }

    _loadScript(visId) {
        this._eachValidVisualizationLayer(this._visualisations[visId], layer => layer._renderContext.init());
    }

    _buildFailed(visualisation, error) {
        console.error(error);
        visualisation.error = "Failed to compose visualisation.";
        visualisation.desc = error;
    }

    _eachValidVisualizationLayer(vis, callback) {
        let shaders = vis.shaders;
        for (let key in shaders) {
            if (shaders.hasOwnProperty(key) && !shaders[key].hasOwnProperty("error")) {
                callback(shaders[key]);
            }
        }
    }

    _eachValidVisibleVisualizationLayer(vis, callback) {
        let shaders = vis.shaders;
        for (let key in shaders) {
            //rendering == true means no error
            if (shaders.hasOwnProperty(key) && shaders[key].rendering) {
                callback(shaders[key]);
            }
        }
    }

    _buildVisualisation(order, visualisation) {
        try {
            let data = this.webGLImplementation.generateVisualisation(order, visualisation, this.supportsHtmlControls());
            if (data.usableShaders < 1) {
                this._buildFailed(visualisation, `Empty visualisation: no valid visualisation has been specified.
<br><b>Visualisation setup:</b></br> <code>${JSON.stringify(visualisation)}</code>
<br><b>Dynamic shader data:</b></br><code>${JSON.stringify(visualisation.data)}</code>`);
            } else {
                data.dziExtendedUrl = data.dataUrls.join(",");
                visualisation._built = data;

                //preventive
                delete visualisation.error;
                delete visualisation.desc;
            }
        } catch (error) {
            this._buildFailed(visualisation, error);
        }
    }

    _detachShader(program, type) {
        var shader = program[type];
        this.gl.detachShader(program, shader);
        this.gl.deleteShader(shader);
    }

    async _downloadAndRegisterShader(url, headers) {
        await fetch(url, {
            method: "GET",
            body: null,
            redirect: 'error',
            mode: 'cors', // no-cors, *cors, same-origin
            credentials: 'same-origin', // include, *same-origin, omit
            cache: "no-cache",
            referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
            headers: headers
        }).then(response => {
            if (response.status < 200 || response.status > 299) {
                return response.text()
                    .then(e => {
                        console.error("Fetching of the shader failed.", e);
                        throw new Error("There was an error when fetching the shader source: " + url);
                    });
            } else {
                return response.text();
            }
        }).then(text => {
            let script = document.createElement("script");
            script.type = "text/javascript";
            script.text = text;
            script.onerror = e => {
                //Just ignore it, only log into the console.
                console.error("Failed to interpret downloaded shader layer script: ", url, "Ignoring this script...");
            }
            document.body.appendChild(script);
        }).catch(e => {
            console.error("Failed to download and initialize shader " + url, e);
        });
    }

    async _downloadRequiredShaderFactories(vis) {
        if (vis.hasOwnProperty("shaderSources")) {
            for (let source of vis["shaderSources"]) {
                let ShaderFactoryClass = WebGLWrapper.ShaderMediator.getClass(source["typedef"]);
                if (!ShaderFactoryClass) {
                    if (!this._workingNotified) {
                        this._workingNotified = true;
                        this.notifyWorkStarted();
                    }
                    await this._downloadAndRegisterShader(source["url"], source["headers"]);
                } else {
                    console.warn("Shader source " + source["typedef"] + " already defined!")
                }
            }
        }
        if (this._workingNotified) {
            this._workingNotified = false;
            this.notifyWorkFinished();
        }
    }

    async _visualisationToProgram(vis, idx) {
        if (!vis.hasOwnProperty("_built")) {
            vis._built = {};
        }

        if (vis.hasOwnProperty("error")) {
            vis._built.html = "Invalid visualisation.";
            return;
        }

        await this._downloadRequiredShaderFactories(vis);
        this._processVisualisation(vis, idx);
        return idx;
    }

    _initializeShaderFactory(ShaderFactoryClass, layer, idx) {
        if (!ShaderFactoryClass) {
            layer.error = "Unknown layer type.";
            layer.desc = `The layer type '${layer.type}' has no associated factory. Missing in 'shaderSources'.`;
            console.warn("Skipping layer " + layer.name);
            return;
        }
        layer._renderContext = new ShaderFactoryClass(layer.params);
        layer.order = idx;

        layer._renderContext._setContextVisualisationLayer(layer, `${this.uniqueId}${layer.order}`, layer.order);
        layer._renderContext._setWebglContext(this.webGLImplementation);
        layer._renderContext._setResetCallback(this.resetCallback);
    }

    _processVisualisation(vis, idx) {
        let gl = this.gl,
            ok = function (kind, status, value, sh) {
                if (!gl['get' + kind + 'Parameter'](value, gl[status + '_STATUS'])) {
                    console.log((sh || 'LINK') + ':\n' + gl['get' + kind + 'InfoLog'](value));
                    return false;
                }
                return true;
            },
            err = function (message, description) {
                vis.error = message;
                vis.desc = description;
            };

        let program;

        if (!this._programs.hasOwnProperty(idx)) {
            program = gl.createProgram();
            this._programs[idx] = program;

            let index = 0;
            for (let key in vis.shaders) {
                if (vis.shaders.hasOwnProperty(key)) {
                    let layer = vis.shaders[key],
                        ShaderFactoryClass = WebGLWrapper.ShaderMediator.getClass(layer.type);

                    if (!layer.hasOwnProperty("cache")) layer.cache = {};
                    this._initializeShaderFactory(ShaderFactoryClass, layer, index++);
                }
            }

            if (!vis.hasOwnProperty("order")) {
                vis.order = Object.keys(vis.shaders);
            }
        } else {
            program = this._programs[idx];
            for (let key in vis.shaders) {
                if (vis.shaders.hasOwnProperty(key)) {
                    let layer = vis.shaders[key];

                    if (layer.hasOwnProperty("_renderContext") &&
                        layer._renderContext.constructor.type() === layer.type) {
                        continue;
                    }
                    let ShaderFactoryClass = WebGLWrapper.ShaderMediator.getClass(layer.type);
                    this._initializeShaderFactory(ShaderFactoryClass, layer, layer.order);
                }
            }
        }

        this._buildVisualisation(vis.order, vis);

        function useShader(gl, program, data, type) {
            var shader = gl.createShader(gl[type]);
            gl.shaderSource(shader, data);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            program[type] = shader;
            return ok('Shader', 'COMPILE', shader, type);
        }

        if (!useShader(gl, program, vis._built["vertex_shader"], 'VERTEX_SHADER') ||
            !useShader(gl, program, vis._built["fragment_shader"], 'FRAGMENT_SHADER')) {
            err("Unable to use this visualisation.",
                "Compilation of shader failed. For more information, see logs in the console.");
            console.warn("VERTEX SHADER", vis._built["vertex_shader"]);
            console.warn("FRAGMENT SHADER", vis._built["fragment_shader"]);
        } else {
            gl.linkProgram(program);
            if (!ok('Program', 'LINK', program)) {
                err("Unable to use this visualisation.",
                    "Linking of shader failed. For more information, see logs in the console.");
            }
        }
        this.visualisationReady(idx, vis);
    }
}
