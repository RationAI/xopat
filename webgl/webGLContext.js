/**
 * Modular behaviour of the WebGL plugin.
 * provide your OWN rendering behaviour using a GPU.
 */
WebGLWrapper.GlContextFactory = class {

    static _GL_MAKERS = {
        "1.0" : {
            glContext: function (canvas) {
                return canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function (wrapper, glContext) {
                return new WebGLWrapper.WebGL_1_0(wrapper, glContext);
            }
        },
        "2.0" : {
            glContext: function (canvas) {
                return canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
            },
            webGLImplementation: function (wrapper, glContext) {
                return new WebGLWrapper.WebGL_2_0(wrapper, glContext);
            }
        }
    }

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
        WebGLWrapper.GlContextFactory._GL_MAKERS[version] = maker;
    }

    /**
     * Create WebGL context and corresponding implementation (State pattern & Factory method)
     * @param wrapper {WebGLWrapper}
     * @param versions {string} array of considered versions in the preferred order
     *      currently supported "1.0", "2.0"
     * @throws
     */
    static init(wrapper, ...versions) {
        if (versions.length < 1) {
            throw "Invalid WebGL context initialization: no version specified!";
        }
        const canvas = document.createElement('canvas');
        let gl;

        for (let version of versions) {
            if (!WebGLWrapper.GlContextFactory._GL_MAKERS.hasOwnProperty(version)) {
                console.warn("WebGL context initialization: unsupported version. Skipping.", version);
                continue;
            }
            let maker = WebGLWrapper.GlContextFactory._GL_MAKERS[version];
            gl = maker.glContext(canvas);
            if (gl) {
                wrapper.gl = gl;
                wrapper.webGLImplementation = maker.webGLImplementation(wrapper, gl);
                return;
            }
        }
        throw "No context available for GlContextFactory to init.";
    }
}

/**
 * @interface WebGLImplementation
 * Interface for the visualisation rendering implementation which can run
 * on various GLSL versions
 */
WebGLWrapper.WebGLImplementation = class {
    /**
     * @return {string} WebGL version used
     */
    getVersion() {
        console.error("::getVersion() must be implemented!");
    }

    /**
     * Get GLSL texture sampling code
     * @param {string} order order number in the shader, available in vis.shaders[id].order
     * @param {string} textureCoords string representing GLSL code of valid texture coordinates
     *  e.g. 'tex_coords' or 'vec2(1.0, 0.0)'
     * @return {string} GLSL code that is correct in texture sampling wrt. WebGL version used
     */
    getTextureSamplingCode(order, textureCoords) {
        console.error("::getTextureSamplingCode() must be implemented!");
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
}

WebGLWrapper.WebGL_1_0 = class extends WebGLWrapper.WebGLImplementation {

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
            init: function() {
                this.canvas = document.createElement('canvas');
                this.canvasReader = this.canvas.getContext('2d');
            },

            toBuffers: function (gl, wrap, filter, visualisation) {
                this.wrap = wrap;
                this.filter = filter;

                //todo maybe leave the textures there...
                this._units.forEach(u => gl.deleteTexture(u));
                this._units = [];
            },

            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {
                let index = 0;
                tileBounds.width = Math.round(tileBounds.width);
                tileBounds.height = Math.round(tileBounds.height);
                const NUM_IMAGES = Math.round(image.height / tileBounds.height);
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);

                if (tileBounds.width != 256 || tileBounds.height != 256)  {
                    this.debug.css({width: image.width, height: image.height});
                    this.debug.get(0).src = this.canvas.toDataURL();
                }

                for (let key of this.renderOrder) {
                    if (!visualisation.shaders.hasOwnProperty(key)) continue;

                    let layer = visualisation.shaders[key];
                    if (!layer.rendering) continue;

                    if (index >= NUM_IMAGES) {
                        console.warn("The visualisation contains less data than layers. Skipping current " +
                            "layer and all the following ones.", layer);
                        return;
                    }

                    //create textures
                    while (index >= this._units.length) {
                        this._units.push(gl.createTexture());
                    }
                    let bindConst = `TEXTURE${index}`;
                    gl.activeTexture(gl[bindConst]);
                    let location = gl.getUniformLocation(program, `vis_data_sampler_${layer.order}`);
                    gl.uniform1i(location, index);

                    gl.bindTexture(gl.TEXTURE_2D, this._units[index]);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrap);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrap);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

                    //load data
                    let read = this.canvasReader.getImageData(0,
                        layer.order*tileBounds.height, tileBounds.width, tileBounds.height);
                    let pixels = new Uint8Array(read.data.buffer);

                    if (tileBounds.width != 256 || tileBounds.height != 256)  {
                        var canvas = document.createElement('canvas');
                        var ctx = canvas.getContext('2d');
                        canvas.width = read.width;
                        canvas.height = read.height;
                        ctx.putImageData(read, 0, 0);
                        this.debug2.css({width: tileBounds.width, height: tileBounds.height});
                        this.debug2.get(0).src = canvas.toDataURL();
                    }



                    // gl.texImage2D(gl.TEXTURE_2D,
                    //     0,
                    //     gl.RED,
                    //     tileBounds.width,
                    //     tileBounds.height,
                    //     0,
                    //     gl.RED,
                    //     gl.UNSIGNED_BYTE,
                    //     pixels);
                    gl.texImage2D(gl.TEXTURE_2D,
                        0,
                        gl.RGBA,
                        tileBounds.width,
                        tileBounds.height,
                        0,
                        gl.RGBA,
                        gl.UNSIGNED_BYTE,
                        pixels);

                    index++;
                }
            }
        }
        this.texture.init();
    }

    getVersion() {
        return "1.0";
    }

    getTextureSamplingCode(order, textureCoords) {
        return `texture2D(vis_data_sampler_${order}, ${textureCoords})`;
    }

    generateVisualisation(order, visualisation, withHtml) {
        var definition = "", execution = "", samplers = "", html = "",
            _this = this, usableShaders = 0, simultaneouslyVisible = 0;

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.type == "none") {
                //this data is meant for other shader to use, skip
            } else if (layer.error) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);

            } else if (layer._renderContext) {
                let visible = false;
                usableShaders++;

                if (layer.visible == 1 && simultaneouslyVisible < _this.max_textures) {
                    definition += layer._renderContext.getFragmentShaderDefinition();
                    execution += layer._renderContext.getFragmentShaderExecution();
                    samplers += `uniform sampler2D vis_data_sampler_${layer["order"]};`;
                    visible = true;
                    layer.rendering = true;
                    simultaneouslyVisible++;
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
        let urls = [];
        for (let key in visualisation.shaders) {
            if (visualisation.shaders.hasOwnProperty(key)) {
                let layer = visualisation.shaders[key];

                //TODO implement?
                // if (layer.hasOwnProperty("target")) {
                //     if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
                //         console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
                //     } else if (visualisation.shaders[target].rendering) {
                //         urls.push(key);
                //     }
                // } else

                if (layer.rendering) {
                    urls.push(key);
                }
            }
        }

        this.texture.renderOrder = urls;

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(samplers, definition, execution),
            html: html,
            usableShaders: usableShaders,
            dataUrls: urls
        };
    }

    getFragmentShader(samplers, definition, execution,) {
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

${definition}

void main() {
    //gl_FragColor = vec4(1., 1., 1., 0.);
    //gl_FragColor = vec4(tile_texture_coords, 0., 1.);
    //gl_FragColor = texture2D(vis_data_sampler_2, tile_texture_coords);
    //return;
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
        gl.uniform2f(gl.getUniformLocation(program, this.tile_size), gl.canvas.height, gl.canvas.width);

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

        // Set Attributes for GLSL
        this._att.map(function (x) {
            gl.enableVertexAttribArray(x.slice(0, 1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), pixelSize);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), zoomLevel);

        // Upload textures
        this.texture.toCanvas(context, currentVisualisation, imageElement, tileDimension, program, context.gl);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this._drawArrays);

        return gl.canvas;
    }
}


WebGLWrapper.WebGL_2_0 = class extends WebGLWrapper.WebGLImplementation {
    constructor(context, gl) {
        super();
        this.context = context;
        this.gl = gl;
        this.wrap = gl.MIRRORED_REPEAT;
        this.filter = gl.NEAREST;
        this.emptyBuffer = gl.createBuffer();

        this.texture = {
            init: function (gl) {
                this.canvas = document.createElement('canvas');
                this.canvasReader = this.canvas.getContext('2d');
                this.textureId = gl.createTexture();
            },

            toBuffers: function (gl, wrap, filter, visualisation) {
                this.wrap = wrap;
                this.filter = filter;
            },


            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {

                // use canvas to get the pixel data array of the image
                const NUM_IMAGES = Math.round(image.height / tileBounds.height);
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);
                let imageData = this.canvasReader.getImageData(0, 0, image.width, image.height);
                let pixels = new Uint8Array(imageData.data.buffer);

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
                    gl.RGBA,
                    tileBounds.width,
                    tileBounds.height,
                    NUM_IMAGES,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    pixels
                );
            }
        }
        this.texture.init(gl);
    }

    getVersion() {
        return "2.0";
    }

    generateVisualisation(order, visualisation, withHtml) {
        var definition = "", execution = "", html = "", _this = this, usableShaders = 0;

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.type == "none") {
                //do nothing
            } else if (layer.hasOwnProperty("error")) {
                if (withHtml) html = _this.context.htmlShaderPartHeader(layer.name, layer.error, dataId, false, layer, false) + html;
                console.warn(layer.error, layer["desc"]);

            } else if (layer._renderContext) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set
                if (layer.visible == 1) {
                    definition += layer._renderContext.getFragmentShaderDefinition();
                    execution += layer._renderContext.getFragmentShaderExecution();
                    layer.rendering = true;
                    visible = true;
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
        let urls = [], indicesMapping = [];
        for (let key in visualisation.shaders) {
            if (visualisation.shaders.hasOwnProperty(key)) {
                let layer = visualisation.shaders[key];

                //TODO implement?
                // if (layer.hasOwnProperty("target")) {
                //     if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
                //         console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
                //     } else if (visualisation.shaders[target].rendering) {
                //         urls.push(key);
                //     }
                // } else

                if (layer.rendering) {
                    urls.push(key);
                    indicesMapping.push(urls.length-1);
                } else {
                    indicesMapping.push(0);
                }
            }
        }

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution, indicesMapping),
            html: html,
            usableShaders: usableShaders,
            dataUrls: urls
        };
    }

    getTextureSamplingCode(order, textureCoords) {
        return `texture(vis_data_sampler_array, vec3(${textureCoords}, _vis_data_sampler_array_indices[${order}]))`;
    }

    getFragmentShader(definition, execution, indicesOfImages) {
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
}

