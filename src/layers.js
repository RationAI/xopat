function initXOpatLayers() {
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

        function parseShaderMap(shaderMap, visualizationIndex, parentPath = []) {
            if (!isset(shaderMap, "object")) {
                return {};
            }

            let sid = 0, source = $.t("common.Source");
            for (let data in shaderMap) {
                const layer = shaderMap[data];
                const layerPath = parentPath.concat([data]).join("/");

                if (!isset(layer, "object")) {
                    console.warn(`Visualization #${visualizationIndex} shader layer removed: invalid config.`, layerPath, layer);
                    delete shaderMap[data];
                    continue;
                }

                const hasNestedShaders = isset(layer.shaders, "object");
                if (!isset(layer.type) && hasNestedShaders) {
                    layer.type = "group";
                }

                if (!isset(layer.type)) {
                    console.warn(`Visualization #${visualizationIndex} shader layer removed: missing type.`, layerPath, layer);
                    delete shaderMap[data];
                    continue;
                }

                if (!isset(layer.name)) {
                    let temp = data.substring(Math.max(0, data.length - 24), 24);
                    if (temp.length !== data.length) temp = "..." + temp;
                    layer.name = source + ": " + temp;
                }

                if (hasNestedShaders) {
                    layer.shaders = parseShaderMap(layer.shaders, visualizationIndex, parentPath.concat([data]));
                }

                sid++;
            }

            return shaderMap;
        }

        let index = 0;
        for (let visualizationTarget of configData) {
            if (!isset(visualizationTarget.name)) {
                visualizationTarget.name = $.t('main.shaders.defaultTitle');
            }
            if (!isset(visualizationTarget.shaders, "object")) {
                console.warn(`Visualization #${index} invalid: missing shaders definition.`, visualizationTarget);
                visualizationTarget.shaders = {};
            }
            visualizationTarget.shaders = parseShaderMap(visualizationTarget.shaders, index++);
        }
    }

    const namedShaderCache = parseStore('_layers.namedCache');
    const orderedShaderCache = parseStore('_layers.orderedCache');

    function isObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeCachePayload(value) {
        if (!isObject(value)) {
            return {};
        }

        // cfg.cache is flat scalars today (e.g. { use_channel0: "rgba", opacity: 1 }).
        // Drop only undefined/null and empty plain objects; scalars, booleans, arrays,
        // and non-empty objects are all valid cache values.
        return Object.fromEntries(
            Object.entries(value).filter(([_, val]) => {
                if (val === undefined || val === null) return false;
                if (isObject(val) && Object.keys(val).length === 0) return false;
                return true;
            })
        );
    }

    const SNAPSHOT_STATE_KEY = "__xopat_state";

    function extractShaderState(config) {
        const params = isObject(config?.params) ? config.params : {};
        const state = {};

        // Always record visibility — matches shaderLayer.mjs default
        // (`this.visible = this.cfg.visible !== false`). Treat 0/false as hidden,
        // anything else (including undefined and 1) as visible.
        state.visible = config?.visible !== false && config?.visible !== 0;
        if (params.use_mode !== undefined) {
            state.use_mode = params.use_mode;
        }
        if (params.use_blend !== undefined) {
            state.use_blend = params.use_blend;
        }

        return state;
    }

    function buildSnapshotPayload(config, shader) {
        const payload = normalizeCachePayload(config?.cache || shader?._cache);
        const state = extractShaderState(config);

        if (Object.keys(state).length > 0) {
            payload[SNAPSHOT_STATE_KEY] = state;
        }

        return payload;
    }

    function splitSnapshotPayload(payload) {
        const normalized = normalizeCachePayload(payload);
        const state = isObject(normalized[SNAPSHOT_STATE_KEY]) ? { ...normalized[SNAPSHOT_STATE_KEY] } : {};
        delete normalized[SNAPSHOT_STATE_KEY];
        return { cache: normalized, state };
    }

    function applySnapshotState(config, state) {
        if (!isObject(config) || !isObject(state) || Object.keys(state).length < 1) {
            return;
        }

        config.params = isObject(config.params) ? config.params : {};

        if (state.visible !== undefined) {
            config.visible = state.visible ? 1 : 0;
        }
        if (state.use_mode !== undefined) {
            config.params.use_mode = state.use_mode;
        }
        if (state.use_blend !== undefined) {
            config.params.use_blend = state.use_blend;
        }
    }

    // Canonical state→cfg merge convention. Exported so canonical-scene.ts
    // (and any future scene serializer) writes structural shader entries
    // using the same shape importLiveVisualization reads on apply.
    UTILITIES.applySnapshotState = applySnapshotState;

    function ensureSmartNamedStore(store) {
        if (store && store.__version === 2) {
            store.byId = store.byId || {};
            store.byPath = store.byPath || {};
            store.byName = store.byName || {};
            store.entries = Array.isArray(store.entries) ? store.entries : [];
            return store;
        }

        const upgraded = {
            __version: 2,
            byId: {},
            byPath: {},
            byName: {},
            entries: []
        };

        if (isObject(store)) {
            for (const [name, cache] of Object.entries(store)) {
                const normalized = normalizeCachePayload(cache);
                if (Object.keys(normalized).length < 1) continue;
                upgraded.byName[name] = upgraded.byName[name] || [];
                upgraded.byName[name].push({ cache: normalized });
                upgraded.entries.push({ name, cache: normalized });
            }
        }

        return upgraded;
    }

    function ensureOrderedStore(store) {
        if (store && store.__version === 2) {
            store.byOrder = store.byOrder || {};
            store.byPath = store.byPath || {};
            store.entries = Array.isArray(store.entries) ? store.entries : [];
            return store;
        }

        const upgraded = {
            __version: 2,
            byOrder: {},
            byPath: {},
            entries: []
        };

        if (isObject(store)) {
            for (const [index, cache] of Object.entries(store)) {
                const normalized = normalizeCachePayload(cache);
                if (Object.keys(normalized).length < 1) continue;
                upgraded.byOrder[index] = normalized;
                upgraded.entries.push({ index, cache: normalized });
            }
        }

        return upgraded;
    }

    function collectShaderEntries(viewer = VIEWER) {
        const renderer = viewer?.drawer?.renderer;
        const entries = [];

        if (renderer && typeof renderer.forEachShaderLayerWithContext === "function") {
            renderer.forEachShaderLayerWithContext(
                renderer.getAllShaders(),
                renderer.getShaderLayerOrder(),
                (shaderLayer, shaderId, shaderConfig, htmlContext) => {
                    entries.push({
                        shader: shaderLayer,
                        shaderId,
                        config: shaderConfig || shaderLayer?.getConfig?.() || {},
                        path: htmlContext?.path || [shaderId],
                        pathString: htmlContext?.pathString || shaderId,
                    });
                }
            );
            return entries;
        }

        const active = renderer?.getAllShaders?.() || {};
        let index = 0;
        for (const shaderId in active) {
            if (!Object.prototype.hasOwnProperty.call(active, shaderId)) continue;
            const shader = active[shaderId];
            entries.push({
                shader,
                shaderId,
                config: shader?.getConfig?.() || {},
                path: [shaderId],
                pathString: shaderId,
                index: index++
            });
        }
        return entries;
    }

    function forEachShaderConfig(shaderConfigMap, callback, path = []) {
        if (!isObject(shaderConfigMap)) return;

        let index = 0;
        for (const [shaderId, config] of Object.entries(shaderConfigMap)) {
            if (!isObject(config)) continue;

            const nextPath = path.concat([shaderId]);
            callback(config, shaderId, nextPath, index++);

            if (isObject(config.shaders)) {
                forEachShaderConfig(config.shaders, callback, nextPath);
            }
        }
    }

    /**
     * Initialize Visualization (data group) from APPLICATION_CONTEXT.config setup
     * todo consider moving this to app.js, doing earlier
     * @return {*}
     */
    window.APPLICATION_CONTEXT.prepareRendering = function () {
        const visualizations = APPLICATION_CONTEXT.config.visualizations;
        parseVisualization(visualizations);
    }

    /*---------------------------------------------------------*/
    /*------------ JS utilities and enhancements --------------*/
    /*---------------------------------------------------------*/

    const recordCache = (cacheKey, currentCache, cacheKeyMaker, keepEmpty) => {
        const entries = collectShaderEntries();

        if (cacheKey === '_layers.namedCache') {
            currentCache.__version = 2;
            currentCache.byId = {};
            currentCache.byPath = {};
            currentCache.byName = {};
            currentCache.entries = [];
        } else if (cacheKey === '_layers.orderedCache') {
            currentCache.__version = 2;
            currentCache.byOrder = {};
            currentCache.byPath = {};
            currentCache.entries = [];
        }

        entries.forEach((entry, index) => {
            const config = entry.config || {};
            const cache = buildSnapshotPayload(config, entry.shader);
            if (!keepEmpty && Object.keys(cache).length < 1) {
                return;
            }

            const primaryKey = cacheKeyMaker(config, index, entry);
            if (cacheKey === '_layers.namedCache') {
                if (config.id) {
                    currentCache.byId[config.id] = cache;
                }
                currentCache.byPath[entry.pathString] = cache;
                if (config.name) {
                    currentCache.byName[config.name] = currentCache.byName[config.name] || [];
                    currentCache.byName[config.name].push({
                        id: config.id,
                        path: entry.pathString,
                        cache
                    });
                }
                currentCache.entries.push({
                    key: primaryKey,
                    id: config.id,
                    name: config.name,
                    path: entry.pathString,
                    cache
                });
            } else {
                currentCache.byOrder[String(index)] = cache;
                currentCache.byPath[entry.pathString] = cache;
                currentCache.entries.push({
                    key: primaryKey,
                    id: config.id,
                    name: config.name,
                    path: entry.pathString,
                    cache
                });
            }
        });

        APPLICATION_CONTEXT.AppCache.set(cacheKey, JSON.stringify(currentCache));
    };

    /**
     * Set visualization parameters cache
     * @param {boolean} named cache by layer name if true, position if false
     */
    UTILITIES.storeVisualizationSnapshot = function (named = true) {
        if (named) recordCache('_layers.namedCache', namedShaderCache, (shader, i) => shader.name, false);
        else recordCache('_layers.orderedCache', orderedShaderCache, (shader, i) => i, true);
        Dialogs.show($.t('messages.paramConfSaved'), 5000, Dialogs.MSG_INFO);
    };

    /**
     * Apply stored visualization parameters cache, best used before overrideConfigureAll().
     * Must rebuild the renderer otherwise.
     * @param shaderConfigMap
     */
    UTILITIES.applyStoredVisualizationSnapshot = function (shaderConfigMap) {
        const smartNamedCache = ensureSmartNamedStore(namedShaderCache);
        const smartOrderedCache = ensureOrderedStore(orderedShaderCache);

        let sid = 0;
        forEachShaderConfig(shaderConfigMap, (config, shaderId, path) => {
            const pathString = path.join("/");
            const namedById = config.id ? smartNamedCache.byId[config.id] : undefined;
            const namedByPath = smartNamedCache.byPath[pathString];
            const namedCandidates = config.name ? (smartNamedCache.byName[config.name] || []) : [];

            let namedSnapshot = splitSnapshotPayload(namedById || namedByPath);
            let cacheApplied;

            if (Object.keys(namedSnapshot.cache).length > 0 || Object.keys(namedSnapshot.state).length > 0) {
                cacheApplied = namedById ? "id" : "path";
            } else if (namedCandidates.length > 0) {
                const exactMatch = namedCandidates.find(entry => entry.path === pathString || entry.id === config.id);
                const fallback = exactMatch || namedCandidates[0];
                namedSnapshot = splitSnapshotPayload(fallback?.cache);
                if (Object.keys(namedSnapshot.cache).length > 0 || Object.keys(namedSnapshot.state).length > 0) {
                    cacheApplied = exactMatch ? "name+path" : "name";
                }
            }

            if (Object.keys(namedSnapshot.cache).length > 0 || Object.keys(namedSnapshot.state).length > 0) {
                config.cache = namedSnapshot.cache;
                applySnapshotState(config, namedSnapshot.state);
                config._cacheApplied = cacheApplied;
            } else {
                // Local-snapshot store (browser AppCache) is an explicit user override
                // that wins over cfg cache. cfg.cache itself is the session-persistence
                // channel populated by the renderer/shaders and round-tripped via
                // serialize/deserialize. Only override when the local store actually
                // has something — otherwise leave cfg cache alone so URL/file imports
                // are not wiped on cold load.
                const orderedSnapshot = splitSnapshotPayload(
                    smartOrderedCache.byPath[pathString] || smartOrderedCache.byOrder[String(sid)]
                );
                if (Object.keys(orderedSnapshot.cache).length > 0 || Object.keys(orderedSnapshot.state).length > 0) {
                    config.cache = orderedSnapshot.cache;
                    applySnapshotState(config, orderedSnapshot.state);
                    config._cacheApplied = smartOrderedCache.byPath[pathString] ? "order+path" : "order";
                }
            }

            sid++;
        });
    };

    function jsonClone(value) {
        try {
            return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        } catch (e) {
            return {};
        }
    }

    /**
     * Capture a viewer's live visualization state for cross-peer broadcast.
     * Shape contract documented in src/SESSION.md and consumed by
     * src/classes/session/providers/visualization.ts.
     */
    UTILITIES.exportLiveVisualization = function (viewer) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer) return null;

        const layers = {};
        for (const entry of collectShaderEntries(viewer)) {
            const config = entry.config || {};
            layers[entry.pathString] = {
                id: config.id,
                type: typeof config.type === "string" ? config.type : "",
                cache: jsonClone(isObject(config.cache) ? config.cache : {}) || {},
                state: extractShaderState(config),
            };
        }

        let layerOrder;
        if (typeof renderer.getShaderLayerOrder === "function") {
            const order = renderer.getShaderLayerOrder();
            if (Array.isArray(order)) layerOrder = order.slice();
        }
        if (!Array.isArray(layerOrder)) layerOrder = Object.keys(layers);

        return { layerOrder, layers };
    };

    /**
     * Apply an exported live visualization payload onto the local renderer.
     * Mutates per-layer config in place via public renderer accessors, then
     * triggers a single drawer rebuild.
     *
     * The session provider sets `viewer.__sessionApplyingRemote = true` for
     * the duration of this call so `_emitShaderConfigUpdate` skips re-emitting
     * the changes back to peers (echo suppression). See
     * src/classes/session/providers/visualization.ts.
     *
     * Returns true if any layer was mutated.
     */
    UTILITIES.importLiveVisualization = function (viewer, payload) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer || !isObject(payload)) return false;

        const incomingLayers = isObject(payload.layers) ? payload.layers : {};
        const navDrawer = viewer.navigator?.drawer;
        let mutated = false;

        for (const pathString of Object.keys(incomingLayers)) {
            const incoming = incomingLayers[pathString];
            if (!isObject(incoming)) continue;

            const config = typeof renderer.getShaderLayerConfig === "function"
                ? renderer.getShaderLayerConfig(pathString)
                : null;
            if (!config) {
                console.warn(`[layers] importLiveVisualization: missing local config for "${pathString}"`);
                continue;
            }

            const incomingType = typeof incoming.type === "string" ? incoming.type : "";
            if (incomingType && config.type !== incomingType) {
                config.type = incomingType;
                if (navDrawer && typeof navDrawer.getOverriddenShaderConfig === "function") {
                    const navConfig = navDrawer.getOverriddenShaderConfig(pathString);
                    if (navConfig) navConfig.type = incomingType;
                }
            }

            config.cache = jsonClone(isObject(incoming.cache) ? incoming.cache : {}) || {};
            applySnapshotState(config, incoming.state);
            config._cacheApplied = "session";
            mutated = true;
        }

        const incomingOrder = Array.isArray(payload.layerOrder) ? payload.layerOrder : null;
        if (incomingOrder && typeof renderer.setShaderLayerOrder === "function") {
            const currentOrder = typeof renderer.getShaderLayerOrder === "function"
                ? renderer.getShaderLayerOrder()
                : null;
            if (!Array.isArray(currentOrder) || currentOrder.join("/") !== incomingOrder.join("/")) {
                try {
                    renderer.setShaderLayerOrder(incomingOrder.slice());
                    mutated = true;
                } catch (e) {
                    console.warn("[layers] importLiveVisualization: setShaderLayerOrder failed:", e);
                }
            }
        }

        if (mutated && viewer.drawer && typeof viewer.drawer.rebuild === "function") {
            try { viewer.drawer.rebuild(0); }
            catch (e) { console.warn("[layers] importLiveVisualization: drawer.rebuild failed:", e); }
        }

        return mutated;
    };

    /**
     * Notify peers that a layer config changed locally. The session
     * visualization provider listens for `shader-config-update` and
     * force-emits a full snapshot on the next microtask. Skips while
     * a remote apply is in progress to suppress echo.
     */
    UTILITIES._emitShaderConfigUpdate = function (viewer, layerId, change) {
        if (!viewer || viewer.__sessionApplyingRemote) return;
        try {
            viewer.raiseEvent("shader-config-update", { viewer, layerId, change });
        } catch (e) {
            console.warn("[shader-config-update] dispatch failed:", e);
        }
    };

    /**
     * @private
     * @param layerId
     */
    UTILITIES.clearShaderCache = function (layerId, viewer = window.VIEWER) {
        const config = viewer.drawer.renderer.getShaderLayerConfig(layerId);
        if (!config) return;
        config.cache = {};
        config._cacheApplied = undefined;
        viewer.drawer.rebuild();
    };

    UTILITIES.changeVisualizationLayer = function (layerId, type, viewer = window.VIEWER) {
        try {
            viewer.drawer.renderer.changeShaderType(layerId, type);
        } catch (e) {
            console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': ${e.message}`);
            return;
        }
        try {
            viewer.navigator?.drawer?.renderer?.changeShaderType?.(layerId, type);
        } catch (e) {
            // navigator may not mirror every layer; non-fatal
        }
        // changeShaderType only rebuilds the WebGL program; idle viewers (e.g. playground)
        // need an explicit repaint so the swap shows immediately.
        viewer.forceRedraw();
        viewer.navigator?.forceRedraw?.();
        UTILITIES._emitShaderConfigUpdate(viewer, layerId, { type });
    };

    /**
     * Enable or disable UI for modes, with the given mode applied (no need to call changeModeOfLayer)
     */
    UTILITIES.shaderPartSetBlendModeUIEnabled = function (layerId, enabled, viewer = window.VIEWER) {
        const maskNode = document.getElementById(`${layerId}-mode-toggle`);
        const mode = enabled ? maskNode.dataset.mode : "show";
        if (!mode || !UTILITIES.changeModeOfLayer(layerId, mode, false, viewer)) {
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
    UTILITIES.changeModeOfLayer = function (layerId, otherMode = "blend", toggle = true, viewer = window.VIEWER) {
        const shader = viewer.drawer.renderer.getShaderLayer(layerId);

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
            viewer.drawer.rebuild(0);
            UTILITIES._emitShaderConfigUpdate(viewer, layerId, { params: { use_mode: applied } });
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
    UTILITIES.setFilterOfLayer = function (layerId, filter, value, viewer = window.VIEWER) {
        const shader = viewer.drawer.renderer.getShaderLayer(layerId);

        if (shader) {
            const shaderConfig = shader.getConfig(layerId);
            shaderConfig.params[filter] = value;
            shader.resetFilters(shaderConfig.params);
            viewer.drawer.rebuild(0);
            UTILITIES._emitShaderConfigUpdate(viewer, layerId, { params: { [filter]: value } });
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
        console.warn("Not implemented!");
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
