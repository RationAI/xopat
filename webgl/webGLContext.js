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
        if (context.gl) {
            //WebGL 2.0
            context.webGLImplementation = getContext(true, wrapper, this.gl);
            return;
        }
        //WebGL 1.0
        wrapper.gl = canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })
                        || canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });   
        wrapper.webGLImplementation = getContext(false, wrapper, this.gl);
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
        this.wrap = this.gl.CLAMP_TO_EDGE;
        this.tile_pos = 'a_tile_pos';
        this.filter = this.gl.NEAREST;
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
   

                //TODO EXTRACT FROM THE IMAGE REQUIRED LAYERS
                let _this = this,
                    index = 0;
                const NUM_IMAGES = 1; //Math.round(image.height / tileBounds.height); //todo enable after protocol is working
                this.canvas.width = image.width;
                this.canvas.height = image.height;
                this.canvasReader.drawImage(image, 0, 0);

                Object.values(visualisation.responseData).forEach(visSetup => {
                    if (!visSetup.rendering) return;

                    if (index >= NUM_IMAGES) {
                        console.warn("The visualisation contains less data than layers. Skipping layer ", visSetup);
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
                    let location = gl.getUniformLocation(program, `vis_data_sampler_${visSetup.order}`);
                    gl.uniform1i(location, index);
                    //gl.activeTexture(gl[_this._units[i].bindConstant]); //TEXTURE[i]
                    gl.activeTexture(gl[bindConst]);
                    //gl.bindTexture(gl.TEXTURE_2D, _this._units[i].bindPointer);
                    gl.bindTexture(gl.TEXTURE_2D, bindPtr); //why twice?

                    index++;
                });
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

    generateVisualisation(order, visSetup, visualisation, glLoadCall, glDrawingCall) {
        var definition = "", execution = "", samplers = "", html = "", js = "", glload = "", gldraw = "", 
            _this = this, usableShaders = 0, simultaneouslyVisible = 0;

        order.forEach(dataId => {
            visSetup[dataId].rendering = false;
            if (visSetup[dataId].type == "none") {
                //this data is meant for other shader to use, skip
                continue;
            } else if (visSetup[dataId].error) {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], visSetup[dataId]["error"], false, false) + html;
                console.warn(visSetup[dataId]["error"], visSetup[dataId]["desc"]);

            } else if (visSetup[dataId].definition && visSetup[dataId].execution) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set and if GPU has enough texture units
                //todo test amst textures
                if (visSetup[dataId].visible == 1 && simultaneouslyVisible < _this.max_textures) {
                    definition += visSetup[dataId]["definition"];
                    execution += visSetup[dataId]["execution"];
                    glload += visSetup[dataId]["glLoaded"];
                    gldraw += visSetup[dataId]["glDrawing"];
                    samplers += `uniform sampler2D vis_data_sampler_${visSetup[dataId]["order"]};`;
                    visible = true;
                    visSetup[dataId].rendering = true;
                    simultaneouslyVisible++;
                }

                //reverse order append to show first the last drawn element (top)
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], visSetup[dataId]["html"], visible, true) + html;
                js += visSetup[dataId]["js"];
            } else {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], `The requested visualisation type does not work properly.`, false, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", visSetup[dataId]);
            }
        });

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(samplers, definition, execution),
            js: `
function saveCache(key, value) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}")) {
        VISUALISAITION_SHADER_CACHE["${visualisation.name}"] = {};
    }
    VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key] = value;
}
function loadCache(key, defaultValue) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}") ||
        !VISUALISAITION_SHADER_CACHE["${visualisation.name}"].hasOwnProperty(key)) {
        return defaultValue;
    }
    return VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key];
}
            
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
            usableShaders: usableShaders
        };
    }

   getFragmentShader(samplers, definition, execution,) {
    return `
precision mediump float;
uniform vec2 u_tile_size;
varying vec2 v_tile_pos;

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
varying vec2 v_tile_pos;
    
void main() {
    v_tile_pos = a_tile_pos;
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
        var tile_size = gl.getUniformLocation(program, this.tile_size);
        gl.uniform2f(tile_size, gl.canvas.height, gl.canvas.width);

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
            gl = this.gl;

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

        // Upload textures
        this.texture.toCanvas(context, context._visualisations[context._program], imageElement, e.tile.sourceBounds, context._programs[context._program], context.gl);

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
        this.wrap = this.gl.CLAMP_TO_EDGE;
        this.filter = this.gl.NEAREST;
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
            gl.texImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                gl.RGBA,
                image.width,
                image.height,
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

    generateVisualisation(order, visSetup, visualisation, glLoadCall, glDrawingCall) {
        var definition = "", execution = "", html = "", js = "", glload = "", gldraw = "", 
            _this = this, usableShaders = 0;

        order.forEach(dataId => {
            if (visSetup[dataId].type == "none") {
                //this data is meant for other shader to use, skip
                continue;
            } else if (visSetup[dataId].error) {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], visSetup[dataId]["error"], false, false) + html;
                console.warn(visSetup[dataId]["error"], visSetup[dataId]["desc"]);

            } else if (visSetup[dataId].definition && visSetup[dataId].execution) {
                let visible = false;
                usableShaders++;

                //make visible textures if 'visible' flag set
                if (visSetup[dataId].visible == 1) {
                    definition += visSetup[dataId]["definition"];
                    execution += visSetup[dataId]["execution"];
                    glload += visSetup[dataId]["glLoaded"];
                    gldraw += visSetup[dataId]["glDrawing"];
                    visible = true;
                }

                //reverse order append to show first the last drawn element (top)
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], visSetup[dataId]["html"], visible, true) + html;
                js += visSetup[dataId]["js"];
            } else {
                //todo attach warn icon
                html = _this.context.htmlShaderPartHeader(visSetup[dataId]["name"], `The requested visualisation type does not work properly.`, false, false) + html;
                console.warn("Invalid shader part.", "Missing one of the required elements.", visSetup[dataId]);
            }
        });

        return {
            vertex_shader: this.getVertexShader(),
            fragment_shader: this.getFragmentShader(definition, execution),
            js: `
function saveCache(key, value) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}")) {
        VISUALISAITION_SHADER_CACHE["${visualisation.name}"] = {};
    }
    VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key] = value;
}
function loadCache(key, defaultValue) {
    if (!VISUALISAITION_SHADER_CACHE.hasOwnProperty("${visualisation.name}") ||
        !VISUALISAITION_SHADER_CACHE["${visualisation.name}"].hasOwnProperty(key)) {
        return defaultValue;
    }
    return VISUALISAITION_SHADER_CACHE["${visualisation.name}"][key];
}
            
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
            usableShaders: usableShaders
        };
    }
 
    getFragmentShader(definition, execution) {
        return `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray vis_data_sampler_array;
uniform vec2 u_tile_size;
in vec2 v_tile_pos;
        
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
out vec2 v_tile_pos;
            
void main() {
    vec2 tex_coords = vec2(a_pos) / 2.0 + 0.5;
    v_tile_pos = vec2(tex_coords.x, 1.0-tex_coords.y);
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
        var tile_size = gl.getUniformLocation(program, this.tile_size);
        gl.uniform2f(tile_size, gl.canvas.height, gl.canvas.width);

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
            gl = this.gl;

        // TODO move this decision to tile-loaded to decide once!
        if (!context['gl_drawing'].call(context, gl, imageElement, e)) {
            return null;
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Set Attributes for GLSL
        gl.enableVertexAttribArray(this._att.slice(0, 1));
        gl.vertexAttribPointer.apply(gl, this._att);

        // Upload textures
        this.texture.toCanvas(context, context._visualisations[context._program], imageElement, e.tile.sourceBounds, context._programs[context._program], gl);

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
 
