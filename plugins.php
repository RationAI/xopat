<?php

require_once("modules.php");
$PLUGINS = array();

foreach (array_diff(scandir(PLUGINS), array('..', '.')) as $_=>$dir) {
    $interface = PLUGINS . "/" . $dir . "/include.json";
    if (file_exists($interface)) {
        $data = json_decode(file_get_contents($interface));
        $data->directory = $dir;

        foreach ($data->modules as $modId) {
            if (!isset($MODULES[$modId])) {
                $data->error = "The plugin requires unknown module.";
            }
        }
        $PLUGINS[$data->id] = $data;
    }
}

//resolve dependencies
foreach ($PLUGINS as $id=>$plugin) {
    if (!isset($plugin->priority)) {
        scanDependencies($PLUGINS, $id, 'plugins');
    }
}

uasort($PLUGINS, function($a, $b) {
    //ascending
    return $a->priority - $b->priority;
});

?>