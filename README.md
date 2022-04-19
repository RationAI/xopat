# Histoviso - OpenSeadragon-based histology data visualizer

This visualiser uses OpenSeadragon together with _fabric.js overlay_ and modified _webGL_ OSD plugins to render 
tissue scans and neural network outputs.

The basic idea is to have a tissue scan in pyramidal `TIFF` and multiple grayscale image sources (also pyramidal).
The data is requested on server by using modified version of `Deepzoom` protocol (we send multiple images at once, so
multiple sources need to be defined) and rendered onto canvas using WebGL.

However, the visualisation is fully flexible. It, in fact, consists of two parts. The first, **image part**, 
is rendered AS-IS. It is meant for tissue scan to be shown. The second, **data part** is rendered using our WebGL 
extension uses the JSON parametrization described below. You can
 - have arbitrary number of images in the image part, these will be fully opaque or transparent, each in it's own canvas
 - have arbitrary number if images in the data part, these will be rendered together into one canvas using your setup.

## Setup
It should be easy to get the application running, the trickiest part is to set 
a correct configuration. 
1. Place the application to a folder from which PHP (**VERSION > 7.1**) can serve files (e.g. create WampServer configuration for localhost)
2. Change **config.php** configuration, most importantly
    - _PROTOCOL_: whether to use `http` or `https`
    - _SERVED_IMAGES_: path to the server that can handle regular tile requests for a single image; and _SERVED_LAYERS_: path to the server that can handle tile requests for image arrays:
        - note that _SERVED*_ values are only passed to the URL-request image creation (see _Protocol construction_ below)
    and it is up to the parameters how these values are used, and depending on your server you probably might want to override default URL creation process
        - note that the visualization parent server must allow `Access-Control-Allow-Origin "*"` CORS policy if you make cross-domain requests
        (e.g. _SERVED*_ URLs are on a different server)
3. Use the visualization by sending the `JSON` configuration via `HTTP POST` to the `index.php` (you will most likely want to have 
a script that is able to provide the user with a link, for reference see how `redirect.php` works)


## Structure
In each folder you will find a `README` document that describes the given component in more detail.

### `./`
Root folder contains 
- basic application scripts:
    - `index.php` - visualisation itself
    - `user_setup.php` & `dev_setup.php` interfaces for customizable visualization setup
    - `error.php` where you are redirected when a fatal error occurs (usualy bad initialization)
- `.js` files together with third-party dependencies inside `./external/` folder
- two basic styles `github.css` (bootstrap _Primer CSS_, [documentation available here](https://primer.style/css)) and `style.css` (custom style)

Supported arguments for `index.php` - the visualisation itself, can be passed both in `POST` and `GET` requests:
- `visualisation` - a `JSON` structure describing the visualisation setup, **only allowed in `POST`**
- `ignoreCookiesCache` - whether user cookies cache should be considered
- `image` - data for the image layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"test/experiments/TP-2019_7207-03-1-vis.tif"` path
- `layer` - data list for the data layer, ignored if `visualisation` set, both `POST` or `GET`
    - example: `"path/to/img1.tif,path/to/img2.tif,different/path/img3.tif"` a list of paths
- inherited **GET-only** switches and other **POST-only** parameters from plugins used

> Direct URL's are not supported, except for those generated within the application.

The visualisation always needs `visualisation` data parameter so that it knows what to render.
Then, based on the presence of `visualisation` the user is
- shown the visualisation if present
- redirected to `user_setup.php` if missing, and both `image` and `layer` parameters are set
- shown error otherwise

#### ``visualisation`` parameter [full example]
````JSON
{    
    "params": {
    }, 
    "data": ["path/to/tissue/scan.tif", "path/to/annotation.tif", "path/to/probability.tif"],
    "background": [
        {
            "dataReference": 0,
            "lossless": false,
            "protocol": "path + \"?Deepzoom=\" + data + \".dzi\";"
        }
    ],
    "shaderSources" : [
        {
            "url": "http://my-shader-url.com/customShader.js",
            "headers": {},
            "typedef": "new_type"
        }, 
        ...
    ],
    "visualizations": [
        {
            "name": "A visualisation setup 1",
            "lossless": true,
            "protocol": "path + \"#DeepZoomExt=\" + data.join(',') + \".dzi\";",
            "shaders": {
                "shader_id_1": { 
                    "name": "Advanced visualisation layer",
                    "type": "new_type", 
                    "fixed": false,
                    "visible": 1, 
                    "dataReferences": [2, 0],
                    "params": { }
                },
                "another_shader_id": {
                    "name": "Probability layer",
                    "type": "edge", 
                    "visible": 1, 
                    "dataReferences": [1],
                    "params": { 
                        "color": "#fa0058"
                    }
                },
                ...                           
            }      
        }, 
        ... multiple visualisations possible  
    ]   
}
````
The parameters shown above are inherited from the WebGL-based module, extended with the properties of
this application. Although the module was written for this application, it was designed so that it can be
re-used. The module is closely described in `./webgl/` folder.

**External parameters** &emsp;
We will use [R] for required and [O] for optional parameters.
- [O]`params` - visualisation parameters, supported:
    - [O]`customBlending` - allow to program custom blending, default `false`
    - [O]`debug` - run in debug mode if `true`, default `false`
    - [O]`activeVisualizationIndex` - index to the visualization array: which one to start with, default `0`
    - [O]`preventNavigationShortcuts` - do not bind navigation controls if `true` (note: default OSD keys still work)
    - [O]`viewport` - where to focus
        - [R]`point` - center of the focus
        - [R]`zoomLevel` - level of the zoom
    - [O] ... other optional parameters based on what plugins read and support, such as `experimentId` (see plugins themselves)
- [R]`data` - defines the data for background (a list of paths to the pyramidal tiffs such that that server can understand it), elements
of this list are essentially given to the construction of the protocol)
- [R]`background` - defines what images compose the **image part**, at least one element must be present
    - [R]`dataReference` - index to the `data` array, can be only one unlike in `shaders`
    - [0]`lossless` - default `false` if the data should be sent from the server as 'png' or 'jpg'
    - [0]`protocol` - see protocol construction below
- [0]`shaderSources` - array of objects, more details in `./webgl/shaders/`, each object must have these properties:
    - [R]`url` - url where to fetch the shader implementation
    - [0]`headers` - arbitrary headers
    - [R]`typedef` - the type which can be referenced later in `shaders`, make sure it has unique value
        - NOTE: this value must equal to the shader id registered in the `ShaderMediator`, see `./webgl/shaders/`
- [O]`visualization` - array of objects that define visualisations (sometimes we say _visualization goals_) of the **data part** 
    - [O]`name` - visualisation goal name 
    - [o]`lossless` - default `true` if the data should be sent from the server as 'png' or 'jpg'
    - [R]`shaders` - a key-value object of data instances (keys) tied to a certain visualisation style (objects), the data layer composition is defined here, 
the key defines the data (e.g. path to the pyramidal tif such that that server can understand it)
        - [0]`name` - name of the layer: displayed to the user
        - [R]`type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` or `none` (used when the data should be used in different shader); can be also one of custom-defined ones 
        - [R]`visible` -  `1` or `0`, `true` of `false`, whether by default the data layer is visible
        - [R]`dataReferences` - indices **array** to the `data` array
        - [O]`fixed` - if `false`, user is able to change the visualisation style, default `true`
            - shaders can then reference `data` items using index to the `dataReferences` array
            - e.g. if `shader_id_1` uses texture with index `0`, it will receive data to `"path/to/probability.tif"`
        - [O]`params` - special parameters for defined shader type (see corresponding shader), default values are used if not set or invalid

**Internal parameters** &emsp;
The visualisation can internally support more parameters, these are set when the application is running and then used to
support various sharing and caching. Worth noting are
- `order` parameter for each visualisation goal, which can be an array of shader ID's - this order define the order of rendering, note that all data that is being
rendered must be present (e.g. all data where in the data settings `visible=1` is set and which has no problems such as incorrect 
parameter values)
- `cache` object inside each shader definition, contains cached values from the shader usage, its properties are dependent on the
shader type, so always check whether a desired property exists or not
    - it is in fact equal to default values overriding
    - it is data-type dependent, so if you enter different value or data type than expected by the shader, you will break things
    
_Protocol construction_ &emsp;
To use custom-defined protocol, pass a string that can be evaluated as a JavaScript code to a valid URL. It must be one-liner expression, which
can use two variables: `path` and `data`. `path` contains absolute url to the default image-serving script (as set in `config.php`). Note that `vis.protocol` 
expression receives a string **list** in the `data` parameter (array of selected images), whereas
`background.protocol` only a single string (one image). That means a server behind `vis.protocol` url must be able to serve simultaneously multiple images. These images
must be concatenated below each other into a single bigger image (see the `webgl` module for more details).
<details>
 <summary>Examples:</summary>

- URL construction using **string concatenation** (note the need of `\"` escape as it has to be valid `JSON`)
    > "protocol": "path + \\"?Deepzoom=\\" + data + \\".dzi\\";"

    is the default behaviour for `background` and creates, if `path=http://serv.org/iipsrv.fcgi` and `data=my/data.tif`, url
`http://serv.org/iipsrv.fcgi?Deepzoom=my/data.tif.dzi` which is a DZI protocol request to IIPImage's `fcgi` script.

- URL construction using **ES6 String Template**

    > "protocol": "&grave;${path}#DeepZoomExt=${data.join(',')}.dzi&grave;"

    is the default behaviour for `visualizations` and creates, if `path=http://serv.org/iipsrv.fcgi` and `data=[my/data.tif, other/data.tif]`,
the `http://serv.org/iipsrv.fcgi#DeepZoomExt=my/data.tif,other/data.tif.dzi` url 
using string template one-liner (`;` is optional). The protocol in this
case is our custom protocol, able to handle multiple image acquisition as described above. Moreover, data behind `#` sign
is sent to as `HTTP POST` data in the request.   

</details>

#### New Handlers
For flawless execution, `VIEWER` fires additional events:
TODO DESCRIBE:
tiled-image-force-remove --> has e.worldIndex
key-down --> has e.focusCanvas
key-up --> has e.focusCanvas


#### TODO available style actions
--disabled, dot-pulse, ...


### `./external/`
Always-present third-party libraries and styles which are guaranteed to be included.

### `plugins.php` and `./plugins/`
The visualizer supports **plugins** - a `JavaScript` files that, if certain policy is kept, allow seamless integration 
of functionality to the visualizer GUI. See `./plugins/README.md`. Plugins are placed in `./plugins/` folder.

### `modules.php` and `./modules/`
The visualizer supports **modules** - a `JavaScript` libraries: it is a more dynamic version of `./external/`.
Modules allow versatile library inclusion: plugins and other modules can declare dependency: 
this dependency is resolved and necessary items are included (in the right order).
See `./modules/README.md`. Modules are placed in `./modules/` folder.

### `./dynamic_shaders/`
Deprecated structure, will be eventually removed.

### `./osd/` or `./osd_debug/`
OpenSeadragon third-party javascript library the whole visualisation builds on. `debug` contains unminified version for debugging & OSD modifications.
These are in their own, explicit folders since this is the core functionality of the tiled, high-resolution image visualizations.
