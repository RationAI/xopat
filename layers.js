// Initialize viewer webGL extension - webGLWrapper
var activeData = "";

seaGL = new OpenSeadragonGL({
    htmlControlsId: "data-layer-options",
    // authorization: "<?php echo AUTH_HEADERS ?>", //todo necessary?
    htmlShaderPartHeader: createHTMLLayerControls,
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
        //todo setup lossless
        let newVisData = Object.keys(newVis.shaders).join(",");
        if (newVisData !== Object.keys(oldVis.shaders).join(",")) {
            if (PLUGINS.dataLayer) {
                viewer.addTiledImage({
                    tileSource : iipSrvUrlPOST + newVisData + ".dzi",
                    index: layerIDX,
                    opacity: $("#global-opacity").val(),
                    replace: true
                });
            }
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
    return e.tiledImage.source.postData;
}, layerIDX);

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


Tutorials.add("", "Basic functionality", "learn how the visualiser works", "foundation", [ {
    'next #viewer-container' : 'You can navigate in the content either using mouse,<br> or via keyboard: arrow keys (movement) and +/- (zoom). Try it out now.'
},{
    'next #main-panel' : 'On the right, the Main Panel <br> holds most functionality and also allows <br> to interact with plugins.',
}, {
    'next #navigator-container' : 'An interactive navigator can be used <br> for orientation or to jump quickly on different areas.',
}, {
    'next #general-controls' : 'The whole visualisation consists of two layers: <br> the tissue scan and the data layer above.<br>You can control the data layer opacity here.'
}, {
    'next #copy-url' : 'To share the visualisation with URL, use this button.<br>It will copy the URL to your clipboard.<b>Plugins will be included, but without their data.'
}, {
    'next #global-export' : 'If you want to share the visualisation <b>along with plugins data</b>, <br> you can export it here - all changes you\'ve made will be stored <br>(<i>note: the behaviour depends on the plugin itself</i>).'
}, {
    'next #panel-shaders' : 'The data layer <br>-the core visualisation functionality-<br> can be controlled here. Hovering over<br>the element will show additional hidden controls.'
}, {
    'click #shaders-pin' : 'Click on the pin to set <br>this controls subpanel to be always visible.'
}, {
    'next #shaders' : 'Multiple different visualisations <br>are supported - you can select <br>which one is being displayed.'
}, {
    'next #data-layer-options' : 'Each visualisation consists of several <br>data parts and their interpretation. <br>Here, you can control each part separately, <br>and also drag-n-drop to reorder.'
}], function() {
    //prerequisite - pin in default state
    let pin = $("#shaders-pin");
    let container = pin.parent().children().eq(1);
    pin.removeClass('pressed');
    container.removeClass('force-visible');
});

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
}

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
    let factoryClass = WebGLWrapper.ShaderMediator.getClass(type);
    if (factoryClass !== undefined) {
        let viz = currentVisualisation();
        if (viz.shaders.hasOwnProperty(layerId)) {
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

function createHTMLLayerControls(title, html, dataId, isVisible, layer, isControllable) {
    let style = isVisible ? '' : 'style="filter: brightness(0.5);"';
    let checked = isVisible ? 'checked' : '';
    let disabled = isControllable ? '' : 'disabled';
    let availableShaders = "";
    for (let available of WebGLWrapper.ShaderMediator.availableShaders()) {
        let selected = available.type() === layer.type ? " selected" : "";
        availableShaders += `<option value="${available.type()}"${selected}>${available.name()}</option>`;
    }

    return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${checked} ${disabled} data-id="${dataId}" onchange="shaderPartToogleOnOff(this);">
              &emsp;${title}
                <span class="material-icons position-absolute right-5" style="width: 10%;">swap_vert</span>
                <div class="position-absolute right-0 d-inline-block" id="label-render-type" style="cursor: pointer;">
                  <label for="change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select id="change-render-type" onchange="changeVisualisationLayer(this, '${dataId}')" style="display: none; cursor: pointer;" class="form-control">${availableShaders}</select>
                </div>
            </div>
            <div class="non-draggable">${html}</div>
            </div>`;
}