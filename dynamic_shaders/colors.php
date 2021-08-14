<?php
/**
 * Colors shader
 * 
 * $_GET expected parameters:
 *  index - unique number in the compiled shader
 * $_GET supported parameters:
 *  color - color to fill-in areas with values, url encoded '#ffffff' format or digits only 'ffffff', default "#d2eb00"
 *  ctrlColor - whether to allow color modification, true or false, default true
 *  ctrlThreshold - whether to allow threshold modification, true or false, default true
 *  ctrlOpacity - whether to allow opacity modification, true or false, default true
 * 
 * colors shader will read underlying data (red component) and output
 * to canvas defined color with opacity based on the data
 * (0.0 => transparent, 1.0 => opaque)
 * supports thresholding - outputs color on areas above certain value
 * mapping html input slider 0-100 to .0-1.0
 */
require_once("init.php");

$r=$g=$b=0;

$color = "";
if (isset($data["color"])) {

    $color = ltrim(urldecode($data["color"]), "#");
    list($r, $g, $b) = sscanf($color, "%02x%02x%02x");
    $color = "#$color"; //make sure hash present for default input value later
} else {
    //default yellow
    $color = "#d2eb00";
    $r = 210;
    $g = 235;
    $b = 0;
} 

$allowColorChange = (!isset($data["ctrlColor"]) || $data["ctrlColor"] != 'false');
$allowThresholdChange = (!isset($data["ctrlThreshold"]) || $data["ctrlThreshold"] != 'false');
$allowOpacityChange = (!isset($data["ctrlOpacity"]) || $data["ctrlOpacity"] != 'false');

$samplerName = "tile_data_{$uniqueId}";

$r = $r / 255;
$g = $g / 255;
$b = $b / 255;

$definition = <<<EOF

uniform sampler2D $samplerName;
uniform float threshold_{$uniqueId};
uniform float threshold_opacity_{$uniqueId};
uniform vec3 color_{$uniqueId};

EOF;

$execution = <<<EOF

  vec4 data{$uniqueId} = texture2D($samplerName, v_tile_pos);
  if(data{$uniqueId}.r > 0.02 && data{$uniqueId}.r > threshold_{$uniqueId}){
    show(vec4(color_{$uniqueId}, data{$uniqueId}.r * threshold_opacity_{$uniqueId}));
  }

EOF;

$glload = <<<EOF

threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_opacity_{$uniqueId}');
color_gl_{$uniqueId} = gl.getUniformLocation(program, 'color_{$uniqueId}');

EOF;


$gldraw = <<<EOF

gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, thresholdopacity_{$uniqueId});
gl.uniform3fv(color_gl_{$uniqueId}, color_{$uniqueId});

EOF;

$html = "";
if ($allowColorChange) {
  $html .= <<<EOF
  <span> Color:</span><input type="color" id="color-{$uniqueId}" class="form-control input-sm"  onchange="colorChange_{$uniqueId}(this)"><br>
  EOF;
}

if ($allowOpacityChange) {
  $html .= <<<EOF
  <span> Opacity:</span><input type="range" id="opacity-{$uniqueId}" onchange="opacityChange_{$uniqueId}(this)" min="0" max="1" value="0" step="0.1"><br>
  EOF;
}

if ($allowThresholdChange) {
  $html .= <<<EOF
  <span> Threshold:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" value="0" step="1">
  <input class="form-control input-sm" style="max-width:60px;" type="number" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="0"><br>
  EOF;
}




$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId}, color_gl_{$uniqueId};

var threshold_{$uniqueId} = loadCache("threshold_{$uniqueId}", 1);

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
   saveCache("threshold_{$uniqueId}", threshold_{$uniqueId});

   //global function, part of API
   redraw();
}

var thresholdopacity_{$uniqueId} = loadCache("thresholdopacity_{$uniqueId}", 1);

$("#opacity-{$uniqueId}").val(thresholdopacity_{$uniqueId});

function opacityChange_{$uniqueId}(self) {
   thresholdopacity_{$uniqueId} = $(self).val();
   saveCache("thresholdopacity_{$uniqueId}", thresholdopacity_{$uniqueId});
   redraw();
}

var color_{$uniqueId} = loadCache("color_{$uniqueId}", [$r, $g, $b]);
$("#color-{$uniqueId}").val("#" + Math.round(color_{$uniqueId}[0] * 255).toString(16).padStart(2, "0") +  Math.round(color_{$uniqueId}[1] * 255).toString(16).padStart(2, "0") +  Math.round(color_{$uniqueId}[2] * 255).toString(16).padStart(2, "0"));

function colorChange_{$uniqueId}(self) {
    let col = $(self).val();
    color_{$uniqueId}[0] = parseInt(col.substr(1,2),16) / 255;
    color_{$uniqueId}[1] = parseInt(col.substr(3,2),16) / 255;
    color_{$uniqueId}[2] = parseInt(col.substr(5,2),16) / 255;
    saveCache("color_{$uniqueId}", color_{$uniqueId});

    redraw();
}
EOF;

send($definition, $samplerName, $execution, $html, $js, $glload, $gldraw);

?>						