# XOpat - OpenSeadragon-based histology data visualizer

In minimum, two components are necessary to run the viewer: a backend service, an image server able to handle image requests;
and a front-end viewer. A crucial integration logics is described in the [integration document](../INTEGRATION.md), and
basic startup guidelines are at https://xopat.readthedocs.io.

## Configuration
Supported configuration for the visualization itself, can be passed both in `POST` and `GET` requests.

> There are at least four ways of opening the viewer:
>  - ``slides`` and `masks` query parameters, where a comma-separated list of data IDs is provided
>  - URL-encoded session after ``#`` hash in URL
>  - simplified GET arguments: ``http://localhost:9000?slides=slide,list&masks=mask,list``
>  - serialized session in GET (not recommended) ``http://localhost:9000#urlEncodedSessionJSONHere``
>  - serialized session in POST (see ``http://localhost:9000/dev_setup`` for simple interface to this method)
> 
> Furthermore, the viewer remembers last successfull session and 
> stores it inside the browser memory, so that opening a viewer without
> a valid session opens the last visited one.
> 
> NOTE: Plugins can override even this behavior. Check used plugin READMEs for more details.
> 


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
    "visualizations": [
        {
            "name": "A visualization setup 1",
            "lossless": true,
            "protocol": "path + \"#DeepZoomExt=\" + data.join(',') + \".dzi\";",
            "shaders": {
                "shader_id_1": { 
                    "name": "Advanced visualization layer",
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
- [O]`params` - an object, visualization parameters, supported:
    - [O]`sessionName` - unique ID of the session, overridable by `background` config (below)
    - [O]`locale` - language locale, default `en`
    - [O]`customBlending` - allow to program custom blending, default `false`
    - [O]`debugMode` - run in debug mode if `true`, default `false`
    - [O]`webglDebugMode` - run debug mode on the post-processing, default `false`
    - [O]`statusBar` - whether to show user action and system status hints, default `true`
    - [O]`activeBackgroundIndex` - index to the background array: which one to start with, default `0`
    - [O]`activeVisualizationIndex` - index to the visualization array: which one to start with, default `0`; note: this value is overridden by background if present
    - [O]`preventNavigationShortcuts` - do not bind navigation controls if `true` (note: default OSD keys still work)
    - [O]`viewport` - where to focus on load, default `undefined`
        - [R]`point` - center of the focus
        - [R]`zoomLevel` - level of the zoom
    - [O]`scaleBar` - show scale, does not show if microns not defined, default `true`,
    - [O]`grayscale` - enforce grayscale transfer, default `false`,
    - [O]`tileCache` - use tile caching, default `true`,
    - [O]`permaLoadPlugins` - remember loaded plugins, default `true`,
    - [O]`bypassCookies` - do not use cookies, default `false`, cookies are necessary for user setup memory
    - [O]`theme` - look and feel, values `"auto"`, `"light"`, `"dark_dimmed"`, `"dark"`, default `"auto"`, 
    - [O]`stackedBackground` - whether to show backgrounds as switchable slide show (`false`, default) or overlays
    - [O]`maxImageCacheCount` - cache size, how many image parts are cached for re-rendering use, default `1200`
    - [O]`preferredFormat` - format to prefer if not specified, must be respected by the used protocol
    - [O]`fetchAsync` - by default uses generic multiplexing on tile protocols to support async fetching, overrideable behaviour
    - [O]`bypassCache` - do not allow using cached values for the user, default `false`
    - [O]`bypassCacheLoadTime` - TODO: better name also affects cookies

- [O]`background` - an array of objects, each defines what images compose the **image** group
    - [R]`dataReference` - index to the `data` array, can be only one unlike in `shaders`
    - [O]`id` - unique ID for the background, created automatically from data path if not defined
    - [O]`lossless` - default `false` if the data should be sent from the server as 'png' or 'jpg'
    - [O]`protocol` - see protocol construction below in advanced details
    - [O]`protocolPreview` - as above, must be able to generate file preview (fetch top-level tile)
    - [O]`microns` - size of pixel in micrometers, default `undefined`,
    - [O]`micronsX` - horizontal size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
    - [O]`micronsY` - vertical size of pixel in micrometers, default `undefined`, if general value not specified must have both X,Y
    - [O]`name` - custom tissue name shown in the UI (renders the data path if not set)
    - [O]`sessionName` - overrides `sessionName` of global params if set
    - [O]`goalIndex` - preferred visualization index for this background, ignored if `stackedBackground=true`, overrides `activeVisualizationIndex` otherwise
- [O]`visualization` - array of objects that define visualizations (sometimes we say _visualization goals_) of the **data** group,
it is an inherited configuration interface of the WebGL module extended by option `fixed` and `protocol`
    - [R]`shaders` - a key-value object of data instances (keys) tied to a certain visualization style (objects), the data layer composition is defined here, 
        - [R]`type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` or `none` (used when the data should be used in different shader); can be also one of custom-defined ones 
        - [R]`dataReferences` - indices **array** to the `data` array
        - [O]`visible` -  `1` or `0`, `true` of `false`, whether by default the data layer is visible
        - [O]`name` - name of the layer: displayed to the user
        - [O]`fixed` - if `false`, user is able to change the visualization style, default `true`
            - shaders can then reference `data` items using index to the `dataReferences` array
            - e.g. if `shader_id_1` uses texture with index `0`, it will receive data to `"path/to/probability.tif"`
        - [O]`params` - special parameters for defined shader type (see corresponding shader), default values are used if not set or invalid
    - [O]`name` - visualization goal name 
    - [O]`lossless` - default `true` if the data should be sent from the server as 'png' or lossy 'jpg'
    - [O]`protocol` - see protocol construction below in advanced details
- [O]`plugins` - a plugin id to object map, the object itself can contain plugin-specific configuration, see plugins themseves

   
<details>
 <summary>Advanced features:</summary>

**Internal parameters** &emsp;
The visualization can internally support more parameters, these are set when the application is running and then used to
support various sharing and caching. Worth noting are
- `order` parameter for each visualization goal, which can be an array of shader ID's - this order define the order of rendering, note that all data that is being
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

### `../`
Root folder contains 
- basic application scripts:
    - `index.php` - the viewer itself which you need to send JSON configuration to
    - `config.php` - static viewer configuration (default server URLs, protocols...)
    - `dev_setup.php` - interface for customizable visualization setup which you can open
    - `redirect.php` - internal interface for URL to configuration translation, used with exported URLs
    
### `./`    
- `.js` files together with third-party dependencies inside `./external/` folder and `.php` utility files
- two basic styles `github.css` (bootstrap _Primer CSS_, [documentation available here](https://primer.style/css)) and `style.css` (see the style sheet for pre-defined classes with use examples)

### `./external/`
Always-present third-party libraries and styles which are guaranteed to be included.
The exception is the `monaco` editor which is also available, but only in a different window
context via the `Dialogs` interface.

### `./assets/`
Own images and styles.

### `../plugins/`
The visualizer supports **plugins** - a `JavaScript` files that, if certain policy is kept, allow seamless integration 
of functionality to the visualizer GUI. See `./plugins/README.md`. Plugins are placed in `./plugins/` folder.

### `../modules/`
The visualizer supports **modules** - a `JavaScript` libraries: it is a more dynamic version of `./external/`.
Modules allow versatile library inclusion: plugins and other modules can declare dependency: 
this dependency is resolved and necessary items are included (in the right order).
See `./modules/README.md`. Modules are placed in `./modules/` folder.

### `../openseadragon/` 
OpenSeadragon **v6+** third-party javascript library the whole visualization builds on. `debug` contains unminified version for debugging & OSD modifications.
These are in their own, explicit folders since this is the core functionality of the tiled, high-resolution image visualizations.
OpenSeadragon is not included by default, but you can clone it inside this repository to use internal
copy of the library. You can also use CDN or different location of OpenSeadragon, but it must be of a v6+.
The OSD location is configurable through the ENV.

## Available API

The viewer comes with many available features. Here will be described only where to look for them, most functions are
either documented or self-explanatory named. Some selected API is described in plugins root ``README``.
Some OpenSeadragon extensions and custom TileSources are placed within ``external``, styles and asset related stuff in `assets`.
Definition of UI builder classes are in ``ui_components.js`` whereas existing UI menus are defined along with their (**You should use new UI components, see [this](../../../../../Repos/xopat-shadowaya/ui/README.md)
**)
enriched API in ``user_interface.js``. `layers.js` take care of overlay rendering interaction with the UI and
the engine setup. ``scripts.js`` contain various utility functions - we encourange browsing
the documentation API page.

Outside, ``../index.php`` file takes care of the main UI layout and basic functionality around parameter and metadata
handling, plugin and module loading and the viewport and events management.

Many features are available through ``modules`` that implement additional important functionality.

### UI
**You should use new UI components, see [this README](../ui/README.md)**.
Components are accessible through `UI` global variable. ``user_interface.js`` creates
a global API ``USER_INTERFACE`` with many UI utilities (notifications, existing menus API...).
The UI builds upon *tailwind* css and *Daisy UI* system.

> We recommend re-using and extending these instead of pulling new dependencies.
> Please, make yourself familiar with the UI API before making new features. 
> Especially, if you need some component that is likely present in DaisyUI, but
> has no corresponding component here, create one in the ``ui/classes/elements`` folder
> so that others can use it too.

### Localization
Is possible through ``i18next`` library and also server-side with `i18n` class (with limited capabilities).
To access the api, use ``$.t(...)`` method to translate. The `i18n` instance is stored in `$.i18n`.
You can use also the (other) API of ``jquery i18next``.
In spawned child window, the translation is available also through ``$`` symbol, but ``jquery i18next`` is not available.

For plugins localization, see the plugins README.

### Advanced: Re-using parts of the CORE SERVER in PHP and JS
<details>
<summary>Reusing the Viewer Code in custom apps.</summary>
A good idea is to look at the server's implementation of the developer setup page.
This way, you can load parts of the viewer code into any web page, using
either Node.js, PHP, or other available server implementation.
This is an example how to include modules and plugins API with loading capabilities
to a custom PHP script:

```php
// load static config and core functions
require_once "src/core.php";
// load plugins and modules (required by plugins)
include_once(PROJECT_SOURCES . "plugins.php");

global $PLUGINS, $MODULES;

// use require_*() to load parts of the core - prints JS script tags to attach
// optionally add other parts of the core - .js files
// choose some of these to load (files to load are mapped in the env file)
//    require_libs(); // libs - jquery, i18next... /src/libs
//    require_openseadragon(); // osd viewer
//    require_external(); // external dependencies (some of src/external)
//    require_core("loader"); // dynamic component loading
//    require_core("deps"); // UI classes, shader configurator

// set up here which modules/plugins are to be
// statically loaded by setting $item["loaded"] = true;
// and print them to the HTML:
require_modules();
require_plugins();

// if we include this
require_core("loader");
// we can do in javascript later
?>
<script>
async function() {
    // loader needs this data from the plugins.php
    const runLoader = initXOpatLoader(
        <?php echo json_encode($PLUGINS) ?>,
        <?php echo json_encode($MODULES) ?>,
        '<?php echo PLUGINS_FOLDER ?>',
        '<?php echo MODULES_FOLDER ?>',
        '<?php echo VERSION ?>',
        // for demonstration purposes, we request awaiting loader, which makes sure all
        // plugins finish their initialization, default is false
        true  
    );
    await runLoader();

    UTILITIES.loadModules(() => {
        console.log('Loaded, yay!');
    }, 'module', 'id', 'list', 'to', 'load', 'dynamically');
}();
</script>
```
The same works for the Node.js server, but with slightly different syntax.
</details>
