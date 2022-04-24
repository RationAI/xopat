//Not used for now, was meant to configure shader params/inputs in GUI layout (clickable setup)
var PredefinedShaderControlParameters = {

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
        let html = ["<div><h3>Available shaders and their parameters</h3><br>"];

        let uicontrols = {};
        let types = WebGLModule.UIControls.types();
        let fallbackLayer = new WebGLModule.IdentityLayer("id", {});
        for (let type of types) {
            let ctrl = WebGLModule.UIControls.build(fallbackLayer, type, {type: type});
            let glType = ctrl.type;
            ctrl.name = type;
            if (!uicontrols.hasOwnProperty(glType)) uicontrols[glType] = [];
            uicontrols[glType].push(ctrl);
        }

        for (let shader of WebGLModule.ShaderMediator.availableShaders()) {
            let id = shader.type();

            html.push( "<div class='d-flex'><div style='min-width: 150px'><p class='f3-light mb-0'>",
                shader.name(), "</p><p style='max-width: 150px;'>", shader.description(),
                "</p></div><div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>",
                "<img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='modules/webgl/shaders/",
                shader.type(),".png'></div><div><code class='f4'>", id, "</code>");

            let controls = shader.defaultControls;
            for (let control in controls) {
                let supported = [];
                for (let gltype in uicontrols) {
                    for (let existing of uicontrols[gltype]) {
                        if (!controls[control].accepts(gltype, existing)) continue;
                        supported.push(existing.name);
                    }
                }
                html.push("<div><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);'",
                    "class='position-relative'><span class='flex-1'>Control <code>",
                    control, "</code> | Supports: ", supported.join(", ") ,"</span></span></div>");

            }
            html.push("</div></div><br>");
        }
        html.push("</div><br><div><h3>Available controls and their parameters</h3><br>");

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

        html.push("</div>");
        node.innerHTML = html.join("");
    }
};
