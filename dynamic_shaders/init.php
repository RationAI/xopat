<?php
$data = null;
if (isset($_GET["index"])) {
  $data = $_GET;
} else if (isset($_POST["index"])) {
  $data = $_POST;
} else {
  die("No data was specified. The shader part could not be generated.");
}

$uniqueId = isset($data["unique_id"]) ? $data["unique_id"] : "";
$uniqueId .= $data["index"];

function toShaderFloatString($value, $precisionLen=5) {
    if (!is_numeric($precisionLen) || $precisionLen < 0 || $precisionLen > 9) {
      $precisionLen = 5;
    }
    $value = sprintf("%01.{$precisionLen}f", $value);
    return $value;
}

function prepare_send($definition, $execution, $html_part, $js_part, $gl_loaded, $gl_drawing, $data_name) {
     return (object)array(
            "definition" => $definition,
            "execution" => $execution,
            "html" => $html_part,
            "js" => $js_part,
            "gl_loaded" => $gl_loaded,
            "gl_drawing" => $gl_drawing,
            "sampler2D" => $data_name
        );
}

function send($definition, $execution, $html_part, $js_part, $gl_loaded, $gl_drawing, $data_name) {
    echo json_encode(
        prepare_send($definition, $execution, $html_part, $js_part, $gl_loaded, $gl_drawing, $data_name)
    );
}

?>