<?php
global $MODULES;
$MODULES = array();

include_once PROJECT_ROOT . "comments.class.php";
use Ahc\Json\Comment;

foreach (array_diff(scandir(ABS_MODULES), array('..', '.')) as $_=>$dir) {
    $full_path = ABS_MODULES . "$dir/";
    $interface = $full_path . "include.json";

    if (file_exists($interface)) {
        try {
            $data = (new Comment)->decode(file_get_contents($interface), true);
            $data["directory"] = $dir;
            $data["path"] = MODULES_FOLDER . "$dir/";
            $data["loaded"] = false;
            if (file_exists($full_path . "style.css")) {
                $data["styleSheet"] = $data["path"] . "style.css";
            }


            try {
                global $ENV, $MODULES;
                if (is_array($ENV)) {
                    if (!isset($ENV["modules"]) || !is_array($ENV["modules"])) $ENV["modules"] = [];
                    $ENV_MOD = $ENV["modules"];

                    if (isset($ENV_MOD[$data["id"]])) {
                        $data = array_merge_recursive_distinct($data, $ENV_MOD[$data["id"]]);
                    }
                } else {
                    trigger_error("Env setup for module failed: invalid \$ENV! Was CORE included?", E_USER_WARNING);
                }
            } catch (Exception $e) {
                trigger_error($e, E_USER_WARNING);
            }

            if (!isset($data["enabled"]) || $data["enabled"] != false) {
                $MODULES[$data["id"]] = $data;
            }

        } catch (Exception $e) {
            trigger_error("Module $full_path has invalid configuration file and cannot be loaded!", E_USER_WARNING);
        }
    }
}

$order = 0;
//DFS assigns smaller numbers to children -> loaded earlier
function scanDependencies(&$itemList, $id, $contextName) {
    global $i18n;
    $item = &$itemList[$id];
    global $order;

    $item["priority"] = -1;

    $valid = true;
    foreach ($item["requires"] as $dependency) {
        $dep = $itemList[$dependency];
        if (!isset($dep)) {
            $item["error"] = $i18n->t('php.invalidDeps',
                array("context" => $contextName, "dependency" => $dependency));
            return false;
        }

        if (isset($dep["error"])) {
            $item["error"] = $i18n->t('php.transitiveInvalidDeps',
                array("context" => $contextName, "dependency" => $dependency, "transitive" => $dependency));
            return false;
        }

        if (!isset($dep["priority"])) {
            $valid &= scanDependencies($itemList, $dependency, $contextName);
        } else if ($dep["priority"] == -1) {
            $item["error"] = $i18n->t('php.cyclicDeps',
                array("context" => $contextName, "dependency" => $dependency));
            return false;
        }
    }
    $item["priority"] = $order++;
    if (!$valid) {
        $item["error"] = $i18n->t('php.removedInvalidDeps',
            array("dependencies" => implode(", ", $item["requires"])));
    }
    return $valid;
}

//make sure all modules required by other modules are loaded, goes in acyclic deps list - everything gets loaded
function resolveDependencies(&$itemList) {
    for (end($itemList); key($itemList)!==null; prev($itemList)){
        //has to be in reverse order!
        $mod = current($itemList);
        if ($mod["loaded"]) {
            foreach ($mod["requires"] as $__ => $requirement) {
                $itemList[$requirement]["loaded"] = true;
            }
        }
    }
}

function getAttributes($source, $properties) {
    $html = "";
    foreach ($properties as $property=>$propScriptName) {
        if (isset($source[$property])) {
            $html .= " $propScriptName=\"{$source[$property]}\"";
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
    $version = VERSION;
    //add module style sheet if exists
    if (isset($item["styleSheet"])) {
        echo "<link rel=\"stylesheet\" href=\"{$item["styleSheet"]}?v=$version\" type='text/css'>\n";
    }

    if (file_exists("$directory{$item["directory"]}/index.min.js")) {
        echo "    <script src=\"$directory{$item["directory"]}/index.min.js?v=$version\"></script>\n";
        return;
    }

    foreach ($item["includes"] as $__ => $file) {
        if (is_string($file)) {
            echo "    <script src=\"$directory{$item["directory"]}/$file?v=$version\"></script>\n";
        } else if (is_object($file)) {
            echo "    <script" . getAttributes($file, array(
                    'async' => 'async', 'crossOrigin' => 'crossorigin', 'defer' => 'defer',
                    'integrity' => 'integrity', 'referrerPolicy' => 'referrerpolicy', 'src' => 'src')) . "></script>";
        } else {
            echo "<script>console.warn('Invalid include:', '{$item["id"]}', '$file');</script>";
        }
    }
}

//resolve dependencies
foreach ($MODULES as $id=>$mod) {
    //scan only if priority not set (not visited yet)

    if (!isset($mod["priority"])) {
        scanDependencies($MODULES, $id, 'modules');
    }
}

uasort($MODULES, function($a, $b) {
    //ascending
    return $a["priority"] - $b["priority"];
});

?>
