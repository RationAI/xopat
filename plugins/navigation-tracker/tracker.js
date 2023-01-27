addPlugin("nav-tracker", class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.id = id;
        this.records = {};
        this.canvasWidth = 250;
    }

    getCanvas(key=this.key) {
        return this.getContext()?.canvas;
    }

    getContext(key=this.key) {
        let context = this.records[key];
        if (!context) {
            let canvas = document.createElement("canvas");
            context = canvas.getContext('2d');
            this.records[key] = context;
        }
        return context;
    }

    refresh() {
        const conf = VIEWER.tools.referencedTiledImage()?.getBackgroundConfig();
        const index = Number.parseInt(conf?.dataReference);
        if (!Number.isInteger(index)) {
            //todo warn?
            console.error("Unable to load the viewport tracking!");
            return undefined;
        }
        this.key = APPLICATION_CONTEXT.config.data[conf.dataReference];
        this.recordCtx = this.getContext();
        this.record = this.recordCtx.canvas;
        const bounds = this.refreshCanvas(); //refreshes setup
        this.recordCtx.globalCompositeOperation = "lighten";
        return bounds;
    }

    refreshCanvas(canvas=this.record) {
        //todo support BG swaps, IO
        const homeBounds = VIEWER.viewport.getHomeBounds();
        homeBounds.width += 2*homeBounds.x; //todo consider setting 1 since it is computed to be 1 anyway
        homeBounds.height += 2*homeBounds.y;
        homeBounds.x = 0;
        homeBounds.y = 0;
        canvas.width = this.canvasWidth * homeBounds.width;
        canvas.height = this.canvasWidth * homeBounds.height;
        this._zoom = VIEWER.viewport.getHomeZoom();
        return homeBounds;
    }

    pluginReady() {
        const _this = this;
        this._renderEngine = new WebGLModule({
            uniqueId: "navtracker",
            onError: function(error) {

            },
            onFatalError: function (error) {
                console.error(error);
                _this._running = false;
            }
        });
        this._running = true;
        this._renderEngine.addVisualisation({
            shaders: {
                _ : {
                    type: "heatmap",
                    dataReferences: [0],
                    params: {color: "#ff0000", opacity: 0.6}
                }
            }
        });
        this._pixel = VIEWER.tools.imagePixelSizeOnScreen(); //todo compute always against home bounds of navigator in refreshCanvas

        const outputCanvas = _this._renderEngine.gl.canvas;
        new OpenSeadragon.MouseTracker({
            element: outputCanvas,
            enterHandler: e => e.originalEvent.target.style.opacity="0.3",
            leaveHandler: e => e.originalEvent.target.style.opacity="1.0",
        });

        this._renderEngine.prepare([""], () => {
            const bounds = _this.refresh();
            if (!bounds) return;

            _this._renderEngine.init(_this.record.width, _this.record.height);

            VIEWER.navigator.addOverlay({
                element: outputCanvas,
                location: bounds, //todo test updates
            });

            VIEWER.addHandler("update-viewport", e => {
                const viewport = e.eventSource.viewport;
                //so we dont lose too many values by rounding
                const zoom = Math.log2(viewport.getZoom(true)) / Math.log2(viewport.getMaxZoom());
                _this.recordCtx.fillStyle = `rgb(${Math.round(255*zoom)},0,0)`;
                _this.recordCtx.globalCompositeOperation = "lighten"; //todo why each time?

                const bounds = viewport.getBoundsNoRotate(true), size = _this.canvasWidth;
                _this.recordCtx.fillRect(size*bounds.x, size*bounds.y, size*bounds.width, size*bounds.height);
                _this._renderEngine.processImage(_this.record, {width: _this.record.width, height: _this.record.height}, _this.zoom, _this._pixel);
            });
        });
    }
});
