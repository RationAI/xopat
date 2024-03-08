/**
 * Modular behaviour of the WebGL plugin.
 * provide your OWN rendering behaviour using a GPU.
 *
 * @typedef {{glContext: function, webGLImplementation: function}} GlContextMaker
 * @class WebGLModule.GlContextFactory
 */
WebGLModule.GlContextFactory = class {

    static _GL_MAKERS = {
        "1.0" : {
            glContext: function(canvas) {
                return canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function(wrapper, glContext) {
                return new WebGLModule.WebGL_1_0(wrapper, glContext);
            }
        },
        "2.0" : {
            glContext: function(canvas) {
                return canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function(wrapper, glContext) {
                return new WebGLModule.WebGL_2_0(wrapper, glContext);
            }
        }
    };

    /**
     * Register custom WebGL renderers
     * @param {string} version version to register (can override)
     * @param {GlContextMaker} maker maker object
     * @param {function} maker.glContext returns WebGL context
     * @param {function} maker.webGLImplementation returns class extending WebGLImplementation
     */
    static register(version, maker) {
        if (!maker.hasOwnProperty("glContext")) {
            console.error("Registered context maker must create webgl context from a canvas using glContext()!");
            return;
        }
        if (!maker.hasOwnProperty("webGLImplementation")) {
            console.error("Registered context maker must create webgl context visualisation using webGLImplementation()!");
            return;
        }
        WebGLModule.GlContextFactory._GL_MAKERS[version] = maker;
    }

    /**
     * Create WebGL context and corresponding implementation (State pattern & Factory method)
     * @param {WebGLModule} wrapper
     * @param {string} versions considered versions in the preferred order
     *      currently supported "1.0", "2.0"
     * @throws Error
     */
    static init(wrapper, ...versions) {
        if (versions.length < 1) {
            throw "Invalid WebGL context initialization: no version specified!";
        }
        const canvas = document.createElement('canvas');

        for (let version of versions) {
            if (!WebGLModule.GlContextFactory._GL_MAKERS.hasOwnProperty(version)) {
                console.warn("WebGL context initialization: unsupported version. Skipping.", version);
                continue;
            }
            if (this._makerInit(canvas, WebGLModule.GlContextFactory._GL_MAKERS[version], wrapper)) {
                return;
            }
        }
        throw "No context available for GlContextFactory to init. Make sure your browser supports WebGL. The engine might also be busy being used by some other application.";
    }

    static _makerInit(canvas, maker, wrapper) {
        let gl = maker.glContext(canvas);
        if (gl) {
            wrapper.gl = gl;
            wrapper.webGLImplementation = maker.webGLImplementation(wrapper, gl);
            return true;
        }
        return false;
    }
};

/**
 * @interface WebGLModule.WebGLImplementation
 * Interface for the visualisation rendering implementation which can run
 * on various GLSL versions
 */
WebGLModule.WebGLImplementation = class {

    constructor() {
        //Set default blending to be MASK
        this.glslBlendCode = "return background * (step(0.001, foreground.a));";
    }

    /**
     * @return {string} WebGL version used
     */
    getVersion() {
        console.error("::getVersion() must be implemented!");
    }

    /**
     * Get GLSL texture sampling code
     * @param {string} order order number in the shader, available in vis.shaders[id].index
     * @param {string} textureCoords string representing GLSL code of valid texture coordinates
     *  e.g. 'tex_coords' or 'vec2(1.0, 0.0)'
     * @return {string} GLSL code that is correct in texture sampling wrt. WebGL version used
     */
    getTextureSamplingCode(order, textureCoords) {
        console.error("::getTextureSamplingCode() must be implemented!");
    }

    /**
     * Get GLSL texture XY dimension
     * @param {string} order order number in the shader, available in vis.shaders[id].index
     * @return {string} vec2
     */
    getTextureDimensionXY(order) {
        console.error("::getTextureDimensionXY() must be implemented!");
    }

    /**
     * Create a visualisation from the given JSON params
     * @param {string[]} order keys of visualisation.shader in which order to build the visualization
     *   the order: painter's algorithm: the last drawn is the most visible
     * @param {object} visualisation
     * @param {boolean} withHtml whether html should be also created (false if no UI controls are desired)
     * @return {object}
         {string} object.vertex_shader vertex shader code
         {string} object.fragment_shader fragment shader code
         {string} object.html html for the UI
         {number} object.usableShaders how many layers are going to be visualised
         {(array|string[])} object.dataUrls ID's of data in use (keys of visualisation.shaders object) in desired order
                    the data is guaranteed to arrive in this order (images stacked below each other in imageElement)
     */
    generateVisualisation(order, visualisation, withHtml) {
        console.error("::generateVisualisation() must be implemented!");
    }

    /**
     * Called once program is switched to: initialize all necessary items
     * @param {WebGLProgram} program  used program
     * @param {Visualization} currentVisualisation  JSON parameters used for this visualisation
     */
    toBuffers(program, currentVisualisation) {
        console.error("::toBuffers() must be implemented!");
    }

    /**
     * Draw on the canvas using given program
     * @param {WebGLProgram} program  used program
     * @param {WebGLModule.VisualizationConfig} currentVisualisation  JSON parameters used for this visualisation
     * @param {object} imageElement image data
     * @param {object} tileDimension
     * @param {number} tileDimension.width width of the result
     * @param {number} tileDimension.height height of the result
     * @param {number} zoomLevel arbitrary number 1 (this is not very clean design, pass object load properties of?)
     *   used to pass OSD zoom level value
     * @param {number} pixelSize arbitrary number 2 (this is not very clean design, pass object load properties of?)
     *   used to pass ratio of how many screen pixels a fragment spans on
     */
    toCanvas(program, currentVisualisation, imageElement, tileDimension, zoomLevel, pixelSize) {
        console.error("::toCanvas() must be implemented!");
    }

    /**
     * Code to be included only once, required by given shader type (keys are considered global)
     * @param {string} type shader type
     * @returns {object} global-scope code used by the shader in <key: code> format
     */
    globalCodeRequiredByShaderType(type) {
        return WebGLModule.ShaderMediator.getClass(type).__globalIncludes;
    }

    /**
     * Blend equation sent from the outside, must be respected
     * @param glslCode code for blending, using two variables: 'foreground', 'background'
     * @example
     * //The shader context must define the following:
     *
     * vec4 some_blending_name_etc(in vec4 background, in vec4 foreground) {
     *     // << glslCode >>
     * }
     *
     * void blend_clip(vec4 input) {
     *     //for details on clipping mask approach see show() below
     *     // <<use some_blending_name_etc() to blend input onto output color of the shader using a clipping mask>>
     * }
     *
     * void blend(vec4 input) { //must be called blend, API
     *     // <<use some_blending_name_etc() to blend input onto output color of the shader>>
     * }
     *
     * //Also, default alpha blending equation 'show' must be implemented:
     * void show(vec4 color) {
     *    //pseudocode
     *    //note that the blending output should not immediatelly work with 'color' but perform caching of the color,
     *    //render the color given in previous call and at the execution end of main call show(vec4(.0))
     *    //this way, the previous color is not yet blended for the next layer show/blend/blend_clip which can use it to create a clipping mask
     *
     *    compute t = color.a + background.a - color.a*background.a;
     *    output vec4((color.rgb * color.a + background.rgb * background.a - background.rgb * (background.a * color.a)) / t, t)
     * }
     */
    setBlendEquation(glslCode) {
        this.glslBlendCode = glslCode;
    }
};

WebGLModule.WebGL_1_0 = class extends WebGLModule.WebGLImplementation {

    constructor(context, gl) {
        super();
        this.context = context;
        this.gl = gl;
        this.max_textures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);

        this.wrap = gl.MIRRORED_REPEAT;
        this.tile_pos = 'a_tile_pos';
        this.filter = gl.NEAREST;
        this.pos = 'a_pos';

        this.texture = new WebGLModule.DataLoader.V1_0(gl);
    }

    getVersion() {
        return "1.0";
    }

    getTextureDimensionXY(dataIndex) {
        return this.texture.measure(dataIndex);
    }

    getTextureSamplingCode(dataIndex, textureCoords) {
        return this.texture.sample(dataIndex, textureCoords);
    }

    generateVisualisation(order, visualisation, withHtml) {
        let definition = "", execution = "", html = "",
            _this = this, usableShaders = 0, simultaneouslyVisible = 0, globalScopeCode = {};

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.type == "none") {
                //prevents the layer from being accounted for
                layer.error = "Not an error - layer type none.";
            } else if (layer.error) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);
            } else if (layer._renderContext) {
                let visible = false;
                usableShaders++;

                if (layer.visible == 1 && simultaneouslyVisible < _this.max_textures && layer.hasOwnProperty("_renderContext") && layer.hasOwnProperty("_index")) {
                    let renderCtx = layer._renderContext;
                    definition += renderCtx.getFragmentShaderDefinition() + `
vec4 lid_${layer._index}_xo() {
    ${renderCtx.getFragmentShaderExecution()}
}`;
                    if (renderCtx.opacity) {
                        execution += `
    vec4 l${layer._index}_out = lid_${layer._index}_xo();
    l${layer._index}_out.a *= ${renderCtx.opacity.sample()};
    deferred_blend = ${renderCtx.__mode}(l${layer._index}_out, deferred_blend);`;
                    } else {
                        execution += `
    deferred_blend = ${renderCtx.__mode}(lid_${layer._index}_xo(), deferred_blend);`;
                    }
                    visible = true;
                    layer.rendering = true;
                    simultaneouslyVisible++;
                    $.extend(globalScopeCode, _this.globalCodeRequiredByShaderType(layer.type))
                }

                //reverse order append to show first the last drawn element (top)
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer["name"],
                    layer._renderContext.htmlControls(), dataId, visible, layer, true) + html;
            } else {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer["name"],
                    `The requested visualisation type does not work properly.`, dataId, false, layer, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", layer);
            }
        });

        /**
         * Implementation of active-only data subset not enabled, because underlying system cannot easily manage cache miss
         */
        //must preserve the definition order
        // let urls = [];
        // for (let key in visualisation.shaders) {
        //     if (visualisation.shaders.hasOwnProperty(key)) {
        //         let layer = visualisation.shaders[key];
        //
        //         // if (layer.hasOwnProperty("target")) {
        //         //     if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
        //         //         console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
        //         //     } else if (visualisation.shaders[target].rendering) {
        //         //         urls.push(key);
        //         //     }
        //         // } else
        //
        //         //to-do once we start to reflect only decessary data to donwload, not all...
        //         // if (layer.rendering) {
        //         //     urls.push(key);
        //         // }
        //         urls.push(key);
        //     }
        // }
        // this.texture.renderOrder = urls;

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution,
                this.context._dataSourceMapping, globalScopeCode),
            definition: definition,
            execution: execution,
            html: html,
            usableShaders: usableShaders,
            dataUrls: this.context._dataSources
        };
    }

    getFragmentShader(definition, execution, indicesOfImages, globalScopeCode) {
        return `
precision mediump float;
uniform float pixel_size_in_fragments;
uniform float zoom_level;
${this.texture.declare(indicesOfImages)}
varying vec2 tile_texture_coords;

bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

vec4 show(vec4 color, vec4 deferred) {
    vec4 fg = deferred;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    gl_FragColor = (pre_fg + gl_FragColor * (1.0-fg.a));
    return color;
}

vec4 blend_equation(in vec4 foreground, in vec4 background) {
${this.glslBlendCode}
}

vec4 blend_clip(vec4 foreground, vec4 deferred) {
    return blend_equation(foreground, deferred);
}

vec4 blend(vec4 foreground, vec4 deferred) {
    vec4 current_deferred = show(foreground, deferred);
    gl_FragColor = blend_equation(current_deferred, gl_FragColor);
    return vec4(.0);
}

void finalize(vec4 deferred) {
    show(vec4(.0), deferred);
    
    if (close(gl_FragColor.a, 0.0)) {
        gl_FragColor = vec4(0.);
    } else {
        gl_FragColor = vec4(gl_FragColor.rgb/gl_FragColor.a, gl_FragColor.a);
    }
}

${Object.values(globalScopeCode).join("\n")}

${definition}

void main() {
    vec4 deferred_blend = vec4(0.);

    ${execution}
    
    finalize(deferred_blend);
}
`;
    }

    getVertexShader() {
        return `
attribute vec4 a_pos;
attribute vec2 a_tile_pos;
varying vec2 tile_texture_coords;

void main() {
    tile_texture_coords = a_tile_pos;
    gl_Position = a_pos;
}
`;
    }

    toBuffers(program, currentVisualisation) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;

        // Allow for custom loading
        gl.useProgram(program);
        context.visualisationInUse(currentVisualisation);
        context['gl_loaded'].call(context, gl, program, currentVisualisation);

        // Unchangeable square array buffer fills viewport with texture
        var boxes = [[-1, 1, -1, -1, 1, 1, 1, -1], [0, 1, 0, 0, 1, 1, 1, 0]];
        var buffer = new Float32Array([].concat.apply([], boxes));
        var bytes = buffer.BYTES_PER_ELEMENT;
        var count = 4;

        // Get attribute terms
        this._att = [this.pos, this.tile_pos].map(function(name, number) {
            var index = Math.min(number, boxes.length - 1);
            var vec = Math.floor(boxes[index].length / count);
            var vertex = gl.getAttribLocation(program, name);
            return [vertex, vec, gl.FLOAT, 0, vec * bytes, count * index * vec * bytes];
        });

        this.texture.toBuffers(this.context, gl, program, this.wrap, this.filter, currentVisualisation);

        this._drawArrays = [gl.TRIANGLE_STRIP, 0, count];

        // Build the position and texture buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    }

    toCanvas(program, currentVisualisation, imageElement, tileDimension, zoomLevel, pixelSize) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;

        context['gl_drawing'].call(context, gl, program, currentVisualisation, tileDimension);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Set Attributes for GLSL
        this._att.map(function(x) {
            gl.enableVertexAttribArray(x.slice(0, 1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), pixelSize);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), zoomLevel);

        // Upload textures
        this.texture.toCanvas(context, context._dataSourceMapping,
            currentVisualisation, imageElement, tileDimension, program, context.gl);

        gl.drawArrays.apply(gl, this._drawArrays);

        this.texture.toCanvasFinish(context, context._dataSourceMapping, currentVisualisation,
            imageElement, tileDimension, program, gl);
        return gl.canvas;
    }
};


WebGLModule.WebGL_2_0 = class extends WebGLModule.WebGLImplementation {
    constructor(context, gl) {
        super();
        this.context = context;
        this.gl = gl;
        this.wrap = gl.MIRRORED_REPEAT;
        this.filter = gl.NEAREST;
        this.emptyBuffer = gl.createBuffer();
        this.texture = new WebGLModule.DataLoader.V2_0(gl, "vis_data_sampler_array");
    }

    getVersion() {
        return "2.0";
    }

    generateVisualisation(order, visualisation, withHtml) {
        var definition = "", execution = "", html = "", _this = this, usableShaders = 0, globalScopeCode = {};

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.type == "none") {
                //prevents the layer from being accounted for
                layer.error = "Not an error - layer type none.";
            } else if (layer.error) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);

            } else if (layer._renderContext && layer.hasOwnProperty("_index")) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set
                if (layer.visible == 1) {
                    let renderCtx = layer._renderContext;
                    definition += renderCtx.getFragmentShaderDefinition() + `
vec4 lid_${layer._index}_xo() {
    ${renderCtx.getFragmentShaderExecution()}
}`;
                    if (renderCtx.opacity) {
                        execution += `
    vec4 l${layer._index}_out = lid_${layer._index}_xo();
    l${layer._index}_out.a *= ${renderCtx.opacity.sample()};
    deferred_blend = ${renderCtx.__mode}(l${layer._index}_out, deferred_blend);`;
                    } else {
                        execution += `
    deferred_blend = ${renderCtx.__mode}(lid_${layer._index}_xo(), deferred_blend);`;
                    }

                    layer.rendering = true;
                    visible = true;
                    $.extend(globalScopeCode, _this.globalCodeRequiredByShaderType(layer.type))
                }

                //reverse order append to show first the last drawn element (top)
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name,
                    layer._renderContext.htmlControls(), dataId, visible, layer, true) + html;
            } else {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name,
                    `The requested visualisation type does not work properly.`, dataId, false, layer, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", layer);
            }
        });

        /**
         * Implementation of active-only data subset not enabled, because underlying system cannot easily manage cache miss
         */
        //must preserve the definition order
        // let urls = [], indicesMapping = new Array(usableShaders).fill(0);
        // for (let key in visualisation.shaders) {
        //     if (visualisation.shaders.hasOwnProperty(key)) {
        //         let layer = visualisation.shaders[key];
        //
        //         // if (layer.hasOwnProperty("target")) {
        //         //     if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
        //         //         console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
        //         //     } else if (visualisation.shaders[target].rendering) {
        //         //         urls.push(key);
        //         //     }
        //         // } else
        //
        //         if (!layer.hasOwnProperty("order")) continue;
        //
        //         //to-do enable once we really DOWNLOAD only necessary stuff, otherwise this mapping is invalid
        //         // if (layer.rendering) {
        //         //     urls.push(key);
        //         //     indicesMapping[layer._index] = urls.length-1;
        //         // }
        //
        //         urls.push(key);
        //         indicesMapping[layer._index] = urls.length-1;
        //     }
        // }

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution, this.context._dataSourceMapping, globalScopeCode),
            html: html,
            usableShaders: usableShaders,
            dataUrls: this.context._dataSources
        };
    }

    getTextureDimensionXY(dataIndex) {
        return this.texture.measure(dataIndex);
    }

    getTextureSamplingCode(dataIndex, textureCoords) {
        return this.texture.sample(dataIndex, textureCoords);
    }

    getFragmentShader(definition, execution, indicesOfImages, globalScopeCode) {
        return `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

${this.texture.declare(indicesOfImages)}
uniform float pixel_size_in_fragments;
uniform float zoom_level;
uniform vec2 u_tile_size;

in vec2 tile_texture_coords;
        
out vec4 final_color;
        
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}
        
vec4 show(vec4 color, vec4 deferred) {
    //premultiplied alpha blending
    vec4 fg = deferred;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    final_color = (pre_fg + final_color * (1.0-fg.a));
    return color;
}

void finalize(vec4 deferred) {
    show(vec4(.0), deferred);
    
    if (close(final_color.a, 0.0)) {
        final_color = vec4(0.);
    } else {
        final_color = vec4(final_color.rgb/final_color.a, final_color.a);
    }
}    

vec4 blend_equation(in vec4 foreground, in vec4 background) {
${this.glslBlendCode}
}

vec4 blend_clip(vec4 foreground, vec4 deferred) {
    return blend_equation(foreground, deferred);
}

vec4 blend(vec4 foreground, vec4 deferred) {
    vec4 current_deferred = show(foreground, deferred);
    final_color =blend_equation(current_deferred, final_color);
    return vec4(.0);
}

${Object.values(globalScopeCode).join("\n")}
        
${definition}
        
void main() {
    vec4 deferred_blend = vec4(0.);
        
    ${execution}
    
    finalize(deferred_blend);
}`;
    }

    getVertexShader() {
        //UNPACK_FLIP_Y_WEBGL not supported with 3D textures so sample bottom up
        return `#version 300 es
out vec2 tile_texture_coords;
const vec2 tex_coords[3] = vec2[3] (
    vec2(0.0, 0.0),
    vec2(2.0, 0.0),
    vec2(0.0, 2.0)
);
            
void main() {
    vec2 tex_coord = tex_coords[gl_VertexID];
    gl_Position = vec4(tex_coord * 2.0 - 1.0, 0.0, 1.0);
    tex_coord.y = 1.0 - tex_coord.y;
    tile_texture_coords = tex_coord;
}
`;
    }

    toBuffers(program, currentVisualisation) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;

        // Allow for custom loading
        gl.useProgram(program);
        context.visualisationInUse(currentVisualisation);
        context['gl_loaded'].call(context, gl, program, currentVisualisation);

        //Note that the drawing strategy is not to resize canvas, and simply draw everyhing on squares
        this.texture.toBuffers(context, gl, program, this.wrap, this.filter, currentVisualisation);

        //Empty ARRAY: get the vertices directly from the shader
        gl.bindBuffer(gl.ARRAY_BUFFER, this.emptyBuffer);
    }

    toCanvas(program, currentVisualisation, imageElement, tileDimension, zoomLevel, pixelSize) {
        if (!this.context.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        let context = this.context,
            gl = this.gl;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        context['gl_drawing'].call(context, gl, program, currentVisualisation, tileDimension);

        // Set Attributes for GLSL
        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), pixelSize);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), zoomLevel);

        // Upload textures
        this.texture.toCanvas(context, context._dataSourceMapping, currentVisualisation,
            imageElement, tileDimension, program, gl);

        // Draw three points (obtained from gl_VertexID from a static array in vertex shader)
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        this.texture.toCanvasFinish(context, context._dataSourceMapping, currentVisualisation,
            imageElement, tileDimension, program, gl);
        return gl.canvas;
    }
};

/*Not yet a part of API, todo functionality to process polygons**/
// WebGLModule.RasterizerContext = class {
//     constructor(context, gl) {
//         this.context = context;
//         this.gl = gl;
//     }
//
//     toBuffers(program) {
//         if (!this.context.running) return;
//
//         let context = this.context,
//             gl = this.gl;
//
//         gl.useProgram(program);
//
//         // Vertices
//         this.positionBuffer = gl.createBuffer();
//         gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
//
//         // Indices
//         this.indexBuffer = gl.createBuffer();
//         gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
//
//
//         this.positionLocation = gl.getAttribLocation(program, "vertex");
//
//         gl.enableVertexAttribArray(this.positionLocation);
//         gl.vertexAttribPointer(
//             this.positionLocation, 2, gl.FLOAT, false, 0, 0);
//
//         this.resolutionLocation = gl.getUniformLocation(program, "resolution");
//         this.colorPosition = gl.getUniformLocation(program, "color");
//     }
//
//     vs() {
//         return `
// attribute vec2 vertex;
// uniform vec2 resolution;
//
// void main() {
//    vec2 zeroToOne = vertex / resolution;
//    // convert from 0->1 to 0->2
//    vec2 zeroToTwo = zeroToOne * 2.0;
//    // convert from 0->2 to -1->+1 (clipspace)
//    vec2 clipSpace = zeroToTwo - 1.0;
//    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
// }
//
//         `;
//     }
//
//     fs() {
//         return `
// precision mediump float;
// uniform vec4 color;
// void main() {
//    gl_FragColor = color;
// }
//         `;
//     }
//
//     toCanvas(program, vertices, color, indices) {
//         if (!this.context.running) return;
//         // Allow for custom drawing in webGL and possibly avoid using webGL at all
//
//         let context = this.context,
//             gl = this.gl;
//
//         gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
//         gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
//         gl.uniform4fv(this.colorPosition, color);
//
//         gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
//         return gl.canvas;
//     }
// };

