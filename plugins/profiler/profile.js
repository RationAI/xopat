Profiler = class {

    constructor() {

    }

    pluginReady() {
        this.snapshots = OpenSeadragon.Snapshots.instance();
        let records, cache;
        this.snapshots.addHandler('play', function () {
            records = [];

            let Job = class extends OpenSeadragon.ImageJob {
                start() {
                    super.start();
                    this.time = Date.now();
                }
                finish(data, request, errorMessage ) {
                    records.push(Date.now() - this.time);
                    super.finish(data, request, errorMessage);
                }
            };
            cache = OpenSeadragon.ImageJob;
            OpenSeadragon.ImageJob = Job;

            console.profile();
        });
        this.snapshots.addHandler('stop', function () {
            OpenSeadragon.ImageJob = cache;
            cache = null;
            console.profileEnd();

            //download after while
            setTimeout(function () {
                UTILITIES.downloadAsFile(
                    `tile-request-times-layers-${VIEWER.bridge.visualization().order.length}.json`,
                    JSON.stringify(records));
            }, 500);
        });
    }
};
addPlugin('profiler', Profiler);
