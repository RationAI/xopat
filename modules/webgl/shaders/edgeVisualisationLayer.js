/**
 * Edges shader
 * data reference must contain one index to the data to render using edges strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - for more details, see @WebGLModule.UIControls color UI type
 *  edgeThickness - for more details, see @WebGLModule.UIControls number UI type
 *  threshold - for more details, see @WebGLModule.UIControls number UI type
 *  opacity - for more details, see @WebGLModule.UIControls number UI type
 */
WebGLModule.EdgeLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "edge";
    }

    static name() {
        return "Edges";
    }

    static description() {
        return "highlights edges at threshold values";
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
        edgeThickness: {
            default: {type: "range", default: 1, min: 0.5, max: 3, step: 0.1, title: "Edge thickness: "},
            accepts: (type, instance) => type === "float"
        },
    };

    textureChannelSamplingAccepts(count) {
        return count === 1;
    }

    getFragmentShaderDefinition() {
        //here we override so we should call super method to include our uniforms
        return `
${super.getFragmentShaderDefinition()}

//todo try replace with step function
float clipToThresholdf_${this.uid}(float value) {
    //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > ${this.threshold.sample('value', 'float')} || close(value, ${this.threshold.sample('value', 'float')}))) return 1.0;
    return 0.0;
}

//todo try replace with step function
int clipToThresholdi_${this.uid}(float value) {
     //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > ${this.threshold.sample('value', 'float')} || close(value, ${this.threshold.sample('value', 'float')}))) return 1;
    return 0;
}`;
    }

    getFragmentShaderExecution() {
        return `
    float mid = ${this.sampleChannel('tile_texture_coords')};
    if (mid < 1e-6) return vec4(.0);
    float dist = ${this.edgeThickness.sample('mid', 'float')} * sqrt(zoom_level) * 0.005 + 0.008;
    
    float u = ${this.sampleChannel('vec2(tile_texture_coords.x - dist, tile_texture_coords.y)')};
    float b = ${this.sampleChannel('vec2(tile_texture_coords.x + dist, tile_texture_coords.y)')}; 
    float l = ${this.sampleChannel('vec2(tile_texture_coords.x, tile_texture_coords.y - dist)')}; 
    float r = ${this.sampleChannel('vec2(tile_texture_coords.x, tile_texture_coords.y + dist)')};

    float u2 = ${this.sampleChannel('vec2(tile_texture_coords.x - 3.0*dist, tile_texture_coords.y)')};
    float b2 = ${this.sampleChannel('vec2(tile_texture_coords.x + 3.0*dist, tile_texture_coords.y)')}; 
    float l2 = ${this.sampleChannel('vec2(tile_texture_coords.x, tile_texture_coords.y - 3.0*dist)')}; 
    float r2 =  ${this.sampleChannel('vec2(tile_texture_coords.x, tile_texture_coords.y + 3.0*dist)')};

    float mid2 = clipToThresholdf_${this.uid}(mid);  
    float dx = min(clipToThresholdf_${this.uid}(u2) - mid2, clipToThresholdf_${this.uid}(b2) - mid2);
    float dy = min(clipToThresholdf_${this.uid}(l2) - mid2, clipToThresholdf_${this.uid}(r2) - mid2);
    int counter = clipToThresholdi_${this.uid}(u) + 
                clipToThresholdi_${this.uid}(b) + 
                clipToThresholdi_${this.uid}(l) + 
                clipToThresholdi_${this.uid}(r);
    
    if(counter == 2 || counter == 3) {  //two or three points hit the region
        return vec4(${this.color.sample()}, 1.0); //border
    } else if ((dx < -0.5 || dy < -0.5)) {
        return vec4(${this.color.sample()} * 0.7, .7); //inner border
    } 
    return vec4(.0);
`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.EdgeLayer);
