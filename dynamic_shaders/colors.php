<?php
/**
 * Colors shader
 * 
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - color to fill-in areas with values, url encoded '#ffffff' format or digits only 'ffffff', default "#d2eb00"
 *  ctrlColor - whether to allow color modification, 1 or 0, default 1
 *  ctrlThreshold - whether to allow threshold modification, 1 or 0, default 1
 *  ctrlOpacity - whether to allow opacity modification, 1 or 0, default 1
 *  inverse - low values are high opacities instead of high values, 1 or 0, default 0
 *  logScale - use logarithmic scale instead of linear, 1 or 0, default 0
 *  logScaleMax - maximum value used in the scale (remember, data values range from 0 to 1), default 1.0
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

$r = $r / 255;
$g = $g / 255;
$b = $b / 255;

//flags
$allowColorChange = (!isset($data["ctrlColor"]) || $data["ctrlColor"] == "1");
$allowThresholdChange = (!isset($data["ctrlThreshold"]) || $data["ctrlThreshold"] == "1");
$allowOpacityChange = (!isset($data["ctrlOpacity"]) || $data["ctrlOpacity"] == "1");
$invertOpacity = (isset($data["inverse"]) && $data["inverse"] == "1");
$logScale = (isset($data["logScale"]) && $data["logScale"] == "1");

//other values
$logScaleMax = isset($data["logScaleMax"]) ? toShaderFloatString($data["logScaleMax"], 100, 2) : "1.0";
$samplerName = "tile_data_{$uniqueId}";

//definition part
$definition = <<<EOF

uniform float threshold_{$uniqueId};
uniform float opacity_{$uniqueId};
uniform vec3 color_{$uniqueId};

EOF;

//execution part
$comparison = $invertOpacity ? "<" : ">";
if ($logScale) {
    $compareAgainst = "float normalized_{$uniqueId} = (log2($logScaleMax + data{$uniqueId}.r) - log2($logScaleMax))/(log2($logScaleMax+1.0)-log2($logScaleMax));";
    $comparison = "normalized_{$uniqueId} $comparison threshold_{$uniqueId}";
    $alpha = ($invertOpacity ? "(1.0 - normalized_{$uniqueId})" : "normalized_{$uniqueId}") . " * opacity_{$uniqueId}";
} else {
    $compareAgainst = "";
    $comparison = "data{$uniqueId}.r $comparison threshold_{$uniqueId}";
    $alpha = ($invertOpacity ? "(1.0 - data{$uniqueId}.r)" : "data{$uniqueId}.r") . " * opacity_{$uniqueId}";
}
$compConst = $invertOpacity ? "< 0.98" : " > 0.02";
$defaultThresholdValue = $invertOpacity ? "100" : "1";

$execution = <<<EOF

    vec4 data{$uniqueId} = {$texture('v_tile_pos')};
    $compareAgainst
    if(data{$uniqueId}.r $compConst && $comparison){
        show(vec4(color_{$uniqueId}, $alpha));
    }

EOF;

//glLoad, glDraw
$glload = <<<EOF

threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'opacity_{$uniqueId}');
color_gl_{$uniqueId} = gl.getUniformLocation(program, 'color_{$uniqueId}');

EOF;


$gldraw = <<<EOF

gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, opacity_{$uniqueId});
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
    $directionRange = $invertOpacity ? 'style="direction: rtl"' : "";
    $logname = $logScale ? " (log scale)" : "";
    $html .= <<<EOF
<span> Threshold$logname:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" $directionRange value="$defaultThresholdValue" step="1">
<input class="form-control input-sm" style="max-width:60px;" type="number" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="$defaultThresholdValue"><br>
EOF;
}


$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId}, color_gl_{$uniqueId};

let threshold_{$uniqueId} = {$getJSProperty('threshold', $defaultThresholdValue)}
//initial values
$("#threshold-{$uniqueId}").val(threshold_{$uniqueId});
$("#threshold-slider-{$uniqueId}").val(threshold_{$uniqueId});

//updater
function thresholdChange_{$uniqueId}(self) {
    threshold_{$uniqueId} = $(self).val();
    threshold_{$uniqueId} = Math.max(Math.min(threshold_{$uniqueId}, 100), 1);
    $("#threshold-{$uniqueId}").val(threshold_{$uniqueId});
    $("#threshold-slider-{$uniqueId}").val(threshold_{$uniqueId});
    {$setJSProperty('threshold', "threshold_{$uniqueId}")};

    //global function, part of API
    redraw();
}

let opacity_{$uniqueId} = {$getJSProperty('opacity', 1)};
$("#opacity-{$uniqueId}").val(opacity_{$uniqueId});

function opacityChange_{$uniqueId}(self) {
    opacity_{$uniqueId} = $(self).val();
    {$setJSProperty('opacity', "opacity_{$uniqueId}")};
    redraw();
}

var color_{$uniqueId} = {$getJSProperty('color', "[$r, $g, $b]")};
$("#color-{$uniqueId}").val("#" + Math.round(color_{$uniqueId}[0] * 255).toString(16).padStart(2, "0") + Math.round(color_{$uniqueId}[1] * 255).toString(16).padStart(2, "0") +  Math.round(color_{$uniqueId}[2] * 255).toString(16).padStart(2, "0"));

function colorChange_{$uniqueId}(self) {
    let col = $(self).val();
    color_{$uniqueId}[0] = parseInt(col.substr(1,2),16) / 255;
    color_{$uniqueId}[1] = parseInt(col.substr(3,2),16) / 255;
    color_{$uniqueId}[2] = parseInt(col.substr(5,2),16) / 255;
    {$setJSProperty('color', "color_{$uniqueId}")};

    redraw();
}
EOF;

send($definition, $execution, $html, $js, $glload, $gldraw);

?>						