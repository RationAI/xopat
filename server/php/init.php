<?php

/**
 * PHP server index entrypoint, parsing input data and compiling index.html page.
 * (server view: CORE is parsed EMV, app view: ENV is the default config)
 */

if (!defined( 'ABSPATH' )) {
    exit;
}

require_once ABSPATH . "server/php/inc/init.php";

if (!count($_POST)) {
    try {
        $_POST = (array)json_decode(file_get_contents("php://input"), false);
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

function safeReadPostValue($val) {
    if (!is_string($val)) return $val;
    try {
        $parsed = json_decode($val);
        if ((bool)$val && $parsed != null) {
            return $parsed;
        }
    } catch (Exception $e) {
        return $val;
    }
}

// in PHP, forms are automatically decoded, so we get nested arrays already, just
// ensure we remove double-encoding
foreach ($_POST as $key=>&$value) {
    if (is_array($value)) {
        foreach ($value as $childKey=>$childValue) {
            $value[$childKey] = safeReadPostValue($childValue);
        }
    } else if (is_object($value)) {
        foreach ($value as $childKey=>$childValue) {
            $value->{$childKey} = safeReadPostValue($childValue);
        }
    } else {
        $_POST[$key] = safeReadPostValue($value);
    }
}

//todo consider parsing at least plugins and loading active items -> the 'compile time element load' - otherwise fetched dynamically
//$bypassCookies = isBoolFlagInObject($parsedParams->params, "bypassCookies");
//
//$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
//

//ensureDefined($_POST, "params", {});
//ensureDefined($_POST, "data", []);
//ensureDefined($_POST, "background", []);
//ensureDefined($_POST, "plugins", {});

$CORE["serverStatus"]["name"] = "php";
$CORE["serverStatus"]["supportsPost"] = true;

$replacer = function($match) use ($i18n, $PLUGINS, $MODULES, $CORE) {
    ob_start();

    switch ($match[1]) {
        case "head":
            require_core("env");
            require_libs();
            require_openseadragon();
            require_external();
            require_ui();
            require_core("loader");
            require_core("deps");
            require_core("app");
            break;

        case "app":
            //Todo think of secure way of sharing POST with the app
?>
    <script type="text/javascript">
        initXopat(
            <?php echo json_encode((object)$PLUGINS) ?>,
            <?php echo json_encode((object)$MODULES) ?>,
            <?php echo json_encode((object)$CORE) ?>,
            <?php echo json_encode($_POST); ?>,
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
            require_modules($CORE["client"]["production"]);
            break;

        case "plugins":
            require_plugins($CORE["client"]["production"]);
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
