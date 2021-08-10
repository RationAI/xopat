<?php
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
//availabe variables gl: webGL context, program: current compiled gl program in use 
$glload = ""; //nothing

//gl-drawing: what happens when gl draw event is invoked? send non-constant values to GPU
//availabe variables gl: webGL context, e: current OSD Tile object
$gldraw = ""; //nothing

//html part: controls rendered under shader settings, allows user to change shader uniform values
$html = ""; //nothing

//js part: controls action: update controls if necessary and invoke `redraw();`
$js = ""; //nothing


//print output: shader first and second part, the name of the image (required because OSD will program this variable for you)
send($definition, $execution, $html, $js, $glload, $gldraw, $samplerName);

?>						