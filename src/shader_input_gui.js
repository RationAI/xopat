//Not used for now, was meant to configure shader params/inputs in GUI layout (clickable setup)
var PredefinedShaderControlParameters = {
    REF: 'PredefinedShaderControlParameters',

    //todo replace by ui_components
    _text: function(cls, placeholder, funToCall, ofType, paramName) {
        funToCall = typeof funToCall === "string" ? `onchange="${funToCall}(this, '${ofType}', '${paramName}');"` : "disabled";
        return `<input type="text" class="${cls} form-control" placeholder="${placeholder}" ${funToCall}>`;
    },
    _checkbox: function(cls, funToCall, ofType, paramName) {
        funToCall = typeof funToCall === "string" ? `onchange="${funToCall}(this, '${ofType}', '${paramName}');"` : "disabled";
        return `<input type="checkbox" class="${cls} form-control" ${funToCall}>`;
    },
    _color: function(cls, placeholder, funToCall, ofType, paramName) {
        funToCall = typeof funToCall === "string" ? `onchange="${funToCall}(this, '${ofType}', '${paramName}');"` : "disabled";
        return `<input type="color" class="${cls} form-control" placeholder="${placeholder}" ${funToCall}>`;
    },
    _real: function(cls, placeholder, funToCall, ofType, paramName, def, min, max) {
        funToCall = typeof funToCall === "string" ? `onchange="${funToCall}(this, '${ofType}', '${paramName}');"` : "disabled";
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" step="0.01" ${funToCall}>`;
    },
    _integer: function(cls, placeholder, funToCall, ofType, paramName, def, min, max) {
        funToCall = typeof funToCall === "string" ? `onchange="${funToCall}(this, '${ofType}', '${paramName}');"` : "disabled";
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" ${funToCall}>`;
    },


    /**
     * Input number by its value
     * @param params
     * @param params.title
     * @param params.visible
     * @param params.default
     * @param params.min
     * @param params.max
     * @param params.step
     */
    number: {
        form: function (onChange) {
            return `
Title: ${this._text('', "Label", onChange, "number", "title")}<br>
Visible in GUI: ${this._checkbox('', onChange, "number", "visible")}<br>
Default value: ${this._real('', "", onChange, "number", "default")}<br>
Minimum: ${this._real('', "Lower bound", onChange, "number", "min")}<br>
Maximum: ${this._real('', "Upper bound", onChange, "number", "max")}<br>
Step: ${this._real('', "Step size", onChange, "number", "step")}<br>
`;
        }
    },

    /**
     * Input number using range slider
     * @param params
     * @param params.title
     * @param params.visible
     * @param params.default
     * @param params.min
     * @param params.max
     * @param params.step
     */
    range: {
        form: function (onChange) {
            return `
Title: ${this._text('', "Label", onChange, "range", "title")}<br>
Visible in GUI: ${this._checkbox('', onChange, "range", "visible")}<br>
Default value: ${this._real('', "", onChange, "range", "default")}<br>
Minimum: ${this._real('', "Lower bound", onChange, "range", "min")}<br>
Maximum: ${this._real('', "Upper bound", onChange, "range", "max")}<br>
Step: ${this._real('', "Step size", onChange, "range", "step")}<br>
`;
        }
    },

    /**
     * Input color using colorpicker
     * @param params
     * @param params.visible
     * @param params.default
     */
    color: {
        form: function (onChange) {
            return `
Title: ${this._text('', "Label", onChange, "color", "title")}<br>
Visible in GUI: ${this._checkbox('', onChange, "color", "visible")}<br>
Default value: ${this._color('', "", onChange, "color", "default")}<br>
`;
        }
    },

    /**
     * Input boolean flag using checkbox
     * @param params
     * @param params.visible
     * @param params.default
     */
    bool: {
        form: function (onChange) {
            return `
Title: ${this._text('', "Label", onChange, "color", "title")}<br>
Visible in GUI: ${this._checkbox('', onChange, "color", "visible")}<br>
Default value: ${this._checkbox('', onChange, "color", "default")}<br>
`;
        }
    },

    printShadersAndParams: function(id) {
        let node = document.getElementById(id);
        node.innerHTML = this.getShadersHtml() + this.getControlsHtml();
        // node.innerHTML = this.getShadersHtml() + this.getInteractiveControlsHtmlFor('colormap');
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
        $("#live-setup-interactive-container").replaceWith(this.getInteractiveControlsHtmlFor(this.setup.shader.type));
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
            let _this = window.PredefinedShaderControlParameters;
            if (_this["__module_"+id]) return _this["__module_"+id];
            throw "Module not instantiated!";
        },
        get vis () { return this.mod('live-setup-interactive-controls').visualization(0)},
        get shader() { return this.mod('live-setup-interactive-controls').visualization(0).shaders["1"] },
        get layer() { return this.mod('live-setup-interactive-controls').visualization(0).shaders["1"]._renderContext }
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
                if (!supported) continue; //skip other props, supports keep only controls

                //todo onchange
                renders.push("<div><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);'",
                    "class='position-relative'><span class='flex-1'>Control <code>",
                    control, "</code> | One of supported:", `<select class='form-control' 
onchange="${_this.REF}.refreshUserSelected('${control}', this.value);">`);

                let activeControl = layer._renderContext[control];
                for (let supType of supported) {
                    let active = activeControl.uiControlType === supType ? "selected" : "";
                    renders.push("<option value='", supType ,"' ", active, ">", supType, "</option>");
                }

                const params = {...activeControl.params};
                delete params.type;

                renders.push("</select></span></span>");
                renders.push(_this._buildControlJSONHtml(control));
                renders.push("</div>");
            }

            return `<div id="live-setup-interactive-container">
${renders.join("")}
<div id="live-setup-interactive-shader-head" style="margin: 0 auto; max-width: 500px;" class="configurable-border">
<div class="shader-part-name">${title}</div>${html}</div>
</div>
</div>`;
        }, onLoaded);
        module.reset();

        const data = shader.sources(); //read static sources declaration
        this.setup.shader.type = shaderId;
        this.setup.shader.dataReferences = data.map((x, i) => i);
        this.setup.shader.name = "Configuration: " + shaderId;

        module.addVisualisation(this.setup.vis);
        module.prepareAndInit(data.map(x => ""));
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
