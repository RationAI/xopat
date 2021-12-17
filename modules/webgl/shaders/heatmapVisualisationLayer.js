/**
 * Heatmap shader
 * data reference must contain one index to the data to render using heatmap strategy
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - color to fill-in areas with values, url encoded '#ffffff' format or digits only 'ffffff', default "#d2eb00"
 *  ctrlColor - whether to allow color modification, 1 or 0, default 1
 *  ctrlThreshold - whether to allow threshold modification, 1 or 0, default 1
 *  ctrlOpacity - whether to allow opacity modification, 1 or 0, default 1
 *  inverse - low values are high opacities instead of high values, 1 or 0, default 0
 *  logScale - use logarithmic scale instead of linear, 1 or 0, default 0
 *  logScaleMax - maximum value used in the scale (remember, data values range from 0 to 1), default 1.0
 *
 * colors shader will read underlying data (red component) and output
 * to canvas defined color with opacity based on the data
 * (0.0 => transparent, 1.0 => opaque)
 * supports thresholding - outputs color on areas above certain value
 * mapping html input slider 0-100 to .0-1.0
 */
WebGLModule.HeatmapLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "heatmap";
    }

    static name() {
        return "Heatmap";
    }

    constructor(options) {
        super(options);

        if (options.hasOwnProperty("color")) {
            this._defaultColor = this.toRGBShaderColorFromString(options["color"], [210/255, 235/255, 0]);
        } else {
            this._defaultColor = [210/255, 235/255, 0];
        }

        //default true
        this._allowColorChange = this.isFlagOrMissing(options["ctrlColor"]);
        this._allowThresholdChange = this.isFlagOrMissing(options["ctrlThreshold"]);
        this._allowOpacityChange = this.isFlagOrMissing(options["ctrlOpacity"]);
        //default false
        this._invertOpacity = this.isFlag(options["inverse"]);
        this._defaultThresholdValue = this._invertOpacity ? "100" : "1";
        this._logScale = this.isFlag(options["logScale"]);
        this._logScaleMax = options.hasOwnProperty("logScaleMax") ?
            this.toShaderFloatString(options["logScaleMax"], 1, 2) : "1.0";
    }

    getFragmentShaderDefinition() {
        return `
uniform float threshold_${this.uid};
uniform float opacity_${this.uid};
uniform vec3 color_${this.uid};
`;
    }

    getFragmentShaderExecution() {
        let comparison = this._invertOpacity ? "<=" : ">=";
        let compareAgainst, alpha;
        if (this._logScale) {
            compareAgainst = `float normalized_${this.uid} = (log2(${this._logScaleMax} + data${this.uid}) - log2(${this._logScaleMax}))/(log2(${this._logScaleMax}+1.0)-log2(${this._logScaleMax}));`;
            comparison = `normalized_${this.uid} ${comparison} threshold_${this.uid}`;
            alpha = (this._invertOpacity ? `(1.0 - normalized_${this.uid})` : `normalized_${this.uid}`) + ` * opacity_${this.uid}`;
        } else {
            compareAgainst = "";
            comparison = `data${this.uid} ${comparison} threshold_${this.uid}`;
            alpha = (this._invertOpacity ? `(1.0 - data${this.uid})` : `data${this.uid}`) + ` * opacity_${this.uid}`;
        }
        let compareConst = this._invertOpacity ? "< 0.98" : " > 0.02";

        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    ${compareAgainst}
    if(data${this.uid} ${compareConst} && ${comparison}){
        show(vec4(color_${this.uid}, ${alpha}));
    }
`;
    }

    glDrawing(program, dimension, gl) {
        gl.uniform1f(this.threshold_loc, this.threshold / 100.0);
        gl.uniform1f(this.opacity_loc, this.opacity);
        gl.uniform3fv(this.color_loc, this.color);
    }

    glLoaded(program, gl) {
        this.threshold_loc = gl.getUniformLocation(program, `threshold_${this.uid}`);
        this.opacity_loc = gl.getUniformLocation(program, `opacity_${this.uid}`);
        this.color_loc = gl.getUniformLocation(program, `color_${this.uid}`);
    }

    init() {
        this.twoElementInit("threshold",
            `#threshold-${this.uid}`,
            `#threshold-slider-${this.uid}`,
            this._defaultThresholdValue,
            v => Math.max(Math.min(v, 100), 1)
        );

        this.simpleControlInit("opacity",
            `#opacity-${this.uid}`,
            1
        );

        const _this = this;
        function colorChange(e) {
            let col = $(e.target).val();
            _this.color = _this.toRGBShaderColorFromString(col, _this._defaultColor);
            _this.storeProperty('color', _this.color);
            _this.invalidate();
        }
        let colpicker = $(`#color-${this.uid}`);
        this.color = this.loadProperty('color', this._defaultColor);
        colpicker.val("#" + Math.round(this.color[0] * 255).toString(16).padStart(2, "0") + Math.round(this.color[1] * 255).toString(16).padStart(2, "0") +  Math.round(this.color[2] * 255).toString(16).padStart(2, "0"));
        colpicker.change(colorChange);
    }

    htmlControls() {
        let html = "";
        if (this._allowColorChange) {
            html += `<span> Color:</span><input type="color" id="color-${this.uid}" class="form-control input-sm"><br>`;
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

WebGLModule.ShaderMediator.registerLayer(WebGLModule.HeatmapLayer);