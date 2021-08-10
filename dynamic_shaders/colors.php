<?php
/**
 * Colors shader
 * 
 * $_GET expected parameters:
 *  index - unique number in the compiled shader
 * $_GET supported parameters:
 *  color - color to fill-in areas with values, default yellow
 * 
 * colors shader will read underlying data (red component) and output
 * to canvas defined color with opacity based on the data
 * (0.0 => transparent, 1.0 => opaque)
 * supports thresholding - outputs color on areas above certain value
 * mapping html input slider 0-100 to .0-1.0
 */
require_once("init.php");

$r=$g=$b=0;

if (isset($data["color"])) {

    $data["color"] = ltrim(urldecode($data["color"]), "#");
    list($r, $g, $b) = sscanf($data["color"], "%02x%02x%02x");
} else {
    //default yellow
    $r = 210;
    $g = 235;
    $b = 0;
} 

$samplerName = "tile_data_{$uniqueId}";

//convert to string and ensure there is always a dot present (1.0000 rather than 1)
$r = toShaderFloatString($r / 255);
$g = toShaderFloatString($g / 255);
$b = toShaderFloatString($b / 255);
//first shader part, defines only uniform variables used
//note: except sampler2D variable, all other variables must be set by you
//note: all names are mixed with _index_ value so that the shader is reusable
//      and won't cause namespace collision
$definition = <<<EOF

uniform sampler2D $samplerName;
uniform float threshold_{$uniqueId};
uniform float threshold_opacity_{$uniqueId};

EOF;

//second shader part, if sampled grayscale value is significant, and above threshold, 
//output the color with threshold opacity decreased intentsity
$execution = <<<EOF

  vec4 data{$uniqueId} = texture2D($samplerName, v_tile_pos);
  if(data{$uniqueId}.r > 0.02 && data{$uniqueId}.r > threshold_{$uniqueId}){
    show(vec4( $r , $g , $b , data{$uniqueId}.r * threshold_opacity_{$uniqueId}));
  }

EOF;

//gl-loaded: what happens when gl program is loaded? define uniform variables
//availabe variables gl: webGL context, program: current compiled gl program in use 
$glload = <<<EOF
threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_opacity_{$uniqueId}');
EOF;

//gl-drawing: what happens when gl draw event is invoked? send non-constant values to GPU
//availabe variables gl: webGL context, e: current OSD Tile object
$gldraw = <<<EOF
gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, thresholdopacity_{$uniqueId});
EOF;

//html part: controls rendered under shader settings, allows user to change shader uniform values
$html = <<<EOF
<span> Opacity:</span><input type="range" id="opacity-{$uniqueId}" onchange="opacityChange_{$uniqueId}(this)" min="0" max="1" value="0" step="0.1">
<br>

<span> Threshold:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" value="0" step="1">
<input type="number" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="0">
<br>
EOF;

//js part: controls action: update controls if necessary and invoke `redraw();`
$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId};

var threshold_{$uniqueId} = 1;

//initial values
$("#threshold-{$uniqueId}").val(threshold_{$uniqueId});
$("#threshold-slider-{$uniqueId}").val(threshold_{$uniqueId});

//updater
function thresholdChange_{$uniqueId}(self) {
   threshold_{$uniqueId} = $(self).val();
   if (threshold_{$uniqueId} < 1) { threshold_{$uniqueId} = 1; }
   else if (threshold_{$uniqueId} > 100) { threshold_{$uniqueId} = 100; }
   $("#threshold-{$uniqueId}").val(threshold_{$uniqueId});
   $("#threshold-slider-{$uniqueId}").val(threshold_{$uniqueId});

   //global function, part of API
   redraw();
}

var thresholdopacity_{$uniqueId} = 1;

$("#opacity-{$uniqueId}").val(thresholdopacity_{$uniqueId});

function opacityChange_{$uniqueId}(self) {
   thresholdopacity_{$uniqueId} = $(self).val();
   redraw();
}
EOF;


//print output: shader first and second part, the name of the image (required because OSD will program this variable for you)
send($definition, $execution, $html, $js, $glload, $gldraw, $samplerName);

?>						