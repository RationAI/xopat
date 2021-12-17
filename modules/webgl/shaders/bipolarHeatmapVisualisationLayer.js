/**
 * Bi-colors shader
 * data reference must contain one index to the data to render using bipolar heatmap strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  colorHigh - color to fill-in areas with high values (-->255), url encoded '#ffffff' format or digits only 'ffffff', default "#ff0000"
 *  colorLow - color to fill-in areas with low values (-->0), url encoded '#ffffff' format or digits only 'ffffff', default "#7cfc00"
 *  ctrlColor - whether to allow color modification, true or false, default true
 *  ctrlThreshold - whether to allow threshold modification, true or false, default true
 *  ctrlOpacity - whether to allow opacity modification, true or false, default true
 *  logScale - use logarithmic scale instead of linear, 1 or 0, default 0
 *  logScaleMax - maximum value used in the scale (remember, data values range from 0 to 1), default 1.0
 *
 * this shader considers insignificant values to be around the middle (0.5), and significant are low or high values,
 * the value itself is encoded in opacity (close to 1 if too low or too high), user can define two colors, for low and high values respectively
 */

WebGLModule.BipolarHeatmapLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "bipolar-heatmap";
    }

    static name() {
        return "Bi-polar Heatmap";
    }

    constructor(options) {
        super(options);

        if (options.hasOwnProperty("colorHigh")) {
            this._defaultHigh = this.toRGBShaderColorFromString(options["colorHigh"], [1, 0, 0]);
        } else {
            this._defaultHigh = [1, 0, 0];
        }

        if (options.hasOwnProperty("colorLow")) {
            this._defaultLow = this.toRGBShaderColorFromString(options["colorLow"], [124/255, 252/255, 0]);
        } else {
            this._defaultLow = [124/255, 252/255, 0];
        }

        //default true
        this._allowColorChange = this.isFlagOrMissing(options["ctrlColor"]);
        this._allowThresholdChange = this.isFlagOrMissing(options["ctrlThreshold"]);
        this._allowOpacityChange = this.isFlagOrMissing(options["ctrlOpacity"]);
        //default false
        this._logScale = this.isFlag(options["logScale"]);
        this._logScaleMax = options.hasOwnProperty("logScaleMax") ?
            this.toShaderFloatString(options["logScaleMax"], 1, 2) : "1.0";
    }

    getFragmentShaderDefinition() {
        return `
uniform float threshold_${this.uid};
uniform float opacity_${this.uid};
uniform vec3 colorHigh_${this.uid};
uniform vec3 colorLow_${this.uid};
`;
    }

    getFragmentShaderExecution() {
        let compareAgainst;
        if (this._logScale) {
            compareAgainst = `value_${this.uid} = (log2(${this._logScaleMax} + value_${this.uid}) - log2(${this._logScaleMax}))/(log2(${this._logScaleMax}+1.0)-log2(${this._logScaleMax}));`;
        } else {
            compareAgainst = "";
        }
        return `
    float data_${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    if (!close(data_${this.uid}, .5)) {
        if (data_${this.uid} < .5) { 
            float value_${this.uid} = 1.0 - data_${this.uid} * 2.0;
            ${compareAgainst}
            if (value_${this.uid} > threshold_${this.uid}) {
                show(vec4( colorLow_${this.uid} , value_${this.uid} * opacity_${this.uid}));
            }
        } else {  
            float value_${this.uid} = (data_${this.uid} - 0.5) * 2.0;
            ${compareAgainst}
            if (value_${this.uid} > threshold_${this.uid}) {
                show(vec4( colorHigh_${this.uid} , value_${this.uid} * opacity_${this.uid}));
            }
        }
    }        
`;
    }

    glDrawing(program, dimension, gl) {
        gl.uniform1f(this.threshold_loc, this.threshold / 100.0);
        gl.uniform1f(this.opacity_loc, this.opacity);
        gl.uniform3fv(this.colorHigh_loc, this.colorHigh);
        gl.uniform3fv(this.colorLow_loc, this.colorLow);
    }

    glLoaded(program, gl) {
        this.threshold_loc = gl.getUniformLocation(program, `threshold_${this.uid}`);
        this.opacity_loc = gl.getUniformLocation(program, `opacity_${this.uid}`);
        this.colorHigh_loc = gl.getUniformLocation(program, `colorHigh_${this.uid}`);
        this.colorLow_loc = gl.getUniformLocation(program, `colorLow_${this.uid}`);
    }

    init() {
        this.twoElementInit("threshold",
            `#threshold-${this.uid}`,
            `#threshold-slider-${this.uid}`,
            1,
            v => Math.max(Math.min(v, 100), 1)
        );

        this.simpleControlInit("opacity",
            `#opacity-${this.uid}`,
            1
        );

        const _this = this;
        function colorHighChange(e) {
            let col = $(e.target).val();
            _this.colorHigh = _this.toRGBShaderColorFromString(col, _this._defaultHigh);
            _this.storeProperty('colorHigh', _this.colorHigh);
            _this.invalidate();
        }
        let colpicker = $(`#color-high-${this.uid}`);
        this.colorHigh = this.loadProperty('colorHigh', this._defaultHigh);
        colpicker.val("#" + Math.round(this.colorHigh[0] * 255).toString(16).padStart(2, "0") + Math.round(this.colorHigh[1] * 255).toString(16).padStart(2, "0") +  Math.round(this.colorHigh[2] * 255).toString(16).padStart(2, "0"));
        colpicker.change(colorHighChange);
        function colorLowChange(e) {
            let col = $(e.target).val();
            _this.colorLow = _this.toRGBShaderColorFromString(col, _this._defaultLow);
            _this.storeProperty('colorLow', _this.colorLow);
            _this.invalidate();
        }
        colpicker = $(`#color-low-${this.uid}`);
        this.colorLow = this.loadProperty('colorLow', this._defaultLow);
        colpicker.val("#" + Math.round(this.colorLow[0] * 255).toString(16).padStart(2, "0") + Math.round(this.colorLow[1] * 255).toString(16).padStart(2, "0") +  Math.round(this.colorLow[2] * 255).toString(16).padStart(2, "0"));
        colpicker.change(colorLowChange);
    }

    htmlControls() {
        let html = "";
        if (this._allowColorChange) {
            html += `<span> High values:</span><input type="color" id="color-high-${this.uid}" class="form-control input-sm"><br>
<span> Low values:</span><input type="color" id="color-low-${this.uid}" class="form-control input-sm"><br>`;
        }

        if (this._allowOpacityChange) {
            html += `<span> Opacity:</span><input type="range" id="opacity-${this.uid}" min="0" max="1" step="0.1"><br>`;
        }

        if (this._allowThresholdChange) {
            let directionRange = this._invertOpacity ? 'style="direction: rtl"' : "";
            html += `<span> Threshold:</span><input type="range" id="threshold-slider-${this.uid}" 
class="with-direct-input" min="1" max="100" ${directionRange} step="1">
<input class="form-control input-sm" style="max-width:60px;" type="number" id="threshold-${this.uid}"><br>`;
        }
        return html;
    }
}

WebGLModule.ShaderMediator.registerLayer(WebGLModule.BipolarHeatmapLayer);