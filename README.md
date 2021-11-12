# Histoviso - OpenSeadragon-based histology data visualizer

This visualiser uses OpenSeadragon together with _fabric.js overlay_ and modified _webGL_ OSD plugins to render 
tissue scans and neural network outputs.

The basic idea is to have a tissue scan in pyramidal `TIFF` and multiple grayscale image sources (also pyramidal).
The data is requested on server by using modified version of `Deepzoom` protocol (we send multiple images at once, so
multiple sources need to be defined) and rendered onto canvas using WebGL.


### Structure

In each folder you will find a `README` document that describes the given component in more detail.

### `./`
Root folder contains two basic styles `github.css` (bootstrap _Primer CSS_, [documentation available here](https://primer.style/css)) and `style.css` (custom style) and `index.php` - files 
that are the skeleton of the visualizer. 

The visualizer consists of two layers. The first, **image layer**, is rendered AS-IS. It is meant for tissue scan
to be shown. The second, **data layer** is rendered using our WebGL extension from an arbitrary number of image sources
 and uses the JSON parametrization described below.

Supported arguments for `index.php` - the visualisation itself, can be passed both in `POST` and `GET` requests:
- `visualisation` - a `JSON` structure describing the visualisation setup, **only allowed in `POST`**
- `image` - data for the image layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"test/experiments/TP-2019_7207-03-1-vis.tif"` path
- `layer` - data list for the data layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"path/to/img1.tif,path/to/img2.tif,different/path/img3.tif"` a list of paths
- inherited **GET-only** switches and other **POST-only** parameters from plugins used
- `cache` - internal object passed to the visualiser if opened from exported file, stores modifications performed by the user, 
ignored if the `visualisation` was not set

The behaviour is that either the visualisation is defined by the `JSON` parameter, or `image` and `layer` values
are used to redirect the user to a custom user setup page.

TODO fix
_Example URL_: http://ip-78-128-251-178.flt.cloud.muni.cz/iipmooviewer-jiri/OSD/index.php?image=horak/512.tif&layer=horak/3chan.tif



The visualisation always needs `image` and `layer` data so that it knows what to render (will be changed in near future).
Then, based on the presence of `visualisation` the user is
- shown the visualisation if present
- shown the visualisation if missing but a cached version is available and `new` is not set
- redirected to `user_setup.php` if missing, where a cached version is available and `new=1` is set
- redirected to `user_setup.php` if both the aforementioned parameter and cached version are missing

#### ``visualisation`` parameter example
````JSON
[{    
      "name": "A visualisation setup 1",
      "params": {
            "uniqueId": "myPlugin",
            "losslessImageLayer": false,
            "losslessDataLayer": true
      }, 
      "data": "path/to/tissue/scan.tif",
      "shaders": {
            "path/to/annotation/layer.tif": { 
                   "name": "Annotation layer",
                   "type:": "identity", 
                   "visible": "1", 
                   "params": { }
            },
            "path/to/probability/layer.tif": {
                   "name": "Probability layer",
                   "type": "edge", 
                   "visible": "1", 
                   "params": { 
                      "color": "#fa0058"
                   }
            }
      }
 },
... //multiple visualisation presets allowed
]
````
All items are required except for items inside `params` field and the exception of `type`/`source`.
- `name` - visualisation name
- `params` - visualisation parameters, supported:
    - `uniqueId` - necessary only to set up in case multiple instances of webGL framework are running
    - `losslessImageLayer` - optional, whether the first layer (tissue) should use lossless data transfer, default `false`
    - `losslessDataLayer` - optional, whether the second layer (data) should use lossless data transfer, default `true`
- `data` - defines the data (path to the pyramidal tif such that that server can understand it) for the first layer (tissue scan), can be omitted (see below)
- `shaders` - a key-value object of data instances (keys) tied to a certain visualisation style (objects), the data layer composition is defined here, 
the key defines the data (e.g. path to the pyramidal tif such that that server can understand it)
    - `name` - name of the layer: displayed to the user
    - one of the following two:
        - `type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` or `none` (used when the data should be used in different shader); can be missing if `source` is defined
        - `srouce` - full URL to a shader part source, expects the output of a shader part (JSON-encoded), for more information see ˙./dynamic-shaders/README.md˙, optional and ignored if `type` defined
    - `visible` -  `1` or `0`, whether by default the data layer is visible
    - `params` - special parameters for defined shader type (see corresponding shader), default values are used if not set or invalid

####  `plugins.php`
The visualizer supports **plugins** - a `JavaScript` files that, if certain policy is kept, allow integrating functionality
to the visualiser. See `./plugins/README.md`.

### `./webgl/`
Contains modified version of WebGl plugin for OpenSeadragon. Contains also a folder with used shaders (will be slowly moved to `./dynamic_shaders/`).

### `./dynamic_shaders/`
`PHP` scripts that generate 'shader parts'. These scripts use `"shaders"` array to create a shader used for each visualisation.

### `./osd/` or `./osd_debug/`
OpenSeadragon third-party javascript library. `debug` contains unminified version for debugging.

### `./plugins/`
Where folders with plugins are placed.

