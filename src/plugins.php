<?php

require_once(PROJECT_SOURCES . "modules.php");
global $i18n;
$PLUGINS = array();

foreach (array_diff(scandir(PLUGINS_FOLDER), array('..', '.')) as $_=>$dir) {
    $dir_path = PLUGINS_FOLDER . "$dir/";
    if (is_dir($dir_path)) {
        $interface = $dir_path . "include.json";
        if (file_exists($interface)) {
            try {
                $data = json_decode(file_get_contents($interface));
                $data->directory = $dir;
                $data->path = $dir_path;

                foreach ($data->modules as $modId) {
                    if (!isset($MODULES[$modId])) {
                        $data->error = $i18n.t('php.pluginUnknownDeps');
                    } else if (isset($MODULES[$modId]->error)) {
                        $data->error = $i18n->t('php.pluginInvalidDeps', array("error" => $MODULES[$modId]->error));
                    }
                }
                $PLUGINS[$data->id] = (object)$data;
            } catch (Exception $e) {
                $id = $dir;
                $PLUGINS[$id] = (object)array(
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
?>
