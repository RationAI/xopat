//! flex-renderer 0.0.1
//! Built on 2026-05-02
//! Git commit: --3326e6e-dirty
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
     * @property {Number} textureDepth
     * @property {Number} stencilDepth
     */

    /**
     * @typedef {Object} InspectorState
     * @property {boolean} enabled master switch for inspector logic
     * @property {"reveal-inside"|"reveal-outside"|"lens-zoom"} mode interaction mode
     * @property {{x: number, y: number}} centerPx inspector center in canvas pixel space
     * @property {number} radiusPx inspector radius in canvas pixels
     * @property {number} featherPx soft edge width in canvas pixels
     * @property {number} lensZoom magnification used by lens mode, clamped to >= 1
     * @property {number} shaderSplitIndex first shader slot affected by reveal modes
     */

    /**
     * @typedef {Object} InspectorStateUpdateOptions
     * @property {boolean} [notify=true] emit the `inspector-change` event
     * @property {boolean} [redraw=true] request a redraw after the state change
     * @property {string} [reason="set-inspector-state"] semantic reason included in the emitted event
     */

    /**
     * @typedef {Object} SecondPassTextureOptions
     * @property {GLint|null} [framebuffer] optional framebuffer override for the final draw call
     * @property {Object|string} [target] backend-owned render target object or stable target key
     * @property {string} [targetKey] stable target key used when `target` is omitted
     * @property {number} [width] target width in physical pixels
     * @property {number} [height] target height in physical pixels
     * @property {number[]} [clearColor=[0, 0, 0, 0]] RGBA color used when rendering an empty second pass
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
         * @param {string|undefined} incomingOptions.backgroundColor #RGB or #RGBA hex, default undefined - transparent
         *
         * @param {Object} incomingOptions.canvasOptions
         * @param {Boolean} incomingOptions.canvasOptions.alpha
         * @param {Boolean} incomingOptions.canvasOptions.premultipliedAlpha
         * @param {Boolean} incomingOptions.canvasOptions.stencil
         *
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
            this._background = incomingOptions.backgroundColor || '#00000000';

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
            this._inspectorState = this.constructor.normalizeInspectorState();

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
                    proto = context && context.prototype;
                if (proto && proto instanceof namespace.WebGLImplementation &&
                    $.isFunction( proto.getVersion ) && proto.getVersion.call( context ) === version) {
                        return context;
                }
            }

            throw new Error("$.FlexRenderer::determineContext: Could not find WebGLImplementation with version " + version);
        }

        /**
         * Pre-compilation shader configuration cleanup
         * @param {ShaderConfig} config
         * @param {NormalizationContext} context
         * @return {ShaderConfig}
         */
        static normalizeShaderConfig(config, context = {}) {
            if (!config || typeof config !== "object") {
                return config;
            }

            let normalized = config;
            const Shader = normalized.type ? $.FlexRenderer.ShaderMediator.getClass(normalized.type) : null;

            if (Shader && typeof Shader.normalizeConfig === "function") {
                const next = Shader.normalizeConfig(normalized, context);
                if (next && typeof next === "object") {
                    normalized = next;
                }
            }

            if (normalized.shaders && typeof normalized.shaders === "object" && !Array.isArray(normalized.shaders)) {
                normalized.shaders = $.FlexRenderer.normalizeShaderMap(normalized.shaders, {
                    ...context,
                    parentConfig: normalized
                });
            }

            return normalized;
        }

        /**
         * Normalize shader configuration map - all shaders at once.
         * @param {Record<string, ShaderConfig>} shaderMap
         * @param {NormalizationContext} context
         * @return {Record<string, ShaderConfig>}
         */
        static normalizeShaderMap(shaderMap, context = {}) {
            if (!shaderMap || typeof shaderMap !== "object" || Array.isArray(shaderMap)) {
                return shaderMap;
            }

            for (const shaderId of Object.keys(shaderMap)) {
                shaderMap[shaderId] = $.FlexRenderer.normalizeShaderConfig(shaderMap[shaderId], {
                    ...context,
                    shaderId,
                    path: Array.isArray(context.path) ? context.path.concat([shaderId]) : [shaderId]
                });
            }

            return shaderMap;
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
        setDimensions(x, y, width, height, levels, tiledImageCount) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(x, y, width, height);
            this.webglContext.setDimensions(x, y, width, height, levels, tiledImageCount);
        }

        /**
         * Set viewer background color, supports #RGBA or #RGB syntax. Note that setting the value
         * does not do anything until you recompile the shaders and should be done as early as possible,
         * at best using the constructor options.
         * @param (background)
         */
        setBackground(background) {
            this._background = background || '#00000000';
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
                this._showOffscreenMatrix(result, {scale: 0.5, pad: 8});
            }

            this.__firstPassResult = result;
            return result;
        }

        /**
         * Execute the second pass for the already prepared first-pass result.
         *
         * Responsibility split:
         * - the renderer owns inspector state and decides whether the active inspector mode
         *   can be executed inline in the normal second pass
         * - reveal modes stay in the normal second-pass program
         * - lens mode may delegate to the backend-specific inspector compositor path
         *
         * @param {SPRenderPackage[]} renderArray
         * @param {RenderOptions|undefined} options
         * @return {RenderOutput}
         */
        secondPassProcessData(renderArray, options = undefined) {
            if (this.webglContext && typeof this.webglContext.processSecondPassWithInspector === "function") {
                const inspectorState = this.getInspectorState();
                if (inspectorState && inspectorState.enabled && inspectorState.mode === "lens-zoom") {
                    return this.webglContext.processSecondPassWithInspector(renderArray, options);
                }
            }

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
            // TODO consider deleting only if succesfully compiled to avoid critical errors
            if (this._programImplementations[key]) {
                this.deleteProgram(key);
            }

            const webglProgram = this.gl.createProgram();
            program._webGLProgram = webglProgram;
            program._justCreated = true;

            // TODO inner control type udpates are not checked here
            for (let shaderId in this._shaders) {
                const shader = this._shaders[shaderId];
                const config = shader.getConfig();
                // Check explicitly type of the config, if updated, recreate shader
                if (shader.constructor.type() !== config.type) {
                    const NewShader = $.FlexRenderer.ShaderMediator.getClass(config.type);
                    if (NewShader) {
                        // Drop orphan params from the previous shader type before re-instantiation,
                        // otherwise stale keys (color, threshold, connect, incompatible use_channelN, ...)
                        // ride along and trigger parseChannel warnings or sample()-time incompatibilities.
                        this._sanitizeShaderParams(config, NewShader);
                    }
                    this.createShaderLayer(shaderId, config, false);
                }
            }
            // Needs reference early
            this._programImplementations[key] = program;
            this.webglContext.setBackground(this._background);

            program.build(this._shaders, this.getShaderLayerOrder());
            // Used also to re-compile, set requiresLoad to true
            program.requiresLoad = true;

            const errMsg = program.getValidateErrorMessage();
            if (errMsg) {
                this.gl.deleteProgram(webglProgram);
                program._webGLProgram = null;
                this._programImplementations[key] = null;
                throw new Error(errMsg);
            }

            if ($.FlexRenderer.WebGLImplementation._compileProgram(
                webglProgram, this.gl, program, $.console.error, this.debug
            )) {
                this.gl.useProgram(webglProgram);
                program.created(this.canvas.width, this.canvas.height);
                return key;
            }
            // else todo consider some cleanup
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

            if (this._program) {
                const reused = !program._justCreated;
                if (this.running && this._program === program && reused) {
                    return false;
                }
                if (reused) {
                    program._justCreated = false;
                }
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
                    try {
                        if (this.htmlHandler) {
                            this.htmlReset();

                            this.forEachShaderLayerWithContext(
                                this._shaders,
                                this.getShaderLayerOrder(),
                                (shaderLayer, shaderId, shaderConfig, htmlContext) => {
                                    this.htmlHandler(
                                        shaderLayer,
                                        shaderConfig,
                                        htmlContext
                                    );
                                }
                            );

                            this.raiseEvent('html-controls-created', {
                                name: name,
                                program: program,
                                shaderLayers: this._shaders,
                            });
                        }

                        for (const shaderId in this._shaders) {
                            try {
                                this._shaders[shaderId].init();
                            } catch (e) {
                                $.console.warn(`Shader ${shaderId} init(). The shader control will not work.`, e);
                            }
                        }
                    } catch (e) {
                        $.console.warn(`Second pass re-initialization error: the visualization might not render.`, e);
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
            if (this._program === implementation) {
                this._program = null;
            }
            implementation.unload();
            implementation.destroy();
            this.gl.deleteProgram(implementation._webGLProgram);
            this.__firstPassResult = null;
            this._programImplementations[key] = null;
        }

        /**
         * Create and initialize new ShaderLayer instance and its controls.
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
                tiledImages: [],
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
                // callback to recreate the shader when control topology changes
                refresh: () => {
                    this.refreshShaderLayer(id, { rebuildProgram: true });
                },
                // callback to reinitialize the drawer; NOT USED
                refetch: this.refetchCallback
            });

            try {
                this._shaders[id] = shader;
                shader.construct();
                return shader;
            } catch (e) {
                delete this._shaders[id];
                console.error(`Failed to construct shader '${id}' (${shaderConfig.type}).`, e, shaderConfig);
                return undefined;
            }
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
         * Change a layer's shader type and trigger a rebuild.
         * Use this rather than mutating shaderConfig.type directly: it scrubs orphan
         * params from the previous type before the rebuild loop re-instantiates the shader.
         *
         * @param {String} layerId
         * @param {String} newType  must be a registered shader type ($.FlexRenderer.ShaderMediator)
         */
        changeShaderType(layerId, newType) {
            const id = $.FlexRenderer.sanitizeKey(layerId);
            const shader = this._shaders[id];
            if (!shader) {
                throw new Error(`$.FlexRenderer::changeShaderType: Unknown layer '${layerId}'.`);
            }

            const NewShader = $.FlexRenderer.ShaderMediator.getClass(newType);
            if (!NewShader) {
                throw new Error(`$.FlexRenderer::changeShaderType: Unknown shader type '${newType}'.`);
            }

            const config = shader.getConfig();
            if (config.type === newType) {
                return;
            }
            config.type = newType;
            config.error = false;
            this._sanitizeShaderParams(config, NewShader);
            this.registerProgram(null, this.webglContext.secondPassProgramKey);
        }

        /**
         * Drop keys from shaderConfig.params that are not valid for the target shader class.
         * Called on shader-type-change paths only — orphan keys from the previous shader
         * (e.g. heatmap's `color`, `threshold`, `connect`) and incompatible per-source
         * channel values would otherwise cause parseChannel warnings or sample()-time
         * GLSL incompatibilities once the new shader is constructed.
         *
         * @param {ShaderConfig} shaderConfig    config whose .params object will be mutated
         * @param {Function}     NewShaderClass  the target shader class
         * @private
         */
        _sanitizeShaderParams(shaderConfig, NewShaderClass) {
            const params = shaderConfig && shaderConfig.params;
            if (!params || typeof params !== "object") {
                return;
            }

            const controlNames = new Set(Object.keys(NewShaderClass.defaultControls || {}));

            let sources = [];
            try {
                sources = NewShaderClass.sources() || [];
            } catch (e) {
                sources = [];
            }

            for (const key of Object.keys(params)) {
                // Keep any use_* key (filters, mode, blend, per-source channel, future additions).
                // Keep keys that match a control on the new shader.
                if (!key.startsWith("use_") && !controlNames.has(key)) {
                    delete params[key];
                    continue;
                }
                // For per-source channel strings, drop if the new source can't accept the length —
                // letting the constructor regenerate a default beats parseChannel greedy-padding.
                const channelMatch = /^use_channel(\d+)$/.exec(key);
                if (!channelMatch) {
                    continue;
                }
                const source = sources[parseInt(channelMatch[1], 10)];
                if (!source || typeof source.acceptsChannelCount !== "function") {
                    continue;
                }
                const value = params[key];
                if (typeof value !== "string") {
                    continue;
                }
                // Strip optional "N:" inline base-channel prefix (e.g. "7:r").
                const inline = /^(\d+):(.*)$/.exec(value);
                const channel = inline ? inline[2] : value;
                if (!source.acceptsChannelCount(channel.length)) {
                    delete params[key];
                }
            }

            if (typeof NewShaderClass.normalizeConfig === "function") {
                NewShaderClass.normalizeConfig(shaderConfig, {});
            }
        }

        /**
         *
         * @param order
         */
        setShaderLayerOrder(order) {
            if (!order) {
                this._shadersOrder = null;
                return;
            }
            const sanitized = order.map($.FlexRenderer.sanitizeKey);
            const seen = new Set();
            const deduped = [];
            for (const key of sanitized) {
                if (seen.has(key)) {
                    $.console.warn(`setShaderLayerOrder: duplicate shader key '${key}' ignored (would cause GLSL redefinition).`);
                    continue;
                }
                seen.add(key);
                deduped.push(key);
            }
            this._shadersOrder = deduped;
        }

        /**
         *
         * Retrieve the order
         * @return {*}
         */
        getShaderLayerOrder() {
            return this._shadersOrder || Object.keys(this._shaders);
        }

        forEachShaderLayer(shaderMap = this._shaders, shaderOrder = this.getShaderLayerOrder(), callback, parentShader = null, depth = 0) {
            if (!shaderMap || !shaderOrder || !callback) {
                return;
            }

            for (const shaderId of shaderOrder) {
                const shader = shaderMap[shaderId];
                if (!shader) {
                    continue;
                }

                callback(shader, shaderId, parentShader, depth);

                if (shader.constructor.type() === "group" && shader.shaderLayers && shader.shaderLayerOrder) {
                    this.forEachShaderLayer(shader.shaderLayers, shader.shaderLayerOrder, callback, shader, depth + 1);
                }
            }
        }

        getFlatShaderLayers(shaderMap = this._shaders, shaderOrder = this.getShaderLayerOrder()) {
            const flat = [];

            this.forEachShaderLayer(shaderMap, shaderOrder, shader => {
                flat.push(shader);
            });

            return flat;
        }

        forEachShaderLayerWithContext(
            shaderMap = this._shaders,
            shaderOrder = this.getShaderLayerOrder(),
            callback,
            parentContext = null
        ) {
            if (!shaderMap || !shaderOrder || !callback) {
                return;
            }

            const depth = parentContext ? parentContext.depth + 1 : 0;

            for (let index = 0; index < shaderOrder.length; index++) {
                const shaderId = shaderOrder[index];
                const shaderLayer = shaderMap[shaderId];
                if (!shaderLayer) {
                    continue;
                }

                const shaderConfig = shaderLayer.__shaderConfig || shaderLayer.getConfig();
                const path = parentContext ? parentContext.path.concat([shaderId]) : [shaderId];
                const hasChildren = !!(
                    shaderLayer.constructor.type() === "group" &&
                    shaderLayer.shaderLayers &&
                    shaderLayer.shaderLayerOrder &&
                    shaderLayer.shaderLayerOrder.length
                );

                const htmlContext = {
                    depth: depth,
                    index: index,
                    path: path,
                    pathString: path.join("/"),
                    isGroupChild: !!parentContext,
                    parentShader: parentContext ? parentContext.shaderLayer : null,
                    parentConfig: parentContext ? parentContext.shaderConfig : null,
                    parentShaderId: parentContext ? parentContext.shaderId : null,
                    hasChildren: hasChildren,
                };

                callback(shaderLayer, shaderId, shaderConfig, htmlContext);

                if (hasChildren) {
                    this.forEachShaderLayerWithContext(
                        shaderLayer.shaderLayers,
                        shaderLayer.shaderLayerOrder,
                        callback,
                        {
                            depth: depth,
                            path: path,
                            shaderLayer: shaderLayer,
                            shaderConfig: shaderConfig,
                            shaderId: shaderId,
                        }
                    );
                }
            }
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
         * Recreate an existing shader layer while preserving its bound config object
         * and current order. This is needed when the set of owned controls changes.
         * @param {string} id
         * @param {object} options
         * @param {boolean} [options.rebuildProgram=true]
         * @returns {ShaderLayer|null}
         */
        refreshShaderLayer(id, options = {}) {
            id = $.FlexRenderer.sanitizeKey(id);
            const shader = this._shaders[id];
            if (!shader) {
                return null;
            }

            const config = shader.getConfig();
            const rebuiltShader = this.createShaderLayer(id, config, false);
            const shouldRebuild = options.rebuildProgram !== false;

            if (shouldRebuild) {
                this.registerProgram(null, this.webglContext.secondPassProgramKey);
            }

            return rebuiltShader;
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

        /**
         * Build a stable JSON-safe snapshot of the current visualization state.
         * Includes shader order and full shader configs, including params and cache.
         * Runtime/private fields are filtered out using FlexRenderer.jsonReplacer.
         *
         * @returns {{
         *   order: string[],
         *   shaders: Object<string, ShaderConfig>
         * }}
         */
        getVisualizationSnapshot() {
            const snapshot = {
                order: this.getShaderLayerOrder().slice(),
                shaders: {}
            };

            for (const [shaderId, shader] of Object.entries(this.getAllShaders())) {
                snapshot.shaders[shaderId] = JSON.parse(
                    JSON.stringify(shader.getConfig(), $.FlexRenderer.jsonReplacer)
                );
            }

            return snapshot;
        }

        /**
         * Alias that makes intent explicit when used by application code.
         * @returns {{order: string[], shaders: Object<string, ShaderConfig>}}
         */
        exportVisualization() {
            return this.getVisualizationSnapshot();
        }

        /**
         * Notify observers that visualization state changed.
         * This is the canonical event to listen to.
         *
         * @param {object} payload
         */
        notifyVisualizationChanged(payload = {}) {
            this.raiseEvent('visualization-change', $.extend(true, {
                snapshot: this.getVisualizationSnapshot()
            }, payload));
        }

        /**
         * Normalize inspector state to the canonical backend-agnostic shape.
         *
         * Backends must consume this logical state, not an implementation-specific variant.
         * The values are defined in canvas pixel space so WebGL, WebGPU, or CPU implementations
         * can produce the same visual result.
         *
         * @param {Partial<InspectorState>|undefined} state
         * @return {InspectorState}
         */
        static normalizeInspectorState(state = undefined) {
            const defaults = {
                enabled: false,
                mode: "reveal-inside",
                centerPx: { x: 0, y: 0 },
                radiusPx: 96,
                featherPx: 16,
                lensZoom: 2,
                shaderSplitIndex: 0,
            };

            if (!state || typeof state !== "object") {
                return $.extend(true, {}, defaults);
            }

            const normalized = $.extend(true, {}, defaults, state);
            const allowedModes = ["reveal-inside", "reveal-outside", "lens-zoom"];

            if (!allowedModes.includes(normalized.mode)) {
                normalized.mode = defaults.mode;
            }
            normalized.enabled = !!normalized.enabled;
            normalized.radiusPx = Math.max(0, Number(normalized.radiusPx) || 0);
            normalized.featherPx = Math.max(0, Number(normalized.featherPx) || 0);
            normalized.lensZoom = Math.max(1, Number(normalized.lensZoom) || 1);
            normalized.shaderSplitIndex = Math.max(0, Math.floor(Number(normalized.shaderSplitIndex) || 0));

            const center = normalized.centerPx || {};
            normalized.centerPx = {
                x: Number(center.x) || 0,
                y: Number(center.y) || 0,
            };

            return normalized;
        }

        /**
         * Update the canonical inspector state stored by the renderer.
         *
         * This method is the public write API for all backends. It does not perform rendering
         * itself; it stores normalized state, emits `inspector-change`, and optionally triggers
         * a redraw so the active backend can consume the new state during the next second pass.
         *
         * @param {Partial<InspectorState>|undefined} state
         * @param {InspectorStateUpdateOptions} [options={}]
         * @return {InspectorState}
         */
        setInspectorState(state = undefined, options = {}) {
            const previous = this.getInspectorState();
            this._inspectorState = this.constructor.normalizeInspectorState(state);

            if (options.notify !== false) {
                this.raiseEvent('inspector-change', {
                    previous: previous,
                    current: this.getInspectorState(),
                    reason: options.reason || 'set-inspector-state'
                });
            }

            if (options.redraw !== false && typeof this.redrawCallback === 'function') {
                this.redrawCallback();
            }

            return this.getInspectorState();
        }

        /**
         * Return a defensive copy of the current canonical inspector state.
         * Backends should read inspector state through this method instead of caching mutable references.
         *
         * @return {InspectorState}
         */
        getInspectorState() {
            return $.extend(true, {}, this._inspectorState || this.constructor.normalizeInspectorState());
        }

        /**
         * Reset the inspector to the normalized disabled state.
         *
         * @param {InspectorStateUpdateOptions} [options={}]
         * @return {InspectorState}
         */
        clearInspectorState(options = {}) {
            return this.setInspectorState(undefined, $.extend(true, {
                reason: 'clear-inspector-state'
            }, options));
        }

        /**
         * Reuse the current first-pass result and render the second pass into an offscreen target.
         *
         * This is the public contract used by features that need a texture copy of the composed
         * second pass. The renderer delegates the target management details to the active backend.
         *
         * @param {SPRenderPackage[]} renderArray
         * @param {SecondPassTextureOptions} [options={}]
         * @return {Object}
         */
        renderSecondPassToTexture(renderArray, options = {}) {
            if (!this.webglContext || typeof this.webglContext.renderSecondPassToTexture !== 'function') {
                throw new Error('Active WebGL implementation does not support second-pass texture targets.');
            }
            return this.webglContext.renderSecondPassToTexture(renderArray, options);
        }

        destroy() {
            this.htmlReset();
            this.deleteShaders();
            for (let pId in this._programImplementations) {
                this.deleteProgram(pId);
            }
            if (this._extractionFB) {
                this.gl.deleteFramebuffer(this._extractionFB);
                this._extractionFB = null;
            }
            if (this._debugPreviewFB) {
                this.gl.deleteFramebuffer(this._debugPreviewFB);
                this._debugPreviewFB = null;
            }
            if (this._debugPreviewColorRB) {
                this.gl.deleteRenderbuffer(this._debugPreviewColorRB);
                this._debugPreviewColorRB = null;
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

        static _buildSelfTestColorData(width, height, rgba) {
            const out = new Uint8Array(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                const offset = i * 4;
                out[offset] = rgba[0];
                out[offset + 1] = rgba[1];
                out[offset + 2] = rgba[2];
                out[offset + 3] = rgba[3];
            }
            return out;
        }

        static _createSelfTestTextureArray(gl, width, height, depth, pixels, internalFormat = null) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internalFormat || gl.RGBA8, width, height, depth);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, depth, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
            return texture;
        }

        static runSelfTest({
            width = 2,
            height = 2,
            tolerance = 8,
            webGLPreferredVersion = "2.0",
            debug = false,
        } = {}) {
            let renderer = null;
            let colorTexture = null;
            let stencilTexture = null;
            const testedAt = Date.now();
            const expected = [67, 255, 100, 255];

            try {
                // TODO! instantiated test could be later used to run rendering itself, i.e. drawer.supports() consumes the instance
                renderer = new $.FlexRenderer({
                    uniqueId: "selftest_renderer",
                    webGLPreferredVersion,
                    redrawCallback: () => {},
                    refetchCallback: () => {},
                    debug: !!debug,
                    interactive: false,
                    backgroundColor: '#00000000',
                    canvasOptions: {
                        stencil: true
                    }
                });

                const shaderId = 'selftest_layer';
                renderer.createShaderLayer(shaderId, {
                    id: shaderId,
                    name: 'Self test',
                    type: 'identity',
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                }, true);
                renderer.setShaderLayerOrder([shaderId]);
                renderer.setDimensions(0, 0, width, height, 1, 1);
                renderer.registerProgram(null, renderer.webglContext.secondPassProgramKey);

                const gl = renderer.gl;
                const colorPixels = $.FlexRenderer._buildSelfTestColorData(width, height, expected);
                const stencilPixels = $.FlexRenderer._buildSelfTestColorData(width, height, [255, 0, 0, 255]);
                colorTexture = $.FlexRenderer._createSelfTestTextureArray(gl, width, height, 1, colorPixels);
                stencilTexture = $.FlexRenderer._createSelfTestTextureArray(gl, width, height, 1, stencilPixels);

                renderer.__firstPassResult = {
                    texture: colorTexture,
                    stencil: stencilTexture,
                    textureDepth: 1,
                    stencilDepth: 1,
                };

                renderer.secondPassProcessData([{
                    zoom: 1,
                    pixelSize: 1,
                    opacity: 1,
                    shader: renderer.getShaderLayer(shaderId),
                }]);
                gl.finish();
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                const pixels = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                for (let i = 0; i < width * height; i++) {
                    const offset = i * 4;
                    for (let c = 0; c < 4; c++) {
                        if (Math.abs(pixels[offset + c] - expected[c]) > tolerance) {
                            throw new Error(
                                `Renderer self-test pixel mismatch at index ${i}: expected [${expected.join(', ')}], got [${Array.from(pixels.slice(offset, offset + 4)).join(', ')}].`
                            );
                        }
                    }
                }

                return {
                    ok: true,
                    testedAt,
                    width,
                    height,
                    tolerance,
                    webGLPreferredVersion,
                    webglVersion: renderer.webglVersion,
                };
            } catch (error) {
                return {
                    ok: false,
                    testedAt,
                    width,
                    height,
                    tolerance,
                    webGLPreferredVersion,
                    error: error && error.message ? error.message : String(error),
                };
            } finally {
                if (renderer && renderer.gl) {
                    const gl = renderer.gl;
                    if (colorTexture) {
                        gl.deleteTexture(colorTexture);
                    }
                    if (stencilTexture) {
                        gl.deleteTexture(stencilTexture);
                    }
                }
                if (renderer) {
                    try {
                        renderer.destroy();
                    } catch (e) {
                        $.console.warn('FlexRenderer self-test cleanup failed.', e);
                    }
                }
            }
        }

        static ensureRuntimeSupport(options = {}) {
            const useCache = options.force !== true;
            if (useCache && $.FlexRenderer.__runtimeSupportCache) {
                const cached = $.FlexRenderer.__runtimeSupportCache;
                if (!cached.ok && options.throwOnFailure !== false) {
                    throw new Error(cached.error || 'FlexRenderer runtime support test failed.');
                }
                return cached;
            }

            const result = $.FlexRenderer.runSelfTest(options);
            $.FlexRenderer.__runtimeSupportCache = result;
            if (!result.ok && options.throwOnFailure !== false) {
                throw new Error(result.error || 'FlexRenderer runtime support test failed.');
            }
            return result;
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
        copyRenderOutputToContext(
            dst,
            renderOutput = undefined,
            {
                level = 0,
                format = null,
                type = null,
                internalFormatGuess = null,
            } = {}
        ) {
            renderOutput = renderOutput || this.__firstPassResult;
            const out = {};
            if (!renderOutput) {
                dst.__firstPassResult = out;
                return out;
            }

            const sameContext = dst.gl === this.gl;

            if (renderOutput.texture) {
                // Reuse existing dst texture only if we know it's from the same context.
                const prevDstTex =
                    sameContext && dst.__firstPassResult && dst.__firstPassResult.texture ?
                        dst.__firstPassResult.texture : null;

                out.texture = this._copyTexture2DArrayBetweenContexts({
                    srcGL: this.gl,
                    dstGL: dst.gl,
                    srcTex: renderOutput.texture,
                    dstTex: prevDstTex,
                    textureLayerCount: renderOutput.textureDepth,
                    level,
                    format,
                    type,
                    internalFormatGuess,
                });
            }

            if (renderOutput.stencil) {
                const prevDstStencil =
                    sameContext && dst.__firstPassResult && dst.__firstPassResult.stencil ?
                        dst.__firstPassResult.stencil : null;

                out.stencil = this._copyTexture2DArrayBetweenContexts({
                    srcGL: this.gl,
                    dstGL: dst.gl,
                    srcTex: renderOutput.stencil,
                    dstTex: prevDstStencil,
                    textureLayerCount: renderOutput.stencilDepth,
                    level,
                    format,
                    type,
                    internalFormatGuess,
                });
            }

            out.textureDepth = renderOutput.textureDepth || 0;
            out.stencilDepth = renderOutput.stencilDepth || 0;
            dst.__firstPassResult = out;
            return out;
        }

        /**
         * Copy a TEXTURE_2D_ARRAY from one WebGL2 context to another.
         *
         * - If srcGL === dstGL: GPU-only copy via framebuffer + copyTexSubImage3D.
         * - If srcGL !== dstGL: readPixels -> texSubImage3D CPU round-trip.
         *
         * Creates the destination texture if not provided.
         *
         * @param {Object} opts
         * @param {WebGL2RenderingContext} opts.srcGL
         * @param {WebGL2RenderingContext} opts.dstGL
         * @param {WebGLTexture} opts.srcTex           - source TEXTURE_2D_ARRAY
         * @param {WebGLTexture?} [opts.dstTex]        - destination TEXTURE_2D_ARRAY (created if omitted)
         * @param {number} opts.textureLayerCount      - number of array layers
         * @param {number} [opts.level=0]              - mip level to copy
         * @param {number} [opts.width]                - texture width; falls back to canvas/drawingBuffer if omitted
         * @param {number} [opts.height]               - texture height; falls back to canvas/drawingBuffer if omitted
         * @param {GLenum} [opts.format=srcGL.RGBA]    - pixel format for read/upload
         * @param {GLenum} [opts.type=srcGL.UNSIGNED_BYTE]  - pixel type for read/upload
         * @param {GLenum} [opts.internalFormatGuess]  - sized internal format for dst allocation
         * @returns {WebGLTexture} dstTex
         */
        _copyTexture2DArrayBetweenContexts({
                                               srcGL,
                                               dstGL,
                                               srcTex,
                                               dstTex = null,
                                               textureLayerCount,
                                               level = 0,
                                               width = null,
                                               height = null,
                                               format = null,
                                               type = null,
                                               internalFormatGuess = null,
                                           }) {
            // Feature-detect WebGL2 instead of relying on instanceof
            const isGL2 = srcGL && typeof srcGL.texStorage3D === "function";
            const isDstGL2 = dstGL && typeof dstGL.texStorage3D === "function";
            if (!isGL2 || !isDstGL2) {
                throw new Error("WebGL2 contexts required (texture arrays + tex(Sub)Image3D).");
            }

            const sameContext = srcGL === dstGL;

            // ---------- Determine texture dimensions ----------
            srcGL.bindTexture(srcGL.TEXTURE_2D_ARRAY, srcTex);

            if (format === null) {
                format = srcGL.RGBA;
            }
            if (type === null) {
                type = srcGL.UNSIGNED_BYTE;
            }

            // Use provided width/height, or fall back to drawingBuffer/canvas
            if (!width || !height) {
                // try drawingBufferSize first (more correct for FBOs)
                width =
                    width ||
                    srcGL.drawingBufferWidth ||
                    (this.canvas && this.canvas.width) ||
                    0;
                height =
                    height ||
                    srcGL.drawingBufferHeight ||
                    (this.canvas && this.canvas.height) ||
                    0;
            }

            const depth = textureLayerCount | 0;

            if (!width || !height || !depth) {
                throw new Error(
                    "Source texture has no width/height/layers (missing width/height/textureLayerCount)."
                );
            }

            // ---------- Create + allocate destination texture if needed ----------
            if (!dstTex) {
                dstTex = dstGL.createTexture();
            }
            dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstTex);

            if (!internalFormatGuess) {
                if (type === srcGL.FLOAT) {
                    internalFormatGuess = dstGL.RGBA32F; // requires appropriate extensions
                } else {
                    internalFormatGuess = dstGL.RGBA8;
                }
            }

            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_MIN_FILTER, dstGL.NEAREST);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_MAG_FILTER, dstGL.NEAREST);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_WRAP_S, dstGL.CLAMP_TO_EDGE);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_WRAP_T, dstGL.CLAMP_TO_EDGE);

            dstGL.texStorage3D(
                dstGL.TEXTURE_2D_ARRAY,
                1, // levels
                internalFormatGuess,
                width,
                height,
                depth
            );

            // ---------- Copy per-layer ----------
            const fb = srcGL.createFramebuffer();
            srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, fb);

            if (sameContext) {
                // GPU-only path
                for (let z = 0; z < depth; z++) {
                    srcGL.framebufferTextureLayer(
                        srcGL.FRAMEBUFFER,
                        srcGL.COLOR_ATTACHMENT0,
                        srcTex,
                        level,
                        z
                    );
                    const status = srcGL.checkFramebufferStatus(srcGL.FRAMEBUFFER);
                    if (status !== srcGL.FRAMEBUFFER_COMPLETE) {
                        srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
                        srcGL.deleteFramebuffer(fb);
                        throw new Error(
                            `Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`
                        );
                    }

                    srcGL.copyTexSubImage3D(
                        srcGL.TEXTURE_2D_ARRAY,
                        level,
                        0, 0, z,    // dst x,y,z
                        0, 0,       // src x,y
                        width,
                        height
                    );
                }
            } else {
                // Cross-context path: CPU readPixels -> texSubImage3D
                const bytesPerChannel = type === srcGL.FLOAT ? 4 : 1;
                const layerByteLen = width * height * 4 * bytesPerChannel;
                const layerBuf =
                    type === srcGL.FLOAT ?
                        new Float32Array(layerByteLen / 4) : new Uint8Array(layerByteLen);

                for (let z = 0; z < depth; z++) {
                    srcGL.framebufferTextureLayer(
                        srcGL.FRAMEBUFFER,
                        srcGL.COLOR_ATTACHMENT0,
                        srcTex,
                        level,
                        z
                    );
                    const status = srcGL.checkFramebufferStatus(srcGL.FRAMEBUFFER);
                    if (status !== srcGL.FRAMEBUFFER_COMPLETE) {
                        srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
                        srcGL.deleteFramebuffer(fb);
                        throw new Error(
                            `Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`
                        );
                    }

                    srcGL.readPixels(0, 0, width, height, format, type, layerBuf);
                    dstGL.texSubImage3D(
                        dstGL.TEXTURE_2D_ARRAY,
                        level,
                        0, 0, z,
                        width,
                        height,
                        1,
                        format,
                        type,
                        layerBuf
                    );
                }
            }

            srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
            srcGL.deleteFramebuffer(fb);

            return dstTex;
        }

        _showOffscreenMatrix(renderOutput, {
            scale = 1,
            pad = 8,
            drawLabels = true,
            background = '#111',
            maxCellSize = 160
        } = {}) {
            const colorLayers = renderOutput.textureDepth || 0;
            const stencilLayers = renderOutput.stencilDepth || 0;

            const packLayout = (this.__flexPackInfo && this.__flexPackInfo.layout) || {};
            const baseLayer = Array.isArray(packLayout.baseLayer) ? packLayout.baseLayer : [];
            const packCount = Array.isArray(packLayout.packCount) ? packLayout.packCount : [];

            const tiCount = Math.max(stencilLayers, baseLayer.length);
            const rawRows = Math.max(colorLayers, stencilLayers);
            const mappedRows = tiCount;

            const width = Math.max(1, Math.floor(this.canvas.width));
            const height = Math.max(1, Math.floor(this.canvas.height));
            const scaledCellW = Math.max(1, Math.floor(width * scale));
            const scaledCellH = Math.max(1, Math.floor(height * scale));
            const cellScale = Math.min(1, maxCellSize / Math.max(scaledCellW, scaledCellH));
            const cellW = Math.max(1, Math.floor(scaledCellW * cellScale));
            const cellH = Math.max(1, Math.floor(scaledCellH * cellScale));

            const sectionGap = 28;
            const headerH = drawLabels ? 18 : 0;

            // 2 columns for raw section, 2 columns for TI-mapped section
            const cols = 4;
            const totalW = pad + cols * (cellW + pad);
            const totalH =
                pad +
                headerH +
                rawRows * (cellH + pad) +
                sectionGap +
                headerH +
                mappedRows * (cellH + pad);

            const dbg = this._openDebugWindowFromUserGesture(
                totalW,
                totalH,
                'Offscreen Layers (Raw + TiledImage Mapping)'
            );
            if (!dbg) {
                console.warn('Could not open debug window');
                return;
            }

            const gl = this.gl;
            const isGL2 = (gl instanceof WebGL2RenderingContext) || this.webGLVersion === "2.0";

            const ctx = dbg.__debugCtx;
            if (!this._debugStage) {
                this._debugStage = document.createElement('canvas');
            }
            const stage = this._debugStage;
            stage.width = cellW;
            stage.height = cellH;
            const stageCtx = stage.getContext('2d', { willReadFrequently: true });

            const outputCanvas = ctx.canvas;
            if (outputCanvas.width !== totalW || outputCanvas.height !== totalH) {
                outputCanvas.width = totalW;
                outputCanvas.height = totalH;
            }
            ctx.clearRect(0, 0, totalW, totalH);
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.imageSmoothingEnabled = false;

            let pixels = this._readbackBuffer;
            if (!pixels || pixels.length !== cellW * cellH * 4) {
                pixels = this._readbackBuffer = new Uint8ClampedArray(cellW * cellH * 4);
            }

            if (!this._imageData || this._imageData.width !== cellW || this._imageData.height !== cellH) {
                this._imageData = new ImageData(cellW, cellH);
            }
            const imageData = this._imageData;

            // Ensure we have a framebuffer to attach sources to
            if (!this._extractionFB) {
                this._extractionFB = gl.createFramebuffer();
            }
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._extractionFB);

            if (!this._debugPreviewFB) {
                this._debugPreviewFB = gl.createFramebuffer();
            }
            if (!this._debugPreviewColorRB) {
                this._debugPreviewColorRB = gl.createRenderbuffer();
            }

            gl.bindRenderbuffer(gl.RENDERBUFFER, this._debugPreviewColorRB);
            if (this._debugPreviewSizeW !== cellW || this._debugPreviewSizeH !== cellH) {
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, cellW, cellH);
                this._debugPreviewSizeW = cellW;
                this._debugPreviewSizeH = cellH;
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._debugPreviewFB);
            gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this._debugPreviewColorRB);
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);

            // Small helpers to attach a layer/texture
            const attachLayer = (texArray, layerIndex) => {
                // WebGL2 texture array
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._extractionFB);
                gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, 0, layerIndex);
            };

            const drawEmptyCell = (x, y, text = '—') => {
                ctx.fillStyle = '#000';
                ctx.fillRect(x, y, cellW, cellH);
                ctx.strokeStyle = '#333';
                ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

                ctx.fillStyle = '#666';
                ctx.font = '12px system-ui';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText(text, x + cellW / 2, y + cellH / 2);
                ctx.textAlign = 'start';
            };

            const drawLayerCell = (texArray, layerIndex, x, y, kind) => {
                if (!isGL2 || !texArray || layerIndex < 0) {
                    drawEmptyCell(x, y, 'n/a');
                    return;
                }

                attachLayer(texArray, layerIndex);

                if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error(`Framebuffer incomplete for ${kind} layer`, layerIndex);
                    drawEmptyCell(x, y, 'fb err');
                    return;
                }

                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._debugPreviewFB);
                if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error(`Preview framebuffer incomplete for ${kind} layer`, layerIndex);
                    drawEmptyCell(x, y, 'fb err');
                    return;
                }

                gl.blitFramebuffer(
                    0, 0, width, height,
                    0, 0, cellW, cellH,
                    gl.COLOR_BUFFER_BIT,
                    gl.NEAREST
                );

                gl.bindFramebuffer(gl.FRAMEBUFFER, this._debugPreviewFB);
                gl.readPixels(0, 0, cellW, cellH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                imageData.data.set(pixels);
                stageCtx.putImageData(imageData, 0, 0);
                ctx.drawImage(stage, x, y, cellW, cellH);
            };

            const rawHeaderY = pad;
            const rawY0 = rawHeaderY + headerH;
            const mappedHeaderY = rawY0 + rawRows * (cellH + pad) + sectionGap;
            const mappedY0 = mappedHeaderY + headerH;

            const xRawTex = pad;
            const xRawStencil = pad + (cellW + pad);
            const xTiColor = pad + 2 * (cellW + pad);
            const xTiStencil = pad + 3 * (cellW + pad);

            if (drawLabels) {
                ctx.fillStyle = '#ddd';
                ctx.font = '12px system-ui';
                ctx.textBaseline = 'top';

                ctx.fillText('Raw texture layers', xRawTex, rawHeaderY);
                ctx.fillText('Raw stencil layers', xRawStencil, rawHeaderY);
                ctx.fillText('TI mapped color', xTiColor, mappedHeaderY);
                ctx.fillText('TI stencil', xTiStencil, mappedHeaderY);
            }

            // --- RAW PHYSICAL LAYERS ---
            for (let i = 0; i < rawRows; i++) {
                const y = rawY0 + i * (cellH + pad);

                if (i < colorLayers) {
                    drawLayerCell(renderOutput.texture, i, xRawTex, y, 'raw-texture');
                } else {
                    drawEmptyCell(xRawTex, y);
                }

                if (i < stencilLayers) {
                    drawLayerCell(renderOutput.stencil, i, xRawStencil, y, 'raw-stencil');
                } else {
                    drawEmptyCell(xRawStencil, y);
                }

                if (drawLabels) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = '12px system-ui';
                    ctx.textBaseline = 'top';
                    ctx.fillText(`#${i}`, xRawTex, y - 14);
                }
            }

            // --- LOGICAL TILED-IMAGE MAPPING ---
            for (let ti = 0; ti < mappedRows; ti++) {
                const y = mappedY0 + ti * (cellH + pad);

                const mappedColorLayer =
                    typeof baseLayer[ti] === 'number' ? baseLayer[ti] : ti;
                const mappedPackCount =
                    typeof packCount[ti] === 'number' ? packCount[ti] : 1;

                if (mappedColorLayer >= 0 && mappedColorLayer < colorLayers) {
                    drawLayerCell(renderOutput.texture, mappedColorLayer, xTiColor, y, 'ti-color');
                } else {
                    drawEmptyCell(xTiColor, y, 'unmapped');
                }

                if (ti < stencilLayers) {
                    drawLayerCell(renderOutput.stencil, ti, xTiStencil, y, 'ti-stencil');
                } else {
                    drawEmptyCell(xTiStencil, y, '—');
                }

                if (drawLabels) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = '12px system-ui';
                    ctx.textBaseline = 'top';
                    const label =
                        `TI #${ti} → tex L${mappedColorLayer}` +
                        (mappedPackCount > 1 ? ` (${mappedPackCount} packs)` : '');
                    ctx.fillText(label, xTiColor, y - 14);
                }
            }

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
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
    $.FlexRenderer.__runtimeSupportCache = null;

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
         * @param {Function} privateOptions.refresh     // callback to recreate the ShaderLayer when control layout changes
         * @param {Function} privateOptions.refetch     // callback to request source/config refetch work from the owning drawer
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
            this._refresh = privateOptions.refresh;
            this._refetch = privateOptions.refetch;
            this._controls = {};

            // channels used for sampling data from the texture
            this.__channels = null;
            // channel offset
            this.__baseChannels = null;

            // which blend mode is being used
            this._mode = null;
            // parameters used for applying filters
            this.__scalePrefix = null;
            this.__scaleSuffix = null;
        }

        /**
         * Manual constructor for ShaderLayer. Kept for backward compatibility.
         */
        construct() {
            // Default init respects cached value, manual usage overrides.

            // set up the color channel(s) for texture sampling
            this.resetChannel(this._customControls, false, false);
            // set up the blending mode
            this.resetMode(this._customControls, false, false);
            // set up the filters to be applied to sampled data from the texture
            this.resetFilters(this._customControls, false, false);
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
         * Optional machine-readable documentation descriptor.
         * External shader registrations can override this as either:
         *  - static docs() { return {...}; }
         *  - static docs = {...}
         * @returns {object|null}
         */
        static docs() {
            return null;
        }

        /**
         * One-line guidance: when should a caller pick this shader?
         *
         * `description()` is technical (what the shader does); `intent()` is "when to use it".
         * Read by hosts (e.g. xOpat scripting / LLM driven layer construction) when picking
         * a shader for a given dataset. Keep it generic — no use-case-specific recipes.
         *
         * Override per shader; the default returns `undefined`, in which case hosts treat
         * "no info" as a safe fallback.
         *
         * @returns {String|undefined}
         */
        static intent() {
            return undefined;
        }

        /**
         * Data-shape hints. Tells the host whether this shader is appropriate for the
         * source the user has loaded. Hosts match the returned `expects` against source
         * metadata (e.g. channel count) to filter candidate shaders.
         *
         * Shape:
         * {
         *   dataKind: "scalar" | "multi-channel" | "rgb" | "mask" | "any",
         *   channels?: number | "any",   // expected source channel count
         *   requiresThreshold?: boolean  // true when behavior depends on threshold breaks
         * }
         *
         * Override per shader; the default returns `undefined`.
         *
         * @returns {{dataKind?: string, channels?: number|string, requiresThreshold?: boolean}|undefined}
         */
        static expects() {
            return undefined;
        }

        /**
         * A minimal valid `params` object for a fresh layer of this shader. Hosts use it
         * when building a "create from scratch" template so they don't have to invent
         * values. Keep small — only controls that need a non-default value to render
         * something sensible. If the shader declares `controlCouplings`, the returned
         * object MUST satisfy them (it doubles as the canonical example).
         *
         * Override per shader; the default returns `undefined`.
         *
         * @returns {object|undefined}
         */
        static exampleParams() {
            return undefined;
        }

        /**
         * Declares relationships between controls that must hold true on every committed
         * layer. Hosts use the returned entries for two purposes:
         *  (a) tell the LLM the rule in plain English so it can construct compliant layers,
         *  (b) validate submitted layers and reject violations with structured errors.
         *
         * Each entry:
         * {
         *   name: string,                                  // stable id, e.g. "colormap_class_count"
         *   summary: string,                               // human-readable rule, shown to the LLM
         *   controls: string[],                            // control keys involved
         *   validate: (layer) => {                         // pure, fast, side-effect-free
         *     ok: boolean,
         *     expected?: Record<string, any>,              // what the coupling requires
         *     actual?: Record<string, any>                 // what the layer currently has
         *   }
         * }
         *
         * The `validate` function is exposed at runtime via
         * `ShaderConfigurator.getShaderCouplingValidators(shaderType)`; the schema model
         * only ships `{name, summary, controls}` (JSON-serializable).
         *
         * Override per shader when controls are coupled; the default returns `undefined`.
         * Returning `[]` is also accepted ("declared, but no couplings").
         *
         * @returns {Array<{name: string, summary: string, controls: string[], validate: Function}>|undefined}
         */
        static controlCouplings() {
            return undefined;
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
         * Repeated control arrays are also supported:
         * get defaultControls () => {
         *     items: {
         *         array: {
         *             count: (layer) => <number>,
         *             name: (index, layer, baseName) => <controlName>,   // OPTIONAL
         *             item: (index, layer, baseName) => ({
         *                 default: {...},
         *                 accepts: (type, instance) => <>
         *             })
         *         }
         *     }
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
         * @typedef {Object} NormalizationContext
         * @property {function} [expandDataSourceRef] - function that maps synthetic source references to real references usable by openseadragon
         */

        /**
         * Modification of the configuration object before it is used.
         * @param {ShaderConfig} config
         * @param {NormalizationContext} context
         * @returns {ShaderConfig}
         */
        static normalizeConfig(config, context = {}) {
            return config;
        }

        /**
         * Instance-level control definition hook.
         * Override when the available controls depend on current config/state.
         * @returns {object}
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.constructor.defaultControls);
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
            const defaultControls = this.getControlDefinitions();

            // add opacity control manually to every ShaderLayer; if not already defined
            if (defaultControls.opacity === undefined || (typeof defaultControls.opacity === "object" && !defaultControls.opacity.accepts("float"))) {
                defaultControls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity"},
                    accepts: (type, instance) => type === "float"
                };
            }

            const expandedControls = this._expandControlDefinitions(defaultControls);

            for (let controlName in expandedControls) {
                // with use_ prefix are defined not UI controls but filters, blend modes, etc.
                if (controlName.startsWith("use_")) {
                    continue;
                }

                // control is manually disabled
                const controlConfig = expandedControls[controlName];
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

        _expandControlDefinitions(controlDefinitions) {
            const expanded = {};

            for (const [baseName, controlConfig] of Object.entries(controlDefinitions || {})) {
                if (!controlConfig || typeof controlConfig !== "object" || !controlConfig.array) {
                    expanded[baseName] = controlConfig;
                    continue;
                }

                const arrayConfig = controlConfig.array;
                const countValue = typeof arrayConfig.count === "function" ?
                    arrayConfig.count(this, baseName) :
                    arrayConfig.count;
                const count = Math.max(0, Number.parseInt(countValue, 10) || 0);

                for (let index = 0; index < count; index++) {
                    const itemConfig = typeof arrayConfig.item === "function" ?
                        arrayConfig.item(index, this, baseName) :
                        $.extend(true, {}, arrayConfig.item || {});

                    if (!itemConfig || itemConfig === false) {
                        continue;
                    }

                    const expandedName = itemConfig.name || (
                        typeof arrayConfig.name === "function" ?
                            arrayConfig.name(index, this, baseName) :
                            `${baseName}${index}`
                    );

                    if (!expandedName) {
                        continue;
                    }

                    if (itemConfig.name !== undefined) {
                        delete itemConfig.name;
                    }

                    expanded[expandedName] = itemConfig;
                }
            }

            return expanded;
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
                if (container[key] === code) {
                    return;
                }
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
        resetChannel(options = {}, force = true, evented = true) {
            if (Object.keys(options) === 0) {
                options = this._customControls;
            }

            // regex to compare with value used with use_channel, to check its correctness
            const channelPattern = new RegExp('[rgba]{1,4}');
            this.__channels = [];
            this.__baseChannels = [];

            const parseChannel = (def, sourceDef, index) => {
                const controlName = `use_channel${index}`;
                const predefined = this.constructor.defaultControls[controlName];
                const baseName = `use_channel_base${index}`;
                const predefinedBase = this.constructor.defaultControls[baseName];

                let base = 0;
                let channel;

                // 1) read raw channel value from options or predefined
                if (options[controlName] || predefined) {
                    channel = predefined && predefined.required;
                    if (!channel) {
                        channel = force ? options[controlName] :
                            this.loadProperty(controlName, options[controlName] || predefined.default);
                    }
                }

                // 2) parse inline "N:pattern" syntax if used
                if (typeof channel === "string") {
                    const m = channel.match(/^(\d+):(.*)$/);
                    if (m) {
                        base = parseInt(m[1], 10) || 0;
                        channel = m[2];
                    }
                }

                // 3) explicit base override via use_channel_baseX
                if (options[baseName] || predefinedBase) {
                    base = predefinedBase && predefinedBase.required;
                    if (!base) {
                        base = force ? options[baseName] :
                            this.loadProperty(baseName, options[baseName] || predefinedBase.default);
                    }
                    base = parseInt(base, 10);
                }

                if (Number.isNaN(base) || base < 0) {
                    base = 0;
                }

                // 4) validate / normalize channel pattern as before
                if (!channel || typeof channel !== "string" || channelPattern.exec(channel) === null) {
                    console.warn(`Invalid channel '${controlName}'. Will use channel '${def}'.`, channel, options);
                    this.storeProperty(controlName, def);
                    channel = predefined && predefined.default ? predefined.default : def;
                }

                if (!sourceDef.acceptsChannelCount(channel.length)) {
                    console.warn(`${this.constructor.name()} does not support channel length ${channel.length} for channel: ${channel}. Using default.`);
                    this.storeProperty(controlName, def);
                    channel = predefined && predefined.default ? predefined.default : def;

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

                this.__channels[index] = channel;
                this.__baseChannels[index] = base;
            };

            const sources = this.constructor.sources();
            for (let i = 0; i < sources.length; i++) {
                parseChannel("r", sources[i], i);
            }

            if (evented) {
                this.webglContext.renderer.notifyVisualizationChanged({
                    reason: "channel-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type()
                });
            }
        }

        /**
         * Unified texture sampling helper.
         *
         * Usage:
         *   sampleChannel("v_texCoord")                      // sourceIndex=0, baseChannel=0
         *   sampleChannel("v_texCoord", 1)                   // sourceIndex=1, baseChannel=0
         *   sampleChannel("v_texCoord", { baseChannel: 4 })  // sourceIndex=0, baseChannel=4
         *   sampleChannel("v_texCoord", { baseChannel: "my_uniform" })  // sourceIndex=0, runtime GLSL expression
         *   sampleChannel("v_texCoord", 0, { baseChannel: 8, raw: true })
         *
         * Returns GLSL:
         *   float, vec2, vec3, or vec4 depending on use_channel pattern.
         */
        sampleChannel(textureCoords, sourceIndexOrOptions = 0, maybeOptions = undefined) {
            let sourceIndex = 0;
            let raw = false;

            let opt = null;

            if (typeof sourceIndexOrOptions === "object") {
                // sampleChannel(uv, { ... })
                opt = sourceIndexOrOptions || {};
                sourceIndex = opt.sourceIndex || 0;
            } else {
                // sampleChannel(uv, sourceIndex, maybeOptions/raw)
                sourceIndex = sourceIndexOrOptions || 0;

                if (typeof maybeOptions === "object") {
                    opt = maybeOptions || {};
                } else if (typeof maybeOptions === "boolean") {
                    raw = maybeOptions;
                }
            }

            // Default baseChannel from resetChannel
            let baseChannel = this.getDefaultChannelBase(sourceIndex);

            // Override from options if provided
            if (opt) {
                if (typeof opt.baseChannel === "number" || typeof opt.baseChannel === "string") {
                    baseChannel = opt.baseChannel;
                }
                if (opt.raw != null) { // eslint-disable-line eqeqeq
                    raw = !!opt.raw;
                }
            }

            const chanPattern = this.__channels[sourceIndex] || "r";
            const glslExpr = this._buildChannelSampleExpr(sourceIndex, textureCoords, baseChannel, chanPattern);

            return raw ? glslExpr : this.filter(glslExpr);
        }

        /**
         * Get number of channels for a given sourceIndex.
         * @param sourceIndex
         * @return {number|*|number}
         */
        getSourceChannelCount(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return 4;
            }
            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.webglContext.renderer.drawer;
            if (!drawer || worldIndex == null) {  // eslint-disable-line eqeqeq
                return 4;
            }
            return drawer.getChannelCount(worldIndex);
        }

        /**
         * Resolve the tiled image used by a given shader source slot.
         * @param {number} sourceIndex
         * @return {OpenSeadragon.TiledImage|null}
         */
        getSourceTiledImage(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return null;
            }

            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.webglContext.renderer.drawer;
            const world = drawer && drawer.viewer ? drawer.viewer.world : null;
            if (!world || worldIndex == null) {  // eslint-disable-line eqeqeq
                return null;
            }

            return world.getItemAt(worldIndex) || null;
        }

        /**
         * Get pack count for a given sourceIndex.
         * @param {number} sourceIndex
         * @return {number}
         */
        getSourcePackCount(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return 1;
            }
            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.webglContext.renderer.drawer;
            if (!drawer || worldIndex == null) {  // eslint-disable-line eqeqeq
                return 1;
            }
            return drawer.getPackCount(worldIndex);
        }

        /**
         * Get source dimensions when available from the tile source metadata.
         * @param {number} sourceIndex
         * @return {{width:number, height:number}}
         */
        getSourceDimensions(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            const dimensions = source && source.dimensions;

            return {
                width: dimensions && typeof dimensions.x === "number" ? dimensions.x : (source && source.width) || 0,
                height: dimensions && typeof dimensions.y === "number" ? dimensions.y : (source && source.height) || 0,
            };
        }

        /**
         * Get source level metadata.
         * @param {number} sourceIndex
         * @return {{minLevel:number, maxLevel:number, levelCount:number}}
         */
        getSourceLevels(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            const minLevel = Number.isInteger(source && source.minLevel) ? source.minLevel : 0;
            const maxLevel = Number.isInteger(source && source.maxLevel) ? source.maxLevel : minLevel;

            return {
                minLevel,
                maxLevel,
                levelCount: Math.max(0, maxLevel - minLevel + 1),
            };
        }

        /**
         * Get source metadata object from the tile source when available.
         * @param {number} sourceIndex
         * @return {object|null}
         */
        getSourceMetadata(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            if (!source) {
                return null;
            }

            if (typeof source.getMetadata === "function") {
                return source.getMetadata();
            }
            return source;
        }

        /**
         * Get consolidated source information for the given source slot.
         * metadataReady becomes true after the drawer has observed tile payload metadata
         * for this source, which matters for gpuTextureSet inputs where channel/pack counts
         * are only known after data arrives.
         *
         * @param {number} sourceIndex
         * @return {{
         *   tiledImage: OpenSeadragon.TiledImage|null,
         *   metadata: object|null,
         *   metadataReady: boolean,
         *   channelCount: number,
         *   packCount: number,
         *   dimensions: {width:number, height:number},
         *   minLevel: number,
         *   maxLevel: number,
         *   levelCount: number
         * }}
         */
        getSourceInfo(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const levels = this.getSourceLevels(sourceIndex);

            return {
                tiledImage,
                metadata: this.getSourceMetadata(sourceIndex),
                metadataReady: !!(tiledImage && tiledImage.__flexMetadataReady),
                channelCount: this.getSourceChannelCount(sourceIndex),
                packCount: this.getSourcePackCount(sourceIndex),
                dimensions: this.getSourceDimensions(sourceIndex),
                minLevel: levels.minLevel,
                maxLevel: levels.maxLevel,
                levelCount: levels.levelCount,
            };
        }

        /**
         * Get the default channel base offset for a given sourceIndex.
         * @param sourceIndex
         * @return {number} channel offset, usually 0, read from use_channel_baseX controls
         */
        getDefaultChannelBase(sourceIndex = 0) {
            let baseChannel = this.__baseChannels[sourceIndex];
            if (typeof baseChannel !== "number") {
                baseChannel = 0;
            }
            return baseChannel;
        }

        /**
         * Get how many logical channels the configured swizzle consumes for a source.
         * @param {number} sourceIndex
         * @return {number}
         */
        getConfiguredChannelWidth(sourceIndex = 0) {
            const pattern = this.__channels[sourceIndex];
            return typeof pattern === "string" && pattern.length > 0 ? pattern.length : 1;
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
        resetMode(options = {}, force = true, evented = true) {
            this._mode = this._resetOption("use_mode", this.webglContext.supportedUseModes, options, force);
            this._blend = this._resetOption("use_blend", OpenSeadragon.FlexRenderer.BLEND_MODE, options, force);

            if (evented) {
                this.webglContext.renderer.notifyVisualizationChanged({
                    reason: "mode-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type(),
                    mode: this._mode,
                    blend: this._blend
                });
            }
        }

        /**
         * Build GLSL that samples the requested components.
         * @param {number} sourceIndex   index into config.tiledImages
         * @param {string} uv            GLSL vec2 identifier
         * @param {number} baseChannel   first flattened channel index to use
         * @param {string} pattern       e.g. "r", "rg", "rgba", "bgra"
         */
        _buildChannelSampleExpr(sourceIndex, uv, baseChannel, pattern) {
            // pattern is relative channel order, we must convert "rgba" to offsets 0,1,2,3
            const offsets = [];
            for (const ch of pattern) {
                let off;
                if (ch === "r") {
                    off = 0;
                } else if (ch === "g") {
                    off = 1;
                } else if (ch === "b") {
                    off = 2;
                } else if (ch === "a") {
                    off = 3;
                } else {
                    continue;
                } // or warn
                offsets.push(off);
            }
            if (offsets.length === 0) {
                offsets.push(0);
            }

            // If this is the common simple case (baseChannel==0, contiguous, canonical "xyz"):
            const contiguous =
                typeof baseChannel === "number" &&
                baseChannel === 0 &&
                offsets.length <= 4 &&
                offsets.every((o, i) => o === i);

            if (contiguous) {
                // Use the old fast path: osd_texture + swizzle
                return `${this.webglContext.sampleTexture(sourceIndex, uv)}.${pattern}`;
            }

            // TODO: we should call here API of the underlying engine to get sampling method, not hardcoding it here!
            //       we should also rely on osd_channel_pack instead of calling X times osd_channel
            const baseExpr = typeof baseChannel === "string" ? `(${baseChannel})` : `${baseChannel}`;
            const comps = offsets.map(off => {
                const channelExpr = off === 0 ? baseExpr : `((${baseExpr}) + ${off})`;
                return `osd_channel(${sourceIndex}, ${channelExpr}, ${uv})`;
            });

            if (comps.length === 1) {
                return comps[0];
            }
            if (comps.length === 2) {
                return `vec2(${comps.join(", ")})`;
            }
            if (comps.length === 3) {
                return `vec3(${comps.join(", ")})`;
            }
            // 4 or more → vec4, extra components ignored
            return `vec4(${comps.slice(0, 4).join(", ")})`;
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
                this._blend = 'mask';
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

        /**
         * Request a config mutation that may require drawer/world level re-fetch or shader refresh.
         * The drawer owns how this request is fulfilled.
         * @param {Function|Object} mutation function(config, shaderLayer) or plain patch object
         * @param {Object} options
         * @return {*}
         */
        requestConfigMutation(mutation, options = {}) {
            if (typeof this._refetch !== "function") {
                return undefined;
            }

            let apply = mutation;
            if (mutation && typeof mutation === "object" && typeof mutation !== "function") {
                apply = (config) => Object.assign(config, mutation);
            }

            return this._refetch({
                kind: "shader-config-mutation",
                shaderId: this.id,
                shaderType: this.constructor.type(),
                mutation: apply,
                ...options
            });
        }

        /**
         * Request source rebinding for one shader source slot.
         * The entry can be a direct world index or any opaque descriptor
         * resolved later by the owning drawer/application.
         * @param {number} sourceIndex
         * @param {*} entry
         * @param {Object} options
         * @return {*}
         */
        requestSourceBinding(sourceIndex, entry, options = {}) {
            if (typeof this._refetch !== "function") {
                return undefined;
            }

            return this._refetch({
                kind: "shader-source-request",
                shaderId: this.id,
                shaderType: this.constructor.type(),
                sourceIndex,
                entry,
                ...options
            });
        }

        // FILTERS LOGIC
        /**
         * Set filters for a ShaderLayer.
         * @param {Object} options contains filters to apply, currently supported are "use_gamma", "use_exposure", "use_logscale"
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetFilters(options = {}, force = true, evented = true) {
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

            if (evented) {
                this.webglContext.renderer.notifyVisualizationChanged({
                    reason: "filter-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type()
                });
            }
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

        // merge dP < cP < rP recursively with rP having the biggest overwriting priority, without modifying the original objects.
        // When the user picks a different `type`, defaultParams is type-specific config from the layer that
        // describes the original control type — its keys (e.g. a string `default` palette name, mode-specific
        // hints, titles) are not transferable to a different control type and would corrupt the new control's
        // expected param shape. Drop defaultParams in that case and let the chosen control's own `supports`
        // fill in defaults via getParams(). requiredParams is layer-enforced and stays.
        const userType = customParams && customParams.type;
        const typeOverridden = userType && originalType && userType !== originalType;
        const params = typeOverridden
            ? $.extend(true, {}, customParams, requiredParams)
            : $.extend(true, {}, defaultParams, customParams, requiredParams);

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
        docs: object|function // optional machine-readable docs descriptor
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
            uiElement["type"] = type;
            this._items[type] = uiElement;
        }
    }

    /**
     * Register class as a UI control
     * @param {string} type unique control name / identifier
     *  The class may optionally expose machine-readable docs as either static docs() or static docs = {...}.
     * @param {OpenSeadragon.FlexRenderer.UIControls.IControl} cls to register, implementation class of the controls
     */
    static registerClass(type, cls) {
        //todo not really possible with syntax checker :/
        // if ($.FlexRenderer.UIControls.IControl.isPrototypeOf(cls)) {
        cls.prototype.getName = () => type;

        if (this._items[type]) {
            console.warn("Registering an already existing control component: ", type);
        }
        cls._type = type;
        this._impls[type] = cls;
        // } else {
        //     console.warn(`Skipping UI control '${type}': does not inherit from $.FlexRenderer.UIControls.IControl.`);
        // }
    }

    static joinClasses(...values) {
        return values.filter(value => typeof value === "string" && value.trim()).join(" ").trim();
    }

    static styleAttr(css = "") {
        return css && String(css).trim() ? ` style="${css}"` : "";
    }

    static renderTitle(title, type) {
        if (!title) {
            return "";
        }
        return `<span class="er-control__title er-control__title--${type}">${title}</span>`;
    }

    static renderControl(type, title, bodyHtml, classes = "", columns = undefined, extraAttrs = "") {
        const resolvedColumns = Number(columns) || (title ? 2 : 1);
        return `<div class="${this.joinClasses("er-control", `er-control--${type}`, classes)}" data-columns="${resolvedColumns}" ${extraAttrs}>${this.renderTitle(title, type)}<div class="er-control__body
  er-control__body--${type}">${bodyHtml}</div></div>`;
    }

    static renderInput(inputTag, type, uniqueId, attrs = "", css = "") {
        return `<${inputTag} id="${uniqueId}" class="er-control__input er-control__input--${type}"${attrs}${this.styleAttr(css)}>`;
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
            const input = `<input class="er-control__input er-control__input--number" min="${params.min}" max="${params.max}"
step="${params.step}" type="number" id="${uniqueId}"${$.FlexRenderer.UIControls.styleAttr(css)}>`;
            return $.FlexRenderer.UIControls.renderControl("number", params.title, input, classes, params.title ? 2 : 1);
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
        type: "number",
        docs: {
            summary: "Numeric float input control.",
            description: "Renders an HTML number input, decodes to float, normalizes values into the configured min/max range, and exposes a float GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number" },
                { name: "min", type: "number" },
                { name: "max", type: "number" },
                { name: "step", type: "number" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "float"
        }
    },

    range: {
        defaults: function() {
            return {title: "Range", interactive: true, default: 0, min: 0, max: 100, step: 1};
        },
        html: function(uniqueId, params, classes = "", css = "") {
            const input = `<input type="range" class="er-control__input er-control__input--range" min="${params.min}" max="${params.max}" step="${params.step}" id="${uniqueId}"${$.FlexRenderer.UIControls.styleAttr(css)}>`;
            return $.FlexRenderer.UIControls.renderControl("range", params.title, input, classes, params.title ? 2 : 1);
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
        type: "range",
        docs: {
            summary: "Slider control for float uniforms.",
            description: "Renders an HTML range input, decodes to float, normalizes values into the configured min/max range, and exposes a float GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number" },
                { name: "min", type: "number" },
                { name: "max", type: "number" },
                { name: "step", type: "number" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "float"
        }
    },

    color: {
        defaults: function() {
            return { title: "Color", interactive: true, default: "#fff900" };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            const input = `<input type="color" id="${uniqueId}" class="er-control__input er-control__input--color"${$.FlexRenderer.UIControls.styleAttr(css)}>`;
            return $.FlexRenderer.UIControls.renderControl("color", params.title, input, classes, params.title ? 2 : 1);
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
        type: "color",
        docs: {
            summary: "RGB color picker control.",
            description: "Renders an HTML color input, decodes a hex color string into three normalized float components, and exposes a vec3 GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "string" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "vec3"
        }
    },

    bool: {
        defaults: function() {
            return { title: "Checkbox", interactive: true, default: true };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let value = this.decode(params.default) ? "checked" : "";
            //note a bit dirty, but works :) - we want uniform access to 'value' property of all inputs
            const input = `<input type="checkbox" id="${uniqueId}" ${value}
class="er-control__input er-control__input--bool" onchange="this.value=this.checked; return true;"${$.FlexRenderer.UIControls.styleAttr(css)}>`;
            return $.FlexRenderer.UIControls.renderControl("bool", params.title, input, classes, params.title ? 2 : 1);
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
        type: "bool",
        docs: {
            summary: "Boolean toggle control.",
            description: "Renders an HTML checkbox, decodes the checked state into 0 or 1, and exposes a bool-compatible GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "boolean" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "bool"
        }
    },

    select: {
        defaults: function() {
            return {
                title: "Select",
                interactive: true,
                default: 1,
                // [{ value: 0, label: "Binary" }, ...] or {0:"Binary",1:"Binary inv"}
                options: [{ value: 0, label: "Off" }, { value: 1, label: "On" }]
            };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let options = [];
            if (Array.isArray(params.options)) {
                options = params.options.map(opt => {
                    if (typeof opt === "object") {
                        return {
                            value: Number.parseInt(opt.value, 10),
                            label: opt.label || String(opt.value)
                        };
                    }
                    const v = Number.parseInt(opt, 10);
                    return { value: v, label: String(opt) };
                });
            } else if (params.options && typeof params.options === "object") {
                options = Object.entries(params.options).map(([value, label]) => ({
                    value: Number.parseInt(value, 10),
                    label: String(label)
                }));
            }

            const optionHtml = options.map(opt => {
                const selected = Number.parseInt(params.default, 10) === opt.value ? " selected" : "";
                return `<option value="${opt.value}"${selected}>${opt.label}</option>`;
            }).join("");

            const input = `<select id="${uniqueId}" class="er-control__input er-control__input--select"${$.FlexRenderer.UIControls.styleAttr(css)}>${optionHtml}</select>`;
            return $.FlexRenderer.UIControls.renderControl("select", params.title, input, classes, params.title ? 2 : 1);
        },
        glUniformFunName: function() {
            return "uniform1i";
        },
        decode: function(fromValue) {
            const parsed = Number.parseInt(fromValue, 10);
            return Number.isNaN(parsed) ? 0 : parsed;
        },
        normalize: function(value, params) {
            return value;
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "int",
        type: "select_int",
        docs: {
            summary: "Integer select control.",
            description: "Renders an HTML select element, decodes the selected option value into an integer, and exposes an int GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number" },
                { name: "options", type: "array|object" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "int"
        }
    }
};

// Implementation of UI control classes, complex functionalities.
$.FlexRenderer.UIControls._impls = {
    // e.g.: colormap: $.FlexRenderer.UIControls.ColorMap
};

/**
 * @interface
 */
$.FlexRenderer.UIControls.IControl = class IControl {

    /**
     * Optional machine-readable documentation descriptor.
     * External control registrations can override this as either:
     *  - static docs() { return {...}; }
     *  - static docs = {...}
     * @returns {object|null}
     */
    static docs() {
        return null;
    }

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
     * Does not trigger canvas re-rednreing, must be done manually (e.g. control.owner.invalidate()).
     * You should raise the 'change' event when the value is changed.
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
     * Get how many columns UI requires. Usually 2 if title showing.
     * The general design is that UI control should be a ROW element,
     * and show:
     *  - 1 column if content control shown only
     *  - 2 columns if title shown, and content control shown
     *  - 3 columns if title shown, and two content elements shown side-by-side (two methods of controlling the parameter synchronized)
     * @return {number}
     */
    get layoutColumns() {
        return this.params && this.params.title ? 2 : 1;
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
        return this.constructor._type;
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
     * @param defaultValue value to return in case of no cached value, if undefined, it is fetched from supports()
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     * @return {*} cached or default value
     */
    load(defaultValue, paramName = "") {
        return this.owner.loadProperty(this.name + (paramName === "default" ? "" : paramName),
            defaultValue === undefined ? this.supports[paramName] : defaultValue,
        );
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
     * TODO: use openseadragon event system directly here too
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

        if (this._suppressVisualizationChanged) {
            return;
        }

        this.owner.webglContext.renderer.notifyVisualizationChanged({
            reason: "control-change",
            shaderId: this.owner.id,
            shaderType: this.owner.constructor.type(),
            controlName: this.name,
            controlVariableName: event,  // we use here event for names of the control vars like 'default', 'breaks'
            encodedValue: this.encodedValue,
            value: this.value
        });
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
            } else if (this.owner._renderer.htmlHandler) {
                console.warn('$.FlexRenderer.UIControls.SimpleUIControl::init: HTML element with id =', this.id, 'not found! Cannot set event listener for the control.');
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
        return this.component["type"];
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
    static docs() {
        return {
            summary: "Compound float control composed of a range slider and number input.",
            description: "Creates two synchronized SimpleUIControl instances, one range and one number input, and uses the range control for GLSL definition and loading.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number" },
                { name: "min", type: "number" },
                { name: "max", type: "number" },
                { name: "step", type: "number" },
                { name: "interactive", type: "boolean" },
                { name: "title", type: "string" }
            ],
            glType: "float"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._c1 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName, params, $.FlexRenderer.UIControls.getUiElement('range'));
        params.title = "";
        this._c2 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName + "_2", params, $.FlexRenderer.UIControls.getUiElement('number'), "second-");
        this._c1._suppressVisualizationChanged = true;
        this._c2._suppressVisualizationChanged = true;
    }

    init() {
        const _this = this;
        this._c2._params = this._c1._params;
        this._c1.init();
        this._c2.init();
        this._c1.on("default", function(value, encoded, owner) {
            const c2 = document.getElementById(_this._c2.id);
            if (c2) {
                c2.value = encoded;
            }
            _this._c2.value = value;
            _this.changed("default", value, encoded, owner);
        }, true); //silently fail if registered
        this._c2.on("default", function(value, encoded, owner) {
            const c1 = document.getElementById(_this._c1.id);
            if (c1) {
                c1.value = encoded;
            }
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

        const titleHtml = this._c1.params.title
            ? `<span class="er-control__title er-control__title--slider-with-input">${this._c1.params.title}</span>`
            : "";

        const rangeHtml = $.FlexRenderer.UIControls.getUiElement("range").html(
            this._c1.id,
            { ...this._c1.params, title: "" },
            classes,
            `${css}width:100%;`
        );

        const numberHtml = $.FlexRenderer.UIControls.getUiElement("number").html(
            this._c2.id,
            { ...this._c2.params, title: "" },
            classes,
            css
        );

        return [
            `<div class="er-control er-control--slider-with-input" data-columns="${this.layoutColumns}">`,
            titleHtml,
            `<div class="er-control__body er-control__body--slider-with-input">`,
            rangeHtml,
            `</div>`,
            `<div class="er-control__aux er-control__aux--slider-with-input">`,
            numberHtml,
            `</div>`,
            `</div>`
        ].join("");
    }

    get layoutColumns() {
        return this._c1.params.title ? 3 : 2;
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
    static docs() {
        return {
            summary: "Named colormap control producing vec3 samples from a float ratio.",
            description: "Loads a palette by name from the configured scheme group, uploads palette colors and step boundaries as uniforms, and samples colors through generated GLSL helper code. Supports discrete and continuous rendering modes.",
            kind: "ui-control",
            parameters: [
                { name: "steps", type: "number|array", default: 3 },
                { name: "default", type: "string", default: "YlOrRd" },
                { name: "mode", type: "string", default: "sequential" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Colormap" },
                { name: "continuous", type: "boolean", default: false }
            ],
            glType: "vec3"
        };
    }

    /**
     * Envelope-level couplings, applied to every shader that nests a `colormap`
     * envelope. Surfaced in the published schema at
     * `$defs.uiControlEnvelopes.colormap['x-controlCouplings']` and reachable
     * at runtime via `ShaderConfigurator.getEnvelopeCouplingValidators("colormap")`.
     */
    static controlCouplings() {
        return [{
            name: "colormap_palette_in_mode",
            summary: "Colormap default must be a palette listed in schemeGroups[mode].",
            corrective: "Set default to a palette that appears in $.FlexRenderer.ColorMaps.schemeGroups[mode], or change mode to a group whose list includes the desired palette.",
            controls: ["default", "mode"],
            validate: (envelope) => {
                const palette = envelope && envelope.default;
                const mode = envelope && envelope.mode;
                // Skip array defaults — those belong to `custom_colormap`, which
                // does not constrain palette name to a scheme group.
                if (typeof palette !== "string" || typeof mode !== "string") {
                    return { ok: true };
                }
                const group = $.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.schemeGroups
                    && $.FlexRenderer.ColorMaps.schemeGroups[mode];
                if (!group) {
                    return { ok: true };
                }
                if (group.includes(palette)) {
                    return { ok: true };
                }
                return {
                    ok: false,
                    expected: { default: `∈ schemeGroups["${mode}"] = [${group.join(", ")}]` },
                    actual: { default: palette, mode }
                };
            }
        }];
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
        this._normalizeParams();
        this.prepare();
    }

    /**
     * Coerce caller-supplied params into the shape `init()` and `prepare()` expect.
     * If the user passed an array `default` they likely meant `type: "custom_colormap"` —
     * we warn rather than mutate the type, and fall back to a safe palette name so
     * `init()`'s `schemeGroups[mode].includes(...)` cannot blow up.
     */
    _normalizeParams() {
        const params = this._params || {};
        const groups = ($.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.schemeGroups) || {};
        const defaults = ($.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.defaults) || {};

        if (typeof params.mode !== "string" || !groups[params.mode]) {
            console.warn(
                `[FlexRenderer.UIControls.ColorMap] params.mode "${params.mode}" is not a known scheme group ` +
                `(${Object.keys(groups).join(", ")}); falling back to "sequential".`
            );
            params.mode = "sequential";
        }

        if (Array.isArray(params.default)) {
            console.warn(
                `[FlexRenderer.UIControls.ColorMap] params.default is an array — ` +
                `did you mean type: "custom_colormap"? Falling back to the default palette for mode "${params.mode}".`
            );
            params.default = defaults[params.mode];
        }

        if (typeof params.default !== "string" || !params.default) {
            params.default = defaults[params.mode];
        }
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

        const mode = this.params.mode;
        const group = $.FlexRenderer.ColorMaps.schemeGroups[mode];
        const requested = this.params.default;
        if (!this.value || !group || !group.includes(this.value)) {
            const fallback = $.FlexRenderer.ColorMaps.defaults[mode];
            if (requested && fallback && requested !== fallback) {
                // Visible signal so the script-driven layer (and any human
                // reading devtools) can correlate the unexpected preview
                // colour with a palette/mode mismatch. Behaviour is unchanged
                // — still falls back — to avoid breaking persisted configs
                // that rely on the substitution.
                console.warn(
                    `[FlexRenderer.ColorMap] palette "${requested}" is not in schemeGroups["${mode}"]; ` +
                    `substituting with "${fallback}". Pick a mode whose schemeGroups list contains the desired palette.`
                );
            }
            this.value = fallback;
        }
        this.colorPallete = $.FlexRenderer.ColorMaps[this.value][this.maxSteps];

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                const self = e.target;
                const selected = self.value;
                _this.colorPallete = $.FlexRenderer.ColorMaps[selected][_this.maxSteps];
                _this._setPallete(_this.colorPallete);
                self.style.background = _this.cssGradient(_this.colorPallete);
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
            node.innerHTML = schemas.join("");
            node.value = this.value;
            node.addEventListener("change", updater);
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
        let node = document.getElementById(this.id);
        if (node) {
            node.style.background = this.cssGradient(this.colorPallete);
        }
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
            // Normalize to 0..1 if the caller passed an unnormalized range. The previous
            // `forEach` here computed the rescaled values and discarded them — a no-op
            // disguised as normalization. `map` actually applies it.
            const span = max - min;
            if (span > 0 && (min !== 0 || max !== 1)) {
                this.steps = this.steps.map(x => (x - min) / span);
            }
            for (let i = this.maxSteps + 1; i < maximum + 1; i++) {
                this.steps.push(-1);
            }
        }
    }

    _continuousCssFromPallete(pallete) {
        if (!pallete || !pallete.length) {
            return "";
        }
        let css = [`linear-gradient(90deg`];
        for (let i = 0; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i]} ${Math.round((this.steps[i] + this.steps[i + 1]) * 50)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        if (!pallete || !pallete.length) {
            return "";
        }
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i - 1]} ${Math.round(this.steps[i] * 100)}%, ${pallete[i]} ${Math.round(this.steps[i] * 100)}%`);
        }
        css.push(")");
        return css.join("");
    }

    /**
     * Rebuild `this.pallete` (flat float uniform buffer) from a canonical hex-string palette.
     * Contract: `hexColors` MUST be an array of `"#rrggbb"` strings. Input normalization
     * belongs at the boundary (init / updater / cache round-trip), not here. The previous
     * implementation tried to be polymorphic (parse strings on one call, re-pad on another)
     * and crashed when given any other shape because `this.pallete` was never initialized
     * along the alternate branch.
     */
    _setPallete(hexColors) {
        this.pallete = [];
        for (const color of hexColors) {
            this.pallete.push(...this.parser(color));
        }
        while (this.pallete.length < 3 * this.MAX_SAMPLES) {
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
            const display = `<span id="${this.id}" class="er-control__display er-control__display--colormap"${$.FlexRenderer.UIControls.styleAttr(css)}>${this.load(this.params.default)}</span>`;
            return $.FlexRenderer.UIControls.renderControl("colormap", this.params.title, display, classes);
        }

        const input = `<select id="${this.id}" class="er-control__input er-control__input--colormap"${$.FlexRenderer.UIControls.styleAttr(css)}></select>`;
        return $.FlexRenderer.UIControls.renderControl("colormap", this.params.title, input, classes);
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
            throw new Error(`Incompatible control. Colormap cannot be used with ${this.name} (sampling type '${valueGlType}').`);
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
    static docs() {
        return {
            summary: "Editable custom colormap control.",
            description: "Variant of the colormap control that uses user-provided color arrays instead of named palettes and expands the maximum sample count to 32.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "array", default: ["#000000", "#888888", "#ffffff"] },
                { name: "steps", type: "number|array", default: 3 },
                { name: "mode", type: "string", default: "sequential" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Colormap:" },
                { name: "continuous", type: "boolean", default: false }
            ],
            glType: "vec3"
        };
    }

    static controlCouplings() {
        // The parent's palette-in-mode coupling has no meaning here:
        // `default` is an array of user-supplied colors, not a named palette.
        return [];
    }

    _normalizeParams() {
        // Hook overridden because the parent ColorMap's normalization encodes invariants specific to
        // its own semantics (params.default must be a named palette string in some scheme group).
        // custom_colormap has different semantics — params.default is the palette itself, as an array.
        // Inheriting the parent's normalization would clobber legitimate user input.
        // General rule: parent-class invariants that don't hold for a subclass belong behind an
        // overridable hook, not in a constructor-driven mutation path.
    }

    /**
     * Coerce an arbitrary palette value (user input or stale cache) into the canonical shape:
     * an array of `"#rrggbb"` hex strings. Called once at the init boundary so every internal
     * consumer (`_setPallete`, `cssGradient`, the color-input UI, the cache round-trip) can
     * assume the canonical shape and skip its own defensive branching.
     *
     * Tolerated inputs:
     *   - array of hex strings (canonical)              → returned as-is
     *   - array of [r, g, b] or [r, g, b, a] in 0..1   → converted to hex (alpha dropped — GLSL is vec3)
     *   - anything else                                  → warn, fall back to supports().default
     */
    _normalizePalette(value) {
        if (Array.isArray(value) && value.length > 0) {
            if (value.every(item => typeof item === "string")) {
                return value;
            }
            if (value.every(item => Array.isArray(item) && item.length >= 3)) {
                return value.map(rgb => this._rgbTupleToHex(rgb));
            }
        }
        console.warn(
            `[FlexRenderer.UIControls.custom_colormap] palette has unsupported shape; ` +
            `expected an array of "#rrggbb" hex strings (or [r,g,b] tuples in 0..1). ` +
            `Falling back to default.`,
            value
        );
        return this.supports.default;
    }

    _rgbTupleToHex(tuple) {
        const channel = (n) => {
            const v = Math.max(0, Math.min(255, Math.round(Number(n) * 255)));
            return v.toString(16).padStart(2, "0");
        };
        return `#${channel(tuple[0])}${channel(tuple[1])}${channel(tuple[2])}`;
    }

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
        // Pin the shape contract at the boundary: `this.value` / `this.colorPallete` are always
        // an array of `"#rrggbb"` hex strings from this point on. The loaded value may be the
        // user-supplied default in any tolerated input shape, or a stale cache entry from an
        // earlier (possibly buggy) run — normalize once here so internal methods can trust it.
        this.value = this._normalizePalette(this.load(this.params.default));

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
                const self = e.target;
                const index = Number.parseInt(e.target.dataset.index, 10);
                const selected = self.value;

                if (Number.isInteger(index)) {
                    _this.colorPallete[index] = selected;
                    _this._setPallete(_this.colorPallete);
                    if (self.parentElement) {
                        self.parentElement.style.background = _this.cssGradient(_this.colorPallete);
                    }
                    _this.value = _this.colorPallete;
                    _this.store(_this.colorPallete);
                    _this.changed("default", _this.pallete, _this.value, _this);
                    _this.owner.invalidate();
                }
            };

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

            const width = 1 / this.colorPallete.length * 100;
            node.innerHTML = this.colorPallete.map((x, i) => `<input type="color" style="width: ${width}%; height: 30px; background: none; border: none; padding: 4px 5px;" value="${x}" data-index="${i}">`).join("");
            Array.from(node.children).forEach(child => child.addEventListener("change", updater));
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
            const display = `<span id="${this.id}" class="er-control__display er-control__display--custom-colormap"${$.FlexRenderer.UIControls.styleAttr(css)}>&emsp;</span>`;
            return $.FlexRenderer.UIControls.renderControl("custom-colormap", this.params.title, display, classes);
        }

        const display = `<span id="${this.id}" class="er-control__display er-control__display--custom-colormap"${$.FlexRenderer.UIControls.styleAttr(css)}></span>`;
        return $.FlexRenderer.UIControls.renderControl("custom-colormap", this.params.title, display, classes);
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
    static docs() {
        return {
            summary: "Multi-breakpoint slider with per-interval mask values.",
            description: "Stores ordered breakpoints and interval masks, uploads both arrays to GLSL, and samples either the active mask or a masked interval ratio through generated helper code. Interactive mode depends on noUiSlider being present.",
            kind: "ui-control",
            parameters: [
                { name: "breaks", type: "array", default: [0.2, 0.8] },
                { name: "mask", type: "array", default: [1, 0, 1] },
                { name: "interactive", type: "boolean", default: true },
                { name: "inverted", type: "boolean", default: true },
                { name: "maskOnly", type: "boolean", default: true },
                { name: "toggleMask", type: "boolean", default: true },
                { name: "title", type: "string", default: "Threshold" },
                { name: "min", type: "number", default: 0 },
                { name: "max", type: "number", default: 1 },
                { name: "minGap", type: "number", default: 0.05 },
                { name: "step", type: "null|number", default: null },
                { name: "pips", type: "object" }
            ],
            glType: "float"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
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
        // Pin the shape contract at the boundary: `encodedValues` and `mask` are always arrays of
        // finite numbers from this point on. Loaders may return user-supplied input or stale cache
        // entries in any shape; normalize once here so the rest of init() and every later method
        // (slider setup, mask toggling, glDrawing) can skip its own defensive branching.
        this.encodedValues = this._normalizeNumberArray(
            this.load(this.params.breaks, "breaks"),
            this.supports.breaks,
            "breaks"
        );
        this.mask = this._normalizeNumberArray(
            this.load(this.params.mask, "mask"),
            this.supports.mask,
            "mask"
        );

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
                                "oklch(var(--er))" : "";
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

    /**
     * Coerce an arbitrary `breaks` / `mask` value (user input or stale cache) into the canonical
     * shape: an array of finite numbers. Tolerates a single-number input (treated as a one-element
     * array, since `breaks: 0.5` is a reasonable user shorthand). Anything else — non-array,
     * empty, full of NaN — warns and returns the supports() default. The single-number branch is
     * the only "convenience" coercion; everything else fails loudly so silent corruption can't
     * propagate into uniforms.
     */
    _normalizeNumberArray(value, fallback, paramName) {
        let candidate = value;
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            candidate = [candidate];
        }
        if (Array.isArray(candidate)) {
            const cleaned = candidate
                .map(v => Number.parseFloat(v))
                .filter(v => Number.isFinite(v));
            if (cleaned.length > 0) {
                return cleaned;
            }
        }
        console.warn(
            `[FlexRenderer.UIControls.AdvancedSlider] params.${paramName} has unsupported shape; ` +
            `expected an array of finite numbers. Falling back to default.`,
            value
        );
        return fallback.slice();
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
                "oklch(var(--er))" : "";
            pips[i].dataset.index = (i).toString();
        }
    }

    getIntervalCount() {
        const breaks = Array.isArray(this.encodedValues) ? this.encodedValues : [];
        return Math.max(1, breaks.length + 1);
    }

    setMask(maskValues, store = true) {
        const values = Array.isArray(maskValues) ? maskValues.slice(0, this.MAX_SLIDERS + 1) : [];
        while (values.length < this.MAX_SLIDERS + 1) {
            values.push(-1);
        }

        this.mask = values;
        this._originalMask = this.mask.map(x => x > 0 ? x : 1);

        if (store) {
            this.store(this.mask, "mask");
        }

        if (this.params.interactive) {
            this._updateConnectStyles();
        }
    }

    syncMaskToIntervals(mapper = undefined, store = true) {
        const intervalCount = this.getIntervalCount();
        const values = [];
        for (let index = 0; index < intervalCount; index++) {
            values.push(typeof mapper === "function" ? mapper(index, intervalCount) : index);
        }
        this.setMask(values, store);
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
        const slider = `<div id="${this.id}" class="er-control__widget er-control__widget--advanced-slider"${$.FlexRenderer.UIControls.styleAttr(`height: 9px; display: inline-block;${css}`)}></div>`;
        return $.FlexRenderer.UIControls.renderControl("advanced-slider", this.params.title, slider, classes);
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
        if (!value || valueGlType !== 'float') {
            throw new Error(`Incompatible control. Advanced slider cannot be used with ${this.name} (sampling type '${valueGlType}').`);
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
    static docs() {
        return {
            summary: "Textarea control for free-form text values.",
            description: "Renders a textarea, stores string values, and does not define or upload any GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "string", default: "" },
                { name: "placeholder", type: "string", default: "" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Text" }
            ],
            glType: "text"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
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
        const textarea = `<textarea id="${this.id}" class="er-control__input er-control__input--textarea"
${$.FlexRenderer.UIControls.styleAttr(`width: 100%; display: block; resize: vertical; ${css}`)} ${disabled} placeholder="${this.params.placeholder}"></textarea>`;
        return $.FlexRenderer.UIControls.renderControl("text-area", this.params.title, textarea, classes);
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
    static docs() {
        return {
            summary: "Button control that counts clicks.",
            description: "Renders a button, increments an internal counter on click, and does not define or upload any GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number", default: 0 },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Button" }
            ],
            glType: "action"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
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
        const button = `<button id="${this.id}" class="er-control__button er-control__button--action"${$.FlexRenderer.UIControls.styleAttr(`${css ? css : ""}float: right;`)} ${disabled}></button>`;
        return $.FlexRenderer.UIControls.renderControl("button", this.params.title, button, classes);
    }

    get layoutColumns() {
        return 1;
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

$.FlexRenderer.IAtlasTextureControl = class IAtlasTextureControl extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this.atlas = owner.webglContext ? owner.webglContext.secondAtlas : null;
        this._params = this.getParams(params);
        this.textureId = -1;
        this.encodedValue = this.params.default;
        this._needsLoad = true;
    }

    _setTexture(encodedValue, textureId, opts = {}) {
        const emitChange = opts.emitChange !== false;
        const store = opts.store !== false;
        this.encodedValue = encodedValue;
        this.textureId = Number.isInteger(textureId) ? textureId : -1;

        if (emitChange) {
            this.changed("default", this.textureId, this.encodedValue, this);
        }
        if (store) {
            this.store(this.encodedValue);
        }
        this._needsLoad = true;
    }

    _uploadAtlasEntry(source, opts = {}) {
        if (!this.atlas) {
            return -1;
        }

        const cacheKey = opts.cacheKey ? String(opts.cacheKey) : null;
        if (cacheKey) {
            this.atlas.__flexRendererCache = this.atlas.__flexRendererCache || {};
            if (Number.isInteger(this.atlas.__flexRendererCache[cacheKey])) {
                return this.atlas.__flexRendererCache[cacheKey];
            }
        }

        const textureId = this.atlas.addImage(source, opts);
        this.atlas._commitUploads();

        if (cacheKey) {
            this.atlas.__flexRendererCache[cacheKey] = textureId;
        }

        return textureId;
    }

    define() {
        return `uniform int ${this.webGLVariableName}_textureId;`;
    }

    glLoaded(program, gl) {
        this.textureIdLocation = gl.getUniformLocation(program, this.webGLVariableName + "_textureId");
        this._needsLoad = true;
    }

    glDrawing(program, gl) {
        if (this._needsLoad) {
            gl.uniform1i(this.textureIdLocation, this.textureId);
            this._needsLoad = false;
        }
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value) {
            throw new Error("Requires a vec2 value/variable specifying the texture coordinate to sample at");
        }

        if (valueGlType === 'vec2') {
            return `osd_atlas_texture(${this.webGLVariableName}_textureId, ${value})`;
        }

        throw new Error(`Incompatible parameter type '${valueGlType}' for atlas sampling control '${this.name}'; only vec2 is supported`);
    }

    get raw() {
        return this.textureId;
    }

    get encoded() {
        return this.encodedValue;
    }

    get type() {
        return "vec4";
    }
};

$.FlexRenderer.UIControls.Image = class extends $.FlexRenderer.IAtlasTextureControl {
    static docs() {
        return {
            summary: "Atlas-backed image sampling control.",
            description: "Stores an integer texture id for the second-pass atlas, starts empty by default, allows uploading arbitrary images through a file input, and samples atlas textures when given vec2 texture coordinates.",
            kind: "ui-control",
            parameters: [
                { name: "title", type: "string", default: "Images" },
                { name: "interactive", type: "boolean", default: true },
                { name: "default", type: "number", default: -1 },
                { name: "accept", type: "string", default: "image/*" }
            ],
            glType: "vec4"
        };
    }

    init() {
        this.encodedValue = this.load(this.params.default);
        this.textureId = Number.parseInt(this.encodedValue, 10);
        if (!Number.isInteger(this.textureId)) {
            this.textureId = -1;
        }

        if (this.params.interactive) {
            const _this = this;

            let number = document.getElementById(`${this.id}_number`);
            if (number) {
                let updater = function(e) {
                    _this.set(e.target.value);
                    _this.owner.invalidate();
                };

                number.value = this.encodedValue;
                number.addEventListener("change", updater);
            }

            let button = document.getElementById(`${this.id}_button`);
            if (button) {
                let updater = function(e) {
                    let file = document.getElementById(`${_this.id}_file`);

                    if (file.files && file.files.length) {
                        const fr = new FileReader();
                        fr.onload = function() {
                            const image = new Image();
                            image.onload = function() {
                                const textureId = _this._uploadAtlasEntry(image, {
                                    width: image.naturalWidth || image.width,
                                    height: image.naturalHeight || image.height
                                });
                                _this.set(textureId);
                                if (number) {
                                    number.value = String(textureId);
                                }
                                file.value = "";
                                _this.owner.invalidate();
                            };
                            image.src = fr.result;
                        };
                        fr.readAsDataURL(file.files[0]);
                    } else {
                        alert("No file selected");
                    }
                };

                button.addEventListener("click", updater);
            }
        }
    }

    set(encodedTextureId) {
        const parsed = Number.parseInt(encodedTextureId, 10);
        if (Number.isNaN(parsed)) {
            this._setTexture(-1, -1);
            return;
        }
        this._setTexture(String(parsed), parsed);
    }

    toHtml(classes = "", css = "") {
        const disabled = this.params.interactive ? "" : "disabled";
        const body = `
        <div id="${this.id}_root" class="er-control__widget er-control__widget--image"${$.FlexRenderer.UIControls.styleAttr(`${css}; position: relative;`)}>
            <div class="er-control__hint er-control__hint--image">The atlas starts empty. Upload an image to create a new atlas entry.</div>
            <label class="er-control__row er-control__row--image-number">Selected: <input type="number" id="${this.id}_number" class="er-control__input er-control__input--image-number" min="-1" step="1" ${disabled}></label>
            <input type="file" id="${this.id}_file" class="er-control__input er-control__input--image-file" accept="${this.params.accept}" ${disabled}>
            <button id="${this.id}_button" class="er-control__button er-control__button--image-upload" ${disabled}>Upload Image</button>
        </div>`;
        return $.FlexRenderer.UIControls.renderControl("image", this.params.title, body, classes);
    }

    get supports() {
        return {
            title: "Images",
            interactive: true,
            default: -1,
            accept: "image/*",
        };
    }

    get supportsAll() {
        return {};
    }
};
$.FlexRenderer.UIControls.registerClass("image", $.FlexRenderer.UIControls.Image);

$.FlexRenderer.UIControls.IconLibrary = {
    sets: {
        core: [
            { name: "house", glyph: "⌂", aliases: ["home", "fa-house", "fa-home"], tags: ["building", "ui"] },
            { name: "location-pin", glyph: "⌖", aliases: ["pin", "map-pin", "marker", "fa-location-dot", "fa-map-marker-alt"], tags: ["map", "place"] },
            { name: "flag", glyph: "⚑", aliases: ["banner", "fa-flag"], tags: ["marker", "state"] },
            { name: "star", glyph: "★", aliases: ["favorite", "fa-star"], tags: ["rating", "bookmark"] },
            { name: "heart", glyph: "♥", aliases: ["like", "fa-heart"], tags: ["favorite"] },
            { name: "circle", glyph: "●", aliases: ["dot", "fa-circle"], tags: ["shape"] },
            { name: "square", glyph: "■", aliases: ["fa-square"], tags: ["shape"] },
            { name: "triangle", glyph: "▲", aliases: ["warning", "fa-triangle-exclamation", "fa-exclamation-triangle"], tags: ["shape", "alert"] },
            { name: "diamond", glyph: "◆", aliases: ["gem", "fa-diamond"], tags: ["shape"] },
            { name: "plus", glyph: "✚", aliases: ["add", "cross", "fa-plus"], tags: ["action"] },
            { name: "check", glyph: "✓", aliases: ["ok", "success", "fa-check"], tags: ["action"] },
            { name: "xmark", glyph: "✕", aliases: ["close", "times", "fa-xmark", "fa-times"], tags: ["action"] },
            { name: "info", glyph: "ℹ", aliases: ["information", "fa-circle-info", "fa-info-circle"], tags: ["status"] },
            { name: "gear", glyph: "⚙", aliases: ["settings", "cog", "fa-gear", "fa-cog"], tags: ["ui"] },
            { name: "search", glyph: "⌕", aliases: ["magnifier", "fa-magnifying-glass", "fa-search"], tags: ["ui"] },
            { name: "mail", glyph: "✉", aliases: ["envelope", "fa-envelope"], tags: ["communication"] },
            { name: "phone", glyph: "☎", aliases: ["call", "fa-phone"], tags: ["communication"] },
            { name: "user", glyph: "☺", aliases: ["person", "profile", "fa-user"], tags: ["people"] },
            { name: "lock", glyph: "🔒", aliases: ["secure", "fa-lock"], tags: ["security"] },
            { name: "unlock", glyph: "🔓", aliases: ["fa-unlock"], tags: ["security"] },
            { name: "eye", glyph: "◉", aliases: ["view", "show", "fa-eye"], tags: ["visibility"] },
            { name: "sun", glyph: "☀", aliases: ["brightness", "fa-sun"], tags: ["weather"] },
            { name: "cloud", glyph: "☁", aliases: ["fa-cloud"], tags: ["weather"] },
            { name: "umbrella", glyph: "☂", aliases: ["rain", "fa-umbrella"], tags: ["weather"] },
            { name: "music", glyph: "♫", aliases: ["note", "fa-music"], tags: ["media"] }
        ]
    },

    getSetNames() {
        return Object.keys(this.sets);
    },

    getIcons(setName = "core") {
        if (setName === "all") {
            return Object.values(this.sets).flat();
        }
        return this.sets[setName] || this.sets.core || [];
    },

    resolveIconSpec(query, setName = "core") {
        const value = String(query === undefined || query === null ? "" : query).trim();
        if (!value) {
            return null;
        }

        const normalized = this._normalizeName(value);
        const directChar = this._resolveDirectGlyph(value);
        if (directChar) {
            return {
                key: `glyph:${directChar}`,
                glyph: directChar,
                label: value,
                set: normalized.startsWith("&#") || normalized.startsWith("&") ? "entity" : "literal"
            };
        }

        const icons = this.getIcons(setName);
        for (const icon of icons) {
            const haystack = [icon.name].concat(icon.aliases || []);
            if (haystack.map(item => this._normalizeName(item)).includes(normalized)) {
                return {
                    key: `${setName}:${icon.name}`,
                    glyph: icon.glyph,
                    label: icon.name,
                    set: setName,
                    icon: icon
                };
            }
        }

        return null;
    },

    search(query = "", setName = "core") {
        const value = this._normalizeName(query);
        const icons = this.getIcons(setName);
        if (!value) {
            return icons.slice(0, 24);
        }

        return icons.filter(icon => {
            const tokens = [icon.name].concat(icon.aliases || [], icon.tags || []);
            return tokens.some(token => this._normalizeName(token).includes(value));
        }).slice(0, 48);
    },

    _normalizeName(value) {
        let normalized = String(value || "").trim().toLowerCase();
        normalized = normalized.replace(/\s+/g, " ");
        normalized = normalized.replace(/\b(?:fa-solid|fa-regular|fa-light|fa-thin|fa-brands|fa-duotone)\b/g, "");
        normalized = normalized.replace(/\b(?:fas|far|fal|fat|fab|fad)\b/g, "");
        normalized = normalized.replace(/\s+/g, " ").trim();

        if (normalized.includes(" ")) {
            const tokens = normalized.split(" ").filter(Boolean);
            normalized = tokens[tokens.length - 1];
        }

        return normalized;
    },

    _resolveDirectGlyph(value) {
        if (!value) {
            return null;
        }

        const entityGlyph = this._decodeHtmlEntity(value);
        if (entityGlyph) {
            return entityGlyph;
        }

        const codeMatch =
            value.match(/^&#x([0-9a-f]+);?$/i) ||
            value.match(/^&#([0-9]+);?$/i) ||
            value.match(/^0x([0-9a-f]+)$/i) ||
            value.match(/^u\+([0-9a-f]+)$/i) ||
            value.match(/^\\u\{?([0-9a-f]+)\}?$/i);

        if (codeMatch) {
            const radix = /^[0-9]+$/.test(codeMatch[1]) && value.startsWith("&#") && !/x/i.test(value) ? 10 : 16;
            const codePoint = Number.parseInt(codeMatch[1], radix);
            if (Number.isInteger(codePoint)) {
                try {
                    return String.fromCodePoint(codePoint);
                } catch (_) {
                    return null;
                }
            }
        }

        const symbols = [...value];
        if (symbols.length === 1) {
            return symbols[0];
        }

        return null;
    },

    _decodeHtmlEntity(value) {
        if (typeof document === "undefined" || !String(value).includes("&")) {
            return null;
        }

        const textarea = document.createElement("textarea");
        textarea.innerHTML = String(value);
        const decoded = textarea.value;
        if (decoded && decoded !== value && [...decoded].length === 1) {
            return decoded;
        }
        return null;
    }
};

$.FlexRenderer.UIControls.IconLibrary = (() => {
    const makeGlyph = (name, glyph, aliases = [], tags = []) => ({
        name,
        glyph,
        aliases,
        tags
    });

    const makeClass = (name, className, aliases = [], tags = []) => ({
        name,
        className,
        aliases,
        tags
    });

    const htmlGlyphs = [
        makeGlyph("star", "★", ["favourite", "favorite", "&starf;", "filled star"], ["shape", "rating"]),
        makeGlyph("star-outline", "☆", ["&star;", "outline star"], ["shape", "rating"]),
        makeGlyph("heart", "♥", ["love", "&hearts;"], ["shape", "status"]),
        makeGlyph("diamond", "◆", ["gem", "&diams;"], ["shape"]),
        makeGlyph("circle", "●", ["dot", "&bull;"], ["shape"]),
        makeGlyph("circle-outline", "○", ["ring"], ["shape"]),
        makeGlyph("square", "■", ["block"], ["shape"]),
        makeGlyph("square-outline", "□", ["outline square"], ["shape"]),
        makeGlyph("triangle-up", "▲", ["caret-up"], ["shape", "direction"]),
        makeGlyph("triangle-down", "▼", ["caret-down"], ["shape", "direction"]),
        makeGlyph("triangle-right", "▶", ["play", "caret-right"], ["shape", "direction", "media"]),
        makeGlyph("triangle-left", "◀", ["caret-left"], ["shape", "direction"]),
        makeGlyph("plus", "✚", ["add", "cross"], ["action"]),
        makeGlyph("minus", "−", ["subtract"], ["action"]),
        makeGlyph("multiply", "✕", ["times", "close", "xmark"], ["action"]),
        makeGlyph("check", "✓", ["ok", "done"], ["action", "status"]),
        makeGlyph("warning", "⚠", ["alert", "&warning;"], ["status"]),
        makeGlyph("info", "ℹ", ["information"], ["status"]),
        makeGlyph("question", "?", ["help"], ["status"]),
        makeGlyph("flag", "⚑", ["banner"], ["marker"]),
        makeGlyph("location-pin", "⌖", ["pin", "marker"], ["map", "marker"]),
        makeGlyph("house", "⌂", ["home"], ["building", "ui"]),
        makeGlyph("gear", "⚙", ["settings", "cog"], ["ui"]),
        makeGlyph("search", "⌕", ["magnifier"], ["ui"]),
        makeGlyph("mail", "✉", ["envelope"], ["communication"]),
        makeGlyph("phone", "☎", ["call"], ["communication"]),
        makeGlyph("user", "☺", ["person", "profile"], ["people"]),
        makeGlyph("lock", "🔒", ["secure"], ["security"]),
        makeGlyph("unlock", "🔓", [], ["security"]),
        makeGlyph("eye", "◉", ["view", "visible"], ["visibility"]),
        makeGlyph("sun", "☀", [], ["weather"]),
        makeGlyph("cloud", "☁", [], ["weather"]),
        makeGlyph("umbrella", "☂", [], ["weather"]),
        makeGlyph("snowflake", "❄", [], ["weather"]),
        makeGlyph("lightning", "⚡", ["bolt"], ["energy", "status"]),
        makeGlyph("music", "♫", ["note"], ["media"]),
        makeGlyph("scissors", "✂", ["cut"], ["action"]),
        makeGlyph("pencil", "✎", ["edit"], ["action"]),
        makeGlyph("trash", "🗑", ["delete", "bin"], ["action"]),
        makeGlyph("folder", "🗀", ["directory"], ["ui"]),
        makeGlyph("document", "🗎", ["file"], ["ui"]),
        makeGlyph("camera", "📷", ["photo"], ["media"]),
        makeGlyph("clock", "🕒", ["time"], ["ui"]),
        makeGlyph("leaf", "🍃", [], ["nature"]),
        makeGlyph("fire", "🔥", [], ["status"]),
        makeGlyph("droplet", "💧", ["water"], ["nature"]),
        makeGlyph("microscope", "🔬", [], ["science"]),
        makeGlyph("dna", "🧬", [], ["science"]),
        makeGlyph("pill", "💊", [], ["medical"]),
        makeGlyph("crosshair", "⌖", ["target"], ["marker"]),
        makeGlyph("ruler", "📏", ["measure"], ["tools"])
    ];

    const faSolidCommon = [
        makeClass("house", "fa-solid fa-house", ["home"], ["building", "ui"]),
        makeClass("location-dot", "fa-solid fa-location-dot", ["map-marker", "pin"], ["map", "marker"]),
        makeClass("flag", "fa-solid fa-flag", [], ["marker"]),
        makeClass("star", "fa-solid fa-star", [], ["rating"]),
        makeClass("heart", "fa-solid fa-heart", [], ["status"]),
        makeClass("circle", "fa-solid fa-circle", ["dot"], ["shape"]),
        makeClass("square", "fa-solid fa-square", [], ["shape"]),
        makeClass("triangle-exclamation", "fa-solid fa-triangle-exclamation", ["warning", "alert"], ["status"]),
        makeClass("diamond", "fa-solid fa-gem", ["gem"], ["shape"]),
        makeClass("plus", "fa-solid fa-plus", ["add"], ["action"]),
        makeClass("minus", "fa-solid fa-minus", ["subtract"], ["action"]),
        makeClass("xmark", "fa-solid fa-xmark", ["close", "times"], ["action"]),
        makeClass("check", "fa-solid fa-check", ["ok"], ["action"]),
        makeClass("circle-info", "fa-solid fa-circle-info", ["info", "information"], ["status"]),
        makeClass("circle-question", "fa-solid fa-circle-question", ["question", "help"], ["status"]),
        makeClass("gear", "fa-solid fa-gear", ["cog", "settings"], ["ui"]),
        makeClass("magnifying-glass", "fa-solid fa-magnifying-glass", ["search"], ["ui"]),
        makeClass("envelope", "fa-solid fa-envelope", ["mail"], ["communication"]),
        makeClass("phone", "fa-solid fa-phone", ["call"], ["communication"]),
        makeClass("user", "fa-solid fa-user", ["person", "profile"], ["people"]),
        makeClass("users", "fa-solid fa-users", ["group"], ["people"]),
        makeClass("lock", "fa-solid fa-lock", [], ["security"]),
        makeClass("unlock", "fa-solid fa-unlock", [], ["security"]),
        makeClass("eye", "fa-solid fa-eye", ["visible"], ["visibility"]),
        makeClass("eye-slash", "fa-solid fa-eye-slash", ["hidden"], ["visibility"]),
        makeClass("sun", "fa-solid fa-sun", [], ["weather"]),
        makeClass("moon", "fa-solid fa-moon", [], ["weather"]),
        makeClass("cloud", "fa-solid fa-cloud", [], ["weather"]),
        makeClass("cloud-rain", "fa-solid fa-cloud-rain", ["rain"], ["weather"]),
        makeClass("umbrella", "fa-solid fa-umbrella", [], ["weather"]),
        makeClass("snowflake", "fa-solid fa-snowflake", [], ["weather"]),
        makeClass("bolt", "fa-solid fa-bolt", ["lightning"], ["energy"]),
        makeClass("music", "fa-solid fa-music", ["note"], ["media"]),
        makeClass("play", "fa-solid fa-play", [], ["media"]),
        makeClass("pause", "fa-solid fa-pause", [], ["media"]),
        makeClass("stop", "fa-solid fa-stop", [], ["media"]),
        makeClass("backward", "fa-solid fa-backward", [], ["media"]),
        makeClass("forward", "fa-solid fa-forward", [], ["media"]),
        makeClass("image", "fa-solid fa-image", ["photo"], ["media"]),
        makeClass("camera", "fa-solid fa-camera", [], ["media"]),
        makeClass("video", "fa-solid fa-video", [], ["media"]),
        makeClass("folder", "fa-solid fa-folder", [], ["ui"]),
        makeClass("file", "fa-solid fa-file", ["document"], ["ui"]),
        makeClass("file-lines", "fa-solid fa-file-lines", ["file-text"], ["ui"]),
        makeClass("trash", "fa-solid fa-trash", ["delete", "bin"], ["action"]),
        makeClass("pen", "fa-solid fa-pen", ["edit", "pencil"], ["action"]),
        makeClass("scissors", "fa-solid fa-scissors", ["cut"], ["action"]),
        makeClass("copy", "fa-solid fa-copy", [], ["action"]),
        makeClass("paste", "fa-solid fa-paste", [], ["action"]),
        makeClass("download", "fa-solid fa-download", [], ["action"]),
        makeClass("upload", "fa-solid fa-upload", [], ["action"]),
        makeClass("share-nodes", "fa-solid fa-share-nodes", ["share"], ["action"]),
        makeClass("link", "fa-solid fa-link", [], ["action"]),
        makeClass("filter", "fa-solid fa-filter", [], ["ui"]),
        makeClass("sliders", "fa-solid fa-sliders", ["adjust"], ["ui"]),
        makeClass("palette", "fa-solid fa-palette", ["color"], ["ui"]),
        makeClass("brush", "fa-solid fa-brush", [], ["tools"]),
        makeClass("ruler", "fa-solid fa-ruler", ["measure"], ["tools"]),
        makeClass("crop", "fa-solid fa-crop", [], ["tools"]),
        makeClass("crosshairs", "fa-solid fa-crosshairs", ["target"], ["marker"]),
        makeClass("bullseye", "fa-solid fa-bullseye", [], ["marker"]),
        makeClass("tag", "fa-solid fa-tag", ["label"], ["ui"]),
        makeClass("bookmark", "fa-solid fa-bookmark", [], ["ui"]),
        makeClass("clock", "fa-solid fa-clock", ["time"], ["ui"]),
        makeClass("calendar", "fa-solid fa-calendar", ["date"], ["ui"]),
        makeClass("microscope", "fa-solid fa-microscope", [], ["science"]),
        makeClass("flask", "fa-solid fa-flask", [], ["science"]),
        makeClass("dna", "fa-solid fa-dna", [], ["science"]),
        makeClass("leaf", "fa-solid fa-leaf", [], ["nature"]),
        makeClass("fire", "fa-solid fa-fire", [], ["status"]),
        makeClass("droplet", "fa-solid fa-droplet", ["water"], ["nature"]),
        makeClass("seedling", "fa-solid fa-seedling", [], ["nature"]),
        makeClass("hospital", "fa-solid fa-hospital", [], ["medical"]),
        makeClass("stethoscope", "fa-solid fa-stethoscope", [], ["medical"]),
        makeClass("syringe", "fa-solid fa-syringe", [], ["medical"]),
        makeClass("pills", "fa-solid fa-pills", ["pill"], ["medical"]),
        makeClass("bug", "fa-solid fa-bug", [], ["status"]),
        makeClass("shield-halved", "fa-solid fa-shield-halved", ["shield"], ["security"]),
        makeClass("database", "fa-solid fa-database", [], ["data"]),
        makeClass("server", "fa-solid fa-server", [], ["data"]),
        makeClass("chart-line", "fa-solid fa-chart-line", ["analytics"], ["data"]),
        makeClass("chart-pie", "fa-solid fa-chart-pie", [], ["data"]),
        makeClass("layer-group", "fa-solid fa-layer-group", ["layers"], ["ui"]),
        makeClass("grid", "fa-solid fa-table-cells", ["table", "cells"], ["ui"])
    ];

    const faRegularCommon = [
        makeClass("star", "fa-regular fa-star", [], ["rating"]),
        makeClass("heart", "fa-regular fa-heart", [], ["status"]),
        makeClass("circle", "fa-regular fa-circle", [], ["shape"]),
        makeClass("square", "fa-regular fa-square", [], ["shape"]),
        makeClass("bookmark", "fa-regular fa-bookmark", [], ["ui"]),
        makeClass("bell", "fa-regular fa-bell", [], ["ui"]),
        makeClass("calendar", "fa-regular fa-calendar", [], ["ui"]),
        makeClass("clock", "fa-regular fa-clock", [], ["ui"]),
        makeClass("file", "fa-regular fa-file", [], ["ui"]),
        makeClass("file-lines", "fa-regular fa-file-lines", [], ["ui"]),
        makeClass("folder", "fa-regular fa-folder", [], ["ui"]),
        makeClass("image", "fa-regular fa-image", [], ["media"]),
        makeClass("message", "fa-regular fa-message", ["comment"], ["communication"]),
        makeClass("circle-question", "fa-regular fa-circle-question", ["help"], ["status"]),
        makeClass("circle-user", "fa-regular fa-circle-user", ["profile"], ["people"])
    ];

    const faBrandsCommon = [
        makeClass("github", "fa-brands fa-github", [], ["brand"]),
        makeClass("gitlab", "fa-brands fa-gitlab", [], ["brand"]),
        makeClass("docker", "fa-brands fa-docker", [], ["brand"]),
        makeClass("chrome", "fa-brands fa-chrome", [], ["brand"]),
        makeClass("firefox", "fa-brands fa-firefox", [], ["brand"]),
        makeClass("edge", "fa-brands fa-edge", [], ["brand"]),
        makeClass("linux", "fa-brands fa-linux", [], ["brand"]),
        makeClass("windows", "fa-brands fa-windows", [], ["brand"]),
        makeClass("apple", "fa-brands fa-apple", [], ["brand"]),
        makeClass("google", "fa-brands fa-google", [], ["brand"]),
        makeClass("python", "fa-brands fa-python", [], ["brand"]),
        makeClass("js", "fa-brands fa-js", ["javascript"], ["brand"]),
        makeClass("html5", "fa-brands fa-html5", [], ["brand"]),
        makeClass("css3", "fa-brands fa-css3-alt", ["css3-alt"], ["brand"]),
        makeClass("node", "fa-brands fa-node-js", ["node-js"], ["brand"]),
        makeClass("npm", "fa-brands fa-npm", [], ["brand"]),
        makeClass("slack", "fa-brands fa-slack", [], ["brand"]),
        makeClass("discord", "fa-brands fa-discord", [], ["brand"]),
        makeClass("figma", "fa-brands fa-figma", [], ["brand"]),
        makeClass("twitter", "fa-brands fa-x-twitter", ["x-twitter"], ["brand"])
    ];

    const sets = {
        "html-glyphs": {
            kind: "glyph",
            fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
            fontWeight: "400",
            items: htmlGlyphs
        },
        "fa-solid-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
            fontWeight: "900",
            items: faSolidCommon
        },
        "fa-regular-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
            fontWeight: "400",
            items: faRegularCommon
        },
        "fa-brands-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Brands','Font Awesome 5 Brands'",
            fontWeight: "400",
            items: faBrandsCommon
        }
    };

    return {
        sets,

        getSetNames() {
            return Object.keys(this.sets);
        },

        getSet(setName = "fa-solid-common") {
            if (setName === "core") {
                return this.sets["html-glyphs"];
            }
            return this.sets[setName] || this.sets["fa-solid-common"];
        },

        getIcons(setName = "fa-solid-common") {
            return this.getSet(setName).items || [];
        },

        getIconEntries(setName = undefined) {
            if (setName) {
                const set = this.getSet(setName);
                return (set.items || []).map(icon => ({ icon, setName, set }));
            }

            return this.getSetNames().flatMap((name) => {
                const set = this.getSet(name);
                return (set.items || []).map(icon => ({ icon, setName: name, set }));
            });
        },

        search(query = "", setName = "fa-solid-common", maxResults = 120) {
            const set = this.getSet(setName);
            const normalized = this._normalizeName(query);

            if (!normalized) {
                return set.items.slice(0, maxResults);
            }

            return set.items.filter(icon => {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || []),
                    ...(icon.tags || [])
                ];
                return tokens.some(token => this._normalizeName(token).includes(normalized));
            }).slice(0, maxResults);
        },

        searchAll(query = "", maxResults = 120) {
            const normalized = this._normalizeName(query);
            const entries = this.getIconEntries();

            if (!normalized) {
                return entries.slice(0, maxResults).map(({ icon, setName }) => ({
                    ...icon,
                    set: setName
                }));
            }

            return entries.filter(({ icon }) => {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || []),
                    ...(icon.tags || [])
                ];
                return tokens.some(token => this._normalizeName(token).includes(normalized));
            }).slice(0, maxResults).map(({ icon, setName }) => ({
                ...icon,
                set: setName
            }));
        },

        resolveIconSpec(query, setName = "fa-solid-common") {
            const raw = String(query === undefined || query === null ? "" : query).trim();
            if (!raw) {
                return null;
            }

            const qualifiedMatch = raw.match(/^([a-z0-9_-]+):(.*)$/i);
            if (qualifiedMatch && this.sets[qualifiedMatch[1]]) {
                setName = qualifiedMatch[1];
                return this.resolveIconSpec(qualifiedMatch[2], setName);
            }

            const set = this.getSet(setName);
            const normalized = this._normalizeName(raw);

            const directGlyph = this._resolveDirectGlyph(raw);
            if (directGlyph) {
                return {
                    key: `${setName}:glyph:${directGlyph}`,
                    label: raw,
                    set: setName,
                    renderMode: "glyph",
                    glyph: directGlyph,
                    fontFamily: set.fontFamily,
                    fontWeight: set.fontWeight
                };
            }

            for (const icon of set.items) {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || [])
                ];
                if (!tokens.some(token => this._normalizeName(token) === normalized)) {
                    continue;
                }

                if (set.kind === "glyph") {
                    return {
                        key: `${setName}:${icon.name}`,
                        label: icon.name,
                        set: setName,
                        renderMode: "glyph",
                        glyph: icon.glyph,
                        fontFamily: set.fontFamily,
                        fontWeight: set.fontWeight,
                        icon
                    };
                }

                return {
                    key: `${setName}:${icon.name}`,
                    label: icon.name,
                    set: setName,
                    renderMode: "class",
                    className: icon.className,
                    fontFamily: set.fontFamily,
                    fontWeight: set.fontWeight,
                    icon
                };
            }

            return null;
        },

        resolveAnyIconSpec(query, preferredSetName = "fa-solid-common") {
            const raw = String(query === undefined || query === null ? "" : query).trim();
            if (!raw) {
                return null;
            }

            const preferred = this.resolveIconSpec(raw, preferredSetName);
            if (preferred) {
                return preferred;
            }

            for (const setName of this.getSetNames()) {
                if (setName === preferredSetName) {
                    continue;
                }
                const resolved = this.resolveIconSpec(raw, setName);
                if (resolved) {
                    return resolved;
                }
            }

            return null;
        },

        _normalizeName(value) {
            let normalized = String(value || "").trim().toLowerCase();
            normalized = normalized.replace(/\s+/g, " ");
            normalized = normalized.replace(/\b(?:fa-solid|fa-regular|fa-light|fa-thin|fa-brands|fa-duotone)\b/g, "");
            normalized = normalized.replace(/\b(?:fas|far|fal|fat|fab|fad)\b/g, "");
            normalized = normalized.replace(/\s+/g, " ").trim();

            if (normalized.includes(" ")) {
                const tokens = normalized.split(" ").filter(Boolean);
                normalized = tokens[tokens.length - 1];
            }

            return normalized;
        },

        _resolveDirectGlyph(value) {
            if (!value) {
                return null;
            }

            const entityGlyph = this._decodeHtmlEntity(value);
            if (entityGlyph) {
                return entityGlyph;
            }

            const codeMatch =
                value.match(/^&#x([0-9a-f]+);?$/i) ||
                value.match(/^&#([0-9]+);?$/i) ||
                value.match(/^0x([0-9a-f]+)$/i) ||
                value.match(/^u\+([0-9a-f]+)$/i) ||
                value.match(/^\\u\{?([0-9a-f]+)\}?$/i);

            if (codeMatch) {
                const radix = /^[0-9]+$/.test(codeMatch[1]) && value.startsWith("&#") && !/x/i.test(value) ? 10 : 16;
                const codePoint = Number.parseInt(codeMatch[1], radix);
                if (Number.isInteger(codePoint)) {
                    try {
                        return String.fromCodePoint(codePoint);
                    } catch (_) {
                        return null;
                    }
                }
            }

            const symbols = [...value];
            if (symbols.length === 1) {
                return symbols[0];
            }

            return null;
        },

        _decodeHtmlEntity(value) {
            if (typeof document === "undefined" || !String(value).includes("&")) {
                return null;
            }

            const textarea = document.createElement("textarea");
            textarea.innerHTML = String(value);
            const decoded = textarea.value;
            if (decoded && decoded !== value && [...decoded].length === 1) {
                return decoded;
            }
            return null;
        }
    };
})();

$.FlexRenderer.UIControls.Icon = class extends $.FlexRenderer.IAtlasTextureControl {
    static docs() {
        return {
            summary: "Atlas-backed icon control with separate HTML-glyph and Font Awesome sets.",
            description: "Searches curated icon sets, previews Font Awesome entries by rendering the actual font-backed class in DOM, converts the selected icon to atlas texture content, and samples the second-pass atlas from GLSL.",
            kind: "ui-control",
            iconSets: $.FlexRenderer.UIControls.IconLibrary.getSetNames(),
            parameters: [
                { name: "title", type: "string", default: "Icon" },
                { name: "interactive", type: "boolean", default: true },
                { name: "default", type: "string", default: "" },
                { name: "iconSet", type: "string", default: "fa-solid-common", allowedValues: $.FlexRenderer.UIControls.IconLibrary.getSetNames() },
                { name: "size", type: "number", default: 160 },
                { name: "padding", type: "number", default: 4 },
                { name: "color", type: "string", default: "#111111" },
                { name: "backgroundColor", type: "string", default: "#00000000" },
                { name: "previewSize", type: "number", default: 34 },
                { name: "maxResults", type: "number", default: 120 },
                { name: "glyphFontFamily", type: "string", default: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif" },
                { name: "glyphFontWeight", type: "string", default: "400" }
            ],
            glType: "vec4"
        };
    }

    init() {
        this.selectedSet = this.load(this.params.iconSet || "fa-solid-common", "set") || (this.params.iconSet || "fa-solid-common");
        this.currentColor = this.params.color || "#111111";
        this.encodedValue = this.load(this.params.default);
        this.textureId = -1;

        if (this.encodedValue) {
            this._applyEncodedIcon(this.encodedValue, false);
        }

        if (!this.params.interactive) {
            return;
        }

        const queryInput = document.getElementById(`${this.id}_query`);
        const results = document.getElementById(`${this.id}_results`);
        const preview = document.getElementById(`${this.id}_preview`);
        const popup = document.getElementById(`${this.id}_popup`);
        const closeButton = document.getElementById(`${this.id}_close`);
        const triggerButton = document.getElementById(`${this.id}_trigger`);
        const colorInput = document.getElementById(`${this.id}_color`);

        if (triggerButton) {
            triggerButton.addEventListener("click", () => {
                if (!popup) {
                    return;
                }
                popup.style.display = "block";
                const decoded = this._decodeStoredValue(this.encodedValue || "");
                this._renderIconResults(results, queryInput ? queryInput.value : decoded.icon);
                if (queryInput) {
                    queryInput.focus();
                    queryInput.select();
                }
            });
        }

        if (queryInput) {
            queryInput.value = this._decodeStoredValue(this.encodedValue || "").icon;
            queryInput.addEventListener("input", () => {
                if (popup) {
                    popup.style.display = "block";
                }
                this._renderIconResults(results, queryInput.value);
            });
            queryInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this._applyIconSelection(queryInput.value, preview, popup);
                }
                if (event.key === "Escape" && popup) {
                    popup.style.display = "none";
                }
            });
        }

        if (colorInput) {
            colorInput.value = this.currentColor;
            colorInput.addEventListener("input", () => {
                this._applyUiState(queryInput ? queryInput.value : "", colorInput.value, preview, false);
            });
            colorInput.addEventListener("change", () => {
                this._applyUiState(queryInput ? queryInput.value : "", colorInput.value, preview, true);
            });
        }

        if (closeButton && popup) {
            closeButton.addEventListener("click", () => {
                popup.style.display = "none";
            });
        }

        if (!this._outsideClickHandler) {
            this._outsideClickHandler = (event) => {
                if (!popup || popup.style.display === "none") {
                    return;
                }
                const root = document.getElementById(`${this.id}_root`);
                if (root && !root.contains(event.target)) {
                    popup.style.display = "none";
                }
            };
            document.addEventListener("click", this._outsideClickHandler);
        }

        this._renderIconPreview(preview, this._decodeStoredValue(this.encodedValue || "").icon);
    }

    destroy() {
        if (this._outsideClickHandler) {
            document.removeEventListener("click", this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
    }

    set(encodedValue) {
        this._applyEncodedIcon(encodedValue, true);
    }

    _applyEncodedIcon(encodedValue, emitChange) {
        const decoded = this._decodeStoredValue(encodedValue);
        this.currentColor = decoded.color;

        const resolved = $.FlexRenderer.UIControls.IconLibrary.resolveAnyIconSpec(decoded.icon, this.selectedSet);
        if (!resolved) {
            this.encodedValue = this._encodeStoredValue(decoded.icon, this.currentColor);
            this.textureId = -1;
            if (emitChange) {
                this.changed("default", this.textureId, this.encodedValue, this);
            }
            this.store(this.encodedValue);
            this._needsLoad = true;
            return;
        }

        this.selectedSet = resolved.set || this.selectedSet;
        this.store(this.selectedSet, "set");

        const renderSpec = this._resolveRenderSpec(resolved);
        if (!renderSpec || !renderSpec.text) {
            this.encodedValue = this._encodeStoredValue(decoded.icon, this.currentColor);
            this.textureId = -1;
            if (emitChange) {
                this.changed("default", this.textureId, this.encodedValue, this);
            }
            this.store(this.encodedValue);
            this._needsLoad = true;
            return;
        }

        const canvas = this._renderIconCanvas(renderSpec);
        const cacheKey = JSON.stringify({
            key: resolved.key,
            text: renderSpec.text,
            size: this.params.size,
            padding: this.params.padding,
            color: this.currentColor,
            backgroundColor: this.params.backgroundColor,
            fontFamily: renderSpec.fontFamily,
            fontWeight: renderSpec.fontWeight
        });

        const textureId = this._uploadAtlasEntry(canvas, {
            width: canvas.width,
            height: canvas.height,
            cacheKey: cacheKey
        });

        this._setTexture(this._encodeStoredValue(decoded.icon, this.currentColor), textureId, { emitChange });
    }

    _decodeStoredValue(encodedValue) {
        const fallbackColor = this._normalizeColor(this.currentColor || this.params.color || "#111111");
        if (encodedValue && typeof encodedValue === "object") {
            return {
                icon: String(encodedValue.icon || encodedValue.default || ""),
                color: this._normalizeColor(encodedValue.color || fallbackColor)
            };
        }

        const raw = String(encodedValue || "").trim();
        if (!raw) {
            return { icon: "", color: fallbackColor };
        }

        if (raw.startsWith("{")) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    return {
                        icon: String(parsed.icon || parsed.default || ""),
                        color: this._normalizeColor(parsed.color || fallbackColor)
                    };
                }
            } catch (_) {
                // Legacy plain-string values remain supported.
            }
        }

        return { icon: raw, color: fallbackColor };
    }

    _encodeStoredValue(iconValue, colorValue) {
        return JSON.stringify({
            icon: String(iconValue || ""),
            color: this._normalizeColor(colorValue || this.currentColor || this.params.color || "#111111")
        });
    }

    _normalizeColor(colorValue) {
        const raw = String(colorValue || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) {
            return raw.toLowerCase();
        }
        if (/^#[0-9a-f]{3}$/i.test(raw)) {
            return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
        }
        return String(this.params.color || "#111111").toLowerCase();
    }

    _applyUiState(iconQuery, colorValue, preview, invalidate) {
        const nextEncodedValue = this._encodeStoredValue(iconQuery, colorValue);
        this.set(nextEncodedValue);
        this._renderIconPreview(preview, iconQuery);
        if (invalidate) {
            this.owner.invalidate();
        }
    }

    _resolveRenderSpec(resolved) {
        if (resolved.renderMode === "glyph") {
            return {
                text: resolved.glyph,
                fontFamily: resolved.fontFamily || this.params.glyphFontFamily,
                fontWeight: resolved.fontWeight || this.params.glyphFontWeight
            };
        }

        if (resolved.renderMode === "class") {
            return this._resolveFontClassRenderSpec(resolved.className, resolved);
        }

        return null;
    }

    _resolveFontClassRenderSpec(className, resolved) {
        if (typeof document === "undefined") {
            return null;
        }

        const probe = document.createElement("i");
        probe.className = className;
        probe.setAttribute("aria-hidden", "true");
        probe.style.position = "absolute";
        probe.style.left = "-10000px";
        probe.style.top = "-10000px";
        probe.style.fontSize = `${Math.max(16, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
        document.body.appendChild(probe);

        try {
            const pseudo = window.getComputedStyle(probe, "::before");
            let content = pseudo.getPropertyValue("content");
            if (!content || content === "none" || content === "normal") {
                const base = window.getComputedStyle(probe);
                content = base.getPropertyValue("content");
            }

            const text = this._decodeCssContent(content);
            if (!text) {
                return null;
            }

            return {
                text,
                fontFamily: pseudo.fontFamily || resolved.fontFamily,
                fontWeight: pseudo.fontWeight || resolved.fontWeight || "900"
            };
        } finally {
            probe.remove();
        }
    }

    _decodeCssContent(content) {
        if (!content || content === "none" || content === "normal") {
            return null;
        }

        let value = String(content).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        value = value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
            try {
                return String.fromCodePoint(Number.parseInt(hex, 16));
            } catch (_) {
                return "";
            }
        });

        value = value.replace(/\\\\/g, "\\");
        value = value.replace(/\\"/g, '"');
        value = value.replace(/\\'/g, "'");

        return value || null;
    }

    _renderIconCanvas(renderSpec) {
        const size = Math.max(16, Number.parseInt(this.params.size, 10) || 160);
        const padding = Math.max(0, Number.parseInt(this.params.padding, 10) || 0);

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, size, size);

        if (this.params.backgroundColor && this.params.backgroundColor !== "#00000000") {
            ctx.fillStyle = this.params.backgroundColor;
            ctx.fillRect(0, 0, size, size);
        }

        const availableSize = Math.max(8, size - (padding * 2));
        const measureAt = (fontSize) => {
            ctx.font = `${renderSpec.fontWeight || "400"} ${fontSize}px ${renderSpec.fontFamily || this.params.glyphFontFamily}`;
            return ctx.measureText(renderSpec.text);
        };

        let metrics = measureAt(size);
        let boundsWidth = Math.max(
            1,
            (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0),
            metrics.width || 0
        );
        let boundsHeight = Math.max(
            1,
            (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0),
            size * 0.7
        );
        const fitScale = Math.min(availableSize / boundsWidth, availableSize / boundsHeight);
        const fontSize = Math.max(8, Math.floor(size * fitScale));
        metrics = measureAt(fontSize);

        ctx.fillStyle = this.currentColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;

        const left = metrics.actualBoundingBoxLeft || 0;
        const right = metrics.actualBoundingBoxRight || metrics.width || 0;
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.75;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.25;
        const x = (size / 2) + ((left - right) / 2);
        const y = (size / 2) + ((ascent - descent) / 2);

        const strokeWidth = Math.max(1, fontSize * 0.035);
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = this.currentColor;
        ctx.strokeText(renderSpec.text, x, y);
        ctx.fillText(renderSpec.text, x, y);

        return canvas;
    }

    _renderIconPreview(node, query) {
        if (!node) {
            return;
        }

        node.innerHTML = "";

        const resolved = $.FlexRenderer.UIControls.IconLibrary.resolveAnyIconSpec(query, this.selectedSet);
        if (!resolved) {
            node.textContent = "?";
            node.title = "Unknown icon";
            return;
        }

        node.title = `${resolved.label} (${resolved.set})`;

        if (resolved.renderMode === "class") {
            const icon = document.createElement("i");
            icon.className = resolved.className;
            icon.setAttribute("aria-hidden", "true");
            icon.style.fontSize = `${Math.max(18, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
            icon.style.color = this.currentColor;
            node.appendChild(icon);
            return;
        }

        const span = document.createElement("span");
        span.textContent = resolved.glyph;
        span.style.fontFamily = resolved.fontFamily || this.params.glyphFontFamily;
        span.style.fontWeight = resolved.fontWeight || this.params.glyphFontWeight;
        span.style.fontSize = `${Math.max(18, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
        span.style.lineHeight = "1";
        span.style.color = this.currentColor;
        node.appendChild(span);
    }

    _renderIconResults(node, query) {
        if (!node) {
            return;
        }

        const maxResults = Math.max(20, Number.parseInt(this.params.maxResults, 10) || 120);
        const icons = $.FlexRenderer.UIControls.IconLibrary.searchAll(query, maxResults);

        node.innerHTML = icons.map(icon => {
            const previewHtml = icon.className
                ? `<i class="${icon.className} text-2xl" aria-hidden="true"></i>`
                : `<span class="text-2xl leading-none">${icon.glyph}</span>`;

            return `
<button type="button"
    class="icon-search-result btn btn-ghost h-auto py-2 flex flex-col items-center gap-1 normal-case font-normal"
    data-icon-name="${icon.name}"
    data-icon-set="${icon.set || ""}"
    title="${icon.name}">
<span class="inline-flex items-center justify-center w-8 h-8">${previewHtml}</span>
<span class="text-xs text-center leading-tight truncate max-w-full">${icon.name}</span>
<span class="text-[11px] text-center leading-tight opacity-60">${icon.set || ""}</span>
</button>`;
        }).join("");

        node.querySelectorAll("[data-icon-name]").forEach(button => {
            button.addEventListener("click", () => {
                const queryInput = document.getElementById(`${this.id}_query`);
                const preview = document.getElementById(`${this.id}_preview`);
                const popup = document.getElementById(`${this.id}_popup`);

                if (queryInput) {
                    queryInput.value = button.dataset.iconName;
                }

                this._applyIconSelection(button.dataset.iconName, preview, popup, button.dataset.iconSet || undefined);
            });
        });
    }

    _applyIconSelection(query, preview, popup, preferredSet = undefined) {
        if (preferredSet) {
            this.selectedSet = preferredSet;
            this.store(this.selectedSet, "set");
        }
        const colorInput = document.getElementById(`${this.id}_color`);
        this._applyUiState(query, colorInput ? colorInput.value : this.currentColor, preview, true);

        if (popup) {
            popup.style.display = "none";
        }
    }

    toHtml(classes = "", css = "") {
        const disabled = this.params.interactive ? "" : "disabled";
        const decodedColor = this._decodeStoredValue(this.encodedValue || this.params.default).color;
        // Positioning (`position: absolute`, top/right offsets, z-index, width
        // clamp) and the `display: none` toggle stay inline — init() flips
        // display directly, and these utilities don't compose cleanly as
        // single Tailwind classes. Visual styling delegates to daisyUI tokens
        // so the popover follows the host theme.
        const body = `<div id="${this.id}_root" class="er-control__widget er-control__widget--icon relative"${$.FlexRenderer.UIControls.styleAttr(css)}>
<div class="er-control__toolbar er-control__toolbar--icon flex items-center justify-between gap-2">
    <button id="${this.id}_trigger" type="button" class="er-control__button er-control__button--icon-trigger btn btn-square btn-outline" ${disabled}>
        <span id="${this.id}_preview" class="er-control__preview er-control__preview--icon inline-flex items-center justify-center w-full h-full">?</span>
    </button>
</div>
<div id="${this.id}_popup" class="er-control__popup er-control__popup--icon card card-compact bg-base-100 border border-base-300 shadow-lg"
     style="display: none; position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: min(420px, 90vw);">
    <div class="card-body p-3">
        <div class="er-control__popup-header er-control__popup-header--icon flex justify-between items-center mb-2">
            <span class="font-medium text-sm">Icon picker</span>
            <button id="${this.id}_close" type="button" class="er-control__button er-control__button--icon-close btn btn-ghost btn-xs btn-circle" aria-label="Close" ${disabled}>✕</button>
        </div>
        <div class="er-control__search er-control__search--icon flex items-center gap-2 mb-2">
            <input type="text" id="${this.id}_query" class="er-control__input er-control__input--icon-query input input-bordered input-sm flex-1" placeholder="Search icons, aliases, glyphs" ${disabled}>
            <input type="color" id="${this.id}_color" class="er-control__input er-control__input--icon-color w-10 h-10 rounded cursor-pointer" value="${decodedColor}" title="Icon color" ${disabled}>
        </div>
        <div id="${this.id}_results" class="er-control__results er-control__results--icon grid grid-cols-3 gap-2 max-h-[360px] overflow-auto"></div>
    </div>
</div>
</div>`;
        return $.FlexRenderer.UIControls.renderControl("icon", this.params.title, body, classes);
    }

    get layoutColumns() {
        return 1;
    }

    get supports() {
        return {
            title: "Icon",
            interactive: true,
            default: "",
            iconSet: "fa-solid-common",
            size: 160,
            padding: 4,
            color: "#111111",
            backgroundColor: "#00000000",
            previewSize: 34,
            maxResults: 120,
            glyphFontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
            glyphFontWeight: "400"
        };
    }

    get supportsAll() {
        return {
            iconSet: $.FlexRenderer.UIControls.IconLibrary.getSetNames()
        };
    }
};
$.FlexRenderer.UIControls.registerClass("icon", $.FlexRenderer.UIControls.Icon);

})(OpenSeadragon);

(function($) {
    /**
     * @interface OpenSeadragon.FlexRenderer.WebGLImplementation
     * Backend rendering contract used by `FlexRenderer`.
     *
     * Despite the historical name, this interface documents responsibilities that any GPU backend
     * is expected to match, including future WebGPU implementations. The concrete backend owns GPU
     * resources and shader programs. The outer renderer owns normalized inspector state, shader
     * ordering, and the decision of whether inspector behavior stays inline in the second pass or
     * is delegated to a backend-specific compositor path.
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

        get inspectorCompositorProgramKey() {
            throw("$.FlexRenderer.WebGLImplementation::inspectorCompositorProgram must be implemented!");
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
         * @param {Number} tiledImageCount number of tiled images carrying the levels
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels, tiledImageCount) {
            //no-op
        }

        /**
         * Set viewer background color, supports #RGBA syntax
         * @param (background)
         */
        setBackground(background) {
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
         * Reuse the current first-pass result and render the normal second pass into an offscreen target.
         *
         * Contract:
         * - consumes the same `renderArray` that would be passed to `secondPassProcessData(...)`
         * - must not mutate renderer-owned inspector state
         * - should render the normal second-pass composition, not apply special lens logic here
         * - returns a backend-owned target object that can later be consumed by compositor logic
         *
         * @param {SPRenderPackage[]} renderArray second-pass draw packages
         * @param {Object} [options={}]
         * @param {Object|string} [options.target] backend-owned render target object or stable target key
         * @param {string} [options.targetKey] stable target key used when `target` is omitted
         * @param {number} [options.width] target width in physical pixels
         * @param {number} [options.height] target height in physical pixels
         * @param {number[]} [options.clearColor] RGBA used when `renderArray` is empty
         * @return {Object}
         */
        renderSecondPassToTexture(renderArray, options = {}) {
            throw("$.FlexRenderer.WebGLImplementation::renderSecondPassToTexture() must be implemented!");
        }

        /**
         * Execute the backend-specific inspector compositor path for modes that cannot be expressed
         * inline in the normal second pass.
         *
         * Phase-1 contract:
         * - this hook is used only for `lens-zoom`
         * - reveal/A-B behavior must stay inside the normal second-pass program
         * - the backend should render the full second pass to an offscreen target and then run a
         *   cheap compositor over that full result
         * - no base/alternate texture semantics are part of the public contract
         *
         * The backend must read the canonical state from `renderer.getInspectorState()` and produce
         * the same visible result as the reference WebGL2 implementation for `lens-zoom`.
         *
         * @param {SPRenderPackage[]} renderArray second-pass draw packages
         * @param {Object} [options={}]
         * @param {GLint|null} [options.framebuffer]
         * @return {RenderOutput|Object}
         */
        processSecondPassWithInspector(renderArray, options = {}) {
            throw("$.FlexRenderer.WebGLImplementation::processSecondPassWithInspector() must be implemented!");
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
         * @param {RenderOptions|undefined} options used for now only for second pass, to specify which FBO to render to
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
        setDimensions(x, y, width, height, levels, tiledImageCount) {

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
         * Add an image. Returns a stable textureId.
         * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
         * @param {{
         *   width?: number,
         *   height?: number,
         * }} [opts]
         * @returns {number}
         */
        addImage(source, opts) {
            throw new Error('TextureAtlas2DArray.addImage: not implemented');
        }

        /**
         * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
         * @param textureUnit
         */
        bind(textureUnit) {}

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

    get inspectorCompositorProgramKey() {
        return "inspectorCompositor";
    }

    init() {
        this.firstAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);

        // TODO: make icons dynamic

        const countryIcon = new Image();
        countryIcon.src = "/icons/place/country-icon.png";
        countryIcon.onload = () => {
            this.firstAtlas.addImage(countryIcon);
        };

        const cityIcon = new Image();
        cityIcon.src = "/icons/place/city-icon.png";
        cityIcon.onload = () => {
            this.firstAtlas.addImage(cityIcon);
        };

        const villageIcon = new Image();
        villageIcon.src = "/icons/place/village-icon.png";
        villageIcon.onload = () => {
            this.firstAtlas.addImage(villageIcon);
        };

        this.secondAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        this._namedColorTargets = {};

        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.FirstPassProgram(this, this.gl, this.firstAtlas), "firstPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.SecondPassProgram(this, this.gl, this.secondAtlas), "secondPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.InspectorCompositorProgram(this, this.gl, this.secondAtlas), "inspectorCompositor");
    }

    getVersion() {
        return "2.0";
    }

    /**
     * Expose GLSL code for texture sampling.
     * @returns {string} glsl code for texture sampling
     */
    sampleTexture(index, vec2coords) {
        // todo make pack index configurable and use this instead of hardcoding functions inside shaderlayer sampleChannel(...)
        return `osd_texture(${index}, 0, ${vec2coords})`;
    }

    getTextureSize(index) {
        return `osd_texture_size(${index})`;
    }

    setDimensions(x, y, width, height, levels, tiledImageCount) {
        this.renderer.getProgram(this.firstPassProgramKey).setDimensions(x, y, width, height, levels, tiledImageCount);
        this.renderer.getProgram(this.secondPassProgramKey).setDimensions(x, y, width, height, levels, tiledImageCount);
        const compositor = this.renderer.getProgram(this.inspectorCompositorProgramKey);
        if (compositor) {
            compositor.setDimensions(x, y, width, height, levels, tiledImageCount);
        }
        //todo consider some elimination of too many calls
    }

    setBackground(background) {
        // todo this is not very nice, we need to call setBg before programs are compiled in a generic way, so
        //  we hit a case where first program is compiled and this setter called, while second program is not available
        const program = this.renderer.getProgram(this.secondPassProgramKey);
        if (!program) {
            return;
        }
        let hex = background.replace(/^#/, "").trim();
        if (hex.length === 6) {
            hex += "FF";
        }
        if (hex.length !== 8) {
            throw new Error("Hex must be RRGGBB or RRGGBBAA");
        }
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        this.renderer.getProgram(this.secondPassProgramKey)._bgColor = `vec4(${r.toFixed(6)}, ${g.toFixed(6)}, ${b.toFixed(6)}, ${a.toFixed(6)})`;
    }

    destroy() {
        if (this._namedColorTargets) {
            for (const key of Object.keys(this._namedColorTargets)) {
                this._destroyColorTarget(this._namedColorTargets[key]);
            }
            this._namedColorTargets = {};
        }
        this.firstAtlas.destroy();
        this.secondAtlas.destroy();
    }

    _createColorTarget(width, height, options = {}) {
        const gl = this.gl;
        const target = {
            key: options.key,
            width: width,
            height: height,
            ownsTexture: true,
            ownsFramebuffer: true,
        };
        const filter = options.filter || gl.LINEAR;
        target.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        target.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this._destroyColorTarget(target);
            throw new Error(`FlexRenderer color target is incomplete: 0x${status.toString(16)}`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return target;
    }

    _destroyColorTarget(target) {
        if (!target) {
            return;
        }
        const gl = this.gl;
        if (target.ownsFramebuffer && target.framebuffer) {
            gl.deleteFramebuffer(target.framebuffer);
            target.framebuffer = null;
        }
        if (target.ownsTexture && target.texture) {
            gl.deleteTexture(target.texture);
            target.texture = null;
        }
    }

    _ensureColorTarget(targetOrKey, width, height, options = {}) {
        let target = typeof targetOrKey === 'string' ? this._namedColorTargets[targetOrKey] : targetOrKey;
        const key = typeof targetOrKey === 'string' ? targetOrKey : (target && target.key);

        if (!target || target.width !== width || target.height !== height || !target.texture || !target.framebuffer) {
            if (target) {
                this._destroyColorTarget(target);
            }
            target = this._createColorTarget(width, height, {
                ...options,
                key: key,
            });
            if (key) {
                this._namedColorTargets[key] = target;
            }
        }

        return target;
    }

    _clearColorTarget(target, rgba = [0, 0, 0, 0]) {
        if (!target || !target.framebuffer) {
            return;
        }
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Reference implementation of the backend offscreen second-pass contract.
     * This renders the normal second pass exactly as it would appear on screen,
     * but into a reusable color target.
     */
    renderSecondPassToTexture(renderArray, options = {}) {
        const width = options.width || this.renderer.canvas.width || this.gl.drawingBufferWidth;
        const height = options.height || this.renderer.canvas.height || this.gl.drawingBufferHeight;
        const target = options.target ?
            this._ensureColorTarget(options.target, width, height, options) :
            this._ensureColorTarget(options.targetKey || '__second_pass_texture', width, height, options);

        if (!renderArray || !renderArray.length) {
            this._clearColorTarget(target, options.clearColor || [0, 0, 0, 0]);
            return target;
        }

        const program = this.renderer.getProgram(this.secondPassProgramKey);
        if (this.renderer.useProgram(program, 'second-pass')) {
            program.load(renderArray);
        }
        program.use(this.renderer.__firstPassResult, renderArray, {
            framebuffer: target.framebuffer
        });
        return target;
    }

    /**
     * Reference implementation of the phase-1 inspector compositor contract.
     * Only `lens-zoom` is routed here by the outer renderer. Reveal/A-B behavior
     * stays inside the normal second-pass shader.
     */
    processSecondPassWithInspector(renderArray, options = undefined) {
        const width = this.renderer.canvas.width || this.gl.drawingBufferWidth;
        const height = this.renderer.canvas.height || this.gl.drawingBufferHeight;

        const fullTarget = this._ensureColorTarget("__inspector_full", width, height, { filter: this.gl.LINEAR });

        this.renderSecondPassToTexture(renderArray, {
            target: fullTarget,
            width,
            height
        });

        const compositor = this.renderer.getProgram(this.inspectorCompositorProgramKey);
        if (this.renderer.useProgram(compositor, "inspector-compositor")) {
            compositor.load();
        }

        return compositor.use(undefined, undefined, {
            framebuffer: options ? options.framebuffer : null,
            inspectorState: this.renderer.getInspectorState(),
            fullTarget: fullTarget
        });
    }

    getBlendingFunction(name) {
        const h = `
float blendLum(vec3 c){return dot(c,vec3(.3,.59,.11));}
float blendSat(vec3 c){return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
vec3 clipColor(vec3 c){
    float l=blendLum(c),n=min(min(c.r,c.g),c.b),x=max(max(c.r,c.g),c.b);
    if(n<0.) c=l+((c-l)*l)/(l-n);
    if(x>1.) c=l+((c-l)*(1.-l))/(x-l);
    return c;
}
vec3 setLum(vec3 c,float l){return clipColor(c+vec3(l-blendLum(c)));}
vec3 setSat(vec3 c,float s){
    float mn=min(min(c.r,c.g),c.b),mx=max(max(c.r,c.g),c.b);
    if(mx<=mn) return vec3(0.);
    if(c.r<=c.g&&c.g<=c.b) return vec3(0.,((c.g-mn)*s)/(mx-mn),s);
    if(c.r<=c.b&&c.b<=c.g) return vec3(0.,s,((c.b-mn)*s)/(mx-mn));
    if(c.g<=c.r&&c.r<=c.b) return vec3(((c.r-mn)*s)/(mx-mn),0.,s);
    if(c.g<=c.b&&c.b<=c.r) return vec3(s,0.,((c.b-mn)*s)/(mx-mn));
    if(c.b<=c.r&&c.r<=c.g) return vec3(((c.r-mn)*s)/(mx-mn),s,0.);
    return vec3(s,((c.g-mn)*s)/(mx-mn),0.);
}`;

        return {
            mask: `
if (close(fg.a, 0.0)) return vec4(.0);
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
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(vec3(0.5), fg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            'soft-light': `
if (!stencilPasses) return bg;
vec3 d1=((16.0*bg.rgb-12.0)*bg.rgb+4.0)*bg.rgb,d2=sqrt(bg.rgb),D=mix(d1,d2,step(vec3(.25),bg.rgb));
vec3 rgb=mix(bg.rgb-(1.0-2.0*fg.rgb)*bg.rgb*(1.0-bg.rgb),bg.rgb+(2.0*fg.rgb-1.0)*(D-bg.rgb),step(vec3(.5),fg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            difference: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, abs(bg.rgb - fg.rgb));`,

            exclusion: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, bg.rgb + fg.rgb - 2.0 * bg.rgb * fg.rgb);`,

            hue: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(setSat(fg.rgb, blendSat(bg.rgb)), blendLum(bg.rgb)), 0.0, 1.0));`,

            saturation: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(setSat(bg.rgb, blendSat(fg.rgb)), blendLum(bg.rgb)), 0.0, 1.0));`,

            color: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(fg.rgb, blendLum(bg.rgb)), 0.0, 1.0));`,

            luminosity: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(bg.rgb, blendLum(fg.rgb)), 0.0, 1.0));`,
        }[name];
    }
};


$.FlexRenderer.WebGL20.SecondPassProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32) - 1; // subtracting 1 to allow texture atlas to be bound; TODO: only bind texture atlas when it is needed
        //todo this might be limiting in some wild cases... make it configurable..? or consider 1d texture
        this.textureMappingsUniformSize = 64;
        this._bgColor = 'vec4(.0)';
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
     * @param {string} customBlendFunctions ShaderLayers' GLSL code for custom blend functions
     * @param {Object} globalScopeCode ShaderLayers' glsl code shared between the their instantions
     * @returns {string} fragment shader's glsl code
     */
    _getFragmentShaderSource(definition, execution, customBlendFunctions, globalScopeCode) {
        const fragmentShaderSource = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2DArray;


// UNIFORMS

// Stores shader index -> pointer to u_instanceTextureIndexes
uniform int u_instanceOffsets[${this.textureMappingsUniformSize}];

// Stores texture indexes for each shader, beginning at index obtained from u_instanceOffsets
uniform int u_instanceTextureIndexes[${this.textureMappingsUniformSize}];

// Carries shader global attributes (opacity, pixelSize, imageOriginPx.xy)
uniform vec4 u_shaderVariables[${this.textureMappingsUniformSize}];

// Viewport zoom — identical across all shaders this frame, so kept as a scalar
// instead of duplicating per slot in u_shaderVariables.
uniform float u_zoom;

// For each tiled image, we store (base texture offset, pack count, channel count)
uniform ivec3 u_tiInfo[${this.textureMappingsUniformSize}];

uniform sampler2DArray u_inputTextures;
uniform sampler2DArray u_stencilTextures;

//  u_inspectorA = [
//     centerPx.x,
//     centerPx.y,
//     radiusPx,
//     featherPx
//   ];
//
//   u_inspectorB = [
//     enabled ? 1 : 0,
//     modeInt,
//     shaderSplitIndex,
//     lensZoom
//   ];
//
//   Mode mapping:
//   - 0 disabled
//   - 1 reveal-inside
//   - 2 reveal-outside
//   - 3 lens-zoom
uniform vec4 u_inspectorA;
uniform vec4 u_inspectorB;


// INPUT VARIABLES

in vec2 v_texture_coords;


// OUTPUT VARIABLES

layout(location=0) out vec4 final_color;


// GLOBAL VARIABLES

int instance_id;
bool stencilPasses;
float opacity;
float pixelSize;
float zoom;
vec2 imageOriginPx;


// FUNCTION DEFINITIONS

int osd_pack_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    return u_tiInfo[worldIndex].y;
}

int osd_channel_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    ivec3 info = u_tiInfo[worldIndex];
    if (info.z <= 0) {
        return info.y * 4;
    }
    return info.z;
}

vec4 osd_texture(int sourceIndex, int packIndex, vec2 coords) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    int base = u_tiInfo[worldIndex].x;
    int pc = u_tiInfo[worldIndex].y;
    packIndex = clamp(packIndex, 0, pc - 1);
    return texture(u_inputTextures, vec3(coords, float(base + packIndex)));
}

float osd_channel(int sourceIndex, int channelIndex, vec2 coords) {
    int pack = channelIndex >> 2;
    int comp = channelIndex & 3;
    vec4 v = osd_texture(sourceIndex, pack, coords);
         if (comp == 0) return v.r;
    else if (comp == 1) return v.g;
    else if (comp == 2) return v.b;
    else                return v.a;
}

vec4 osd_stencil_texture(int instance, int sourceIndex, vec2 coords) {
    int offset = u_instanceOffsets[instance];
    int index = u_instanceTextureIndexes[offset + sourceIndex];
    return texture(u_stencilTextures, vec3(coords, float(index)));
}

// todo index unused, but we might want to keep it (other rendering engines might need it on the API level, not necessarily here in GLSL)
ivec2 osd_texture_size(int sourceIndex) {
    return textureSize(u_inputTextures, 0).xy;
}

${this.atlas.getFragmentShaderDefinition()}

// UTILITY FUNCTION
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

bool inspector_enabled() {
    return u_inspectorB.x > 0.5;
}

int inspector_mode() {
    return int(round(u_inspectorB.y));
}

int inspector_shader_split_index() {
    return int(round(u_inspectorB.z));
}

float inspector_lens_zoom() {
    return max(u_inspectorB.w, 1.0);
}

float inspector_mask(vec2 fragPx) {
    float feather = max(u_inspectorA.w, 0.0001);
    float distPx = distance(fragPx, u_inspectorA.xy);
    float inner = max(u_inspectorA.z - feather, 0.0);
    float outer = max(u_inspectorA.z + feather, feather);
    return 1.0 - smoothstep(inner, outer, distPx);
}

float inspector_layer_alpha(int shaderSlot) {
    if (!inspector_enabled()) {
        return 1.0;
    }

    int mode = inspector_mode();
    if (mode != 1 && mode != 2) {
        return 1.0;
    }

    if (shaderSlot < inspector_shader_split_index()) {
        return 1.0;
    }

    float mask = inspector_mask(gl_FragCoord.xy);
    return mode == 1 ? mask : (1.0 - mask);
}


// BLEND FUNCTIONS

vec4 blendAlpha(vec4 fg, vec4 bg, vec3 rgb) {
    float a = fg.a + bg.a * (1.0 - fg.a);
    return vec4(rgb, a);
}

vec4 blend_source_over(vec4 fg, vec4 bg) {
    if (!stencilPasses) return bg;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    return pre_fg + bg * (1.0 - pre_fg.a);
}

// CUSTOM BLEND FUNCTIONS

${customBlendFunctions ? customBlendFunctions : "    // No custom blend functions here..."}


// GLOBAL SCOPE SHADER LAYER CODE

${Object.keys(globalScopeCode).length !== 0 ? Object.values(globalScopeCode).join("\n") : "    // No global scope shader layer code here..."}


// SHADER LAYERS DEFINITIONS

${definition !== "" ? definition : "    // No shader layer definitions here..."}


// MAIN FUNCTION

void main() {
${execution}
}`;

        return fragmentShaderSource;
    }

    build(shaderMap, keyOrder) {
        if (!keyOrder.length) {
            // Todo prevent unimportant first init build call
            this.vertexShader = this._getVertexShaderSource();
            this.fragmentShader = this._getFragmentShaderSource("", "", "", $.FlexRenderer.ShaderLayer.__globalIncludes);
            return;
        }

        const renderer = this.context && this.context.renderer;
        if (!renderer || typeof renderer.getFlatShaderLayers !== "function") {
            throw new Error(
                "$.FlexRenderer.WebGL20.SecondPassProgram::build: renderer.getFlatShaderLayers() is not available."
            );
        }

        const flatShaders = renderer.getFlatShaderLayers(shaderMap, keyOrder);
        for (let slot = 0; slot < flatShaders.length; slot++) {
            flatShaders[slot].__renderSlot = slot;
        }

        let definition = "";
        let execution = `
    vec4 intermediate_color = ${this._bgColor};
    vec4 overall_color = intermediate_color;
    vec4 clip_color = vec4(.0);

    vec4 attrs;
`;
        let customBlendFunctions = "";

        const addShaderDefinition = shader => {
            definition += `
// ${shader.uid} - Definition
${shader.getFragmentShaderDefinition()}

// ${shader.uid} - Custom blending function for a given shader
${shader.getCustomBlendFunction(shader.uid + "_blend_func")}

// ${shader.uid} - Shader code execution
vec4 ${shader.uid}_execution() {
${shader.getFragmentShaderExecution()}
}
`;
        };

        const getStencilPassCode = shader => {
            const shaderConfig = shader.getConfig();
            const hasSources = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length > 0;

            if (!hasSources) {
                return "    stencilPasses = true;";
            }

            return `    stencilPasses = osd_stencil_texture(${shader.__renderSlot}, 0, v_texture_coords).r > 0.995;`;
        };

        let remainingBlendShader = null;
        const getRemainingBlending = () => {
            if (!remainingBlendShader) {
                return "";
            }

            return `
${getStencilPassCode(remainingBlendShader)}
    overall_color = ${remainingBlendShader.mode === "show" ? "blend_source_over" : remainingBlendShader.uid + "_blend_func"}(intermediate_color, overall_color);
`;
        };

        for (const shaderLayerId of keyOrder) {
            const shaderLayer = shaderMap[shaderLayerId];
            const shaderLayerConfig = shaderLayer.getConfig();

            // Snapshot mutable assembly state so a throw mid-iteration (e.g. an
            // incompatible control's sample() throws from getFragmentShaderExecution)
            // can be rolled back cleanly and the offending layer emitted as disabled
            // instead of corrupting the GLSL source.
            const definitionSnapshot = definition;
            const executionSnapshot = execution;
            const customBlendSnapshot = customBlendFunctions;
            const remainingBlendSnapshot = remainingBlendShader;

            try {
                const slot = shaderLayer.__renderSlot;
                const opacityModifierBase = shaderLayer.opacity ? `opacity * ${shaderLayer.opacity.sample()}` : "opacity";
                const opacityModifier = `(${opacityModifierBase}) * inspector_layer_alpha(${slot})`;

            execution += `\n    // ${shaderLayer.uid}\n`;

            if (shaderLayerConfig.type === "none" || shaderLayerConfig.error || !shaderLayerConfig.visible) {
                if (shaderLayer._mode !== "clip") {
                    execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - Disabled (error or visible = false)
    intermediate_color = vec4(0.0);
`;
                    remainingBlendShader = shaderLayer;
                } else {
                    execution += `
    // ${shaderLayer.uid} - Disabled with Clipmask (error or visible = false)
    intermediate_color = ${shaderLayer.uid}_blend_func(vec4(0.0), intermediate_color);
`;
                }

                continue;
            }

            addShaderDefinition(shaderLayer);

            execution += `
    instance_id = ${slot};
${getStencilPassCode(shaderLayer)}
    attrs = u_shaderVariables[${slot}];
    opacity = attrs.x;
    pixelSize = attrs.y;
    imageOriginPx = attrs.zw;
    zoom = u_zoom;
`;

            if (shaderLayer._mode !== "clip") {
                execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - blending
    intermediate_color = ${shaderLayer.uid}_execution();
    intermediate_color.a = intermediate_color.a * ${opacityModifier};
`;
                remainingBlendShader = shaderLayer;
            } else {
                execution += `
    // ${shaderLayer.uid} - clipping
    clip_color = ${shaderLayer.uid}_execution();
    clip_color.a = clip_color.a * ${opacityModifier};
    intermediate_color = ${shaderLayer.uid}_blend_func(clip_color, intermediate_color);
`;
                }
            } catch (e) {
                $.console.error(`Failed to assemble shader '${shaderLayer.id}' (${shaderLayerConfig.type}). Hiding layer.`, e);
                shaderLayerConfig.error = true;
                definition = definitionSnapshot;
                execution = executionSnapshot;
                customBlendFunctions = customBlendSnapshot;
                remainingBlendShader = remainingBlendSnapshot;

                execution += `\n    // ${shaderLayer.uid}\n`;
                if (shaderLayer._mode !== "clip") {
                    execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - Disabled (assembly error)
    intermediate_color = vec4(0.0);
`;
                    remainingBlendShader = shaderLayer;
                } else {
                    execution += `
    // ${shaderLayer.uid} - Disabled with Clipmask (assembly error)
    intermediate_color = vec4(0.0);
`;
                }
            }
        }

        if (remainingBlendShader) {
            execution += getRemainingBlending();
        }

        execution += "\n    final_color = overall_color;\n";

        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource(
            definition,
            execution,
            customBlendFunctions,
            $.FlexRenderer.ShaderLayer.__globalIncludes
        );
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
        this._zoomLoc = gl.getUniformLocation(program, "u_zoom");

        this._texturesLocation = gl.getUniformLocation(program, "u_inputTextures");
        this._stencilLocation = gl.getUniformLocation(program, "u_stencilTextures");

        this._tiInfoLoc = gl.getUniformLocation(program, "u_tiInfo");
        this._inspectorALocation = gl.getUniformLocation(program, "u_inspectorA");
        this._inspectorBLocation = gl.getUniformLocation(program, "u_inspectorB");
        this.vao = gl.createVertexArray();

        // TODO: is this refreshing logic necessary? if enableing this, delete the above refresh, not needed, will be done at use(...)
        //  this._uploadedPackInfoVersion = -1;
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
        this._uploadTiledImageInfo();
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, renderArray, options) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, options ? options.framebuffer : null);
        gl.bindVertexArray(this.vao);

        // TODO: is refreshing necessary here?
        // Second-pass source layout can change without recompiling the program.
        // Refresh texture metadata uniforms every draw so helper wrappers around
        // osd_texture()/osd_channel() see the same layout as inline sampling.
        // this._uploadTiledImageInfo();

        const shaderVariables = [];
        const instanceOffsets = [];
        const instanceTextureIndexes = [];

        for (const renderInfo of renderArray) {
            renderInfo.shader.glDrawing(this.webGLProgram, gl);

            const origin = renderInfo.imageOriginPx || [0, 0];
            shaderVariables.push(renderInfo.opacity, renderInfo.pixelSize, origin[0], origin[1]);

            instanceOffsets.push(instanceTextureIndexes.length);
            instanceTextureIndexes.push(...renderInfo.shader.getConfig().tiledImages);
        }

        // todo _instanceOffsets and _instanceTextureIndexes are possibly static per program lifetime, so we could do this once at load()
        // Guard against empty arrays — WebGL2 raises INVALID_VALUE on uniform1iv with a zero-length array.
        // This happens for shaders with no tiledImages (e.g. the grid shader); leaving the GLSL fixed-size
        // uniform arrays at their defaults is fine since those shaders don't read these uniforms.
        if (instanceOffsets.length > 0) {
            gl.uniform1iv(this._instanceOffsets, instanceOffsets);
        }
        if (instanceTextureIndexes.length > 0) {
            gl.uniform1iv(this._instanceTextureIndexes, instanceTextureIndexes);
        }
        // todo changes dynamically, but could be stored per tiled image instead of per-shader layer
        gl.uniform4fv(this._shaderVariables, shaderVariables);
        gl.uniform1f(this._zoomLoc, renderArray.length > 0 ? renderArray[0].zoom : 1);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.texture);
        gl.uniform1i(this._texturesLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.stencil);
        gl.uniform1i(this._stencilLocation, 1);

        const inspectorState = this.context.renderer.getInspectorState();
        const inspectorMode = {
            "reveal-inside": 1,
            "reveal-outside": 2,
            "lens-zoom": 3
        }[inspectorState.mode] || 0;

        gl.uniform4f(
            this._inspectorALocation,
            inspectorState.centerPx.x,
            inspectorState.centerPx.y,
            inspectorState.radiusPx,
            inspectorState.featherPx
        );

        gl.uniform4f(
            this._inspectorBLocation,
            inspectorState.enabled ? 1 : 0,
            inspectorMode,
            inspectorState.shaderSplitIndex,
            inspectorState.lensZoom
        );

        this.atlas.bind(gl.TEXTURE2, 2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Unbinding textures removes feedback loop when we write to it in the first pass
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.bindVertexArray(null);

        return renderOutput;
    }

    _uploadTiledImageInfo() {
        const renderer = this.context.renderer;
        const packInfo = renderer.__flexPackInfo || {};
        const layout = packInfo.layout || {};
        const baseLayer = layout.baseLayer || [];
        const packCount = layout.packCount || [];
        const channelCount = packInfo.channelCount || [];

        const maxTI = this._tiledImageCount;
        const tiInfo = new Int32Array(maxTI * 3);

        for (let i = 0; i < maxTI; i++) {
            const base = (typeof baseLayer[i] === "number") ? baseLayer[i] : i;
            const pc = (typeof packCount[i] === "number") ? packCount[i] : 1;

            tiInfo[i * 3 + 0] = base;
            tiInfo[i * 3 + 1] = pc;
            tiInfo[i * 3 + 2] = (typeof channelCount[i] === "number") ? channelCount[i] : pc * 4;
        }

        this.gl.uniform3iv(this._tiInfoLoc, tiInfo);
    }

    /**
     * Destroy program. No arguments.
     */
    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    // TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
    setDimensions(x, y, width, height, levels, tiledImageCount) {
        this._dataLayerCount = levels;
        this._tiledImageCount = tiledImageCount;
    }
};

$.FlexRenderer.WebGL20.InspectorCompositorProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._width = 1;
        this._height = 1;
    }

    _getVertexShaderSource() {
        return `#version 300 es
precision mediump float;

out vec2 v_texture_coords;

const vec2 viewport[4] = vec2[4](
    vec2(-1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0)
);

void main() {
    vec2 clip = viewport[gl_VertexID];
    v_texture_coords = clip * 0.5 + 0.5;
    gl_Position = vec4(clip, 0.0, 1.0);
}
`;
    }

    _getFragmentShaderSource() {
        return `#version 300 es
precision mediump float;
precision mediump int;
precision mediump sampler2D;

uniform sampler2D u_fullTexture;
uniform vec2 u_viewportSize;
uniform vec2 u_lensCenterPx;
uniform float u_radiusPx;
uniform float u_featherPx;
uniform float u_lensZoom;
uniform int u_mode;
uniform int u_enabled;

in vec2 v_texture_coords;
layout(location=0) out vec4 final_color;

float inspector_mask(vec2 fragPx) {
  float feather = max(u_featherPx, 0.0001);
  float distPx = distance(fragPx, u_lensCenterPx);
  float inner = max(u_radiusPx - feather, 0.0);
  float outer = max(u_radiusPx + feather, feather);
  return 1.0 - smoothstep(inner, outer, distPx);
}

vec2 inspector_lens_uv(vec2 uv) {
  vec2 viewportSize = max(u_viewportSize, vec2(1.0));
  vec2 centerUv = u_lensCenterPx / viewportSize;
  float zoom = max(u_lensZoom, 1.0);
  return clamp(centerUv + (uv - centerUv) / zoom, vec2(0.0), vec2(1.0));
}

void main() {
  vec4 fullColor = texture(u_fullTexture, v_texture_coords);
  vec4 result = fullColor;

  if (u_enabled == 1 && u_mode == 3) {
      float mask = inspector_mask(gl_FragCoord.xy);
      vec4 lensColor = texture(u_fullTexture, inspector_lens_uv(v_texture_coords));
      result = mix(fullColor, lensColor, mask);
  }

  final_color = result;
}
`;
    }

    build() {
        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource();
    }

    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;
        this._width = width;
        this._height = height;
        this._fullTextureLoc = gl.getUniformLocation(program, 'u_fullTexture');
        this._viewportSizeLoc = gl.getUniformLocation(program, 'u_viewportSize');
        this._lensCenterLoc = gl.getUniformLocation(program, 'u_lensCenterPx');
        this._radiusLoc = gl.getUniformLocation(program, 'u_radiusPx');
        this._featherLoc = gl.getUniformLocation(program, 'u_featherPx');
        this._lensZoomLoc = gl.getUniformLocation(program, 'u_lensZoom');
        this._modeLoc = gl.getUniformLocation(program, 'u_mode');
        this._enabledLoc = gl.getUniformLocation(program, 'u_enabled');
        this.vao = gl.createVertexArray();
    }

    load() {
    }

    _modeToInt(mode) {
        return {
            'reveal-inside': 1,
            'reveal-outside': 2,
            'lens-zoom': 3,
        }[mode] || 0;
    }

    use(renderOutput, renderArray, options = {}) {
        const gl = this.gl;
        const fullTarget = options.fullTarget;
        const inspectorState = options.inspectorState || {};

        if (!fullTarget || !fullTarget.texture) {
            throw new Error('Inspector compositor requires a full color target.');
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, options.framebuffer === undefined ? null : options.framebuffer);
        gl.bindVertexArray(this.vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fullTarget.texture);
        gl.uniform1i(this._fullTextureLoc, 0);

        gl.uniform2f(this._viewportSizeLoc, this._width, this._height);
        gl.uniform2f(this._lensCenterLoc, inspectorState.centerPx ? inspectorState.centerPx.x || 0 : 0, inspectorState.centerPx ? inspectorState.centerPx.y || 0 : 0);
        gl.uniform1f(this._radiusLoc, inspectorState.radiusPx || 0);
        gl.uniform1f(this._featherLoc, inspectorState.featherPx || 0);
        gl.uniform1f(this._lensZoomLoc, inspectorState.lensZoom || 1);
        gl.uniform1i(this._modeLoc, this._modeToInt(inspectorState.mode));
        gl.uniform1i(this._enabledLoc, inspectorState.enabled ? 1 : 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);

        return {
            texture: fullTarget.texture,
        };
    }

    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    setDimensions(x, y, width, height) {
        this._width = width;
        this._height = height;
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
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32) - 1; // subtracting 1 to allow texture atlas to be bound; TODO: only bind texture atlas when it is needed
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
layout(location = 4) in vec4 a_payload0; // first 4 raster texture coords or vector positions and atlas texture ID (x, y, z, textureId)
layout(location = 5) in vec4 a_payload1; // second 4 raster texture coords or vector colors or icon parameters (x, y, width, height)

uniform vec2 u_renderClippingParams;
uniform mat3 u_geomMatrix;

flat out int instance_id;
out vec2 v_texture_coords;
out float v_vecDepth;
flat out int v_textureId;
out vec4 v_vecColor;

const vec3 viewport[4] = vec3[4] (
    vec3(0.0, 1.0, 1.0),
    vec3(0.0, 0.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 0.0, 1.0)
);

void main() {
    if (u_renderClippingParams.y > 0.5) {
        v_texture_coords = vec2((a_payload0.x - a_payload1.x) / a_payload1.z, (a_payload0.y - a_payload1.y) / a_payload1.w);
    } else {
        int vid = gl_VertexID & 3;
        v_texture_coords = (vid == 0) ? a_payload0.xy :
            (vid == 1) ? a_payload0.zw :
                (vid == 2) ? a_payload1.xy : a_payload1.zw;
    }

    mat3 matrix = u_renderClippingParams.y > 0.5 ? u_geomMatrix : a_transform_matrix;

    vec3 space_2d = u_renderClippingParams.x > 0.5 ?
        matrix * vec3(a_payload0.xy, 1.0) :
        matrix * viewport[gl_VertexID];

    v_vecDepth = a_payload0.z;
    v_textureId = int(a_payload0.w);
    v_vecColor = a_payload1;

    gl_Position = vec4(space_2d.xy, 1.0, space_2d.z);
    instance_id = gl_InstanceID;
}
`;
        this.fragmentShader = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2D;
precision mediump sampler2DArray;

uniform vec2 u_renderClippingParams;

flat in int instance_id;
in vec2 v_texture_coords;
in float v_vecDepth;
flat in int v_textureId;
in vec4 v_vecColor;

uniform sampler2DArray u_textures[${this._maxTextures}];
uniform int u_tileLayer;

${this.atlas.getFragmentShaderDefinition()}

layout(location=0) out vec4 outputColor;
layout(location=1) out vec4 outputStencil;

void main() {
    if (u_renderClippingParams.x < 0.5) {
        for (int i = 0; i < ${this._maxTextures}; i++) {
            if (i == instance_id) {
                 switch (i) {
    ${ this.printN(x =>
                    `case ${x}: outputColor = texture(u_textures[${x}], vec3(v_texture_coords, float(u_tileLayer))); break;`,
                this._maxTextures, "                ")}
                 }
                 break;
            }
        }

        outputStencil = vec4(1.0);
        gl_FragDepth = gl_FragCoord.z;
    } else if (u_renderClippingParams.y > 0.5) {
        // Vector geometry draw path (per-vertex color)

        vec4 stencil = vec4(1.0);
        float depth = v_vecDepth / 255.0; // 2 ^ 8 - 1; 6 bits for z and 2 bits for y and x; assuming the maximal zoom level of tiles to be 64 (no other implementations seem to go past 25 so this should be plenty)

        if (v_textureId < 0) {
            outputColor = v_vecColor;
        } else {
            vec4 texColor = osd_atlas_texture(v_textureId, v_texture_coords); // required for icon rendering, needs texture atlas to be bound; TODO: use osd_atlas_texture only when texture atlas is bound
            outputColor = texColor;

            if (texColor.a < 1.0) {
                stencil = vec4(0.0);
                depth = 0.0;
            }
        }

        outputStencil = stencil;
        gl_FragDepth = depth;
    } else {
        // Pure clipping path: write only to stencil (color target value is undefined)
        outputStencil = vec4(0.0);
        gl_FragDepth = 0.0;
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
        this._tileLayerLoc = gl.getUniformLocation(program, "u_tileLayer");

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

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        this.atlas.load(this.webGLProgram);
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, sourceArray, options) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.offScreenBuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.stencilClipBuffer);

        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GEQUAL);
        gl.clearDepth(0.0);

        gl.enable(gl.STENCIL_TEST);

        let isBlend = true;

        // this.fpTexture = this.fpTexture === this.colorTextureA ? this.colorTextureB : this.colorTextureA;
        // this.fpTextureClip = this.fpTextureClip === this.stencilTextureA ? this.stencilTextureB : this.stencilTextureA;
        this.fpTexture = this.colorTextureA;
        this.fpTextureClip = this.stencilTextureA;

        // Allocate reusable buffers once
        if (!this._tempMatrixData) {
            this._tempMatrixData = new Float32Array(this._maxTextures * 9);
            this._tempTexCoords = new Float32Array(this._maxTextures * 8);
        }

        let wasClipping = true; // force first init (~ as if was clipping was true)

        for (const renderInfo of sourceArray) {
            const rasterTiles = renderInfo.tiles;

            const attachments = [];

            const targetColorLayer   = renderInfo.dataIndex;
            const targetStencilLayer = renderInfo.stencilIndex;

            // for (let i = 0; i < 1; i++) {

            // color
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                this.colorTextureA, 0, targetColorLayer);
            attachments.push(gl.COLOR_ATTACHMENT0);

            // stencil
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1,
                this.stencilTextureA, 0, targetStencilLayer);
            attachments.push(gl.COLOR_ATTACHMENT0 + 1);

            //}

            gl.drawBuffers(attachments);

            const packIndex = (typeof renderInfo.packIndex === "number") ? renderInfo.packIndex : 0;
            gl.uniform1i(this._tileLayerLoc, packIndex);

            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

            this.atlas.bind(gl.TEXTURE0 + this._maxTextures, this._maxTextures); // TODO: find out if this could be run only once at setup

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
                // Tiles MUST NOT blend - alpha channel can carry data just like another channel payload
                if (isBlend) {
                    gl.disable(gl.BLEND);
                    isBlend = false;
                }
                isBlend = false;
                // Then draw join tiles
                gl.bindVertexArray(this.firstPassVao);
                let currentIndex = 0;
                while (currentIndex < tileCount) {
                    const batchSize = Math.min(this._maxTextures, tileCount - currentIndex);

                    for (let i = 0; i < batchSize; i++) {
                        const tile = rasterTiles[currentIndex + i];

                        gl.activeTexture(gl.TEXTURE0 + i);
                        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tile.texture);

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
                // Vectors MUST blend, as they can overlap within single layer
                if (!isBlend) {
                    gl.enable(gl.BLEND);
                    isBlend = true;
                }
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
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

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
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    batch = vectorTile.points;
                    if (batch) {
                        if (!vectorTile.fills && !vectorTile.lines) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    // TODO: find out if we can somehow combine points and icons
                    batch = vectorTile.icons;
                    if (batch) {
                        if (!vectorTile.fills && !vectorTile.lines && !vectorTile.points) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex icon parameters
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }
                }

                gl.uniform2f(this._renderClipping, 0, 0);
            }
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        // blending by default ON
        if (!isBlend) {
            gl.enable(gl.BLEND);
        }

        gl.bindVertexArray(null);

        if (!renderOutput) {
            renderOutput = {};
        }
        renderOutput.texture = this.fpTexture;
        renderOutput.stencil = this.fpTextureClip;
        renderOutput.textureDepth = this._dataLayerCount;
        renderOutput.stencilDepth = this._tiledImageCount;

        return renderOutput;
    }

    unload() {
    }

    setDimensions(x, y, width, height, dataLayerCount, tiledImageCount) {
        if (!width || !height || !dataLayerCount || !tiledImageCount) {
            // Defer — GL resources will be reallocated when real dimensions arrive.
            return;
        }

        // Double swapping required else collisions
        this._createOffscreenTexture("colorTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("colorTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._createOffscreenTexture("stencilTextureA", width, height, tiledImageCount, this.gl.LINEAR);
        // this._createOffscreenTexture("stencilTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._dataLayerCount = dataLayerCount;
        this._tiledImageCount = tiledImageCount;

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
        const gl = this.gl;
        const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

        layerCount = Math.max(layerCount, 1);

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
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(previousActiveTexture);
    }
};

})(OpenSeadragon);

(function ($) {
    // todo: support no-atlas mode (dont bind anything if not used at all)
    $.FlexRenderer.WebGL20.TextureAtlas2DArray = class extends $.FlexRenderer.TextureAtlas {

        constructor(gl, opts) {
            super(gl, opts);

            this.version = 1;
            this._atlasUploadedVersion = -1;
            this._metadataDirty = true;

            /** @type {{ id:number, source:any, w:number, h:number, layer:number, x:number, y:number }[]} */
            this._entries = [];
            this._pendingUploads = [];

            /** @type {{ shelves: { y:number, h:number, x:number }[], nextY:number }[]} */
            this._layerState = [];
            this._createTexture(this.layerWidth, this.layerHeight, this.layers);
        }


        /**
         * Add an image. Returns a stable textureId.
         * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
         * @param {{
         *   width?: number,
         *   height?: number,
         * }} [opts]
         * @returns {number}
         */
        addImage(source, opts) {
            const width = (opts && opts.width && typeof opts.width === 'number') ? opts.width :
                (source && (source.width || source.naturalWidth || (source.canvas && source.canvas.width) || source.w));
            const height = (opts && opts.height && typeof opts.height === 'number') ? opts.height :
                (source && (source.height || source.naturalHeight || (source.canvas && source.canvas.height) || source.h));

            if (!width || !height) {
                throw new Error('TextureAtlas2DArray.addImage: width or height missing');
            }

            const place = this._ensureCapacityFor(width, height);

            const id = this._entries.length;

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

            this._metadataDirty = true;
            this.version++;
            return id;
        }

        /**
         * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
         * @param textureUnit
         */
        bind(textureUnit, textureUnitIndex) {
            const gl = this.gl;

            // textureUnit is the numeric unit index (0..N-1)
            gl.activeTexture(textureUnit);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
            gl.uniform1i(this._atlasTexLoc, textureUnitIndex);
            gl.uniform1i(this._atlasWidthLoc, this.layerWidth);
            gl.uniform1i(this._atlasHeightLoc, this.layerHeight);
            gl.uniform1i(this._atlasMetadataRowsLoc, this._metadataRows());
            this._atlasUploadedVersion = this.version;
        }

        /**
         * Get WebGL Atlas shader code. This code must define the following function:
         * vec4 osd_atlas_texture(int, vec2)
         * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
         *
         * @return {string}
         */
        getFragmentShaderDefinition() {
            const metadataTexelsPerEntry = 3;
            return `
uniform sampler2DArray u_atlasTex;
uniform int u_atlasWidth;
uniform int u_atlasHeight;
uniform int u_atlasMetadataRows;

const int OSD_ATLAS_MAX_IDS = ${this.maxIds};
const int OSD_ATLAS_METADATA_TEXELS_PER_ENTRY = ${metadataTexelsPerEntry};
const int OSD_ATLAS_PADDING = ${this.padding};

int osd_atlas_unpack_u16(vec2 normalizedPair) {
ivec2 bytes = ivec2(round(clamp(normalizedPair, 0.0, 1.0) * 255.0));
return bytes.x | (bytes.y << 8);
}

ivec2 osd_atlas_meta_coord(int linearIndex, int atlasWidth) {
return ivec2(linearIndex % atlasWidth, linearIndex / atlasWidth);
}

vec4 osd_atlas_texture(int textureId, vec2 uv) {
if (textureId < 0 || textureId >= OSD_ATLAS_MAX_IDS) {
    // return purple for non-existent texture
    return vec4(1.0, 0.0, 1.0, 1.0);
}

int baseIndex = textureId * OSD_ATLAS_METADATA_TEXELS_PER_ENTRY;
ivec2 meta0Coord = osd_atlas_meta_coord(baseIndex, u_atlasWidth);
ivec2 meta1Coord = osd_atlas_meta_coord(baseIndex + 1, u_atlasWidth);
ivec2 meta2Coord = osd_atlas_meta_coord(baseIndex + 2, u_atlasWidth);

if (meta2Coord.y >= u_atlasMetadataRows) {
    return vec4(1.0, 0.0, 1.0, 1.0);
}

vec4 meta0 = texelFetch(u_atlasTex, ivec3(meta0Coord, 0), 0);
vec4 meta1 = texelFetch(u_atlasTex, ivec3(meta1Coord, 0), 0);
vec4 meta2 = texelFetch(u_atlasTex, ivec3(meta2Coord, 0), 0);

int packedLayer = osd_atlas_unpack_u16(meta2.rg);
if (packedLayer <= 0) {
    return vec4(1.0, 0.0, 1.0, 1.0);
}

int x = osd_atlas_unpack_u16(meta0.rg);
int y = osd_atlas_unpack_u16(meta0.ba);
int w = osd_atlas_unpack_u16(meta1.rg);
int h = osd_atlas_unpack_u16(meta1.ba);

// enable mirroring
uv = mod(uv, 2.0);
uv = uv - 1.0;
uv = sign(uv) * uv;
uv = 1.0 - uv;

vec2 atlasSize = vec2(float(u_atlasWidth), float(u_atlasHeight));
vec2 offset = vec2(float(x + OSD_ATLAS_PADDING), float(y + OSD_ATLAS_PADDING)) / atlasSize;
vec2 scale = vec2(float(w), float(h)) / atlasSize;
vec2 st = offset + uv * scale;

return texture(u_atlasTex, vec3(st, float(packedLayer)));
}
`;
        }

        /**
         * Load the current atlas uniform locations.
         * @param {WebGLProgram} program
         */
        load(program) {
            const gl = this.gl;

            this._atlasTexLoc    = gl.getUniformLocation(program, "u_atlasTex");
            this._atlasWidthLoc = gl.getUniformLocation(program, "u_atlasWidth");
            this._atlasHeightLoc = gl.getUniformLocation(program, "u_atlasHeight");
            this._atlasMetadataRowsLoc = gl.getUniformLocation(program, "u_atlasMetadataRows");
            this._commitUploads();
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

            if (!this._pendingUploads.length && !this._metadataDirty) {
                return;
            }

            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

            for (const u of this._pendingUploads) {
                const x = u.x + this.padding;
                const y = u.y + this.padding;
                const physicalLayer = u.layer + 1;
                this._uploadSubImage(gl, u.source, u.w, u.h, physicalLayer, x, y);
            }

            if (this._metadataDirty) {
                this._uploadMetadata(gl);
                this._metadataDirty = false;
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
            const metadataRows = Math.ceil((this.maxIds * 3) / Math.max(w, 1));
            const height = Math.max(h, metadataRows || 1);
            const physicalDepth = Math.max(depth + 1, 2);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, this.internalFormat, w, height, physicalDepth);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            this.layerWidth = w;
            this.layerHeight = height;
            this.layers = depth;
            this._physicalLayers = physicalDepth;
            this._metadataDirty = true;

            // reset packer state sized to current depth
            this._layerState = [];
            for (let i = 0; i < depth; i++) {
                this._layerState.push({ shelves: [], nextY: 0 });
            }
        }

        _ensureCapacityFor(width, height) {
            const paddedWidth = width + 2 * this.padding;
            const paddedHeight = height + 2 * this.padding;

            // try current layers first
            for (let li = 0; li < this.layers; li++) {
                const pos = this._tryPlaceRect(li, paddedWidth, paddedHeight);
                if (pos) {
                    return { layer: li, x: pos.x, y: pos.y, willRealloc: false };
                }
            }

            // if rectangle is bigger than layer extent, grow extent (power of 2)
            let newW = this.layerWidth;
            let newH = this.layerHeight;
            if (paddedWidth > newW || paddedHeight > newH) {
                while (newW < paddedWidth) {
                    newW *= 2;
                }
                while (newH < paddedHeight) {
                    newH *= 2;
                }
                // reallocate texture with same layer count but bigger extent
                this._resizeAndReupload(newW, newH, this.layers);
            }

            // try again after extent growth
            for (let li = 0; li < this.layers; li++) {
                const pos2 = this._tryPlaceRect(li, paddedWidth, paddedHeight);
                if (pos2) {
                    return { layer: li, x: pos2.x, y: pos2.y, willRealloc: false };
                }
            }

            // still not fitting due to fragmentation / filled layers: add one or more layers
            let newLayers = Math.max(this.layers * 2, this.layers + 1);
            this._resizeAndReupload(this.layerWidth, this.layerHeight, newLayers);

            // after adding layers there will be empty layers to place into
            const li = this._firstEmptyLayer();
            const pos3 = this._tryPlaceRect(li, paddedWidth, paddedHeight);
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

            this._metadataDirty = true;
            this.version++;
        }

        _tryPlaceRect(layerIndex, w, h) {
            const W = this.layerWidth;
            const H = this.layerHeight;
            let st = this._layerState[layerIndex];

            if (!st) {
                // todo it happens that the _layerState is empty but plaing called! this is a bug
                $.console.error('TextureAtlas2DArray._tryPlaceRect: invalid layerIndex');
                this._createTexture(W, H, this.layers);
                st = this._layerState[layerIndex];
            }

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
            const physicalLayer = layer + 1;
            this._uploadSubImage(gl, source, w, h, physicalLayer, x, y);

            // optional: no mipmaps for now (icon UI)
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        }

        _uploadSubImage(gl, source, w, h, physicalLayer, x, y) {
            const isDomImageSource = source instanceof ImageBitmap ||
                (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
                (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement);

            if (isDomImageSource) {
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                try {
                    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source);
                } finally {
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                }
                return;
            }

            if (source && source.data && typeof source.width === 'number' && typeof source.height === 'number') {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source.data);
                return;
            }

            if (source && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source);
                return;
            }

            throw new Error('Unsupported image source for atlas');
        }

        _metadataRows() {
            return Math.ceil((this.maxIds * 3) / Math.max(this.layerWidth, 1));
        }

        _metadataCoord(linearIndex) {
            return {
                x: linearIndex % this.layerWidth,
                y: Math.floor(linearIndex / this.layerWidth)
            };
        }

        _uploadMetadata(gl) {
            const rows = this._metadataRows();
            if (rows < 1) {
                return;
            }

            const texels = new Uint8Array(this.layerWidth * rows * 4);
            const pack16 = (value) => {
                const safe = Math.max(0, Math.min(65535, Number.parseInt(value, 10) || 0));
                return [safe & 255, (safe >> 8) & 255];
            };

            for (const ent of this._entries) {
                const baseIndex = ent.id * 3;
                const coords = [
                    this._metadataCoord(baseIndex),
                    this._metadataCoord(baseIndex + 1),
                    this._metadataCoord(baseIndex + 2)
                ];
                const texelOffset0 = (coords[0].y * this.layerWidth + coords[0].x) * 4;
                const texelOffset1 = (coords[1].y * this.layerWidth + coords[1].x) * 4;
                const texelOffset2 = (coords[2].y * this.layerWidth + coords[2].x) * 4;
                const x = pack16(ent.x);
                const y = pack16(ent.y);
                const w = pack16(ent.w);
                const h = pack16(ent.h);
                const physicalLayer = pack16(ent.layer + 1);

                texels[texelOffset0 + 0] = x[0];
                texels[texelOffset0 + 1] = x[1];
                texels[texelOffset0 + 2] = y[0];
                texels[texelOffset0 + 3] = y[1];

                texels[texelOffset1 + 0] = w[0];
                texels[texelOffset1 + 1] = w[1];
                texels[texelOffset1 + 2] = h[0];
                texels[texelOffset1 + 3] = h[1];

                texels[texelOffset2 + 0] = physicalLayer[0];
                texels[texelOffset2 + 1] = physicalLayer[1];
                texels[texelOffset2 + 2] = 0;
                texels[texelOffset2 + 3] = 255;
            }

            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.layerWidth, rows, 1, this.format, this.type, texels);
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
            this._managedShaderSourceSlots = new Map();
            this._managedShaderSourceNextIndex = null;
            // We have 'undefined' extra format for blank tiles
            this._supportedFormats = ["rasterBlob", "context2d", "image", "vector-mesh", "gpuTextureSet", "undefined"];
            this.rebuildCounter = 0;

            this._suspendRenderingDepth = 0;
            this._pendingRebuildRequest = null;
            this._drawReady = false;

            // reject listening for the tile-drawing and tile-drawn events, which this drawer does not fire
            this.viewer.rejectEventHandler("tile-drawn", "The WebGLDrawer does not raise the tile-drawn event");
            this.viewer.rejectEventHandler("tile-drawing", "The WebGLDrawer does not raise the tile-drawing event");
            this.viewer.world.addHandler("remove-item", (e) => {
                const tiledImage = e.item;
                if (tiledImage && tiledImage.__flexManagedShaderSourceSlotKey) {
                    const slot = this._managedShaderSourceSlots.get(tiledImage.__flexManagedShaderSourceSlotKey);
                    if (slot && slot.item === tiledImage) {
                        slot.item = null;
                    }
                }
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
                handleNavigator: true,
                shaderSourceResolver: null,
                // hex bg color, by default transparent
                backgroundColor: undefined
            };
        }

        /**
         * Override the default configuration: the renderer will use given shaders,
         * supplied with data from collection of TiledImages, to render.
         * TiledImages are treated only as data sources, the rendering outcome is fully in controls of the shader specs.
         * @param {Object.<string, ShaderConfig>} shaders map of id -> shader config value
         * @param {Array<string>} [shaderOrder=undefined] custom order of shader ids to render.
         * @param {Object} [options]
         * @param {Boolean} [options.immediate=false] if true, run the rebuild synchronously
         *      (program registration + dimensions update) instead of deferring via setTimeout.
         *      Required when the caller intends to draw immediately after configuring.
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        overrideConfigureAll(shaders, shaderOrder = undefined, options = {}) {
            // todo reset also when reordering tiled images!
            // or we could change order only

            if (this.options.handleNavigator && this.viewer.navigator) {
                this.viewer.navigator.drawer.overrideConfigureAll(shaders, shaderOrder, options);
            }

            const willBeConfigured = !!shaders;
            if (!willBeConfigured) {
                if (this._configuredExternally) {
                    this._configuredExternally = false;
                    // If we changed render style, recompile everything
                    this.renderer.deleteShaders();
                    return $.Promise.all(this.viewer.world._items.map(item => this.tiledImageCreated(item).id));
                }
                return $.Promise.resolve();
            }

            // If custom rendering used, use arbitrary external configuration
            this._configuredExternally = true;
            this.renderer.deleteShaders();

            const requestedOrder = shaderOrder || Object.keys(shaders);
            const createdOrder = [];

            for (const shaderId of requestedOrder) {
                const sanitized = $.FlexRenderer.sanitizeKey(shaderId);
                if (this.renderer._shaders[sanitized]) {
                    this.renderer.removeShader(sanitized);
                }
                const shader = this.renderer.createShaderLayer(shaderId, shaders[shaderId], true);
                if (shader) {
                    createdOrder.push(shaderId);
                }
            }
            this.renderer.setShaderLayerOrder(createdOrder);

            shaderOrder = shaderOrder || Object.keys(shaders);
            this.renderer.setShaderLayerOrder(shaderOrder);

            this.renderer.notifyVisualizationChanged({
                reason: "external-config",
                external: true
            });

            return this._requestRebuild(0, false, false, !!(options && options.immediate));
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

            shader.id = shader.id || (tiledImage.__shaderConfig && tiledImage.__shaderConfig.id) || this.constructor.idGenerator;
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

            this.renderer.notifyVisualizationChanged({
                reason: "configure-tiled-image",
                shaderId: shader.id
            });

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

            if (tiledImage.__flexManagedShaderSourceSlotKey) {
                return this._requestRebuild();
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

        _applyShaderConfigMutationRequest(request = {}, syncNavigator = true) {
            const {
                shaderId,
                mutation,
                refreshShader = true,
                rebuildProgram = true,
                rebuildDrawer = true,
                resetItems = true,
                reason = "shader-config-mutation"
            } = request;

            if (!shaderId) {
                return $.Promise.resolve();
            }

            const shader = this.renderer.getShaderLayer(shaderId);
            if (!shader) {
                return $.Promise.resolve();
            }

            const config = shader.getConfig();
            if (typeof mutation === "function") {
                mutation(config, shader);
            } else if (mutation && typeof mutation === "object") {
                Object.assign(config, mutation);
            }

            if (refreshShader) {
                this.renderer.refreshShaderLayer(shaderId, { rebuildProgram });
            } else if (rebuildProgram) {
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
            }

            this.renderer.notifyVisualizationChanged({
                reason,
                shaderId,
                shaderType: shader.constructor.type()
            });

            if (
                syncNavigator &&
                !request.drawerLocalWorldIndex &&
                this.options.handleNavigator &&
                this.viewer.navigator &&
                this.viewer.navigator.drawer
            ) {
                this.viewer.navigator.drawer._applyShaderConfigMutationRequest(request, false);
            }

            if (resetItems && this.viewer.world && typeof this.viewer.world.resetItems === "function") {
                this.viewer.world.resetItems();
            }

            if (rebuildDrawer) {
                return this._requestRebuild(0, true);
            }
            this.viewer.forceRedraw();
            return $.Promise.resolve();
        }

        _handleRefetchRequest(request = undefined) {
            if (!request) {
                return this.viewer.world.resetItems();
            }

            if (request.kind === "shader-source-request") {
                return this._handleShaderSourceRequest(request);
            }

            if (request.kind === "shader-config-mutation") {
                return this._applyShaderConfigMutationRequest(request);
            }

            return this.viewer.world.resetItems();
        }

        _getManagedShaderSourceSlotKey(request = {}) {
            return `${request.shaderId || "shader"}:${Number.parseInt(request.sourceIndex, 10) || 0}`;
        }

        _allocateManagedShaderSourceWorldIndex() {
            const worldCount = this.viewer && this.viewer.world ? this.viewer.world.getItemCount() : 0;
            if (!Number.isInteger(this._managedShaderSourceNextIndex)) {
                this._managedShaderSourceNextIndex = worldCount;
            } else {
                this._managedShaderSourceNextIndex = Math.max(this._managedShaderSourceNextIndex, worldCount);
            }
            return this._managedShaderSourceNextIndex++;
        }

        _isManagedShaderSourceDescriptor(entry) {
            return !!(entry && typeof entry === "object" && (
                entry.tileSource !== undefined ||
                entry.source !== undefined ||
                entry.open !== undefined ||
                entry.openOptions !== undefined
            ));
        }

        _normalizeManagedShaderSourceDescriptor(entry = {}) {
            const descriptor = $.extend(true, {}, entry);
            const openOptions = $.extend(true, {},
                descriptor.openOptions || descriptor.open || {}
            );
            const tileSource = descriptor.tileSource !== undefined ? descriptor.tileSource : descriptor.source;

            delete descriptor.openOptions;
            delete descriptor.open;
            delete descriptor.tileSource;
            delete descriptor.source;

            return {
                tileSource,
                openOptions,
                meta: descriptor
            };
        }

        _openManagedShaderSourceAtSlot(slot, descriptor, request = {}) {
            const normalized = this._normalizeManagedShaderSourceDescriptor(descriptor);
            if (normalized.tileSource === undefined) {
                return $.Promise.reject(new Error("Managed shader source descriptor requires tileSource or source."));
            }

            const shader = request.shaderId ? this.renderer.getShaderLayer(request.shaderId) : null;
            const sourceIndex = Number.parseInt(request.sourceIndex, 10) || 0;
            const referenceItem = shader && typeof shader.getSourceTiledImage === "function"
                ? shader.getSourceTiledImage(sourceIndex)
                : null;

            const openOptions = $.extend(true, {
                opacity: 0,
                preload: false,
                preserveViewport: true
            }, normalized.openOptions || {}, {
                tileSource: normalized.tileSource
            });

            delete openOptions.index;
            delete openOptions.replace;

            if (referenceItem) {
                const bounds = referenceItem.getBoundsNoRotate(true);

                if (openOptions.x === undefined && openOptions.y === undefined && !openOptions.position) {
                    openOptions.x = bounds.x;
                    openOptions.y = bounds.y;
                }

                if (openOptions.width === undefined && openOptions.height === undefined) {
                    openOptions.width = bounds.width;
                }

                if (openOptions.clip === undefined && referenceItem.getClip) {
                    const clip = referenceItem.getClip();
                    if (clip) {
                        openOptions.clip = clip;
                    }
                }

                if (openOptions.rotation === undefined && typeof referenceItem.getRotation === "function") {
                    openOptions.rotation = referenceItem.getRotation();
                }

                if (openOptions.flipped === undefined && typeof referenceItem.getFlip === "function") {
                    openOptions.flipped = referenceItem.getFlip();
                }
            }

            return new $.Promise((resolve, reject) => {
                const success = openOptions.success;
                const error = openOptions.error;

                openOptions.success = (event) => {
                    const item = event && event.item ? event.item : null;
                    const worldIndex = item && this.viewer.world
                        ? this.viewer.world.getIndexOfItem(item)
                        : -1;

                    if (item) {
                        item.__flexManagedShaderSourceSlotKey = slot.key;
                        slot.item = item;
                        slot.worldIndex = worldIndex;
                    }

                    if (typeof success === "function") {
                        success(event);
                    }

                    resolve({
                        worldIndex,
                        tiledImage: item
                    });
                };

                openOptions.error = (event) => {
                    if (typeof error === "function") {
                        error(event);
                    }
                    reject(new Error(event && event.message ? event.message : "Failed to open managed shader source."));
                };

                this.viewer.addTiledImage(openOptions);
            });
        }

        realizeShaderSourceDescriptor(request = {}, descriptor = undefined) {
            const entry = descriptor === undefined ? request.entry : descriptor;
            if (!this._isManagedShaderSourceDescriptor(entry)) {
                return $.Promise.resolve(null);
            }

            const slotKey = this._getManagedShaderSourceSlotKey(request);
            let slot = this._managedShaderSourceSlots.get(slotKey);
            if (!slot) {
                slot = {
                    key: slotKey,
                    worldIndex: this._allocateManagedShaderSourceWorldIndex(),
                    item: null
                };
                this._managedShaderSourceSlots.set(slotKey, slot);
            }

            return this._openManagedShaderSourceAtSlot(slot, entry, request).then(result => ({
                worldIndex: result.worldIndex,
                refreshShader: false,
                rebuildProgram: false,
                rebuildDrawer: true,
                resetItems: false,
                drawerLocalWorldIndex: true
            }));
        }

        _resolveSourceRequestResult(request, result) {
            if (result === undefined || result === null || result === false) {
                return null;
            }

            if (Number.isInteger(result)) {
                return {
                    mutation: (config) => {
                        const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                        tiledImages[request.sourceIndex || 0] = result;
                        config.tiledImages = tiledImages;
                    }
                };
            }

            if (Array.isArray(result)) {
                return {
                    mutation: (config) => {
                        config.tiledImages = result.slice();
                    }
                };
            }

            if (typeof result === "object") {
                if (Array.isArray(result.tiledImages)) {
                    return {
                        ...result,
                        mutation: result.mutation || ((config) => {
                            config.tiledImages = result.tiledImages.slice();
                        })
                    };
                }
                if (Number.isInteger(result.worldIndex)) {
                    return {
                        ...result,
                        mutation: result.mutation || ((config) => {
                            const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                            tiledImages[request.sourceIndex || 0] = result.worldIndex;
                            config.tiledImages = tiledImages;
                        })
                    };
                }
                if (typeof result.mutation === "function") {
                    return result;
                }
            }

            return null;
        }

        _handleShaderSourceRequest(request = {}) {
            const shader = request.shaderId ? this.renderer.getShaderLayer(request.shaderId) : null;
            if (!shader) {
                return $.Promise.resolve();
            }

            const directWorldIndex = Number.parseInt(request.entry, 10);
            if (Number.isFinite(directWorldIndex) && String(directWorldIndex) === String(request.entry).trim()) {
                return this._applyShaderConfigMutationRequest({
                    ...request,
                    kind: "shader-config-mutation",
                    mutation: (config) => {
                        const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                        tiledImages[request.sourceIndex || 0] = directWorldIndex;
                        config.tiledImages = tiledImages;
                    },
                    reason: request.reason || "shader-source-request",
                    refreshShader: request.refreshShader !== false,
                    rebuildProgram: request.rebuildProgram !== false,
                    rebuildDrawer: request.rebuildDrawer !== false,
                    resetItems: request.resetItems !== false
                });
            }

            if (this._isManagedShaderSourceDescriptor(request.entry)) {
                return this.realizeShaderSourceDescriptor(request).then(resolved => {
                    if (!resolved) {
                        return $.Promise.resolve();
                    }
                    const mutationSpec = this._resolveSourceRequestResult(request, resolved);
                    if (!mutationSpec) {
                        return $.Promise.resolve();
                    }
                    return this._applyShaderConfigMutationRequest({
                        ...request,
                        ...resolved,
                        ...mutationSpec,
                        kind: "shader-config-mutation",
                        reason: request.reason || resolved.reason || "shader-source-request"
                    });
                });
            }

            const resolver = this.options.shaderSourceResolver;
            if (typeof resolver !== "function") {
                $.console.warn("Shader source request received but no drawer.options.shaderSourceResolver is configured.", request);
                return $.Promise.resolve();
            }

            const outcome = resolver({
                request,
                drawer: this,
                viewer: this.viewer,
                renderer: this.renderer,
                shader,
                shaderConfig: shader.getConfig()
            });

            return $.Promise.resolve(outcome).then(result => {
                if (this._isManagedShaderSourceDescriptor(result)) {
                    return this.realizeShaderSourceDescriptor(request, result).then(realized =>
                        realized ? (() => {
                            const mutationSpec = this._resolveSourceRequestResult(request, realized);
                            if (!mutationSpec) {
                                return $.Promise.resolve();
                            }
                            return this._applyShaderConfigMutationRequest({
                                ...request,
                                ...realized,
                                ...mutationSpec,
                                kind: "shader-config-mutation",
                                reason: request.reason || realized.reason || "shader-source-request"
                            });
                        })() : $.Promise.resolve()
                    );
                }

                const resolved = this._resolveSourceRequestResult(request, result);
                if (!resolved) {
                    return $.Promise.resolve();
                }

                return this._applyShaderConfigMutationRequest({
                    ...request,
                    ...resolved,
                    kind: "shader-config-mutation",
                    reason: request.reason || resolved.reason || "shader-source-request",
                    refreshShader: resolved.refreshShader !== false,
                    rebuildProgram: resolved.rebuildProgram !== false,
                    rebuildDrawer: resolved.rebuildDrawer !== false,
                    resetItems: resolved.resetItems !== false
                });
            });
        }

        /**
         * This methods can suspend viewer animation, for example when
         * you are still in the process of modifying the viewer state
         * and the viewer is forced to re-render unfinished configuration(s).
         * @param reason
         */
        suspendRendering(reason = "manual") {
            this._suspendRenderingDepth++;
            this._drawReady = false;
            if (this._rebuildHandle) {
                clearTimeout(this._rebuildHandle);
                this._rebuildHandle = null;
            }
        }

        resumeRendering(reason = "manual") {
            if (this._suspendRenderingDepth > 0) {
                this._suspendRenderingDepth--;
            }
            if (this._suspendRenderingDepth > 0) {
                return;
            }

            const pending = this._pendingRebuildRequest;
            this._pendingRebuildRequest = null;

            if (pending) {
                this._requestRebuild(pending.timeout, pending.force, true);
            } else {
                this._refreshDrawReadyState();
                this.viewer.forceRedraw();
            }
        }

        _isRenderingSuspended() {
            return this._suspendRenderingDepth > 0;
        }

        _refreshDrawReadyState() {
            const canvas = this.canvas;
            this._drawReady = !this._isRenderingSuspended() &&
                !!canvas &&
                canvas.width > 0 &&
                canvas.height > 0 &&
                !this._hasInvalidBuildState();
            return this._drawReady;
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

        // todo documment
        getPackCount(ti) {
            const world = this.viewer.world;
            if (!world) {
                return 1;
            }

            let tiledImage = ti;
            if (typeof ti === "number") {
                tiledImage = world.getItemAt(ti);
            }
            if (!tiledImage) {
                return 1;
            }

            return tiledImage.__flexPackCount || 1;
        }

        getChannelCount(ti) {
            const world = this.viewer.world;
            if (!world) {
                return 4;
            }

            let tiledImage = ti;
            if (typeof ti === "number") {
                tiledImage = world.getItemAt(ti);
            }
            if (!tiledImage) {
                return 4;
            }

            // fall back to packCount * 4, preserving old semantics
            if (typeof tiledImage.__flexChannelCount === "number") {
                return tiledImage.__flexChannelCount;
            }
            const pc = tiledImage.__flexPackCount || 1;
            return pc * 4;
        }

        _hasInvalidBuildState() {
            return this._requestBuildStamp > this._buildStamp;
        }

        _requestRebuild(timeout = 30, force = false, bypassSuspend = false, immediate = false) {
            this._requestBuildStamp = Date.now();
            this._drawReady = false;

            if (!bypassSuspend && this._isRenderingSuspended()) {
                const pending = this._pendingRebuildRequest || { timeout, force };
                pending.timeout = Math.min(pending.timeout, timeout);
                pending.force = pending.force || force;
                this._pendingRebuildRequest = pending;
                return $.Promise.resolve();
            }

            if (this._rebuildHandle) {
                if (!force && !immediate) {
                    return $.Promise.resolve();
                }
                clearTimeout(this._rebuildHandle);
                this._rebuildHandle = null;
            }

            const runRebuild = () => {
                if (this._isRenderingSuspended()) {
                    this._pendingRebuildRequest = { timeout: 0, force: true };
                    this._rebuildHandle = null;
                    this._drawReady = false;
                    return;
                }

                if (this._destroyed) {
                    this._rebuildHandle = null;
                    return;
                }

                if (!this._configuredExternally) {
                    this.renderer.setShaderLayerOrder(this.viewer.world._items.map(item => item.__shaderConfig.id));
                }

                this._buildStamp = Date.now();
                this.renderer.setDimensions(
                    0,
                    0,
                    this.canvas.width,
                    this.canvas.height,
                    this._computeOffscreenLayerCount(),
                    this.viewer.world.getItemCount()
                );
                this._updatePackLayout();
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.rebuildCounter++;
                this._rebuildHandle = null;
                this._refreshDrawReadyState();

                if (!immediate) {
                    setTimeout(() => {
                        if (!this._isRenderingSuspended()) {
                            this.viewer.forceRedraw();
                        }
                    });
                }
            };

            if (immediate) {
                runRebuild();
            } else {
                this._rebuildHandle = setTimeout(runRebuild, timeout);
            }

            return $.Promise.resolve();
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

                //todo batched?
                this.renderer.setDimensions(0, 0, viewportSize.x, viewportSize.y, this._computeOffscreenLayerCount(), this.viewer.world.getItemCount());
                this._size = viewportSize;
                this._refreshDrawReadyState();
            };
            this.viewer.addHandler("resize", this._resizeHandler);
        }

        _resolveRenderView(view = undefined) {
            if (view) {
                return view;
            }

            const bounds = this.viewport.getBoundsNoRotateWithMargins(true);
            return {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: this.viewport.getRotation(true) * Math.PI / 180,
                zoom: this.viewport.getZoom(true)
            };
        }

        /**
         * Build the current second-pass uniform payload for a set of shaders.
         * The returned array is backend-neutral input for `renderer.secondPassProcessData(...)`
         * and `renderer.renderSecondPassToTexture(...)`.
         * @param {Object} [view=undefined]
         * @param {Object.<string, ShaderLayer>} [shaderMap=this.renderer.getAllShaders()]
         * @param {string[]} [shaderOrder=this.renderer.getShaderLayerOrder()]
         * @return {SPRenderPackage[]}
         */
        getCurrentShaderRenderArray(view = undefined, shaderMap = undefined, shaderOrder = undefined) {
            view = this._resolveRenderView(view);
            shaderMap = shaderMap || this.renderer.getAllShaders();
            shaderOrder = shaderOrder || this.renderer.getShaderLayerOrder();
            return this._collectShaderUniforms(shaderMap, shaderOrder, view);
        }

        /**
         * Render the current visualization into an offscreen target using the active backend's
         * `renderSecondPassToTexture(...)` implementation.
         *
         * This is the public drawer-level convenience wrapper for callers that want a texture
         * result but do not want to assemble the second-pass render array themselves.
         *
         * @param {Object} [options]
         * @return {Object}
         */
        renderVisualizationToTexture(options = {}) {
            const view = this._resolveRenderView(options.view);
            const shaderMap = options.shaderMap || this.renderer.getAllShaders();
            const shaderOrder = options.shaderOrder || this.renderer.getShaderLayerOrder();
            const renderArray = this._collectShaderUniforms(shaderMap, shaderOrder, view);
            return this.renderer.renderSecondPassToTexture(renderArray, options);
        }

        /**
         * Drawer-level convenience API for updating the renderer-owned inspector state.
         *
         * The drawer does not implement inspector rendering itself and does not synchronize
         * inspector state to the navigator. Backend implementations must consume the state
         * through `renderer.getInspectorState()`.
         *
         * @param {Partial<InspectorState>|undefined} state
         * @return {InspectorState}
         */
        setInspectorState(state) {
            return this.renderer.setInspectorState(state, {
                reason: "drawer-set-inspector-state"
            });
        }

        /**
         * Reset inspector state through the renderer-owned API.
         *
         * @return {InspectorState}
         */
        clearInspectorState() {
            return this.setInspectorState(undefined);
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
            if (!this._drawReady && !this._refreshDrawReadyState()) {
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

            this._ensurePackLayout();

            if (this._drawTwoPassFirst(tiledImages, view, viewMatrix)) {
                this._drawTwoPassSecond(view);
            }
        } // end of function

        /**
         * During the first-pass draw all tiles' data sources into the corresponding off-screen textures using identity rendering,
         * excluding any image-processing operations or any rendering customizations.
         * @param {OpenSeadragon.TiledImage[]} tiledImages array of TiledImage objects to draw
         * @param {Object} viewport has bounds, center, rotation, zoom
         * @param {OpenSeadragon.Mat3} viewMatrix
         */
        _drawTwoPassFirst(tiledImages, viewport, viewMatrix) {
            // FIRST PASS (render things as they are into the corresponding off-screen textures)
            const TI_PAYLOAD = [];

            for (let tiledImageIndex = 0; tiledImageIndex < tiledImages.length; tiledImageIndex++) {
                const tiledImage = tiledImages[tiledImageIndex];
                const payload = [];
                const vecPayload = [];

                const tilesToDraw = tiledImage.getTilesToDraw();

                // rendering in 4 overlapping groups of non-overlapping tiles so the depth value stays relatively small
                // TODO: move the tile ordering elsewhere to reduce amount of time spent recomputing it - possibly to TiledImage
                tilesToDraw.sort(
                    (entryA, entryB) => {
                        let levelA = entryA.tile.level;
                        let levelOrderA = 2 * (entryA.tile.y % 2) + (entryA.tile.x % 2);

                        let levelB = entryB.tile.level;
                        let levelOrderB = 2 * (entryB.tile.y % 2) + (entryB.tile.x % 2);

                        if (levelA === levelB) {
                            return levelOrderB - levelOrderA;
                        }

                        return levelB - levelA;
                    }
                );

                let overallMatrix = viewMatrix;
                let imageRotation = tiledImage.getRotation(true);
                // if needed, handle the tiledImage being rotated

                // todo consider in-place multiplication, this creates insane amout of arrays
                if (imageRotation % 360 !== 0) {
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
                                dataIndex: tiledImage.__flexBaseLayer || tiledImageIndex, // color layer index
                                stencilIndex: tiledImageIndex,
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
                            if (tileInfo.vectors.points) {
                                tileInfo.vectors.points.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.icons) {
                                tileInfo.vectors.icons.matrix = transformMatrix;
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

                const packCount = tiledImage.__flexPackCount || 1;
                const baseLayer =
                    (typeof tiledImage.__flexBaseLayer === "number") ? tiledImage.__flexBaseLayer : tiledImageIndex;

                for (let packIndex = 0; packIndex < packCount; packIndex++) {
                    TI_PAYLOAD.push({
                        tiles: payload,
                        vectors: vecPayload,
                        polygons: polygons,
                        dataIndex: baseLayer + packIndex,
                        stencilIndex: tiledImageIndex,
                        packIndex: packIndex,
                        _temp: overallMatrix, // todo dirty
                    });
                }
            }

            // todo flatten render data

            this.renderer.gl.clearColor(1.0, 1.0, 1.0, 1.0);
            this.renderer.gl.clear(this.renderer.gl.COLOR_BUFFER_BIT); // This ensures that areas that are not drawn into do not show old data

            this.renderer.firstPassProcessData(TI_PAYLOAD);
            return true;
        }

        /**
         * Collects shader layer variables (opacity, pixelSize, zoom) into one flat array,
         * group shader layers are followed by their child layers in the order specified by the group
         * @param shaders
         * @param shaderOrder
         * @param viewport
         * @returns {*[]}
         * @private
         */
        _collectShaderUniforms(shaders, shaderOrder, viewport) {
            const sources = [];
            const flatShaders = this.renderer.getFlatShaderLayers(shaders, shaderOrder);

            const canvas = this.renderer.canvas;
            const osdViewport = this.viewer.viewport;
            const inner = osdViewport && osdViewport._containerInnerSize;
            const sx = inner && inner.x ? canvas.width / inner.x : 1;
            const sy = inner && inner.y ? canvas.height / inner.y : 1;

            for (const shader of flatShaders) {
                const config = shader.getConfig();
                const hasSources = Array.isArray(config.tiledImages) && config.tiledImages.length > 0;
                const tiledImage = hasSources ? this.viewer.world.getItemAt(config.tiledImages[0]) : null;

                let imageOriginPx = [0, 0];
                if (tiledImage && osdViewport) {
                    // image (0,0) → viewport coords → CSS viewer-element pixels (top-down)
                    // → framebuffer pixels (bottom-up to match gl_FragCoord).
                    const vp = tiledImage.imageToViewportCoordinates(0, 0, true);
                    const cssPt = osdViewport.pixelFromPoint(vp, true);
                    imageOriginPx[0] = cssPt.x * sx;
                    imageOriginPx[1] = canvas.height - cssPt.y * sy;
                }

                sources.push({
                    zoom: viewport.zoom,
                    pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
                    opacity: tiledImage ? tiledImage.getOpacity() : 1,
                    imageOriginPx,
                    shader: shader,
                });
            }

            return sources;
        }

        /**
         * During the second-pass draw from the off-screen textures into the rendering canvas,
         * applying the image-processing operations and rendering customizations.
         * @param {Object} viewport has bounds, center, rotation, zoom
         */
        _drawTwoPassSecond(viewport) {
            const sources = this._collectShaderUniforms(this.renderer.getAllShaders(), this.renderer.getShaderLayerOrder(), viewport);

            if (!sources.length) {
                this.viewer.forceRedraw();
                return false;
            }

            this.renderer.secondPassProcessData(sources);
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

        //todo: this could be called only on change of TI, not each frame!
        _updatePackLayout() {
            const world = this.viewer.world;
            const itemCount = world.getItemCount();

            let baseLayer = [];
            let packCount = [];
            let total = 0;

            for (let i = 0; i < itemCount; i++) {
                const ti = world.getItemAt(i);
                const pc = ti && ti.__flexPackCount ? ti.__flexPackCount : 1;
                baseLayer[i] = total;
                packCount[i] = pc;
                total += pc;
                ti.__flexBaseLayer = baseLayer[i];
            }

            if (!this.renderer.__flexPackInfo) {
                this.renderer.__flexPackInfo = { packCount: [], channelCount: [] };
            }
            this.renderer.__flexPackInfo.layout = {
                baseLayer: baseLayer,
                packCount: packCount,
                totalLayers: total
            };

            // TODO: is this refreshing logic necessary?
            //  this.renderer.__flexPackInfo.version =
            //     (this.renderer.__flexPackInfo.version || 0) + 1;
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
        static isSupported(options = {}) {
            const rendererClass = $.FlexRenderer;
            if (rendererClass && typeof rendererClass.ensureRuntimeSupport === "function") {
                try {
                    return !!rendererClass.ensureRuntimeSupport({
                        webGLPreferredVersion: options.webGLPreferredVersion || "2.0",
                        force: options.force === true,
                        throwOnFailure: false,
                        debug: !!options.debug,
                    }).ok;
                } catch (e) {
                    return false;
                }
            }

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
                    refetchCallback: (request) => this._handleRefetchRequest(request),
                    uniqueId: "osd_" + this._id,
                    // TODO: problem when navigator renders first
                    // Navigator must not have the handler since it would attempt to define the controls twice
                    htmlHandler: this._isNavigatorDrawer ? null : this.options.htmlHandler,
                    // However, navigator must have interactive same as parent renderer to bind events to the controls
                    interactive: this._isNavigatorDrawer ? false : !!this.options.htmlHandler,
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
            this._refreshDrawReadyState();
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
            const tiledImage = tile.tiledImage;
            const normalized = this._normalizeCacheData(cache);

            return this.createTileInfoFromSource({
                data: normalized.data,
                type: normalized.type,
                tile,
                tiledImage
            }).catch(e => {
                $.console.error(`Unsupported data type! ${normalized.data}`, e);
            });
        }

        async createTileInfoFromSource({ data, type, tile, tiledImage }) {
            const gl = this._gl;

            if (type === "undefined") {
                return null;
            }

            if (type === "vector-mesh" || (data && (data.fills || data.lines || data.points))) {
                return this._buildVectorTileInfo(data, gl);
            }

            const isGpuTextureSet = data &&
                typeof data.getType === "function" &&
                data.getType() === "gpuTextureSet";

            if (isGpuTextureSet) {
                const tileInfo = this._buildGpuTextureTileInfo(data, tile, tiledImage, gl);

                if (this._packLayoutDirty) {
                    // TODO: is this refreshing logic necessary?
                    //  this._refreshPackLayoutNow();
                    this._packLayoutDirty = false;
                    this._requestRebuild();
                }

                return tileInfo;
            }

            return this._buildBitmapTileInfo(data, tile, tiledImage, gl);
        }

        // _refreshPackLayoutNow() {
        //     this._updatePackLayout();
        //     this._packLayoutDirty = false;
        // }

        /**
         * Compute normalized tile texture coordinates (UVs) in source image space,
         * including overlap trimming. Works for both normal images and gpuTextureSet.
         */
        _computeTilePosition(tile, tiledImage, dataWidth, dataHeight) {
            let sourceWidthFraction, sourceHeightFraction;

            if (tile.sourceBounds) {
                sourceWidthFraction = Math.min(tile.sourceBounds.width, dataWidth) / dataWidth;
                sourceHeightFraction = Math.min(tile.sourceBounds.height, dataHeight) / dataHeight;
            } else {
                sourceWidthFraction = 1;
                sourceHeightFraction = 1;
            }

            const overlap = tiledImage.source.tileOverlap;
            if (overlap > 0) {
                // calculate the normalized position of the rect to actually draw
                // discarding overlap.
                const tileMeta = this._getTileRenderMeta(tile, tiledImage);

                const left   = (tile.x === 0 ? 0 : tileMeta.overlapX) * sourceWidthFraction;
                const top    = (tile.y === 0 ? 0 : tileMeta.overlapY) * sourceHeightFraction;
                const right  = (tile.isRightMost ? 1 : 1 - tileMeta.overlapX) * sourceWidthFraction;
                const bottom = (tile.isBottomMost ? 1 : 1 - tileMeta.overlapY) * sourceHeightFraction;

                return new Float32Array([
                    left, bottom,
                    left, top,
                    right, bottom,
                    right, top
                ]);
            } else {
                return new Float32Array([
                    0, sourceHeightFraction,
                    0, 0,
                    sourceWidthFraction, sourceHeightFraction,
                    sourceWidthFraction, 0
                ]);
            }
        }

        _ensurePackLayout() {
            if (this._packLayoutDirty) {
                this._updatePackLayout();
                this._packLayoutDirty = false;
            }
        }

        _computeOffscreenLayerCount() {
            const world = this.viewer.world;
            const items = world._items || [];
            let total = 0;

            for (let i = 0; i < items.length; i++) {
                const ti = items[i];
                const packCount = ti && ti.__flexPackCount ? ti.__flexPackCount : 1;
                total += packCount;
            }

            return Math.max(total, 1);
        }

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
                if (data.vectors.points) {
                    gl.deleteBuffer(data.vectors.points.vboPos);
                    gl.deleteBuffer(data.vectors.points.vboCol);
                    gl.deleteBuffer(data.vectors.points.ibo);
                }
                if (data.vectors.icons) {
                    gl.deleteBuffer(data.vectors.icons.vboPos);
                    gl.deleteBuffer(data.vectors.icons.vboCol);
                    gl.deleteBuffer(data.vectors.icons.ibo);
                }
                data.vectors = null;
            }
        }

        // inside OpenSeadragon.FlexDrawer

        _normalizeCacheData(cache) {
            if (!cache || cache.type === "undefined") {
                return { type: "undefined", data: null };
            }

            let data = cache.data;
            if (data instanceof CanvasRenderingContext2D) {
                data = data.canvas;
            }

            return {
                type: cache.type,
                data
            };
        }

        _updatePackMetadata(tiledImage, packCount, channelCount) {
            if (!tiledImage) {
                return;
            }

            const metadataWasReady = !!tiledImage.__flexMetadataReady;
            let metadataChanged = !metadataWasReady;

            if (tiledImage.__flexPackCount !== packCount) {
                tiledImage.__flexPackCount = packCount;
                this._packLayoutDirty = true;
                metadataChanged = true;
            }
            if (tiledImage.__flexChannelCount !== channelCount) {
                tiledImage.__flexChannelCount = channelCount;
                this._packLayoutDirty = true;
                metadataChanged = true;
            }
            tiledImage.__flexMetadataReady = true;

            if (this.renderer && !this.renderer.__flexPackInfo) {
                this.renderer.__flexPackInfo = {
                    packCount: [],
                    channelCount: [],
                };
            }

            if (this.renderer && this.renderer.__flexPackInfo && this.viewer.world) {
                const tiIndex = this.viewer.world.getIndexOfItem(tiledImage);
                if (tiIndex >= 0) {
                    this.renderer.__flexPackInfo.packCount[tiIndex] = packCount;
                    this.renderer.__flexPackInfo.channelCount[tiIndex] = channelCount;
                }
            }

            if (metadataChanged) {
                this._refreshShadersForTiledImage(tiledImage);
            }
        }

        _refreshShadersForTiledImage(tiledImage) {
            if (!this.renderer || !this.viewer || !this.viewer.world || !tiledImage) {
                return;
            }

            const tiIndex = this.viewer.world.getIndexOfItem(tiledImage);
            if (tiIndex < 0) {
                return;
            }

            const idsToRefresh = [];
            this.renderer.forEachShaderLayer(undefined, undefined, shader => {
                const config = shader.getConfig();
                if (config && Array.isArray(config.tiledImages) && config.tiledImages.includes(tiIndex)) {
                    idsToRefresh.push(shader.id);
                }
            });

            if (!idsToRefresh.length) {
                return;
            }

            for (const shaderId of idsToRefresh) {
                this.renderer.refreshShaderLayer(shaderId, { rebuildProgram: false });
            }

            this._requestRebuild(0, true);
        }

        _buildVectorTileInfo(data, gl) {
            const tileInfo = {
                position: null,
                texture: null,
                vectors: {}
            };

            const buildBatch = (meshes) => {
                let vCount = 0,
                    iCount = 0;
                for (const m of meshes) {
                    vCount += (m.vertices.length / 4);
                    iCount += m.indices.length;
                }

                const positions = new Float32Array(vCount * 4);
                const parameters = new Float32Array(vCount * 4);
                const indices = new Uint32Array(iCount);

                let vOfs = 0,
                    iOfs = 0,
                    baseVertex = 0;

                for (const m of meshes) {
                    positions.set(m.vertices, vOfs * 4);

                    // fill color per-vertex (constant per feature)
                    const rgba = m.color ? m.color : [0, 0, 0, 1];
                    const r = Math.max(0.0, Math.min(1.0, rgba[0]));
                    const g = Math.max(0.0, Math.min(1.0, rgba[1]));
                    const b = Math.max(0.0, Math.min(1.0, rgba[2]));
                    const a = Math.max(0.0, Math.min(1.0, rgba[3]));
                    for (let k = 0; k < (m.vertices.length / 4); k++) {
                        const pOfs = (vOfs + k) * 4;
                        parameters[pOfs + 0] = r;
                        parameters[pOfs + 1] = g;
                        parameters[pOfs + 2] = b;
                        parameters[pOfs + 3] = a;
                    }

                    // if parameters are specified from mesh
                    if (m.parameters) {
                        parameters.set(m.parameters, vOfs * 4);
                    }

                    // rebase indices
                    for (let k = 0; k < m.indices.length; k++) {
                        indices[iOfs + k] = baseVertex + m.indices[k];
                    }

                    vOfs += (m.vertices.length / 4);
                    iOfs += m.indices.length;
                    baseVertex += (m.vertices.length / 4);
                }

                // Upload once
                const vboPos = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
                gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

                const vboParam = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vboParam);
                gl.bufferData(gl.ARRAY_BUFFER, parameters, gl.STATIC_DRAW);

                const ibo = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

                return { vboPos, vboParam, ibo, count: indices.length };
            };

            if (data.fills && data.fills.length) {
                tileInfo.vectors.fills = buildBatch(data.fills);
            }
            if (data.lines && data.lines.length) {
                tileInfo.vectors.lines = buildBatch(data.lines);
            }
            if (data.points && data.points.length) {
                tileInfo.vectors.points = buildBatch(data.points);
            }
            if (data.icons && data.icons.length) {
                tileInfo.vectors.icons = buildBatch(data.icons);
            }

            return tileInfo;
        }

        _buildGpuTextureTileInfo(gpu, tile, tiledImage, gl) {
            const width = gpu.width;
            const height = gpu.height;
            const packs = gpu.packs || [];
            const packCount = packs.length || 1;
            const channelCount = gpu.channelCount || packCount * 4;

            this._updatePackMetadata(tiledImage, packCount, channelCount);

            const tileInfo = {
                position: this._computeTilePosition(tile, tiledImage, width, height),
                texture: null,
                vectors: undefined,
            };

            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);

            const firstFmt = (packs[0] && packs[0].format) || "RGBA8";
            const internalFormat = (firstFmt === "RGBA16F") ? gl.RGBA16F : gl.RGBA8;
            const format = gl.RGBA;
            const type = (firstFmt === "RGBA16F") ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internalFormat, width, height, packCount);

            for (let layer = 0; layer < packCount; layer++) {
                const pack = packs[layer];
                if (!pack) {
                    continue;
                }

                gl.texSubImage3D(
                    gl.TEXTURE_2D_ARRAY,
                    0,
                    0, 0, layer,
                    width, height, 1,
                    format,
                    type,
                    pack.data
                );
            }

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            tileInfo.texture = texture;
            return tileInfo;
        }

        async _buildBitmapTileInfo(data, tile, tiledImage, gl) {
            // if (!tiledImage.isTainted()) {
            // todo tained data handle
            // if((data instanceof CanvasRenderingContext2D) && $.isCanvasTainted(data.canvas)){
            //     tiledImage.setTainted(true);
            //     $.console.warn('WebGL cannot be used to draw this TiledImage because it has tainted data. Does crossOriginPolicy need to be set?');
            //     this._raiseDrawerErrorEvent(tiledImage, 'Tainted data cannot be used by the WebGLDrawer. Falling back to CanvasDrawer for this TiledImage.');
            //     this.setInternalCacheNeedsRefresh();
            // } else {

            const bitmap = await createImageBitmap(data);

            const width = bitmap.width;
            const height = bitmap.height;

            this._updatePackMetadata(tiledImage, 1, 4);

            const tileInfo = {
                position: this._computeTilePosition(tile, tiledImage, width, height),
                texture: null,
                vectors: undefined,
            };

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);

            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, 1);
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                0, 0, 0,
                width, height, 1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                bitmap
            );

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            tileInfo.texture = tex;
            return tileInfo;
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

    function createLock() {
        let locked = false;
        const waiters = [];

        return {
            async lock() {
                if (!locked) {
                    locked = true;
                    return;
                }
                await new $.Promise(resolve => waiters.push(resolve));
            },
            unlock() {
                const next = waiters.shift();
                if (next) {
                    next();
                } else {
                    locked = false;
                }
            }
        };
    }

    function installExtractionApi(target, renderer, readCurrentCanvas) {
        target._extractScratch = {
            canvas: null,
            ctx: null,
            framebuffer: null,
            imageData: null,
            u8: null,
            f32: null,
        };

        target._ensureExtract2D = function(width, height) {
            const scratch = this._extractScratch;
            if (!scratch.canvas) {
                scratch.canvas = document.createElement('canvas');
                scratch.ctx = scratch.canvas.getContext('2d', { willReadFrequently: true });
            }
            if (scratch.canvas.width !== width) {
                scratch.canvas.width = width;
            }
            if (scratch.canvas.height !== height) {
                scratch.canvas.height = height;
            }
            return scratch.ctx;
        };

        target._ensureExtractImageData = function(width, height) {
            const scratch = this._extractScratch;
            if (!scratch.imageData || scratch.imageData.width !== width || scratch.imageData.height !== height) {
                scratch.imageData = new ImageData(width, height);
            }
            return scratch.imageData;
        };

        target._ensureExtractBuffer = function(width, height, type = "uint8") {
            const scratch = this._extractScratch;
            const len = width * height * 4;

            if (type === "float32") {
                if (!(scratch.f32 instanceof Float32Array) || scratch.f32.length !== len) {
                    scratch.f32 = new Float32Array(len);
                }
                return scratch.f32;
            }

            if (!(scratch.u8 instanceof Uint8Array) || scratch.u8.length !== len) {
                scratch.u8 = new Uint8Array(len);
            }
            return scratch.u8;
        };

        target._readCanvasResult = function(ctx, result = "imageData") {
            const canvas = ctx.canvas;

            switch (result) {
                case "ctx":
                    return ctx;
                case "canvas":
                    return canvas;
                case "imageData":
                    return ctx.getImageData(0, 0, canvas.width, canvas.height);
                case "uint8": {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    return new Uint8Array(imageData.data.buffer.slice(0));
                }
                default:
                    throw new Error(`Unsupported extract result "${result}"`);
            }
        };

        target._readCurrentCanvas = function(sourceCanvas, result = "imageData") {
            const ctx = this._ensureExtract2D(sourceCanvas.width, sourceCanvas.height);
            ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            ctx.drawImage(sourceCanvas, 0, 0);
            return this._readCanvasResult(ctx, result);
        };

        target._getExtractionFramebuffer = function() {
            const gl = renderer.gl;
            const scratch = this._extractScratch;
            if (!scratch.framebuffer) {
                scratch.framebuffer = gl.createFramebuffer();
            }
            return scratch.framebuffer;
        };

        target._readTextureArrayLayer = function(texArray, layerIndex, {
            width = renderer.canvas.width,
            height = renderer.canvas.height,
            level = 0,
            format = null,
            type = null,
            result = "imageData",
        } = {}) {
            const gl = renderer.gl;

            format = format || gl.RGBA;
            type = type || gl.UNSIGNED_BYTE;

            const fb = this._getExtractionFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, level, layerIndex);

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                throw new Error(`Extraction framebuffer incomplete: 0x${status.toString(16)}`);
            }

            const pixels = this._ensureExtractBuffer(width, height, type === gl.FLOAT ? "float32" : "uint8");
            gl.readPixels(0, 0, width, height, format, type, pixels);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            if (result === "uint8" || result === "float32") {
                return pixels.slice(0);
            }

            const imageData = this._ensureExtractImageData(width, height);
            imageData.data.set(type === gl.FLOAT ? new Uint8ClampedArray(pixels.buffer) : pixels);
            if (result === "imageData") {
                return new ImageData(new Uint8ClampedArray(imageData.data), width, height);
            }

            const ctx = this._ensureExtract2D(width, height);
            ctx.putImageData(imageData, 0, 0);
            if (result === "canvas") {
                return ctx.canvas;
            }
            if (result === "ctx") {
                return ctx;
            }

            throw new Error(`Unsupported extract result "${result}"`);
        };

        target.extractCurrentViewport = async function({
            result = "imageData"
        } = {}) {
            return readCurrentCanvas.call(this, result);
        };
    }

    async function rasterizeStandaloneSource(source) {
        if (!source) {
            throw new Error("Invalid standalone input source.");
        }

        if (typeof source === "string") {
            source = await new Promise((resolve, reject) => {
                const image = document.createElement("img");
                image.decoding = "async";
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`Failed to load standalone input source '${source}'.`));
                image.src = source;
            });
        } else if (source && typeof source === "object" && typeof source.src === "string" &&
            !(typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement)) {
            return rasterizeStandaloneSource(source.src);
        }

        if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
            if (!source.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
                await new Promise((resolve, reject) => {
                    source.addEventListener("load", resolve, { once: true });
                    source.addEventListener("error", () => reject(new Error("Failed to load standalone image input.")), { once: true });
                });
            }

            const width = source.naturalWidth || source.width;
            const height = source.naturalHeight || source.height;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(source, 0, 0, width, height);
            return {
                width,
                height,
                pixels: ctx.getImageData(0, 0, width, height).data
            };
        }

        if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
            const ctx = source.getContext("2d", { willReadFrequently: true });
            return {
                width: source.width,
                height: source.height,
                pixels: ctx.getImageData(0, 0, source.width, source.height).data
            };
        }

        if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
            const canvas = document.createElement("canvas");
            canvas.width = source.width;
            canvas.height = source.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(source, 0, 0);
            return {
                width: source.width,
                height: source.height,
                pixels: ctx.getImageData(0, 0, source.width, source.height).data
            };
        }

        if (typeof ImageData !== "undefined" && source instanceof ImageData) {
            return {
                width: source.width,
                height: source.height,
                pixels: source.data
            };
        }

        throw new Error("Unsupported standalone input source.");
    }

    function createStandaloneViewportHost(viewer) {
        return {
            navigator: null,
            world: viewer.world,
            drawer: {
                canRotate: function() {
                    return !!(viewer.drawer && typeof viewer.drawer.canRotate === "function" && viewer.drawer.canRotate());
                }
            },
            forceRedraw: function() {},
            raiseEvent: function() {},
        };
    }

    function setStandaloneViewportRotation(viewport, viewer, degrees) {
        if (typeof degrees !== "number") {
            return;
        }

        if (viewport.degreesSpring) {
            viewport.degreesSpring.resetTo(degrees);
        }
        if (viewport._oldDegrees !== undefined) {
            viewport._oldDegrees = degrees;
        }

        viewport._setContentBounds(viewer.world.getHomeBounds(), viewer.world.getContentFactor());
    }

    function syncStandaloneViewportState(viewport, viewer, view, size) {
        viewport._setContentBounds(viewer.world.getHomeBounds(), viewer.world.getContentFactor());

        if (size && typeof size.x === "number" && typeof size.y === "number") {
            viewport.resize(new $.Point(size.x, size.y), true);
        }

        if (view && view.bounds) {
            viewport.fitBounds(view.bounds, true);
        } else if (view) {
            if (typeof view.zoom === "number") {
                viewport.zoomTo(view.zoom, null, true);
            }
            if (view.center) {
                viewport.panTo(view.center, true);
            }
        } else {
            viewport.fitBounds(viewer.viewport.getBoundsNoRotate(true), true);
        }

        if (view && typeof view.rotation === "number") {
            setStandaloneViewportRotation(viewport, viewer, view.rotation * 180 / Math.PI);
        } else {
            setStandaloneViewportRotation(viewport, viewer, viewer.viewport.getRotation(true));
        }

        if (view && typeof view.flipped === "boolean") {
            viewport.setFlip(view.flipped);
        } else {
            viewport.setFlip(viewer.viewport.getFlip());
        }

        viewport.applyConstraints(true);
    }

    $.makeStandaloneFlexDrawer = function(viewer) {
        const Drawer = OpenSeadragon.FlexDrawer;
        const viewportHost = createStandaloneViewportHost(viewer);
        const standaloneViewport = new $.Viewport({
            containerSize: viewer.viewport.getContainerSize(),
            springStiffness: viewer.springStiffness,
            animationTime: viewer.animationTime,
            minZoomImageRatio: viewer.minZoomImageRatio,
            maxZoomPixelRatio: viewer.maxZoomPixelRatio,
            visibilityRatio: viewer.visibilityRatio,
            wrapHorizontal: viewer.wrapHorizontal,
            wrapVertical: viewer.wrapVertical,
            defaultZoomLevel: viewer.defaultZoomLevel,
            minZoomLevel: viewer.minZoomLevel,
            maxZoomLevel: viewer.maxZoomLevel,
            viewer: viewportHost,
            degrees: viewer.viewport.getRotation(true),
            flipped: viewer.viewport.getFlip(),
            overlayPreserveContentDirection: viewer.overlayPreserveContentDirection,
            navigatorRotate: viewer.navigatorRotate,
            homeFillsViewer: viewer.homeFillsViewer,
            margins: viewer.viewportMargins,
            silenceMultiImageWarnings: viewer.silenceMultiImageWarnings
        });
        viewportHost.viewport = standaloneViewport;
        syncStandaloneViewportState(standaloneViewport, viewer);

        const options = $.extend(true, {}, viewer.drawerOptions[Drawer.prototype.getType()]);
        options.debug = false;
        options.htmlReset = undefined;
        options.htmlHandler = undefined;
        // avoid modification on navigator
        options.handleNavigator = false;
        options.offScreen = true;

        const drawer = new Drawer({
            viewer:             viewer,
            viewport:           standaloneViewport,
            element:            viewer.drawer.container,
            debugGridColor:     viewer.debugGridColor,
            options:            options
        });

        const mutex = createLock();
        const lock = () => mutex.lock();
        const unlock = () => mutex.unlock();

        drawer._bindTiledImagesToViewport = function(tiledImages) {
            const bindings = tiledImages.map(tiledImage => ({
                tiledImage,
                viewport: tiledImage.viewport
            }));
            for (const binding of bindings) {
                binding.tiledImage.viewport = this.viewport;
            }
            return bindings;
        };

        drawer._restoreTiledImageViewports = function(bindings) {
            if (!bindings) {
                return;
            }
            for (const binding of bindings) {
                binding.tiledImage.viewport = binding.viewport;
            }
        };

        drawer._syncViewerViewport = async function(view, size) {
            if (!view || view instanceof OpenSeadragon.FlexDrawer) {
                return;
            }

            const viewport = this.viewport;
            if (!viewport) {
                return;
            }

            syncStandaloneViewportState(viewport, viewer, view, size);

            await new $.Promise(resolve => requestAnimationFrame(() => resolve()));
        };

        drawer._collectReadyTiles = async function(tiledImages, view, size) {
            await this._syncViewerViewport(view, size);

            for (const tiledImage of tiledImages) {
                tiledImage.update(true);
            }

            let tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
            if (tiles.length) {
                return tiles;
            }

            for (let attempt = 0; attempt < 3; attempt++) {
                await new $.Promise(resolve => requestAnimationFrame(() => resolve()));
                for (const tiledImage of tiledImages) {
                    tiledImage.update(true);
                }
                tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                if (tiles.length) {
                    return tiles;
                }
            }

            return [];
        };

        /**
         * Draws the viewer with the given configuration.
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages
         * @param {Object.<string, ShaderConfig>} [configuration]
         * @param {object|OpenSeadragon.FlexDrawer} [view] draw desired viewport (full pass) or re-use last frame
         *    - The viewport to draw, see {@link OpenSeadragon.FlexDrawer#draw}
         *    - Or, the reference to the drawer to draw the same viewport as the previous one. By default, the
         *      reference to the standalone drawer is used - which is probably not desired!
         * @param {OpenSeadragon.Point|{x:number,y:number}} [size] - The size of the viewer. Inherited from viewOrReference if not provided,
         *      required if viewport description is provided to the viewOrReference argument.
         * @returns {Promise<CanvasRenderingContext2D>}
         */
        drawer.drawWithConfiguration = (async function (tiledImages, configuration = undefined, view = undefined, size = undefined) {
            let tiles;
            let tasks;
            let viewportBindings = null;

            let fullDrawPass = true;
            if (!view || view instanceof OpenSeadragon.FlexDrawer) {
                fullDrawPass = false;
                if (!view) {
                    view = viewer.drawer;
                }

                if (!size) {
                    size = {x: view.canvas.width, y: view.canvas.height};
                }
            } else if (!size) {
                size = {x: drawer.canvas.width, y: drawer.canvas.height};
                $.console.warn('size is required when drawing a viewport!');
            }

            if (fullDrawPass) {
                viewportBindings = drawer._bindTiledImagesToViewport(tiledImages);
                try {
                    tiles = await drawer._collectReadyTiles(tiledImages, view, size);
                    if (!tiles.length) {
                        throw new Error("Standalone extraction found no tiles to draw for the requested view.");
                    }
                    tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));
                } catch (e) {
                    drawer._restoreTiledImageViewports(viewportBindings);
                    viewportBindings = null;
                    throw e;
                }
            }

            await lock();
            try {
                if (configuration) {
                    await drawer.overrideConfigureAll(configuration, undefined, { immediate: true });
                }

                // todo: tiledImages.length is not reliable! we can have TI that produces more layers in the color part!

                if (fullDrawPass) {
                    return Promise.all(tasks).then(() => {
                        // Sum of packs across all TIs:
                        const colorLayers = drawer._computeOffscreenLayerCount();
                        const stencilLayers = tiledImages.length;

                        this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);
                        this.draw(tiledImages, view);

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = size.x;
                        canvas.height = size.y;
                        ctx.drawImage(this.renderer.canvas, 0, 0);
                        return ctx;
                    }).catch(e => {
                        console.error(e);
                        throw e;
                    }).finally(() => {
                        // free data
                        const dId = drawer.getId();
                        tiles.forEach(t => t.tile.getCache().destroyInternalCache(dId));
                        drawer._restoreTiledImageViewports(viewportBindings);
                        viewportBindings = null;
                    });
                }

                let colorLayers   = tiledImages.length;
                let stencilLayers = tiledImages.length;

                if (view.renderer.__firstPassResult) {
                    const srcFP = view.renderer.__firstPassResult;
                    if (typeof srcFP.textureDepth === "number") {
                        colorLayers = srcFP.textureDepth;
                    }
                    if (typeof srcFP.stencilDepth === "number") {
                        stencilLayers = srcFP.stencilDepth;
                    }
                }

                // Steal FP initialized textures if we differ in reference (different webgl context) or we have no state
                if (view !== drawer || !this.renderer.__firstPassResult) {
                    // todo dirty, hide the __firstPassResult structure within the program logics
                    const program = view.renderer.getProgram('firstPass');
                    colorLayers = drawer._computeOffscreenLayerCount();
                    this.renderer.__firstPassResult = {
                        texture: program.colorTextureA,
                        stencil: program.stencilTextureA,
                        textureDepth: colorLayers,
                        stencilDepth: stencilLayers,
                    };
                }

                this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);

                // Instead of re-rendering, we steal last state of the renderer and re-render second pass only.
                view.renderer.copyRenderOutputToContext(this.renderer);
                // ! must be called after copy, otherwise we would access wrong context
                if (this.debug) {
                    const fp = this.renderer.__firstPassResult;
                    this.renderer._showOffscreenMatrix(fp, {scale: 0.5, pad: 8});
                }

                this._drawTwoPassSecond({
                    zoom: this.viewport.getZoom(true)
                });

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = size.x;
                canvas.height = size.y;
                ctx.drawImage(this.renderer.canvas, 0, 0);
                return ctx;
            } finally {
                if (viewportBindings) {
                    drawer._restoreTiledImageViewports(viewportBindings);
                }
                unlock();
            }
        }).bind(drawer);

        // ---------------------------------------------------------------------
        // Extraction API
        // ---------------------------------------------------------------------

        installExtractionApi(drawer, drawer.renderer, function(result = "imageData") {
            return this._readCurrentCanvas(viewer.drawer.canvas, result);
        });

        /**
         * Extract a single first-pass layer directly from the standalone renderer state.
         *
         * @param {"texture"|"stencil"} kind
         * @param {number} layerIndex
         * @param {object} [opts]
         */
        drawer.extractFirstPassLayer = async function(kind, layerIndex, opts = {}) {
            await lock();
            try {
                const fp = this.renderer.__firstPassResult;
                if (!fp) {
                    throw new Error("No first-pass result available in standalone renderer.");
                }

                const tex = kind === "stencil" ? fp.stencil : fp.texture;
                const depth = kind === "stencil" ? fp.stencilDepth : fp.textureDepth;

                if (!tex) {
                    throw new Error(`No ${kind} texture available.`);
                }
                if (layerIndex < 0 || layerIndex >= depth) {
                    throw new Error(`Invalid ${kind} layer index ${layerIndex}; depth=${depth}`);
                }

                return this._readTextureArrayLayer(tex, layerIndex, {
                    width: opts.width || this.renderer.canvas.width,
                    height: opts.height || this.renderer.canvas.height,
                    level: opts.level || 0,
                    format: opts.format,
                    type: opts.type,
                    result: opts.result || "imageData",
                });
            } finally {
                unlock();
            }
        };

        /**
         * Main extraction facade.
         *
         * mode:
         *  - "viewport-copy": copy current viewer canvas exactly
         *  - "second-pass": isolated rerender via standalone and return result
         *  - "first-pass-layer": direct readback from first-pass texture/stencil layer
         */
        drawer.extract = async function({
            mode = "second-pass",
            tiledImages = viewer.world ? viewer.world.getItemCount ? [...Array(viewer.world.getItemCount()).keys()].map(i => viewer.world.getItemAt(i)) : [] : [],
            configuration = undefined,
            view = undefined,
            size = undefined,
            result = "imageData",

            // first-pass specific
            kind = "texture",
            layerIndex = 0,
            level = 0,
            format = undefined,
            type = undefined,
        } = {}) {
            if (mode === "viewport-copy") {
                return this.extractCurrentViewport({ result });
            }

            if (mode === "first-pass-layer") {
                return this.extractFirstPassLayer(kind, layerIndex, {
                    width: size && size.x,
                    height: size && size.y,
                    level,
                    format,
                    type,
                    result,
                });
            }

            const ctx = await this.drawWithConfiguration(
                tiledImages,
                configuration,
                view,
                size
            );
            return this._readCanvasResult(ctx, result);
        };

        return drawer;
    };

    $.makeStandaloneFlexRenderer = function({
        uniqueId = `standalone_renderer_${Date.now()}`,
        width = 256,
        height = 256,
        webGLPreferredVersion = "2.0",
        backgroundColor = "#00000000",
        debug = false,
        interactive = false,
        canvasOptions = { stencil: true }
    } = {}) {
        const runtime = {};
        const mutex = createLock();
        const lock = () => mutex.lock();
        const unlock = () => mutex.unlock();

        runtime.renderer = new $.FlexRenderer({
            uniqueId: $.FlexRenderer.sanitizeKey(uniqueId),
            webGLPreferredVersion,
            redrawCallback: () => {},
            refetchCallback: () => {},
            debug: !!debug,
            interactive: !!interactive,
            backgroundColor,
            canvasOptions
        });
        runtime.renderer.setDataBlendingEnabled(true);
        runtime.renderer.setDimensions(0, 0, width, height, 1, 1);
        runtime.canvas = runtime.renderer.canvas;
        runtime._inputState = {
            key: null,
            count: 0,
            width,
            height
        };

        installExtractionApi(runtime, runtime.renderer, function(result = "imageData") {
            return this._readCurrentCanvas(this.renderer.canvas, result);
        });

        runtime.setSize = function(nextWidth, nextHeight) {
            const safeWidth = Math.max(1, Math.round(Number(nextWidth) || 1));
            const safeHeight = Math.max(1, Math.round(Number(nextHeight) || 1));
            this._inputState.width = safeWidth;
            this._inputState.height = safeHeight;
            const depth = Math.max(this._inputState.count || 1, 1);
            this.renderer.setDimensions(0, 0, safeWidth, safeHeight, depth, depth);
        };

        runtime._clearInputTextures = function() {
            const gl = this.renderer.gl;
            if (this._inputState.colorTexture) {
                gl.deleteTexture(this._inputState.colorTexture);
            }

            this._inputState.colorTexture = null;
            this.renderer.__firstPassResult = null;
        };

        runtime._buildSyntheticFirstPassSource = function() {
            if (!this._inputState.colorTexture || !this._inputState.count) {
                return [];
            }

            const fullScreenMatrix = new Float32Array([
                2, 0, 0,
                0, 2, 0,
                -1, -1, 1
            ]);
            const fullUv = new Float32Array([
                0, 0,
                0, 1,
                1, 0,
                1, 1
            ]);

            const source = [];
            for (let i = 0; i < this._inputState.count; i++) {
                source.push({
                    tiles: [{
                        transformMatrix: fullScreenMatrix,
                        dataIndex: i,
                        stencilIndex: i,
                        texture: this._inputState.colorTexture,
                        position: fullUv,
                        tile: null
                    }],
                    vectors: [],
                    polygons: [],
                    dataIndex: i,
                    stencilIndex: i,
                    packIndex: 0,
                    _temp: { values: fullScreenMatrix }
                });
            }

            return source;
        };

        runtime._renderFirstPass = function() {
            if (!this._inputState.colorTexture || !this._inputState.count) {
                throw new Error("Standalone renderer has no input textures. Call setInputs(...) first.");
            }

            this.renderer.__flexPackInfo = {
                layout: {
                    baseLayer: Array.from({ length: this._inputState.count }, (_, i) => i),
                    packCount: Array.from({ length: this._inputState.count }, () => 1),
                    totalLayers: this._inputState.count
                },
                channelCount: Array.from({ length: this._inputState.count }, () => 4)
            };

            this.renderer.setDimensions(
                0,
                0,
                this._inputState.width,
                this._inputState.height,
                this._inputState.count,
                this._inputState.count
            );

            const source = this._buildSyntheticFirstPassSource();
            this.renderer.firstPassProcessData(source);
            return this.renderer.__firstPassResult;
        };

        runtime.setInputs = async function(inputs, options = {}) {
            const sourceList = Array.isArray(inputs) ? inputs.filter(Boolean) : (inputs ? [inputs] : []);
            const rasterized = await Promise.all(sourceList.map(source => rasterizeStandaloneSource(source)));
            if (!rasterized.length) {
                this._clearInputTextures();
                this._inputState.count = 0;
                this.renderer.__flexPackInfo = {
                    layout: { baseLayer: [], packCount: [], totalLayers: 0 },
                    channelCount: []
                };
                this.setSize(options.width || this._inputState.width, options.height || this._inputState.height);
                return;
            }

            const targetWidth = Math.max(1, Math.round(Number(options.width) || rasterized[0].width || this._inputState.width || 1));
            const targetHeight = Math.max(1, Math.round(Number(options.height) || rasterized[0].height || this._inputState.height || 1));
            const layerCount = rasterized.length;
            const colorPixels = new Uint8Array(targetWidth * targetHeight * 4 * layerCount);

            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });

            rasterized.forEach((entry, layerIndex) => {
                ctx.clearRect(0, 0, targetWidth, targetHeight);
                const imageData = new ImageData(new Uint8ClampedArray(entry.pixels), entry.width, entry.height);
                if (entry.width === targetWidth && entry.height === targetHeight) {
                    ctx.putImageData(imageData, 0, 0);
                } else {
                    const tmp = document.createElement("canvas");
                    tmp.width = entry.width;
                    tmp.height = entry.height;
                    tmp.getContext("2d", { willReadFrequently: true }).putImageData(imageData, 0, 0);
                    ctx.drawImage(tmp, 0, 0, targetWidth, targetHeight);
                }

                const rgbaPixels = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
                colorPixels.set(rgbaPixels, layerIndex * targetWidth * targetHeight * 4);
            });

            this._clearInputTextures();

            const gl = this.renderer.gl;
            this._inputState.colorTexture = $.FlexRenderer._createSelfTestTextureArray(gl, targetWidth, targetHeight, layerCount, colorPixels);
            this._inputState.count = layerCount;
            this._inputState.width = targetWidth;
            this._inputState.height = targetHeight;
            this._inputState.key = `${targetWidth}x${targetHeight}:${layerCount}`;

            this.renderer.setDimensions(0, 0, targetWidth, targetHeight, layerCount, layerCount);
        };

        runtime.overrideConfigureAll = async function(shaders, shaderOrder = undefined) {
            this.renderer.deleteShaders();
            this.renderer.__firstPassResult = null;
            if (!shaders) {
                this.renderer.setShaderLayerOrder([]);
                return;
            }

            const normalized = $.FlexRenderer.normalizeShaderMap(
                $.extend(true, {}, shaders),
                { source: "standalone-runtime" }
            ) || {};

            for (const shaderId in normalized) {
                this.renderer.createShaderLayer(shaderId, normalized[shaderId], false);
            }

            this.renderer.setShaderLayerOrder(shaderOrder || Object.keys(normalized));
            this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
        };

        runtime.getOverriddenShaderConfig = function(key) {
            const shaderLayer = this.renderer.getAllShaders()[key];
            return shaderLayer ? shaderLayer.getConfig() : undefined;
        };

        runtime._buildRenderArray = function({
            zoom = 1,
            pixelSize = 1,
            opacity = 1
        } = {}) {
            const renderArray = [];
            for (const shader of this.renderer.getFlatShaderLayers(this.renderer.getAllShaders(), this.renderer.getShaderLayerOrder())) {
                renderArray.push({
                    zoom,
                    pixelSize,
                    opacity,
                    shader
                });
            }
            return renderArray;
        };

        runtime.drawWithConfiguration = async function(inputs = undefined, configuration = undefined, _view = undefined, size = undefined) {
            await lock();
            try {
                if (inputs !== undefined) {
                    await this.setInputs(inputs, size ? {
                        width: size.width || size.x,
                        height: size.height || size.y
                    } : {});
                } else if (size && typeof size.x === "number" && typeof size.y === "number") {
                    this.setSize(size.x, size.y);
                }

                if (configuration) {
                    await this.overrideConfigureAll(configuration);
                }

                const gl = this.renderer.gl;
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.clearColor(1.0, 1.0, 1.0, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                this._renderFirstPass();

                const renderArray = this._buildRenderArray();
                if (!renderArray.length) {
                    throw new Error("Standalone renderer has no configured shader layers.");
                }

                this.renderer.secondPassProcessData(renderArray);
                this.renderer.gl.finish();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = this.renderer.canvas.width;
                canvas.height = this.renderer.canvas.height;
                ctx.drawImage(this.renderer.canvas, 0, 0);
                return ctx;
            } finally {
                unlock();
            }
        };

        runtime.extractFirstPassLayer = async function(kind, layerIndex, opts = {}) {
            await lock();
            try {
                const fp = this.renderer.__firstPassResult || this._renderFirstPass();
                if (!fp) {
                    throw new Error("No first-pass result available in standalone renderer.");
                }

                const tex = kind === "stencil" ? fp.stencil : fp.texture;
                const depth = kind === "stencil" ? fp.stencilDepth : fp.textureDepth;

                if (!tex) {
                    throw new Error(`No ${kind} texture available.`);
                }
                if (layerIndex < 0 || layerIndex >= depth) {
                    throw new Error(`Invalid ${kind} layer index ${layerIndex}; depth=${depth}`);
                }

                return this._readTextureArrayLayer(tex, layerIndex, {
                    width: opts.width || this.renderer.canvas.width,
                    height: opts.height || this.renderer.canvas.height,
                    level: opts.level || 0,
                    format: opts.format,
                    type: opts.type,
                    result: opts.result || "imageData",
                });
            } finally {
                unlock();
            }
        };

        runtime.extract = async function({
            mode = "second-pass",
            inputs = undefined,
            sources = undefined,
            configuration = undefined,
            size = undefined,
            result = "imageData",
            kind = "texture",
            layerIndex = 0,
            level = 0,
            format = undefined,
            type = undefined,
        } = {}) {
            if (mode === "viewport-copy") {
                return this.extractCurrentViewport({ result });
            }

            if (mode === "first-pass-layer") {
                return this.extractFirstPassLayer(kind, layerIndex, {
                    width: size && size.x,
                    height: size && size.y,
                    level,
                    format,
                    type,
                    result,
                });
            }

            const ctx = await this.drawWithConfiguration(
                sources !== undefined ? sources : inputs,
                configuration,
                undefined,
                size
            );
            return this._readCanvasResult(ctx, result);
        };

        runtime.destroy = function() {
            if (this._extractScratch && this._extractScratch.framebuffer) {
                this.renderer.gl.deleteFramebuffer(this._extractScratch.framebuffer);
                this._extractScratch.framebuffer = null;
            }
            this._clearInputTextures();
            this.renderer.destroy();
        };

        return runtime;
    };

}(OpenSeadragon));

(function($) {

    $.FlexRenderer.ShaderMediator.registerLayer(class AdaptiveThreshold extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "adaptive_threshold";
        }

        static name() {
            return "Adaptive threshold";
        }

        static description() {
            return "Local adaptive thresholding with mean or Gaussian-weighted neighborhood.";
        }

        static docs() {
            return {
                summary: "Adaptive threshold shader for a single scalar input channel.",
                description: "Computes a local statistic over a square neighborhood and compares the center sample against localStat - C. The neighborhood may be uniformly weighted or approximately Gaussian weighted.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Single scalar channel / derived scalar field"
                }],
                controls: [
                    { name: "block_size", ui: "range_input", valueType: "float", default: 5, min: 3, max: 11, step: 2 },
                    { name: "c_value", ui: "range_input", valueType: "float", default: 0.03, min: -0.5, max: 0.5, step: 0.001 },
                    { name: "gaussian", ui: "bool", valueType: "bool", default: false },
                    { name: "invert", ui: "bool", valueType: "bool", default: false },
                    { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                    { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (n) => n === 1,
                description: "Single scalar channel / derived scalar field"
            }];
        }

        static get defaultControls() {
            return {
                // OpenCV-like block size, odd only
                block_size: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 5,
                        min: 3,
                        max: 11,
                        step: 2,
                        title: "Block size"
                    },
                    accepts: (type) => type === "float"
                },

                // Subtracted from local statistic: threshold = local - C
                c_value: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 0.03,
                        min: -0.5,
                        max: 0.5,
                        step: 0.001,
                        title: "C"
                    },
                    accepts: (type) => type === "float"
                },

                // false = mean, true = gaussian-weighted
                gaussian: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: false,
                        title: "Gaussian"
                    },
                    accepts: (type) => type === "bool"
                },

                // false = BINARY, true = BINARY_INV
                invert: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: false,
                        title: "Invert"
                    },
                    accepts: (type) => type === "bool"
                },

                fg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#ffffff",
                        title: "Foreground"
                    },
                    accepts: (type) => type === "vec3"
                },

                bg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#000000",
                        title: "Background"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderDefinition() {
            const fnWeight = `adaptive_threshold_weight_${this.uid}`;
            return `
${super.getFragmentShaderDefinition()}

float ${fnWeight}(in float dx, in float dy, in float radius, in bool gaussianMode) {
    if (!gaussianMode) {
        return 1.0;
    }

    // Approximate Gaussian window from radius.
    float sigma = max(radius * 0.5, 0.8);
    float rr = dx * dx + dy * dy;
    return exp(-rr / (2.0 * sigma * sigma));
}
`;
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();
            const fnWeight = `adaptive_threshold_weight_${this.uid}`;

            // Your preferred form
            const texelSizeExpr =
                `vec2(1.0) / vec2(float(${this.getTextureSize()}.x), float(${this.getTextureSize()}.y))`;

            // Fixed compile-time bound; runtime block_size chooses active neighborhood inside it.
            // block_size max = 11 -> radius max = 5
            const MAX_RADIUS = 5;

            const sampleAt = (uvExpr) => this.sampleChannel(uvExpr);

            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    vec2 texelSize = ${texelSizeExpr};

    float blockSize = ${this.block_size.sample()};
    float radius = floor(blockSize * 0.5);
    float center = ${sampleAt("v_texture_coords")};

    float sum = 0.0;
    float wsum = 0.0;

    for (int iy = -${MAX_RADIUS}; iy <= ${MAX_RADIUS}; iy++) {
        for (int ix = -${MAX_RADIUS}; ix <= ${MAX_RADIUS}; ix++) {
            float dx = float(ix);
            float dy = float(iy);

            if (abs(dx) <= radius && abs(dy) <= radius) {
                vec2 uv = v_texture_coords + vec2(dx, dy) * texelSize;
                float s = ${sampleAt("uv")};
                float w = ${fnWeight}(dx, dy, radius, ${this.gaussian.sample()});

                sum += s * w;
                wsum += w;
            }
        }
    }

    float localStat = (wsum > 0.0) ? (sum / wsum) : center;
    float thresholdValue = localStat - ${this.c_value.sample()};
    float mask = step(thresholdValue, center);

    if (${this.invert.sample()}) {
        mask = 1.0 - mask;
    }

    vec3 color = mix(
        ${this.bg_color.sample()},
        ${this.fg_color.sample()},
        mask
    );

    return vec4(color, ${this.opacity.sample()});
`;
        }
    });

})(OpenSeadragon);

(function($) {
/**
 * Bi-colors shader
 * data reference must contain one index to the data to render using bipolar heatmap strategy
 *
 * supported parameters:
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

    static intent() {
        return "Render diverging scalar data with separate colors above and below the midpoint (0.5). Pick for signed/centered values.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return { colorHigh: "#ff1000", colorLow: "#01ff00", threshold: 1 };
    }

    static docs() {
        return {
            summary: "Diverging heatmap shader for a single scalar input channel.",
            description: "Treats values around 0.5 as insignificant and maps values below and above 0.5 to separate colors. Opacity is derived from the distance from the midpoint after filtering and threshold comparison.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D diverging data encoded in opacity"
            }],
            controls: [
                { name: "colorHigh", ui: "color", valueType: "vec3", default: "#ff1000" },
                { name: "colorLow", ui: "color", valueType: "vec3", default: "#01ff00" },
                { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 }
            ]
        };
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
        return "Number of color classes is always threshold.breaks.length + 1. To set classes explicitly, use color = { type: \"custom_colormap\", default: [...colors], steps: N } (palette length N wins) OR color = \" { type: \"colormap\", default: \"PaletteName\", steps: N } (steps wins). The connect flag (default true) syncs step boundaries to break positions.";
    }

    static intent() {
        return "Map a scalar value through a discrete color palette. Pick for class maps with explicit thresholds.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return {
            color: { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
            threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
            connect: true
        };
    }

    static controlCouplings() {
        return [{
            name: "colormap_class_count",
            summary: "Color class count must equal threshold.breaks.length + 1. Resize palette and breaks together.",
            corrective: "Set params.color.steps = params.threshold.breaks.length + 1 (or pass threshold.breaks of length color.steps - 1).",
            controls: ["color", "threshold"],
            validate: (layer) => {
                const params = (layer && layer.params) || {};
                const Configurator = $.FlexRenderer.ShaderConfigurator;
                const breaksCount = Configurator.resolveEffectiveBreaks(params.threshold).length;
                const colorSteps = Configurator.resolveEffectiveColorSteps(params.color);
                const expectedSteps = breaksCount + 1;
                return colorSteps === expectedSteps
                    ? { ok: true }
                    : {
                        ok: false,
                        expected: { "color.steps": expectedSteps },
                        actual: {
                            "color.steps": colorSteps,
                            "threshold.breaks.length": breaksCount
                        }
                    };
            }
        }];
    }

    static docs() {
        return {
            summary: "Colormap shader for one scalar channel.",
            description: "Samples a scalar value, maps it through a colormap control, and uses an advanced slider control as the visibility mask. The optional connect control synchronizes colormap step boundaries with slider breaks when a colormap control is active.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D data mapped to color map"
            }],
            controls: [
                {
                    name: "color",
                    ui: "colormap",
                    valueType: "vec3",
                    default: {
                        default: "Viridis",
                        steps: 3,
                        mode: "sequential",
                        continuous: false
                    }
                },
                {
                    name: "threshold",
                    ui: "advanced_slider",
                    valueType: "float",
                    default: {
                        default: [0.25, 0.75],
                        mask: [1, 0, 1]
                    },
                    required: {
                        type: "advanced_slider",
                        inverted: false
                    }
                },
                { name: "connect", ui: "bool", valueType: "bool", default: true }
            ]
        };
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
                default: {type: "bool", interactive: true, title: "Connect breaks: ", default: true},
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

    init() {
        this.opacity.init();

        const Configurator = $.FlexRenderer.ShaderConfigurator;
        const isColormap = typeof this.color.setSteps === "function";

        // Read breaks through the same canonical accessor the coupling validator uses,
        // so validation cannot disagree with runtime coercion. Live drag updates pass
        // their fresh values into syncColor() directly via the 'breaks' callback.
        const breaksOf = (override) => {
            if (Array.isArray(override)) {
                return override.map(v => Number.parseFloat(v)).filter(v => Number.isFinite(v));
            }
            return Configurator.resolveEffectiveBreaks(this.threshold && this.threshold.params);
        };
        const currentColorSteps = () =>
            Configurator.resolveEffectiveColorSteps(this.color.params);

        const warnIfMismatched = (expected) => {
            if (this._coercionWarned) {
                return;
            }
            const current = currentColorSteps();
            if (current !== expected) {
                this._coercionWarned = true;
                console.warn(
                    `[colormap] color step count ${current} coerced to ${expected} ` +
                    `to satisfy threshold.breaks.length + 1`
                );
            }
        };

        const syncColor = (liveBreaks) => {
            if (!isColormap) {
                return;
            }
            const breaks = breaksOf(liveBreaks);
            const expected = breaks.length + 1;
            warnIfMismatched(expected);
            if (this.connect && this.connect.raw) {
                this.color.setSteps([0, ...breaks, 1]);
            } else {
                this.color.setSteps(expected);
            }
            if (typeof this.color.updateColormapUI === "function") {
                this.color.updateColormapUI();
            }
        };

        if (this.connect) {
            this.connect.on('default', function() {
                syncColor();
            }, true);
            this.connect.init();

            this.threshold.on('breaks', function(_rawValue, encodedValue) {
                syncColor(encodedValue);
            }, true);
        }
        this.threshold.init();

        syncColor();

        this.color.init();
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

    static intent() {
        return "Pass the source through with optional channel swizzle. Pick to render the raw image.";
    }

    static expects() {
        return { dataKind: "rgb", channels: "any" };
    }

    static exampleParams() {
        return {};
    }

    static docs() {
        return {
            summary: "Identity shader for four-channel input.",
            description: "Samples the input texture directly and returns the sampled RGBA value unchanged.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [4],
                description: "4d texture to render AS-IS"
            }],
            controls: [
                { name: "use_channel0", required: "rgba", description: "Required RGBA swizzle for direct passthrough sampling." }
            ]
        };
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
 * Threshold edge shader with derivative-aware smoothing.
 *
 * Operates only through the public sample(...) contract of the threshold control.
 * A plain range behaves like a single threshold, while advanced controls can provide
 * more complex sampled behavior without this shader caring about their internals.
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "edge";
    }

    static name() {
        return "Edge";
    }

    static description() {
        return "highlights threshold boundaries with separate inner and outer styling";
    }

    static docs() {
        return {
            summary: "Derivative-aware threshold edge shader for one scalar input channel.",
            description: "Detects threshold-boundary crossings over a local neighborhood by evaluating a signed field derived from value - threshold.sample(value). Keeps adjustable edge thickness, works with any float threshold control, and renders lower-side and higher-side boundaries with separate colors.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D scalar data to detect threshold edges on"
            }],
            controls: [
                { name: "use_channel0", default: "r" },
                {
                    name: "threshold",
                    ui: "range_input",
                    valueType: "float",
                    default: 50,
                    min: 1,
                    max: 100,
                    step: 1,
                    description: "Any float-producing threshold control. Advanced sliders are supported through their sample() behavior."
                },
                { name: "outer_color", ui: "color", valueType: "vec3", default: "#fff700" },
                { name: "inner_color", ui: "color", valueType: "vec3", default: "#b2a800" },
                { name: "edgeThickness", ui: "range", valueType: "float", default: 1, min: 0.5, max: 3, step: 0.1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D scalar data to detect threshold edges on"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: { // eslint-disable-line camelcase
                default: "r"
            },
            threshold: {
                default: { type: "range_input", default: 50, min: 1, max: 100, step: 1, title: "Threshold: " },
                accepts: (type) => type === "float",
            },
            outer_color: { // eslint-disable-line camelcase
                default: { type: "color", default: "#fff700", title: "Outer color: " },
                accepts: (type) => type === "vec3"
            },
            inner_color: { // eslint-disable-line camelcase
                default: { type: "color", default: "#b2a800", title: "Inner color: " },
                accepts: (type) => type === "vec3"
            },
            edgeThickness: {
                default: { type: "range", default: 1, min: 0.5, max: 3, step: 0.1, title: "Edge thickness: " },
                accepts: (type) => type === "float"
            },
        };
    }

    getFragmentShaderDefinition() {
        const uid = this.uid;

        return `
${super.getFragmentShaderDefinition()}

float edge_softness_${uid}(float centerScore, float neighborhoodMin, float neighborhoodMax) {
    float localSpan = max(neighborhoodMax - neighborhoodMin, 0.0);
    float derivSpan = abs(dFdx(centerScore)) + abs(dFdy(centerScore));
    return max(0.01, max(localSpan * 0.35, derivSpan * 2.0));
}

float edge_crossing_${uid}(float neighborhoodMin, float neighborhoodMax, float softness) {
    float low = smoothstep(-softness, 0.0, neighborhoodMax);
    float high = 1.0 - smoothstep(0.0, softness, neighborhoodMin);
    return clamp(low * high, 0.0, 1.0);
}`;
    }

    getFragmentShaderExecution() {
        const uid = this.uid;

        return `
    float mid = ${this.sampleChannel("v_texture_coords")};
    if (mid < 1e-6) return vec4(.0);

    float dist = ${this.edgeThickness.sample("mid", "float")} * sqrt(zoom) * 0.005 + 0.008;
    float midScore = mid - (${this.threshold.sample("mid", "float")});

    float u = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y)")};
    float b = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y)")};
    float l = ${this.sampleChannel("vec2(v_texture_coords.x, v_texture_coords.y - dist)")};
    float r = ${this.sampleChannel("vec2(v_texture_coords.x, v_texture_coords.y + dist)")};
    float ul = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y - dist)")};
    float ur = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y + dist)")};
    float bl = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y - dist)")};
    float br = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y + dist)")};

    float uScore = u - (${this.threshold.sample("u", "float")});
    float bScore = b - (${this.threshold.sample("b", "float")});
    float lScore = l - (${this.threshold.sample("l", "float")});
    float rScore = r - (${this.threshold.sample("r", "float")});
    float ulScore = ul - (${this.threshold.sample("ul", "float")});
    float urScore = ur - (${this.threshold.sample("ur", "float")});
    float blScore = bl - (${this.threshold.sample("bl", "float")});
    float brScore = br - (${this.threshold.sample("br", "float")});

    float neighborhoodMin = min(midScore, min(min(min(uScore, bScore), min(lScore, rScore)), min(min(ulScore, urScore), min(blScore, brScore))));
    float neighborhoodMax = max(midScore, max(max(max(uScore, bScore), max(lScore, rScore)), max(max(ulScore, urScore), max(blScore, brScore))));
    float softness = edge_softness_${uid}(midScore, neighborhoodMin, neighborhoodMax);
    float crossing = edge_crossing_${uid}(neighborhoodMin, neighborhoodMax, softness);
    float outerAlpha = midScore < 0.0 ? crossing : 0.0;
    float innerAlpha = midScore >= 0.0 ? crossing : 0.0;

    float edgeAlpha = max(outerAlpha, innerAlpha);
    if (edgeAlpha <= 0.01) {
        return vec4(0.0);
    }

    vec3 edgeColor = outerAlpha >= innerAlpha ? ${this.outer_color.sample()} : ${this.inner_color.sample()};
    return vec4(edgeColor, edgeAlpha);
`;
    }
});
})(OpenSeadragon);

(function($) {
/**
 * Grid shader.
 *
 * Declares one data reference that the configurator auto-binds (via
 * tiledImages: [0]) so the grid lives in that image's source-pixel space and
 * pans/zooms with it. The reference texture is not sampled — it is used
 * purely as a coordinate anchor: the drawer's _collectShaderUniforms fills
 * `pixelSize` (screen-px per image-px) from the bound tiledImage. If no
 * binding exists, `pixelSize` defaults to 1 and the grid degrades gracefully
 * into screen-pixel space.
 *
 * Cell sizes are in image pixels; line width is in screen pixels (so lines
 * stay readable regardless of zoom).
 *
 * Optional adaptive_lod toggle holds on-screen cell size in [1×, 2×) of the
 * configured size by snapping cellX/cellY to powers of two — merge when the
 * cell would drop below ½ original; subdivide when it would exceed 2×.
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "grid";
    }

    static name() {
        return "Grid";
    }

    static description() {
        return "Render a configurable grid overlay anchored to a reference image.";
    }

    static intent() {
        return "Overlay an alignment / scale grid. Pick to add image-anchored guidelines.";
    }

    static expects() {
        return { dataKind: "any", channels: 0 };
    }

    static exampleParams() {
        /* eslint-disable camelcase */
        return { color: "#ffffff", cell_x: 256, cell_y: 256, line_width: 1, adaptive_lod: false };
        /* eslint-enable camelcase */
    }

    static docs() {
        return {
            summary: "Configurable grid overlay anchored to a reference image (texture not sampled).",
            description: "Draws an axis-aligned grid in image-source pixel coordinates. Declares one data reference used purely as a coordinate anchor — the configurator auto-binds it so the grid pans/zooms with the image. Cell sizes are in image pixels; line width is in screen pixels so lines stay readable. With no binding, the grid degrades to screen-pixel space (pixelSize = 1).",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: "any",
                description: "Reference image — used only as a coordinate anchor (not sampled)."
            }],
            controls: [
                { name: "color", ui: "color", valueType: "vec3", default: "#ffffff" },
                { name: "cell_x", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "cell_y", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "line_width", ui: "range_input", valueType: "float", default: 1, min: 0.5, max: 10, step: 0.5 },
                { name: "adaptive_lod", ui: "bool", valueType: "bool", default: false }
            ],
            notes: [
                "The reference texture is bound for coordinate anchoring only; pixels are never sampled.",
                "With no binding, the grid renders in screen pixels (pixelSize = 1).",
                "adaptive_lod snaps cell size to powers of two so the on-screen cell stays in [1×, 2×) of the configured size."
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: () => true,
            description: "Reference image — used only as a coordinate anchor (not sampled)."
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgba",
                accepts: (type, instance) => true,
            },
            color: {
                default: {type: "color", default: "#ff0000", title: "Color: "},
                accepts: (type, instance) => type === "vec3"
            },
            cell_x: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 256, min: 1, max: 8192, step: 1, title: "Cell width (image px): "},
                accepts: (type, instance) => type === "float"
            },
            cell_y: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 256, min: 1, max: 8192, step: 1, title: "Cell height (image px): "},
                accepts: (type, instance) => type === "float"
            },
            line_width: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 1, min: 0.5, max: 10, step: 0.5, title: "Line width (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            adaptive_lod: {  // eslint-disable-line camelcase
                default: {type: "bool", default: true, title: "Adaptive LOD: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        // SimpleUIControl normalizes range/number values to [0, 1] before upload, so the
        // GLSL uniform is a fraction of the configured min..max range. Denormalize via
        // mix(min, max, sample) — same pattern as iconmap_decodeCellSize.
        // pixelSize is OSD's image-zoom (screen-px per image-px); convert via divide.
        const f = (n) => $.FlexRenderer.ShaderLayer.toShaderFloatString(n, 0, 5);
        const cx = this.cell_x.params;
        const cy = this.cell_y.params;
        const lw = this.line_width.params;
        return `
    float cellX = max(mix(${f(cx.min)}, ${f(cx.max)}, ${this.cell_x.sample()}), 1.0);
    float cellY = max(mix(${f(cy.min)}, ${f(cy.max)}, ${this.cell_y.sample()}), 1.0);
    float scale = max(pixelSize, 1e-6);

    // Symmetric LOD: snap cell size to a power of two so on-screen cell stays
    // in [1×, 2×) of the configured size. pixelSize<0.5 → merge; pixelSize≥2 → subdivide.
    if (${this.adaptive_lod.sample()}) {
        float lodMult = exp2(-floor(log2(scale)));
        cellX *= lodMult;
        cellY *= lodMult;
    }

    vec2 imgCoord = (gl_FragCoord.xy - imageOriginPx) / scale;

    float modX = mod(imgCoord.x, cellX);
    float modY = mod(imgCoord.y, cellY);
    float dx = min(modX, cellX - modX);
    float dy = min(modY, cellY - modY);

    // Convert image-pixel distances to screen pixels for a stable line width.
    float minDistScreen = min(dx, dy) * scale;

    float halfWidth = mix(${f(lw.min)}, ${f(lw.max)}, ${this.line_width.sample()}) * 0.5;
    float feather = max(fwidth(minDistScreen), 1e-4);
    float onLine = 1.0 - smoothstep(halfWidth - feather, halfWidth + feather, minDistScreen);

    return vec4(${this.color.sample()}, onLine);
`;
    }
});
})(OpenSeadragon);

(function($) {

    /**
     * A shader layer grouping multiple shader layers and combining them into one output
     */
    $.FlexRenderer.ShaderMediator.registerLayer(
        class extends $.FlexRenderer.ShaderLayer {
            static type() {
                return "group";
            }

            static name() {
                return "Group";
            }

            static description() {
                return "Group shader layers.";
            }

            static docs() {
                return {
                    summary: "Composite shader that evaluates child shader layers in group order.",
                    description: "Instantiates nested shader configurations from the group's shaders map, evaluates them in the configured order, and combines their outputs using each child shader's blend or clip mode.",
                    kind: "shader",
                    inputs: [],
                    config: {
                        shaders: "Map of child shader id to child ShaderConfig.",
                        order: "Optional ordered list of child shader ids."
                    },
                    notes: [
                        "The group shader itself does not declare renderer-native controls.",
                        "Child shaders are initialized, loaded, drawn, and destroyed through the group."
                    ]
                };
            }

            static sources() {
                return [];
            }

            static get defaultControls() {
                return {};
            }

            createShaderLayer(id, config) {
                id = $.FlexRenderer.sanitizeKey(id);

                const ShaderLayer = $.FlexRenderer.ShaderMediator.getClass(config.type);
                if (!ShaderLayer) {
                    throw new Error(`Unknown shader layer type '${config.type}'`);
                }

                const defaultConfig = {
                    id: id,
                    name: "Layer",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [],
                    params: {},
                    cache: {},
                };

                for (let propName in defaultConfig) {
                    if (config[propName] === undefined) {
                        config[propName] = defaultConfig[propName];
                    }
                }

                const shaderLayer = new ShaderLayer(
                    id,
                    {
                        shaderConfig: config,
                        webglContext: this.webglContext,
                        params: config.params,
                        interactive: this._interactive,

                        invalidate: this.invalidate,
                        rebuild: this._rebuild,
                        refetch: this._refetch,
                    }
                );

                shaderLayer.construct();

                return shaderLayer;
            }

            construct() {
                super.construct();

                this.shaderLayers = {};

                const shaderLayerConfigs = this.__shaderConfig["shaders"] || {};

                for (let id in shaderLayerConfigs) {
                    let config = shaderLayerConfigs[id];
                    $.console.log("Creating shader layer", id, config);
                    this.shaderLayers[id] = this.createShaderLayer(id, config);
                }

                this.shaderLayerOrder = this.__shaderConfig["order"] || Object.keys(shaderLayerConfigs);
            }

            init() {
                super.init();

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].init();
                }
            }

            destroy() {
                if (this.shaderLayers) {
                    for (let id in this.shaderLayers) {
                        if (this.shaderLayers[id]) {
                            this.shaderLayers[id].destroy();
                        }
                    }
                }

                this.shaderLayers = {};
                this.shaderLayerOrder = [];
            }

            glLoaded(program, gl) {
                super.glLoaded(program, gl);

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].glLoaded(program, gl);
                }
            }

            glDrawing(program, gl) {
                super.glDrawing(program, gl);

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].glDrawing(program, gl);
                }
            }

            constructShaderLayerCode(shaderLayer) {
                return `
// ${shaderLayer.constructor.type()} - definitions
${shaderLayer.getFragmentShaderDefinition()}
// ${shaderLayer.constructor.type()} - blending function
${shaderLayer.getCustomBlendFunction(shaderLayer.uid + "_blend_func")}
// ${shaderLayer.constructor.type()} - final function definition
vec4 compute_${shaderLayer.uid}() {
    ${shaderLayer.getFragmentShaderExecution()}
}
`;
            }

            getFragmentShaderDefinition() {
                let definition = super.getFragmentShaderDefinition() + "\n";

                for (let id of this.shaderLayerOrder) {
                    let shaderLayer = this.shaderLayers[id];

                    definition += this.constructShaderLayerCode(shaderLayer);
                }

                return definition;
            }

            // TODO: move the grouping logic into WebGLContext
            getFragmentShaderExecution() {
                let execution = "vec4 new_color = vec4(0.0);\nvec4 combined_color = vec4(0.0);\nvec4 clip_color = vec4(0.0);";

                const shaderMap = this.shaderLayers;
                const keyOrder = this.shaderLayerOrder;

                const getStencilPassCode = shader => {
                    const shaderConfig = shader.getConfig();
                    const hasSources = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length > 0;

                    if (!hasSources) {
                        return "    stencilPasses = true;";
                    }

                    return `    stencilPasses = osd_stencil_texture(${shader.__renderSlot}, 0, v_texture_coords).r > 0.995;`;
                };

                let remainingBlendShader = null;
                const getRemainingBlending = () => {
                    if (!remainingBlendShader) {
                        return "";
                    }

                    return `
${getStencilPassCode(remainingBlendShader)}
    combined_color = ${remainingBlendShader.mode === "show" ? "blend_source_over" : remainingBlendShader.uid + "_blend_func"}(new_color, combined_color);
`;
                };

                for (const shaderId of keyOrder) {
                    const shaderLayer = shaderMap[shaderId];
                    const shaderConf = shaderLayer.getConfig();
                    const slot = shaderLayer.__renderSlot;
                    const opacityModifier = shaderLayer.opacity ? `opacity * ${shaderLayer.opacity.sample()}` : "opacity";

                    if (shaderConf.type === "none" || shaderConf.error || !shaderConf.visible) {
                        if (shaderLayer._mode !== "clip") {
                            execution += `${getRemainingBlending()}
// ${shaderLayer.constructor.type()} - Disabled (error or visible = false)
new_color = vec4(0.0);`;
                            remainingBlendShader = shaderLayer;
                        } else {
                            execution += `
// ${shaderLayer.constructor.type()} - Disabled with Clipmask (error or visible = false)
new_color = ${shaderLayer.uid}_blend_func(vec4(0.0), new_color);`;
                        }

                        continue;
                    }

                    execution += `
    instance_id = ${slot};
${getStencilPassCode(shaderLayer)}
    vec4 attrs_${slot} = u_shaderVariables[${slot}];
    opacity = attrs_${slot}.x;
    pixelSize = attrs_${slot}.y;
    imageOriginPx = attrs_${slot}.zw;
    zoom = u_zoom;`;

                    if (shaderLayer._mode !== "clip") {
                        execution += `${getRemainingBlending()}
// ${shaderLayer.constructor.type()} - Blending
new_color = compute_${shaderLayer.uid}();
new_color.a = new_color.a * ${opacityModifier};`;

                        remainingBlendShader = shaderLayer;
                    } else {
                        execution += `
// ${shaderLayer.constructor.type()} - Clipping
clip_color = compute_${shaderLayer.uid}();
clip_color.a = clip_color.a * ${opacityModifier};
new_color = ${shaderLayer.uid}_blend_func(clip_color, new_color);`;
                    }
                }

                if (remainingBlendShader) {
                    execution += getRemainingBlending();
                }

                execution += "\nreturn combined_color;";

                return execution;
            }
        }
    );

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

    static intent() {
        return "Tint a single scalar channel and gate it with a threshold. Pick to highlight \"above/below value\" regions.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return { color: "#fff700", threshold: 50, inverse: false };
    }

    static docs() {
        return {
            summary: "Heatmap shader for one scalar channel.",
            description: "Uses the sampled scalar value as alpha and colors visible pixels with a configurable RGB control once the sampled value passes the threshold. In inverted mode, values below the threshold are shown with full alpha while values above the threshold are inverted.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "The value to map to opacity"
            }],
            controls: [
                { name: "use_channel0", default: "r" },
                { name: "color", ui: "color", valueType: "vec3", default: "#fff700" },
                { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 },
                { name: "inverse", ui: "bool", valueType: "bool", default: false }
            ]
        };
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
     * Class-icon shader
     *
     * Scalar input is classified by the advanced slider control.
     * Each interval is mapped to its own icon texture.
     * The icon is then repeated over the visible class area using a configurable grid.
     */
    class IconMapShader extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "iconmap";
        }

        static name() {
            return "IconMap";
        }

        static description() {
            return "maps scalar classes to repeated per-class icons";
        }

        static docs() {
            return {
                summary: "Scalar-to-icon class shader.",
                description: "Samples one scalar channel, classifies each sparse screen-space marker cell by the value at its center, maps each interval to its own icon texture, and renders the whole icon for that class.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "1D scalar data used for class selection"
                }],
                controls: [
                    { name: "use_channel0", default: "r" },
                    {
                        name: "threshold",
                        ui: "advanced_slider",
                        valueType: "float",
                        default: {
                            default: [0.25, 0.75],
                            mask: [1, 1, 1],
                            maskOnly: false
                        },
                        required: {
                            type: "advanced_slider",
                            inverted: false
                        }
                    },
                    {
                        name: "iconN",
                        ui: "icon",
                        valueType: "vec4",
                        description: "One icon control is generated per class interval."
                    },
                    { name: "grid_layout", ui: "select_int", valueType: "int", default: { default: 0 } },
                    { name: "cell_size", ui: "float", valueType: "float", default: { default: 15 } },
                    { name: "jitter", ui: "float", valueType: "float", default: { default: 0 } },
                    { name: "icon_scale", ui: "float", valueType: "float", default: { default: 0.82 } },
                    { name: "clip_icons", ui: "bool", valueType: "bool", default: { default: false } }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x === 1,
                description: "1D scalar data used for class selection"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },
                threshold: {
                    default: {
                        type: "advanced_slider",
                        default: [0.25, 0.75],
                        mask: [1, 1, 1],
                        // The slider's `maskOnly=false` mode returns the
                        // positional ratio of which interval the value fell
                        // into (bigger / actualLength = i / breakCount), with
                        // mask[] left alone as the visibility toggle. IconMap
                        // recovers the integer interval index from that ratio
                        // in getFragmentShaderExecution; mask is no longer
                        // overloaded as an index carrier.
                        maskOnly: false,
                        title: "Breaks",
                        pips: {
                            mode: "positions",
                            values: [0, 25, 50, 75, 100],
                            density: 4
                        }
                    },
                    accepts: (type) => type === "float",
                    required: { type: "advanced_slider", inverted: false }
                },
                icons: {
                    array: {
                        count: (layer) => layer._getClassCount(),
                        name: (index) => `icon${index}`,
                        item: (index, layer) => ({
                            default: {
                                type: "icon",
                                title: `Icon ${index + 1}`,
                                default: layer._getDefaultIconName(index),
                                size: 384,
                                padding: 10,
                                previewSize: 40
                            },
                            accepts: (type) => type === "vec4"
                        })
                    }
                },
                grid_layout: {  // eslint-disable-line camelcase
                    default: {
                        type: "select",
                        title: "Grid Layout",
                        default: 0,
                        options: [
                            { value: 0, label: "Square" },
                            { value: 1, label: "Brick" },
                            { value: 2, label: "Hex" }
                        ]
                    },
                    accepts: (type) => type === "int"
                },
                cell_size: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Cell Size (px)",
                        default: 15,
                        min: 3,
                        max: 50,
                        step: 1
                    },
                    accepts: (type) => type === "float"
                },
                jitter: {
                    default: {
                        type: "range_input",
                        title: "Jitter",
                        default: 0,
                        min: 0,
                        max: 0.45,
                        step: 0.01
                    },
                    accepts: (type) => type === "float"
                },
                icon_scale: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Icon Size",
                        default: 0.82,
                        min: 0.3,
                        max: 1.0,
                        step: 0.01
                    },
                    accepts: (type) => type === "float"
                },
                clip_icons: { // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        title: "Clip To Data",
                        default: false
                    },
                    accepts: (type) => type === "bool"
                }
            };
        }

        init() {
            if (this.threshold) {
                this.threshold.on("breaks", (raw) => {
                    const nextClassCount = Array.isArray(raw) ? raw.length + 1 : this._getClassCount();
                    if (nextClassCount !== this._getIconControlCount() && typeof this._refresh === "function") {
                        this._refresh();
                        return;
                    }
                    // Class count unchanged: the breaks uniform alone moved.
                    // GLSL re-classifies on the next draw via the slider's
                    // bigger/actualLength positional-ratio path, so we just
                    // invalidate. No mask coupling to maintain.
                    this.invalidate();
                }, true);
            }

            super.init();
        }

        _getClassCount() {
            if (this.threshold && Array.isArray(this.threshold.encodedValues)) {
                return this.threshold.getIntervalCount();
            }
            const configuredBreaks = this._getConfiguredThresholdBreaks();
            if (configuredBreaks) {
                return Math.max(1, configuredBreaks.length + 1);
            }
            const fallbackBreaks = this.constructor.defaultControls.threshold.default.default || [];
            return Math.max(1, fallbackBreaks.length + 1);
        }

        _getConfiguredThresholdBreaks() {
            const configured = this._customControls && this._customControls.threshold;
            if (!configured || typeof configured !== "object") {
                return null;
            }

            if (Array.isArray(configured.breaks)) {
                return configured.breaks;
            }

            if (Array.isArray(configured.default)) {
                return configured.default;
            }

            if (configured.default && typeof configured.default === "object" && Array.isArray(configured.default.default)) {
                return configured.default.default;
            }

            return null;
        }

        _getIconControlCount() {
            let count = 0;
            while (this._getIconControl(count)) {
                count++;
            }
            return count;
        }

        _getDefaultIconName(index) {
            const defaultIcons = ["diamond", "circle", "triangle-up", "square", "star", "flag", "plus", "check"];
            return defaultIcons[index % defaultIcons.length];
        }

        _getIconControl(index) {
            const control = this[`icon${index}`];
            return control && typeof control.sample === "function" ? control : null;
        }

        _buildGridHelpers() {
            const uid = this.uid;

            return `
float iconmap_decodeCellSize_${uid}(float rawValue) {
        return rawValue <= 1.0 ? mix(${this.cell_size.params.min}.0, ${this.cell_size.params.max}.0, clamp(rawValue, 0.0, 1.0)) : rawValue;
    }

float iconmap_hash_${uid}(vec2 value) {
        return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
    }

vec2 iconmap_hash2_${uid}(vec2 value) {
        return vec2(
            iconmap_hash_${uid}(value),
            iconmap_hash_${uid}(value + vec2(19.19, 73.73))
        );
    }

vec2 iconmap_jitterOffset_${uid}(vec2 cellId, vec2 spacing, float amount) {
        if (amount <= 0.0) {
            return vec2(0.0);
        }
        vec2 rnd = iconmap_hash2_${uid}(cellId) * 2.0 - 1.0;
        return rnd * amount * spacing;
    }

vec3 iconmap_squarePlacement_${uid}(vec2 fragCoord, float cellSize, float jitterAmount, bool brickLayout) {
        float row = floor(fragCoord.y / cellSize);
        float shift = brickLayout ? 0.5 * cellSize * mod(row, 2.0) : 0.0;
        float col = floor((fragCoord.x + shift) / cellSize);
        vec2 centerPx = vec2((col + 0.5) * cellSize - shift, (row + 0.5) * cellSize);
        centerPx += iconmap_jitterOffset_${uid}(vec2(col, row), vec2(cellSize), jitterAmount);
        return vec3(centerPx, cellSize);
    }

vec3 iconmap_hexPlacement_${uid}(vec2 fragCoord, float cellSize, float jitterAmount) {
        float rowHeight = cellSize * 0.8660254037844386;
        float baseRow = floor(fragCoord.y / rowHeight);
        vec2 bestCenter = fragCoord;
        float bestDist2 = 1e30;

        for (int rowOffset = -1; rowOffset <= 1; rowOffset++) {
            float row = baseRow + float(rowOffset);
            float shift = 0.5 * cellSize * mod(row, 2.0);
            float colBase = floor((fragCoord.x + shift) / cellSize);

            for (int colOffset = -1; colOffset <= 1; colOffset++) {
                float col = colBase + float(colOffset);
                vec2 centerPx = vec2((col + 0.5) * cellSize - shift, (row + 0.5) * rowHeight);
                centerPx += iconmap_jitterOffset_${uid}(vec2(col, row), vec2(cellSize, rowHeight), jitterAmount);
                vec2 delta = fragCoord - centerPx;
                float dist2 = dot(delta, delta);
                if (dist2 < bestDist2) {
                    bestDist2 = dist2;
                    bestCenter = centerPx;
                }
            }
        }

        return vec3(bestCenter, rowHeight);
    }

vec3 iconmap_gridPlacement_${uid}(vec2 fragCoord) {
        int layoutMode = ${this.grid_layout.sample()};
        float cellSize = max(iconmap_decodeCellSize_${uid}(${this.cell_size.sample()}), 1.0);
        float jitterAmount = clamp(${this.jitter.sample()}, 0.0, 0.45);

        if (layoutMode == 2) {
            return iconmap_hexPlacement_${uid}(fragCoord, cellSize, jitterAmount);
        }

        return iconmap_squarePlacement_${uid}(fragCoord, cellSize, jitterAmount, layoutMode == 1);
    }

vec3 iconmap_gridUv_${uid}(vec2 fragCoord) {
        vec3 placement = iconmap_gridPlacement_${uid}(fragCoord);
        float iconScale = clamp(${this.icon_scale.sample()}, 0.3, 1.0);
        float padding = clamp((1.0 - iconScale) * 0.5, 0.0, 0.49);
        vec2 centerPx = placement.xy;
        float footprint = max(placement.z, 1.0);
        vec2 local = (fragCoord - centerPx) / vec2(footprint) + 0.5;

        vec2 spacingVec = vec2(padding);
        vec2 feather = max(fwidth(local), vec2(1e-4));

        vec2 lowMask = smoothstep(spacingVec - feather, spacingVec + feather, local);
        vec2 highMask = 1.0 - smoothstep(vec2(1.0) - spacingVec - feather, vec2(1.0) - spacingVec + feather, local);
        float inside = lowMask.x * lowMask.y * highMask.x * highMask.y;

        vec2 denom = max(vec2(1.0) - 2.0 * spacingVec, vec2(1e-5));
        vec2 paddedUv = clamp((local - spacingVec) / denom, 0.0, 1.0);

        return vec3(paddedUv, inside);
    }

vec2 iconmap_cellCenterUv_${uid}(vec2 dataUv) {
        vec2 centerPx = iconmap_gridPlacement_${uid}(gl_FragCoord.xy).xy;
        vec2 deltaPx = centerPx - gl_FragCoord.xy;
        return dataUv + dFdx(dataUv) * deltaPx.x + dFdy(dataUv) * deltaPx.y;
    }`;
        }

        _buildIconSamplerFunction() {
            const uid = this.uid;
            const classCount = this._getClassCount();
            const branches = [];
            let fallbackExpr = "vec4(0.0)";

            for (let index = 0; index < classCount; index++) {
                const control = this._getIconControl(index);
                if (!control) {
                    continue;
                }
                const sampleExpr = control.sample("localUv", "vec2");
                fallbackExpr = sampleExpr;
                if (index === 0) {
                    branches.push(`if (classIndex <= 0) { return ${sampleExpr}; }`);
                } else {
                    branches.push(`if (classIndex == ${index}) { return ${sampleExpr}; }`);
                }
            }

            return `
vec4 iconmap_sampleIcon_${uid}(int classIndex, vec2 localUv) {
        ${branches.join("\n        ")}
        return ${fallbackExpr};
    }`;
        }

        getFragmentShaderDefinition() {
            return `
${super.getFragmentShaderDefinition()}
${this._buildGridHelpers()}
${this._buildIconSamplerFunction()}
`;
        }

        getFragmentShaderExecution() {
            const uid = this.uid;
            const thresholdMaskAtCenter = `sample_advanced_slider(centerChan, ${this.threshold.webGLVariableName}_breaks, ${this.threshold.webGLVariableName}_mask, true, ${this.threshold.webGLVariableName}_min)`;
            const thresholdMaskAtPoint = `sample_advanced_slider(chan, ${this.threshold.webGLVariableName}_breaks, ${this.threshold.webGLVariableName}_mask, true, ${this.threshold.webGLVariableName}_min)`;
            // breakCount = number of breaks = classCount - 1. The slider
            // returns i/breakCount as a positional ratio (maskOnly=false on
            // this control), so multiplying by breakCount and rounding
            // recovers the integer interval index. With one class there are
            // no breaks; classIndex is statically 0.
            const breakCount = Math.max(0, this._getClassCount() - 1);
            const classIndexExpr = breakCount === 0
                ? "int classIndex = 0;"
                : `int classIndex = int(floor(classRatio * float(${breakCount}) + 0.5));`;

            return `
float chan = ${this.sampleChannel("v_texture_coords")};
vec3 grid = iconmap_gridUv_${uid}(gl_FragCoord.xy);

if (grid.z <= 0.0) {
    return vec4(0.0);
}

vec2 centerUv = iconmap_cellCenterUv_${uid}(v_texture_coords);
float centerChan = ${this.sampleChannel("centerUv")};
float centerMask = ${thresholdMaskAtCenter};
float classRatio = ${this.threshold.sample("centerChan", "float")};
float visibleCenter = step(0.05, centerMask);

if (visibleCenter <= 0.0) {
    return vec4(0.0);
}

${classIndexExpr}
vec4 icon = iconmap_sampleIcon_${uid}(classIndex, grid.xy);
float visible = ${this.clip_icons.sample()} ? step(0.05, ${thresholdMaskAtPoint}) : 1.0;

return vec4(icon.rgb, icon.a * visible * grid.z);
`;
        }
    }

    $.FlexRenderer.ShaderMediator.registerLayer(IconMapShader);
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

    static docs() {
        return {
            summary: "Sobel edge detector for RGB input.",
            description: "Samples a 3x3 neighborhood, applies Sobel X and Y kernels independently to RGB data, and returns grayscale edge strength with alpha fixed to 1.0.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [3],
                description: "Data to detect edges on"
            }],
            controls: [
                { name: "use_channel0", default: "rgb" }
            ]
        };
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
 * H&E (and related) stain-separation shader.
 *
 * Implements Ruifrok–Johnston color deconvolution for brightfield slides.
 * Each preset bakes a 3x3 stain matrix M whose rows are the normalized RGB
 * optical-density signatures of the stains. The inverse Q = M^-1 is computed
 * once at module load and injected as a GLSL constant; per pixel:
 *
 *   OD     = -log10((rgb*255 + 1) / 256)
 *   stains = OD * Q     (vec3 * mat3 -> row-vector multiply)
 *
 * The user picks one stain to display. Output is either the raw concentration
 * (debug) or the concentration multiplied by a tint color.
 */

// Standard Ruifrok stain RGB-OD vectors.
const STAIN_VECTORS = {
    H: [0.65, 0.70, 0.29],
    E: [0.07, 0.99, 0.11],
    DAB: [0.27, 0.57, 0.78],
    MG: [0.0, 1.0, 0.0],
    R: [0.27, 0.57, 0.78]   // Ruifrok's residual for HE
};

// Stain enum -> select option index. Must match SHADER_STAIN_* constants below.
const STAIN_H = 0;
const STAIN_E = 1;
const STAIN_DAB = 2;
const STAIN_MG = 3;
const STAIN_R = 4;

function normalize3(v) {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

// Build a 3-row stain matrix; if autoResidualIndex is given, fill that row
// with the cross product of the other two normalized rows.
function buildMatrix(rows, autoResidualIndex) {
    const m = rows.map(r => r ? normalize3(r) : null);
    if (autoResidualIndex !== undefined) {
        const others = m.filter((_, i) => i !== autoResidualIndex);
        m[autoResidualIndex] = normalize3(cross3(others[0], others[1]));
    }
    return m;
}

function inverse3(rows) {
    const [a, b, c] = rows[0];
    const [d, e, f] = rows[1];
    const [g, h, i] = rows[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) {
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    }
    const k = 1 / det;
    return [
        [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
        [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
        [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k]
    ];
}

// Emit a GLSL mat3 literal in column-major order from a row-major JS matrix.
// We use vec3 * mat3 in GLSL, which is row-vector * matrix; storing M^-1 in
// the natural column-major layout makes that multiply produce the right thing.
function glslMat3(rowMajor) {
    const f = (x) => Number(x).toFixed(6);
    const m = rowMajor;
    return `mat3(` +
        `${f(m[0][0])}, ${f(m[1][0])}, ${f(m[2][0])}, ` +
        `${f(m[0][1])}, ${f(m[1][1])}, ${f(m[2][1])}, ` +
        `${f(m[0][2])}, ${f(m[1][2])}, ${f(m[2][2])})`;
}

function glslVec3(v) {
    const f = (x) => Number(x).toFixed(6);
    return `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
}

// preset id -> { matrix rows (input order), GLSL inverse literal, mapping
// from stain enum to row index, list of stains the preset exposes }.
// Row order in each `rows` array fixes the index of each stain in `stains`
// that comes out of the deconvolution.
const PRESETS = (() => {
    function build(id, rowsInput, stainOrder, autoResidualIndex) {
        const rows = buildMatrix(rowsInput, autoResidualIndex);
        const inv = inverse3(rows);
        // stainEnum -> row index (0..2), or -1 if not in this preset.
        const stainToRow = { H: -1, E: -1, DAB: -1, MG: -1, R: -1 };
        stainOrder.forEach((name, idx) => {
            stainToRow[name] = idx;
        });
        return {
            id,
            matrixInvGlsl: glslMat3(inv),
            // Per-row normalized stain RGB-OD vector, used for natural reconstruction.
            stainVecGlsl: rows.map(glslVec3),
            stainToRow,
            stainOrder
        };
    }

    return {
        he: build("he", [STAIN_VECTORS.H, STAIN_VECTORS.E, STAIN_VECTORS.R], ["H", "E", "R"]),
        hdab: build("hdab", [STAIN_VECTORS.H, STAIN_VECTORS.DAB, null], ["H", "DAB", "R"], 2),
        hedab: build("hedab", [STAIN_VECTORS.H, STAIN_VECTORS.E, STAIN_VECTORS.DAB], ["H", "E", "DAB"]),
        mgdab: build("mgdab", [STAIN_VECTORS.MG, STAIN_VECTORS.DAB, null], ["MG", "DAB", "R"], 2)
    };
})();

const PRESET_INDEX = ["he", "hdab", "hedab", "mgdab"];

// Build the GLSL fragment that maps (preset, stain) -> matrix row index, plus
// the helper that returns the per-preset M^-1. Indices are stable across the
// shader uniform values for `preset` and `stain`.
function buildHelpersGlsl(uid) {
    const matrixBranches = PRESET_INDEX
        .map((id, i) => `    if (preset == ${i}) return ${PRESETS[id].matrixInvGlsl};`)
        .join("\n");

    const rowBranches = PRESET_INDEX.map((id, presetIdx) => {
        const m = PRESETS[id].stainToRow;
        const checks = [
            ["H", STAIN_H],
            ["E", STAIN_E],
            ["DAB", STAIN_DAB],
            ["MG", STAIN_MG],
            ["R", STAIN_R]
        ]
            .filter(([key]) => m[key] >= 0)
            .map(([key, enumVal]) => `        if (stain == ${enumVal}) return ${m[key]};`)
            .join("\n");
        return `    if (preset == ${presetIdx}) {\n${checks}\n        return -1;\n    }`;
    }).join("\n");

    const vectorBranches = PRESET_INDEX.map((id, presetIdx) => {
        const vecs = PRESETS[id].stainVecGlsl;
        const checks = vecs.map((v, row) => `        if (row == ${row}) return ${v};`).join("\n");
        return `    if (preset == ${presetIdx}) {\n${checks}\n    }`;
    }).join("\n");

    return `
mat3 stain_matrix_inv_${uid}(int preset) {
${matrixBranches}
    return mat3(1.0);
}

int stain_row_${uid}(int preset, int stain) {
${rowBranches}
    return -1;
}

vec3 stain_vector_${uid}(int preset, int row) {
${vectorBranches}
    return vec3(0.0);
}

float stain_pick_${uid}(vec3 stains, int row) {
    if (row == 0) return stains.x;
    if (row == 1) return stains.y;
    return stains.z;
}
`;
}

$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "stain-separation";
    }

    static name() {
        return "H&E stain separation";
    }

    static description() {
        return "Ruifrok–Johnston color deconvolution for brightfield H&E and related stain combinations (H-DAB, HE-DAB, MG-DAB).";
    }

    static intent() {
        return "Separate and visualise individual stains in brightfield RGB slides (H&E, H-DAB, etc.).";
    }

    static expects() {
        return { dataKind: "rgb", channels: 3 };
    }

    static exampleParams() {
        return {
            preset: 0,
            stain: 0,
            style: 0,
            tintColor: "#5b3ea4",
            intensity: 1.0
        };
    }

    static docs() {
        return {
            summary: "Brightfield stain separation via Ruifrok–Johnston color deconvolution.",
            description: "Reads RGB, converts to optical density, multiplies by the inverse stain matrix of the chosen preset, and renders one stain channel. The default Natural style physically reconstructs what the slide would look like with only the chosen stain present (opaque, calibrated colors); Tinted multiplies a custom color by the concentration; Grayscale shows the raw concentration. Stain options not present in the chosen preset render as transparent.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [3, 4],
                description: "RGB brightfield slide (alpha is ignored)"
            }],
            controls: [
                { name: "use_channel0", required: "rgb" },
                {
                    name: "preset",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Stain matrix preset: 0=H&E, 1=H-DAB, 2=HE-DAB, 3=MG-DAB."
                },
                {
                    name: "stain",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Which stain to display: 0=Hematoxylin, 1=Eosin, 2=DAB, 3=Methyl Green, 4=Residual. Stains absent from the chosen preset render transparent."
                },
                {
                    name: "style",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Display style: 0=Natural (physically reconstructed single-stain slide, opaque), 1=Tinted (stain concentration multiplied by tintColor, alpha = concentration), 2=Grayscale (concentration as gray, alpha = concentration)."
                },
                { name: "tintColor", ui: "color", valueType: "vec3", default: "#5b3ea4" },
                { name: "intensity", ui: "range_input", valueType: "float", default: 1.0, min: 0, max: 10, step: 0.1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (n) => n >= 3,
            description: "RGB brightfield slide (alpha is ignored)"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                required: "rgb"
            },
            preset: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Preset",
                    options: [
                        { value: 0, label: "H&E" },
                        { value: 1, label: "H-DAB" },
                        { value: 2, label: "HE-DAB" },
                        { value: 3, label: "MG-DAB" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            stain: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Stain",
                    options: [
                        { value: STAIN_H, label: "Hematoxylin" },
                        { value: STAIN_E, label: "Eosin" },
                        { value: STAIN_DAB, label: "DAB" },
                        { value: STAIN_MG, label: "Methyl Green" },
                        { value: STAIN_R, label: "Residual" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            style: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Style",
                    options: [
                        { value: 0, label: "Natural" },
                        { value: 1, label: "Tinted" },
                        { value: 2, label: "Grayscale" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            tintColor: {
                default: { type: "color", default: "#5b3ea4", title: "Tint" },
                accepts: (type) => type === "vec3"
            },
            intensity: {
                default: { type: "range_input", default: 1.0, min: 0, max: 10, step: 0.1, title: "Intensity" },
                accepts: (type) => type === "float"
            }
        };
    }

    getFragmentShaderDefinition() {
        return `
${super.getFragmentShaderDefinition()}
${buildHelpersGlsl(this.uid)}
`;
    }

    getFragmentShaderExecution() {
        const uid = this.uid;
        return `
    vec3 rgb = ${this.sampleChannel('v_texture_coords', 0, true)};
    rgb = clamp(rgb, vec3(1.0 / 255.0), vec3(1.0));
    vec3 od = -log((rgb * 255.0 + 1.0) / 256.0) / log(10.0);

    int preset = int(${this.preset.sample()});
    int stain  = int(${this.stain.sample()});
    int row = stain_row_${uid}(preset, stain);
    if (row < 0) {
        return vec4(0.0);
    }

    mat3 Q = stain_matrix_inv_${uid}(preset);
    vec3 stains = od * Q;
    float v = max(stain_pick_${uid}(stains, row), 0.0);
    float scaled = ${this.filter(`v * ${this.intensity.sample()}`)};

    int style = int(${this.style.sample()});
    if (style == 0) {
        // Natural reconstruction: rebuild what the slide would look like with
        // only this stain present. exp(-c*s*ln10) inverts the OD formulation
        // back to RGB in [0,1]. Output is fully opaque so contrast is preserved
        // against any background.
        vec3 stainVec = stain_vector_${uid}(preset, row);
        vec3 reconRgb = exp(-scaled * stainVec * log(10.0));
        return vec4(clamp(reconRgb, 0.0, 1.0), ${this.opacity.sample()});
    }

    float t = clamp(scaled, 0.0, 1.0);
    if (style == 2) {
        return vec4(vec3(t), t);
    }
    return vec4(t * ${this.tintColor.sample()}, t);
`;
    }
});
})(OpenSeadragon);

(function($) {
/**
 * Shader that uses a texture via a texture atlas
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {
    static type() {
        return "texture";
    }

    static name() {
        return "Texture";
    }

    static description() {
        return "use a texture via texture atlas";
    }

    static docs() {
        return {
            summary: "Texture compositing shader using the second-pass atlas.",
            description: "Samples the primary RGBA input and a texture selected by the image control, then blends them with blendAlpha using the minimum RGB of both samples as the blend mask.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [4],
                description: "first pass colors"
            }],
            controls: [
                { name: "use_channel0", default: "rgba" },
                { name: "texture", ui: "image", valueType: "vec4", default: { type: "image" } }
            ]
        };
    }

    static sources() {
        return [
            {
                acceptsChannelCount: (x) => x === 4,
                description: "first pass colors",
            },
        ];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgba",
            },
            texture: {
                default: { type: "image" },
                accepts: (type, instance) => type === "vec4",
            },
        };
    }

    getFragmentShaderExecution() {
        return `
vec4 chan = ${this.sampleChannel('v_texture_coords', 0)};
vec4 tex = ${this.texture.sample('v_texture_coords * 2.0', 'vec2')};

return blendAlpha(chan, tex, min(chan.rgb, tex.rgb));
`;
    }
});

})(OpenSeadragon);

(function($) {

    $.FlexRenderer.ShaderMediator.registerLayer(class Threshold extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "threshold";
        }

        static name() {
            return "Threshold";
        }

        static description() {
            return "Global threshold preview with OpenCV-like threshold modes.";
        }

        static docs() {
            return {
                summary: "Global threshold shader for a single scalar input channel.",
                description: "Implements five threshold modes analogous to binary, binary inverse, truncation, to-zero, and to-zero inverse. Binary modes can optionally be colorized with foreground and background colors.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Single scalar channel / derived scalar field"
                }],
                controls: [
                    { name: "threshold", ui: "range", valueType: "float", default: 0.5, min: 0, max: 1, step: 0.005 },
                    { name: "max_value", ui: "range", valueType: "float", default: 1, min: 0, max: 1, step: 0.005 },
                    {
                        name: "version",
                        ui: "select",
                        valueType: "int",
                        default: 0,
                        options: [
                            { value: 0, label: "Binary" },
                            { value: 1, label: "Binary inv" },
                            { value: 2, label: "Trunc" },
                            { value: 3, label: "To zero" },
                            { value: 4, label: "To zero inv" }
                        ]
                    },
                    { name: "colorize_binary", ui: "bool", valueType: "bool", default: true },
                    { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                    { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (n) => n === 1,
                description: "Single scalar channel / derived scalar field"
            }];
        }

        static get defaultControls() {
            return {
                threshold: {
                    default: {
                        type: "range",
                        default: 0.5,
                        min: 0,
                        max: 1,
                        step: 0.005,
                        title: "Threshold"
                    },
                    accepts: (type) => type === "float"
                },

                max_value: {  // eslint-disable-line camelcase
                    default: {
                        type: "range",
                        default: 1.0,
                        min: 0,
                        max: 1,
                        step: 0.005,
                        title: "Max value"
                    },
                    accepts: (type) => type === "float"
                },

                version: {
                    default: {
                        type: "select",
                        default: 0,
                        title: "Mode",
                        options: [
                            { value: 0, label: "Binary" },
                            { value: 1, label: "Binary inv" },
                            { value: 2, label: "Trunc" },
                            { value: 3, label: "To zero" },
                            { value: 4, label: "To zero inv" }
                        ]
                    },
                    accepts: (type) => type === "int"
                },

                colorize_binary: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: true,
                        title: "Colorize binary"
                    },
                    accepts: (type) => type === "bool"
                },

                fg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#ffffff",
                        title: "Foreground"
                    },
                    accepts: (type) => type === "vec3"
                },

                bg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#000000",
                        title: "Background"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();

            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    float src = ${this.sampleChannel("v_texture_coords")};
    float thr = ${this.threshold.sample()};
    float maxv = ${this.max_value.sample()};
    int mode = int(${this.version.sample()});

    float outv;

    if (mode == 0) {               // THRESH_BINARY
        outv = src > thr ? maxv : 0.0;
    } else if (mode == 1) {        // THRESH_BINARY_INV
        outv = src > thr ? 0.0 : maxv;
    } else if (mode == 2) {        // THRESH_TRUNC
        outv = min(src, thr);
    } else if (mode == 3) {        // THRESH_TOZERO
        outv = src > thr ? src : 0.0;
    } else {                       // THRESH_TOZERO_INV
        outv = src > thr ? 0.0 : src;
    }

    // binary modes can be shown as fg/bg instead of grayscale
    if (${this.colorize_binary.sample()} && (mode == 0 || mode == 1)) {
        float m = maxv > 0.0 ? clamp(outv / maxv, 0.0, 1.0) : 0.0;
        vec3 color = mix(${this.bg_color.sample()}, ${this.fg_color.sample()}, m);
        return vec4(color, ${this.opacity.sample()});
    }

    return vec4(vec3(outv), ${this.opacity.sample()});
`;
        }
    });

})(OpenSeadragon);

(function($) {

$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "time-series";
    }

    static name() {
        return "Time Series";
    }

    static description() {
        return "Wrap one shader and switch its active source through a timeline control.";
    }

    static docs() {
        return {
            summary: "Wrapper shader that delegates rendering to another shader over a selectable series.",
            description: "The wrapper hosts one delegated shader and rewires its tiledImages source list to the currently selected series item. Series entries can be direct world indexes or lazy descriptors resolved externally through drawer.options.shaderSourceResolver.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: null,
                description: "Logical source slot used by the delegated shader. The active tiled image is picked from the series parameter."
            }],
            customParams: [
                {
                    name: "seriesRenderer",
                    default: "identity",
                    description: "Shader type used internally for rendering the selected series element."
                },
                {
                    name: "series",
                    description: "Array of source descriptors addressable through the timeline control. Items can be direct world indexes or opaque entries resolved lazily by drawer.options.shaderSourceResolver."
                }
            ],
            controls: [
                {
                    name: "timeline",
                    ui: "range_input",
                    valueType: "float",
                    required: { type: "range_input" }
                }
            ],
            notes: [
                "Opacity is disabled on this wrapper shader.",
                "Series entries can be direct world indexes or lazy descriptors resolved externally.",
                "Selection changes request source rebinding through the drawer so delegated shaders can react to source metadata changes."
            ]
        };
    }

    static get customParams() {
        return {
            seriesRenderer: {
                usage: "Specify shader type to use in this series. Attach the shader properties as you would normally do with your desired shader.",
                type: "string",
                default: "identity"
            },
            series: {
                type: "json",
                usage: "Specify source descriptors available through the timeline control. Entries may be direct world tiled-image indexes or arbitrary objects/IDs later resolved by drawer.options.shaderSourceResolver."
            }
        };
    }

    static _readWrapperParam(config, name, fallback = undefined) {
        const params = (config && config.params) || {};
        if (params[name] !== undefined) {
            return params[name];
        }
        if (config && config[name] !== undefined) {
            return config[name];
        }
        return fallback;
    }

    static get defaultControls() {
        return {
            timeline: {
                default: { title: "Timeline: " },
                accepts: type => type === "float",
                required: { type: "range_input" }
            },
            opacity: false
        };
    }

    static normalizeConfig(config, context = {}) {
        if (!config || typeof config !== "object") {
            return config;
        }

        const params = config.params || (config.params = {});
        if (config.series !== undefined && params.series === undefined) {
            params.series = config.series;
        }
        if (config.seriesRenderer !== undefined && params.seriesRenderer === undefined) {
            params.seriesRenderer = config.seriesRenderer;
        }

        const series = Array.isArray(params.series) ? params.series : [];
        const defs = this.defaultControls || {};
        const required = defs.timeline && defs.timeline.required ? $.extend(true, {}, defs.timeline.required) : {};
        const fallback = defs.timeline && defs.timeline.default ? $.extend(true, {}, defs.timeline.default) : {};
        const timeline = $.extend(true, {}, fallback, required, params.timeline || {});

        timeline.type = "range_input";

        const step = Number(timeline.step);
        timeline.step = Number.isFinite(step) && step > 0 ? step : 1;

        const min = Number(timeline.min);
        timeline.min = Number.isFinite(min) ? min : 0;

        if ((timeline.min % timeline.step) !== 0) {
            timeline.min = 0;
        }

        const maxIndex = Math.max(0, series.length - 1);
        timeline.max = timeline.min + maxIndex * timeline.step;

        const defaultValue = Number(timeline.default);
        if (!Number.isFinite(defaultValue) || ((defaultValue - timeline.min) % timeline.step) !== 0) {
            timeline.default = timeline.min;
        } else {
            timeline.default = Math.max(timeline.min, Math.min(timeline.max, defaultValue));
        }

        params.timeline = timeline;

        if (!Array.isArray(params.series)) {
            return config;
        }

        const expand = typeof context.expandDataSourceRef === "function"
            ? context.expandDataSourceRef
            : null;

        if (!expand) {
            return config;
        }

        params.series = params.series.map((entry, index) => expand(entry, {
            shaderType: this.type(),
            param: "series",
            entryIndex: index,
            config,
            context
        }));

        return config;
    }

    static sources() {
        return [{
            acceptsChannelCount: () => true,
            description: "Render the currently selected series item by the delegated shader."
        }];
    }

    getControlDefinitions() {
        const defs = $.extend(true, {}, this.constructor.defaultControls);
        const timeline = defs.timeline || (defs.timeline = {});
        const config = this.getConfig() || {};
        const params = config.params || {};
        timeline.default = $.extend(true, {}, timeline.default || {}, params.timeline || {});
        timeline.required = $.extend(true, {}, timeline.required || {}, { type: "range_input" });
        return defs;
    }

    _getActiveSeriesOffset() {
        const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
        const timelineConfig = (config.params && config.params.timeline) || {};

        const min = Number(timelineConfig.min) || 0;
        const step = Number(timelineConfig.step) || 1;

        let encoded;
        if (this.timeline && this.timeline.encoded !== undefined) {
            encoded = Number.parseInt(this.timeline.encoded, 10);
        } else {
            encoded = Number.parseInt(timelineConfig.default, 10);
        }

        if (!Number.isFinite(encoded)) {
            encoded = min;
        }

        return Math.max(0, Math.round((encoded - min) / step));
    }

    _getActiveSeriesEntry(series) {
        if (!series.length) {
            return null;
        }
        const index = Math.max(0, Math.min(series.length - 1, this._getActiveSeriesOffset()));
        return series[index];
    }

    _getDelegateShaderConfig(activeEntry) {
        const config = this.getConfig();
        const activeWorldIndex = Number.isInteger(activeEntry)
            ? activeEntry
            : (Number.isInteger(activeEntry && activeEntry.worldIndex) ? activeEntry.worldIndex : null);
        const delegateParams = $.extend(true, {}, (config && config.params) || {});
        delete delegateParams.seriesRenderer;
        delete delegateParams.series;
        delete delegateParams.timeline;

        return {
            id: `${this.id}_delegate`,
            name: config.name || "Time series delegate",
            type: this.constructor._readWrapperParam(config, "seriesRenderer", "identity"),
            visible: 1,
            fixed: false,
            tiledImages: activeWorldIndex === null ? [] : [activeWorldIndex],
            params: delegateParams,
            cache: config.cache || {}
        };
    }

    construct() {
        const config = this.getConfig();
        const series = this.constructor._readWrapperParam(config, "series", []) || [];
        const timeline = (config.params && config.params.timeline) || {};
        const min = Number(timeline.min) || 0;
        const step = Number(timeline.step) || 1;
        const defaultValue = Number(timeline.default);
        const initialOffset = Number.isFinite(defaultValue) ? Math.max(0, Math.round((defaultValue - min) / step)) : 0;
        const activeEntry = series.length ? series[Math.max(0, Math.min(series.length - 1, initialOffset))] : null;

        super.construct();

        timeline.default = this.timeline.encoded || this.timeline.raw || config.params.timeline.default;

        const delegateConfig = this._getDelegateShaderConfig(activeEntry);

        // preserve a live source binding
        // across re-constructs. _refreshShadersForTiledImage (~line 11673) re-runs
        // construct() when a newly-opened series frame finishes loading. By that
        // point requestSourceBinding's mutation has already written
        // config.tiledImages[0] = newIdx; re-deriving from series[initialOffset]
        // would clobber it back to the original active entry, so first visits to
        // non-active frames render the active frame's data.
        const liveTiledImages = config.tiledImages;
        if (
            Array.isArray(liveTiledImages) &&
            liveTiledImages.length > 0 &&
            liveTiledImages.every(w => Number.isInteger(w) && w >= 0)
        ) {
            delegateConfig.tiledImages = liveTiledImages;
        }

        const DelegateShader = $.FlexRenderer.ShaderMediator.getClass(delegateConfig.type);
        if (!DelegateShader) {
            throw new Error(`time-series: unknown child shader type '${delegateConfig.type}'.`);
        }
        if (delegateConfig.type === this.constructor.type()) {
            throw new Error("time-series cannot recursively render itself.");
        }

        this._renderer = new DelegateShader(`${this.id}_delegate`, {
            shaderConfig: delegateConfig,
            webglContext: this.webglContext,
            params: delegateConfig.params,
            interactive: this._interactive,
            invalidate: this.invalidate,
            rebuild: this._rebuild,
            refresh: this._refresh,
            refetch: this._refetch
        });
        this._renderer.construct();
        this._renderer.removeControl("opacity");

        config.tiledImages = delegateConfig.tiledImages;

        if (!delegateConfig.tiledImages || delegateConfig.tiledImages.length < 1) {
            console.warn("time-series has no initial bound source", {
                id: this.id,
                config: this.getConfig(),
                activeEntry,
                delegateConfig
            });
        }
    }

    init() {
        super.init();
        this._renderer.init();

        // time-series scrub — was reading config.series (raw,
        // un-expanded by the data-source pipeline) and passing a raw integer to
        // requestSourceBinding, which routed to the integer-rebind shortcut and
        // bypassed the xOpat shaderSourceResolver. Drop lastOffset short-circuit
        // and delegate dedup to the resolver's cache-hit branch (it already
        // handles same-loadKey rebinds with all rebuild flags false).
        this.timeline.on("default", () => this.scrubTo(this._getActiveSeriesOffset()));
    }

    scrubTo(offset) {
        const series = this.constructor._readWrapperParam(this.getConfig(), "series", []);
        if (!Array.isArray(series) || series.length === 0) {
            return;
        }
        const idx = Math.max(0, Math.min(series.length - 1, Number(offset) | 0));
        this.requestSourceBinding(0, series[idx], {
            reason: "time-series-source-change",
            refreshShader: false,
            rebuildProgram: false,
            rebuildDrawer: false,
            resetItems: false
        });
    }

    destroy() {
        if (this._renderer) {
            this._renderer.destroy();
            this._renderer = null;
        }
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

    htmlControls(wrapper = null, classes = "", css = "") {
        return `
${super.htmlControls(wrapper, classes, css)}
<h4>Rendering as ${this._renderer.constructor.name()}</h4>
${this._renderer.htmlControls(wrapper, classes, css)}`;
    }
});

})(OpenSeadragon);

(function($) {

    /**
     * Single-channel fluorescence shader.
     *
     * Processes ONE logical channel from a multi-channel source.
     * You can stack multiple instances of this shader with different configs.
     *
     * Channel selection is standardized:
     *  - Swizzle pattern comes from use_channel0 (e.g. "r", "g", "rgba").
     *  - Base channel index comes from:
     *      1) use_channel_base0 in shader config, or inline "N:pattern"
     *         in use_channel0 (e.g. "7:r"), via ShaderLayer.resetChannel,
     *      2) fallback: config.channelIndex (legacy),
     *      3) fallback: 0.
     */
    $.FlexRenderer.ShaderMediator.registerLayer(class SingleChannel extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "single_channel";
        }

        static name() {
            return "Single channel";
        }

        static description() {
            return "Render one selected TIFF channel with a custom color.";
        }

        static intent() {
            return "Extract one channel from a multi-channel raster and tint it. Pick when the source has multiple channels and you want exactly one of them rendered.";
        }

        static expects() {
            return { dataKind: "multi-channel", channels: "any" };
        }

        static exampleParams() {
            return { use_channel_base0: 0, color: "#ffffff" };  // eslint-disable-line camelcase
        }

        static docs() {
            return {
                summary: "Single-channel shader that colors one logical scalar channel.",
                description: "Samples one selected scalar channel and multiplies that scalar value by a configurable RGB color. Alpha is set to the sampled scalar value.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Multi-channel TIFF/GeoTIFF (scalar channels)"
                }],
                controls: [
                    { name: "use_channel0", default: "r", description: "Single-channel swizzle used for sampling." },
                    { name: "color", ui: "color", valueType: "vec3", default: "#ff00ff" }
                ]
            };
        }

        // One source: multi-channel TIFF/GeoTIFF scalar channels
        static sources() {
            return [{
                // We treat each channel as a scalar; use_channel0 must be length 1.
                acceptsChannelCount: (n) => n === 1,
                description: "Multi-channel TIFF/GeoTIFF (scalar channels)"
            }];
        }

        static get defaultControls() {
            return {
                // We want a single scalar per sample: "r"
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },

                // Color for this channel
                color: {
                    default: {
                        type: "color",
                        default: "#ff00ff",
                        title: "Color"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();

            // Controls as GLSL expressions
            const colorExpr   = this.color.sample("1.0", "float");

            // todo avoid calling osd_* methods, use API calls e,g, $(this.channelCount(optionalIndex))
            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    float fv = ${this.sampleChannel("v_texture_coords")};
    vec3 col = fv * (${colorExpr});
    return vec4(col, fv);
`;
        }
    });

})(OpenSeadragon);

(function($) {

    $.FlexRenderer.ShaderMediator.registerLayer(
        class extends $.FlexRenderer.ShaderLayer {
            static type() {
                return "channel-series";
            }

            static name() {
                return "Channel Series";
            }

            static description() {
                return "Wrap one shader and move its source channel base through a runtime control.";
            }

            static docs() {
                return {
                    summary: "Wrapper shader that hosts one delegated shader and drives its channel base with a runtime control.",
                    description: "Uses source metadata from ShaderLayer.getSourceInfo(sourceIndex) to size a channel-offset control. The delegated shader is instantiated once, and its use_channel_baseN value for the selected source is overridden by a GLSL expression backed by the wrapper control, so offset changes do not require program rebuilds.",
                    kind: "shader",
                    inputs: [{
                        index: 0,
                        acceptedChannelCounts: null,
                        description: "Source whose logical channels are browsed through the delegated shader."
                    }],
                    customParams: [
                        {
                            name: "channelRenderer",
                            default: "single_channel",
                            description: "Shader type to instantiate internally."
                        },
                        {
                            name: "channelRendererConfig",
                            description: "Optional ShaderConfig fragment merged into the delegated child shader."
                        },
                        {
                            name: "sourceIndex",
                            default: 0,
                            description: "Which source slot should receive the runtime channel-base override."
                        }
                    ],
                    controls: [
                        {
                            name: "channel_offset",
                            ui: "range_input",
                            valueType: "float",
                            description: "Logical channel base offset fed into the delegated shader at draw time."
                        }
                    ],
                    notes: [
                        "Only the metadata-ready refresh rebuilds the wrapper so the control range can be updated.",
                        "Moving channel_offset afterwards only updates uniforms and does not rebuild the program."
                    ]
                };
            }

            static sources() {
                return [{
                    acceptsChannelCount: () => true,
                    description: "Source whose logical channels are browsed through the delegated shader."
                }];
            }

            static get customParams() {
                return {
                    channelRenderer: {
                        usage: "Shader type used internally for rendering the currently selected logical channel.",
                        type: "string",
                        default: "single_channel"
                    },
                    channelRendererConfig: {
                        type: "json",
                        usage: "Optional ShaderConfig fragment merged into the delegated child shader. Put delegated shader params here."
                    },
                    sourceIndex: {
                        usage: "Source slot whose use_channel_baseN should be overridden by the runtime channel offset control.",
                        type: "number",
                        default: 0
                    }
                };
            }

            static _readWrapperParam(config, name, fallback = undefined) {
                const params = (config && config.params) || {};
                if (params[name] !== undefined) {
                    return params[name];
                }
                if (config && config[name] !== undefined) {
                    return config[name];
                }
                return fallback;
            }

            static get defaultControls() {
                return {
                    channel_offset: { // eslint-disable-line camelcase
                        default: {
                            type: "range_input",
                            title: "Channel: ",
                            default: 0,
                            min: 0,
                            max: 0,
                            step: 1
                        },
                        accepts: type => type === "float"
                    }
                };
            }

            _readIntConfig(name, fallback, minimum = null) {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                const raw = this.constructor._readWrapperParam(config, name, fallback);
                const parsed = Number.parseInt(raw, 10);
                let value = Number.isFinite(parsed) ? parsed : fallback;
                if (minimum != null && value < minimum) { // eslint-disable-line eqeqeq
                    value = minimum;
                }
                return value;
            }

            _getDelegateSettings() {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                const delegateConfig = $.extend(true, {}, this.constructor._readWrapperParam(config, "channelRendererConfig", {}) || {});
                const delegateType = delegateConfig.type || this.constructor._readWrapperParam(config, "channelRenderer", "single_channel");

                if (delegateType === this.constructor.type()) {
                    throw new Error("channel-series cannot recursively render itself.");
                }
                if (!$.FlexRenderer.ShaderMediator.getClass(delegateType)) {
                    throw new Error(`channel-series: unknown child shader type '${delegateType}'.`);
                }

                return {
                    delegateType,
                    delegateConfig,
                    sourceIndex: this._readIntConfig("sourceIndex", 0, 0)
                };
            }

            _getDelegatedChannelPattern(settings = this._getDelegateSettings()) {
                const params = settings.delegateConfig.params || {};
                const controlName = `use_channel${settings.sourceIndex}`;
                const predefined = $.FlexRenderer.ShaderMediator.getClass(settings.delegateType).defaultControls[controlName];

                let pattern = params[controlName];
                if (pattern == null && predefined) { // eslint-disable-line eqeqeq
                    pattern = predefined.required != null ? predefined.required : predefined.default; // eslint-disable-line eqeqeq
                }
                if (typeof pattern !== "string" || !pattern) {
                    return "r";
                }

                const inlineBase = pattern.match(/^(\d+):(.*)$/);
                if (inlineBase) {
                    pattern = inlineBase[2];
                }
                return pattern || "r";
            }

            _getDelegatedChannelWidth(settings = this._getDelegateSettings()) {
                const pattern = this._getDelegatedChannelPattern(settings);
                return /^[rgba]{1,4}$/.test(pattern) ? pattern.length : 1;
            }

            _getMaxChannelOffset(settings = this._getDelegateSettings()) {
                const sourceInfo = this.getSourceInfo(settings.sourceIndex);
                const channelCount = Number.parseInt(sourceInfo.channelCount, 10);
                if (!Number.isFinite(channelCount) || channelCount < 1) {
                    return 0;
                }
                return Math.max(0, channelCount - this._getDelegatedChannelWidth(settings));
            }

            getControlDefinitions() {
                const defs = $.extend(true, {}, this.constructor.defaultControls);
                defs.channel_offset.default.max = this._getMaxChannelOffset();
                return defs;
            }

            _buildDelegateShaderConfig(settings) {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                const delegateParams = $.extend(true, {}, ((settings.delegateConfig && settings.delegateConfig.params) || {}));
                delete delegateParams.channelRenderer;
                delete delegateParams.channelRendererConfig;
                delete delegateParams.sourceIndex;
                delete delegateParams.channel_offset;
                return $.extend(true, {
                    id: `${this.id}_delegate`,
                    name: config.name || settings.delegateType,
                    type: settings.delegateType,
                    visible: 1,
                    fixed: false,
                    tiledImages: (config.tiledImages || []).slice(),
                    params: delegateParams,
                    cache: {}
                }, settings.delegateConfig, {
                    id: `${this.id}_delegate`,
                    type: settings.delegateType,
                    params: delegateParams,
                    tiledImages: Array.isArray(settings.delegateConfig.tiledImages) ?
                        settings.delegateConfig.tiledImages.slice() :
                        ((config.tiledImages || []).slice())
                });
            }

            _buildRuntimeBaseExpression(settings) {
                const uniformExpr = this.channel_offset.sample();
                const maxOffset = this._getMaxChannelOffset(settings);
                const maxExpr = $.FlexRenderer.ShaderLayer.toShaderFloatString(maxOffset, 0, 1);
                const encodedExpr = `clamp(${uniformExpr}, 0.0, 1.0) * ${maxExpr}`;
                return `int(round(clamp(${encodedExpr}, 0.0, ${maxExpr})))`;
            }

            construct() {
                super.construct();

                const settings = this._getDelegateSettings();
                const delegateConfig = this._buildDelegateShaderConfig(settings);
                const DelegateShader = $.FlexRenderer.ShaderMediator.getClass(settings.delegateType);

                this._delegateShader = new DelegateShader(`${this.id}_delegate`, {
                    shaderConfig: delegateConfig,
                    webglContext: this.webglContext,
                    params: delegateConfig.params,
                    interactive: this._interactive,
                    invalidate: this.invalidate,
                    rebuild: this._rebuild,
                    refresh: this._refresh,
                    refetch: this._refetch
                });
                this._delegateShader.construct();

                const originalGetDefaultChannelBase = this._delegateShader.getDefaultChannelBase.bind(this._delegateShader);
                this._delegateShader.getDefaultChannelBase = sourceIndex => {
                    if (sourceIndex !== settings.sourceIndex) {
                        return originalGetDefaultChannelBase(sourceIndex);
                    }
                    return this._buildRuntimeBaseExpression(settings);
                };

                this._delegateShader.removeControl("opacity");
            }

            init() {
                super.init();
                this._delegateShader.init();
            }

            destroy() {
                if (this._delegateShader) {
                    this._delegateShader.destroy();
                    this._delegateShader = null;
                }
            }

            glLoaded(program, gl) {
                super.glLoaded(program, gl);
                this._delegateShader.glLoaded(program, gl);
            }

            glDrawing(program, gl) {
                super.glDrawing(program, gl);
                this._delegateShader.glDrawing(program, gl);
            }

            getFragmentShaderDefinition() {
                return `
${super.getFragmentShaderDefinition()}
${this._delegateShader.getFragmentShaderDefinition()}`;
            }

            getFragmentShaderExecution() {
                return this._delegateShader.getFragmentShaderExecution();
            }

            htmlControls(wrapper = null, classes = "", css = "") {
                return `
${super.htmlControls(wrapper, classes, css)}
${this._delegateShader.htmlControls(wrapper, classes, css)}`;
            }
        }
    );

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
                        lines: t.lines.map(packMesh),
                        points: t.points.map(packMesh),
                        icons: t.icons.map(packMesh),
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
        parameters: m.parameters ? new Float32Array(m.parameters) : undefined,
    };
}

// TODO: make icons dynamic
const iconMapping = {
    country: {
        textureId: 0,
        width: 256,
        height: 256,
    },
    city: {
        textureId: 1,
        width: 256,
        height: 256,
    },
    village: {
        textureId: 2,
        width: 256,
        height: 256,
    },
};

function defaultStyle() {
    // Super-minimal style mapping; replace as needed.
    // layerName => {type:'fill'|'line', color:[r,g,b,a], widthPx?:number, join?:'miter'|'bevel'|'round', cap?:'butt'|'square'|'round'}
    return {
        layers: {
            water:          { type: 'fill', color: [0.10, 0.80, 0.80, 0.80] },
            landcover:      { type: 'fill', color: [0.10, 0.80, 0.10, 0.80] },
            landuse:        { type: 'fill', color: [0.80, 0.80, 0.10, 0.80] },
            park:           { type: 'fill', color: [0.10, 0.80, 0.10, 0.80] },
            boundary:       { type: 'line', color: [0.60, 0.20, 0.60, 1.00], widthPx: 2.0, join: 'round', cap: 'round' },
            waterway:       { type: 'line', color: [0.10, 0.10, 0.80, 1.00], widthPx: 1.2, join: 'round', cap: 'round' },
            transportation: { type: 'line', color: [0.80, 0.60, 0.10, 1.00], widthPx: 1.6, join: 'round', cap: 'round' },
            road:           { type: 'line', color: [0.60, 0.60, 0.60, 1.00], widthPx: 1.6, join: 'round', cap: 'round' },
            building:       { type: 'fill', color: [0.10, 0.10, 0.10, 0.80] },
            aeroway:        { type: 'fill', color: [0.10, 0.80, 0.60, 0.80] },
            poi:            { type: 'point', color: [0.00, 0.00, 0.00, 1.00], size: 10.0 },
            housenumber:    { type: 'point', color: [0.50, 0.00, 0.50, 1.00], size: 8.0 },
            place:          {
                type: 'icon',
                color: [0.80, 0.10, 0.10, 1.00],
                size: 1.2,
                iconMapping: iconMapping, // TODO: somehow pass a function instead?
            },
        },
        // Default if layer not listed
        fallback: { type: 'line', color: [0.50, 0.50, 0.50, 1.00], widthPx: 0.8, join: 'bevel', cap: 'butt' }
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

/**
 * Shader configurator for current FlexRenderer API.
 *
 * - compile* methods build machine-friendly docs JSON
 * - serialize* methods serialize docs as json or text
 * - render* methods render static docs or interactive UI
 * - preview is optional and injected through previewAdapter
 *
 * Requires:
 *   - OpenSeadragon.FlexRenderer
 *   - OpenSeadragon.FlexRenderer.ShaderMediator
 *   - OpenSeadragon.FlexRenderer.UIControls
 */
(function($) {

    let AjvConstructor;
    const candidates = ["Ajv2020", "ajv2020", "Ajv", "ajv", "ajv7"];
    for (const name of candidates) {
        const cand = window[name];
        if (typeof cand === "function") {
            AjvConstructor = cand;
            break;
        }
        if (cand && typeof cand.default === "function") {
            AjvConstructor = cand.default;
            break;
        }
    }
    if (typeof AjvConstructor !== "function") {
        console.warn(
            "[flex renderer] AJV is not available on global scope (looked for " +
            "Ajv2020 / ajv2020 / Ajv / ajv / ajv7). Schema validation is disabled; the " +
            "playground review remains the gate."
        );
    }

    function deepClone(value) {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function firstDefined(...values) {
        for (const value of values) {
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    function escapeHtml(v) {
        return String(v || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function resolveNode(nodeOrId) {
        if (typeof nodeOrId === "string") {
            const node = document.getElementById(nodeOrId);
            if (!node) {
                throw new Error(`Node "${nodeOrId}" not found`);
            }
            return node;
        }
        if (!(nodeOrId instanceof Node)) {
            throw new Error("Expected DOM node or element id");
        }
        return nodeOrId;
    }

    function isNode(v) {
        return typeof Node !== "undefined" && v instanceof Node;
    }

    function inferDefaultPreviewAssetBasePath() {
        if (typeof document === "undefined" || !document.currentScript || !document.currentScript.src) {  // eslint-disable-line compat/compat
            return null;
        }
        try {
            return new URL("shaders/", document.currentScript.src).toString().replace(/\/$/, "");  // eslint-disable-line compat/compat
        } catch (_) {
            return null;
        }
    }

    function svgToDataUri(svg) {
        return `data:image/svg+xml;utf8,${encodeURIComponent(String(svg || "").trim())}`;
    }

    function getRenderableDimensions(data) {
        if (!data) {
            return { width: 256, height: 256 };
        }

        const width = Number(
            data.videoWidth ||
            data.naturalWidth ||
            data.width ||
            (data.canvas && data.canvas.width) ||
            256
        );
        const height = Number(
            data.videoHeight ||
            data.naturalHeight ||
            data.height ||
            (data.canvas && data.canvas.height) ||
            256
        );

        return {
            width: Math.max(1, Math.round(width) || 256),
            height: Math.max(1, Math.round(height) || 256)
        };
    }

    class Registry {
        constructor(items = {}) {
            this._map = new Map(Object.entries(items));
        }
        register(key, value) {
            this._map.set(key, value);
            return this;
        }
        get(key) {
            return this._map.get(key) || null;
        }
        has(key) {
            return this._map.has(key);
        }
        entries() {
            return [...this._map.entries()];
        }
    }

    class PreviewSession {
        constructor({
                        uniqueId,
                        width = 256,
                        height = 256,
                        backgroundColor = "#00000000",
                        controlMountResolver,
                        onVisualizationChanged
                    }) {
            this.uniqueId = $.FlexRenderer.sanitizeKey(uniqueId);
            this.width = width;
            this.height = height;
            this.controlMountResolver = controlMountResolver;
            this.onVisualizationChanged = onVisualizationChanged;
            this._currentShaderId = null;
            this._suspendVisualizationSync = false;

            this.renderer = new $.FlexRenderer({
                uniqueId: this.uniqueId,
                webGLPreferredVersion: "2.0",
                debug: false,
                interactive: true,
                redrawCallback: () => {},
                refetchCallback: () => {},
                backgroundColor,
                htmlHandler: (shaderLayer, shaderConfig) => {
                    const mount = this.controlMountResolver();
                    if (!mount || !shaderLayer) {
                        return "";
                    }

                    const section = document.createElement("div");
                    section.className = "card bg-base-200 border border-base-300 shadow-sm";

                    const body = document.createElement("div");
                    body.className = "card-body p-3 gap-2";

                    const title = document.createElement("div");
                    title.className = "text-sm font-semibold";
                    title.textContent = shaderConfig.name || shaderLayer.constructor.name();

                    const controlsId = `${this.uniqueId}_${shaderLayer.id}_controls`;
                    const controls = document.createElement("div");
                    controls.id = controlsId;
                    controls.className = "flex flex-col gap-2";
                    controls.innerHTML = shaderLayer.htmlControls(
                        html => `<div class="flex flex-col gap-2">${html}</div>`
                    );

                    body.appendChild(title);
                    body.appendChild(controls);
                    section.appendChild(body);
                    mount.appendChild(section);

                    return controlsId;
                },
                htmlReset: () => {
                    const mount = this.controlMountResolver();
                    if (mount) {
                        mount.innerHTML = "";
                    }
                },
                canvasOptions: {
                    stencil: true
                }
            });

            this.renderer.setDataBlendingEnabled(true);
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
            this.renderer.canvas.classList.add("rounded-box", "border", "border-base-300", "bg-base-100");
            this.renderer.addHandler("visualization-change", () => {
                if (this._suspendVisualizationSync || typeof this.onVisualizationChanged !== "function") {
                    return;
                }
                const shader = this.getShader();
                if (shader) {
                    this.onVisualizationChanged(deepClone(shader.getConfig()), this);
                }
            });
        }

        setSize(width, height) {
            this.width = width;
            this.height = height;
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
        }

        setShader(shaderConfig) {
            const config = deepClone(shaderConfig);
            const shaderId = $.FlexRenderer.sanitizeKey(config.id || "prl");
            this._currentShaderId = shaderId;
            this._suspendVisualizationSync = true;

            try {
                this.renderer.deleteShaders();
                this.renderer.createShaderLayer(shaderId, config, true);
                this.renderer.setShaderLayerOrder([shaderId]);

                // Rebuild second-pass to regenerate controls and shader JS/GL state.
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.renderer.useProgram(this.renderer.getProgram(this.renderer.webglContext.secondPassProgramKey), "second-pass");
            } finally {
                this._suspendVisualizationSync = false;
            }
        }

        getShader() {
            if (!this._currentShaderId) {
                return null;
            }
            return this.renderer.getShaderLayer(this._currentShaderId);
        }

        destroy() {
            this.renderer.destroy();
        }
    }

    var ShaderConfigurator = {
        REF: "ShaderConfigurator",
        _uniqueId: "live_setup",
        _renderData: null,
        _previewAdapter: null,
        _previewSession: null,
        _rootNode: null,
        _docsModel: null,
        _onControlSelectFinish: undefined,

        interactiveRenderers: new Registry(),
        docsRenderers: new Registry(),

        previewAssets: {
            basePath: inferDefaultPreviewAssetBasePath(),
            aliases: {
                "bipolar-heatmap": "bipolar-heatmap.png",
                code: "code.png",
                colormap: "colormap.png",
                edge: "edge.png",
                heatmap: "heatmap.png",
                identity: "identity.png"
            },
            registry: new Registry()
        },

        setup: {
            shader: {
                id: "prl",
                name: "Shader controls and configuration",
                type: undefined,
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        },

        renderStyle: {
            _styles: {},
            advanced(key) {
                return this._styles[key] === true;
            },
            setAdvanced(key) {
                this._styles[key] = true;
            },
            ui(key) {
                return !this.advanced(key);
            },
            setUi(key) {
                delete this._styles[key];
            }
        },

        setUniqueId(id) {
            this._uniqueId = $.FlexRenderer.sanitizeKey(id);
        },

        setData(data) {
            this._renderData = data || null;
        },

        setPreviewAssetBasePath(basePath) {
            this.previewAssets.basePath = basePath ? String(basePath).replace(/\/+$/, "") : null;
            return this;
        },

        registerShaderPreview(shaderType, preview) {
            this.previewAssets.registry.register(shaderType, preview);
            return this;
        },

        registerShaderPreviewAlias(shaderType, fileName) {
            this.previewAssets.aliases[shaderType] = fileName;
            return this;
        },

        setPreviewAdapter(adapter) {
            this._previewAdapter = adapter || null;
            return this;
        },

        registerInteractiveRenderer(type, renderer) {
            this.interactiveRenderers.register(type, renderer);
            return this;
        },

        registerDocsRenderer(kind, renderer) {
            this.docsRenderers.register(kind, renderer);
            return this;
        },

        destroy() {
            if (this._previewSession) {
                this._previewSession.destroy();
                this._previewSession = null;
            }
        },

        buildShadersAndControlsDocs(nodeId) {
            const node = resolveNode(nodeId);
            const model = this.compileDocsModel();
            this.renderDocsPage(node, model);
        },

        compileDocsModel() {
            const shaders = $.FlexRenderer.ShaderMediator.availableShaders().map(Shader => {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                const controls = this._compileControlDescriptors(Shader);
                const customParams = Shader.customParams || {};
                const configNotes = this._compileSpecialConfigNotes(Shader);
                const classDocs = this._getShaderClassDocs(Shader);

                return {
                    type: Shader.type(),
                    name: typeof Shader.name === "function" ? Shader.name() : Shader.type(),
                    description: typeof Shader.description === "function" ? Shader.description() : "",
                    intent: typeof Shader.intent === "function" ? Shader.intent() : undefined,
                    expects: typeof Shader.expects === "function" ? Shader.expects() : undefined,
                    exampleParams: typeof Shader.exampleParams === "function" ? Shader.exampleParams() : undefined,
                    controlCouplings: this._serializeControlCouplings(Shader),
                    preview: this._resolveShaderPreview(Shader),
                    sources: sources.map((src, index) => ({
                        index,
                        description: src.description || "",
                        acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                    })),
                    controls,
                    customParams: Object.entries(customParams).map(([name, meta]) =>
                        this._compileCustomParamDescriptor(name, meta)
                    ),
                    configNotes,
                    classDocs
                };
            });

            const controls = this._compileAvailableControls();

            const model = {
                version: 6,
                generatedAt: new Date().toISOString(),
                shaders,
                controls
            };

            this._docsModel = model;
            return model;
        },

        compileConfigSchemaModel() {
            const availableShaders = $.FlexRenderer.ShaderMediator.availableShaders();
            const uiControlEnvelopes = this._compileJsonSchemaUiControlEnvelopes();
            const shaderLayerRefs = availableShaders.map(Shader => ({
                $ref: `#/$defs/shaderLayers/${Shader.type()}`
            }));
            const shaderLayers = {};

            for (const Shader of availableShaders) {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                shaderLayers[Shader.type()] = this._compileShaderLayerJsonSchema(
                    Shader,
                    sources,
                    uiControlEnvelopes,
                    shaderLayerRefs
                );
            }

            const schema = {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                $id: "https://flex-renderer/schemas/visualization-config/v2.json",
                title: "FlexRenderer visualization config",
                description: "Published JSON Schema for renderer visualization configuration.",
                type: "object",
                additionalProperties: false,
                required: ["shaders"],
                properties: {
                    order: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional top-level render order override. Defaults to Object.keys(shaders)."
                    },
                    shaders: {
                        type: "object",
                        additionalProperties: {
                            oneOf: deepClone(shaderLayerRefs)
                        },
                        description: "Map of shader id -> shader configuration object."
                    }
                },
                $defs: {
                    uiControlEnvelopes,
                    shaderLayers
                },
                "x-schemaVersion": 2,
                "x-generatedAt": new Date().toISOString()
            };

            this._assertPublishedExamplesValid(availableShaders, schema);
            return schema;
        },

        async compileConfigSchemaModelAsync() {
            return this.compileConfigSchemaModel();
        },

        /**
         * Serialization-friendly view of a shader's `controlCouplings()`.
         * Returns `undefined` when the shader has none (so JSON output stays clean),
         * or an array of `{name, summary, controls}` (no functions).
         */
        _serializeControlCouplings(Shader) {
            if (!Shader || typeof Shader.controlCouplings !== "function") {
                return undefined;
            }
            const raw = Shader.controlCouplings();
            if (!Array.isArray(raw) || raw.length === 0) {
                return undefined;
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                corrective: c.corrective,
                controls: c.controls
            }));
        },

        /**
         * Canonical "what are the break positions on this `threshold` control value?".
         * Single source of truth for couplings and renderer-side syncing — the validator
         * and the shader's runtime sync logic must read through this so they cannot
         * disagree on what counts as a break.
         * Precedence: `value.breaks` first, then `value.default`, otherwise `[]`.
         */
        resolveEffectiveBreaks(thresholdValue) {
            if (!thresholdValue || typeof thresholdValue !== "object") {
                return [];
            }
            if (Array.isArray(thresholdValue.breaks)) {
                return thresholdValue.breaks;
            }
            if (Array.isArray(thresholdValue.default)) {
                return thresholdValue.default;
            }
            return [];
        },

        /**
         * Canonical "how many color classes does this `color` control value carry?".
         * Single source of truth for couplings and renderer-side coercion.
         * Precedence: a `custom_colormap` with a `default` array wins over `steps`,
         * otherwise `steps` wins; primitives count as one class.
         */
        resolveEffectiveColorSteps(colorValue) {
            if (!colorValue || typeof colorValue !== "object") {
                return 1;
            }
            if (colorValue.type === "custom_colormap" && Array.isArray(colorValue.default)) {
                return colorValue.default.length;
            }
            if (typeof colorValue.steps === "number") {
                return colorValue.steps;
            }
            return 1;
        },

        /**
         * Walks each compiled shader entry and flags every key in `exampleParams`
         * that is not declared in `params.builtIns ∪ params.controls ∪ params.customParams`.
         * Returns a (possibly empty) list of `{ shaderType, key, allowed }` issues.
         * The published example must be a valid layer per its own schema; otherwise
         * a host that uses `exampleParams` as a template will produce layers that
         * fail their own coupling/key validation.
         */
        checkExampleParamsConsistency(shaders) {
            const issues = [];
            for (const shader of shaders || []) {
                const example = shader && shader.exampleParams;
                if (!example || typeof example !== "object") {
                    continue;
                }
                const params = shader.params || {};
                const allowed = new Set([
                    ...((params.builtIns || []).map(c => c.key)),
                    ...((params.controls || []).map(c => c.key)),
                    ...((params.customParams || []).map(c => c.key))
                ]);
                for (const key of Object.keys(example)) {
                    if (!allowed.has(key)) {
                        issues.push({ shaderType: shader.type, key, allowed: [...allowed] });
                    }
                }
            }
            return issues;
        },

        _compileExampleConsistencyInputs(ShaderClasses = []) {
            return (ShaderClasses || []).map(Shader => {
                const shaderType = Shader && typeof Shader.type === "function" ? Shader.type() : Shader && Shader.type;
                const sources = Shader && typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                return {
                    type: shaderType,
                    exampleParams: Shader && typeof Shader.exampleParams === "function" ? Shader.exampleParams() : undefined,
                    params: this._compileShaderParamsSchema(Shader, sources)
                };
            });
        },

        _assertPublishedExamplesValid(ShaderClasses, schemaModel) {
            const issues = [];
            const compiledShaders = this._compileExampleConsistencyInputs(ShaderClasses);
            const keyIssues = this.checkExampleParamsConsistency(compiledShaders);
            for (const issue of keyIssues) {
                issues.push({
                    kind: "keys",
                    type: issue.shaderType,
                    key: issue.key,
                    allowed: issue.allowed
                });
            }

            const ajv = this._createSchemaAjv();
            for (const Shader of ShaderClasses || []) {
                const type = Shader && typeof Shader.type === "function" ? Shader.type() : Shader && Shader.type;
                if (!type) {
                    continue;
                }
                const layerSchema = schemaModel && schemaModel.$defs && schemaModel.$defs.shaderLayers &&
                    schemaModel.$defs.shaderLayers[type];
                const exampleLayer = layerSchema && layerSchema.examples && layerSchema.examples[0];
                if (!layerSchema || !exampleLayer) {
                    continue;
                }

                const validate = ajv.compile({
                    ...layerSchema,
                    $defs: deepClone((schemaModel && schemaModel.$defs) || {})
                });
                if (!validate(exampleLayer)) {
                    issues.push({
                        kind: "schema",
                        type,
                        errors: deepClone(validate.errors || [])
                    });
                }

                for (const coupling of this.getShaderCouplingValidators(type)) {
                    if (typeof coupling.validate !== "function") {
                        continue;
                    }
                    const outcome = coupling.validate(exampleLayer);
                    if (outcome && outcome.ok === false) {
                        issues.push({
                            kind: "coupling",
                            type,
                            coupling: coupling.name,
                            expected: deepClone(outcome.expected),
                            actual: deepClone(outcome.actual)
                        });
                    }
                }

                const exampleParams = exampleLayer && exampleLayer.params;
                if (exampleParams && typeof exampleParams === "object") {
                    for (const [paramKey, value] of Object.entries(exampleParams)) {
                        if (!value || typeof value !== "object" || Array.isArray(value)) {
                            continue;
                        }
                        const envelopeType = typeof value.type === "string" ? value.type : null;
                        if (!envelopeType) {
                            continue;
                        }
                        for (const coupling of this.getEnvelopeCouplingValidators(envelopeType)) {
                            if (typeof coupling.validate !== "function") {
                                continue;
                            }
                            const outcome = coupling.validate(value);
                            if (outcome && outcome.ok === false) {
                                issues.push({
                                    kind: "envelope-coupling",
                                    type,
                                    paramKey,
                                    envelope: envelopeType,
                                    coupling: coupling.name,
                                    expected: deepClone(outcome.expected),
                                    actual: deepClone(outcome.actual)
                                });
                            }
                        }
                    }
                }
            }

            if (!issues.length) {
                return;
            }
            throw new Error(
                "[FlexRenderer.ShaderConfigurator] published examples failed validation:\n" +
                issues.map(issue => `  ${JSON.stringify(issue)}`).join("\n")
            );
        },

        _createSchemaAjv() {
            if (!AjvConstructor) {
                throw new Error("[FlexRenderer.ShaderConfigurator] Ajv is required for published-example validation.");
            }
            return new AjvConstructor({
                allErrors: true,
                strict: false,
                schemaId: "auto"
            });
        },

        _warnIfExampleParamsInconsistent(shaders) {
            const issues = this.checkExampleParamsConsistency(shaders);
            if (!issues.length) {
                return;
            }
            const summary = issues.map(i => `${i.shaderType}.exampleParams.${i.key}`).join(", ");
            console.warn(
                `[FlexRenderer.ShaderConfigurator] exampleParams keys not present in published params schema: ${summary}. ` +
                `Hosts using exampleParams as a template will fail their own validation.`
            );
        },

        /**
         * Returns runtime coupling validators (with the `validate` function attached) for
         * a given shader type. Hosts call this to validate layers before submission.
         * The schema model only ships serialization-friendly entries (no functions).
         */
        getShaderCouplingValidators(shaderType) {
            const Mediator = $.FlexRenderer.ShaderMediator;
            const Shader = Mediator && (typeof Mediator.getShaderByType === "function"
                ? Mediator.getShaderByType(shaderType)
                : typeof Mediator.getClass === "function"
                    ? Mediator.getClass(shaderType)
                    : null);
            if (!Shader || typeof Shader.controlCouplings !== "function") {
                return [];
            }
            const raw = Shader.controlCouplings();
            if (!Array.isArray(raw)) {
                return [];
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                corrective: c.corrective,
                controls: c.controls,
                validate: typeof c.validate === "function" ? c.validate : undefined
            }));
        },

        /**
         * Returns runtime coupling validators (with `validate` attached) for a UI
         * control envelope type (e.g. "colormap"). Hosts call this to validate any
         * value carrying that envelope `type` before submitting a layer. The schema
         * model surfaces the same entries (without `validate`) at
         * `$defs.uiControlEnvelopes[<type>]['x-controlCouplings']`.
         */
        getEnvelopeCouplingValidators(envelopeType) {
            if (!envelopeType) {
                return [];
            }
            const built = this._buildControls();
            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    if (control && control.uiControlType === envelopeType) {
                        const Klass = control.constructor;
                        if (!Klass || typeof Klass.controlCouplings !== "function") {
                            return [];
                        }
                        const raw = Klass.controlCouplings();
                        if (!Array.isArray(raw)) {
                            return [];
                        }
                        return raw.map(c => ({
                            name: c.name,
                            summary: c.summary,
                            corrective: c.corrective,
                            controls: c.controls,
                            validate: typeof c.validate === "function" ? c.validate : undefined
                        }));
                    }
                }
            }
            return [];
        },

        async compileDocsModelAsync() {
            return this.compileDocsModel();
        },

        serializeDocs(mode = "json", model = this._docsModel || this.compileDocsModel()) {
            if (mode === "json") {
                return JSON.stringify(model, null, 2);
            }
            if (mode === "text") {
                return this._serializeDocsText(model);
            }
            throw new Error(`Unsupported docs serialization mode "${mode}"`);
        },

        renderDocsPage(nodeId, model = this._docsModel || this.compileDocsModel()) {
            const node = resolveNode(nodeId);
            node.innerHTML = "";

            const root = document.createElement("div");
            root.className = "flex flex-col gap-6";

            const customRoot = this.docsRenderers.get("root");
            if (customRoot) {
                const rendered = customRoot({ configurator: this, model, mount: root });
                if (rendered === false) {
                    node.appendChild(root);
                    return;
                }
            }

            const shadersSection = document.createElement("section");
            shadersSection.className = "flex flex-col gap-4";
            shadersSection.innerHTML = `<h3 class="text-xl font-semibold">Available shaders</h3>`;

            for (const shader of model.shaders) {
                const customShaderRenderer = this.docsRenderers.get("shader");
                let rendered = null;
                if (customShaderRenderer) {
                    rendered = customShaderRenderer({ configurator: this, shader, model });
                }
                shadersSection.appendChild(isNode(rendered) ? rendered : this._renderDefaultShaderDoc(shader));
            }

            const controlsSection = document.createElement("section");
            controlsSection.className = "flex flex-col gap-4";
            controlsSection.innerHTML = `<h3 class="text-xl font-semibold">Available UI controls</h3>`;

            for (const [glType, controls] of Object.entries(model.controls)) {
                const block = document.createElement("div");
                block.className = "card bg-base-100 border border-base-300 shadow-sm";

                const rows = controls.map(ctrl => `
<tr>
    <td class="font-mono">${escapeHtml(ctrl.name)}</td>
    <td class="font-mono">${escapeHtml(ctrl.glType)}</td>
    <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.supports, null, 2))}</pre></td>
</tr>`).join("");

                block.innerHTML = `
<div class="card-body">
    <div class="card-title">GL type: <code>${escapeHtml(glType)}</code></div>
    <div class="overflow-x-auto">
        <table class="table table-sm">
            <thead><tr><th>Name</th><th>GL type</th><th>Supports</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>
</div>`;
                controlsSection.appendChild(block);
            }

            root.appendChild(shadersSection);
            root.appendChild(controlsSection);
            node.appendChild(root);
        },

        runShaderSelector(nodeId, onFinish) {
            if (!this.picker || typeof this.picker.init !== "function") {
                throw new Error("ShaderConfigurator.picker.init(...) is not available.");
            }
            this.picker.init(this, nodeId, { onFinish });
        },

        runShaderAndControlSelector(nodeId, onFinish) {
            const _this = this;
            this.runShaderSelector(nodeId, async(shaderId) => {
                const src = _this.picker.granularity("image") ||
                    _this.picker.selectionRules.granularity._config.image.granular;

                if (src) {
                    const data = await _this._loadRenderableData(src);
                    if (data) {
                        _this.setData(data);
                    }
                }
                _this.runControlSelector(nodeId, shaderId, onFinish);
            });
        },

        async _loadRenderableData(source) {
            if (!source) {
                return null;
            }

            if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
                return source;
            }
            if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
                if (source.complete && source.naturalWidth > 0) {
                    return source;
                }
                return await new Promise(resolve => {
                    source.onload = () => resolve(source);
                    source.onerror = () => resolve(null);
                });
            }
            if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
                return source;
            }
            if (typeof ImageData !== "undefined" && source instanceof ImageData) {
                return source;
            }
            if (typeof source === "string") {
                return await new Promise(resolve => {
                    const image = document.createElement("img");
                    image.decoding = "async";
                    image.onload = () => resolve(image);
                    image.onerror = () => resolve(null);
                    image.src = source;
                });
            }
            if (source && typeof source === "object" && typeof source.src === "string") {
                return await this._loadRenderableData(source.src);
            }
            return source;
        },


        async runControlSelector(nodeId, shaderId, onFinish = undefined) {
            this._onControlSelectFinish = onFinish;
            this._rootNode = resolveNode(nodeId);

            if (this._previewSession && this.setup.shader.type && this.setup.shader.type !== shaderId) {
                this._previewSession.destroy();
                this._previewSession = null;
            }

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderId);
            if (!Shader) {
                throw new Error(`Invalid shader: ${shaderId}. Not present.`);
            }

            const srcDecl = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
            this.setup.shader = {
                id: "prl",
                name: `Configuration: ${shaderId}`,
                type: shaderId,
                visible: 1,
                fixed: false,
                tiledImages: srcDecl.map((_, i) => i),
                params: deepClone(this.setup.shader.params || {}),
                cache: {}
            };

            this._renderInteractiveShell(this._rootNode, Shader);
            await this._refreshInteractive();
        },

        getCurrentShaderConfig() {
            return deepClone(this.setup.shader);
        },

        refresh() {
            this.setup.shader.cache = {};
            return this._refreshInteractive();
        },

        refreshUserSwitched(controlId) {
            if (this.renderStyle.advanced(controlId)) {
                this.renderStyle.setUi(controlId);
            } else {
                this.renderStyle.setAdvanced(controlId);
            }
            this.refresh();
        },

        refreshUserSelected(controlId, type) {
            if (!this.setup.shader.params[controlId]) {
                this.setup.shader.params[controlId] = {};
            }
            this.setup.shader.params[controlId].type = type;
            if (this._previewSession) {
                this._previewSession.destroy();
                this._previewSession = null;
            }
            this.refresh();
        },

        refreshUserScripted(node, controlId) {
            try {
                this.parseJSONConfig(node.value, controlId);
                node.classList.remove("textarea-error");
                this.refresh();
            } catch (e) {
                node.classList.add("textarea-error");
            }
        },

        refreshUserUpdated(_node, controlId, keyChain, value) {
            const ensure = (o, key) => {
                if (!o[key]) {
                    o[key] = {};
                }
                return o[key];
            };

            let ref = ensure(this.setup.shader.params, controlId);
            const keys = keyChain.split(".");
            const key = keys.pop();
            keys.forEach(x => {
                ref = ensure(ref, x);
            });
            ref[key] = value;
            this.refresh();
        },

        parseJSONConfig(value, controlId) {
            const config = JSON.parse(value);
            const current = this.setup.shader.params[controlId] || {};
            if (current.type && !config.type) {
                config.type = current.type;
            }
            this.setup.shader.params[controlId] = config;
            return config;
        },

        getAvailableControlsForShader(shader) {
            const uiControls = this._buildControls();
            const controls = this._resolveShaderControlDefinitions(shader);

            if (controls.opacity === undefined || (typeof controls.opacity === "object" && typeof controls.opacity.accepts === "function" && !controls.opacity.accepts("float"))) {
                controls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity"},
                    accepts: (type) => type === "float"
                };
            }

            const result = {};
            for (let control in controls) {
                if (control.startsWith("use_")) {
                    continue;
                }
                if (controls[control] === false) {
                    continue;
                }

                const supported = [];
                if (controls[control].required && controls[control].required.type) {
                    supported.push(controls[control].required.type);
                } else {
                    if (typeof controls[control].accepts !== "function") {
                        result[control] = supported;
                        continue;
                    }
                    for (let glType in uiControls) {
                        for (let existing of uiControls[glType]) {
                            if (!controls[control].accepts(glType, existing)) {
                                continue;
                            }
                            supported.push(existing.name);
                        }
                    }
                }
                result[control] = [...new Set(supported)];
            }
            return result;
        },

        _compileControlDescriptors(Shader) {
            const supports = this.getAvailableControlsForShader(Shader);
            const defs = this._resolveShaderControlDefinitions(Shader);

            return Object.keys(supports).map(name => ({
                name,
                supportedTypes: supports[name],
                default: (defs[name] && defs[name].default) || null,
                required: (defs[name] && defs[name].required) || null
            }));
        },

        _resolveShaderControlDefinitions(Shader) {
            const probe = this._createShaderDefinitionProbe(Shader);
            const baseControls = typeof probe.getControlDefinitions === "function" ?
                probe.getControlDefinitions() :
                $.extend(true, {}, Shader.defaultControls || {});

            if (typeof probe._expandControlDefinitions === "function") {
                return probe._expandControlDefinitions(baseControls);
            }
            return baseControls;
        },

        _createShaderDefinitionProbe(Shader) {
            const probe = Object.create(Shader.prototype);
            probe.constructor = Shader;
            probe._customControls = {};
            probe._controls = {};
            probe.loadProperty = (_name, defaultValue) => defaultValue;
            probe.storeProperty = () => {};
            probe.invalidate = () => {};
            probe._rebuild = () => {};
            probe._refresh = () => {};
            probe._refetch = () => {};
            return probe;
        },

        _compileAvailableControls() {
            const built = this._buildControls();
            const out = {};
            for (const [glType, controls] of Object.entries(built)) {
                out[glType] = controls.map(ctrl => ({
                    name: ctrl.name,
                    glType: ctrl.type,
                    type: ctrl.uiControlType,
                    supports: deepClone(ctrl.supports || {}),
                    classDocs: this._getControlClassDocs(ctrl)
                }));
            }
            return out;
        },

        _compileControlSchemas() {
            const built = this._buildControls();
            const out = {};
            for (const [glType, controls] of Object.entries(built)) {
                out[glType] = controls.map(ctrl => ({
                    name: ctrl.name,
                    glType: ctrl.type,
                    type: ctrl.uiControlType,
                    typedef: this._getControlTypedefId(ctrl),
                    config: this._compileControlConfigShape(ctrl)
                }));
            }
            return out;
        },

        _compileControlTypedefs() {
            const built = this._buildControls();
            const typedefs = {};

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    const typedefId = this._getControlTypedefId(control);
                    if (!typedefs[typedefId]) {
                        typedefs[typedefId] = {
                            id: typedefId,
                            name: control.name,
                            type: control.uiControlType,
                            glType: control.type,
                            config: this._compileControlConfigShape(control)
                        };
                    }
                }
            }

            return typedefs;
        },

        _probeAcceptedChannelCounts(src) {
            if (!src || typeof src.acceptsChannelCount !== "function") {
                return null;
            }
            const accepted = [];
            for (let n = 1; n <= 32; n++) {
                try {
                    if (src.acceptsChannelCount(n)) {
                        accepted.push(n);
                    }
                } catch (_) {
                    // no-op
                }
            }
            return accepted;
        },

        _compileBaseShaderConfigSchema() {
            return {
                type: "object",
                usage: "Base JSON object accepted by renderer shader-layer configuration.",
                properties: [
                    {
                        key: "id",
                        type: "string",
                        required: true,
                        usage: "Unique shader identifier used by the renderer."
                    },
                    {
                        key: "name",
                        type: "string",
                        required: false,
                        usage: "Optional human-readable layer name."
                    },
                    {
                        key: "type",
                        type: "string",
                        required: true,
                        usage: "Registered shader type resolved through ShaderMediator."
                    },
                    {
                        key: "visible",
                        type: "number|boolean",
                        required: false,
                        usage: "Layer visibility flag. Renderer examples use 1 or 0."
                    },
                    {
                        key: "fixed",
                        type: "boolean",
                        required: false,
                        usage: "Renderer flag stored on ShaderConfig."
                    },
                    {
                        key: "tiledImages",
                        type: "number[]|OpenSeadragon.TiledImage[]",
                        required: false,
                        usage: "Data sources consumed by the shader. Entries are indexed by source position."
                    },
                    {
                        key: "dataReferences",
                        type: "number[]",
                        required: false,
                        usage: "Persisted-config source indexes that hosts may resolve to tiledImages before rendering."
                    },
                    {
                        key: "params",
                        type: "object",
                        required: false,
                        usage: "Shader-specific settings, built-in use_* options, UI-control configs, and custom parameters."
                    },
                    {
                        key: "_controls",
                        type: "object",
                        required: false,
                        usage: "Renderer-managed control storage present on ShaderConfig."
                    },
                    {
                        key: "cache",
                        type: "object",
                        required: false,
                        usage: "Persistent runtime state used by controls and reset* helpers."
                    }
                ]
            };
        },

        _compileJsonSchemaUiControlEnvelopes() {
            const built = this._buildControls();
            const envelopes = {};

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    const type = control && control.uiControlType;
                    if (!type || envelopes[type]) {
                        continue;
                    }
                    envelopes[type] = this._compileJsonSchemaUiControlEnvelope(control);
                }
            }

            return envelopes;
        },

        _compileJsonSchemaUiControlEnvelope(control) {
            const docs = this._getControlClassDocs(control) || {};
            const shape = this._compileControlConfigShape(control);
            const properties = {
                type: { const: control.uiControlType }
            };
            const required = ["type"];

            for (const [key, value] of Object.entries(shape || {})) {
                if (key === "type") {
                    continue;
                }
                properties[key] = this._compileJsonSchemaFromDescriptor(value);
            }

            const envelope = {
                type: "object",
                additionalProperties: false,
                required,
                properties,
                description: docs.description || docs.summary ||
                    `${control.uiControlType} control envelope. The 'type' field discriminates the UI control kind; it is distinct from the parent shader layer's own 'type' field by virtue of nesting depth.`,
                "x-glType": control.type
            };

            const envelopeCouplings = this._serializeEnvelopeControlCouplings(control);
            if (Array.isArray(envelopeCouplings) && envelopeCouplings.length) {
                envelope["x-controlCouplings"] = envelopeCouplings;
            }

            return envelope;
        },

        /**
         * Serialization-friendly view of a UI control class's envelope-level
         * `controlCouplings()`. Mirrors `_serializeControlCouplings` for shaders.
         * The class itself (not the instance) carries the static method.
         */
        _serializeEnvelopeControlCouplings(control) {
            const Klass = control && control.constructor;
            if (!Klass || typeof Klass.controlCouplings !== "function") {
                return undefined;
            }
            const raw = Klass.controlCouplings();
            if (!Array.isArray(raw) || raw.length === 0) {
                return undefined;
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                corrective: c.corrective,
                controls: deepClone(c.controls || [])
            }));
        },

        _compileShaderLayerJsonSchema(Shader, sources, uiControlEnvelopes, shaderLayerRefs) {
            const shaderType = Shader.type();
            const name = typeof Shader.name === "function" ? Shader.name() : shaderType;
            const description = typeof Shader.description === "function" ? Shader.description() : "";
            const properties = {
                id: { type: "string" },
                name: { type: "string" },
                type: { const: shaderType },
                visible: {
                    type: ["number", "boolean"]
                },
                fixed: { type: "boolean" },
                tiledImages: {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    description: "Renderer form: OSD world indices the shader samples from. Use this when assembling renderer config directly (e.g. via overrideConfigureAll). The host's normalizer also accepts dataReferences and resolves them to tiledImages at render time."
                },
                dataReferences: {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    description: "Persisted-config form: indices into config.data the shader samples from. Hosts (e.g. xOpat) resolve these to tiledImages at open time. Either tiledImages OR dataReferences (or both, when they agree) is acceptable; tiledImages takes precedence at the renderer boundary."
                }
            };

            if (Shader.type() === "group") {
                properties.order = {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional child render order override inside the group. Defaults to Object.keys(shaders)."
                };
                properties.shaders = {
                    type: "object",
                    additionalProperties: {
                        oneOf: deepClone(shaderLayerRefs)
                    }
                };
            }

            const paramsSchema = this._compileShaderParamsJsonSchema(
                Shader,
                sources,
                uiControlEnvelopes
            );
            if (Object.keys(paramsSchema.properties || {}).length > 0) {
                properties.params = paramsSchema;
            }

            const schema = {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties,
                title: name,
                description: this._buildShaderSchemaDescription(Shader, description),
                "x-sources": (sources || []).map((src, index) => ({
                    index,
                    description: src.description || "",
                    acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                })),
                "x-controlCouplings": this._compileJsonSchemaControlCouplings(Shader)
            };

            const intent = typeof Shader.intent === "function" ? Shader.intent() : undefined;
            if (intent) {
                schema["x-intent"] = intent;
            }
            const expects = this._resolveShaderSchemaExpects(Shader, sources);
            if (expects) {
                schema["x-expects"] = expects;
            }

            const examples = this._buildShaderLayerExamples(Shader, sources);
            if (examples.length) {
                schema.examples = examples;
            }

            return schema;
        },

        _compileShaderParamsJsonSchema(Shader, sources, uiControlEnvelopes) {
            const compiled = this._compileShaderParamsSchema(Shader, sources);
            const properties = {};

            for (const item of compiled.builtIns || []) {
                properties[item.key] = this._compileBuiltInParamJsonSchema(item);
            }

            for (const control of compiled.controls || []) {
                properties[control.key] = this._compileControlParamJsonSchema(control, uiControlEnvelopes);
            }

            for (const item of compiled.customParams || []) {
                properties[item.key] = this._compileCustomParamJsonSchema(Shader, item);
            }

            return {
                type: "object",
                additionalProperties: false,
                properties
            };
        },

        _compileControlParamJsonSchema(control, uiControlEnvelopes) {
            const normalizedTypes = (control.supportedTypes || [])
                .map(type => this._normalizePublishedControlType(type))
                .filter(type => !!uiControlEnvelopes[type]);
            const primitiveSchemas = this._compileControlPrimitiveSchemasFromEnvelopes(normalizedTypes, uiControlEnvelopes);
            const refs = normalizedTypes.map(type => ({ $ref: `#/$defs/uiControlEnvelopes/${type}` }));
            const variants = primitiveSchemas.concat(refs);

            if (!variants.length) {
                return {};
            }
            if (variants.length === 1) {
                return variants[0];
            }
            return { anyOf: variants };
        },

        _normalizePublishedControlType(type) {
            if (!type) {
                return type;
            }
            if ($.FlexRenderer.UIControls && $.FlexRenderer.UIControls._items && $.FlexRenderer.UIControls._items[type]) {
                const item = $.FlexRenderer.UIControls._items[type];
                return item.type || type;
            }
            return type;
        },

        _compileControlPrimitiveSchemasFromEnvelopes(types, uiControlEnvelopes) {
            const seen = new Set();
            const schemas = [];

            for (const type of types || []) {
                const envelope = uiControlEnvelopes[type];
                const defaultSchema = envelope && envelope.properties && envelope.properties.default;
                const primitiveSchema = this._compilePrimitiveSchemaFromEnvelopeDefault(type, defaultSchema);
                if (!primitiveSchema) {
                    continue;
                }
                const key = JSON.stringify(primitiveSchema);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                schemas.push(primitiveSchema);
            }

            return schemas;
        },

        _compilePrimitiveSchemaFromEnvelopeDefault(type, defaultSchema) {
            if (!defaultSchema || !defaultSchema.type) {
                return null;
            }

            const normalizedType = Array.isArray(defaultSchema.type)
                ? defaultSchema.type[0]
                : defaultSchema.type;

            if (type === "color") {
                return {
                    type: "string",
                    pattern: "^#[0-9a-fA-F]{6,8}$"
                };
            }

            switch (normalizedType) {
                case "string":
                    return { type: "string" };
                case "integer":
                case "number":
                    return { type: "number" };
                case "boolean":
                    return { type: "boolean" };
                case "array":
                    return { type: "array" };
                default:
                    return null;
            }
        },

        _compileSchemaFromSampleValue(value) {
            if (value === null) {
                return { type: "null" };
            }
            if (Array.isArray(value)) {
                const itemSchemas = value
                    .map(item => this._compileSchemaFromSampleValue(item))
                    .filter(Boolean);
                const samePrimitiveType = itemSchemas.length > 0 &&
                    itemSchemas.every(schema => schema.type && schema.type === itemSchemas[0].type);

                return samePrimitiveType
                    ? { type: "array", items: { type: itemSchemas[0].type } }
                    : { type: "array" };
            }
            if (typeof value === "string") {
                return { type: "string" };
            }
            if (typeof value === "number") {
                return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
            }
            if (typeof value === "boolean") {
                return { type: "boolean" };
            }
            if (typeof value === "object") {
                return { type: "object" };
            }
            return null;
        },

        _compileBuiltInParamJsonSchema(item) {
            let schema;
            if (item.allowedValues) {
                schema = { enum: deepClone(item.allowedValues) };
            } else if (item.key && item.key.startsWith("use_channel_base")) {
                schema = {
                    type: "integer",
                    minimum: 0
                };
            } else {
                schema = this._compileTypeExpressionSchema(item.type, firstDefined(item.required, item.default));
            }

            if (item.default === null) {
                schema = this._withNullableSchema(schema);
            }

            if (item.default !== undefined) {
                schema.default = deepClone(item.default);
            }
            if (item.usage) {
                schema.description = item.usage;
            }
            return schema;
        },

        _compileCustomParamJsonSchema(Shader, item) {
            const schema = this._compileSpecialCustomParamJsonSchema(Shader, item) ||
                this._compileTypeExpressionSchema(item.type, firstDefined(item.required, item.default));
            if (item.default !== undefined && item.default !== null) {
                schema.default = deepClone(item.default);
            }
            if (item.usage) {
                schema.description = item.usage;
            }
            return schema;
        },

        _compileSpecialCustomParamJsonSchema(Shader, item) {
            const shaderType = Shader && typeof Shader.type === "function" ? Shader.type() : "";
            if (shaderType === "time-series" && item.key === "series") {
                return {
                    type: "array",
                    items: {
                        oneOf: [
                            { type: "integer", minimum: 0 },
                            { type: "string" },
                            { type: "object" }
                        ]
                    }
                };
            }
            if (shaderType === "channel-series" && item.key === "channelRendererConfig") {
                return {
                    type: "object"
                };
            }
            if (shaderType === "channel-series" && item.key === "sourceIndex") {
                return {
                    type: "integer",
                    minimum: 0
                };
            }
            return null;
        },

        _compileJsonSchemaFromDescriptor(descriptor) {
            const schema = this._compileTypeExpressionSchema(
                descriptor && descriptor.type,
                descriptor && descriptor.default
            );

            if (descriptor && descriptor.default !== undefined) {
                schema.default = deepClone(descriptor.default);
            }
            if (descriptor && descriptor.default === null) {
                return this._withNullableSchema(schema);
            }
            if (descriptor && descriptor.allowedValues) {
                schema.enum = deepClone(descriptor.allowedValues);
            }
            if (descriptor && descriptor.examples) {
                schema.examples = deepClone(descriptor.examples);
            }
            if (descriptor && descriptor.usage) {
                schema.description = descriptor.usage;
            }
            return schema;
        },

        _compileTypeExpressionSchema(typeExpression, sampleValue = undefined) {
            if (!typeExpression || typeExpression === "unknown" || typeExpression === "json") {
                return {};
            }

            if (typeExpression.endsWith("[]")) {
                return {
                    type: "array",
                    items: this._compileTypeExpressionSchema(typeExpression.slice(0, -2))
                };
            }

            const arrayMatch = typeExpression.match(/^array<(.*)>$/);
            if (arrayMatch) {
                return {
                    type: "array",
                    items: this._compileTypeExpressionSchema(arrayMatch[1])
                };
            }

            const parts = typeExpression.split("|").map(part => part.trim()).filter(Boolean);
            if (parts.length > 1) {
                const schemas = parts.map(part => this._compileTypeExpressionSchema(part, sampleValue));
                const simpleTypes = schemas.every(schema =>
                    schema &&
                    Object.keys(schema).length === 1 &&
                    typeof schema.type === "string"
                );
                if (simpleTypes) {
                    return {
                        type: schemas.map(schema => schema.type)
                    };
                }
                return { oneOf: schemas };
            }

            switch (typeExpression) {
                case "string":
                    return { type: "string" };
                case "number":
                    return Number.isInteger(sampleValue) ? { type: "integer" } : { type: "number" };
                case "boolean":
                    return { type: "boolean" };
                case "null":
                    return { type: "null" };
                case "array":
                    return { type: "array" };
                case "object":
                    return { type: "object" };
                case "integer":
                    return { type: "integer" };
                default:
                    return {};
            }
        },

        _withNullableSchema(schema = {}) {
            if (schema.type && typeof schema.type === "string") {
                return {
                    ...schema,
                    type: [schema.type, "null"]
                };
            }
            if (Array.isArray(schema.type) && !schema.type.includes("null")) {
                return {
                    ...schema,
                    type: schema.type.concat(["null"])
                };
            }
            return schema;
        },

        _buildShaderLayerExamples(Shader, sources) {
            let exampleParams;
            if (Shader && typeof Shader.exampleParams === "function") {
                exampleParams = Shader.exampleParams();
            }
            if (!exampleParams || typeof exampleParams !== "object") {
                exampleParams = this._synthesizeExampleParamsFromDefaults(Shader, sources);
            }
            if (!exampleParams || typeof exampleParams !== "object") {
                return [];
            }

            const example = {
                id: `${Shader.type()}_example`,
                type: Shader.type()
            };

            if (sources && sources.length) {
                example.tiledImages = sources.map((_, index) => index);
            }
            if (Shader.type() === "group" && exampleParams.shaders) {
                Object.assign(example, deepClone(exampleParams));
            } else {
                example.params = deepClone(exampleParams);
            }

            return [example];
        },

        _synthesizeExampleParamsFromDefaults(Shader, sources) {
            if (!Shader || typeof Shader.type !== "function") {
                return null;
            }
            if (Shader.type() === "group") {
                return {
                    shaders: {
                        child_1: {  // eslint-disable-line camelcase
                            type: "identity",
                            params: {
                                use_channel0: "r" // eslint-disable-line camelcase
                            }
                        }
                    },
                    order: ["child_1"]
                };
            }
            if (Shader.type() === "time-series") {
                return {
                    seriesRenderer: "identity",
                    series: [0],
                    timeline: {
                        type: "range_input",
                        default: 0,
                        min: 0,
                        max: 0,
                        step: 1
                    }
                };
            }

            const params = {};
            const compiled = this._compileShaderParamsSchema(Shader, sources);
            for (const builtIn of compiled.builtIns || []) {
                if (builtIn.default !== undefined && builtIn.default !== null) {
                    params[builtIn.key] = deepClone(builtIn.default);
                }
            }
            for (const control of this._compileControlDescriptors(Shader)) {
                const seed = firstDefined(control.required, control.default);
                if (seed !== undefined && seed !== null) {
                    params[control.name] = deepClone(seed);
                }
            }
            for (const [name, meta] of Object.entries(Shader.customParams || {})) {
                if (meta && meta.default !== undefined) {
                    params[name] = deepClone(meta.default);
                }
            }
            return Object.keys(params).length ? params : {};
        },

        _compileJsonSchemaControlCouplings(Shader) {
            const couplings = this._serializeControlCouplings(Shader);
            if (!Array.isArray(couplings) || !couplings.length) {
                return [];
            }
            return couplings.map(coupling => ({
                name: coupling.name,
                summary: coupling.summary,
                controls: deepClone(coupling.controls || [])
            }));
        },

        _buildShaderSchemaDescription(Shader, description) {
            const type = Shader && typeof Shader.type === "function" ? Shader.type() : "";
            if (type === "time-series" || type === "channel-series") {
                return `${description} Wrapper-specific settings live under params alongside built-ins and UI controls.`;
            }
            return description;
        },

        _resolveShaderSchemaExpects(Shader, sources = []) {
            if (Shader && typeof Shader.expects === "function") {
                const explicit = Shader.expects();
                if (explicit && explicit.dataKind) {
                    return explicit;
                }
            }

            const type = Shader && typeof Shader.type === "function" ? Shader.type() : "";
            if (type === "group" || type === "time-series" || type === "channel-series") {
                return { dataKind: "any", channels: "any" };
            }

            const accepted = (sources || [])
                .map(src => this._probeAcceptedChannelCounts(src))
                .filter(values => Array.isArray(values) && values.length);
            if (!accepted.length) {
                return null;
            }
            const first = accepted[0];
            if (first.length === 1 && first[0] === 1) {
                return { dataKind: "scalar", channels: 1 };
            }
            if (first.length === 1 && first[0] === 3) {
                return { dataKind: "rgb", channels: 3 };
            }
            if (first.length === 1 && first[0] === 4) {
                return { dataKind: "rgb", channels: 4 };
            }
            return { dataKind: "multi-channel", channels: "any" };
        },

        _compileShaderRootConfigSchema(Shader) {
            const base = this._compileBaseShaderConfigSchema().properties.map(item => deepClone(item));
            const byKey = new Map(base.map(item => [item.key, item]));

            for (const note of this._compileSpecialConfigNotes(Shader)) {
                byKey.set(note.key, {
                    ...(byKey.get(note.key) || {}),
                    key: note.key,
                    type: note.kind || "special",
                    required: false,
                    usage: note.usage || ""
                });
            }

            return {
                type: "object",
                properties: [...byKey.values()]
            };
        },

        _compileShaderParamsSchema(Shader, sources = []) {
            const defs = Shader.defaultControls || {};
            const controls = this._compileControlDescriptors(Shader).map(control => ({
                key: control.name,
                kind: "ui-control",
                usage: `Shader param for UI control '${control.name}'.`,
                supportedTypes: control.supportedTypes,
                defaultControlConfig: control.default !== null ? deepClone(control.default) : null,
                requiredControlConfig: control.required !== null ? deepClone(control.required) : null,
            }));

            const customParams = Object.entries(Shader.customParams || {}).map(([name, meta]) => ({
                key: name,
                kind: "custom-param",
                type: this._resolveCustomParamType(meta),
                usage: (meta && meta.usage) || "",
                default: meta && meta.default !== undefined ? deepClone(meta.default) : null,
                required: meta && meta.required !== undefined ? deepClone(meta.required) : null
            }));

            return {
                type: "object",
                usage: "Configuration object assigned to ShaderConfig.params.",
                builtIns: [
                    ...this._compileUseChannelSchemas(Shader, sources, defs),
                    this._compileUseModeSchema(defs),
                    this._compileUseBlendSchema(defs),
                    ...this._compileUseFilterSchemas(defs)
                ],
                controls,
                customParams
            };
        },

        _compileUseChannelSchemas(_Shader, sources = [], defs = {}) {
            return sources.flatMap((src, index) => {
                const accepted = this._probeAcceptedChannelCounts(src);
                const defaultControl = defs[`use_channel${index}`] || {};
                const baseControl = defs[`use_channel_base${index}`] || {};

                return [
                    {
                        key: `use_channel${index}`,
                        kind: "built-in",
                        type: "string",
                        usage: "Channel pattern used for sampling this source. Accepts swizzles like 'r', 'rg', 'rgba' and inline base form 'N:pattern'.",
                        acceptedChannelCounts: accepted,
                        default: firstDefined(defaultControl.required, defaultControl.default, "r"),
                        required: firstDefined(defaultControl.required, null)
                    },
                    {
                        key: `use_channel_base${index}`,
                        kind: "built-in",
                        type: "number",
                        usage: "Explicit flattened base-channel offset for this source. Overrides the optional N prefix from use_channel.",
                        default: firstDefined(baseControl.required, baseControl.default, 0),
                        required: firstDefined(baseControl.required, null)
                    }
                ];
            });
        },

        _compileUseModeSchema(defs = {}) {
            const spec = defs.use_mode || {};
            return {
                key: "use_mode",
                kind: "built-in",
                type: "string",
                usage: "Rendering mode resolved by resetMode(). Supported values come from renderer WebGL context.",
                allowedValues: ["show", "blend", "clip", "mask", "clip_mask"],
                default: firstDefined(spec.required, spec.default, "show"),
                required: firstDefined(spec.required, null)
            };
        },

        _compileUseBlendSchema(defs = {}) {
            const spec = defs.use_blend || {};
            return {
                key: "use_blend",
                kind: "built-in",
                type: "string",
                usage: "Blend function used when the current use_mode applies blending.",
                allowedValues: deepClone($.FlexRenderer.BLEND_MODE || []),
                default: firstDefined(spec.required, spec.default, ($.FlexRenderer.BLEND_MODE || [])[0], null),
                required: firstDefined(spec.required, null)
            };
        },

        _compileUseFilterSchemas(defs = {}) {
            const names = $.FlexRenderer.ShaderLayer.filterNames || {};
            return Object.keys($.FlexRenderer.ShaderLayer.filters || {}).map(key => {
                const spec = defs[key] || {};
                const label = names[key] || key;
                return {
                    key,
                    kind: "built-in",
                    type: "number",
                    usage: `${label} filter parameter applied by resetFilters().`,
                    default: firstDefined(spec.required, spec.default, null),
                    required: firstDefined(spec.required, null)
                };
            });
        },

        _expandSupportedUiSchemas(names = []) {
            const built = this._buildControls();
            const seen = new Set();
            const out = [];

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    if (!names.includes(control.name) || seen.has(control.name)) {
                        continue;
                    }
                    seen.add(control.name);
                    out.push({
                        name: control.name,
                        glType: control.type,
                        type: control.uiControlType,
                        typedef: this._getControlTypedefId(control),
                        config: this._compileControlConfigShape(control)
                    });
                }
            }

            return out;
        },

        _getControlTypedefId(control) {
            const type = control && control.uiControlType ? control.uiControlType : "unknown";
            const glType = control && control.type ? control.type : "unknown";
            return `control:${type}:${glType}`;
        },

        _compileControlConfigShape(control) {
            const docs = this._getControlClassDocs(control);
            const docParams = new Map(((docs && docs.parameters) || []).map(param => [param.name, param]));
            const supports = deepClone(this._safeReadControlProp(control, "supports", {}) || {});
            const supportsAll = deepClone(this._safeReadControlProp(control, "supportsAll", {}) || {});
            const keys = [...new Set([
                ...Object.keys(supports),
                ...Object.keys(supportsAll),
                ...docParams.keys()
            ])];

            const config = {};
            for (const key of keys) {
                config[key] = this._compileControlConfigPropertySchema(
                    key,
                    supports[key],
                    supportsAll[key],
                    docParams.get(key) || null
                );
            }
            return config;
        },

        _safeReadControlProp(control, prop, fallback = undefined) {
            if (!control) {
                return fallback;
            }
            try {
                const value = control[prop];
                return value === undefined ? fallback : value;
            } catch (_) {
                return fallback;
            }
        },

        _compileControlConfigPropertySchema(name, sampleValue, variantsValue, docParam) {
            const schema = {
                type: this._inferSchemaType(sampleValue, variantsValue, docParam)
            };

            if (sampleValue !== undefined) {
                schema.default = deepClone(sampleValue);
            } else if (docParam && docParam.default !== undefined) {
                schema.default = deepClone(docParam.default);
            }

            if (variantsValue !== undefined) {
                schema.examples = deepClone(Array.isArray(variantsValue) ? variantsValue : [variantsValue]);
            }

            if (docParam && docParam.usage) {
                schema.usage = docParam.usage;
            }

            if (docParam && Array.isArray(docParam.allowedValues)) {
                schema.allowedValues = deepClone(docParam.allowedValues);
            }

            if (docParam && docParam.examples !== undefined) {
                schema.examples = deepClone(Array.isArray(docParam.examples) ? docParam.examples : [docParam.examples]);
            }

            return schema;
        },

        _inferSchemaType(sampleValue, variantsValue, docParam) {
            if (docParam && docParam.type) {
                return docParam.type;
            }

            if (variantsValue !== undefined) {
                return this._inferValueType(variantsValue);
            }

            return this._inferValueType(sampleValue);
        },

        _inferValueType(value) {
            if (value === null) {
                return "null";
            }
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    return "array";
                }
                const itemTypes = [...new Set(value.map(item => this._inferValueType(item)))];
                if (itemTypes.length === 1) {
                    return `${itemTypes[0]}[]`;
                }
                return `array<${itemTypes.join("|")}>`;
            }
            if (typeof value === "string") {
                return "string";
            }
            if (typeof value === "number") {
                return "number";
            }
            if (typeof value === "boolean") {
                return "boolean";
            }
            if (value && typeof value === "object") {
                return "object";
            }
            return "unknown";
        },

        _compileSpecialConfigNotes(Shader) {
            if (!Shader || typeof Shader.type !== "function") {
                return [];
            }

            if (Shader.type() === "group") {
                return [
                    {
                        key: "shaders",
                        kind: "map",
                        usage: "Map of child shader id -> ShaderConfig. This is the nested layer collection rendered by the group."
                    },
                    {
                        key: "order",
                        kind: "string[]",
                        usage: "Optional child render order override inside the group. When omitted, the group falls back to Object.keys(shaders).",
                        overridesDefaultOrder: true,
                        targets: "group-children",
                        defaultBehavior: "Object.keys(shaders)"
                    },
                    {
                        key: "tiledImages",
                        kind: "special",
                        usage: "Unlike regular shader layers, the group shader does not usually consume tiled images directly. Child shaders define and use their own tiledImages."
                    },
                    {
                        key: "controls",
                        kind: "special",
                        usage: "Renderer-native controls are created for child shaders. The group shader itself is mainly a container and blend/composition stage."
                    }
                ];
            }

            return [];
        },

        _serializeDocsText(model) {
            const out = [];
            out.push(`Shader documentation`);
            out.push(`Version: ${model.version}`);
            out.push(`Generated at: ${model.generatedAt}`);
            out.push("");

            for (const shader of model.shaders) {
                out.push(`Shader: ${shader.name} [${shader.type}]`);
                if (shader.description) {
                    out.push(`Description: ${shader.description}`);
                }
                if (shader.intent) {
                    out.push(`Intent: ${shader.intent}`);
                }
                if (shader.expects) {
                    out.push(`Expects: ${JSON.stringify(shader.expects)}`);
                }
                if (shader.exampleParams !== undefined) {
                    out.push(`Example params: ${JSON.stringify(shader.exampleParams)}`);
                }
                if (Array.isArray(shader.controlCouplings) && shader.controlCouplings.length) {
                    out.push(`Control couplings:`);
                    for (const c of shader.controlCouplings) {
                        out.push(`- ${c.name} [${(c.controls || []).join(", ")}]: ${c.summary}`);
                    }
                }

                if (shader.sources.length) {
                    out.push(`Sources:`);
                    for (const src of shader.sources) {
                        out.push(`- Source ${src.index}: ${src.description || "No description"}` +
                            (src.acceptedChannelCounts ? ` | accepted channel counts: ${src.acceptedChannelCounts.join(", ")}` : ""));
                    }
                }

                if (shader.controls.length) {
                    out.push(`Controls:`);
                    for (const control of shader.controls) {
                        out.push(`- ${control.name}: supported ui types = ${control.supportedTypes.join(", ")}`);
                    }
                }

                if (shader.customParams.length) {
                    out.push(`Custom parameters:`);
                    for (const param of shader.customParams) {
                        const detail = [
                            param.type ? `type = ${param.type}` : "",
                            param.default !== undefined ? `default = ${JSON.stringify(param.default)}` : "",
                            param.required !== undefined ? `required = ${JSON.stringify(param.required)}` : ""
                        ].filter(Boolean).join(" | ");
                        out.push(`- ${param.name}: ${param.usage}${detail ? ` | ${detail}` : ""}`);
                    }
                }

                if (shader.classDocs && shader.classDocs.summary) {
                    out.push(`Class docs: ${shader.classDocs.summary}`);
                }

                if (shader.configNotes && shader.configNotes.length) {
                    out.push(`Configuration notes:`);
                    for (const note of shader.configNotes) {
                        out.push(`- ${note.key}${note.kind ? ` (${note.kind})` : ""}: ${note.usage}`);
                    }
                }

                out.push("");
            }

            return out.join("\n");
        },

        _inferCustomParamTypeFromValue(value) {
            if (Array.isArray(value) || value === null) {
                return "json";
            }
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                return typeof value;
            }
            if (typeof value === "object") {
                return "json";
            }
            return null;
        },

        _resolveCustomParamType(meta = {}) {
            if (meta && typeof meta.type === "string" && meta.type.trim()) {
                return meta.type.trim();
            }
            if (meta && meta.required && typeof meta.required === "object" &&
                typeof meta.required.type === "string" && meta.required.type.trim()) {
                return meta.required.type.trim();
            }
            if (meta && meta.default !== undefined) {
                return this._inferCustomParamTypeFromValue(meta.default) || "json";
            }
            if (meta && meta.required !== undefined) {
                return this._inferCustomParamTypeFromValue(meta.required) || "json";
            }
            return "json";
        },

        _compileCustomParamDescriptor(name, meta = {}) {
            return {
                name,
                type: this._resolveCustomParamType(meta),
                usage: (meta && meta.usage) || "",
                default: meta && meta.default !== undefined ? deepClone(meta.default) : undefined,
                required: meta && meta.required !== undefined ? deepClone(meta.required) : undefined
            };
        },

        _normalizeClassDocs(rawDocs, fallback = {}) {
            if (!rawDocs) {
                return null;
            }

            if (typeof rawDocs === "function") {
                rawDocs = rawDocs(fallback);
            }

            if (!rawDocs) {
                return null;
            }

            if (typeof rawDocs === "string") {
                return {
                    summary: rawDocs,
                    description: rawDocs
                };
            }

            if (typeof rawDocs !== "object") {
                return null;
            }

            const normalized = deepClone(rawDocs);
            if (!normalized.summary && normalized.description) {
                normalized.summary = String(normalized.description).split(/\n\s*\n/)[0].trim();
            }
            if (!normalized.description && normalized.summary) {
                normalized.description = normalized.summary;
            }

            if (fallback.type && normalized.type === undefined) {
                normalized.type = fallback.type;
            }
            if (fallback.name && normalized.name === undefined) {
                normalized.name = fallback.name;
            }
            if (fallback.kind && normalized.kind === undefined) {
                normalized.kind = fallback.kind;
            }

            return normalized;
        },

        _extractDocsProvider(subject, fallback = {}) {
            if (!subject) {
                return null;
            }

            if (typeof subject.docs === "function") {
                return this._normalizeClassDocs(subject.docs(subject, fallback), fallback);
            }

            if (typeof subject.docs === "object" || typeof subject.docs === "string") {
                return this._normalizeClassDocs(subject.docs, fallback);
            }

            if (typeof subject.getDocs === "function") {
                return this._normalizeClassDocs(subject.getDocs(subject, fallback), fallback);
            }

            return null;
        },

        _getShaderClassDocs(Shader) {
            if (!Shader || typeof Shader.type !== "function") {
                return null;
            }

            const fallback = {
                kind: "shader",
                type: Shader.type(),
                name: typeof Shader.name === "function" ? Shader.name() : Shader.type()
            };

            const explicit = this._extractDocsProvider(Shader, fallback);
            if (explicit) {
                return explicit;
            }

            const description = typeof Shader.description === "function" ? Shader.description() : "";
            return this._normalizeClassDocs({
                ...fallback,
                summary: description || `${fallback.name} shader`,
                description: description || `${fallback.name} shader.`,
                api: {
                    hasSources: typeof Shader.sources === "function",
                    hasDefaultControls: !!Shader.defaultControls,
                    hasCustomParams: !!Shader.customParams
                }
            }, fallback);
        },

        _getControlClassDocs(control) {
            if (!control) {
                return null;
            }

            const fallback = {
                kind: "ui-control",
                type: control.uiControlType || control.name,
                name: control.name || control.uiControlType
            };

            if (control.component) {
                const docs = this._extractDocsProvider(control.component, fallback);
                if (docs) {
                    return docs;
                }
            }

            const explicit = this._extractDocsProvider(control.constructor, fallback);
            if (explicit) {
                return explicit;
            }

            return this._normalizeClassDocs({
                ...fallback,
                summary: `${fallback.name || fallback.type} UI control`,
                description: `${fallback.name || fallback.type} UI control for GLSL type ${control.type}.`,
                api: {
                    glType: control.type,
                    supports: deepClone(control.supports || {})
                }
            }, fallback);
        },

        _renderDefaultShaderDoc(shader) {
            const card = document.createElement("div");
            card.className = "card bg-base-100 border border-base-300 shadow-sm";
            const preview = this._normalizePreviewDefinition(shader.preview, shader);

            card.innerHTML = `
<details class="bg-base-100">
  <summary class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 p-4">
        <span class="min-w-[180px] flex-1">
            <span class="block text-lg font-semibold">${escapeHtml(shader.name)}</span>
            <span class="badge badge-outline mt-1">${escapeHtml(shader.type)}</span>
            <span class="mt-2 block text-sm opacity-80">${escapeHtml(shader.description || "")}</span>
        </span>
        ${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-w-[150px] max-h-[150px] shrink-0")}
  </summary>
  <div class="border-t border-base-300 p-4 text-sm">
    ${shader.intent ? `
    <div class="mb-3">
        <div class="font-semibold">Intent</div>
        <div>${escapeHtml(shader.intent)}</div>
    </div>` : ""}

    ${shader.expects ? `
    <div class="mb-3">
        <div class="font-semibold">Expects</div>
        <pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(shader.expects, null, 2))}</pre>
    </div>` : ""}

    ${shader.exampleParams !== undefined ? `
    <div class="mb-3">
        <div class="font-semibold">Example params</div>
        <pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(shader.exampleParams, null, 2))}</pre>
    </div>` : ""}

    ${Array.isArray(shader.controlCouplings) && shader.controlCouplings.length ? `
    <div class="mb-3">
        <div class="font-semibold">Control couplings</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Controls</th><th>Rule</th></tr></thead>
                <tbody>
                    ${shader.controlCouplings.map(c => `
                    <tr>
                        <td><code>${escapeHtml(c.name)}</code></td>
                        <td>${escapeHtml((c.controls || []).join(", "))}</td>
                        <td>${escapeHtml(c.summary || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

     ${shader.sources.length ? `
    <div>
        <div class="mb-2 font-semibold">Sources</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>#</th><th>Description</th><th>Accepted channels</th></tr></thead>
                <tbody>
                    ${shader.sources.map(src => `
                    <tr>
                        <td>${src.index}</td>
                        <td>${escapeHtml(src.description || "")}</td>
                        <td>${src.acceptedChannelCounts ? escapeHtml(src.acceptedChannelCounts.join(", ")) : "any"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.controls.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Controls</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Supported UI types</th><th>Default</th></tr></thead>
                <tbody>
                    ${shader.controls.map(ctrl => `
                    <tr>
                        <td><code>${escapeHtml(ctrl.name)}</code></td>
<td>${escapeHtml(ctrl.supportedTypes.join(", "))}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.default || ctrl.required || {}, null, 2))}</pre></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.customParams && shader.customParams.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Custom Parameters</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Type</th><th>Usage</th><th>Default</th><th>Required</th></tr></thead>
                <tbody>
                    ${shader.customParams.map(param => `
                    <tr>
                        <td><code>${escapeHtml(param.name)}</code></td>
                        <td><code>${escapeHtml(param.type || "json")}</code></td>
                        <td>${escapeHtml(param.usage || "")}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(param.default, null, 2))}</pre></td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(param.required, null, 2))}</pre></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.configNotes && shader.configNotes.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Configuration notes</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Key</th><th>Kind</th><th>Usage</th></tr></thead>
                <tbody>
                    ${shader.configNotes.map(note => `
                    <tr>
                        <td><code>${escapeHtml(note.key)}</code></td>
                        <td>${escapeHtml(note.kind || "")}</td>
                        <td>${escapeHtml(note.usage || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}
  </div>
</details>`;
            return card;
        },

        _renderInteractiveShell(node, Shader) {
            const shaderType = Shader.type();
            const preview = this._resolveShaderPreview(Shader);
            node.innerHTML = `
<div class="grid grid-cols-1 xl:grid-cols-[minmax(380px,540px)_1fr] gap-4" id="${this._uniqueId}_interactive_root">
    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="flex items-center justify-between gap-4">
                <div>
                    <div class="card-title">Shader configurator</div>
                    <div class="badge badge-primary">${escapeHtml(shaderType)}</div>
                </div>
                ${this._onControlSelectFinish ? `<button class="btn btn-primary btn-sm" id="${this._uniqueId}_done_btn">Done</button>` : ""}
            </div>
            <div class="alert alert-info text-sm">
                Renderer-native controls below are mounted by FlexRenderer itself.
                Meta-editors on the left change shader config and recompile the preview.
            </div>
            <div id="${this._uniqueId}_meta_editors" class="flex flex-col gap-3"></div>
        </div>
    </div>

    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="card-title">Renderer controls & preview</div>
            ${preview ? `<div class="flex items-center justify-center rounded-box bg-base-200 p-2">${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-h-[180px] w-auto")}</div>` : ""}
            <div id="${this._uniqueId}_native_controls" class="flex flex-col gap-3"></div>
            <div id="${this._uniqueId}_preview_host" class="min-h-[180px] flex items-center justify-center rounded-box bg-base-200 p-2"></div>
        </div>
    </div>
</div>`;

            const doneBtn = document.getElementById(`${this._uniqueId}_done_btn`);
            if (doneBtn && this._onControlSelectFinish) {
                doneBtn.addEventListener("click", () => {
                    this._onControlSelectFinish(this.getCurrentShaderConfig());
                });
            }
        },

        async _refreshInteractive() {
            if (!this._rootNode) {
                return;
            }

            const Shader = $.FlexRenderer.ShaderMediator.getClass(this.setup.shader.type);
            if (!Shader) {
                return;
            }

            const previewHost = document.getElementById(`${this._uniqueId}_preview_host`);
            await this._ensurePreviewSession(previewHost);
            const previewSize = getRenderableDimensions(this._renderData);
            await this._previewSession.setSize(previewSize.width, previewSize.height);
            await this._previewSession.setShader(this.setup.shader);

            this._renderMetaEditors(Shader);
            await this._renderInteractivePreview(previewHost, previewSize);
        },

        async _ensurePreviewSession(previewHost = undefined) {
            if (this._previewSession) {
                return;
            }

            const previewSize = getRenderableDimensions(this._renderData);
            const sessionOptions = {
                uniqueId: `${this._uniqueId}_preview`,
                width: previewSize.width,
                height: previewSize.height,
                controlMountResolver: () => document.getElementById(`${this._uniqueId}_native_controls`),
                previewHost,
                data: this._renderData,
                onVisualizationChanged: (shaderConfig, session) => {
                    this.setup.shader = deepClone(shaderConfig);
                    if (this._previewAdapter && typeof this._previewAdapter.onSessionVisualizationChanged === "function") {
                        this._previewAdapter.onSessionVisualizationChanged({
                            configurator: this,
                            session,
                            shaderConfig: this.getCurrentShaderConfig(),
                            data: this._renderData,
                            previewHost: document.getElementById(`${this._uniqueId}_preview_host`),
                            previewSize: getRenderableDimensions(this._renderData)
                        });
                    }
                }
            };

            if (this._previewAdapter && typeof this._previewAdapter.createSession === "function") {
                this._previewSession = await this._previewAdapter.createSession(sessionOptions);
            } else {
                this._previewSession = new PreviewSession(sessionOptions);
            }
        },

        async _renderInteractivePreview(previewHost, previewSize) {
            if (this._previewAdapter && typeof this._previewAdapter.render === "function") {
                const renderedPreview = await this._previewAdapter.render({
                    configurator: this,
                    session: this._previewSession,
                    shaderConfig: this.getCurrentShaderConfig(),
                    data: this._renderData,
                    previewHost,
                    previewSize
                });

                if (previewHost && isNode(renderedPreview) && renderedPreview.parentNode !== previewHost) {
                    previewHost.innerHTML = "";
                    previewHost.appendChild(renderedPreview);
                }
            } else if (previewHost) {
                if (this._previewSession.renderer.canvas.parentNode !== previewHost) {
                    previewHost.innerHTML = "";
                    previewHost.appendChild(this._previewSession.renderer.canvas);
                }
                this._previewSession.setSize(previewSize.width, previewSize.height);
            }
        },

        _resolvePreviewSrc(fileOrSrc) {
            if (!fileOrSrc) {
                return null;
            }
            const value = String(fileOrSrc);
            if (/^(?:data:|blob:|https?:|\/)/i.test(value)) {
                return value;
            }
            const basePath = this.previewAssets.basePath;
            if (!basePath) {
                return value;
            }
            return `${basePath.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
        },

        _normalizePreviewDefinition(preview, shaderMeta = {}) {
            if (!preview) {
                return null;
            }

            if (typeof preview === "function") {
                preview = preview(shaderMeta);
            }
            if (!preview) {
                return null;
            }

            const alt = preview.alt || `${shaderMeta.name || shaderMeta.type || "Shader"} preview`;

            if (typeof preview === "string") {
                return {
                    src: this._resolvePreviewSrc(preview),
                    alt
                };
            }
            if (preview.svg) {
                return {
                    src: svgToDataUri(preview.svg),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.file) {
                return {
                    src: this._resolvePreviewSrc(preview.file),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.src) {
                return {
                    src: this._resolvePreviewSrc(preview.src),
                    alt,
                    className: preview.className || ""
                };
            }
            return null;
        },

        _buildFallbackPreview(shaderMeta = {}) {
            const label = escapeHtml(shaderMeta.name || shaderMeta.type || "Shader");
            return this._normalizePreviewDefinition({
                svg: `
+<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${label}">
+  <defs>
+    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
<stop offset="0%" stop-color="#1f2937"/>
<stop offset="100%" stop-color="#111827"/>
+    </linearGradient>
+  </defs>
+  <rect width="320" height="180" rx="18" fill="url(#g)"/>
+  <g fill="none" stroke="#60a5fa" stroke-width="10" opacity="0.9">
+    <path d="M24 126 C72 48, 122 48, 168 126 S264 204, 296 58"/>
+    <path d="M24 86 C72 150, 122 150, 168 86 S264 22, 296 122" opacity="0.55"/>
+  </g>
+  <rect x="20" y="20" width="112" height="30" rx="15" fill="#0f172a" stroke="#334155"/>
+  <text x="76" y="40" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#e5e7eb">${label}</text>
+</svg>`,
                alt: `${label} preview`
            }, shaderMeta);
        },

        _resolveShaderPreview(shaderLike) {
            if (!shaderLike) {
                return null;
            }

            const type = typeof shaderLike.type === "function" ? shaderLike.type() : shaderLike.type;
            const name = typeof shaderLike.name === "function" ? shaderLike.name() : shaderLike.name || type;
            const meta = { type, name };

            let preview = this.previewAssets.registry.get(type);
            if (!preview && typeof shaderLike.preview === "function") {
                preview = shaderLike.preview();
            } else if (!preview && shaderLike.preview) {
                preview = shaderLike.preview;
            }
            if (!preview && this.previewAssets.aliases[type]) {
                preview = { file: this.previewAssets.aliases[type] };
            }

            return this._normalizePreviewDefinition(preview, meta) || this._buildFallbackPreview(meta);
        },

        _renderShaderPreviewMarkup(preview, className = "") {
            const normalized = this._normalizePreviewDefinition(preview, {});
            if (!normalized || !normalized.src) {
                return "";
            }
            const classes = [normalized.className || "", className].filter(Boolean).join(" ").trim();
            return `<img alt="${escapeHtml(normalized.alt || "Shader preview")}" loading="lazy" decoding="async" class="${escapeHtml(classes)}" src="${escapeHtml(normalized.src)}">`;
        },

        _renderMetaEditors(Shader) {
            const mount = document.getElementById(`${this._uniqueId}_meta_editors`);
            if (!mount) {
                return;
            }
            mount.innerHTML = "";

            const supports = this.getAvailableControlsForShader(Shader);
            const defs = Shader.defaultControls || {};
            const customParams = Shader.customParams || {};

            for (const [controlName, supported] of Object.entries(supports)) {
                const current = this.setup.shader.params[controlName] || {};
                const requiredType = defs[controlName] && defs[controlName].required && typeof defs[controlName].required === "object" ?
                    defs[controlName].required.type : undefined;
                const defaultType = defs[controlName] && defs[controlName].default && typeof defs[controlName].default === "object" ?
                    defs[controlName].default.type : undefined;
                const activeType =
                    current.type ||
                    requiredType ||
                    defaultType ||
                    supported[0];

                if (!this.setup.shader.params[controlName]) {
                    this.setup.shader.params[controlName] = { type: activeType };
                } else if (!this.setup.shader.params[controlName].type) {
                    this.setup.shader.params[controlName].type = activeType;
                }

                const card = document.createElement("div");
                card.className = "card bg-base-200 border border-base-300 shadow-sm";

                const useSimple = this.renderStyle.ui(controlName) && !!this.interactiveRenderers.get(activeType);

                card.innerHTML = `
<div class="card-body p-4 gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
            <div class="font-semibold">Control <code>${escapeHtml(controlName)}</code></div>
            <div class="text-xs opacity-70">Supported: ${escapeHtml(supported.join(", "))}</div>
        </div>
        <div class="flex items-center gap-3">
            <label class="label cursor-pointer gap-2">
                <span class="label-text text-sm">Simple</span>
                <input type="checkbox" class="toggle toggle-sm" ${useSimple ? "checked" : ""} data-role="style-toggle">
            </label>
            <select class="select select-bordered select-sm" data-role="type-select">
                ${supported.map(type => `<option value="${escapeHtml(type)}" ${type === activeType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
            </select>
        </div>
    </div>
    <div data-role="simple-editor"></div>
    <details class="collapse collapse-arrow bg-base-100 border border-base-300">
        <summary class="collapse-title text-sm font-medium">JSON</summary>
        <div class="collapse-content">
            <textarea class="textarea textarea-bordered w-full h-40 font-mono text-xs" data-role="json-editor"></textarea>
        </div>
    </details>
</div>`;

                const typeSelect = card.querySelector(`[data-role="type-select"]`);
                const styleToggle = card.querySelector(`[data-role="style-toggle"]`);
                const simpleEditor = card.querySelector(`[data-role="simple-editor"]`);
                const jsonEditor = card.querySelector(`[data-role="json-editor"]`);

                jsonEditor.value = JSON.stringify(this.setup.shader.params[controlName], null, 2);

                typeSelect.addEventListener("change", () => {
                    this.refreshUserSelected(controlName, typeSelect.value);
                });

                styleToggle.addEventListener("change", () => {
                    this.refreshUserSwitched(controlName);
                });

                jsonEditor.addEventListener("change", () => {
                    this.refreshUserScripted(jsonEditor, controlName);
                });

                const renderer = this.interactiveRenderers.get(activeType);
                if (useSimple && renderer) {
                    const api = {
                        configurator: this,
                        controlName,
                        shaderConfig: this.setup.shader,
                        controlDefinition: defs[controlName],
                        controlConfig: this.setup.shader.params[controlName],
                        mount: simpleEditor,
                        update: (patch) => {
                            this.setup.shader.params[controlName] = {
                                ...this.setup.shader.params[controlName],
                                ...patch
                            };
                            this.refresh();
                        }
                    };

                    const rendered = typeof renderer === "function" ? renderer(api) : renderer.render(api);
                    if (typeof rendered === "string") {
                        simpleEditor.innerHTML = rendered;
                    } else if (isNode(rendered)) {
                        simpleEditor.appendChild(rendered);
                    }
                } else {
                    simpleEditor.innerHTML = `
<div class="alert alert-warning text-sm">
    No simple editor registered for <code>${escapeHtml(activeType)}</code>.
    Use JSON editor.
</div>`;
                }

                mount.appendChild(card);
            }

            for (const [paramName, meta] of Object.entries(customParams)) {
                const currentValue = this.setup.shader.params[paramName] !== undefined ?
                    this.setup.shader.params[paramName] :
                    (meta && meta.default);
                const inferredType = this._resolveCustomParamType({
                    ...(meta || {}),
                    default: currentValue
                });

                const card = document.createElement("div");
                card.className = "card bg-base-200 border border-base-300 shadow-sm";
                card.innerHTML = `
<div class="card-body p-4 gap-3">
    <div>
        <div class="font-semibold">Parameter <code>${escapeHtml(paramName)}</code></div>
        <div class="text-xs opacity-70">${escapeHtml((meta && meta.usage) || "")}</div>
        <div class="text-xs opacity-60">Type: <code>${escapeHtml(inferredType)}</code></div>
    </div>
    <div data-role="simple-editor"></div>
    <details class="collapse collapse-arrow bg-base-100 border border-base-300">
        <summary class="collapse-title text-sm font-medium">JSON</summary>
        <div class="collapse-content">
            <textarea class="textarea textarea-bordered w-full h-40 font-mono text-xs" data-role="json-editor"></textarea>
        </div>
    </details>
</div>`;

                const simpleEditor = card.querySelector(`[data-role="simple-editor"]`);
                const jsonEditor = card.querySelector(`[data-role="json-editor"]`);
                jsonEditor.value = JSON.stringify(currentValue, null, 2);
                jsonEditor.addEventListener("change", () => {
                    try {
                        this.setup.shader.params[paramName] = JSON.parse(jsonEditor.value);
                        jsonEditor.classList.remove("textarea-error");
                        this.refresh();
                    } catch (_) {
                        jsonEditor.classList.add("textarea-error");
                    }
                });

                const setValue = (value) => {
                    this.setup.shader.params[paramName] = value;
                    this.refresh();
                };

                if (inferredType === "string") {
                    simpleEditor.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Value</span></div>
    <input class="input input-bordered input-sm" type="text" value="${escapeHtml(currentValue === undefined ? "" : String(currentValue))}">
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(e.target.value);
                    });
                } else if (inferredType === "number") {
                    simpleEditor.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Value</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(currentValue === undefined ? "" : String(currentValue))}">
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(Number(e.target.value));
                    });
                } else if (inferredType === "boolean") {
                    simpleEditor.innerHTML = `
<label class="label cursor-pointer justify-start gap-3">
    <input type="checkbox" class="toggle toggle-sm" ${currentValue ? "checked" : ""}>
    <span class="label-text">Enabled</span>
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(!!e.target.checked);
                    });
                } else {
                    simpleEditor.innerHTML = `
<div class="alert alert-warning text-sm">
    No simple typed editor available. Use JSON editor.
</div>`;
                }

                mount.appendChild(card);
            }
        },

        _buildControls() {
            if (this.__uicontrols) {
                return this.__uicontrols;
            }
            this.__uicontrols = {};

            const types = $.FlexRenderer.UIControls.types();
            const ShaderClass = $.FlexRenderer.ShaderMediator.getClass("identity");

            const fallbackLayer = new ShaderClass("id", {
                shaderConfig: {
                    id: "fallback__",
                    name: "Layer",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                },
                webglContext: {
                    supportedUseModes: ["show"],
                    includeGlobalCode: () => {}
                },
                params: {},
                interactive: false,
                invalidate: () => {},
                rebuild: () => {},
                refetch: () => {}
            });

            fallbackLayer.construct({}, [0]);

            for (let type of types) {
                const ctrl = $.FlexRenderer.UIControls.build(fallbackLayer, type, {
                    default: { type: type },
                    accepts: () => true
                }, Date.now(), {});

                const glType = ctrl.type;
                ctrl.name = type;
                if (!this.__uicontrols[glType]) {
                    this.__uicontrols[glType] = [];
                }
                this.__uicontrols[glType].push(ctrl);
            }

            return this.__uicontrols;
        }
    };

    // ---------------------------------------------------------------------
    // Optional default simple editors
    // ---------------------------------------------------------------------

    ShaderConfigurator.registerInteractiveRenderer("range", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(spec.default || "")}">
</label>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: Number(e.target.value) });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("range_input", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "grid grid-cols-2 gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" data-k="default" type="number" value="${escapeHtml(spec.default || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Step</span></div>
    <input class="input input-bordered input-sm" data-k="step" type="number" value="${escapeHtml(spec.step || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Min</span></div>
    <input class="input input-bordered input-sm" data-k="min" type="number" value="${escapeHtml(spec.min || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Max</span></div>
    <input class="input input-bordered input-sm" data-k="max" type="number" value="${escapeHtml(spec.max || "")}">
</label>`;
        wrap.querySelectorAll("input").forEach(input => {
            input.addEventListener("change", () => {
                update({ [input.dataset.k]: Number(input.value) });
            });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("bool", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "label cursor-pointer justify-start gap-3";
        wrap.innerHTML = `
<input type="checkbox" class="toggle toggle-sm" ${controlConfig.default ? "checked" : ""}>
<span class="label-text">Default enabled</span>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: !!e.target.checked });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("color", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "form-control";
        wrap.innerHTML = `
<div class="label"><span class="label-text">Default color</span></div>
<input type="color" class="input input-bordered input-sm p-1" value="${escapeHtml(controlConfig.default || "#ffffff")}">`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: e.target.value });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("select_int", ({ mount, controlConfig, update }) => {
        const options = Array.isArray(controlConfig.options) ? controlConfig.options : [];
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(controlConfig.default || 0)}">
</label>
<details class="collapse collapse-arrow bg-base-100 border border-base-300">
    <summary class="collapse-title text-sm font-medium">Options</summary>
    <div class="collapse-content">
        <textarea class="textarea textarea-bordered w-full h-28 font-mono text-xs">${escapeHtml(JSON.stringify(options, null, 2))}</textarea>
    </div>
</details>`;
        const defaultInput = wrap.querySelector("input");
        const optionsArea = wrap.querySelector("textarea");

        defaultInput.addEventListener("change", () => {
            update({ default: Number(defaultInput.value) });
        });
        optionsArea.addEventListener("change", () => {
            update({ options: JSON.parse(optionsArea.value) });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("icon", ({ mount, controlConfig, update }) => {
        const iconSets = $.FlexRenderer.UIControls.IconLibrary.getSetNames();
        const wrap = document.createElement("div");
        wrap.className = "grid grid-cols-2 gap-2";
        wrap.innerHTML = `
<label class="form-control col-span-2">
    <div class="label"><span class="label-text">Default icon query</span></div>
    <input class="input input-bordered input-sm" data-k="default" type="text" value="${escapeHtml(controlConfig.default || "")}" placeholder="fa-house, &#xf015;, ★">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Icon set</span></div>
    <select class="select select-bordered select-sm" data-k="iconSet">
        ${iconSets.map(name => `<option value="${escapeHtml(name)}" ${name === (controlConfig.iconSet || "core") ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
    </select>
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Size</span></div>
    <input class="input input-bordered input-sm" data-k="size" type="number" min="16" value="${escapeHtml(controlConfig.size || 128)}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Padding</span></div>
    <input class="input input-bordered input-sm" data-k="padding" type="number" min="0" value="${escapeHtml(controlConfig.padding || 16)}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Color</span></div>
    <input class="input input-bordered input-sm p-1" data-k="color" type="color" value="${escapeHtml(controlConfig.color || "#111111")}">
</label>`;

        wrap.querySelectorAll("input, select").forEach(input => {
            input.addEventListener("change", () => {
                const key = input.dataset.k;
                const value = input.type === "number" ? Number(input.value) : input.value;
                update({ [key]: value });
            });
        });
        mount.appendChild(wrap);
    });

    OpenSeadragon.FlexRenderer.ShaderConfigurator = ShaderConfigurator;

})(OpenSeadragon);

//! flex-renderer 0.0.1
//! Built on 2026-05-02
//! Git commit: --3326e6e-dirty
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

let EXTENT = 4096;
let STYLE = {
    layers: {},
    fallback: { type: 'line', color: [0, 0, 0, 1], widthPx: 1, join: 'bevel', cap: 'butt' }
};

self.onmessage = async (e) => {
    const msg = e.data;

    try {
        if (msg.type === 'config') {
            EXTENT = msg.extent || EXTENT;
            STYLE = msg.style || STYLE;
            return;
        }

        if (msg.type === 'tile') {
            const {key, url, z, x, y} = msg;

            let tileDepth = (z << 2) + (2 * (y % 2) + (x % 2)) + 1; // we only need 2 bits to encode for the 4 possibilities for the combination of x and y

            // lazy-load libs
            if (!self.Pbf || !self.vectorTile || !self.earcut) {
                throw new Error('Missing libs');
            }
            const resp = await fetch(url);

            if (!resp.ok) {
                throw new Error('HTTP ' + resp.status);
            }

            const buf = await resp.arrayBuffer();
            const vt = new self.vectorTile.VectorTile(new self.Pbf(new Uint8Array(buf)));

            const fills = [];
            const lines = [];
            const points = [];
            const icons = [];

            // Iterate layers
            for (const lname in vt.layers) {
                const lyr = vt.layers[lname];
                const lstyle = STYLE.layers[lname] || STYLE.fallback;

                for (let f = 0; f < lyr.length; f++) {
                    const feat = lyr.feature(f);
                    const geom = feat.loadGeometry();
                    const fstyle = lstyle; // TODO: evaluate by properties/zoom if needed

                    if (feat.type === 3 && fstyle.type === 'fill') {
                        // Polygon with holes; MVT ring rule: outer CW, holes CCW (y down)
                        const polys = classifyRings(geom);
                        for (const poly of polys) {
                            const flat = [];
                            const holes = [];
                            let len = 0;

                            for (let r = 0; r < poly.length; r++) {
                                const ring = poly[r];

                                if (r > 0) {
                                    holes.push(len);
                                }

                                for (let k = 0; k < ring.length; k++) {
                                    const p = ring[k];
                                    flat.push(p.x, p.y);
                                    len++;
                                }
                            }

                            const idx = self.earcut(flat, holes, 2);

                            if (idx.length) {
                                // Normalize to 0..1 UV for the renderer
                                const vertCount = flat.length / 2;
                                const verts = new Float32Array(4 * vertCount);
                                for (let v = 0; v < vertCount; v += 1) {
                                    verts[4 * v + 0] = flat[2 * v + 0] / lyr.extent;
                                    verts[4 * v + 1] = flat[2 * v + 1] / lyr.extent;
                                    verts[4 * v + 2] = tileDepth;
                                    verts[4 * v + 3] = -1;
                                }
                                fills.push({ vertices: verts.buffer, indices: new Uint32Array(idx).buffer, color: fstyle.color });
                            }
                        }
                    }

                    if (feat.type === 2 && fstyle.type === 'line') {
                        // Build stroke triangles (bevel joins + requested caps; miter threshold)
                        const widthPx = fstyle.widthPx || 1.0;
                        const widthTile = widthPx * (lyr.extent / (512)); // heuristic: px@512 tile
                        for (let p = 0; p < geom.length; p++) {
                            const pts = geom[p];
                            const mesh = strokePoly(pts, widthTile, fstyle.join || 'bevel', fstyle.cap || 'butt', fstyle.miterLimit || 2.0);
                            if (mesh && mesh.indices.length) {
                                const vertCount = mesh.vertices.length / 2;
                                const verts = new Float32Array(4 * vertCount);
                                for (let v = 0; v < vertCount; v += 1) {
                                    verts[4 * v + 0] = mesh.vertices[2 * v + 0] / lyr.extent;
                                    verts[4 * v + 1] = mesh.vertices[2 * v + 1] / lyr.extent;
                                    verts[4 * v + 2] = tileDepth;
                                    verts[4 * v + 3] = -1;
                                }
                                lines.push({ vertices: verts.buffer, indices: new Uint32Array(mesh.indices).buffer, color: fstyle.color });
                            }
                        }
                    }

                    if (feat.type === 1 && fstyle.type === 'point') {
                        const size = (fstyle.size || 10.0) / 2.0;
                        const verts = [];
                        const idx = [0, 1, 2, 0, 2, 3];
                        for (let p = 0; p < geom.length; p++) {
                            const pts = geom[p];
                            for (let pi = 0; pi < pts.length; pi += 1) {
                                const pt = pts[pi];
                                verts.push((pt.x + size) / lyr.extent, (pt.y - size) / lyr.extent, tileDepth, -1);
                                verts.push((pt.x - size) / lyr.extent, (pt.y - size) / lyr.extent, tileDepth, -1);
                                verts.push((pt.x - size) / lyr.extent, (pt.y + size) / lyr.extent, tileDepth, -1);
                                verts.push((pt.x + size) / lyr.extent, (pt.y + size) / lyr.extent, tileDepth, -1);
                            }
                        }
                        points.push({ vertices: new Float32Array(verts).buffer, indices: new Uint32Array(idx).buffer, color: fstyle.color });
                    }

                    if (feat.type === 1 && fstyle.type === 'icon') {
                        const size = fstyle.size || 1.0;
                        const icon = fstyle.iconMapping[feat.properties.class] || { textureId: -1, width: 16, height: 16 };

                        const verts = [];
                        const idx = [0, 1, 3, 0, 2, 3];
                        const parameters = [];

                        for (let p = 0; p < geom.length; p++) {
                            const pts = geom[p];
                            for (let pi = 0; pi < pts.length; pi += 1) {
                                const pt = pts[pi];

                                const width = size * icon.width;
                                const height = size * icon.height;

                                const xStart = (pt.x - (width / 2.0)) / lyr.extent;
                                const xEnd = (pt.x + (width / 2.0)) / lyr.extent;
                                const yStart = (pt.y - (height / 2.0)) / lyr.extent;
                                const yEnd = (pt.y + (height / 2.0)) / lyr.extent;

                                verts.push(xStart, yStart, tileDepth, icon.textureId);
                                verts.push(xEnd, yStart, tileDepth, icon.textureId);
                                verts.push(xStart, yEnd, tileDepth, icon.textureId);
                                verts.push(xEnd, yEnd, tileDepth, icon.textureId);

                                for (let i = 0; i < 4; i += 1) {
                                    parameters.push(xStart, yStart, width / lyr.extent, height / lyr.extent);
                                }
                            }
                        }

                        icons.push({ vertices: new Float32Array(verts).buffer, indices: new Uint32Array(idx).buffer, parameters: new Float32Array(parameters).buffer });
                    }
                }
            }

            // Transfer buffers
            const transfer = [];

            for (const a of fills) {
                transfer.push(a.vertices, a.indices);
            }

            for (const a of lines) {
                transfer.push(a.vertices, a.indices);
            }

            for (const a of points) {
                transfer.push(a.vertices, a.indices);
            }

            for (const a of icons) {
                transfer.push(a.vertices, a.indices, a.parameters);
            }

            self.postMessage({ type: 'tile', key, ok: true, data: { fills, lines, points, icons } }, transfer);
        }
    } catch (err) {
        self.postMessage({ type: 'tile', key: e.data && e.data.key, ok: false, error: String(err) });
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
//! Built on 2026-05-02
//! Git commit: --3326e6e-dirty
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