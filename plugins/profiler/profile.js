addPlugin('profiler', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.page = new AdvancedMenuPages(this.id);
        this.records = [];
    }

    getVegaBoxPlot(data) {
        return {
            "$schema": "https://vega.github.io/schema/vega/v5.json",
            "description": "A tile fetching duration box plot.",
            "width": 450,
            "padding": 5,
            "signals": [
                { "name": "plotWidth", "value": 60 },
                { "name": "height", "update": "plotWidth + 10"}
            ],
            "data": [
                {
                    "name": "frames",
                    "values": data
                }
            ],
            "scales":[{"name":"xscale","type":"linear","range":"width","round":true,"domain":
                {"data":"frames","field":"ms"},"zero":false,"nice":true}],
            "axes":[{"orient":"bottom","scale":"xscale","zindex":1}],
            "marks":[{"type":"group","data":[{"name":"summary","source":"frames","transform":[{"type":
                "aggregate","fields":["ms","ms","ms","ms","ms"],"ops":["min","q1","median","q3","max"],
                "as":["min","q1","median","q3","max"]}]}],"marks":[{"type":"rect","from":{"data":"summary"},
                "encode":{"enter":{"fill":{"value":"black"},"height":{"value":1}},"update":{"yc":{"signal":
                "plotWidth/2","offset":-0.5},"x":{"scale":"xscale","field":"min"},"x2":{"scale":"xscale",
                "field":"max"}}}},{"type":"rect","from":{"data":"summary"},"encode":{"enter":{"fill":{"value":
                "steelblue"},"cornerRadius":{"value":4}},"update":{"yc":{"signal":"plotWidth/2"},"height":
                {"signal":"plotWidth/2"},"x":{"scale":"xscale","field":"q1"},"x2":{"scale":"xscale","field":
                "q3"}}}},{"type":"rect","from":{"data":"summary"},"encode":{"enter":{"fill":{"value":
                "aliceblue"},"width":{"value":2}},"update":{"yc":{"signal":"plotWidth/2"},"height":{"signal":
                "plotWidth/2"},"x":{"scale":"xscale","field":"median"}}}}]}
            ]
        }
    }

    exportFile() {
        UTILITIES.downloadAsFile(
            `tile-request-times-layers-${VIEWER.bridge?.visualization()?.order.length || 'missing'}.json`,
            JSON.stringify(this.records));
    }

    pluginReady() {
        const _this = this;
        this.snapshots = OpenSeadragon.Snapshots.instance();
        let cache;
        this.snapshots.addHandler('play', function () {
            _this.records = [];

            let Job = class extends OpenSeadragon.ImageJob {
                start() {
                    super.start();
                    this.time = Date.now();
                }
                finish(data, request, errorMessage ) {
                    _this.records.push(Date.now() - this.time);
                    super.finish(data, request, errorMessage);
                }
            };
            cache = OpenSeadragon.ImageJob;
            OpenSeadragon.ImageJob = Job;

            console.profile("recording");
        });
        this.snapshots.addHandler('stop', async function () {
            const sleep = time => new Promise(res => setTimeout(res, time));
            let wait = 0;
            Dialogs.show("Profiling has finished. Waiting for all requests to finish before rendering the results: please wait.",
                8000,
                Dialogs.MSG_INFO)
            while (VIEWER.imageLoader.jobsInProgress > 1 && wait < 30000) {
                wait += 500;
                await sleep(500);
            }

            OpenSeadragon.ImageJob = cache;
            cache = null;
            console.profileEnd("recording");

            _this.page.buildMetaDataMenu([{
                title: 'Profiler output',
                id: 'profiler-output',
                page: [{
                    type: "header",
                    title: "Profiling output",
                    classes: "f2-light"
                },{
                    type: "text",
                    content: `Measured requests for tiles (number of requests is ${_this.records.length}, min: ${Math.min(..._this.records)} ms, max: ${Math.max(..._this.records)} ms. Below is the boxplot from the measurements.`,
                },{
                    type: "vega",
                    classes: "color-bg-white",
                    vega: _this.getVegaBoxPlot(_this.records.map(r => ({ms: r})))
                }, {
                    type: "text",
                    content: "You can download the raw data here:"
                }, {
                    type: "button",
                    title: "Download as JSON",
                    action: `plugin('${_this.id}').exportFile();`
                }]
            }], false);

            _this.page.openMenu('profiler-output');
        });
    }
});
