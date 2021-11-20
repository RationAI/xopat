/**
 * Interface to the modular behaviour of the WebGL plugin.
 * extend this class, implement getContext(...) and provide
 * your OWN rendering behaviour using a GPU.
 */
class GlContextFactory {
    /**
     * Create WebGL context and corresponding implementation (State pattern & Factory method)
     */
    init(wrapper) {
        const canvas = document.createElement('canvas');

        wrapper.gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
        if (wrapper.gl) {
            //WebGL 2.0
            wrapper.webGLImplementation = this.getContext(true, wrapper, wrapper.gl);
            return;
        }

        //WebGL 1.0
        wrapper.gl = canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
            || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
        wrapper.webGLImplementation = this.getContext(false, wrapper, wrapper.gl);
    }

    /**
     * Factory method, should be overrided
     * @param {boolean} webGL2 true if context can use WebGL 2.0
     * @param {*} wrapper webGL wrapper, basic visualiser funcitonality (sort of manager)
     * @param {*} gl WebGL context
     * @returns null (must be overriden)
     */
    getContext(webGL2, wrapper, gl) {
        console.error("This is a factory method and should be implemented in a subclass.");
        return null;
    }
}


/**
 * Implementation of factory. Default WebGL contexts.
 */
class DefaultGLContextFactory extends GlContextFactory {
    getContext(webGL2, wrapper, gl) {
        return webGL2 ? new WebGL20(wrapper, gl) : new WebGL10(wrapper, gl);
    }
}


class WebGL10 {
    constructor(context, gl) {
        this.context = context;
        this.gl = gl;
        this.max_textures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);

        this.tile_size = 'u_tile_size';
        this.wrap = gl.CLAMP_TO_EDGE;
        this.tile_pos = 'a_tile_pos';
        this.filter = gl.NEAREST;
        this.pos = 'a_pos';

        //TODO: fix how textures are allocated and freed, also limit it with
        this.texture = {
            init: function (gl, maxTextureUnits) {
                this.canvas = document.createElement('canvas');
                this.canvasReader = this.canvas.getContext('2d');

                this._units = [];
                // for (let i = 0; i < maxTextureUnits; i++) {
                //     this._units.push({
                //         bindConstant: `TEXTURE${i}`,
                //         bindPointer: gl.createTexture(),
                //     });
                // }
            },

            toBuffers: function (gl, wrap, filter, visualisation) {
                this.texParameteri = [
                    [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap],
                    [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap],
                    [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter],
                    [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter]
                ];
                this.pixelStorei = [gl.UNPACK_FLIP_Y_WEBGL, 1];
                //todo dirty...
                //this.init(this.gl, this._units.length);

            },

            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {
                let _this = this,
                    index = 0;
                const NUM_IMAGES = Math.round(image.height / tileBounds.height);
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);

                for (let key in visualisation.shaders) {
                    let layer = visualisation.shaders[key];
                    if (!layer.rendering) {
                        index++;
                        continue;
                    }

                    if (index >= NUM_IMAGES) {
                        console.warn("The visualisation contains less data than layers. Skipping layer ", layer);
                        return;
                    }

                    // Bind pointer
                    //gl.bindTexture(gl.TEXTURE_2D, _this._units[i].bindPointer);
                    let bindPtr = gl.createTexture();
                    //_this._units.push(bindPtr);
                    let bindConst = `TEXTURE${index}`;
                    gl.bindTexture(gl.TEXTURE_2D, bindPtr);

                    // Apply texture parameters
                    _this.texParameteri.map(function (x) {
                        gl.texParameteri.apply(gl, x);
                    });
                    gl.pixelStorei.apply(gl, _this.pixelStorei);

                    let pixels = new Uint8Array(this.canvasReader.getImageData(0, index*tileBounds.height, tileBounds.width, tileBounds.height).data.buffer);

                    // Send the tile into the texture.
                    gl.texImage2D(gl.TEXTURE_2D,
                        0,
                        gl.RGBA,
                        tileBounds.width,
                        tileBounds.height,
                        0,
                        gl.RGBA,
                        gl.UNSIGNED_BYTE,
                        pixels);

                    //TODO why not simultaneously in tutorial?

                    // Bind texture unit
                    let location = gl.getUniformLocation(program, `vis_data_sampler_${layer.order}`);
                    gl.uniform1i(location, index);
                    //gl.activeTexture(gl[_this._units[i].bindConstant]); //TEXTURE[i]
                    gl.activeTexture(gl[bindConst]);
                    //gl.bindTexture(gl.TEXTURE_2D, _this._units[i].bindPointer);
                    gl.bindTexture(gl.TEXTURE_2D, bindPtr); //why twice?

                    index++;
                }
            },

            freeTextures: function (gl) {
                this._units.forEach(tex => gl.deleteTexture(tex));
                //this._units = [];
            }
        }
        this.texture.init(gl, this.max_textures);

    }

    isWebGL2() {
        return false;
    }

    generateVisualisation(order, visualisation, glLoadCall, glDrawingCall) {
        var definition = "", execution = "", samplers = "", html = "", js = "", glload = "", gldraw = "",
            _this = this, usableShaders = 0, simultaneouslyVisible = 0;

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.rendering = false;

            if (layer.type == "none") {
                //this data is meant for other shader to use, skip
                dataTempUrls.push(dataId);
            } else if (layer.error) {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(layer["name"], layer["error"], dataId,false, false) + html;
                console.warn(layer["error"], layer["desc"]);

            } else if (layer.definition && layer.execution) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set and if GPU has enough texture units
                //todo test amst textures
                if (layer.visible == 1 && simultaneouslyVisible < _this.max_textures) {
                    definition += layer["definition"];
                    execution += layer["execution"];
                    glload += layer["glLoaded"];
                    gldraw += layer["glDrawing"];
                    samplers += `uniform sampler2D vis_data_sampler_${layer["order"]};`;
                    visible = true;
                    layer.rendering = true;
                    simultaneouslyVisible++;
                }

                //reverse order append to show first the last drawn element (top)
                html = _this.context.htmlShaderPartHeader(layer["name"], layer["html"], dataId, visible, true) + html;
                js += layer["js"];
            } else {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(layer["name"], `The requested visualisation type does not work properly.`, dataId, false, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", layer);
            }
        });

        //must preserve the definition order
        let urls = [];
        for (let key in visualisation.shaders) {
            let layer = visualisation.shaders[key];
            //none shader can be ommited in the above cycle
            if (layer.hasOwnProperty("target")) {
                if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
                    console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
                } else if (visualisation.shaders[target].rendering) {
                    urls.push(key);
                }
            } else if (layer.rendering) {
                urls.push(key);
            }
        }

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(samplers, definition, execution),
            js: `            
//user input might do wild things, use try-catch
try {
    ${js}
            
    function ${glLoadCall}(program, gl) {
        ${glload}
    }
            
    function ${glDrawingCall}(gl, e) {
        ${gldraw}
    }
} catch (error) {
    console.error(error.message);
    //todo try if error outside functions
}`,
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
    gl_FragColor = vec4(1., 1., 1., 0.);
    
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

    toBuffers(program) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;

        // Allow for custom loading
        gl.useProgram(program);
        context.visualisationInUse(context._visualisations[context._program]);
        context['gl_loaded'].call(context, gl, program);

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

    toCanvas(imageElement, e) {
        if (!this.context.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        let context = this.context,
            gl = this.gl,
            program = context._programs[context._program];


        // TODO move this decision to tile-loaded to decide once!
        if (!context['gl_drawing'].call(context, gl, imageElement, e)) {
            return null;
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Set Attributes for GLSL
        this._att.map(function (x) {
            gl.enableVertexAttribArray(x.slice(0, 1));
            gl.vertexAttribPointer.apply(gl, x);
        });

        //todo better access
        let dx = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(1, 0)).x -
            PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0)).x;
        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), dx);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), PLUGINS.osd.viewport.getZoom());

        // Upload textures
        this.texture.toCanvas(context, context._visualisations[context._program], imageElement, e.tile.sourceBounds, program, context.gl);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this._drawArrays);

        // Apply to container if needed
        if (context.container) {
            context.container.appendChild(gl.canvas);
        }

        //this.texture.freeTextures(gl);
        return gl.canvas;
    }
}



class WebGL20 {
    constructor(context, gl) {
        this.context = context;
        this.gl = gl;
        this.tile_size = 'u_tile_size';
        this.wrap = gl.CLAMP_TO_EDGE;
        this.filter = gl.NEAREST;
        this.pos = 'a_pos';

        this.texture = {
            init: function (gl) {
                this.canvas = document.createElement('canvas');
                this.canvasReader = this.canvas.getContext('2d');
                this.textureId = gl.createTexture();

            },

            toBuffers: function (gl, wrap, filter, visualisation) {


            },

            toCanvas: function (context, visualisation, image, tileBounds, program, gl) {

                // use canvas to get the pixel data array of the image

                const NUM_IMAGES = Math.round(image.height / tileBounds.height);
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);
                let imageData = this.canvasReader.getImageData(0, 0, image.width, image.height);
                let pixels = new Uint8Array(imageData.data.buffer);

                // -- Init Texture
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureId);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
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


            },

            freeTextures: function (gl) {
                gl.deleteTexture(this.textureId);
            }
        }
        this.texture.init(gl);
    }

    isWebGL2() {
        return true;
    }

    generateVisualisation(order, visualisation, glLoadCall, glDrawingCall) {
        var definition = "", execution = "", html = "", js = "", glload = "", gldraw = "",
            _this = this, usableShaders = 0;

        order.forEach(dataId => {
            let layer = visualisation.shaders[dataId];
            layer.inUse = false;

            if (layer.type == "none") {
                //do nothing
            } else if (layer.error) {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(layer["name"], layer["error"], dataId, false, false) + html;
                console.warn(layer["error"], layer["desc"]);

            } else if (layer.definition && layer.execution) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set
                if (layer.visible == 1) {
                    definition += layer["definition"];
                    execution += layer["execution"];
                    glload += layer["glLoaded"];
                    gldraw += layer["glDrawing"];
                    layer.inUse = true;
                    visible = true;
                }

                //reverse order append to show first the last drawn element (top)
                html = _this.context.htmlShaderPartHeader(layer["name"], layer["html"], dataId, visible, true) + html;
                js += layer["js"];
            } else {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(layer["name"], `The requested visualisation type does not work properly.`, dataId, false, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", layer);
            }
        });

        //must preserve the definition order
        let urls = [];
        for (let key in visualisation.shaders) {
            let layer = visualisation.shaders[key];
            //none shader can be ommited in the above cycle
            if (layer.hasOwnProperty("target")) {
                if (!visualisation.shaders.hasOwnProperty(layer["target"])) {
                    console.warn("Invalid target of the data source " + dataId + ". Ignoring.");
                } else if (visualisation.shaders[target].inUse) {
                    urls.push(key);
                }
            } else if (layer.inUse) {
                urls.push(key);
            }
        }

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution),
            js: `   
//user input might do wild things, use try-catch
try {
    ${js}
            
    function ${glLoadCall}(program, gl) {
        ${glload}
    }
            
    function ${glDrawingCall}(gl, e) {
        ${gldraw}
    }
} catch (error) {
    console.error(error.message);
    //todo try if error outside functions
}`,
            html: html,
            usableShaders: usableShaders,
            dataUrls: urls
        };
    }

    getFragmentShader(definition, execution) {
        return `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

uniform sampler2DArray vis_data_sampler_array;
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
in vec4 a_pos;
out vec2 tile_texture_coords;
            
void main() {
    vec2 tex_coords = vec2(a_pos) / 2.0 + 0.5;
    tile_texture_coords = vec2(tex_coords.x, 1.0-tex_coords.y);
    gl_Position = a_pos;
}
`;
    }

    toBuffers(program) {
        if (!this.context.running) return;

        let context = this.context,
            gl = this.gl;


        //TODO use VAO and avoid all this setup (REFACTOR THIS!!!!)

        // Allow for custom loading
        gl.useProgram(program);
        context.visualisationInUse(context._visualisations[context._program]);
        context['gl_loaded'].call(context, gl, program);

        // Unchangeable square array buffer fills viewport with texture
        var boxes = [-1, 1, -1, -1, 1, 1, 1, -1];
        var buffer = new Float32Array(boxes);
        var count = 4;

        // Get uniform term
        gl.uniform2f(gl.getUniformLocation(program, this.tile_size), gl.canvas.width, gl.canvas.height);

        // Get attribute terms
        this._att = [gl.getAttribLocation(program, this.pos), 2, gl.FLOAT, 0, 0, 0];

        this.texture.toBuffers(gl, this.wrap, this.filter);

        this._drawArrays = [gl.TRIANGLE_STRIP, 0, count];

        // Build the position and texture buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    }

    toCanvas(imageElement, e) {
        if (!this.context.running) return;
        // Allow for custom drawing in webGL and possibly avoid using webGL at all

        let context = this.context,
            gl = this.gl,
            program = context._programs[context._program];

        // TODO move this decision to tile-loaded to decide once!
        if (!context['gl_drawing'].call(context, gl, imageElement, e)) {
            return null;
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Set Attributes for GLSL
        gl.enableVertexAttribArray(this._att.slice(0, 1));
        gl.vertexAttribPointer.apply(gl, this._att);

        //todo better access
        let dx = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(1, 0)).x -
            PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0)).x;
        gl.uniform1f(gl.getUniformLocation(program, "pixel_size_in_fragments"), dx);
        gl.uniform1f(gl.getUniformLocation(program, "zoom_level"), PLUGINS.osd.viewport.getZoom());

        // Upload textures
        this.texture.toCanvas(context, context._visualisations[context._program], imageElement, e.tile.sourceBounds, program, gl);

        // Draw everything needed to canvas
        gl.drawArrays.apply(gl, this._drawArrays);

        // Apply to container if needed
        if (context.container) {
            context.container.appendChild(gl.canvas);
        }

        //this.texture.freeTextures(gl);
        return gl.canvas;
    }
}

