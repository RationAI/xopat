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
     * Global supported options
     * @param id unique ID among all webgl instances and shaders
     * @param options
     *  options.channel: "r", "g" or "b" channel to sample, default "r"
     */
    constructor(id, options) {
        this.uid = id;
        if (options.hasOwnProperty("channel")) {
            this.__channel = options.__channel;
        }

        //todo this is valid only for one-channel shaders
        if (!["r", "g", "b", "a"].some(ch => this.__channel === ch, this)) {
            this.__channel = "r";
        }
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

    /**
     * Declare supported controls by a particular shader
     * @return {object} name => glType (string, what is the expected output type in shader
     * when sampling that particular input value)
     */
    supports() {
        return {};
    }

    ////////////////////////////////////
    ////////// AVAILABLE API ///////////
    ////////////////////////////////////

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

    static __globalIncludes = {};

    _setContextVisualisationLayer(visualisationLayer) {
        this.__visualisationLayer = visualisationLayer;
    }

    _setWebglContext(webglContext) {
        this.webglContext = webglContext;
    }

    _setResetCallback(reset) {
        this.invalidate = reset;
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
     * @return {WebGLModule.UIControls.IControl}
     */
    static build(context, name, params={}, defaultParams={}, accepts=() => true) {
        //if not an object, but a value: make it the default one
        if (!(typeof params === 'object')) {
            params = {default: params};
        }
        let originalType = defaultParams.type;
        $.extend(true, defaultParams, params);

        if (!this._items.hasOwnProperty(defaultParams.type)) {
            if (!this._impls.hasOwnProperty(defaultParams.type)) {
                return this._buildFallback(defaultParams.type, originalType, context, name, params, defaultParams, accepts);
            }

            let cls = new this._impls[defaultParams.type](context, name, `${name}_${context.uid}`, defaultParams);
            if (accepts(cls.type, cls)) {
                return cls;
            }
            return this._buildFallback(defaultParams.type, originalType, context, name, params, defaultParams, accepts);
        } else {
            let contextComponent = this.getUiElement(defaultParams.type);
            let comp = new WebGLModule.UIControls.SimpleUIControl(context, name, `${name}_${context.uid}`, defaultParams, contextComponent);
            if (accepts(comp.type, comp)) {
                return comp;
            }
            return this._buildFallback(contextComponent.glType, originalType, context, name, params, defaultParams, accepts);
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
                console.warn(`Skipping UI control '${prop}': missing ${desc}.`);
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
                console.warn(`Skipping UI control '${prop}': missing implementation of ${desc}.`);
                return false;
            }
            return true;
        }

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
                return {title: "Number", visible: true, default: 0, min: 0, max: 100, step: 1};
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
                return {title: "Range", visible: true, default: 0, min: 0, max: 100, step: 1};
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
                return { title: "Color", visible: true, default: "#fff900" };
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
                return { title: "Checkbox", visible: true, default: "true" };
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

    static _buildFallback(newType, originalType, context, name, params, defaultParams, requiredType) {
        //repeated check when building object from type

        params.visible = false;
        if (originalType === newType) { //if default and new equal, fail - recursion will not help
            console.error(`Invalid parameter in shader '${params.type}': the parameter could not be built.`);
            return undefined;
        } else { //otherwise try to build with originalType (default)
            params.type = originalType;
            console.warn("Incompatible UI control type '"+newType+"': making the input invisible.");
            return this.build(context, name, params, defaultParams, requiredType);
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
     *  - should respect this.params.visible attribute and return empty string if not visible
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
     *        (e.g. support 'undefined' to
     */
    sample(ratio) {
        throw "WebGLModule.UIControls.IControl::sample() must be implemented.";
    }

    /**
     * Parameters supported by this UI component, should contain at least 'visible' and 'default'
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

        if (this.params.visible) {
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
        if (!this.params.visible) return "";
        return this.component.html(this.id, this.params, `style="${controlCss}"`)
            + (breakLine ? "<br>" : "");
    }

    define() {
        return `uniform ${this.component.glType} ${this.webGLVariableName};`;
    }

    sample(ratio) {
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

/**
 * Re-uses two compound components since they are fully compatible
 * @type {WebGLModule.UIControls.SliderWithInput}
 */
WebGLModule.UIControls.SliderWithInput = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this._c1 = new WebGLModule.UIControls.SimpleUIControl(
            context, name, webGLVariableName, params, WebGLModule.UIControls.getUiElement('range'));
        let paramsClone = $.extend({}, params, {title: ""});
        this._c2 = new WebGLModule.UIControls.SimpleUIControl(
            context, name, webGLVariableName, paramsClone, WebGLModule.UIControls.getUiElement('number'), "second-");
    }

    init() {
        const _this = this;
        this._c1.init();
        this._c2.init();
        this._c1.on(this.name, function (value, encoded, context) {
            $(`#${_this._c2.id}`).val(encoded);
            _this._c2.value = value;
            _this.changed(this.name, value, encoded, context);
        }, true); //silently fail if registered
        this._c2.on(this.name, function (value, encoded, context) {
            $(`#${_this._c1.id}`).val(encoded);
            _this._c1.value = value;
            _this.changed(this.name, value, encoded, context);
        }, true); //silently fail if registered
    }

    glDrawing(program, dimension, gl) {
        this._c1.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this._c1.glLoaded(program, gl);
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this._c1.params.visible) return "";
        return `<div ${controlCss}>${this._c1.toHtml(false, 'style="width: 48%;"')}
        ${this._c2.toHtml(false, 'style="width: 12%;"')}</div>
        ${breakLine ? "<br>" : ""}`;
    }

    define() {
        return this._c1.define();
    }

    sample(ratio) {
        return this._c1.sample(ratio);
    }

    get supports() {
        return this._c1.defaults();
    }

    get type() {
        return this._c1.glType;
    }

    get raw() {
        return this._c1.value;
    }

    get encoded() {
        return this._c1.encodedValue;
    }
};
WebGLModule.UIControls.registerClass("range-input", WebGLModule.UIControls.SliderWithInput);

WebGLModule.UIControls.ColorMap = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this.params = this.supports;
        this.MAX_SAMPLES = 12;
        $.extend(this.params, params);

        this.parser = WebGLModule.UIControls.getUiElement("color").decode;
        this.continuous = !Array.isArray(this.params.steps) && this.params.steps < 1;
        if (this.continuous) {
            this.params.steps = 8;
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.context.includeGlobalCode('colormap', `
#define COLORMAP_ARRAY_LEN ${this.MAX_SAMPLES}
vec3 sample_colormap(in float ratio, in vec3 map[COLORMAP_ARRAY_LEN], in float steps[COLORMAP_ARRAY_LEN], in bool interpolate) {
    for (int i = 0; i < COLORMAP_ARRAY_LEN; i++) {
        if (ratio <= steps[i] || steps[i] < .0) {
            if (i == 0) return map[0];           
            float remainder = ratio - steps[i];               
            if (ratio > steps[i]) {
                return map[i];
            }
            if (interpolate) return mix(map[i], map[i+1], remainder);
            if (steps[i+1] > steps[i] && remainder > abs(ratio - steps[i+1])) return map[i+1];   
            return map[i];
        }
    }
}`);
    }

    init() {
        //todo safe steps - provide maps up to this.MAX_SAMPLES or prevent from malicious access
        this.value = this.context.loadProperty(this.name, this.params.default);

        this.setSteps();

        if (!this.value || !WebGLModule.ColorBrewer.schemeGroups[this.params.mode].hasOwnProperty(this.value)) {
            this.value = WebGLModule.ColorBrewer.defaults[this.params.mode];
        }
        this.pallete = WebGLModule.ColorBrewer[this.value][this.maxSteps];

        if (this.params.visible) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target),
                    selected = self.val();
                let pallete = WebGLModule.ColorBrewer[selected][_this.maxSteps];
                _this._setPallete(pallete);
                self.css("background", _this.cssGradient(pallete));
                _this.value = selected;
                _this.context.storeProperty(_this.name, selected);
                _this.changed(_this.name, _this.pallete, _this.value, _this);
                _this.context.invalidate();
            };
            let node = $(`#${this.id}`);
            node.css("background", this.cssGradient(this.pallete));
            this._setPallete(this.pallete);
            let schemas = [];
            for (let pallete of WebGLModule.ColorBrewer.schemeGroups[this.params.mode]) { //todo need to do this building after init(...)
                schemas.push(`<option value="${pallete}">${pallete}</option>`);
            }
            node.html(schemas.join(""));
            node.val(this.value);
            node.change(updater);
        }
    }

    setSteps(steps) {
        this.steps = steps || this.params.steps;
        if (! Array.isArray(this.steps)) {
            if (this.steps < 3) this.steps = 3;
            if (this.steps > this.MAX_SAMPLES) this.steps = this.MAX_SAMPLES;
            this.maxSteps = this.steps;
            let step = 1.0 / this.maxSteps;
            this.steps = new Array(this.MAX_SAMPLES);
            this.steps.fill(-1);
            this.steps[0] = step;
            for (let i = 1; i < this.maxSteps; i++) this.steps[i] = this.steps[i - 1] + step;
            this.steps[this.maxSteps-1] = 1.0;
        } else {
            this.steps = this.steps.filter(x => x >= 0);
            this.steps.sort();
            let max = this.steps[0];
            let min = this.steps[this.steps.length-1];
            this.steps = this.steps.slice(0, this.MAX_SAMPLES);
            this.maxSteps = this.steps.length;
            this.steps.forEach(x => (x - min) / (max-min));
            for (let i = this.maxSteps; i < this.MAX_SAMPLES; i++) this.steps.push(-1);
        }
    }

    _continuousCssFromPallete(pallete) {
        let step = 100 / (pallete.length-1),
            percent = step;
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < pallete.length; i++) {
            css.push(`, ${pallete[i]} ${percent}%`);
            percent += step;
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        let step = 100 / pallete.length,
            percent = step;
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < pallete.length; i++) {
            css.push(`, ${pallete[i-1]} ${percent}%, ${pallete[i]} ${percent}%`);
            percent += step;
        }
        css.push(")");
        return css.join("");
    }

    _setPallete(newPallete, stepSize) {
        if (typeof newPallete[0] === "string") {
            let temp = newPallete; //if this.pallete passed
            this.pallete = [];
            for (let color of temp) {
                this.pallete.push(...this.parser(color));
            }
        }
        for (let i = this.pallete.length; i < 3*this.MAX_SAMPLES; i++) this.pallete.push(0);
    }

    glDrawing(program, dimension, gl) {
        gl.uniform3fv(this.colormap_gluint,  Float32Array.from(this.pallete));
        gl.uniform1fv(this.steps_gluint, Float32Array.from(this.steps));
    }

    glLoaded(program, gl) {
        this.steps_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_steps[0]");
        this.colormap_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap[0]");
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this.params.visible) return "";

        // let temp = [];
        // if (this.params.modeSelectable) {
        //     temp.push(`<select id="${id}_mode">`);
        //     for (let mode in WebGLModule.ColorBrewer.schemeGroups) {
        //         let selected = mode === this.params.mode ? "selected" : "";
        //         temp.push(`<option value="${mode}" ${selected}>${mode}</option>`)
        //     }
        //     temp.push(`</select>`);
        // }

        if (!WebGLModule.ColorBrewer.hasOwnProperty(this.params.pallete)) {
            this.params.pallete = "OrRd";
        }

        if (this.continuous) {
            return `<span> ${this.params.title}</span><select id="${this.id}" class="form-control text-readable" 
style="width: 60%;"></select><br>`;
        } else { //discrete
            // let width = 350 / this.params.steps;
            //
            // let joins = [];
            // for (let i = 0; i < this.params.steps; i++) {
            //     let selected = mode === this.params.scheme ? "selected" : "";
            //     joins.push(`<option value="${mode}" ${selected}>${mode}</option>`)
            // }
            //
            // return `<select id="${this.id}">${schemas.join("")}</select>`;
            return `<span> ${this.params.title}</span><select id="${this.id}" class="form-control text-readable" 
style="width: 60%;"></select><br>`;
        }
    }

    define() {
        return `uniform vec3 ${this.webGLVariableName}_colormap[COLORMAP_ARRAY_LEN];
uniform float ${this.webGLVariableName}_steps[COLORMAP_ARRAY_LEN];`;
    }

    get type() {
        return "vec3";
    }

    sample(ratio) {
        if (!ratio) return "ERROR colormap requires sample(ratio) argument!";
        return `sample_colormap(${ratio}, ${this.webGLVariableName}_colormap, ${this.webGLVariableName}_steps, ${this.continuous})`;
    }

    get supports() {
        return {
            steps: -1, //continuous
            default: "YlOrRd",
            mode: "sequential",
            visible: true,
            title: "Colormap"
        };
    }

    get raw() {
        return this.pallete;
    }

    get encoded() {
        return this.value;
    }
};
WebGLModule.UIControls.registerClass("colormap", WebGLModule.UIControls.ColorMap);

/**
 * Advanced slider that can define multiple points and interval masks
 * | --- A - B -- C -- D ----- |
 * will be sampled with mask float[5], the result is
 * the percentage reached within this interval: e.g. if C <= ratio < D, then
 * the result is  4/5 * mask[3]   (4-th interval out of 5 reached, multiplied by 4th mask)
 * @type {WebGLModule.UIControls.AdvancedSlider}
 */
WebGLModule.UIControls.AdvancedSlider = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this.MAX_SLIDERS = 12;
        this.params = this.supports;
        $.extend(this.params, params);

        this.context.includeGlobalCode('advanced_slider', `
#define ADVANCED_SLIDER_LEN ${this.MAX_SLIDERS} 
float sample_advanced_slider(in float ratio, in float breaks[ADVANCED_SLIDER_LEN], in float mask[ADVANCED_SLIDER_LEN+1], in bool maskOnly) {
    float bigger = .0, actualLength = .0, masked = .0;
    bool sampling = true;
    for (int i = 0; i < ADVANCED_SLIDER_LEN; i++) {
        if (breaks[i] < .0) {
            if (sampling) masked = mask[i];
            sampling = false;
            break;
        }
       
        if (sampling) {
            if (ratio <= breaks[i]) {
                sampling = false;
                masked = mask[i];
            } else bigger++;
        }
        actualLength++;
    }
    if (sampling) masked = mask[ADVANCED_SLIDER_LEN];
    if (maskOnly) return masked;
    return masked * bigger / actualLength;
}`);
    }

    init() {
        this._updatePending = false;
        this.value = this.context.loadProperty(this.name, this.params.default);
        this.mask = this.context.loadProperty(this.name + "_mask", this.params.mask);

        this.value = this.value.slice(0, this.MAX_SLIDERS);
        this.sampleSize = this.value.length;

        this.mask = this.mask.slice(0, this.MAX_SLIDERS+1);
        let size = this.mask.length;
        this.connects = this.value.map(_ => true); this.connects.push(true); //intervals have +1 elems
        for (let i = size; i <  this.MAX_SLIDERS+1; i++) this.mask.push(-1);

        let format = this.params.max < 10 ? {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 1 }),
            from: v => Number.parseFloat(v)
        } : {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 0 }),
            from: v => Number.parseFloat(v)
        };

        if (this.params.visible) {
            const _this = this;
            let container = document.getElementById(this.id);
            noUiSlider.create(container, {
                range: {
                    'min': _this.params.min,
                    'max': _this.params.max
                },
                step: _this.params.step,
                start: _this.value,
                margin: _this.params.minGap,
                limit: _this.params.max,
                connect: _this.connects,
                direction: 'ltr',
                orientation: 'horizontal',
                behaviour: 'drag',
                tooltips: true,
                format: format,
                pips: $.extend({format: format}, this.params.pips)
            });

            if (this.params.pips) {
                let pips = container.querySelectorAll('.noUi-value');
                function clickOnPip() {
                    let idx = 0;
                    let value = Number(this.getAttribute('data-value'));
                    let values = container.noUiSlider.get().map(v => Number.parseFloat(v));
                    if (Array.isArray(values)) {
                        let closest = Math.abs(values[0] - value);
                        for (let i = 1; i < values.length; i++) {
                            let d = Math.abs(values[i] - value);
                            if (d < closest) {
                                idx = i;
                                closest = d;
                            }
                        }
                        container.noUiSlider.setHandle(idx, value, false, false);
                    } else { //just one
                        container.noUiSlider.set(value);
                    }
                    _this.value[idx] = value;

                    _this.changed(_this.name + "_mask", _this.mask, _this.mask, _this);
                    _this.context.invalidate();
                }

                for (let i = 0; i < pips.length; i++) {
                    pips[i].addEventListener('click', clickOnPip);
                }
            }

            if (this.params.invertMask) {
                let connects = container.querySelectorAll('.noUi-connect');
                for (let i = 0; i < connects.length; i++) {
                    connects[i].addEventListener('mouseup', function (e) {
                        let d = Math.abs(Date.now() - _this._timer);
                        _this._timer = 0;
                        if (d >= 180) return;

                        let idx = Number.parseInt(this.dataset.index);
                        _this.mask[idx] = 1 - _this.mask[idx];
                        this.style.background = _this.mask[i] >= 0.5 ? "var(--color-bg-danger-inverse)" : "var(--color-bg-primary)";
                        _this.context.invalidate();
                        _this._ignoreNextClick = idx !== 0 && idx !== _this.sampleSize-1;
                        _this.context.storeProperty(_this.name + "_mask", _this.mask);
                    });

                    connects[i].addEventListener('mousedown', function (e) {
                        _this._timer = Date.now();
                    });

                    connects[i].style.cursor = "pointer";
                }
            }

            container.noUiSlider.on("change", function doSomething(values, handle, unencoded, tap, positions, noUiSlider) {
                _this.value[handle] = _this._normalize(unencoded[handle]);
                _this.encodedValues = values;
                if (_this._ignoreNextClick) {
                    _this._ignoreNextClick = false;
                } else if (!_this._updatePending) {
                    //can be called multiple times upon multiple handle updates, do once if possible
                    _this._updatePending = true;
                    setTimeout(_ => {

                        //todo re-scale values or filter out -1ones
                        _this.changed(_this.name, unencoded, values, _this);
                        _this.context.storeProperty(_this.name, unencoded);

                        _this.context.invalidate();
                        _this._updatePending = false;
                    }, 50);
                }
            });

            this._updateConnectStyles(container);
        }

        //do at last since value gets stretched by -1ones
        for (let i =  this.sampleSize; i < this.MAX_SLIDERS; i++) this.value.push(-1);
    }

    _normalize(value) {
        return (value - this.params.min) / (this.params.max - this.params.min);
    }

    _updateConnectStyles(container) {
        if (!container) container = document.getElementById(this.id);
        let pips = container.querySelectorAll('.noUi-connect');
        for (let i = 0; i < pips.length; i++) {
            pips[i].style.background = this.mask[i] >= 0.5 ? "var(--color-bg-danger-inverse)" : "var(--color-bg-primary);";
            pips[i].dataset.index = (i).toString();
        }
    }

    glDrawing(program, dimension, gl) {
        gl.uniform1fv(this.breaks_gluint, Float32Array.from(this.value));
        gl.uniform1fv(this.mask_gluint, Float32Array.from(this.mask));
    }

    glLoaded(program, gl) {
        this.breaks_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_breaks[0]");
        this.mask_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_mask[0]");
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this.params.visible) return "";
        return `<span style="height: 54px;">${this.params.title}: </span><div id="${this.id}" style="height: 9px; 
margin-left: 5px; width: 60%; display: inline-block"></div>`;
    }

    define() {
        return `uniform float ${this.webGLVariableName}_breaks[ADVANCED_SLIDER_LEN];
uniform float ${this.webGLVariableName}_mask[ADVANCED_SLIDER_LEN+1];`;
    }

    get type() {
        return "float";
    }

    sample(ratio) {
        if (!ratio) return "ERROR advanced slider requires sample(ratio) argument!";
        return `sample_advanced_slider(${ratio}, ${this.webGLVariableName}_breaks, ${this.webGLVariableName}_mask, ${this.params.maskOnly})`;
    }

    get supports() {
        return {
            default: [0.2, 0.8],
            mask: [1, 0, 1],
            visible: true,
            maskOnly: false,
            invertMask: true,
            title: "Threshold",
            min: 0,
            max: 1,
            minGap: 0.05,
            step: undefined,
            pips: {
                mode: 'positions',
                values: [0, 20, 40, 50, 60, 80, 90, 100],
                density: 4
            }
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValues;
    }
};
WebGLModule.UIControls.registerClass("advanced_slider", WebGLModule.UIControls.AdvancedSlider);
