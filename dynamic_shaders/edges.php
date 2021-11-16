<?php
/**
 * Edges shader
 * 
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - color to fill-in areas with values, url encoded '#ffffff' format or digits only 'ffffff', default "#d2eb00"
 *  ctrlColor - whether to allow color modification, 1 or 0, default 1
 *  ctrlThreshold - whether to allow threshold modification, 1 or 0, default 1
 *  ctrlOpacity - whether to allow opacity modification, 1 or 0, default 1
 * 
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

$allowColorChange = (!isset($data["ctrlColor"]) || $data["ctrlColor"] == "1");
$allowThresholdChange = (!isset($data["ctrlThreshold"]) || $data["ctrlThreshold"] == "1");
$allowOpacityChange = (!isset($data["ctrlOpacity"]) || $data["ctrlOpacity"] == "1");

$r = $r / 255;
$g = $g / 255;
$b = $b / 255;


$definition = <<<EOF

uniform float threshold_{$uniqueId};
uniform float opacity_{$uniqueId};
uniform float zoom_{$uniqueId};
uniform vec3 color_{$uniqueId};

//todo try replace with step function
float clipToThresholdf_{$uniqueId}(float value) {
    //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > threshold_{$uniqueId} || close(value, threshold_{$uniqueId}))) return 1.0;
    return 0.0;
}

//todo try replace with step function
int clipToThresholdi_{$uniqueId}(float value) {
     //for some reason the condition > 0.02 is crucial to render correctly...
    if ((value > 0.02 || close(value, 0.02)) && (value > threshold_{$uniqueId} || close(value, threshold_{$uniqueId}))) return 1;
    return 0;
}

vec4 getBorder_{$uniqueId}(float mid, float u, float b, float l, float r, float u2, float b2, float l2, float r2) {
    float mid2 = clipToThresholdf_{$uniqueId}(mid);  

    float dx = min(clipToThresholdf_{$uniqueId}(u2) - mid2, clipToThresholdf_{$uniqueId}(b2) - mid2);
    float dy = min(clipToThresholdf_{$uniqueId}(l2) - mid2, clipToThresholdf_{$uniqueId}(r2) - mid2);
    
    int counter = clipToThresholdi_{$uniqueId}(u) + 
                clipToThresholdi_{$uniqueId}(b) + 
                clipToThresholdi_{$uniqueId}(l) + 
                clipToThresholdi_{$uniqueId}(r);
    
    if(counter == 2 || counter == 3) {  //two or three points hit the region
        return vec4(color_{$uniqueId}, 1.0); //border
    } else if ((dx < -0.5 || dy < -0.5)) {
        return vec4(color_{$uniqueId} * 0.7, .7); //inner border
    } 
    return vec4(.0, .0, .0, .0);
}

EOF;

//second shader part, if sampled grayscale value is significant, and above threshold, 
//output the color with threshold opacity decreased intentsity
$execution = <<<EOF

    float data_{$uniqueId} = {$texture('v_tile_pos')}.r;
    float dist_{$uniqueId} = 0.005 * sqrt(sqrt(zoom_{$uniqueId}));

    float up_{$uniqueId} = {$texture("vec2(v_tile_pos.x - dist_{$uniqueId}, v_tile_pos.y)")}.r;
    float bottom_{$uniqueId} = {$texture("vec2(v_tile_pos.x + dist_{$uniqueId}, v_tile_pos.y)")}.r; 
    float left_{$uniqueId} = {$texture("vec2(v_tile_pos.x, v_tile_pos.y - dist_{$uniqueId})")}.r; 
    float right_{$uniqueId} = {$texture("vec2(v_tile_pos.x, v_tile_pos.y + dist_{$uniqueId})")}.r;

    float up2_{$uniqueId} = {$texture("vec2(v_tile_pos.x - 3.0*dist_{$uniqueId}, v_tile_pos.y)")}.r;
    float bottom2_{$uniqueId} = {$texture("vec2(v_tile_pos.x + 3.0*dist_{$uniqueId}, v_tile_pos.y)")}.r; 
    float left2_{$uniqueId} = {$texture("vec2(v_tile_pos.x, v_tile_pos.y - 3.0*dist_{$uniqueId})")}.r; 
    float right2_{$uniqueId} =  {$texture("vec2(v_tile_pos.x, v_tile_pos.y + 3.0*dist_{$uniqueId})")}.r;

    vec4 border_{$uniqueId} = getBorder_{$uniqueId}(data_{$uniqueId}, up_{$uniqueId}, bottom_{$uniqueId}, left_{$uniqueId},
                                right_{$uniqueId}, up2_{$uniqueId}, bottom2_{$uniqueId}, left2_{$uniqueId}, right2_{$uniqueId});
                                                               
    //we don't know the ZOOM max level, opacity created empirically
    //float borderOpacity_{$uniqueId} = min(max(0.0, (zoom_{$uniqueId}-1.0)) / 2.0, 1.0);
    show(vec4(border_{$uniqueId}.rgb, border_{$uniqueId}.a * opacity_{$uniqueId}));
    
EOF;

$glload = <<<EOF
threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'opacity_{$uniqueId}');
zoom_gl_{$uniqueId} = gl.getUniformLocation(program, 'zoom_{$uniqueId}');
color_gl_{$uniqueId} = gl.getUniformLocation(program, 'color_{$uniqueId}');
EOF;

$gldraw = <<<EOF
gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, opacity_{$uniqueId});
gl.uniform1f(zoom_gl_{$uniqueId}, viewer.viewport.getZoom(true)); //todo dirty touching of global variable
gl.uniform1f(zoom_gl_{$uniqueId}, viewer.viewport.getZoom(true)); 
gl.uniform3fv(color_gl_{$uniqueId}, color_{$uniqueId});
EOF;

//html part: controls rendered under shader settings, allows user to change shader uniform values
$html = "";
if ($allowColorChange) {
    $html .= <<<EOF
<span> Color:</span><input type="color" class="form-control input-sm" id="color-{$uniqueId}" onchange="colorChange_{$uniqueId}(this)"><br>
EOF;
}

if ($allowOpacityChange) {
    $html .= <<<EOF
<span> Opacity:</span><input type="range" id="opacity-{$uniqueId}" onchange="opacityChange_{$uniqueId}(this)" min="0" max="1" value="0" step="0.1"><br>
EOF;
}

if ($allowThresholdChange) {
    $html .= <<<EOF
<span> Threshold:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" value="1" step="1">
<input class="form-control input-sm" type="number" style="max-width:60px;" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="1"><br>
EOF;
}

//js part: controls action: update controls if necessary and invoke `redraw();`
$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId}, zoom_gl_{$uniqueId}, color_gl_{$uniqueId};

//initial values
let threshold_{$uniqueId} = {$getJSProperty('threshold', 1)}
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

let color_{$uniqueId} = {$getJSProperty('color', "[$r, $g, $b]")};
$("#color-{$uniqueId}").val("#" + Math.round(color_{$uniqueId}[0] * 255).toString(16).padStart(2, "0") +  Math.round(color_{$uniqueId}[1] * 255).toString(16).padStart(2, "0") +  Math.round(color_{$uniqueId}[2] * 255).toString(16).padStart(2, "0"));

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