<?php

if (!ABS_ROOT) throw new Exception("Plugins must be loaded with active core!");

require_once PROJECT_ROOT . "modules.php";
use Ahc\Json\Comment;

global $i18n;
$PLUGINS = array();

foreach (array_diff(scandir(ABS_PLUGINS), array('..', '.')) as $_=>$dir) {
    $dir_path = ABS_PLUGINS . "$dir/";
    if (is_dir($dir_path)) {
        $interface = $dir_path . "include.json";
        if (file_exists($interface)) {
            try {
                $data = (new Comment)->decode(file_get_contents($interface), true);

                if (!$data["id"]) {
                    $data["id"] = "__generated_id_$dir";
                    $data["error"] = "Plugin (dir $dir) removed: probably include.json misconfiguration.";
                }

                $data["directory"] = $dir;
                $data["path"] = PLUGINS_FOLDER . "$dir/";
                if (file_exists($dir_path . "style.css")) {
                    $data["styleSheet"] = $data["path"] . "style.css";
                }

                foreach ($data["modules"] as $modId) {
                    if (!isset($MODULES[$modId])) {
                        $data["error"] = $i18n->t('php.pluginUnknownDeps');
                    } else if (isset($MODULES[$modId]->error)) {
                        $data["error"] = $i18n->t('php.pluginInvalidDeps', array("error" => $MODULES[$modId]->error));
                    }
                }
                $PLUGINS[$data["id"]] = $data;
            } catch (Exception $e) {
                $id = $dir;
                $PLUGINS[$id] = array(
                    "id" => $dir,
                    "name" => $dir,
                    "error" => $i18n->t('php.pluginInvalid', array("error" => $e->getMessage())),
                    "author" => "-",
                    "version" => "-",
                    "icon" => "",
                    "includes" => array(),
                    "modules" => array(),
                );
            }
        }
    }
}

try {
    global $ENV;
    if (is_array($ENV)) {
        if (!is_array($ENV["modules"])) $ENV["modules"] = [];
        if (!is_array($ENV["plugins"])) $ENV["plugins"] = [];
        $MODULES = array_merge_recursive_distinct($MODULES, $ENV["modules"]);
        $PLUGINS = array_merge_recursive_distinct($PLUGINS, $ENV["plugins"]);
    } else {
        trigger_error("Env setup shold have been loaded, but the data is missing!", E_USER_WARNING);
    }
} catch (Exception $e) {
    trigger_error($e, E_USER_WARNING);
}

function require_modules() {
    global $MODULES;
    resolveDependencies($MODULES);
    foreach ($MODULES as $_ => $mod) {
        if (isset($mod["loaded"]) && $mod["loaded"]) {
            printDependencies(MODULES_FOLDER, $mod);
        }
    }
}

function require_plugins() {
    global $PLUGINS;
    foreach ($PLUGINS as $_ => $plugin) {
        if (isset($plugin["loaded"]) && $plugin["loaded"]) {
            echo "<div id='script-section-{$plugin["id"]}'>";
            printDependencies(PLUGINS_FOLDER, $plugin);
            echo "</div>";
        }
    }
}

?>
