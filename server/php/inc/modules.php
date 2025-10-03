<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

global $MODULES;
$MODULES = array();

include_once PHP_INCLUDES . "comments.class.php";
use Ahc\Json\Comment;

foreach (array_diff(scandir(ABS_MODULES), array('..', '.')) as $_=>$dir) {
    $full_path = ABS_MODULES . "$dir/";
    $interface = $full_path . "include.json";

    try {
        // Base data from include.json (if present)
        $data = NULL;
        if (file_exists($interface)) {
            $data = (new Comment)->decode(file_get_contents($interface), true);
        }

        $workspace = $full_path . 'package.json';
        if (file_exists($workspace)) {
            if (!file_exists($full_path . 'index.workspace.js')) {
                error_log('Module ' . $full_path . ' has package.json but no index.workspace.js! The module needs to be compiled first!');
            }

            $packageData = (new Comment)->decode(file_get_contents($workspace), true);

            if (!isset($data['includes']) || !is_array($data['includes'])) {
                $data['includes'] = [];
            }
            array_unshift($data['includes'], 'index.workspace.js');

            // Fill missing fields from package.json
            if (!isset($data['id']) || $data['id'] === '' ) {
                if (isset($packageData['name'])) $data['id'] = $packageData['name'];
            }
            if (!isset($data['name']) || $data['name'] === '' ) {
                if (isset($packageData['name'])) $data['name'] = $packageData['name'];
            }
            if (!isset($data['author']) || $data['author'] === '' ) {
                if (isset($packageData['author'])) $data['author'] = $packageData['author'];
            }
            if (!isset($data['version']) || $data['version'] === '' ) {
                if (isset($packageData['version'])) $data['version'] = $packageData['version'];
            }
            if (!isset($data['description']) || $data['description'] === '' ) {
                if (isset($packageData['description'])) $data['description'] = $packageData['description'];
            }
        }

        if (!empty($data) && is_array($data)) {
            $data["directory"] = $dir;
            $data["path"] = MODULES_FOLDER . "$dir/";
            $data["loaded"] = false;
            if (file_exists($full_path . "style.css")) {
                $data["styleSheet"] = $data["path"] . "style.css";
            }

            if (!isset($data['requires']) || !is_array($data['requires'])) {
                $data['requires'] = [];
            }

            try {
                global $ENV, $MODULES;
                if (is_array($ENV)) {
                    if (!isset($ENV["modules"]) || !is_array($ENV["modules"])) $ENV["modules"] = [];
                    $ENV_MOD = $ENV["modules"];

                    if (isset($ENV_MOD[$data["id"]])) {
                        $data = array_merge_recursive_distinct($data, $ENV_MOD[$data["id"]]);
                    }

                    if (ENABLE_PERMA_LOAD && isset($data["permaLoad"]) && $data["permaLoad"]) {
                        $data["loaded"] = true;
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
        }
    } catch (Exception $e) {
            // todo only log error, do not shut down everything
        trigger_error("Module $full_path has invalid configuration file and cannot be loaded!", E_USER_WARNING);
    }
}

$order = 0;
//DFS assigns smaller numbers to children -> loaded earlier
function scanDependencies(&$itemList, $id, $contextName) {
    global $i18n;
    $item = &$itemList[$id];
    global $order;

    if (isset($item["_xoi"])) return $item["_xoi"] > 0;
    $item["_xoi"] = -1;

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

        if (!isset($dep["_xoi"])) {
            $valid &= scanDependencies($itemList, $dependency, $contextName);
        } else if ($dep["_xoi"] == -1) {
            $item["error"] = $i18n->t('php.cyclicDeps',
                array("context" => $contextName, "dependency" => $dependency));
            return false;
        }
    }
    $item["_xoi"] = $order++;
    if (!$valid) {
        $item["error"] = $i18n->t('php.removedInvalidDeps',
            array("dependencies" => implode(", ", $item["requires"])));
    }
    return $valid;
}

//make sure all modules required by other modules are loaded, goes in acyclic deps list - everything gets loaded
function resolveDependencies(&$itemList) {
    foreach ($itemList as $_ => $mod){
        if ($mod["loaded"]) {
            foreach ($mod["requires"] as $__ => $requirement) {
                $itemList[$requirement]["loaded"] = true;
            }
        }
    }
}

function getAttributes($source, $properties) {
    $html = "";
    foreach ($properties as $property => $propScriptName) {
        if (isset($source[$property])) {
            $val = $source[$property];
            // Add type='module' automatically if src ends with .mjs and no explicit type is set
            if ($property === 'src' && str_ends_with($val, '.mjs') && empty($source['type'])) {
                $html .= " type=\"module\"";
            }
            $html .= " $propScriptName=\"" . htmlspecialchars($val, ENT_QUOTES) . "\"";
        }
    }
    return $html;
}

/**
 * Print module or plugin dependency based on its parsed configuration
 * @param $directory string parent context directory full path, ending with slash
 * @param $item object item to load
 * @param $production boolean whether to prefer minified files
 */
function printDependencies($directory, $item, $production) {
    $version = VERSION;
    //add module style sheet if exists
    if (isset($item["styleSheet"])) {
        echo "<link rel=\"stylesheet\" href=\"{$item["styleSheet"]}?v=$version\" type='text/css'>\n";
    }

    if ($production && file_exists("$directory{$item["directory"]}/index.min.js")) {
        echo "    <script src=\"$directory{$item["directory"]}/index.min.js?v=$version\"></script>\n";
        return;
    }

    foreach ($item["includes"] as $__ => $file) {
        if (is_string($file)) {
            $path = "$directory{$item["directory"]}/$file?v=$version";
            if (str_ends_with($file, '.mjs')) {
                echo "    <script src=\"$path\" type=\"module\"></script>\n";
            } else {
                echo "    <script src=\"$path\"></script>\n";
            }
        } else if (is_array($file)) {
            if (isset($file['src']) && !preg_match('#^https?://#', $file['src'])) {
                $src = ltrim($file['src'], './');
                $file['src'] = "$directory{$item["directory"]}/$src?v=$version";
                if (str_ends_with($src, '.mjs') && empty($file['type'])) {
                    $file['type'] = 'module';
                }
            }
            echo "    <script" . getAttributes($file, array(
                    'async' => 'async', 'crossOrigin' => 'crossorigin', 'defer' => 'defer', 'type' => 'type',
                    'integrity' => 'integrity', 'referrerPolicy' => 'referrerpolicy', 'src' => 'src')) . "></script>";
        } else {
            $details = json_encode($file);
            echo "<script type='text/javascript'>console.warn('Invalid include', '{$item["id"]}', {$details});</script>";
        }
    }
}

//resolve dependencies
foreach ($MODULES as $id=>$mod) {
    //scan only if priority not set (not visited yet)

    if (!isset($mod["_xoi"])) {
        scanDependencies($MODULES, $id, 'modules');
    }
}

uasort($MODULES, function($a, $b) {
    //ascending
    return $a["_priority"] - $b["_priority"];
});

?>
