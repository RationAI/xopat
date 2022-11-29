(function (window) {
    window.APPLICATION_CONTEXT.disableRendering = function () {
        if (!VIEWER.bridge) return;
        const renderingIndex = VIEWER.bridge.getWorldIndex();
        if (renderingIndex || renderingIndex == 0) {
            VIEWER.bridge.removeLayer(renderingIndex);
        }
        window.APPLICATION_CONTEXT.layersAvailable = false;
    }

    window.APPLICATION_CONTEXT.prepareRendering = function (atStartup=false) {

        //We are active!
        window.APPLICATION_CONTEXT.layersAvailable = true;

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
                    var i = 0;
                    const activeBackgroundSetup = APPLICATION_CONTEXT.config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)],
                        defaultIndex = activeBackgroundSetup?.dataGroupIndex;

                    let select = $("#shaders"),
                        activeIndex = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", Number.isInteger(defaultIndex) ? defaultIndex : 0);
                    seaGL.foreachVisualisation(function (vis) {
                        let selected = i === activeIndex ? "selected" : "";
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
                visualisationInUse: function(visualisation) {
                    enableDragSort("data-layer-options");
                    UTILITIES.updateUIForMissingSources();
                    //called only if everything is fine
                    USER_INTERFACE.Errors.hide(); //preventive

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

                    VIEWER.raiseEvent('visualisation-used', visualisation);
                },
                visualisationChanged: function(oldVis, newVis) {
                    seaGL.createUrlMaker(newVis);
                    let index = seaGL.getWorldIndex(),
                        sources = seaGL.dataImageSources();

                    if (seaGL.disabled()) {
                        seaGL.enable();
                        VIEWER.addTiledImage({
                            tileSource : seaGL.urlMaker(APPLICATION_CONTEXT.layersServer, sources),
                            index: index,
                            opacity: $("#global-opacity input").val(),
                            success: function (e) {
                                if ((!newVis.hasOwnProperty("lossless") || newVis.lossless) && e.item.source.setFormat) {
                                    e.item.source.setFormat("png"); //todo unify tile initialization processing - put it into one function, now present at bottom of index.php and here
                                }
                                seaGL.addLayer(index);
                                seaGL.redraw();
                            }
                        });
                    } else {
                        VIEWER.addTiledImage({
                            tileSource : seaGL.urlMaker(APPLICATION_CONTEXT.layersServer, sources),
                            index: index,
                            opacity: $("#global-opacity input").val(),
                            replace: true,
                            success: function (e) {
                                if ((!newVis.hasOwnProperty("lossless") || newVis.lossless) && e.item.source.setFormat) {
                                    e.item.source.setFormat("png"); //todo unify tile initialization processing - put it into one function, now present at bottom of index.php and here
                                }
                                seaGL.addLayer(index);
                                seaGL.redraw();
                            }
                        });
                    }
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
            //load shaders just once
            webglProcessing.addCustomShaderSources(...APPLICATION_CONTEXT.config.shaderSources);
        }

        let seaGL = VIEWER.bridge;
        seaGL.addVisualisation(...APPLICATION_CONTEXT.config.visualizations);
        seaGL.addData(...APPLICATION_CONTEXT.config.data);
        if (APPLICATION_CONTEXT.getOption("activeVisualizationIndex") > APPLICATION_CONTEXT.config.visualizations) {
            console.warn("Invalid default vis index. Using 0.");
            APPLICATION_CONTEXT.setOption("activeVisualizationIndex", 0);
        }

        seaGL.createUrlMaker = function(vis) {
            seaGL.urlMaker = new Function("path,data", "return " + (vis?.protocol || APPLICATION_CONTEXT.layersProtocol));
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

            // let filterChange = "";
            // if (canChangeFilters) {
            //     canChangeFilters = "<select onchange='UTILITIES.setFilterOfLayer()'>";
            //     for (let f in WebGLModule.VisualisationLayer.filterNames) {
            //         let selected = available.type() === layer.type ? " selected" : "";
            //         canChangeFilters +=  `<option value="${available.type()}"${selected}>${available.name()}</option>`;
            //     }
            // }

            let filterUpdate = [];
            if (!fixed) {
                for (let key in WebGLModule.VisualisationLayer.filters) {
                    let found = layer.params.hasOwnProperty(key);
                    if (found) {
                        filterUpdate.push('<span>', WebGLModule.VisualisationLayer.filterNames[key],
                            ':</span><input type="number" value="', layer._renderContext.getFilterValue(key, layer.params[key]),
                            '" style="width:80px;" onchange="UTILITIES.setFilterOfLayer(\'', dataId,
                            "', '", key, '\', Number.parseFloat(this.value));" class="form-control"><br>');
                    }
                }
            }

            return `<div class="shader-part resizable rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" id="${dataId}-shader-part" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${isVisible ? 'checked' : ''}
${wasErrorWhenLoading ? '' : 'disabled'} onchange="UTILITIES.shaderPartToogleOnOff(this, '${dataId}');">
              &emsp;<span style='width: 210px; vertical-align: bottom;' class="one-liner" title="ID: ${dataId}">${title}</span>
              <div class="d-inline-block label-render-type pointer" style="float: right;">
                  <label for="${dataId}-change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select id="${dataId}-change-render-type" ${fixed ? "disabled" : ""}
onchange="UTILITIES.changeVisualisationLayer(this, '${dataId}')" style="display: none;" class="form-control pointer input-sm">${availableShaders}</select>
                </div>
                ${modeChange}
                <span class="material-icons" style="width: 10%; float: right;">swap_vert</span>
            </div>
            <div class="non-draggable">${html}${filterUpdate.join("")}</div>
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
            const sortableList = document.getElementById(listId);
            Array.prototype.forEach.call(sortableList.children, (item) => {enableDragItem(item)});
        }

        function enableDragItem(item) {
            item.setAttribute('draggable', true);
            item.ondragstart = startDrag;
            item.ondrag = handleDrag;
            item.ondragend = handleDrop;

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
        }

        function startDrag(event) {
            //const currentTarget = event.target;
            let clicked = document.elementFromPoint(event.x, event.y);
            if (isPrevented(clicked, 'non-draggable')) {
                event.preventDefault();
            }
        }

        //modified from https://codepen.io/akorzun/pen/aYwXoR
        const isPrevented = (element, cls) => {
            let currentElem = element;
            let isParent = false;

            while (currentElem) {
                const hasClass = Array.from(currentElem.classList).some(elem => {return cls === elem;});
                if (hasClass) {
                    isParent = true;
                    currentElem = undefined;
                } else {
                    currentElem = currentElem.parentElement;
                }
            }
            return isParent;
        };

        function handleDrag(item) {
            const selectedItem = item.target,
                list = selectedItem.parentNode,
                x = event.clientX,
                y = event.clientY;

            selectedItem.classList.add('drag-sort-active');
            let swapItem = document.elementFromPoint(x, y) === null ? selectedItem : document.elementFromPoint(x, y);

            if (list === swapItem.parentNode) {
                swapItem = swapItem !== selectedItem.nextSibling ? swapItem : swapItem.nextSibling;
                list.insertBefore(selectedItem, swapItem);
            }
        }

        function handleDrop(item) {
            item.target.classList.remove('drag-sort-active');
            const listItems = item.target.parentNode.children;

            var order = [];
            Array.prototype.forEach.call(listItems, function(child) {
                order.push(child.dataset.id);
            });

            seaGL.reorder(order);
        }



        if (firstTimeSetup) {
            VIEWER.addHandler('open-failed', function (e) {
                //todo check whether open failed only during opening, if so this is correct
                //this event handless add:    add-item-failed

                //should work only for rendering layer
                //todo not called probably because it is not on VIEWER called but somewhere else
                if (typeof e.source === 'string') {
                    if (e.source == seaGL.urlMaker(APPLICATION_CONTEXT.layersServer, seaGL.dataImageSources())) {
                        VIEWER.addTiledImage({
                            //todo what if this is the background image? :/
                            tileSource : new EmptyTileSource({
                                height: 512,
                                width: 512,
                                tileSize: 512
                            }),
                            //index: seaGL.getWorldIndex(),
                            opacity: $("#global-opacity input").val(),
                            replace: true,
                            success: function (e) {
                                //seaGL.addLayer(seaGL.getWorldIndex());
                                //seaGL.initAfterOpen();
                            }
                        });
                    }
                } else {
                    //unknown origin, just fail=ignore?
                }
            });
            /*---------------------------------------------------------*/
            /*------------ JS utilities and enhancements --------------*/
            /*---------------------------------------------------------*/

            window.UTILITIES.makeCacheSnapshot = function() {
                if (APPLICATION_CONTEXT.getOption("bypassCookies")) {
                    Dialogs.show($.t('messages.cookiesDisabled'), 5000, Dialogs.MSG_WARN);
                    return;
                }

                let active = seaGL.visualization().shaders;
                const shaderCache = {};
                for (let key in active) {
                    if (active.hasOwnProperty(key)) {
                        let shaderSettings = active[key];
                        shaderCache[shaderSettings.name] = shaderSettings.cache;
                    }
                }
                APPLICATION_CONTEXT._setCookie('_cache', JSON.stringify(shaderCache));
                Dialogs.show($.t('messages.cookieConfSaved'), 5000, Dialogs.MSG_INFO);
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

            function setNewDataGroup(index) {
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", index);
                seaGL.switchVisualisation(index);
            }

            shadersMenu.addEventListener("change", function () {
                setNewDataGroup(Number.parseInt(this.value));
            });

            VIEWER.addHandler('background-image-swap', function (e) {
                e.prevBackgroundSetup.dataGroupIndex = webglProcessing.currentVisualisationIndex();

                if (Number.isInteger(e.backgroundSetup.dataGroupIndex)) {
                    const selectNode = $("#shaders");
                    let active = Number.parseInt(selectNode.val());
                    if (active !== e.backgroundSetup.dataGroupIndex) {
                        selectNode.val(String(e.backgroundSetup.dataGroupIndex));
                        setNewDataGroup(e.backgroundSetup.dataGroupIndex);
                    }
                } else {
                    e.backgroundSetup.dataGroupIndex = webglProcessing.currentVisualisationIndex();
                }
            });

            UTILITIES.shaderPartToogleOnOff = function(self, layerId) {
                if (self.checked) {
                    seaGL.visualization().shaders[layerId].visible = true;
                    self.parentNode.parentNode.classList.remove("shader-part-error");
                } else {
                    seaGL.visualization().shaders[layerId].visible = false;
                    self.parentNode.parentNode.classList.add("shader-part-error");
                }
                seaGL.reorder(null);
            };

            UTILITIES.changeVisualisationLayer = function(self, layerId) {
                let _this = $(self),
                    type = _this.val();
                let factoryClass = WebGLModule.ShaderMediator.getClass(type);
                if (factoryClass !== undefined) {
                    let viz = seaGL.visualization();
                    self.dataset.title = factoryClass.name();
                    if (viz.shaders.hasOwnProperty(layerId)) {
                        let shaderPart = viz.shaders[layerId];

                        //preserve parameters for the original type
                        shaderPart[`__${shaderPart.type}_params`] = shaderPart.params;
                        if (!shaderPart.hasOwnProperty(`__${type}_params`)) {
                            shaderPart[`__${type}_params`] = {};
                        }
                        shaderPart.params = shaderPart[`__${type}_params`];

                        viz.shaders[layerId].type = type;
                        seaGL.reorder(null); //force to re-build
                    } else {
                        console.error(`UTILITIES::changeVisualisationLayer Invalid layer id '${layerId}': bad initialization?`);
                    }
                } else {
                    console.error(`UTILITIES::changeVisualisationLayer Invalid layer id '${layerId}': unknown type!`);
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

            UTILITIES.updateUIForMissingSources = function () {
                let layers = seaGL.visualization().shaders;
                let sources = webglProcessing.getSources();
                let allSources = APPLICATION_CONTEXT.config.data;
                let tiledImage = seaGL.getTiledImage();
                if (!tiledImage) {
                    console.error("Could not determine TiledImage item that is bound to the bridge.");
                    return;
                }

                if (typeof tiledImage.source.getImageMetaAt !== 'function') {
                    console.warn('OpenSeadragon TileSource for the visualization layers is missing getImageMetaAt() function.',
                        'The visualization is unable to inspect problems with data sources.');
                    return;
                }

                for (let key in layers) {
                    if (!layers.hasOwnProperty(key)) continue;

                    let errorMessage;

                    //todo check this attr existnce and invalidate layer if missing
                    for (let imgSource of layers[key].dataReferences) {
                        let idx = sources.findIndex(s => s === allSources[imgSource]);
                        if (idx !== -1
                            && (errorMessage = tiledImage.source.getImageMetaAt(idx))
                            && (errorMessage = errorMessage.error)) {

                            let node = $(`#${key}-shader-part`);
                            node.prepend(`<div class="p2 error-container rounded-2">Possibly faulty layer.<code>${errorMessage}</code></div>`);
                            break;
                        }
                    }
                }
            };
        }
    }
})(window);
