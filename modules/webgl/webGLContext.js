/**
 * Modular behaviour of the WebGL plugin.
 * provide your OWN rendering behaviour using a GPU.
 */
WebGLModule.GlContextFactory = class {

    static _GL_MAKERS = {
        "1.0" : {
            glContext: function (canvas) {
                return canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function (wrapper, glContext) {
                return new WebGLModule.WebGL_1_0(wrapper, glContext);
            }
        },
        "2.0" : {
            glContext: function (canvas) {
                return canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function (wrapper, glContext) {
                return new WebGLModule.WebGL_2_0(wrapper, glContext);
            }
        }
    };

    /**
     * Register custom WebGL renderers
     * @param version version to register (can override)
     * @param maker maker object
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
     * @param wrapper {WebGLModule}
     * @param versions {string} array of considered versions in the preferred order
     *      currently supported "1.0", "2.0"
     * @throws
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
        throw "No context available for GlContextFactory to init.";
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
 * @interface WebGLImplementation
 * Interface for the visualisation rendering implementation which can run
 * on various GLSL versions
 */
WebGLModule.WebGLImplementation = class {

    /**
     * Set default blending to be MASK
     */
    constructor() {
        this.glslBlendCode = "return background * (1.0 - step(0.001, foreground.a));";
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
     * @param {[string]} order keys of visualisation.shader in which order to build the visualization
     *   the order: painter's algorithm: the last drawn is the most visible
     * @param {object} visualisation
     * @param {boolean} withHtml whether html should be also created (false if no UI controls are desired)
     * @return {object}
         {string} object.vertex_shader vertex shader code
         {string} object.fragment_shader fragment shader code
         {string} object.html html for the UI
         {number} object.usableShaders how many layers are going to be visualised
         {array[string]} object.dataUrls ID's of data in use (keys of visualisation.shaders object) in desired order
                    the data is guaranteed to arrive in this order (images stacked below each other in imageElement)
     */
    generateVisualisation(order, visualisation, withHtml) {
        console.error("::generateVisualisation() must be implemented!");
    }

    /**
     * Called once program is switched to: initialize all necessary items
     * @param program  used program
     * @param currentVisualisation  JSON parameters used for this visualisation
     */
    toBuffers(program, currentVisualisation) {
        console.error("::toBuffers() must be implemented!");
    }

    /**
     * Draw on the canvas using given program
     * @param program  used program
     * @param {object} currentVisualisation  JSON parameters used for this visualisation
     * @param {object} imageElement image data (how do we define the format? todo image convertor class)
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
     * @param type shader type
     * @returns {object} global-scope code used by the shader in <key: code> format
     */
    globalCodeRequiredByShaderType(type) {
        return WebGLModule.ShaderMediator.getClass(type).__globalIncludes;
    }

    /**
     * Blend equation sent from the outside, must be respected
     * @param glslCode code for blending, using two variables: 'foreground', 'background'
     *
     * The shader context must define the following:
     *
     * vec4 some_blending_name_etc(in vec4 background, in vec4 foreground) {
     *     << glslCode >>
     * }
     *
     * void blend(vec4 input) { //must be called blend, API
     *     <<use some_blending_name_etc() to blend input onto output color of the shader>>
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

        this.tile_size = 'u_tile_size';
        this.wrap = gl.MIRRORED_REPEAT;
        this.tile_pos = 'a_tile_pos';
        this.filter = gl.NEAREST;
        this.pos = 'a_pos';

        this.texture = {
            debug: $("#debug"),
            debug2: $("#debug2"),
            _units: [],
            context: context,

            init: function() {
                this.canvas = document.createElement('canvas');
                this.canvasReader = this.canvas.getContext('2d');

                this.canvasConverter = document.createElement('canvas');
                this.canvasConverterReader = this.canvasConverter.getContext('2d');
            },

            toBuffers: function (gl, wrap, filter, visualisation) {
                this.wrap = wrap;
                this.filter = filter;
            },

            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {
                let index = 0;
                tileBounds.width = Math.round(tileBounds.width);
                tileBounds.height = Math.round(tileBounds.height);

                //we read from here
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);

                const NUM_IMAGES = Math.round(image.height / tileBounds.height);
                //Allowed texture size dimension only 256+ and power of two...
                //TODO it worked for arbitrary size until we begun with image arrays... is it necessary?
                const IMAGE_SIZE = image.width < 256 ? 256 : Math.pow(2, Math.ceil(Math.log2(image.width)));
                this.canvasConverter.width = IMAGE_SIZE;
                this.canvasConverter.height = IMAGE_SIZE;

                //just load all images and let shaders reference them...
                for (let i = 0; i < this.context._dataSourceMapping.length; i++) {
                    if (this.context._dataSourceMapping[i] < 0) {
                        continue;
                    }
                    if (index >= NUM_IMAGES) {
                        console.warn("The visualisation contains less data than layers. Skipping layers ...");
                        return;
                    }

                    //create textures
                    while (index >= this._units.length) {
                        this._units.push(gl.createTexture());
                    }
                    let bindConst = `TEXTURE${index}`;
                    gl.activeTexture(gl[bindConst]);
                    let location = gl.getUniformLocation(program, `vis_data_sampler_${i}`);
                    gl.uniform1i(location, index);

                    gl.bindTexture(gl.TEXTURE_2D, this._units[index]);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrap);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrap);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);


                    var pixels;
                    if (tileBounds.width !== IMAGE_SIZE || tileBounds.height !== IMAGE_SIZE)  {
                        this.canvasConverterReader.drawImage(this.canvas, 0, this.context._dataSourceMapping[i]*tileBounds.height,
                            tileBounds.width, tileBounds.height, 0, 0, IMAGE_SIZE, IMAGE_SIZE);

                        pixels = this.canvasConverterReader.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
                    } else {
                        //load data
                        pixels = this.canvasReader.getImageData(0,
                            this.context._dataSourceMapping[i]*tileBounds.height, tileBounds.width, tileBounds.height);
                    }

                    gl.texImage2D(gl.TEXTURE_2D,
                        0,
                        gl.RGBA,
                        gl.RGBA,
                        gl.UNSIGNED_BYTE,
                        pixels);
                    index++;
                }
            }
        };
        this.texture.init();
    }

    getVersion() {
        return "1.0";
    }

    getTextureDimensionXY(dataIndex) {
        return `u_tile_size`; //hope its okay :D
    }

    getTextureSamplingCode(dataIndex, textureCoords) {
        return `texture2D(vis_data_sampler_${dataIndex}, ${textureCoords})`;
    }

    generateVisualisation(order, visualisation, withHtml) {
        var definition = "", execution = "", samplers = "", html = "",
            _this = this, usableShaders = 0, simultaneouslyVisible = 0, globalScopeCode = {};

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.error) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);

            } else if (layer._renderContext) {
                let visible = false;
                usableShaders++;

                if (layer.visible == 1 && simultaneouslyVisible < _this.max_textures && layer.hasOwnProperty("_renderContext") && layer.hasOwnProperty("index")) {
                    definition += layer._renderContext.getFragmentShaderDefinition();
                    execution += layer._renderContext.getFragmentShaderExecution();
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

        //must preserve the definition order
        // let urls = [];
        // for (let key in visualisation.shaders) {
        //     if (visualisation.shaders.hasOwnProperty(key)) {
        //         let layer = visualisation.shaders[key];
        //
        //         //TODO implement?
        //         // if (layer.hasOwnProperty("target")) {
        //         //     if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
        //         //         console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
        //         //     } else if (visualisation.shaders[target].rendering) {
        //         //         urls.push(key);
        //         //     }
        //         // } else
        //
        //         //todo once we start to reflect only decessary data to donwload, not all...
        //         // if (layer.rendering) {
        //         //     urls.push(key);
        //         // }
        //         urls.push(key);
        //     }
        // }
        // this.texture.renderOrder = urls;


        //since we download for now all data, we can just index the sources...
        this.texture.loadOrder = this.context.currentVisualisation();
        for (let i = 0; i < this.context._dataSourceMapping.length; i++) {
            if (this.context._dataSourceMapping[i] === -1) continue;
            samplers += `uniform sampler2D vis_data_sampler_${i};`;
        }

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(samplers, definition, execution, globalScopeCode),
            html: html,
            usableShaders: usableShaders,
            dataUrls: this.context._dataSources
        };
    }

    getFragmentShader(samplers, definition, execution, globalScopeCode) {

        return `
precision mediump float;
uniform float pixel_size_in_fragments;
uniform float zoom_level;
uniform vec2 u_tile_size;

varying vec2 tile_texture_coords;

${samplers}

bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

void show(vec4 color) {
    if (close(color.a, 0.0)) return;
    float t = color.a + gl_FragColor.a - color.a*gl_FragColor.a;
    gl_FragColor = vec4((color.rgb * color.a + gl_FragColor.rgb * gl_FragColor.a - gl_FragColor.rgb * (gl_FragColor.a * color.a)) / t, t);
}

vec4 blend_equation(in vec4 foreground, in vec4 background) {
${this.glslBlendCode}
}

void blend(vec4 foreground) {
    gl_FragColor = blend_equation(foreground, gl_FragColor);
}

${Object.values(globalScopeCode).join("\n")}

${definition}

void main() {
    ${execution}
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

        // Get uniform term
        gl.uniform2f(gl.getUniformLocation(program, this.tile_size), gl.canvas.width, gl.canvas.height);

        // Get attribute terms
        this._att = [this.pos, this.tile_pos].map(function (name, number) {

            var index = Math.min(number, boxes.length - 1);
            var vec = Math.floor(boxes[index].length / count);
            var vertex = gl.getAttribLocation(program, name);

            return [vertex, vec, gl.FLOAT, 0, vec * bytes, count * index * vec * bytes];
        });

        this.texture.toBuffers(gl, this.wrap, this.filter);

        this._drawArrays = [gl.TRIANGLE_STRIP, 0, count];

        // Build the position and texture buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    }

    toCanvas(program, currentVisualisation, imageElement, tileDimension, zoomLevel, pixelSize) {
        if (!this.context.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        let context = this.context,
            gl = this.gl;

        context['gl_drawing'].call(context, gl, program, currentVisualisation, tileDimension);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        //TODO with glsl 1 (and same probably on 2) any error get stuck here --> AVOID USING if
        //problem TODO fix this

        // Set Attributes for GLSL
        this._att.map(function (x) {
            gl.enableVertexAttribArray(x.slice(0, 1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), pixelSize);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), zoomLevel);

        //this.context.setDimensions(tileDimension.width, tileDimension.height);

        // Upload textures
        this.texture.toCanvas(context, currentVisualisation, imageElement, tileDimension, program, context.gl);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this._drawArrays);

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

        this.texture = {
            init: function (gl) {
                this.textureId = gl.createTexture();
            },

            toBuffers: function (gl, wrap, filter, visualisation) {
                this.wrap = wrap;
                this.filter = filter;
            },

            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {
                // use canvas to get the pixel data array of the image
                const NUM_IMAGES = Math.round(image.height / tileBounds.height);

                if (NUM_IMAGES < this.imageCount) {
                     console.warn("Incoming data does not contain necessary number of images!");
                }

                //Init Texture
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureId);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, this.filter);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, this.filter);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, this.wrap);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, this.wrap);
                // gl.texImage3D(
                //     gl.TEXTURE_2D_ARRAY,
                //     0,
                //     gl.R8,
                //     tileBounds.width,
                //     tileBounds.height,
                //     NUM_IMAGES,
                //     0,
                //     gl.RED,
                //     gl.UNSIGNED_BYTE,
                //     pixels
                // );
                gl.texImage3D(
                    gl.TEXTURE_2D_ARRAY,
                    0,
                    gl.R8,
                    tileBounds.width,
                    tileBounds.height,
                    NUM_IMAGES,
                    0,
                    gl.RED,
                    gl.UNSIGNED_BYTE,
                    image
                );
            }
        };
        this.texture.init(gl);
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
                //do nothing
            } else if (layer.hasOwnProperty("error")) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);

            } else if (layer._renderContext && layer.hasOwnProperty("index")) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set
                if (layer.visible == 1) {
                    definition += layer._renderContext.getFragmentShaderDefinition();
                    execution += layer._renderContext.getFragmentShaderExecution();
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

        //must preserve the definition order
        // let urls = [], indicesMapping = new Array(usableShaders).fill(0);
        // for (let key in visualisation.shaders) {
        //     if (visualisation.shaders.hasOwnProperty(key)) {
        //         let layer = visualisation.shaders[key];
        //
        //         //TODO implement?
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
        //         //todo enable once we really DOWNLOAD only necessary stuff, otherwise this mapping is invalid
        //         // if (layer.rendering) {
        //         //     urls.push(key);
        //         //     indicesMapping[layer.index] = urls.length-1;
        //         // }
        //
        //         urls.push(key);
        //         indicesMapping[layer.index] = urls.length-1;
        //     }
        // }
        //this.texture.imageCount = urls.length;

        this.texture.imageCount = this.context._dataSources.length;

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution, this.context._dataSourceMapping, globalScopeCode),
            html: html,
            usableShaders: usableShaders,
            dataUrls: this.context._dataSources
        };
    }

    getTextureDimensionXY(dataIndex) {
        return `vec2(textureSize(vis_data_sampler_array))`;
    }

    getTextureSamplingCode(dataIndex, textureCoords) {
        return `texture(vis_data_sampler_array, vec3(${textureCoords}, _vis_data_sampler_array_indices[${dataIndex}]))`;
    }

    getFragmentShader(definition, execution, indicesOfImages, globalScopeCode) {
        return `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

uniform sampler2DArray vis_data_sampler_array;
int _vis_data_sampler_array_indices[${indicesOfImages.length}] = int[${indicesOfImages.length}](
  ${indicesOfImages.join(",")}
);
uniform float pixel_size_in_fragments;
uniform float zoom_level;
uniform vec2 u_tile_size;

in vec2 tile_texture_coords;
        
out vec4 final_color;
        
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}
        
void show(vec4 color) {
    if (close(color.a, 0.0)) return;
    float t = color.a + final_color.a - color.a*final_color.a;
    final_color = vec4((color.rgb * color.a + final_color.rgb * final_color.a - final_color.rgb * (final_color.a * color.a)) / t, t);
}

vec4 blend_equation(in vec4 foreground, in vec4 background) {
${this.glslBlendCode}
}

void blend(vec4 foreground) {
    final_color = blend_equation(foreground, final_color);
}


${Object.values(globalScopeCode).join("\n")}
        
${definition}
        
void main() {
    final_color = vec4(1., 1., 1., 0.);
        
    ${execution}
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
        //The resizing in border tiles is done when the GL canvas is rendered to the output canvas
        gl.uniform2f(gl.getUniformLocation(program, 'u_tile_size'), gl.canvas.width, gl.canvas.height);

        //Init textures
        this.texture.toBuffers(gl, this.wrap, this.filter);

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
        this.texture.toCanvas(context, currentVisualisation, imageElement, tileDimension, program, gl);
        // Draw three points (obtained from gl_VertexID from a static array in vertex shader)
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return gl.canvas;
    }
};

/**Not a part of API, static functionality to process polygons**/
WebGLModule.RasterizerContext = class {
    constructor(context, gl) {
        this.context = context;
        this.gl = gl;
    }

    toBuffers(program) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;

        gl.useProgram(program);

        // Vertices
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

        // Indices
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);


        this.positionLocation = gl.getAttribLocation(program, "vertex");

        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(
            this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        this.resolutionLocation = gl.getUniformLocation(program, "resolution");
        this.colorPosition = gl.getUniformLocation(program, "color");
    }

    vs() {
        return `
attribute vec2 vertex;
uniform vec2 resolution;

void main() {
   vec2 zeroToOne = vertex / resolution;
   // convert from 0->1 to 0->2
   vec2 zeroToTwo = zeroToOne * 2.0;
   // convert from 0->2 to -1->+1 (clipspace)
   vec2 clipSpace = zeroToTwo - 1.0;
   gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
}
        
        `;
    }

    fs() {
        return `
precision mediump float;
uniform vec4 color;
void main() {
   gl_FragColor = color;
}
        `;
    }




    toCanvas(program, vertices, color, indices) {
        if (!this.context.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        let context = this.context,
            gl = this.gl;

        //todo blending!!!!!
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        gl.uniform4fv(this.colorPosition, color);

        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        return gl.canvas;
    }
};

