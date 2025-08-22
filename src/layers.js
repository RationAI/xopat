function initXopatLayers() {
    /**
     * Disables Visualization Rendering (the data group)
     */
    window.APPLICATION_CONTEXT.disableVisualization = function () {
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
    let initialized = false;

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

        // seaGL.addVisualization(...visualizations);
        // seaGL.setData(...APPLICATION_CONTEXT.config.data);
        if (APPLICATION_CONTEXT.getOption("activeVisualizationIndex") > visualizations.length) {
            console.warn("Invalid default vis index. Using 0.");
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", 0);
        }

        VIEWER.drawer.renderer.createUrlMaker = function(vis, isSecureMode) {
            if (isSecureMode && vis) delete vis.protocol;
            VIEWER.drawer.renderer.urlMaker = new Function("path,data", "return " + (vis?.protocol || APPLICATION_CONTEXT.env.client.data_group_protocol));
            return VIEWER.drawer.renderer.urlMaker;
        };

        if (initialized) return;
        initialized = true;

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
                    const currentMask = VIEWER.drawer.getOverriddenShaderConfig(id)?.params.use_mode;
                    const clipSelected = currentMask === "clip";
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
                            const newMode = selected ? "blend" : "clip";
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
                // todo no change on the navigator...
                VIEWER.drawer.renderer.setShaderLayerOrder(Array.prototype.map.call(listItems, child => child.dataset.id));
                VIEWER.drawer.rebuild();
            })
        }

        // TODO just drawer?
        VIEWER.drawer.renderer.addHandler('html-controls-created', e => {
            enableDragSort("data-layer-options");
            UTILITIES.updateUIForMissingSources();

            /**
             * Fired when visualization goal is set up and run, but before first rendering occurs.
             * @property visualization visualization configuration used
             * @memberOf VIEWER
             * @event visualization-used
             */
            VIEWER.raiseEvent('visualization-used', e);
        });

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
                    VIEWER.drawer.renderer.urlMaker(APPLICATION_CONTEXT.env.client.data_group_server, s)));
            }

            //todo get rid of?
            image.source.greyscale = APPLICATION_CONTEXT.getOption("grayscale") ? "/greyscale" : "";
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

            let shader = VIEWER.drawer.renderer.getShaderLayerConfig(layerId);
            if (shader) {
                if (self.checked) {
                    shader.visible = true;
                    self.parentNode.parentNode.classList.remove("shader-part-error");
                } else {
                    shader.visible = false;
                    self.parentNode.parentNode.classList.add("shader-part-error");
                }

                VIEWER.drawer.rebuild(0);
                VIEWER.navigator.drawer.rebuild(0);
            } else {
                console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${layerId}': bad initialization?`);
            }
        };

        UTILITIES.changeVisualizationLayer = function(self, layerId) {
            let _this = $(self),
                type = _this.val();
            let factoryClass = OpenSeadragon.FlexRenderer.ShaderMediator.getClass(type);
            if (factoryClass !== undefined) {

                // todo sync config somehow
                self.dataset.title = factoryClass.name();

                let shader = VIEWER.drawer.renderer.getShaderLayerConfig(layerId);
                if (shader) {
                    shader.type = type;
                    //todo make it part of api
                    VIEWER.drawer.rebuild(0);

                    shader = VIEWER.navigator.drawer.getOverriddenShaderConfig(layerId);
                    shader.type = type;
                    VIEWER.navigator.drawer.rebuild(0);
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
         * @param otherMode other toggle mode, default "blend"
         * @param toggle if false, just update the current mode
         * @return true if successfully performed
         */
        UTILITIES.changeModeOfLayer = function(layerId, otherMode="blend", toggle=true) {
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
                VIEWER.navigator.drawer.rebuild(0);
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
            let layers = VIEWER.drawer.renderer.getAllShaders();
            let allSources = APPLICATION_CONTEXT.config.data;

            for (let key in layers) {
                if (!layers.hasOwnProperty(key)) continue;

                const shader = layers[key];

                for (let source of shader.getConfig().tiledImages) {
                    const tiledImage = VIEWER.world.getItemAt(source);

                    if (typeof tiledImage?.source.getMetadata !== 'function') {
                        console.info('OpenSeadragon TileSource for the visualization layers is missing getMetadata() function.',
                            'The visualization is unable to inspect problems with data sources.', tiledImage);
                        continue;
                    }

                    const message = tiledImage.source.getMetadata();
                    if (message.error) {
                        let node = $(`#${key}-shader-part`);
                        node.prepend(`<div class="p2 error-container rounded-2">${$.t('main.shaders.faulty')}<code>${message.error}</code></div>`);
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


    /**
     * Test for rendering capabilities
     * Throws error on failure
     * // todo implement
     */
    UTILITIES.testRendering = function(pixelErrThreshold=10) {
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
