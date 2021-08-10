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
   $uniqueId = "&unique_id=$params->unique_id";
 } catch (\Exception $e) {
   //do nothing, use default values as set above
 }
 

 $visualisation=array();

 $i = 0;
 foreach ($input as $key=>$object) {
    if (isset($shaders[$object->type])) { 

        if (file_exists("{$shaders[$object->type]}.php")) {
            $i++;
            try {
                $args = to_params($object->params);
                $dir = dirname($_SERVER['SCRIPT_NAME']);
                $fullurl="http://".$_SERVER['HTTP_HOST'].$dir;
                $data = json_decode(file_get_contents("$fullurl/{$shaders[$object->type]}.php?index=$i$uniqueId$args"));
                $data->order = $i;
                                
                $visualisation[$object->data] = $data; 
            } catch (\Exception $e) {
                $msg = $e->getMessage();
                $visualisation[$object->data] = (object)array("error" => "Failed to obtain '$object->type' visualisation.", "desc" => "Failure sending GET request for '$object->type' shader. Parameters sent: <br>$object->params<br><br>$msg"); 
            } 
        } else {
            $visualisation[$object->data] = (object)array("error" => "ERROR: Requested visualisation '$object->type' implementation is missing.", "desc" => "File ./{$shaders[$object->type]}.php does not exist."); 
        }    
    } else {
        $visualisation[$object->data] = (object)array("error" => "Requested visualisation '$object->type' does not exist.", "desc" => "Undefined shader: $object->type."); 
    }       
 }

 function to_params($array) {
    $out = "";
    foreach ($array as $name=>$value) {
        $encoded = urlencode($value);
        $out .= "&$name=$encoded";
    }
    return $out;
 }

echo json_encode((object)($visualisation));

?>