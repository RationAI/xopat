// import './geotiff-tilesource.min.js';
// globalThis.GeoTIFFTileSource.enableGeoTIFFTileSource(OpenSeadragon, {
//     workerUrl: "modules/geotiff/assets/tiff.worker-C-TorwXd.js",
// });

import {enableGeoTIFFTileSource} from "./dist/geotiff-tilesource.lite.mjs";
enableGeoTIFFTileSource(OpenSeadragon, {
    workerUrl: "modules/geotiff/dist/assets/tiff.worker-BPpoNmhb.js",
});