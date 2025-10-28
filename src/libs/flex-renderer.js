//! flex-renderer 0.0.1
//! Built on 2025-10-28
//! Git commit: --3205840-dirty
//! http://openseadragon.github.io
//! License: http://openseadragon.github.io/license/

(function($) {
    /**
     * @typedef {Object} ShaderConfig
     * @property {String} shaderConfig.id
     * @property {String} shaderConfig.name
     * @property {String} shaderConfig.type         equal to ShaderLayer.type(), e.g. "identity"
     * @property {Number} shaderConfig.visible      1 = use for rendering, 0 = do not use for rendering
     * @property {Boolean} shaderConfig.fixed
     * @property {Object} shaderConfig.params          settings for the ShaderLayer
     * @property {OpenSeadragon.TiledImage[]|number[]} tiledImages images that provide the data
     * @property {Object} shaderConfig._controls       storage for the ShaderLayer's controls
     * @property {Object} shaderConfig.cache          cache object used by the ShaderLayer's controls
     */

    /**
     * @typedef {Object} FPRenderPackageItem
     * @property {WebGLTexture[]} texture           [TEXTURE_2D]
     * @property {Float32Array} textureCoords
     * @property {Float32Array} transformMatrix
     * //todo provide also opacity per tile?
     */

    /**
     * @typedef {Object} FPRenderPackage
     * @property {FPRenderPackageItem} tiles
     * @property {Number[][]} stencilPolygons
     */

    /**
     * @typedef {Object} SPRenderPackage
     * @property {Number} zoom
     * @property {Number} pixelsize
     * @property {Number} opacity
     * @property {ShaderLayer} shader
     * @property {Uint8Array|undefined} iccLut  TODO also support error rendering by passing some icon texture & rendering where nothing was rendered but should be (-> use mask, but how we force tiles to come to render if they are failed?  )
     */

    /**
     * @typedef HTMLControlsHandler
     * Function that attaches HTML controls for ShaderLayer's controls to DOM.
     * @type function
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} [shaderLayer]
     * @param {ShaderConfig} [shaderConfig]
     * @returns {String}
     */

    /**
     * @typedef {Object} RenderOutput
     * @property {Number} sourcesLength
     */

    /**
     * WebGL Renderer for OpenSeadragon.
     *
     * Renders in two passes:
     *  1st pass joins tiles and creates masks where we should draw
     *  2nd pass draws the actual data using shaders
     *
     * @property {RegExp} idPattern
     * @property {Object} BLEND_MODE
     *
     * @class OpenSeadragon.FlexRenderer
     * @classdesc class that manages ShaderLayers, their controls, and WebGLContext to allow rendering using WebGL
     * @memberof OpenSeadragon
     */
    $.FlexRenderer = class extends $.EventSource {

        /**
         * @param {Object} incomingOptions
         *
         * @param {String} incomingOptions.uniqueId
         *
         * @param {String} incomingOptions.webGLPreferredVersion    prefered WebGL version, "1.0" or "2.0"
         *
         * @param {Function} incomingOptions.redrawCallback          function called when user input changed; triggers re-render of the viewport
         * @param {Function} incomingOptions.refetchCallback        function called when underlying data changed; triggers re-initialization of the whole WebGLDrawer
         * @param {Boolean} incomingOptions.debug                   debug mode on/off
         * @param {Boolean} incomingOptions.interactive             if true (default), the layers are configured for interactive changes (not applied by default)
         * @param {HTMLControlsHandler} incomingOptions.htmlHandler function that ensures individual ShaderLayer's controls' HTML is properly present at DOM
         * @param {function} incomingOptions.htmlReset              callback called when a program is reset - html needs to be cleaned
         *
         * @param {Object} incomingOptions.canvasOptions
         * @param {Boolean} incomingOptions.canvasOptions.alpha
         * @param {Boolean} incomingOptions.canvasOptions.premultipliedAlpha
         * @param {Boolean} incomingOptions.canvasOptions.stencil
         *
         * @constructor
         * @memberof FlexRenderer
         */
        constructor(incomingOptions) {
            super();

            if (!this.constructor.idPattern.test(incomingOptions.uniqueId)) {
                throw new Error("$.FlexRenderer::constructor: invalid ID! Id can contain only letters, numbers and underscore. ID: " + incomingOptions.uniqueId);
            }
            this.uniqueId = incomingOptions.uniqueId;

            this.webGLPreferredVersion = incomingOptions.webGLPreferredVersion;

            this.redrawCallback = incomingOptions.redrawCallback;
            this.refetchCallback = incomingOptions.refetchCallback;
            this.debug = incomingOptions.debug;
            this.interactive = incomingOptions.interactive === undefined ?
                !!incomingOptions.htmlHandler : !!incomingOptions.interactive;
            this.htmlHandler = this.interactive ? incomingOptions.htmlHandler : null;

            if (this.htmlHandler) {
                if (!incomingOptions.htmlReset) {
                    throw Error("$.FlexRenderer::constructor: htmlReset callback is required when htmlHandler is set!");
                }
                this.htmlReset = incomingOptions.htmlReset;
            } else {
                this.htmlReset = () => {};
            }

            this.running = false;
            this._program = null;            // WebGLProgram
            this._shaders = {};
            this._shadersOrder = null;
            this._programImplementations = {};
            this.__firstPassResult = null;

            this.canvasContextOptions = incomingOptions.canvasOptions;
            const canvas = document.createElement("canvas");
            const WebGLImplementation = this.constructor.determineContext(this.webGLPreferredVersion);
            const webGLRenderingContext = $.FlexRenderer.WebGLImplementation.createWebglContext(canvas, this.webGLPreferredVersion, this.canvasContextOptions);
            if (webGLRenderingContext) {
                this.gl = webGLRenderingContext;                                            // WebGLRenderingContext|WebGL2RenderingContext
                this.webglContext = new WebGLImplementation(this, webGLRenderingContext);   // $.FlexRenderer.WebGLImplementation
                this.canvas = canvas;

                // Should be last call of the constructor to make sure everything is initialized
                this.webglContext.init();
            } else {
                throw new Error("$.FlexRenderer::constructor: Could not create WebGLRenderingContext!");
            }
        }

        /**
         * Search through all FlexRenderer properties to find one that extends WebGLImplementation and it's getVersion() method returns <version> input parameter.
         * @param {String} version WebGL version, "1.0" or "2.0"
         * @returns {WebGLImplementation}
         *
         * @instance
         * @memberof FlexRenderer
         */
        static determineContext(version) {
            const namespace = $.FlexRenderer;
            for (let property in namespace) {
                const context = namespace[ property ],
                    proto = context.prototype;
                if (proto && proto instanceof namespace.WebGLImplementation &&
                    $.isFunction( proto.getVersion ) && proto.getVersion.call( context ) === version) {
                        return context;
                }
            }

            throw new Error("$.FlexRenderer::determineContext: Could not find WebGLImplementation with version " + version);
        }

        /**
         * Get Currently used WebGL version
         * @return {String|*}
         */
        get webglVersion() {
            return this.webglContext.webGLVersion;
        }

        /**
         * Set viewport dimensions.
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @param {Number} levels number of layers that are rendered, kind of 'depth' parameter, an integer
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(x, y, width, height);
            this.webglContext.setDimensions(x, y, width, height, levels);
        }

        /**
         * Whether the FlexRenderer creates HTML elements in the DOM for ShaderLayers' controls.
         * @return {Boolean}
         *
         * @instance
         * @memberof FlexRenderer
         */
        supportsHtmlControls() {
            return typeof this.htmlHandler === "function";
        }

        /**
         * Call to first-pass draw using WebGLProgram.
         * @param {FPRenderPackage[]} source
         * @param {RenderOptions|undefined} options
         * @return {RenderOutput}
         * @instance
         * @memberof FlexRenderer
         */
        firstPassProcessData(source) {
            const program = this._programImplementations[this.webglContext.firstPassProgramKey];
            if (this.useProgram(program, "first-pass")) {
                program.load();
            }
            const result = program.use(this.__firstPassResult, source, undefined);
            if (this.debug) {
                this._showOffscreenMatrix(result, source.length, {scale: 0.5, pad: 8});
            }
            this.__firstPassResult = result;
            this.__firstPassResult.sourcesLength = source.length;
            return result;
        }

        /**
         * Call to second-pass draw
         * @param {SPRenderPackage[]} renderArray
         * @param {RenderOptions|undefined} options
         * @return {RenderOutput}
         */
        secondPassProcessData(renderArray, options) {
            const program = this._programImplementations[this.webglContext.secondPassProgramKey];
            if (this.useProgram(program, "second-pass")) {
                program.load(renderArray);
            }
            return program.use(this.__firstPassResult, renderArray, options);
        }

        /**
         * Create and load the new WebGLProgram based on ShaderLayers and their controls.
         * @param {OpenSeadragon.FlexRenderer.Program} program
         * @param {String} [key] optional ID for the program to use
         * @return {String} ID for the program it was registered with
         *
         * @instance
         * @protected
         * @memberof FlexRenderer
         */
        registerProgram(program, key = undefined) {
            key = key || String(Date.now());

            if (!program) {
                program = this._programImplementations[key];
            }
            if (this._programImplementations[key]) {
                this.deleteProgram(key);
            }

            const webglProgram = this.gl.createProgram();
            program._webGLProgram = webglProgram;

            // TODO inner control type udpates are not checked here
            for (let shaderId in this._shaders) {
                const shader = this._shaders[shaderId];
                const config = shader.getConfig();
                // Check explicitly type of the config, if updated, recreate shader
                if (shader.constructor.type() !== config.type) {
                    this.createShaderLayer(shaderId, config, false);
                }
            }

            program.build(this._shaders, this.getShaderLayerOrder());
            // Used also to re-compile, set requiresLoad to true
            program.requiresLoad = true;

            const errMsg = program.getValidateErrorMessage();
            if (errMsg) {
                this.gl.deleteProgram(webglProgram);
                program._webGLProgram = null;
                throw Error(errMsg);
            }

            this._programImplementations[key] = program;
            if ($.FlexRenderer.WebGLImplementation._compileProgram(
                webglProgram, this.gl, program, $.console.error, this.debug
            )) {
                this.gl.useProgram(webglProgram);
                program.created(webglProgram, this.canvas.width, this.canvas.height);
                return key;
            }
            return undefined;
        }

        /**
         * Switch program
         * @param {OpenSeadragon.FlexRenderer.Program|string} program instance or program key to use
         * @param {string} name "first-pass" or "second-pass"
         * @return {boolean} false if update is not necessary, true if update was necessary -- updates
         * are initialization steps taken once after program is first loaded (after compilation)
         * or when explicitly re-requested
         */
        useProgram(program, name) {
            if (!(program instanceof $.FlexRenderer.Program)) {
                program = this.getProgram(program);
            }

            if (this.running && this._program === program) {
                return false;
            } else if (this._program) {
                this._program.unload();
            }

            this._program = program;
            this.gl.useProgram(program.webGLProgram);

            const needsUpdate = this._program.requiresLoad;
            this._program.requiresLoad = false;
            if (needsUpdate) {
                /**
                 * todo better docs
                 * Fired after program has been switched to (initially or when changed).
                 * The event happens BEFORE JS logics executes within ShaderLayers.
                 * @event program-used
                 */
                this.raiseEvent('program-used', {
                    name: name,
                    program: program,
                    shaderLayers: this._shaders,
                });

                // initialize ShaderLayer's controls:
                //      - set their values to default,
                //      - if interactive register event handlers to their corresponding DOM elements created in the previous step

                //todo a bit dirty.. consider events / consider doing within webgl context
                if (name === "second-pass") {
                    // generate HTML elements for ShaderLayer's controls and put them into the DOM
                    if (this.htmlHandler) {
                        this.htmlReset();

                        for (const shaderId of this.getShaderLayerOrder()) {
                            const shaderLayer = this._shaders[shaderId];
                            const shaderConfig = shaderLayer.__shaderConfig;
                            this.htmlHandler(
                                shaderLayer,
                                shaderConfig
                            );
                        }

                        this.raiseEvent('html-controls-created', {
                            name: name,
                            program: program,
                            shaderLayers: this._shaders,
                        });
                    }

                    for (const shaderId in this._shaders) {
                        this._shaders[shaderId].init();
                    }
                }
            }

            if (!this.running) {
                this.running = true;
            }
            return needsUpdate;
        }

        /**
         *
         * @param {string} programKey
         * @return {OpenSeadragon.FlexRenderer.Program}
         */
        getProgram(programKey) {
            return this._programImplementations[programKey];
        }

        /**
         *
         * @param {string} key program key to delete
         */
        deleteProgram(key) {
            const implementation = this._programImplementations[key];
            if (!implementation) {
                return;
            }
            implementation.unload();
            implementation.destroy();
            this.gl.deleteProgram(implementation._webGLProgram);
            this.__firstPassResult = null;
            this._programImplementations[key] = null;
        }

        /**
         * Create and initialize new ShaderLayer instantion and its controls.
         * @param id
         * @param {ShaderConfig} shaderConfig object bound to a concrete ShaderLayer instance
         * @param {boolean} [copyConfig=false] if true, deep copy of the config is used to avoid modification of the parameter
         * @returns {ShaderLayer} instance of the created shaderLayer
         *
         * @instance
         * @memberof FlexRenderer
         */
        createShaderLayer(id, shaderConfig, copyConfig = false) {
            id = $.FlexRenderer.sanitizeKey(id);

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderConfig.type);
            if (!Shader) {
                throw new Error(`$.FlexRenderer::createShaderLayer: Unknown shader type '${shaderConfig.type}'!`);
            }

            const defaultConfig = {
                id: id,
                name: "Layer",
                type: "identity",
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: {},
                cache: {},
            };
            if (copyConfig) {
                // Deep copy to avoid modification propagation
                shaderConfig = $.extend(true, defaultConfig, shaderConfig);
            } else {
                // Ensure we keep references where possible -> this will make shader object within drawers (e.g. navigator VS main)
                for (let propName in defaultConfig) {
                    if (shaderConfig[propName] === undefined) {
                        shaderConfig[propName] = defaultConfig[propName];
                    }
                }
            }

            if (this._shaders[id]) {
                this.removeShader(id);
            }

            // TODO a bit dirty approach, make the program key usable from outside
            const shader = new Shader(id, {
                shaderConfig: shaderConfig,
                webglContext: this.webglContext,
                params: shaderConfig.params,
                interactive: this.interactive,

                // callback to re-render the viewport
                invalidate: this.redrawCallback,
                // callback to rebuild the WebGL program
                rebuild: () => {
                    this.registerProgram(null, this.webglContext.secondPassProgramKey);
                },
                // callback to reinitialize the drawer; NOT USED
                refetch: this.refetchCallback
            });

            shader.construct();
            this._shaders[id] = shader;
            return shader;
        }

        getAllShaders() {
            return this._shaders;
        }

        getShaderLayer(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            return this._shaders[id];
        }

        getShaderLayerConfig(id) {
            const shader = this.getShaderLayer(id);
            if (shader) {
                return shader.getConfig();
            }
            return undefined;
        }

        /**
         *
         * @param order
         */
        setShaderLayerOrder(order) {
            if (!order) {
                this._shadersOrder = null;
            }
            this._shadersOrder = order.map($.FlexRenderer.sanitizeKey);
        }

        /**
         *
         * Retrieve the order
         * @return {*}
         */
        getShaderLayerOrder() {
            return this._shadersOrder || Object.keys(this._shaders);
        }

        /**
         * Remove ShaderLayer instantion and its controls.
         * @param {string} id shader id
         *
         * @instance
         * @memberof FlexRenderer
         */
        removeShader(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            const shader = this._shaders[id];
            if (!shader) {
                return;
            }
            shader.destroy();
            delete this._shaders[id];
        }

        /**
         * Clear all shaders
         */
        deleteShaders() {
            for (let sId in this._shaders) {
                this.removeShader(sId);
            }
        }

        /**
         * @param {Boolean} enabled if true enable alpha blending, otherwise disable blending
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDataBlendingEnabled(enabled) {
            if (enabled) {
                this.gl.enable(this.gl.BLEND);

                // standard alpha blending
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this.gl.disable(this.gl.BLEND);
            }
        }

        destroy() {
            this.htmlReset();
            this.deleteShaders();
            for (let pId in this._programImplementations) {
                this.deleteProgram(pId);
            }
            this.webglContext.destroy();
            this._programImplementations = {};
        }

        static sanitizeKey(key) {
            if (!$.FlexRenderer.idPattern.test(key)) {
                key = key.replace(/[^0-9a-zA-Z_]/g, '');
                key = key.replace(/_+/g, '_');
                key = key.replace(/^_+/, '');

                if (!key) {
                    throw new Error("Invalid key: sanitization removed all parts!");
                }
            }
            return key;
        }

        // Todo below are debug and other utilities hardcoded for WebGL2. In case of other engines support, these methods
        //  must be adjusted or moved to appropriate interfaces

        /**
         * Convenience: copy your RenderOutput {texture, stencil} to desination.
         * Returns { texture: WebGLTexture, stencil: WebGLTexture } in the destination context.
         *
         * @param {OpenSeadragon.FlexRenderer} dst
         * @param {RenderOutput} [renderOutput]  first pass output to copy, defaults to latest internal state
         * @param {Object} [opts]  options
         * @return {RenderOutput}
         */
        copyRenderOutputToContext(dst, renderOutput = undefined, {
            level = 0,
            format = null,
            type = null,
            internalFormatGuess = null,
        } = {}) {
            renderOutput = renderOutput || this.__firstPassResult;
            const out = {};
            if (renderOutput.texture) {
                out.texture = this._copyTexture2DArrayBetweenContexts({
                    dstGL: dst.gl, srcTex: renderOutput.texture, dstTex: dst.__firstPassResult.texture,
                    textureLayerCount: renderOutput.sourcesLength, format, type, internalFormatGuess,
                });
            }
            if (renderOutput.stencil) {
                out.stencil = this._copyTexture2DArrayBetweenContexts({
                    dstGL: dst.gl, srcTex: renderOutput.stencil, dstTex: dst.__firstPassResult.stencil,
                    textureLayerCount: renderOutput.sourcesLength, format, type, internalFormatGuess,
                });
            }
            out.sourcesLength = renderOutput.sourcesLength || 0;
            dst.__firstPassResult = out;
            return out;
        }

        /**
         * Copy a TEXTURE_2D_ARRAY from one WebGL2 context to another by readPixels -> texSubImage3D.
         * Creates the destination texture if not provided.
         *
         * @param {Object} opts
         * @param {WebGL2RenderingContext} opts.dstGL
         * @param {WebGLTexture} opts.srcTex           - source TEXTURE_2D_ARRAY
         * @param {WebGLTexture?} [opts.dstTex]        - optional destination TEXTURE_2D_ARRAY (created if omitted)
         * @param {number} [opts.level=0]              - mip level to copy
         * @param {GLenum} [opts.format=srcGL.RGBA]    - pixel format for read/upload
         * @param {GLenum} [opts.type=srcGL.UNSIGNED_BYTE]  - pixel type for read/upload (supports srcGL.FLOAT if you have the extensions)
         * @param {GLenum} [opts.internalFormatGuess]  - sized internal format for dst allocation (defaults to RGBA8 for UNSIGNED_BYTE, RGBA32F for FLOAT)
         * @returns {WebGLTexture} dstTex
         */
        _copyTexture2DArrayBetweenContexts({ dstGL, srcTex, dstTex = null,
               textureLayerCount, format = null, type = null, internalFormatGuess = null }) {
            const gl = this.gl;
            if (!(gl instanceof WebGL2RenderingContext) || !(dstGL instanceof WebGL2RenderingContext)) {
                throw new Error('WebGL2 contexts required (texture arrays + tex(Sub)Image3D).');
            }

            // ---------- Inspect source texture dimensions ----------
           // const srcPrevTex = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcTex);

            if (format === null) {
                format = gl.RGBA;
            }
            if (type === null) {
                type = gl.UNSIGNED_BYTE;
            }

            const width  = this.canvas.width;
            const height = this.canvas.height;
            if (!width || !height || !textureLayerCount) {
                // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
                throw new Error('Source texture level has no width/height/layers (is it initialized?)');
            }

            // ---------- Create + allocate destination texture if needed ----------
            //const dstPrevTex = dstGL.getParameter(dstGL.TEXTURE_BINDING_2D_ARRAY);
            dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstTex);

            // todo cache fb
            const srcFB = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, srcFB);

            // ---------- Prepare source framebuffer for extraction ----------
            // const srcPrevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);

            const layerByteLen = width * height * 4 * (type === gl.FLOAT ? 4 : 1);
            const layerBuf = (type === gl.FLOAT) ? new Float32Array(layerByteLen / 4) : new Uint8Array(layerByteLen);

            for (let z = 0; z < textureLayerCount; z++) {
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, srcTex, 0, z);
                const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                if (status !== gl.FRAMEBUFFER_COMPLETE) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.deleteFramebuffer(srcFB);
                    // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
                    // dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstPrevTex);
                    throw new Error(`Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`);
                }

                gl.readPixels(0, 0, width, height, format, type, layerBuf);
                dstGL.texSubImage3D(
                    dstGL.TEXTURE_2D_ARRAY, 0,
                    0, 0, z,
                    width, height, 1,
                    format, type,
                    layerBuf
                );
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(srcFB);
            // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
            // dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstPrevTex);
            return dstTex;
        }

        _showOffscreenMatrix(renderOutput, length, {
            scale = 1,
            pad = 8,
            drawLabels = true,
            background = '#111'
        } = {}) {
            // 2 columns: [Texture, Stencil], `length` rows
            const cols = 2;
            const rows = length;
            const width = Math.floor(this.canvas.width);
            const height = Math.floor(this.canvas.height);
            const cellW = Math.floor(width * scale);
            const cellH = Math.floor(height * scale);
            const totalW = pad + cols * (cellW + pad);
            const totalH = pad + rows * (cellH + pad) + (drawLabels ? 18 : 0);

            const dbg = this._openDebugWindowFromUserGesture(totalW, totalH, 'Offscreen Layers (Texture | Stencil)');
            if (!dbg) {
                console.warn('Could not open debug window');
                return;
            }

            const gl = this.gl;
            const isGL2 = (gl instanceof WebGL2RenderingContext) || this.webGLVersion === "2.0";

            const ctx = dbg.__debugCtx;
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.imageSmoothingEnabled = false;

            // Optional headers
            if (drawLabels) {
                ctx.fillStyle = '#ddd';
                ctx.font = '12px system-ui';
                ctx.textBaseline = 'top';
                const yLbl = 2;
                const x0 = pad;
                const x1 = pad + (cellW + pad);
                ctx.fillText('Texture', x0, yLbl);
                ctx.fillText('Stencil', x1, yLbl);
            }

            // Prepare a tiny staging canvas so we can draw the pixels into 2D easily
            // and then scale when drawing to the popup.
            if (!this._debugStage) {
                this._debugStage = document.createElement('canvas');
            }
            const stage = this._debugStage;
            stage.width = width;
            stage.height = height;
            const stageCtx = stage.getContext('2d', { willReadFrequently: true });

            // One reusable buffer & ImageData to avoid reallocation per tile
            let pixels = this._readbackBuffer;
            if (!pixels || pixels.length !== width * height * 4) {
                pixels = this._readbackBuffer = new Uint8ClampedArray(width * height * 4);
            }
            if (!this._imageData || this._imageData.width !== width || this._imageData.height !== height) {
                this._imageData = new ImageData(width, height);
            }
            const imageData = this._imageData;

            // Ensure we have a framebuffer to attach sources to
            if (!this._extractionFB) {
                this._extractionFB = gl.createFramebuffer();
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._extractionFB);

            // Small helpers to attach a layer/texture
            const attachLayer = (texArray, layerIndex) => {
                // WebGL2 texture array
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, 0, layerIndex);
            };
            // Read helper (reuses pixels & imageData, draws into `stage`)
            const readToStage = () => {
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                // Set, don’t construct: avoids allocating a new buffer every time
                imageData.data.set(pixels);
                stageCtx.putImageData(imageData, 0, 0);
            };

            // Iterate rows: each row = {texture i, stencil i}
            for (let i = 0; i < length; i++) {
                // ---- texture ----
                if (isGL2 && renderOutput.texture /* texture array */) {
                    attachLayer(renderOutput.texture, i);
                } else {
                    console.error('No valid texture binding for "texture" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for texture layer', i);
                    continue;
                }
                readToStage();
                // draw scaled into grid
                const colTex = 0;
                const xTex = pad + colTex * (cellW + pad);
                const yBase = (drawLabels ? 18 : 0);
                const yRow = yBase + pad + i * (cellH + pad);
                ctx.drawImage(stage, 0, 0, width, height, xTex, yRow, cellW, cellH);

                // ---- stencil ----
                if (isGL2 && renderOutput.stencil /* texture array */) {
                    attachLayer(renderOutput.stencil, i);
                } else {
                    console.error('No valid texture binding for "stencil" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for stencil layer', i);
                    continue;
                }
                readToStage();
                const colSt = 1;
                const xSt = pad + colSt * (cellW + pad);
                ctx.drawImage(stage, 0, 0, width, height, xSt, yRow, cellW, cellH);

                // optional row label
                if (drawLabels) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = '12px system-ui';
                    ctx.textBaseline = 'top';
                    ctx.fillText(`#${i}`, pad, yRow - 14);
                }
            }

            // tidy
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        _openDebugWindowFromUserGesture(width, height, title = 'Debug Output') {
            const debug = this.__debugWindow;
            if (debug && !debug.closed) {
                return this.__debugWindow;
            }

            const features = `width=${width},height=${height}`;
            let w = window.open('', 'osd-debug-grid', features);
            if (!w) {
                // Popup blocked even within gesture (some environments)
                // Create a visible fallback button that opens it on another gesture.
                const fallback = document.createElement('button');
                fallback.textContent = 'Open debug window';
                fallback.style.cssText = 'position:fixed;top: 50;left:50;inset:auto 12px 12px auto;z-index:99999';
                fallback.onclick = () => {
                    const w2 = window.open('', 'osd-debug-grid', features);
                    if (w2) {
                        this._initDebugWindow(w2, title, width, height);
                        fallback.remove();
                    } else {
                        // If it still fails, there’s nothing we can do without the user changing settings
                        alert('Please allow pop-ups for this site and click the button again.');
                    }
                };
                document.body.appendChild(fallback);
                return null;
            }

            this._initDebugWindow(w, title, width, height);
            this.__debugWindow = w;
            return w;
        }

        _initDebugWindow(w, title, width, height) {
            if (w.__debugCtx) {
                return;
            }

            w.document.title = title;
            const style = w.document.createElement('style');
            style.textContent = `
    html,body{margin:0;background:#111;color:#ddd;font:12px/1.4 system-ui}
    .head{position:fixed;inset:0 0 auto 0;background:#222;padding:6px 10px}
    canvas{display:block;margin-top:28px}
  `;
            w.document.head.appendChild(style);

            const head = w.document.createElement('div');
            head.className = 'head';
            head.textContent = title;
            w.document.body.appendChild(head);

            const cnv = w.document.createElement('canvas');
            cnv.width = width;
            cnv.height = height;
            w.document.body.appendChild(cnv);
            w.__debugCtx = cnv.getContext('2d');
        }
    };


    // STATIC PROPERTIES
    /**
     * ID pattern allowed for FlexRenderer. ID's are used in GLSL to distinguish uniquely between individual ShaderLayer's generated code parts
     * @property
     * @type {RegExp}
     * @memberof FlexRenderer
     */
    $.FlexRenderer.idPattern = /^(?!_)(?:(?!__)[0-9a-zA-Z_])*$/;

    $.FlexRenderer.BLEND_MODE = [
        'mask',
        'source-over',
        'source-in',
        'source-out',
        'source-atop',
        'destination-over',
        'destination-in',
        'destination-out',
        'destination-atop',
        'lighten',
        'darken',
        'copy',
        'xor',
        'multiply',
        'screen',
        'overlay',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity',
    ];

    $.FlexRenderer.jsonReplacer = function (key, value) {
        return key.startsWith("_") || ["eventSource"].includes(key) ? undefined : value;
    };

    /**
     * Generic computational program interface
     * @type {{new(*): $.FlexRenderer.Program, context: *, _requiresLoad: boolean, prototype: Program}}
     */
    $.FlexRenderer.Program = class {
        constructor(context) {
            this.context = context;
            this._requiresLoad = true;
        }

        /**
         *
         * @param shaderMap
         * @param shaderKeys
         */
        build(shaderMap, shaderKeys) {
            throw new Error("$.FlexRenderer.Program::build: Not implemented!");
        }

        /**
         * Retrieve program error message
         * @return {string|undefined} error message of the current state or undefined if OK
         */
        getValidateErrorMessage() {
            return undefined;
        }

        /**
         * Set whether the program requires load.
         * @type {boolean}
         */
        set requiresLoad(value) {
            if (this._requiresLoad !== value) {
                this._requiresLoad = value;

                // Consider this event..
                // if (value) {
                //     this.context.raiseEvent('program-requires-load', {
                //         program: this,
                //         requiresLoad: value
                //     });
                // }
            }
        }

        /**
         * Whether the program requires load.
         * @return {boolean}
         */
        get requiresLoad() {
            return this._requiresLoad;
        }

        /**
         * Create program.
         * @param width
         * @param height
         */
        created(width, height) {}

        /**
         * Load program. Arbitrary arguments.
         * Called ONCE per shader lifetime. Should not be called twice
         * unless requested by requireLoad() -- you should not set values
         * that are lost when webgl program is changed.
         */
        load() {}

        /**
         * Use program. Arbitrary arguments.
         */
        use() {}

        /**
         * Unload program. No arguments.
         */
        unload() {}

        /**
         * Destroy program. No arguments.
         */
        destroy() {}
    };

    /**
     * Blank layer that takes almost no memory and current renderer skips it.
     * @type {OpenSeadragon.BlankTileSource}
     */
    $.BlankTileSource = class extends $.TileSource {
        supports(data, url) {
            return (data && data.type === "_blank") || (url && url.type === "_blank");
        }
        configure(options, dataUrl, postData) {
            return $.extend(options, {
                width: 512,
                height: 512,
                _tileWidth: 512,
                _tileHeight: 512,
                tileSize: 512,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: 0,
                dimensions: new $.Point(512, 512),
            });
        }
        downloadTileStart(context) {
            return context.finish("_blank", undefined, "undefined");
        }
        getMetadata() {
            return this;
        }
        getTileUrl(level, x, y) {
            return "_blank";
        }
    };

})(OpenSeadragon);

(function ($){
    /**
     * https://github.com/saikocat/colorbrewer
     * Color specifications and designs developed by Cynthia Brewer (http://colorbrewer2.org/).
     * This is a shim module of colorbrewer2 by Cythina Brewer for browserify.
     *
     * Some ColorSchemes are taken from Matlab
     *
     * TODO include our own color schemes [yellow + tyrkys  based]
     */
 $.FlexRenderer.ColorMaps = {
        defaults: {
            sequential: "Viridis",
            singlehue: "Reds",
            diverging: "RdBu",
            cyclic: "TwilightShift",
            qualitative: "Accent"
        },
        schemeGroups: {
            sequential: ["Viridis", "Parula", "Winter", "Turbo", "Hot", "Inferno", "Magma", "Plasma", "BuGn", "BuPu", "PuBuGn", "RdPu", "YlGn", "YlGnBu", "YlOrRd"],
            singlehue: ["Blues", "Greens", "Greys", "Purples", "Reds"],
            diverging: ["BrBG", "PiYG", "PRGn", "PuOr", "RdBu", "RdGy", "RdYlBu", "RdYlGn", "Spectral"],
            cyclic: ["Twilight", "TwilightShift"],
            qualitative: ["Accent", "Dark2", "Paired", "Pastel1", "Pastel2", "Set1", "Set2", "Set3", "Turbo"],
        }, Viridis: {
            2: ["#440154", "#fde725"],
            3: ["#440154", "#21918c", "#fde725"],
            4: ["#440154", "#31688e", "#35b779", "#fde725"],
            5: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
            6: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
            7: ["#440154", "#443983", "#31688e", "#21918c", "#35b779", "#90d743", "#fde725"],
            8: ["#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725"],
        }, Parula: {
            2: ["#12beb9", "#f9fb15"],
            3: ["#3e26a8", "#12beb9", "#f9fb15"],
            4: ["#3e26a8", "#2797eb", "#81cc59", "#f9fb15"],
            5: ["#3e26a8", "#347afd", "#12beb9", "#c8c129", "#f9fb15"],
            6: ["#3e26a8", "#4367fd", "#1caadf", "#48cb86", "#eaba30", "#f9fb15"],
            7: ["#3e26a8", "#475bf9", "#2797eb", "#12beb9", "#81cc59", "#fcbb3e", "#f9fb15"],
            8: ["#3e26a8", "#4852f4", "#2e87f7", "#12b1d6", "#37c897", "#abc739", "#fec338", "#f9fb15"],
        }, Winter: {
            2: ["#0080bf", "#00ff80"],
            3: ["#0000ff", "#0080bf", "#00ff80"],
            4: ["#0000ff", "#0055d5", "#00aaaa", "#00ff80"],
            5: ["#0000ff", "#0040df", "#0080bf", "#00bf9f", "#00ff80"],
            6: ["#0000ff", "#0033e6", "#0066cc", "#0099b3", "#00cc99", "#00ff80"],
            7: ["#0000ff", "#002bea", "#0055d5", "#0080bf", "#00aaaa", "#00d595", "#00ff80"],
            8: ["#0000ff", "#0024ed", "#0049db", "#006dc8", "#0092b6", "#00b6a4", "#00db92", "#00ff80"],
        }, Turbo: {
            2: ["#a3fd3c", "#7a0403"],
            3: ["#30123b", "#a3fd3c", "#7a0403"],
            4: ["#30123b", "#1ae4b6", "#faba39", "#7a0403"],
            5: ["#30123b", "#29bbec", "#a3fd3c", "#fb8022", "#7a0403"],
            6: ["#30123b", "#3e9bfe", "#46f884", "#e1dd37", "#f05b12", "#7a0403"],
            7: ["#30123b", "#4686fa", "#1ae4b6", "#a3fd3c", "#faba39", "#e4460b", "#7a0403"],
            8: ["#30123b", "#4777ef", "#1ccfd5", "#62fc6b", "#d1e935", "#fe9b2d", "#da3907", "#7a0403"],
        }, Hot: {
            2: ["#ff0000", "#ffff00"],
            3: ["#ff0000", "#ffff00", "#ffffff"],
            4: ["#ff0000", "#ffff00", "#ffff80", "#ffffff"],
            5: ["#ff0000", "#ffff00", "#ffff55", "#ffffaa", "#ffffff"],
            6: ["#800000", "#ff0000", "#ff8000", "#ffff00", "#ffff80", "#ffffff"],
            7: ["#800000", "#ff0000", "#ff8000", "#ffff00", "#ffff55", "#ffffaa", "#ffffff"],
            8: ["#550000", "#aa0000", "#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#ffff80", "#ffffff"],
        }, Inferno: {
            2: ["#bc3754", "#fcffa4"],
            3: ["#000004", "#bc3754", "#fcffa4"],
            4: ["#000004", "#781c6d", "#ed6925", "#fcffa4"],
            5: ["#000004", "#57106e", "#bc3754", "#f98e09", "#fcffa4"],
            6: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
            7: ["#000004", "#320a5e", "#781c6d", "#bc3754", "#ed6925", "#fbb61a", "#fcffa4"],
            8: ["#000004", "#280b53", "#65156e", "#9f2a63", "#d44842", "#f57d15", "#fac228", "#fcffa4"],
            9: ["#000004", "#210c4a", "#57106e", "#8a226a", "#bc3754", "#e45a31", "#f98e09", "#f9cb35", "#fcffa4"],
            10: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
            11: ["#000004", "#160b39", "#420a68", "#6a176e", "#932667", "#bc3754", "#dd513a", "#f37819", "#fca50a", "#f6d746", "#fcffa4"],
            12: ["#000004", "#140b34", "#390963", "#5f136e", "#85216b", "#a92e5e", "#cb4149", "#e65d2f", "#f78410", "#fcae12", "#f5db4c", "#fcffa4"],
        }, Magma: {
            2: ["#b73779", "#fcfdbf"],
            3: ["#000004", "#b73779", "#fcfdbf"],
            4: ["#000004", "#721f81", "#f1605d", "#fcfdbf"],
            5: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
            6: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
            7: ["#000004", "#2c115f", "#721f81", "#b73779", "#f1605d", "#feb078", "#fcfdbf"],
            8: ["#000004", "#221150", "#5f187f", "#982d80", "#d3436e", "#f8765c", "#febb81", "#fcfdbf"],
            9: ["#000004", "#1d1147", "#51127c", "#832681", "#b73779", "#e75263", "#fc8961", "#fec488", "#fcfdbf"],
            10: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
            11: ["#000004", "#140e36", "#3b0f70", "#641a80", "#8c2981", "#b73779", "#de4968", "#f7705c", "#fe9f6d", "#fecf92", "#fcfdbf"],
            12: ["#000004", "#120d31", "#331067", "#59157e", "#7e2482", "#a3307e", "#c83e73", "#e95462", "#fa7d5e", "#fea973", "#fed395", "#fcfdbf"],
        }, Twilight: {
            2: ["#2f1436", "#e2d9e2"], //does not make sense...
            3: ["#e2d9e2", "#2f1436", "#e2d9e2"],
            4: ["#e2d9e2", "#5e43a5", "#8e2c50", "#e2d9e2"],
            5: ["#e2d9e2", "#6276ba", "#2f1436", "#b25652", "#e2d9e2"],
            6: ["#e2d9e2", "#6d90c0", "#531e7c", "#64194b", "#c0755e", "#e2d9e2"],
            7: ["#e2d9e2", "#7ba1c2", "#5e43a5", "#2f1436", "#8e2c50", "#c6896c", "#e2d9e2"],
            8: ["#e2d9e2", "#89adc5", "#5f61b4", "#491564", "#501444", "#a54350", "#ca997c", "#e2d9e2"],
            9: ["#e2d9e2", "#95b5c7", "#6276ba", "#592a8f", "#2f1436", "#741e4f", "#b25652", "#cca389", "#e2d9e2"],
            10: ["#e2d9e2", "#9ebbc9", "#6785be", "#5e43a5", "#421257", "#471340", "#8e2c50", "#ba6657", "#ceac94", "#e2d9e2"],
            11: ["#e2d9e2", "#a6bfca", "#6d90c0", "#5f58b0", "#531e7c", "#2f1436", "#64194b", "#9f3c50", "#c0755e", "#d0b39e", "#e2d9e2"],
            12: ["#e2d9e2", "#adc3cd", "#759ac1", "#6068b6", "#5b3196", "#3e1150", "#41123d", "#7b2150", "#a94950", "#c48065", "#d2b7a5", "#e2d9e2"],
        }, TwilightShift: {
            2: ["#e2d9e2", "#301437"], //does not make sense...
            3: ["#e2d9e2", "#301437", "#e2d9e2"],
            4: ["#e2d9e2", "#8d2b50", "#5e45a6", "#e2d9e2"],
            5: ["#e2d9e2", "#b25652", "#301437", "#6276ba", "#e2d9e2"],
            6: ["#e2d9e2", "#c0745d", "#63184b", "#541e7e", "#6e91c0", "#e2d9e2"],
            7: ["#e2d9e2", "#c6896c", "#8d2b50", "#301437", "#5e45a6", "#7ba1c2", "#e2d9e2"],
            8: ["#e2d9e2", "#ca997c", "#a54350", "#501444", "#491564", "#5f61b4", "#89adc5", "#e2d9e2"],
            9: ["#e2d9e2", "#cca389", "#b25652", "#741e4f", "#301437", "#592a8f", "#6276ba", "#95b5c7", "#e2d9e2"],
            10: ["#e2d9e2", "#ceac94", "#ba6657", "#8d2b50", "#471340", "#421257", "#5e45a6", "#6785be", "#9ebbc9", "#e2d9e2"],
            11: ["#e2d9e2", "#d0b29c", "#c0745d", "#9e3b50", "#63184b", "#301437", "#541e7e", "#5f59b1", "#6e91c0", "#a7c0cb", "#e2d9e2"],
            12: ["#e2d9e2", "#d2b7a5", "#c48065", "#a94950", "#7b2150", "#41123d", "#3e1150", "#5b3196", "#6068b6", "#759ac1", "#adc3cd", "#e2d9e2"],
        }, Plasma: {
            2: ["#cc4778", "#f0f921"],
            3: ["#0d0887", "#cc4778", "#f0f921"],
            4: ["#0d0887", "#9c179e", "#ed7953", "#f0f921"],
            5: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"],
            6: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
            7: ["#0d0887", "#5c01a6", "#9c179e", "#cc4778", "#ed7953", "#fdb42f", "#f0f921"],
            8: ["#0d0887", "#5302a3", "#8b0aa5", "#b83289", "#db5c68", "#f48849", "#febd2a", "#f0f921"],
            9: ["#0d0887", "#4c02a1", "#7e03a8", "#aa2395", "#cc4778", "#e66c5c", "#f89540", "#fdc527", "#f0f921"],
            10: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
            11: ["#0d0887", "#41049d", "#6a00a8", "#8f0da4", "#b12a90", "#cc4778", "#e16462", "#f2844b", "#fca636", "#fcce25", "#f0f921"],
            12: ["#0d0887", "#3e049c", "#6300a7", "#8606a6", "#a62098", "#c03a83", "#d5546e", "#e76f5a", "#f68d45", "#fdae32", "#fcd225", "#f0f921"],
        }, YlGn: {
            2: ["#f7fcb9", "#31a354"],
            3: ["#f7fcb9", "#addd8e", "#31a354"],
            4: ["#ffffcc", "#c2e699", "#78c679", "#238443"],
            5: ["#ffffcc", "#c2e699", "#78c679", "#31a354", "#006837"],
            6: ["#ffffcc", "#d9f0a3", "#addd8e", "#78c679", "#31a354", "#006837"],
            7: ["#ffffcc", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#005a32"],
            8: ["#ffffe5", "#f7fcb9", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#005a32"],
            9: ["#ffffe5", "#f7fcb9", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#006837", "#004529"]
        }, YlGnBu: {
            2: ["#edf8b1", "#2c7fb8"],
            3: ["#edf8b1", "#7fcdbb", "#2c7fb8"],
            4: ["#ffffcc", "#a1dab4", "#41b6c4", "#225ea8"],
            5: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"],
            6: ["#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#2c7fb8", "#253494"],
            7: ["#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"],
            8: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"],
            9: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"]
        }, BuGn: {
            2: ["#e5f5f9", "#2ca25f"],
            3: ["#e5f5f9", "#99d8c9", "#2ca25f"],
            4: ["#edf8fb", "#b2e2e2", "#66c2a4", "#238b45"],
            5: ["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"],
            6: ["#edf8fb", "#ccece6", "#99d8c9", "#66c2a4", "#2ca25f", "#006d2c"],
            7: ["#edf8fb", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#005824"],
            8: ["#f7fcfd", "#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#005824"],
            9: ["#f7fcfd", "#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#006d2c", "#00441b"]
        }, PuBuGn: {
            2: ["#ece2f0", "#1c9099"],
            3: ["#ece2f0", "#a6bddb", "#1c9099"],
            4: ["#f6eff7", "#bdc9e1", "#67a9cf", "#02818a"],
            5: ["#f6eff7", "#bdc9e1", "#67a9cf", "#1c9099", "#016c59"],
            6: ["#f6eff7", "#d0d1e6", "#a6bddb", "#67a9cf", "#1c9099", "#016c59"],
            7: ["#f6eff7", "#d0d1e6", "#a6bddb", "#67a9cf", "#3690c0", "#02818a", "#016450"],
            8: ["#fff7fb", "#ece2f0", "#d0d1e6", "#a6bddb", "#67a9cf", "#3690c0", "#02818a", "#016450"],
            9: ["#fff7fb", "#ece2f0", "#d0d1e6", "#a6bddb", "#67a9cf", "#3690c0", "#02818a", "#016c59", "#014636"]
        }, BuPu: {
            2: ["#e0ecf4", "#8856a7"],
            3: ["#e0ecf4", "#9ebcda", "#8856a7"],
            4: ["#edf8fb", "#b3cde3", "#8c96c6", "#88419d"],
            5: ["#edf8fb", "#b3cde3", "#8c96c6", "#8856a7", "#810f7c"],
            6: ["#edf8fb", "#bfd3e6", "#9ebcda", "#8c96c6", "#8856a7", "#810f7c"],
            7: ["#edf8fb", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#6e016b"],
            8: ["#f7fcfd", "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#6e016b"],
            9: ["#f7fcfd", "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#810f7c", "#4d004b"]
        }, RdPu: {
            2: ["#fde0dd", "#c51b8a"],
            3: ["#fde0dd", "#fa9fb5", "#c51b8a"],
            4: ["#feebe2", "#fbb4b9", "#f768a1", "#ae017e"],
            5: ["#feebe2", "#fbb4b9", "#f768a1", "#c51b8a", "#7a0177"],
            6: ["#feebe2", "#fcc5c0", "#fa9fb5", "#f768a1", "#c51b8a", "#7a0177"],
            7: ["#feebe2", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177"],
            8: ["#fff7f3", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177"],
            9: ["#fff7f3", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177", "#49006a"]
        }, YlOrRd: {
            2: ["#ffeda0", "#f03b20"],
            3: ["#ffeda0", "#feb24c", "#f03b20"],
            4: ["#ffffb2", "#fecc5c", "#fd8d3c", "#e31a1c"],
            5: ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"],
            6: ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026"],
            7: ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"],
            8: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"],
            9: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"]
        }, Purples: {
            2: ["#efedf5", "#756bb1"],
            3: ["#efedf5", "#bcbddc", "#756bb1"],
            4: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#6a51a3"],
            5: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
            6: ["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#756bb1", "#54278f"],
            7: ["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"],
            8: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"],
            9: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"]
        }, Blues: {
            2: ["#deebf7", "#3182bd"],
            3: ["#deebf7", "#9ecae1", "#3182bd"],
            4: ["#eff3ff", "#bdd7e7", "#6baed6", "#2171b5"],
            5: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
            6: ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
            7: ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
            8: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
            9: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"]
        }, Greens: {
            2: ["#e5f5e0", "#31a354"],
            3: ["#e5f5e0", "#a1d99b", "#31a354"],
            4: ["#edf8e9", "#bae4b3", "#74c476", "#238b45"],
            5: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
            6: ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#31a354", "#006d2c"],
            7: ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"],
            8: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"],
            9: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"]
        }, Reds: {
            2: ["#fee0d2", "#de2d26"],
            3: ["#fee0d2", "#fc9272", "#de2d26"],
            4: ["#fee5d9", "#fcae91", "#fb6a4a", "#cb181d"],
            5: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
            6: ["#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#de2d26", "#a50f15"],
            7: ["#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d"],
            8: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d"],
            9: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"]
        }, Greys: {
            2: ["#f0f0f0", "#636363"],
            3: ["#f0f0f0", "#bdbdbd", "#636363"],
            4: ["#f7f7f7", "#cccccc", "#969696", "#525252"],
            5: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"],
            6: ["#f7f7f7", "#d9d9d9", "#bdbdbd", "#969696", "#636363", "#252525"],
            7: ["#f7f7f7", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525"],
            8: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525"],
            9: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"]
        }, PuOr: {
            2: ["#f1a340", "#998ec3"],
            3: ["#f1a340", "#f7f7f7", "#998ec3"],
            4: ["#e66101", "#fdb863", "#b2abd2", "#5e3c99"],
            5: ["#e66101", "#fdb863", "#f7f7f7", "#b2abd2", "#5e3c99"],
            6: ["#b35806", "#f1a340", "#fee0b6", "#d8daeb", "#998ec3", "#542788"],
            7: ["#b35806", "#f1a340", "#fee0b6", "#f7f7f7", "#d8daeb", "#998ec3", "#542788"],
            8: ["#b35806", "#e08214", "#fdb863", "#fee0b6", "#d8daeb", "#b2abd2", "#8073ac", "#542788"],
            9: ["#b35806", "#e08214", "#fdb863", "#fee0b6", "#f7f7f7", "#d8daeb", "#b2abd2", "#8073ac", "#542788"],
            10: ["#7f3b08", "#b35806", "#e08214", "#fdb863", "#fee0b6", "#d8daeb", "#b2abd2", "#8073ac", "#542788", "#2d004b"],
            11: ["#7f3b08", "#b35806", "#e08214", "#fdb863", "#fee0b6", "#f7f7f7", "#d8daeb", "#b2abd2", "#8073ac", "#542788", "#2d004b"]
        }, BrBG: {
            2: ["#d8b365", "#5ab4ac"],
            3: ["#d8b365", "#f5f5f5", "#5ab4ac"],
            4: ["#a6611a", "#dfc27d", "#80cdc1", "#018571"],
            5: ["#a6611a", "#dfc27d", "#f5f5f5", "#80cdc1", "#018571"],
            6: ["#8c510a", "#d8b365", "#f6e8c3", "#c7eae5", "#5ab4ac", "#01665e"],
            7: ["#8c510a", "#d8b365", "#f6e8c3", "#f5f5f5", "#c7eae5", "#5ab4ac", "#01665e"],
            8: ["#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#c7eae5", "#80cdc1", "#35978f", "#01665e"],
            9: ["#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e"],
            10: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
            11: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"]
        }, PRGn: {
            2: ["#af8dc3", "#7fbf7b"],
            3: ["#af8dc3", "#f7f7f7", "#7fbf7b"],
            4: ["#7b3294", "#c2a5cf", "#a6dba0", "#008837"],
            5: ["#7b3294", "#c2a5cf", "#f7f7f7", "#a6dba0", "#008837"],
            6: ["#762a83", "#af8dc3", "#e7d4e8", "#d9f0d3", "#7fbf7b", "#1b7837"],
            7: ["#762a83", "#af8dc3", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#7fbf7b", "#1b7837"],
            8: ["#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837"],
            9: ["#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837"],
            10: ["#40004b", "#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837", "#00441b"],
            11: ["#40004b", "#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837", "#00441b"]
        }, PiYG: {
            2: ["#e9a3c9", "#a1d76a"],
            3: ["#e9a3c9", "#f7f7f7", "#a1d76a"],
            4: ["#d01c8b", "#f1b6da", "#b8e186", "#4dac26"],
            5: ["#d01c8b", "#f1b6da", "#f7f7f7", "#b8e186", "#4dac26"],
            6: ["#c51b7d", "#e9a3c9", "#fde0ef", "#e6f5d0", "#a1d76a", "#4d9221"],
            7: ["#c51b7d", "#e9a3c9", "#fde0ef", "#f7f7f7", "#e6f5d0", "#a1d76a", "#4d9221"],
            8: ["#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221"],
            9: ["#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221"],
            10: ["#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419"],
            11: ["#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419"]
        }, RdBu: {
            2: ["#ef8a62", "#67a9cf"],
            3: ["#ef8a62", "#f7f7f7", "#67a9cf"],
            4: ["#ca0020", "#f4a582", "#92c5de", "#0571b0"],
            5: ["#ca0020", "#f4a582", "#f7f7f7", "#92c5de", "#0571b0"],
            6: ["#b2182b", "#ef8a62", "#fddbc7", "#d1e5f0", "#67a9cf", "#2166ac"],
            7: ["#b2182b", "#ef8a62", "#fddbc7", "#f7f7f7", "#d1e5f0", "#67a9cf", "#2166ac"],
            8: ["#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac"],
            9: ["#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac"],
            10: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"],
            11: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"]
        }, RdGy: {
            2: ["#ef8a62", "#999999"],
            3: ["#ef8a62", "#ffffff", "#999999"],
            4: ["#ca0020", "#f4a582", "#bababa", "#404040"],
            5: ["#ca0020", "#f4a582", "#ffffff", "#bababa", "#404040"],
            6: ["#b2182b", "#ef8a62", "#fddbc7", "#e0e0e0", "#999999", "#4d4d4d"],
            7: ["#b2182b", "#ef8a62", "#fddbc7", "#ffffff", "#e0e0e0", "#999999", "#4d4d4d"],
            8: ["#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#e0e0e0", "#bababa", "#878787", "#4d4d4d"],
            9: ["#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#ffffff", "#e0e0e0", "#bababa", "#878787", "#4d4d4d"],
            10: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#e0e0e0", "#bababa", "#878787", "#4d4d4d", "#1a1a1a"],
            11: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#ffffff", "#e0e0e0", "#bababa", "#878787", "#4d4d4d", "#1a1a1a"]
        }, RdYlBu: {
            2: ["#fc8d59", "#91bfdb"],
            3: ["#fc8d59", "#ffffbf", "#91bfdb"],
            4: ["#d7191c", "#fdae61", "#abd9e9", "#2c7bb6"],
            5: ["#d7191c", "#fdae61", "#ffffbf", "#abd9e9", "#2c7bb6"],
            6: ["#d73027", "#fc8d59", "#fee090", "#e0f3f8", "#91bfdb", "#4575b4"],
            7: ["#d73027", "#fc8d59", "#fee090", "#ffffbf", "#e0f3f8", "#91bfdb", "#4575b4"],
            8: ["#d73027", "#f46d43", "#fdae61", "#fee090", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4"],
            9: ["#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4"],
            10: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"],
            11: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"]
        }, Spectral: {
            2: ["#fc8d59", "#99d594"],
            3: ["#fc8d59", "#ffffbf", "#99d594"],
            4: ["#d7191c", "#fdae61", "#abdda4", "#2b83ba"],
            5: ["#d7191c", "#fdae61", "#ffffbf", "#abdda4", "#2b83ba"],
            6: ["#d53e4f", "#fc8d59", "#fee08b", "#e6f598", "#99d594", "#3288bd"],
            7: ["#d53e4f", "#fc8d59", "#fee08b", "#ffffbf", "#e6f598", "#99d594", "#3288bd"],
            8: ["#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#e6f598", "#abdda4", "#66c2a5", "#3288bd"],
            9: ["#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd"],
            10: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"],
            11: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"]
        }, RdYlGn: {
            2: ["#fc8d59", "#91cf60"],
            3: ["#fc8d59", "#ffffbf", "#91cf60"],
            4: ["#d7191c", "#fdae61", "#a6d96a", "#1a9641"],
            5: ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"],
            6: ["#d73027", "#fc8d59", "#fee08b", "#d9ef8b", "#91cf60", "#1a9850"],
            7: ["#d73027", "#fc8d59", "#fee08b", "#ffffbf", "#d9ef8b", "#91cf60", "#1a9850"],
            8: ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"],
            9: ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"],
            10: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"],
            11: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"]
        }, Accent: {
            2: ["#7fc97f", "#beaed4"],
            3: ["#7fc97f", "#beaed4", "#fdc086"],
            4: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99"],
            5: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0"],
            6: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0", "#f0027f"],
            7: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0", "#f0027f", "#bf5b17"],
            8: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0", "#f0027f", "#bf5b17", "#666666"]
        }, Dark2: {
            2: ["#1b9e77", "#d95f02"],
            3: ["#1b9e77", "#d95f02", "#7570b3"],
            4: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a"],
            5: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e"],
            6: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02"],
            7: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d"],
            8: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"]
        }, Paired: {
            2: ["#a6cee3", "#1f78b4"],
            3: ["#a6cee3", "#1f78b4", "#b2df8a"],
            4: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"],
            5: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99"],
            6: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c"],
            7: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f"],
            8: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00"],
            9: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6"],
            10: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"],
            11: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99"],
            12: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"]
        }, Pastel1: {
            2: ["#fbb4ae", "#ccebc5"],
            3: ["#fbb4ae", "#b3cde3", "#ccebc5"],
            4: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4"],
            5: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6"],
            6: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc"],
            7: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd"],
            8: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec"],
            9: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec", "#f2f2f2"]
        }, Pastel2: {
            2: ["#b3e2cd", "#cbd5e8"],
            3: ["#b3e2cd", "#fdcdac", "#cbd5e8"],
            4: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4"],
            5: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9"],
            6: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9", "#fff2ae"],
            7: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9", "#fff2ae", "#f1e2cc"],
            8: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9", "#fff2ae", "#f1e2cc", "#cccccc"]
        }, Set1: {
            2: ["#e41a1c", "#377eb8"],
            3: ["#e41a1c", "#377eb8", "#4daf4a"],
            4: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3"],
            5: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00"],
            6: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33"],
            7: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628"],
            8: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf"],
            9: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf", "#999999"]
        }, Set2: {
            2: ["#66c2a5", "#fc8d62"],
            3: ["#66c2a5", "#fc8d62", "#8da0cb"],
            4: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3"],
            5: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854"],
            6: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f"],
            7: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494"],
            8: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"]
        }, Set3: {
            2: ["#8dd3c7", "#ffffb3"],
            3: ["#8dd3c7", "#ffffb3", "#bebada"],
            4: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072"],
            5: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3"],
            6: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462"],
            7: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69"],
            8: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5"],
            9: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9"],
            10: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd"],
            11: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5"],
            12: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"]
        }
    };
})(OpenSeadragon);

(function($) {
    /**
     * Organizer of ShaderLayers.
     *
     * @property {object} _layers           storage of ShaderLayers, {ShaderLayer.type(): ShaderLayer}
     * @property {Boolean} _acceptsShaders  allow new ShaderLayer registrations
     *
     * @class OpenSeadragon.FlexRenderer.ShaderMediator
     * @memberOf OpenSeadragon.FlexRenderer
     */
    $.FlexRenderer.ShaderMediator = class {
        /**
         * Register ShaderLayer.
         * @param {typeof OpenSeadragon.FlexRenderer.ShaderLayer} shaderLayer
         */
        static registerLayer(shaderLayer) {
            if (this._acceptsShaders) {
                if (this._layers[shaderLayer.type()]) {
                    console.warn(`OpenSeadragon.FlexRenderer.ShaderMediator::registerLayer: ShaderLayer ${shaderLayer.type()} already registered, overwriting the content!`);
                }
                this._layers[shaderLayer.type()] = shaderLayer;
            } else {
                console.warn("OpenSeadragon.FlexRenderer.ShaderMediator::registerLayer: ShaderMediator is set to not accept new ShaderLayers!");
            }
        }

        /**
         * Enable or disable ShaderLayer registrations.
         * @param {Boolean} accepts
         */
        static setAcceptsRegistrations(accepts) {
            if (accepts === true || accepts === false) {
                this._acceptsShaders = accepts;
            } else {
                console.warn("OpenSeadragon.FlexRenderer.ShaderMediator::setAcceptsRegistrations: Accepts parameter must be either true or false!");
            }
        }

        /**
         * Get the ShaderLayer implementation.
         * @param {String} shaderType equals to a wanted ShaderLayers.type()'s return value
         * @return {typeof OpenSeadragon.FlexRenderer.ShaderLayer}
         */
        static getClass(shaderType) {
            return this._layers[shaderType];
        }

        /**
         * Get all available ShaderLayers.
         * @return {[typeof OpenSeadragon.FlexRenderer.ShaderLayer]}
         */
        static availableShaders() {
            return Object.values(this._layers);
        }

        /**
         * Get all available ShaderLayer types.
         * @return {[String]}
         */
        static availableTypes() {
            return Object.keys(this._layers);
        }
    };
    // STATIC PROPERTIES
    $.FlexRenderer.ShaderMediator._acceptsShaders = true;
    $.FlexRenderer.ShaderMediator._layers = {};



    /**
     * Interface for classes that implement any rendering logic and are part of the final WebGLProgram.
     *
     * @property {Object} defaultControls default controls for the ShaderLayer
     * @property {Object} customParams
     * @property {Object} modes
     * @property {Object} filters
     * @property {Object} filterNames
     * @property {Object} __globalIncludes
     *
     * @interface OpenSeadragon.FlexRenderer.ShaderLayer
     * @memberOf OpenSeadragon.FlexRenderer
     */
    $.FlexRenderer.ShaderLayer = class {
        /**
         * @typedef channelSettings
         * @type {Object}
         * @property {Function} acceptsChannelCount
         * @property {String} description
         */

        /**
         * @param {String} id unique identifier
         * @param {Object} privateOptions
         * @param {Object} privateOptions.shaderConfig              object bind with this ShaderLayer
         * @param {WebGLImplementation} privateOptions.webglContext
         * @param {Object} privateOptions.cache
         * @param {Function} privateOptions.invalidate  // callback to re-render the viewport
         * @param {Function} privateOptions.rebuild     // callback to rebuild the WebGL program
         * @param {Function} privateOptions.refetch     // callback to reinitialize the whole WebGLDrawer; NOT USED
         *
         * @constructor
         * @memberOf FlexRenderer.ShaderLayer
         */
        constructor(id, privateOptions) {
            // unique identifier of this ShaderLayer for FlexRenderer
            this.id = id;
            // unique identifier of this ShaderLayer for WebGLProgram
            this.uid = this.constructor.type().replaceAll('-', '_') + '_' + id;
            if (!$.FlexRenderer.idPattern.test(this.uid)) {
                console.error(`Invalid ID for the shader: ${id} does not match to the pattern`, $.FlexRenderer.idPattern);
            }

            this.__shaderConfig = privateOptions.shaderConfig;
            this.webglContext = privateOptions.webglContext;
            this._interactive = privateOptions.interactive;
            this._customControls = privateOptions.params ? privateOptions.params : {};


            this.invalidate = privateOptions.invalidate;
            this._rebuild = privateOptions.rebuild;
            this._refetch = privateOptions.refetch;
            this._controls = {};

            // channels used for sampling data from the texture
            this.__channels = null;
            // which blend mode is being used
            this._mode = null;
            // parameters used for applying filters
            this.__scalePrefix = null;
            this.__scaleSuffix = null;
        }

        /**
         * Manuall constructor for ShaderLayer. Keeped for backward compatibility.
         */
        construct() {
            // Default init respects cached value, manual usage overrides.

            // set up the color channel(s) for texture sampling
            this.resetChannel(this._customControls, false);
            // set up the blending mode
            this.resetMode(this._customControls, false);
            // set up the filters to be applied to sampled data from the texture
            this.resetFilters(this._customControls, false);
            // build the ShaderLayer's controls
            this._buildControls();
        }

        // STATIC METHODS
        /**
         * Parses value to a float string representation with given precision (length after decimal)
         * @param {number} value value to convert
         * @param {number} defaultValue default value on failure
         * @param {number} precisionLen number of decimals
         * @return {string}
         */
        static toShaderFloatString(value, defaultValue, precisionLen = 5) {
            if (!Number.isInteger(precisionLen) || precisionLen < 0 || precisionLen > 9) {
                precisionLen = 5;
            }
            try {
                return value.toFixed(precisionLen);
            } catch (e) {
                return defaultValue.toFixed(precisionLen);
            }
        }

        // METHODS TO (re)IMPLEMENT WHEN EXTENDING
        /**
         * @returns {String} key under which is the shader registered, should be unique!
         */
        static type() {
            throw "ShaderLayer::type() must be implemented!";
        }

        /**
         * @returns {String} name of the ShaderLayer (user-friendly)
         */
        static name() {
            throw "ShaderLayer::name() must be implemented!";
        }

        /**
         * @returns {String} optional description
         */
        static description() {
            return "No description of the ShaderLayer.";
        }

        /**
         * Declare the object for channel settings. One for each data source (NOT USED, ALWAYS RETURNS ARRAY OF ONE OBJECT; for backward compatibility the array is returned)
         * @returns {[channelSettings]}
         */
        static sources() {
            throw "ShaderLayer::sources() must be implemented!";
        }

        /**
         * Declare supported controls by a particular shader,
         * each control defined this way is automatically created for the shader.
         *
         * Structure:
         * get defaultControls () => {
         *     controlName: {
                   default: {type: <>, title: <>, default: <>, interactive: true|false, ...},
                   accepts: (type, instance) => <>,
                   required: {type: <>, ...} [OPTIONAL]
         *     }, ...
         * }
         *
         * use: controlId: false to disable a specific control (e.g. all shaders
         *  support opacity by default - use to remove this feature)
         *
         *
         * Additionally, use_[...] value can be specified, such controls enable shader
         * to specify default or required values for built-in use_[...] params. Example:
         * {
         *     use_channel0: {
         *         default: "bg"
         *     },
         *     use_channel1: {
         *         required: "rg"
         *     },
         *     use_gamma: {
         *         default: 0.5
         *     },
         * }
         * reads by default for texture 1 channels 'bg', second texture is always forced to read 'rg',
         * textures apply gamma filter with 0.5 by default if not overridden
         * todo: allow also custom object without structure being specified (use in custom manner,
         *  but limited in automated docs --> require field that summarises its usage)
         *
         * @member {object}
         */
        static get defaultControls() {
            return {
                opacity: {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
                    accepts: (type, instance) => type === "float"
                }
            };
        }

        /**
         * Code executed to create the output color. The code
         * must always return a vec4 value, otherwise the program
         * will fail to compile (this code actually runs inside a glsl vec4 function() {...here...}).
         *
         * DO NOT SAMPLE TEXTURE MANUALLY: use this.sampleChannel(...) to generate the sampling code
         *
         * @return {string}
         */
        getFragmentShaderExecution() {
            throw "ShaderLayer::getFragmentShaderExecution must be implemented!";
        }

        /**
         * Code placed outside fragment shader's main function.
         * By default, it includes all definitions of controls defined in this.defaultControls.
         *
         * ANY VARIABLE NAME USED IN THIS FUNCTION MUST CONTAIN UNIQUE ID: this.uid
         * DO NOT SAMPLE TEXTURE MANUALLY: use this.sampleChannel(...) to generate the sampling code
         * WHEN OVERRIDING, INCLUDE THE OUTPUT OF THIS METHOD AT THE BEGINNING OF THE NEW OUTPUT.
         *
         * @return {string} glsl code
         */
        getFragmentShaderDefinition() {
            const glsl = [];

            for (const controlName in this._controls) {
                let code = this[controlName].define();
                if (code) {
                    // trim removes whitespace from beggining and the end of the string
                    glsl.push(code.trim());
                }
            }
            return glsl.join("\n    ");
        }

        /**
         * Initialize the ShaderLayer's controls.
         */
        init() {
            for (const controlName in this._controls) {
                const control = this[controlName];
                control.init();
            }
        }

        // CONTROLs LOGIC
        /**
         * Build the ShaderLayer's controls.
         */
        _buildControls() {
            const defaultControls = this.constructor.defaultControls;

            // add opacity control manually to every ShaderLayer; if not already defined
            if (defaultControls.opacity === undefined || (typeof defaultControls.opacity === "object" && !defaultControls.opacity.accepts("float"))) {
                defaultControls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
                    accepts: (type, instance) => type === "float"
                };
            }

            for (let controlName in defaultControls) {
                // with use_ prefix are defined not UI controls but filters, blend modes, etc.
                if (controlName.startsWith("use_")) {
                    continue;
                }

                // control is manually disabled
                const controlConfig = defaultControls[controlName];
                if (controlConfig === false) {
                    continue;
                }

                const control = $.FlexRenderer.UIControls.build(this, controlName, controlConfig, this.id + '_' + controlName, this._customControls[controlName]);
                // enables iterating over the owned controls
                this._controls[controlName] = control;
                // simplify usage of controls (e.g. this.opacity instead of this._controls.opacity)
                this[controlName] = control;
            }
        }

        /**
         * Get HTML code of the ShaderLayer's controls.
         * @returns {String} HTML code
         */
        htmlControls(wrapper = null, classes = "", css = "") {
            let controlsHtmls = [];
            for (const controlName in this._controls) {
                const control = this[controlName];
                controlsHtmls.push(control.toHtml(classes, css));
            }
            if (wrapper) {
                controlsHtmls = controlsHtmls.map(wrapper);
            }
            return controlsHtmls.join("");
        }

        /**
         * Remove all ShaderLayer's controls.
         */
        removeControls() {
            for (const controlName in this._controls) {
                this.removeControl(controlName);
            }
        }

        /**
         * @param {String} controlName name of the control to remove
         */
        removeControl(controlName) {
            if (!this._controls[controlName]) {
                return;
            }
            delete this._controls[controlName];
            delete this[controlName];
        }

        // GLSL LOGIC (getFragmentShaderDefinition and getFragmentShaderExecution could also have been placed in this section)
        /**
         * Called from the the WebGLImplementation's loadProgram function.
         * For every control owned by this ShaderLayer connect control.glLocation attribute to it's corresponding glsl variable.
         * @param {WebGLProgram} program
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         */
        glLoaded(program, gl) {
            for (const controlName in this._controls) {
                this[controlName].glLoaded(program, gl);
            }
        }

        /**
         * Called from the the WebGLImplementation's useProgram function.
         * For every control owned by this ShaderLayer fill it's corresponding glsl variable.
         * @param {WebGLProgram} program WebglProgram instance
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl WebGL Context
         */
        glDrawing(program, gl) {
            for (const controlName in this._controls) {
                this[controlName].glDrawing(program, gl);
            }
        }

        /**
         * Include GLSL shader code on global scope (e.g. define function that is repeatedly used).
         * @param {String} key a key under which is the code stored
         * @param {String} code GLSL code to add to the WebGL shader
         */
        includeGlobalCode(key, code) {
            const container = this.constructor.__globalIncludes;
            if (container[key]) {
                console.warn('$.FlexRenderer.ShaderLayer::includeGlobalCode: Global code with key', key, 'already exists in this.__globalIncludes. Overwriting the content!');
            }
            container[key] = code;
        }

        /**
         * Called when shader is destructed
         */
        destroy() {
        }

        /**
         * Proxy cache to the config object. The config object stores the cached values, which keeps consistent state.
         * @return {Object}
         */
        get cache() {
            return this.__shaderConfig.cache;
        }

        // CACHE LOGIC
        /**
         * Load value from the cache, return default value if not found.
         *
         * @param {String} name
         * @param {String} defaultValue
         * @return {String}
         */
        loadProperty(name, defaultValue) {
            const value = this.cache[name];
            return value !== undefined ? value : defaultValue;
        }

        /**
         * Store value in the cache.
         * @param {String} name
         * @param {String} value
         */
        storeProperty(name, value) {
            this.cache[name] = value;
        }

        // TEXTURE SAMPLING LOGIC
        /**
         * Set color channel(s) for texture sampling.
         * @param {Object} options
         * @param {String} options.use_channel[X] "r", "g" or "b" channel to sample index X, default "r"
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetChannel(options = {}, force = true) {
            if (Object.keys(options) === 0) {
                options = this._customControls;
            }

            // regex to compare with value used with use_channel, to check its correctness
            const channelPattern = new RegExp('[rgba]{1,4}');
            const parseChannel = (controlName, def, sourceDef) => {
                const predefined = this.constructor.defaultControls[controlName];

                if (options[controlName] || predefined) {
                    let channel = predefined && predefined.required;
                    if (!channel) {
                        channel = force ? options[controlName] :
                            this.loadProperty(controlName, options[controlName] || predefined.default);
                    }

                    // (if channel is not defined) or (is defined and not string) or (is string and doesn't contain __channelPattern)
                    if (!channel || typeof channel !== "string" || channelPattern.exec(channel) === null) {
                        console.warn(`Invalid channel '${controlName}'. Will use channel '${def}'.`, channel, options);
                        this.storeProperty(controlName, def);
                        channel = predefined.default || def;
                    }

                    if (!sourceDef.acceptsChannelCount(channel.length)) {
                        console.warn(`${this.constructor.name()} does not support channel length ${channel.length} for channel: ${channel}. Using default.`);
                        this.storeProperty(controlName, def);
                        channel = predefined.default || def;

                        // if def is not compatible with the channel count, try to stack it
                        if (!sourceDef.acceptsChannelCount(channel.length)) {
                            channel = def;
                            console.warn(`${this.constructor.name()} does not support channel length ${channel.length} for channel: ${channel}. Using default.`);
                            while (channel.length < 5 && !sourceDef.acceptsChannelCount(channel.length)) {
                                channel += def;
                            }
                            this.storeProperty(controlName, channel);
                        }
                    }

                    if (channel !== options[controlName]) {
                        this.storeProperty(controlName, channel);
                    }
                    return channel;
                }
                return def;
            };

            this.__channels = this.constructor.sources().map((source, i) => parseChannel(`use_channel${i}`, "r", source));
        }

        /**
         * Method for texture sampling with applied channel restrictions and filters.
         *
         * @param {String} textureCoords valid GLSL vec2 object
         * @param {Number} otherDataIndex UNUSED; index of the data source, for backward compatibility left here
         * @param {Boolean} raw whether to output raw value from the texture (do not apply filters)
         *
         * @return {String} glsl code for correct texture sampling within the ShaderLayer's methods for generating glsl code (e.g. getFragmentShaderExecution)
         */
        sampleChannel(textureCoords, otherDataIndex = 0, raw = false) {
            const chan = this.__channels[otherDataIndex];
            let sampled = `${this.webglContext.sampleTexture(otherDataIndex, textureCoords)}.${chan}`;

            if (raw) {
                return sampled;
            }
            return this.filter(sampled);
        }

        /**
         *
         * @param otherDataIndex
         * @return {never}
         */
        getTextureSize(otherDataIndex = 0) {
            return this.webglContext.getTextureSize(otherDataIndex);
        }


        // BLENDING LOGIC
        /**
         * Set blending mode.
         * @param {Object} options
         * @param {String} options.use_mode rendering mode to use: one of supportedUseModes
         * @param {String} options.use_blend blending mode to use: one of standard supported blending modes (+ "mask")
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetMode(options = {}, force = true) {
            this._mode = this._resetOption("use_mode", this.webglContext.supportedUseModes, options, force);
            this._blend = this._resetOption("use_blend", OpenSeadragon.FlexRenderer.BLEND_MODE, options, force);
        }

        _resetOption(name, supportedValueList, options = {}, force = true) {
            let result;
            if (!options) {
                options = this._customControls;
            }

            const predefined = this.constructor.defaultControls[name];
            // if required, set mode to required
            result = predefined && predefined.required;

            if (!result) {
                let dynamicValue = options[name];
                if (name === "use_mode") {
                    // Supporting legacy names
                    if (dynamicValue === "mask") {
                        dynamicValue = "blend";
                        $.console.warn("OpenSeadragon.FlexRenderer.ShaderLayer: use_mode 'mask' is deprecated, use 'blend' instead.");
                    }
                    if (dynamicValue === "mask_clip") {
                        dynamicValue = "clip";
                        $.console.warn("OpenSeadragon.FlexRenderer.ShaderLayer: use_mode 'mask_clip' is deprecated, use 'clip' instead.");
                    }
                }

                if (dynamicValue) {
                    // firstly try to load from cache, if not in cache, use options.use_mode
                    result = force ? dynamicValue : this.loadProperty(name, dynamicValue);

                    // if mode was not in the cache and we got default value = options.use_mode, store it in the cache
                    if (result === dynamicValue) {
                        this.storeProperty(name, result);
                    }
                } else {
                    result = (predefined && predefined.default) || supportedValueList[0];
                }
            }

            if (!supportedValueList.includes(result)) {
                $.console.warn(`Invalid ${name}: ${result}. Using default`, supportedValueList[0]);
                return supportedValueList[0];
            }
            return result;
        }

        /**
         * @returns {String} GLSL code of the custom blend function
         * TODO configurable...
         */
        getCustomBlendFunction(functionName) {
            let code = this.webglContext.getBlendingFunction(this._blend);
            if (!code) {
                $.console.warn("Invalid blending - using default", this._blend, this);
                // Set to mask, typical wanted value if mode is not show. If mode=show, there is a hardcoded blend function.
                this._blend = 'blend';
                code = this.webglContext.getBlendingFunction(this._blend);
            }
            return `vec4 ${functionName}(vec4 fg, vec4 bg) {
${code}
}`;
        }

        /**
         * Get JSON configuration
         * @return {ShaderConfig}
         */
        getConfig() {
            return this.__shaderConfig;
        }

        // FILTERS LOGIC
        /**
         * Set filters for a ShaderLayer.
         * @param {Object} options contains filters to apply, currently supported are "use_gamma", "use_exposure", "use_logscale"
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetFilters(options = {}, force = true) {
            if (Object.keys(options) === 0) {
                options = this._customControls;
            }

            this.__scalePrefix = [];
            this.__scaleSuffix = [];
            for (let key in this.constructor.filters) {
                const predefined = this.constructor.defaultControls[key];
                let value = predefined ? predefined.required : undefined;
                if (value === undefined) {
                    if (options[key]) {
                        value = force ? options[key] : this.loadProperty(key, options[key]);
                    } else {
                        value = predefined ? predefined.default : undefined;
                    }
                }

                if (value !== undefined) {
                    let filter = this.constructor.filters[key](value);
                    this.__scalePrefix.push(filter[0]);
                    this.__scaleSuffix.push(filter[1]);
                }
            }
            this.__scalePrefix = this.__scalePrefix.join("");
            this.__scaleSuffix = this.__scaleSuffix.reverse().join("");
        }

        /**
         * Apply global filters on value
         * @param {String} value GLSL code string, value to filter
         * @return {String} filtered value (GLSL oneliner without ';')
         */
        filter(value) {
            return `${this.__scalePrefix}${value}${this.__scaleSuffix}`;
        }

        /**
         * Set filter value
         * @param filter filter name
         * @param value value of the filter
         */
        setFilterValue(filter, value) {
            if (!this.constructor.filterNames[filter]) {
                console.error("Invalid filter name", filter);
                return;
            }
            this.storeProperty(filter, value);
        }

        /**
         * Get the filter value (alias for loadProperty(...)
         * @param {String} filter filter to read the value of
         * @param {String} defaultValue
         * @return {String} stored filter value or defaultValue if no value available
         */
        getFilterValue(filter, defaultValue) {
            return this.loadProperty(filter, defaultValue);
        }



        // UTILITIES
        /**
         * Evaluates option flag, e.g. any value that indicates boolean 'true'
         * @param {*} value value to interpret
         * @return {Boolean} true if the value is considered boolean 'true'
         */
        isFlag(value) {
            return value === "1" || value === true || value === "true";
        }

        isFlagOrMissing(value) {
            return value === undefined || this.isFlag(value);
        }

        /**
         * Parses value to a float string representation with given precision (length after decimal)
         * @param {Number} value value to convert
         * @param {Number} defaultValue default value on failure
         * @param {Number} precisionLen number of decimals
         * @return {String}
         */
        toShaderFloatString(value, defaultValue, precisionLen = 5) {
            return this.constructor.toShaderFloatString(value, defaultValue, precisionLen);
        }

        /**
         * Get the blend mode.
         * @return {String}
         */
        get mode() {
            return this._mode;
        }
    };

    /**
     * Declare custom parameters for documentation purposes.
     * Can set default values to provide sensible defaults.
     * Requires only 'usage' parameter describing the use.
     * Unlike controls, these values are not processed in any way.
     * Of course you don't have to define your custom parameters,
     * but then these won't be documented in any nice way. Note that
     * the value can be an object, or a different value (e.g., an array)
     * {
     *     customParamId: {
     *         default: {myItem: 1, myValue: "string" ...}, [OPTIONAL]
     *         usage: "This parameter can be used like this and that.",
     *         required: {type: <> ...} [OPTIONAL]
     *     }, ...
     * }
     * @type {any}
     */
    $.FlexRenderer.ShaderLayer.customParams = {};

    /**
     * Parameter to save shaderLayer's functionality that can be shared and reused between ShaderLayer instantions.
     */
    $.FlexRenderer.ShaderLayer.__globalIncludes = {};


    //not really modular
    //add your filters here if you want... function that takes parameter (number)
    //and returns prefix and suffix to compute oneliner filter
    //should start as 'use_[name]' for namespace collision avoidance (params object)
    //expression should be wrapped in parenthesses for safety: ["(....(", ")....)"] in the middle the
    // filtered variable will be inserted, notice pow does not need inner brackets since its an argument...
    //note: pow avoided in gamma, not usable on vectors, we use pow(x, y) === exp(y*log(x))
    // TODO: implement filters as shader nodes instead!
    $.FlexRenderer.ShaderLayer.filters = {};
    $.FlexRenderer.ShaderLayer.filters["use_gamma"] = (x) => ["exp(log(", `) / ${$.FlexRenderer.ShaderLayer.toShaderFloatString(x, 1)})`];
    $.FlexRenderer.ShaderLayer.filters["use_exposure"] = (x) => ["(1.0 - exp(-(", `)* ${$.FlexRenderer.ShaderLayer.toShaderFloatString(x, 1)}))`];
    $.FlexRenderer.ShaderLayer.filters["use_logscale"] = (x) => {
        x = $.FlexRenderer.ShaderLayer.toShaderFloatString(x, 1);
        return [`((log(${x} + (`, `)) - log(${x})) / (log(${x}+1.0)-log(${x})))`];
    };

    $.FlexRenderer.ShaderLayer.filterNames = {};
    $.FlexRenderer.ShaderLayer.filterNames["use_gamma"] = "Gamma";
    $.FlexRenderer.ShaderLayer.filterNames["use_exposure"] = "Exposure";
    $.FlexRenderer.ShaderLayer.filterNames["use_logscale"] = "Logarithmic scale";
})(OpenSeadragon);

(function($) {
/**
 * Factory Manager for predefined UIControls
 *  - you can manage all your UI control logic within your shader implementation
 *  and not to touch this class at all, but here you will find some most common
 *  or some advanced controls ready to use, simple and powerful
 *  - registering an IComponent implementation (or an UiElement) in the factory results in its support
 *  among all the shaders (given the GLSL type, result of sample(...) matches).
 *  - UiElements are objects to create simple controls quickly and get rid of code duplicity,
 *  for more info @see OpenSeadragon.FlexRenderer.UIControls.register()
 * @class OpenSeadragon.FlexRenderer.UIControls
 */
$.FlexRenderer.UIControls = class {
    /**
     * Get all available control types
     * @return {string[]} array of available control types
     */
    static types() {
        return Object.keys(this._items).concat(Object.keys(this._impls));
    }

    /**
     * Get an element used to create simple controls, if you want
     * an implementation of the controls themselves (IControl), use build(...) to instantiate
     * @param {string} id type of the control
     * @return {*}
     */
    static getUiElement(id) {
        let ctrl = this._items[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._items["number"];
        }
        return ctrl;
    }

    /**
     * Get an element used to create advanced controls, if you want
     * an implementation of simple controls, use build(...) to instantiate
     * @param {string} id type of the control
     * @return {OpenSeadragon.FlexRenderer.UIControls.IControl}
     */
    static getUiClass(id) {
        let ctrl = this._impls[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._impls["colormap"];
        }
        return ctrl;
    }

    /**
     * Build UI control object based on given parameters
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} owner owner of the control, shaderLayer
     * @param {string} controlName name used for the control (eg.: opacity)
     * @param {object} controlObject object from shaderLayer.defaultControls, defines control
     * @param {string} controlId
     * @param {object|*} customParams parameters passed to the control (defined by the control) or set as default value if not object ({})
     * @return {OpenSeadragon.FlexRenderer.UIControls.IControl}
     */
    static build(owner, controlName, controlObject, controlId, customParams = {}) {
        let defaultParams = controlObject.default,
            accepts = controlObject.accepts,
            requiredParams = controlObject.required === undefined ? {} : controlObject.required;

        let interactivityEnabled = owner._interactive;

        // if not an object, but a value, make it the default one
        if (!(typeof customParams === 'object')) {
            customParams = {default: customParams};
        }
        //must be false if HTML nodes are not managed
        if (!interactivityEnabled) {
            customParams.interactive = false;
        }

        let originalType = defaultParams.type;

        // merge dP < cP < rP recursively with rP having the biggest overwriting priority, without modifying the original objects
        const params = $.extend(true, {}, defaultParams, customParams, requiredParams);

        if (!this._items[params.type]) {
            const controlType = params.type;

            // if cannot use the new control type, try to use the default one
            if (!this._impls[controlType]) {
                return this._buildFallback(controlType, originalType, owner, controlName, controlObject, params);
            }

            let cls = new this._impls[controlType](owner, controlName, controlId, params);

            if (accepts(cls.type, cls)) {
                return cls;
            }

            // cannot built with custom implementation, try to build with a default one
            return this._buildFallback(controlType, originalType, owner, controlName, controlObject, params);

        } else { // control's type (eg.: range/number/...) is defined in this._items
            let intristicComponent = this.getUiElement(params.type);
            let comp = new $.FlexRenderer.UIControls.SimpleUIControl(
                owner, controlName, controlId, params, intristicComponent
            );

            if (accepts(comp.type, comp)) {
                return comp;
            }
            return this._buildFallback(intristicComponent.glType, originalType,
                owner, controlName, controlObject, params);
        }
    }

    static _buildFallback(newType, originalType, owner, controlName, controlObject, customParams) {
        //repeated check when building object from type

        customParams.interactive = false;
        if (originalType === newType) { //if default and new equal, fail - recursion will not help
            console.error(`Invalid parameter in shader '${customParams.type}': the parameter could not be built.`);
            return undefined;
        } else { //otherwise try to build with originalType (default)
            customParams.type = originalType;
            console.warn("Incompatible UI control type '" + newType + "': making the input non-interactive.");
            return this.build(owner, controlName, controlObject, customParams);
        }
    }

    /**
     * Register simple UI element by providing necessary object
     * implementation:
     *  { defaults: function() {...}, // object with all default values for all supported parameters
         html: function(uniqueId, params, classes="", css="") {...}, //how the HTML UI controls look like
        glUniformFunName: function() {...}, //what function webGL uses to pass this attribute to GPU
        decode: function(fromValue) {...}, //parse value obtained from HTML controls into something
                                                gl[glUniformFunName()](...) can pass to GPU
        glType: //what's the type of this parameter wrt. GLSL: int? vec3?
     * @param type the identifier under which is this control used: lookup made against params.type
     * @param uiElement the object to register, fulfilling the above-described contract
     */
    static register(type, uiElement) {
        function check(el, prop, desc) {
            if (!el[prop]) {
                console.warn(`Skipping UI control '${type}' due to '${prop}': missing ${desc}.`);
                return false;
            }
            return true;
        }

        if (check(uiElement, "defaults", "defaults():object") &&
            check(uiElement, "html", "html(uniqueId, params, css):htmlString") &&
            check(uiElement, "glUniformFunName", "glUniformFunName():string") &&
            check(uiElement, "decode", "decode(encodedValue):<compatible with glType>") &&
            check(uiElement, "normalize", "normalize(value, params):<typeof value>") &&
            check(uiElement, "sample", "sample(value, valueGlType):glslString") &&
            check(uiElement, "glType", "glType:string")
        ) {
            uiElement.prototype.getName = () => type;
            if (this._items[type]) {
                console.warn("Registering an already existing control component: ", type);
            }
            uiElement["uiType"] = type;
            this._items[type] = uiElement;
        }
    }

    /**
     * Register class as a UI control
     * @param {string} type unique control name / identifier
     * @param {OpenSeadragon.FlexRenderer.UIControls.IControl} cls to register, implementation class of the controls
     */
    static registerClass(type, cls) {
        //todo not really possible with syntax checker :/
        // if ($.FlexRenderer.UIControls.IControl.isPrototypeOf(cls)) {
        cls.prototype.getName = () => type;

        if (this._items[type]) {
            console.warn("Registering an already existing control component: ", type);
        }
        cls._uiType = type;
        this._impls[type] = cls;
        // } else {
        //     console.warn(`Skipping UI control '${type}': does not inherit from $.FlexRenderer.UIControls.IControl.`);
        // }
    }
};

// Definitions of possible controls' types, simple functionalities:
$.FlexRenderer.UIControls._items = {
    number: {
        defaults: function() {
            return {title: "Number", interactive: true, default: 0, min: 0, max: 100, step: 1};
        },
        // returns string corresponding to html code for injection
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input class="${classes}" style="${css}" min="${params.min}" max="${params.max}"
step="${params.step}" type="number" id="${uniqueId}">`;
        },
        glUniformFunName: function() {
            return "uniform1f";
        },
        decode: function(fromValue) {
            return Number.parseFloat(fromValue);
        },
        normalize: function(value, params) {
            return (value - params.min) / (params.max - params.min);
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "float",
        uiType: "number"
    },

    range: {
        defaults: function() {
            return {title: "Range", interactive: true, default: 0, min: 0, max: 100, step: 1};
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input type="range" style="${css}"
class="${classes}" min="${params.min}" max="${params.max}" step="${params.step}" id="${uniqueId}">`;
        },
        glUniformFunName: function() {
            return "uniform1f";
        },
        decode: function(fromValue) {
            return Number.parseFloat(fromValue);
        },
        normalize: function(value, params) {
            return (value - params.min) / (params.max - params.min);
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "float",
        uiType: "range"
    },

    color: {
        defaults: function() {
            return { title: "Color", interactive: true, default: "#fff900" };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input type="color" id="${uniqueId}" style="${css}" class="${classes}">`;
        },
        glUniformFunName: function() {
            return "uniform3fv";
        },
        decode: function(fromValue) {
            try {
                let index = fromValue.startsWith("#") ? 1 : 0;
                return [
                    parseInt(fromValue.slice(index, index + 2), 16) / 255,
                    parseInt(fromValue.slice(index + 2, index + 4), 16) / 255,
                    parseInt(fromValue.slice(index + 4, index + 6), 16) / 255
                ];
            } catch (e) {
                return [0, 0, 0];
            }
        },
        normalize: function(value, params) {
            return value;
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "vec3",
        uiType: "color"
    },

    bool: {
        defaults: function() {
            return { title: "Checkbox", interactive: true, default: true };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            let value = this.decode(params.default) ? "checked" : "";
            //note a bit dirty, but works :) - we want uniform access to 'value' property of all inputs
            return `${title}<input type="checkbox" style="${css}" id="${uniqueId}" ${value}
class="${classes}" onchange="this.value=this.checked; return true;">`;
        },
        glUniformFunName: function() {
            return "uniform1i";
        },
        decode: function(fromValue) {
            return fromValue && fromValue !== "false" ? 1 : 0;
        },
        normalize: function(value, params) {
            return value;
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "bool",
        uiType: "bool"
    }
};

// Implementation of UI control classes, complex functionalities.
$.FlexRenderer.UIControls._impls = {
    // e.g.: colormap: $.FlexRenderer.UIControls.ColorMap
};

/**
 * @interface
 */
$.FlexRenderer.UIControls.IControl = class {

    /**
     * Sets common properties needed to create the controls:
     *  this.owner @extends FlexRenderer.ShaderLayer - owner
     *  this.name - name of the parameter for this.owner.[load/store]Property(...) call
     *  this.id - unique ID for HTML id attribute, to be able to locate controls in DOM,
     *      created as ${uniq}${name}-${owner.uid}
     *  this.webGLVariableName - unique webgl uniform variable name, to not to cause conflicts
     *
     * If extended (class-based definition, see registerCass) children should define constructor as
     *
     * @example
     *   constructor(owner, name, webGLVariableName, params) {
     *       super(owner, name, webGLVariableName);
     *       ...
     *       //possibly make use of params:
     *       this.params = this.getParams(params);
     *
     *       //now access params:
     *       this.params...
     *   }
     *
     * @param {ShaderLayer} owner shader context owning this control
     * @param {string} name name of the control (key to the params in the shader configuration)
     * @param {string} uniq another element to construct the DOM id from, mostly for compound controls
     */
    constructor(owner, name, id) {
        this.owner = owner;
        this.name = name;
        this.id = id;
        this.webGLVariableName = `${name}_${owner.uid}`;
        this._params = {};
        this.__onchange = {};
    }

    /**
     * Safely sets outer params with extension from 'supports'
     *  - overrides 'supports' values with the correct type (derived from supports or supportsAll)
     *  - sets 'supports' as defaults if not set
     * @param params
     */
    getParams(params) {
        const t = this.constructor.getVarType;
        function mergeSafeType(mask, from, possibleTypes) {
            const to = Object.assign({}, mask);
            Object.keys(from).forEach(key => {
                const tVal = to[key],
                    fVal = from[key],
                    tType = t(tVal),
                    fType = t(fVal);

                const typeList = possibleTypes ? possibleTypes[key] : undefined,
                    pTypeList = typeList ? typeList.map(x => t(x)) : [];

                //our type detector distinguishes arrays and objects
                if (tVal && fVal && tType === "object" && fType === "object") {
                    to[key] = mergeSafeType(tVal, fVal, typeList);
                } else if (tVal === undefined || tType === fType || pTypeList.includes(fType)) {
                    to[key] = fVal;
                } else if (fType === "string") {
                    //try parsing NOTE: parsing from supportsAll is ignored!
                    if (tType === "number") {
                        const parsed = Number.parseFloat(fVal);
                        if (!Number.isNaN(parsed)) {
                            to[key] = parsed;
                        }
                    } else if (tType === "boolean") {
                        const value = fVal.toLowerCase();
                        if (value === "false") {
                            to[key] = false;
                        }
                        if (value === "true") {
                            to[key] = true;
                        }
                    }
                }
            });
            return to;
        }

        return mergeSafeType(this.supports, params, this.supportsAll);
    }

    /**
     * Safely check certain param value
     * @param value  value to check
     * @param defaultValue default value to return if check fails
     * @param paramName name of the param to check value type against
     * @return {boolean|number|*}
     */
    getSafeParam(value, defaultValue, paramName) {
        const t = this.constructor.getVarType;
        function nest(suppNode, suppAllNode) {
            if (t(suppNode) !== "object") {
                return [suppNode, suppAllNode];
            }
            if (!suppNode[paramName]) {
                return [undefined, undefined];
            }
            return nest(suppNode[paramName], suppAllNode ? suppAllNode[paramName] : undefined);
        }
        const param = nest(this.supports, this.supportsAll),
            tParam = t(param[0]);

        if (tParam === "object") {
            console.warn("Parameters should not be stored at object level. No type inspection is done.");
            return true; //no supported inspection
        }
        const tValue = t(value);
        //supported type OR supports all types includes the type
        if (tValue === tParam || (param[1] && param[1].map(t).includes(tValue))) {
            return value;
        }

        if (tValue === "string") {
            //try parsing NOTE: parsing from supportsAll is ignored!
            if (tParam === "number") {
                const parsed = Number.parseFloat(value);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            } else if (tParam === "boolean") {
                const val = value.toLowerCase();
                if (val === "false") {
                    return false;
                }
                if (val === "true") {
                    return true;
                }
            }
        }

        return defaultValue;
    }

    /**
     * Uniform behaviour wrt type checking in shaders
     * @param x
     * @return {string}
     */
    static getVarType(x) {
        if (x === undefined) {
            return "undefined";
        }
        if (x === null) {
            return "null";
        }
        return Array.isArray(x) ? "array" : typeof x;
    }

    /**
     * JavaScript initialization
     *  - read/store default properties here using this.owner.[load/store]Property(...)
     *  - work with own HTML elements already attached to the DOM
     *      - set change listeners, input values!
     */
    init() {
        throw "FlexRenderer.UIControls.IControl::init() must be implemented.";
    }

    /**
     * TODO: improve overall setter API
     * Allows to set the control value programatically.
     * Does not trigger canvas re-rednreing, must be done manually (e.g. control.owner.invalidate())
     * @param encodedValue any value the given control can support, encoded
     *  (e.g. as the control acts on the GUI - for input number of
     *    values between 5 and 42, the value can be '6' or 6 or 6.15
     */
    set(encodedValue) {
        throw "FlexRenderer.UIControls.IControl::set() must be implemented.";
    }

    /**
     * Called when an image is rendered
     * @param {WebGLProgram} program
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    glDrawing(program, gl) {
        //the control should send something to GPU
        throw "FlexRenderer.UIControls.IControl::glDrawing() must be implemented.";
    }

    /**
     * Called when associated webgl program is switched to
     * @param {WebGLProgram} program
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    glLoaded(program, gl) {
        //the control should send something to GPU
        throw "FlexRenderer.UIControls.IControl::glLoaded() must be implemented.";
    }

    /**
     * Get the UI HTML controls
     *  - these can be referenced in this.init(...)
     *  - should respect this.params.interactive attribute and return non-interactive output if interactive=false
     *      - don't forget to no to work with DOM elements in init(...) in this case
     *
     * todo: when overrided value before 'init' call on params, toHtml was already called, changes might not get propagated
     *  - either: delay toHtml to trigger insertion later (not nice)
     *  - do not allow changes before init call, these changes must happen at constructor
     */
    toHtml(classes = "", css = "") {
        throw "FlexRenderer.UIControls.IControl::toHtml() must be implemented.";
    }

    /**
     * Handles how the variable is being defined in GLSL
     *  - should use variable names derived from this.webGLVariableName
     */
    define() {
        throw "FlexRenderer.UIControls.IControl::define() must be implemented.";
    }

    /**
     * Sample the parameter using ratio as interpolation, must be one-liner expression so that GLSL code can write
     *    `vec3 mySampledValue = ${this.color.sample("0.2")};`
     * NOTE: you can define your own global-scope functions to keep one-lined sampling,
     * see this.owner.includeGlobalCode(...)
     * @param {(string|undefined)} value openGL value/variable, used in a way that depends on the UI control currently active
     *        (do not pass arguments, i.e. 'undefined' just get that value, note that some inputs might require you do it..)
     * @param {string} valueGlType GLSL type of the value
     * @return {string} valid GLSL oneliner (wihtout ';') for sampling the value, or invalid code (e.g. error message) to signal error
     */
    sample(value = undefined, valueGlType = 'void') {
        throw "FlexRenderer.UIControls.IControl::sample() must be implemented.";
    }

    /**
     * Parameters supported by this UI component, must contain at least
     *  - 'interactive' - type bool, enables and disables the control interactivity
     *  (by changing the content available when rendering html)
     *  - 'title' - type string, the control title
     *
     *  Additionally, for compatibility reasons, you should, if possible, define
     *  - 'default' - type any; the default value for the particular control
     * @return {{}} name: default value mapping
     */
    get supports() {
        throw "FlexRenderer.UIControls.IControl::supports must be implemented.";
    }

    /**
     * Type definitions for supports. Can return empty object. In case of missing
     * type definitions, the type is derived from the 'supports()' default value type.
     *
     * Each key must be an array of default values for the given key if applicable.
     * This is an _extension_ to the supports() and can be used only for keys that have more
     * than one default type applicable
     * @return {{}}
     */
    get supportsAll() {
        throw "FlexRenderer.UIControls.IControl::typeDefs must be implemented.";
    }

    /**
     * GLSL type of this control: what type is returned from this.sample(...) ?
     * @return {string}
     */
    get type() {
        throw "FlexRenderer.UIControls.IControl::type must be implemented.";
    }

    /**
     * Raw value sent to the GPU, note that not necessarily typeof raw() === type()
     * some controls might send whole arrays of data (raw) and do smart sampling such that type is only a number
     * @return {any}
     */
    get raw() {
        throw "FlexRenderer.UIControls.IControl::raw must be implemented.";
    }

    /**
     * Encoded value as used in the UI, e.g. a name of particular colormap, or array of string values of breaks...
     * @return {any}
     */
    get encoded() {
        throw "FlexRenderer.UIControls.IControl::encoded must be implemented.";
    }

    //////////////////////////////////////
    //////// COMMON API //////////////////
    //////////////////////////////////////

    /**
     * The control type component was registered with. Handled internally.
     * @return {*}
     */
    get uiControlType() {
        return this.constructor._uiType;
    }

    /**
     * Get current control parameters
     * the control should set the value as this._params = this.getParams(incomingParams);
     * @return {{}}
     */
    get params() {
        return this._params;
    }

    /**
     * Automatically overridden to return the name of the control it was registered with
     * @return {string}
     */
    getName() {
        return "IControl";
    }

    /**
     * Load a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param defaultValue value to return in case of no cached value
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     *  - default value can be empty string
     * @return {*} cached or default value
     */
    load(defaultValue, paramName = "") {
        const value = this.owner.loadProperty(this.name + (paramName === "default" ? "" : paramName), defaultValue);
        return value;
    }

    /**
     * Store a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param value to store
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     *  - default value can be empty string
     */
    store(value, paramName = "") {
        if (paramName === "default") {
            paramName = "";
        }
        this.owner.storeProperty(this.name + paramName, value);
    }

    /**
     * On parameter change register self
     * @param {string} event which event to fire on
     *  - events are with inputs the names of supported parameters (this.supports), separated by dot if nested
     *  - most controls support "default" event - change of default value
     *  - see specific control implementation to see what events are fired (Advanced Slider fires "breaks" and "mask" for instance)
     * @param {function} clbck(rawValue, encodedValue, context) call once change occurs, context is the control instance
     */
    on(event, clbck) {
        this.__onchange[event] = clbck; //only one possible event -> rewrite?
    }

    /**
     * Clear events of the event type
     * @param {string} event type
     */
    off(event) {
        delete this.__onchange[event];
    }

    /**
     * Clear ALL events
     */
    clearEvents() {
        this.__onchange = {};
    }

    /**
     * Invoke changed value event
     *  -- should invoke every time a value changes !driven by USER!, and use unique or compatible
     *     event name (event 'value') so that shader knows what changed
     * @param event event to call
     * @param value decoded value of encodedValue
     * @param encodedValue value that was received from the UI input
     * @param context self reference to bind to the callback
     */
    changed(event, value, encodedValue, context) {
        if (typeof this.__onchange[event] === "function") {
            this.__onchange[event](value, encodedValue, context);
        }
    }

    /**
     * Create cache object to store this control's values.
     * @returns {object}
     */
    createCacheObject() {
        this._cache = {
            encodedValue: this.encoded,
            value: this.raw
        };
        return this._cache;
    }

    /**
     *
     * @param {object} cache object to serve as control's cache
     */
    loadCacheObject(cache) {
        this._cache = cache;
        this.set(cache.encodedValue);
    }
};


/**
 * Generic UI control implementations
 * used if:
 * {
 *     type: "CONTROL TYPE",
 *     ...
 * }
 *
 * The subclass constructor should get the owner reference, the name
 * of the input and the parametrization.
 *
 * Further parameters passed are dependent on the control type, see
 * @ FlexRenderer.UIControls
 *
 * @class FlexRenderer.UIControls.SimpleUIControl
 */
$.FlexRenderer.UIControls.SimpleUIControl = class extends $.FlexRenderer.UIControls.IControl {
    /**
     * Uses intristicComponent from UIControls._items that corresponds to type of this control.
     * @param {ShaderLayer} owner owner of the control (shaderLayer)
     * @param {string} name name of the control (eg. "opacity")
     * @param {string} id unique control's id, corresponds to it's DOM's element's id
     * @param {object} params
     * @param {object} intristicComponent control's object from UIControls._items, keyed with it's params.default.type?
     */
    constructor(owner, name, id, params, intristicComponent) {
        super(owner, name, id);
        this.component = intristicComponent;
        this._params = this.getParams(params);
        this._needsLoad = true;
    }

    /**
     * Set this.encodedValue to the default value defined in the intristicComponent.
     * Set this.value to the normalized value (from the encoded value) that will be sent to the GLSL.
     * Register "change" event handler to the control, if interactive.
     */
    init() {
        this.encodedValue = this.load(this.params.default);
        // nothing was stored in the cache so we got the default value from the load call => store the value in the cache
        if (this.encodedValue === this.params.default) {
            this.store(this.encodedValue);
        }

        /** Firstly decode encodedValue:
         *      for color it means that it is converted from string "#ffffff" to an array of three floats,
         *      for range it just parses the float on input.
         *  Secondly normalize the obtained value:
         *      for color it does nothing,
         *      for range it somehow gets it to the range <0, 1>;
         *          e.g.: with the range-min being 0 and range-max 100 and default value 40, it will set the min to 0, max to 100, and value to 0.4;
         *                  so that "distances" between the value and min and max remain the same.
         */
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        if (this.params.interactive) {
            const _this = this;
            let node = document.getElementById(this.id);
            if (node) {
                let updater = function(e) {
                    _this.set(e.target.value);
                    _this.owner.invalidate();
                };

                // TODO: some elements do not have 'value' attribute, but 'checked' or 'selected' instead
                node.value = this.encodedValue;
                node.addEventListener('change', updater);
            } else {
                console.error('$.FlexRenderer.UIControls.SimpleUIControl::init: HTML element with id =', this.id, 'not found! Cannot set event listener for the control.');
            }
        }
    }

    set(encodedValue) {
        this.encodedValue = encodedValue;
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        this.changed("default", this.value, this.encodedValue, this);
        this.store(this.encodedValue);
        this._needsLoad = true;
    }

    glDrawing(program, gl) {
        if (this._needsLoad) {
            // debugging purposes
            // console.debug('Setting', this.component.glUniformFunName(), 'corresponding to', this.webGLVariableName, 'to value', this.value);

            gl[this.component.glUniformFunName()](this.glLocation, this.value);
            this._needsLoad = false;
        }
    }

    glLoaded(program, gl) {
        // debugging purposes
        // console.debug(`Setting control's glLocation to ${this.webGLVariableName}`);
        this.glLocation = gl.getUniformLocation(program, this.webGLVariableName);
        this._needsLoad = true;
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return "";
        }
        return this.component.html(this.id, this.params, classes, css);
    }

    define() {
        return `uniform ${this.component.glType} ${this.webGLVariableName};`;
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            return this.webGLVariableName;
        }
        return this.component.sample(this.webGLVariableName, value);
    }

    get uiControlType() {
        return this.component["uiType"];
    }

    get supports() {
        return this.component.defaults();
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValue;
    }

    get type() {
        return this.component.glType;
    }
};

$.FlexRenderer.UIControls.SliderWithInput = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._c1 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName, params, $.FlexRenderer.UIControls.getUiElement('range'));
        params.title = "";
        this._c2 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName + "_2", params, $.FlexRenderer.UIControls.getUiElement('number'), "second-");
    }

    init() {
        const _this = this;
        this._c2._params = this._c1._params;
        this._c1.init();
        this._c2.init();
        this._c1.on("default", function(value, encoded, owner) {
            document.getElementById(_this._c2.id).value = encoded;
            _this._c2.value = value;
            _this.changed("default", value, encoded, owner);
        }, true); //silently fail if registered
        this._c2.on("default", function(value, encoded, owner) {
            document.getElementById(_this._c1.id).value = encoded;
            _this._c1.value = value;
            // Only C1 loads values to gpu, request change
            _this._c1._needsLoad = true;
            _this.changed("default", value, encoded, owner);
        }, true); //silently fail if registered
    }

    glDrawing(program, dimension, gl) {
        this._c1.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this._c1.glLoaded(program, gl);
    }

    toHtml(classes = "", css = "") {
        if (!this._c1.params.interactive) {
            return "";
        }
        return this._c1.toHtml(classes, css + "flex: 1;") + this._c2.toHtml(classes, css);
    }

    define() {
        return this._c1.define();
    }

    sample(ratio) {
        return this._c1.sample(ratio);
    }

    get supports() {
        return this._c1.supports;
    }

    get params() {
        return this._c1.params;
    }

    get type() {
        return this._c1.type;
    }

    get raw() {
        return this._c1.raw;
    }

    get encoded() {
        return this._c1.encoded;
    }
};
$.FlexRenderer.UIControls.registerClass("range_input", $.FlexRenderer.UIControls.SliderWithInput);
})(OpenSeadragon);


(function($) {
/**
 * ColorMap Input
 * @class OpenSeadragon.FlexRenderer.UIControls.ColorMap
 */
$.FlexRenderer.UIControls.ColorMap = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this.prepare();
    }

    prepare() {
        //Note that builtin colormap must support 2->this.MAX_SAMPLES color arrays
        this.MAX_SAMPLES = 8;
        this.GLOBAL_GLSL_KEY = 'colormap';

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    init() {
        this.value = this.load(this.params.default);

        //steps could have been set manually from the outside
        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }

        if (!this.value || !$.FlexRenderer.ColorMaps.schemeGroups[this.params.mode].includes(this.value)) {
            this.value = $.FlexRenderer.ColorMaps.defaults[this.params.mode];
        }
        this.colorPallete = $.FlexRenderer.ColorMaps[this.value][this.maxSteps];

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target),
                    selected = self.val();
                _this.colorPallete = $.FlexRenderer.ColorMaps[selected][_this.maxSteps];
                _this._setPallete(_this.colorPallete);
                self.css("background", _this.cssGradient(_this.colorPallete));
                _this.value = selected;
                _this.store(selected);
                _this.changed("default", _this.pallete, _this.value, _this);
                _this.owner.invalidate();
            };

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

            let schemas = [];
            for (let pallete of $.FlexRenderer.ColorMaps.schemeGroups[this.params.mode]) {
                schemas.push(`<option value="${pallete}">${pallete}</option>`);
            }
            node.html(schemas.join(""));
            node.val(this.value);
            node.on('change', updater);
        } else {
            this._setPallete(this.colorPallete);
            this.updateColormapUI();
            //be careful with what the DOM elements contains or not if not interactive...
            let existsNode = document.getElementById(this.id);
            if (existsNode) {
                existsNode.style.background = this.cssGradient(this.pallete);
            }
        }
    }

    _glslCode() {
        return `
#define COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES} ${this.MAX_SAMPLES}
vec3 sample_colormap(in float ratio, in vec3 map[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}], in float steps[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}+1], in int max_steps, in bool discrete) {
for (int i = 1; i < COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES} + 1; i++) {
    if (ratio <= steps[i]) {
        if (discrete) return map[i-1];

        float scale = (ratio - steps[i-1]) / (steps[i] - steps[i-1]) - 0.5;

        if (scale < .0) {
            if (i == 1) return map[0];
            //scale should be positive, but we need to keep the right direction
            return mix(map[i-1], map[i-2], -scale);
        }

        if (i == max_steps) return map[i-1];
        return mix(map[i-1], map[i], scale);
    } else if (i >= max_steps) {
        return map[i-1];
    }
}
}`;
    }

    updateColormapUI() {
        let node = $(`#${this.id}`);
        node.css("background", this.cssGradient(this.colorPallete));
        return node;
    }

    /**
     * Setup the pallete density, the value is trimmed with a cap of MAX_SAMPLES
     * @param {(number|number[])} steps - amount of sampling steps
     *   number: input number of colors to use
     *   array: put number of colors + 1 values, example: for three color pallete,
     *      put 4 numbers: 2 separators and 2 bounds (min, max value)
     * @param maximum max number of steps available, should not be greater than this.MAX_SAMPLES
     *   unless you know you can modify that value
     */
    setSteps(steps, maximum = this.MAX_SAMPLES) {
        this.steps = steps || this.params.steps;
        if (!Array.isArray(this.steps)) {
            if (this.steps < 2) {
                this.steps = 2;
            }
            if (this.steps > maximum) {
                this.steps = maximum;
            }
            this.maxSteps = this.steps;

            this.steps++; //step generated must have one more value (separators for colors)
            let step = 1.0 / this.maxSteps;
            this.steps = new Array(maximum + 1);
            this.steps.fill(-1);
            this.steps[0] = 0;
            for (let i = 1; i < this.maxSteps; i++) {
                this.steps[i] = this.steps[i - 1] + step;
            }
            this.steps[this.maxSteps] = 1.0;
        } else {
            this.steps = this.steps.filter(x => x >= 0);
            this.steps.sort();
            let max = this.steps[this.steps.length - 1];
            let min = this.steps[0];
            this.steps = this.steps.slice(0, maximum + 1);
            this.maxSteps = this.steps.length - 1;
            this.steps.forEach(x => (x - min) / (max - min));
            for (let i = this.maxSteps + 1; i < maximum + 1; i++) {
                this.steps.push(-1);
            }
        }
    }

    _continuousCssFromPallete(pallete) {
        let css = [`linear-gradient(90deg`];
        for (let i = 0; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i]} ${Math.round((this.steps[i] + this.steps[i + 1]) * 50)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i - 1]} ${Math.round(this.steps[i] * 100)}%, ${pallete[i]} ${Math.round(this.steps[i] * 100)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _setPallete(newPallete) {
        if (typeof newPallete[0] === "string") {
            let temp = newPallete; //if this.pallete passed
            this.pallete = [];
            for (let color of temp) {
                this.pallete.push(...this.parser(color));
            }
        }
        for (let i = this.pallete.length; i < 3 * (this.MAX_SAMPLES); i++) {
            this.pallete.push(0);
        }
    }

    glDrawing(program, gl) {
        gl.uniform3fv(this.colormapGluint, Float32Array.from(this.pallete));
        gl.uniform1fv(this.stepsGluint, Float32Array.from(this.steps));
        gl.uniform1i(this.colormapSizeGluint, this.maxSteps);
    }

    glLoaded(program, gl) {
        this.stepsGluint = gl.getUniformLocation(program, this.webGLVariableName + "_steps[0]");
        this.colormapGluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap[0]");
        this.colormapSizeGluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap_size");
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="text-white-shadow p-1 rounded-2"
style="width: 60%;">${this.load(this.params.default)}</span></div>`;
        }

        return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><select id="${this.id}" class="form-control text-white-shadow"
style="width: 60%;"></select></div>`;
    }

    define() {
        return `uniform vec3 ${this.webGLVariableName}_colormap[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}];
uniform float ${this.webGLVariableName}_steps[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}+1];
uniform int ${this.webGLVariableName}_colormap_size;`;
    }

    get type() {
        return "vec3";
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            return `ERROR Incompatible control. Colormap cannot be used with ${this.name} (sampling type '${valueGlType}')`;
        }
        return `sample_colormap(${value}, ${this.webGLVariableName}_colormap, ${this.webGLVariableName}_steps, ${this.webGLVariableName}_colormap_size, ${!this.params.continuous})`;
    }

    get supports() {
        return {
            steps: 3,
            default: "YlOrRd",
            mode: "sequential",  // todo provide 'set' of available values for documentation
            interactive: true,
            title: "Colormap",
            continuous: false,
        };
    }

    get supportsAll() {
        return {
            steps: [3, [0, 0.5, 1]]
        };
    }

    get raw() {
        return this.pallete;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("colormap", $.FlexRenderer.UIControls.ColorMap);


$.FlexRenderer.UIControls.registerClass("custom_colormap", class extends $.FlexRenderer.UIControls.ColorMap {
    prepare() {
        this.MAX_SAMPLES = 32;
        this.GLOBAL_GLSL_KEY = 'custom_colormap';

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    init() {
        this.value = this.load(this.params.default);

        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }
        if (this.maxSteps < this.value.length) {
            this.value = this.value.slice(0, this.maxSteps);
        }

        //super class compatibility in methods, keep updated
        this.colorPallete = this.value;

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target),
                    index = Number.parseInt(e.target.dataset.index, 10),
                    selected = self.val();

                if (Number.isInteger(index)) {
                    _this.colorPallete[index] = selected;
                    _this._setPallete(_this.colorPallete);
                    self.parent().css("background", _this.cssGradient(_this.colorPallete));
                    _this.value = _this.colorPallete;
                    _this.store(_this.colorPallete);
                    _this.changed("default", _this.pallete, _this.value, _this);
                    _this.owner.invalidate();
                }
            };

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

            const width = 1 / this.colorPallete.length * 100;
            node.html(this.colorPallete.map((x, i) => `<input type="color" style="width: ${width}%; height: 30px; background: none; border: none; padding: 4px 5px;" value="${x}" data-index="${i}">`).join(""));
            node.val(this.value);
            node.children().on('change', updater);
        } else {
            this._setPallete(this.colorPallete);
            this.updateColormapUI();
            //be careful with what the DOM elements contains or not if not interactive...
            let existsNode = document.getElementById(this.id);
            if (existsNode) {
                existsNode.style.background = this.cssGradient(this.pallete);
            }
        }
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="text-white-shadow rounded-2 p-0 d-inline-block"
style="width: 60%;">&emsp;</span></div>`;
        }

        return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="form-control text-white-shadow p-0 d-inline-block"
style="width: 60%;"></span></div>`;
    }

    get supports() {
        return {
            default: ["#000000", "#888888", "#ffffff"],
            steps: 3,  // todo probably not necessary
            mode: "sequential",  // todo not used
            interactive: true,
            title: "Colormap:",
            continuous: false,
        };
    }

    get supportsAll() {
        return {
            steps: [3, [0, 0.5, 1]]
        };
    }
});

/**
 * Advanced slider that can define multiple points and interval masks
 * | --- A - B -- C -- D ----- |
 * will be sampled with mask float[5], the result is
 * the percentage reached within this interval: e.g. if C <= ratio < D, then
 * the result is  4/5 * mask[3]   (4-th interval out of 5 reached, multiplied by 4th mask)
 * @class OpenSeadragon.FlexRenderer.UIControls.AdvancedSlider
 */
$.FlexRenderer.UIControls.AdvancedSlider = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this.MAX_SLIDERS = 12;

        this.owner.includeGlobalCode('advanced_slider', `
#define ADVANCED_SLIDER_LEN ${this.MAX_SLIDERS}
float sample_advanced_slider(in float ratio, in float breaks[ADVANCED_SLIDER_LEN], in float mask[ADVANCED_SLIDER_LEN+1], in bool maskOnly, in float minValue) {
float bigger = .0, actualLength = .0, masked = minValue;
bool sampling = true;
for (int i = 0; i < ADVANCED_SLIDER_LEN; i++) {
    if (breaks[i] < .0) {
        if (sampling) masked = mask[i];
        sampling = false;
        break;
    }

    if (sampling) {
        if (ratio <= breaks[i]) {
            sampling = false;
            masked = mask[i];
        } else bigger++;
    }
    actualLength++;
}
if (sampling) masked = mask[ADVANCED_SLIDER_LEN];
if (maskOnly) return masked;
return masked * bigger / actualLength;
}`);
    }

    init() {
        this._updatePending = false;
        //encoded values hold breaks values between min and max,
        this.encodedValues = this.load(this.params.breaks, "breaks");
        this.mask = this.load(this.params.mask, "mask");

        this.value = this.encodedValues.map(this._normalize.bind(this));
        this.value = this.value.slice(0, this.MAX_SLIDERS);
        this.sampleSize = this.value.length;

        this.mask = this.mask.slice(0, this.MAX_SLIDERS + 1);
        let size = this.mask.length;
        this.connects = this.value.map(_ => true);
        this.connects.push(true); //intervals have +1 elems
        for (let i = size; i < this.MAX_SLIDERS + 1; i++) {
            this.mask.push(-1);
        }

        if (!this.params.step || this.params.step < 1) {
            delete this.params.step;
        }

        let limit =  this.value.length < 2 ? undefined : this.params.max;

        let format = this.params.max < 10 ? {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 1 }),
            from: v => Number.parseFloat(v)
        } : {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 0 }),
            from: v => Number.parseFloat(v)
        };

        if (this.params.interactive) {
            const _this = this;
            let container = document.getElementById(this.id);
            if (!window.noUiSlider) {
                throw new Error("noUiSlider not found: install noUiSlide library!");
            }
            window.noUiSlider.create(container, {
                range: {
                    min: _this.params.min,
                    max: _this.params.max
                },
                step: _this.params.step,
                start: _this.encodedValues,
                margin: _this.params.minGap,
                limit: limit,
                connect: _this.connects,
                direction: 'ltr',
                orientation: 'horizontal',
                behaviour: 'drag',
                tooltips: true,
                format: format,
                pips: $.extend({format: format}, this.params.pips)
            });

            if (this.params.pips) {
                let pips = container.querySelectorAll('.noUi-value');
                /* eslint-disable no-inner-declarations */
                function clickOnPip() {
                    let idx = 0;
                    /* eslint-disable no-invalid-this */
                    let value = Number(this.getAttribute('data-value'));
                    let encoded = container.noUiSlider.get();
                    let values = encoded.map(v => Number.parseFloat(v));

                    if (Array.isArray(values)) {
                        let closest = Math.abs(values[0] - value);
                        for (let i = 1; i < values.length; i++) {
                            let d = Math.abs(values[i] - value);
                            if (d < closest) {
                                idx = i;
                                closest = d;
                            }
                        }
                        container.noUiSlider.setHandle(idx, value, false, false);
                    } else { //just one
                        container.noUiSlider.set(value);
                    }
                    value = _this._normalize(value);
                    _this.value[idx] = value;

                    _this.changed("breaks", _this.value, encoded, _this);
                    _this.store(values, "breaks");
                    _this.owner.invalidate();
                }

                for (let i = 0; i < pips.length; i++) {
                    pips[i].addEventListener('click', clickOnPip);
                }
            }

            if (this.params.toggleMask) {
                this._originalMask = this.mask.map(x => x > 0 ? x : 1);
                let connects = container.querySelectorAll('.noUi-connect');
                for (let i = 0; i < connects.length; i++) {
                    connects[i].addEventListener('mouseup', function(e) {
                        let d = Math.abs(Date.now() - _this._timer);
                        _this._timer = 0;
                        if (d >= 180) {
                            return;
                        }

                        let idx = Number.parseInt(this.dataset.index, 10);
                        _this.mask[idx] = _this.mask[idx] > 0 ? 0 : _this._originalMask[idx];
                        /* eslint-disable eqeqeq */
                        this.style.background = (!_this.params.inverted && _this.mask[idx] > 0) ||
                            (_this.params.inverted && _this.mask[idx] == 0) ?
                                "var(--color-icon-danger)" : "var(--color-icon-tertiary)";
                        _this.owner.invalidate();
                        _this._ignoreNextClick = idx !== 0 && idx !== _this.sampleSize - 1;
                        _this.changed("mask", _this.mask, _this.mask, _this);
                        _this.store(_this.mask, "mask");
                    });

                    connects[i].addEventListener('mousedown', function(e) {
                        _this._timer = Date.now();
                    });

                    connects[i].style.cursor = "pointer";
                }
            }

            container.noUiSlider.on("change", function(strValues, handle, unencoded, tap, positions, noUiSlider) {
                _this.value[handle] = _this._normalize(unencoded[handle]);
                _this.encodedValues = strValues;
                if (_this._ignoreNextClick) {
                    _this._ignoreNextClick = false;
                } else if (!_this._updatePending) {
                    //can be called multiple times upon multiple handle updates, do once if possible
                    _this._updatePending = true;
                    setTimeout(_ => {
                        //todo re-scale values or filter out -1ones
                        _this.changed("breaks", _this.value, strValues, _this);
                        _this.store(unencoded, "breaks");

                        _this.owner.invalidate();
                        _this._updatePending = false;
                    }, 50);
                }
            });

            this._updateConnectStyles(container);
        }

        //do at last since value gets stretched by -1ones
        for (let i =  this.sampleSize; i < this.MAX_SLIDERS; i++) {
            this.value.push(-1);
        }
    }

    _normalize(value) {
        return (value - this.params.min) / (this.params.max - this.params.min);
    }

    _updateConnectStyles(container) {
        if (!container) {
            container = document.getElementById(this.id);
        }
        let pips = container.querySelectorAll('.noUi-connect');
        for (let i = 0; i < pips.length; i++) {
            /* eslint-disable eqeqeq */
            pips[i].style.background = (!this.params.inverted && this.mask[i] > 0) ||
                (this.params.inverted && this.mask[i] == 0) ?
                "var(--color-icon-danger)" : "var(--color-icon-tertiary)";
            pips[i].dataset.index = (i).toString();
        }
    }

    glDrawing(program, gl) {
        gl.uniform1fv(this.breaksGluint, Float32Array.from(this.value));
        gl.uniform1fv(this.maskGluint, Float32Array.from(this.mask));
    }

    glLoaded(program, gl) {
        this.minGluint = gl.getUniformLocation(program, this.webGLVariableName + "_min");
        gl.uniform1f(this.minGluint, this.params.min);
        this.breaksGluint = gl.getUniformLocation(program, this.webGLVariableName + "_breaks[0]");
        this.maskGluint = gl.getUniformLocation(program, this.webGLVariableName + "_mask[0]");
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return "";
        }
        return `<div style="${css}" class="${classes}"><span>${this.params.title}: </span><div id="${this.id}" style="height: 9px;
margin-left: 5px; width: 60%; display: inline-block"></div></div>`;
    }

    define() {
        return `uniform float ${this.webGLVariableName}_min;
uniform float ${this.webGLVariableName}_breaks[ADVANCED_SLIDER_LEN];
uniform float ${this.webGLVariableName}_mask[ADVANCED_SLIDER_LEN+1];`;
    }

    get type() {
        return "float";
    }

    sample(value = undefined, valueGlType = 'void') {
        // TODO: throwing & managing exception would be better, now we don't know what happened when this gets baked to GLSL
        if (!value || valueGlType !== 'float') {
            return `ERROR Incompatible control. Advanced slider cannot be used with ${this.name} (sampling type '${valueGlType}')`;
        }
        return `sample_advanced_slider(${value}, ${this.webGLVariableName}_breaks, ${this.webGLVariableName}_mask, ${this.params.maskOnly}, ${this.webGLVariableName}_min)`;
    }

    get supports() {
        return {
            breaks: [0.2, 0.8],
            mask: [1, 0, 1],
            interactive: true,
            inverted: true,
            maskOnly: true,
            toggleMask: true,
            title: "Threshold",
            min: 0,
            max: 1,
            minGap: 0.05,
            step: null,
            pips: {
                mode: 'positions',
                values: [0, 20, 40, 50, 60, 80, 90, 100],
                density: 4
            }
        };
    }

    get supportsAll() {
        return {
            step: [null, 0.1]
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValues;
    }
};
$.FlexRenderer.UIControls.registerClass("advanced_slider", $.FlexRenderer.UIControls.AdvancedSlider);

/**
 * Text area input
 * @class WebGLModule.UIControls.TextArea
 */
$.FlexRenderer.UIControls.TextArea = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
    }

    init() {
        this.value = this.load(this.params.default);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target);
                _this.value = self.val();
                _this.store(_this.value);
                _this.changed("default", _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.val(this.value);
            node.on('change', updater);
        } else {
            let node = $(`#${this.id}`);
            node.val(this.value);
        }
    }

    glDrawing(program, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(classes = "", css = "") {
        let disabled = this.params.interactive ? "" : "disabled";
        let title = this.params.title ? `<span style="height: 54px;">${this.params.title}: </span>` : "";
        return `<div class="${classes}">${title}<textarea id="${this.id}" class="form-control"
style="width: 100%; display: block; resize: vertical; ${css}" ${disabled} placeholder="${this.params.placeholder}"></textarea></div>`;
    }

    define() {
        return "";
    }

    get type() {
        return "text";
    }

    sample(value = undefined, valueGlType = 'void') {
        return this.value;
    }

    get supports() {
        return {
            default: "",
            placeholder: "",
            interactive: true,
            title: "Text"
        };
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("text_area", $.FlexRenderer.UIControls.TextArea);

/**
 * Button Input
 * @class OpenSeadragon.FlexRenderer.UIControls.Button
 */
$.FlexRenderer.UIControls.Button = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
    }

    init() {
        this.value = this.load(this.params.default);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.value++;
                _this.store(_this.value);
                _this.changed("default", _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.html(this.params.title);
            node.click(updater);
        } else {
            let node = $(`#${this.id}`);
            node.html(this.params.title);
        }
    }

    glDrawing(program, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(classes = "", css = "") {
        let disabled = this.params.interactive ? "" : "disabled";
        css = `style="${css ? css : ""}float: right;"`;
        return `<button id="${this.id}" ${css} class="${classes}" ${disabled}></button>`;
    }

    define() {
        return "";
    }

    get type() {
        return "action";
    }

    sample(value = undefined, valueGlType = 'void') {
        return "";
    }

    get supports() {
        return {
            default: 0, //counts clicks
            interactive: true,
            title: "Button"
        };
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("button", $.FlexRenderer.UIControls.Button);
})(OpenSeadragon);

(function($) {
    /**
     * @interface OpenSeadragon.FlexRenderer.WebGLImplementation
     * Interface for the WebGL rendering implementation which can run on various GLSL versions.
     */
    $.FlexRenderer.WebGLImplementation = class {
        /**
         * Create a WebGL rendering implementation.
         * @param {FlexRenderer} renderer owner of this implementation
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         * @param {String} webGLVersion "1.0" or "2.0"
         */
        constructor(renderer, gl, webGLVersion) {
            //todo renderer name is misleading, rename
            this.renderer = renderer;
            this.gl = gl;
            this.webGLVersion = webGLVersion;
        }

        /**
         * Static WebGLRenderingContext creation (to avoid class instantiation in case of missing support).
         * @param {HTMLCanvasElement} canvas
         * @param {string} webGLVersion
         * @param {Object} contextAttributes desired options used for the canvas webgl context creation
         * @return {WebGLRenderingContext|WebGL2RenderingContext}
         */
        static createWebglContext(canvas, webGLVersion, contextAttributes) {
            // indicates that the canvas contains an alpha buffer
            contextAttributes.alpha = true;
            // indicates that the page compositor will assume the drawing buffer contains colors with pre-multiplied alpha
            contextAttributes.premultipliedAlpha = true;
            contextAttributes.preserveDrawingBuffer = true;

            if (webGLVersion === "1.0") {
                return canvas.getContext('webgl', contextAttributes);
            } else {
                return canvas.getContext('webgl2', contextAttributes);
            }
        }

        get firstPassProgramKey() {
            throw("$.FlexRenderer.WebGLImplementation::firstPassProgram must be implemented!");
        }

        get secondPassProgramKey() {
            throw("$.FlexRenderer.WebGLImplementation::secondPassProgram must be implemented!");
        }

        /**
         * Init phase
         */
        init() {

        }

        /**
         * Attach shaders and link WebGLProgram, catch errors.
         * @param {WebGLProgram} program
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         * @param {OpenSeadragon.FlexRenderer.WGLProgram} options build options
         * @param {function} onError
         * @param {boolean} debug
         * @return {boolean} true if program was built successfully
         */
        static _compileProgram(program, gl, options, onError, debug = false) {
            /* Napriklad gl.getProgramParameter(program, gl.LINK_STATUS) pre kind = "Program", status = "LINK", value = program */
            function ok(kind, status, value, sh) {
                if (!gl['get' + kind + 'Parameter'](value, gl[status + '_STATUS'])) {
                    $.console.error((sh || 'LINK') + ':\n' + gl['get' + kind + 'InfoLog'](value));
                    return false;
                }
                return true;
            }

            /* Attach shader to the WebGLProgram, return true if valid. */
            function useShader(gl, program, data, type) {
                let shader = gl.createShader(gl[type]);
                gl.shaderSource(shader, data);
                gl.compileShader(shader);
                gl.attachShader(program, shader);
                program[type] = shader;
                return ok('Shader', 'COMPILE', shader, type);
            }

            function numberLines(str) {
                // from https://stackoverflow.com/questions/49714971/how-to-add-line-numbers-to-beginning-of-each-line-in-string-in-javascript
                return str.split('\n').map((line, index) => `${index + 1} ${line}`).join('\n');
            }

            // Attaching shaders to WebGLProgram failed
            if (!useShader(gl, program, options.vertexShader, 'VERTEX_SHADER') ||
                !useShader(gl, program, options.fragmentShader, 'FRAGMENT_SHADER')) {
                onError("Unable to correctly build WebGL shaders.",
                    "Attaching of shaders to WebGLProgram failed. For more information, see logs in the $.console.");
                $.console.warn("VERTEX SHADER\n", numberLines( options.vertexShader ));
                $.console.warn("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                return false;
            } else { // Shaders attached
                gl.linkProgram(program);
                if (!ok('Program', 'LINK', program)) {
                    onError("Unable to correctly build WebGL program.",
                        "Linking of WebGLProgram failed. For more information, see logs in the $.console.");
                    $.console.warn("VERTEX SHADER\n", numberLines( options.vertexShader ));
                    $.console.warn("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                    return false;
                } else if (debug) {
                    $.console.info("VERTEX SHADER\n", numberLines( options.vertexShader ));
                    $.console.info("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                }
                return true;
            }
        }

        /**
         * Get WebGL version of the implementation.
         * @return {String} "1.0" or "2.0"
         */
        getVersion() {
            return undefined;
        }

        sampleTexture() {
            throw("$.FlexRenderer.WebGLImplementation::sampleTexture() must be implemented!");
        }

        getTextureSize() {
            throw("$.FlexRenderer.WebGLImplementation::getTextureSize() must be implemented!");
        }

        getShaderLayerGLSLIndex() {
            throw("$.FlexRenderer.WebGLImplementation::getShaderLayerGLSLIndex() must be implemented!");
        }

        createProgram() {
            throw("$.FlexRenderer.WebGLImplementation::createProgram() must be implemented!");
        }

        loadProgram() {
            throw("$.FlexRenderer.WebGLImplementation::loadProgram() must be implemented!");
        }

        useProgram() {
            throw("$.FlexRenderer.WebGLImplementation::useProgram() must be implemented!");
        }

        /**
         * Set viewport dimensions. Parent context already applied correct viewport settings to the
         * OpenGL engine. These values are already configured, but the webgl context can react to them.
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @param {Number} levels number of layers that are rendered, kind of 'depth' parameter, an integer
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels) {
            //no-op
        }

        destroy() {
        }

        /**
         * Get supported render modes by the renderer. First should be the default.
         * Keywords with *mask* are deprecated.
         * @return {string[]}
         */
        get supportedUseModes() {
            return ["show", "blend", "clip", "mask", "clip_mask"];
        }

        /**
         * Return sampling GLSL code (no function definition allowed) that implements blending passed by name
         * available are vec4 arguments 'fg' and 'bg'
         * e.g.:
         *   return vec4(fg.rgb * bg.a, fg.a);
         * @param {string} name one of OpenSeadragon.FlexRenderer.BLEND_MODE
         * @return {string}
         */
        getBlendingFunction(name) {
            throw("$.FlexRenderer.WebGLImplementation::blendingFunction must be implemented!");
        }
    };

    /**
     * @typedef {object} RenderOptions
     * @property {GLint|null} [framebuffer=null]
     *
     * todo: needs to differentiate first and second pass... might need to define interface for both individually
     */

    /**
     * WebGL Program instance
     * @class OpenSeadragon.FlexRenderer.WGLProgram
     */
    $.FlexRenderer.WGLProgram = class extends $.FlexRenderer.Program {

        /**
         *
         * @param context
         * @param gl {WebGLRenderingContext|WebGL2RenderingContext} Rendering program.
         * @param atlas {OpenSeadragon.FlexRenderer.TextureAtlas} Shared texture atlas.
         */
        constructor(context, gl, atlas) {
            super(context);
            /**
             *
             * @type {WebGLRenderingContext}
             */
            this.gl = gl;
            /**
             * @type {$.FlexRenderer.TextureAtlas}
             */
            this.atlas = atlas;
            this._webGLProgram = null;
            /**
             *
             * @type {string}
             */
            this.fragmentShader = "";
            /**
             *
             * @type {string}
             */
            this.vertexShader = "";
        }

        get webGLProgram() {
            if (!this._webGLProgram) {
                throw Error("Program accessed without registration - did you call this.renderer.registerProgram()?");
            }
            return this._webGLProgram;
        }

        /**
         *
         * @param shaderMap
         * @param shaderKeys
         */
        build(shaderMap, shaderKeys) {
        }

        /**
         * Create program.
         * @param width
         * @param height
         */
        created(width, height) {
        }

        /**
         * Retrieve program error message
         * @return {string|undefined} error message of the current state or undefined if OK
         */
        getValidateErrorMessage() {
            if (!this.vertexShader || !this.fragmentShader) {
                return "Program does not define vertexShader or fragmentShader shader property!";
            }
            return undefined;
        }

        /**
         * Load program. Arbitrary arguments.
         * Called ONCE per shader lifetime. Should not be called twice
         * unless requested by this.requireLoad=true call -- you should not set values
         * that are lost when webgl program is changed.
         */
        load() {
        }

        /**
         * Use program. Arbitrary arguments.
         * @param {RenderOutput} renderOutput the object passed between first and second pass
         * @param {FPRenderPackage[]|SPRenderPackage[]} renderArray
         * @param {RenderOptions} options
         */
        use(renderOutput, renderArray, options) {
        }

        unload() {

        }

        /**
         * Destroy program. No arguments.
         */
        destroy() {
        }

// TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
        setDimensions(x, y, width, height, levels) {

        }

        /**
         * Iterate GLSL code
         */
        printN(fn, number, padding = "") {
            const output = new Array(number);
            for (let i = 0; i < number; i++) {
                output[i] = padding + fn(i);
            }
            return output.join('\n');
        }
    };

    /**
     * Texture atlas for WebGL. Shaders should be offered addImage(...) interface that returns atlas ID to
     * use in turn to access the desired image on-gpu.
     * @type {{gl: WebGL2RenderingContext, layerWidth: number|number, layerHeight: number|number, layers: number|number, padding: number|number, maxIds: number|number, internalFormat: number|0x8058, format: number|0x1908, type: number|0x1401, texture: null, new(WebGL2RenderingContext, {layerWidth?: number, layerHeight?: number, layers?: number, padding?: number, maxIds?: number, internalFormat?: number, format?: number, type?: number}=): $.FlexRenderer.TextureAtlas, prototype: TextureAtlas}}
     */
    $.FlexRenderer.TextureAtlas = class {
        /**
         * Construct the atlas, optionally using custom parameters. The atlas is
         * supposed to use layers (2d array or 3d texture) to allow growth once hitting
         * the max texture 2D dimension.
         * @param {WebGL2RenderingContext} gl
         * @param {{
         *   layerWidth?: number,
         *   layerHeight?: number,
         *   layers?: number,
         *   padding?: number,
         *   maxIds?: number,
         *   internalFormat?: number,
         *   format?: number,
         *   type?: number
         * }} [opts]
         */
        constructor(gl, opts) {
            this.gl = gl;

            this.layerWidth = (opts && opts.layerWidth) ? opts.layerWidth : 512;
            this.layerHeight = (opts && opts.layerHeight) ? opts.layerHeight : 512;
            this.layers = (opts && typeof opts.layers === 'number') ? opts.layers : 1;
            this.padding = (opts && typeof opts.padding === 'number') ? opts.padding : 1;
            this.maxIds = (opts && typeof opts.maxIds === 'number') ? opts.maxIds : 256;

            this.internalFormat = (opts && opts.internalFormat) ? opts.internalFormat : gl.RGBA8;
            this.format = (opts && opts.format) ? opts.format : gl.RGBA;
            this.type = (opts && opts.type) ? opts.type : gl.UNSIGNED_BYTE;

            this.texture = null;
        }

        /**
         * Add an image. Returns a stable atlasId.
         * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
         * @param {number} [w]
         * @param {number} [h]
         * @returns {number}
         */
        addImage(source, w, h) {
            throw new Error('TextureAtlas2DArray.addImage: not implemented');
        }

        /**
         * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
         * @param textureUnit
         */
        bind(textureUnit) {
        }

        /**
         * Get WebGL Atlas shader code. This code must define the following function:
         * vec4 osd_atlas_texture(int, vec2)
         * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
         *
         * @return {string}
         */
        getFragmentShaderDefinition() {
            throw new Error('TextureAtlas2DArray.getFragmentShaderDefinition: not implemented');
        }

        /**
         * Load the current atlas uniform locations.
         * @param {WebGLProgram} program
         */
        load(program) {
        }

        /**
         * Destroy the atlas.
         */
        destroy() {
        }
    };

    $.FlexRenderer.WebGL10 = class extends $.FlexRenderer.WebGLImplementation {
        // todo implement support
    };

})(OpenSeadragon);

(function($) {
    $.FlexRenderer.WebGL20 = class extends $.FlexRenderer.WebGLImplementation {
    /**
     * Create a WebGL 2.0 rendering implementation.
     * @param {OpenSeadragon.FlexRenderer} renderer
     * @param {WebGL2RenderingContext} gl
     */
    constructor(renderer, gl) {
        // sets this.renderer, this.gl, this.webGLVersion
        super(renderer, gl, "2.0");
        $.console.info("WebGl 2.0 renderer.");
    }

    get firstPassProgramKey() {
        return "firstPass";
    }

    get secondPassProgramKey() {
        return "secondPass";
    }

    init() {
        const textureAtlas = this.atlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        //todo consider passing reference to this
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.FirstPassProgram(this, this.gl, textureAtlas), "firstPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.SecondPassProgram(this, this.gl, textureAtlas), "secondPass");
    }

    getVersion() {
        return "2.0";
    }

    /**
     * Expose GLSL code for texture sampling.
     * @returns {string} glsl code for texture sampling
     */
    sampleTexture(index, vec2coords) {
        return `osd_texture(${index}, ${vec2coords})`;
    }

    getTextureSize(index) {
        return `osd_texture_size(${index})`;
    }

    setDimensions(x, y, width, height, levels) {
        this.renderer.getProgram(this.firstPassProgramKey).setDimensions(x, y, width, height, levels);
        this.renderer.getProgram(this.secondPassProgramKey).setDimensions(x, y, width, height, levels);
        //todo consider some elimination of too many calls
    }

    destroy() {
        this.atlas.destroy();
    }

    getBlendingFunction(name) {
        return {
            mask: `
if (close(fg.a, 0.0))  return vec4(.0);
return bg;`,
            'source-over': `
if (!stencilPasses) return bg;
vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
return pre_fg + bg * (1.0 - pre_fg.a);`,

            'source-in': `
if (!stencilPasses) return bg;
return vec4(fg.rgb * bg.a, fg.a * bg.a);`,

            'source-out': `
if (!stencilPasses) return bg;
return vec4(fg.rgb * (1.0 - bg.a), fg.a * (1.0 - bg.a));`,

            'source-atop': `
if (!stencilPasses) return bg;
vec3 rgb = fg.rgb * bg.a + bg.rgb * (1.0 - fg.a);
float a = fg.a * bg.a + bg.a * (1.0 - fg.a);
return vec4(rgb, a);`,

            'destination-over': `
if (!stencilPasses) return bg;
vec4 pre_bg = vec4(bg.rgb * bg.a, bg.a);
return pre_bg + fg * (1.0 - pre_bg.a);`,

            'destination-in': `
if (!stencilPasses) return bg;
return vec4(bg.rgb * fg.a, fg.a * bg.a);`,

            'destination-out': `
if (!stencilPasses) return bg;
return vec4(bg.rgb * (1.0 - fg.a), bg.a * (1.0 - fg.a));`,

            'destination-atop': `
if (!stencilPasses) return bg;
vec3 rgb = bg.rgb * fg.a + fg.rgb * (1.0 - bg.a);
float a = bg.a * fg.a + fg.a * (1.0 - bg.a);
return vec4(rgb, a);`,

            lighten: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, max(fg.rgb, bg.rgb));`,

            darken: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, min(fg.rgb, bg.rgb));`,

            copy: `
if (!stencilPasses) return bg;
return fg;`,

            xor: `
if (!stencilPasses) return bg;
vec3 rgb = fg.rgb * (1.0 - bg.a) + bg.rgb * (1.0 - fg.a);
float a = fg.a + bg.a - 2.0 * fg.a * bg.a;
return vec4(rgb, a);`,

            multiply: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, fg.rgb * bg.rgb);`,

            screen: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, 1.0 - (1.0 - fg.rgb) * (1.0 - bg.rgb));`,

            overlay: `
if (!stencilPasses) return bg;
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(0.5, bg.rgb));
return blendAlpha(fg, bg, rgb);`,

            'color-dodge': `
if (!stencilPasses) return bg;
vec3 rgb = bg.rgb / (1.0 - fg.rgb + 1e-5);
return blendAlpha(fg, bg, min(rgb, 1.0));`,

            'color-burn': `
if (!stencilPasses) return bg;
vec3 rgb = 1.0 - ((1.0 - bg.rgb) / (fg.rgb + 1e-5));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            'hard-light': `
if (!stencilPasses) return bg;
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(0.5, fg.rgb));
return blendAlpha(fg, bg, rgb);`,

            'soft-light': `
if (!stencilPasses) return bg;
vec3 rgb = (bg.rgb < 0.5)
    ? (2.0 * fg.rgb * bg.rgb + fg.rgb * fg.rgb * (1.0 - 2.0 * bg.rgb))
    : (sqrt(fg.rgb) * (2.0 * bg.rgb - 1.0) + 2.0 * fg.rgb * (1.0 - bg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            difference: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, abs(bg.rgb - fg.rgb));`,

            exclusion: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, bg.rgb + fg.rgb - 2.0 * bg.rgb * fg.rgb);`,
        }[name];
    }
};


$.FlexRenderer.WebGL20.SecondPassProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32);
        //todo this might be limiting in some wild cases... make it configurable..? or consider 1d texture
        this.textureMappingsUniformSize = 64;
    }

    build(shaderMap, keyOrder) {
        if (!keyOrder.length) {
            // Todo prevent unimportant first init build call
            this.vertexShader = this._getVertexShaderSource();
            this.fragmentShader = this._getFragmentShaderSource('', '',
                '', $.FlexRenderer.ShaderLayer.__globalIncludes);
            return;
        }
        let definition = '',
            execution = `
vec4 intermediate_color = vec4(.0);
vec4 clip_color = vec4(.0);
`,
            customBlendFunctions = '';

        const addShaderDefinition = shader => {
            definition += `
// ${shader.constructor.type()} - Definition
${shader.getFragmentShaderDefinition()}
// ${shader.constructor.type()} - Custom blending function for a given shader
${shader.getCustomBlendFunction(shader.uid + "_blend_func")}
// ${shader.constructor.type()} - Shader code execution
vec4 ${shader.uid}_execution() {
${shader.getFragmentShaderExecution()}
}
`;
        };

        let remainingBlenForShaderID = '';
        const getRemainingBlending = () => { //todo next blend argument
            if (remainingBlenForShaderID) {
                const i = keyOrder.indexOf(remainingBlenForShaderID);
                const shader = shaderMap[remainingBlenForShaderID];
                // Set stencilPasses again: we are going to blend deferred data
                return `
    stencilPasses = osd_stencil_texture(${i}, 0, v_texture_coords).r > 0.995;
    overall_color = ${shader.mode === "show" ? "blend_source_over" : shader.uid + "_blend_func"}(intermediate_color, overall_color);
`;
            }
            return '';
        };

        let i = 0;
        for (; i < keyOrder.length; i++) {
            const previousShaderID = keyOrder[i];
            const previousShaderLayer = shaderMap[previousShaderID];
            const shaderConf = previousShaderLayer.getConfig();

            const opacityModifier = previousShaderLayer.opacity ? `opacity * ${previousShaderLayer.opacity.sample()}` : 'opacity';
            if (shaderConf.type === "none" || shaderConf.error || !shaderConf.visible) {
                //prevents the layer from being accounted for in the rendering (error or not visible)

                // For explanation of this logics see main shader part below
                if (previousShaderLayer._mode !== "clip") {
                    execution += `${getRemainingBlending()}
// ${previousShaderLayer.constructor.type()} - Disabled (error or visible = false)
intermediate_color = vec4(.0);`;
                    remainingBlenForShaderID = previousShaderID;
                } else {
                    execution += `
// ${previousShaderLayer.constructor.type()} - Disabled with Clipmask (error or visible = false)
intermediate_color = ${previousShaderLayer.uid}_blend_func(vec4(.0), intermediate_color);`;
                }
                continue;
            }

            addShaderDefinition(previousShaderLayer);
            execution += `
    instance_id = ${i};
    stencilPasses = osd_stencil_texture(${i}, 0, v_texture_coords).r > 0.995;
    vec3 attrs_${i} = u_shaderVariables[${i}];
    opacity = attrs_${i}.x;
    pixelSize = attrs_${i}.y;
    zoom = attrs_${i}.z;`;

            // To understand the code below: show & mask are basically same modes: they blend atop
            // of existing data. 'Show' just uses built-in alpha blending.
            // However, clip blends on the previous output only (and it can chain!).

            if (previousShaderLayer._mode !== "clip") {
                    execution += `${getRemainingBlending()}
// ${previousShaderLayer.constructor.type()} - Blending
intermediate_color = ${previousShaderLayer.uid}_execution();
intermediate_color.a = intermediate_color.a * ${opacityModifier};`;

                remainingBlenForShaderID = previousShaderID;
            } else {
                execution += `
// ${previousShaderLayer.constructor.type()} - Clipping
clip_color = ${previousShaderLayer.uid}_execution();
clip_color.a = clip_color.a * ${opacityModifier};
intermediate_color = ${previousShaderLayer.uid}_blend_func(clip_color, intermediate_color);`;
            }
        } // end of for cycle

        if (remainingBlenForShaderID) {
            execution += getRemainingBlending();
        }
        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource(definition, execution,
            customBlendFunctions, $.FlexRenderer.ShaderLayer.__globalIncludes);
    }

    /**
     * Create program.
     * @param width
     * @param height
     */
    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;

        // Shader element indexes match element id (instance id) to position in the texture array
        this._instanceOffsets = gl.getUniformLocation(program, "u_instanceOffsets[0]");
        this._instanceTextureIndexes = gl.getUniformLocation(program, "u_instanceTextureIndexes[0]");
        this._shaderVariables = gl.getUniformLocation(program, "u_shaderVariables");

        this._texturesLocation = gl.getUniformLocation(program, "u_inputTextures");
        this._stencilLocation = gl.getUniformLocation(program, "u_stencilTextures");

        this.vao = gl.createVertexArray();
    }

    /**
     * Load program. No arguments.
     */
    load(renderArray) {
        const gl = this.gl;
        // ShaderLayers' controls
        for (const renderInfo of renderArray) {
            renderInfo.shader.glLoaded(this.webGLProgram, gl);
        }
        this.atlas.load(this.webGLProgram);
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, renderArray, options) {
        //todo flatten render array :/
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, options.framebuffer || null);
        gl.bindVertexArray(this.vao);

        const shaderVariables = [];
        const instanceOffsets = [];
        const instanceTextureIndexes = [];
        for (const renderInfo of renderArray) {
            renderInfo.shader.glDrawing(this.webGLProgram, gl);

            shaderVariables.push(renderInfo.opacity, renderInfo.pixelSize, renderInfo.zoom);

            instanceOffsets.push(instanceTextureIndexes.length);
            instanceTextureIndexes.push(...renderInfo.shader.getConfig().tiledImages);
        }

        gl.uniform1iv(this._instanceOffsets, instanceOffsets);
        gl.uniform1iv(this._instanceTextureIndexes, instanceTextureIndexes);
        gl.uniform3fv(this._shaderVariables, shaderVariables);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.texture);
        gl.uniform1i(this._texturesLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.stencil);
        gl.uniform1i(this._stencilLocation, 1);

        this.atlas.bind(gl.TEXTURE2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        return renderOutput;
    }

    /**
     * Destroy program. No arguments.
     */
    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    // TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
    setDimensions(x, y, width, height, levels) {
    }

    // PRIVATE FUNCTIONS
    /**
     * Get vertex shader's glsl code.
     * @returns {string} vertex shader's glsl code
     */
    _getVertexShaderSource() {
        const vertexShaderSource = `#version 300 es
precision mediump int;
precision mediump float;

out vec2 v_texture_coords;

const vec3 viewport[4] = vec3[4] (
    vec3(-1.0, 1.0, 1.0),
    vec3(-1.0, -1.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, -1.0, 1.0)
);

void main() {
    v_texture_coords = vec2(viewport[gl_VertexID]) / 2.0 + 0.5;
    gl_Position = vec4(viewport[gl_VertexID], 1.0);
}
`;

        return vertexShaderSource;
    }

    /**
     * Get fragment shader's glsl code.
     * @param {string} definition ShaderLayers' glsl code placed outside the main function
     * @param {string} execution ShaderLayers' glsl code placed inside the main function
     * @param {string} globalScopeCode ShaderLayers' glsl code shared between the their instantions
     * @returns {string} fragment shader's glsl code
     */
    _getFragmentShaderSource(definition, execution, globalScopeCode) {
        const fragmentShaderSource = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2DArray;

uniform int u_instanceTextureIndexes[${this.textureMappingsUniformSize}];
uniform int u_instanceOffsets[${this.textureMappingsUniformSize}];
uniform vec3 u_shaderVariables[${this.textureMappingsUniformSize}];

in vec2 v_texture_coords;

bool stencilPasses;
int instance_id;
float opacity;
float pixelSize;
float zoom;

uniform sampler2DArray u_inputTextures;
uniform sampler2DArray u_stencilTextures;

vec4 osd_texture(int index, vec2 coords) {
    int offset = u_instanceOffsets[instance_id];
    index = u_instanceTextureIndexes[offset + index];
    return texture(u_inputTextures, vec3(coords, float(index)));
}

vec4 osd_stencil_texture(int instance, int index, vec2 coords) {
    int offset = u_instanceOffsets[instance];
    index = u_instanceTextureIndexes[offset + index];
    return texture(u_stencilTextures, vec3(coords, float(index)));
}

ivec2 osd_texture_size(int index) {
    int offset = u_instanceOffsets[instance_id];
    index = u_instanceTextureIndexes[offset + index];
    return textureSize(u_inputTextures, index).xy;
}

${this.atlas.getFragmentShaderDefinition()}

// UTILITY function
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

// BLEND attributes
out vec4 overall_color;
vec4 blendAlpha(vec4 fg, vec4 bg, vec3 rgb) {
    float a = fg.a + bg.a * (1.0 - fg.a);
    return vec4(rgb, a);
}
vec4 blend_source_over(vec4 fg, vec4 bg) {
    if (!stencilPasses) return bg;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    return pre_fg + bg * (1.0 - pre_fg.a);
}

// GLOBAL SCOPE CODE:
${Object.keys(globalScopeCode).length !== 0 ? Object.values(globalScopeCode).join("\n") : '\n    // No global scope code here...'}

// DEFINITIONS OF SHADERLAYERS:
${definition !== '' ? definition : '\n    // No shaderLayer here to define...'}

void main() {
    ${execution}
}`;

        return fragmentShaderSource;
    }
};

$.FlexRenderer.WebGL20.FirstPassProgram = class extends $.FlexRenderer.WGLProgram {

    /**
     *
     * @param {OpenSeadragon.FlexRenderer} context
     * @param {WebGL2RenderingContext} gl
     * @param {OpenSeadragon.FlexRenderer.TextureAtlas} atlas
     */
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32);
        this._textureIndexes = [...Array(this._maxTextures).keys()];
        // Todo: RN we support only MAX_COLOR_ATTACHMENTS in the texture array, which varies beetween devices
        //   make the first pass shader run multiple times if the number does not suffice
        // this._maxAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
    }

    build(shaderMap, shaderKeys) {
        this.vertexShader = `#version 300 es
precision mediump int;
precision mediump float;

layout(location = 0) in mat3 a_transform_matrix;
// Generic payload args. Used for texture positions, vector positions and colors.
layout(location = 4) in vec4 a_payload0; // first 4 texture coords or positions
layout(location = 5) in vec4 a_payload1; // second 4 texture coords or colors

uniform vec2 u_renderClippingParams;
uniform mat3 u_geomMatrix;

out vec2 v_texture_coords;
flat out int instance_id;
out vec4 v_vecColor;

const vec3 viewport[4] = vec3[4] (
    vec3(0.0, 1.0, 1.0),
    vec3(0.0, 0.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 0.0, 1.0)
);

void main() {
    int vid = gl_VertexID & 3;
    v_texture_coords = (vid == 0) ? a_payload0.xy :
        (vid == 1) ? a_payload0.zw :
             (vid == 2) ? a_payload1.xy : a_payload1.zw;

    mat3 matrix = u_renderClippingParams.y > 0.5 ? u_geomMatrix : a_transform_matrix;

    vec3 space_2d = u_renderClippingParams.x > 0.5 ?
        matrix * vec3(a_payload0.xy, 1.0) :
        matrix * viewport[gl_VertexID];

    v_vecColor = a_payload1;

    gl_Position = vec4(space_2d.xy, 1.0, space_2d.z);
    instance_id = gl_InstanceID;
}
`;
        this.fragmentShader = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2D;

uniform vec2 u_renderClippingParams;

flat in int instance_id;
in vec2 v_texture_coords;
in vec4 v_vecColor;
uniform sampler2D u_textures[${this._maxTextures}];

layout(location=0) out vec4 outputColor;
layout(location=1) out float outputStencil;

void main() {
    if (u_renderClippingParams.x < 0.5) {
        // Iterate over tiles - textures for each tile (a texture array)
        for (int i = 0; i < ${this._maxTextures}; i++) {
            // Iterate over data in each tile if the index matches our tile
            if (i == instance_id) {
                 switch (i) {
    ${this.printN(x => `case ${x}: outputColor = texture(u_textures[${x}], v_texture_coords); break;`,
                this._maxTextures, "                ")}
                 }
                 break;
            }
        }
        outputStencil = 1.0;
    } else if (u_renderClippingParams.y > 0.5) {
        // Vector geometry draw path (per-vertex color)
        outputColor = v_vecColor;
        outputStencil = 1.0;
    } else {
        // Pure clipping path: write only to stencil (color target value is undefined)
        outputColor = vec4(0.0);
    }
}
`;
    }

    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;

        // Texture creation happens on setDimensions, called later

        let vao = this.firstPassVao;
        if (!vao) {
            this.offScreenBuffer = gl.createFramebuffer();

            this.firstPassVao = vao = gl.createVertexArray();
            this.matrixBuffer = gl.createBuffer();
            this.texCoordsBuffer = gl.createBuffer();

            this.matrixBufferClip = gl.createBuffer();
            this.firstPassVaoClip = gl.createVertexArray();
            this.positionsBufferClip = gl.createBuffer();

            this.firstPassVaoGeom = gl.createVertexArray();
            this.positionsBufferGeom = gl.createBuffer();
        }

        // Texture locations are 0->N uniform indexes, we do not load the data here yet as vao does not store them
        this._inputTexturesLoc = gl.getUniformLocation(program, "u_textures");
        this._renderClipping = gl.getUniformLocation(program, "u_renderClippingParams");

        // Alias names to avoid confusion
        this._positionsBuffer = gl.getAttribLocation(program, "a_payload0");
        this._colorAttrib = gl.getAttribLocation(program, "a_payload1");
        this._payload1 = gl.getAttribLocation(program, "a_payload1");
        this._payload0 = gl.getAttribLocation(program, "a_payload0");

        /*
         * Rendering Geometry. Colors are issued per vertex, set up during actual draw calls (changes
         * properties, has custom buffers). Positions are issued per vertex, also changes per draw call
         * (custom buffers preloaded at initialization).
         */
        gl.bindVertexArray(this.firstPassVaoGeom);
        // Colors for geometry, set up actually during drawing as each tile delivers its own buffer
        gl.enableVertexAttribArray(this._colorAttrib);
        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        // a_positions (dynamic buffer, we may re-bind/retarget per primitive)
        gl.enableVertexAttribArray(this._positionsBuffer);
        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);
        this._geomSingleMatrix = gl.getUniformLocation(program, "u_geomMatrix");



        /*
         * Rendering vector tiles. Positions of tiles are always rectangular (stretched and moved by the matrix),
         * not computed but read on-vertex-shader. Texture coords might be customized (e.g. overlap), and
         * need to be explicitly set to each vertex. Need 2x vec4 to read 8 values for 4 vertices.
         * NOTE! Divisor 0 not usable, since it reads from the beginning of a buffer for all instances.
         */
        gl.bindVertexArray(vao);
        // Texture coords are vec2 * 4 coords for the textures, needs to be passed since textures can have offset
        const maxTexCoordBytes = this._maxTextures * 8 * Float32Array.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, maxTexCoordBytes, gl.DYNAMIC_DRAW);
        const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this._payload0);
        gl.vertexAttribPointer(this._payload0, 4, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(this._payload0, 1);
        gl.enableVertexAttribArray(this._payload1);
        gl.vertexAttribPointer(this._payload1, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(this._payload1, 1);

        // Matrices position tiles, 3*3 matrix per tile sent as 3 attributes in
        // Share the same per-instance transform setup as the raster VAO
        this._matrixBuffer = gl.getAttribLocation(program, "a_transform_matrix");
        const matLoc = this._matrixBuffer;
        const maxMatrixBytes = this._maxTextures * 9 * Float32Array.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
        gl.enableVertexAttribArray(matLoc);
        gl.enableVertexAttribArray(matLoc + 1);
        gl.enableVertexAttribArray(matLoc + 2);
        gl.vertexAttribPointer(matLoc, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 0);
        gl.vertexAttribPointer(matLoc + 1, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(matLoc + 2, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(matLoc, 1);
        gl.vertexAttribDivisor(matLoc + 1, 1);
        gl.vertexAttribDivisor(matLoc + 2, 1);
        // We call bufferData once, then we just call subData
        gl.bufferData(gl.ARRAY_BUFFER, maxMatrixBytes, gl.STREAM_DRAW);


        /*
         * Rendering clipping. This prevents data to show outside the clipping areas. Only positions are needed.
         */
        vao = this.firstPassVaoClip;
        gl.bindVertexArray(vao);
        // We use only one of the two vec4 payload arguments, the other remains uninitialized here.
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionsBufferClip);
        gl.enableVertexAttribArray(this._positionsBuffer);
        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);
        // We use static matrix
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBufferClip);
        gl.enableVertexAttribArray(matLoc);
        gl.enableVertexAttribArray(matLoc + 1);
        gl.enableVertexAttribArray(matLoc + 2);
        gl.vertexAttribPointer(matLoc, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 0);
        gl.vertexAttribPointer(matLoc + 1, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(matLoc + 2, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(matLoc, 1);
        gl.vertexAttribDivisor(matLoc + 1, 1);
        gl.vertexAttribDivisor(matLoc + 2, 1);
        gl.bufferData(gl.ARRAY_BUFFER, maxMatrixBytes, gl.STREAM_DRAW);

        // Good practice
        gl.bindVertexArray(null);
    }

    /**
     * Load program. No arguments.
     */
    load() {
        this.gl.uniform1iv(this._inputTexturesLoc, this._textureIndexes);
        this.gl.disable(this.gl.BLEND);
    }

    /**
     * Use program. Arbitrary arguments.
     * @param {RenderOutput} renderOutput
     * @param {FPRenderPackage[]} sourceArray
     * @param {RenderOptions} options
     */
    use(renderOutput, sourceArray, options) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.offScreenBuffer);
        gl.enable(gl.STENCIL_TEST);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.stencilClipBuffer);

        // this.fpTexture = this.fpTexture === this.colorTextureA ? this.colorTextureB : this.colorTextureA;
        // this.fpTextureClip = this.fpTextureClip === this.stencilTextureA ? this.stencilTextureB : this.stencilTextureA;
        this.fpTexture = this.colorTextureA;
        this.fpTextureClip = this.stencilTextureA;

        this._renderOffset = 0;

        // Allocate reusable buffers once
        if (!this._tempMatrixData) {
            this._tempMatrixData = new Float32Array(this._maxTextures * 9);
            this._tempTexCoords = new Float32Array(this._maxTextures * 8);
        }
        let wasClipping = true; // force first init (~ as if was clipping was true)

        for (const renderInfo of sourceArray) {
            const rasterTiles = renderInfo.tiles;
            const attachments = [];
            // for (let i = 0; i < 1; i++) {
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                    this.fpTexture, 0, this._renderOffset);
                attachments.push(gl.COLOR_ATTACHMENT0);

                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + 1,
                    this.fpTextureClip, 0, this._renderOffset);
                attachments.push(gl.COLOR_ATTACHMENT0 + 1);
            //}
            gl.drawBuffers(attachments);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

            // First, clip polygons if any required
            if (renderInfo.polygons.length) {
                gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);

                // Note: second param unused for now...
                gl.uniform2f(this._renderClipping, 1, 0);
                gl.bindVertexArray(this.firstPassVaoClip);

                gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBufferClip);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(renderInfo._temp.values));

                for (const polygon of renderInfo.polygons) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionsBufferClip);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(polygon), gl.STATIC_DRAW);
                    gl.drawArrays(gl.TRIANGLE_FAN, 0, polygon.length / 2);
                }

                gl.stencilFunc(gl.EQUAL, renderInfo.polygons.length, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                // Note: second param unused for now...
                gl.uniform2f(this._renderClipping, 0, 0);
                wasClipping = true;

            } else if (wasClipping) {
                gl.uniform2f(this._renderClipping, 0, 0);
                gl.stencilFunc(gl.EQUAL, 0, 0xFF);
                wasClipping = false;
            }

            const tileCount = rasterTiles.length;
            if (tileCount) {
                // Then draw join tiles
                gl.bindVertexArray(this.firstPassVao);
                let currentIndex = 0;
                while (currentIndex < tileCount) {
                    const batchSize = Math.min(this._maxTextures, tileCount - currentIndex);

                    for (let i = 0; i < batchSize; i++) {
                        const tile = rasterTiles[currentIndex + i];

                        gl.activeTexture(gl.TEXTURE0 + i);
                        gl.bindTexture(gl.TEXTURE_2D, tile.texture);

                        this._tempMatrixData.set(tile.transformMatrix, i * 9);
                        this._tempTexCoords.set(tile.position, i * 8);
                    }

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordsBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempTexCoords.subarray(0, batchSize * 8));

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempMatrixData.subarray(0, batchSize * 9));

                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batchSize);
                    currentIndex += batchSize;
                }
            }

            const vectors = renderInfo.vectors;
            if (vectors && vectors.length) {
                // Signal geometry branch in shader
                gl.uniform2f(this._renderClipping, 1, 1);
                gl.bindVertexArray(this.firstPassVaoGeom);

                for (let vectorTile of vectors) {
                    let batch = vectorTile.fills;
                    if (batch) {
                        // Upload per-tile transform matrix (we draw exactly 1 instance)
                        gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboCol);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    batch = vectorTile.lines;
                    if (batch) {
                        if (!vectorTile.fills) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboCol);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }
                }
                gl.uniform2f(this._renderClipping, 0, 0);
            }

            this._renderOffset++;
        }

        gl.disable(gl.STENCIL_TEST);
        gl.bindVertexArray(null);

        if (!renderOutput) {
            renderOutput = {};
        }
        renderOutput.texture = this.fpTexture;
        renderOutput.stencil = this.fpTextureClip;
        return renderOutput;
    }

    unload() {
    }

    setDimensions(x, y, width, height, dataLayerCount) {
        // Double swapping required else collisions
        this._createOffscreenTexture("colorTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("colorTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._createOffscreenTexture("stencilTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("stencilTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        const gl  = this.gl;
        if (this.stencilClipBuffer) {
            gl.deleteRenderbuffer(this.stencilClipBuffer);
        }
        this.stencilClipBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.stencilClipBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
    }


    /**
     * Destroy program. No arguments.
     */
    destroy() {
        // todo calls here might be frequent due to initialization... try to optimize, e.g. soft delete
        const gl = this.gl;
        gl.deleteFramebuffer(this.offScreenBuffer);
        this.offScreenBuffer = null;
        gl.deleteTexture(this.colorTextureA);
        this.colorTextureA = null;
        gl.deleteTexture(this.stencilTextureA);
        this.stencilTextureA = null;
        // gl.deleteTexture(this.colorTextureB);
        // this.colorTextureB = null;
        // gl.deleteTexture(this.stencilTextureB);
        // this.stencilTextureB = null;

        gl.deleteVertexArray(this.firstPassVaoGeom);
        gl.deleteBuffer(this.positionsBufferGeom);
        this.firstPassVaoGeom = null;
        this.positionsBufferGeom = null;
        this.matrixBufferGeom = null;

        this.stencilClipBuffer = null;

        gl.deleteVertexArray(this.firstPassVao);
        gl.deleteBuffer(this.matrixBuffer);
        gl.deleteBuffer(this.texCoordsBuffer);
        this.matrixBuffer = null;
        this.firstPassVao = null;
        this.texCoordsBuffer = null;

        this.firstPassVaoClip = gl.createVertexArray();
        gl.deleteVertexArray(this.firstPassVaoClip);
        // gl.deleteBuffer(this.positionsBuffer);
        // this.positionsBuffer = null;
        gl.deleteBuffer(this.matrixBufferClip);
        this.matrixBufferClip = null;
        gl.deleteBuffer(this.positionsBufferClip);
        this.positionsBufferClip = null;
    }

    _createOffscreenTexture(name, width, height, layerCount, filter) {
        layerCount = Math.max(layerCount, 1);
        const gl = this.gl;

        let texRef = this[name];
        if (texRef) {
            gl.deleteTexture(texRef);
        }

        this[name] = texRef = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, texRef);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, layerCount);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
};

// todo: support no-atlas mode (dont bind anything if not used at all)
$.FlexRenderer.WebGL20.TextureAtlas2DArray = class extends $.FlexRenderer.TextureAtlas {

    constructor(gl, opts) {
        super(gl, opts);
        this.version = 1;
        this._atlasUploadedVersion = -1;

        /** @type {{ id:number, source:any, w:number, h:number, layer:number, x:number, y:number }[]} */
        this._entries = [];
        this._pendingUploads = [];

        /** @type {{ shelves: { y:number, h:number, x:number }[], nextY:number }[]} */
        this._layerState = [];

        // Per-id uniforms for the shader
        this._scale = new Float32Array(this.maxIds * 2);   // sx, sy
        this._offset = new Float32Array(this.maxIds * 2);  // ox, oy
        this._layer = new Int32Array(this.maxIds);         // layer index
        this._createTexture(this.layerWidth, this.layerHeight, this.layers);
    }


    /**
     * Add an image. Returns a stable atlasId.
     * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
     * @param {number} [w]
     * @param {number} [h]
     * @returns {number}
     */
    addImage(source, w, h) {
        const width = (typeof w === 'number') ? w :
            (source && (source.width || source.naturalWidth || (source.canvas && source.canvas.width) || source.w));
        const height = (typeof h === 'number') ? h :
            (source && (source.height || source.naturalHeight || (source.canvas && source.canvas.height) || source.h));

        if (!width || !height) {
            throw new Error('TextureAtlas2DArray.addImage: width or height missing');
        }

        const place = this._ensureCapacityFor(width, height);

        const id = this._entries.length;

        // uniforms for shader (can be uploaded later; we just fill CPU buffers now)
        this._layer[id] = place.layer;
        this._scale[id * 2 + 0] = width / this.layerWidth;
        this._scale[id * 2 + 1] = height / this.layerHeight;
        this._offset[id * 2 + 0] = (place.x + this.padding) / this.layerWidth;
        this._offset[id * 2 + 1] = (place.y + this.padding) / this.layerHeight;

        // remember for re-pack / re-upload
        this._entries.push({
            id: id,
            source: source,
            w: width,
            h: height,
            layer: place.layer,
            x: place.x,
            y: place.y
        });

        // enqueue GPU upload (performed later in load()/commitUploads())
        this._pendingUploads.push({
            source: source,
            w: width,
            h: height,
            layer: place.layer,
            x: place.x,
            y: place.y
        });

        if (id + 1 > this.maxIds) {
            throw new Error('TextureAtlas2DArray: exceeded maxIds capacity');
        }

        this.version++;
        return id;
    }

    /**
     * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
     * @param textureUnit
     */
    bind(textureUnit) {
        const gl = this.gl;

        // textureUnit is the numeric unit index (0..N-1)
        gl.activeTexture(textureUnit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        // only push uniform arrays when changed (fast and harmless during draw)
        if (this._atlasUploadedVersion !== this.version) {
            gl.uniform2fv(this._atlasScaleLoc, this._scale);
            gl.uniform2fv(this._atlasOffsetLoc, this._offset);
            gl.uniform1iv(this._atlasLayerLoc, this._layer);
            this._atlasUploadedVersion = this.version;
        }
    }

    /**
     * Get WebGL Atlas shader code. This code must define the following function:
     * vec4 osd_atlas_texture(int, vec2)
     * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
     *
     * @return {string}
     */
    getFragmentShaderDefinition() {
        return `
uniform sampler2DArray u_atlasTex;
uniform vec2  u_atlasScale[${this.maxIds}];
uniform vec2  u_atlasOffset[${this.maxIds}];
uniform int   u_atlasLayer[${this.maxIds}];

vec4 osd_atlas_texture(int atlasId, vec2 uv) {
    vec2 st = uv * u_atlasScale[atlasId] + u_atlasOffset[atlasId];
    float layer = float(u_atlasLayer[atlasId]);
    return texture(u_atlasTex, vec3(st, layer));
}
`;
    }

    /**
     * Load the current atlas uniform locations.
     * @param {WebGLProgram} program
     */
    load(program) {
        const gl = this.gl;

        // fetch uniform locations (existing behavior)
        this._atlasTexLoc    = gl.getUniformLocation(program, "u_atlasTex");
        this._atlasScaleLoc  = gl.getUniformLocation(program, "u_atlasScale[0]");
        this._atlasOffsetLoc = gl.getUniformLocation(program, "u_atlasOffset[0]");
        this._atlasLayerLoc  = gl.getUniformLocation(program, "u_atlasLayer[0]");

        // commit all staged texSubImage3D uploads in a single pass
        this._commitUploads();

        // (optional) you can also pre-upload the uniform arrays here once right after commit
        if (this._atlasUploadedVersion !== this.version) {
            gl.uniform2fv(this._atlasScaleLoc, this._scale);
            gl.uniform2fv(this._atlasOffsetLoc, this._offset);
            gl.uniform1iv(this._atlasLayerLoc, this._layer);
            this._atlasUploadedVersion = this.version;
        }
    }

    /**
     * Destroy the atlas.
     */
    destroy() {
        const gl = this.gl;

        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }

        this._entries.length = 0;
        this._layerState.length = 0;
    }

    _commitUploads() {
        if (!this.texture) {
            // allocate storage if not created yet
            this._createTexture(this.layerWidth, this.layerHeight, this.layers);
        }

        if (!this._pendingUploads.length) {
            return;
        }

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        for (const u of this._pendingUploads) {
            const x = u.x + this.padding;
            const y = u.y + this.padding;

            if (u.source instanceof ImageBitmap ||
                (typeof HTMLImageElement !== 'undefined' && u.source instanceof HTMLImageElement) ||
                (typeof HTMLCanvasElement !== 'undefined' && u.source instanceof HTMLCanvasElement)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source);
            } else if (u.source && u.source.data && typeof u.source.width === 'number' && typeof u.source.height === 'number') {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source.data);
            } else if (u.source && (u.source instanceof Uint8Array || u.source instanceof Uint8ClampedArray)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source);
            } else {
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
                throw new Error('Unsupported image source for atlas');
            }
        }

        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        // all uploads done; clear queue
        this._pendingUploads.length = 0;
    }

    _createTexture(w, h, depth) {
        const gl = this.gl;

        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, this.internalFormat, w, h, Math.max(depth, 1));
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        this.layerWidth = w;
        this.layerHeight = h;
        this.layers = depth;

        // reset packer state sized to current depth
        this._layerState = [];
        for (let i = 0; i < depth; i++) {
            this._layerState.push({ shelves: [], nextY: 0 });
        }
    }

    _ensureCapacityFor(width, height) {
        // try current layers first
        for (let li = 0; li < this.layers; li++) {
            const pos = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
            if (pos) {
                return { layer: li, x: pos.x, y: pos.y, willRealloc: false };
            }
        }

        // if rectangle is bigger than layer extent, grow extent (power of 2)
        let newW = this.layerWidth;
        let newH = this.layerHeight;
        if (width + this.padding * 2 > newW || height + this.padding * 2 > newH) {
            while (newW < width + this.padding * 2) {
                newW *= 2;
            }
            while (newH < height + this.padding * 2) {
                newH *= 2;
            }
            // reallocate texture with same layer count but bigger extent
            this._resizeAndReupload(newW, newH, this.layers);
        }

        // try again after extent growth
        for (let li = 0; li < this.layers; li++) {
            const pos2 = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
            if (pos2) {
                return { layer: li, x: pos2.x, y: pos2.y, willRealloc: false };
            }
        }

        // still not fitting due to fragmentation / filled layers: add one or more layers
        let newLayers = Math.max(this.layers * 2, this.layers + 1);
        this._resizeAndReupload(this.layerWidth, this.layerHeight, newLayers);

        // after adding layers there will be empty layers to place into
        const li = this._firstEmptyLayer();
        const pos3 = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
        return { layer: li, x: pos3.x, y: pos3.y, willRealloc: false };
    }

    _firstEmptyLayer() {
        for (let i = 0; i < this.layers; i++) {
            const st = this._layerState[i];
            if ((st.nextY === 0) && st.shelves.length === 0) {
                return i;
            }
        }
        return 0;
    }

    _resizeAndReupload(newW, newH, newLayers) {
        // keep old entries and repack from scratch
        const oldEntries = this._entries.slice();

        this._createTexture(newW, newH, newLayers);

        // clear packing and pending upload queues
        this._entries.length = 0;
        this._pendingUploads.length = 0;

        // re-place each entry; update uniforms; enqueue for upload
        for (const ent of oldEntries) {
            const pos = this._ensureCapacityFor(ent.w, ent.h);
            ent.layer = pos.layer;
            ent.x = pos.x;
            ent.y = pos.y;

            const id = ent.id;

            this._layer[id] = ent.layer;
            this._scale[id * 2 + 0] = ent.w / this.layerWidth;
            this._scale[id * 2 + 1] = ent.h / this.layerHeight;
            this._offset[id * 2 + 0] = (ent.x + this.padding) / this.layerWidth;
            this._offset[id * 2 + 1] = (ent.y + this.padding) / this.layerHeight;

            this._entries.push(ent);
            this._pendingUploads.push({
                source: ent.source,
                w: ent.w,
                h: ent.h,
                layer: ent.layer,
                x: ent.x,
                y: ent.y
            });
        }

        // mark uniforms changed; actual GPU uploads will occur in load()/commitUploads()
        this.version++;
    }

    _tryPlaceRect(layerIndex, w, h) {
        const W = this.layerWidth;
        const H = this.layerHeight;
        const st = this._layerState[layerIndex];

        // try existing shelves
        for (const shelf of st.shelves) {
            if (h <= shelf.h && shelf.x + w <= W) {
                const x = shelf.x;
                const y = shelf.y;
                shelf.x += w;
                return { x: x, y: y };
            }

        }

        // start a new shelf
        if (st.nextY + h <= H) {
            const y = st.nextY;
            st.shelves.push({ y: y, h: h, x: w });
            st.nextY += h;
            return { x: 0, y: y };
        }

        return null;
    }

    _uploadSource(source, w, h, layer, x, y) {
        const gl = this.gl;

        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        if (source instanceof ImageBitmap ||
            (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
            (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)) {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source);
        } else if (source && source.data && typeof source.width === 'number' && typeof source.height === 'number') {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source.data);
        } else if (source && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source);
        } else {
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
            throw new Error('Unsupported image source for atlas');
        }

        // optional: no mipmaps for now (icon UI)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }
};

})(OpenSeadragon);

(function( $ ){
    const OpenSeadragon = $;

    /**
     * @typedef {Object} TiledImageInfo
     * @property {Number} TiledImageInfo.id
     * @property {Number[]} TiledImageInfo.shaderOrder
     * @property {Object} TiledImageInfo.shaders
     * @property {Object} TiledImageInfo.drawers
     */

    /**
     * @property {Number} idGenerator unique ID getter
     *
     * @class OpenSeadragon.FlexDrawer
     * @classdesc implementation of WebGL renderer for an {@link OpenSeadragon.Viewer}
     */
    OpenSeadragon.FlexDrawer = class extends OpenSeadragon.DrawerBase {
        /**
         * @param {Object} options options for this Drawer
         * @param {OpenSeadragon.Viewer} options.viewer the Viewer that owns this Drawer
         * @param {OpenSeadragon.Viewport} options.viewport reference to Viewer viewport
         * @param {HTMLElement} options.element parent element
         * @param {[String]} options.debugGridColor see debugGridColor in {@link OpenSeadragon.Options} for details
         * @param {Object} options.options optional
         *
         * @constructor
         * @memberof OpenSeadragon.FlexDrawer
         */
        constructor(options){
            super(options);

            this._destroyed = false;
            this._imageSmoothingEnabled = false; // will be updated by setImageSmoothingEnabled
            this._configuredExternally = false;
            // We have 'undefined' extra format for blank tiles
            this._supportedFormats = ["rasterBlob", "context2d", "image", "vector-mesh", "undefined"];
            this.rebuildCounter = 0;

            // reject listening for the tile-drawing and tile-drawn events, which this drawer does not fire
            this.viewer.rejectEventHandler("tile-drawn", "The WebGLDrawer does not raise the tile-drawn event");
            this.viewer.rejectEventHandler("tile-drawing", "The WebGLDrawer does not raise the tile-drawing event");
            this.viewer.world.addHandler("remove-item", (e) => {
                const tiledImage = e.item;
                // if managed internally on the instance (regardless of renderer state), handle removal
                if (tiledImage.__shaderConfig) {
                    this.renderer.removeShader(tiledImage.__shaderConfig.id);
                    delete tiledImage.__shaderConfig;
                    if (tiledImage.__wglCompositeHandler) {
                        tiledImage.removeHandler('composite-operation-change', tiledImage.__wglCompositeHandler);
                    }
                }
                // if now managed externally, just request rebuild, also updates order
                if (!this._configuredExternally) {
                    // Update keys
                    this._requestRebuild();
                }
            });
        } // end of constructor

        /**
         * Drawer type.
         * @returns {String}
         */
        getType() {
            return 'flex-renderer';
        }

        getSupportedDataFormats() {
            return this._supportedFormats;
        }

        getRequiredDataFormats() {
            return this._supportedFormats;
        }

        get defaultOptions() {
            return {
                usePrivateCache: true,
                preloadCache: true,
                copyShaderConfig: false,
                handleNavigator: true
            };
        }

        /**
         * Override the default configuration: the renderer will use given shaders,
         * supplied with data from collection of TiledImages, to render.
         * TiledImages are treated only as data sources, the rendering outcome is fully in controls of the shader specs.
         * @param {object} shaders map of id -> shader config value
         * @param {Array<string>} [shaderOrder=undefined] custom order of shader ids to render.
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        overrideConfigureAll(shaders, shaderOrder = undefined) {
            // todo reset also when reordering tiled images!
            // or we could change order only

            if (this.options.handleNavigator && this.viewer.navigator) {
                this.viewer.navigator.drawer.overrideConfigureAll(shaders, shaderOrder);
            }

            const willBeConfigured = !!shaders;
            if (!willBeConfigured) {
                if (this._configuredExternally) {
                    this._configuredExternally = false;
                    // If we changed render style, recompile everything
                    this.renderer.deleteShaders();
                    this.viewer.world._items.map(item => this.tiledImageCreated(item).id);
                }
                return $.Promise.resolve();
            }

            // If custom rendering used, use arbitrary external configuration
            this._configuredExternally = true;
            this.renderer.deleteShaders();
            for (let shaderID in shaders) {
                $.console.log("Registering shader", shaderID, shaders[shaderID], this._isNavigatorDrawer);
                let config = shaders[shaderID];
                this.renderer.createShaderLayer(shaderID, config, this.options.copyShaderConfig);
            }
            shaderOrder = shaderOrder || Object.keys(shaders);
            this.renderer.setShaderLayerOrder(shaderOrder);
            return this._requestRebuild();
        }

        /**
         * Retrieve shader config by its key. Shader IDs are known only
         * when overrideConfigureAll() called
         * @param key
         * @return {ShaderConfig|*|undefined}
         */
        getOverriddenShaderConfig(key) {
            const shaderLayer = this.renderer.getAllShaders()[key];
            return shaderLayer ? shaderLayer.getConfig() : undefined;
        }

        /**
         * If shaders are managed internally, tiled image can be configured a single custom
         * shader if desired. This shader is ignored if overrideConfigureAll({...}) used.
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @param {ShaderConfig} shader
         * @return {ShaderConfig} shader config used, a copy if options.copyShaderConfig is true, otherwise a modified argument
         */
        configureTiledImage(tiledImage, shader) {
            if (this.options.copyShaderConfig) {
                shader = $.extend(true, {}, shader);
            }

            shader.id = shader.id || tiledImage.__shaderConfig.id || this.constructor.idGenerator;
            tiledImage.__shaderConfig = shader;

            // if already configured, request re-configuration
            if (tiledImage.__wglCompositeHandler) {
                this.tiledImageCreated(tiledImage);
            }

            if (this.options.handleNavigator && this.viewer.navigator) {
                const nav = this.viewer.navigator;
                let tiledImageNavigator = null;
                for (let i = 0; i < nav.world.getItemCount(); i++) {
                    if (nav.world.getItemAt(i).source === tiledImage.source) {
                        tiledImageNavigator = nav.world.getItemAt(i);
                        break;
                    }
                }

                if (tiledImageNavigator) {
                    this.viewer.navigator.drawer.configureTiledImage(tiledImageNavigator, shader);
                } else {
                    $.console.warn("Could not find corresponding tiled image for the navigator!");
                }
            }

            return shader;
        }

        /**
         * Register TiledImage into the system.
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        tiledImageCreated(tiledImage) {
            // Always attempt to clean up
            if (tiledImage.__wglCompositeHandler) {
                tiledImage.removeHandler('composite-operation-change', tiledImage.__wglCompositeHandler);
            }

            // If we configure externally the renderer, simply bypass
            if (this._configuredExternally) {
                // __shaderConfig reference is kept only when managed internally, can keep custom shader config for particular tiled image
                delete tiledImage.__shaderConfig;
                return this._requestRebuild();
            }

            let config = tiledImage.__shaderConfig;
            if (!config) {
                config = tiledImage.__shaderConfig = {
                    name: "Identity shader",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    params: {},
                    cache: {},
                };
            }

            if (!config.id) {
                // potentially problematic, relies on the fact that navigator is always initialized second
                // shared ID are required for controls, which have only 1 present HTML but potentially two listeners
                if (this._isNavigatorDrawer) {
                    const parent = this.viewer.viewer;
                    for (let i = 0; i < parent.world.getItemCount(); i++) {
                        const tiledImageParent = parent.world.getItemAt(i);
                        if (tiledImageParent.source === tiledImage.source) {
                            config.id = tiledImageParent.__shaderConfig.id;
                            break;
                        }
                    }
                }
                if (!config.id) {
                    // generate a unique ID for the shader
                    config.id = this.constructor.idGenerator;
                }
            }

            const shaderId = config.id;

            // When this._configuredExternally == false, the index is always self index, deduced dynamically
            const property = Object.getOwnPropertyDescriptor(config, 'tiledImages');
            if (!property || property.configurable) {
                delete config.tiledImages;

                // todo make custom renderer pass tiledImages as array of tiled images -> will deduce easily
                Object.defineProperty(config, "tiledImages", {
                    get: () => [this.viewer.world.getIndexOfItem(tiledImage)]
                });
            } // else already set as a getter


            if (!config.params.use_blend && tiledImage.compositeOperation) {
                // eslint-disable-next-line camelcase
                config.params.use_mode = 'blend';
                // eslint-disable-next-line camelcase
                config.params.use_blend = tiledImage.compositeOperation;
            }

            tiledImage.__wglCompositeHandler = e => {
                const shader = this.renderer.getShaderLayer(shaderId);
                const config = shader.getConfig();
                const operation = tiledImage.compositeOperation;
                if (operation) {
                    // eslint-disable-next-line camelcase
                    config.params.use_blend = operation;
                    // eslint-disable-next-line camelcase
                    config.params.use_mode = 'blend';
                } else {
                    // eslint-disable-next-line camelcase
                    delete config.params.use_blend;
                    // eslint-disable-next-line camelcase
                    config.params.use_mode = 'show';
                }
                shader.resetMode(config.params, true);
                this._requestRebuild(0);
            };

            tiledImage.addHandler('composite-operation-change', tiledImage.__wglCompositeHandler);

            // copy config only applied when passed externally
            this.renderer.createShaderLayer(shaderId, config, false);
            return this._requestRebuild();
        }

        /**
         * Rebuild current shaders to reflect updated configurations.
         * @return {Promise}
         */
        rebuild() {
            if (this.options.handleNavigator) {
                this.viewer.navigator.drawer.rebuild();
            }
            return this._requestRebuild();
        }

        /**
         * Clean up the FlexDrawer, removing all resources.
         */
        destroy() {
            if (this._destroyed) {
                return;
            }
            const gl = this._gl;

            // clean all texture units; adapted from https://stackoverflow.com/a/23606581/1214731
            var numTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
            for (let unit = 0; unit < numTextureUnits; ++unit) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);

                if (this.webGLVersion === "2.0") {
                    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);


            // this._renderingCanvas = null;
            let ext = gl.getExtension('WEBGL_lose_context');
            if (ext) {
                ext.loseContext();
            }
            // set our webgl context reference to null to enable garbage collection
            this._gl = null;

            // unbind our event listeners from the viewer
            this.viewer.removeHandler("resize", this._resizeHandler);

            if (!this.options.offScreen) {
                this.container.removeChild(this.canvas);
                if (this.viewer.drawer === this){
                    this.viewer.drawer = null;
                }
            }

            this.renderer.destroy();
            this.renderer = null;

            // set our destroyed flag to true
            this._destroyed = true;
        }

        _hasInvalidBuildState() {
            return this._requestBuildStamp > this._buildStamp;
        }

        _requestRebuild(timeout = 30, force = false) {
            this._requestBuildStamp = Date.now();
            if (this._rebuildHandle) {
                if (!force) {
                    return $.Promise.resolve();
                }
                clearTimeout(this._rebuildHandle);
            }

            if (timeout === 0) {
                this._buildStamp = Date.now();
                this.renderer.setDimensions(0, 0, this.canvas.width, this.canvas.height, this.viewer.world.getItemCount());
                // this.renderer.registerProgram(null, this.renderer.webglContext.firstPassProgramKey);
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.rebuildCounter++;
                return $.Promise.resolve();
            }

            return new $.Promise((success, _) => {
                this._rebuildHandle = setTimeout(() => {
                    if (!this._configuredExternally) {
                        this.renderer.setShaderLayerOrder(this.viewer.world._items.map(item =>
                            item.__shaderConfig.id));
                    }
                    this._buildStamp = Date.now();
                    this.renderer.setDimensions(0, 0, this.canvas.width, this.canvas.height, this.viewer.world.getItemCount());
                    // this.renderer.registerProgram(null, this.renderer.webglContext.firstPassProgramKey);
                    this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                    this.rebuildCounter++;
                    this._rebuildHandle = null;
                    success();
                    setTimeout(() => {
                        this.viewer.forceRedraw();
                    });
                }, timeout);
            });
        }

        /**
         * Initial setup of all three canvases used (output, rendering) and their contexts (2d, 2d, webgl)
         */
        _setupCanvases() {
            // this._outputCanvas = this.canvas; //canvas on screen
            // this._outputContext = this._outputCanvas.getContext('2d');

            // this._renderingCanvas = this.renderer.canvas; //canvas for webgl

            // this._renderingCanvas.width = this._outputCanvas.width;
            // this._renderingCanvas.height = this._outputCanvas.height;

            this._resizeHandler = () => {
                // if(this._outputCanvas !== this.viewer.drawer.canvas) {
                //     this._outputCanvas.style.width = this.viewer.drawer.canvas.clientWidth + 'px';
                //     this._outputCanvas.style.height = this.viewer.drawer.canvas.clientHeight + 'px';
                // }

                let viewportSize = this._calculateCanvasSize();
                if (this.debug) {
                    console.info('Resize event, newWidth, newHeight:', viewportSize.x, viewportSize.y);
                }

                // if( this._outputCanvas.width !== viewportSize.x ||
                //     this._outputCanvas.height !== viewportSize.y ) {
                //     this._outputCanvas.width = viewportSize.x;
                //     this._outputCanvas.height = viewportSize.y;
                // }

                // todo necessary?
                // this._renderingCanvas.style.width = this._outputCanvas.clientWidth + 'px';
                // this._renderingCanvas.style.height = this._outputCanvas.clientHeight + 'px';
                // this._renderingCanvas.width = this._outputCanvas.width;
                // this._renderingCanvas.height = this._outputCanvas.height;

                this.renderer.setDimensions(0, 0, viewportSize.x, viewportSize.y, this.viewer.world.getItemCount());
                this._size = viewportSize;
            };
            this.viewer.addHandler("resize", this._resizeHandler);
        }

        // DRAWING METHODS
        /**
         * Draw using FlexRenderer.
         * @param {[TiledImage]} tiledImages array of TiledImage objects to draw
         * @param {Object} [view=undefined] custom view position if desired
         * @param view.bounds {OpenSeadragon.Rect} bounds of the viewport
         * @param view.center {OpenSeadragon.Point} center of the viewport
         * @param view.rotation {Number} rotation of the viewport
         * @param view.zoom {Number} zoom of the viewport
         */
        draw(tiledImages, view = undefined) {
            // If we did not rebuild yet, avoid rendering - invalid program
            if (this._hasInvalidBuildState()) {
                this.viewer.forceRedraw();
                return;
            }

            const bounds = this.viewport.getBoundsNoRotateWithMargins(true);
            view = view || {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: this.viewport.getRotation(true) * Math.PI / 180,
                zoom: this.viewport.getZoom(true)
            };

            // TODO consider sending data and computing on GPU
            // calculate view matrix for viewer
            let flipMultiplier = this.viewport.flipped ? -1 : 1;
            let posMatrix = $.Mat3.makeTranslation(-view.center.x, -view.center.y);
            let scaleMatrix = $.Mat3.makeScaling(2 / view.bounds.width * flipMultiplier, -2 / view.bounds.height);
            let rotMatrix = $.Mat3.makeRotation(-view.rotation);
            let viewMatrix = scaleMatrix.multiply(rotMatrix).multiply(posMatrix);

            if (this._drawTwoPassFirst(tiledImages, view, viewMatrix)) {
                this._drawTwoPassSecond(view);
            }
        } // end of function

        /**
         * Allow drawing to FBO instead of the main canvas.
         * This works once per draw, the configuration is discarded afterwads.
         * You should use
         * const context = this.initDrawFBO();
         * this.draw(...)
         * const data = this.freeDrawFRBO(context); //cleanup
         *
         * @return {object} { fbo, tex } context info
         */
        initDrawFBO() {
            const gl = this.renderer.gl;
            const w = this.canvas.width,
                h = this.canvas.height;

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

            // verify completeness
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn('Export FBO incomplete:', status.toString(16));
            }

            this.__activeOutputFBO = fbo;
            return { fbo, tex };
        }

        /**
         * Retrieve drawing from FBO instead of the main canvas.
         * Requires prior call of initDrawFBO
         * const context = this.initDrawFBO();
         * this.draw(...)
         * const data = this.freeDrawFRBO(context); //cleanup
         *
         * @return {CanvasRenderingContext2D} output data
         */
        freeDrawFRBO(context) {
            const gl = this.renderer.gl;
            const w = this.canvas.width,
                h = this.canvas.height;
            const { fbo, tex } = context;

            // Ensure we read from the exact FBO we drew into
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            if (gl.readBuffer) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
            }

            const pixels = new Uint8ClampedArray(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const err = gl.getError();
            if (err) {
                console.warn('readPixels error:', err);
            }

            // Flip Y in-place (single output canvas)
            const rowBytes = w * 4;
            const row = new Uint8ClampedArray(rowBytes);
            for (let y = 0; y < (h >> 1); y++) {
                const top = y * rowBytes,
                    bot = (h - 1 - y) * rowBytes;
                row.set(pixels.subarray(top, top + rowBytes));
                pixels.copyWithin(top, bot, bot + rowBytes);
                pixels.set(row, bot);
            }

            // Write to a single output canvas
            const output = document.createElement('canvas');
            output.width = w;
            output.height = h;
            const ctx = output.getContext('2d', { willReadFrequently: true });
            ctx.putImageData(new ImageData(pixels, w, h), 0, 0);

            // Cleanup
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            gl.deleteTexture(tex);
            this.__activeOutputFBO = null;

            return ctx;
        }

        /**
         * During the first-pass draw all tiles' data sources into the corresponding off-screen textures using identity rendering,
         * excluding any image-processing operations or any rendering customizations.
         * @param {OpenSeadragon.TiledImage[]} tiledImages array of TiledImage objects to draw
         * @param {Object} viewport has bounds, center, rotation, zoom
         * @param {OpenSeadragon.Mat3} viewMatrix
         */
        _drawTwoPassFirst(tiledImages, viewport, viewMatrix) {
            const gl = this._gl;

            // FIRST PASS (render things as they are into the corresponding off-screen textures)
            const TI_PAYLOAD = [];
            for (let tiledImageIndex = 0; tiledImageIndex < tiledImages.length; tiledImageIndex++) {
                const tiledImage = tiledImages[tiledImageIndex];
                const payload = [];
                const vecPayload = [];

                const tilesToDraw = tiledImage.getTilesToDraw();

                let overallMatrix = viewMatrix;
                let imageRotation = tiledImage.getRotation(true);
                // if needed, handle the tiledImage being rotated

                // todo consider in-place multiplication, this creates insane amout of arrays
                if( imageRotation % 360 !== 0) {
                    let imageRotationMatrix = $.Mat3.makeRotation(-imageRotation * Math.PI / 180);
                    let imageCenter = tiledImage.getBoundsNoRotate(true).getCenter();
                    let t1 = $.Mat3.makeTranslation(imageCenter.x, imageCenter.y);
                    let t2 = $.Mat3.makeTranslation(-imageCenter.x, -imageCenter.y);

                    // update the view matrix to account for this image's rotation
                    let localMatrix = t1.multiply(imageRotationMatrix).multiply(t2);
                    overallMatrix = viewMatrix.multiply(localMatrix);
                }

                if (tiledImage.getOpacity() > 0 && tilesToDraw.length > 0) {
                    // TODO support placeholder?
                    // if (tiledImage.placeholderFillStyle && tiledImage._hasOpaqueTile === false) {
                    //     this._drawPlaceholder(tiledImage);
                    // }

                    for (let tileIndex = 0; tileIndex < tilesToDraw.length; ++tileIndex) {
                        const tile = tilesToDraw[tileIndex].tile;

                        const tileInfo = this.getDataToDraw(tile);
                        if (!tileInfo) {
                            //TODO consider drawing some error if the tile is in erroneous state
                            continue;
                        }
                        const transformMatrix = this._updateTileMatrix(tileInfo, tile, tiledImage, overallMatrix);
                        if (tileInfo.texture) {
                            payload.push({
                                transformMatrix,
                                dataIndex: tiledImageIndex,
                                texture: tileInfo.texture,
                                position: tileInfo.position,
                                tile: tile
                            });
                        } else if (tileInfo.vectors) {
                            // Flatten fill + line meshes into a simple draw list

                            if (tileInfo.vectors.fills) {
                                tileInfo.vectors.fills.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.lines) {
                                tileInfo.vectors.lines.matrix = transformMatrix;
                            }
                            vecPayload.push(tileInfo.vectors);
                        }
                    }
                }

                let polygons;

                //TODO: osd could cache this.getBoundsNoRotate(current) which might be fired many times in rendering (possibly also other parts)
                if (tiledImage._croppingPolygons) {
                    polygons = tiledImage._croppingPolygons.map(polygon => polygon.flatMap(coord => {
                        let point = tiledImage.imageToViewportCoordinates(coord.x, coord.y, true);
                        return [point.x, point.y];
                    }));
                } else {
                    polygons = [];
                }
                if (tiledImage._clip) {
                    const polygon = [
                        {x: tiledImage._clip.x, y: tiledImage._clip.y},
                        {x: tiledImage._clip.x + tiledImage._clip.width, y: tiledImage._clip.y},
                        {x: tiledImage._clip.x + tiledImage._clip.width, y: tiledImage._clip.y + tiledImage._clip.height},
                        {x: tiledImage._clip.x, y: tiledImage._clip.y + tiledImage._clip.height},
                    ];
                    polygons.push(polygon.flatMap(coord => {
                        let point = tiledImage.imageToViewportCoordinates(coord.x, coord.y, true);
                        return [point.x, point.y];
                    }));
                }

                TI_PAYLOAD.push({
                    tiles: payload,
                    vectors: vecPayload,
                    polygons: polygons,
                    dataIndex: tiledImageIndex,
                    _temp: overallMatrix, // todo dirty
                });
            }

            // todo flatten render data

            if (!TI_PAYLOAD.length) {
                this.renderer.gl.clear(gl.COLOR_BUFFER_BIT);
                return false;
            }
            this.renderer.firstPassProcessData(TI_PAYLOAD);
            return true;
        }

        /**
         * During the second-pass draw from the off-screen textures into the rendering canvas,
         * applying the image-processing operations and rendering customizations.
         * @param {Object} viewport has bounds, center, rotation, zoom
         */
        _drawTwoPassSecond(viewport) {
            const sources = [];
            const shaders = this.renderer.getAllShaders();

            for (let shaderID of this.renderer.getShaderLayerOrder()) {
                const shader = shaders[shaderID];
                const config = shader.getConfig();

                // TODO Here we could do some nicer logics, RN we just treat TI0 as a source of truth
                // also when rendering offscreen, the tiled image might be detached
                const tiledImage = this.viewer.world.getItemAt(config.tiledImages[0]);
                sources.push({
                    zoom: viewport.zoom,
                    pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
                    opacity: tiledImage ? tiledImage.getOpacity() : 1,
                    shader: shader
                });
            }

            if (!sources.length) {
                this.viewer.forceRedraw();
                return false;
            }

            this.renderer.secondPassProcessData(sources, { framebuffer: null });
            this.renderer.gl.finish();
            return true;
        }

        _getTileRenderMeta(tile, tiledImage) {
            let result = tile._renderStruct;
            if (result) {
                return result;
            }

            // Overlap fraction of tile if set
            let overlap = tiledImage.source.tileOverlap;
            if (overlap > 0) {
                let nativeWidth = tile.sourceBounds.width; // in pixels
                let nativeHeight = tile.sourceBounds.height; // in pixels
                let overlapWidth  = (tile.x === 0 ? 0 : overlap) + (tile.isRightMost ? 0 : overlap); // in pixels
                let overlapHeight = (tile.y === 0 ? 0 : overlap) + (tile.isBottomMost ? 0 : overlap); // in pixels
                let widthOverlapFraction = overlap / (nativeWidth + overlapWidth); // as a fraction of image including overlap
                let heightOverlapFraction = overlap / (nativeHeight + overlapHeight); // as a fraction of image including overlap
                tile._renderStruct = result = {
                    overlapX: widthOverlapFraction,
                    overlapY: heightOverlapFraction
                };
            } else {
                tile._renderStruct = result = {
                    overlapX: 0,
                    overlapY: 0
                };
            }

            return result;
        }

        /**
         * Get transform matrix that will be applied to tile.
         */
        _updateTileMatrix(tileInfo, tile, tiledImage, viewMatrix){
            let tileMeta = this._getTileRenderMeta(tile, tiledImage);
            let xOffset = tile.positionedBounds.width * tileMeta.overlapX;
            let yOffset = tile.positionedBounds.height * tileMeta.overlapY;

            let x = tile.positionedBounds.x + (tile.x === 0 ? 0 : xOffset);
            let y = tile.positionedBounds.y + (tile.y === 0 ? 0 : yOffset);
            let right = tile.positionedBounds.x + tile.positionedBounds.width - (tile.isRightMost ? 0 : xOffset);
            let bottom = tile.positionedBounds.y + tile.positionedBounds.height - (tile.isBottomMost ? 0 : yOffset);

            const model = new $.Mat3([
                right - x, 0, 0, // sx = width
                0, bottom - y, 0, // sy = height
                x, y, 1
            ]);

            if (tile.flipped) {
                // For documentation:
                // // - flips the tile so that we see it's back
                // const flipLeftAroundTileOrigin = $.Mat3.makeScaling(-1, 1);
                // //  tile's geometry stays the same so when looking at it's back we gotta reverse the logic we would normally use
                // const moveRightAfterScaling = $.Mat3.makeTranslation(-1, 0);
                // matrix = matrix.multiply(flipLeftAroundTileOrigin).multiply(moveRightAfterScaling);

                //Optimized:
                model.scaleAndTranslateSelf(-1, 1, 1, 0);
            }

            model.scaleAndTranslateOtherSetSelf(viewMatrix);
            return model.values;
        }

        /**
         * Get pixel size value.
         */
        _tiledImageViewportToImageZoom(tiledImage, viewportZoom) {
            var ratio = tiledImage._scaleSpring.current.value *
                tiledImage.viewport._containerInnerSize.x /
                tiledImage.source.dimensions.x;
            return ratio * viewportZoom;
        }

        /**
         * @returns {Boolean} true
         */
        canRotate() {
            return true;
        }

        /**
         * @returns {Boolean} true if canvas and webgl are supported
         */
        static isSupported() {
            let canvasElement = document.createElement('canvas');
            let webglContext = $.isFunction(canvasElement.getContext) &&
                canvasElement.getContext('webgl');
            let ext = webglContext && webglContext.getExtension('WEBGL_lose_context');
            if (ext) {
                ext.loseContext();
            }
            return !!(webglContext);
        }

        /**
         * @param {TiledImage} tiledImage the tiled image that is calling the function
         * @returns {Boolean} Whether this drawer requires enforcing minimum tile overlap to avoid showing seams.
         * @private
         */
        minimumOverlapRequired(tiledImage) {
            // return true if the tiled image is tainted, since the backup canvas drawer will be used.
            return tiledImage.isTainted();
        }

        /**
         * Creates an HTML element into which will be drawn.
         * @private
         * @returns {HTMLCanvasElement} the canvas to draw into
         */
        _createDrawingElement() {
            // Navigator has viewer parent reference
            // todo: what about reference strip??
            this._isNavigatorDrawer = !!this.viewer.viewer;
            if (this._isNavigatorDrawer) {
                this.options.debug = false;
                this.options.handleNavigator = false;
            }

            // todo better handling, build-in ID does not comply to syntax... :/
            this._id = this.constructor.idGenerator;

            // SETUP FlexRenderer
            const rendererOptions = $.extend(
                // Default
                {
                    debug: false,
                    webGLPreferredVersion: "2.0",
                },
                // User-defined
                this.options,
                // Required
                {
                    redrawCallback: () => this.viewer.forceRedraw(),
                    refetchCallback: () => this.viewer.world.resetItems(),
                    uniqueId: "osd_" + this._id,
                    // TODO: problem when navigator renders first
                    // Navigator must not have the handler since it would attempt to define the controls twice
                    htmlHandler: this._isNavigatorDrawer ? null : this.options.htmlHandler,
                    // However, navigator must have interactive same as parent renderer to bind events to the controls
                    interactive: !!this.options.htmlHandler,
                    canvasOptions: {
                        stencil: true
                    }
                });
            this.renderer = new $.FlexRenderer(rendererOptions);

            this.renderer.setDataBlendingEnabled(true); // enable alpha blending
            this.webGLVersion = this.renderer.webglVersion;
            this.debug = rendererOptions.debug;

            const canvas = this.renderer.canvas;
            let viewportSize = this._calculateCanvasSize();

            // SETUP CANVASES
            this._gl = this.renderer.gl;
            this._setupCanvases();

            canvas.width = viewportSize.x;
            canvas.height = viewportSize.y;
            return canvas;
        }


        /**
         * Sets whether image smoothing is enabled or disabled.
         * @param {Boolean} enabled if true, uses gl.LINEAR as the TEXTURE_MIN_FILTER and TEXTURE_MAX_FILTER, otherwise gl.NEAREST
         */
        setImageSmoothingEnabled(enabled){
            if( this._imageSmoothingEnabled !== enabled ){
                this._imageSmoothingEnabled = enabled;
                this.setInternalCacheNeedsRefresh();
                this.viewer.requestInvalidate(false);
            }
        }

        internalCacheCreate(cache, tile) {
            let tiledImage = tile.tiledImage;
            let gl = this._gl;
            let position;

            if (cache.type === "undefined") {
                return null;
            }

            let data = cache.data;

            if (data instanceof CanvasRenderingContext2D) {
                data = data.canvas;
            }

            // NEW: vector geometry path (pre-tessellated triangles in tile UV space 0..1)
            if (cache.type === "vector-mesh" || (data && (data.fills || data.lines))) {
                const tileInfo = { texture: null, position: null, vectors: {} };

                const buildBatch = (meshes) => {
                    // Count totals
                    let vCount = 0,
                        iCount = 0;
                    for (const m of meshes) {
                        vCount += (m.vertices.length / 2);
                        iCount += m.indices.length;
                    }

                    // Allocate batched arrays
                    const positions = new Float32Array(vCount * 2);
                    const colors    = new Uint8Array(vCount * 4);  // normalized RGBA
                    const indices   = new Uint32Array(iCount);

                    // Fill them
                    let vOfs = 0,
                        iOfs = 0,
                        baseVertex = 0;
                    for (const m of meshes) {
                        positions.set(m.vertices, vOfs * 2);

                        // fill color per-vertex (constant per feature)
                        const rgba = m.color ? m.color : [0, 0, 0, 1];
                        const r = Math.max(0, Math.min(255, Math.round(rgba[0] * 255)));
                        const g = Math.max(0, Math.min(255, Math.round(rgba[1] * 255)));
                        const b = Math.max(0, Math.min(255, Math.round(rgba[2] * 255)));
                        const a = Math.max(0, Math.min(255, Math.round(rgba[3] * 255)));
                        for (let k = 0; k < (m.vertices.length / 2); k++) {
                            const cOfs = (vOfs + k) * 4;
                            colors[cOfs + 0] = r;
                            colors[cOfs + 1] = g;
                            colors[cOfs + 2] = b;
                            colors[cOfs + 3] = a;
                        }

                        // rebase indices
                        for (let k = 0; k < m.indices.length; k++) {
                            indices[iOfs + k] = baseVertex + m.indices[k];
                        }

                        vOfs += (m.vertices.length / 2);
                        iOfs += m.indices.length;
                        baseVertex += (m.vertices.length / 2);
                    }

                    // Upload once
                    const vboPos = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
                    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

                    const vboCol = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboCol);
                    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

                    const ibo = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

                    return { vboPos, vboCol, ibo, count: indices.length };
                };

                if (data.fills && data.fills.length) {
                    tileInfo.vectors.fills = buildBatch(data.fills);
                }
                if (data.lines && data.lines.length) {
                    tileInfo.vectors.lines = buildBatch(data.lines);
                }

                return Promise.resolve(tileInfo);
            }


            // if (cache.type === "vector-mesh") {
            //     // We keep per-primitive VBOs so first pass can draw them without re-uploading every frame
            //     const tileInfo = { texture: null, position: null, vectors: [] };
            //
            //     const meshes = Array.isArray(data.meshes) ? data.meshes : [];
            //     for (const m of meshes) {
            //         const positions = (m && m.positions) instanceof Float32Array ? m.positions : null;
            //         if (!positions || positions.length === 0) continue;
            //
            //         const color = m.color && m.color.length === 4 ? m.color : [1, 0, 0, 1]; // default red
            //
            //         const vbo = gl.createBuffer();
            //         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            //         gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
            //         tileInfo.vectors.push({
            //             buffer: vbo,
            //             count: positions.length / 2,
            //             color: new Float32Array(color)
            //         });
            //     }
            //
            //     return Promise.resolve(tileInfo);
            // }

            return createImageBitmap(data).then(data => {
                // if (!tiledImage.isTainted()) {
                // todo tained data handle
                // if((data instanceof CanvasRenderingContext2D) && $.isCanvasTainted(data.canvas)){
                //     tiledImage.setTainted(true);
                //     $.console.warn('WebGL cannot be used to draw this TiledImage because it has tainted data. Does crossOriginPolicy need to be set?');
                //     this._raiseDrawerErrorEvent(tiledImage, 'Tainted data cannot be used by the WebGLDrawer. Falling back to CanvasDrawer for this TiledImage.');
                //     this.setInternalCacheNeedsRefresh();
                // } else {
                let sourceWidthFraction, sourceHeightFraction;
                if (tile.sourceBounds) {
                    sourceWidthFraction = Math.min(tile.sourceBounds.width, data.width) / data.width;
                    sourceHeightFraction = Math.min(tile.sourceBounds.height, data.height) / data.height;
                } else {
                    sourceWidthFraction = 1;
                    sourceHeightFraction = 1;
                }

                let overlap = tiledImage.source.tileOverlap;
                if (overlap > 0){
                    // calculate the normalized position of the rect to actually draw
                    // discarding overlap.
                    let tileMeta = this._getTileRenderMeta(tile, tiledImage);

                    let left = (tile.x === 0 ? 0 : tileMeta.overlapX) * sourceWidthFraction;
                    let top = (tile.y === 0 ? 0 : tileMeta.overlapY) * sourceHeightFraction;
                    let right = (tile.isRightMost ? 1 : 1 - tileMeta.overlapX) * sourceWidthFraction;
                    let bottom = (tile.isBottomMost ? 1 : 1 - tileMeta.overlapY) * sourceHeightFraction;
                    position = new Float32Array([
                        left, bottom,
                        left, top,
                        right, bottom,
                        right, top
                    ]);
                } else {
                    position = new Float32Array([
                        0, sourceHeightFraction,
                        0, 0,
                        sourceWidthFraction, sourceHeightFraction,
                        sourceWidthFraction, 0
                    ]);
                }

                const tileInfo = {
                    position: position,
                    texture: null,
                    vectors: undefined,
                };

                try {
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);

                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this._imageSmoothingEnabled ? this._gl.LINEAR : this._gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this._imageSmoothingEnabled ? this._gl.LINEAR : this._gl.NEAREST);
                    //gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

                    // upload the image data into the texture
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
                    tileInfo.texture = texture;
                    return tileInfo;
                } catch (e){
                    // Todo a bit dirty re-use of the tainted flag, but makes the code more stable
                    tiledImage.setTainted(true);
                    $.console.error('Error uploading image data to WebGL. Falling back to canvas renderer.', e);
                    this._raiseDrawerErrorEvent(tiledImage, 'Unknown error when uploading texture. Falling back to CanvasDrawer for this TiledImage.');
                    this.setInternalCacheNeedsRefresh();
                }
                // }
                // }

                // TODO fix this
                // if (data instanceof Image) {
                //     const canvas = document.createElement( 'canvas' );
                //     canvas.width = data.width;
                //     canvas.height = data.height;
                //     const context = canvas.getContext('2d', { willReadFrequently: true });
                //     context.drawImage( data, 0, 0 );
                //     data = context;
                // }
                // if (data instanceof CanvasRenderingContext2D) {
                //     return data;
                // }
                $.console.error("Unsupported data used for WebGL Drawer - probably a bug!");
                return {};
            }).catch(e => {
                //TODO: support tile failure - if cache load fails in some way, the tile should be marked as such, and it should be allowed to enter rendering routine nevertheless
                $.console.error(`Unsupported data type! ${data}`, e);
            });
        }

        // internalCacheFree(data) {
        //     if (data && data.texture) {
        //         this._gl.deleteTexture(data.texture);
        //         data.texture = null;
        //     }
        // }

        internalCacheFree(data) {
            if (!data) {
                return;
            }
            if (data.texture) {
                this._gl.deleteTexture(data.texture);
                data.texture = null;
            }
            if (data.vectors) {
                const gl = this._gl;
                if (data.vectors.fills) {
                    gl.deleteBuffer(data.vectors.fills.vboPos);
                    gl.deleteBuffer(data.vectors.fills.vboCol);
                    gl.deleteBuffer(data.vectors.fills.ibo);
                }
                if (data.vectors.lines) {
                    gl.deleteBuffer(data.vectors.lines.vboPos);
                    gl.deleteBuffer(data.vectors.lines.vboCol);
                    gl.deleteBuffer(data.vectors.lines.ibo);
                }
                data.vectors = null;
            }
        }

        _setClip(){
            // no-op: called, handled during rendering from tiledImage data
        }
    };

    OpenSeadragon.FlexDrawer._idGenerator = 0;
    Object.defineProperty(OpenSeadragon.FlexDrawer, 'idGenerator', {
        get: function() {
            return this._idGenerator++;
        }
    });
}( OpenSeadragon ));

(function($) {

    $.makeStandaloneFlexDrawer = function(viewer) {
        const Drawer = OpenSeadragon.FlexDrawer;

        const options = $.extend(true, {}, viewer.drawerOptions[Drawer.prototype.getType()]);
        options.debug = false;
        options.htmlReset = undefined;
        options.htmlHandler = undefined;
        // avoid modification on navigator
        options.handleNavigator = false;
        options.offScreen = true;

        const drawer = new Drawer({
            viewer:             viewer,
            viewport:           viewer.viewport,
            element:            viewer.drawer.container,
            debugGridColor:     viewer.debugGridColor,
            options:            options
        });

        const originalDraw = drawer.draw.bind(drawer);
        drawer.draw = (function (tiledImages, size, view = undefined) {
            if (view) {
                const tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                const tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));

                return Promise.all(tasks).then(() => {
                    //const ctx = this.initDrawFBO();
                    this.renderer.setDimensions(0, 0, size.width, size.height, tiledImages.length);
                    originalDraw(tiledImages, view);
                    //return this.freeDrawFRBO(ctx);
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = this.renderer.canvas.width;
                    canvas.height = this.renderer.canvas.height;
                    ctx.drawImage(this.renderer.canvas, 0, 0);
                    return ctx;
                }).catch(e => console.error(e)).finally(() => {
                    // free data
                    const dId = drawer.getId();
                    tiles.forEach(t => t.tile.getCache().destroyInternalCache(dId));
                });
            }

            this.renderer.setDimensions(0, 0, size.width, size.height, tiledImages.length);
            // Steal FP initialized textures
            if (!this.renderer.__firstPassResult) {
                // todo dirty, hide the __firstPassResult structure within the program logics
                const program = this.renderer.getProgram('firstPass');
                this.renderer.__firstPassResult = {
                    texture: program.colorTextureA,
                    stencil: program.stencilTextureA,
                };
            }

            // Instead of re-rendering, we steal last state of the renderer and re-render second pass only.
            viewer.drawer.renderer.copyRenderOutputToContext(this.renderer);
            const ctx = this.initDrawFBO();
            this._drawTwoPassSecond({
                zoom: this.viewport.getZoom(true)
            });
            return this.freeDrawFRBO(ctx);

        }).bind(drawer);
        return drawer;
    };

}(OpenSeadragon));

(function($) {
/**
 * Bi-colors shader
 * data reference must contain one index to the data to render using bipolar heatmap strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  colorHigh - color to fill-in areas with high values (-->255), url encoded '#ffffff' format or digits only 'ffffff', default "#ff0000"
 *  colorLow - color to fill-in areas with low values (-->0), url encoded '#ffffff' format or digits only 'ffffff', default "#7cfc00"
 *  ctrlColor - whether to allow color modification, true or false, default true
 *  ctrlThreshold - whether to allow threshold modification, true or false, default true
 *  ctrlOpacity - whether to allow opacity modification, true or false, default true
 *
 * this shader considers insignificant values to be around the middle (0.5), and significant are low or high values,
 * the value itself is encoded in opacity (close to 1 if too low or too high), user can define two colors, for low and high values respectively
 */

$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "bipolar-heatmap";
    }

    static name() {
        return "Bi-polar Heatmap";
    }

    static description() {
        return "values are of two categories, smallest considered in the middle";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D diverging data encoded in opacity"
        }];
    }

    static get defaultControls() {
        return {
            colorHigh: {
                default: {type: "color", default: "#ff1000", title: "Color High: "},
                accepts: (type, instance) => type === "vec3",
            },
            colorLow: {
                default: {type: "color", default: "#01ff00", title: "Color Low: "},
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
        };
    }

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('v_texture_coords', 0, true)};
    if (!close(chan, .5)) {
        if (chan < .5) {
            chan = ${this.filter(`1.0 - chan * 2.0`)};
            if (chan > ${this.threshold.sample('chan', 'float')}) {
               return vec4(${this.colorLow.sample('chan', 'float')}, chan);
            }
            return vec4(.0);
        }

        chan = ${this.filter(`(chan - 0.5) * 2.0`)};
        if (chan > ${this.threshold.sample('chan', 'float')}) {
            return vec4(${this.colorHigh.sample('chan', 'float')}, chan);
        }
        return vec4(.0);
    }
`;
    }
});

})(OpenSeadragon);

(function($) {
/**
 * Colormap shader
 * data reference must contain one index to the data to render using colormap strategy
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - can be a ColorMap, number of steps = x
 *  threshold - must be an AdvancedSlider, default values array (pipes) = x-1, mask array size = x, incorrect
 *      values are changed to reflect the color steps
 *  connect - a boolean switch to enable/disable advanced slider mapping to break values, enabled for type==="colormap" only
 *
 * colors shader will read underlying data (red component) and output
 * to canvas defined color with opacity based on the data
 * (0.0 => transparent, 1.0 => opaque)
 * supports thresholding - outputs color on areas above certain value
 * mapping html input slider 0-100 to .0-1.0
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "colormap";
    }

    static name() {
        return "ColorMap";
    }

    static description() {
        return "data values encoded in color scale";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D data mapped to color map"
        }];
    }

    construct(options, dataReferences) {
        super.construct(options, dataReferences);
        //delete unused controls if applicable after initialization
        if (this.color.getName() !== "colormap") {
            this.removeControl("connect");
        }
    }

    static get defaultControls() {
        return {
            color: {
                default: {
                    type: "colormap",
                    steps: 3, //number of categories
                    default: "Viridis",
                    mode: "sequential",
                    title: "Colormap",
                    continuous: false,
                },
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {
                    type: "advanced_slider",
                    default: [0.25, 0.75], //breaks/separators, e.g. one less than bin count
                    mask: [1, 0, 1],  //same number of steps as color
                    title: "Breaks",
                    pips: {
                        mode: 'positions',
                        values: [0, 35, 50, 75, 90, 100],
                        density: 4
                    }
                },
                accepts: (type, instance) => type === "float",
                required: {type: "advanced_slider", inverted: false}
            },
            connect: {
                default: {type: "bool", interactive: true, title: "Connect breaks: ", default: false},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('v_texture_coords')};
    return vec4(${this.color.sample('chan', 'float')}, step(0.05, ${this.threshold.sample('chan', 'float')}));
`;
    }

    defaultColSteps(length) {
        return [...Array(length).keys()].forEach(x => x + 1);
    }

    init() {
        const _this = this;

        this.opacity.init();

        if (this.connect) {
            this.connect.on('default', function(raw, encoded, ctx) {
                _this.color.setSteps(_this.connect.raw ? [0, ..._this.threshold.raw, 1] :
                    _this.defaultColSteps(_this.color.maxSteps)
                );
                _this.color.updateColormapUI();
            }, true);
            this.connect.init();


            this.threshold.on('breaks', function(raw, encoded, ctx) {
                if (_this.connect.raw) { //if YES
                    _this.color.setSteps([0, ...raw, 1]);
                    _this.color.updateColormapUI();
                }
            }, true);
        }
        this.threshold.init();

        //todo fix this scenario
        // if (this.threshold.raw.length != this.color.params.steps - 1) {
        // }

        if (this.connect) {
            if (this.connect.raw) {
                this.color.setSteps([0, ...this.threshold.raw, 1]);
            } else {
                //default breaks mapping for colormap if connect not enabled
                this.color.setSteps(this.defaultColSteps(this.color.maxSteps));
            }
        }

        this.color.init();
        // let steps = this.color.steps.filter(x => x >= 0);
        // steps.splice(steps.length-1, 1); //last element is 1 not a break
        // this.storeProperty('threshold_values', steps);
    }
});
})(OpenSeadragon);

(function($) {
/**
 * Identity shader
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                required: "rgba"
            }
        };
    }

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    static description() {
        return "shows the data AS-IS";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 4,
            description: "4d texture to render AS-IS"
        }];
    }

    getFragmentShaderExecution() {
        return `
    return ${this.sampleChannel("v_texture_coords")};`;
    }
});
})(OpenSeadragon);

(function($) {
    /**
 * Edges shader
 * data reference must contain one index to the data to render using edges strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - for more details, see @WebGLModule.UIControls color UI type
 *  edgeThickness - for more details, see @WebGLModule.UIControls number UI type
 *  threshold - for more details, see @WebGLModule.UIControls number UI type
 *  opacity - for more details, see @WebGLModule.UIControls number UI type
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "edge";
    }

    static name() {
        return "Edges";
    }

    static description() {
        return "highlights edges at threshold values";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D data to detect edges on threshold value"
        }];
    }

    static get defaultControls() {
        return {
            color: {
                default: {type: "color", default: "#fff700", title: "Color: "},
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {type: "range_input", default: 50, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
            edgeThickness: {
                default: {type: "range", default: 1, min: 0.5, max: 3, step: 0.1, title: "Edge thickness: "},
                accepts: (type, instance) => type === "float"
            },
        };
    }

    getFragmentShaderDefinition() {
        //here we override so we should call super method to include our uniforms
        return `
${super.getFragmentShaderDefinition()}

//todo try replace with step function
float clipToThresholdf_${this.uid}(float value) {
    //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > ${this.threshold.sample('value', 'float')}
        || close(value, ${this.threshold.sample('value', 'float')}))) return 1.0;
    return 0.0;
}

//todo try replace with step function
int clipToThresholdi_${this.uid}(float value) {
     //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > ${this.threshold.sample('value', 'float')}
        || close(value, ${this.threshold.sample('value', 'float')}))) return 1;
    return 0;
}`;
    }

    getFragmentShaderExecution() {
        return `
    float mid = ${this.sampleChannel('v_texture_coords')};
    if (mid < 1e-6) return vec4(.0);
    float dist = ${this.edgeThickness.sample('mid', 'float')} * sqrt(zoom_level) * 0.005 + 0.008;

    float u = ${this.sampleChannel('vec2(v_texture_coords.x - dist, v_texture_coords.y)')};
    float b = ${this.sampleChannel('vec2(v_texture_coords.x + dist, v_texture_coords.y)')};
    float l = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y - dist)')};
    float r = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y + dist)')};
    int counter = clipToThresholdi_${this.uid}(u) +
                clipToThresholdi_${this.uid}(b) +
                clipToThresholdi_${this.uid}(l) +
                clipToThresholdi_${this.uid}(r);
    if (counter == 2 || counter == 3) {  //two or three points hit the region
        return vec4(${this.color.sample()}, 1.0); //border
    }

    float u2 = ${this.sampleChannel('vec2(v_texture_coords.x - 3.0*dist, v_texture_coords.y)')};
    float b2 = ${this.sampleChannel('vec2(v_texture_coords.x + 3.0*dist, v_texture_coords.y)')};
    float l2 = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y - 3.0*dist)')};
    float r2 = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y + 3.0*dist)')};

    float mid2 = clipToThresholdf_${this.uid}(mid);
    float dx = min(clipToThresholdf_${this.uid}(u2) - mid2, clipToThresholdf_${this.uid}(b2) - mid2);
    float dy = min(clipToThresholdf_${this.uid}(l2) - mid2, clipToThresholdf_${this.uid}(r2) - mid2);
    if ((dx < -0.5 || dy < -0.5)) {
        return vec4(${this.color.sample()} * 0.7, .7); //inner border
    }
    return vec4(.0);
`;
    }
});
})(OpenSeadragon);

(function($) {
/**
 * Heatmap Shader
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "heatmap";
    }

    static name() {
        return "Heatmap";
    }

    static description() {
        return "encode data values in opacity";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "The value to map to opacity"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "r"
            },
            color: {
                default: {type: "color", default: "#fff700", title: "Color: "},
                accepts: (type, instance) => type === "vec3",
            },
            threshold: {
                default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
            inverse: {
                default: {type: "bool", default: false, title: "Invert: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        return `
float chan = ${this.sampleChannel('v_texture_coords')};
bool shows = chan >= ${this.threshold.sample('chan', 'float')};
if (${this.inverse.sample()}) {
    if (!shows) {
        shows = true;
        chan = 1.0;
    } else chan = 1.0 - chan;
}
if (shows) return vec4(${this.color.sample('chan', 'float')}, chan);
return vec4(.0);
`;
    }
});

})(OpenSeadragon);

(function($) {
/**
 * Sobel shader
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "sobel";
    }

    static name() {
        return "Sobel";
    }

    static description() {
        return "sobel edge detector";
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 3,
            description: "Data to detect edges on"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgb"
            }
        };
    }

    getFragmentShaderExecution() {
        return `
        // Sobel kernel for edge detection
        float kernelX[9] = float[9](-1.0,  0.0,  1.0,
                                    -2.0,  0.0,  2.0,
                                    -1.0,  0.0,  1.0);

        float kernelY[9] = float[9](-1.0, -2.0, -1.0,
                                     0.0,  0.0,  0.0,
                                     1.0,  2.0,  1.0);

        vec3 sumX = vec3(0.0);
        vec3 sumY = vec3(0.0);
        vec2 texelSize = vec2(1.0) / vec2(float(${this.getTextureSize()}.x), float(${this.getTextureSize()}.y));

        // Sampling 3x3 neighborhood
        int idx = 0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec3 sampleColor = ${this.sampleChannel('v_texture_coords + vec2(float(x), float(y)) * texelSize')};
                sumX += sampleColor * kernelX[idx];
                sumY += sampleColor * kernelY[idx];
                idx++;
            }
        }

        float edgeStrength = length(sumX) + length(sumY);
        return vec4(vec3(edgeStrength), 1.0);
`;
    }
});

})(OpenSeadragon);

(function($) {
/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    construct(options, dataReferences) {
        //todo supply options clone? options changes are propagated and then break things

        const ShaderClass = $.FlexRenderer.ShaderMediator.getClass(options.seriesRenderer);
        if (!ShaderClass) {
            //todo better way of throwing errors to show users
            throw "";
        }
        this._renderer = new ShaderClass(`series_${this.uid}`, {
            layer: this.__visualizationLayer,
            webgl: this.webglContext,
            invalidate: this.invalidate,
            rebuild: this._rebuild,
            refetch: this._refetch
        });
        this.series = options.series;
        if (!this.series) {
            //todo err
            this.series = [];
        }

        //parse and correct timeline data
        let timeline = options.timeline;
        if (typeof timeline !== "object") {
            timeline = {type: timeline};
        }
        if (!timeline.step) {
            timeline.step = 1;
        }
        const seriesLength = this.series.length;
        if (timeline.min % timeline.step !== 0) {
            timeline.min = 0;
        }
        if ((timeline.default - timeline.min) % timeline.step !== 0) {
            timeline.default = timeline.min;
        }
        //min is also used as a valid selection: +1
        const requestedLength = (timeline.max - timeline.min) / timeline.step + 1;
        if (requestedLength !== seriesLength) {
            timeline.max = (seriesLength - 1) * timeline.step + timeline.min;
        }

        this._dataReferences = dataReferences;
        super.construct(options, dataReferences);
        this._renderer.construct(options, dataReferences);
    }

    static type() {
        return "time-series";
    }

    static name() {
        return "Time Series";
    }

    static description() {
        return "internally use different shader to render one of chosen elements";
    }

    static get customParams() {
        return {
            seriesRenderer: {
                usage: "Specify shader type to use in this series. Attach the shader properties as you would normally do with your desired shader.",
                default: "identity"
            },
            series: {
                //todo allow using the same data in different channels etc.. now the data must be distinct
                usage: "Specify data indexes for the series (as if you've specified dataReferences). The dataReferences is expected to be array with single number, the starting data reference. For now, the data indexes must be unique.",
            }
        };
    }

    static get defaultControls() {
        return {
            timeline: {
                default: {title: "Timeline: "},
                accepts: (type, instance) => type === "float",
                required: {type: "range_input"}
            },
            opacity: false
        };
    }


    static sources() {
        return [{
            acceptsChannelCount: (x) => true,
            description: "render selected data source by underlying shader"
        }];
    }

    getFragmentShaderDefinition() {

        return `
${super.getFragmentShaderDefinition()}
${this._renderer.getFragmentShaderDefinition()}`;
    }

    getFragmentShaderExecution() {
        return this._renderer.getFragmentShaderExecution();
    }

    glLoaded(program, gl) {
        super.glLoaded(program, gl);
        this._renderer.glLoaded(program, gl);
    }

    glDrawing(program, gl) {
        super.glDrawing(program, gl);
        this._renderer.glDrawing(program, gl);
    }

    init() {
        super.init();
        this._renderer.init();

        const _this = this;
        this.timeline.on('default', (raw, encoded, ctx) => {
            const value = (Number.parseInt(encoded, 10) - this.timeline.params.min) / _this.timeline.params.step;
            _this._dataReferences[0] = _this.series[value];
            _this._refetch();
        });
    }

    htmlControls() {
        return `
${super.htmlControls()}
<h4>Rendering as ${this._renderer.constructor.name()}</h4>
${this._renderer.htmlControls()}`;
    }
});
})(OpenSeadragon);

(function ($) {
/**
 * MVTTileJSONSource
 * ------------------
 * A TileSource that reads TileJSON metadata, fetches MVT (.mvt/.pbf) tiles,
 * decodes + tessellates them on a Web Worker, and returns FlexDrawer-compatible
 * caches using the new `vector-mesh` format (fills + lines).
 *
 * Requirements:
 *  - flex-drawer.js patched to accept `vector-mesh` (see vector-mesh-support.patch)
 *  - flex-webgl2.js patched to draw geometry in first pass (see flex-webgl2-vector-pass.patch)
 *
 * Usage:
 *   const src = await OpenSeadragon.MVTTileJSONSource.from(
 *     'https://tiles.example.com/basemap.json',
 *     { style: defaultStyle() }
 *   );
 *   viewer.addTiledImage({ tileSource: src });
 *
 * Usage (local server for testing via docker):
 *     Download desired vector tiles from the server, and run:
 *       docker run -it --rm -p 8080:8080 -v /path/to/data:/data maptiler/tileserver-gl-light:latest
 *
 * Alternatives (not supported):
 *      PMTiles range queries
 *      Raw files: pip install mbutil && mb-util --image_format=pbf mytiles.mbtiles ./tiles
 *
 *
 * TODO OSD uses // eslint-disable-next-line compat/compat to disable URL warns for opera mini - what is the purpose of supporting it at all
 */
$.MVTTileSource = class extends $.TileSource {
    constructor({ template, scheme = 'xyz', tileSize = 512, minLevel = 0, maxLevel = 14, width, height, extent = 4096, style }) {
        super({ width, height, tileSize, minLevel, maxLevel });
        this.template = template;
        this.scheme = scheme;
        this.extent = extent;
        this.style = style || defaultStyle();
        this._worker = makeWorker();
        this._pending = new Map(); // key -> {resolve,reject}

        // Wire worker responses
        this._worker.onmessage = (e) => {
            const msg = e.data;
            if (!msg || !msg.key) {
                return;
            }

            const waiters = this._pending.get(msg.key);
            if (!waiters) {
                return;
            }
            this._pending.delete(msg.key);

            if (msg.ok) {
                const t = msg.data;
                for (const ctx of waiters) {
                    ctx.finish({
                        fills: t.fills.map(packMesh),
                        lines: t.lines.map(packMesh)
                    }, undefined, 'vector-mesh');
                }
            } else {
                for (const ctx of waiters) {
                    ctx.fail(msg.error || 'Worker failed');
                }
            }
        };

        // Send config once
        this._worker.postMessage({ type: 'config', extent: this.extent, style: this.style });
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @function
     * @param {Object|Array} data
     * @param {String} url - optional
     */
    supports(data, url) {
        return data["tiles"] && data["format"] === "pbf" && url.endsWith(".json");
    }
    /**
     *
     * @function
     * @param {Object} data - the options
     * @param {String} dataUrl - the url the image was retrieved from, if any.
     * @param {String} postData - HTTP POST data in k=v&k2=v2... form or null
     * @returns {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure(data, dataUrl, postData) {
        const tj = data;

        // Basic TileJSON fields
        const tiles = (tj.tiles && tj.tiles.length) ? tj.tiles : (tj.tilesURL ? [tj.tilesURL] : null);
        if (!tiles) {
            throw new Error('TileJSON missing tiles template');
        }
        const template = tiles[0];
        const tileSize = tj.tileSize || 512;  // many vector tile sets use 512
        const minLevel = tj.minzoom ? tj.minzoom : 0;
        const maxLevel = tj.maxzoom ? tj.maxzoom : 14;
        const scheme = tj.scheme || 'xyz'; // 'xyz' or 'tms'
        const extent = (tj.extent && Number.isFinite(tj.extent)) ? tj.extent : 4096;

        const width = Math.pow(2, maxLevel) * tileSize;
        const height = width;

        return {
            template,
            scheme,
            tileSize,
            minLevel,
            maxLevel,
            width,
            height,
            extent,
            style: defaultStyle(),  // todo style
        };
    }

    getTileUrl(level, x, y) {
        const z = level;
        const n = 1 << z;
        const ty = (this.scheme === 'tms') ? (n - 1 - y) : y;
        return this.template.replace('{z}', z).replace('{x}', x).replace('{y}', ty);
    }

    /**
     * Return a FlexDrawer cache object directly (vector-mesh).
     */
    downloadTileStart(context) {
        const tile = context.tile;
        const key = context.src;

        const list = this._pending.get(key);
        if (list) {
            list.push(context);
        } else {
            this._pending.set(key, [ context ]);
        }

        this._worker.postMessage({
            type: 'tile',
            key: key,
            z: tile.level,
            x: tile.x,
            y: tile.y,
            url: context.src
        });
    }
};

// ---------- Helpers ----------

function packMesh(m) {
    return {
        vertices: new Float32Array(m.vertices),
        indices: new Uint32Array(m.indices),
        color: m.color || [1, 0, 0, 1],
    };
}

function defaultStyle() {
    // Super-minimal style mapping; replace as needed.
    // layerName => {type:'fill'|'line', color:[r,g,b,a], widthPx?:number, join?:'miter'|'bevel'|'round', cap?:'butt'|'square'|'round'}
    return {
        layers: {
            water:     { type: 'fill', color: [0.65, 0.80, 0.93, 1] },
            landuse:   { type: 'fill', color: [0.95, 0.94, 0.91, 1] },
            park:      { type: 'fill', color: [0.88, 0.95, 0.88, 1] },
            building:  { type: 'fill', color: [0.93, 0.93, 0.93, 1] },
            waterway:  { type: 'line', color: [0.55, 0.75, 0.90, 1], widthPx: 1.2, join: 'round', cap: 'round' },
            road:      { type: 'line', color: [0.60, 0.60, 0.60, 1], widthPx: 1.5, join: 'round', cap: 'round' },
        },
        // Default if layer not listed
        fallback: { type: 'line', color: [0.3, 0.3, 0.3, 1], widthPx: 1, join: 'bevel', cap: 'butt' }
    };
}

function makeWorker() {
    // Prefer the inlined source if available
    const inline = (OpenSeadragon && OpenSeadragon.__MVT_WORKER_SOURCE__);
    if (inline) {
        const blob = new Blob([inline], { type: "text/javascript" });
        return new Worker((window.URL || window.webkitURL).createObjectURL(blob));
    }

    throw new Error('No worker source available');
}

})(OpenSeadragon);

// fabric-tile-source.js (single rectangular tile, unit-normalized in worker)
(function ($) {

    $.FabricTileSource = class extends $.TileSource {
        constructor(options) {
            // options: { width, height, origin?, objects, workerLibs? }
            super(options);

            this.width = options.width;
            this.height = options.height;

            // Rectangular single tile
            this.tileWidth = this.width;
            this.tileHeight = this.height;
            this.minLevel = 0;
            this.maxLevel = 0;

            this._origin = options.origin || { x: 0, y: 0 };
            this._pending = new Map();

            this._worker = makeWorker(options.workerLibs);

            this._worker.postMessage({
                type: 'config',
                width: this.width,
                height: this.height,
                origin: this._origin
            });

            if (options.objects && options.objects.length > 0) {
                let autoId = 0;
                for (const o of options.objects) {
                    const entries = normalizeToWorkerPrims(o);
                    for (const entry of entries) {
                        const id = entry.id || ('fab_' + (autoId++));
                        this._worker.postMessage({
                            type: 'addOrUpdate',
                            id: id,
                            fabric: entry.fabric,
                            style: entry.style
                        });
                    }
                }
            }

            this._worker.onmessage = (e) => {
                const msg = e.data || {};

                if (msg.type === 'tiles' && Array.isArray(msg.tiles)) {
                    for (const t of msg.tiles) {
                        this._deliverTileRecord(t);
                    }
                    return;
                }

                if (msg.key) {
                    this._deliverTileRecord(msg);
                }
            };
        }

        supports(data, url) {
            const hasObjects = data && Array.isArray(data.objects) && data.objects.length > 0;
            const okFormat = !data.format || data.format === 'fabric' || data.format === 'native';
            const looksJson = typeof url === 'string' ? url.toLowerCase().endsWith('.json') : true;

            if (hasObjects && okFormat && looksJson) {
                return true;
            }

            return false;
        }

        configure(data, dataUrl, postData) {
            const objs = Array.isArray(data.objects) ? data.objects : [];
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            const upd = (x, y) => {
                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
            };

            for (const o of objs) {
                if (o.type === 'rect') {
                    upd(o.left, o.top);
                    upd(o.left + o.width, o.top + o.height);
                } else if (o.type === 'ellipse') {
                    upd(o.left - o.rx, o.top - o.ry);
                    upd(o.left + o.rx, o.top + o.ry);
                } else if ((o.type === 'polygon' || o.type === 'polyline') && Array.isArray(o.points)) {
                    for (const p of o.points) {
                        upd(p.x, p.y);
                    }
                } else if (o.type === 'path' && o.factoryID === 'multipolygon' && Array.isArray(o.points)) {
                    for (const ring of o.points) {
                        for (const p of ring) {
                            upd(p.x, p.y);
                        }
                    }
                }
            }

            if (!isFinite(minX)) {
                minX = 0;
                minY = 0;
                maxX = 1;
                maxY = 1;
            }

            const width  = data.width ? data.width : Math.ceil(maxX - minX);
            const height = data.height ? data.height : Math.ceil(maxY - minY);

            // If caller provides the full image size, anchor at (0,0) so the tile is in-view.
            // Otherwise, fall back to bbox origin.
            const origin = (data.width && data.height) ? { x: 0, y: 0 } : { x: minX, y: minY };

            return {
                width: width,
                height: height,
                origin: origin,
                // rectangular single tile
                tileWidth: width,
                tileHeight: height,
                minLevel: 0,
                maxLevel: 0,
                objects: objs,
                template: 'fabric://{z}/{x}/{y}',
                scheme: 'xyz'
            };
        }

        getTileUrl(level, x, y) {
            return 'fabric://' + level + '/' + x + '/' + y;
        }

        downloadTileStart(context) {
            const tile = context.tile;
            const level = tile.level;
            const x = tile.x;
            const y = tile.y;

            const key = this.getTileUrl(level, x, y);

            // allow multiple waiters (main viewer + navigator)
            const list = this._pending.get(key);
            if (list) {
                list.push(context);
            } else {
                this._pending.set(key, [ context ]);
            }

            this._worker.postMessage({
                type: 'tiles',
                z: 0,
                keys: [ level + '/' + x + '/' + y ]
            });
        }

        _deliverTileRecord(rec) {
            const key = rec.key ? ('fabric://' + rec.key) : null;
            if (!key) {
                return;
            }

            const waiters = this._pending.get(key);
            if (!waiters || waiters.length === 0) {
                return;
            }
            this._pending.delete(key);

            const toMeshes = (packed, defaultColor) => {
                if (!packed) {
                    return [];
                }
                const vertsBuf = packed.positions || packed.vertices;
                const idxBuf = packed.indices;
                return [{
                    vertices: new Float32Array(vertsBuf),
                    indices: new Uint32Array(idxBuf),
                    color: Array.isArray(defaultColor) ? defaultColor : [ 1, 1, 1, 1 ]
                }];
            };

            if (rec.error) {
                for (const p of waiters) {
                    p.fail(rec.error || 'Worker failed');
                }
                return;
            }

            const fills = toMeshes(rec.fills, [ 1, 1, 1, 1 ]);
            const lines = toMeshes(rec.lines, [ 1, 1, 1, 1 ]);
            for (const p of waiters) {
                p.finish({ fills: fills, lines: lines }, undefined, 'vector-mesh');
            }
        }
    };

    // ---------- Helpers ----------

    function makeWorker() {
        const inline = OpenSeadragon && OpenSeadragon.__FABRIC_WORKER_SOURCE__;

        if (inline) {
            const blob = new Blob([ inline ], { type: 'text/javascript' });
            const url = (window.URL || window.webkitURL).createObjectURL(blob);
            return new Worker(url);
        }

        throw new Error('No FABRIC worker source available');
    }

    function hexToRgba(hex, a) {
        const alpha = typeof a === 'number' ? a : 1;

        if (!hex || typeof hex !== 'string') {
            return [ 0, 0, 0, alpha ];
        }

        const s = hex.replace('#', '');

        if (s.length === 3) {
            const r = parseInt(s[0] + s[0], 16);
            const g = parseInt(s[1] + s[1], 16);
            const b = parseInt(s[2] + s[2], 16);
            return [ r / 255, g / 255, b / 255, alpha ];
        }

        if (s.length >= 6) {
            const r = parseInt(s.substring(0, 2), 16);
            const g = parseInt(s.substring(2, 4), 16);
            const b = parseInt(s.substring(4, 6), 16);
            return [ r / 255, g / 255, b / 255, alpha ];
        }

        return [ 0, 0, 0, alpha ];
    }

    function normalizeToWorkerPrims(obj) {
        const color = obj.color || '#ff0000';
        const fill = hexToRgba(color, 0.6);
        const stroke = hexToRgba(color, 1);

        if (obj.type === 'rect') {
            const x = obj.left;
            const y = obj.top;
            const w = obj.width;
            const h = obj.height;

            return [
                {
                    id: obj.id,
                    fabric: { type: 'rect', x: x, y: y, w: w, h: h },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'ellipse') {
            const cx = obj.left;
            const cy = obj.top;
            const rx = obj.rx;
            const ry = obj.ry;

            return [
                {
                    id: obj.id,
                    fabric: { type: 'ellipse', cx: cx, cy: cy, rx: rx, ry: ry, segments: 64 },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'polygon' && Array.isArray(obj.points)) {
            return [
                {
                    id: obj.id,
                    fabric: { type: 'polygon', points: obj.points.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'polyline' && Array.isArray(obj.points)) {
            return [
                {
                    id: obj.id,
                    fabric: { type: 'polyline', points: obj.points.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { stroke: stroke, strokeWidth: obj.strokeWidth || 2 }
                }
            ];
        }

        if (obj.type === 'path' && obj.factoryID === 'multipolygon' && Array.isArray(obj.points)) {
            const out = [];

            for (const ring of obj.points) {
                out.push({
                    id: undefined,
                    fabric: { type: 'polygon', points: ring.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                });
            }

            return out;
        }

        return [];
    }

})(OpenSeadragon);

//! flex-renderer 0.0.1
//! Built on 2025-10-28
//! Git commit: --3205840-dirty
//! http://openseadragon.github.io
//! License: http://openseadragon.github.io/license/

(function(root){
  root.OpenSeadragon = root.OpenSeadragon || {};
  // Full inlined worker source (libs + core)
  root.OpenSeadragon.__MVT_WORKER_SOURCE__ = `
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.default=void 0;const SHIFT_LEFT_32=(1<<16)*(1<<16);const SHIFT_RIGHT_32=1/SHIFT_LEFT_32;const TEXT_DECODER_MIN_LENGTH=12;const utf8TextDecoder=typeof TextDecoder==="undefined"?null:new TextDecoder("utf-8");const PBF_VARINT=0;const PBF_FIXED64=1;const PBF_BYTES=2;const PBF_FIXED32=5;class Pbf{constructor(buf=new Uint8Array(16)){this.buf=ArrayBuffer.isView(buf)?buf:new Uint8Array(buf);this.dataView=new DataView(this.buf.buffer);this.pos=0;this.type=0;this.length=this.buf.length}readFields(readField,result,end=this.length){while(this.pos<end){const val=this.readVarint(),tag=val>>3,startPos=this.pos;this.type=val&7;readField(tag,result,this);if(this.pos===startPos)this.skip(val)}return result}readMessage(readField,result){return this.readFields(readField,result,this.readVarint()+this.pos)}readFixed32(){const val=this.dataView.getUint32(this.pos,true);this.pos+=4;return val}readSFixed32(){const val=this.dataView.getInt32(this.pos,true);this.pos+=4;return val}readFixed64(){const val=this.dataView.getUint32(this.pos,true)+this.dataView.getUint32(this.pos+4,true)*SHIFT_LEFT_32;this.pos+=8;return val}readSFixed64(){const val=this.dataView.getUint32(this.pos,true)+this.dataView.getInt32(this.pos+4,true)*SHIFT_LEFT_32;this.pos+=8;return val}readFloat(){const val=this.dataView.getFloat32(this.pos,true);this.pos+=4;return val}readDouble(){const val=this.dataView.getFloat64(this.pos,true);this.pos+=8;return val}readVarint(isSigned){const buf=this.buf;let val,b;b=buf[this.pos++];val=b&127;if(b<128)return val;b=buf[this.pos++];val|=(b&127)<<7;if(b<128)return val;b=buf[this.pos++];val|=(b&127)<<14;if(b<128)return val;b=buf[this.pos++];val|=(b&127)<<21;if(b<128)return val;b=buf[this.pos];val|=(b&15)<<28;return readVarintRemainder(val,isSigned,this)}readVarint64(){return this.readVarint(true)}readSVarint(){const num=this.readVarint();return num%2===1?(num+1)/-2:num/2}readBoolean(){return Boolean(this.readVarint())}readString(){const end=this.readVarint()+this.pos;const pos=this.pos;this.pos=end;if(end-pos>=TEXT_DECODER_MIN_LENGTH&&utf8TextDecoder){return utf8TextDecoder.decode(this.buf.subarray(pos,end))}return readUtf8(this.buf,pos,end)}readBytes(){const end=this.readVarint()+this.pos,buffer=this.buf.subarray(this.pos,end);this.pos=end;return buffer}readPackedVarint(arr=[],isSigned){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readVarint(isSigned));return arr}readPackedSVarint(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readSVarint());return arr}readPackedBoolean(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readBoolean());return arr}readPackedFloat(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readFloat());return arr}readPackedDouble(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readDouble());return arr}readPackedFixed32(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readFixed32());return arr}readPackedSFixed32(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readSFixed32());return arr}readPackedFixed64(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readFixed64());return arr}readPackedSFixed64(arr=[]){const end=this.readPackedEnd();while(this.pos<end)arr.push(this.readSFixed64());return arr}readPackedEnd(){return this.type===PBF_BYTES?this.readVarint()+this.pos:this.pos+1}skip(val){const type=val&7;if(type===PBF_VARINT)while(this.buf[this.pos++]>127){}else if(type===PBF_BYTES)this.pos=this.readVarint()+this.pos;else if(type===PBF_FIXED32)this.pos+=4;else if(type===PBF_FIXED64)this.pos+=8;else throw new Error(\`Unimplemented type: \${type}\`)}writeTag(tag,type){this.writeVarint(tag<<3|type)}realloc(min){let length=this.length||16;while(length<this.pos+min)length*=2;if(length!==this.length){const buf=new Uint8Array(length);buf.set(this.buf);this.buf=buf;this.dataView=new DataView(buf.buffer);this.length=length}}finish(){this.length=this.pos;this.pos=0;return this.buf.subarray(0,this.length)}writeFixed32(val){this.realloc(4);this.dataView.setInt32(this.pos,val,true);this.pos+=4}writeSFixed32(val){this.realloc(4);this.dataView.setInt32(this.pos,val,true);this.pos+=4}writeFixed64(val){this.realloc(8);this.dataView.setInt32(this.pos,val&-1,true);this.dataView.setInt32(this.pos+4,Math.floor(val*SHIFT_RIGHT_32),true);this.pos+=8}writeSFixed64(val){this.realloc(8);this.dataView.setInt32(this.pos,val&-1,true);this.dataView.setInt32(this.pos+4,Math.floor(val*SHIFT_RIGHT_32),true);this.pos+=8}writeVarint(val){val=+val||0;if(val>268435455||val<0){writeBigVarint(val,this);return}this.realloc(4);this.buf[this.pos++]=val&127|(val>127?128:0);if(val<=127)return;this.buf[this.pos++]=(val>>>=7)&127|(val>127?128:0);if(val<=127)return;this.buf[this.pos++]=(val>>>=7)&127|(val>127?128:0);if(val<=127)return;this.buf[this.pos++]=val>>>7&127}writeSVarint(val){this.writeVarint(val<0?-val*2-1:val*2)}writeBoolean(val){this.writeVarint(+val)}writeString(str){str=String(str);this.realloc(str.length*4);this.pos++;const startPos=this.pos;this.pos=writeUtf8(this.buf,str,this.pos);const len=this.pos-startPos;if(len>=128)makeRoomForExtraLength(startPos,len,this);this.pos=startPos-1;this.writeVarint(len);this.pos+=len}writeFloat(val){this.realloc(4);this.dataView.setFloat32(this.pos,val,true);this.pos+=4}writeDouble(val){this.realloc(8);this.dataView.setFloat64(this.pos,val,true);this.pos+=8}writeBytes(buffer){const len=buffer.length;this.writeVarint(len);this.realloc(len);for(let i=0;i<len;i++)this.buf[this.pos++]=buffer[i]}writeRawMessage(fn,obj){this.pos++;const startPos=this.pos;fn(obj,this);const len=this.pos-startPos;if(len>=128)makeRoomForExtraLength(startPos,len,this);this.pos=startPos-1;this.writeVarint(len);this.pos+=len}writeMessage(tag,fn,obj){this.writeTag(tag,PBF_BYTES);this.writeRawMessage(fn,obj)}writePackedVarint(tag,arr){if(arr.length)this.writeMessage(tag,writePackedVarint,arr)}writePackedSVarint(tag,arr){if(arr.length)this.writeMessage(tag,writePackedSVarint,arr)}writePackedBoolean(tag,arr){if(arr.length)this.writeMessage(tag,writePackedBoolean,arr)}writePackedFloat(tag,arr){if(arr.length)this.writeMessage(tag,writePackedFloat,arr)}writePackedDouble(tag,arr){if(arr.length)this.writeMessage(tag,writePackedDouble,arr)}writePackedFixed32(tag,arr){if(arr.length)this.writeMessage(tag,writePackedFixed32,arr)}writePackedSFixed32(tag,arr){if(arr.length)this.writeMessage(tag,writePackedSFixed32,arr)}writePackedFixed64(tag,arr){if(arr.length)this.writeMessage(tag,writePackedFixed64,arr)}writePackedSFixed64(tag,arr){if(arr.length)this.writeMessage(tag,writePackedSFixed64,arr)}writeBytesField(tag,buffer){this.writeTag(tag,PBF_BYTES);this.writeBytes(buffer)}writeFixed32Field(tag,val){this.writeTag(tag,PBF_FIXED32);this.writeFixed32(val)}writeSFixed32Field(tag,val){this.writeTag(tag,PBF_FIXED32);this.writeSFixed32(val)}writeFixed64Field(tag,val){this.writeTag(tag,PBF_FIXED64);this.writeFixed64(val)}writeSFixed64Field(tag,val){this.writeTag(tag,PBF_FIXED64);this.writeSFixed64(val)}writeVarintField(tag,val){this.writeTag(tag,PBF_VARINT);this.writeVarint(val)}writeSVarintField(tag,val){this.writeTag(tag,PBF_VARINT);this.writeSVarint(val)}writeStringField(tag,str){this.writeTag(tag,PBF_BYTES);this.writeString(str)}writeFloatField(tag,val){this.writeTag(tag,PBF_FIXED32);this.writeFloat(val)}writeDoubleField(tag,val){this.writeTag(tag,PBF_FIXED64);this.writeDouble(val)}writeBooleanField(tag,val){this.writeVarintField(tag,+val)}}exports.default=Pbf;function readVarintRemainder(l,s,p){const buf=p.buf;let h,b;b=buf[p.pos++];h=(b&112)>>4;if(b<128)return toNum(l,h,s);b=buf[p.pos++];h|=(b&127)<<3;if(b<128)return toNum(l,h,s);b=buf[p.pos++];h|=(b&127)<<10;if(b<128)return toNum(l,h,s);b=buf[p.pos++];h|=(b&127)<<17;if(b<128)return toNum(l,h,s);b=buf[p.pos++];h|=(b&127)<<24;if(b<128)return toNum(l,h,s);b=buf[p.pos++];h|=(b&1)<<31;if(b<128)return toNum(l,h,s);throw new Error("Expected varint not more than 10 bytes")}function toNum(low,high,isSigned){return isSigned?high*4294967296+(low>>>0):(high>>>0)*4294967296+(low>>>0)}function writeBigVarint(val,pbf){let low,high;if(val>=0){low=val%4294967296|0;high=val/4294967296|0}else{low=~(-val%4294967296);high=~(-val/4294967296);if(low^4294967295){low=low+1|0}else{low=0;high=high+1|0}}if(val>=0x10000000000000000||val<-0x10000000000000000){throw new Error("Given varint doesn't fit into 10 bytes")}pbf.realloc(10);writeBigVarintLow(low,high,pbf);writeBigVarintHigh(high,pbf)}function writeBigVarintLow(low,high,pbf){pbf.buf[pbf.pos++]=low&127|128;low>>>=7;pbf.buf[pbf.pos++]=low&127|128;low>>>=7;pbf.buf[pbf.pos++]=low&127|128;low>>>=7;pbf.buf[pbf.pos++]=low&127|128;low>>>=7;pbf.buf[pbf.pos]=low&127}function writeBigVarintHigh(high,pbf){const lsb=(high&7)<<4;pbf.buf[pbf.pos++]|=lsb|((high>>>=3)?128:0);if(!high)return;pbf.buf[pbf.pos++]=high&127|((high>>>=7)?128:0);if(!high)return;pbf.buf[pbf.pos++]=high&127|((high>>>=7)?128:0);if(!high)return;pbf.buf[pbf.pos++]=high&127|((high>>>=7)?128:0);if(!high)return;pbf.buf[pbf.pos++]=high&127|((high>>>=7)?128:0);if(!high)return;pbf.buf[pbf.pos++]=high&127}function makeRoomForExtraLength(startPos,len,pbf){const extraLen=len<=16383?1:len<=2097151?2:len<=268435455?3:Math.floor(Math.log(len)/(Math.LN2*7));pbf.realloc(extraLen);for(let i=pbf.pos-1;i>=startPos;i--)pbf.buf[i+extraLen]=pbf.buf[i]}function writePackedVarint(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeVarint(arr[i])}function writePackedSVarint(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeSVarint(arr[i])}function writePackedFloat(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeFloat(arr[i])}function writePackedDouble(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeDouble(arr[i])}function writePackedBoolean(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeBoolean(arr[i])}function writePackedFixed32(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeFixed32(arr[i])}function writePackedSFixed32(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeSFixed32(arr[i])}function writePackedFixed64(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeFixed64(arr[i])}function writePackedSFixed64(arr,pbf){for(let i=0;i<arr.length;i++)pbf.writeSFixed64(arr[i])}function readUtf8(buf,pos,end){let str="";let i=pos;while(i<end){const b0=buf[i];let c=null;let bytesPerSequence=b0>239?4:b0>223?3:b0>191?2:1;if(i+bytesPerSequence>end)break;let b1,b2,b3;if(bytesPerSequence===1){if(b0<128){c=b0}}else if(bytesPerSequence===2){b1=buf[i+1];if((b1&192)===128){c=(b0&31)<<6|b1&63;if(c<=127){c=null}}}else if(bytesPerSequence===3){b1=buf[i+1];b2=buf[i+2];if((b1&192)===128&&(b2&192)===128){c=(b0&15)<<12|(b1&63)<<6|b2&63;if(c<=2047||c>=55296&&c<=57343){c=null}}}else if(bytesPerSequence===4){b1=buf[i+1];b2=buf[i+2];b3=buf[i+3];if((b1&192)===128&&(b2&192)===128&&(b3&192)===128){c=(b0&15)<<18|(b1&63)<<12|(b2&63)<<6|b3&63;if(c<=65535||c>=1114112){c=null}}}if(c===null){c=65533;bytesPerSequence=1}else if(c>65535){c-=65536;str+=String.fromCharCode(c>>>10&1023|55296);c=56320|c&1023}str+=String.fromCharCode(c);i+=bytesPerSequence}return str}function writeUtf8(buf,str,pos){for(let i=0,c,lead;i<str.length;i++){c=str.charCodeAt(i);if(c>55295&&c<57344){if(lead){if(c<56320){buf[pos++]=239;buf[pos++]=191;buf[pos++]=189;lead=c;continue}else{c=lead-55296<<10|c-56320|65536;lead=null}}else{if(c>56319||i+1===str.length){buf[pos++]=239;buf[pos++]=191;buf[pos++]=189}else{lead=c}continue}}else if(lead){buf[pos++]=239;buf[pos++]=191;buf[pos++]=189;lead=null}if(c<128){buf[pos++]=c}else{if(c<2048){buf[pos++]=c>>6|192}else{if(c<65536){buf[pos++]=c>>12|224}else{buf[pos++]=c>>18|240;buf[pos++]=c>>12&63|128}buf[pos++]=c>>6&63|128}buf[pos++]=c&63|128}}return pos}},{}],2:[function(require,module,exports){"use strict";var _pbf=_interopRequireDefault(require("pbf"));function _interopRequireDefault(e){return e&&e.__esModule?e:{default:e}}self.Pbf=_pbf.default},{pbf:1}]},{},[2]);
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){"use strict";var _vectorTile=require("@mapbox/vector-tile");self.vectorTile={VectorTile:_vectorTile.VectorTile}},{"@mapbox/vector-tile":3}],2:[function(require,module,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.default=Point;function Point(x,y){this.x=x;this.y=y}Point.prototype={clone(){return new Point(this.x,this.y)},add(p){return this.clone()._add(p)},sub(p){return this.clone()._sub(p)},multByPoint(p){return this.clone()._multByPoint(p)},divByPoint(p){return this.clone()._divByPoint(p)},mult(k){return this.clone()._mult(k)},div(k){return this.clone()._div(k)},rotate(a){return this.clone()._rotate(a)},rotateAround(a,p){return this.clone()._rotateAround(a,p)},matMult(m){return this.clone()._matMult(m)},unit(){return this.clone()._unit()},perp(){return this.clone()._perp()},round(){return this.clone()._round()},mag(){return Math.sqrt(this.x*this.x+this.y*this.y)},equals(other){return this.x===other.x&&this.y===other.y},dist(p){return Math.sqrt(this.distSqr(p))},distSqr(p){const dx=p.x-this.x,dy=p.y-this.y;return dx*dx+dy*dy},angle(){return Math.atan2(this.y,this.x)},angleTo(b){return Math.atan2(this.y-b.y,this.x-b.x)},angleWith(b){return this.angleWithSep(b.x,b.y)},angleWithSep(x,y){return Math.atan2(this.x*y-this.y*x,this.x*x+this.y*y)},_matMult(m){const x=m[0]*this.x+m[1]*this.y,y=m[2]*this.x+m[3]*this.y;this.x=x;this.y=y;return this},_add(p){this.x+=p.x;this.y+=p.y;return this},_sub(p){this.x-=p.x;this.y-=p.y;return this},_mult(k){this.x*=k;this.y*=k;return this},_div(k){this.x/=k;this.y/=k;return this},_multByPoint(p){this.x*=p.x;this.y*=p.y;return this},_divByPoint(p){this.x/=p.x;this.y/=p.y;return this},_unit(){this._div(this.mag());return this},_perp(){const y=this.y;this.y=this.x;this.x=-y;return this},_rotate(angle){const cos=Math.cos(angle),sin=Math.sin(angle),x=cos*this.x-sin*this.y,y=sin*this.x+cos*this.y;this.x=x;this.y=y;return this},_rotateAround(angle,p){const cos=Math.cos(angle),sin=Math.sin(angle),x=p.x+cos*(this.x-p.x)-sin*(this.y-p.y),y=p.y+sin*(this.x-p.x)+cos*(this.y-p.y);this.x=x;this.y=y;return this},_round(){this.x=Math.round(this.x);this.y=Math.round(this.y);return this},constructor:Point};Point.convert=function(p){if(p instanceof Point){return p}if(Array.isArray(p)){return new Point(+p[0],+p[1])}if(p.x!==undefined&&p.y!==undefined){return new Point(+p.x,+p.y)}throw new Error("Expected [x, y] or {x, y} point format")}},{}],3:[function(require,module,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.VectorTileLayer=exports.VectorTileFeature=exports.VectorTile=void 0;exports.classifyRings=classifyRings;var _pointGeometry=_interopRequireDefault(require("@mapbox/point-geometry"));function _interopRequireDefault(e){return e&&e.__esModule?e:{default:e}}class VectorTileFeature{constructor(pbf,end,extent,keys,values){this.properties={};this.extent=extent;this.type=0;this.id=undefined;this._pbf=pbf;this._geometry=-1;this._keys=keys;this._values=values;pbf.readFields(readFeature,this,end)}loadGeometry(){const pbf=this._pbf;pbf.pos=this._geometry;const end=pbf.readVarint()+pbf.pos;const lines=[];let line;let cmd=1;let length=0;let x=0;let y=0;while(pbf.pos<end){if(length<=0){const cmdLen=pbf.readVarint();cmd=cmdLen&7;length=cmdLen>>3}length--;if(cmd===1||cmd===2){x+=pbf.readSVarint();y+=pbf.readSVarint();if(cmd===1){if(line)lines.push(line);line=[]}if(line)line.push(new _pointGeometry.default(x,y))}else if(cmd===7){if(line){line.push(line[0].clone())}}else{throw new Error(\`unknown command \${cmd}\`)}}if(line)lines.push(line);return lines}bbox(){const pbf=this._pbf;pbf.pos=this._geometry;const end=pbf.readVarint()+pbf.pos;let cmd=1,length=0,x=0,y=0,x1=Infinity,x2=-Infinity,y1=Infinity,y2=-Infinity;while(pbf.pos<end){if(length<=0){const cmdLen=pbf.readVarint();cmd=cmdLen&7;length=cmdLen>>3}length--;if(cmd===1||cmd===2){x+=pbf.readSVarint();y+=pbf.readSVarint();if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y}else if(cmd!==7){throw new Error(\`unknown command \${cmd}\`)}}return[x1,y1,x2,y2]}toGeoJSON(x,y,z){const size=this.extent*Math.pow(2,z),x0=this.extent*x,y0=this.extent*y,vtCoords=this.loadGeometry();function projectPoint(p){return[(p.x+x0)*360/size-180,360/Math.PI*Math.atan(Math.exp((1-(p.y+y0)*2/size)*Math.PI))-90]}function projectLine(line){return line.map(projectPoint)}let geometry;if(this.type===1){const points=[];for(const line of vtCoords){points.push(line[0])}const coordinates=projectLine(points);geometry=points.length===1?{type:"Point",coordinates:coordinates[0]}:{type:"MultiPoint",coordinates:coordinates}}else if(this.type===2){const coordinates=vtCoords.map(projectLine);geometry=coordinates.length===1?{type:"LineString",coordinates:coordinates[0]}:{type:"MultiLineString",coordinates:coordinates}}else if(this.type===3){const polygons=classifyRings(vtCoords);const coordinates=[];for(const polygon of polygons){coordinates.push(polygon.map(projectLine))}geometry=coordinates.length===1?{type:"Polygon",coordinates:coordinates[0]}:{type:"MultiPolygon",coordinates:coordinates}}else{throw new Error("unknown feature type")}const result={type:"Feature",geometry:geometry,properties:this.properties};if(this.id!=null){result.id=this.id}return result}}exports.VectorTileFeature=VectorTileFeature;VectorTileFeature.types=["Unknown","Point","LineString","Polygon"];function readFeature(tag,feature,pbf){if(tag===1)feature.id=pbf.readVarint();else if(tag===2)readTag(pbf,feature);else if(tag===3)feature.type=pbf.readVarint();else if(tag===4)feature._geometry=pbf.pos}function readTag(pbf,feature){const end=pbf.readVarint()+pbf.pos;while(pbf.pos<end){const key=feature._keys[pbf.readVarint()];const value=feature._values[pbf.readVarint()];feature.properties[key]=value}}function classifyRings(rings){const len=rings.length;if(len<=1)return[rings];const polygons=[];let polygon,ccw;for(let i=0;i<len;i++){const area=signedArea(rings[i]);if(area===0)continue;if(ccw===undefined)ccw=area<0;if(ccw===area<0){if(polygon)polygons.push(polygon);polygon=[rings[i]]}else if(polygon){polygon.push(rings[i])}}if(polygon)polygons.push(polygon);return polygons}function signedArea(ring){let sum=0;for(let i=0,len=ring.length,j=len-1,p1,p2;i<len;j=i++){p1=ring[i];p2=ring[j];sum+=(p2.x-p1.x)*(p1.y+p2.y)}return sum}class VectorTileLayer{constructor(pbf,end){this.version=1;this.name="";this.extent=4096;this.length=0;this._pbf=pbf;this._keys=[];this._values=[];this._features=[];pbf.readFields(readLayer,this,end);this.length=this._features.length}feature(i){if(i<0||i>=this._features.length)throw new Error("feature index out of bounds");this._pbf.pos=this._features[i];const end=this._pbf.readVarint()+this._pbf.pos;return new VectorTileFeature(this._pbf,end,this.extent,this._keys,this._values)}}exports.VectorTileLayer=VectorTileLayer;function readLayer(tag,layer,pbf){if(tag===15)layer.version=pbf.readVarint();else if(tag===1)layer.name=pbf.readString();else if(tag===5)layer.extent=pbf.readVarint();else if(tag===2)layer._features.push(pbf.pos);else if(tag===3)layer._keys.push(pbf.readString());else if(tag===4)layer._values.push(readValueMessage(pbf))}function readValueMessage(pbf){let value=null;const end=pbf.readVarint()+pbf.pos;while(pbf.pos<end){const tag=pbf.readVarint()>>3;value=tag===1?pbf.readString():tag===2?pbf.readFloat():tag===3?pbf.readDouble():tag===4?pbf.readVarint64():tag===5?pbf.readVarint():tag===6?pbf.readSVarint():tag===7?pbf.readBoolean():null}if(value==null){throw new Error("unknown feature value")}return value}class VectorTile{constructor(pbf,end){this.layers=pbf.readFields(readTile,{},end)}}exports.VectorTile=VectorTile;function readTile(tag,layers,pbf){if(tag===3){const layer=new VectorTileLayer(pbf,pbf.readVarint()+pbf.pos);if(layer.length)layers[layer.name]=layer}}},{"@mapbox/point-geometry":2}]},{},[1]);
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){"use strict";var _earcut=_interopRequireDefault(require("earcut"));function _interopRequireDefault(e){return e&&e.__esModule?e:{default:e}}self.earcut=_earcut.default},{earcut:2}],2:[function(require,module,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.default=earcut;exports.deviation=deviation;exports.flatten=flatten;function earcut(data,holeIndices,dim=2){const hasHoles=holeIndices&&holeIndices.length;const outerLen=hasHoles?holeIndices[0]*dim:data.length;let outerNode=linkedList(data,0,outerLen,dim,true);const triangles=[];if(!outerNode||outerNode.next===outerNode.prev)return triangles;let minX,minY,invSize;if(hasHoles)outerNode=eliminateHoles(data,holeIndices,outerNode,dim);if(data.length>80*dim){minX=data[0];minY=data[1];let maxX=minX;let maxY=minY;for(let i=dim;i<outerLen;i+=dim){const x=data[i];const y=data[i+1];if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y}invSize=Math.max(maxX-minX,maxY-minY);invSize=invSize!==0?32767/invSize:0}earcutLinked(outerNode,triangles,dim,minX,minY,invSize,0);return triangles}function linkedList(data,start,end,dim,clockwise){let last;if(clockwise===signedArea(data,start,end,dim)>0){for(let i=start;i<end;i+=dim)last=insertNode(i/dim|0,data[i],data[i+1],last)}else{for(let i=end-dim;i>=start;i-=dim)last=insertNode(i/dim|0,data[i],data[i+1],last)}if(last&&equals(last,last.next)){removeNode(last);last=last.next}return last}function filterPoints(start,end){if(!start)return start;if(!end)end=start;let p=start,again;do{again=false;if(!p.steiner&&(equals(p,p.next)||area(p.prev,p,p.next)===0)){removeNode(p);p=end=p.prev;if(p===p.next)break;again=true}else{p=p.next}}while(again||p!==end);return end}function earcutLinked(ear,triangles,dim,minX,minY,invSize,pass){if(!ear)return;if(!pass&&invSize)indexCurve(ear,minX,minY,invSize);let stop=ear;while(ear.prev!==ear.next){const prev=ear.prev;const next=ear.next;if(invSize?isEarHashed(ear,minX,minY,invSize):isEar(ear)){triangles.push(prev.i,ear.i,next.i);removeNode(ear);ear=next.next;stop=next.next;continue}ear=next;if(ear===stop){if(!pass){earcutLinked(filterPoints(ear),triangles,dim,minX,minY,invSize,1)}else if(pass===1){ear=cureLocalIntersections(filterPoints(ear),triangles);earcutLinked(ear,triangles,dim,minX,minY,invSize,2)}else if(pass===2){splitEarcut(ear,triangles,dim,minX,minY,invSize)}break}}}function isEar(ear){const a=ear.prev,b=ear,c=ear.next;if(area(a,b,c)>=0)return false;const ax=a.x,bx=b.x,cx=c.x,ay=a.y,by=b.y,cy=c.y;const x0=Math.min(ax,bx,cx),y0=Math.min(ay,by,cy),x1=Math.max(ax,bx,cx),y1=Math.max(ay,by,cy);let p=c.next;while(p!==a){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.next}return true}function isEarHashed(ear,minX,minY,invSize){const a=ear.prev,b=ear,c=ear.next;if(area(a,b,c)>=0)return false;const ax=a.x,bx=b.x,cx=c.x,ay=a.y,by=b.y,cy=c.y;const x0=Math.min(ax,bx,cx),y0=Math.min(ay,by,cy),x1=Math.max(ax,bx,cx),y1=Math.max(ay,by,cy);const minZ=zOrder(x0,y0,minX,minY,invSize),maxZ=zOrder(x1,y1,minX,minY,invSize);let p=ear.prevZ,n=ear.nextZ;while(p&&p.z>=minZ&&n&&n.z<=maxZ){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&p!==a&&p!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.prevZ;if(n.x>=x0&&n.x<=x1&&n.y>=y0&&n.y<=y1&&n!==a&&n!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,n.x,n.y)&&area(n.prev,n,n.next)>=0)return false;n=n.nextZ}while(p&&p.z>=minZ){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&p!==a&&p!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.prevZ}while(n&&n.z<=maxZ){if(n.x>=x0&&n.x<=x1&&n.y>=y0&&n.y<=y1&&n!==a&&n!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,n.x,n.y)&&area(n.prev,n,n.next)>=0)return false;n=n.nextZ}return true}function cureLocalIntersections(start,triangles){let p=start;do{const a=p.prev,b=p.next.next;if(!equals(a,b)&&intersects(a,p,p.next,b)&&locallyInside(a,b)&&locallyInside(b,a)){triangles.push(a.i,p.i,b.i);removeNode(p);removeNode(p.next);p=start=b}p=p.next}while(p!==start);return filterPoints(p)}function splitEarcut(start,triangles,dim,minX,minY,invSize){let a=start;do{let b=a.next.next;while(b!==a.prev){if(a.i!==b.i&&isValidDiagonal(a,b)){let c=splitPolygon(a,b);a=filterPoints(a,a.next);c=filterPoints(c,c.next);earcutLinked(a,triangles,dim,minX,minY,invSize,0);earcutLinked(c,triangles,dim,minX,minY,invSize,0);return}b=b.next}a=a.next}while(a!==start)}function eliminateHoles(data,holeIndices,outerNode,dim){const queue=[];for(let i=0,len=holeIndices.length;i<len;i++){const start=holeIndices[i]*dim;const end=i<len-1?holeIndices[i+1]*dim:data.length;const list=linkedList(data,start,end,dim,false);if(list===list.next)list.steiner=true;queue.push(getLeftmost(list))}queue.sort(compareXYSlope);for(let i=0;i<queue.length;i++){outerNode=eliminateHole(queue[i],outerNode)}return outerNode}function compareXYSlope(a,b){let result=a.x-b.x;if(result===0){result=a.y-b.y;if(result===0){const aSlope=(a.next.y-a.y)/(a.next.x-a.x);const bSlope=(b.next.y-b.y)/(b.next.x-b.x);result=aSlope-bSlope}}return result}function eliminateHole(hole,outerNode){const bridge=findHoleBridge(hole,outerNode);if(!bridge){return outerNode}const bridgeReverse=splitPolygon(bridge,hole);filterPoints(bridgeReverse,bridgeReverse.next);return filterPoints(bridge,bridge.next)}function findHoleBridge(hole,outerNode){let p=outerNode;const hx=hole.x;const hy=hole.y;let qx=-Infinity;let m;if(equals(hole,p))return p;do{if(equals(hole,p.next))return p.next;else if(hy<=p.y&&hy>=p.next.y&&p.next.y!==p.y){const x=p.x+(hy-p.y)*(p.next.x-p.x)/(p.next.y-p.y);if(x<=hx&&x>qx){qx=x;m=p.x<p.next.x?p:p.next;if(x===hx)return m}}p=p.next}while(p!==outerNode);if(!m)return null;const stop=m;const mx=m.x;const my=m.y;let tanMin=Infinity;p=m;do{if(hx>=p.x&&p.x>=mx&&hx!==p.x&&pointInTriangle(hy<my?hx:qx,hy,mx,my,hy<my?qx:hx,hy,p.x,p.y)){const tan=Math.abs(hy-p.y)/(hx-p.x);if(locallyInside(p,hole)&&(tan<tanMin||tan===tanMin&&(p.x>m.x||p.x===m.x&&sectorContainsSector(m,p)))){m=p;tanMin=tan}}p=p.next}while(p!==stop);return m}function sectorContainsSector(m,p){return area(m.prev,m,p.prev)<0&&area(p.next,m,m.next)<0}function indexCurve(start,minX,minY,invSize){let p=start;do{if(p.z===0)p.z=zOrder(p.x,p.y,minX,minY,invSize);p.prevZ=p.prev;p.nextZ=p.next;p=p.next}while(p!==start);p.prevZ.nextZ=null;p.prevZ=null;sortLinked(p)}function sortLinked(list){let numMerges;let inSize=1;do{let p=list;let e;list=null;let tail=null;numMerges=0;while(p){numMerges++;let q=p;let pSize=0;for(let i=0;i<inSize;i++){pSize++;q=q.nextZ;if(!q)break}let qSize=inSize;while(pSize>0||qSize>0&&q){if(pSize!==0&&(qSize===0||!q||p.z<=q.z)){e=p;p=p.nextZ;pSize--}else{e=q;q=q.nextZ;qSize--}if(tail)tail.nextZ=e;else list=e;e.prevZ=tail;tail=e}p=q}tail.nextZ=null;inSize*=2}while(numMerges>1);return list}function zOrder(x,y,minX,minY,invSize){x=(x-minX)*invSize|0;y=(y-minY)*invSize|0;x=(x|x<<8)&16711935;x=(x|x<<4)&252645135;x=(x|x<<2)&858993459;x=(x|x<<1)&1431655765;y=(y|y<<8)&16711935;y=(y|y<<4)&252645135;y=(y|y<<2)&858993459;y=(y|y<<1)&1431655765;return x|y<<1}function getLeftmost(start){let p=start,leftmost=start;do{if(p.x<leftmost.x||p.x===leftmost.x&&p.y<leftmost.y)leftmost=p;p=p.next}while(p!==start);return leftmost}function pointInTriangle(ax,ay,bx,by,cx,cy,px,py){return(cx-px)*(ay-py)>=(ax-px)*(cy-py)&&(ax-px)*(by-py)>=(bx-px)*(ay-py)&&(bx-px)*(cy-py)>=(cx-px)*(by-py)}function pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,px,py){return!(ax===px&&ay===py)&&pointInTriangle(ax,ay,bx,by,cx,cy,px,py)}function isValidDiagonal(a,b){return a.next.i!==b.i&&a.prev.i!==b.i&&!intersectsPolygon(a,b)&&(locallyInside(a,b)&&locallyInside(b,a)&&middleInside(a,b)&&(area(a.prev,a,b.prev)||area(a,b.prev,b))||equals(a,b)&&area(a.prev,a,a.next)>0&&area(b.prev,b,b.next)>0)}function area(p,q,r){return(q.y-p.y)*(r.x-q.x)-(q.x-p.x)*(r.y-q.y)}function equals(p1,p2){return p1.x===p2.x&&p1.y===p2.y}function intersects(p1,q1,p2,q2){const o1=sign(area(p1,q1,p2));const o2=sign(area(p1,q1,q2));const o3=sign(area(p2,q2,p1));const o4=sign(area(p2,q2,q1));if(o1!==o2&&o3!==o4)return true;if(o1===0&&onSegment(p1,p2,q1))return true;if(o2===0&&onSegment(p1,q2,q1))return true;if(o3===0&&onSegment(p2,p1,q2))return true;if(o4===0&&onSegment(p2,q1,q2))return true;return false}function onSegment(p,q,r){return q.x<=Math.max(p.x,r.x)&&q.x>=Math.min(p.x,r.x)&&q.y<=Math.max(p.y,r.y)&&q.y>=Math.min(p.y,r.y)}function sign(num){return num>0?1:num<0?-1:0}function intersectsPolygon(a,b){let p=a;do{if(p.i!==a.i&&p.next.i!==a.i&&p.i!==b.i&&p.next.i!==b.i&&intersects(p,p.next,a,b))return true;p=p.next}while(p!==a);return false}function locallyInside(a,b){return area(a.prev,a,a.next)<0?area(a,b,a.next)>=0&&area(a,a.prev,b)>=0:area(a,b,a.prev)<0||area(a,a.next,b)<0}function middleInside(a,b){let p=a;let inside=false;const px=(a.x+b.x)/2;const py=(a.y+b.y)/2;do{if(p.y>py!==p.next.y>py&&p.next.y!==p.y&&px<(p.next.x-p.x)*(py-p.y)/(p.next.y-p.y)+p.x)inside=!inside;p=p.next}while(p!==a);return inside}function splitPolygon(a,b){const a2=createNode(a.i,a.x,a.y),b2=createNode(b.i,b.x,b.y),an=a.next,bp=b.prev;a.next=b;b.prev=a;a2.next=an;an.prev=a2;b2.next=a2;a2.prev=b2;bp.next=b2;b2.prev=bp;return b2}function insertNode(i,x,y,last){const p=createNode(i,x,y);if(!last){p.prev=p;p.next=p}else{p.next=last.next;p.prev=last;last.next.prev=p;last.next=p}return p}function removeNode(p){p.next.prev=p.prev;p.prev.next=p.next;if(p.prevZ)p.prevZ.nextZ=p.nextZ;if(p.nextZ)p.nextZ.prevZ=p.prevZ}function createNode(i,x,y){return{i:i,x:x,y:y,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:false}}function deviation(data,holeIndices,dim,triangles){const hasHoles=holeIndices&&holeIndices.length;const outerLen=hasHoles?holeIndices[0]*dim:data.length;let polygonArea=Math.abs(signedArea(data,0,outerLen,dim));if(hasHoles){for(let i=0,len=holeIndices.length;i<len;i++){const start=holeIndices[i]*dim;const end=i<len-1?holeIndices[i+1]*dim:data.length;polygonArea-=Math.abs(signedArea(data,start,end,dim))}}let trianglesArea=0;for(let i=0;i<triangles.length;i+=3){const a=triangles[i]*dim;const b=triangles[i+1]*dim;const c=triangles[i+2]*dim;trianglesArea+=Math.abs((data[a]-data[c])*(data[b+1]-data[a+1])-(data[a]-data[b])*(data[c+1]-data[a+1]))}return polygonArea===0&&trianglesArea===0?0:Math.abs((trianglesArea-polygonArea)/polygonArea)}function signedArea(data,start,end,dim){let sum=0;for(let i=start,j=end-dim;i<end;i+=dim){sum+=(data[j]-data[i])*(data[i+1]+data[j+1]);j=i}return sum}function flatten(data){const vertices=[];const holes=[];const dimensions=data[0][0].length;let holeIndex=0;let prevLen=0;for(const ring of data){for(const p of ring){for(let d=0;d<dimensions;d++)vertices.push(p[d])}if(prevLen){holeIndex+=prevLen;holes.push(holeIndex)}prevLen=ring.length}return{vertices:vertices,holes:holes,dimensions:dimensions}}},{}]},{},[1]);
// libs (Pbf, vectorTile, earcut) are concatenated before this file

let EXTENT = 4096; let STYLE = {layers:{},fallback:{type:'line',color:[0,0,0,1],widthPx:1,join:'bevel',cap:'butt'}};
self.onmessage = async (e) => {
    const msg = e.data;
    try {
        if (msg.type === 'config') {
            EXTENT = msg.extent || EXTENT; STYLE = msg.style || STYLE; return;
        }
        if (msg.type === 'tile') {
            const {key, url, z, x, y} = msg;
            // lazy-load libs
            if (!self.Pbf || !self.vectorTile || !self.earcut) {
                throw new Error('Missing libs');
            }
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP '+resp.status);
            const buf = await resp.arrayBuffer();
            const vt = new self.vectorTile.VectorTile(new self.Pbf(new Uint8Array(buf)));

            const fills = [], lines = [];
            // Iterate layers
            for (const lname in vt.layers) {
                const lyr = vt.layers[lname];
                const lstyle = STYLE.layers[lname] || STYLE.fallback;
                for (let i=0;i<lyr.length;i++) {
                    const feat = lyr.feature(i);
                    const geom = feat.loadGeometry();
                    const fstyle = lstyle; // TODO: evaluate by properties/zoom if needed
                    if (feat.type === 3 && fstyle.type === 'fill') {
                        // Polygon with holes; MVT ring rule: outer CW, holes CCW (y down)
                        const polys = classifyRings(geom);
                        for (const poly of polys) {
                            const flat = []; const holes = []; let len=0;
                            for (let r=0;r<poly.length;r++) {
                                const ring = poly[r];
                                if (r>0) holes.push(len);
                                for (let k=0;k<ring.length;k++){ const p=ring[k]; flat.push(p.x, p.y); len++; }
                            }
                            const idx = self.earcut(flat, holes, 2);
                            if (idx.length) {
                                // Normalize to 0..1 UV for the renderer
                                const verts = new Float32Array(flat.length);
                                for (let j=0;j<flat.length;j+=2){ verts[j] = flat[j]/lyr.extent; verts[j+1] = flat[j+1]/lyr.extent; }
                                fills.push({ vertices: verts.buffer, indices: new Uint32Array(idx).buffer, color: fstyle.color });
                            }
                        }
                    }
                    if (feat.type === 2 && fstyle.type === 'line') {
                        // Build stroke triangles (bevel joins + requested caps; miter threshold)
                        const widthPx = fstyle.widthPx || 1.0;
                        const widthTile = widthPx * (lyr.extent / (512)); // heuristic: px@512 tile
                        for (let p=0;p<geom.length;p++) {
                            const pts = geom[p];
                            const mesh = strokePoly(pts, widthTile, fstyle.join||'bevel', fstyle.cap||'butt', fstyle.miterLimit||2.0);
                            if (mesh && mesh.indices.length) {
                                const verts = new Float32Array(mesh.vertices.length);
                                for (let j=0;j<mesh.vertices.length;j+=2){ verts[j] = mesh.vertices[j]/lyr.extent; verts[j+1] = mesh.vertices[j+1]/lyr.extent; }
                                lines.push({ vertices: verts.buffer, indices: new Uint32Array(mesh.indices).buffer, color: fstyle.color });
                            }
                        }
                    }
                }
            }

            // Transfer buffers
            const transfer = [];
            for (const a of fills) { transfer.push(a.vertices, a.indices); }
            for (const a of lines) { transfer.push(a.vertices, a.indices); }
            self.postMessage({ type:'tile', key, ok:true, data:{ fills, lines } }, transfer);
        }
    } catch (err) {
        self.postMessage({ type:'tile', key: e.data && e.data.key, ok:false, error: String(err) });
    }
};

// --- Helpers (worker) ---
function ringArea(r){ let s=0; for(let i=0;i<r.length;i++){ const p=r[i], q=r[(i+1)%r.length]; s += p.x*q.y - q.x*p.y; } return 0.5*s; }
function isOuter(r){ return ringArea(r) > 0; } // y-down: CW yields positive area
function classifyRings(rings){
    const polys=[]; let current=null;
    for (let i=0;i<rings.length;i++){
        const r=rings[i];
        if (isOuter(r)) { current && polys.push(current); current=[r]; }
        else { if (!current) { current=[r]; } else current.push(r); }
    }
    if (current) polys.push(current);
    return polys;
}

function strokePoly(points, width, join, cap, miterLimit){
    if (!points || points.length<2) return {vertices:[], indices:[]};
    const half=width/2; const V=[]; const I=[];
    let vi=0;
    function addTri(a,b,c){ I.push(a,b,c); }
    function addQuad(a,b,c,d){ I.push(a,b,c, c,b,d); }
    function add(v){ V.push(v[0],v[1]); return vi++; }
    function normal(a,b){ const dx=b.x-a.x, dy=b.y-a.y; const L=Math.hypot(dx,dy)||1; return [-dy/L, dx/L]; }
    function miter(a,b,c){ const n0=normal(a,b), n1=normal(b,c); const t=[n0[0]+n1[0], n0[1]+n1[1]]; const tl=Math.hypot(t[0],t[1]); if (tl<1e-6) return { ok:false, n:n1, ml:1e9}; const m=[t[0]/tl, t[1]/tl]; const cos= (n0[0]*n1[0]+n0[1]*n1[1]); const ml = 1/Math.max(1e-6, Math.sqrt((1+cos)/2)); return { ok:true, n:m, ml}; }

    for (let i=0;i<points.length-1;i++){
        const a=points[i], b=points[i+1];
        const n=normal(a,b);
        const off=[n[0]*half, n[1]*half];
        const aL=[a.x-off[0], a.y-off[1]], aR=[a.x+off[0], a.y+off[1]];
        const bL=[b.x-off[0], b.y-off[1]], bR=[b.x+off[0], b.y+off[1]];

        const i0=add(aL), i1=add(aR), i2=add(bL), i3=add(bR);
        addQuad(i0,i1,i2,i3);

        // Join at vertex b (if next segment exists)
        if (i < points.length-2) {
            const c=points[i+2];
            const mit=miter(a,b,c);
            if (join==='miter' && mit.ml <= (miterLimit||2)) {
                // add miter triangle to extend outer edge
                // Determine which side is outer using cross product sign
                const v0=[bL[0]-bR[0], bL[1]-bR[1]]; const outerLeft = (v0[0]*(c.y-b.y) - v0[1]*(c.x-b.x)) > 0;
                const mpt=[b.x+mit.n[0]*half/Math.max(1e-6,Math.sin(Math.acos((mit.ml*mit.ml-1)/(mit.ml*mit.ml+1)))), b.y+mit.n[1]*half/Math.max(1e-6,Math.sin(Math.acos((mit.ml*mit.ml-1)/(mit.ml*mit.ml+1))))];
                const iM=add(mpt);
                if (outerLeft) { addTri(i2,iM,i0); } else { addTri(i1,iM,i3); }
            } else if (join==='round') {
                // approximate round join with fan (8 segments)
                const segs=8; const dirA=Math.atan2(a.y-b.y, a.x-b.x)+Math.PI/2; const dirB=Math.atan2(c.y-b.y, c.x-b.x)+Math.PI/2; let start=dirA, end=dirB;
                // ensure sweep in correct direction (outer side)
                let sweep=end-start; while (sweep<=0) sweep+=Math.PI*2; if (sweep>Math.PI) { const t=start; start=end; end=t; sweep=2*Math.PI-sweep; }
                let prevIdx=add([b.x+Math.cos(start)*half, b.y+Math.sin(start)*half]);
                for (let s=1;s<=segs;s++){ const t=start + sweep*s/segs; const curIdx=add([b.x+Math.cos(t)*half, b.y+Math.sin(t)*half]); addTri(i2, prevIdx, curIdx); prevIdx=curIdx; }
            } else {
                // bevel (default): connect outer corners with a triangle; choose side by turn
                const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
                if (cross>0) { // left turn => outer on left
                    const iOuter=add([bL[0],bL[1]]); addTri(i2,iOuter,i0);
                } else {
                    const iOuter=add([bR[0],bR[1]]); addTri(i1,iOuter,i3);
                }
            }
        }

        // Caps at ends
        if (i===0) {
            if (cap==='square' || cap==='round') {
                const capOff=[-n[0]*half, -n[1]*half];
                const aL2=[aL[0]+capOff[0], aL[1]+capOff[1]]; const aR2=[aR[0]+capOff[0], aR[1]+capOff[1]];
                const j0=add(aL2), j1=add(aR2); addQuad(j0,j1,i0,i1);
            }
        }
        if (i===points.length-2) {
            if (cap==='square' || cap==='round') {
                const capOff=[n[0]*half, n[1]*half];
                const bL2=[bL[0]+capOff[0], bL[1]+capOff[1]]; const bR2=[bR[0]+capOff[0], bR[1]+capOff[1]];
                const j2=add(bL2), j3=add(bR2); addQuad(i2,i3,j2,j3);
            }
        }
    }
    return { vertices: V, indices: I };
}

`;
})(typeof self !== 'undefined' ? self : window);
//! flex-renderer 0.0.1
//! Built on 2025-10-28
//! Git commit: --3205840-dirty
//! http://openseadragon.github.io
//! License: http://openseadragon.github.io/license/

(function(root){
  root.OpenSeadragon = root.OpenSeadragon || {};
  // Full inlined worker source (libs + core)
  root.OpenSeadragon.__FABRIC_WORKER_SOURCE__ = `
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){"use strict";var _earcut=_interopRequireDefault(require("earcut"));function _interopRequireDefault(e){return e&&e.__esModule?e:{default:e}}self.earcut=_earcut.default},{earcut:2}],2:[function(require,module,exports){"use strict";Object.defineProperty(exports,"__esModule",{value:true});exports.default=earcut;exports.deviation=deviation;exports.flatten=flatten;function earcut(data,holeIndices,dim=2){const hasHoles=holeIndices&&holeIndices.length;const outerLen=hasHoles?holeIndices[0]*dim:data.length;let outerNode=linkedList(data,0,outerLen,dim,true);const triangles=[];if(!outerNode||outerNode.next===outerNode.prev)return triangles;let minX,minY,invSize;if(hasHoles)outerNode=eliminateHoles(data,holeIndices,outerNode,dim);if(data.length>80*dim){minX=data[0];minY=data[1];let maxX=minX;let maxY=minY;for(let i=dim;i<outerLen;i+=dim){const x=data[i];const y=data[i+1];if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y}invSize=Math.max(maxX-minX,maxY-minY);invSize=invSize!==0?32767/invSize:0}earcutLinked(outerNode,triangles,dim,minX,minY,invSize,0);return triangles}function linkedList(data,start,end,dim,clockwise){let last;if(clockwise===signedArea(data,start,end,dim)>0){for(let i=start;i<end;i+=dim)last=insertNode(i/dim|0,data[i],data[i+1],last)}else{for(let i=end-dim;i>=start;i-=dim)last=insertNode(i/dim|0,data[i],data[i+1],last)}if(last&&equals(last,last.next)){removeNode(last);last=last.next}return last}function filterPoints(start,end){if(!start)return start;if(!end)end=start;let p=start,again;do{again=false;if(!p.steiner&&(equals(p,p.next)||area(p.prev,p,p.next)===0)){removeNode(p);p=end=p.prev;if(p===p.next)break;again=true}else{p=p.next}}while(again||p!==end);return end}function earcutLinked(ear,triangles,dim,minX,minY,invSize,pass){if(!ear)return;if(!pass&&invSize)indexCurve(ear,minX,minY,invSize);let stop=ear;while(ear.prev!==ear.next){const prev=ear.prev;const next=ear.next;if(invSize?isEarHashed(ear,minX,minY,invSize):isEar(ear)){triangles.push(prev.i,ear.i,next.i);removeNode(ear);ear=next.next;stop=next.next;continue}ear=next;if(ear===stop){if(!pass){earcutLinked(filterPoints(ear),triangles,dim,minX,minY,invSize,1)}else if(pass===1){ear=cureLocalIntersections(filterPoints(ear),triangles);earcutLinked(ear,triangles,dim,minX,minY,invSize,2)}else if(pass===2){splitEarcut(ear,triangles,dim,minX,minY,invSize)}break}}}function isEar(ear){const a=ear.prev,b=ear,c=ear.next;if(area(a,b,c)>=0)return false;const ax=a.x,bx=b.x,cx=c.x,ay=a.y,by=b.y,cy=c.y;const x0=Math.min(ax,bx,cx),y0=Math.min(ay,by,cy),x1=Math.max(ax,bx,cx),y1=Math.max(ay,by,cy);let p=c.next;while(p!==a){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.next}return true}function isEarHashed(ear,minX,minY,invSize){const a=ear.prev,b=ear,c=ear.next;if(area(a,b,c)>=0)return false;const ax=a.x,bx=b.x,cx=c.x,ay=a.y,by=b.y,cy=c.y;const x0=Math.min(ax,bx,cx),y0=Math.min(ay,by,cy),x1=Math.max(ax,bx,cx),y1=Math.max(ay,by,cy);const minZ=zOrder(x0,y0,minX,minY,invSize),maxZ=zOrder(x1,y1,minX,minY,invSize);let p=ear.prevZ,n=ear.nextZ;while(p&&p.z>=minZ&&n&&n.z<=maxZ){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&p!==a&&p!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.prevZ;if(n.x>=x0&&n.x<=x1&&n.y>=y0&&n.y<=y1&&n!==a&&n!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,n.x,n.y)&&area(n.prev,n,n.next)>=0)return false;n=n.nextZ}while(p&&p.z>=minZ){if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1&&p!==a&&p!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,p.x,p.y)&&area(p.prev,p,p.next)>=0)return false;p=p.prevZ}while(n&&n.z<=maxZ){if(n.x>=x0&&n.x<=x1&&n.y>=y0&&n.y<=y1&&n!==a&&n!==c&&pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,n.x,n.y)&&area(n.prev,n,n.next)>=0)return false;n=n.nextZ}return true}function cureLocalIntersections(start,triangles){let p=start;do{const a=p.prev,b=p.next.next;if(!equals(a,b)&&intersects(a,p,p.next,b)&&locallyInside(a,b)&&locallyInside(b,a)){triangles.push(a.i,p.i,b.i);removeNode(p);removeNode(p.next);p=start=b}p=p.next}while(p!==start);return filterPoints(p)}function splitEarcut(start,triangles,dim,minX,minY,invSize){let a=start;do{let b=a.next.next;while(b!==a.prev){if(a.i!==b.i&&isValidDiagonal(a,b)){let c=splitPolygon(a,b);a=filterPoints(a,a.next);c=filterPoints(c,c.next);earcutLinked(a,triangles,dim,minX,minY,invSize,0);earcutLinked(c,triangles,dim,minX,minY,invSize,0);return}b=b.next}a=a.next}while(a!==start)}function eliminateHoles(data,holeIndices,outerNode,dim){const queue=[];for(let i=0,len=holeIndices.length;i<len;i++){const start=holeIndices[i]*dim;const end=i<len-1?holeIndices[i+1]*dim:data.length;const list=linkedList(data,start,end,dim,false);if(list===list.next)list.steiner=true;queue.push(getLeftmost(list))}queue.sort(compareXYSlope);for(let i=0;i<queue.length;i++){outerNode=eliminateHole(queue[i],outerNode)}return outerNode}function compareXYSlope(a,b){let result=a.x-b.x;if(result===0){result=a.y-b.y;if(result===0){const aSlope=(a.next.y-a.y)/(a.next.x-a.x);const bSlope=(b.next.y-b.y)/(b.next.x-b.x);result=aSlope-bSlope}}return result}function eliminateHole(hole,outerNode){const bridge=findHoleBridge(hole,outerNode);if(!bridge){return outerNode}const bridgeReverse=splitPolygon(bridge,hole);filterPoints(bridgeReverse,bridgeReverse.next);return filterPoints(bridge,bridge.next)}function findHoleBridge(hole,outerNode){let p=outerNode;const hx=hole.x;const hy=hole.y;let qx=-Infinity;let m;if(equals(hole,p))return p;do{if(equals(hole,p.next))return p.next;else if(hy<=p.y&&hy>=p.next.y&&p.next.y!==p.y){const x=p.x+(hy-p.y)*(p.next.x-p.x)/(p.next.y-p.y);if(x<=hx&&x>qx){qx=x;m=p.x<p.next.x?p:p.next;if(x===hx)return m}}p=p.next}while(p!==outerNode);if(!m)return null;const stop=m;const mx=m.x;const my=m.y;let tanMin=Infinity;p=m;do{if(hx>=p.x&&p.x>=mx&&hx!==p.x&&pointInTriangle(hy<my?hx:qx,hy,mx,my,hy<my?qx:hx,hy,p.x,p.y)){const tan=Math.abs(hy-p.y)/(hx-p.x);if(locallyInside(p,hole)&&(tan<tanMin||tan===tanMin&&(p.x>m.x||p.x===m.x&&sectorContainsSector(m,p)))){m=p;tanMin=tan}}p=p.next}while(p!==stop);return m}function sectorContainsSector(m,p){return area(m.prev,m,p.prev)<0&&area(p.next,m,m.next)<0}function indexCurve(start,minX,minY,invSize){let p=start;do{if(p.z===0)p.z=zOrder(p.x,p.y,minX,minY,invSize);p.prevZ=p.prev;p.nextZ=p.next;p=p.next}while(p!==start);p.prevZ.nextZ=null;p.prevZ=null;sortLinked(p)}function sortLinked(list){let numMerges;let inSize=1;do{let p=list;let e;list=null;let tail=null;numMerges=0;while(p){numMerges++;let q=p;let pSize=0;for(let i=0;i<inSize;i++){pSize++;q=q.nextZ;if(!q)break}let qSize=inSize;while(pSize>0||qSize>0&&q){if(pSize!==0&&(qSize===0||!q||p.z<=q.z)){e=p;p=p.nextZ;pSize--}else{e=q;q=q.nextZ;qSize--}if(tail)tail.nextZ=e;else list=e;e.prevZ=tail;tail=e}p=q}tail.nextZ=null;inSize*=2}while(numMerges>1);return list}function zOrder(x,y,minX,minY,invSize){x=(x-minX)*invSize|0;y=(y-minY)*invSize|0;x=(x|x<<8)&16711935;x=(x|x<<4)&252645135;x=(x|x<<2)&858993459;x=(x|x<<1)&1431655765;y=(y|y<<8)&16711935;y=(y|y<<4)&252645135;y=(y|y<<2)&858993459;y=(y|y<<1)&1431655765;return x|y<<1}function getLeftmost(start){let p=start,leftmost=start;do{if(p.x<leftmost.x||p.x===leftmost.x&&p.y<leftmost.y)leftmost=p;p=p.next}while(p!==start);return leftmost}function pointInTriangle(ax,ay,bx,by,cx,cy,px,py){return(cx-px)*(ay-py)>=(ax-px)*(cy-py)&&(ax-px)*(by-py)>=(bx-px)*(ay-py)&&(bx-px)*(cy-py)>=(cx-px)*(by-py)}function pointInTriangleExceptFirst(ax,ay,bx,by,cx,cy,px,py){return!(ax===px&&ay===py)&&pointInTriangle(ax,ay,bx,by,cx,cy,px,py)}function isValidDiagonal(a,b){return a.next.i!==b.i&&a.prev.i!==b.i&&!intersectsPolygon(a,b)&&(locallyInside(a,b)&&locallyInside(b,a)&&middleInside(a,b)&&(area(a.prev,a,b.prev)||area(a,b.prev,b))||equals(a,b)&&area(a.prev,a,a.next)>0&&area(b.prev,b,b.next)>0)}function area(p,q,r){return(q.y-p.y)*(r.x-q.x)-(q.x-p.x)*(r.y-q.y)}function equals(p1,p2){return p1.x===p2.x&&p1.y===p2.y}function intersects(p1,q1,p2,q2){const o1=sign(area(p1,q1,p2));const o2=sign(area(p1,q1,q2));const o3=sign(area(p2,q2,p1));const o4=sign(area(p2,q2,q1));if(o1!==o2&&o3!==o4)return true;if(o1===0&&onSegment(p1,p2,q1))return true;if(o2===0&&onSegment(p1,q2,q1))return true;if(o3===0&&onSegment(p2,p1,q2))return true;if(o4===0&&onSegment(p2,q1,q2))return true;return false}function onSegment(p,q,r){return q.x<=Math.max(p.x,r.x)&&q.x>=Math.min(p.x,r.x)&&q.y<=Math.max(p.y,r.y)&&q.y>=Math.min(p.y,r.y)}function sign(num){return num>0?1:num<0?-1:0}function intersectsPolygon(a,b){let p=a;do{if(p.i!==a.i&&p.next.i!==a.i&&p.i!==b.i&&p.next.i!==b.i&&intersects(p,p.next,a,b))return true;p=p.next}while(p!==a);return false}function locallyInside(a,b){return area(a.prev,a,a.next)<0?area(a,b,a.next)>=0&&area(a,a.prev,b)>=0:area(a,b,a.prev)<0||area(a,a.next,b)<0}function middleInside(a,b){let p=a;let inside=false;const px=(a.x+b.x)/2;const py=(a.y+b.y)/2;do{if(p.y>py!==p.next.y>py&&p.next.y!==p.y&&px<(p.next.x-p.x)*(py-p.y)/(p.next.y-p.y)+p.x)inside=!inside;p=p.next}while(p!==a);return inside}function splitPolygon(a,b){const a2=createNode(a.i,a.x,a.y),b2=createNode(b.i,b.x,b.y),an=a.next,bp=b.prev;a.next=b;b.prev=a;a2.next=an;an.prev=a2;b2.next=a2;a2.prev=b2;bp.next=b2;b2.prev=bp;return b2}function insertNode(i,x,y,last){const p=createNode(i,x,y);if(!last){p.prev=p;p.next=p}else{p.next=last.next;p.prev=last;last.next.prev=p;last.next=p}return p}function removeNode(p){p.next.prev=p.prev;p.prev.next=p.next;if(p.prevZ)p.prevZ.nextZ=p.nextZ;if(p.nextZ)p.nextZ.prevZ=p.prevZ}function createNode(i,x,y){return{i:i,x:x,y:y,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:false}}function deviation(data,holeIndices,dim,triangles){const hasHoles=holeIndices&&holeIndices.length;const outerLen=hasHoles?holeIndices[0]*dim:data.length;let polygonArea=Math.abs(signedArea(data,0,outerLen,dim));if(hasHoles){for(let i=0,len=holeIndices.length;i<len;i++){const start=holeIndices[i]*dim;const end=i<len-1?holeIndices[i+1]*dim:data.length;polygonArea-=Math.abs(signedArea(data,start,end,dim))}}let trianglesArea=0;for(let i=0;i<triangles.length;i+=3){const a=triangles[i]*dim;const b=triangles[i+1]*dim;const c=triangles[i+2]*dim;trianglesArea+=Math.abs((data[a]-data[c])*(data[b+1]-data[a+1])-(data[a]-data[b])*(data[c+1]-data[a+1]))}return polygonArea===0&&trianglesArea===0?0:Math.abs((trianglesArea-polygonArea)/polygonArea)}function signedArea(data,start,end,dim){let sum=0;for(let i=start,j=end-dim;i<end;i+=dim){sum+=(data[j]-data[i])*(data[i+1]+data[j+1]);j=i}return sum}function flatten(data){const vertices=[];const holes=[];const dimensions=data[0][0].length;let holeIndex=0;let prevLen=0;for(const ring of data){for(const p of ring){for(let d=0;d<dimensions;d++)vertices.push(p[d])}if(prevLen){holeIndex+=prevLen;holes.push(holeIndex)}prevLen=ring.length}return{vertices:vertices,holes:holes,dimensions:dimensions}}},{}]},{},[1]);
// fabric-geom.worker.js  (single-rectangular-tile, unit-normalized)
/* global self */

let CONFIG = {
    width: 0,
    height: 0,
    minLevel: 0,
    maxLevel: 0,
    origin: { x: 0, y: 0 }
};

// id -> { aabb:{x,y,w,h}, meshes:{fills,lines} } ; meshes are in IMAGE space
const OBJECTS = new Map();

// Messages:
//  - { type: 'config', width, height, origin? }
//  - { type: 'addOrUpdate', id, fabric, style }
//  - { type: 'remove', id }
//  - { type: 'tiles', z, keys:[ 'z/x/y', ... ] }  -> returns same unit batch for all keys (single-tile mode)

self.onmessage = (e) => {
    const m = e.data || {};

    try {
        if (m.type === 'config') {
            if (typeof m.width === 'number') {
                CONFIG.width = m.width;
            }
            if (typeof m.height === 'number') {
                CONFIG.height = m.height;
            }
            if (m.origin) {
                CONFIG.origin = m.origin;
            }

            CONFIG.minLevel = 0;
            CONFIG.maxLevel = 0;

            self.postMessage({ type: 'config', ok: true });
            return;
        }

        if (m.type === 'addOrUpdate') {
            const id = m.id;
            const fabric = m.fabric;
            const style = m.style;

            const aabb = computeAABB(fabric);
            const meshes = toMeshes(fabric, style);

            OBJECTS.set(id, { aabb: aabb, meshes: meshes });

            self.postMessage({ type: 'ack', id: id, ok: true });
            return;
        }

        if (m.type === 'remove') {
            const id = m.id;

            OBJECTS.delete(id);

            self.postMessage({ type: 'ack', ok: true });
            return;
        }

        if (m.type === 'tiles') {
            const unit = buildUnitBatchesFromAllObjects();

            const pack = (b) => {
                if (!b) {
                    return undefined;
                }
                return {
                    vertices: b.positions.buffer,
                    colors: b.colors.buffer,
                    indices: b.indices.buffer
                };
            };

            const rec = {
                fills: pack(unit.fills),
                lines: pack(unit.lines)
            };

            const transfers = [];
            if (rec.fills) {
                transfers.push(rec.fills.vertices);
                transfers.push(rec.fills.colors);
                transfers.push(rec.fills.indices);
            }
            if (rec.lines) {
                transfers.push(rec.lines.vertices);
                transfers.push(rec.lines.colors);
                transfers.push(rec.lines.indices);
            }

            const keys = Array.isArray(m.keys) && m.keys.length > 0 ? m.keys : [ '0/0/0' ];
            const out = [];

            for (const key of keys) {
                out.push({ key: key, fills: rec.fills, lines: rec.lines });
            }

            self.postMessage({ type: 'tiles', z: 0, ok: true, tiles: out }, transfers);
            return;
        }
    } catch (err) {
        self.postMessage({ type: m.type, ok: false, error: String(err.stack || err) });
    }
};

// ---- build a single unit-UV batch from everything ----

function buildUnitBatchesFromAllObjects() {
    const fills = [];
    const lines = [];

    for (const obj of OBJECTS.values()) {
        if (obj.meshes.fills) {
            for (const m of obj.meshes.fills) {
                fills.push(normalizeMesh(m));
            }
        }
        if (obj.meshes.lines) {
            for (const m of obj.meshes.lines) {
                lines.push(normalizeMesh(m));
            }
        }
    }

    const result = {
        fills: fills.length > 0 ? makeBatch(fills) : undefined,
        lines: lines.length > 0 ? makeBatch(lines) : undefined
    };

    return result;
}

function normalizeMesh(m) {
    const W = CONFIG.width > 0 ? CONFIG.width : 1;
    const H = CONFIG.height > 0 ? CONFIG.height : 1;
    const ox = CONFIG.origin && typeof CONFIG.origin.x === 'number' ? CONFIG.origin.x : 0;
    const oy = CONFIG.origin && typeof CONFIG.origin.y === 'number' ? CONFIG.origin.y : 0;

    const src = m.vertices;
    const out = new Float32Array(src.length);

    for (let i = 0; i < src.length; i += 2) {
        out[i] = (src[i] - ox) / W;
        out[i + 1] = (src[i + 1] - oy) / H;
    }

    return {
        vertices: out,
        indices: m.indices,
        color: m.color
    };
}

// ---- meshing (image-space) ----

function toMeshes(fabric, style) {
    const colorFill = style && Array.isArray(style.fill) ? style.fill : [ 0, 0, 0, 0 ];
    const colorLine = style && Array.isArray(style.stroke) ? style.stroke : [ 0, 0, 0, 1 ];
    const widthPx = typeof style?.strokeWidth === 'number' ? style.strokeWidth : 1;

    const outF = [];
    const outL = [];

    if (fabric.type === 'rect') {
        const x = fabric.x;
        const y = fabric.y;
        const w = fabric.w;
        const h = fabric.h;

        if (colorFill[3] > 0) {
            outF.push(triRect(x, y, w, h, colorFill));
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const loop = [
                { x: x, y: y },
                { x: x + w, y: y },
                { x: x + w, y: y + h },
                { x: x, y: y + h },
                { x: x, y: y }
            ];
            const m = strokeTriangles(loop, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'ellipse') {
        const cx = fabric.cx;
        const cy = fabric.cy;
        const rx = fabric.rx;
        const ry = fabric.ry;
        const segments = typeof fabric.segments === 'number' ? fabric.segments : 64;

        const ring = [];
        for (let k = 0; k < segments; k++) {
            const t = (2 * Math.PI * k) / segments;
            ring.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
        }

        if (colorFill[3] > 0) {
            const m = triPolygon([ ring ], colorFill);
            if (m) {
                outF.push(m);
            }
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const m = strokeTriangles(ring.concat([ ring[0] ]), widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'polygon') {
        const rings = normalizeRings(fabric.points);

        if (colorFill[3] > 0) {
            const m = triPolygon(rings, colorFill);
            if (m) {
                outF.push(m);
            }
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const closed = rings[0].concat([ rings[0][0] ]);
            const m = strokeTriangles(closed, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'polyline') {
        if (colorLine[3] > 0 && widthPx > 0) {
            const m = strokeTriangles(fabric.points, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    }

    return { fills: outF, lines: outL };
}

function triRect(x, y, w, h, color) {
    const vertices = new Float32Array([
        x, y,
        x + w, y,
        x + w, y + h,
        x, y + h
    ]);

    const indices = new Uint32Array([ 0, 1, 2, 0, 2, 3 ]);

    return {
        vertices: vertices,
        indices: indices,
        color: color
    };
}

function triPolygon(rings, color) {
    const flat = [];
    const holes = [];

    let len = 0;
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];

        if (r > 0) {
            holes.push(len);
        }

        for (const p of ring) {
            flat.push(p.x, p.y);
            len = len + 1;
        }
    }

    const idx = self.earcut ? self.earcut(flat, holes, 2) : [];

    if (!idx || idx.length === 0) {
        return null;
    }

    return {
        vertices: Float32Array.from(flat),
        indices: Uint32Array.from(idx),
        color: color
    };
}

function strokeTriangles(points, widthPx, color) {
    const stroked = strokePoly(points, widthPx);

    if (!stroked.indices || stroked.indices.length === 0) {
        return null;
    }

    return {
        vertices: Float32Array.from(stroked.vertices),
        indices: Uint32Array.from(stroked.indices),
        color: color
    };
}

// Minimal polyline stroker (bevel joins, butt caps). Width is in IMAGE pixels.
function strokePoly(points, widthPx) {
    const half = widthPx * 0.5;

    const verts = [];
    const idx = [];

    let base = 0;

    for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];

        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;

        const len = Math.hypot(dx, dy);
        const safeLen = len > 0 ? len : 1;

        const nx = -dy / safeLen;
        const ny = dx / safeLen;

        const v0 = [ p0.x - nx * half, p0.y - ny * half ];
        const v1 = [ p0.x + nx * half, p0.y + ny * half ];
        const v2 = [ p1.x - nx * half, p1.y - ny * half ];
        const v3 = [ p1.x + nx * half, p1.y + ny * half ];

        verts.push(v0[0], v0[1]);
        verts.push(v1[0], v1[1]);
        verts.push(v2[0], v2[1]);
        verts.push(v3[0], v3[1]);

        idx.push(base + 0, base + 1, base + 2);
        idx.push(base + 1, base + 3, base + 2);

        base = base + 4;
    }

    return { vertices: verts, indices: idx };
}

// ---- batching (same layout your renderer expects) ----

function makeBatch(meshes) {
    let vCount = 0;
    let iCount = 0;

    for (const m of meshes) {
        vCount = vCount + (m.vertices.length / 2);
        iCount = iCount + m.indices.length;
    }

    const positions = new Float32Array(vCount * 2);
    const colors = new Uint8Array(vCount * 4);
    const indices = new Uint32Array(iCount);

    let vOfs = 0;
    let iOfs = 0;
    let base = 0;

    for (const m of meshes) {
        positions.set(m.vertices, vOfs * 2);

        const r = clamp255(((m.color && m.color[0]) || 0) * 255);
        const g = clamp255(((m.color && m.color[1]) || 0) * 255);
        const b = clamp255(((m.color && m.color[2]) || 0) * 255);
        const a = clamp255(((m.color && m.color[3]) || 1) * 255);

        const localVerts = m.vertices.length / 2;

        for (let k = 0; k < localVerts; k++) {
            const c = (vOfs + k) * 4;
            colors[c] = r;
            colors[c + 1] = g;
            colors[c + 2] = b;
            colors[c + 3] = a;
        }

        for (let k = 0; k < m.indices.length; k++) {
            indices[iOfs + k] = base + m.indices[k];
        }

        base = base + localVerts;
        vOfs = vOfs + localVerts;
        iOfs = iOfs + m.indices.length;
    }

    return { positions: positions, colors: colors, indices: indices };
}

function clamp255(v) {
    const n = Math.round(v);
    if (n < 0) {
        return 0;
    }
    if (n > 255) {
        return 255;
    }
    return n;
}

// ---- utils ----

function normalizeRings(points) {
    return [ points ];
}

function computeAABB(f) {
    if (f.type === 'rect') {
        return { x: f.x, y: f.y, w: f.w, h: f.h };
    }

    if (f.type === 'ellipse') {
        return { x: f.cx - f.rx, y: f.cy - f.ry, w: 2 * f.rx, h: 2 * f.ry };
    }

    const pts = Array.isArray(f.points) ? f.points : [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of pts) {
        if (p.x < minX) {
            minX = p.x;
        }
        if (p.y < minY) {
            minY = p.y;
        }
        if (p.x > maxX) {
            maxX = p.x;
        }
        if (p.y > maxY) {
            maxY = p.y;
        }
    }

    if (!isFinite(minX)) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

`;
})(typeof self !== 'undefined' ? self : window);
//# sourceMappingURL=flex-renderer.js.map