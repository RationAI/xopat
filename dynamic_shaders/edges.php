<?php
/**
 * Edges shader
 * 
 * $_GET expected parameters:
 *  index - unique number in the compiled shader
 * $_GET supported parameters:
 *  color - color to use on edges, default yellow
 * 
 */
require_once("init.php");

$r=$g=$b=$r_dark=$g_dark=$b_dark=0;

if (!isset($data["color"])) {
    $data["color"] = "#d2eb00"; //default yellow
} else {
    $data["color"] = urldecode($data["color"]);
}

list($r, $g, $b) = adjustBrightness($data["color"], 0); //parse original color
$r = toShaderFloatString($r); 
$g = toShaderFloatString($g); 
$b = toShaderFloatString($b); 

list($r_dark, $g_dark, $b_dark) = adjustBrightness($data["color"], 0); //parse original color
$r_dark = toShaderFloatString($r_dark); 
$g_dark = toShaderFloatString($g_dark); 
$b_dark = toShaderFloatString($b_dark); 

$samplerName = "tile_data_{$uniqueId}";

/**
 * https://stackoverflow.com/questions/3512311/how-to-generate-lighter-darker-color-with-php
 * Increases or decreases the brightness of a color by a percentage of the current brightness.
 *
 * @param   string  $hexCode        Supported formats: `#FFF`, `#FFFFFF`, `FFF`, `FFFFFF`
 * @param   float   $adjustPercent  A number between -1 and 1. E.g. 0.3 = 30% lighter; -0.4 = 40% darker.
 *
 * @return  array   [r g b] r g b conponents in decimal values, ready to be used by shader (between 0 and 1)
 *
 * @author  maliayas (modified)
 */
function adjustBrightness($hexCode, $adjustPercent) {
    $hexCode = ltrim($hexCode, '#');

    if (strlen($hexCode) == 3) {
        $hexCode = $hexCode[0] . $hexCode[0] . $hexCode[1] . $hexCode[1] . $hexCode[2] . $hexCode[2];
    }

    $hexCode = array_map('hexdec', str_split($hexCode, 2));

    foreach ($hexCode as & $color) {
        $adjustableLimit = $adjustPercent < 0 ? $color : 255 - $color;
        $adjustAmount = ceil($adjustableLimit * $adjustPercent);

        $color = ($color + $adjustAmount) / 255;
    }

    return $hexCode;
}


$definition = <<<EOF

uniform sampler2D $samplerName;
uniform float threshold_{$uniqueId};
uniform float threshold_opacity_{$uniqueId};
uniform float zoom_{$uniqueId};

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
       return vec4($r, $g, $b, 1.0); //border
    } else if ((dx < -0.5 || dy < -0.5)) {
       return vec4($r_dark, $g_dark, $b_dark, .7); //inner border
    } 
    return vec4(.0, .0, .0, .0);
}

EOF;

//second shader part, if sampled grayscale value is significant, and above threshold, 
//output the color with threshold opacity decreased intentsity
$execution = <<<EOF

    float data_{$uniqueId} = texture2D($samplerName, v_tile_pos).g;
    float dist_{$uniqueId} = 0.01;

    float up_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x - dist_{$uniqueId}, v_tile_pos.y)).g;
    float bottom_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x + dist_{$uniqueId}, v_tile_pos.y)).g;
    float left_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x, v_tile_pos.y - dist_{$uniqueId})).g;
    float right_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x, v_tile_pos.y + dist_{$uniqueId})).g;

    float up2_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x - 3.0*dist_{$uniqueId}, v_tile_pos.y)).g;
    float bottom2_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x + 3.0*dist_{$uniqueId}, v_tile_pos.y)).g;
    float left2_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x, v_tile_pos.y - 3.0*dist_{$uniqueId})).g;
    float right2_{$uniqueId} = texture2D($samplerName, vec2(v_tile_pos.x, v_tile_pos.y + 3.0*dist_{$uniqueId})).g;

    vec4 border_{$uniqueId} = getBorder_{$uniqueId}(data_{$uniqueId}, up_{$uniqueId}, bottom_{$uniqueId}, left_{$uniqueId},
                                right_{$uniqueId}, up2_{$uniqueId}, bottom2_{$uniqueId}, left2_{$uniqueId}, right2_{$uniqueId});
                                                               
    //we don't know the ZOOM max level, opacity created empirically
    float borderOpacity_{$uniqueId} = min(max(0.0, (zoom_{$uniqueId}-1.0)) / 2.0, 1.0);
    show(vec4(border_{$uniqueId}.r, border_{$uniqueId}.g, border_{$uniqueId}.b, border_{$uniqueId}.a * borderOpacity_{$uniqueId} * threshold_opacity_{$uniqueId}));
    
    // if (clipToThresholdi_(data.r) == 1){
    //     if (data.g > 0.1) {
    //         gl_FragColor = blend(vec4(0.823529, 0.9215686, 0.0, data.r * threshold_opacity), vec4(0.0, 1.0, 1.0, 1.0), data.r * threshold_opacity);
    //         border = maxblend(border, annotationBorder);
    //     } else {
    //         gl_FragColor = vec4(0.823529, 0.9215686, 0.0, data.r * threshold_opacity);
    //     }   
    //     gl_FragColor = blend(border, gl_FragColor, borderOpacity * threshold_opacity);
    // } else if (data.g > 0.1) {
    //     gl_FragColor = blend(annotationBorder, vec4(0.0, 1.0, 1.0, 1.0), borderOpacity * threshold_opacity);
    // } 

EOF;

$glload = <<<EOF
threshold_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_{$uniqueId}');
opacity_gl_{$uniqueId} = gl.getUniformLocation(program, 'threshold_opacity_{$uniqueId}');
zoom_gl_{$uniqueId} = gl.getUniformLocation(program, 'zoom_{$uniqueId}');
EOF;

$gldraw = <<<EOF
gl.uniform1f(threshold_gl_{$uniqueId}, threshold_{$uniqueId} / 100.0);
gl.uniform1f(opacity_gl_{$uniqueId}, thresholdopacity_{$uniqueId});
gl.uniform1f(zoom_gl_{$uniqueId}, viewer.viewport.getZoom(true)); //todo dirty touching of global variable
EOF;

//html part: controls rendered under shader settings, allows user to change shader uniform values
$html = <<<EOF
<span> Edges Opacity:</span><input type="range" id="opacity-{$uniqueId}" onchange="opacityChange_{$uniqueId}(this)" min="0" max="1" value="0" step="0.1">
<br>

<span> Edges Threshold:</span><input type="range" id="threshold-slider-{$uniqueId}" class="with-direct-input" onchange="thresholdChange_{$uniqueId}(this)" min="1" max="100" value="0" step="1">
<input type="number" onchange="thresholdChange_{$uniqueId}(this)" id="threshold-{$uniqueId}" value="0">
<br>
EOF;

//js part: controls action: update controls if necessary and invoke `redraw();`
$js = <<<EOF
var threshold_gl_{$uniqueId}, opacity_gl_{$uniqueId}, zoom_gl_{$uniqueId};

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

send($definition, $execution, $html, $js, $glload, $gldraw, $samplerName);

?>						