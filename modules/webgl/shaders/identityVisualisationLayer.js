/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
WebGLModule.IdentityLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    static description() {
        return "shows the data AS-IS";
    }

    getFragmentShaderExecution() {
        //return `return vec4(vec3(${this.sampleChannel("tile_texture_coords")}), 1.0);`;
        return `return ${this.sample("tile_texture_coords")};`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
