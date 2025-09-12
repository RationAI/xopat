function initXopatLayers() {
    function parseStore(key) {
        try {
            return JSON.parse(APPLICATION_CONTEXT.AppCache.get(key, "{}"));
        } catch (e) {
            return {};
        }
    }

    function parseVisualization(configData) {
        function isset(x, type = "string") {
            return x && typeof x === type;
        }

        for (let visualizationTarget of configData) {
            if (!isset(visualizationTarget.name)) {
                visualizationTarget.name = $.t('main.shaders.defaultTitle');
            }
            if (!isset(visualizationTarget.shaders, "object")) {
                console.warn(`Visualization #${index} invalid: missing shaders definition.`, visualizationTarget);
                visualizationTarget.shaders = {};
            }

            let sid = 0, source = $.t("common.Source");
            for (let data in visualizationTarget.shaders) {
                const layer = visualizationTarget.shaders[data];

                if (!isset(layer.type)) {
                    //message ui? 'messages.shaderTypeMissing'
                    console.warn(`Visualization #${index} shader layer removed: missing type.`, layer);
                    delete visualizationTarget.shaders[data];
                    continue;
                }

                if (!isset(layer.name)) {
                    let temp = data.substring(Math.max(0, data.length - 24), 24);
                    if (temp.length !== data.length) temp = "..." + temp;
                    layer.name = source + ": " + temp;
                }
            }
        }
    }

    const namedCookieCache = parseStore('_layers.namedCache');
    const orderedCookieCache = parseStore('_layers.orderedCache');

    /**
     * Initialize Visualization (data group) from APPLICATION_CONTEXT.config setup
     * @return {*}
     */
    window.APPLICATION_CONTEXT.prepareRendering = function () {
        const visualizations = APPLICATION_CONTEXT.config.visualizations;
        parseVisualization(visualizations);

        if (APPLICATION_CONTEXT.getOption("activeVisualizationIndex") > visualizations.length) {
            console.warn("Invalid default vis index. Using 0.");
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", 0);
        }
    }

    /*---------------------------------------------------------*/
    /*------------ JS utilities and enhancements --------------*/
    /*---------------------------------------------------------*/

    const recordCache = (cookieKey, currentCache, cacheKeyMaker, keepEmpty) => {
        const shaderCache = currentCache;
        let index = 0;
        let active = VIEWER.drawer.renderer.getAllShaders();
        for (let key in active) {
            if (active.hasOwnProperty(key)) {
                let shader = active[key];

                //filter cache so that only non-empty objects are stored
                const cache = Object.fromEntries(
                    Object.entries(shader._cache).filter(([key, val]) => Object.keys(val)?.length > 0)
                );
                if (keepEmpty || Object.keys(cache).length > 0) {
                    shaderCache[cacheKeyMaker(shader.getConfig(), index++)] = cache;
                }
            }
        }
        APPLICATION_CONTEXT.AppCache.set(cookieKey, JSON.stringify(shaderCache));
    };

    /**
     * Set visualization parameters cache
     * @param {boolean} named cache by layer name if true, position if false
     */
    UTILITIES.storeVisualizationSnapshot = function (named = true) {
        if (named) recordCache('_layers.namedCache', namedCookieCache, (shader, i) => shader.name, false);
        else recordCache('_layers.orderedCache', orderedCookieCache, (shader, i) => i, true);
        Dialogs.show($.t('messages.paramConfSaved'), 5000, Dialogs.MSG_INFO);
    };

    // load desired shader upon selection
    let shadersMenu = document.getElementById("shaders");
    shadersMenu.addEventListener("mousedown", function (e) {
        if (this.childElementCount < 2) {
            e.preventDefault();
            $(this.previousElementSibling).click();
            return false;
        }
    });

    /**
     * Apply stored visualization parameters cache, best used before overrideConfigureAll().
     * Must rebuild the renderer otherwise.
     * @param shaderConfigMap
     */
    UTILITIES.applyStoredVisualizationSnapshot = function (shaderConfigMap) {
        let sid = 0;
        for (const shaderId in shaderConfigMap) {
            const config = shaderConfigMap[shaderId];
            const namedCache = namedCookieCache[config.name] || {};
            if (Object.keys(namedCache).length > 0) {
                config.cache = namedCache;
                config._cacheApplied = "name";
            } else {
                config.cache = config.cache || orderedCookieCache[sid] || {};
                config._cacheApplied = Object.keys(config.cache).length > 0 ? "order" : undefined;
            }
            sid++;
        }
    };

    shadersMenu.addEventListener("change", function () {
        const shaderIndex = Number.parseInt(this.value);
        UTILITIES.setBackgroundAndGoal(undefined, shaderIndex);
    });

    /**
     * @private
     * @param layerId
     */
    UTILITIES.clearShaderCache = function (layerId) {
        const config = VIEWER.drawer.renderer.getShaderLayerConfig(layerId);
        if (!config) return;
        config.cache = {};
        config._cacheApplied = undefined;
        VIEWER.drawer.rebuild();
    };

    UTILITIES.changeVisualizationLayer = function (layerId, type) {
        let factoryClass = OpenSeadragon.FlexRenderer.ShaderMediator.getClass(type);
        if (factoryClass !== undefined) {
            let shader = VIEWER.drawer.renderer.getShaderLayerConfig(layerId);
            if (shader) {
                shader.type = type;
                shader = VIEWER.navigator.drawer.getOverriddenShaderConfig(layerId);
                shader.type = type;
                VIEWER.drawer.rebuild(0);
            } else {
                console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': bad initialization?`);
            }
        } else {
            console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': unknown type!`);
        }
    };

    /**
     * Enable or disable UI for modes, with the given mode applied (no need to call changeModeOfLayer)
     */
    UTILITIES.shaderPartSetBlendModeUIEnabled = function (layerId, enabled) {
        const maskNode = document.getElementById(`${layerId}-mode-toggle`);
        const mode = enabled ? maskNode.dataset.mode : "show";
        if (!mode || !UTILITIES.changeModeOfLayer(layerId, mode, false)) {
            Dialogs.show($.t('messages.failedToSetMask'), 2500, Dialogs.MSG_WARN);
        }
    };

    /**
     * Change rendering mode of a shader by toggle between "show" and "otherMode"
     * without
     * @param layerId layer id in the visualization target
     * @param otherMode other toggle mode, default "blend"
     * @param toggle if false, just update the current mode
     * @return true if successfully performed
     */
    UTILITIES.changeModeOfLayer = function (layerId, otherMode = "blend", toggle = true) {
        const shader = VIEWER.drawer.renderer.getShaderLayer(layerId);

        if (shader) {
            const shaderConfig = shader.getConfig(layerId);

            const mode = shaderConfig.params.use_mode;
            let applied = "";
            let didRenderAsMask = typeof mode === "string" && mode !== "show";
            if (toggle) {
                applied = didRenderAsMask ? "show" : otherMode;
            } else {
                //if no need for change, return
                if ((!didRenderAsMask && otherMode === "show") || otherMode === mode) return true;
                applied = otherMode; //re-render, there are multiple modes to choose from
            }

            shaderConfig.params.use_mode = applied;
            // use blend not set, default with blend mode
            shader.resetMode(shaderConfig.params);
            VIEWER.drawer.rebuild(0);
            return true;
        }

        console.error(`UTILITIES::changeModeOfLayer Invalid layer id '${layerId}': bad initialization?`);
        return false;
    };

    /**
     * Set filter for given layer id
     * @param layerId
     * @param filter filter to set, "use_*" style (gamma, exposure...)
     * @param value filter parameter (scalar) value
     */
    UTILITIES.setFilterOfLayer = function (layerId, filter, value) {
        const shader = VIEWER.drawer.renderer.getShaderLayer(layerId);

        if (shader) {
            const shaderConfig = shader.getConfig(layerId);
            shaderConfig.params[filter] = value;
            shader.resetFilters(shaderConfig.params);
            VIEWER.drawer.rebuild(0);
        } else {
            console.error("Invalid layer: bad initialization?");
        }
    };

    /**
     * Test for rendering capabilities
     * Throws error on failure
     * // todo implement
     */
    UTILITIES.testRendering = function (pixelErrThreshold = 10) {
        console.error("Not implemented!");
        // //test 4X4 with heatmap shader
        // const webglModuleTest = new WebGLModule({
        //     webGlPreferredVersion: APPLICATION_CONTEXT.getOption("webGlPreferredVersion"),
        //     onFatalError: error => {throw error},
        //     onError: error => {throw error},
        //     debug: window.APPLICATION_CONTEXT.getOption("webglDebugMode"),
        //     uniqueId: "browser_render_test"
        // });
        // //tests #43ff64 --> [67, 255, 100]
        // webglModuleTest.addVisualization({name: "Test", shaders: {
        //     test: {
        //         type: "heatmap",
        //         params: {color: "#43ff64", threshold: 0, inverse: false, opacity: 1},
        //         dataReferences: [0]
        //     }
        // }});
        // webglModuleTest.prepareAndInit(null, 2, 2);
        // const canvas = document.createElement("canvas");
        // const ctx = canvas.getContext("2d");
        // canvas.width = canvas.height = 2;
        // ctx.fillStyle = "rgba(0, 0, 0, 0)"; ctx.fillRect(0, 0, 1, 1);
        // ctx.fillStyle = "rgba(255, 80, 125, 255)"; ctx.fillRect(1, 0, 1, 1);
        // ctx.fillStyle = "rgba(32, 0, 32, 128)"; ctx.fillRect(0, 1, 1, 1);
        // ctx.fillStyle = "rgba(80, 80, 90, 120)"; ctx.fillRect(1, 1, 1, 1);
        //
        // // Render a webGL canvas to an input canvas using cached version
        // const output = webglModuleTest.processImage(canvas, {width: 2, height: 2},1, 1);
        // if (!output) throw "Failed to process WebGL output: null returned.";
        // ctx.drawImage(output, 0, 0, 2, 2);
        // const data = ctx.getImageData(0, 0, 2, 2).data;
        // const testPixel = (pixelPosition, expectedRGBA) => {
        //     let index = pixelPosition*4;
        //     for (let i = 0; i < 4; i++) {
        //         const d = Math.abs(data[index+i] - expectedRGBA[i]);
        //         if (d > pixelErrThreshold) {
        //             const description = `PIXEL[${(pixelPosition)%2}, ${Math.floor(pixelPosition/2)}] expected [${expectedRGBA}], got [${data.slice(index, index+4)}]`;
        //             if (d > 2*pixelErrThreshold) throw "Heatmap shader does not work as intended! " + description;
        //             console.warn("WebGL Test shows minor color error in the output - this might be caused by interpolation.");
        //         }
        //     }
        // }
        // // Remove subsequent tests
        // UTILITIES.testRendering = function () {};
        // console.log("Rendering test output:", data, "pixel", OpenSeadragon.pixelDensityRatio);
        // // Test pixels [0, 0], [1, 0], [0, 1], [1, 1]
        // testPixel(0, [0, 0, 0, 0]); // R0 -> alpha 0, output zeroed out (no-op)
        // testPixel(1, [67, 255, 100, 255]); // R255 -> alpha 0
        //
        // // TODO: for some reason test returns modified colors for alpha != 255
        // //testPixel(2, [67, 255, 100, 32]); // R32 -> alpha 32
        // //testPixel(3, [67, 255, 100, 80]); // R80 -> alpha 80
    }
}
