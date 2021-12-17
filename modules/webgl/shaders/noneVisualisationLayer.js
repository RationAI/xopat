/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
WebGLModule.NoneLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "none";
    }

    static name() {
        return "None";
    }

    constructor(options) {
        super(options);
    }

    getFragmentShaderExecution() {
        return "";
    }
}

WebGLModule.ShaderMediator.registerLayer(WebGLModule.NoneLayer);
