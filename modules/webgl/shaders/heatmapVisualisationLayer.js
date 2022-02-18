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

        this.inverse = WebGLModule.UIControls.build(this, "inverse",
            options.inverse, {type: "bool", default: false, title: "Invert: "},
            (type, instance) => type === "bool");
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
${this.inverse.define()}
`;
    }

    getFragmentShaderExecution() {
        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    if (${this.inverse.sample()}) data${this.uid} = 1.0 - data${this.uid};
    if(data${this.uid} > 0.02 && data${this.uid} >= ${this.threshold.sample()}){
        ${this.render(`vec4(${this.color.sample()}, data${this.uid}) * ${this.opacity.sample()}`)}
    }
`;
    }

    glDrawing(program, dimension, gl) {
        this.color.glDrawing(program, dimension, gl);
        this.threshold.glDrawing(program, dimension, gl);
        this.opacity.glDrawing(program, dimension, gl);
        this.inverse.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this.color.glLoaded(program, gl);
        this.threshold.glLoaded(program, gl);
        this.opacity.glLoaded(program, gl);
        this.inverse.glLoaded(program, gl);
    }

    init() {
        this.color.init();
        this.threshold.init();
        this.opacity.init();
        this.inverse.init();
    }

    htmlControls() {
        return [
            this.color.toHtml(true),
            this.opacity.toHtml(true, this._invertOpacity ? "direction: rtl" : ""),
            this.threshold.toHtml(true),
            this.inverse.toHtml(true)
        ].join("");
    }

    supports() {
        return {
            color: "vec3",
            opacity: "float",
            threshold: "float",
            inverse: "bool"
        }
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.HeatmapLayer);
