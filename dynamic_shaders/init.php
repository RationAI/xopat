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

$uniqueId = isset($data["uniqueId"]) ? $data["uniqueId"] : "";
$uniqueId .= $data["index"];


function toShaderFloatString($value, $precisionLen=5) {
    if (!is_numeric($precisionLen) || $precisionLen < 0 || $precisionLen > 9) {
      $precisionLen = 5;
    }
    $value = sprintf("%01.{$precisionLen}f", $value);
    return $value;
}

function prepare_send($definition, $dataName, $execution, $htmlPart, $jsPart, $glLoaded, $glDrawing) {
     return (object)array(
            "definition" => $definition,
            "execution" => $execution,
            "html" => $htmlPart,
            "js" => $jsPart,
            "glLoaded" => $glLoaded,
            "glDrawing" => $glDrawing,
            "sampler2D" => $dataName
        );
}

function send($definition, $dataName, $execution, $htmlPart = "", $jsPart = "", $glLoaded = "", $glDrawing = "") {
  if (!$definition || !$dataName || !$execution) {
    echo json_encode((object)array("error" => "Invalid shader.", 
    "desc" => "Missing compulsory parameters.<br>Definition: <code>$definition</code><br>Execution: <code>$execution</code><br>Sampler name: $dataName."));
  } else {
    echo json_encode(
      prepare_send($definition, $dataName, $execution, $htmlPart, $jsPart, $glLoaded, $glDrawing)
    );
  }    
}

?>