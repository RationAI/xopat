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
};


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
     * Declare supported controls by a particular shader
     * each controls is automatically created for the shader
     * and this[controlId] instance set
     * @return {object} controlId => {
     *     default: {type: <>, title: <>, interactive: true|false...},
           accepts: (type, instance) => <>,
           required: {type: <> ...} [OPTIONAL]
     * }
     */
    static defaultControls() {
        return {};
    }

    /**
     * Global supported options
     * @param id unique ID among all webgl instances and shaders
     * @param options
     *  options.channel: "r", "g" or "b" channel to sample, default "r"
     */
    constructor(id, options) {
        this.uid = id;
        if (options.hasOwnProperty("use_channel")) {
            this.__channel = options.use_channel;
        }

        if (!this.__channel
            || typeof this.__channel !== "string"
            || WebGLModule.VisualisationLayer.__chanPattern.exec(this.__channel) === null) {

            this.__channel = "r";
        }

        if (this.__channel.length > 1) {
            console.warn("Shader will sample more dimensions - no such shader is " +
                "present in default ones: make sure this is a custom implementation.");
        }

        this.__mode = "show";
        if (options.hasOwnProperty("use_mode")) {
            if (options["use_mode"] === "blend") {
                this.__mode = "blend";
            }
        }

        //parse filters
        this.__scalePrefix = [];
        this.__scaleSuffix = [];
        let THIS = WebGLModule.VisualisationLayer;
        for (let key in options) {
            if (options.hasOwnProperty(key) && THIS.filters.hasOwnProperty(key)) {
                let value = options[key];
                let filter = THIS.filters[key](this.toShaderFloatString(value, "1.0"));
                this.__scalePrefix.push(filter[0]);
                this.__scaleSuffix.push(filter[1]);
            }
        }
        this.__scalePrefix = this.__scalePrefix.join("");
        this.__scaleSuffix = this.__scaleSuffix.reverse().join("");
        this._buildControls(options);
    }

    /**
     * Called once the shader is ready to be used, called only once.
     */
    ready() {
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
     * (might be multiple times), after htmlControls()
     */
    init() {
    }

    /**
     * Get the shader UI controls
     * @return {string} HTML controls for the particular shader
     */
    htmlControls() {
        return "";
    }

    ////////////////////////////////////
    ////////// AVAILABLE API ///////////
    ////////////////////////////////////

    //add your filters here if you want... function that takes parameter (number)
    //and returns prefix and suffix to compute oneliner filter
    //should start as 'use_[name]' for namespace collision avoidance (params object)
    //expression should be wrapped in parenthesses for safety: ["(....(", ")....)"] in the middle the
    // filtered variable will be inserted, notice pow does not need inner brackets since its an argument...
    static filters = {
        use_gamma: (x) => ["pow(", `, 1.0 / ${x})`],
        use_exposure: (x) => ["(1.0 - exp(-(", `)* ${x}))`],
        use_logscale: (x) => [`((log(${x} + (`, `)) - log(${x})) / (log(${x}+1.0)-log(${x})))`]
    };

    /**
     * Include GLSL shader code on global scope
     * (e.g. define function that is repeatedly used)
     * does not have to use unique ID extended names as this code is included only once
     * @param key a key under which is the code stored, so that the same key is not loaded twice
     * @param code code to add to the shader
     */
    includeGlobalCode(key, code) {
        let container = this.constructor.__globalIncludes;
        if (!container.hasOwnProperty(key)) container[key] = code;
    }

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
     * Add your shader part result
     * @param {string} output, GLSL code to output from the shader, output must be a vec4
     */
    render(output) {
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
        if (otherDataIndex >= refs.length) {
            switch (this.__channel.length) {
                case 1: return ".0";
                case 2: return "vec2(.0)";
                case 3: return "vec3(.0)";
                default:
                    return 'vec4(0.0)';
            }
        }
        let sampled = `${this.webglContext.getTextureSamplingCode(refs[otherDataIndex], textureCoords)}.${this.__channel}`;
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
     * @param name value name
     * @param defaultValue default value if no stored value available
     * @return stored value or default value
     */
    loadProperty(name, defaultValue) {
        let selfType = this.constructor.type();
        if (this.__visualisationLayer.cache[selfType].hasOwnProperty(name)) {
            return this.__visualisationLayer.cache[selfType][name];
        }
        return defaultValue;
    }

    /**
     * Store value, useful for controls value caching
     * @param name value name
     * @param value value
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
        return this.__mode;
    }

    /**
     * Returns number of textures available to this shader
     * @return {number} number of textures available
     */
    get texturesCount() {
        return this.__visualisationLayer.dataReferences.length;
    }

    ////////////////////////////////////
    ////////// PRIVATE /////////////////
    ////////////////////////////////////

    static __globalIncludes = {};
    static __chanPattern = new RegExp('[rgbxyzuvw]+');

    _buildControls(options) {
        let controls = this.constructor.defaultControls();
        for (let control in controls) {
            if (controls.hasOwnProperty(control)) {
                let buildContext = controls[control];
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

    _setWebglContext(webglContext) {
        this.webglContext = webglContext;
    }

    _setResetCallback(reset, rebuild) {
        this.invalidate = reset;
        //use with care... (that's why it has more difficult name)
        this.build_shaders = rebuild;
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
     * @param id type of the control
     * @return {*}
     */
    static getUiElement(id) {
        let ctrl = WebGLModule.UIControls._items[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = WebGLModule.UIControls._items["number"];
        }
        return ctrl;
    }

    /**
     * Get an element used to create advanced controls, if you want
     * an implementation of simple controls, use build(...) to instantiate
     * @param id type of the control
     * @return {WebGLModule.UIControls.IControl}
     */
    static getUiClass(id) {
        let ctrl = WebGLModule.UIControls._impls[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = WebGLModule.UIControls._impls["colormap"];
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
        $.extend(true, defaultParams, params, requiredParams);

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
            && check(uiElement, "glType", "glType:string")
        ) {
            if (this._items.hasOwnProperty(type)) {
                console.warn("Registering an already existing control component: ", type);
            }
            this._items[type] = uiElement;
        }
    }

    /**
     * Register class as a UI control
     * @param {string} type unique control name / identifier
     * @param {WebGLModule.UIControls.IControl} cls to register, implementation class of the controls
     */
    static registerClass(type, cls) {
        function check(el, prop, desc) {
            if (!el.hasOwnProperty(prop)) {
                console.warn(`Skipping UI control '${type}' due to '${prop}': missing implementation of ${desc}.`);
                return false;
            }
            return true;
        }

        //todo does not work for subchildren...
        if (check(cls.prototype, "init", "init(webGLVariableName):void")
            && check(cls.prototype, "glDrawing", " glDrawing(program, dimension, gl):void")
            && check(cls.prototype, "glLoaded", "glLoaded(program, gl):void")
            && check(cls.prototype, "toHtml", "toHtml(breakLine=true, controlCss=\"\"):string")
            && check(cls.prototype, "sample", "sample(ratio):string")
        ) {
            if (this._items.hasOwnProperty(type)) {
                console.warn("Registering an already existing control component: ", type);
            }
            this._impls[type] = cls;
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
                return `${title}<input class="form-control input-sm" ${css} min="${params.min}" max="${params.max}" 
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
            glType: "float"
        },

        range: {
            defaults: function () {
                return {title: "Range", interactive: true, default: 0, min: 0, max: 100, step: 1};
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                return `${title}<input type="range" ${css} 
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
            glType: "float"
        },

        color: {
            defaults: function () {
                return { title: "Color", interactive: true, default: "#fff900" };
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                return `${title}<input type="color" id="${uniqueId}" class="form-control input-sm">`;
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
            glType: "vec3"
        },

        bool: {
            defaults: function () {
                return { title: "Checkbox", interactive: true, default: "true" };
            },
            html: function (uniqueId, params, css="") {
                let title = params.title ? `<span> ${params.title}</span>` : "";
                let value = params.default && params.default !== "false" ? "checked" : "";
                //todo verify if this dirty trick works
                return `${title}<input type="checkbox" id="${uniqueId}" ${value}
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
            glType: "bool"
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
     * @param {string} ratio openGL float value/variable, ratio used to interpolate the user-defined parameter
     *        note that shaders extending this interface might extend supported types to be more flexible
     *        (e.g. support 'undefined' to avoid passing every time "1.0" if you want to just get that value)
     */
    sample(ratio) {
        throw "WebGLModule.UIControls.IControl::sample() must be implemented.";
    }

    /**
     * Parameters supported by this UI component, should contain at least 'interactive', 'title' and 'default'
     * @return {object} name => default value mapping
     */
    get supports() {
        throw "WebGLModule.UIControls.IControl::parameters must be implemented.";
    }

    /**
     * GLSL type of this control: what type is returned from this.sample(...) ?
     */
    get type() {
        throw "WebGLModule.UIControls.IControl::type must be implemented.";
    }

    /**
     * Raw value sent to the GPU, note that not necessarily typeof raw() === type()
     * some controls might send whole arrays of data (raw) and do smart sampling such that type is only a number
     */
    get raw() {
        throw "WebGLModule.UIControls.IControl::raw must be implemented.";
    }

    /**
     * Encoded value as used in the UI, e.g. a name of particular colormap, or array of string values of breaks...
     */
    get encoded() {
        throw "WebGLModule.UIControls.IControl::encoded must be implemented.";
    }

    //////////////////////////////////////
    //////// COMMON API //////////////////
    //////////////////////////////////////

    /**
     * On parameter change register self
     * @param {string} event which event change
     * @param {function} clbck(rawValue, encodedValue, context) call once change occurs, context is the control instance
     * @param {bool} silent whether to be silent on failure, default false, makes the developer to realize that
     *      if used in init(...), it can be called multiple times and on(...) event might be already occupied
     */
    on(event, clbck, silent=false) {
        if (!this.__onchange.hasOwnProperty(event)) this.__onchange[event] = clbck;
        else if (!silent) console.warn(`on() event already full for event '${event}': due to implementation reasons, only one callback is allowed at time.`);
    }

    /**
     * Clear ALL events of the event type
     * @param {string} event type
     */
    off(event) {
        delete this.__onchange[event];
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
        if (this.__onchange.hasOwnProperty(event)) {
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
        this.params = this.component.defaults();
        $.extend(this.params, params);
    }

    init() {
        this.encodedValue = this.context.loadProperty(this.name, this.params.default);
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.encodedValue = $(e.target).val();
                _this.value = _this.component.normalize(_this.component.decode(_this.encodedValue), _this.params);
                _this.changed(_this.name, _this.value, _this.encodedValue, _this);
                _this.context.storeProperty(_this.name, _this.encodedValue);
                _this.context.invalidate();
            };
            let node = $(`#${this.id}`);
            node.val(this.encodedValue);
            node.change(updater); //note, set change only now! val(..) would trigger it
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
        return this.component.html(this.id, this.params, `style="${controlCss}"`)
            + (breakLine ? "<br>" : "");
    }

    define() {
        return `uniform ${this.component.glType} ${this.webGLVariableName};`;
    }

    sample(ratio) {
        //TODO INVALID!!!! * not valid on all types, e.g. bool
        if (!ratio) return this.webGLVariableName;
        return `${this.webGLVariableName} * ${ratio}`;
    }

    get supports() {
        return this.component.defaults();
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
