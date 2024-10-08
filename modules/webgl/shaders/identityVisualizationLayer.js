/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
WebGLModule.IdentityLayer = class extends WebGLModule.VisualizationLayer {

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    static description() {
        return "shows the data AS-IS";
    }

    static defaultControls = {
        use_channel0: {
            required: "rgba"
        }
    };

    static sources() {
        return [{
            acceptsChannelCount: (x) => x===4,
            description: "4d texture to render AS-IS"
        }];
    }

    getFragmentShaderExecution() {
        return `return ${this.sampleChannel("tile_texture_coords")};`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
