<?php
 //requires input data in the following form (order is the order of rendering, first=bottom, last=top):
 // [
 //   {
 //      "data": --data identifier--
 //      "shader": --name of the shader--
 //      "params": {--shader--param--: --value--, ...}
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
 

 $visualisation=array();

 $i = 0;
 foreach ($input as $key=>$object) {

    //try to get the url of shader part
    $url = "";
    if (!isset($object->type) && isset($object->source)) {
        $i++;
        $args = to_params($object->params);
        $url = "$object->source?index=$i$uniqueId$args";
    } else if (isset($object->type) && isset($shaders[$object->type])) { 
        if (file_exists("{$shaders[$object->type]}.php")) {
            $i++;
            $args = to_params($object->params);
            $dir = dirname($_SERVER['SCRIPT_NAME']);
            $fullurl="http://".$_SERVER['HTTP_HOST'].$dir;
            $url = "$fullurl/{$shaders[$object->type]}.php?index=$i$uniqueId$args";
        } else {
            $visualisation[$object->data] = (object)array("error" => "ERROR: Requested visualisation '$object->type' implementation is missing.", "desc" => "File ./{$shaders[$object->type]}.php does not exist."); 
            continue;
        }    
    } else {
        $visualisation[$object->data] = (object)array("error" => "Requested visualisation '$object->type' does not exist.", "desc" => "Undefined shader: $object->type."); 
        continue;
    } 
    
    //try to load the shader URL
    try {
        $data = json_decode(file_get_contents($url));
        $data->order = $i;
        if (isset($data->error) && $data->error) {
            $visualisation[$object->data] = (object)array("error" => "Failed to obtain '$object->type' visualisation. $data->error", "desc" => $data->desc); 
        } else {
            $visualisation[$object->data] = $data; 
        }
    } catch (\Exception $e) {
        $msg = $e->getMessage();
        $visualisation[$object->data] = (object)array("error" => "Failed to obtain '$object->type' visualisation.", "desc" => "Failure sending GET request for '$object->type' shader. Parameters sent: <br>$object->params<br><br>$msg"); 
    } 
 }

 function to_params($array) {
    if (!is_array($array) || !is_object($array)) {
        return "";
    }

    $out = "";
    foreach ($array as $name=>$value) {
        $encoded = urlencode($value);
        $out .= "&$name=$encoded";
    }
    return $out;
 }

echo json_encode((object)($visualisation));

?>