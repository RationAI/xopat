class Playground  {

    constructor(id, params) {
        this.id = id;
        //todo move params to 'plugins' ? probably yes...
        this.setup = params;
        this.strategy = null;

        if (!this.setup.hasOwnProperty("server")) this.setup.server = "http://test.muni:8080";
        this.imageSources = [...APPLICATION_CONTEXT.setup.data]; //copy

        USER_INTERFACE.MainMenu.appendExtended("Python Playground", `
<span class="material-icons pointer" id="reload-playground" title="Restart" style="float: right;" onclick="${this.id}.refresh();"> refresh</span>
<span class="material-icons pointer" id="enable-disable-playground" title="Enable/disable" style="float: right;" data-ref="on" onclick="
        let self = $(this);
        if (self.attr('data-ref') === 'on'){
            ${this.id}.setEnabled(false); self.html('visibility_off'); self.attr('data-ref', 'off');
        } else {
            ${this.id}.setEnabled(true); self.html('visibility'); self.attr('data-ref', 'on');
        }"> visibility</span>
        <span style="float: right;" class="material-icons pointer" onclick="${this.id}.openMenu();">receipt_long</span>
<!--<span style="float: right;" class="material-icons pointer" onclick="${this.id}.workflow.open();">history_edu</span>-->`,
            `<select id="data-playground-select" style="max-width: 380px" class="form-control"
 onchange="${this.id}.switchUnderlyingData($(this).val())"></select>`,
            `<div id="postprocess-algorithm"></div><div id=""></div>`,
            "python-playground", this.id);

        USER_INTERFACE.Tools.setMenu(this.id, "play-status-notif", "Playground", `
<div class="d-flex"><span class='dot-pulse mr-3 ml-5' style='width: 5px; height: 5px;transform: translate(-5px, 12px);'></span><div id="notification-playground" class="py-1 px-2 rounded-2 d-inline-block flex-1">Loading</div></div>
<!--TODO append permanent messages - errors (last X)-->       
        `, "terminal");
        this.messageStatus = document.getElementById('notification-playground');


        this.refresh(false);
        this.timer = $("#elapsed-python-compute-time");
    }

    createWebGLEngine() {
        this.webglEngine = new WebGLModule({
            htmlControlsId: "postprocess-algorithm",
            htmlShaderPartHeader: this.postProcessHeader,
            uniqueId: "playground_",
            debug: false,
            ready: function () {

            },
            visualisationInUse: function (visualisation) {

            },
            visualisationChanged: function (oldVis, newVis) {

            },
            //called when this module is unable to run
            onFatalError: function (error) {

            },
            //called when a problem occurs, but other parts of the system still might work
            onError: function (error) {

            }
        });
    }

    createVectorCanvas() {
        UTILITIES.loadModules(function () {
            this.vectorCanvas = VIEWER.fabricjsOverlay({
                //todo move this to the fabricjs module
                scale: VIEWER.tools.referencedTiledImage().source.Image.Size.Width,
                fireRightClick: false,
                fireMiddleClick: false,
            });
        }, "fabricjs");
    }

    //delayed after OSD initialization is finished...
    pluginReady() {
        this.switchUnderlyingData(this.imageSources[0]);
        this.menu = new Playground.AlgorithmMenu(this, "menu");
        //this.workflow = new Playground.WorkFlow(this, "workflow");

        if (this.setup.localStrategy) {
            this.localStrategy = new Playground.LocalStrategy(this);
            this.strategy = this.localStrategy;
        } else {
            this.serverStrategy = new Playground.ServerPixelStrategy(this);
            this.strategy = this.serverStrategy;
        }
        this.messageStatus = document.getElementById('notification-playground');

        const _this = this;
        VIEWER.addHandler('tiled-image-problematic', function (e) {
            if (e.tiledImage.source == _this.strategy.source) {
                _this.strategy.clear();
                console.log("REMOVED PLAYGROUND");
                _this.setEnabled(false);
                Dialogs.show("Playground response took too long. Disabled.", 5000, Dialogs.MSG_ERR);
            }
        });
    }

    getTheVisualization(name, renderingJSON, numOfLayers) {
        let result = {
            name: name || "Rendering options",
            params: {},
            shaders: {}
        };
        let index = 0;
        for (let style of renderingJSON) {
            if (typeof style === "string") {
                style = {type: style};
            }
            result.shaders[`${index}`] = $.extend({name: "Output Postprocessing", type: "identity", visible: true,
                dataReferences: [index], params: {}}, style);
            index++;
        }

        //populate undefined rendering styles with identity
        while (index < numOfLayers) {
            index++;
            result.shaders[`${index}`] = {name: "Default rendering", type: "identity", visible: true,
                dataReferences: [index], params: {}};
        }

        return result;
    }

    setBusy(message) {
        if (this._busy) {
            if (Date.now() - this._busytime > 540000) { //1.5 minutes
                Dialogs.show("Timeout on the previous task. The response took too long.",
                    5000, Dialogs.MSG_INFO);
            } else {
                Dialogs.show(this._busy, 5000, Dialogs.MSG_WARN);
                return;
            }
        }
        $("#python-playground").addClass("loading");
        this._busy = message;
        this._busytime = Date.now();
        return true;
    }

    finishBusy() {
        if (!this._busy) return false;
        $("#python-playground").removeClass("loading");
        this._busy = null;
        return true;
    }

    postProcessHeader(title, html, dataId, isVisible, layer, wasErrorWhenLoading) {
        //wasErrorWhenLoading = wasErrorWhenLoading || layer.missingDataSources;
        let shader = WebGLModule.ShaderMediator.getClass(layer.type);

        return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2">
            <div class="h5 py-1 position-relative">
              &emsp;${title}
              <div class="d-inline-block label-render-type" style="float: right;">Render: ${shader.name()} &emsp;</div>
            </div>
            <div class="non-draggable">${html}</div>
        </div>`;
    }

    switchUnderlyingData(data, force=false) {
        if (!this._enabled || (!force && this.underlyingData === data)) return;

        if (!this.setBusy("Refreshing the plugin...")) {
            return;
        }

        this.setStatus(`Fetch supported algorithms for <i>${data}</i>`, {loading: true});
        let algoSelect = $("#algorithm-playground-select");
        algoSelect.html("");

        const _this = this;
        UTILITIES.fetchJSON(`${this.setup.server}/prepare?Deepzoom=${data}.dzi`).then(json => {
            _this.underlyingData = data;
            this._algoJSON = json.algorithms;
            delete json.algorithms;
            let selectedAlgo = _this.menu.open(this._algoJSON, _this.activeAlgorithm, true);
            _this._loadAlgorithm(selectedAlgo, data, json);
        }).catch(e => {
            _this._handleErrorResponse("Server /prepare request failed. Make sure backend is not blocked (CORS).", e);
            algoSelect.html("");
        });
    }

    openMenu() {
        if (!this._algoJSON) {
            Dialogs.show("No algorithms available: is the server running?", 5000, Dialogs.MSG_WARN);
        } else {
            this.menu.open(this._algoJSON, this.activeAlgorithm);
        }
    }

    get data() {
        return this.underlyingData;
    }

    get algorithm() {
        return this.activeAlgorithm;
    }

    get configuration() {
        return this.lastConfig;
    }

    switchState(data, algorithm, configuration) {
        if (this.underlyingData !== data) {
            this.activeAlgorithm = algorithm;
            this.lastConfig = configuration; //todo probably useless...?
            this.switchUnderlyingData(data);
        } else if (this.activeAlgorithm !== algorithm) {
            this.switchAlgorithm(data, configuration);
        }
    }

    setEnabled(enabled) {
        if (this._enabled === enabled) return;
        //todo disable GUI controls... such as toolbar etc..
        this._enabled = enabled;
        if (enabled) {
            this.setStatus("Enabled.");
            this.strategy.enable();
        } else {
            this.setStatus("Disabled.", {error: true});
            this.strategy.disable();
        }
        this.setLoading(false);
    }

    refresh(withReload=true) {
        this._enabled = true;

        let dataSelection = [];
        for (let source of this.imageSources) {
            dataSelection.push("<option value='", source, "'>", source, "</option>");
        }
        $("#data-playground-select").html(dataSelection.join(""));

        if (withReload) {
            this.switchUnderlyingData(this.imageSources.some(img => img === this.underlyingData) ?
                this.underlyingData : this.imageSources[0], true);
        }
    }

    setStatus(message, flags={}) {
        this.messageStatus.innerHTML = message;
        this.messageStatus.style.background = flags.error ? "var(--color-bg-warning)" : "";
        this.setLoading(!flags.error);
    }

    setLoading(isLoading) {
        if (this._loading !== isLoading) {
            this._loading = isLoading;

            let node = $("#play-status-notif div > span.dot-pulse");
            if (isLoading) node.removeClass("d-none");
            else node.addClass("d-none");
        }
    }

    switchAlgorithm(algId, jsonConfig=null) {
        if (!this._enabled || !algId || algId === this.activeAlgorithm) return;

        if (!this.setBusy(`Switching to a new algorithm...`)) {
            return;
        }
        this._loadAlgorithm(algId, this.underlyingData);
    }

    _loadAlgorithm(algId, data, jsonConfig=null) {
        const _this = this;
        if (!jsonConfig) jsonConfig = this.lastConfig;
        if (!jsonConfig) {
            this.finishBusy();
            throw "Playground must first call /prepare before /init";
        }

        this.setStatus(`Init algorithm <i>${this._algoJSON[algId].title || algId}</i>`, {loading: true});
        this.lastConfig = jsonConfig;
        this.activeAlgorithm = algId;

        UTILITIES.fetchJSON(`${this.setup.server}/init/${algId}`, {
            api: ["render", "overlap", "render_type"]
        }).then(json => {
            json = $.extend(true, {output: {"data": "pixels", "layers": 1, "rendering": []}}, json);
            this.setStatus("Ready.");

            if (json.output.data === "pixels") {
                let vis = this.getTheVisualization(json.output.name, json.output.rendering, json.output.layers);
                _this.strategy.prepareVisualization(vis, data, json.output.layers);
                jsonConfig.setup = json; //todo enable overriding json with existing setup if comes from history..?
                _this.strategy.initVisualization(_ => {
                    //todo better strategy? now just unpdates only on algo change
                    _this.refreshMenuForms(false, algId);

                    _this.strategy.load(jsonConfig, data, algId, true);
                    _this.finishBusy();

                    //setTimeout(_this.workflow.capture.bind(this.workflow), 1000, "init");
                });
            } else {
                _this.strategy.load(jsonConfig, data, algId, false);
                _this.finishBusy();
            }
        }).catch(e => {
            _this._handleErrorResponse("Algorithm initialization failed.", e);
        });
    }

    _handleErrorResponse(details, error) {
        this.strategy.clear();
        if (error instanceof HTTPError) {
            switch (error.code) {
                case 503:
                    details = "No response: is the server running? <br>URL:&nbsp;<code>\" + this.setup.server + \"</code>\"";
                    Dialogs.show("Playground: " + details, 5000, Dialogs.MSG_ERR);
                    this.setStatus(details, {error: true});
                    break;
                default:
                    details = `Unknown error at the server. Please, restart the service. 
Note that for this plugin to work, you need to run a python playground server by yourself. <a onclick="${this.id}.refresh()">Retry</a>.`;
                    Dialogs.show("Playground: " + details, 5000, Dialogs.MSG_ERR);
                    this.setStatus(details, {error: true});
                    break;
            }
        } else {
            this.setStatus(details, {error: true});
        }

        this.finishBusy();
        //todor really unknown?
        console.warn("Unknown error.", details, error);
    }

    refreshMenuForms(refresh=false, algId=undefined) {
        //todo allways called with refresh=false ...-> remove
        if (refresh)  this.strategy.refresh();
        this.menu.cacheInputs();
        this.lastConfig.formdata = this.menu.getCachedInput(algId || this.activeAlgorithm);
    }

    getPostData() {
        return this.lastConfig;
    }

    //todo remove?
    changeRendering(self, layerId) {
        let _this = $(self),
            type = _this.val();
        let factoryClass = WebGLModule.ShaderMediator.getClass(type);
        if (factoryClass !== undefined) {
            //todo valid? really each visualization...?
            this.webglEngine.foreachVisualisation(vis => vis.shaders[layerId].type = type);
            this.webglEngine.rebuildVisualisation(null);
            VIEWER.world.draw();
            VIEWER.navigator.world.draw();
        }
        _this.html("");
    }
}

addPlugin("playground", Playground);
