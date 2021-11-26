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
- `ignoreCookiesCache` - whether user cookies cache should be considered
- `image` - data for the image layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"test/experiments/TP-2019_7207-03-1-vis.tif"` path
- `layer` - data list for the data layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"path/to/img1.tif,path/to/img2.tif,different/path/img3.tif"` a list of paths
- inherited **GET-only** switches and other **POST-only** parameters from plugins used

_Example URL_: Direct URL's are not supported, except for those generated within the application.



The visualisation always needs `visualisation` data parameter so that it knows what to render.
Then, based on the presence of `visualisation` the user is
- shown the visualisation if present
- redirected to `user_setup.php` if missing, and both `image` and `layer` parameters are set
- shown error otherwise

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
                   "type": "identity", 
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
**External parameters** &emsp;
All items are required except for items inside `params` field and the exception of `type`/`source`. 
In fact, some (such as `params` or `name` are somehow derived if missing).
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

**Internal parameters** &emsp;
The visualisation can internally support more parameters, these are set when the application is running and then used to
support various caching. Worth noting are
- `order` parameter for each visualisation goal, which can be an array of shader ID's - this order define the order of rendering, note that all data that is being
rendered must be present (e.g. all data where in the data settings `visible=1` is set)
- `cache` object inside each shader definition, contains cached values from the shader usage, its properties are dependent on the
shader type, so always check whether a desired property exists or not
    - it is in fact equal to default values overriding
    - it is data-type dependent, so if you enter different value than expected by the shader, you will break things
    

####  `plugins.php` and `./plugins/`
The visualizer supports **plugins** - a `JavaScript` files that, if certain policy is kept, allow seamless integrating 
of functionality to the visualizer. See `./plugins/README.md`. Plugins are placed in `./plugins/` folder.

### `./webgl/`
Contains modified version of WebGl plugin for OpenSeadragon. It is an application capable of parsing the visualisation
parameters, loading & compiling shaders and using them to draw on a canvas, passed to OpenSeadragon.

### `./dynamic_shaders/`
`PHP` scripts that generate 'shader parts'. These scripts use `"shaders"` array to create a shader used for each visualisation.

### `./osd/` or `./osd_debug/`
OpenSeadragon third-party javascript library. `debug` contains unminified version for debugging & OSD modifications.
