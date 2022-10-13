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

    static defaultControls = {
        color: {
            default: {type: "color", default: "#fff700", title: "Color: "},
            accepts: (type, instance) => type === "vec3"
        },
        threshold: {
            default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
            accepts: (type, instance) => type === "float"
        },
        opacity: {
            default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
            accepts: (type, instance) => type === "float"
        },
        inverse: {
            default: {type: "bool", default: false, title: "Invert: "},
            accepts: (type, instance) => type === "bool"
        }
    };

    getFragmentShaderExecution() {
        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    bool cond${this.uid} = data${this.uid} > 0.02 && data${this.uid} >= ${this.threshold.sample(`data${this.uid}`, 'float')};
    if (${this.inverse.sample()}) {
        cond${this.uid} = !cond${this.uid};
        data${this.uid} = 1.0 - data${this.uid};
    }
    
    if(cond${this.uid}){
        ${this.render(`vec4(${this.color.sample()}, data${this.uid} * ${this.opacity.sample()})`)}
    } else {
        ${this.render(`vec4(.0)`)}
    }
`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.HeatmapLayer);
