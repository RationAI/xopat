# WebGL Module
Module for WebGL-based post-processing of images. Supports arrays of images concatenated into one image vertically, or an
array of images. Other input types can be supported by extending on data loader capabilities.
Multiple images can be post-processed using various strategies (which can be dynamically changed) and the result is
blended into one resulting image. It is highly customizable and allows for multiple contexts in use.

Setting up:
``include.json`` specifies how to load the module as a series of JS files. `requires` specifies other module dependence.


Constructor of `WebGLModule` accepts `options` argument
- `options.ready()` function called once the visualisation is prepared to render, for the first time only
- `options.htmlControlsId` id of a HTML container where to append visualisation UI controls (basically appends the output of `htmlShaderPartHeader`)
- `options.htmlShaderPartHeader(title, html, dataId, isVisible, layer, isControllable = true)` function to customize HTML rendering of the shader controls (ignored if `htmlControlsId` not set)
- `options.resetCallback()` function called when user changes a value using shader controls and the shader layer requests update: here OSD bridge registers redraw event 
- `options.visualisationReady(i, visualisation)` function called once a visualisation is processed (which might result in error, in that case `visualisation.error` is set)
- `options.visualisationInUse(visualisation)` called once every time if the visualisation was sucesfully compiled and linked (e.g. when user re-orders the layers or switches to this new goal)
- `options.visualisationChanged(oldVis, newVis)` function called when visualisation goals are switched between
- `options.onError(error)` called when exception (usually some missing function) occurs and the visualization is somewhat able to continue
- `options.onFatalError(error)` called when key functionality fails and the module is probably unusable
- `options.debug` - boolean, outputs debug information if true
- `options.uniqueId` - unique identifier, **must be defined if multiple WebGLModules are running** (note: can be left out for one of them), can contain
only `[A-Za-z0-9_]*` (can be empty, only numbers and letters with no diacritics or `_`) 

## WebGL in OpenSeadragon
> A javascript bridge file enables plugin-like integration to OpenSeadragon. But you can use this module (except the bridge class obviously) for any suitable purpose, without employing the OpenSeadragon library.

Constructor of `OpenSeadragon.BridgeGL` accepts `openSeaDragonInstance`, a reference to the viewer, `webGLEngine` a referece
to the webgl module that is being bridged; and `cachedMode` flag to enable or disable OSD caching for post-processed `TiledImage`s.
 

### Setting up the visualisation

Visualisation and data must be set up. Then, you can also add custom shaders if you want and call `prepare()` and `init()`.
A short example:

``````javascript
const webglProcessing = new WebGLModule({
    // htmlControlsId: "div-id",  //if set, shader realtime controls are available 
    // htmlShaderPartHeader: callback, //function that handles HTML rendering for each layer
    // debug: t/f,
    // for other control options, see WebGLModule class
});

const seaGL = viewer.bridge = new OpenSeadragon.BridgeGL(viewer, webglProcessing, true); //true to enable cache, false to disable
seaGL.addVisualisation({
    //here you want to add a visualization with compulsory member "shaders" - object that defines what postprocessing is applied
    //note that for vanilla OSD protocols, you will not use more than first dataReferences index, example:
    "name": "My first postprocessing",
    "shaders": {
        "id_1": {
            "name": "Render with heatmap",
            "type": "heatmap", 
            "visible": "1", 
            "dataSources": [0], //usually 0, unless you specify the data array, see below
            "params": {} //let take over defaults
        }
    }
});

//requires open event to be fired on OSD, if not, fire it manually
seaGL.initBeforeOpen();

//or after open event:
// seaGL.loadShaders(0, () => {
//     seaGL.initAfterOpen();
// });

//to attach TiledImage to the renderer, simply call (once TiledImage at given index exists)
seaGL.addLayer( index );
``````

#### Visualisation settings
You can run multiple visualisation goals (ways of pre-defined visualisation style, e.g. what shaders-layers are drawn with what data); 
and each goal can define arbitrary amount of layers to render into the output canvas, using highly customizable shaders 
(downloadable from custom sources). These layers can be manually re-ordered, changed and further parametrized by the user 
in the real time. For more information on dynamic shaders, see `./shaders/README.md`.

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
                          "color": "#fa0058", //shader-dependent parameter, set as default value for a default control type specified by the shader itself if not an object
                          "opacity": { //shader-dependent parameter
                                 "default": 50,
                                 "type": "range", //show as a slider
                                 "min": 0,
                                 "max": 100,
                                 "title": "Opacity: ",
                                 "interactive": true
                          }, 
                          "use_gamma": 2.0,   //global parameter, apply gamma correction with parameter 2
                          "use_channel0": "b"  //global parameter, sample channel 'b' from the first image, can be any combination of 'rgba' - but the shader used must support the number of channels you create this way 
                   }
            }
      }
}
````
- [O]`name` - visualisation goal name 
- [O]`lossless` - default `true` if the data should be sent from the server as 'png' or 'jpg', this is not used but you can read this flag later to set up TileSource correctly
- [R]`shaders` - a key-value object of data instances (keys) tied to a certain visualisation style (objects), the data layer composition is defined here, 
the key defines the data (e.g. path to the pyramidal tif such that that server can understand it)
    - [0]`name` - name of the layer: displayed to the user
    - [R]`type` - type of shader to use, supported now are `color`, `edge`, `dual-color`, `identity` (used when the data should be used in different shader); can be also one of custom-defined ones 
    - [R]`visible` -  `1` or `0`, whether by default the data layer is visible
    - [R]`dataReferences` - indices **array** to the `data` array
        - shaders can then reference `data` items using index to the `dataReferences` array
        - e.g. if `shader_id_1` uses texture with index `0`, it will receive data to `"path/to/probability.tif"`
    - [O]`params` - special parameters for defined shader type (see corresponding shader), shader should define fault vaules values that are used if not set
        - no keys in `params` field should be required
        - some parameters are global, see more detailed description in `shaders/README.md`
- [O]`order` - array of shader ID's - preferred order of rendering, if defined, id's of shader definitions that are ommited _do not get rendered and interacted with_        

> Getting a list of supported shader types, their controls and control types and their params can be hard, it is a dynamic
> environment. There is a JS script class that processes the API and extracts this information as a HTML summary.

**Note that** some field names starting with `use_` within `[layer].params` are reserved. Do not name
your parameters like this. For more detailed info and guidelines on writing shaders, see `shaders/README.md`.


### Data settings
Data must be loaded in compliance with indices used in `dataSources` elements across the visualisation (strings / image srouce paths passed to `addVisualisation()`)
- the module will automatically extract an ordered subset of the given data in the order in which it expects the data to arrive
    - see `WebGLModule.getSources()`
    
The idea of working with multiple data sources is:
  - create bridge and module instances, initialize visualization
  - read required data sources `WebGLModule::getSources()`, read other information necessary to fetch data such as `WebGlModule::visualization().lossless` flag
    - do not forget to update correctly (re-initialize tiled image) when UI requests viz goal changes:

                visualisationChanged: function(oldVis, newVis) {
                    const seaGL = viewer.bridge,
                        //we are rendering only on one TiledImage, so seaGL.getWorldIndex() will get us index to replace
                        index = seaGL.getWorldIndex(),
                        //read all files necessary to render, a proper subset of WebGLModule.getSources()
                        sources = seaGL.dataImageSources(); 
                        //possibly read lossless info from newVis object
                        
                    if (!seaGL.disabled()) {
                        VIEWER.addTiledImage({
                            tileSource: "", //todo: create the init protocol URL from sources array
                            index: index,
                            success: function (e) {
                                seaGL.addLayer(index);
                                seaGL.redraw(); //probably not necessary since we will be drawing the new tiled image anyway
                            }
                        });
                    }
                }

  - add new tiled image to OSD with required properties
  - bind the created tiled image instance to the bridge using ``OpenSeadragon.BridgeGL::addLayer( ... )``

Your app can then request a configuration like so:
````json
{
      "data": ["image1", "image2"],
      "shaderSources" : [
            {
                 "url": "http://my-shader-url.com/customShader.js",
                 "headers": {},
                 "typedef": "new_type"
            }
      ],
      "visualizations": [
            {
                  ... config references items in "data" 
            }
      ]
}
````
then simply call:

````js
seaGl.setData(json.data); 
seaGl.addVisualisation(...json.visualizations);
````
upon initialization.


### Custom shader types
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


### Reading from channels
The shader can specify data references for rendering from nD data sources. You can spacify the chanel to be read,
note that this option is ignored if the shader _reads all channels instead of a subset_. Reading from all channels
is discouraged; the shader should specify the number of channels being read instead and let the user specify
the channels themselves. Note that better is reading one channel from multiple sources for flexibility. You can set
 - ``use_channel[X]`` for specific index X in `dataReferences` (e.g. for second element, set `use_channel1` to override)

### webGLWrapper.js
The main file, definition of `WebGLModule` class, handles all the visualiser-specific functionality, uses GlContextFactory to obtain an instance (GlContext) that renders the data.

### webGLContext.js
Includes GlContextFactory definition and its default subclass that implements `getContext()` and returns either `WebGL20` or `WebGL10` that behave as a `State` pattern, providing either WebGL 2.0 (if supported) or WebGL 1.0 (fallback) functionality respectively.

## Advanced: processing custom raster data

The ``processImage(...)`` method accepts any data an image loader is prepared for. `dataLoader.js` contains
definitions for loading the data as textures to the GPU. In order to draw custom data, you can either extend or override classes in
the loader.
 - ``WebGLModule.DataLoader`` class that ensures data interpretation, by default supports Image and Canvas objects (including arrays of those)
   - ``dataAsHtmlElement`` function that renders input data in the debug mode, needs a dom element to append the input data to
   - ``V1_0`` class implementing WebGL 1.0 texture loader
   - ``V2_0`` class implementing WebGL 2.0 texture loader
   
#### Texture Loader
Class that has the following interface (details are documented in the implementation):

````js
    constructor(gl);
    
    /**
     * Called when the program is being loaded (set as active)
     */
    toBuffers (context, gl, program, wrap, filter, visualisation);
    
    /**
     * Called when tile is processed
     */
    toCanvas (context, dataIndexMapping, visualisation, data, tileBounds, program, gl);
    
    /**
     * Measure texture size
     */
    measure(index);
    
    /**
     * Sample texture
     */
    sample(index, vec2coords);
    
    /**
     * Declare elements in shader
     */
    declare(indicesOfImages);
````

Texture loaders by default support ``Canvas`` and `Image` objects. You can either re-implement the whole
interface to load custom data to the GPU, or provide just the ``toCanvas`` implementation with custom
mapping support in ``WebGLModule.DataLoader.V[X]_[Y]`` for WebGL X.Y version.

Provided loaders use ``toCanvas`` to load data based on the data `toString.apply(data)` result. By default, 
image or image arrays are supported for the rendering. Attaching new keys or modyfiing existing ones can
be easier than implementing the whole loader interface.

````js
loadersByType = {
    "[object HTMLImageElement]": function (self, webglModule, dataIndexMapping, visualisation, data, tileBounds, program, gl);,
    //Image objects in Array, we assume image objects only
    "[object Array]": function (self, webglModule, dataIndexMapping, visualisation, data, tileBounds, program, gl);
}
````

Thus allowing to add new definitions of loaders as such:
````js
WebGLModule.DataLoader.V1_0.loadersByType["<type>"] = function(...) {...};
````
with the ``<type>`` as a result of calling `toString.apply(myData)`.
Note that doing so must conform to the existing environment; each loader uses certain
texture types and other configuration, this part only takes care of the data loading
that must conform to the existing context.

## Advanced: processing vector data
This feature is on the TODO list.
