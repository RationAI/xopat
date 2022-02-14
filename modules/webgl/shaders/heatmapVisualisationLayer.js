/**
 * Heatmap shader
 * data reference must contain one index to the data to render using heatmap strategy
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - for more details, see @WebGLModule.UIControls color UI type
 *  threshold - for more details, see @WebGLModule.UIControls number UI type
 *  opacity - for more details, see @WebGLModule.UIControls color UI type
 *
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

    static description() {
        return "data values encoded in color/opacity";
    }

    constructor(id, options) {
        super(id, options);

        //default false
        //todo reimplement as UI controls (by default hidden)...?
        this._invertOpacity = this.isFlag(options["inverse"]);
        this._logScale = this.isFlag(options["logScale"]);
        this._logScaleMax = options.hasOwnProperty("logScaleMax") ?
            this.toShaderFloatString(options["logScaleMax"], 1, 2) : "1.0";

        //We support three controls
        this.color = WebGLModule.UIControls.build(this, "color",
            options.color, {type: "color", default: "#fff700", title: "Color: "},
            (type, instance) => type === "vec3");
        this.threshold = WebGLModule.UIControls.build(this, "threshold",
            options.threshold, {type: "range-input", default: "1", min: "1", max: "100", step: "1", title: "Threshold: "},
            (type, instance) => type === "float");
        this.opacity = WebGLModule.UIControls.build(this, "opacity",
            options.opacity, {type: "number", default: "1", min: "0", max: "1", step: "0.1", title: "Opacity: "},
            (type, instance) => type === "float");
    }

    getFragmentShaderDefinition() {
        return `
${this.color.define()}
${this.threshold.define()}
${this.opacity.define()}
`;
    }

    getFragmentShaderExecution() {
        let comparison = this._invertOpacity ? "<=" : ">=";
        let compareAgainst, alpha;
        if (this._logScale) {
            compareAgainst = `float normalized_${this.uid} = (log2(${this._logScaleMax} + data${this.uid}) - log2(${this._logScaleMax}))/(log2(${this._logScaleMax}+1.0)-log2(${this._logScaleMax}));`;
            comparison = `normalized_${this.uid} ${comparison} ${this.threshold.sample()}`;
            alpha = this.opacity.sample(this._invertOpacity ? `(1.0 - normalized_${this.uid})` : `normalized_${this.uid}`);
        } else {
            compareAgainst = "";
            comparison = `data${this.uid} ${comparison} ${this.threshold.sample()}`;
            alpha = this.opacity.sample(this._invertOpacity ? `(1.0 - data${this.uid})` : `data${this.uid}`);
        }
        let compareConst = this._invertOpacity ? "< 0.98" : " > 0.02";

        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    ${compareAgainst}
    if(data${this.uid} ${compareConst} && ${comparison}){
        show(vec4(${this.color.sample()}, ${alpha}));
    }
`;
    }

    glDrawing(program, dimension, gl) {
        this.color.glDrawing(program, dimension, gl);
        this.threshold.glDrawing(program, dimension, gl);
        this.opacity.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this.color.glLoaded(program, gl);
        this.threshold.glLoaded(program, gl);
        this.opacity.glLoaded(program, gl);
    }

    init() {
        this.color.init();
        this.threshold.init();
        this.opacity.init();
    }

    htmlControls() {
        return [
            this.color.toHtml(true),
            this.opacity.toHtml(true, this._invertOpacity ? "direction: rtl" : ""),
            this.threshold.toHtml(true)
        ].join("");
    }

    supports() {
        return {
            color: "vec3",
            opacity: "float",
            threshold: "float",
        }
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.HeatmapLayer);
