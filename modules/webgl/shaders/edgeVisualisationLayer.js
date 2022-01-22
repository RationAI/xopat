/**
 * Edges shader
 * data reference must contain one index to the data to render using edges strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - color to fill-in areas with values, url encoded '#ffffff' format or digits only 'ffffff', default "#d2eb00"
 *  ctrlColor - whether to allow color modification, 1 or 0, default 1
 *  ctrlThreshold - whether to allow threshold modification, 1 or 0, default 1
 *  ctrlOpacity - whether to allow opacity modification, 1 or 0, default 1
 *  edgeThickness
 *  ctrlEdgeThickness
 */
WebGLModule.EdgeLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "edge";
    }

    static name() {
        return "Edges";
    }

    constructor(options) {
        super(options);

        if (options.hasOwnProperty("color")) {
            this._color = this.toRGBShaderColorFromString(options["color"], [210/255, 235/255, 0]);
        } else {
            this._color = [210/255, 235/255, 0];
        }
        //default true
        this._allowColorChange = this.isFlagOrMissing(options["ctrlColor"]);
        this._allowThresholdChange = this.isFlagOrMissing(options["ctrlThreshold"]);
        this._allowOpacityChange = this.isFlagOrMissing(options["ctrlOpacity"]);
        this._allowEdgeThicknessChange = this.isFlagOrMissing(options["ctrlEdgeThickness"]);
    }

    getFragmentShaderDefinition() {
        return `
uniform float threshold_${this.uid};
uniform float opacity_${this.uid};
uniform float edge_thickness_${this.uid};
uniform vec3 color_${this.uid};

//todo try replace with step function
float clipToThresholdf_${this.uid}(float value) {
    //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > threshold_${this.uid} || close(value, threshold_${this.uid}))) return 1.0;
    return 0.0;
}

//todo try replace with step function
int clipToThresholdi_${this.uid}(float value) {
     //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > threshold_${this.uid} || close(value, threshold_${this.uid}))) return 1;
    return 0;
}

vec4 getBorder_${this.uid}() {
    float dist = edge_thickness_${this.uid} * sqrt(zoom_level) * 0.005;
    float mid = ${this.sampleChannel('tile_texture_coords')};
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
        return vec4(color_${this.uid}, 1.0); //border
    } else if ((dx < -0.5 || dy < -0.5)) {
        return vec4(color_${this.uid} * 0.7, .7); //inner border
    } 
    return vec4(.0, .0, .0, .0);
}
`;
    }

    getFragmentShaderExecution() {
        return `
    vec4 border_${this.uid} =  getBorder_${this.uid}();
    show(vec4(border_${this.uid}.rgb, border_${this.uid}.a * opacity_${this.uid}));
`;
    }
    
    glDrawing(program, dimension, gl) {
        gl.uniform1f(this.threshold_loc, this.threshold / 100.0);
        gl.uniform1f(this.opacity_loc, this.opacity);
        gl.uniform3fv(this.color_loc, this.color);
        gl.uniform1f(this.thickness_loc, this.edgeThickness);
    }

    glLoaded(program, gl) {
        this.threshold_loc = gl.getUniformLocation(program, `threshold_${this.uid}`);
        this.opacity_loc = gl.getUniformLocation(program, `opacity_${this.uid}`);
        this.color_loc = gl.getUniformLocation(program, `color_${this.uid}`);
        this.thickness_loc = gl.getUniformLocation(program, `edge_thickness_${this.uid}`);
    }

    init() {
        this.twoElementInit("threshold",
            `#threshold-${this.uid}`,
            `#threshold-slider-${this.uid}`,
            1,
            v => Math.max(Math.min(v, 100), 1)
        );

        this.simpleControlInit("edgeThickness",
            `#thickness-${this.uid}`,
            1
        );

        this.simpleControlInit("opacity",
            `#opacity-${this.uid}`,
            1
        );

        let _this = this;
        function colorChange(e) {
            let col = $(e.target).val();
            _this.color = _this.toRGBShaderColorFromString(col, _this._color);
            _this.storeProperty('color', _this.color);
            _this.invalidate();
        }
        let colpicker = $(`#color-${this.uid}`);
        this.color = this.loadProperty('color', this._color);
        colpicker.val("#" + Math.round(this.color[0] * 255).toString(16).padStart(2, "0") + Math.round(this.color[1] * 255).toString(16).padStart(2, "0") +  Math.round(this.color[2] * 255).toString(16).padStart(2, "0"));
        colpicker.change(colorChange);
    }

    htmlControls() {
        let html = "";
        if (this._allowColorChange) {
            html += `<span> Color:</span><input type="color" id="color-${this.uid}" class="form-control input-sm"><br>`;
        }

        if (this._allowEdgeThicknessChange) {
            html += `<span> Edge Thickness:</span><input type="range" id="thickness-${this.uid}" min="0.5" max="3" step="0.1"><br>`;
        }

        if (this._allowOpacityChange) {
            html += `<span> Opacity:</span><input type="range" id="opacity-${this.uid}" min="0" max="1" step="0.1"><br>`;
        }

        if (this._allowThresholdChange) {
            let directionRange = this._invertOpacity ? 'style="direction: rtl"' : "";
            html += `<span> Threshold:</span><input type="range" id="threshold-slider-${this.uid}" 
class="with-direct-input" min="1" max="100" ${directionRange} step="1">
<input class="form-control input-sm" style="max-width:60px;" type="number" id="threshold-${this.uid}"><br>`;
        }
        return html;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.EdgeLayer);
