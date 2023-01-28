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
        return "values are of two categories, smallest considered in the middle";
    }

    static defaultControls = {
        colorHigh: {
            default: {type: "color", default: "#ff1000", title: "Color High: "},
            accepts: (type, instance) => type === "vec3",
        },
        colorLow: {
            default: {type: "color", default: "#01ff00", title: "Color Low: "},
            accepts: (type, instance) => type === "vec3"
        },
        threshold: {
            default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
            accepts: (type, instance) => type === "float"
        },
    };

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('tile_texture_coords', 0, true)};
    if (!close(chan, .5)) {
        if (chan < .5) {
            chan = ${this.filter(`1.0 - chan * 2.0`)};
            if (chan > ${this.threshold.sample('chan', 'float')}) {
               return vec4(${this.colorLow.sample('chan', 'float')}, chan);
            }
            return vec4(.0);
        } 
        
        chan = ${this.filter(`(chan - 0.5) * 2.0`)};
        if (chan > ${this.threshold.sample('chan', 'float')}) {
            return vec4(${this.colorHigh.sample('chan', 'float')}, chan);
        }
        return vec4(.0);     
    }  
`;
    }

    textureChannelSamplingAccepts(count) {
        return count === 1;
    }

    htmlControls() {
        return [
            this.colorHigh.toHtml(true),
            this.colorLow.toHtml(true),
            this.opacity.toHtml(true),
            this.threshold.toHtml(true)
        ].join("");
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.BipolarHeatmapLayer);
