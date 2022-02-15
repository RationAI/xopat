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

    constructor(id, options) {
        super(id, options);

        //We support three controls
        this.color = WebGLModule.UIControls.build(this, "color",
            options.color, {type: "colormap"}, (type, instance) => type === "vec3");
        this.threshold = WebGLModule.UIControls.build(this, "threshold",
            options.threshold, {type: "advanced_slider"}, (type, instance) => type === "float");
        this.opacity = WebGLModule.UIControls.build(this, "opacity",
            options.opacity, {type: "range", default: "1", min: "0", max: "1", step: "0.1", title: "Opacity: "}, (type, instance) => type === "float");

        //lets break some encapsulation
        //connect supported only if these controls used
        this.supportConnect = (!options.color || !options.color.type || options.color.type === "colormap")
            && (!options.threshold || !options.threshold.type || options.threshold.type === "advanced_slider");

        if (this.supportConnect) {
            this.connect = WebGLModule.UIControls.build(this, "connects",
                options.connect, {type: "bool", visible: false, title: "Breaks mapping: ", default: false},
                (type, instance) => type === "bool");
        } else {
            console.log("ColorMap: cannot connect controls.");
        }
    }

    getFragmentShaderDefinition() {
        return `
${this.color.define()}
${this.threshold.define()}
${this.opacity.define()}
`;
    }

    getFragmentShaderExecution() {
//         let comparison, compareAgainst, ratio;
//         if (this._logScale) {
//             compareAgainst = `float normalized_${this.uid} = (log2(${this._logScaleMax} + data${this.uid}) - log2(${this._logScaleMax}))/(log2(${this._logScaleMax}+1.0)-log2(${this._logScaleMax}));`;
//             comparison = `normalized_${this.uid} >= ${this.threshold.sample("0.01")}`;
//             ratio = `normalized_${this.uid}`;
//         } else {
//             compareAgainst = "";
//             comparison = `data${this.uid} >= ${this.threshold.sample("0.01")}`;
//             ratio = `data${this.uid}`;
//         }
//         let compareConst = " > 0.02";
//
//         return `
//     float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
//     ${compareAgainst}
//     if(data${this.uid} ${compareConst} && ${comparison}){
//         show(vec4(${this.color.sample(ratio)}, ${this.opacity.sample()}));
//     }
// `;
        let ratio = `data${this.uid}`;
        return `
    float data${this.uid} = ${this.sampleChannel('tile_texture_coords')};
    show(vec4(${this.color.sample(ratio)}, step(0.05, ${this.threshold.sample(ratio)}) * ${this.opacity.sample()}));
    
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

        if (this.supportConnect) {
            let steps = this.color.steps.filter(x => x >= 0);
            steps.splice(steps.length-1, 1); //last element is 1 not a break
            this.threshold.params.default = steps;
            this.storeProperty('threshold', steps);
        }
        this.threshold.init();
        this.opacity.init();

        const _this = this;
        if (this.supportConnect) {
            this.threshold.on('threshold', function (raw, encoded, ctx) {
                if (_this.connect.raw) { //if YES
                    _this.color.setSteps(raw);
                }
            }, true);
            this.connect.on('connects', function (raw, encoded, ctx) {
                _this.color.setSteps(_this.connect.raw ? [..._this.threshold.raw, 1] : undefined);
            }, true);
            this.connect.init();
        } else {
            this.threshold.off('threshold');
        }
    }

    htmlControls() {
        return [
            this.color.toHtml(true),
            this.threshold.toHtml(true),
            (this.supportConnect ? this.connect.toHtml(true) : ""),
            this.opacity.toHtml(true)
        ].join("");
    }

    supports() {
        return {
            color: "vec3",
            opacity: "float",
            threshold: "float",
            connect: "bool",
        }
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.ColorMap);
