<?php
define("PLUGIN_FOLDER", "./plugins/");

$PLUGINS = array();

$plugin_list = array_diff(scandir(PLUGIN_FOLDER), array('..', '.'));
foreach ($plugin_list as $_=>$dir) {
    $interface = PLUGIN_FOLDER . $dir . "/include.json";
    if (file_exists($interface)) {
        $data = json_decode(file_get_contents($interface));
        //todo verify values
        if (!is_numeric($data->priority)) $data->priority = 0;
        $data->directory = $dir;
        $PLUGINS[$data->id] = $data;
    }
}

uasort($PLUGINS, function($a, $b) {
    //ascending
    return $a->priority - $b->priority;
});

?>