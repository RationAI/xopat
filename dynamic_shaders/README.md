# Dynamic shader building

All the API is accessible through simple `GET` or `POST` requests. 

### `build.php`

Is an interface to avoid running separate requests for each shader part. Only `POST` request is supported, because
the parametrization might be lengthy. Required parameters are attributes of the `visualisation` field required by
`index.php`:
````JSON
[{    
      "name": "A visualisation setup 1",
      "params": {}, 
      "shaders": [
             {
                 "name": "Probability layer",
                 "data": "data_identifier",
                 "type:": "color", 
                 "visible": "1", 
                 "params": { 
                    "color": "#fa0058"
                 }
             }
      ]
 
 }]
````
The builder is given a single visualisation description:
`$_POST["params"] = --params stringified from the above--` and `$_POST["shaders"] = --shaders stringified from the above--`.
Parameter requirements are the same as with `index.php`.

The output is a JSON-encoded object where keys are `data` items from `shaders`, each inner object contains output
of certain shader-part script (described below). The only additional field is `order` having an integer from `1` that
tells in which order was certain object processed (the order in which `shaders` array was passed in `POST`).

### `defined.php`
Contains definitions of shader names, filenames, parameter names, parameters-to-HTML-input mapping and short descriptions.

### `[shader_part].php`
Required parameter (`GET` or `POST`) is `index`. Other parameters are voluntary, shader-dependent, except `unique-id` - a value 
that can be passed from outer `params` field.

_Example URL_: https://ip-78-128-251-178.flt.cloud.muni.cz/iipmooviewer-jiri/OSD/dynamic_shaders/colors.php?index=1&color=#9900fa

Each shader type has a shader part script that generates following JSON-encoded object output with following fields:
- `definition` - define global variables or custom functions in the resulting shader
- `execution` - write shader code that is executed, placed inside `main{}` and can use pre-defined functions or `definition` part
- `html` - html elements that are to be shown in the visualiser, serve for user input
- `js` - `js` script, that helps to send user values from `html` to shader
- `glLoaded` - `js` code executed when WebGL program is loaded, used to register uniform variables
- `glDrawing` - `js` code executed when WebGL program is used, used to set values to uniforms

**OR**

- `error` - error title - user-friendly message
- `desc` - detailed error description

#### Global functions and variables - PHP
There are some necessary things required to allow advanced functionality. Each file, after `init.php` inclusion, can use global parameters:
- `$uniqueID` - a variable to avoid namespace collision
- `$data` - an array that contains sent parameters
- `$texture_name` - name of the texture that holds data to the current shader part, with respect to the WebGL version used
- function `$texture($sampling_coords, $id=-1)` - use this to sample the texture at `$sampling_coords`, alternatively set custon `$id` to touch data of other shaders (see at the bottom of this README)
- function `send($definition, $execution, $htmlPart="", $jsPart="", $glLoaded="", $glDrawing="")` for unified output style
- function `toShaderFloatString($value, $default, $precisionLen=5)` - use this function to covert a number `$value` to a string with decimal length of `$precisionLen`
- function `toRGBColorFromString($toParse, $default)` - use this function to parse hexadecimal color representation (e.g. `#ffffff`) to an integer array [r, g, b].
More detailed information can be found in the documentation of `init.php`.

#### Global functions and variables - GLSL
In fragment shader (`$execution` and `$definition`), there are several global functions and variables available. Example of really simple _identity_ shader part:

`````php
/**
 * Identity shader
 */
require_once("init.php");

$samplerName = "tile_data_{$uniqueId}";

$definition = <<<EOF
uniform sampler2D $samplerName;
EOF;

//second shader part, if sampled grayscale value is significant, and above threshold, 
//output the color with threshold opacity decreased intentsity
$execution = <<<EOF
  show(texture2D($samplerName, v_tile_pos));
EOF;

//gl-loaded: what happens when gl program is loaded? define uniform variables
//available variables: gl - webGL context, program - current compiled gl program in use 
$glload = ""; //nothing
//gl-drawing: what happens when gl draw event is invoked? send non-constant values to GPU
//available variables: gl - webGL context, e - current OSD Tile object
$gldraw = ""; //nothing
//html part: controls rendered under shader settings, allows user to change shader uniform values
$html = ""; //nothing
//js part: controls action: update controls if necessary and invoke `redraw();`
$js = ""; //nothing
//print output, it is also possible to call send($definition, $samplerName, $execution); only
send($definition, $samplerName, $execution, $html, $js, $glload, $gldraw);
`````
Shader in WebGL 2.0 is then composed in this manner: (you can see the **global** stuff here)
````glsl
#version 300 es
precision mediump float;
uniform vec2 u_tile_size;  //tile dimension
in vec2 v_tile_pos;        //in-texture position
uniform sampler2DArray vis_data_sampler_array;  //texture array with data

out vec4 final_color;      //do not touch directly, fragment output, use show(...) instead

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
    final_color = vec4(0.0, 0.0, 0.0, 0.0);

    //here is placed any code from execution part
    ${execution}
};
````

You can see which global variables and functions are available. The resulting color from `execution` must be set using
`show(...)`. TODO possible boost: The performance can be enhanced in reverse-order rendering if the first `show(...)` call uses alpha
of `1`, the rest of the shader execution can be aborted. This is visualisator-independent and now considered pointless.

#### ~~Global~~ Local ~~functions and~~ variables only - JavaScript inside GLDrawing/GLLoaded
Of course you can use global variables here too (especially the ones defined in pure `js` part), but these two evens are placed inside two functions that
provide you with two local variables:
- `glLoaded` is passed two parameters: `(program, gl)` : `program` is the current program in use, `gl` is the instance of WebGL, so you can call stuff like `my_var_location = gl.getUniformLocation(program, 'nameOfUniformInShader');`
- `glDrawing` is passed two parameters: `(gl, e)` : `gl` is the instance of WebGL, `e` is the current drawing event object (see OSD API, contains for example `tiledImage` property - a reference to the corresponding TiledImage object instance), so you can call stuff like `gl.uniform1f(my_var_location, value);`
 

#### Global functions and variables - JavaScript
For javascript, you can use
- `redraw();` - will trigger update to the whole canvas, WebGL will be used to update it
- `loadCache( key, defaultValue )` - will load saved data
- `saveCache( key, value )` - will save data

Saving and retriving data is important for between-visualisation switching. When your visualisation is loaded (not necessarily for the first time), all your `js` code is
executed. That means the user would lose all presets from the visualisation use history. Here you can nicely cache your variable values so that all changes will be preserved.
Also, you will want to probably propagate these values to various `HTML` input elements you've defined in `$html` part.

### Example of sending user input values to the GPU
We will define an input for user to be able to control a shader uniform variable.
```HTML
<span> Value to send to shader:</span>
<input type="number" id="my-input-type-number-for-this-variable" onchange="myAwesomeOnChangeHandler(this);" min="0" max="100" step="1">
<br>
```
Then, we will add some `JavaScript` code to add logic around the input.
```
//load cached value or default value of 48
var myUniqueNameForVariable = loadCache("myUniqueNameForVariable", 48);

//update HTML input to reflect current state
$("#my-input-type-number-for-this-variable").val(myUniqueNameForVariable);

//called onChange
function myAwesomeOnChangeHandler(self) {
   //get the user input
   myUniqueNameForVariable = $(self).val();
   //save the new value
   saveCache("threshold_{$uniqueId}", threshold_{$uniqueId});
   //global function, part of API, update canvas
   redraw();
}

//we will want to later send the variable to shader, it is done by a location parameter
var myUniqueNameForVariableLocationWebGL = null;
```
And finally, we can use `glLoaded` and `glDrawing` to send the user input to the GPU

```
myUniqueNameForVariableLocationWebGL = gl.getUniformLocation(program, 'theNameForUniformWeUsedInTheShaderDefinitionPart');
```
```
gl.uniform1f(myUniqueNameForVariableLocationWebGL, myUniqueNameForVariable);
```


For more complex examples, see scripts themselves. **Non-unique names of variables and functions may cause the shader compilation failure or other
namespace collision.** 
We recommend to extend each custom variable and function name with `$uniqueId`, both for `GLSL` and `JavaScript` parts - of course after you include `init.php`.

### More advanced stuff: using multiple data sources at once
One might want to combine multiple data into one visualisation (shader) part. To do so:
- Check the shader source code what indices the shader accessess
    - in case you are wriging the shader yourself: use `$texture($texCoordsString, $dataIndex)` `PHP` function to access arbitrary data, e.g. use `$dataIndex=$index+$i` where `$i` is offset, `$index` is current index: this way we can say 'use data of the following layers'
- Construct the visualisation so that the order of rendering is such that the additional data is at the index position where the shader part accesses it, following the example above:
    ```json
    "shaders": [
        {
            "name": "Shader that uses multiple data",
            "data": "data_source_main",
            "type:": "color", 
            "visible": "1", 
            "params": { 
                "color": "#fa0058"
            }
        }, 
        {
            "data": "data_source_additional_1", //to access this data, use `$texture($texCoordsString, $index+1)` in the shader above
            "type:": "none" //tell the visualisation not to touch this data
            //as an exception, you can ommit other parameters here
        }
    ]
    ```
