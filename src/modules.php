<?php

//todo translate
$MODULES = array();

foreach (array_diff(scandir(MODULES_FOLDER), array('..', '.')) as $_=>$dir) {
    $interface = MODULES_FOLDER . "/" . $dir . "/include.json";
    if (file_exists($interface)) {
        $data = json_decode(file_get_contents($interface));
        $data->directory = $dir;
        $data->loaded = false;
        $MODULES[$data->id] = $data;
    }
}

//bit dirty (reused in plugins), but we keep increasing so it works anyway...
$order = 0;
//DFS assigns smaller numbers to children -> loaded earlier
function scanDependencies($itemList, $id, $contextName) {
    $item = $itemList[$id];

    global $order;
    $item->priority = -1;

    $valid = true;
    foreach ($item->requires as $dependency) {
        if (!isset($itemList[$dependency])) {
            $item->error = "Invalid dependency in $contextName: $id->$dependency";
            return false;
        }

        if (isset($itemList[$dependency]->error)) {
            $item->error = "Dependency in $contextName: $id->$dependency but $dependency has an error.";
            return false;
        }

        if (!isset($itemList[$dependency]->priority)) {
            $valid &= scanDependencies($itemList, $dependency, $contextName);
        } else if ($itemList[$dependency]->priority == -1) {
            //maybe we could unwind recurse and invalidate all...
            $item->error = "Found cyclic dependency in $contextName: $id->$dependency";
            return false;
        }
    }
    $item->priority = $order++;
    if (!$valid) {
        $item->error = "Removed due to invalid dependency $id->$dependency";
    }
    return $valid;
}

//resolve dependencies
foreach ($MODULES as $id=>$mod) {
    if (!isset($mod->priority)) {
        scanDependencies($MODULES, $id, 'modules');
    }
}

uasort($MODULES, function($a, $b) {
    //ascending
    return $a->priority - $b->priority;
});

?>
