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
                 "data": "Probability layer",
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

### `__shader_part__.php`
Required parameter (`GET` or `POST`) is `index`. Other parameters are voluntary, shader-dependent, except `unique-id` - a value 
that can be passed from outer `params` field.

_Example URL_: https://ip-78-128-251-178.flt.cloud.muni.cz/iipmooviewer-jiri/OSD/dynamic_shaders/colors.php?index=1&color=#9900fa

Each shader type has a shader part script that generates following JSON-encoded object output with following fields:
- `definition` - define global variables or custom functions in the resulting shader, should define at least `sampler2D` variable where
 the visualisation sends the data for certain tile
- `execution` - write shader code that is executed, placed inside `main{}` and can use pre-defined functions or `definition` part
- `html` - html elements that are to be shown in the visualiser, serve for user input
- `js` - `js` script, that helps to send user values from `html` to shader
- `glLoaded` - `js` code executed when WebGL program is loaded, used to register uniform variables
- `glDrawing` - `js` code executed when WebGL program is used, used to set values to uniforms
- `sampler2D` - name of the `sampler2D` variable, so that visualiser knows where to bind the data

**OR**

- `error` - error title - user-friendly message
- `desc` - detailed error description

#### Global functions and variables - PHP
There are some necessary things required to allow advanced functionality. Each file, after `init.php` inclusion can use global parameters:
- `$uniqueID` - a variable to avoid namespace collision
- `$data` - an array that contains sent parameters
- function `send($definition, $sampler2DUniformName, $execution, $htmlPart="", $jsPart="", $glLoaded="", $glDrawing="")` for unified output style

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
Shader is then composed in this manner: (you can see the **global** stuff here)
````glsl
precision mediump float;
uniform vec2 u_tile_size;  //tile dimension
varying vec2 v_tile_pos;   //in-texture position

//linear blending of colors based on float 'ratio'
vec4 blend(vec4 a, vec4 b, float ratio) {
    return ratio * a + (1.0-ratio) * b;
}

//output using show(...)
void show(vec4 color) {
    gl_FragColor = color.a * color + (1.0-color.a) * gl_FragColor;
}

//instead of equality comparison, unusable on float values
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

//here is placed any code from $definition part
${definition}

void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);

    //here is placed any code from execution part
    ${execution}
};
````

You can see which global variables and functions are available. The resulting color from `execution` must be set using
`show(...)`. TODO possible boost: The performance can be enhanced in reverse-order rendering if the first `show(...)` call uses alpha
of `1`, the rest of the shader execution can be aborted. This is visualisator-independent and now considered pointless.

#### Global functions and variables - JavaScript
For javascript, you can use
- `redraw();` - will trigger update to the whole canvas, WebGL will be used to update it
- `loadCache( key, defaultValue )` - will load data
- `saveCache( key, value )` - will save data
Saving cache is important for between-visualisation switching. When your visualisation is loaded (not necessarily for the first time), all your `js` code is
executed. That means the user would lose all presents from the use history. Here you can nicely cache and load your variable values so that all changes will be preserved.
Also, you will want to probably propagate these values to various `HTML` input elements you've defined in `$html` part.


For more complex examples, see scripts themselves. **Non-unique names of variables and functions will cause the shader compilation failure or other
namespace collision.** 
We recommend to extend each custom variable and function name with `$uniqueId`, both for `GLSL` and `JavaScript`.