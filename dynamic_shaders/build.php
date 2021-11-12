<?php
 //requires input data in the following form (order is the order of rendering, first=bottom, last=top):
 // [
 //   {
 //      "data": --data identifier--
 //      "name": --data layer name--
 //      "shader": --name of the shader--
 //      "params": {--shader--param--: --value--, ...}
 //      "webgl2": --optional flag--
 //   },                
 //   ...
 //]
 //outputs
 // {
 //   --data identifier-- : {
 //         ...SHADER DATA...
 //   },
 //   ...
 // }
 //
 //


//default handle for errors
set_exception_handler(function($exception) {
    $msg = $exception->getMessage();
    echo json_encode((object)array("error" => "Unknown error. Please, re-open the application.", "desc" => "<code>$msg</code>"));
});
 
 include_once("defined.php");

 $input = json_decode($_POST["shaders"]); //the data
 if (!$input) {
    //todo error
    $post = print_r($_POST, true);
    echo json_encode((object)array("error" => "Unable to start the visualizer. Please, re-open the application.", 
        "desc" => "Invalid input for shader builder: exitting.<br><code>POST data: $post</code>"));
    die();
 }

 $uniqueId = "";
 try {
   $params = json_decode($_POST["params"]); //the params
   $uniqueId = "&uniqueId=$params->unique_id";
 } catch (\Exception $e) {
   //do nothing, use default values as set above
 }

 if (!isset($_POST["webgl2"])) {
    //default ON
    $_POST["webgl2"] = "true";
 }
 
 $visualisation=array();

 $i = 0;
 foreach ($input as $key=>$object) {

    //try to get the url of shader part
    $url = "";
    if (!isset($object->type) && isset($object->source)) {
        //shader type not set and custom source defined
        $args = to_params($object->params);
        $url = "$object->source?index=$i&webgl2={$_POST["webgl2"]}$uniqueId$args";
        $i++;
    } else if (isset($object->type) && isset($shaders[$object->type])) {
        //shader type set and existing 
        if (file_exists("{$shaders[$object->type]}.php")) {
            $args = to_params($object->params);
            $dir = dirname($_SERVER['SCRIPT_NAME']);
            $fullurl="http://".$_SERVER['HTTP_HOST'].$dir;
            $url = "$fullurl/{$shaders[$object->type]}.php?index=$i&webgl2={$_POST["webgl2"]}$uniqueId$args";
            $i++;
        } else {
            $visualisation[$object->data] = (object)array("error" => "ERROR: Requested visualisation '$object->type' implementation is missing.", "desc" => "File ./{$shaders[$object->type]}.php does not exist."); 
            continue;
        } 
    } else if ($object->type == "none") {
        //shader typs is 'none'
        $args = to_params($object->params);
        $visualisation[$object->data] = (object)array("type" => "none", "visible" => false, "url" => "$object->source?index=$i&webgl2={$_POST["webgl2"]}$uniqueId$args"); 
        $i++;
        continue;   
    } else {
        //invalid shader type
        $visualisation[$object->data] = (object)array("error" => "Requested visualisation '$object->type' does not exist.", "desc" => "Undefined shader: $object->type."); 
        continue;
    } 
    
    //try to GET the shader from URL
    try {
        $data = json_decode(file_get_contents($url));
        $data->order = $i;
        $data->visible = $object->visible;
        $data->url = $url;
        $data->type = $object->type;
        if (isset($data->error) && $data->error) {
            $visualisation[$object->data] = (object)array("error" => "Failed to obtain '$object->type' visualisation. $data->error", "desc" => $data->desc); 
        } else if (strlen($data->execution) < 5 || strlen($data->definition) < 5) {
            $data->error = "The requested visualisation type '$object->type' does not work properly.";
            $data->desc = "One of the compulsory parts is empty or missing: definition/execution/sampler2D member variables. Status from $url request: " . $http_response_header[0];
            $visualisation[$object->data] = $data;
        } else {
            $visualisation[$object->data] = $data; 
        }
    } catch (\Exception $e) {
        $msg = $e->getMessage();
        $visualisation[$object->data] = (object)array("error" => "Failed to obtain '$object->type' visualisation.", "desc" => "Failure sending GET request for '$object->type' shader. Parameters sent: <br>$object->params<br><br>$msg"); 
    } 
 }

 /**
  * Convert array of key=>value pairs into URL GET parameter list
  * 
  * $array {array} parameters names mapped to data
  */
 function to_params($array) {
    // if (!is_array($array) || !is_object($array)) {
    //     return "";
    // }

    $out = "";
    foreach ($array as $name=>$value) {
        $encoded = urlencode($value);
        $out .= "&$name=$encoded";
    }
    return $out;
 }

 //send data
echo json_encode((object)($visualisation));

?>