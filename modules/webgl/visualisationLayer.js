/**
 * Shader sharing point
 * @type {WebGLModule.ShaderMediator}
 */
WebGLModule.ShaderMediator = class {

    static _layers = {};

    /**
     * Register shader
     * @param {function} LayerRendererClass class extends WebGLModule.VisualisationLayer
     */
    static registerLayer(LayerRendererClass) {
        if (this._layers.hasOwnProperty(LayerRendererClass.type())) {
            console.warn("Registering an already existing layer renderer:", LayerRendererClass.type());
        }
        if (!WebGLModule.VisualisationLayer.isPrototypeOf(LayerRendererClass)) {
            throw `${LayerRendererClass} does not inherit from VisualisationLayer!`;
        }
        this._layers[LayerRendererClass.type()] = LayerRendererClass;
    }

    /**
     * Get the shader class by type id
     * @param {string} id
     * @return {function} class extends WebGLModule.VisualisationLayer
     */
    static getClass(id) {
        return this._layers[id];
    }

    /**
     * Get all available shaders
     * @return {function[]} classes that extend WebGLModule.VisualisationLayer
     */
    static availableShaders() {
        return Object.values(this._layers);
    }
};

/**
 * Abstract interface to any Shader
 * @type {WebGLModule.VisualisationLayer}
 */
WebGLModule.VisualisationLayer = class {

    /**
     * Override **static** type definition
     * The class must be registered using the type
     * @returns {string} unique id under which is the shader registered
     */
    static type() {
        throw "Type must be specified!";
    }

    /**
     * Override **static** name definition
     * @returns {string} name of the shader (user-friendly)
     */
    static name() {
        throw "Name must be specified!";
    }

    /**
     * Provide description
     * @returns {string} optional description
     */
    static description() {
        return "WebGL shader";
    }

    /**
     * Declare the number of data sources it reads from
     * @return {[{}]} array of source specifications:
     *  channels: the number of channels expected at most in the
     *  [optional] description: the description of the source - what it is being used for
     */
    static sources() {
        return [{channels: 1}];
    }

    /**
     * Declare supported controls by a particular shader
     * each controls is automatically created for the shader
     * and this[controlId] instance set
     * structure:
     * {
     *     controlId: {
               default: {type: <>, title: <>, interactive: true|false...},
               accepts: (type, instance) => <>,
               required: {type: <> ...} [OPTIONAL]
     *     }, ...
     * }
     *
     * use: controlId: false to disable a specific control (e.g. all shaders
     *  support opacity by default - use to remove this feature)
     * @member {object}
     */
    static defaultControls = {};

    /**
     * Global supported options
     * @param {string} id unique ID among all webgl instances and shaders
     * @param {object} options
     *  options.channel: "r", "g" or "b" channel to sample, default "r"
     *  options.use_mode: blending mode - default alpha ("show"), custom blending ("mask") and clipping mask blend ("mask_clip")
     *  options.use_[*]: filtering, gamma/exposure/logscale with a float filter parameter (e.g. "use_gamma" : 1.5)
     * @param {object} privateOptions options that should not be touched, necessary for linking the layer to the core
     */
    constructor(id, options, privateOptions) {
        this.uid = id;
        this._setContextVisualisationLayer(privateOptions.layer);
        this.webglContext = privateOptions.webgl;
        this.invalidate = privateOptions.invalidate;
        //use with care...
        this._rebuild = privateOptions.rebuild;

        this.resetChannel(options);
        this.resetMode(options);
        this.resetFilters(options);
        this._buildControls(options);
    }

    /**
     * Code placed outside fragment shader's main(...).
     * By default, it includes all definitions of
     * controls you defined in defaultControls
     *
     *  NOTE THAT ANY VARIABLE NAME
     *  WITHIN THE GLOBAL SPACE MUST BE
     *  ESCAPED WITH UNIQUE ID: this.uid
     *
     *  DO NOT SAMPLE TEXTURE MANUALLY: use
     *  this.sample(...) or this.sampleChannel(...) to generate the code
     *
     *  WHEN OVERRIDING, INCLUDE THE OUTPUT OF THIS METHOD AT THE BEGINNING OF THE NEW OUTPUT.
     *
     * @return {string}
     */
    getFragmentShaderDefinition() {
        let controls = this.constructor.defaultControls,
            html = [];
        for (let control in controls) {
            if (this.hasOwnProperty(control)) {
                let code = this[control].define()?.trim();
                if (code) html.push(code);
            }
        }
        return html.join("\n");
    }

    /**
     * Code executed to create the output color. The code
     * must always return a vec4 value, otherwise the visualization
     * will fail to compile (this code actually runs inside a vec4 function).
     *
     *  DO NOT SAMPLE TEXTURE MANUALLY: use
     *  this.sample(...) or this.sampleChannel(...) to generate the code
     *
     * @return {string}
     */
    getFragmentShaderExecution() {
        throw "This function must be implemented!";
    }

    /**
     * Called when an image is rendered
     * @param {WebGLProgram} program WebglProgram instance
     * @param {object} dimension canvas dimension {width, height}
     * @param {number} dimension.width
     * @param {number} dimension.height
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    glDrawing(program, dimension, gl) {
        let controls = this.constructor.defaultControls,
            html = [];
        for (let control in controls) {
            if (this.hasOwnProperty(control)) {
                this[control].glDrawing(program, dimension, gl);
            }
        }
    }

    /**
     * Called when associated webgl program is switched to
     * @param {WebGLProgram} program WebglProgram instance
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl WebGL Context
     */
    glLoaded(program, gl) {
        let controls = this.constructor.defaultControls,
            html = [];
        for (let control in controls) {
            if (this.hasOwnProperty(control)) {
                this[control].glLoaded(program, gl);
            }
        }
    }

    /**
     * This function is called once at
     * the beginning of the layer use
     * (might be multiple times), after htmlControls()
     */
    init() {
        let controls = this.constructor.defaultControls,
            html = [];
        for (let control in controls) {
            if (this.hasOwnProperty(control)) {
                this[control].init();
            }
        }
    }

    /**
     * Get the shader UI controls
     * @return {string} HTML controls for the particular shader
     */
    htmlControls() {
        let controls = this.constructor.defaultControls,
            html = [];
        for (let control in controls) {
            if (this.hasOwnProperty(control)) {
                html.push(this[control].toHtml(true));
            }
        }
        return html.join("");
    }

    /************************** FILTERING ****************************/
    //not really modular
    //add your filters here if you want... function that takes parameter (number)
    //and returns prefix and suffix to compute oneliner filter
    //should start as 'use_[name]' for namespace collision avoidance (params object)
    //expression should be wrapped in parenthesses for safety: ["(....(", ")....)"] in the middle the
    // filtered variable will be inserted, notice pow does not need inner brackets since its an argument...
    //note: pow avoided in gamma, not usable on vectors, we use pow(x, y) === exp(y*log(x))
    static filters = {
        use_gamma: (x) => ["exp(log(", `) / ${this.toShaderFloatString(x, 1)})`],
        use_exposure: (x) => ["(1.0 - exp(-(", `)* ${this.toShaderFloatString(x, 1)}))`],
        use_logscale: (x) => {
            x = this.toShaderFloatString(x, 1);
            return [`((log(${x} + (`, `)) - log(${x})) / (log(${x}+1.0)-log(${x})))`]
        }
    };

    /**
     * Available filters (use_[name])
     * @type {{use_exposure: string, use_gamma: string, use_logscale: string}}
     */
    static filterNames = {
        use_gamma: "Gamma",
        use_exposure: "Exposure",
        use_logscale: "Logarithmic scale"
    };

    /**
     * Available use_mode modes
     * @type {{show: string, mask: string}}
     */
    static modes = {
        show: "show",
        mask: "blend",
        mask_clip: "blend_clip"
    };

    /**
     * Include GLSL shader code on global scope
     * (e.g. define function that is repeatedly used)
     * does not have to use unique ID extended names as this code is included only once
     * @param {string} key a key under which is the code stored, so that the same key is not loaded twice
     * @param {string} code GLSL code to add to the shader
     */
    includeGlobalCode(key, code) {
        let container = this.constructor.__globalIncludes;
        if (!container.hasOwnProperty(key)) container[key] = code;
    }

    /**
     * Parses value to a float string representation with given precision (length after decimal)
     * @param {number} value value to convert
     * @param {number} defaultValue default value on failure
     * @param {number} precisionLen number of decimals
     * @return {string}
     */
    toShaderFloatString(value, defaultValue, precisionLen=5) {
        return this.constructor.toShaderFloatString(value, defaultValue, precisionLen);
    }

    /**
     * Parses value to a float string representation with given precision (length after decimal)
     * @param {number} value value to convert
     * @param {number} defaultValue default value on failure
     * @param {number} precisionLen number of decimals
     * @return {string}
     */
    static toShaderFloatString(value, defaultValue, precisionLen=5) {
        if (!Number.isInteger(precisionLen) || precisionLen < 0 || precisionLen > 9) {
            precisionLen = 5;
        }
        try {
            return value.toFixed(precisionLen);
        } catch (e) {
            return defaultValue.toFixed(precisionLen);
        }
    }

    /**
     * Add your shader part result
     * @param {string} output, GLSL code to output from the shader, output must be a vec4
     * @deprecated todo remove
     */
    render(output) {
        console.warn("WebGLModule:: VisualisationLayer::render deprecated!");
        return `${this.__mode}(${output});`;
    }

    /**
     * Apply global filters on value
     * @param {string} value GLSL code string, value to filter
     * @return {string} filtered value (GLSL oneliner without ';')
     */
    filter(value) {
        return `${this.__scalePrefix}${value}${this.__scaleSuffix}`;
    }

    /**
     * Alias for sampleReferenced(textureCoords, 0)
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @param {number} otherDataIndex index of the data in self.dataReference JSON array
     * @param {boolean} raw whether to output raw value from the texture (do not apply filters)
     * @return {string} code for appropriate texture sampling within the shader
     */
    sample(textureCoords, otherDataIndex=0, raw=false) {
        let refs = this.__visualisationLayer.dataReferences;
        if (otherDataIndex >= refs.length) {
            return 'vec4(0.0)';
        }
        let sampled = this.webglContext.getTextureSamplingCode(refs[otherDataIndex], textureCoords);
        if (raw) return sampled;
        return this.filter(sampled);
    }

    /**
     * Sample only one channel (which is defined in options)
     * @param {string} textureCoords valid GLSL vec2 object as string
     * @param {number} otherDataIndex index of the data in self.dataReference JSON array
     * @param {boolean} raw whether to output raw value from the texture (do not apply filters)
     * @return {string} code for appropriate texture sampling within the shader,
     *                  where only one channel is extracted or float with zero value if
     *                  the reference is not valid
     */
    sampleChannel(textureCoords, otherDataIndex=0, raw=false) {
        let refs = this.__visualisationLayer.dataReferences;
        const chan = this.__channels[otherDataIndex] || this.__channel;

        if (otherDataIndex >= refs.length) {
            switch (chan.length) {
                case 1: return ".0";
                case 2: return "vec2(.0)";
                case 3: return "vec3(.0)";
                default:
                    return 'vec4(0.0)';
            }
        }
        let sampled = `${this.webglContext.getTextureSamplingCode(refs[otherDataIndex], textureCoords)}.${chan}`;
        if (raw) return sampled;
        return this.filter(sampled);
    }

    /**
     * Get texture size
     * @param {number} index index of the data in self.dataReference JSON array
     * @return {string} vec2 GLSL value with width and height of the texture
     */
    textureSize(index=0) {
        let refs = this.__visualisationLayer.dataReferences;
        if (index >= refs.length) {
            return 'vec2(0.0)';
        }
        return this.webglContext.getTextureDimensionXY(refs[index]);
    }

    /**
     * For error detection, how many textures are available
     * @return {number} number of textures available
     */
    dataSourcesCount() {
        return this.__visualisationLayer.dataReferences.length;
    }

    /**
     * Load value, useful for controls value caching
     * @param {string} name value name
     * @param {string} defaultValue default value if no stored value available
     * @return {string} stored value or default value
     */
    loadProperty(name, defaultValue) {
        let selfType = this.constructor.type();
        if (!this.__visualisationLayer) return defaultValue;
        if (this.__visualisationLayer.cache[selfType].hasOwnProperty(name)) {
            return this.__visualisationLayer.cache[selfType][name];
        }
        return defaultValue;
    }

    /**
     * Store value, useful for controls value caching
     * @param {string} name value name
     * @param {*} value value
     */
    storeProperty(name, value) {
        this.__visualisationLayer.cache[this.constructor.type()][name] = value;
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
     * Get the mode we operate in
     * @return {string} mode
     */
    get mode() {
        return this._mode;
    }

    /**
     * Returns number of textures available to this shader
     * @return {number} number of textures available
     */
    get texturesCount() {
        return this.__visualisationLayer.dataReferences.length;
    }

    /**
     * Set filter value
     * @param filter filter name
     * @param value value of the filter
     */
    setFilterValue(filter, value) {
        if (!this.constructor.filterNames.hasOwnProperty(filter)) {
            console.error("Invalid filter name.", filter);
            return;
        }
        this.storeProperty(filter, value);
    }

    /**
     * Get the filter value (alias for loadProperty(...)
     * @param {string} filter filter to read the value of
     * @param {string} defaultValue
     * @return {string} stored filter value or defaultValue if no value available
     */
    getFilterValue(filter, defaultValue) {
        return this.loadProperty(filter, defaultValue);
    }

    /**
     * Set sampling channel
     * @param {object} options
     * @param {string} options.use_channel chanel to sample
     */
    resetChannel(options) {
        //todo verify (and test) also against required channel count!

        const parseChannel = (name, def) => {
            if (options.hasOwnProperty(name)) {
                let channel = this.loadProperty(name, options[name]);

                if (!channel
                    || typeof channel !== "string"
                    || this.constructor.__chanPattern.exec(channel) === null) {
                    console.warn(`Invalid channel '${name}'. Will use channel '${def}'.`, channel, options);
                    this.storeProperty(name, "r");
                    channel = def;
                }

                if (channel !== options[name]) this.storeProperty(name, channel);
                return channel;
            }
            return def;
        }

        this.__channel = parseChannel("use_channel", "r");
        this.__channels = this.constructor.sources().map((source, i) => parseChannel(`use_channel${i}`, this.__channel));
    }

    /**
     * Set blending mode
     * @param {object} options
     * @param {string} options.use_mode blending mode to use: "show" or "mask"
     */
    resetMode(options) {
        if (options.hasOwnProperty("use_mode")) {
            this._mode = this.loadProperty("use_mode", options.use_mode);
            if (this._mode !== options.use_mode) this.storeProperty("use_mode", this._mode);
        } else {
            this._mode = "show";
        }

        this.__mode = this.constructor.modes[this._mode] || "show";
    }

    /**
     * Can be used to re-set filters for a shader
     * @param {object} options filters configuration, currently supported are
     *  'use_gamma', 'use_exposure', 'use_logscale'
     */
    resetFilters(options) {
        this.__scalePrefix = [];
        this.__scaleSuffix = [];
        let THIS = this.constructor;
        for (let key in options) {
            if (options.hasOwnProperty(key) && THIS.filters.hasOwnProperty(key)) {
                let value = this.loadProperty(key, options[key]);
                let filter = THIS.filters[key](value);
                this.__scalePrefix.push(filter[0]);
                this.__scaleSuffix.push(filter[1]);
            }
        }
        this.__scalePrefix = this.__scalePrefix.join("");
        this.__scaleSuffix = this.__scaleSuffix.reverse().join("");
    }

    ////////////////////////////////////
    ////////// PRIVATE /////////////////
    ////////////////////////////////////

    static __globalIncludes = {};
    static __chanPattern = new RegExp('[rgba]{1,4}');

    _buildControls(options) {
        let controls = this.constructor.defaultControls;

        if (controls.opacity === undefined || (typeof controls.opacity === "object" && !controls.opacity.accepts("float"))) {
            controls.opacity = {
                default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
                accepts: (type, instance) => type === "float"
            };
        }

        for (let control in controls) {
            if (controls.hasOwnProperty(control)) {
                let buildContext = controls[control];
                if (!buildContext) continue;
                this[control] = WebGLModule.UIControls.build(this, control, options[control],
                    buildContext.default, buildContext.accepts, buildContext.required)
            }
        }
    }

    _setContextVisualisationLayer(visualisationLayer) {
        this.__visualisationLayer = visualisationLayer;
        if (!this.__visualisationLayer.hasOwnProperty("cache")) this.__visualisationLayer.cache = {};
        if (!this.__visualisationLayer.cache.hasOwnProperty(this.constructor.type())) {
            this.__visualisationLayer.cache[this.constructor.type()] = {};
        }
    }
};

/**
 * Factory for predefined UIControls
 *  - you can manage all your UI control logic within your shader implementation
 *  and not to touch this class at all, but here you will find some most common
 *  or some advanced controls ready to use, simple and powerful
 *  - registering an IComponent implementation (or an UiElement) in the factory results in its support
 *  among all the shaders (given the GLSL type, result of sample(...) matches).
 *  - UiElements are objects to create simple controls quickly and get rid of code duplicity,
 *  for more info @see WebGLModule.UIControls.register()
 * @type {WebGLModule.UIControls}
 */
WebGLModule.UIControls = class {

    /**
     * Get all available control types
     * @return {string[]} array of available control types
     */
    static types() {
        return Object.keys(this._items).concat(Object.keys(this._impls));
    }

    /**
     * Get an element used to create simple controls, if you want
     * an implementation of the controls themselves (IControl), use build(...) to instantiate
     * @param {string} id type of the control
     * @return {*}
     */
    static getUiElement(id) {
        let ctrl = this._items[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._items["number"];
        }
        return ctrl;
    }

    /**
     * Get an element used to create advanced controls, if you want
     * an implementation of simple controls, use build(...) to instantiate
     * @param {string} id type of the control
     * @return {WebGLModule.UIControls.IControl}
     */
    static getUiClass(id) {
        let ctrl = this._impls[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._impls["colormap"];
        }
        return ctrl;
    }

    /**
     * Build UI control object based on given parameters
     * @param {WebGLModule.VisualisationLayer} context owner of the control
     * @param {string} name name used for the layer, should be unique among different context types
     * @param {object|*} params parameters passed to the control (defined by the control) or set as default value if not object
     * @param {object} defaultParams default parameters that the shader might leverage above defaults of the control itself
     * @param {function} accepts required GLSL type of the control predicate, for compatibility typechecking
     * @param {object} requiredParams parameters that override anything sent by user or present by defaultParams
     * @return {WebGLModule.UIControls.IControl}
     */
    static build(context, name, params, defaultParams={}, accepts=() => true, requiredParams={}) {
        //if not an object, but a value: make it the default one
        if (!(typeof params === 'object')) {
            params = {default: params};
        }
        let originalType = defaultParams.type;

        defaultParams = $.extend(true, {}, defaultParams, params, requiredParams);

        if (!this._items.hasOwnProperty(defaultParams.type)) {
            if (!this._impls.hasOwnProperty(defaultParams.type)) {
                return this._buildFallback(defaultParams.type, originalType, context,
                    name, params, defaultParams, accepts, requiredParams);
            }

            let cls = new this._impls[defaultParams.type](
                context, name, `${name}_${context.uid}`, defaultParams
            );
            if (accepts(cls.type, cls)) return cls;
            return this._buildFallback(defaultParams.type, originalType, context,
                name, params, defaultParams, accepts, requiredParams);
        } else {
            let contextComponent = this.getUiElement(defaultParams.type);
            let comp = new WebGLModule.UIControls.SimpleUIControl(
                context, name, `${name}_${context.uid}`, defaultParams, contextComponent
            );
            if (accepts(comp.type, comp)) return comp;
            return this._buildFallback(contextComponent.glType, originalType, context,
                name, params, defaultParams, accepts, requiredParams);
        }
    }

    /**
     * Register simple UI element by providing necessary object
     * implementation:
     *  { defaults: function () {...}, // object with all default values for all supported parameters
          html: function (uniqueId, params, css="") {...}, //how the HTML UI controls look like
          glUniformFunName: function () {...}, //what function webGL uses to pass this attribute to GPU
          decode: function (fromValue) {...}, //parse value obtained from HTML controls into something
                                                gl[glUniformFunName()](...) can pass to GPU
          glType: //what's the type of this parameter wrt. GLSL: int? vec3?
     * @param type the identifier under which is this control used: lookup made against params.type
     * @param uiElement the object to register, fulfilling the above-described contract
     */
    static register(type, uiElement) {
        function check(el, prop, desc) {
            if (!el.hasOwnProperty(prop)) {
                console.warn(`Skipping UI control '${type}' due to '${prop}': missing ${desc}.`);
                return false;
            }
            return true;
        }

        if (check(uiElement, "defaults", "defaults():object")
            && check(uiElement, "html", "html(uniqueId, params, css):htmlString")
            && check(uiElement, "glUniformFunName", "glUniformFunName():string")
            && check(uiElement, "decode", "decode(encodedValue):<compatible with glType>")
            && check(uiElement, "normalize", "normalize(value, params):<typeof value>")
            && check(uiElement, "sample", "sample(value, valueGlType):glslString")
            && check(uiElement, "glType", "glType:string")
        ) {
            uiElement.prototype.getName = () => type;
            if (this._items.hasOwnProperty(type)) {
                console.warn("Registering an already existing control component: ", type);
            }
            uiElement["uiType"] = type;
            this._items[type] = uiElement;
        }
    }

    /**
     * Register class as a UI control
     * @param {string} type unique control name / identifier
     * @param {WebGLModule.UIControls.IControl} cls to register, implementation class of the controls
     */
    static registerClass(type, cls) {
        if (WebGLModule.UIControls.IControl.isPrototypeOf(cls)) {
            cls.prototype.getName = () => type;

            if (this._items.hasOwnProperty(type)) {
                console.warn("Registering an already existing control component: ", type);
            }
            cls._uiType = type;
            this._impls[type] = cls;
        } else {
            console.warn(`Skipping UI control '${type}': does not inherit from WebGLModule.UIControls.IControl.`);
        }
    }

    /////////////////////////
    /////// PRIVATE /////////
    /////////////////////////

    //implementation of UI control classes
    //more complex functionality
    static _impls = {
        //colormap: WebGLModule.UIControls.ColorMap
    };
    //implementation of UI control objects
    //simple functionality
    static _items = {
        number: {
            defaults: function () {
                return {title: "Number", interactive: true, default: 0, min: 0, max: 100, step: 1};
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                return `${title}<input class="form-control input-sm" style="${css}" min="${params.min}" max="${params.max}" 
step="${params.step}" type="number" id="${uniqueId}">`;
            },
            glUniformFunName: function () {
                return "uniform1f";
            },
            decode: function (fromValue) {
                return Number.parseFloat(fromValue);
            },
            normalize: function(value, params) {
                return  (value - params.min) / (params.max - params.min);
            },
            sample: function(name, ratio) {
                return name;
            },
            glType: "float",
            uiType: "number"
        },

        range: {
            defaults: function () {
                return {title: "Range", interactive: true, default: 0, min: 0, max: 100, step: 1};
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                return `${title}<input type="range" style="${css}" 
class="with-direct-input" min="${params.min}" max="${params.max}" step="${params.step}" id="${uniqueId}">`;
            },
            glUniformFunName: function () {
                return "uniform1f";
            },
            decode: function (fromValue) {
                return Number.parseFloat(fromValue);
            },
            normalize: function(value, params) {
                return  (value - params.min) / (params.max - params.min);
            },
            sample: function(name, ratio) {
                return name;
            },
            glType: "float",
            uiType: "range"
        },

        color: {
            defaults: function () {
                return { title: "Color", interactive: true, default: "#fff900" };
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                return `${title}<input type="color" id="${uniqueId}" style="${css}" class="form-control input-sm">`;
            },
            glUniformFunName: function () {
                return "uniform3fv";
            },
            decode: function (fromValue) {
                try {
                    let index = fromValue.startsWith("#") ? 1 : 0;
                    return [
                        parseInt(fromValue.slice(index, index+2), 16) / 255,
                        parseInt(fromValue.slice(index+2, index+4), 16) / 255,
                        parseInt(fromValue.slice(index+4, index+6), 16) / 255
                    ];
                } catch (e) {
                    return [0, 0, 0];
                }
            },
            normalize: function(value, params) {
                return value;
            },
            sample: function(name, ratio) {
                return name;
            },
            glType: "vec3",
            uiType: "color"
        },

        bool: {
            defaults: function () {
                return { title: "Checkbox", interactive: true, default: true };
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                let value = this.decode(params.default) ? "checked" : "";
                //note a bit dirty, but works :) - we want uniform access to 'value' property of all inputs
                return `${title}<input type="checkbox" style="${css}" id="${uniqueId}" ${value}
class="form-control input-sm" onchange="this.value=this.checked; return true;">`;
            },
            glUniformFunName: function () {
                return "uniform1i";
            },
            decode: function (fromValue) {
                return fromValue && fromValue !== "false" ? 1 : 0;
            },
            normalize: function(value, params) {
                return value;
            },
            sample: function(name, ratio) {
                return name;
            },
            glType: "bool",
            uiType: "bool"
        }
    };

    static _buildFallback(newType, originalType, context, name, params, defaultParams, requiredType, requiredParams) {
        //repeated check when building object from type

        params.interactive = false;
        if (originalType === newType) { //if default and new equal, fail - recursion will not help
            console.error(`Invalid parameter in shader '${params.type}': the parameter could not be built.`);
            return undefined;
        } else { //otherwise try to build with originalType (default)
            params.type = originalType;
            console.warn("Incompatible UI control type '"+newType+"': making the input non-interactive.");
            return this.build(context, name, params, defaultParams, requiredType, requiredParams);
        }
    }
};


WebGLModule.UIControls.IControl = class {

    /**
     * Sets common properties needed to create the controls:
     *  this.context @extends WebGLModule.VisualisationLayer - owner context
     *  this.name - name of the parameter for this.context.[load/store]Property(...) call
     *  this.id - unique ID for HTML id attribute, to be able to locate controls in DOM,
     *      created as ${uniq}${name}-${context.uid}
     *  this.webGLVariableName - unique webgl uniform variable name, to not to cause conflicts
     *
     * If extended (class-based definition, see registerCass) children should define constructor as
     *   constructor(context, name, webGLVariableName, params) {
     *       super(context, name, webGLVariableName);
     *       ...
     *       //possibly make use of params:
     *       this.params = this.getParams(params);
     *
     *       //now access params:
     *       this.params...
     *   }
     *
     * @param {WebGLModule.VisualisationLayer} context shader context owning this control
     * @param {string} name name of the control (key to the params in the shader configuration)
     * @param {string} webGLVariableName configuration parameters,
     *      depending on the params.type field (the only one required)
     * @param {string} uniq another element to construct the DOM id from, mostly for compound controls
     */
    constructor(context, name, webGLVariableName, uniq="") {
        this.context = context;
        this.id = `${uniq}${name}-${context.uid}`;
        this.name = name;
        this.webGLVariableName = webGLVariableName;
        this._params = {};
    }

    /**
     * Safely sets outer params with extension from 'supports'
     *  - overrides 'supports' values with the correct type (derived from supports or supportsAll)
     *  - sets 'supports' as defaults if not set
     * @param params
     */
    getParams(params) {
        const t = this.constructor.getVarType;
        function mergeSafeType(mask, from, possibleTypes) {
            const to = {...mask};
            Object.keys(from).forEach(key => {
                const tVal = to[key],
                    fVal = from[key],
                    tType = t(tVal),
                    fType = t(fVal);

                const typeList = possibleTypes?.[key],
                    pTypeList = typeList ? typeList.map(x => t(x)) : [];

                //our type detector distinguishes arrays and objects
                if (tVal && fVal && tType === "object" && fType === "object") {
                    to[key] = mergeSafeType(tVal, fVal, typeList);
                } else if (tVal === undefined || tType === fType || pTypeList.includes(fType)) {
                    to[key] = fVal;
                } else if (fType === "string") {
                    //try parsing
                    if (tType === "number") {
                        const parsed = Number.parseFloat(fVal);
                        if (!Number.isNaN(parsed)) to[key] = parsed;
                    } else if (tType === "boolean") {
                        const value = fVal.toLowerCase();
                        if (value === "false") to[key] = false;
                        if (value === "true") to[key] = true;
                    }
                }
            });
            return to;
        }
        return mergeSafeType(this.supports, params, this.supportsAll);
    }

    /**
     * Uniform behaviour wrt type checking in shaders
     * @param x
     * @return {string}
     */
    static getVarType(x) {
        if (x === undefined) return "undefined";
        if (x === null) return "null";
        return Array.isArray(x) ? "array" : typeof x;
    }

    /**
     * JavaScript initialization
     *  - read/store default properties here using this.context.[load/store]Property(...)
     *  - work with own HTML elements already attached to the DOM
     *      - set change listeners, input values!
     */
    init() {
        throw "WebGLModule.UIControls.IControl::init() must be implemented.";
    }

    /**
     * Called when an image is rendered
     * @param program WebglProgram instance
     * @param dimension canvas dimension {width, height}
     * @param gl WebGL Context
     */
    glDrawing(program, dimension, gl) {
        //the control should send something to GPU
        throw "WebGLModule.UIControls.IControl::glDrawing() must be implemented.";
    }

    /**
     * Called when associated webgl program is switched to
     * @param program WebglProgram instance
     * @param gl WebGL Context
     */
    glLoaded(program, gl) {
        //the control should send something to GPU
        throw "WebGLModule.UIControls.IControl::glLoaded() must be implemented.";
    }

    /**
     * Get the UI HTML controls
     *  - these can be referenced in this.init(...)
     *  - should respect this.params.interactive attribute and return non-interactive output if interactive=false
     *      - don't forget to no to work with DOM elements in init(...) in this case
     */
    toHtml(breakLine=true, controlCss="") {
        throw "WebGLModule.UIControls.IControl::toHtml() must be implemented.";
    }

    /**
     * Handles how the variable is being defined in GLSL
     *  - should use variable names derived from this.webGLVariableName
     */
    define() {
        throw "WebGLModule.UIControls.IControl::define() must be implemented.";
    }

    /**
     * Sample the parameter using ratio as interpolation, must be one-liner expression so that GLSL code can write
     *    `vec3 mySampledValue = ${this.color.sample("0.2")};`
     * NOTE: you can define your own global-scope functions to keep one-lined sampling,
     * see this.context.includeGlobalCode(...)
     * @param {string||undefined} value openGL value/variable, used in a way that depends on the UI control currently active
     *        (do not pass arguments, i.e. 'undefined' just get that value, note that some inputs might require you do it..)
     * @param {string} valueGlType GLSL type of the value
     * @return {string} valid GLSL oneliner (wihtout ';') for sampling the value, or invalid code (e.g. error message) to signal error
     */
    sample(value=undefined, valueGlType='void') {
        throw "WebGLModule.UIControls.IControl::sample() must be implemented.";
    }

    /**
     * Parameters supported by this UI component, must contain at least
     *  - 'interactive' - type bool, enables and disables the control interactivity
     *  (by changing the content available when rendering html)
     *  - 'title' - type string, the control title
     *
     *  Additionally, for compatibility reasons, you should, if possible, define
     *  - 'default' - type any; the default value for the particular control
     * @return {{}} name: default value mapping
     */
    get supports() {
        throw "WebGLModule.UIControls.IControl::supports must be implemented.";
    }

    /**
     * Type definitions for supports. Can return empty object. In case of missing
     * type definitions, the type is derived from the 'supports()' default value type.
     *
     * Each key must be an array of default values for the given key if applicable.
     * This is an _extension_ to the supports() and can be used only for keys that have more
     * than one default type applicable
     * @return {{}}
     */
    get supportsAll() {
        throw "WebGLModule.UIControls.IControl::typeDefs must be implemented.";
    }

    /**
     * GLSL type of this control: what type is returned from this.sample(...) ?
     * @return {string}
     */
    get type() {
        throw "WebGLModule.UIControls.IControl::type must be implemented.";
    }

    /**
     * Raw value sent to the GPU, note that not necessarily typeof raw() === type()
     * some controls might send whole arrays of data (raw) and do smart sampling such that type is only a number
     * @return {any}
     */
    get raw() {
        throw "WebGLModule.UIControls.IControl::raw must be implemented.";
    }

    /**
     * Encoded value as used in the UI, e.g. a name of particular colormap, or array of string values of breaks...
     * @return {any}
     */
    get encoded() {
        throw "WebGLModule.UIControls.IControl::encoded must be implemented.";
    }

    //////////////////////////////////////
    //////// COMMON API //////////////////
    //////////////////////////////////////

    /**
     * The control type component was registered with. Handled internally.
     * @return {*}
     */
    get uiControlType() {
        return this.constructor._uiType;
    }

    /**
     * Get current control parameters
     * the control should set the value as this._params = this.getParams(incomingParams);
     * @return {{}}
     */
    get params() {
        return this._params;
    }

    /**
     * Automatically overridden to return the name of the control it was registered with
     * @return {string}
     */
    getName() {
        return "IControl";
    }

    /**
     * Load a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param defaultValue value to return in case of no cached value
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     *  - default value can be empty string
     * @return {*} cached or default value
     */
    load(defaultValue, paramName="") {
        //todo test against required type wrt supports and return default if not valid
        if (paramName === "default") paramName = "";
        return this.context.loadProperty(this.name + paramName, defaultValue)
    }

    /**
     * Store a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param value to store
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     *  - default value can be empty string
     */
    store(value, paramName="") {
        if (paramName === "default") paramName = "";
        return this.context.storeProperty(this.name + paramName, value);
    }

    /**
     * On parameter change register self
     * @param {string} event which event to fire on
     *  - events are with inputs the names of supported parameters (this.supports), separated by dot if nested
     *  - most controls support "default" event - change of default value
     *  - see specific control implementation to see what events are fired (Advanced Slider fires "breaks" and "mask" for instance)
     * @param {function} clbck(rawValue, encodedValue, context) call once change occurs, context is the control instance
     */
    on(event, clbck) {
        this.__onchange[event] = clbck; //only one possible event -> rewrite?
    }

    /**
     * Clear events of the event type
     * @param {string} event type
     */
    off(event) {
        delete this.__onchange[event];
    }

    /**
     * Clear ALL events
     */
    clearEvents() {
        this.__onchange = {}
    }

    /**
     * Invoke changed value event
     *  -- should invoke every time a value changes !driven by USER!, and use unique or compatible
     *     event name (event 'value') so that shader knows what changed
     * @param event event to call
     * @param value decoded value of encodedValue
     * @param encodedValue value that was received from the UI input
     * @param context self reference to bind to the callback
     */
    changed(event, value, encodedValue, context) {
        if (typeof this.__onchange[event] === "function") {
            this.__onchange[event](value, encodedValue, context);
        }
    }

    __onchange = {}
};


/**
 * Generic UI control implementations
 * used if:
 * {
 *     type: "CONTROL TYPE",
 *     ...
 * }
 *
 * The subclass constructor should get the context reference, the name
 * of the input and the parametrization.
 *
 * Further parameters passed are dependent on the control type, see
 * @WebGLModule.UIControls
 *
 * @type {WebGLModule.UIControls.SimpleUIControl}
 */
WebGLModule.UIControls.SimpleUIControl = class extends WebGLModule.UIControls.IControl {

    //uses intristicComponent that holds all specifications needed to work with the component uniformly
    constructor(context, name, webGLVariableName, params, intristicComponent, uniq="") {
        super(context, name, webGLVariableName, uniq);
        this.component = intristicComponent;
        this._params = this.getParams(params);

        this.encodedValue = this.load(this.params.default);
        //this unfortunatelly makes cache erasing and rebuilding vis impossible, the shader part has to be fully re-instantiated
        this.params.default = this.encodedValue;
    }

    init() {
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.encodedValue = $(e.target).val();
                _this.value = _this.component.normalize(_this.component.decode(_this.encodedValue), _this.params);
                _this.changed("default", _this.value, _this.encodedValue, _this);
                _this.store(_this.encodedValue);
                _this.context.invalidate();
            };
            let node = $(`#${this.id}`);
            node.val(this.encodedValue);
            node.on('change', updater); //note, set change only now! val(..) would trigger it
        }
    }

    glDrawing(program, dimension, gl) {
        gl[this.component.glUniformFunName()](this.location_gluint, this.value);
    }

    glLoaded(program, gl) {
        this.location_gluint = gl.getUniformLocation(program, this.webGLVariableName);
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this.params.interactive) return "";
        return this.component.html(this.id, this.params, controlCss)
            + (breakLine ? "<br>" : "");
    }

    define() {
        return `uniform ${this.component.glType} ${this.webGLVariableName};`;
    }

    sample(value=undefined, valueGlType='void') {
        if (!value || valueGlType !== 'float') return this.webGLVariableName;
        return this.component.sample(this.webGLVariableName, value);
    }

    get uiControlType() {
        return this.component["uiType"];
    }

    get supports() {
        return this.component.defaults();
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValue;
    }

    get type() {
        return this.component.glType;
    }
};
