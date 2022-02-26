// Initialize viewer webGL extension - webGLWrapper
var activeData = "";

seaGL = new OpenSeadragonGL({
    htmlControlsId: "data-layer-options",
    // authorization: "<?php echo AUTH_HEADERS ?>", //todo necessary?
    htmlShaderPartHeader: createHTMLLayerControls,
    debug: setup.params.debug,
    ready: function() {
        var i = 0;
        let select = $("#shaders");
        seaGL.foreachVisualisation(function (vis) {
            let selected = vis.params.hasOwnProperty("isDefault") && vis.params.isDefault ? "selected" : "";
            if (vis.error) {
                select.append(`<option value="${i}" ${selected} title="${vis.error}">&#9888; ${vis['name']}</option>`);
            } else {
                select.append(`<option value="${i}" ${selected}>${vis['name']}</option>`);
            }
            i++;
        });

        if (setup.params.customBlending) {
            let blend = $("#blending-equation");
            blend.html(`
<span class="blob-code"><span class="blob-code-inner">vec4 blend(vec4 foreground, vec4 background) {</span></span>
<textarea id="custom-blend-equation-code" class="form-control blob-code-inner" style="width: calc(100% - 20px); margin-left: 20px; 
display: block; resize: vertical;">//some simple placeholder:\nreturn foreground;</textarea>
<span class="blob-code"><span class="blob-code-inner">}</span></span>
<button class="btn" onclick="seaGL.webGLWrapper.changeBlending($('#custom-blend-equation-code').val());seaGL.redraw();"
style="float: right;"><span class="material-icons pl-0" style="line-height: 11px;">payments</span> Set blending</button>`);
        }
    },
    visualisationInUse: function(visualisation) {
        enableDragSort("data-layer-options");
        //called only if everything is fine
        DisplayError.hide(); //preventive
        //re-fetch data

        // TODO maybe do not use this at all, or perform it more sophistically
        // let data = seaGL.dataImageSources();
        // if (data !== activeData) {
        //     activeData = data;
        //     //todo dirty?
        //     if (PLUGINS.dataLayer) {
        //         viewer.addTiledImage({
        //             tileSource : iipSrvUrlPOST + seaGL.dataImageSources() + ".dzi",
        //             index: layerIDX,
        //             opacity: $("#global-opacity").val(),
        //             replace: true
        //         });
        //     }
        // }

        viewer.raiseEvent('visualisation-used', visualisation);
    },

    visualisationChanged: function(oldVis, newVis) {
        if (PLUGINS.hasLayers) {
            viewer.addTiledImage({
                tileSource : visualizationUrlMaker('/iipsrv-martin/iipsrv.fcgi', seaGL.dataImageSources()),
                index: layerIDX,
                opacity: $("#global-opacity").val(),
                replace: true
            });
        }
    },

    //called when this module is unable to run
    onFatalError: function(error) {
        DisplayError.show(error.error, error.desc);
    },

    //called when a problem occurs, but other parts of the system still might work
    onError: function(error) {
        DisplayError.show(error.error, error.desc);
    },
}, function (e) {
    return e.tiledImage.source.postData; //todo rather find out which tilesource it belongs to
});

//Set visualisations
seaGL.addVisualisation(...setup.visualizations);
seaGL.addData(...setup.data);
seaGL.webGLWrapper.addCustomShaderSources(...setup.shaderSources);

/*---------------------------------------------------------*/
/*------------ JS utilities and enhancements --------------*/
/*---------------------------------------------------------*/

function currentVisualisation() {
    return seaGL.currentVisualisation();
}

function makeCacheSnapshot() {
    let active = seaGL.currentVisualisation().shaders;
    for (let key in active) {
        if (active.hasOwnProperty(key)) {
            let shaderSettings = active[key];
            shadersCache[shaderSettings.name] = shaderSettings.cache;
        }
    }
    document.cookie = `cache=${JSON.stringify(shadersCache)}; expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=Strict; path=/`;
    Dialogs.show("Modifications in parameters saved.", 5000, Dialogs.MSG_INFO);
}

// load desired shader upon selection
$("#shaders").on("change", function () {
    activeVisualization = Number.parseInt(this.value);
    seaGL.switchVisualisation(activeVisualization);
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
    const currentTarget = event.target;
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

function shaderPartToogleOnOff(self) {
    if (self.checked) {
        seaGL.currentVisualisation().shaders[self.dataset.id].visible = 1;
        self.parentNode.parentNode.classList.remove("shader-part-error");
    } else {
        seaGL.currentVisualisation().shaders[self.dataset.id].visible = 0;
        self.parentNode.parentNode.classList.add("shader-part-error");
    }
    seaGL.reorder(null);
}



function changeVisualisationLayer(self, layerId) {
    let _this = $(self),
        type = _this.val();
    let factoryClass = WebGLModule.ShaderMediator.getClass(type);
    if (factoryClass !== undefined) {
        let viz = currentVisualisation();
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
}

function changeModeOfLayer(self, layerId) {
    let viz = currentVisualisation();
    if (viz.shaders.hasOwnProperty(layerId)) {
        let useBlend = viz.shaders[layerId].params.use_mode === "blend"; //todo remporary since we have now only two modes
        viz.shaders[layerId].params.use_mode = useBlend ? "show" : "blend";
        viz.shaders[layerId].error = "force_rebuild"; //error will force reset
        seaGL.reorder(null); //force to re-build
    } else {
        console.error("Invalid layer: bad initialization?");
    }
}

function updateUIForMissingSources() {
    //todo debug
    // seaGL.refreshMissingSources();
    // let layers = seaGL.currentVisualisation().shaders;
    // for (let key in layers) {
    //     if (layers.hasOwnProperty(key) && layers[key].missingDataSources) {
    //         let layer = $(`#${key}-shader-part`);
    //         layer.find("input")[0].attr("disabled", true);
    //     }
    // }
}

function createHTMLLayerControls(title, html, dataId, isVisible, layer, wasErrorWhenLoading) {
    let fixed = !(layer.hasOwnProperty("fixed") && !layer.fixed);
    let style = isVisible ? '' : 'style="filter: brightness(0.5);"';
    let modeChange = fixed ? "" : `<span class="material-icons pointer" 
id="label-render-mode"  style="width: 10%; float: right;${layer.params.use_mode === "blend" ? "" : "color: var(--color-icon-tertiary);"}" 
onclick="changeModeOfLayer(this, '${dataId}')" title="Toggle blending (default: mask)">payments</span>`;

    wasErrorWhenLoading = wasErrorWhenLoading || layer.missingDataSources;

    let availableShaders = "";
    for (let available of WebGLModule.ShaderMediator.availableShaders()) {
        let selected = available.type() === layer.type ? " selected" : "";
        availableShaders += `<option value="${available.type()}"${selected}>${available.name()}</option>`;
    }

    return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" id="${dataId}-shader-part" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${isVisible ? 'checked' : ''} 
${wasErrorWhenLoading ? '' : 'disabled'} data-id="${dataId}" onchange="shaderPartToogleOnOff(this);">
              &emsp;${title}
              <div class="d-inline-block label-render-type" style="cursor: pointer; float: right;">
                  <label for="change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select id="${dataId}-change-render-type" ${fixed ? "disabled" : ""} 
onchange="changeVisualisationLayer(this, '${dataId}')" style="display: none; cursor: pointer;" class="form-control">${availableShaders}</select>
                </div>
                ${modeChange}
                <span class="material-icons" style="width: 10%; float: right;">swap_vert</span>
            </div>
            <div class="non-draggable">${html}</div>
            </div>`;
}
