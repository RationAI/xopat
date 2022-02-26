class PythonPlayground  {

    static identifier = "playground";

    constructor() {
        this.id = PythonPlayground.identifier;
        this.setup = PLUGINS.params.hasOwnProperty("playground") ? PLUGINS.params.playground : {"server": "http://localhost",
            "gchr": {
                "name": "Green channel remover"
            }};
        this.server = this.setup.server || null;
        this.rendering = false;
        this.selectedAlgId = null;

        let dataSelection = [];
        for (let source of PLUGINS.imageSources) {
            dataSelection.push("<option value='", source, "'>", source, "</option>");
        }

        let algoSelection = [];
        for (let algId in this.setup) {
            if (algId !== "server" && this.setup.hasOwnProperty(algId)) {
                if (!this.selectedAlgId) this.selectedAlgId = algId;
                algoSelection.push("<option value='", algId, "'>", this.setup[algId].name || algId, "</option>");
            }
        }

        PLUGINS.replaceInMainMenuExtended("Python Playground", "",
            `Note that for this plugin to work, you need to run
a python playground server by yourself.<div id="report-notify-playground"></div><select id="data-playground-select" onchange="${this.id}.switchUnderlyingData($(this).val())">${dataSelection.join("")}</select>
<select id="algorithm-playground-select" onchange="${this.id}.switchAlgorithm($(this).val())">${algoSelection.join("")}</select>`,
            `<div id="postprocess-algorithm"></div><div id=""></div>`,
            "python-playground", this.id);

        this.seaGL = new OpenSeadragonGL({
            htmlControlsId: "postprocess-algorithm",
            htmlShaderPartHeader: this.postProcessHeader,
            debug: false,
            ready: function() {

            },
            visualisationInUse: function(visualisation) {

            },
            visualisationChanged: function(oldVis, newVis) {

            },
            //called when this module is unable to run
            onFatalError: function(error) {

            },
            //called when a problem occurs, but other parts of the system still might work
            onError: function(error) {

            },
        }, function (e) {
            return e.tiledImage.source.postData; //todo rather find out which tilesource it belongs to
        });

//Set visualisations
        this.seaGL.addVisualisation({
            name: "Output Postprocessing",
            params: {},
            shaders: {
                "__postprocessing__": {
                    name: "Output Postprocessing",
                    type: "identity",
                    visible: "1",
                    dataReferences: [0], //todo maybe switch index based on which data we render
                    params: {}
                }
            }
        });
        this.seaGL.addData("__auto_generated__");
    }

    //delayed after OSD initialization is finished...
    openSeadragonReady() {
        const _this = this;
        this.seaGL.loadShaders(function() {
            _this._load(_this.selectedAlgId, PLUGINS.imageSources[0]);
        });
        this.seaGL.init(PLUGINS.osd); //bind OSD
    }

    postProcessHeader(title, html, dataId, isVisible, layer, wasErrorWhenLoading) {
        //wasErrorWhenLoading = wasErrorWhenLoading || layer.missingDataSources;
        let availableShaders = "";
        for (let available of WebGLModule.ShaderMediator.availableShaders()) {
            let selected = available.type() === layer.type ? " selected" : "";
            availableShaders += `<option value="${available.type()}"${selected}>${available.name()}</option>`;
        }

        return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2">
            <div class="h5 py-1 position-relative">
              &emsp;${title}
              <div class="d-inline-block label-render-type" style="cursor: pointer; float: right;">
                  <label for="change-render-type"><span class="material-icons" style="width: 10%;">style</span></label>
                  <select onchange="${this.id}.changeRendering(this, '${dataId}')" style="display: none; cursor: pointer;" class="form-control">${availableShaders}</select>
                </div>
            </div>
            <div class="non-draggable">${html}</div>
            </div>`;
    }

    switchUnderlyingData(data) {
        this._load(this.rendering, data);
    }

    switchAlgorithm(algId) {
        this._load(algId, this.underlyingData);
    }

    _load(algId, data) {
        if (this.setup.length < 1) {
            return;
        }
        if (!algId) return;

        let algData = this.setup[algId];
        if (!algData) {
            Dialogs.show("Selected algorithm has no context.", 5000, Dialogs.MSG_ERR);
            return;
        }
        let server = this.server || algData.server;
        const _this = this;

        if (!this.rendering) {
            PythonPlayground.Protocol.initialize(
                source => {
                    if (typeof source === "string") {
                        console.error(source);
                    } else {
                        PLUGINS.osd.addTiledImage({
                            tileSource : source,
                            opacity: 1
                        });

                        let items = PLUGINS.osd.world._items;
                        for (let i = 0; i < items.length; i++) {
                            let src = items[i];
                            if (typeof src.Image === "string" && src.Image.xmlns.contains("rationai.fi.muni.cz/deepzoom/playground")) {
                                _this.layerIndex = i;
                            }
                        }
                    }
                },
                error => {
                    $("#report-notify-playground").html("Error fetching the data. Is your playground server running?");
                    _this.layerIndex = -1;
                    delete _this.rendering;
                }, server, data, algId);
        } else {
            PythonPlayground.Protocol.initialize(
                source => {
                    if (typeof source === "string") {
                        console.error(source);
                    } else {
                        PLUGINS.osd.addTiledImage({
                            tileSource: source,
                            index: _this.layerIndex,
                            opacity: 1,
                            replace: true
                        });
                    }
                },
                error => {
                    let currentSource = PLUGINS.osd.world.getItemAt(_this.layerIndex);
                    if (currentSource) PLUGINS.osd.world.removeItem();
                    _this.layerIndex = -1;
                    delete _this.rendering;
                    $("#report-notify-playground").html(error);
                    console.warn("Error fetching the data. Is your playground server running?");
                }, server, data, algId);
        }
        //should be OK since network will take longer to finish and rendering will get overwritten...
        this.rendering = algId;
        this.underlyingData = data;
    }

    changeRendering(self, layerId) {
        let _this = $(self),
            type = _this.val();
        let factoryClass = WebGLModule.ShaderMediator.getClass(type);
        if (factoryClass !== undefined) {
            this.seaGL.foreachVisualisation(vis => vis.shaders[layerId].type = type);
            this.seaGL.reorder(null);
        }
        _this.html("");
    }
}

registerPlugin(PythonPlayground);
