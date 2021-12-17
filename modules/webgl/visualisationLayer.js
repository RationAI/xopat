WebGLModule.ShaderMediator = class {

    static _layers = {};

    static registerLayer(LayerRendererClass) {
        if (WebGLModule.ShaderMediator._layers.hasOwnProperty(LayerRendererClass.type())) {
            console.warn("Registering an already existing layer renderer:", LayerRendererClass.type());
        }
        WebGLModule.ShaderMediator._layers[LayerRendererClass.type()] = LayerRendererClass;
    }

    static getClass(id) {
        return WebGLModule.ShaderMediator._layers[id];
    }

    static availableShaders() {
        return Object.values(WebGLModule.ShaderMediator._layers);
    }
}


WebGLModule.VisualisationLayer = class {

    /**
     * Override **static** type definition
     * The class must be registered using the type
     */
    static type() {
        throw "Type must be specified!";
    }

    /**
     * Override **static** name definition
     */
    static name() {
        throw "Name must be specified!";
    }

    /**
     * Global supported options
     * @param options
     *  options.channel: "r", "g" or "b" channel to sample, default "r"
     */
    constructor(options) {
        if (options.hasOwnProperty("channel")) {
            this.__channel = options.__channel;
        }

        if (!["r", "g", "b", "a"].some(ch => this.__channel === ch, this)) {
            this.__channel = "r";
        }
    }

    /**
     * Code placed outside fragment shader's main(...), default none.
     *
     *  NOTE THAT ANY VARIABLE NAME
     *  WITHIN THE GLOBAL SPACE MUST BE
     *  ESCAPED WITH UNIQUE ID: this.uid
     *
     *  DO NOT SAMPLE TEXTURE MANUALLY: use
     *  this.sample(...) or this.sampleChannel(...) to generate the code
     *
     */
    getFragmentShaderDefinition() {
        return "";
    }

    /**
     * Code placed inside fragment shader's main(...)
     *
     *  NOTE THAT ANY VARIABLE NAME
     *  WITHIN THE GLOBAL SPACE MUST BE
     *  ESCAPED WITH UNIQUE ID: this.uid
     *
     *  DO NOT SAMPLE TEXTURE MANUALLY: use
     *  this.sample(...) or this.sampleChannel(...) to generate the code
     *
     */
    getFragmentShaderExecution() {
        throw "This function must be implemented!";
    }

    /**
     * Called when an image is rendered
     * @param program WebglProgram instance
     * @param dimension canvas dimension {width, height}
     * @param gl WebGL Context
     */
    glDrawing(program, dimension, gl) {
    }

    /**
     * Called when associated webgl program is switched to
     * @param program WebglProgram instance
     * @param gl WebGL Context
     */
    glLoaded(program, gl) {
    }

    /**
     * This function is called once at
     * the beginning of the layer use
     * (might be multiple times)
     */
    init() {
    }

    htmlControls() {
        return "";
    }

    ////////////////////////////////////
    ////////// AVAILABLE API ///////////
    ////////////////////////////////////

    /**
     * Parses value to a float string representation with given precision (length after decimal)
     */
    toShaderFloatString(value, defaultValue, precisionLen=5) {
        if (isNaN(Number.parseInt(precisionLen)) || precisionLen < 0 || precisionLen > 9) {
            precisionLen = 5;
        }
        try {
            return value.toFixed(precisionLen);
        } catch (e) {
            return defaultValue.toFixed(precisionLen);
        }
    }

    /**
     * Evaluates option flag, e.g. any value that indicates boolean 'true'
     * @param {*} value value to interpret
     * @return {boolean} true if the value is considered boolean 'true'
     */
    isFlag(value) {
        return value == "1" || value == true || value == "true";
    }

    isFlagOrMissing(value) {
        return value === undefined || this.isFlag(value);
    }

    /**
     * Returns array of (GLSL standard) rgb color parsed from the string
     * from its hexadecimal string representation
     * @param {string} toParse string to parse (with or without '#')
     * @param {number[]} defaultValue to return on error
     * @return {number[]} int array: [r, g, b] color with 0-1 range
     */
    toRGBShaderColorFromString(toParse, defaultValue) {
        try {
            let index = toParse.startsWith("#") ? 1 : 0;
            return [
                parseInt(toParse.slice(index, index+2), 16) / 255,
                parseInt(toParse.slice(index+2, index+4), 16) / 255,
                parseInt(toParse.slice(index+4, index+6), 16) / 255
            ];
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Returns string representation of a (GLSL standard) rgb color such as '#ff0000'
     * @param {number[]} rgbArray [r, g, b] with 0-1 range values to parse
     * @param {string} defaultValue value returned on error
     * @return {string} parsed rgb string representation
     */
    toStringFromRGBShaderColor(rgbArray, defaultValue) {
        try {
            return "#" + Math.round(rgbArray[0] * 255).toString(16).padStart(2, "0") +
                Math.round(rgbArray[1] * 255).toString(16).padStart(2, "0") +
                Math.round(rgbArray[2] * 255).toString(16).padStart(2, "0");
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Returns array of (GLSL standard) rgb color parsed from the string
     * from its hexadecimal string representation
     * @param {string} toParse string to parse (with or without '#')
     * @param {number[]} defaultValue to return on error
     * @return {number[]} int array: [r, g, b] color with 0-1 range
     */
    toRGBColorFromString(toParse, defaultValue) {
        try {
            let index = toParse.startsWith("#") ? 1 : 0;
            return [
                parseInt(toParse.slice(index, index+2), 16),
                parseInt(toParse.slice(index+2, index+4), 16),
                parseInt(toParse.slice(index+4, index+6), 16)
            ];
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Returns string representation of a (GLSL standard) rgb color such as '#ff0000'
     * @param {number[]} rgbArray [r, g, b] with 0-1 range values to parse
     * @param {string} defaultValue value returned on error
     * @return {string} parsed rgb string representation
     */
    toStringFromRGBColor(rgbArray, defaultValue) {
        try {
            return "#" + Math.round(rgbArray[0]).toString(16).padStart(2, "0") +
                Math.round(rgbArray[1]).toString(16).padStart(2, "0") +
                Math.round(rgbArray[2]).toString(16).padStart(2, "0");
        } catch (e) {
            return defaultValue;
        }
    }

    toRGBColorFromShaderRGBColor(rgbArray) {
        return rgbArray.map(x => x*255);
    }

    toShaderRGBColorFromRGBColor(rgbArray) {
        return rgbArray.map(x => x/255);
    }

    /**
     * Most values are processed similarly
     *  - create this.varName and initialize it
     *  - set up html node to reflect the value
     *  - create onchange event to update shaders
     * @param {string} varName
     * @param {string} htmlId
     * @param {*} defaultValue default value to use if no cache available
     * @param {function} postprocess function applied on the html node value, result stored in this[varName]
     */
    simpleControlInit(varName, htmlId, defaultValue, postprocess=undefined) {
        const _this = this;
        let updater = postprocess === undefined ? function updater(e) {
            _this[varName] = $(e.target).val();
            _this.storeProperty(varName, _this[varName]);
            _this.invalidate();
        } : function updater(e) {
            _this[varName] = postprocess($(e.target).val());
            _this.storeProperty(varName, _this[varName]);
            _this.invalidate();
        };
        let node = $(htmlId);
        this[varName] = this.loadProperty(varName, defaultValue);
        node.val(this[varName]);
        node.change(updater);
    }

    /**
     * Same as simple control, but some elements are controllable with two HTML inputs
     * @param {string} varName
     * @param {string} html1Id
     * @param {string} html2Id
     * @param {*} defaultValue default value to use if no cache available
     * @param {function} postprocess function applied on the html node value, result stored in this[varName]
     */
    twoElementInit(varName, html1Id, html2Id, defaultValue, postprocess=undefined) {
        const _this = this;
        let updater = postprocess === undefined ? function updater(e) {
            _this[varName] = $(e.target).val();
            $(html1Id).val(_this[varName]);
            $(html2Id).val(_this[varName]);
            _this.storeProperty(varName, _this[varName]);
            _this.invalidate();
        } : function updater(e) {
            _this[varName] = postprocess($(e.target).val());
            $(html1Id).val(_this[varName]);
            $(html2Id).val(_this[varName]);
            _this.storeProperty(varName, _this[varName]);
            _this.invalidate();
        };

        let node1 = $(html1Id);
        let node2 = $(html2Id);
        this[varName] = this.loadProperty(varName, defaultValue);

        node1.val(this[varName]);
        node2.val(this[varName]);
        node1.change(updater);
        node2.change(updater);
    }

    /**
     * Alias for sampleReferenced(textureCoords, 0)
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @return {string} code for appropriate texture sampling within the shader
     */
    sample(textureCoords) {
        return this.sampleReferenced(textureCoords, 0);
    }

    /**
     * Alias for sampleChannelReferenced(textureCoords, 0)
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @return {string} code for appropriate texture sampling within the shader,
     *                  where only one channel is extracted
     */
    sampleChannel(textureCoords) {
        return this.sampleChannelReferenced(textureCoords, 0);
    }

    /**
     * Return code for appropriate sampling of the texture bound to this shader
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @param {number} otherDataIndex index of the data in self.dataReference JSON array
     * @return {string} code for appropriate texture sampling within the shader or vec4(.0) if
     *                  the reference is not valid
     */
    sampleReferenced(textureCoords, otherDataIndex) {
        let refs = this.__visualisationLayer.dataReferences;
        if (otherDataIndex >= refs.length) {
            return 'vec4(0.0)';
        }

        return this.webglContext.getTextureSamplingCode(refs[otherDataIndex], textureCoords);
    }

    /**
     * Sample only one channel (which is defined in options)
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @param {number} otherDataIndex index of the data in self.dataReference JSON array
     * @return {string} code for appropriate texture sampling within the shader,
     *                  where only one channel is extracted or float with zero value if
     *                  the reference is not valid
     */
    sampleChannelReferenced(textureCoords, otherDataIndex) {
        return `${this.sampleReferenced(textureCoords, otherDataIndex)}.${this.__channel}`;
    }

    /**
     * For error detection, how many textures are available
     * @return {number} number of textures available
     */
    dataSourcesCount() {
        return this.__visualisationLayer.dataReferences.length;
    }

    /**
     * Load value
     * @param name value name
     * @param defaultValue default value if no stored value available
     * @return stored value or default value
     */
    loadProperty(name, defaultValue) {
        if (this.__visualisationLayer.cache.hasOwnProperty(name)) {
            return this.__visualisationLayer.cache[name];
        }
        return defaultValue;
    }

    /**
     * Store value
     * @param name value name
     * @param value value
     */
    storeProperty(name, value) {
        this.__visualisationLayer.cache[name] = value;
    }

    ////////////////////////////////////
    ////////// PRIVATE /////////////////
    ////////////////////////////////////

    _setContextVisualisationLayer(visualisationLayer, uniqueId) {
        this.uid = uniqueId;
        this.__visualisationLayer = visualisationLayer;
    }

    _setWebglContext(webglContext) {
        this.webglContext = webglContext;
    }

    _setResetCallback(reset) {
        this.invalidate = reset;
    }
}