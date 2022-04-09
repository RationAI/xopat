/**
 * Code shader
 *
 * todo allow shader inspection by showing the rendered thing
 */
WebGLModule.CodingLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "code";
    }

    static name() {
        return "GLSL Code";
    }

    static description() {
        return "use GLSL to display anything you want";
    }

    static defaultControls = {
        fs_define: {
            default: {type: 'text_area', title: false,
                placeholder: "Input GLSL that is not executed: define functions/globals.",
                default: this._getDefaultFSDefine()},
            accepts: (type, instance) => type === "text"
        },
        fs_execute: {
            default: {type: 'text_area', title: false, placeholder: "Input GLSL into main() - executed.", default: "\n//no output\nreturn vec4(0);"},
            accepts: (type, instance) => type === "text"
        },
        hints: {
            default: {type: "bool", default: true, title: "Show hints"},
            accepts: (type, instance) => type === "bool"
        },
        submit : {
            default: {type: "button", title: "Render"},
            accepts:  (type, instance) => type === "action"
        }
    };

    constructor(id, options) {
        super(id, options);
    }

    getFragmentShaderDefinition() {
        //todo fix this, not really reading the value from the control
        return `
${this._getUpdatedDefineHints()}

vec4 render_${this.uid}() {
    ${this._getUpdatedExecHints()}
}
`;
    }

    getFragmentShaderExecution() {
        return `
    ${this.render(`render_${this.uid}()`)}
        `;
    }

    glDrawing(program, dimension, gl) {
        //maybe the controls need to call it, default ones don't
        //todo fix type and remove this
        this.fs_define.glDrawing(program, dimension, gl);
        this.fs_execute.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        //maybe the controls need to call it, default ones don't
        //todo fix type and remove this
        this.fs_define.glLoaded(program, gl);
        this.fs_execute.glLoaded(program, gl);
    }

    static _getDefaultFSDefine() {
        return `// note that these have no unique name - commended out so that no collision occurs if multiple layers of code loaded
/*float myValue = 0.3;
vec3 myFunction(in int param1, out float param2, inout bool param3) {
    param2 = float(param1); //retype param1 into param 2
    param3 = !param3; //invert param3
    return vec4(1.0).rgg; //return vec3 channels r and twice g of vec4 (swizzling) 
}*/`;
    }

    _getDefaultFSExecute() {
        let textures = [];
        for (let i = 0; i < this.texturesCount; i++) {
            textures.push(this.sample('tile_texture_coords', i, true))
        }
        return `/*Some hints:
--- how do I sample texture? which textures are available?
(note this might not work across different machines)
${textures.join("\n")};

--- what filters are requested on this layer? (note: value used is 0.123456
and the filters -if any- are applied on that number)
float filtered = ${this.filter("0.123456")}; 
*/`;
    }

    _getUpdatedDefineHints() {
        let defined = this.loadProperty("fs_define", "");
        if (!defined) return this.showHints ? this.constructor._getDefaultFSDefine() : "";

        if (defined.match(WebGLModule.CodingLayer._commentsRegex)) {
            return defined.replace(WebGLModule.CodingLayer._commentsRegex, this.showHints ? this.constructor._getDefaultFSDefine() : "");
        }
        return (this.showHints ? this.constructor._getDefaultFSDefine() : "") + defined;
    }

    _getUpdatedExecHints() {
        let defined = this.loadProperty("fs_execute", "");
        if (!defined) return (this.showHints ? this._getDefaultFSExecute() : "") + "\nreturn vec4(.0);";

        if (defined.match(WebGLModule.CodingLayer._commentsRegex)) {
            return defined.replace(WebGLModule.CodingLayer._commentsRegex, this.showHints ? this._getDefaultFSExecute() : "");
        }
        return (this.showHints ? this._getDefaultFSExecute() : "") + defined;
    }

    init() {
        const _this = this;
        this.hints.init();
        this.hints.on('hints', function (raw, encoded, ctx)  {
            _this.showHints = raw === 1;
            _this.storeProperty("fs_execute", _this._getUpdatedExecHints());
            _this.storeProperty("fs_define", _this._getUpdatedDefineHints());
            _this.fs_execute.init();
            _this.fs_define.init();
        });
        this.showHints = this.hints.raw === 1;

        this.storeProperty("fs_define", this._getUpdatedDefineHints());
        this.fs_define.init();
        this.storeProperty("fs_execute", this._getUpdatedExecHints());
        this.fs_execute.init();
        this.submit.init();
        this.submit.on('submit', function (raw, encoded, ctx)  {
            _this.build_shaders();
            _this.invalidate();
        });
    }

    htmlControls() {
        return [
            '<span class="blob-code"><span class="blob-code-inner pl-0">//here you can define GLSL</span></span>',
            this.fs_define.toHtml(false, "font-family: ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace;height: 170px;"),
            '<span class="blob-code"><span class="blob-code-inner pl-0">vec4 render() {</span></span>',
            this.fs_execute.toHtml(false, "font-family: ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace;margin-left:5px;display: block; height: 170px;"),
            '<span class="blob-code"><span class="blob-code-inner pl-0">}</span></span><br>',
            this.hints.toHtml(false),
            this.submit.toHtml()
        ].join("");
    }

    //escaped: \/\*[^*]*\*+(?:[^\/*][^*]*\*+)*\/
    static _commentsRegex = new RegExp('/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*/');
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.CodingLayer);
