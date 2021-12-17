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
`color`, `edge`, `dual-color`. Then, the `shaders[<id>].params` field is sent to the constructor as a single object.

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
- COMPLY TO OUT ADJUSTMENTS
    - specify code to define in `getFragmentShaderDefinition`
    - specify code to execute in `getFragmentShaderExecution` (possibly use stuff from the former)
    - output final color using `void show( vec4 )` function

At your disposal are these global variables:
- `uniform float pixel_size_in_fragments;` - how many fragmens can fit into one pixel on the screen
- `uniform float zoom_level;` - zoom level, a value passed from the outer scope, can be anything, in our context used as OpenSeadragon zoom level TODO rename?
- `uniform vec2 u_tile_size;` - size of the canvas
- `in vec2 tile_texture_coords;` - texture coordinates for this fragment

And a member function to sample a texture appropriately:
- [JavaSciript] `this.sample(str)` where str is the string representing the sample coordinates, for example in WebGL 2 the result of
 `this.sample('coords.xy')` could be something like `texture(internally_defined_texarray_name, coords.xy)`

#### Writing the Layer Class
You of course might want to do more such as passing user input into the shader. The `VisualisationLayer` enables you to implement
these member functions:
- `glLoaded(program, gl)` is called when the WebGL program starts to be used, get your uniform locations here (and possibly send time-independent values)
- `glDrawing(program, dimension, gl)` is called when the WebGl drawing event begins, meant to send time-varying uniform values
- `init()` is called always before `glLoaded()`, and after your HTML was attached to the page you can for example initialize your HTML control inputs
- `htmlControls()` is called to generate the shader HTML controls, these are **_replaced_** every time the visualisation is
re-compiled

There are helper functions available so that it is easier to create more advanced, controllable shaders. You can
expect the object of the constructor to contain anything you wish to receive (e.g. flags, default values...). You can
rely on the following functions:
- parsing (not only the input) data
    - `isFlag(value)` - check if value in the input parameters can be interpreted as boolean true, default `false`
    - `isFlagOrMissing(value)` - same as above, interpreted as 'true' if missing
    - `toShaderFloatString(value, defaultValue, precisionLen=5)` - convert value (number) to a string representation with given decimal `precisionLen` length,
    some shaders require you to input floats as `1.0`, `1` could be interpreted as integer
        - e.g. `shader += this.toShaderFloatString(myValue, "1.0", 3);`
    - `to[String/RGBColor/RGBShaderColor]From[String/RGBColor/RGBShaderColor]Color(value, defaultValue)` - convert between array and string representation of an RGB color,
    where `value` is of the from-conversion type and `defaultValue` of the to-conversion type 
        - `String` is hexadecimal representation, e.g. `#5500fa` or `ffffff`
        - `RGBColor` is an array of 0-255 integer values, e.g. `[0, 255, 132]`
        - `RGBShaderColor` is an array of 0-1 float values, e.g. `[0, 1.0, 0.518]`
- writing shaders
    - `sample(str)`
- data caching
    - `loadProperty(name, defaultValue)` - remembered or default value is returned
    - `storeProperty(name, value)` - value is propagated to the internal cache and possibly remembered
- pre-defined user control setup (for `init()`)
    - `simpleControlInit(varName, htmlId, defaultValue, postprocess=undefined)`: in many cases the initialization is similar, if you have
    just one simple html control node, this function will
         - initialize `this.varName` by default or cached value 
         - set up html node to reflect the value (found by `id`, its value and `onchange` properties are set)
         - `onchange` will update `this.varName = postprocess(node.value)` and also cache it
    - `twoElementInit(varName, html1Id, html2Id, defaultValue, postprocess=undefined)`: same as the above, but two HTML elements are synchronized    

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
}

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

//here is placed any code from $definition part        
${definition}
        
void main() {
    final_color = vec4(1., 1., 1., 0.);

    //here is placed any code from execution part    
    ${execution}
}`;
````

You can see which global variables and functions are available. The resulting color from `execution` must be set using
`show(...)`. TODO possible boost: The performance can be enhanced in reverse-order rendering if the first `show(...)` call uses alpha
of `1`, the rest of the shader execution can be aborted. This is visualisator-independent and now considered pointless.

For more complex examples, see scripts themselves. 

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