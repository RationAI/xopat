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
WebGLModule.ColorMap = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "colormap";
    }

    static name() {
        return "ColorMap";
    }

    static description() {
        return "data values encoded in color scale";
    }

    static defaultControls = {
        color: {
            default: {}, //todo define some
            accepts: (type, instance) => type === "vec3",
            required: {type: "colormap"}
        },
        threshold: {
            default: {},
            accepts: (type, instance) => type === "float",
            required: {type: "advanced_slider"}
        },
        opacity: {
            default: {type: "range", default: 1, min: "0", max: 1, step: 0.1, title: "Opacity: "},
            accepts: (type, instance) => type === "float"
        },
        connect : {
            default: {type: "bool", interactive: true, title: "Breaks mapping: ", default: false},
            accepts:  (type, instance) => type === "bool"
        }
    };


    constructor(id, options) {
        super(id, options);
    }

    getFragmentShaderExecution() {
        let ratio = `data${this.uid}`;
        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    ${this.render(`vec4(${this.color.sample(ratio)}, step(0.05, ${this.threshold.sample(ratio)}) * ${this.opacity.sample()})`)}
`;
    }

    init() {
        this.color.init();
        let steps = this.color.steps.filter(x => x >= 0);
        steps.splice(steps.length-1, 1); //last element is 1 not a break
        this.threshold.params.default = steps;
        this.storeProperty('threshold', steps);
        this.threshold.init();
        this.opacity.init();

        const _this = this;

        this.threshold.on('threshold', function (raw, encoded, ctx) {
            if (_this.connect.raw) { //if YES
                _this.color.setSteps([...raw, 1]);
            }
        }, true);
        this.connect.on('connects', function (raw, encoded, ctx) {
            _this.color.setSteps(_this.connect.raw ? [..._this.threshold.raw, 1] : undefined);
           // _this.invalidate(); todo does not update?
        }, true);
        this.connect.init();
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.ColorMap);
