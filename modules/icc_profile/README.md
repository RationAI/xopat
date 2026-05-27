# ICC Profiles

To avoid expensive re-computation and profile application while avoiding to put stress on servers,
this module binds to OpenSeadragon and applies icc profiles using WASM.

Download ``emsdk`` tool and build the necessary files using directives in the `build/icc` folder.

Support for icc profiles from the OpenSeadragon side is by providing a function within the desired `TileSource`:
````
/**
 * @returns {Promise<ArrayBuffer>}
 */
async downloadICCProfile() {
    // todo download data
    return data;
}
````


