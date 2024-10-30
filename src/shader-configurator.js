/**
 * Script for shader configuration
 * - requires webgl module, ui_components.js, loader.js
 *
 * - build* methods render static pages
 * - run* methods accept callback and run an interactive selection
 * @namespace ShaderConfigurator
 */
var ShaderConfigurator = {

    /**
     * Prints info about shaders and controls available
     * @param nodeId DOM ID or node to render the content into
     */
    buildShadersAndControlsDocs: function(nodeId) {
        let node = typeof nodeId === "string" ? document.getElementById(nodeId) : nodeId;
        node.innerHTML = this.staticShadersDocs() + this.staticControlsDocs();
    },

    /**
     * Run shader sčelector
     * @param nodeId DOM ID or node to render the content into
     * @param onFinish, callback with shader ID as argument
     */
    runShaderSelector: function(nodeId, onFinish) {
        this.picker.init(this, nodeId, {
            onFinish: onFinish
        });
    },

    /**
     * Run shader and controls selector
     * @param nodeId DOM ID or node to render the content into
     * @param onFinish callback, argument is the visualization config with given shader and controls
     */
    runShaderAndControlSelector: function(nodeId, onFinish) {
        const _this = this;
        this.runShaderSelector(nodeId, (shaderId) => {
            const src = _this.picker.granularity("image")
                || _this.picker.selectionRules.granularity._config.image.granular;
            if (src) {
                const image = document.createElement('img');
                image.onload = () => {
                    ShaderConfigurator.setData(image);
                    _this.runControlSelector(nodeId, shaderId, onFinish);
                }
                image.src = src;
            } else {
                _this.runControlSelector(nodeId, shaderId, onFinish);
            }
        });
    },

    /**
     * Run controls selector for given shader
     * @param nodeId DOM ID or node to render the content into
     * @param shaderId shader ID to configure controls for
     * @param onFinish callback, argument is the visualization config with given shader and controls
     */
    runControlSelector: function(nodeId, shaderId, onFinish=undefined) {
        let node = typeof nodeId === "string" ? document.getElementById(nodeId) : nodeId;
        this._onControlSelectFinish = onFinish;
        node.innerHTML = this.getInteractiveControlsHtmlFor(shaderId);
        this.setModuleActiveRender();
    },


    /**
     * Set data for realtime data postprocessing - interactive selector can render 'how it looks'
     * @param {(Image|Canvas)} data to process
     */
    setData: function(data) {
        const module = this._getModule(this._uniqueId + 'live-setup-interactive-controls');
        if (module) {
            module.setDimensions(data.width, data.height);
        }
        this._renderData = data;
    },

    setUniqueId: function(id) {
        this._uniqueId = id;
    },

    /**********************/
    /*** STATIC RENDER ****/
    /**********************/
    _uniqueId: "live-setup-",

    staticShadersDocs: function() {
        let html = ["<div><h3>Available shaders and their parameters</h3><br>"];
        const uiControls = this._buildControls();
        for (let shader of WebGLModule.ShaderMediator.availableShaders()) {
            let id = shader.type();

            html.push( "<div class='d-flex'><div style='min-width: 150px'><p class='f3-light mb-0'>",
                shader.name(), "</p><p style='max-width: 150px;'>", shader.description(),
                "</p></div><div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>",
                "<img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='modules/webgl/shaders/",
                shader.type(),".png'></div><div><code class='f4'>", id, "</code>");

            const supports = this.getAvailableControlsForShader(shader);
            for (let control in supports) {
                let supported = supports[control];
                html.push("<div><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);'",
                    "class='position-relative'><span class='flex-1'>Control <code>",
                    control, "</code> | Supports: ", supported.join(", ") ,"</span></span></div>");
            }

            let didParams = false;
            for (let param in shader.customParams) {
                if (!didParams) {
                    didParams = true;
                    html.push("<hr>");
                }
                html.push("<div><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);'",
                    "class='position-relative'><span class='flex-1'>Parameter <code>",
                    param, "</code> <br><span class='text-small'>", shader.customParams[param].usage ,"</span></span></span></div>");
            }
            html.push("</div></div><br>");
        }
        html.push("</div><br>");
        return html.join("");
    },

    staticControlsDocs: function() {
        let html = ["<div><h3>Available controls and their parameters</h3><br>"];
        const uiControls = this._buildControls();

        for (let type in uiControls) {
            html.push("<div><h4>Type <code>", type, "</code></h4>");
            for (let ctrl of uiControls[type]) {
                html.push( "<div class='d-flex'><div style='min-width: 150px'><p class='f3-light mb-0'>",
                    ctrl.name,
                    "</p></div><div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>",
                    "</div><div>");

                html.push("<div><pre>", JSON.stringify(ctrl.supports, null, 4) ,"</pre></div>");
                html.push("</div></div><br>");
            }
            html.push("</div>");
        }
        html.push("</div><br>");
        return html.join("");
    },

    /**********************/
    /*** DYNAMIC RENDER ***/
    /**********************/

    REF: 'ShaderConfigurator',

    //todo why this.REF not working
    __chngtml: (paramName, key, valueGetter) =>
        `ShaderConfigurator.refreshUserUpdated(this, '${paramName}', '${key}', ${valueGetter})`,

    _onControlSelectFinish: undefined,

    /**
     * Render number by its value, a map of [uiType] => function values
     * @param name name of the control as defined by its shader
     * @param params for supported parameters see the control 'c.supports' value
     */
    uiRenderers: {},

    refreshUserSwitched(controlId) {
        if (this.renderStyle.advanced(controlId)) {
            this.renderStyle.setUi(controlId);
        } else {
            this.renderStyle.setAdvanced(controlId);
        }
        this.refresh();
    },

    refreshUserSelected(controlId, type) {
        if (!this.setup.params[controlId]) {
            this.setup.params[controlId] = {};
        }
        this.setup.params[controlId].type = type;
        this.refresh();
    },

    refreshUserScripted(node, controlId) {
        try {
            this.parseJSONConfig($(node).val(), controlId);
            this.refresh();
        } catch (e) {
            node.style.background = 'var(--color-bg-danger-inverse)';
        }
    },

    refreshUserUpdated(node, controlId, keyChain, value) {
        try {
            const ensure = (o, key) => {
                if (!o[key]) o[key] = {};
                return o[key];
            }

            let ref = ensure(this.setup.params, controlId);
            const keys = keyChain.split('.');
            const key = keys.pop();
            keys.forEach(x => ref = ensure(ref, x));
            ref[key] = value;
            this.refresh();
        } catch (e) {
            node.style.background = 'var(--color-bg-danger-inverse)';
        }
    },

    parseJSONConfig(value, controlId) {
        const config = JSON.parse(value);
        const control = this.active.layer[controlId];
        const t = WebGLModule.UIControls.IControl.getVarType;

        function extendValuesBy(to, nameMap, suffix="") {
            Object.keys(nameMap).forEach(key => {
                const tVal = to[key],
                    fVal = nameMap[key],
                    tType = t(tVal),
                    fType = t(fVal);

                if (!tVal) return;
                if (fVal && tType === "object" && fType === "object") {
                    extendValuesBy(tVal, fVal, key + ".");
                    return;
                }

                if (tVal == fVal) {
                    //override config with cached values, only if cached did not change
                    to[key] = control.load(tVal, suffix + key);
                }
            });
            return to;
        }
        extendValuesBy(config, control.supports);

        config.type = this.active.layer[controlId].uiControlType;
        this.setup.params[controlId] = config;
        return config;
    },

    refresh() {
        this.setup.shader.cache = {};
        $("#"+this._uniqueId+"interactive-container").replaceWith(this.getInteractiveControlsHtmlFor(this.setup.shader.type));
        this.setModuleActiveRender();
    },

    setModuleActiveRender() {
        if (this._renderData) {
            const module = this._getModule(this._uniqueId + 'interactive-controls');
            if (module) {
                 //timeout so that DOM gets loaded
                const _this = this;
                setTimeout(()=>{
                    document.getElementById(_this._uniqueId + "realtime-rendering-example").appendChild(module.gl.canvas);
                    document.getElementById(_this._uniqueId + "realtime-rendering-example").appendChild(this._renderData);
                    module.processImage(this._renderData,
                        {width: this._renderData.width, height: this._renderData.height},
                        0,
                        1);
                }, 150);
            }
        }
    },

    _buildControlJSONHtml(controlId) {
        let control = this.active.layer[controlId];
        const params = {...control.params};
        delete params.type;

        return `<div id='${this._uniqueId}interactive-control-${controlId}'>
<textarea rows='5' class='form-control m-2 layer-params' style='resize: vertical; width: 90%;box-sizing: border-box;' 
onchange="${this.REF}.refreshUserScripted(this, '${controlId}');">
${JSON.stringify(params, null, '\t')}
</textarea></div>`;
    },

    setup: {
        _visualization: {
            name: "Shader controls and configuration",
            shaders: {
                "1": {
                    name: undefined,
                    dataReferences: undefined,
                    params: {}
                }
            }
        },

        get vis () { return this._visualization },
        get shader() { return this._visualization.shaders["1"] },
        get params() { return this._visualization.shaders["1"].params },
    },

    active: {
        mod: function(id) {
            let _this = window.ShaderConfigurator,
                module = _this._getModule(_this._uniqueId + id);
            if (module) return module;
            throw "Module not instantiated!";
        },
        get vis () { return this.mod('interactive-controls').visualization(0)},
        get shader() { return this.mod('interactive-controls').visualization(0).shaders["1"] },
        get layer() { return this.mod('interactive-controls').visualization(0).shaders["1"]._renderContext }
    },

    renderStyle: {
        _styles: {},
        advanced: function (key) {
            return this._styles[key] == true;
        },
        setAdvanced: function (key) {
            this._styles[key] = true;
        },
        ui: function (key) {
            return !this.advanced(key)
        },
        setUi: function (key) {
            delete this._styles[key];
        }
    },

    getInteractiveControlsHtmlFor: function(shaderId) {
        let shader;
        for (let s of WebGLModule.ShaderMediator.availableShaders()) {
            if (shaderId === s.type()) {
                shader = s;
                break;
            }
        }
        if (!shader) throw "Invalid shader: " + shaderId + ". Not present.";

        const supports = this.getAvailableControlsForShader(shader);
        const _this = this;

        function onLoaded() {}
        const module = this._buildModule(this._uniqueId + 'interactive-controls', function (title, html, dataId, isVisible, layer, isControllable = true) {
            const renders = [];
            for (let control in layer._renderContext) {
                let supported = supports[control];
                if (!supported) continue; //skip other props, supports keep only control

                //todo onchange

                //render type and renderer switching
                renders.push("<div><div class='rounded-2 m-1 px-2 py-1' style='background: var(--color-bg-tertiary)'><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);'",
                    "class='position-relative'><span class='flex-1'>Control <code>",
                    control, "</code> | One of supported: &nbsp;", `<select class='form-control' 
onchange="${_this.REF}.refreshUserSelected('${control}', this.value);">`);

                const activeControl = layer._renderContext[control],
                    activeType = activeControl.uiControlType;
                for (let supType of supported) {
                    let active = activeType === supType ? "selected" : "";
                    renders.push("<option value='", supType ,"' ", active, ">", supType, "</option>");
                }
                const params = {...activeControl.params};
                delete params.type;
                renders.push("</select></span></span>");

                const uiRenderer = _this.uiRenderers[activeType],
                    willRenderUi = _this.renderStyle.ui(control) && uiRenderer;

                if (uiRenderer) {
                    renders.push(`&emsp;<span class="float-right">Simple configuration &nbsp;<input type='checkbox' class='form-control' 
onchange="${_this.REF}.refreshUserSwitched('${control}')" ${willRenderUi ? "checked " : ""}></span>`);
                }
                renders.push("</div>");

                //render control config
                if (willRenderUi) {
                    let controlObject = _this.active.layer[control];
                    const params = {...controlObject.params};
                    delete params.type;
                    renders.push("<div class='m-2 layer-params'>", uiRenderer(control, controlObject.params), "</div>");
                } else {
                    renders.push(_this._buildControlJSONHtml(control));
                }
                renders.push("</div>");
            }

            return `<div id="${_this._uniqueId}interactive-container">
${renders.join("")}
<style>.configurable-border.shader-input span{display: inline-block; margin: 5px 15px;}</style>
<div class="m-2 p-2 border rounded-2">
    <div id="${_this._uniqueId}interactive-shader-head" style="max-width: 500px; min-width: 400px;" class="d-inline-block configurable-border shader-input">
        <div class="shader-part-name px-2 f3-light">${title}.</div>
        <div class=" px-2 py-1">note: resets on config change, permanent changes perform above</div>
        ${html}
    </div>
<div id="${_this._uniqueId}realtime-rendering-example" class="d-inline-block"></div>
</div>
</div>
</div>`;
        }, onLoaded);
        module.reset();

        const data = shader.sources(); //read static sources declaration
        this.setup.shader.type = shaderId;
        this.setup.shader.dataReferences = data.map((x, i) => i);
        this.setup.shader.name = "Configuration: " + shaderId;

        const finish = this._onControlSelectFinish ?
            `<button class="btn" onclick="${this.REF}._onControlSelectFinish(${this.REF}.getCurrentShaderConfig());">Done</button>` : '';

        module.addVisualization(this.setup.vis);
        module.prepareAndInit(data.map(x => ""), this._renderData?.width, this._renderData?.height);
        return `<div><h3>Available controls and their parameters</h3><br><div id='${this._uniqueId}interactive-controls'></div></div>${finish}<br>`;
    },

    getCurrentShaderConfig() {
        return JSON.parse(JSON.stringify(this.setup.shader, WebGLModule.jsonReplacer))
    },

    /**********************/
    /***** UTILITIES ******/
    /**********************/

    getAvailableControlsForShader: function(shader) {
        const uiControls = this._buildControls();
        let controls = shader.defaultControls;

        //this is done with visualization layer as hard-coded control option, include here as well
        if (controls.opacity === undefined || (typeof controls.opacity === "object" && !controls.opacity.accepts("float"))) {
            controls.opacity = {
                default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
                accepts: (type, instance) => type === "float"
            };
        }

        const result = {};
        for (let control in controls) {
            if (control.startsWith("use_")) continue;

            let supported = [];
            if (controls[control] === false) continue;
            if (controls[control].required?.type) {
                supported.push(controls[control].required.type);
            } else {
                for (let glType in uiControls) {
                    for (let existing of uiControls[glType]) {
                        if (controls[control] === false) continue;
                        if (!controls[control].accepts(glType, existing)) continue;
                        supported.push(existing.name);
                    }
                }
            }
            result[control] = supported;
        }
        return result;
    },

    _buildModule: function(id, htmlRenderer, onReady) {
        if (this["__module_"+id]) return this["__module_"+id];
        const _this = this;
        const module = new WebGLModule({
            htmlControlsId: id,
            webGlPreferredVersion: "2.0",
            htmlShaderPartHeader: htmlRenderer,
            ready: onReady,
            resetCallback: () => {
                if (_this._renderData) {
                    module.processImage(_this._renderData,
                        {width: _this._renderData.width, height: _this._renderData.height},
                        0,
                        1);
                }

            }
        });
        this["__module_"+id] = module;
        return module;
    },

    _getModule: function(id) {
        return this["__module_"+id];
    },

    _buildControls: function () {
        if (this.__uicontrols) return this.__uicontrols;
        this.__uicontrols = {};
        let types = WebGLModule.UIControls.types();
        let fallbackLayer = new WebGLModule.IdentityLayer("id", {
            shaderObject: {},
            webglContext: {},
            interactive: false,
            invalidate: () => {},
            rebuild: () => {},
            refetch: () => {}
        });
        fallbackLayer.construct({}, [0]);
        for (let type of types) {
            let ctrl = WebGLModule.UIControls.build(fallbackLayer, type, {
                default: {
                    type: type
                },
                accepts: () => true,
            }, Date.now(), {});
            let glType = ctrl.type;
            ctrl.name = type;
            if (!this.__uicontrols.hasOwnProperty(glType)) this.__uicontrols[glType] = [];
            this.__uicontrols[glType].push(ctrl);
        }
        return this.__uicontrols;
    },

    /**
     * Shader picking
     */
    picker: {
        selectionRules: {
            granularity: {
                _config: {
                    type: "radio",
                    name: "The data granularity",
                    description: "Data granularity tells us what detail we aim for - the data might be large regions of same values and we are interested in bounaries only, or we might be interested in value difference at close proximity.",
                    info: {
                        plain: "Large regions of same or similar values",
                        other: "Not very granular, but still diverse values",
                        granular: "Dense data with mild or high variety",
                    },
                    image: {
                        plain: "data:image/png;base64,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",
                        other: "data:image/png;base64,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",
                        granular: "data:image/png;base64,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",
                    }
                },
                plain: {
                    "bipolar-heatmap": 0.1,
                    "edge": 0.8,
                    "heatmap": 0.1,
                },
                other: {
                    "bipolar-heatmap": 0.4,
                    "heatmap": 0.4,
                    "colormap": 0.1,
                    "identity": 0.1,
                },
                granular: {
                    "bipolar-heatmap": 0.3,
                    "heatmap": 0.3,
                    "colormap": 0.3,
                    "identity": 0.1,
                }
            },
            ordering: {
                _config: {
                    type: "radio",
                    name: "The data ordering",
                    description: "Describes the data order / direction.",
                    names: {
                        sequential: "Sequential",
                        bidirectional: "Diverging",
                        cyclic: "Cyclic",
                        categorical: "Categorical"
                    },
                    info: {
                        sequential: "Both minimum and maximum in the data is equal to min and max in pixels, or vice versa. The data is linear.",
                        bidirectional: "Your data min or max point is in the middle, and the data ranges in two directions linearly.",
                        cyclic: "Your data have the same value semantics at both high and low pixel values.",
                        categorical: "The data has no ordering and each value represents a discrete category."
                    },
                    image: {
                        sequential: "data:image/png;base64,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",
                        bidirectional: "data:image/png;base64,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",
                        cyclic: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAKT2lDQ1BQaG90b3Nob3AgSUNDIHByb2ZpbGUAAHjanVNnVFPpFj333vRCS4iAlEtvUhUIIFJCi4AUkSYqIQkQSoghodkVUcERRUUEG8igiAOOjoCMFVEsDIoK2AfkIaKOg6OIisr74Xuja9a89+bN/rXXPues852zzwfACAyWSDNRNYAMqUIeEeCDx8TG4eQuQIEKJHAAEAizZCFz/SMBAPh+PDwrIsAHvgABeNMLCADATZvAMByH/w/qQplcAYCEAcB0kThLCIAUAEB6jkKmAEBGAYCdmCZTAKAEAGDLY2LjAFAtAGAnf+bTAICd+Jl7AQBblCEVAaCRACATZYhEAGg7AKzPVopFAFgwABRmS8Q5ANgtADBJV2ZIALC3AMDOEAuyAAgMADBRiIUpAAR7AGDIIyN4AISZABRG8lc88SuuEOcqAAB4mbI8uSQ5RYFbCC1xB1dXLh4ozkkXKxQ2YQJhmkAuwnmZGTKBNA/g88wAAKCRFRHgg/P9eM4Ors7ONo62Dl8t6r8G/yJiYuP+5c+rcEAAAOF0ftH+LC+zGoA7BoBt/qIl7gRoXgugdfeLZrIPQLUAoOnaV/Nw+H48PEWhkLnZ2eXk5NhKxEJbYcpXff5nwl/AV/1s+X48/Pf14L7iJIEyXYFHBPjgwsz0TKUcz5IJhGLc5o9H/LcL//wd0yLESWK5WCoU41EScY5EmozzMqUiiUKSKcUl0v9k4t8s+wM+3zUAsGo+AXuRLahdYwP2SycQWHTA4vcAAPK7b8HUKAgDgGiD4c93/+8//UegJQCAZkmScQAAXkQkLlTKsz/HCAAARKCBKrBBG/TBGCzABhzBBdzBC/xgNoRCJMTCQhBCCmSAHHJgKayCQiiGzbAdKmAv1EAdNMBRaIaTcA4uwlW4Dj1wD/phCJ7BKLyBCQRByAgTYSHaiAFiilgjjggXmYX4IcFIBBKLJCDJiBRRIkuRNUgxUopUIFVIHfI9cgI5h1xGupE7yAAygvyGvEcxlIGyUT3UDLVDuag3GoRGogvQZHQxmo8WoJvQcrQaPYw2oefQq2gP2o8+Q8cwwOgYBzPEbDAuxsNCsTgsCZNjy7EirAyrxhqwVqwDu4n1Y8+xdwQSgUXACTYEd0IgYR5BSFhMWE7YSKggHCQ0EdoJNwkDhFHCJyKTqEu0JroR+cQYYjIxh1hILCPWEo8TLxB7iEPENyQSiUMyJ7mQAkmxpFTSEtJG0m5SI+ksqZs0SBojk8naZGuyBzmULCAryIXkneTD5DPkG+Qh8lsKnWJAcaT4U+IoUspqShnlEOU05QZlmDJBVaOaUt2ooVQRNY9aQq2htlKvUYeoEzR1mjnNgxZJS6WtopXTGmgXaPdpr+h0uhHdlR5Ol9BX0svpR+iX6AP0dwwNhhWDx4hnKBmbGAcYZxl3GK+YTKYZ04sZx1QwNzHrmOeZD5lvVVgqtip8FZHKCpVKlSaVGyovVKmqpqreqgtV81XLVI+pXlN9rkZVM1PjqQnUlqtVqp1Q61MbU2epO6iHqmeob1Q/pH5Z/YkGWcNMw09DpFGgsV/jvMYgC2MZs3gsIWsNq4Z1gTXEJrHN2Xx2KruY/R27iz2qqaE5QzNKM1ezUvOUZj8H45hx+Jx0TgnnKKeX836K3hTvKeIpG6Y0TLkxZVxrqpaXllirSKtRq0frvTau7aedpr1Fu1n7gQ5Bx0onXCdHZ4/OBZ3nU9lT3acKpxZNPTr1ri6qa6UbobtEd79up+6Ynr5egJ5Mb6feeb3n+hx9L/1U/W36p/VHDFgGswwkBtsMzhg8xTVxbzwdL8fb8VFDXcNAQ6VhlWGX4YSRudE8o9VGjUYPjGnGXOMk423GbcajJgYmISZLTepN7ppSTbmmKaY7TDtMx83MzaLN1pk1mz0x1zLnm+eb15vft2BaeFostqi2uGVJsuRaplnutrxuhVo5WaVYVVpds0atna0l1rutu6cRp7lOk06rntZnw7Dxtsm2qbcZsOXYBtuutm22fWFnYhdnt8Wuw+6TvZN9un2N/T0HDYfZDqsdWh1+c7RyFDpWOt6azpzuP33F9JbpL2dYzxDP2DPjthPLKcRpnVOb00dnF2e5c4PziIuJS4LLLpc+Lpsbxt3IveRKdPVxXeF60vWdm7Obwu2o26/uNu5p7ofcn8w0nymeWTNz0MPIQ+BR5dE/C5+VMGvfrH5PQ0+BZ7XnIy9jL5FXrdewt6V3qvdh7xc+9j5yn+M+4zw33jLeWV/MN8C3yLfLT8Nvnl+F30N/I/9k/3r/0QCngCUBZwOJgUGBWwL7+Hp8Ib+OPzrbZfay2e1BjKC5QRVBj4KtguXBrSFoyOyQrSH355jOkc5pDoVQfujW0Adh5mGLw34MJ4WHhVeGP45wiFga0TGXNXfR3ENz30T6RJZE3ptnMU85ry1KNSo+qi5qPNo3ujS6P8YuZlnM1VidWElsSxw5LiquNm5svt/87fOH4p3iC+N7F5gvyF1weaHOwvSFpxapLhIsOpZATIhOOJTwQRAqqBaMJfITdyWOCnnCHcJnIi/RNtGI2ENcKh5O8kgqTXqS7JG8NXkkxTOlLOW5hCepkLxMDUzdmzqeFpp2IG0yPTq9MYOSkZBxQqohTZO2Z+pn5mZ2y6xlhbL+xW6Lty8elQfJa7OQrAVZLQq2QqboVFoo1yoHsmdlV2a/zYnKOZarnivN7cyzytuQN5zvn//tEsIS4ZK2pYZLVy0dWOa9rGo5sjxxedsK4xUFK4ZWBqw8uIq2Km3VT6vtV5eufr0mek1rgV7ByoLBtQFr6wtVCuWFfevc1+1dT1gvWd+1YfqGnRs+FYmKrhTbF5cVf9go3HjlG4dvyr+Z3JS0qavEuWTPZtJm6ebeLZ5bDpaql+aXDm4N2dq0Dd9WtO319kXbL5fNKNu7g7ZDuaO/PLi8ZafJzs07P1SkVPRU+lQ27tLdtWHX+G7R7ht7vPY07NXbW7z3/T7JvttVAVVN1WbVZftJ+7P3P66Jqun4lvttXa1ObXHtxwPSA/0HIw6217nU1R3SPVRSj9Yr60cOxx++/p3vdy0NNg1VjZzG4iNwRHnk6fcJ3/ceDTradox7rOEH0x92HWcdL2pCmvKaRptTmvtbYlu6T8w+0dbq3nr8R9sfD5w0PFl5SvNUyWna6YLTk2fyz4ydlZ19fi753GDborZ752PO32oPb++6EHTh0kX/i+c7vDvOXPK4dPKy2+UTV7hXmq86X23qdOo8/pPTT8e7nLuarrlca7nuer21e2b36RueN87d9L158Rb/1tWeOT3dvfN6b/fF9/XfFt1+cif9zsu72Xcn7q28T7xf9EDtQdlD3YfVP1v+3Njv3H9qwHeg89HcR/cGhYPP/pH1jw9DBY+Zj8uGDYbrnjg+OTniP3L96fynQ89kzyaeF/6i/suuFxYvfvjV69fO0ZjRoZfyl5O/bXyl/erA6xmv28bCxh6+yXgzMV70VvvtwXfcdx3vo98PT+R8IH8o/2j5sfVT0Kf7kxmTk/8EA5jz/GMzLdsAAAAgY0hSTQAAeiUAAICDAAD5/wAAgOkAAHUwAADqYAAAOpgAABdvkl/FRgAAQ+NJREFUeNrsvXuw51dVJ/pZ63vO6e7T7w7pTrrTnXeUvEgCQhDMaMBoIjLoYGoqvIPl5Y4wZpgaIBSEUiMBS7mUQQdSECITSVX0FtTVIY4K18uIo6LyCIklCSQmne50p9Pvx3n91uf+sdfee+39+wVPeNyLZU7q5PQ5v9f3u/fa6/FZa32WkMQzX/96v/SZJXhGAJ75ekYAnvl6RgCe+fpX+TU16Y+vfOUrIQCgAgEgEEAEYBWZ/Dfxv4sSoP8OQESQ/qkQsD4XSO/d/U5/P/XnAun14k8QqP+d/rrwOATQ/FyFgOsFci5FzhLKGaLYTshWhWyG8FkQWS/AGhGsAmRKRJYAnIDgqEAOAdgHwV6F7oJgpwgeFujDw9TwjVtuuWXf98vm3XXXXRARmBmuu+66b+s9ZFIUcO2114ZNyltUF5y+wfVvAgqg4q+hP08F+T/fqbLp5bVFCASU+hn1cwEVKUKBuOkuDAI5HyqXCXiJUC6m4gKBbI3vkZ6nRY4lXE++V+R7LgIeBVkAYLeK/gME94vo11Tl/ptvvvl/fj8IwNzcHFQVqgIg/VRVv36BSvr9lT/3c/+8BlBVgIRoXmotwiCuBlhOIiCiUKGfPl9MEqpJGBC0Qtp4F6O82P53TU8ui06ExyVoDsgsiCsAeREEP6yil1MwKy58CgWFUAjg15XuC66l6nsGHQUVSZ8pVUCrsBIieqoAp0LkSn/oxE3vfveXofpVFblPVO59z03v+fN/8SZAVCCsR1EovoYC8cVMP1keVxWQ4ouY3gOSFp2UIollW1VAoggJXc13Jw7qn+PC9hIReakIrgTxfCJdl59tUFiuXVwYRToBlCDkxbzkU49m85PgJ4HPmoJCvyYAwCoDXqjgC80IGB569003/eOg+o9Hjx69Ib/HMDXglltu+ZcjACpaNhxRTTOpaU2nAUDeuLQ4KnVB1RebAgx1edNJcgHwA9/6GoALEzCogNTtArxMBNdQcLUCQ3mt5k0RKJMZyiYpf1Y63+FEh88tmkfpQur2TYPfgqydgkNStFjVEgZCBWeCcibJq1bPzv5bIx8F8ODCwsL1N77jRv/MpJ5vvvnm72MBUO2crHQSRHyxiz0WFDkRgTA7cFrULLNgIDuLeXG1OBT9YvprL1KRn6HKK4S4VMQ3OH5e9EO0nuJiRmDVLGXxUqlq34VRRFu1X0wO/bF0byy+COsaAMncZWOpApIKwRkqegbAi1auWvUCIR9YWFx8RbYqN7373YAqVASigvfc9J7vIxPgNw0YRIbg9RNafi8yEBZOy6ZnlalF/Sblr+Fxd8dc9bqdFlxE4FoVuRaQ80SzP9FFrFIdO4BFa0QnUzVdazEVrH5EChw0CGl73dFsCLJWyP4Ci6kyo5tNBUn0TrXIsAHABlE5Y8XKFf8I4kuLi4v/3tyTctOBm97zHgyqOHLkCKLpWLlyZY3IxAXGv88444zvnQZIGzpUM8CqvilVsRYbGmytltManbxWKLKDF15/mkBeDeGrFHohuigk+hDFIxSpCj4vDFo7z3w6/aSBrYef1DtqtBEjFX+/GjkkYRTEcNeVG2uERFYzVy9VZkXkPAi2zszMfAnA/zUajd6TfIrkP5HEmtWrYUwCNjc3h7kTc43pWLVyJfi9NwFSpLo6enlh1FWjVHzAVXoN4fqQCu6Js1v0ssGvFeB1IrySMtQNKoue7b00mEI9sYRgSGYqe/SKaoqyKtdqioqDG02Pa6JsGiDZVEhBzPJJz+GX+OYBVqKfRuhZoyWCALGGwCUqsm0Yhh+w0ejfB9ORPtPXcnb1agiJufn5LNOYn58vpuN77AMkb7cuRg6n0hJv3batqKNsx5LpUIj635p/+3PD8x544Os/BODnIXijEAOkdbgE9VSXoIQCDNmOu1CpQkyKkECA6elprF49i9nZ1Vi1ahVWrVyFFStmMDMzg+mZGagqpqam0oaORoAAi0tLGC2NsLCwkE7f3ByOHzuKI0ePYXFxsZoxCGijIsxwXwOu/tk4jNVvyuYhWTWerKrXishZJH/n+uuvv0OQ1zFrNK1OrQh+67d+y98L+G5lcb+FACCEYQG585COJMyBQYNAjYAyLQYF9EfSv9PvaeEAKPHAg1//BRF5kwCXJnVJQAYMUg5SVf/xRGlrbvLZXDm7EuvXr8fadWuxbs06rFi5wjVZFlCti6p+0mm+d0kgV62cSturVWCzgM8vzOPQocM4ePAgnty/H0cOHw5+QLoSS/8oDmI0HXQNEDVXglrkhwi5+eO3337OG66//l1pUavGEBaXBTMzMxARjJaWQK3W8HtjAvzI0dV10vQ17qYllUdVD4LS31QVMIF51KAATAQqBirw0D89cq4I3jyo/iKAoZgSPxrRaWx9jA5ipmDFyhXYtGkTNm7cmJwl10SKpKb9EmGuitUDNljyZ0wA1XySDEaBwkBqkmUt5xsrVqzAls1bsOWULRBRzJ04jsd3P46du3bh6JEjoLExXQGlLL6DVSMWsExAVLaB+o47Pn7HmaLyO69//eu/gBpQpeez7rcOA2iWBOQ7lICniALcnrqzNhRHRwrcm1WQGaECWI7qaIj4GpkExCDYvfPRq1T1BgGuZkYPEfMJEnw8P0HF2083OjVMYf369diwcQNmZ2eLZ5w+V9P+KqHW5i1I+sJnJNMgUNBYU2JJNqBmoN9Uvi8zQNSgbu9XrVqFs84+C2efcw4OHjqEnY8+isceewzzCwtBgAuqyREhBTwjS2SSbpdQ1QHEdRRu+8QnPvGh1772tX+Q1IYDZWV9U0REj0a+U0vwFAKQkbQKo4oCUtQlYfm0w9IJT8cJNAGVUI6SdmAS3T379lwvom8VkQt6r73E5x5tVNSOBb1bMb0CGzdsxPoN6zFoUtNJCJNwpY3x1TC/JuYzbxATmGsHwM2XWJI2U1CTHAiSEIglgMh1d9IGBn+P9PeU6yA2rF+PDRs24MILL8TOnY/iwQe/gWPHjpUoxkYmOUwgKwSeVLwUwXS/6d8A2PLf7vxvW17z6tf8Ngy+nmnDVbQiqPld7HsRBmbnBVKBkSErrqxiDaIK9ZMjfiViAnOnSMywf//+t6vo2whski58g3SJIalhGkQxPT2FjRs3Yu2atcU5HZEY0lEtx9zyhoUvo0GoKC4NfQPyyTP4xpsLAWFQiAFQA/Pxd9lK7gthrp6TptAQVAh27DgdO3acjl27duHrD3wdR44cSVEhBeanP2ksNCe76iYBBT8olF/55Cc/ufG66667Ob02rRPpTiSQzI4KKIZvNzb8ljhAvDEElQYKjJZOkxHMqtYEJuavNxw8cHiNiLxzELmROVLo8HaihmIxPh9UsXbdeqxbt7Y6nWbu0BEGg1pCdyiAqiUhENdEyPKRfAFXVun6LN3fSNNzktLJz2NVJGolr6ApwE/+hPsjSU4IEweiIAVc2rZtG7Zt24aHH35Y7r//fiwsLNQowVhh9Jwsc81nkk85N5H81bvu+uQaQt573XXXHYabsazsKP4+pIeYAdL+Tp3AiJhJ9vyzbVa4HXMVbOp+QNogmuHosRMnqeq7oHqDBhi1EYCav6/CIILZVauwdl1S9XnT4RtrAMQI1aL8k6PJHJHkx5kiESZPMGkIz18k5D6dwPwaVwdkDulcQwgA+ieFUK9oGTF3irNNZznOooIzzzwT27dvx1e/+lU89NBD7lfR7Xk0u6yIUn4gbejbB9UVd33yrvcSeCKajigEQEIhxVULKd9hFJBPexaAEsCmGzOjO0XpGCU/IG3Q4uLCSSLDe0TxFmYYNTt5yClZlo0VX9ipqQFr1qz1cMctNbVERvSNL0LnKt+QTmhdz+TRS9ZSngQqjqs7XmWDq+SATA6iwoUNgqzzTVNY1qDSxY2gRxpZHbp+BzA1NYXnPve52HH6Dnzxb76I48ePI7osyZ8wUBSStau4aUlm6wZVHdavW/fLhw8dfhImoLo5K+/B8rcSRFqBbp5eSZiEuFk9LsaQvG0dtKhkGEEYzAhaUstLS0trIPIuVbylFCJ4MUL5mYsVtH7OihUrsHbtOgzDAHN1T6ZNT+o/fVbG2wkDLUUdNIP5z/z8rGaN/hozmD/PjOl1NJg/lt/XLGED9b3yYwb/wPL+JMPv6XXpuv3a82P+ffKzTsZVV12FHafvSNfnWpRIfkV+L7hjWBRB2uW3EHjX+o0b1mR1D2TVj7JWrYmxqpHk6WiAYarCr+yqZ9w5W1pYgGlymFTTyYEBKvJOiNwgqJVCffWPqlf/uL2aWTGD6emZYs9gBlMFXP2XuDzbZWTHM3n3IqyOKKx4/xmrMGWFct2rtrwuYjCqA1moUQMEIvW9PLgo96rBMZSS7MpCh6I/SniRF3xqCi94/guw+eST8Xd/+3dJOByuNvMQj+ZacgiRAiHEDSBPGO2dWdMUASuRRXIsmLWCMAdiE/3Ep6gHkJL6lYDBi9feIcfVDq6kDyBmpqbfDuDGmIevBSI1OZSjC9EE2Q7DkC7Wgn7102FQaAzrsmNX4pG0UaSWcI3u9ZXNMboQiJsLz8VlIVA/h8FPSKbfnVrRct9mTJ+X04tegmXmAuNms4SLOdRgq2/POussbNiwEf/zL/4CJ04cLw5ygXh901E2n3ndb9y4YdOhgwcPvJ8lP86yB2RyXHO+QkIIQ+XyTICKQgfF4N64aEqtJlxfoaLpBLnqNCNWrpi5XkTepoNCdEiqXcXVvXiCQyA6pPdQwdTUVLqprJrJRmXTVbG5CJuxqGxENe4miO4IlfdxNV7ek9WcmCNp9H8ns4Ci8o2dii9mqbi+sHwCi9pPmsUyFpEus5qs7ho2btyIH3/pS7F+/Xo3cSifK/Gzs7Ivapxv27Rp0/VpV7MfYPWMu/9TzAErmrhsAUjpR/WQzDHxYfCEjpaNMRpmZ1dfJaJvVZVNKoJBWjs/uN+gQSgSOhoWLdrWLFisfoDRGrudNtg3kOE7b5IhnIq80f45wa9oXtMLYfYRXMiAKJz1p0VV7L6Cuf5C/LzOJwCJ2dlVeMmVL8FJJ20KaGXWBBG9RHx8E4G3Hjly9KryXNbX0SOqNkp4ujWBoTxXY7xe8HGDmmDjho3nEnoDwAsaZE+6qlpmCBkYjZZCosWSrxGQuoLd021+QPXgkKwxCZnBHCXLEF6Cd+kgUQoJq6svJkepsg+mT8L9CQLrSK4BZK0Y16RStuoTJLuagaEAHWcfx30WRx9KDkIEJSeSIik2h9ADD8xMT+NHf/RH8fnPfx779u0DhiEHirnYDMwYhREYBAJcQPKGI4ePPDS7evaBJO1a0cZcl8BU+RSya8txAoe2/j7Y77ypNMJSCPdmFbma9IKL7PDlWrAS+6eTsrgwD4i7MOLhmsPIGe7MnpRpQt5gmhw+SahedrLoQmWGlFfIISIUQpLAvSL6FyT/HrCvAvpNA56UAPhkLIE0/2Q5SYCzBLxYyMsU+mKDXSQmUsJAtuGmekqQovHBEm6mD1L3Ncb9AQMwDAP+zRVX4M//n8/jwIH9JSMKomxicfDcrIjI1QQfAPBLrPlDL1/LuRg3AeJI5HI1gGa3rxSAZrXNklzZsvnkX6DgF3NtYCn8kJqEyR7yiMTciROennWnLsfoIsW2qwaY2CRFGshVPUmNqqlDz570yZiB6SKEfwrFH4ByD8nHDVZwDYQ8XM1lODTkdpOqTwJ4UmBfpOnHXJOcAsjVMHslVH7cKNOlQCxHH1mbFWChbq+4zqTDzSmX4KCSCoB04HQYcMUVP4I//7//HEeOHim5vpK4Ist90M2mivzi8RMn7lPV28y1JnJEwhwRVOBoeT6ACnTIMbuW2F1EMegAVcXWU0/5IVF9k4oO/fNqvK+luuj4seMYjaqzF2NpVm/JbXX1A5Cdud72Njabjxp5o9FOM+CnSPs4LW1+dPqibWfjR1h1Is0a28/kNzxO2sdJ/hSN22G4keSjjPdSnFE0n5HgY4bPC85j2ciRvwaYmp7Ci3/kxVi5cmUTETSgUdZV6ccA8k2A/RAaLIGNKQD5dAQgefHD4N6/o3XD4NGBKkT154dBLh1CZasM7uEPA4YsNIPiyNGjGI2WGkcpL0hewArQBE/eDCMLr+mdKeNDNHsDjWeT9j6Se8lJwmJB4Kz5aQVUyr+jcdYsfK5/7zHa+8x4Nsk30PjN6NQZ8j2hAlg2OarIpxhRaIxYuXIlLr/8hRh0KI5gfr+C+pQSM4LEpSB+PkUKdZfT62oxCrHMMDCFe9Xjz9/Fkxd5rejwRvFwMUcMCMheRv6OHDmChYWFurnujcdTXBfIaojmCwTWU1xROR4z2o1G/iDJO0BbTO8ZNIhLvnlhSAy/CopoIYxsED92KF4nnOnfi2a8g+SzzezGdE15M+t7GrqNR0YlWa8Xzb2BJDZu3IBLLnmOI4QWIgF3KRhjO4KUN4J4bQkbWQtdSupxuQIwIMT+Eb5NxRen6TC8TkSGstlDwgaGXJHjHv6JuXkcO3q83lg8zQiqHjWkSzuDyQufTvYfknY+je+jcaERHlgb4jXaI2gbc4jY4+SsisnOZJg175EFMyde0gm2BZDvI3k+yT+0qGFSYB9CWnr5WDARyJgGxjTkjtNPx/bTtrdZo5yOrjhxVvMDBK8D5TRHIuLDRRMs0wT4qR/UhaBqAai8WlWvHMbsvmKQrPoVZiMcOLC/Wbgmdrdgw603C52tTup5juT/buTLjXikfTxoF1SAqGL9bOL/5n1RwaJWM9UT1qj4rKUaU0YY+YgZX07am0jOlfxDuWcE4AqtKYMVIc24SP7M5zznYqyaXT1+Td6mZk2lE68E+OqsITLQVWshlpsMGmKypmoAGfSiQfVVSSAGF5IhAT+DlucOOmDfE/swGo2C3Q6LFVWeYcwPqMJRkkEPkvZCIz9sIbFT3hfRzkf1Huw+rdEENmZarP9Mv55xYUoXbY1gZOTJiI8Y+UKSD5pri+QXWCeA6HwTjpsLEsMw4NJLL6kaAjFVjJo0KpfAV5G4CMFnKL7DsjWAFzUMyB59Skyo6rWqw4VDVv0ZzBm0ZhBVcPjwYRw7fjwtYIxFaSBHbdauSL61zpflE8S/ptnlRn6ZZh0022qV9kSieV8LZgTGxrFrT3QyJWMOaXBaq5NnRZtV38IA8sskLyf515aTiGj9kuxr5AAodQjFa6nfJ510Ek7fsaO6ckRTOyAFwyAAXEjw2lLsEBwHwdOIAnIkoENJ416kItfmTS7wcKn311zJgr1799SUbIBbM95uBf6NadhqL8lyYu4h7SUknuREZ7CNDKzB5cdTsha1EdpwrajpIEzRtGRMHSVvYRVaBospQ75X8kmSLyHtnhJOuuZC9Gn8WoFOMNjmMJ59/rNLxjSmgRG21mr58LUAL0I0DqxtbMs2AVHNq8rPiOp5TX5/yEmfwVW/Yu+evVgcLQXba91GWZc8iSrWor3+HyRf4R5/59BhLIdffIAQxhms2/zWVFh5r/D88BogaiXfQHRhW+OzVO3g0csxS/fwxzXuj1HOuHDG943abmpqCuedd15J7ERzkK85+CvngfIzMfxnSRgtNxvomzyk7N92UX1FExI2TmDa/IXFBTy5b9/E+NuynR4xRAAMKjRm4eyvSf4saQvNRjM4bN2iFUzBRu3n+kajiQCC0zgBmLKIS1hICPX3Ul4XtVcAkNK1L5D8d6T9dYk40JokdtgAPZw0onEOd+zYgdnVs7UcjwjmNb9eclTwCpLbUauKlu8EJhQwt1kpROVlKsOl+fTLUKlHhtzMIYLdu3Znj71m6cZi3gjEjIEsIO1Bkj9tZsebLF+vUbrQrAidh3ZmdcMaO519kLGowEJ8bm66rH28ERy02cLgD5T7QzGBx0n+NMkHOYYWdu8dMIQmHewbeO455zZVQMXEg9E4gOSlAF6WBUTwNHCAquKT9z+oXDM4yBNP/xB6Aefn5/HEk/vqZgX1ieJc1VNZc+dNvv2Y0V5O4xNFSzQp4j7sy3hCpyWigKDfRAQ1bF3JWbgW9I4eJoBDnY8RUsGjILC+kU+Q/LkUIlqAuuHvk+seev+gmk2AOOWULVg9u7qieyQ6QCCivtdEKHr5UYBo9vqhw/ASFb1aNaCCCKp/SD937d7tRRBsizSi1zwKaBgnaoG30PgPTT3e2MbbmN1nk0Po8v5dzM6QEyiOqD1FVGEWYnIrDmA1ZUFrdCodZl0BCkHyy0be0Kj/WMMYwatiJh3McwQRAM44/YzUdRxCPHrPAFCLSUBeTeAljCji8pzA5AM45v9S0WEIMLCHhVJifxsZ9j6+J2DT1pz8CLrUTQr4e9IWnyL58X5h8ia1i2YTPXs0SZy20IMW3qf3UYKTCWujiwjmWLD5DKhjg2qSDerY4BBJmj4C8lPlM1IFavALOsH22qMaOQGnbj0V09PTTfFIdQJRTURKM7609BMsvyIobTIEswpcmQChBAtjyNU+Q2HoePzxx7Fko3KCepTPwmah21xHqw7S7M3skkNN8qbZGHT5g7aMqz/xtHGM3zqnD7TiN1hvSjLC2Pg2aHwCoEXwGAW1A8NIe7ORB8v65Ng+b1SDUaBAxV52DBHBqadubdU6IyqImAW8EsBs7T1YTi5AB6/rG65Q1ednVT/kMjEP+0QVMigee+yxRuX1CF8f3/cpVDPebOQuM5bkz/hGtaFk83e0AoPO/JSNLZonnNwxoCja5lijyOa6ox1vhLD/bFiHNxjMuIvEr4L1euuhsYKUmnUCbdWWb9u2rcR4bL3B6gymx55P8opYKr+MbGCx8S9KGIDDvFMp3Mup3kEVR48cwdGjRxubW1SysavZ7xIe6aYfAu23YL1Kz+9RTUeP5xfEb1TVsuVIAxFr55izVjetFrfGBTXG2sJQ62ft+1pnSsqnj4Wa6HGCW834zQzQZBgaRPE90JmEDKObGWZXz2LtunVdmldCPUBuTwJIvKj0Hiw7HZxCwR/OhSCJ3sGre7OAiODx3Y+3sXPvhQcbXn+OakaO9qtGLhLhOeYbb60GaKt9K1hSTkxWwRYBp7YgpDlVIc632CTS5O+t0xLWViOzxTGyM8dvmVI2mHGRsF9tUceMWaALmWMquaKpmzdvbos/YvIqVA1B8MNPVRb8rXIB5yv08uT0oaEe1czqpYJdu3ehV90WARa0VTw13WsA+IgZ78wePEK5t3VmAOWkBjtdYvZY2dN3CFm5NpRQbwL+EHD4KMQjsusQYoMe9ovdChcb5xJoUUMa7iTtEYsbF4QE1kPVbCKSzZs3o8F6M0qJpq0IgF0O4vxJyYCnTAcPopfpoLP5xFezkGFf4MSJORw9cnSsmKFRnQVmRQmH8mkZGX+H5GJMsWZPt8/G5RJxs5BF83jbOtg3YgjFYQs9BbVKp9UK6LJ+We0Xn6YvRcubMuJ4Gbn7JkSf9m7yDUtG/A7ZaycLPQ7o/KZ6XytWrsCqVSsLxFOMQagddFxg1sDLlo8DpDqAS3L5l2ZMQDQhf54D2Pv44yGGRutgdRFA7ySa2SJpd/Q5+r54o773OMiTT38bWro2QVcQgjZOLwJj1YnLAogmfsc4iMTxDS9hXlN4wjHfZ1zD2R0gFjJM3NQ2lJpI1iISa7XWxk2b6kHvIGK2DSGXYLlOoKpCBrlYS2WQk0dqJFBSPLFvX+flRmm1oMZiUqjc/J/SuMcQF8ya2rmojsF2YS1kFdmlbxnz+NZGAjk72aeEgfi8VgtUpG7Udi6xln1VTRUd3VETtVhodglVQXtGZv+jDSfHzV8RRrTXvX7d+rDZuU+wZBxS+id94MX2NLqD16vIBaIoIV+u/ctsoMOg2Lt3b5NwaWLvvvAzVsGkxf/9vBEYC6nqaY4nBk2K1opP0BZ5WoMExkQQLIRYHHcU2eUVqnCG1rERu67iAvD45o9CwQoaDYi+0MSzmgD/z6dARhuQCwFmz4+tW7cesaUVuYSw2n//YRcAXL9chpBzAWxtOHwL328Ciebn53Ds6LHS1JibLNSr+gvbhvfJUQW0TNdiRshnxDSxdOSeDhYelgJ8GJyN3DkBJHciB1ZODcRPqZvEyR68IcPABIKoQnLHsGSSicggBohZIrNQJ4lIvQKBe0hLL4I5h7DSYINCOd7KJd7g6t0IkMJroN7zA4B2T+YzMX9eulcUPoLCbEBtPmNmZhrD1BRoo7TOw9DQ7OW6EAq2iuFcAH+7DCBIz2rq/bIf4KXhIor9Bw4WSRyVk43WvllXA1gl914j95rXMdnI++v6LKH1IWCXTOpsbFNu5vX3qbpnNCEP32oTm1RYMhpP2WLS/TXIJBqTVlPFbWjcOpPYa+RXJ4WOGMuIVlg7r8/aNasLbxGaOsPWCSB41rJMAFTPKHh/KP+qjKCCgwcOFscPjRpGKG6MdfIx7ra/qAvvasratKixs8XWJ1g6NK7x8tHE9H2unxOSN61trZU+o+IvWPsZvUNp1uYNbFLvQ82VRJTRTeAXxotCKvePTRSM5NyuWjVbqWVK+Q8Lf0HoIThjmfwA2A6fEqKZw0/asS9Hjhz2WN75dySzb2X+nVSopJYbK51UUgRq/Ds2BI1JfZoSYgNEnH3Me+syb0AmZcosjlba4y0Znqz2AYhTv9UmTu/Tz2o8x8l+XYn6VRP5A6y0j4lo4j5yenklAjOEf4Zlc2B+v4FLwFnI6KxmBoF4k2khq0gW5e9EiEhbmIhWkwkqRNSB6EKcH3HFihUFCc5cQy0oXMioti/XB9iKZlpGyxICIAmAtQ2ZSqdZQ2mY800QN+1+4kXvFSeYTE27kdfPmXmYBCmzdWjh97H6PNNizxPJsi+gL3QyqC6Y5huo2cbmzmR1QonUPClZQCQzhSZ7nBjSMzFE8lPK+2igxWWmvYXT5LncOc+x9/oWdlXvbAWg92byafMC20zDK/n6nPKuRvmpOXXFyhWFJaRwBJV2yFpUAuHWZQkAdNicyC/CDJ3Y8CniABAbkUyLYQ0tSmzCzGybJL8B1YbMMT+3dABnZk60dC9Q8ce0LKQg8RLm5lJ637XlaqVM7+abmXtSGR5Tk3LSc6FldjY15NMLfYyzjGTyKgQaOjFvfPU2dik0dYm1KbeeF5aTdAHfyBRTgpoZLAcik1iZNOwnMGB6arpWDWXWVCauJUUe5AGQ3LwsARhEn5Wo1+vMHWHg2xfg+IkThcum6FqVdAK9hTkrriIESQyPmuCA0rztmy3rFsy7WBIvUG7fzg5Lel9WVZ5ZY7w9u/DoZYaxIkh5kok5nYuEmQJpF9T89PkG6ZgWcj4/50aiZj5i80hFQ06GhV0MwsQtoGW4TKGLVRYzckCURwmsydqSmaNQa49x4kNKZiGz3yemlWgipPLfZVLpNFLnWcs1AevT1C23K5nmLXMECTA3N5duxVzlGQpnPr0dm6iMy5Yp3mh7kTn2aekkmBQeHgkkS4WpU/NG5Aiv8pSntm5/rZ+QkS+O0opwJp5C5w4IvLuV819rP7/z7Jn39BdLlRlCs0Zh1VAoGkSrJlD3Jyz5IHQiSxvg5Fbi3T2+T2Z7VHVNieXFSaw8/FVoIun0a6DXgpcpb1KzgSKhUqhwCMoycQCRNcysnpRgdyp/YIFdJZ0cRm5eS2yepPMGW2TYwDEUBvFa2WhIDtYIgb1TWRg/EwOpFCrXgjEwM2xlZnKP3VE3UA1VvTN9iKmbq0I1m32SzE3oJPdGj/n9mYpqx02TMDpXYiKXrpgC/DpAze6K23Q6NbJjDvT7ghw35rMe8BTJJE+j5NxKWm86qQZC97DT0Af3L/MaE4kFZVlk0VglZVBUYvVmiQaSCpibm0fOFFph1bLCdZ9OBMOJlazOD2dquezg5JNiTGrWsjYwS1y4OR5wuFOjv5DZOsU33DeKhceNiR3Lmb+L+mSlhy/apDCRZY4XS4I4JC2TySkglQ0kU8cVBieKs4a4YKlvYFHJib+4OIaWaXQIVTucJc3oZlOc87iYRBZCa80sKvleWSuEjZaafDMvaRKCVctkCBmmklct7cy/MGeHDSWpVi6Mgsw5zYurq4aTXQJFWwaA6vpBxIshtYZC2ZOHZL9Bi7+QuXGKj814okdOZRtYR+lRSwlW6Pw7HvIxOIoe8plUvr6osTI3UX0P50ISj1JQzYFEbWYV5vMYqdyzWPanCB0lAhGhs5hk9DCvC+u8IcZpBJlCjjUiAWVqmSZAl6CcynSlmcqc1Qhgenoai4sLHrLUYQyR6jSRMInTuua7wzrkDdcaNjIKRaZKde+5MJEz2UIUupR8X3TS5iTxSWsnraNOy4LAIZw0RXUiJfsSCBorawyP4auAJG0gLj0aQ91M0aKjRAcjYW4B88mPMHCMUAgRrpMcebhmzOOIUnShPpmGhRAbBix5tTDRckFlpTPkPxJLy4sCFCeoulbQTvuMY16lcN+3nLse6fgJqRuc1C0B42q4LYwc/1nNldpHJ542q94uS3QRwiGDcw5ljD1iEFpmBdCp5iNolXl7rJw6dzY9csibId5fXwGgOhan0rbDCS3z/KIcP2iZpFMHWTgOIHmqmebDM0vn/DWgmMc8cKdyJKedHhXntJJAZB6hav+lVmsLTiwTB9CjKrJWnJkqT7ooQ5tFsWLlCszPzSXI0jVFAPd8MaXEIpJVn+jmDMgYEcyFe7xekUzL84oZmMCT6qQg2PNkAhJdvE8hcdtJd+CS+UjUcZn8KrN3JvSxui4ZedOMWRQnsWUtTwiiFQGvyKP7O0V4WOJx5IETmcnU39OkaKYthbrWeaSGnEhjAN1KdJI8osXFxVoRFLqxE2hKcNCMLRxdbj3AIcnNIQ4HZ3KonCBaPbu6Sc701by5BcqaRIl7ouRGNq1U1mDlFuvzOZ4jiNW8ae4TG0qWmAouRFF9da/FJkwLRE7sagm7Uq1IJGXfgkvIuh6Fpl6xbTf3XMpGkmtiLyXGaiKtKQnLId/i4sJ43X8sE8tzBYSHltsZtE8jMYSoT9OqY+DWrl3b5azRUapEVqyxJM/ZtUnTs3ZNOVbY1AndPXnapo116IaScBtnHqVZw9g11t9nXaYvFpc0gjWpq9fafoSxWsK2JB6ZlbwkzXB2FBpYSDIF4orYA5HXZ35hsY4ZYK0HoKN2pbWd2LdcnsC91eljnKpYoOCNmza1jQkldArARp6AZpGxm4DohSD/VtxxU1gZSJHMQ87rs5JAe75AtGJzygrXZkApvz4lZ7SMAtAcohpqfj/OHcixrEcuOQytMHb6d+azTomeDJZVJtIChwegSrM+9sFLpqE+gA5pGy5K/gOLiUuBi88ryEUIHhYq6jykhbm5CPl4yxgKaTScJFINe5fbF7CrMnwOicUzED4DgpM2bRoroa45cuvKrmJvH2DG502q/DX0jRe9akVDAJEOUUcFA04sz465+tjBBI4zdDFStTS9hKnuf9TMDght5LGELKapswmInxf7D1MdxXPH+AZytRV6LuVWG5yYm6tAcOQYjiQhMECwa7lh4KOCHLVJM0g50wCfcuqpacatS/FYuSFr6rNJhJAQ6IsCZ2fNqJlTymZwBXXESwYKBOLwL0riKVcixYqePM8wVuDQEkSasHc/jWQKr8ScITXBtJQ6Mk4yKydYMoUj9+jFaeEt09Y7OphTtZn9OHMhw5NDuW4vZzZp8iIGFLEM5GLGoDN/sQNRKTsB0nBibs7T7bUkoMRX5j6ACTDg0eWOjHkYca5P7gMAS+/g9tNOqyYgI1J1whokpKuMORXjHqzwYlVuBnSvT9wJYaBh8Bk8iFkz5kd9mmYGTtKUCveS06tVWFRpysj5KPmczSRLzp8hZYxcYOpRRa4VyGlleniXEcw0Fs/vT0eJwlaT0FlOpHk0lIAn5/zVSiGbtJZuFuBisEYdGQ8pwbHXKuTK3jQpNx2qE8ePe+1Xgt6JdP8YQmlaWqOHl0sV+82mC1iT1OfqIECxdt1abFi/vu2hD+xZVp2bjlHLQJqSvKbvhkUo8x5j1jJr1R+soZ+xWL3bzwjoZgHAYr9BR2PTlIZ506VVroGx4tfSoYRxx88it4A1FHhdw+zVRmpPM2udM9tXWBmJ+cUFLGYnMDr/0vUMpid8c7lVwQ+o6C4N5E/Z+089AenvZ599dmM/I1WJTQiHzOsHnR3r5/qmy0K4FAkfMalMzJp+BHZtXH0UEsvPKj0s2lLy6JEXthBrmjTYMXk11c6Buq78jnBdXXNp0z9A+3eVZSTU/E3iN+r8miOHDzfj42AYI4Z1f2AXYA8sMwwcDonqfe1wJ6d0z6QQojjn3HPbIkvm4Qk2wblCKY12gfhxmG2ptXiVtAHW4wktFoCeMLqnVxujeLPxrt6ulrCWardcPWYt85gFvt62e4ml9qGe2rZYNMb1VomkNtP4E5l/0AoOEoUAnTaopehHjx4Nja0h+9cTRgP3GbFMHCBlmL4qkS9YKhN4Tg5ddNGFT9kPb30PXWbbqI0k00a+PhJH2KRmzb4qtgha103UxelN0aW1DJ8Fs5hUJAoba2ThGM+BtfwFHWgUeZAiI7mxxwUIM3sDyRmLG+3mJlLmtl3NdX0OHT7ckEVFPmG0vMFffRpj4xQK/bJkDiCJrOGVH3DLli141sknd/SqHQP4hA7ZQs9G+w8kpxqULZIuWMvVh67K18JModiF1AqiNciihS4mxLYxa0OviRRuJfyqaJ11pNPWzCmyrtcvEEsmmpkpkv+hlrmbRwRtq1tDnJHZSWiYn5vDwtx8aPplQxrFQiYJGO3Ly6eISdW7f68qxzUygEuc/ZPMwfOe+7y2ZashcBpvZUILh+4w8jWRbnXMHKCr2UenDcCGh6Bl/URHusSJpA6VC6iltGlJrrqmzwjRFtJpa0e5NT0MbYu58/5cR+OOjG8UUzamQYJZzBCxAQcPHqwqH7kB1wpRVJCJ4yD+nrTlagDBMOj9IvJX4jODIiNo/am4/PIXuJqxhkW7NISO1fvngYnlb+8ibdqssnhbx58P9tBuAHlKRBC7hq0Fk/oT3dOyNRRxva21jum05Spmz3g+ibKmo6NzIZgm+Z7YPdxwKE3okWidZsOBAwd8Vhg7JRA6lNL0kL8ieb88nfZwTwL9Zd7oSgsTZwIIzj77bGw95dRu0MKoIT8eG9nGhnr1LCPeMmbTOwetYfyYxBRmsRunJl9GE0gg0XP/hwX3rWwo2yL7BzumsjqVBGP0so0GCebLI4A3m9lZLaFUxiEmhIGdEM7Nz+H4iRNlOCSCI0h01w78ZdMzuKzRsen7C9Hul87gMCVERfBjV/4YEBIxhai5m/BhZg39egmVzN4N2tbx0Gdytq3QxwTHLzOMVKIFa+hbxl5vT0HxZq3/UZMuYXydoSF+sH4CSXTYInl1PQCnGnlTy/+Tuo/HIewepk7P3b9vf0j/BoJIYa3YqlHTF/ppIv+sD+DfnxfVvykaAVpoZCVrBlH86I/9GKampwNQ0jl06HCBPswjNxhxaz80oSF9sHa0S89FyJF1ncrBdPS8RWM0sxNZytu5wx1JFTpyqZ6lLEdB6EJQ//wPwWwDu5YzWMsmPo6lJOEYjQz7Dx4opE8SB0gXc1x8w7+h8PO5m2jZNHFu54+r6udEvR4w8wVJ/plCw/Xr1uGKH7miOl3W2vFC5dIwg7Y1AKD9LMxeHxcahoZyjp2D1wgK+NQcwL333dri0GZuY4JXJoxyMsfveI+itVQ3MSxNn/+/0fizbbOsjZ32FBBYW6Pggnjg4AEsLS01IF8Wntg/5u/1ORqO57VfPklU5QP6M1Udxenf4tCweKeOquLlL395mldXMlHt8KRGDcOKzwDGuJ23wnhBJIVmxzsYs3QtWBQAG3C8STX4EZW23iY2jLZs5Igxe6M9wG5crf991FDlRjPES0j+HzmraE+Bl3QT0Rr2UBJpuGRkNQtZwKwS3PaPAPwZMJko+lszhJRKYPmsiNxT8wItGJTrA7Zv344XvfjF1X6iHaU6Xi1kbVzv1UJGfhrAxjFuPutYvRBDNaswcmwpR8fa2Xn/HJ9H1AFLPelFJJ3ytvOgpaqat9C6Xq7nZNJ+38hVfc6ghbvbQhiGkbVmxMGDBzE/PxcQPvcDpOUK9q97QH4WzRCppzMxJJNDQz5T/AIER7CZJia47rpXedFEOPkldR4AnTJiDS2baNqQc2j2B4StGJ+mNU7tjsjB08z+6xg+w8luE0XWaAoGnqFxn6WtxjEL/kCkjIu0r+nfs6T9Iclz0G10r+2a0LRjTDEz7NmzNwA9CDhAnJVcbMNnInfoJCHQpxKLCvYIVPWPFPKlGAlU8ojqEJ62/TT8xE/8hNfSB3WPCRx95TSx9LMHdXqlkb9Psxl0lGwgOnZwjpkC6wZJgeNTxK0fOh35hGBjXj37JFADalmTFa2FH4AZZ2D2+2Z8QcORPCFvMR7/txjGgf0HMD8/34yMYQMDMwrHl0D+UWUXfdps4RodwkdF5NNFAFRDeXgyA+qND695zWtqwWjnqQPjJzkueJfC/WmAnzbY6rGx8BOGO1o3No4d6WM7qKojWWgmjoXJIzY+lYwhodVSuFozjMJP7GojP23kNdFvmTTsgmP5BWsYQpaWlrB3796m6LMpBM2ZwLrOnybwaJkt9LQGR0Ybn8vAVD+lql/PcLCUyeBaowZRrNuwAW984xu7iVp96dU4ZayF/rYAhFxN42dpdtLY2DebUIAZAR2Oh3JtJFCLS5taBYvMZC0DanzvMeJpZxELINFJJD9Ls6vb9DHHD0cBrjCWRcxmac+evVgaLRXH08hmY601Cl9nYl8vjcIlSli2ALgZQOEIwr2qenf2AdJkUQ8Fh9S7p0OCja++5hpcfPHFgeiwBzImECBbrSFEk33DC0j+FchLgAnUq02e3dVfYORqVDPD1NBQf2fWppRBgKOaRMIENW3R0WOt+XM1fwmB/2XkC2KCzMbKx9uClPpz1Di3x44dw8EDBxqUL6r7Gg34t+FuEdwLTOQLXCYUjOwAhpFwIneLyteGMDmsVAs7/Yv43MC3/Zf/glWrZserW7zkGxnzR493W5muGTJ455jxf9HsF8aHUHURgrFPO49VGLUJJgvec8jqoWPvtp7nJ46GbWjhfoHpWs9FU9Jt40mlsdkEfUhI2GgJu3fv8hrCdgh6ZQSvgkDgawDvZqCfrVPGnoYGyFO/VaM5kHuh+nuCuvGqYVwssqCkotFf+qX/ON47gJBdgwXsvqdGDxO80kKuNPIjNH7ayB3swkybEOJ1U8gqVB3yBrAW028rkntSKOswgcBMSttBs08B9hGCK9tK5NFYirzU/bMdTNETUe7evQcLC4v1eFuYCEo0dHluAH4PwL2NvWflSlq+E+gbD0XYYEBF7oTic5k5VJ2/I2UMY45AcdVVV+Gaa67pNqaSLtZK5slzAqwv9U7f/5bk/aS9PRdSNHOHOlw/Jn/GU8KB4s3G/YjKTNZFBWETaJwh+XYz3mewV1ifx/cGEISBGZjIVh5nKqbvAwcP4tDhQy3WXxo+QrlfdQY/R+OdmXY+B1llVtNyo4BcEayi3mMuEHg2ULBTRX9XRUapPlRbGtlCKZ/8gf/01v+EH/yBHwyhE7qsnYV0blsbyDhZM84eMq424/to9g8gX2fG6XZGQVfjjwi6dJU3eboXOx+g6ydgl3k047SRrzPaP9D4PpJrGIis+1rGZoJKF8bC+oIXw4kTJ7B3z57C7wOimoEwRjZfu4AjkL9LcGdTHpbdw6czPVxCDyBKXWBqG/Yo4BOq+jGFNIUi+d85bwBRzMzM4Ob33ozNzzp5Yi6+XmucNTROjd7XGfopOstod4D8Bsl3kNzczCywiKFX7sA8INIaYYypXRujjQ21i5uN9g7QvkHyDhJnxXk/EQEcG5dj45FDrBga+eYvLCxi12O7Mtd/cf7E0M+KC8kAfIzAJ/p6AEbyIH5bYWAL+2oNAT8q6uBQhY0rPIz69y2bt+A3fuM3sHr16iZTaF2XjHWVONF3oE2oOawh5XaSt5DcSfKPSL7ODCdnXMCyjezrB2LKusuh5+JW39yTSb6OtP9uxp0kb6Fh+8RxMW1uY5w00trBFLUSKAntaDTCY489hsWlxdooG00l4ixByyXgXzLio5kckg1bONsRwk8nGyiqoQwsqXR47H/ppZd+ESofVtWRZP8gTBuXWEEEwTnnnoMP/OYHsHLlyvFhDe6hl+FI7ODZXMY9hu13U72SKfipdDL5OMkvE/wQzd5As+eR2DhWxh7mDbkfsJHk82j2BiNvpfHLJB834x1GXkPYtHXVwKXZEy2lLArg1KKX7FLS+XWj0QiP7nwM8/PzzXzgeK0NtJts9QjAhwF+0QpPSxUaIbrwcVkcQVJ49AS5KZSZtqpI2aXPufS2r3zlKxeIyn/MqCBbOqn0m4vZhRddiN/8zQ/gP//nt+LE3FwgU6o/BJlVNJFDZkJEb4VxyplKGJ0vyyRRuyRqGEVq05HnmNpz1KndfLLXUYHtFeqBxNcjEMoaKtcAWE/YGjoTh3qjaGwvQ+4SKrwDmWRSIc4CIoFksnQLwZlT8qBnZ0YzpnY2gHh8zx7MzS8k7kGIs3ui3XT3BXLDLAb97dNOO+22xx7bWQpBnWHGN92bbp2JdflRQNEE+ZK18tyoFPWoKh8SkXuSza8Vw9kP0IgoquKyyy7FrR/6ENauWTN+IuLUzqbRoh/g1LZtp6FRWY0jJGMm8AEY19B4FsDn0tI3yB8wchtpa6wZWIkWG+hKutu8g9W8Q/Rz0I2fM4xV+4xGIzy2cxeOHz+eWroY8R2WETusLT/pvkXuSRrO+QoRx8r39RYtgew/6wMgq/GQBo72Pt/QRRdd9ICIfFAE9zVl48EMxFJyEcFFF16Ej3z4w9iyZctYV64FouMYqrVkC2EqSFOlaw2MOz4fOJI/1FTyqJSHYULvPyY0qbSc/e1Ukwk1kF0jSxTuhcUF7Hx0J07Mz3Vqv9pyIJCQVSG4D+QHT9u27QHz8aKM7l/U+OWnLD8MLAWguURMJAWEbtMR2qsuuOCCPxHoB1Rkf4kIcvjoOYPgPEIFOOe8c/Hx22/Hs5/97IntWSVCsElDk/wmmw2alGHrZu/kU20dnIxJWIS1cHMuIkEniA2LibUCNmG8bR2YCZyYO4Gdj+7E/MJCGFmHNuKPRZ4FseR+Eh/Ydtq2P6nhtTQYRZsCbtftnxcAVF7g7NilpFCiL1SnMIvpyPPPP/92AL8uglI0ijxqxiuHShbRgaKTN2/Gxz76Ubz85S8f20Rru2eQecibgtKGNQMt3buN9+MV84Iu5Jz0maG9qgrkqBaB2qRSs0kawCb2HB4+eAiP7dyFpcWl2svXefoN8htHwJO/vu20bbc3M4qaugBWerhGKzxNAYi4UM3+Vb6AOMwZBJ797Ge/X0RuKXCyaHv6PYzMDiNEMLNiBW666Sb8yq/8CmZnZ9sGErKpM8SkE9eXaDcj6nrUjw3lik2YytmYiW4OooVqYMOEKqex2Uc2Nk5uaTTC3r178MQTTyRTJf3JZKHjQjMFrHjzt2zddtr7+0qmkPKrDKrGji8I354ARApRcR7g3NOHbpKWiL5XRT6YUUEJm58pTkreIPsbInjZT70Md911Fy677LIWgUNXt2fo0skh7dy0jbMFetravAm4QmwzDxnFvsp44ijZdjzcGEmUO6xzx09g586dOHzkiPf+BdUe0rUMnESwxox/EMB7x/iMyNbGG2p62EIIDX6HApDpzVXCkMK2r+/cc889KiI3i8ithbjeJ4+qZMbu6g9U3AHYftp23HbbbXjXu96FmZmZdlh0zMNH1q1e9TYOpIU5gmiYupqmzn5AJXpIGmPTv2LvQVvDN97FPBqNsHfvXuzavQuLi4sJ3m2IvKyJ8aXMGwrFH+StJG/eunXr0WYUXzc/OdYJlq6hIlj4zgWgiUdDuOS5XZDEOeec8ySAX1bVD9bqYRSq2QY1zL+jws4/+ZM/ySf3P5lan8xCyRXGhkRasP21ynhCxTBtbINifUITWvZQcEcJF2cVkrlos2+KNSyZ4eDhQ3jkkUdwxNu4iQ7PzwU7Ukkdx/B+8oMEfnnr1q1P1lmJcdQuxuv+8rVm8uinqAqe+vYFgHWSGBIwQzg/L4Gzzz77yYe++dC7IThBkRsLkORq32eRoDDcSnV4fu3Xfk0efeRRiAgOHDiIZ518EtavW1+AKHGSxsxfStEGTErULz4NpDDNSJnSQQszCjKppTOOZWpaZX0Pce4iMtO8JoLLxFyauY3ilDTg2LGjOHT4EEYjK2Gxo2uhgrdSuzIziBrAIdPIAgRvIfjeraeccjTzHycOTalsYWKNH5EEp96xSuV2/u4KACqNLBPXaqGKFQJnnnXmURF55zcfeuiQQN4GyiYRIjOQlVlESIygAsGDDz7I22+/vZATLS4sYPfu3dj/5H5s2nQS1q9fXwiVrQB8LCNSTDNpdBrHIn4xzegaqWPZKvFyYCW1ykCep4EYMqNo/r2Orsm8PqPRCMeOH8ORw0ewtLQEGQSDE27mUA1Sp/wNGFpyXzBQ5XL/IPj1U0859f0qWrp9Cv2d0/Kx8PTWlrB0wAyCIdm9gW0lyXdHAPpqgyTGolq1gz901plnvv/hhx96goK3QvSCbAOzuqCjBhDi7W9/m6S25wqDChULCwvYs+dx7Nu3Dxs2rMf6DRuwYmamnpzucjJJkzqjuDLOBki0tEnlFvqqdFKduz8LRiZpVs2UznnBfXSNKOaXFnDs6BEcO3ECZoYhh7t05vDA408SAzNfoTOQs1D9Zhm5D8AHtpy65fYccajzJiZ8n4F02jWpATLUwhBBYI52U6ccvpsCYOMuRJlX4ypAqhScccaZt//TP/3TTgA3QOTqMpASNd9wz2fuwZ/+6WfD1MMwRqZs3gj79+/HgYMHsGrlKqxbuw5r163BzMxMM6uoeMOaPqeMjinPkZpoKWziPsgicwQHyrPENJaZvIGFpUXMnZjD8bnjWFxY9NEuUkbQhENdCJvyPKm6L8mMSBj4LMQ9EH7wlFNO/ROG6SiZnr4wsvkQjmTmLPgSaJnUyUL5z++mDxCb0BiK1TKbfubJy6EfCJx++ul/8sgjjzxE4AEBfjGNYnDVbYa3v+MdmJ+bKy+pKyWZ4rmsLJHG1izML2Dfk/uwYmYFZtesxuyqVVg1O4uZ6enAYJpn0bj9tULcn/wHq9NBSzJKnAHcb3O0NMLc/DwWFxYwNz+HpcUlDE6YJT5ZrcVeazkuOfjjlsj/PcTVklgzADKiyW9zkA+dsmXLA+ZUdpUuz2cdaZo4ktcoTWLTUjCSh0RRMve6dOnk76IJYBkVy8CSLS0TuLQCsmPHjgdE5JceeeSR+wC8CcClJHHrrbfivq/d56zdEswKS1aSxW/IzpvzZVOwsLiIxYMHcfjwYSiAqalpzKxcgZUrVmBmZgbTM9OYnp7GoAOmpqcwUKHDUOoAYMRSAJVGI8PSaAmjxSUsLi0WNa5Ol5NPmmQvEyxTyIotznx+mUiyGDyJYgIAXyLw4VNOPeW2bCrEAm28E01q9gCVZWZAYgS3MqIOUtfLSAwxFJyQC/i2BeCxXbsKwFOKQLTOEiisolpBH7QUFbcB+BKAnz906ND173v/+6aa5Smz7rply6q0VRA1XU3CRDAaLeHE8RHm5074NWmT0CrJqkqGUWodhgBb96/LUKs0Or6FWwkmssuI7bFW9Zo/DnIE5ccA+SghX3x89+6Sg6n0fFquqdD0eduedM8lYvl3IIls1ui7ZgK+K19fJPnFd77znV94fPfjr4PIlfniJQiLlE6YEEF4jQKzyqtuCEL1gk89Ew/j0LxvGLdZpmumiLJW3MbXVQ/bTz7zyBz4766GywVLUcEScPlEcs3PEfhdIz+hPtw6lm/Rw0FhfqwKX3Ys4Q4yQgNIySXkKVexV0L1+04A8JWvfAV33nnnJwB8DsSrRfkqQC5sNlDQerZZxaovQBlriqIp8kJJUYE+5SSHrfEUu3DVghZFxC2ag+OzefL0klKgm53igiTK+PWmjfsahL8HyJ0EdsZefonhYffBdDefTpVL9wEx5LlBUcGyuc88ZcS+3zTA3Xffjdtuuw1HjhwBgJ0CvI/EfxeRawlcK8B5mfpcs/MXR6L3hcyhIFLiDHU/If3pZ52oWU+oATKwfBCdELqefkHr4If/+8vKKZSmfPvrAO4GcDfBe6XdsTACL0z7cXCN9CqnonFC0SfzzKI6KkZC/X8xP5QJXQH/PwvAtddeize96U19Ofq9BO9VyN0gf4YirxDg0qx2S2SZUTiEcJMVZQQrApZnH5Ct1c6xOn1GsoftNTwrDl6bWxeNIFarVTT8zf/xJQo/LcSnSN6btIGUsi4tnwWfmNoV/kqFucU9+3II8tgYZqPneYtgDiQTRmSztRwB2Lhx4/8nAjD5RBbVeS9E7gXwcQheRvAaEVxNYijPcQjJDX1QtQmg6c0IMtO4sIkwEIjpC7yMOiwzp7ulCJrEptuySVJx95Gkcq3PwPBHHPCoRIcs+i6ifUTQ2PniZMcKHyM4uCD5PSHPlQjlQHSIPV1i5l38PvMBJuEL4oWMbtEfBflfIfJfQXkJBC8V2JWAPj/MRW/foobbAZBx31uc+1+qlZdchjZIsOWS7CsGB2saO54Ao7z42VyQf0PB50D8mSAxc9SdkToMmlrwkVry5WV2yoJ7IA+aEqY+TBjMBgxDt8lBMBxZ8VGynIDdfN8LQNudxBgFCD+rkM8SMivAFQBeRPKHReRykrMCFtCnnDbW6qakCrXG46xaIGFDLKlu8aGY5XnSBA1uceQ4hH8F4i8B+QKAzwM8XtdaC5ydP7lBAd0+F3WSnVBhoxLKc3NFcY7vi8kLGghx+g2bcBnAvyAByHKQJ2KGsX0qOE7wj0H8sTt754vIZRBcAvBiQC4AuTXCzdV5qCc82nlKHr3uhykMwCgbD+6C8D5SvirCL0P49wTuL2Fk3gig2HmJdfExYdPY4xCz+1CKPFPQJ/j6CFw3X8zDUr0tLE8OFQ8bCxKYr6MtMP0XJQCtf1vjcc2zXdPX/STvh+DOhKdzPUXPFeAsI85QwXaSW0VkM4lnCbAewjWArCI4JdAlECcgOErwkED20bAXA3YRfBTAwwS/CcoDIA+lAyu1AaMMaKz+RWFMY6RyyRtYI5NK9iShmUMK4FXS2sy+STZHrlkaKW1p4ouFRA4VddIBI575+tf7pc8swTMC8MzXMwLwzNe/1q//dwC/bWlmNHEo0gAAAABJRU5ErkJggg==",
                        categorical: "data:image/png;base64,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"
                    }
                },
                sequential: {
                    "edge": 0.1,
                    "heatmap": 0.4,
                    "colormap": 0.4,
                    "identity": 0.1,
                },
                bidirectional: {
                    "bipolar-heatmap": 0.4,
                    "colormap": 0.4,
                    "identity": 0.2,
                },
                cyclic: {
                    "bipolar-heatmap": 0.15,
                    "colormap": 0.8,
                    "identity": 0.05,
                },
                categorical: {
                    "bipolar-heatmap": 0.9,
                    "identity": 0.1,
                },
            },
            significance: {
                _config: {
                    type: "checkbox",
                    name: "Data significance",
                    description: "Where are interesting values?",
                    names: {
                        low: "Significant low values in the data",
                        mid: "Significant middle values in the data",
                        high: "Significant high values in the data",
                        other: "It's complicated..."
                    }
                },
                low: {
                    "bipolar-heatmap": 0.2,
                    "edge": 0.1,
                    "heatmap": 0.3,
                    "colormap": 0.2,
                    "identity": 0.2,
                },
                mid: {
                    "colormap": 0.8,
                    "identity": 0.2,
                },
                high: {
                    "bipolar-heatmap": 0.2,
                    "edge": 0.1,
                    "heatmap": 0.3,
                    "colormap": 0.2,
                    "identity": 0.2,
                },
                other: {
                    "colormap": 1.0,
                }
            }
        },
        selection: {
            shaders: {

            },
            stages: {

            }
        },

        /**
         * Get current granularity data (context -> config KEY)
         * @param {string} context if not set, get selected map {type => true}, else config value of the selected value(s)
         */
        granularity(context="") {
            return this.getSelected("granularity", context);
        },

        ordering(context="") {
            return this.getSelected("granularity", context);
        },

        significance(context="") {
            return this.getSelected("significance", context);
        },

        getSelected(type, context, single=true) {
            if (context === "") return this.selection.stages[type];
            const selected = this.selection.stages[type];

            const result = [];
            for (let selection in selected) {
                if (selected[selection]) {
                    if (single) return this.selectionRules[type]?._config[context][selection];
                    result.push(this.selectionRules[type]?._config[context][selection]);
                }
            }
            return result.length > 0 ? result : undefined;
        },


        /**
         * Init the shader selector routine
         * @param context parent context reference
         * @param nodeId DOM ID or node to render into
         * @param params
         * @param params.idPrefix ID prefix to add to all IDs
         * @param params.onFinish callback with shader ID to call on selector finish
         */
        init(context, nodeId, params) {
            let index = 0;
            const _this = this,
                keys = Object.keys(this.selectionRules),
                REF = context.REF + ".picker",
                allShaderTypeList = WebGLModule.ShaderMediator.availableShaders();

            const idPrefix = params.idPrefix || "shader-picker-";
            this.onFinish = params.onFinish || (() => {})

            function computeSelection() {
                _this.selection.shaders = {};
                for (let stageKey in _this.selection.stages) {
                    const selection = _this.selection.stages[stageKey];
                    for (let selectedKey in selection) {

                        //todo multiple could be chosen - what to do in that case?
                        if (selection[selectedKey]) { //flags t/f

                            const rules = _this.selectionRules[stageKey][selectedKey];
                            for (let shader of allShaderTypeList) {
                                const shaderId = shader.type(),
                                    value = _this.selection.shaders[shaderId],
                                    multiplier = rules[shaderId] || 0;
                                if (value === undefined) _this.selection.shaders[shaderId] = multiplier;
                                else _this.selection.shaders[shaderId] = value * multiplier;
                            }
                        }
                    }
                }
                return _this.selection.shaders;


                // for (let shader in _this.selection._stage) {
                //
                //     //todo cache old, make removable
                //     const value = _this.selection.shaders[shader.type()];
                //     const multiplier = rules[shader.type()] || 0;
                //     if (!value) {
                //         _this.selection.shaders[shader.type()] = multiplier;
                //     } else {
                //         //todo based on type... this is radio
                //         console.log("INCrease", shader.type(), value, multiplier, "TO", value * multiplier);
                //         _this.selection.shaders[shader.type()] = value * multiplier;
                //     }
                // }
                // if (!_this.selection.stages[key]) _this.selection.stages[key] = {};
                // _this.selection.stages[key][type] = true;
            }


            this.renderSelection = () => {
                const key = keys[index];
                if (!key) {
                    computeSelection();
                    let best = -1, selected = "";
                    for (let s in _this.selection.shaders) {
                        if (_this.selection.shaders[s] > best) {
                            best = _this.selection.shaders[s];
                            selected = s;
                        }
                    }
                    console.log("Computed probabilities:", _this.selection.shaders);
                    if (selected) {
                        _this.onFinish(selected);
                    } else {
                        //todo
                        render();
                    }
                    return;
                }
                index++;
                if (key.startsWith("_")) {
                    return _this.renderSelection();
                }

                (typeof nodeId === "string" ? document.getElementById(nodeId) : nodeId).innerHTML = renderPage(key);
            }

            this.recordSelection = (key, selected, add = true) => {
                if (!_this.selection.stages[key]) _this.selection.stages[key] = {};
                _this.selection.stages[key][selected] = true;
            }

            function renderPage(key) {
                const page = _this.selectionRules[key];
                const conf = page._config;

                const output = [];
                output.push('<h3 class="f3-light">', conf.name || key, '</h3>');
                output.push('<p>', conf.description, '</p>');

                const inputType = conf.type;
                output.push(...Object.entries(page).map(([type, value]) => {
                    if (type.startsWith("_")) return "";

                    let description = "";
                    if (conf.names?. [type]) {
                        description = `<h4 class="f5-light" style='max-width: 150px;'>${conf.names[type]}</h4>`;
                    }
                    if (conf.info?.[type]) description = `${description}<p style='max-width: 150px;'>${conf.info[type]}</p>`;
                    if (conf.image?.[type]) {
                        description = `<div style='min-width: 150px'>${description}
<span class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>
<img alt='' style='width: 150px; height: 150px;' class='rounded-2' src='${conf.image[type]}'></span></div>`;
                    } else {
                        description = `<div style='min-width: 150px'>${description}</div>`;
                    }

                    return `
<div class="d-inline-block"><input type="${inputType}" class="d-block" id="${idPrefix}selector-shader-${key}-${type}" name="shader_selector" onchange="${REF}.recordSelection('${key}', '${type}', this.checked);" value="${type}">      
<label class="d-inline-block" for="${idPrefix}selector-shader-${key}-${type}">${description}</label>  </div>
      `;
                }));
                output.push('<button class="btn" onclick="', REF, '.renderSelection();">Next</button>');
                return output.join("");
            }

            function render() {
                const html = [`<div style='cursor:pointer;' class="border rounded px-2 py-1 d-inline-block" onclick="${REF}.renderSelection();">
      <p class='f2-light mb-0'>
      Help me to select a correct shader.</p>
      <p style='max-width: 150px;'>Run interactive selection that helps you to select the shader.</p></div><br><br><br><p class='f4-light mb-0'>&emsp;OR SELECT ONE BELOW:</p><br><br>`];
                html.push()

                for (let shader of allShaderTypeList) {
                    let id = shader.type();

                    html.push(`<div class="d-flex"><div style="min-width: 150px; cursor:pointer;" onclick="${REF}.onFinish('${id}');"><p class="f3-light mb-0">`,
                        shader.name(), "</p><p style='max-width: 150px;'>", shader.description(),
                        "</p></div><div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>",
                        "<img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='", shader.preview(),
                        "'></div><div><code class='f4'>", id, "</code></div></div><br>");
                }
                (typeof nodeId === "string" ? document.getElementById(nodeId) : nodeId).innerHTML = html.join("");
            }

            render();
        }
    }
};

/**
 * Definition of tailored setters for shader controls
 */
ShaderConfigurator.uiRenderers.number = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: ShaderConfigurator.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: ShaderConfigurator.__chngtml(name, 'interactive', 'this.checked')})}<br>
Value between min and max<br>
Default value: &emsp; ${UIComponents.Elements.numberInput({...params,
        onchange: ShaderConfigurator.__chngtml(name, 'default', 'Number.parseFloat(this.value)')})}<br>
Minimum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.min,
        onchange: ShaderConfigurator.__chngtml(name, 'min', 'Number.parseFloat(this.value)')})}<br>
Maximum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.max,
        onchange: ShaderConfigurator.__chngtml(name, 'max', 'Number.parseFloat(this.value)')})}<br>
Step: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.step,
        onchange: ShaderConfigurator.__chngtml(name, 'step', 'Number.parseFloat(this.value)')})}<br>
`;
ShaderConfigurator.uiRenderers.range = ShaderConfigurator.uiRenderers.number;
ShaderConfigurator.uiRenderers.range_input = ShaderConfigurator.uiRenderers.number;
ShaderConfigurator.uiRenderers.color = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: ShaderConfigurator.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: ShaderConfigurator.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.colorInput({...params,
        onchange: ShaderConfigurator.__chngtml(name, 'default', 'this.value')})}<br>
`;
ShaderConfigurator.uiRenderers.colormap = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: ShaderConfigurator.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: ShaderConfigurator.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.select({...params, options: ColorMaps.schemeGroups[params.mode],
        onchange: ShaderConfigurator.__chngtml(name, 'default', 'this.value')})}<br>
Continuous: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.continuous,
        onchange: ShaderConfigurator.__chngtml(name, 'continuous', 'this.checked')})}<br>
Mode: &emsp; ${UIComponents.Elements.select({...params, default: params.mode, options: Object.keys(ColorMaps.schemeGroups),
        onchange: ShaderConfigurator.__chngtml(name, 'mode', 'this.value')})}<br>
Steps: &emsp; ${UIComponents.Elements.numberInput({...params, min: 0, max: 8, step: 1, default: params.steps,
        onchange: ShaderConfigurator.__chngtml(name, 'steps', 'Number.parseInt(this.value)')})}<br>
`;
ShaderConfigurator.uiRenderers.advanced_slider = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: ShaderConfigurator.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: ShaderConfigurator.__chngtml(name, 'interactive', 'this.checked')})}<br>
Sample Mask or Uniformly (mask=false) <br>
Read Mask: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.maskOnly,
    onchange: ShaderConfigurator.__chngtml(name, 'maskOnly', 'this.checked')})}<br>
Select starting positions (between min and max) <br>
Breaks: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.breaks,
        onchange: ShaderConfigurator.__chngtml(name, 'breaks', 'this.values')})}<br>
Minimum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.min,
        onchange: ShaderConfigurator.__chngtml(name, 'min', 'Number.parseFloat(this.value)')})}<br>
Maximum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.max,
        onchange: ShaderConfigurator.__chngtml(name, 'max', 'Number.parseFloat(this.value)')})}<br>
Step: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.minGap,
        onchange: ShaderConfigurator.__chngtml(name, 'minGap', 'Number.parseFloat(this.value)')})}<br>
Mask should have #Breaks+1 elements, either 0 or 1 depending on whether given range is enabled or disabled<br>
Mask: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.mask,
        onchange: ShaderConfigurator.__chngtml(name, 'mask', 'this.values')})}<br>
Labels on scale, in %<br>
Pips: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.pips.values,
        onchange: ShaderConfigurator.__chngtml(name, 'pips.values', 'this.values')})}<br>
`;
ShaderConfigurator.uiRenderers.bool = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
    onchange: ShaderConfigurator.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
    onchange: ShaderConfigurator.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.checkBox({...params,
    onchange: ShaderConfigurator.__chngtml(name, 'default', 'this.checked')})}<br>
`;
