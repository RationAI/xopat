<?php

set_exception_handler(function($exception) {
    $msg = $exception->getMessage();
    echo json_encode((object)array("error" => "Unknown error. This shader will be unusable.", "desc" => "<code>$msg</code>"));
});

//data can be send either using POST or GET
$data = null;
if (isset($_GET["index"])) {
    $data = $_GET;
} else if (isset($_POST["index"])) {
    $data = $_POST;
} else {
    die("Missing index. The shader part could not be generated.");
}

if (!isset($data["dataId"])) {
    die("Missing data ID. The shader part could not be generated.");
}

//index of the data
$index = $data["index"];
$dataId = $data["dataId"];
//WebGL2 (OpenGL ES 3) default ON
$webGL2 = true;
if (isset($data["webgl2"])) {
    $webGL2 = json_decode($data["webgl2"]);
}

//unique identifier to distringuish variables 
$uniqueId = isset($data["uniqueId"]) ? $data["uniqueId"] : "";
$uniqueId .= $index;
//texture naming convention
$texture_name = getTextureId($index);



$setJSProperty = function($variableName, $variableValue) {
    global $dataId;
    return "currentVisualisation().shaders['$dataId'].cache['$variableName'] = $variableValue";
};

$getJSProperty = function($variableName, $defaultValue) {
    global $dataId;
    return <<<EOF
currentVisualisation().shaders['$dataId'].cache.hasOwnProperty('$variableName') ? 
  currentVisualisation().shaders['$dataId'].cache['$variableName'] : $defaultValue
EOF;
};

/**
 * Returns appropriate texture sampling call
 * based on OpenGL version and the data
 * 
 * $sampling_coords {string} vec2 GLSL object - texture coordinates
 * $id {number} data index, default current shader index, can be used to
 *              access data meant for different shaders too 
 */
$texture = function($sampling_coords, $id=-1) {
    global $texture_name, $webGL2, $index;

    if ($id == -1) {
        if ($webGL2) {
            return "texture($texture_name, vec3($sampling_coords, $index))";
        }
        return "texture2D($texture_name, $sampling_coords)";
    } else {
        if ($webGL2) {
            return "texture($texture_name, vec3($sampling_coords, $id))";
        }
        $tex = getTextureId($id);
        return "texture2D($tex, $sampling_coords)";
    }
};

/**
 * Returns appropriate texture name for given OpenGL version.
 */
function getTextureId($index) {
    global $webGL2;
    return $webGL2 ? "vis_data_sampler_array" : "vis_data_sampler_{$index}";
}

/**
 * Parses value to a float string representation with given precision (length after decimal)
 */
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

/**
 * Returns array of color values (integers) parsed
 * from its hexadecimal string representation
 * 
 * $default {array} default value to return if parsing fails
 */
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

/**
 * Returns an object with naming convention for exporting, e.g. prepared to be encoded as
 * JSON and sent to client.
 */
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

/**
 * Send shader data to the client. The shader data should reflect WebGL version used, and
 * do necessary JS coding in case an user interaction is involved (values setting, caching).
 * Most importantly, all variables within the global space (GLSL, JavaScript) should be extended by $uniqueId
 * to avoid namespace collision.
 * 
 * $definition {string} REQUIRED, first fragment shader part, where variables and custom functions are defined
 * $execution {string} REQUIRED, a code placed inside GLSL main() function, should output the color using show(vec4)
 * $htmlPart {HTML string} a html used to control this shader part, e.g. input elements sent to the shader on change
 * $jsPart {string} a javascript code that should update HTML, cache user-defined values and define used variables
 * $glLoaded {string} a javascript code executed when GLSL program is loaded: set here static uniform values and 
 *                    bind Gluint indices to uniform names
 * $glDrawing {string} a javascript code executed when GLSL program is used: set here dynamic uniform values
 */
function send($definition, $execution, $htmlPart = "", $jsPart = "", $glLoaded = "", $glDrawing = "") {
    if (!$definition || !$execution) {
        fail("Invalid shader.", "Missing compulsory parameters.<br>Definition: <code>$definition</code><br>Execution: <code>$execution</code>");
    } else {
        echo json_encode(
            prepare_send($definition, $execution, $htmlPart, $jsPart, $glLoaded, $glDrawing)
        );
    }
}

/**
 * Exit with failure message encoded in JSON
 * @param $title {string} title
 * @param $description {string} detailed problem description
 */
function fail($title, $description) {
    echo json_encode((object)array("error" => $title, "desc" => $description));
    die();
}

?>