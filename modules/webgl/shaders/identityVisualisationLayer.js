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
        return this.render(this.sample("tile_texture_coords"));
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
