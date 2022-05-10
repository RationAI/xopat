# Pathopus - OpenSeadragon-based histology data visualizer

A flexible way of visualisation of multiple high resolution images overlaid.

The visualisation is fully flexible. It, in fact, consists of two main logical groups. The first, **image** groups, 
is rendered AS-IS. It is meant for tissue scan to be shown. The second, **data** groups is rendered using our WebGL 
extension. 

## Environment, Build & Test
The visualization is not based on any framework, it is pure JavaScript application that integrates
various libraries. Automated building and testing is not yet available; you can just use the code as-is.
Later, automated testing and minification will be included.

## Setup
There are _docker_ composite builds available: https://github.com/RationAI/pathopus-docker.

#### DYI - Backend
The trickiest part is to set a correct configuration.
For that reason you can either set up things yourself, including capable image server; 
our server (https://github.com/xkacenga/iipsrv) which is fully compatible. More detailed description
on the process and requirements will be documented later. The good news is that all tile-serving
servers should be to some extent compatible.
Plugins require their own API so also check documentation of each plugin.
#### DYI - Frontend
1. Place the application to a folder from which PHP (**VERSION > 7.1**) can serve files (e.g. create WampServer configuration for localhost).
2. Change **config.php** configuration, most importantly the protocol used, correct paths and default URL(s) to image server(s).
3. Use the visualization by sending the `JSON` configuration via `HTTP POST` to the `index.php` (you will most likely want to have 
a script that is able to provide the user with a link, for reference see how `redirect.php` works).

## Configuration
Supported configuration for `index.php` - the visualisation itself, can be passed both in `POST` and `GET` requests.
The name of the argument is **`visualization`**, a JSON structure that sets up everything.

> Direct URL's are not supported, except for those generated within the application and sent to `redirect.php`, 
> _unless_ the post data is sent in `GET`. Note that this is not recommended as the size of the JSON configuration
> can be enormous.

Example configuration:
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
        }
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
                        "color": "#fa0058",
                        "use_gamma": 1.0
                    }
                }
            }      
        }
    ],
    "plugins": {
        "recorder": {}
    }    
}
````
**External parameters** &emsp;
We will use [R] for required and [O] for optional parameters.
- [R]`data` - an array of strings, defines the data, identifiers such that image server can understand it (most usually paths)
- [O]`params` - an object, visualisation parameters, supported:
    - [O]`customBlending` - allow to program custom blending, default `false`
    - [O]`debugMode` - run in debug mode if `true`, default `false`
    - [O]`webglDebugMode` - run debug mode on the post-processing, default `false`
    - [O]`activeVisualizationIndex` - index to the visualization array: which one to start with, default `0`
    - [O]`preventNavigationShortcuts` - do not bind navigation controls if `true` (note: default OSD keys still work)
    - [O]`viewport` - where to focus on load, default `undefined`
        - [R]`point` - center of the focus
        - [R]`zoomLevel` - level of the zoom
    - [O]`scaleBar` - show scale, does not show if microns not defined, default `true`,
    - [O]`microns` - real world units to pixels mapping, default `undefined`,
    - [O]`grayscale` - enforce grayscale transfer, default `false`,
    - [O]`tileCache` - use tile caching, default `true`,
    - [O]`permaLoadPlugins` - remember loaded plugins, default `true`,
    - [O]`bypassCookies` - do not use cookies, default `false`, cookies are necessary for user setup memory
    - [O]`theme` - look and feel, values `"auto"`, `"light"`, `"dark_dimmed"`, `"dark"`, default `"auto"`, 
- [O]`background` - an array of objects, each defines what images compose the **image** group
    - [R]`dataReference` - index to the `data` array, can be only one unlike in `shaders`
    - [O]`lossless` - default `false` if the data should be sent from the server as 'png' or 'jpg'
    - [O]`protocol` - see protocol construction below in advanced details
- [O]`shaderSources` - an array of objects, more details in `./webgl/shaders/`, each object defines:
    - [R]`url` - url where to fetch the shader implementation
    - [R]`typedef` - the type which can be referenced later in `shaders`, make sure it has unique value
        - NOTE: this value must equal to the shader id registered in the `ShaderMediator`, see `./webgl/shaders/`
    - [O]`headers` - arbitrary headers
- [O]`visualization` - array of objects that define visualisations (sometimes we say _visualization goals_) of the **data** group,
it is an inherited configuration interface of the WebGL module extended by option `fixed` and `protocol`
    - [R]`shaders` - a key-value object of data instances (keys) tied to a certain visualisation style (objects), the data layer composition is defined here, 
        - [R]`type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` or `none` (used when the data should be used in different shader); can be also one of custom-defined ones 
        - [R]`dataReferences` - indices **array** to the `data` array
        - [O]`visible` -  `1` or `0`, `true` of `false`, whether by default the data layer is visible
        - [O]`name` - name of the layer: displayed to the user
        - [O]`fixed` - if `false`, user is able to change the visualisation style, default `true`
            - shaders can then reference `data` items using index to the `dataReferences` array
            - e.g. if `shader_id_1` uses texture with index `0`, it will receive data to `"path/to/probability.tif"`
        - [O]`params` - special parameters for defined shader type (see corresponding shader), default values are used if not set or invalid
    - [O]`name` - visualisation goal name 
    - [O]`lossless` - default `true` if the data should be sent from the server as 'png' or lossy 'jpg'
    - [O]`protocol` - see protocol construction below in advanced details
- [O]`plugins` - a plugin id to object map, the object itself can contain plugin-specific configuration, see plugins themseves
- [O]`dataPage` - an unique page ID to object mapping, each object consists of
    - [O]`title` - the page menu button title
    - [O]`page` - a list of nodes of UI building blocks to generate data reports, where each node:
        - [R]`type` - a node type, can be either "columns", "vega" or one of keys of `UIComponents.Elements` interface; based on the node type other
        parameters are supported (interface nodes are described at the definition)
        - [O]`classes` - a space separated list of classes to add to the generated HTML
        - [R type=columns]`children` - a list of nodes to place in columns
        - [R type=vega]`specs` - a VEGA visualization grammar configuration for a particular GRAPH
    
<details>
 <summary>Advanced features:</summary>

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
To use custom protocol, pass a string that can be evaluated as a JavaScript code to a valid URL. It must be one-liner expression, which
can use two variables: `path` and `data`. `path` contains absolute url to the default image-serving script (as set in `config.php`). Note that `vis.protocol` 
expression receives a string **list** in the `data` parameter (array of selected images), whereas
`background.protocol` only a single string (one image). That means a server behind `vis.protocol` url must be able to serve simultaneously multiple images. These images
must be concatenated below each other into a single bigger image (see the `webgl` module for more details).

Examples:
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

## Structure
In each folder you will find a `README` document that describes the given component in more detail. For now, only
this README and description of MODULES and PLUGINS system are up-to-date.

### `./`
Root folder contains 
- basic application scripts:
    - `index.php` - the viewer itself which you need to send JSON configuration to
    - `config.php` - static viewer configuration (default server URLs, protocols...)
    - `dev_setup.php` - interface for customizable visualization setup which you can open
    - `redirect.php` - internal interface for URL to configuration translation, used with exported URLs
    - `error.php` where you are redirected when a fatal error occurs (usually malformed/missing configuration)
- `.js` files together with third-party dependencies inside `./external/` folder
- two basic styles `github.css` (bootstrap _Primer CSS_, [documentation available here](https://primer.style/css)) and `style.css` (see the style sheet for pre-defined classes with use examples)

<!--#### New Handlers
For flawless execution, `VIEWER` fires additional events:
TODO move :
tiled-image-force-remove -> has e.worldIndex
key-down -> has e.focusCanvas
key-up -> has e.focusCanvas-->

### `./external/`
Always-present third-party libraries and styles which are guaranteed to be included.
The exception is the `monaco` editor which is also available, but only in a different window
context via the `Dialogs` interface.

### `./assets/`
Own images and styles.

### `plugins.php` and `./plugins/`
The visualizer supports **plugins** - a `JavaScript` files that, if certain policy is kept, allow seamless integration 
of functionality to the visualizer GUI. See `./plugins/README.md`. Plugins are placed in `./plugins/` folder.

### `modules.php` and `./modules/`
The visualizer supports **modules** - a `JavaScript` libraries: it is a more dynamic version of `./external/`.
Modules allow versatile library inclusion: plugins and other modules can declare dependency: 
this dependency is resolved and necessary items are included (in the right order).
See `./modules/README.md`. Modules are placed in `./modules/` folder.

### `./openseadragon/` 
OpenSeadragon third-party javascript library the whole visualisation builds on. `debug` contains unminified version for debugging & OSD modifications.
These are in their own, explicit folders since this is the core functionality of the tiled, high-resolution image visualizations.
