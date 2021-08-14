<?php

//EXISTING SHADERS
 $COLORS_NAME = "color";
 $COLORS_FILENAME = "colors";
 $EDGES_NAME = "edge";
 $EDGES_FILENAME = "edges";
 $IDENTITY_NAME = "identity";
 $IDENTITY_FILENAME = "identity";

 $shaders = array(
     $COLORS_NAME=>$COLORS_FILENAME,
     $EDGES_NAME=>$EDGES_FILENAME,
     $IDENTITY_NAME=>$IDENTITY_FILENAME
 );

 //options offered by each shader
 $options = array(
    $COLORS_NAME=>array("color"=>"color", "ctrlThreshold"=>"bool", "ctrlOpacity"=>"bool", "ctrlColor"=>"bool"),
    $EDGES_NAME=>array("color"=>"color", "ctrlThreshold"=>"bool", "ctrlOpacity"=>"bool", "ctrlColor"=>"bool"),
    $IDENTITY_NAME=>array()
 );

 $descriptions = array(
    $COLORS_NAME=>"extreme values encoded in opacity",
    $EDGES_NAME=>"highlights edges at threshold values",
    $IDENTITY_NAME=>"shows the data AS-IS"
 );

 $paramDescriptions = array(
    "color"=>"default color",
    "ctrlColor"=>"allow to change color",
    "ctrlThreshold"=>"allow to control threshold",
    "ctrlOpacity"=>"allow to control opacity",

 );


 $htmlInputTypes = array(
    "color"=>"color", 
    "bool"=> "checkbox",
    "number"=>"number"
 );

$htmlInputValues = array(
    "color"=>'value="#d2eb00"', 
    "bool"=> "checked",
    "number"=>'value="1"'
);


 ?>