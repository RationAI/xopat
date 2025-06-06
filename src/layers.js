function initXopatLayers() {
    /**
     * Disables Visualization Rendering (the data group)
     */
    window.APPLICATION_CONTEXT.disableVisualization = function () {
        if (!VIEWER.bridge) return;
        const renderingIndex = VIEWER.bridge.getWorldIndex();
        if (renderingIndex || renderingIndex == 0) {
            VIEWER.bridge.removeLayer(renderingIndex);
        }
        APPLICATION_CONTEXT.layersAvailable = false;
    }

    function parseStore(key) {
        try {
            return JSON.parse(APPLICATION_CONTEXT.AppCache.get(key, "{}"));
        } catch (e) {
            return {};
        }
    }

    function parseVisualization() {
        function isset(x, type="string") {
            return x && typeof x === type;
        }
        return APPLICATION_CONTEXT.config.visualizations.filter((visualizationTarget, index) => {
            if (!isset(visualizationTarget.name)) {
                visualizationTarget.name = $.t('main.shaders.defaultTitle');
            }
            if (!isset(visualizationTarget.shaders, "object")) {
                console.warn(`Visualization #${index} removed: missing shaders definition.`, visualizationTarget);
                return false;
            }

            let shaderCount = 0, sid = 0, source = $.t("common.Source");
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

                const namedCache = namedCookieCache[layer.name] || {};
                if (Object.keys(namedCache).length > 0) {
                    layer.cache = namedCache;
                    layer._cacheApplied = "name";
                } else {
                    layer.cache = layer.cache || orderedCookieCache[sid++] || {};
                    layer._cacheApplied = Object.keys(layer.cache).length > 0 ? "order" : undefined;
                }
                shaderCount++;
            }
            return shaderCount > 0;
        });
    }

    const namedCookieCache = parseStore('_layers.namedCache');
    const orderedCookieCache = parseStore('_layers.orderedCache');

    /**
     * Initialize Visualization (data group) from APPLICATION_CONTEXT.config setup
     * @return {*}
     */
    window.APPLICATION_CONTEXT.prepareRendering = function () {
        const visualizations = parseVisualization();
        if (visualizations.length <= 0) {
            return APPLICATION_CONTEXT.disableVisualization();
        }

        //We are active!
        APPLICATION_CONTEXT.layersAvailable = true;

        // Wrap WebGL module into bridge interface to bind to OpenSeadragon
        const firstTimeSetup = VIEWER.bridge === undefined;
        let webglProcessing;
        if (!firstTimeSetup) {
            VIEWER.bridge.reset();
            webglProcessing = VIEWER.bridge.webGLEngine;
        } else {
            webglProcessing = new WebGLModule({
                htmlControlsId: "data-layer-options",
                htmlShaderPartHeader: createHTMLLayerControls,
                webGlPreferredVersion: APPLICATION_CONTEXT.getOption("webGlPreferredVersion"),
                debug: window.APPLICATION_CONTEXT.getOption("webglDebugMode"),
                ready: function() {
                    let i = 0;
                    const select = $("#shaders"),
                        activeIndex = APPLICATION_CONTEXT.getOption("activeVisualizationIndex");
                    seaGL.foreachVisualization(function (vis) {
                        let selected = i == activeIndex ? "selected" : "";
                        if (vis.error) {
                            select.append(`<option value="${i}" ${selected} title="${vis.error}">&#9888; ${vis['name']}</option>`);
                        } else {
                            select.append(`<option value="${i}" ${selected}>${vis['name']}</option>`);
                        }
                        i++;
                    });

                    if (window.APPLICATION_CONTEXT.getOption("customBlending")) {
                        let blend = $("#blending-equation");
                        blend.html(`
<span class="blob-code"><span class="blob-code-inner">vec4 blend(vec4 foreground, vec4 background) {</span></span>
<textarea id="custom-blend-equation-code" class="form-control blob-code-inner" style="width: calc(100% - 20px); margin-left: 20px;
display: block; resize: vertical;">//mask:\nreturn background * (1.0 - step(0.001, foreground.a));</textarea>
<span class="blob-code"><span class="blob-code-inner">}</span></span>
<button class="btn" onclick="VIEWER.bridge.webGLEngine.changeBlending($('#custom-blend-equation-code').val()); VIEWER.bridge.redraw();"
style="float: right;"><span class="material-icons pl-0" style="line-height: 11px;">payments</span> ${$.t('main.shaders.setBlending')}</button>`);
                    }
                },
                visualizationInUse: function(visualization) {
                    enableDragSort("data-layer-options");
                    UTILITIES.updateUIForMissingSources();
                    //called only if everything is fine
                    // TODO: consider timeout - this hides any errors although they might be valid
                    //USER_INTERFACE.Errors.hide(); //preventive

                    //Re-fetching data not necessary as we always fetch all the data of given visualization
                    // var activeData = ""; //don't set this globally :(
                    // let data = seaGL.dataImageSources();
                    // if (data !== activeData) {
                    //     activeData = data;
                    //     if (seaGL.getTiledImage()) {
                    //          window.VIEWER.addTiledImage({
                    //             tileSource : iipSrvUrlPOST + seaGL.dataImageSources() + ".dzi",
                    //             index: seaGL.getLayerIdx(),
                    //             opacity: $("#global-opacity input").val(),
                    //             replace: true
                    //         });
                    //     }
                    // }
                    /**
                     * Fired when visualization goal is set up and run, but before first rendering occurs.
                     * @property visualization visualization configuration used
                     * @memberOf VIEWER
                     * @event visualization-used
                     */
                    VIEWER.raiseEvent('visualization-used', visualization);
                },
                visualizationChanged: function(oldVis, newVis) {
                    seaGL.createUrlMaker(newVis, APPLICATION_CONTEXT.secure);
                    let index = seaGL.getWorldIndex(),
                        sources = seaGL.dataImageSources();

                    if (seaGL.disabled()) {
                        seaGL.enable();
                        VIEWER.addTiledImage({
                            tileSource : seaGL.urlMaker(APPLICATION_CONTEXT.env.client.data_group_server, sources),
                            index: index,
                            opacity: $("#global-opacity input").val(),
                            success: function(e) {
                                UTILITIES.prepareTiledImage(index, e.item, newVis);
                                seaGL.addLayer(index);
                                seaGL.redraw();
                            }
                        });
                    } else {
                        VIEWER.addTiledImage({
                            tileSource : seaGL.urlMaker(APPLICATION_CONTEXT.env.client.data_group_server, sources),
                            index: index,
                            opacity: $("#global-opacity input").val(),
                            replace: true,
                            success: function(e) {
                                UTILITIES.prepareTiledImage(index, e.item, newVis);
                                seaGL.addLayer(index);
                                seaGL.redraw();
                            }
                        });
                    }
                },
                resetCallback: function () {
                    /**
                     * Fired when visualization is updated (re-rendered), which might happen quite often.
                     * @memberOf VIEWER
                     * @event visualization-redrawn
                     */
                    VIEWER.raiseEvent('visualization-redrawn');
                },
                //called when this module is unable to run
                onFatalError: function(error) {
                    USER_INTERFACE.Errors.show(error.error, error.desc);
                },

                //called when a problem occurs, but other parts of the system still might work
                onError: function(error) {
                    USER_INTERFACE.Errors.show(error.error, error.desc);
                },
            });
            VIEWER.bridge = new OpenSeadragon.BridgeGL(VIEWER, webglProcessing, APPLICATION_CONTEXT.getOption("tileCache"));
        }

        let seaGL = VIEWER.bridge;
        seaGL.addVisualization(...visualizations);
        seaGL.setData(...APPLICATION_CONTEXT.config.data);
        if (APPLICATION_CONTEXT.getOption("activeVisualizationIndex") > visualizations.length) {
            console.warn("Invalid default vis index. Using 0.");
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", 0);
        }

        seaGL.createUrlMaker = function(vis, isSecureMode) {
            if (isSecureMode && vis) delete vis.protocol;
            seaGL.urlMaker = new Function("path,data", "return " + (vis?.protocol || APPLICATION_CONTEXT.env.client.data_group_protocol));
            return seaGL.urlMaker;
        };

        function createHTMLLayerControls(title, html, dataId, isVisible, layer, wasErrorWhenLoading) {
            let fixed = UTILITIES.isJSONBoolean(layer.fixed, true);
            //let canChangeFilters = layer.hasOwnProperty("toggleFilters") && layer.toggleFilters;

            let style = isVisible ? (layer.params.use_mode === "mask_clip" ? 'style="transform: translateX(10px);"' : "") : `style="filter: brightness(0.5);"`;
            const isModeShow = !layer.params.use_mode || layer.params.use_mode === "show";
            let modeChange = fixed && isModeShow ? "display: none;" : 'display: block;'; //do not show if fixed and show mode
            modeChange = `<span class="material-icons btn-pointer" data-mode="${isModeShow ? "mask" : layer.params.use_mode}"
id="${dataId}-mode-toggle"
 style="width: 10%; float: right; ${modeChange}${isModeShow ? "color: var(--color-icon-tertiary);" : ""}"
onclick="UTILITIES.changeModeOfLayer('${dataId}', this.dataset.mode);" title="${$.t('main.shaders.blendingExplain')}">payments</span>`;

            let availableShaders = "";
            for (let available of WebGLModule.ShaderMediator.availableShaders()) {
                let selected = available.type() === layer.type ? " selected" : "";
                availableShaders += `<option value="${available.type()}"${selected}>${available.name()}</option>`;
            }

            let filterUpdate = [];
            if (!fixed) {
                for (let key in WebGLModule.VisualizationLayer.filters) {
                    let found = layer.params.hasOwnProperty(key);
                    if (found) {
                        filterUpdate.push('<span>', WebGLModule.VisualizationLayer.filterNames[key],
                            ':</span><input type="number" value="', layer._renderContext.getFilterValue(key, layer.params[key]),
                            '" style="width:80px;" onchange="UTILITIES.setFilterOfLayer(\'', dataId,
                            "', '", key, '\', Number.parseFloat(this.value));" class="form-control"><br>');
                    }
                }
            }
            const fullTitle = title.startsWith("Source: ...") ? dataId : title;
            const cacheApplied = layer._cacheApplied ?
                `<div class="p2 info-container rounded-2" style="width: 97%">
${$.t('main.shaders.cache.' + layer._cacheApplied, {action: `UTILITIES.clearShaderCache('${dataId}');`})}</div>` : "";

            return `<div class="shader-part resizable rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" id="${dataId}-shader-part" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${isVisible ? 'checked' : ''}
${wasErrorWhenLoading ? '' : 'disabled'} onchange="UTILITIES.shaderPartToogleOnOff(this, '${dataId}');">
              &emsp;<span style='width: 210px; vertical-align: bottom;' class="one-liner" title="${fullTitle}">${title}</span>
              <div class="d-inline-block label-render-type pointer" style="float: right;">
                  <label for="${dataId}-change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select id="${dataId}-change-render-type" ${fixed ? "disabled" : ""}
onchange="UTILITIES.changeVisualizationLayer(this, '${dataId}')" style="display: none;" class="form-control pointer input-sm">${availableShaders}</select>
                </div>
                ${modeChange}
                <span class="material-icons" style="width: 10%; float: right;">swap_vert</span>
            </div>
            <div class="non-draggable">${html}${filterUpdate.join("")}</div>${cacheApplied}
            </div>`;
        }

        /**
         * Made with love by @fitri
         * This is a component of my ReactJS project https://codepen.io/fitri/full/oWovYj/
         *
         * Shader re-compilation and re-ordering logics
         * Modified by Jiří
         */
        function enableDragSort(listId) {
            UIComponents.Actions.draggable(listId, item => {
                const id = item.dataset.id;
                window.DropDown.bind(item, () => {
                    const currentMask = seaGL.visualization()?.shaders[id]?.params.use_mode;
                    const clipSelected = currentMask === "mask_clip";
                    const maskEnabled = typeof currentMask === "string" && currentMask !== "show";

                    return [{
                        title: $.t('main.shaders.defaultBlending'),
                    }, {
                        title: maskEnabled ? $.t('main.shaders.maskDisable') : $.t('main.shaders.maskEnable'),
                        action: (selected) => UTILITIES.shaderPartSetBlendModeUIEnabled(id, !selected),
                        selected: maskEnabled
                    }, {
                        title: clipSelected ? $.t('main.shaders.clipMaskOff') : $.t('main.shaders.clipMask'),
                        icon: "payments",
                        styles: "padding-right: 5px;",
                        action: (selected) => {
                            const node = document.getElementById(`${id}-mode-toggle`);
                            const newMode = selected ? "mask" : "mask_clip";
                            node.dataset.mode = newMode;
                            if (!maskEnabled) {
                                UTILITIES.shaderPartSetBlendModeUIEnabled(id, true);
                            } else {
                                UTILITIES.changeModeOfLayer(id, newMode, false);
                            }
                        },
                        selected: clipSelected
                    }];
                });
            }, undefined, e => {
                const listItems = e.target.parentNode.children;
                seaGL.reorder(Array.prototype.map.call(listItems, child => child.dataset.id));
            })
        }

        if (firstTimeSetup) {
            /*---------------------------------------------------------*/
            /*------------ JS utilities and enhancements --------------*/
            /*---------------------------------------------------------*/

            const recordCache = (cookieKey, currentCache, cacheKeyMaker, keepEmpty) => {
                const shaderCache = currentCache;
                let index = 0;
                let active = seaGL.visualization().shaders;
                for (let key in active) {
                    if (active.hasOwnProperty(key)) {
                        let shaderSettings = active[key];

                        //filter cache so that only non-empty objects are stored
                        const cache = Object.fromEntries(
                            Object.entries(shaderSettings.cache).filter(([key, val]) => Object.keys(val)?.length > 0)
                        );
                        if (keepEmpty || Object.keys(cache).length > 0) {
                            shaderCache[cacheKeyMaker(shaderSettings, index++)] = cache;
                        }
                    }
                }
                APPLICATION_CONTEXT.AppCache.set(cookieKey, JSON.stringify(shaderCache));
            };

            /**
             * Prepares TiledImage for visualization rendering after it has been instantiated
             * @private
             */
            UTILITIES.prepareTiledImage = function(index, image, visSetup) {
                //todo not flexible, propose format setting in OSD? depends on the protocol

                const async = APPLICATION_CONTEXT.getOption("fetchAsync");
                if (image.source.setFormat) {
                    const preferredFormat = APPLICATION_CONTEXT.getOption("preferredFormat");
                    const lossless = !visSetup.hasOwnProperty("lossless") || visSetup.lossless;
                    const format = lossless ? (async ? "png" : preferredFormat) : (async ? "jpg" : preferredFormat);
                    image.source.setFormat(format);
                }

                if (async && !image.source.multiConfigure) {
                    UTILITIES.multiplexSingleTileSource(image);
                    image.source.multiConfigure(VIEWER.bridge.dataImageSources().map(s =>
                        seaGL.urlMaker(APPLICATION_CONTEXT.env.client.data_group_server, s)));
                }

                //todo get rid of?
                image.source.greyscale = APPLICATION_CONTEXT.getOption("grayscale") ? "/greyscale" : "";
                seaGL.addLayer(index);
            };

            /**
             * Set visualization parameters cache
             * @param {boolean} named cache by layer name if true, position if false
             */
            UTILITIES.makeCacheSnapshot = function(named=true) {
                if (named) recordCache('_layers.namedCache', namedCookieCache, (shader, i) => shader.name, false);
                else recordCache('_layers.orderedCache', orderedCookieCache, (shader, i) => i, true);
                Dialogs.show($.t('messages.paramConfSaved'), 5000, Dialogs.MSG_INFO);
            };

            // load desired shader upon selection
            let shadersMenu = document.getElementById("shaders");
            shadersMenu.addEventListener("mousedown", function(e) {
                if (this.childElementCount < 2) {
                    e.preventDefault();
                    $(this.previousElementSibling).click();
                    return false;
                }
            });

            function setNewDataGroup(index) {
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", index);
                seaGL.switchVisualization(index);
            }

            shadersMenu.addEventListener("change", function() {
                setNewDataGroup(Number.parseInt(this.value));
            });

            VIEWER.addHandler('background-image-swap', function(e) {
                const oldIndex = webglProcessing.currentVisualizationIndex();
                e.prevBackgroundSetup.goalIndex = oldIndex;

                const newIndex = Number.parseInt(e.backgroundSetup.goalIndex);
                if (Number.isInteger(newIndex)) {
                    const selectNode = $("#shaders");
                    if (oldIndex !== newIndex) {
                        selectNode.val(String(newIndex));
                        setNewDataGroup(newIndex);
                    }
                } else {
                    e.backgroundSetup.goalIndex = oldIndex;
                }
            });

            /**
             * @private
             * @param layerId
             */
            UTILITIES.clearShaderCache = function(layerId) {
                const shader = seaGL.visualization().shaders[layerId];
                if (!shader) return;
                shader.cache = {};
                //because webgl ui controls override their params by cache, we need to re-build that shader
                shader.error = "force-rebuild";
                delete shader._cacheApplied;
                seaGL.reorder();
            };

            /**
             * @private
             */
            UTILITIES.shaderPartToogleOnOff = function(self, layerId) {
                if (self.checked) {
                    seaGL.visualization().shaders[layerId].visible = true;
                    self.parentNode.parentNode.classList.remove("shader-part-error");
                } else {
                    seaGL.visualization().shaders[layerId].visible = false;
                    self.parentNode.parentNode.classList.add("shader-part-error");
                }
                seaGL.reorder();
            };

            UTILITIES.changeVisualizationLayer = function(self, layerId) {
                let _this = $(self),
                    type = _this.val();
                let factoryClass = WebGLModule.ShaderMediator.getClass(type);
                if (factoryClass !== undefined) {
                    let viz = seaGL.visualization();
                    self.dataset.title = factoryClass.name();
                    if (viz.shaders.hasOwnProperty(layerId)) {
                        let shaderPart = viz.shaders[layerId];

                        // //parameter switching does not have to be done anymore - the routine can type-safe reuse params
                        // shaderPart[`__${shaderPart.type}_params`] = shaderPart.params;
                        // if (!shaderPart.hasOwnProperty(`__${type}_params`)) {
                        //     shaderPart[`__${type}_params`] = {};
                        // }
                        // shaderPart.params = shaderPart[`__${type}_params`];

                        shaderPart.type = type;
                        seaGL.reorder(null); //force to re-build
                    } else {
                        console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': bad initialization?`);
                    }
                } else {
                    console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': unknown type!`);
                }
                _this.html("");
            };

            /**
             * Enable or disable UI for modes, with the given mode applied (no need to call changeModeOfLayer)
             */
            UTILITIES.shaderPartSetBlendModeUIEnabled = function(layerId, enabled) {
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
             * @param otherMode other toggle mode, default "mask"
             * @param toggle if false, just update the current mode
             * @return true if successfully performed
             */
            UTILITIES.changeModeOfLayer = function(layerId, otherMode="mask", toggle=true) {
                let viz = seaGL.visualization();
                if (viz.shaders.hasOwnProperty(layerId)) {
                    const layer = viz.shaders[layerId],
                        mode = layer.params.use_mode;

                    let didRenderAsMask = typeof mode === "string" && mode !== "show";
                    if (toggle) {
                        layer.params.use_mode = didRenderAsMask ? "show" : otherMode;
                    } else {
                        //if no need for change, return
                        if ((!didRenderAsMask && otherMode === "show") || otherMode === mode) return true;
                        layer.params.use_mode = otherMode; //re-render, there are multiple modes to choose from
                    }
                    layer.error = "force_rebuild"; //error will force reset
                    seaGL.reorder(null);
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
            UTILITIES.setFilterOfLayer = function(layerId, filter, value) {
                let viz = seaGL.visualization();
                if (viz.shaders.hasOwnProperty(layerId)) {
                    //store to the configuration
                    viz.shaders[layerId]._renderContext.setFilterValue(filter, value);
                    viz.shaders[layerId]._renderContext.resetFilters(viz.shaders[layerId].params);
                    seaGL.reorder(null); //force to re-build
                } else {
                    console.error("Invalid layer: bad initialization?");
                }
            };

            /**
             * @private
             */
            UTILITIES.updateUIForMissingSources = function() {
                let layers = seaGL.visualization().shaders;
                let sources = webglProcessing.getSources();
                let allSources = APPLICATION_CONTEXT.config.data;
                let tiledImage = seaGL.getTiledImage();
                if (!tiledImage) {
                    console.error("Could not determine TiledImage item that is bound to the bridge.");
                    return;
                }

                if (typeof tiledImage.source.getImageMetaAt !== 'function') {
                    console.info('OpenSeadragon TileSource for the visualization layers is missing getImageMetaAt() function.',
                        'The visualization is unable to inspect problems with data sources.');
                    return;
                }

                for (let key in layers) {
                    if (!layers.hasOwnProperty(key)) continue;

                    let errorMessage;
                    for (let imgSource of layers[key].dataReferences) {
                        let idx = sources.findIndex(s => s === allSources[imgSource]);
                        if (idx !== -1
                            && (errorMessage = tiledImage.source.getImageMetaAt(idx))
                            && (errorMessage = errorMessage.error)) {

                            let node = $(`#${key}-shader-part`);
                            node.prepend(`<div class="p2 error-container rounded-2">${$.t('main.shaders.faulty')}<code>${errorMessage}</code></div>`);
                            break;
                        }
                    }
                }
            };

            /**
             * Generic Multiplexing for TileSources
             * allows to use built-in protocols as multi tile sources for visualization viewing.
             * The image exchange must be in images - the tile response is interpreted as an Image object
             * @param {OpenSeadragon.TiledImage} image
             *
             * @example
             *   //ENV configuration
             *   ...
             *   "client": {
             *     "[...]": {
             *       ...
             *       "data_group_protocol": "`${path}?Deepzoom=${data}.dzi`"
             *     }
             *   },
             *   "setup": {
             *     "fetchAsync": true
             *   },
             *   ...
             */
            UTILITIES.multiplexSingleTileSource = function(image) {
                const source = image.source,
                    isHash = image.splitHashDataForPost;

                //a bit dirty but enables use of async requests
                source.__cached_getTilePostData = source.getTilePostData;
                source.getTilePostData = function(level, x, y) {
                    return [level, x, y];
                }

                source.configureItem = source.configureItem || function(data, url, postData, options) {
                    console.warn("The Tile Source has been automatically multiplexed to support async requests.", "Url", url);
                    console.info(`You can adjust the $TileSourceImplementation::configureItem function, we now assume all tiles just share the same metadata (e.g. maxLevel).`);
                    console.info(`The function is the same as configure() method except it has fourth argument 'options' that is the outcome of 'configure', it's called for each item, multiple times (similar to iterator).`);
                    //no-op
                    return options;
                }

                source.multiConfigure = source.multiConfigure || function(dataList) {
                    let blackImage = (context, resolve, reject) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = context.getTileWidth();
                        canvas.height = context.getTileHeight();
                        const ctx = canvas.getContext('2d');
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        const img = new Image(canvas.width, canvas.height);
                        img.onload = () => {
                            //next promise just returns the created object
                            blackImage = (context, ready, _) => ready(img);
                            resolve(img);
                        };
                        img.onerror = img.onabort = reject;
                        img.src = canvas.toDataURL();
                    };

                    source._childSources = [];
                    for (let index in dataList) {
                        let url = dataList[index], postData;
                        if (isHash) {
                            var hashIdx = url.indexOf("#");
                            if (hashIdx !== -1) {
                                postData = url.substring(hashIdx + 1);
                                url = url.substr(0, hashIdx);
                            }
                        }
                        if( url.match(/\.js$/) ){
                            const callbackName = url.split('/').pop().replace('.js', '');
                            OpenSeadragon.jsonp({
                                url: url,
                                async: false,
                                callbackName: callbackName,
                                callback: callback
                            });
                        } else {
                            // request info via xhr asynchronously.
                            OpenSeadragon.makeAjaxRequest( {
                                url: url,
                                postData: postData,
                                withCredentials: this.ajaxWithCredentials,
                                headers: this.ajaxHeaders,
                                success: function( xhr ) {
                                    var responseText = xhr.responseText,
                                        status       = xhr.status,
                                        statusText,
                                        data;

                                    if ( !xhr ) {
                                        throw new Error( OpenSeadragon.getString( "Errors.Security" ) );
                                    } else if ( xhr.status !== 200 && xhr.status !== 0 ) {
                                        status     = xhr.status;
                                        statusText = ( status === 404 ) ?
                                            "Not Found" :
                                            xhr.statusText;
                                        throw new Error( OpenSeadragon.getString( "Errors.Status", status, statusText ) );
                                    }

                                    if( responseText.match(/\s*<.*/) ){
                                        try{
                                            data = ( xhr.responseXML && xhr.responseXML.documentElement ) ?
                                                xhr.responseXML :
                                                OpenSeadragon.parseXml( responseText );
                                        } catch(e) {
                                            data = xhr.responseText;
                                        }
                                    }else if( responseText.match(/\s*[{[].*/) ){
                                        try {
                                            data = OpenSeadragon.parseJSON(responseText);
                                        } catch (e) {
                                            data =  responseText;
                                        }
                                    } else data = responseText;
                                    if ( typeof (data) === "string" ) {
                                        data = OpenSeadragon.parseXml( data );
                                    }
                                    const $TileSource = source.constructor;
                                    const options = $TileSource.prototype.configure.apply( image, [ data, url, postData ]);
                                    const newOpts = source.configureItem(data, url, postData, options);
                                    source._childSources[index] = new $TileSource( newOpts || options );
                                },
                                error: function( xhr, exc ) {
                                    source._childSources[index] = null;
                                    console.warn();
                                }
                            });
                        }

                    }

                    //see https://stackoverflow.com/questions/41996814/how-to-abort-a-fetch-request
                    function afetch(input, init) {
                        let controller = new AbortController();
                        let signal = controller.signal;
                        init = Object.assign({signal}, init);
                        let promise = fetch(input, init);
                        promise.controller = controller;
                        return promise;
                    }

                    source.downloadTileStart = function(imageJob) {

                        let items = this._childSources.length,
                            count = items,
                            errors = 0;
                        const context = imageJob.userData,
                            finish = (error) => {
                                if (error) {
                                    imageJob.finish(null, context.promise, error);
                                    return;
                                }
                                count--;
                                if (count < 1) {
                                    if (context.images.length < 1) context.images = null;
                                    if (errors >= items) {
                                        imageJob.finish(null, context.promise, "All images failed to load!");
                                    } else {
                                        imageJob.finish(context.images, context.promise);
                                    }
                                }
                            },
                            fallBack = (i) => {
                                errors++;
                                return blackImage(
                                    source, //todo use this?
                                    (image) => {
                                        context.images[i] = image;
                                        finish();
                                    },
                                    () => finish("Failed to create black image!")
                                );
                            };


                        const coords = imageJob.postData,
                            success = finish.bind(this, null);

                        //todo let the child decide how to aggregate results, now it works for all images only
                        if (imageJob.loadWithAjax) {
                            context.images = new Array(count);
                            for (let i = 0; i < count; i++) {
                                const img = new Image();
                                img.onerror = img.onabort = fallBack.bind(this, i);
                                img.onload = success;
                                context.images[i] = img;
                            }

                            context.promises = this._childSources.map((child, i) => {
                                //re-contruct the data
                                let furl = child?.getTileUrl(coords[0], coords[1], coords[2]),
                                    postData = child?.getTilePostData(coords[0], coords[1], coords[2]);

                                return afetch(furl, {
                                    method: postData ? "POST" : "GET",
                                    mode: 'cors',
                                    cache: 'no-cache',
                                    credentials: 'same-origin',
                                    headers: imageJob.ajaxHeaders || {},
                                    body: postData
                                }).then(data => data.blob()).then(blob => {
                                    if (imageJob.userData.didAbort) throw "Aborted!";
                                    //todo revoke not called! implement with v5 in OSD destructors
                                    context.images[i].src = URL.createObjectURL(blob);
                                }).catch((e) => {
                                    console.log(e);
                                    fallBack(i);
                                });
                            });

                        } else {
                            context.images = new Array(count);
                            for (let i = 0; i < count; i++) {
                                const img = new Image();
                                img.onerror = img.onabort = fallBack.bind(this, i);
                                img.onload = finish;
                                context.images[i] = img;

                                if (imageJob.crossOriginPolicy !== false) {
                                    img.crossOrigin = imageJob.crossOriginPolicy;
                                }
                                img.src = this._childSources[i]?.getTileUrl(coords[0], coords[1], coords[2]);
                            }
                        }
                    }
                    source.downloadTileAbort = function(imageJob) {
                        //todo images
                        if (imageJob.loadWithAjax) {
                            imageJob.userData.didAbort = true;
                            imageJob.userData.promises?.forEach(p => p.controller.abort());
                        }
                    }
                }
            }
        }
    }

    /**
     * Test for rendering capabilities
     * Throws error on failure
     */
    UTILITIES.testRendering = function(pixelErrThreshold=10) {
        //test 4X4 with heatmap shader
        const webglModuleTest = new WebGLModule({
            webGlPreferredVersion: APPLICATION_CONTEXT.getOption("webGlPreferredVersion"),
            onFatalError: error => {throw error},
            onError: error => {throw error},
            debug: window.APPLICATION_CONTEXT.getOption("webglDebugMode"),
            uniqueId: "browser_render_test"
        });
        //tests #43ff64 --> [67, 255, 100]
        webglModuleTest.addVisualization({name: "Test", shaders: {
            test: {
                type: "heatmap",
                params: {color: "#43ff64", threshold: 0, inverse: false, opacity: 1},
                dataReferences: [0]
            }
        }});
        webglModuleTest.prepareAndInit(null, 2, 2);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = canvas.height = 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0)"; ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = "rgba(255, 80, 125, 255)"; ctx.fillRect(1, 0, 1, 1);
        ctx.fillStyle = "rgba(32, 0, 32, 128)"; ctx.fillRect(0, 1, 1, 1);
        ctx.fillStyle = "rgba(80, 80, 90, 120)"; ctx.fillRect(1, 1, 1, 1);

        // Render a webGL canvas to an input canvas using cached version
        const output = webglModuleTest.processImage(canvas, {width: 2, height: 2},1, 1);
        if (!output) throw "Failed to process WebGL output: null returned.";
        ctx.drawImage(output, 0, 0, 2, 2);
        const data = ctx.getImageData(0, 0, 2, 2).data;
        const testPixel = (pixelPosition, expectedRGBA) => {
            let index = pixelPosition*4;
            for (let i = 0; i < 4; i++) {
                const d = Math.abs(data[index+i] - expectedRGBA[i]);
                if (d > pixelErrThreshold) {
                    const description = `PIXEL[${(pixelPosition)%2}, ${Math.floor(pixelPosition/2)}] expected [${expectedRGBA}], got [${data.slice(index, index+4)}]`;
                    if (d > 2*pixelErrThreshold) throw "Heatmap shader does not work as intended! " + description;
                    console.warn("WebGL Test shows minor color error in the output - this might be caused by interpolation.");
                }
            }
        }
        // Remove subsequent tests
        UTILITIES.testRendering = function () {};
        console.log("Rendering test output:", data, "pixel", OpenSeadragon.pixelDensityRatio);
        // Test pixels [0, 0], [1, 0], [0, 1], [1, 1]
        testPixel(0, [0, 0, 0, 0]); // R0 -> alpha 0, output zeroed out (no-op)
        testPixel(1, [67, 255, 100, 255]); // R255 -> alpha 0

        // TODO: for some reason test returns modified colors for alpha != 255
        //testPixel(2, [67, 255, 100, 32]); // R32 -> alpha 32
        //testPixel(3, [67, 255, 100, 80]); // R80 -> alpha 80
    }
}
