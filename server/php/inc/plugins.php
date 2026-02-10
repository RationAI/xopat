<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

if (!PHP_INCLUDES) throw new Exception("Plugins must be loaded with active core!");

require_once PHP_INCLUDES . "modules.php";
use Ahc\Json\Comment;

global $i18n, $PLUGINS, $MODULES;
$PLUGINS = array();

foreach (array_diff(scandir(ABS_PLUGINS), array('..', '.')) as $_=>$dir) {
    $dir_path = ABS_PLUGINS . "$dir/";
    if (is_dir($dir_path)) {
        $interface = $dir_path . "include.json";

        try {
            $data = NULL;
            if (file_exists($interface)) {
                $data = (new Comment)->decode(file_get_contents($interface), true);
            }

            $workspace = $dir_path . "package.json";
            if (file_exists($workspace)) {
                $has_js = file_exists($full_path . 'index.workspace.js');
                $has_mjs = $has_js || file_exists($full_path . 'index.workspace.mjs');
                if (!$has_mjs) {
                    error_log('Module ' . $full_path . ' has package.json but no index.workspace.(m)js! The module needs to be compiled first!');
                }

                $packageData = (new Comment)->decode(file_get_contents($workspace), true);

                if (!isset($data['includes']) || !is_array($data['includes'])) {
                    $data['includes'] = [];
                }
                array_unshift($data['includes'], $has_js ? 'index.workspace.js' : 'index.workspace.mjs');

                $data['includes'] = expand_include_globs($dir_path, $data['includes']);

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
                if (!$data["id"]) {
                    $data["id"] = "__generated_id_$dir";
                    $data["error"] = "Plugin (dir $dir) removed: probably include.json misconfiguration.";
                }

                $data["directory"] = $dir;
                $data["path"] = PLUGINS_FOLDER . "$dir/";
                if (file_exists($dir_path . "style.css")) {
                    $data["styleSheet"] = $data["path"] . "style.css";
                }

                if (!isset($data['modules']) || !is_array($data['modules'])) {
                    $data['modules'] = [];
                }

                foreach ($data["modules"] as $modId) {
                    if (!isset($MODULES[$modId])) {
                        $data["error"] = $i18n->t('php.pluginUnknownDeps');
                    } else if (isset($MODULES[$modId]->error)) {
                        $data["error"] = $i18n->t('php.pluginInvalidDeps', array("error" => $MODULES[$modId]->error));
                    }
                }

                try {
                    global $ENV, $PLUGINS;
                    if (is_array($ENV)) {
                        if (!isset($ENV["plugins"]) || !is_array($ENV["plugins"])) $ENV["plugins"] = [];
                        $ENV_PLUG = $ENV["plugins"];

                        if (isset($ENV_PLUG[$data["id"]])) {
                            $data = array_merge_recursive_distinct($data, $ENV_PLUG[$data["id"]]);
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
                    $PLUGINS[$data["id"]] = $data;
                }
            }
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

foreach ($PLUGINS as $key => &$plugin) {
    $plugin["loaded"] &= !isset($plugin["error"]); // || ($hasParams || in_array($plugin["id"], $pluginsInCookies)
    //make sure all modules required by plugins are also loaded
    if ($plugin["loaded"]) {
        foreach ($plugin["modules"] as $modId) {
            if (isset($MODULES[$modId])) {
                $MODULES[$modId]["loaded"] = true;
            }
        }
    }
}



function require_modules($production) {
    global $MODULES;
    resolveDependencies($MODULES);
    foreach ($MODULES as $_ => $mod) {
        if (isset($mod["loaded"]) && $mod["loaded"]) {
            printDependencies(MODULES_FOLDER, $mod, $production);
        }
    }
}

function require_plugins($production) {
    global $PLUGINS;
    foreach ($PLUGINS as $_ => $plugin) {
        if (isset($plugin["loaded"]) && $plugin["loaded"]) {
            echo "<div id='script-section-{$plugin["id"]}'>";
            printDependencies(PLUGINS_FOLDER, $plugin, $production);
            echo "</div>";
        }
    }
}

?>
