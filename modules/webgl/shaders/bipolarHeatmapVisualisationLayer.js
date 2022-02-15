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

    static description() {
        return "TODO: remove in the future";
    }

    constructor(id, options) {
        super(id, options);

        this.colorHigh = WebGLModule.UIControls.build(this, "colorHigh",
            options.colorHigh, {type: "color", default: "#fff700", title: "Color High: "},
            (type, instance) => type === "vec3");
        this.colorLow = WebGLModule.UIControls.build(this, "colorLow",
            options.colorLow, {type: "color", default: "#fff700", title: "Color Low: "},
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
${this.colorHigh.define()}
${this.colorLow.define()}
${this.threshold.define()}
${this.opacity.define()}
`;
    }

    getFragmentShaderExecution() {
        let varname = `data_${this.uid}`;
        return `
    float ${varname} = ${this.sampleChannel('tile_texture_coords', true)};
    if (!close(${varname}, .5)) {
        if (${varname} < .5) { 
            ${varname} = ${this.filter(`1.0 - ${varname} * 2.0`)};
            if (${varname} > ${this.threshold.sample()}) {
                show(vec4( ${this.colorLow.sample()}, ${varname} * ${this.opacity.sample()}));
            }
        } else {  
            ${varname} = ${this.filter(`(${varname} - 0.5) * 2.0`)};
            if (${varname} > ${this.threshold.sample()}) {
                show(vec4( ${this.colorHigh.sample()}, ${varname} * ${this.opacity.sample()}));
            }
        }
    }        
`;
    }

    glDrawing(program, dimension, gl) {
        this.colorHigh.glDrawing(program, dimension, gl);
        this.colorLow.glDrawing(program, dimension, gl);
        this.threshold.glDrawing(program, dimension, gl);
        this.opacity .glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this.colorHigh.glLoaded(program, gl);
        this.colorLow.glLoaded(program, gl);
        this.threshold.glLoaded(program, gl);
        this.opacity.glLoaded(program, gl);
    }

    init() {
        this.colorHigh.init();
        this.colorLow.init();
        this.threshold.init();
        this.opacity.init();
    }

    htmlControls() {
        return [
            this.colorHigh.toHtml(true),
            this.colorLow.toHtml(true),
            this.opacity.toHtml(true, this._invertOpacity ? "direction: rtl" : ""),
            this.threshold.toHtml(true)
        ].join("");
    }

    supports() {
        return {
            colorHigh: "vec3",
            colorLow: "vec3",
            opacity: "float",
            threshold: "float",
        }
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.BipolarHeatmapLayer);
