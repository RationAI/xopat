# Dynamic shader building

The visualization setup is used to instantiate to JavaScript shader layer classes.
````JSON
{    
      "name": "A visualization setup 1",
      "shaders": {
            "my_id": {
                  "name": "Probability layer",
                  "type": "heatmap", 
                  "visible": "1", 
                  "dataReference": [0],
                  "params": { 
                          "color": "#fa0058", //shader-dependent parameter, equals to "color": {default: value} if not an object
                          "threshold": { //shader-dependent parameter
                                 "default": 50,
                                 "type": "range", //show as a simple slider
                                 "min": 0,
                                 "max": 100,
                                 "title": "Threshold: ",
                                 "interactive": true
                          }, 
                          "use_gamma": 2.0,   //global parameter, apply gamma correction with parameter 2
                          "use_channel0": "b"  //global parameter, sample channel 'b' from the image, but make sure "heatmap" supports 1channel data
                  }
            }
      }
}
````

Each shader (layer) must inherit from `VisualizationLayer` class. There are pre-defined shader layers such as `identity`, 
`heatmap`, `edge`, `biploar-heatmap` or `colormap`. Then, the `shaders[<id>].params` field is sent to the constructor as a single object.

Furthermore:
- shader layer class must inherit from `VisualizationLayer`
    - your constructor must pass the received object to the super constructor
- shader layer class must implement `name()`, `type()` and `getFragmentShaderExecution()` methods
- the class must be registered to `ShaderMediator`
    - e.g. `ShaderMediator.registerLayer(MyNewShaderLayer);`
    - `type()` return value can overwrite already existing implementations (e.g. `heatmap`), the latter registered class is used
    - `type` in `shaders` `JSON` must refer to existing registered shader classes only (registered under `type()` return value)
- parameter names starting with `use_` are **reserved**

### params
Parameters are fully dependent on the shader you use. If our policy is kept then
 - it is a `<key>:<value>` mapping where
    - key is a name of a particular control of the shader
    - value is either a primitive type (number...) or object containing data that depend on a particular control
        - missing values are OK, invalid not so much - might render your layer unusable
 - you can list supported key => default configuration map using `YourShaderClass.defaultControls`
 - you can list supported UI controls using  `WebGLModule.UIControls.types()` and `WebGLModule.UIControls.build()`
 to instantiate them
 - instantiated controls can tell you supported param types using ``WebGLModule.UIControls.IControl`` API

#### shader-specific inherited parameters
There are parameters common to all shaders and define how the layer is treated. Such parameters are specified **directly in**
params field (such as custom 'color' in the example above):
 - `use_channel[X]` - sample desired channel combination (consists of `rgba`), make sure the specified amount of channels is supported by given shader type
    - e.g. if `params.use_channel1 = "rrr"` the shader will sample the `RED` channel three times when reading a second texture in `dataReferences` and obtain `vec3`

To specify blending, the params field can specify
 - `use_mode` - with values `"show"` (default alpha blending), `"mask"` or `"mask_clip"` (custom blending with default hard mask implementation)

The following three filters can be specified. The order of definition in the params sets the order of application. They accept one float value as the filter parameter.    
 - `use_gamma` - a gamma scale applied on the intensities, 
 - `use_exposure` - remapping intensities onto
 - `use_logscale` - logarithm scale applied on the intensities (safer version of gamma when arg > 1 used)
 
The ``opacity`` (glType `float`) control is created for any layer by default, so that opacity adjustment
is available without the need to explicitly program it.

#### control wide-supported parameters
Each control should support three parameters:
 - `title`: name of the control
 - `interactive`: whether the user should be allowed to interact with the control (usually provides no HTML if no interactive)
 - `default`: default value (need not to be necessarily true, however, with simple controls it is advantageous since controls switching will use the same default value)

### class `VisualizationLayer`
There are several features available for you: things that will make your coding easier. Basic `identity` shader can look
really simple!

````js
class IdentityVisualizationLayer extends VisualizationLayer {

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    static description() {
        return "shows the data AS-IS";
    }

    static sources() {
        return [{
            channels: 4,
            description: "4-channel data to "
        }];
    }

    getFragmentShaderExecution() {
        //opacity available by default without doing anything
        return `return ${this.sampleChannel("tile_texture_coords")};`;
    }
}
````

#### Writing in GLSL
Your code should reflect these important properties:
- VERSION INDEPENDENCE: the code should be independent of the GLSL version used.
    - `this.webglContext.getVersion()` will tell you the version of WebGL used
    - rely on functions available in ``VisualizationLayer`` superclass, and request new API if needed
- SHADER RE-USABILITY: all global variable and function names must be extended with unique ID so that multiple code 
insertion is possible
    - `this.uid` contains unique identifier for each layer
    - or include your functions only once at global scope using `this.includeGlobalCode(id, code)`
    - ``getFragmentShaderExecution`` is not on the global scope, do anything here, just make sure you return `vec4` value
- COMPLY TO OUT ADJUSTMENTS
    - you **can** specify code to define in `getFragmentShaderDefinition` (global scope)
        - call ``super.getFragmentShaderDefinition()`` as the first line!
    - you **must** specify code to execute in `getFragmentShaderExecution` and return a `vec4` value in this code
- RENDER OVER ALL PIXELS
    - this is implicitly enforced with ``getFragmentShaderExecution`` - it is inserted in a function that returns `vec4` - 
all exiting branches must return a value
- WORK CAREFULLY WITH UI CONTROLS, preferably use existing ones
    - creating a bug-free UI controls is rather hard: keep the cache correct at all times, keep the UI updated,
    program the handlers correctly...
    - include ``super.getFragmentShaderDefinition()`` output when overriding

#### Writing the Layer Class
You of course might want to do more such as passing user input into the shader. The `VisualizationLayer` enables you to implement
these member functions:
- `glLoaded(program, gl)` is called when the WebGL program starts to be used, get your uniform locations here (and possibly send time-independent values)
- `glDrawing(program, dimension, gl)` is called when the WebGl drawing event begins, meant to send time-varying uniform values
- `init()` is called always before `glLoaded()`, and after your HTML was attached to the page you can for example initialize your HTML control inputs
- `htmlControls()` is called to generate the shader HTML controls, these are **_replaced_** every time the visualization is
re-compiled

##### Life cycle of your shader
API functions are called in a certain order. Keep the order to avoid errors. _\[loop\]_ means the block can be repeated multiple times:
  1. `constructor()` phase: you can rely on no functions and API calls to work: use
  to initialize your member variables only, also good place to play around with passed
  options object - set default values etc.
  2. `ready()` phase: you can use API of `WebGLModule.VisualizationLayer`
  3. **visualization used** _\[loop\]_
     1. `htlmControls` phase: define what user can interact with
     2. `init` phase: run JavaScript initialization (e.g. set up your HTML elements), after `mycontrol.ini()` it is safe to use all API of the aprticular control (see controls description below)
     3. `glLoaded` phase: hurray! WebGL is ready to render: do all static work here (locate uniforms, load static values...)
     4. **render** _\[loop\]_
        - `glDrawing` phase: particular image is going to be post-processed: load data to GPU that differs tile to tile
 
##### Selected VisualizationLayer API
    
At your disposal are these global variables:
- `uniform float pixel_size_in_fragments;` - how many fragmens can fit into one pixel on the screen
- `uniform float zoom_level;` - zoom level, a value passed from the outer scope, can be anything, in our context used as OpenSeadragon zoom level TODO rename?
- `uniform vec2 u_tile_size;` - size of the canvas
- `in vec2 tile_texture_coords;` - texture coordinates for this fragment


And a member function to sample a texture appropriately: [JavaScript] 
 - `this.sampleChannel(str)` where str is the string representing the sample coordinates, for example in WebGL 2 the result of
 `this.sampleChannel('coords.xy')` could be something like `texture(internally_defined_texarray_name, coords.xy).rggr` (where `rggr` comes from the shader configuration)


There are helper functions available so that it is easier to create more advanced, controllable shaders. You can
expect the object of the constructor to contain anything you wish to receive (e.g. flags, default values...). You can
rely on the following functions:
- reading pixel values
    - `this.filter(value)` does not really read a value, but applies post-processing required for the layer
    - `this.sampleChannel(textureCoords, textureIndex=0, raw=false)` - sample channel(s) as specified by shader configuration with (raw=false) or without post-processing
- sampling controls (the same names as specified within `static defaultControls` map)
    - `this.controlName.sample(str)` to sample particular UI control or texture (or preferred `sampleChannel` with textures) 
        - argument is any GLSL ``float`` value the control should be sampled against
        - you do not have to provide any, but certain controls require the value (`advanced_slider`), so it is good to give some - e.g. a sampled value
- data caching
    - `this.loadProperty(name, defaultValue)` - remembered or default value is returned
    - `this.storeProperty(name, value)` - value is propagated to the internal cache and possibly remembered
- pre-defined user controls (more on controls later)
- parsing (not only the input) data (probably not needed, implemented with controls internally)
    - `this.isFlag(value)` - check if value in the input parameters can be interpreted as boolean true, default `false`
    - `this.isFlagOrMissing(value)` - same as above, interpreted as 'true' if missing
    - `this.toShaderFloatString(value, defaultValue, precisionLen=5)` - convert value (number) to a string representation with given decimal `precisionLen` length,

#### Global functions and variables - GLSL
In fragment shader (`$execution` and `$definition`), there are several global functions and variables available.

Shader in WebGL 2.0 is then composed in this manner: 
````glsl
precision mediump float;
precision mediump sampler2DArray;

uniform ?                               //textures definition, you use ${this.sampleChannel('tile_texture_coords')}
uniform float pixel_size_in_fragments;  //how many fragments add up to one pixel on screen
uniform float zoom_level;               //zoom amount (see OpenSeadragon.Viewport::getZoom())
uniform vec2 u_tile_size;               //tile dimension
in vec2 tile_texture_coords;            //in-texture position
        
out vec4 final_color;                    //do not touch directly, fragment output, use show(...) instead
       
//compare equality of floats - exact comparison that is unusable
bool close(float value, float target) {
    return {{bool}}
}
   
//do not use directly, call ${this.render(...)} javascript function to decide for correct code for you     
void show(vec4 color) {
}
//do not use directly
vec4 blend_equation(in vec4 foreground, in vec4 background) {
}
//do not use directly
void blend_clip(vec4 foreground) {
}
//do not use directly
void blend(vec4 foreground) {
}

... inserted code from your getFragmentShaderDefinition() return value
    !once for each instance of your shader! ...
        
void main() {
    final_color = vec4(1., 1., 1., 0.);
        
    ... generated rendering part ...
    
    show(vec4(.0));
}`;
````

Basically, you can use present ``uniform`` and `in` variables; and `close` function - these are consistent accross versions.
For more complex examples, see scripts themselves. 

### User Controls within your shaders
You have all API calls you need to implement your own UI controls. However, there is another available
hierarchy of UIControls that allow you to integrate even advanced UI interactively. The way
how you define the controls affects what the shader constructor parameter `options` should contain.

##### DO's
 - your shader should use registered UI controls for full flexibility
    - specify static controls definition, .e.g
    ````js
        static defaultControls = {
            color: {
                default: {type: "color", default: "#fff700", title: "Color: "},
                accepts: (type, instance) => type === "vec3",
            },
            threshold: {
                default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float",
                required: {type: "range_input"}
            },
            inverse: {
                default: {type: "bool", default: false, title: "Invert: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    ````
    - `name` is an unique identifier (wrt. your shader class) you use when communicating with the control
    - `parameters` is object given by the user, e.g. if you say the shader supports a control named 'opacity', then you pass `options.opacity`
    - `default` **must** at least contain **valid/existing type** of a preferred control (or infinite loop can happen)
        - set other default values for the selected type, the user _might_ give different types - in that case, the shader verifies which values can be re-used
    - `accepts(type, instance)` is a function that evaluates whether given control (GLSL type and its instance) is compatible with your shader
    - optionally, ``required`` map that will ensure a certain params are always set to specific values, e.g. always having `range_input` control for thresholding

 - respect user input: do not require any specific values unless you _have to_ (see `colormap` shader that specifically works with certain threshold type; yet does not enforce its presence)
 
 - if needed, implement your own controls to extend `WebGLModule.UIControls.IControl` and register them with `WebGLModule.UIControls.registerClass()`
    - be careful about correct data management, UI updates: it is not trivial! look at existing classes
    - such controls then can be also used within other shaders
    - using same control name as different shader with a custom control type that is not registered might make
    the other shader look for it and fail in doing so
    - ensure that the GLSL uniform is provided with value between 0 and 1 (standardize)
       - if possible, of course not true for integer or boolean for example

 - follow strictly shader life cycle to manage your controls
    - you **can** do custom stuff with controls in ``this.init() {....}`` before they are used
    - you **can** specify code to define in `getFragmentShaderDefinition` (global scope)
        - call ``super.getFragmentShaderDefinition()`` as the first line - it will initialize controls for you
    - when generating GLSL code, `control.sample(ratio)` will give you a one-liner code (without `;` at end) to use anywhere you like
        - note that `ratio` can be `undefined`, however, some controls might require it in order to sample properly and use default constants otherwise
        - `float data = 3.0; float x = ${this.threshold.sample("data * .5 + 2")};` is perfectly valid
        remember your shader(part) can run several times within one (shader)script

 - **float controls are mapped to 0-1 range**
    - to unify controls output, all `float` values of an uniforms sent to GPU with rational part are mapped to 0-1 interval range
    - this means your shader should assume the input in GLSL will be between 0 and 1 and can rescale it as it sees fit
    
 - sync controls using `control.on(name, callback)` and clear them using `control.off(name)` inside ``this.init() {....}`` 
    - only one callback can be registered for each name
    - you defined `name` when creating the control, the control will notify you if its value was modified
    - advanced controls support multiple events, see particular controls
        - not called if the instance is of a different type then the you think you are using, `build(...)` respects user-defined incoming types
        - for example, advanced slider can also change its mask, so the proper way is `slider.on('myslider' + "_mask", callback)`
    - possibly enforce control type in `static defaultContros` if you access certain control-specific API
 
 
#### Rendering in nD
The shader can specify data references for rendering from nD data sources. 
> Note: prefer multiple sources over multiple channels (i.e. reading from two images 1x channels instead of 
>1x image and using two channels) - the user can deliver such data in separate files or in one file by specifying the same data reference twice.
 

### More advanced stuff: using multiple data sources at once
One might want to combine multiple data into one visualization (shader) part. To do so:
- Define all data ID's you access in the shader setup using `dataReference` array

Having data set-up like this (and sent to the webgl module using `setup([<the data>], ...)` in the right order),
```json
"data": ["image1", "image2", "image3", "image4", "image5", "image6"]
```
and having one visualization goal set-up in the following manner:
```json
     "shaders": {
         "data_source_main": {
             "name": "Shader that uses multiple data",
             "type": "sophisticated_shader", 
             "visible": "1", 
             "dataReferences": [0,2,5],
             "params": { 
                  //your params
             }
         }
     }
```
We can
- sample the shader in the class with `this.sampleChannel(..)`
    - arguments are: `vec2(--texture coordinates--)` string representing sampling coords and index to the `dataReference` array
    - e.g. to sample `"image1"`, call `this.sampleChannel('tile_texture_coords')` or `this.sampleChannel('tile_texture_coords', 0)`
    - e.g. to sample `"image6"`, call `this.sampleChannel('tile_texture_coords', 2)` which maps to third index in `dataReferences`
    - note that the shader defines how `dataReference` should look like (number of required indices)
- use any combinations of shaders and their collections within different groups (goals) we want
    - sampling any number of data
    - using any number of shaders, even custom-defined at remote URL

### Even more advanced stuff: implementation of UI controls
Just don't. 

Or have a detailed understanding of the above and fully conform to `WebGLModule.UIControls.IControl`.
Implementation using modification of an existing control is recommended.
