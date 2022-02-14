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

    constructor(id, options) {
        super(id, options);
    }

    getFragmentShaderExecution() {
        return `
        show(${this.sample('tile_texture_coords')});
`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
