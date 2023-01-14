/**
 * Colormap shader
 * data reference must contain one index to the data to render using colormap strategy
 *
 * todo allow invert
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - can be a ColorMap, number of steps = x
 *  threshold - must be an AdvancedSlider, default values array (pipes) = x-1, mask array size = x, incorrect
 *      values are changed to reflect the color steps
 *  connect - a boolean switch to enable/disable advanced slider mapping to break values, enabled for type==="colormap" only
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

    constructor(id, options, privateOptions) {
        super(id, options, privateOptions);

        //delete unused controls if applicable after initialization
        if (this.color.getName() !== "colormap") {
            delete this.connect;
        }
    }

    static defaultControls = {
        color: {
            default: {
                type: "colormap",
                steps: 3, //number of categories
                default: "Viridis",
                mode: "sequential",
                title: "Colormap",
                continuous: false,
            },
            accepts: (type, instance) => type === "vec3"
        },
        threshold: {
            default: {
                type: "advanced_slider",
                default: [0.25, 0.75], //breaks/separators, e.g. one less than bin count
                mask: [1, 0, 1],  //same number of steps as color
                title: "Breaks",
                pips: {
                    mode: 'positions',
                    values: [0, 35, 50, 75, 90, 100],
                    density: 4
                }},
            accepts: (type, instance) => type === "float",
            required: {type: "advanced_slider", inverted: false}
        },
        connect : {
            default: {type: "bool", interactive: true, title: "Connect breaks: ", default: false},
            accepts:  (type, instance) => type === "bool"
        }
    };

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('tile_texture_coords')};
    return vec4(${this.color.sample('chan', 'float')}, step(0.05, ${this.threshold.sample('chan', 'float')}));
`;
    }

    defaultColSteps(length) {
        return [...Array(length).keys()].forEach(x => x+1);
    }

    init() {
        const _this = this;

        this.opacity.init();

        if (this.connect) {
            this.connect.on('default', function (raw, encoded, ctx) {
                _this.color.setSteps(_this.connect.raw ? [0, ..._this.threshold.raw, 1] :
                    _this.defaultColSteps(_this.color.maxSteps)
                );
                _this.color.updateColormapUI();
            }, true);
            this.connect.init();


            this.threshold.on('breaks', function (raw, encoded, ctx) {
                if (_this.connect.raw) { //if YES
                    _this.color.setSteps([0, ...raw, 1]);
                    _this.color.updateColormapUI();
                }
            }, true);
        }
        this.threshold.init();

        if (this.threshold.raw.length != this.color.params.steps - 1) {
            //todo fix this scenario
            //console.warn("Invalid todododo");
        }

        if (this.connect) {
            if (this.connect.raw) {
                this.color.setSteps([0, ...this.threshold.raw, 1]);
            } else {
                //default breaks mapping for colormap if connect not enabled
                this.color.setSteps(this.defaultColSteps(this.color.maxSteps));
            }
        }

        this.color.init();
        // let steps = this.color.steps.filter(x => x >= 0);
        // steps.splice(steps.length-1, 1); //last element is 1 not a break
        // this.storeProperty('threshold_values', steps);
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.ColorMap);
