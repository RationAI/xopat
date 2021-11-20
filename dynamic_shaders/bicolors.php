<?php
/**
 * Bi-colors shader
 * 
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  colorHigh - color to fill-in areas with high values (-->255), url encoded '#ffffff' format or digits only 'ffffff', default "#ff0000"
 *  colorLow - color to fill-in areas with low values (-->0), url encoded '#ffffff' format or digits only 'ffffff', default "#7cfc00"
 *  ctrlColor - whether to allow color modification, true or false, default true
 *  ctrlThreshold - whether to allow threshold modification, true or false, default true
 *  ctrlOpacity - whether to allow opacity modification, true or false, default true
 *  logScale - use logarithmic scale instead of linear, 1 or 0, default 0
 *  logScaleMax - maximum value used in the scale (remember, data values range from 0 to 1), default 1.0
 * 
 * this shader considers insignificant values to be around the middle (0.5), and significant are low or high values,
 * the value itself is encoded in opacity (close to 1 if too low or too high), user can define two colors, for low and high values respectively 
 */
require_once("init.php");

$colorHigh = [255, 0, 0];
if (isset($data["colorHigh"])) {
  $colorHigh = toRGBColorFromString($data["colorHigh"], $colorHigh);
} 

$colorLow = [124, 252, 0];
if (isset($data["colorLow"])) {
  $colorLow = toRGBColorFromString($data["colorLow"], $colorLow);
} 

$rH = $colorHigh[0] / 255;
$gH = $colorHigh[1] / 255;
$bH = $colorHigh[2] / 255;
$rL = $colorLow[0] / 255;
$gL = $colorLow[1] / 255; 
$bL = $colorLow[2] / 255;

//flags
$allowColorChange = (!isset($data["ctrlColor"]) || $data["ctrlColor"] == "1");
$allowThresholdChange = (!isset($data["ctrlThreshold"]) || $data["ctrlThreshold"] == "1");
$allowOpacityChange = (!isset($data["ctrlOpacity"]) || $data["ctrlOpacity"] == "1");
$logScale = (isset($data["logScale"]) && $data["logScale"] == "1");

//other values
$logScaleMax = isset($data["logScaleMax"]) ? toShaderFloatString($data["logScaleMax"], 100, 2) : "100.0";
$samplerName = "tile_data_{$uniqueId}";

//definition part
$definition = <<<EOF

uniform float threshold_{$uniqueId};
uniform float opacity_{$uniqueId};
uniform vec3 colorHigh_{$uniqueId};
uniform vec3 colorLow_{$uniqueId};

EOF;

//execution part
if ($logScale) {
    $compareAgainst = "float normalized_{$uniqueId} = (log2($logScaleMax + value_{$uniqueId}) - log2($logScaleMax))/(log2($logScaleMax+1.0)-log2($logScaleMax));";
    $comparison = "normalized_{$uniqueId} > threshold_{$uniqueId}";
    $alpha = "normalized_{$uniqueId} * opacity_{$uniqueId}";
} else {
    $compareAgainst = "";
    $comparison = "value_{$uniqueId} > threshold_{$uniqueId}";
    $alpha = "value_{$uniqueId} * opacity_{$uniqueId}";
}
$compConst = $invertOpacity ? "< 0.98" : " > 0.02";
$defaultThresholdValue = $invertOpacity ? "100" : "1";

$execution = <<<EOF

    vec4 data_{$uniqueId} = {$texture('tile_texture_coords')};
    if (!close(data_{$uniqueId}.b, .5)) {
        if (data_{$uniqueId}.b < .5) { //g2 color for small values
            float value_{$uniqueId} = 1.0 - data_{$uniqueId}.b * 2.0;
            $compareAgainst
            if ($comparison) {
                show(vec4( colorLow_{$uniqueId} , $alpha));
            }
        } else {  //r2 color for large values
            float value_{$uniqueId} = (data_{$uniqueId}.b - 0.5) * 2.0;
            $compareAgainst
            if ($comparison) {
                show(vec4( colorHigh_{$uniqueId} , $alpha));
            } 
        }  
    }

EOF;

//glLoad, glDraw
$glload = <<<EOF

threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'opacity_{$uniqueId}');
colorHigh_gl_{$uniqueId} = gl.getUniformLocation(program, 'colorHigh_{$uniqueId}');
colorLow_gl_{$uniqueId} = gl.getUniformLocation(program, 'colorLow_{$uniqueId}');

EOF;


$gldraw = <<<EOF

gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, opacity_{$uniqueId});
gl.uniform3fv(colorHigh_gl_{$uniqueId}, colorHigh_{$uniqueId});
gl.uniform3fv(colorLow_gl_{$uniqueId}, colorLow_{$uniqueId});

EOF;

$html = "";
if ($allowColorChange) {
  $html .= <<<EOF
<span> High values:</span><input type="color" id="color-high-{$uniqueId}" class="form-control input-sm"  onchange="colorHighChange_{$uniqueId}(this)"><br>
<span> Low values:</span><input type="color" id="color-low-{$uniqueId}" class="form-control input-sm"  onchange="colorLowChange_{$uniqueId}(this)"><br>
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
<span> Threshold$logname:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" $directionRange value="1" step="1">
<input class="form-control input-sm" style="max-width:60px;" type="number" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="1"><br>
EOF;
}


$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId}, colorHigh_gl_{$uniqueId}, colorLow_gl_{$uniqueId};

var threshold_{$uniqueId} = {$getJSProperty('threshold', 1)}

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

let colorHigh_{$uniqueId} = {$getJSProperty('colorHigh', "[$rH, $gH, $bH]")};
$("#color-high-{$uniqueId}").val("#" + Math.round(colorHigh_{$uniqueId}[0] * 255).toString(16).padStart(2, "0") +  Math.round(colorHigh_{$uniqueId}[1] * 255).toString(16).padStart(2, "0") +  Math.round(colorHigh_{$uniqueId}[2] * 255).toString(16).padStart(2, "0"));

function colorHighChange_{$uniqueId}(self) {
    let col = $(self).val();
    colorHigh_{$uniqueId}[0] = parseInt(col.substr(1,2),16) / 255;
    colorHigh_{$uniqueId}[1] = parseInt(col.substr(3,2),16) / 255;
    colorHigh_{$uniqueId}[2] = parseInt(col.substr(5,2),16) / 255;
    {$setJSProperty('colorHigh', "colorHigh_{$uniqueId}")};

    redraw();
}

var colorLow_{$uniqueId} = {$getJSProperty('colorLow', "[$rL, $gL, $bL]")};
$("#color-low-{$uniqueId}").val("#" + Math.round(colorLow_{$uniqueId}[0] * 255).toString(16).padStart(2, "0") +  Math.round(colorLow_{$uniqueId}[1] * 255).toString(16).padStart(2, "0") +  Math.round(colorLow_{$uniqueId}[2] * 255).toString(16).padStart(2, "0"));

function colorLowChange_{$uniqueId}(self) {
    let col = $(self).val();
    colorLow_{$uniqueId}[0] = parseInt(col.substr(1,2),16) / 255;
    colorLow_{$uniqueId}[1] = parseInt(col.substr(3,2),16) / 255;
    colorLow_{$uniqueId}[2] = parseInt(col.substr(5,2),16) / 255;
    {$setJSProperty('colorLow', "colorLow_{$uniqueId}")};

    redraw();
}
EOF;

send($definition, $execution, $html, $js, $glload, $gldraw);

?>						