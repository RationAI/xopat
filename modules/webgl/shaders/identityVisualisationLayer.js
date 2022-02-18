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

        this.kernel = WebGLModule.UIControls.build(this, "kernel", options.kernel,
            {type: 'kernel'}, (type, cls) => type === "float");
    }

    getFragmentShaderDefinition() {
        return this.kernel.define();
    }

    getFragmentShaderExecution() {
//         return `
//     ${this.render("vec4("+ this.kernel.sample() + ")")}
// `;
        return this.render(this.sample("tile_texture_coords"));
    }


    // glDrawing(program, dimension, gl) {
    //     this.kernel.glDrawing(program, dimension, gl);
    // }
    //
    // glLoaded(program, gl) {
    //     this.kernel.glLoaded(program, gl);
    // }
    //
    // init() {
    //     this.kernel.init();
    // }
    //
    // htmlControls() {
    //     this.kernel.toHtml();
    // }
    //
    // supports() {
    //     return {
    //         kernel: "float",
    //     }
    // }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.IdentityLayer);
