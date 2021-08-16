<?php

//EXISTING SHADERS
 $COLORS_NAME = "color";
 $COLORS_FILENAME = "colors";
 $EDGES_NAME = "edge";
 $EDGES_FILENAME = "edges";
 $BICOLORS_NAME = "dual-color";
 $BICOLORS_FILENAME = "bicolors";
 $IDENTITY_NAME = "identity";
 $IDENTITY_FILENAME = "identity";

 $shaders = array(
     $COLORS_NAME=>$COLORS_FILENAME,
     $EDGES_NAME=>$EDGES_FILENAME,
     $BICOLORS_NAME=>$BICOLORS_FILENAME,
     $IDENTITY_NAME=>$IDENTITY_FILENAME
 );

 //options offered by each shader
 $options = array(
    $COLORS_NAME=>array("color"=>"color", "logScale"=>"neg_bool", "logScaleMax"=>"float", "ctrlThreshold"=>"bool", "ctrlOpacity"=>"bool", "ctrlColor"=>"bool", "inverse"=>"neg_bool"),
    $EDGES_NAME=>array("color"=>"color", "ctrlThreshold"=>"bool", "ctrlOpacity"=>"bool", "ctrlColor"=>"bool"),
    $BICOLORS_NAME=>array("colorHigh"=>"color", "colorLow"=>"color", "logScale"=>"neg_bool", "logScaleMax"=>"float", "ctrlThreshold"=>"bool", "ctrlOpacity"=>"bool", "ctrlColor"=>"bool"),
    $IDENTITY_NAME=>array()
 );

 //shader short description
 $descriptions = array(
    $COLORS_NAME=>"data values encoded in opacity",
    $EDGES_NAME=>"highlights edges at threshold values",
    $BICOLORS_NAME=>"extreme values (both low and high) encoded in opacity",
    $IDENTITY_NAME=>"shows the data AS-IS"
 );

 //params short description
 $paramDescriptions = array(
    "color"=>"default color",
    "ctrlColor"=>"allow to change color",
    "ctrlThreshold"=>"allow to control threshold",
    "ctrlOpacity"=>"allow to control opacity",
    "inverse"=>"treat low values as high values and vice versa",
    "logScale"=>"use logarithmic scale instead of linear",
    "logScaleMax"=>"max value in logarithmic normalisation, used with logarithmic scale",
    "colorHigh"=>"color for values closer to MAX (255)",
    "colorLow"=>"color for values closer to MIN (0)"
 );

 //how a param type is mapped to HTML input type
 $htmlInputTypes = array(
    "color"=>"color", 
    "bool"=> "checkbox",
    "number"=>"number",
    "float"=>"number",
    "neg_bool" => "checkbox"
 );

 //what to append to HTML input tag - default value by type
$htmlInputValues = array(
    "color"=>'value="#d2eb00"', 
    "bool"=> "checked",
    "number"=>'value="1" min="0"',
    "float"=>'value="1.0" step="0.01" min="0"',
    "neg_bool"=>""
);


 ?>