class HistovisoExplain  {
    constructor(id, params) {
        //comply to the documentation:
        this.id = id;
        this.setupData = {};
        this.model_list = {};
        this.params = params;
        this.current_method = undefined;
        this.current_model = undefined;
        this.PLUGIN = `plugin('${id}')`;
    }

    //delayed after OSD initialization is finished...
    pluginReady() {
        const _this = this;
        USER_INTERFACE.MainMenu.append("Neural Network (NN) inspector",
            `<span class="material-icons btn-pointer" id="show-histoviso-board" title="Show board" 
style="float: right;" data-ref="on" onclick="${this.PLUGIN}.context.history.openHistoryWindow();">assignment</span>`,
            "Waiting for the server...", "feature-maps", this.id);

        this.context = OSDAnnotations.instance();
        this.context.setModeUsed("CUSTOM");

        this.inspect = new OSDAnnotations.Preset(Date.now().toString(),
            this.context.getAnnotationObjectFactory("_histoviso-network_inspector"));
        this.measure = new OSDAnnotations.Preset(Date.now().toString(),
            this.context.getAnnotationObjectFactory("_histoviso-explain-explorer"));

        this.fetchParameters("/histoviso-explain/available-expl-methods").then(
            data => {
                _this._init(data);
            }
        ).catch( e => {
            console.error(e);
            _this.createErrorMenu(`An error has occured while loading the plugin.`, e);
        });
    }

    setMode(node, otherNode, mode) {
        let tool = this[mode];
        if (!tool) return;
        if (this.context.getPreset() == tool) {
            this.context.setPreset(this._cachedTool);
            delete this._cachedTool;
            node.setAttribute('aria-selected', false);
            return;
        }
        this._cachedTool = this.context.setPreset(tool);
        node.setAttribute('aria-selected', true);
        otherNode.setAttribute('aria-selected', false);
    }

    createMenu(notification=undefined) {
        let targetSetup = "";
        // if (APPLICATION_CONTEXT.config.background.length > 1) {
        targetSetup = `<br><br>
Use Alt+Left Mouse button to draw region of interest.<br>
<button class="btn" onclick="${this.PLUGIN}.setMode(this, this.nextElementSibling , 'inspect');">Inspect</button>
<button class="btn" onclick="${this.PLUGIN}.setMode(this, this.previousElementSibling, 'measure');">Measure</button>

<br>Fetching data from &nbsp;<select style="max-width: 240px;" class="form-control" 
onchange='${this.PLUGIN}.targetImageSourceName = ${this.PLUGIN}.getNameFromImagePath(this.value);'>`;
        var name;
        for (let i = APPLICATION_CONTEXT.config.background.length-1; i >= 0; i--) {
            name = this.getNameFromImagePath(APPLICATION_CONTEXT.config.data[APPLICATION_CONTEXT.config.background[i].dataReference]);
            let selected = i === 0 ? "selected" : "";
            targetSetup += `<option value='${name}' ${selected}>image ${name}</option>`;
        }
        this.targetImageSourceName = name; //reverse order, remember last one
        targetSetup += "</select>";
        // }  else {
        //     this.targetImageSourceName = this.getNameFromImagePath(APPLICATION_CONTEXT.config.data[APPLICATION_CONTEXT.config.background[0].dataReference]);
        // }

        //bit dirty :)
        if (notification || targetSetup) {
            let style = (notification && notification.startsWith("NOTE")) ? "color-bg-severe" : "";
            notification = `<div class="p-2 ${style}">${notification}${targetSetup}</div>`;
        }

        //controlPanelId is incomming parameter, defines where to add HTML
        USER_INTERFACE.MainMenu.replaceExtended("Neural Network (NN) inspector", "",
            `${notification}<div id="method-setup"></div><div id="model-setup">Loading...</div>
<div style="text-align: right" class="mt-1"><button class="btn" onclick="${this.PLUGIN}.reSendRequest();">Re-evaluate selected</button>
<button class="btn" onclick="${this.PLUGIN}.reRenderSelectedObject();">Repaint selected</button></div>`,
            `<br><h4 class="d-inline-block" style="width: 80px;">Rendering </h4>&emsp;<select class="form-control" id="histoviso-explain-rendering" 
onchange="${this.PLUGIN}.viaGL.switchVisualisation($(this).val())"></select><div id='histoviso-explain-html'></div>`,
            "feature-maps", this.id);
        USER_INTERFACE.addHtml("<div id='histoviso-explain-scripts'></div>", this.id);
    }

    createErrorMenu(html, err=undefined) {
        if (!err) {
            USER_INTERFACE.MainMenu.replace("Neural Network (NN) inspector", "", html, "feature-maps", this.id);
        } else {
            USER_INTERFACE.MainMenu.replaceExtended("Neural Network (NN) inspector", "", html,
                `<br>Error description: <br><code>${err}</code>`, "feature-maps", this.id);
        }
    }

    getNameFromImagePath(path) {
        let begin = path.lastIndexOf('/')+1;
        return path.substr(begin, path.length - begin - 4);
    }

    /**
     * Load supported method list and setup method GUI controls, the top of the cascade update
     */
    updateMethodList() {
        //hardcoded for now
        let first = undefined;
        let options = [];
        for (let key in this.setupData) {
            let method = this.setupData[key];
            if (!first) {
                first = key;
                options.push(`<option value='${key}' selected>${method["display_name"]}</option>`);
            } else {
                options.push(`<option value='${key}'>${method["display_name"]}</option>`);
            }
        }

        $("#method-setup").html(`<h3 style="width: 80px;" class="d-inline-block">Method</h3>
<select id="method-selection" class="form-control" onchange="${this.PLUGIN}.updateMethodProperties($(this).val());" 
name="method-selection">${options.join('')}</select><div id="method-specifier"></div>`);
        this.updateMethodProperties(first);
    }

    updateMethodProperties(method) {
        this.current_method = method;
        let container = $("#method-specifier");
        if (!method || !container) return;

        let html = "";
        let methodParams = this.setupData[method]["params"];
        for (let paramName in methodParams) {
            let param = methodParams[paramName];
            let parser = this._parsers[param["type"]];
            if (!parser) {
                console.warn("Unsupported parameter type " + param["type"]);
                continue;
            }
            html += `<span class="d-inline-block ml-3" style="width: 120px;height: 28px;">${paramName} </span>`
            html += parser("params-for-explainability-method", paramName, param["default"], param["range"]);
            html += "<br>";
        }
        container.html(html);

        this.updateLayerList(this.setupData[method]["model_name"]);
    }

    updateLayerList(model, fetches=true) {
        if (!model) {
            $("#model-setup").html(`There was an error when obtaining the model information. Please, select a different method.`);
            console.warn(`Invalid model name ${model}.`);
            return;
        }
        if (this.current_model === model) return;

        let _this = this,
            container = $("#model-setup"),
            method_select = $("#method-selection");
        this.inspect.objectFactory.active = false;
        this.measure.objectFactory.active = false;

        if (!this.model_list.hasOwnProperty(model)) {
            if (fetches) {
                container.html('Loading...');
                method_select.attr('disabled', true);
                this.fetchParameters(
                    '/histoviso-explain/layers-info/' + model
                ).then(data => {
                    _this.model_list[model] = data;
                    return data;
                }).then(
                    data => _this.updateLayerList(model, false)
                ).catch( e => {
                    $("#model-setup").html(`There was an error when obtaining the model information. Please, select a different model.`);
                    console.warn(e);
                });
            } else {
                container.html(`There was an error when obtaining the model information. Please, select a different model.`);
            }
            method_select.attr('disabled', false);
            return;
        }
        this.current_model = model;
        method_select.attr('disabled', false);
        let modelData = this.model_list[model];
        let first = false;
        let options = [];

        for (let layer in modelData) {
            let selected = "";
            if (!first) {
                selected = " selected";
                first = layer;
            }
            options.push(`<option value="${layer}"${selected}>${layer}</option>`)
        }

        container.html(`<br><span class="d-inline-block text-bold ml-2" style="width: 70px;">Layer </span>
<select id="layer-selection" style="font-size: smaller;" name="layer-selection" class="form-control" onchange="${this.PLUGIN}.updateFeatureMaps('${model}', $(this).val())">
${options.join('')}</select><div id="feature-map-specifier"></div>`);
        //cascade
        if (first) {
            this.updateFeatureMaps(model, first);
        }

        this.measure.objectFactory.active = true;
        this.inspect.objectFactory.active = true;
    }

    updateFeatureMaps(model, layer) {
        let maxFeatureMapCount = this.model_list[model][layer];
        if (maxFeatureMapCount) {
            maxFeatureMapCount = Number.parseInt(maxFeatureMapCount);
            $("#feature-map-specifier").html(`<span class="d-inline-block ml-3" style="width: 100px;">Feature Map</span>
<input id="feature-map-number" class="form-control" type="number" min="0" 
max="${maxFeatureMapCount-1}" value="0"> out of ${maxFeatureMapCount-1}`);
        } else {
            $("#feature-map-specifier").html(`Missing features data!`);
        }
    }

    getModel() {
        return this.current_model;
    }

    getMethod() {
        return this.current_method;
    }

    getLayer() {
        return $("#layer-selection").val();
    }

    getLayerFeatureId() {
        return Number.parseInt($("#feature-map-number").val());
    }

    getImageSource() {
        return this.targetImageSourceName;
    }

    getAditionalMethodParams() {
        let result = {};
        let _this = this;
        $(".params-for-explainability-method").each((idx, elem) => {
            let getter = _this._evaluators[elem.dataset.type];
            if (getter) {
                result[elem.dataset.name] = getter(elem);
            } else {
                result[elem.dataset.name] = null;
            }
        })
        return result;
    }

    async fetchParameters(url = '') {
        // Default options are marked with *
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors', // no-cors, *cors, same-origin
            cache: 'no-cache',
            credentials: 'same-origin', // include, *same-origin, omit
            headers: {
                'Content-Type': 'application/json'
            },
            redirect: 'error',
            referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
            body: null // body data type must match "Content-Type" header
        });

        if (response.status < 200 || response.status > 299) {
            return response.text().then(text => {
                throw new Error(`Server returned ${response.status}: ${text}`);
            });
        }
        return response.json(); // parses JSON response into native JavaScript objects
    }

    _init(setupData) {
        //todo add annotation objects at runtime to avoid interaction in failure

        let notification = "";
        let params = this.params;
        if (params) {
            //todo hardcoded
            if (params.experimentId && params.experimentId !== "VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69") {
                this.createErrorMenu(`This method works only for experiment <b>VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69</b>. Your
experiment is '${params.experimentId}'.`);
                return;
            }
            if (!params.experimentId) {
                notification = "NOTE: We could not identify the experiment: we inspect <b>VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69</b>.";
            }
        } else {
            notification = "NOTE: We could not identify the experiment: we inspect <b>VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69</b>.";
        }

        if (!notification) notification = "Experiment <b>VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69</b>.";
        this._initParamParsers();

        this.createMenu(notification);
        //todo check structure?
        this.setupData = setupData;

        this.updateMethodList();
        this._initWebGL();
    }

    reSendRequest() {
        this.inspect.objectFactory.reSendRequest();
    }

    reRenderSelectedObject() {
        this.inspect.objectFactory.reRenderSelectedObject();
    }

    _initParamParsers() {
        this._parsers = {
            int: function (cls, name, defaultValue, range) {
                let bounded = "", value = "";
                if (range && Array.isArray(range) && range.length == 2) {
                    bounded = `min="${range[0]}" max="${range[1]}"`;
                }
                value = defaultValue ? `value="${Number.parseInt(defaultValue)}"` : 'value="" placeholder="Integer number"';
                return `<input class='form-control ${cls}' type="number" ${bounded} ${value} step="1" data-name="${name}" data-type="int">`;
            },
            float: function (cls, name, defaultValue, range) {
                let bounded = "", value = "";
                if (range && Array.isArray(range) && range.length == 2) {
                    bounded = `min="${range[0]}" max="${range[1]}"`;
                }
                value = defaultValue ? `value="${Number.parseFloat(defaultValue)}"` : 'value="" placeholder="Float number"';
                return `<input class='form-control ${cls}' type="number" ${bounded} ${value} step="0.00001" data-name="${name}" data-type="float">`;
            },
            str: function (cls, name, defaultValue, range) {
                if (range && Array.isArray(range)) {
                    let options = [];
                    range.forEach(item => {
                        let selected = defaultValue == item ? " selected" : "";
                        options.push(`<option value="${item}"${selected}>${item}</option>`)
                    });
                    return `<select class='form-control ${cls}' data-name="${name}" data-type="str">>${options.join('')}</select>`;
                }
                let value = defaultValue ? `value="${defaultValue}"` : `value=""  placeholder="Text"`;
                return `<input ${cls}" data-name="${name}" data-type="str" type="text" ${value}>`;
            },
            bool: function (cls, name, defaultValue, range) {
                let value = defaultValue ? `checked` : ``;
                return `<input class='form-control ${cls}' type="checkbox" data-name="${name}" data-type="bool" ${value}>`;
            }
        }

        this._evaluators = {
            int: function (elem) {
                let result = Number.parseInt(elem.value);
                if (isNaN(result)) return null;
                return result;
            },
            float: function (elem) {
                let result = Number.parseFloat(elem.value);
                if (isNaN(result)) return null;
                return result;
            },
            str: function (elem) {
                return elem.value;
            },
            bool: function (elem) {
                return elem.checked;
            }
        }
    }

    _initWebGL() {
        //TODO not debugged...
        let shaderNames = $("#histoviso-explain-rendering");
        const _this = this;

        this.viaGL = new WebGLModule({
            htmlControlsId: "histoviso-explain-html",
            uniqueId: "histoviso_explain",
            ready: function() {
                var i = 0;
                _this.viaGL.foreachVisualisation(function (vis) {
                    if (vis.error) {
                        shaderNames.append(`<option value="${i}" title="${vis.error}">&#9888; ${vis['name']}</option>`);
                    } else {
                        shaderNames.append(`<option value="${i}">${vis['name']}</option>`);
                    }
                    i++;
                });
            },
            onFatalError: function (vis) {
                alert("Error in network plugin:" + vis["error"] + (vis["desc"] ? vis["desc"] : ""));
            },
            htmlShaderPartHeader: function(title, html, dataId, isVisible, layer, isControllable) {
                let style = isVisible ? 'style="cursor:default;"' : 'style="filter: brightness(0.5);cursor:default;"';
                return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${dataId}" ${style}>
            <div class="h5 py-1 position-relative">
              ${title}
            </div>
            <div class="non-draggable">${html}</div>
            </div>`;
            }
        });

        this.viaGL.addVisualisation({
                name: "Identity",
                params: {},
                shaders: {
                    "__automaticaly_generated_data": {
                        name: "Network Output",
                        type: "identity",
                        visible: "1",
                        dataReferences: [0],
                        params: {}
                    }
                }
            },
            {
                name: "HeatMap",
                params: {},
                shaders: {
                    "__automaticaly_generated_data": {
                        name: "Network Output",
                        type: "heatmap",
                        visible: "1",
                        dataReferences: [0],
                        params: {
                            opacity: {
                                interactive: false
                            }

                        }
                    }
                }
            },
            {
                name: "HeatMap (LogScale)",
                params: {},
                shaders: {
                    "__automaticaly_generated_data": {
                        name: "Network Output",
                        type: "heatmap",
                        visible: "1",
                        dataReferences: [0],
                        params: {
                            opacity: {
                                interactive: false
                            },
                            use_logscale: 0.4,
                        }
                    }
                }
            },
            {
                name: "Two-polar HeatMap",
                params: {},
                shaders: {
                    "__automaticaly_generated_data": {
                        name: "Network Output",
                        type: "bipolar-heatmap",
                        visible: "1",
                        dataReferences: [0],
                        params: {
                            opacity: {
                                interactive: false
                            }
                        }
                    }
                }
            },
            {
                name: "Two-polar HeatMap (LogScale)",
                params: {},
                shaders: {
                    "__automaticaly_generated_data": {
                        name: "Network Output",
                        type: "bipolar-heatmap",
                        visible: "1",
                        dataReferences: [0],
                        params: {
                            opacity: {
                                interactive: false
                            },
                            use_logscale: 0.4,
                        }
                    }
                }
            }
        );

        this.viaGL.prepare(["_not_used_"], () => {
            _this.viaGL.init(1, 1);
            this.inspect.objectFactory.setContext(_this.viaGL, _this);
            this.measure.objectFactory.setContext(_this);
        });
    }
}

addPlugin("histoviso_explain", HistovisoExplain);
