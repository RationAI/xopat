<?php

set_exception_handler(function($exception) {
  $msg = $exception->getMessage();
  echo json_encode((object)array("error" => "Unknown error. This shader will be unusable.", "desc" => "<code>$msg</code>"));
});

$data = null;
if (isset($_GET["index"])) {
  $data = $_GET;
} else if (isset($_POST["index"])) {
  $data = $_POST;
} else {
  die("No data was specified. The shader part could not be generated.");
}

$index = $data["index"];

$uniqueId = isset($data["uniqueId"]) ? $data["uniqueId"] : "";
$uniqueId .= $index;


//default ON
$webGL2 = true;
if (isset($data["webgl2"])) {
  $webGL2 = json_decode($data["webgl2"]);
} 

//texture naming convention
$texture_name = $webGL2 ? "vis_data_sampler_array" : "vis_data_sampler_{$index}";

$texture = function($sampling_coords) {
  global $texture_name, $webGL2, $index;

  if ($webGL2) {
    return "texture($texture_name, vec3($sampling_coords, $index))";
  } 
  return "texture2D($texture_name, $sampling_coords)";
};

function toShaderFloatString($value, $default, $precisionLen=5) {
  if (!is_numeric($precisionLen) || $precisionLen < 0 || $precisionLen > 9) {
    $precisionLen = 5;
  }
  try {     
    return sprintf("%01.{$precisionLen}f", $value);
  } catch (\Exception $e) {
    //ignore and use default
    return sprintf("%01.{$precisionLen}f", $default);
  }   
}

function toRGBColorFromString($toParse, $default) {
  try {     
    $color = ltrim(urldecode($toParse), "#");
    $arr = sscanf($color, "%02x%02x%02x");
    return $arr;
  } catch (\Exception $e) {
    //ignore and use default
    return $default;
  }   
}

function prepare_send($definition, $execution, $htmlPart, $jsPart, $glLoaded, $glDrawing) {
     return (object)array(
            "definition" => $definition,
            "execution" => $execution,
            "html" => $htmlPart,
            "js" => $jsPart,
            "glLoaded" => $glLoaded,
            "glDrawing" => $glDrawing
        );
}

function send($definition, $execution, $htmlPart = "", $jsPart = "", $glLoaded = "", $glDrawing = "") {
  if (!$definition || !$execution) {
    echo json_encode((object)array("error" => "Invalid shader.", 
    "desc" => "Missing compulsory parameters.<br>Definition: <code>$definition</code><br>Execution: <code>$execution</code>"));
  } else {
    echo json_encode(
      prepare_send($definition, $execution, $htmlPart, $jsPart, $glLoaded, $glDrawing)
    );
  }    
}

?>