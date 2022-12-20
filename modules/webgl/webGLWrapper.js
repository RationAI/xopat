/**
* Wrapping the funcionality of WebGL to be suitable for the visualisation.
* Written by Jiří Horák, 2021
*
* Originally based on viaWebGL (and almost nothing-alike as of now)
* Built on 2016-9-9
* http://via.hoff.in
*
* @typedef {{
*  name: string,
*  lossless: boolean,
*  shaders: object
* }} Visualization
*
* @typedef {{
*   name: string,
*   type: string,
*   visible: boolean,
*   dataReferences: number[],
*   params: object
*  }} Layer
*/

window.WebGLModule = class {
    /**
     * @param {object} incomingOptions
     * @param {function} incomingOptions.htmlControlsId: where to render html controls,
     * @param {string} incomingOptions.webGlPreferredVersion prefered WebGL version, see WebGLModule.GlContextFactory for available
     * @param {function} incomingOptions.htmlShaderPartHeader function that generates particular layer HTML:
     *  signature: f({string} title,{string} html,{string} dataId,{boolean} isVisible,{Layer} layer, {boolean} wasErrorWhenLoading)
     * @param {boolean} incomingOptions.debug debug mode default false
     * @param {function} incomingOptions.ready function called when ready
     * @param {function} incomingOptions.resetCallback function called when user input changed, e.g. changed output of the current rendering
     * @param {function} incomingOptions.visualisationInUse function called when visualisation is initialized and run
     * @param {function} incomingOptions.visualisationChanged function called when a visualization swap is performed:
     *   signature f({Visualization} oldVisualisation,{Visualization} newVisualisation)
     * @param {function} incomingOptions.onFatalError called when this module is unable to run
     * @param {function} incomingOptions.onError called when a problem occurs, but other parts of the system still might work
     */
    constructor(incomingOptions) {
        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Default values overrideable from incomingOptions  /////////////////
        /////////////////////////////////////////////////////////////////////////////////
        this.uniqueId = "";
        this.ready = function () { };
        this.htmlControlsId = null;
        this.webGlPreferredVersion = "2.0";
        this.htmlShaderPartHeader = function (title, html, dataId, isVisible, layer, isControllable = true) {
            return `<div class="configurable-border"><div class="shader-part-name">${title}</div>${html}</div>`;
        };
        this.resetCallback = function () { };
        //called once a visualisation is compiled and linked (might not happen)
        this.visualisationReady = function(i, visualisation) { };
        //called once a visualisation is switched to (including first run)
        this.visualisationInUse = function(visualisation) { };
        this.visualisationChanged = function(oldVis, newVis) { };
        //called when exception (usually some missing function) occurs
        this.onError = function(error) {
            console.warn("An error has occurred:", error.error, error.desc);
        };
        //called when key functionality fails
        this.onFatalError = function (error) {
            console.error(error["error"], error["desc"]);
        };

        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Incoming Values ///////////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////////

        /**
         * Debug mode.
         * @member {boolean}
         */
        this.debug = false;

        // Assign from incoming terms
        for (let key in incomingOptions) {
            if (incomingOptions.hasOwnProperty(key)) {
                this[key] = incomingOptions[key];
            }
        }

        /**
         * Current rendering context
         * @member {WebGLModule.WebGLImplementation}
         */
        this.webGLImplementation = null;

        /**
         * WebGL context
         * @member {WebGLRenderingContext|WebGL2RenderingContext}
         */
        this.gl = null;

        /////////////////////////////////////////////////////////////////////////////////
        ///////////// Internals /////////////////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////////

        this.reset();

        try {
            //WebGLModule.GlContextFactory.init(this,  "1.0");
            WebGLModule.GlContextFactory.init(this, this.webGlPreferredVersion, "2.0", "1.0");
        } catch (e) {
            this.onFatalError({error: "Unable to initialize the visualisation.", desc: e});
            console.error(e);
            return;
        }
        console.log("WebGL Rendering module with version " + this.webGLImplementation.getVersion());

        this.gl_loaded = function (gl, program, vis) {
            WebGLModule.eachValidVisibleVisualizationLayer(vis, layer => layer._renderContext.glLoaded(program, gl));
        };

        this.gl_drawing = function (gl, program, vis, bounds) {
            WebGLModule.eachValidVisibleVisualizationLayer(vis, layer => layer._renderContext.glDrawing(program, bounds, gl));
        };
    }

    /**
     * Reset the engine to the initial state
     */
    reset() {
        this._visualisations = [];
        this._dataSources = [];
        this._origDataSources = [];
        this._customShaders = [];
        this._programs = {};
        this._program = -1;
        this._prepared = false;
        this.running = false;
        this._initialized = false;
    }

    /**
     * Check if prepare() was called.
     * @return {boolean}
     */
    get isPrepared() {
        return this._prepared;
    }

    /**
     * Check if init() was called.
     * @return {boolean}
     */
    get isInitialized() {
        return this._initialized;
    }

    /**
     * Set program shaders. Vertex shader is set by default a square.
     * @param {Visualization} visualisations - objects that define the visualisation (see Readme)
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
            if (!vis.hasOwnProperty("shaders")) {
                console.warn("Invalid visualization: no shaders defined", vis);
                continue;
            }
            this._visualisations.push(vis);
        }
        return true;
    }

    /**
     * @param {object} shaderSources custom shaders
     */
    addCustomShaderSources(...shaderSources) {
        if (this._prepared) {
            console.error("The viaGL was already prepared: shaders are no longer add-able.");
            return;
        }
        this._customShaders.push(...shaderSources);
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
     * @param {string[]|undefined} order of shaders, ID's of data as defined in setup JSON, last element is rendered last (top)
     */
    rebuildVisualisation(order=undefined) {
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
        this._visualisationToProgram(vis, this._program);
        this._forceSwitchShader(this._program);
    }

    /**
     * Get currently used visualisation
     * @return {object} current visualisation
     */
    visualization(index) {
        return this._visualisations[Math.min(index, this._visualisations.length-1)];
    }

    /**
     * Get currently used visualisation ilayer.params,ndex
     * @return {number} index of the current visualization
     */
    currentVisualisationIndex() {
        return this._program;
    }

    /**
     * Switch to program at index: this is the index (order) in which
     * setShaders(...) was called. If you want to switch to shader that
     * has been set with second setShaders(...) call, pass i=1.
     * @param {Number} i program index or null if you wish to re-initialize the current one
     */
    switchVisualisation(i) {
        if (!this._initialized) {
            console.warn("WebGLModule::switchVisualisation(): not initialized.");
            return;
        }
        if (this._program === i) return;
        let oldIndex = this._program;
        this._forceSwitchShader(i);
        this.visualisationChanged(this._visualisations[oldIndex], this._visualisations[i]);
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
        //return this._visualisations[this._program].dziExtendedUrl;
        return this._dataSources;
    }

    /**
     * Renders data using WebGL
     * @param {object} data image data
     * @param tileDimension expected dimension of the output (canvas)
     * @param zoomLevel value passed to the shaders as zoom_level
     * @param pixelSize value passed to the shaders as pixel_size_in_fragments
     * @returns canvas (with transparency) with the data rendered based on current program
     *          null if willUseWebGL(imageElement, e) would return false
     */
    processImage(data, tileDimension, zoomLevel, pixelSize) {
        let result = this.webGLImplementation.toCanvas(this._programs[this._program],  this._visualisations[this._program],
            data, tileDimension, zoomLevel, pixelSize);

        if (this.debug) this._renderDebugIO(data, result);
        return result;
    }

    /**
     * Whether the webgl module renders UI
     * @return {boolean|boolean}
     */
    supportsHtmlControls() {
        return typeof this.htmlControlsId === "string" && this.htmlControlsId.length > 0;
    }

    /**
     * Execute call on each visualization layer with no errors
     * @param {object} vis current visualisation setup context
     * @param {function} callback call to execute
     * @param {function} onFail handle exception during execition
     * @return {boolean} true if no exception occured
     */
    static eachValidVisualizationLayer(vis, callback,
                                       onFail = (layer, e) => {layer.error = e.message; console.error(e);}) {
        let shaders = vis.shaders;
        let noError = true;
        for (let key in shaders) {
            if (shaders.hasOwnProperty(key) && !shaders[key].hasOwnProperty("error")) {
                try {
                    callback(shaders[key]);
                } catch (e) {
                    if (!onFail) throw e;
                    onFail(shaders[key], e);
                    noError = false;
                }
            }
        }
        return noError;
    }

    /**
     * Execute call on each _visible_ visualization layer with no errors
     * @param {object} vis current visualisation setup context
     * @param {function} callback call to execute
     * @param {function} onFail handle exception during execition
     * @return {boolean} true if no exception occured
     */
    static eachValidVisibleVisualizationLayer(vis, callback,
                                              onFail = (layer, e) => {layer.error = e.message; console.error(e);}) {
        let shaders = vis.shaders;
        let noError = true;
        for (let key in shaders) {
            //rendering == true means no error
            if (shaders.hasOwnProperty(key) && shaders[key].rendering) {
                try {
                    callback(shaders[key]);
                } catch (e) {
                    if (!onFail) throw e;
                    onFail(shaders[key], e);
                    noError = false;
                }
            }
        }
        return noError;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    //// YOU PROBABLY WANT TO READ FUNCTIONS BELOW SO YOU KNOW HOW TO SET UP YOUR SHADERS
    //// BUT YOU SHOULD NOT CALL THEM DIRECTLY
    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Get current program, reset if invalid
     * @return {number} program index
     */
    getCurrentProgramIndex() {
        if (this._program < 0 || this._program >= this._visualisations.length) this._program = 0;
        return this._program;
    }

    /**
     * Function to JSON.stringify replacer
     * @param key key to the value
     * @param value value to be exported
     * @return {*} value if key passes exportable condition, undefined otherwise
     */
    static jsonReplacer(key, value) {
        return key.startsWith("_") || ["eventSource"].includes(key) ? undefined : value;
    }

    /**
     * For easy initialization, do both in once call.
     * For separate initialization (prepare|init), see functions below.
     * @param dataSources a list of data identifiers available to the visualisations
     *  - visualisation configurations should not reference data not present in this array
     *  - the module gives you current list of required subset of this list for particular active visualization goal
     */
    prepareAndInit(dataSources) {
        let _this = this;
        this.prepare(dataSources, () => {
            _this.init(1, 1);
        });
    }

    /**
     * Prepares the WebGL wrapper for being initialized. More concretely,
     * each visualisation is prepared by downloading all necessary files (e.g. shaders),
     * shaders are compiled and other WebGL structures initialized. It is separated from
     * initialization as this must be finished before OSD is ready (we must be ready to draw when the data comes).
     * The idea is to open the protocol for OSD in onPrepared.
     * Shaders are fetched from `visualisation.url` parameter.
     *
     * @param {[string]} dataSources id's of data such that server can understand which image to send (usually paths)
     * @param {number} visIndex index of the initial visualisation
     * @param {function} onPrepared callback to execute after succesfull preparing.
     */
    prepare(dataSources, onPrepared, visIndex=0) {
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
        this._origDataSources = dataSources;
        this._program = visIndex;

        this._prepared = true;
        this.getCurrentProgramIndex(); //resets index

        this._downloadRequiredShaderFactories(this._customShaders).then(
            this._visualisationToProgram.bind(this, this._visualisations[this._program], this._program)
        ).then(
            onPrepared
        );
    }

    /**
     * Initialization. It is separated from preparation as this must be
     * called after OSD is ready. Must be performed after
     * all the prepare() strategy finished: e.g. as onPrepared. Or use prepareAndInit();
     *
     * @param {int} width width of the first tile going to be drawn
     * @param {int} height height of the first tile going to be drawn
     */
    init(width=1, height=1) {
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

        this._forceSwitchShader(null);
        this.ready();
    }

    /**
     * Supported are two modes: show and blend
     * show is the default option, stacking layers by generalized alpha blending
     * blend is a custom alternative, default is a mask (remove background where foreground.a > 0.001)
     *
     * vec4 my_blend(vec4 foreground, vec4 background) {
     *      <<code>> //here goes your blending code
     * }
     *
     * @param code GLSL code to blend - must return vec4() and can use
     * two variables: background, foreground
     */
    changeBlending(code) {
        this.webGLImplementation.setBlendEquation(code);
        this.rebuildVisualisation();
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
     * @param _reset @private
     */
    _forceSwitchShader(i, _reset=true) {
        if (isNaN(i) || i === null || i === undefined) i = this._program;

        if (i >= this._visualisations.length) {
            console.error("Invalid visualisation index ", i, "trying to use index 0...");
            if (i === 0) return;
            i = 0;
        }

        let target = this._visualisations[i];
        if (!this._programs.hasOwnProperty(i)) {
            this._visualisationToProgram(target, i);
        } else if (i !== this._program) {
            this._updateRequiredDataSources(target);
        }

        this._program = i;
        if (target.hasOwnProperty("error")) {
            if (this.supportsHtmlControls()) this._loadHtml(i, this._program);
            this._loadScript(i, this._program);
            this.running = false;
            if (this._visualisations.length < 2) {
                this.onFatalError(target); //considered fatal as there is no valid goal
            } else {
                this.onError(target);
            }
        } else {
            this.running = true;
            if (this.supportsHtmlControls()) this._loadHtml(i, this._program);
            this._loadDebugInfo();
            if (!this._loadScript(i, this._program)) {
                if (!_reset) throw "Could not build visualization";
                return this._forceSwitchShader(i, false); //force reset in errors
            }
            this._toBuffers(this._programs[i], target);
        }
    }

    _loadHtml(visId) {
        let htmlControls = document.getElementById(this.htmlControlsId);
        htmlControls.innerHTML = this._visualisations[visId]._built["html"];
    }

    _loadScript(visId) {
        return WebGLModule.eachValidVisualizationLayer(this._visualisations[visId], layer => layer._renderContext.init());
    }

    _getDebugInfoPanel() {
        return `<div id="test-inner-${this.uniqueId}-webgl">
<b>WebGL Processing I/O (debug mode)</b>
<div id="test-${this.uniqueId}-webgl-log"></div>
Input: <br><div style="border: 1px solid;display: inline-block; overflow: auto;" id='test-${this.uniqueId}-webgl-input'>No input.</div><br>
Output:<br><div style="border: 1px solid;display: inline-block; overflow: auto;" id="test-${this.uniqueId}-webgl-output">No output.</div>`;
    }

    _loadDebugInfo() {
        if (!this.debug) return;

        let container = document.getElementById(`test-${this.uniqueId}-webgl`);
        if (!container) {
            if (!this.htmlControlsId) {
                document.body.innerHTML += `<div id="test-${this.uniqueId}-webgl" style="position:absolute; top:0; right:0; width: 250px">${this._getDebugInfoPanel()}</div>`;
            } else {
                //safe as we do this before handlers are attached
                document.getElementById(this.htmlControlsId).parentElement.innerHTML += `<div id="test-${this.uniqueId}-webgl" style="width: 100%;">${this._getDebugInfoPanel()}</div>`;
            }
        }
    }

    async _renderDebugIO(inputData, outputData) {
        let input = document.getElementById(`test-${this.uniqueId}-webgl-input`);
        let output = document.getElementById(`test-${this.uniqueId}-webgl-output`);

        input.innerHTML = "";
        input.append(WebGLModule.DataLoader.dataToImage(inputData));

        if (outputData) {
            output.innerHTML = "";
            if (!this._ocanvas) this._ocanvas = document.createElement("canvas");
            this._ocanvas.width = outputData.width;
            this._ocanvas.height = outputData.height;
            let octx = this._ocanvas.getContext('2d');
            octx.drawImage(outputData, 0, 0);
            output.append(this._ocanvas);
        } else {
            output.innerHTML = "No output!";
        }
    }

    _buildFailed(visualisation, error) {
        console.error(error);
        visualisation.error = "Failed to compose visualisation.";
        visualisation.desc = error;
    }

    _buildVisualisation(order, visualisation) {
        try {
            let data = this.webGLImplementation.generateVisualisation(order, visualisation, this.supportsHtmlControls());
            if (data.usableShaders < 1) {
                this._buildFailed(visualisation, `Empty visualisation: no valid visualisation has been specified.
<br><b>Visualisation setup:</b></br> <code>${JSON.stringify(visualisation, WebGLModule.jsonReplacer)}</code>
<br><b>Dynamic shader data:</b></br><code>${JSON.stringify(visualisation.data)}</code>`);
                return null;
            }
            data.dziExtendedUrl = data.dataUrls.join(",");
            visualisation._built = data;

            //preventive
            delete visualisation.error;
            delete visualisation.desc;
            return data;
        } catch (error) {
            this._buildFailed(visualisation, error);
        }
        return null;
    }

    _detachShader(program, type) {
        let shader = program[type];
        if (shader) {
            this.gl.detachShader(program, shader);
            this.gl.deleteShader(shader);
            program[type] = null;
        }
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
                throw new Error("There was an error when fetching the shader source: " + url);
            }
            return response.text();
        }).then(text => {
            let script = document.createElement("script");
            script.type = "text/javascript";
            script.text = text;
            script.onerror = e => {
                //Just ignore it, only log into the console.
                console.error("Failed to interpret downloaded shader layer script: ", url, "Ignoring this script...");
            };
            document.body.appendChild(script);
        }).catch(e => {
            console.error("Failed to download and initialize shader " + url, e);
        });
    }

    async _downloadRequiredShaderFactories(shaderSources) {
        for (let source of shaderSources) {
            let ShaderFactoryClass = WebGLModule.ShaderMediator.getClass(source["typedef"]);
            if (!ShaderFactoryClass) {
                await this._downloadAndRegisterShader(source["url"], source["headers"]);
            } else {
                console.warn("Shader source " + source["typedef"] + " already defined!")
            }
        }
    }

    _visualisationToProgram(vis, idx) {
        if (!vis.hasOwnProperty("_built")) {
            vis._built = {};
        }

        this._updateRequiredDataSources(vis);
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
        layer._index = idx;
        layer.visible = layer.visible ?? true;
        layer._renderContext = new ShaderFactoryClass(`${this.uniqueId}${idx}`, layer.params || {}, {
            layer: layer,
            webgl: this.webGLImplementation,
            invalidate: this.resetCallback,
            rebuild: this.rebuildVisualisation.bind(this, undefined)
        });
    }

    _updateRequiredDataSources(vis) {
        //for now just request all data, later decide in the context on what to really send
        //might in the future decide to only request used data, now not supported
        let usedIds = new Set();
        for (let key in vis.shaders) {
            if (vis.shaders.hasOwnProperty(key)) {
                let layer = vis.shaders[key];
                layer.dataReferences.forEach(x => usedIds.add(x));
            }
        }
        usedIds = [...usedIds].sort();
        this._dataSources = [];
        this._dataSourceMapping = new Array(Math.max(this._origDataSources.length, usedIds[usedIds.length-1])).fill(-1);
        for (let id of usedIds) {
            this._dataSourceMapping[id] = this._dataSources.length;
            this._dataSources.push(this._origDataSources[id]);
            while (id > this._dataSourceMapping.length) {
                this._dataSourceMapping.push(-1);
            }
        }
    }

    _processVisualisation(vis, idx) {
        let gl = this.gl,
            err = function (message, description) {
                vis.error = message;
                vis.desc = description;
            };

        let program;

        if (!this._programs.hasOwnProperty(idx)) {
            program = gl.createProgram();
            this._programs[idx] = program;

            let index = 0;
            //init shader factories and unique id's
            for (let key in vis.shaders) {
                if (vis.shaders.hasOwnProperty(key)) {
                    let layer = vis.shaders[key],
                        ShaderFactoryClass = WebGLModule.ShaderMediator.getClass(layer.type);
                    if (layer.type === "none") continue;
                    this._initializeShaderFactory(ShaderFactoryClass, layer, index++);
                }
            }
        } else {
            program = this._programs[idx];
            for (let key in vis.shaders) {
                if (vis.shaders.hasOwnProperty(key)) {
                    let layer = vis.shaders[key];

                    if (!layer.hasOwnProperty("error") && !layer.error &&
                        layer.hasOwnProperty("_renderContext") &&
                        layer._renderContext.constructor.type() === layer.type) {
                        continue;
                    }
                    delete layer.error;
                    delete layer.desc;
                    if (layer.type === "none") continue;
                    let ShaderFactoryClass = WebGLModule.ShaderMediator.getClass(layer.type);
                    this._initializeShaderFactory(ShaderFactoryClass, layer, layer._index);
                }
            }
        }

        if (!Array.isArray(vis.order) || vis.order.length < 1) {
            vis.order = Object.keys(vis.shaders);
        }

        this._buildVisualisation(vis.order, vis);

        if (vis.hasOwnProperty("error") && vis.error) {
            this.visualisationReady(idx, vis);
            return;
        }

        this.constructor.compileShader(gl, program,
            vis._built["vertex_shader"], vis._built["fragment_shader"], err, this.debug);
        this.visualisationReady(idx, vis);
    }

    static compileShader(gl, program, VS, FS, onError, isDebugMode) {
        function ok (kind, status, value, sh) {
            if (!gl['get' + kind + 'Parameter'](value, gl[status + '_STATUS'])) {
                console.error((sh || 'LINK') + ':\n' + gl['get' + kind + 'InfoLog'](value));
                return false;
            }
            return true;
        }

        function useShader(gl, program, data, type) {
            let shader = gl.createShader(gl[type]);
            gl.shaderSource(shader, data);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            program[type] = shader;
            return ok('Shader', 'COMPILE', shader, type);
        }

        function numberLines(str) {
            //https://stackoverflow.com/questions/49714971/how-to-add-line-numbers-to-beginning-of-each-line-in-string-in-javascript
            return str.split('\n').map((line, index) => `${index + 1} ${line}`).join('\n')
        }

        if (!useShader(gl, program, VS, 'VERTEX_SHADER') ||
            !useShader(gl, program, FS, 'FRAGMENT_SHADER')) {
            onError("Unable to use this visualisation.",
                "Compilation of shader failed. For more information, see logs in the console.");
            console.warn("VERTEX SHADER\n", numberLines( VS ));
            console.warn("FRAGMENT SHADER\n", numberLines( FS ));
        } else {
            gl.linkProgram(program);
            if (!ok('Program', 'LINK', program)) {
                onError("Unable to use this visualisation.",
                    "Linking of shader failed. For more information, see logs in the console.");
            } else if (isDebugMode) {
                console.info("FRAGMENT SHADER\n", numberLines( FS ));
            }
        }
    }
}

/**Not a part of API, static functionality to process polygons, not yet fully implemented.**/
WebGLModule.Rasterizer = class {
    constructor() {
        this.canvas = document.createElement("canvas");
        WebGLModule.GlContextFactory._makerInit(this.canvas, {
            glContext: function (canvas) {
                return canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function (wrapper, glContext) {
                return new WebGLModule.RasterizerContext(wrapper, glContext);
            }
        }, this);
        this._program = this.gl.createProgram();
        WebGLModule.compileShader(this.gl, this._program,
            this.webGLImplementation.vs(), this.webGLImplementation.fs(), (err, desc) => {}, true);
        this.webGLImplementation.toBuffers(this._program);
        this.running = true;
        this._initialized = false;
    }


    get isInitialized() {
        return this._initialized;
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

    init(width=1, height=1) {
        if (this._initialized) {
            console.error("Already initialized!");
            return;
        }
        this._initialized = true;
        this.setDimensions(width, height);
        this.running = true;

        //todo create program
        gl.useProgram(program);
    }

    rasterizePolygons(polygonPoints) {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        let canvas = null;
        for (let i = 0; i < polygonPoints.length; i++) {
            let data = polygonPoints[i];
            let indices = this.constructor.earcut(data.object);
            canvas = this.webGLImplementation.toCanvas(this._program, data.object, indices, data.color || [1.0, 1.0, 1.0, 1.0]);
        }
        return canvas;
    }


    /***
     *
     *
     */

    static earcut(data, holeIndices, dim) {

        dim = dim || 2;

        let hasHoles = holeIndices && holeIndices.length,
            outerLen = hasHoles ? holeIndices[0] * dim : data.length,
            outerNode = this.linkedList(data, 0, outerLen, dim, true),
            triangles = [];

        if (!outerNode || outerNode.next === outerNode.prev) return triangles;

        let minX, minY, maxX, maxY, x, y, invSize;

        if (hasHoles) outerNode = this.eliminateHoles(data, holeIndices, outerNode, dim);

        // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
        if (data.length > 80 * dim) {
            minX = maxX = data[0];
            minY = maxY = data[1];

            for (let i = dim; i < outerLen; i += dim) {
                x = data[i];
                y = data[i + 1];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }

            // minX, minY and invSize are later used to transform coords into integers for z-order calculation
            invSize = Math.max(maxX - minX, maxY - minY);
            invSize = invSize !== 0 ? 1 / invSize : 0;
        }

        this.earcutLinked(outerNode, triangles, dim, minX, minY, invSize);
        return triangles;
    }

// create a circular doubly linked list from polygon points in the specified winding order
    static linkedList(data, start, end, dim, clockwise) {
        let i, last;

        if (clockwise === (this.signedArea(data, start, end, dim) > 0)) {
            for (i = start; i < end; i += dim) last = this.insertNode(i, data[i], data[i + 1], last);
        } else {
            for (i = end - dim; i >= start; i -= dim) last = this.insertNode(i, data[i], data[i + 1], last);
        }

        if (last && this.equals(last, last.next)) {
            this.removeNode(last);
            last = last.next;
        }

        return last;
    }

    static filterPoints(start, end) {
        if (!start) return start;
        if (!end) end = start;

        let p = start,
            again;
        do {
            again = false;

            if (!p.steiner && (this.equals(p, p.next) || this.area(p.prev, p, p.next) === 0)) {
                this.removeNode(p);
                p = end = p.prev;
                if (p === p.next) break;
                again = true;

            } else {
                p = p.next;
            }
        } while (again || p !== end);

        return end;
    }

    static earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
        if (!ear) return;

        // interlink polygon nodes in z-order
        if (!pass && invSize) this.indexCurve(ear, minX, minY, invSize);

        let stop = ear,
            prev, next;

        // iterate through ears, slicing them one by one
        while (ear.prev !== ear.next) {
            prev = ear.prev;
            next = ear.next;

            if (invSize ? this.isEarHashed(ear, minX, minY, invSize) : this.isEar(ear)) {
                // cut off the triangle
                triangles.push(prev.i / dim);
                triangles.push(ear.i / dim);
                triangles.push(next.i / dim);

                this.removeNode(ear);

                // skipping the next vertex leads to less sliver triangles
                ear = next.next;
                stop = next.next;

                continue;
            }

            ear = next;

            // if we looped through the whole remaining polygon and can't find any more ears
            if (ear === stop) {
                // try filtering points and slicing again
                if (!pass) {
                    this.earcutLinked(this.filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

                    // if this didn't work, try curing all small self-intersections locally
                } else if (pass === 1) {
                    ear = this.cureLocalIntersections(this.filterPoints(ear), triangles, dim);
                    this.earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);

                    // as a last resort, try splitting the remaining polygon into two
                } else if (pass === 2) {
                    this.splitEarcut(ear, triangles, dim, minX, minY, invSize);
                }

                break;
            }
        }
    }

    static isEar(ear) {
        let a = ear.prev,
            b = ear,
            c = ear.next;

        if (this.area(a, b, c) >= 0) return false; // reflex, can't be an ear

        // now make sure we don't have other points inside the potential ear
        let p = ear.next.next;

        while (p !== ear.prev) {
            if (this.pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                this.area(p.prev, p, p.next) >= 0) return false;
            p = p.next;
        }

        return true;
    }

    static isEarHashed(ear, minX, minY, invSize) {
        let a = ear.prev,
            b = ear,
            c = ear.next;

        if (this.area(a, b, c) >= 0) return false; // reflex, can't be an ear

        // triangle bbox; min & max are calculated like this for speed
        let minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x),
            minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y),
            maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x),
            maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

        // z-order range for the current triangle bbox;
        let minZ = this.zOrder(minTX, minTY, minX, minY, invSize),
            maxZ = this.zOrder(maxTX, maxTY, minX, minY, invSize);

        let p = ear.prevZ,
            n = ear.nextZ;

        // look for points inside the triangle in both directions
        while (p && p.z >= minZ && n && n.z <= maxZ) {
            if (p !== ear.prev && p !== ear.next &&
                this.pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                this.area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;

            if (n !== ear.prev && n !== ear.next &&
                this.pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
                this.area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }

        // look for remaining points in decreasing z-order
        while (p && p.z >= minZ) {
            if (p !== ear.prev && p !== ear.next &&
                this.pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                this.area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;
        }

        // look for remaining points in increasing z-order
        while (n && n.z <= maxZ) {
            if (n !== ear.prev && n !== ear.next &&
                this.pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
                this.area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }

        return true;
    }

// go through all polygon nodes and cure small local self-intersections
    static cureLocalIntersections(start, triangles, dim) {
        let p = start;
        do {
            let a = p.prev,
                b = p.next.next;

            if (!this.equals(a, b) && this.intersects(a, p, p.next, b) && this.locallyInside(a, b) && this.locallyInside(b, a)) {

                triangles.push(a.i / dim);
                triangles.push(p.i / dim);
                triangles.push(b.i / dim);

                // remove two nodes involved
                this.removeNode(p);
                this.removeNode(p.next);

                p = start = b;
            }
            p = p.next;
        } while (p !== start);

        return this.filterPoints(p);
    }

// try splitting polygon into two and triangulate them independently
    static splitEarcut(start, triangles, dim, minX, minY, invSize) {
        // look for a valid diagonal that divides the polygon into two
        let a = start;
        do {
            let b = a.next.next;
            while (b !== a.prev) {
                if (a.i !== b.i && this.isValidDiagonal(a, b)) {
                    // split the polygon in two by the diagonal
                    let c = this.splitPolygon(a, b);

                    // filter colinear points around the cuts
                    a = this.filterPoints(a, a.next);
                    c = this.filterPoints(c, c.next);

                    // run earcut on each half
                    this.earcutLinked(a, triangles, dim, minX, minY, invSize);
                    this.earcutLinked(c, triangles, dim, minX, minY, invSize);
                    return;
                }
                b = b.next;
            }
            a = a.next;
        } while (a !== start);
    }

// link every hole into the outer loop, producing a single-ring polygon without holes
    static eliminateHoles(data, holeIndices, outerNode, dim) {
        let queue = [],
            i, len, start, end, list;

        for (i = 0, len = holeIndices.length; i < len; i++) {
            start = holeIndices[i] * dim;
            end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            list = this.linkedList(data, start, end, dim, false);
            if (list === list.next) list.steiner = true;
            queue.push(this.getLeftmost(list));
        }

        queue.sort(this.compareX);

        // process holes from left to right
        for (i = 0; i < queue.length; i++) {
            outerNode = this.eliminateHole(queue[i], outerNode);
            outerNode = this.filterPoints(outerNode, outerNode.next);
        }

        return outerNode;
    }

    static compareX(a, b) {
        return a.x - b.x;
    }

// find a bridge between vertices that connects hole with an outer ring and and link it
    static eliminateHole(hole, outerNode) {
        let bridge = this.findHoleBridge(hole, outerNode);
        if (!bridge) {
            return outerNode;
        }

        let bridgeReverse = this.splitPolygon(bridge, hole);

        // filter collinear points around the cuts
        let filteredBridge = this.filterPoints(bridge, bridge.next);
        this.filterPoints(bridgeReverse, bridgeReverse.next);

        // Check if input node was removed by the filtering
        return outerNode === bridge ? filteredBridge : outerNode;
    }

// David Eberly's algorithm for finding a bridge between hole and outer polygon
    static findHoleBridge(hole, outerNode) {
        let p = outerNode,
            hx = hole.x,
            hy = hole.y,
            qx = -Infinity,
            m;

        // find a segment intersected by a ray from the hole's leftmost point to the left;
        // segment's endpoint with lesser x will be potential connection point
        do {
            if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
                let x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
                if (x <= hx && x > qx) {
                    qx = x;
                    if (x === hx) {
                        if (hy === p.y) return p;
                        if (hy === p.next.y) return p.next;
                    }
                    m = p.x < p.next.x ? p : p.next;
                }
            }
            p = p.next;
        } while (p !== outerNode);

        if (!m) return null;

        if (hx === qx) return m; // hole touches outer segment; pick leftmost endpoint

        // look for points inside the triangle of hole point, segment intersection and endpoint;
        // if there are no points found, we have a valid connection;
        // otherwise choose the point of the minimum angle with the ray as connection point

        let stop = m,
            mx = m.x,
            my = m.y,
            tanMin = Infinity,
            tan;

        p = m;

        do {
            if (hx >= p.x && p.x >= mx && hx !== p.x &&
                this.pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {

                tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

                if (this.locallyInside(p, hole) &&
                    (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && this.sectorContainsSector(m, p)))))) {
                    m = p;
                    tanMin = tan;
                }
            }

            p = p.next;
        } while (p !== stop);

        return m;
    }

// whether sector in vertex m contains sector in vertex p in the same coordinates
    static sectorContainsSector(m, p) {
        return this.area(m.prev, m, p.prev) < 0 && this.area(p.next, m, m.next) < 0;
    }

// interlink polygon nodes in z-order
    static indexCurve(start, minX, minY, invSize) {
        let p = start;
        do {
            if (p.z === null) p.z = this.zOrder(p.x, p.y, minX, minY, invSize);
            p.prevZ = p.prev;
            p.nextZ = p.next;
            p = p.next;
        } while (p !== start);

        p.prevZ.nextZ = null;
        p.prevZ = null;

        this.sortLinked(p);
    }

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
    static sortLinked(list) {
        let i, p, q, e, tail, numMerges, pSize, qSize,
            inSize = 1;

        do {
            p = list;
            list = null;
            tail = null;
            numMerges = 0;

            while (p) {
                numMerges++;
                q = p;
                pSize = 0;
                for (i = 0; i < inSize; i++) {
                    pSize++;
                    q = q.nextZ;
                    if (!q) break;
                }
                qSize = inSize;

                while (pSize > 0 || (qSize > 0 && q)) {

                    if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
                        e = p;
                        p = p.nextZ;
                        pSize--;
                    } else {
                        e = q;
                        q = q.nextZ;
                        qSize--;
                    }

                    if (tail) tail.nextZ = e;
                    else list = e;

                    e.prevZ = tail;
                    tail = e;
                }

                p = q;
            }

            tail.nextZ = null;
            inSize *= 2;

        } while (numMerges > 1);

        return list;
    }

// z-order of a point given coords and inverse of the longer side of data bbox
    static zOrder(x, y, minX, minY, invSize) {
        // coords are transformed into non-negative 15-bit integer range
        x = 32767 * (x - minX) * invSize;
        y = 32767 * (y - minY) * invSize;

        x = (x | (x << 8)) & 0x00FF00FF;
        x = (x | (x << 4)) & 0x0F0F0F0F;
        x = (x | (x << 2)) & 0x33333333;
        x = (x | (x << 1)) & 0x55555555;

        y = (y | (y << 8)) & 0x00FF00FF;
        y = (y | (y << 4)) & 0x0F0F0F0F;
        y = (y | (y << 2)) & 0x33333333;
        y = (y | (y << 1)) & 0x55555555;

        return x | (y << 1);
    }

// find the leftmost node of a polygon ring
    static getLeftmost(start) {
        let p = start,
            leftmost = start;
        do {
            if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
            p = p.next;
        } while (p !== start);

        return leftmost;
    }

// check if a point lies within a convex triangle
    static pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
        return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
            (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
            (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
    }

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
    static isValidDiagonal(a, b) {
        return a.next.i !== b.i && a.prev.i !== b.i && !this.intersectsPolygon(a, b) && // dones't intersect other edges
            (this.locallyInside(a, b) && this.locallyInside(b, a) && this.middleInside(a, b) && // locally visible
                (this.area(a.prev, a, b.prev) || this.area(a, b.prev, b)) || // does not create opposite-facing sectors
                this.equals(a, b) && this.area(a.prev, a, a.next) > 0 && this.area(b.prev, b, b.next) > 0); // special zero-length case
    }

// signed area of a triangle
    static area(p, q, r) {
        return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    }

// check if two points are equal
    static equals(p1, p2) {
        return p1.x === p2.x && p1.y === p2.y;
    }

// check if two segments intersect
    static intersects(p1, q1, p2, q2) {
        let o1 = this.sign(this.area(p1, q1, p2));
        let o2 = this.sign(this.area(p1, q1, q2));
        let o3 = this.sign(this.area(p2, q2, p1));
        let o4 = this.sign(this.area(p2, q2, q1));

        if (o1 !== o2 && o3 !== o4) return true; // general case

        if (o1 === 0 && this.onSegment(p1, p2, q1)) return true; // p1, q1 and p2 are collinear and p2 lies on p1q1
        if (o2 === 0 && this.onSegment(p1, q2, q1)) return true; // p1, q1 and q2 are collinear and q2 lies on p1q1
        if (o3 === 0 && this.onSegment(p2, p1, q2)) return true; // p2, q2 and p1 are collinear and p1 lies on p2q2
        if (o4 === 0 && this.onSegment(p2, q1, q2)) return true; // p2, q2 and q1 are collinear and q1 lies on p2q2

        return false;
    }

// for collinear points p, q, r, check if point q lies on segment pr
    static onSegment(p, q, r) {
        return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    }

    static sign(num) {
        return num > 0 ? 1 : num < 0 ? -1 : 0;
    }

// check if a polygon diagonal intersects any polygon segments
    static intersectsPolygon(a, b) {
        let p = a;
        do {
            if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
                this.intersects(p, p.next, a, b)) return true;
            p = p.next;
        } while (p !== a);

        return false;
    }

// check if a polygon diagonal is locally inside the polygon
    static locallyInside(a, b) {
        return this.area(a.prev, a, a.next) < 0 ?
            this.area(a, b, a.next) >= 0 && this.area(a, a.prev, b) >= 0 :
            this.area(a, b, a.prev) < 0 || this.area(a, a.next, b) < 0;
    }

// check if the middle point of a polygon diagonal is inside the polygon
    static middleInside(a, b) {
        let p = a,
            inside = false,
            px = (a.x + b.x) / 2,
            py = (a.y + b.y) / 2;
        do {
            if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
                (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
                inside = !inside;
            p = p.next;
        } while (p !== a);

        return inside;
    }

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
// if one belongs to the outer ring and another to a hole, it merges it into a single ring
    static splitPolygon(a, b) {
        let a2 = new this.Node(a.i, a.x, a.y),
            b2 = new this.Node(b.i, b.x, b.y),
            an = a.next,
            bp = b.prev;

        a.next = b;
        b.prev = a;

        a2.next = an;
        an.prev = a2;

        b2.next = a2;
        a2.prev = b2;

        bp.next = b2;
        b2.prev = bp;

        return b2;
    }

// create a node and optionally link it with previous one (in a circular doubly linked list)
    static insertNode(i, x, y, last) {
        let p = new this.Node(i, x, y);

        if (!last) {
            p.prev = p;
            p.next = p;

        } else {
            p.next = last.next;
            p.prev = last;
            last.next.prev = p;
            last.next = p;
        }
        return p;
    }

    static removeNode(p) {
        p.next.prev = p.prev;
        p.prev.next = p.next;

        if (p.prevZ) p.prevZ.nextZ = p.nextZ;
        if (p.nextZ) p.nextZ.prevZ = p.prevZ;
    }

    static Node(i, x, y) {
        // vertex index in coordinates array
        this.i = i;

        // vertex coordinates
        this.x = x;
        this.y = y;

        // previous and next vertex nodes in a polygon ring
        this.prev = null;
        this.next = null;

        // z-order curve value
        this.z = null;

        // previous and next nodes in z-order
        this.prevZ = null;
        this.nextZ = null;

        // indicates whether this is a steiner point
        this.steiner = false;
    }

// return a percentage difference between the polygon area and its triangulation area;
// used to verify correctness of triangulation
    static deviation = function (data, holeIndices, dim, triangles) {
        let hasHoles = holeIndices && holeIndices.length;
        let outerLen = hasHoles ? holeIndices[0] * dim : data.length;

        let polygonArea = Math.abs(this.signedArea(data, 0, outerLen, dim));
        if (hasHoles) {
            for (var i = 0, len = holeIndices.length; i < len; i++) {
                let start = holeIndices[i] * dim;
                let end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
                polygonArea -= Math.abs(this.signedArea(data, start, end, dim));
            }
        }

        let trianglesArea = 0;
        for (i = 0; i < triangles.length; i += 3) {
            let a = triangles[i] * dim;
            let b = triangles[i + 1] * dim;
            let c = triangles[i + 2] * dim;
            trianglesArea += Math.abs(
                (data[a] - data[c]) * (data[b + 1] - data[a + 1]) -
                (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
        }

        return polygonArea === 0 && trianglesArea === 0 ? 0 :
            Math.abs((trianglesArea - polygonArea) / polygonArea);
    };

    static signedArea(data, start, end, dim) {
        let sum = 0;
        for (let i = start, j = end - dim; i < end; i += dim) {
            sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
            j = i;
        }
        return sum;
    }

// turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
    static flatten = function (data) {
        let dim = data[0][0].length,
            result = {vertices: [], holes: [], dimensions: dim},
            holeIndex = 0;

        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < data[i].length; j++) {
                for (let d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
            }
            if (i > 0) {
                holeIndex += data[i - 1].length;
                result.holes.push(holeIndex);
            }
        }
        return result;
    };
};
