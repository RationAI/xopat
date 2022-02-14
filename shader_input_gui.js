var PredefinedShaderControlParameters = {

    _text: function(cls, placeholder, funToCall, ofType, paramName) {
        return `<input type="text" class="${cls} form-control" placeholder="${placeholder}" onchange="${funToCall}(this, '${ofType}', '${paramName}');">`;
    },
    _checkbox: function(cls, funToCall, ofType, paramName) {
        return `<input type="checkbox" class="${cls} form-control" onchange="${funToCall}(this, '${ofType}', '${paramName}');">`;
    },
    _color: function(cls, placeholder, funToCall, ofType, paramName) {
        return `<input type="color" class="${cls} form-control" placeholder="${placeholder}" onchange="${funToCall}(this, '${ofType}', '${paramName}');">`;
    },
    _real: function(cls, placeholder, funToCall, ofType, paramName, def, min, max) {
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" step="0.01" onchange="${funToCall}(this, '${ofType}', '${paramName}');">`;
    },
    _integer: function(cls, placeholder, funToCall, ofType, paramName, def, min, max) {
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" onchange="${funToCall}(this, '${ofType}', '${paramName}');">`;
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

    shaderMapping: {
        "bipolar-heatmap": {
            "colorHigh": "color",
            "colorLow": "color",
            "threshold": "float",
            "opacity": "float",
            //todo some input only
            "logScale": "bool",
            "logScaleMax": "float"
        },
        "heatmap": {
            "color": "color",
            "threshold": "float",
            "opacity": "float",
            //todo some input only
            "logScale": "bool",
            "logScaleMax": "float",
            "inverse": "bool"
        },
        "edge": {
            "color": "color",
            "threshold": "float",
            "opacity": "float",
            "edgeThickness": "float"
        },
        "identity": {
            //todo opacity?
        }
    }
};
