# WebGL in OpenSeadragon [NEEDS UPDATES]
Module for WebGL-based post-processing of images. Supports arrays of images concatenated into one image vertically.
Multiple images can be post-processed using various strategies (which can be dynamically changed) and the result is
blended into one resulting image. It is highly customizable and allows for multiple contexts in use.

A bridge javascript file enables plugin-like integration to OpenSeadragon. But you can use this module (except the bridge class obviously) for any suitable purpose, without employing the OpenSeadragon library.

You can run multiple visualisation goals (ways of pre-defined visualisation style, e.g. what shaders-layers are drawn with what data); 
and each goal can define arbitrary amount of layers to render into the output canvas, using highly customizable shaders 
(downloadable from custom sources). These layers can be manually re-ordered, changed and further parametrized by the user 
in the real time. For more information on dynamic shaders, see `./shaders/README.md`.

Constructors of both `OpenSeadragonGL` and `WebGLWrapper` accept `options` argument
- `options.ready()` function called once the visualisation is prepared to render, for the first time only
- `options.htmlControlsId` id of a HTML container where to append visualisation UI controls (basically appends the output of `htmlShaderPartHeader`)
- `options.htmlShaderPartHeader(title, html, dataId, isVisible, layer, isControllable = true)` function for custom UI html controls (ignored if `htmlControlsId` not set)
- `options.resetCallback()` function called when user changes a value using shader controls and the shader layer requests update: here OSD bridge registers redraw event 
- `options.visualisationReady(i, visualisation)` function called once a visualisation is processed (which might result in error, in that case `visualisation.error` is set)
- `options.visualisationInUse(visualisation)` called once every time if the visualisation was sucesfully compiled and linked (e.g. when user re-orders the layers or switches to this new goal)
- `options.visualisationChanged(oldVis, newVis)` function called when visualisation goals are switched between
- `options.onError(error)` called when exception (usually some missing function) occurs and the visualization is somewhat able to continue
- `options.onFatalError(error)` called when key functionality fails and the module is probably unusable

Constructor of `OpenSeadragonGL` furthermore expects `useEvaluator()` function callback predicate that handles the decision whether
this module is going to be used on the given OSD TileSource post-processing. 

### Setting up the visualisation

Visualisation and data must be set up. Then, you can also add custom shaders if you want and call `prepare()` and `init()`.

#### Visualisation settings
An example of valid visualisation goal (object(s) passed to `addVisualisation()`):

````JSON
{    
      "name": "A visualisation setup 1",
      "shaders": {
            "arbitrary_id": {
                   "name": "Probability layer",
                   "type": "color", 
                   "visible": "1", 
                   "dataSources": [1],
                   "params": { 
                      "color": "#fa0058"
                   }
            }
      }
}
````
- [O]`name` - visualisation goal name 
- [o]`lossless` - default `true` if the data should be sent from the server as 'png' or 'jpg'
- [R]`shaders` - a key-value object of data instances (keys) tied to a certain visualisation style (objects), the data layer composition is defined here, 
the key defines the data (e.g. path to the pyramidal tif such that that server can understand it)
    - [0]`name` - name of the layer: displayed to the user
    - [R]`type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` or `none` (used when the data should be used in different shader); can be also one of custom-defined ones 
    - [R]`visible` -  `1` or `0`, whether by default the data layer is visible
    - [R]`dataReferences` - indices **array** to the `data` array
        - shaders can then reference `data` items using index to the `dataReferences` array
        - e.g. if `shader_id_1` uses texture with index `0`, it will receive data to `"path/to/probability.tif"`
    - [O]`params` - special parameters for defined shader type (see corresponding shader), default values are used if not set or invalid

#### Data settings
Data must be loaded with compliance to the indices used in `dataSources` elements across the visualisation (strings / image srouce paths passed to `addVisualisation()`)
- the module will automatically extract an ordered subset of the given data in the order in which it expects the data to arrive
- see `WebGlWrapper.getSources()`

#### Custom shader types
An example of valid custom shader source declaration (object(s) passed to `addCustomShader()`):
````JSON
{
    "url": "http://my-shader-url.com/customShader.js",
    "headers": {},
    "typedef": "new_type"
}
````
- [R]`url` - url where to fetch the shader implementation
- [0]`headers` - arbitrary headers
- [R]`typedef` - the type which can be referenced later in `shaders`, make sure it has unique value



### webGLToOSDBridge.js
Binding of WebGLWrapper to OpenSeadragon. The API is docummented in the code. A recommended use is:
```js
var seaGL = new OpenSeadragonGL({...}, drawingEvent => {return true;});
var osd = new OpenSeadragon({...}); //init OSD without specifying the TileSources to load - delay the initialization

//load shaders now
seaGL.loadShaders(function() {
    //fire OpenSeadragon initialization after WebGLWrapper finished and the rendering can begin
    osd.open(...);
});
seaGL.init(osd); //calls seaGL.loadShaders(...) if not performed manually
```

### webGLWrapper.js
Wrapper for WebGL, handles all the visualiser-specific functionality, uses GlContextFactory to obtain an instance (GlContext) that renders the data.

### webGLContext.js
Includes GlContextFactory definition and its default subclass that implements `getContext()` and returns either `WebGL20` or `WebGL10` that behave as a `State` pattern, providing either WebGL 2.0 (if supported) or WebGL 1.0 (fallback) functionality respectively.
