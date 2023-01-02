/**
 * Data loading strategies for different WebGL versions.
 * Should you have your own data format, change/re-define these
 * to correctly load the textures to GPU, based on the WebGL version used.
 *
 * TODO dataloader should be a component given to the configuration dynamically
 * TODO make GLSL code as functions (proxies) instead of using code injection
 *
 * This implementation supports data as Image or Canvas objects
 *
 * @type {{V2_0: WebGLModule.DataLoader.V2_0, V1_0: WebGLModule.DataLoader.V1_0}}
 */
WebGLModule.DataLoader = {
    /**
     * In case the system is fed by anything but 'Image' (or the like) data object,
     * implement here conversion so that debug mode can draw it.
     * @param {*} data
     * @return {Image}
     */
    dataToImage: function (data) {
        return data;
    },

    /**
     * Data loader for WebGL 1.0. Must load the data based on dataIndexMapping:
     *  for (first) texture at index 0, obtain its global index at dataIndexMapping[0]
     *  use the global index to localize the texture chunk in the data
     *  use the local index to get the texture name the chunk must be loaded to.
     *
     * Note that loading with single texture and computing indices is not possible
     * since some access surrounding pixels -> requirement of MIRRORED_REPEAT not implementable
     *
     * For details, please, see the implementation.
     * @type WebGLModule.DataLoader.V1_0
     */
    V1_0: class {
        /**
         * Creation
         * @param {WebGLRenderingContext} gl
         */
        constructor(gl) {
            this._units = [];
            this.canvas = document.createElement('canvas');
            this.canvasReader = this.canvas.getContext('2d', {willReadFrequently: true});
            this.canvasConverter = document.createElement('canvas');
            this.canvasConverterReader = this.canvasConverter.getContext('2d', {willReadFrequently: true});
        }

        /**
         * Called when the program is being loaded (set as active)
         * @param {WebGLModule} context
         * @param {WebGLRenderingContext} gl WebGL context
         * @param {WebGLProgram} program
         * @param {GLint} wrap required texture GL wrap value
         * @param {GLint} filter required texture GL filter value
         * @param {object} visualisation reference to the visualization object
         */
        toBuffers (context, gl, program, wrap, filter, visualisation) {
            this.wrap = wrap;
            this.filter = filter;

            //The resizing in border tiles is done when the GL canvas is rendered to the output canvas
            gl.uniform2f(gl.getUniformLocation(program, 'sampler_size'), gl.canvas.width, gl.canvas.height);
        }

        /**
         * Called when tile is processed
         * @param {WebGLModule} context
         * @param {array} dataIndexMapping mapping of array indices to data indices, e.g. texture 0 for
         *   this shader corresponds to index dataIndexMapping[0] in the data array, -1 value used for textures not loaded
         * @param {object} visualisation reference to the current active visualisation object
         * @param {*} data data object, must contain all the data listed in WebGLModule.prototype.getSources() in
         *   the respective order, dataIndexMapping then points with index to this data; by default an Image object
         * @param {object} tileBounds tile size in pixels
         * @param {number} tileBounds.width tile width
         * @param {number} tileBounds.height tile height
         * @param {WebGLProgram} program current WebGLProgram
         * @param {WebGLRenderingContext} gl
         */
        toCanvas (context, dataIndexMapping, visualisation, data, tileBounds, program, gl) {
            let index = 0;
            tileBounds.width = Math.round(tileBounds.width);
            tileBounds.height = Math.round(tileBounds.height);

            //we read from here
            this.canvas.width = data.width;
            this.canvas.height = data.height;
            this.canvasReader.drawImage(data, 0, 0);

            const NUM_IMAGES = Math.round(data.height / tileBounds.height);
            //Allowed texture size dimension only 256+ and power of two...

            //it worked for arbitrary size until we begun with image arrays... is it necessary?
            const IMAGE_SIZE = data.width < 256 ? 256 : Math.pow(2, Math.ceil(Math.log2(data.width)));
            this.canvasConverter.width = IMAGE_SIZE;
            this.canvasConverter.height = IMAGE_SIZE;

            //just load all images and let shaders reference them...
            for (let i = 0; i < dataIndexMapping.length; i++) {
                if (dataIndexMapping[i] < 0) {
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

                let pixels;
                if (tileBounds.width !== IMAGE_SIZE || tileBounds.height !== IMAGE_SIZE)  {
                    this.canvasConverterReader.drawImage(this.canvas, 0, dataIndexMapping[i]*tileBounds.height,
                        tileBounds.width, tileBounds.height, 0, 0, IMAGE_SIZE, IMAGE_SIZE);

                    pixels = this.canvasConverterReader.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
                } else {
                    //load data
                    pixels = this.canvasReader.getImageData(0,
                        dataIndexMapping[i]*tileBounds.height, tileBounds.width, tileBounds.height);
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

        /**
         * Measure texture size
         * @param {number} index index of the texture
         * @return {string} GLSL expression (unterminated) to obtain texture size - vec2
         */
        measure(index) {
            return 'sampler_size';
        }

        /**
         * Sample texture
         * @param {number|string} index texture index, must respect index re-mapping (see declare())
         * @param {string} vec2coords GLSL expression that evaluates to vec2
         * @return {string} GLSL expression (unterminated) that evaluates to vec4
         */
        sample(index, vec2coords) {
            return `texture2D(vis_data_sampler_${index}, ${vec2coords})`;
        }

        /**
         * Declare elements in shader
         * @param {number[]} indicesOfImages mapping of shader to data index, i.e. if shader requests
         *  texture i, the texture is located in the data at indicesOfImages[i] index
         * @return {string} GLSL declaration (terminated with semicolon) of necessary elements for textures
         */
        declare(indicesOfImages) {
            let samplers = 'uniform vec2 sampler_size;';
            for (let i = 0; i < indicesOfImages.length; i++) {
                if (indicesOfImages[i] === -1) continue;
                samplers += `uniform sampler2D vis_data_sampler_${i};`;
            }
            return samplers;
        }
    },

    /**
     * Data loader for WebGL 2.0. Must load the data to a Texture2DArray.
     * The name of the texture is a constant. The order od the textures in
     * the z-stacking is defined in dataIndexMapping.
     *
     * For details, please, see the implementation.
     * @type WebGLModule.DataLoader.V2_0
     */
    V2_0: class {
        /**
         * Creation
         * @param {WebGL2RenderingContext} gl
         * @param {string} textureName texture name, must load the data as Texture2DArray
         */
        constructor(gl, textureName) {
            this.textureName = textureName;
            this.textureId = gl.createTexture();
        }

        /**
         * Called when the program is being loaded (set as active)
         * @param {WebGLModule} context
         * @param {WebGL2RenderingContext} gl WebGL context
         * @param {GLint} wrap required texture GL wrap value
         * @param {GLint} filter required texture GL filter value
         * @param {object} visualisation reference to the visualization object
         */
        toBuffers(context, gl, program, wrap, filter, visualisation) {
            this.wrap = wrap;
            this.filter = filter;
        }

        /**
         * Called when tile is processed
         * @param {WebGLModule} context context renderer reference
         * @param {array} dataIndexMapping mapping of array indices to data indices, e.g. texture 0 for
         *   this shader corresponds to index dataIndexMapping[0] in the data array, -1 value used for textures not loaded
         * @param {object} visualisation reference to the current active visualisation object
         * @param {*} data data object, must contain all the data listed in WebGLModule.prototype.getSources() in
         *   the respective order, dataIndexMapping then points with index to this data; by default an Image object
         * @param {object} tileBounds tile size in pixels
         * @param {number} tileBounds.width tile width
         * @param {number} tileBounds.height tile height
         * @param {WebGLProgram} program current WebGLProgram
         * @param {WebGL2RenderingContext} gl
         */
        toCanvas(context, dataIndexMapping, visualisation, data, tileBounds, program, gl) {
            const NUM_IMAGES = Math.round(data.height / tileBounds.height);

            // Texture checking disabled due to performance reasons
            // if (NUM_IMAGES < dataIndexMapping.reduce((sum, val, _i, _a) => sum + (val >= 0 ? 1 : 0), 0).length) {
            //     console.warn("Incoming data does not contain necessary number of images!", NUM_IMAGES, dataIndexMapping);
            // }

            //Just load the texture since it comes as an Image element concatenated below each other
            //in the correct order --> directly to GPU
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureId);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, this.filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, this.filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, this.wrap);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, this.wrap);

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
                data
            );
        }


        /**
         * Measure texture size
         * @param {number} index index of the texture
         * @return {string} GLSL expression (unterminated) to obtain texture size - vec2
         */
        measure(index) {
            return 'vec2(textureSize(vis_data_sampler_array))';
        }

        /**
         * Sample texture
         * @param {number|string} index texture index, must respect index re-mapping (see declare())
         * @param {string} vec2coords GLSL expression that evaluates to vec2
         * @return {string} GLSL expression (unterminated) that evaluates to vec4
         */
        sample(index, vec2coords) {
            return `texture(vis_data_sampler_array, vec3(${vec2coords}, _vis_data_sampler_array_indices[${index}]))`;
        }

        /**
         * Declare elements in shader
         * @param {number[]} indicesOfImages mapping of shader to data index, i.e. if shader requests
         *  texture i, the texture is located in the data at indicesOfImages[i] index
         * @return {string} GLSL declaration (terminated with semicolon) of necessary elements for textures
         */
        declare(indicesOfImages) {
            return `uniform sampler2DArray vis_data_sampler_array;
int _vis_data_sampler_array_indices[${indicesOfImages.length}] = int[${indicesOfImages.length}](
  ${indicesOfImages.join(",")}
);`;
        }
    }
};
