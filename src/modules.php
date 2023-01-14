<?php

$MODULES = array();

foreach (array_diff(scandir(MODULES_FOLDER), array('..', '.')) as $_=>$dir) {
    $full_path = MODULES_FOLDER . "$dir/";
    $interface = $full_path . "include.json";

    if (file_exists($interface)) {
        $data = json_decode(file_get_contents($interface));
        $data->directory = $dir;
        $data->path = $full_path;
        $data->loaded = false;
        $MODULES[$data->id] = $data;
    }
}

//bit dirty (reused in plugins), but we keep increasing so it works anyway...
$order = 0;
//DFS assigns smaller numbers to children -> loaded earlier
function scanDependencies($itemList, $id, $contextName) {
    global $i18n;
    $item = $itemList[$id];

    global $order;
    $item->priority = -1;

    $valid = true;
    foreach ($item->requires as $dependency) {
        if (!isset($itemList[$dependency])) {
            $item->error = $i18n->t('php.invalidDeps',
                array("context" => $contextName, "dependency" => $id->$dependency));
            return false;
        }

        if (isset($itemList[$dependency]->error)) {
            $item->error = $i18n->t('php.transitiveInvalidDeps',
                array("context" => $contextName, "dependency" => $id->$dependency, "transitive" => $dependency));
            return false;
        }

        if (!isset($itemList[$dependency]->priority)) {
            $valid &= scanDependencies($itemList, $dependency, $contextName);
        } else if ($itemList[$dependency]->priority == -1) {
            //maybe we could unwind recurse and invalidate all...
            $item->error = $i18n->t('php.cyclicDeps',
                array("context" => $contextName, "dependency" => $id->$dependency));
            return false;
        }
    }
    $item->priority = $order++;
    if (!$valid) {
        $item->error = $i18n->t('php.removedInvalidDeps',
            array("dependencies" => implode(", ", $item->requires)));
    }
    return $valid;
}

//make sure all modules required by other modules are loaded, goes in acyclic deps list - everything gets loaded
function resolveDependencies($itemList, $version) {
    for (end($itemList); key($itemList)!==null; prev($itemList)){
        //has to be in reverse order!
        $mod = current($itemList);

        if (file_exists(MODULES_FOLDER . $mod->directory . "/style.css")) {
            $mod->styleSheet = MODULES_FOLDER . $mod->directory . "/style.css?v=$version";
        }

        if ($mod->loaded) {
            foreach ($mod->requires as $__ => $requirement) {
                $itemList[$requirement]->loaded = true;
            }
        }
    }
}

function getAttributes($source, $properties) {
    $html = "";
    foreach ($properties as $property=>$propScriptName) {
        if (isset($source->{$property})) {
            $html .= " $propScriptName=\"{$source->{$property}}\"";
        }
    }
    return $html;
}

/**
 * Print module or plugin dependency based on its parsed configuration
 * @param $directory string parent context directory full path, ending with slash
 * @param $item object item to load
 */
function printDependencies($directory, $item) {
    global $version;
    //add module style sheet if exists
    if (isset($item->styleSheet)) {
        echo "<link rel=\"stylesheet\" href=\"$item->styleSheet\" type='text/css'>\n";
    }
    foreach ($item->includes as $__ => $file) {
        if (is_string($file)) {
            echo "    <script src=\"$directory{$item->directory}/$file?v=$version\"></script>\n";
        } else if (is_object($file)) {
            //todo transalte js to html syntax
            echo "    <script" . getAttributes($file, array(
                    'async' => 'async', 'crossOrigin' => 'crossorigin', 'defer' => 'defer',
                    'integrity' => 'integrity', 'referrerPolicy' => 'referrerpolicy', 'src' => 'src')) . "></script>";
        } else {
            echo "<script>console.warn('Invalid include:', '{$item->id}', '$file');</script>";
        }
    }
}

//resolve dependencies
foreach ($MODULES as $id=>$mod) {
    //scan only if priority not set (not visited yet)
    if (!isset($mod->priority)) {
        scanDependencies($MODULES, $id, 'modules');
    }
}

uasort($MODULES, function($a, $b) {
    //ascending
    return $a->priority - $b->priority;
});

?>
