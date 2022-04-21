<?php
/*---------------------------------------------------------*/
/*------------ DIALOGS ------------------------------------*/
/*--All PHP variables are inherited from index.php---------*/
/*---------------------------------------------------------*/
?>
<script type="text/javascript">
(function (window) {
    //We are active!
    window.APPLICATION_CONTEXT.layersAvailable = true;

    let webglProcessing = new WebGLModule({
        htmlControlsId: "data-layer-options",
        htmlShaderPartHeader: createHTMLLayerControls,
        debug: window.APPLICATION_CONTEXT.getOption("webglDebugMode"),
        ready: function() {
            var i = 0;
            let select = $("#shaders"),
                activeIndex = APPLICATION_CONTEXT.getOption("activeVisualizationIndex");
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
style="float: right;"><span class="material-icons pl-0" style="line-height: 11px;">payments</span> Set blending</button>`);
            }
        },
        visualisationInUse: function(visualisation) {
            enableDragSort("data-layer-options");
            APPLICATION_CONTEXT.UTILITIES.updateUIForMissingSources();
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
            //             opacity: $("#global-opacity").val(),
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
                    tileSource : seaGL.urlMaker('<?php echo LAYERS_TILE_SERVER ?>', sources),
                    index: index,
                    opacity: $("#global-opacity").val(),
                    success: function (e) {
                        if (!newVis.hasOwnProperty("lossless") || newVis.lossless &&  e.item.source.setFormat) {
                            e.item.source.setFormat("png"); //todo unify tile initialization processing - put it into one function, now present at bottom of index.php and here
                        }
                        seaGL.addLayer(index);
                        seaGL.redraw();
                    }
                });
            } else {
                window.VIEWER.addTiledImage({
                    tileSource : seaGL.urlMaker('<?php echo LAYERS_TILE_SERVER ?>', sources),
                    index: index,
                    opacity: $("#global-opacity").val(),
                    replace: true,
                    success: function (e) {
                        if (!newVis.hasOwnProperty("lossless") || newVis.lossless &&  e.item.source.setFormat) {
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

    // Wrap WebGL module into bridge interface to bind to OpenSeadragon
    let seaGL = new OpenSeadragon.BridgeGL(VIEWER, webglProcessing);

    VIEWER.bridge = seaGL;
    seaGL.addVisualisation(...APPLICATION_CONTEXT.setup.visualizations);
    seaGL.addData(...APPLICATION_CONTEXT.setup.data);
    webglProcessing.addCustomShaderSources(...APPLICATION_CONTEXT.setup.shaderSources);
    if (APPLICATION_CONTEXT.getOption("activeVisualizationIndex") > APPLICATION_CONTEXT.setup.visualizations) {
        console.warn("Invalid default vis index. Using 0.");
        APPLICATION_CONTEXT.setOption("activeVisualizationIndex", 0);
    }

    seaGL.createUrlMaker = function(vis) {
        seaGL.urlMaker = new Function("path,data", "return " + (vis.protocol || "<?php echo $protoLayers?>"));
        return seaGL.urlMaker;
    };

    /*---------------------------------------------------------*/
    /*------------ JS utilities and enhancements --------------*/
    /*---------------------------------------------------------*/

    window.APPLICATION_CONTEXT.UTILITIES.makeCacheSnapshot = function() {
        if (APPLICATION_CONTEXT.getOption("bypassCookies")) {
            Dialogs.show("Cookies are disabled. You can change this option in 'Settings'.", 5000, Dialogs.MSG_WARN);
            return;
        }

        let active = seaGL.currentVisualisation().shaders;
        for (let key in active) {
            if (active.hasOwnProperty(key)) {
                let shaderSettings = active[key];
                APPLICATION_CONTEXT.shadersCache[shaderSettings.name] = shaderSettings.cache;
            }
        }
        document.cookie = `_cache=${JSON.stringify(APPLICATION_CONTEXT.shadersCache)}; <?php echo JS_COOKIE_SETUP ?>`;
        Dialogs.show("Modifications in parameters saved.", 5000, Dialogs.MSG_INFO);
    };

    // load desired shader upon selection
    $("#shaders").on("change", function () {
        let active =  Number.parseInt(this.value);
        APPLICATION_CONTEXT.setOption("activeVisualizationIndex", active);
        seaGL.switchVisualisation(active);
    });

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

    APPLICATION_CONTEXT.UTILITIES.shaderPartToogleOnOff = function(self, layerId) {
        if (self.checked) {
            seaGL.currentVisualisation().shaders[layerId].visible = 1;
            self.parentNode.parentNode.classList.remove("shader-part-error");
        } else {
            seaGL.currentVisualisation().shaders[layerId].visible = 0;
            self.parentNode.parentNode.classList.add("shader-part-error");
        }
        seaGL.reorder(null);
    };

    APPLICATION_CONTEXT.UTILITIES.changeVisualisationLayer = function(self, layerId) {
        let _this = $(self),
            type = _this.val();
        let factoryClass = WebGLModule.ShaderMediator.getClass(type);
        if (factoryClass !== undefined) {
            let viz = seaGL.currentVisualisation();
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
                console.error("Invalid layer: bad initialization?");
            }
        } else {
            console.error("Invalid shader: unknown type!");
        }
        _this.html("");
    };

    APPLICATION_CONTEXT.UTILITIES.changeModeOfLayer = function(layerId) {
        let viz = seaGL.currentVisualisation();
        if (viz.shaders.hasOwnProperty(layerId)) {
            let useMask = viz.shaders[layerId].params.use_mode === "mask";
            viz.shaders[layerId].params.use_mode = useMask ? "show" : "mask";
            viz.shaders[layerId].error = "force_rebuild"; //error will force reset
            seaGL.reorder(null); //force to re-build
        } else {
            console.error("Invalid layer: bad initialization?");
        }
    };

    APPLICATION_CONTEXT.UTILITIES.setFilterOfLayer = function(layerId, filter, value) {
        let viz = seaGL.currentVisualisation();
        if (viz.shaders.hasOwnProperty(layerId)) {
            //store to the configuration
            viz.shaders[layerId].setFilterValue(filter, value);
            viz.shaders[layerId]._renderContext.resetFilters(viz.shaders[layerId].params);
            seaGL.reorder(null); //force to re-build
        } else {
            console.error("Invalid layer: bad initialization?");
        }
    };

    APPLICATION_CONTEXT.UTILITIES.updateUIForMissingSources = function () {
        let layers = seaGL.currentVisualisation().shaders;
        let sources = webglProcessing.getSources();
        let allSources = APPLICATION_CONTEXT.setup.data;
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

    function createHTMLLayerControls(title, html, dataId, isVisible, layer, wasErrorWhenLoading) {
        let fixed = !(layer.hasOwnProperty("fixed") && !layer.fixed);
        //let canChangeFilters = layer.hasOwnProperty("toggleFilters") && layer.toggleFilters;

        let style = isVisible ? '' : 'style="filter: brightness(0.5);"';
        let modeChange = fixed ? "" : `<span class="material-icons pointer"
id="label-render-mode"  style="width: 10%; float: right;${layer.params.use_mode === "mask" ? "" : "color: var(--color-icon-tertiary);"}"
onclick="APPLICATION_CONTEXT.UTILITIES.changeModeOfLayer('${dataId}')" title="Toggle blending (default: mask)">payments</span>`;

        wasErrorWhenLoading = wasErrorWhenLoading || layer.missingDataSources;

        let availableShaders = "";
        for (let available of WebGLModule.ShaderMediator.availableShaders()) {
            let selected = available.type() === layer.type ? " selected" : "";
            availableShaders += `<option value="${available.type()}"${selected}>${available.name()}</option>`;
        }

        // let filterChange = "";
        // if (canChangeFilters) {
        //     canChangeFilters = "<select onchange='APPLICATION_CONTEXT.UTILITIES.setFilterOfLayer()'>";
        //     for (let f in WebGLModule.VisualisationLayer.filterNames) {
        //         let selected = available.type() === layer.type ? " selected" : "";
        //         canChangeFilters +=  `<option value="${available.type()}"${selected}>${available.name()}</option>`;
        //     }
        // }

        let filterUpdate = "";
        if (!fixed) {
            Object.keys(WebGLModule.VisualisationLayer.filters).some(key => {
                let found = layer.params.hasOwnProperty(key);
                if (found) filterUpdate = `<span>${WebGLModule.VisualisationLayer.filterNames[key]}:</span><input type="number" value="${layer.params[key]}"
onchange="APPLICATION_CONTEXT.UTILITIES.setFilterOfLayer('${dataId}', '${key}', Number.parseFloat(this.value));" class="form-control">`;
                return found;
            });
        }

        return `<div class="shader-part resizable rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" id="${dataId}-shader-part" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${isVisible ? 'checked' : ''}
${wasErrorWhenLoading ? '' : 'disabled'} onchange="APPLICATION_CONTEXT.UTILITIES.shaderPartToogleOnOff(this, '${dataId}');">
              &emsp;<span style='width: 210px; vertical-align: bottom;' class="one-liner">${title}</span>
              <div class="d-inline-block label-render-type" style="cursor: pointer; float: right;">
                  <label for="change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select id="${dataId}-change-render-type" ${fixed ? "disabled" : ""}
onchange="APPLICATION_CONTEXT.UTILITIES.changeVisualisationLayer(this, '${dataId}')" style="display: none; cursor: pointer;" class="form-control input-sm">${availableShaders}</select>
                </div>
                ${modeChange}
                <span class="material-icons" style="width: 10%; float: right;">swap_vert</span>
            </div>
            <div class="non-draggable">${html}${filterUpdate}</div>
            </div>`;
    }
})(window);
</script>
