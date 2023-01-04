//Not used for now, was meant to configure shader params/inputs in GUI layout (clickable setup)
var PredefinedShaderControlParameters = {
    REF: 'PredefinedShaderControlParameters',

    //todo why this.REF not working
    __chngtml: (paramName, key, valueGetter) =>
        `PredefinedShaderControlParameters.refreshUserUpdated(this, '${paramName}', '${key}', ${valueGetter})`,

    /**
     * Render number by its value, a map of [uiType] => function values
     * @param name name of the control as defined by its shader
     * @param params for supported parameters see the control 'c.supports' value
     */
    uiRenderers: {},

    /**
     * Set data for realtime data postprocessing
     * @param {Image|Canvas} data to process
     */
    setData: function (data) {
        const module = this._getModule('live-setup-interactive-controls');
        if (module) {
            module.setDimensions(data.width, data.height);
        }
        this._renderData = data;
    },

    printShadersAndParams: function(id) {
        let node = document.getElementById(id);
        //node.innerHTML = this.getShadersHtml() + this.getControlsHtml();
        node.innerHTML = this.getShadersHtml() + this.getInteractiveControlsHtmlFor('heatmap');

        //todo only when intearctive
        this.setModuleActiveRender();
    },

    getShadersHtml: function() {
        let html = ["<div><h3>Available shaders and their parameters</h3><br>"];
        const uicontrols = this._buildControls();
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
            html.push("</div></div><br>");
        }
        html.push("</div><br>");
        return html.join("");
    },

    getControlsHtml: function() {
        let html = ["<div><h3>Available controls and their parameters</h3><br>"];
        const uicontrols = this._buildControls();

        for (let type in uicontrols) {
            html.push("<div><h4>Type <code>", type, "</code></h4>");
            for (let ctrl of uicontrols[type]) {
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

    getAvailableControlsForShader: function(shader) {
        const uicontrols = this._buildControls();
        let controls = shader.defaultControls;

        const result = {};
        for (let control in controls) {
            let supported = [];
            if (controls[control] === false) continue;
            if (controls[control].required?.type) {
                supported.push(controls[control].required.type);
            } else {
                for (let gltype in uicontrols) {
                    for (let existing of uicontrols[gltype]) {
                        if (controls[control] === false) continue;
                        if (!controls[control].accepts(gltype, existing)) continue;
                        supported.push(existing.name);
                    }
                }
            }
            result[control] = supported;
        }
        return result;
    },

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
            this.setup.params[controlId] = this.parseJSONConfig($(node).val());
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

    parseJSONConfig(value) {
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
        return config
    },

    refresh() {
        this.setup.shader.cache = {};
        $("#live-setup-interactive-container").replaceWith(this.getInteractiveControlsHtmlFor(this.setup.shader.type));
        this.setModuleActiveRender();
    },

    setModuleActiveRender() {
        if (this._renderData) {
            const module = this._getModule('live-setup-interactive-controls');
            if (module) {
                document.getElementById("realtime-rendering-example").appendChild(module.gl.canvas);
                module.processImage(this._renderData,
                    {width: this._renderData.width, height: this._renderData.height},
                    0,
                    1);
            }
        }
    },

    _buildControlJSONHtml(controlId) {
        let control = this.active.layer[controlId];
        const params = {...control.params};
        delete params.type;

        return `<div id='live-setup-interactive-control-${controlId}'>
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
            let _this = window.PredefinedShaderControlParameters,
                module = _this._getModule(id);
            if (module) return module;
            throw "Module not instantiated!";
        },
        get vis () { return this.mod('live-setup-interactive-controls').visualization(0)},
        get shader() { return this.mod('live-setup-interactive-controls').visualization(0).shaders["1"] },
        get layer() { return this.mod('live-setup-interactive-controls').visualization(0).shaders["1"]._renderContext }
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
        const module = this._buildModule('live-setup-interactive-controls', function (title, html, dataId, isVisible, layer, isControllable = true) {
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

            return `<div id="live-setup-interactive-container">
${renders.join("")}
<div id="live-setup-interactive-shader-head" style="margin: 0 auto; max-width: 500px;" class="configurable-border">
<div class="shader-part-name">${title}</div>${html}</div>
</div>
<div id="realtime-rendering-example"></div>
</div>`;
        }, onLoaded);
        module.reset();

        const data = shader.sources(); //read static sources declaration
        this.setup.shader.type = shaderId;
        this.setup.shader.dataReferences = data.map((x, i) => i);
        this.setup.shader.name = "Configuration: " + shaderId;

        module.addVisualisation(this.setup.vis);
        module.prepareAndInit(data.map(x => ""), this._renderData?.width, this._renderData?.height);
        return "<div><h3>Available controls and their parameters</h3><br><div id='live-setup-interactive-controls'></div></div><br>";
    },

    _buildModule: function(id, htmlRenderer, onReady) {
        if (this["__module_"+id]) return this["__module_"+id];
        this["__module_"+id] = new WebGLModule({
            htmlControlsId: id,
            webGlPreferredVersion: "2.0",
            htmlShaderPartHeader: htmlRenderer,
            ready: onReady
        });
        return this["__module_"+id];
    },

    _getModule: function(id) {
        return this["__module_"+id];
    },

    _buildControls: function () {
        if (this.__uicontrols) return this.__uicontrols;
        this.__uicontrols = {};
        let types = WebGLModule.UIControls.types();
        let fallbackLayer = new WebGLModule.IdentityLayer("id", {}, {layer: {}});
        for (let type of types) {
            let ctrl = WebGLModule.UIControls.build(fallbackLayer, type, {type: type});
            let glType = ctrl.type;
            ctrl.name = type;
            if (!this.__uicontrols.hasOwnProperty(glType)) this.__uicontrols[glType] = [];
            this.__uicontrols[glType].push(ctrl);
        }
        return this.__uicontrols;
    }
};

/**
 * Definition of tailored setters for shader controls
 */
PredefinedShaderControlParameters.uiRenderers.number = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.numberInput({...params,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'default', 'Number.parseFloat(this.value)')})}<br>
<!--Minimum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.min,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'min', 'Number.parseFloat(this.value)')})}<br>
Maximum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.max,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'max', 'Number.parseFloat(this.value)')})}<br>
Step: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.step,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'step', 'Number.parseFloat(this.value)')})}<br>-->
`;
PredefinedShaderControlParameters.uiRenderers.range = PredefinedShaderControlParameters.uiRenderers.number;
PredefinedShaderControlParameters.uiRenderers.range_input = PredefinedShaderControlParameters.uiRenderers.number;
PredefinedShaderControlParameters.uiRenderers.color = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.colorInput({...params,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'default', 'this.value')})}<br>
`;
PredefinedShaderControlParameters.uiRenderers.colormap = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.select({...params, options: ColorMaps.schemeGroups[params.mode],
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'default', 'this.value')})}<br>
Continuous: &emsp; ${UIComponents.Elements.checkBox({...params, default: params.continuous,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'continuous', 'this.checked')})}<br>
Mode: &emsp; ${UIComponents.Elements.select({...params, default: params.mode, options: Object.keys(ColorMaps.schemeGroups),
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'mode', 'this.value')})}<br>
Steps: &emsp; ${UIComponents.Elements.numberInput({...params, min: 0, max: 8, step: 1, default: params.steps,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'steps', 'Number.parseInt(this.value)')})}<br>
`;
PredefinedShaderControlParameters.uiRenderers.advanced_slider = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'interactive', 'this.checked')})}<br>
Breaks: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.breaks,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'breaks', 'this.values')})}<br>
Minimum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.min,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'min', 'Number.parseFloat(this.value)')})}<br>
Maximum value: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.max,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'max', 'Number.parseFloat(this.value)')})}<br>
Step: &emsp; ${UIComponents.Elements.numberInput({...params, min: -1e+5, max: +1e+5, step: 1e-5, default: params.minGap,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'minGap', 'Number.parseFloat(this.value)')})}<br>
Mask: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.mask,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'mask', 'this.values')})}<br>
Pips: &emsp; ${UIComponents.Elements.numberArray({...params, default: params.pips.values,
        onchange: PredefinedShaderControlParameters.__chngtml(name, 'pips.values', 'this.values')})}<br>
`;
PredefinedShaderControlParameters.uiRenderers.bool = (name, params, onChange) => `
Title: &emsp; ${UIComponents.Elements.textInput({...params, default: params.title,
    onchange: PredefinedShaderControlParameters.__chngtml(name, 'title', 'this.value')})}<br>
Interactive: &emsp;  ${UIComponents.Elements.checkBox({...params, default: params.interactive,
    onchange: PredefinedShaderControlParameters.__chngtml(name, 'interactive', 'this.checked')})}<br>
Default value: &emsp; ${UIComponents.Elements.checkBox({...params,
    onchange: PredefinedShaderControlParameters.__chngtml(name, 'default', 'this.checked')})}<br>
`;
