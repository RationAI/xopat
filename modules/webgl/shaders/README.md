# Dynamic shader building  [NEEDS UPDATES]

The visualisation setup is used to instantiate to JavaScript shader layer classes.
````JSON
[{    
      "name": "A visualisation setup 1",
      "params": {}, 
      "shaderSources" : [
            {
                   "url": "http://my-shader-url.com/customShader.js",
                   "headers": {},
                   "typedef": "new_type"
            }
      ],
      "shaders": {
            "path/to/probability/layer.tif": {
                   "name": "Probability layer",
                   "type": "heatmap", 
                   "visible": "1", 
                   "params": { 
                      "color": "#fa0058"
                   }
            }
      }
}]
````

Each shader (layer) must inherit from `VisualisationLayer` class. There are pre-defined shader layers such as `identity`, 
`heatmap`, `edge`, `biploar-heatmap` or `colormap`. Then, the `shaders[<id>].params` field is sent to the constructor as a single object.

`shaderSources` are used to download and initialize custom-defined shader layers. The output of the specified url must be a text interpretable by JavaScript.
Furthermore:
- shader layer class must inherit from `VisualisationLayer`
    - your constructor must pass the received object to the super constructor
- shader layer class must implement `name()`, `type()` and `getFragmentShaderExecution()` methods
- the class must be registered to `ShaderMediator`
    - e.g. `ShaderMediator.registerLayer(MyNewShaderLayer);`
    - `MyNewShaderLayer` class must not collide with existing classes in the global namespace
    - `type()` return value can overwrite already existing implementations (e.g. `heatmap`), the latter registered class is used
    - `type` in `shaders` `JSON` must refer to existing registered shader classes only (registered under `type()` return value)

### params
Parameters are fully dependent on the shader you use. If our policy is kept then
 - it is a `<key>:<value>` mapping where
    - key is a name of a particular control of the shader
    - value is either a primitive type (number...) or object containing data that depend on a particular control
        - missing values are OK, invalid not so much - might render your layer unusable
 - you can list supported key values => expected types map using `yourShader.supports()`
 - you can list supported UI controls using  `WebGLModule.UIControls.types()` and `WebGLModule.UIControls.build()`
 to instantiate them
 - instantiated controls can tell you all their supported values using `self.supports` and their GLSL type `self.type`

#### shader-specific inherited parameters
There are parameters common to all shaders and define how the layer is treated. Such parameters are specified **directly in**
params field (such as custom 'color' in the example above):
 - `channel` - a shader might work only with grayscale values - in that case, it's preferred when the shader uses `sampleChannel()`
 to respect this value (if set): then, the shader samples the channel given in this parameter
    - e.g. if `params.channel = "rrr"` the shader will sample the `RED` channel three times and obtain `vec3`
 - `gamma` - a gamma correction value (float), no correction is performed if the value is not set

#### control wide-supported parameters
Each control should support three parameters:
 - `title`: name of the control
 - `visible`: whether the user should be allowed to interact with the control (note it still might be visible, maybe rename the variable to _interactive_)
 - `default`: default value (need not to be necessarily true, however, with simple controls it is advantageous since controls switching will use the same default value)

### class `VisualisationLayer`
There are several features available for you: things that will make your coding easier. Basic `identity` shader can look
really simple!

````js
class IdentityVisualisationLayer extends VisualisationLayer {

    constructor(options) {
        super();
    }

    getFragmentShaderDefinition() {
        return "";
    }

    getFragmentShaderExecution() {
        //use 'tile_texture_coords' predefined GLSL variable
        return `
        show(${this.sample('tile_texture_coords')}); 
`;
    }
}
````

#### Writing in GLSL
Your code should reflect these important properties:
- VERSION INDEPENDENCE: the code should be independent of the GLSL version used.
    - `this.webglContext.getVersion()` will tell you the version of WebGL used
- SHADER RE-USABILITY: all global variable and function names must be extended with unique ID so that multiple code 
insertion is possible
    - `this.uid` contains unique identifier for each layer
    - or include your functions only once at global scope using `this.includeGlobalCode(id, code)`
- COMPLY TO OUT ADJUSTMENTS
    - specify code to define in `getFragmentShaderDefinition`
    - specify code to execute in `getFragmentShaderExecution` (possibly use stuff from the former)
    - output final color using `void show( vec4 )` function
- WORK CAREFULLY WITH UI CONTROLS, preferably use existing ones

#### Writing the Layer Class
You of course might want to do more such as passing user input into the shader. The `VisualisationLayer` enables you to implement
these member functions:
- `glLoaded(program, gl)` is called when the WebGL program starts to be used, get your uniform locations here (and possibly send time-independent values)
- `glDrawing(program, dimension, gl)` is called when the WebGl drawing event begins, meant to send time-varying uniform values
- `init()` is called always before `glLoaded()`, and after your HTML was attached to the page you can for example initialize your HTML control inputs
- `htmlControls()` is called to generate the shader HTML controls, these are **_replaced_** every time the visualisation is
re-compiled

##### Life cycle of your shader
API functions are called in a certain order. Keep the order to avoid errors. _\[loop\]_ means the block can be repeated multiple times:
  1. `constructor()` phase: you can rely on no functions and API calls to work: use
  to initialize your member variables only, also good place to play around with passed
  options object - set default values etc.
  2. `ready()` phase: you can use API of `WebGLModule.VisualisationLayer`
  3. **visualization used** _\[loop\]_
     1. `htlmControls` phase: define what user can interact with
     2. `init` phase: run JavaScript initialization (e.g. set up your HTML elements), after `mycontrol.ini()` it is safe to use all API of the aprticular control (see controls description below)
     3. `glLoaded` phase: hurray! WebGL is ready to render: do all static work here (locate uniforms, load static values...)
     4. **render** _\[loop\]_
        - `glDrawing` phase: particular image is going to be post-processed: load data to GPU that differs tile to tile
 
##### Some API
    
At your disposal are these global variables:
- `uniform float pixel_size_in_fragments;` - how many fragmens can fit into one pixel on the screen
- `uniform float zoom_level;` - zoom level, a value passed from the outer scope, can be anything, in our context used as OpenSeadragon zoom level TODO rename?
- `uniform vec2 u_tile_size;` - size of the canvas
- `in vec2 tile_texture_coords;` - texture coordinates for this fragment

And a member function to sample a texture appropriately:
- [JavaSciript] `this.sample(str)` where str is the string representing the sample coordinates, for example in WebGL 2 the result of
 `this.sample('coords.xy')` could be something like `texture(internally_defined_texarray_name, coords.xy)`

There are helper functions available so that it is easier to create more advanced, controllable shaders. You can
expect the object of the constructor to contain anything you wish to receive (e.g. flags, default values...). You can
rely on the following functions:
- reading pixel values
    - `filter(value)` does not really read a value, but applies post-processing common to the layer
    - `sample(textureCoords, raw=false)` - sample `vec4` with (raw=false) or without post-processing
    - `sampleChannel(textureCoords, raw=false)` - sample custom channel with (raw=false) or without post-processing
    - `sampleReferenced(textureCoords, otherDataIndex, raw=false)` - sample `otherDataIndex`th texture (refer to the layer data indices) with (raw=false) or without post-processing
    - `sampleChannelReferenced(textureCoords, otherDataIndex, raw=false)` - sample custom channel of `otherDataIndex`th texture (refer to the layer data indices) with (raw=false) or without post-processing
- parsing (not only the input) data
    - `isFlag(value)` - check if value in the input parameters can be interpreted as boolean true, default `false`
    - `isFlagOrMissing(value)` - same as above, interpreted as 'true' if missing
    - `toShaderFloatString(value, defaultValue, precisionLen=5)` - convert value (number) to a string representation with given decimal `precisionLen` length,
    some shaders require you to input floats as `1.0`, `1` could be interpreted as integer
        - e.g. `shader += this.toShaderFloatString(myValue, "1.0", 3);`
- writing shaders
    - `[control|this].sample(str)` to sample particular UI control or texture
    - `control.define()` to define uniform in the shader 
- data caching
    - `loadProperty(name, defaultValue)` - remembered or default value is returned
    - `storeProperty(name, value)` - value is propagated to the internal cache and possibly remembered
- pre-defined user controls (more on controls later)

#### Global functions and variables - GLSL
In fragment shader (`$execution` and `$definition`), there are several global functions and variables available. Example of really simple _identity_ shader:

`````js
/**
 * Identity shader
 */
MyIdentityLayer = class extends WebGLModule.VisualisationLayer {

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    constructor(options) {
        super(options);
    }

    getFragmentShaderExecution() {
        return `
        show(${this.sample('tile_texture_coords')});
`;
    }
};

WebGLModule.ShaderMediator.registerLayer(MyIdentityLayer);

`````
Shader in WebGL 2.0 is then composed in this manner: (you can see the **global** stuff here)
````glsl
uniform float pixel_size_in_fragments;  //how many fragments add up to one pixel on screen
uniform float zoom_level;               //zoom amount (see OpenSeadragon.Viewport::getZoom())
uniform vec2 u_tile_size;               //tile dimension

in vec2 tile_texture_coords;            //in-texture position
        
out vec4 final_color;                    //do not touch directly, fragment output, use show(...) instead

//instead of equality comparison that is unusable on float values        
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

//output any color using show(...) that provides correct blending   
void show(vec4 color) {
    if (close(color.a, 0.0)) return;
    float t = color.a + final_color.a - color.a*final_color.a;
    final_color = vec4((color.rgb * color.a + final_color.rgb * final_color.a - final_color.rgb * (final_color.a * color.a)) / t, t);
}

//here is placed all global-scope code, only once       
${definition}

//here is placed any code from $definition part !once for each instance of your shader!        
${definition}
        
void main() {
    final_color = vec4(1., 1., 1., 0.);

    //here is placed any code from execution part !once for each instance of your shader!
    ${execution}
}`;
````

You can see which global variables and functions are available. The resulting color from `execution` must be set using
`show(...)`. TODO possible boost: The performance can be enhanced in reverse-order rendering if the first `show(...)` call uses alpha
of `1`, the rest of the shader execution can be aborted. This is visualisator-independent and now considered pointless.

For more complex examples, see scripts themselves. 

### User Controls within your shaders
You have all API calls you need to implement your own UI controls. However, there is another available
hierarchy of UIControls that allow you to integrate even advanced UI interactively. The way
how you define the controls affects what the shader constructor parameter `options` should contain.

##### DO's
 - your shader should use registered UI controls for full flexibility
    - call `this.mycontrol = WebGLModule.UIControls.build(this, <name>, <parameters>, <default parameteres>, <predicate>)` to safely parse and initialize controls
    - `name` is an unique identifier (wrt. your shader class) you use when communicating with the control
    - `parameters` is object given by the user, e.g. if you say the shader supports a control named 'opacity', then you pass `options.opacity`
    - `default parameters` **must** at least contain **valid/existing type** of a preferred control (or infinite loop can happen)
    - `predicate(type, instance)` is a function that evaluates whether given control (GLSL type and its instance) is compatible with your shader
 - respect user input: if the control type is different, just give it to them unless it makes no sense
 - if needed, implement your own controls to extend `WebGLModule.UIControls.IControl` and register them with `WebGLModule.UIControls.registerClass()`
    - be careful about correct data management, UI updates: it is not trivial! look at existing classes
    - such controls then can be also used within other shaders
    - using same control name as different shader with a custom control type that is not registered might make
    the other shader look for it and fail in doing so
 - follow strictly shader life cycle to manage your controls
    - `control.define()` will give you full code to include your uniform variable in the shader
    - `control.sample(ratio)` will give you a one-liner code (without `;`) to use anywhere you like
        - note that `ratio` can be `undefined`, however, some controls might require it in order to sample properly and use default constants otherwise
        - `float data = 3.0; float x = ${this.opacity.sample("data * .5 + 2)};` is perfectly valid, unless used inside main(...) due to namespace collisions,
        remember your shader(part) can run several times within one (shader)script
    - `glLoaded, glDrawing, init, toHtml` functions to map onto your shader lifecycle
 - sync controls using `control.on(name, callback)` and clear them using `control.off(name)` 
    - only one callback can be registered for each name
    - you defined `name` when creating the control, the control will notify you if its value was modified
    - advanced controls support multiple events, see particular controls
        - not called if the instance is of a different type then the you think you are using, `build(...)` respects user-defined incoming types
        - for example, advanced slider can also change its mask, so the proper way is `slider.on('myslider' + "_mask", callback)`
 - define in `supports()` what control names are supported by your shader and what GLSL types you require
    - otherwise, the system might want to use for example `vec3` with your floats
    - e.g. 
        ```
       return  {
            opacity: "float" 
       }
       ```

### More advanced stuff: using multiple data sources at once
One might want to combine multiple data into one visualisation (shader) part. To do so:
- Define all data ID's you access in the shader setup using `dataReference` array

Having data set-up like this (and sent to the webgl module using `addData(...)` in the right order),
```json
"data": ["image1", "image2", "image3", "image4"]
```
and having one visualisation goal set-up in the following manner:
```json
     "shaders": {
         "data_source_main": {
             "name": "Shader that uses multiple data",
             "type": "sophisticated_shader", 
             "visible": "1", 
             "dataReference": [0,2,3],
             "params": { 
                  //your params
             }
         }
     }
```
We can
- sample the shader in the class with `this.sampleReferenced(..)` or `this.sampleChannelReferenced(...)`
    - arguments are: `vec2(--texture coordinates--)` string representing sampling coords and index to the `dataReference` array
    - e.g. to sample `"image1"`, call `this.sample('tile_texture_coords')` or `this.sampleReferenced('tile_texture_coords', 0)`
    - e.g. to sample `"image4"`, call `this.sampleReferenced('tile_texture_coords', 2)` which maps to index 3 in `"data"`
    - note that the shader defines how `dataReference` should look like (number of required indices)
- use any combinations of shaders and their collections within different groups (goals) we want
    - sampling any number of data
    - using any number of shaders, even custom-defined at remote URL

### Even more advanced stuff: implementation of UI controls
Just don't. 

Or have a detailed understanding of the above and fully conform to `WebGLModule.UIControls.IControl`.
Implementation using modification of an existing control is recommended.
