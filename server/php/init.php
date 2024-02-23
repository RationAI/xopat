<?php

/**
 * PHP server index entrypoint, parsing input data and compiling index.html page.
 * (server view: CORE is parsed EMV, app view: ENV is the default config)
 */

if (!defined( 'ABSPATH' )) {
    exit;
}

require_once ABSPATH . "server/php/inc/init.php";

define('HTML_TEMPLATE_REGEX', "/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/");

if (!count($_POST)) {
    try {
        $_POST = (array)json_decode(file_get_contents("php://input"), true);
    } catch (Exception $e) {
        //pass not a valid input
        $_POST = (object)[];
    }
}

if (!isset($_POST)) {
    $_POST = (object)[];
}

global $PLUGINS, $MODULES, $CORE;
require_once PHP_INCLUDES . "core.php";

// todo try parsing params somehow and configuring from them
$locale = setupI18n(false, "en");
global $i18n;

//load plugins
require_once PHP_INCLUDES . "plugins.php";

//todo consider parsing at least plugins and loading active items -> the 'compile time element load' - otherwise fetched dynamically
//$bypassCookies = isBoolFlagInObject($parsedParams->params, "bypassCookies");
//
//$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
//
foreach ($PLUGINS as $key => &$plugin) {
//    $hasParams = isset($parsedParams->plugins->{$plugin["id"]});
    $plugin["loaded"] &= !isset($plugin["error"]); // || ($hasParams || in_array($plugin["id"], $pluginsInCookies)
    //make sure all modules required by plugins are also loaded
    if ($plugin["loaded"]) {
//        if (!$hasParams) {
//            $parsedParams->plugins->{$plugin["id"]} = (object)array();
//        }
        foreach ($plugin["modules"] as $modId) {
            if (isset($MODULES[$modId])) {
                $MODULES[$modId]["loaded"] = true;
            }
        }
    }
}

$replacer = function($match) use ($i18n) {
    ob_start();

    switch ($match[1]) {
        case "head":
            require_core("env");
            require_libs();
            require_openseadragon();
            require_external();
            require_core("loader");
            require_core("deps");
            require_core("app");
            break;

        case "app":
            //Todo think of secure way of sharing POST with the app
            global $PLUGINS, $MODULES, $CORE;
?>
    <script type="text/javascript">
        initXopat(
            <?php echo json_encode((object)$PLUGINS) ?>,
            <?php echo json_encode((object)$MODULES) ?>,
            <?php echo json_encode((object)$CORE) ?>,
            <?php echo json_encode($_POST); ?>,
            xOpatParseConfiguration,
            '<?php echo PLUGINS_FOLDER ?>',
            '<?php echo MODULES_FOLDER ?>',
            '<?php echo VERSION ?>',
            //i18next init config
            {
                resources: {
                    '<?php echo $i18n->getAppliedLang() ?>' : <?php echo $i18n->getRawData() ?>
                },
                lng: '<?php echo $i18n->getAppliedLang() ?>',
            }
        );
    </script><?php break;

        case "modules":
            require_modules();
            break;

        case "plugins":
            require_plugins();
            break;

        default:
            //todo some warn?
            break;
    }
    return ob_get_clean();
};

$template_file = ABSPATH . "server/templates/index.html";
if (!file_exists($template_file)) {
    throwFatalErrorIf(true, "error.unknown", "error.noDetails",
        "File not found: " . ABSPATH . "server/templates/index.html");
}
echo preg_replace_callback(HTML_TEMPLATE_REGEX, $replacer, file_get_contents($template_file));
