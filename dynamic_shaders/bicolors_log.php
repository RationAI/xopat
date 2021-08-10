<?php
/**
 *
 * Unifinished, untested
 *
 */
//contains $data variable initialization and functions (send(...)) 
require_once("init.php");
$r1=$g1=$b1=0;
if (isset($data["color1"])) {
    list($r1, $g1, $b1) = sscanf($data["color1"], "#%02x%02x%02x");
} else {
    //default red
    $r1 = 255;
    $g1 = 20;
    $b1 = 0;
} 
//convert to string and ensure there is always a dot present (1.0000 rather than 1)
$r1 = sprintf('%01.5f', $r1 / 255);
$g1 = sprintf('%01.5f', $g1 / 255);
$b1 = sprintf('%01.5f', $b1 / 255);
$r2=$g2=$b2=0;
if (isset($data["color2"])) {
    list($r2, $g2, $b2) = sscanf($data["color2"], "#%02x%02x%02x");
} else {
    //default red
    $r2 = 255;
    $g2 = 20;
    $b2 = 0;
}
$r2 = sprintf('%01.5f', $r2 / 255);
$g2 = sprintf('%01.5f', $g2 / 255);
$b2 = sprintf('%01.5f', $b2 / 255);
//first shader part, defines only uniform variables used
$definition = <<<EOF

uniform sampler2D data_{$data["index"]};
uniform float log_threshold_{$data["index"]};
uniform float rg_threshold_{$data["index"]};

bool close_{$data["index"]}(float value, float target) {
    return abs(target - value) < 0.01;
}

EOF;
//second shader part, if sampled grayscale value is significant, and above threshold, 
//output the color with threshold opacity decreased intentsity
$execution = <<<EOF

  vec4 data_{$data["index"]} = texture2D(data_{$data["index"]}, v_tile_pos);
  if (!close_{$data["index"]}(data_{$data["index"]}.b, .5)) {
    if (data_{$data["index"]}.b < .5) { //g2 color for small values
      float value_{$data["index"]} = 1.0 - data_{$data["index"]}.b * 2.0;
      float normalized_val_{$data["index"]} = (log2(log_threshold_{$data["index"]} + value_{$data["index"]}) - log2(log_threshold_{$data["index"]}))/(log2(log_threshold_{$data["index"]}+1.0)-log2(log_threshold_{$data["index"]}));
      if (normalized_val_{$data["index"]} > rg_threshold_{$data["index"]}) {
         out(vec4( $r2 , $g2 , $b2 , normalized_val_{$data["index"]}));
      }
    } else {  //r2 color for large values
      float value = (data_{$data["index"]}.b - 0.5) * 2.0;
      float normalized_val_{$data["index"]} = (log2(log_threshold_{$data["index"]} + value) - log2(log_threshold_{$data["index"]}))/(log2(log_threshold_{$data["index"]}+1.0)-log2(log_threshold_{$data["index"]}));
      if (normalized_val_{$data["index"]} > rg_threshold_{$data["index"]}) {
         out(vec4( $r1 , $g1 , $b1 , normalized_val_{$data["index"]}));
      } 
    }  
  }

EOF;

//print output: shader first and second part, the name of the image (required because OSD will program this variable for you)
send($definition, $execution, "data_{$data['index']}");
?>						