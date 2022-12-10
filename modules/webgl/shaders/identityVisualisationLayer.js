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

    static defaultControls = {
        opacity: {
            default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
            accepts: (type, instance) => type === "float"
        }
    };

    getFragmentShaderExecution() {
        return this.render(`vec4(${this.sample("tile_texture_coords")}.rgb, ${this.opacity.sample()})`);
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
