/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
WebGLWrapper.IdentityLayer = class extends WebGLWrapper.VisualisationLayer {

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    constructor(options) {
        super(options);
    }

    getFragmentShaderExecution() {
        return `
        show(${this.sample('tile_texture_coords')});
`;
    }
}

WebGLWrapper.ShaderMediator.registerLayer(WebGLWrapper.IdentityLayer);
