import { DICOMWebTileSource } from "./tileSource.mjs";
addPlugin('dicom-web', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        this.serviceUrl = this.getStaticMeta('serviceUrl');

        VIEWER_MANAGER.addHandler('before-open', e => {
            for (let bg of e.background) {
                const data = e.data[bg.dataReference];

                if (typeof data === "object" && (data.studyUID || data.seriesUID || data.instanceUID)) {
                    bg.tileSource = new DICOMWebTileSource({
                        baseUrl: this.serviceUrl,
                        studyUID: data.studyUID,
                        seriesUID: data.seriesUID,
                        instanceUID: data.instanceUID,
                        useRendered: this.getOption("useRendered", false),
                    });
                }
            }
        });
    }
      
    pluginReady() {

    }
});