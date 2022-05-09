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
            accepts: (type, instance) => type === "vec3"
        },
        colorLow: {
            default: {type: "color", default: "#01ff00", title: "Color Low: "},
            accepts: (type, instance) => type === "vec3"
        },
        threshold: {
            default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
            accepts: (type, instance) => type === "float"
        },
        opacity: {
            default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
            accepts: (type, instance) => type === "float"
        }
    };

    getFragmentShaderExecution() {
        let varname = `data_${this.uid}`;
        return `
    float ${varname} = ${this.sampleChannel('tile_texture_coords', 0, true)};
    if (!close(${varname}, .5)) {
        if (${varname} < .5) { 
            ${varname} = ${this.filter(`1.0 - ${varname} * 2.0`)};
            if (${varname} > ${this.threshold.sample(varname, 'float')}) {
                ${this.render(`vec4( ${this.colorLow.sample(varname, 'float')}, ${varname} * ${this.opacity.sample(varname, 'float')})`)}
            } else ${this.render(`vec4(.0)`)}
        } else {  
            ${varname} = ${this.filter(`(${varname} - 0.5) * 2.0`)};
            if (${varname} > ${this.threshold.sample(varname, 'float')}) {
                ${this.render(`vec4( ${this.colorHigh.sample(varname, 'float')}, ${varname} * ${this.opacity.sample(varname, 'float')})`)}
            } else ${this.render(`vec4(.0)`)}
        }
    }  
`;
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
