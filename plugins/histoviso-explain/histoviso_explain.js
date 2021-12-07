class HistovisoExplain  {

    static identifier = "histoviso_explain";

    constructor() {
        //comply to the documentation:
        this.id = HistovisoExplain.identifier;
        this.setupData = {};
        this.model_list = {};
        this.current_method = undefined;
        this.current_model = undefined;
    }

    //delayed after OSD initialization is finished...
    openSeadragonReady() {
        const _this = this;
        PLUGINS.appendToMainMenu("Neural Network (NN) inspector", "", "Waiting for the server...", "feature-maps", this.id);
        this.fetchParameters("/histoviso-explain/available-expl-methods").then(
            data => {
                _this._init(data);
            }
        ).catch( e => {
            console.error(e);
            _this.createErrorMenu(`An error has occured while loading the plugin.`, e);
        });
    }

    createMenu(notification=undefined) {
        //bit dirty :)
        if (notification) {
            let style = (notification.startsWith("NOTE")) ? "color-bg-severe" : "";
            notification = `<div class="p-2 ${style}">${notification}</div>`;
        }

        //controlPanelId is incomming parameter, defines where to add HTML
        PLUGINS.replaceInMainMenuExtended("Neural Network (NN) inspector", "",
            `${notification}<div id="method-setup"></div><div id="model-setup">Loading...</div>
<div style="text-align: right" class="mt-1"><button class="btn" onclick="${this.id}.reSendRequest();">Re-evaluate selected</button>
<button class="btn" onclick="${this.id}.reRenderSelectedObject();">Repaint selected</button></div>`,
            `<br><h4 class="d-inline-block" style="width: 80px;">Rendering </h4>&emsp;<select class="form-control" id="histoviso-explain-rendering" 
onchange="${this.id}.viaGL.switchVisualisation($(this).val())"></select><div id='histoviso-explain-html'></div>`,
            "feature-maps", this.id);
        PLUGINS.addHtml("<div id='histoviso-explain-scripts'></div>", this.id);
    }

    createErrorMenu(html, err=undefined) {
        if (!err) {
            PLUGINS.replaceInMainMenu("Neural Network (NN) inspector", "", html, "feature-maps", this.id);
        } else {
            PLUGINS.replaceInMainMenuExtended("Neural Network (NN) inspector", "", html,
                `<br>Error description: <br><code>${err}</code>`, "feature-maps", this.id);
        }
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
<select id="method-selection" class="form-control" onchange="${this.id}.updateMethodProperties($(this).val());" 
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
        this._ownExplorer.active = false;
        this._ownRenderer.active = false;

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
<select id="layer-selection" style="font-size: smaller;" name="layer-selection" class="form-control" onchange="${this.id}.updateFeatureMaps('${model}', $(this).val())">
${options.join('')}</select><div id="feature-map-specifier"></div>`);
        //cascade
        if (first) {
            this.updateFeatureMaps(model, first);
        }

        this._ownExplorer.active = true;
        this._ownRenderer.active = true;
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
                'Content-Type': 'application/json',
                'Authorization': 'Basic cmF0aW9uYWk6cmF0aW9uYWlfZGVtbw=='
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

        //Requires Annotations plugin
        let annotationPlugin = PLUGINS.each[PLUGINS.each[this.id].requires];
        if (!annotationPlugin || !annotationPlugin.loaded) {
            this.createErrorMenu("The Annotations plugin is required: please, reload with the plugin as active.");
            return;
        }

        let notification = "";
        let params = PLUGINS.seaGL.currentVisualisation().params;
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
        this._annotationPlugin = annotationPlugin.instance;
        this._ownRenderer = this._annotationPlugin.getAnnotationObjectFactory("image");
        this._ownExplorer = this._annotationPlugin.getAnnotationObjectFactory("histoviso-explain-explorer");

        this.createMenu(notification);
        //todo check structure?
        this.setupData = setupData;

        this.updateMethodList();
        this._initWebGL();
    }

    reSendRequest() {
        this._ownRenderer.reSendRequest();
    }

    reRenderSelectedObject() {
        this._ownRenderer.reRenderSelectedObject();
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

        this.viaGL = new WebGLWrapper({
            //where to append html/css designed for shaders to use, these containers are emptied before append!
            htmlControlsId: "histoviso-explain-html",
            uniqueId: "histoviso_explain",
            //just a custom function names to avoid collision
            //todo hardcoded!!
            authorization: "Basic cmF0aW9uYWk6cmF0aW9uYWlfZGVtbw==",
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
                        params: {ctrlOpacity: 0}
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
                        params: {
                            ctrlOpacity: 0,
                            logScale: 1,
                            logScaleMax: 0.6
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
                        params: {ctrlOpacity: 0}
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
                        params: {
                            ctrlOpacity: 0,
                            logScale: 1,
                            logScaleMax: 0.6
                        }
                    }
                }
            }
        );

        this.viaGL.prepare(() => {
            _this.viaGL.init(1, 1);
            this._ownRenderer.setContext(_this.viaGL, _this);
            this._ownExplorer.setContext(_this);
        });
    }
}

registerPlugin(HistovisoExplain);