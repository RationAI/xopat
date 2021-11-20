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

 //options offered by each shader, each option contains [type, default input HTML value]
 $options = array(
    $COLORS_NAME=>array(
       "color"=>["color", 'value="#d2eb00"'], 
       "logScale"=>["bool", ""], 
       "logScaleMax"=>["float", 'value="1.0" step="0.01" min="0"'], 
       "ctrlThreshold"=>["bool", "checked"], 
       "ctrlOpacity"=>["bool", "checked"], 
       "ctrlColor"=>["bool", "checked"],
       "inverse"=>["neg_bool", ""]),
    $EDGES_NAME=>array(
       "color"=>["color", 'value="#d2eb00"'], 
       "ctrlThreshold"=>["bool", "checked"], 
       "ctrlOpacity"=>["bool", "checked"], 
       "ctrlColor"=>["bool", "checked"],
       "edgeThickness"=>["float", 'value="1.0" step="0.1" min="0.5" max="3"'],
       "ctrlEdgeThickness"=>["bool", "checked"]),
    $BICOLORS_NAME=>array(
       "colorHigh"=>["color", 'value="#ff0000"'], 
       "colorLow"=>["color", 'value="#7cfc00"'], 
       "logScale"=>["neg_bool", ""], 
       "logScaleMax"=>["float", 'value="1.0" step="0.01" min="0"'], 
       "ctrlThreshold"=>["bool", "checked"], 
       "ctrlOpacity"=>["bool", "checked"], 
       "ctrlColor"=>["bool", "checked"]),
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
    "color"=>"color of the layer, default #d2eb00",
    "ctrlColor"=>"allow user to change color if set to 1",
    "ctrlThreshold"=>"allow user to control threshold if set to 1",
    "ctrlOpacity"=>"allow user to control opacity if set to 1",
    "inverse"=>"treat low values as high values and vice versa if set to 1",
    "logScale"=>"use logarithmic scale instead of linear if set to 1",
    "logScaleMax"=>"max value in logarithmic normalisation, used with logarithmic scale, this value is compared against pixel values (range from 0 to 1)",
    "colorHigh"=>"color for values closer to MAX (255), default #ff0000",
    "colorLow"=>"color for values closer to MIN (0), default #7cfc00",
    "edgeThickness"=>"edge thickness, default 1",
    "ctrlEdgeThickness"=>"allow user to control edge thickness"
 );

 //how a param type is mapped to HTML input type
 $htmlInputTypes = array(
    "color"=>"color", 
    "bool"=> "checkbox",
    "number"=>"number",
    "float"=>"number",
    "neg_bool" => "checkbox"
 );

 ?>