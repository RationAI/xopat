<?php

/**
 * PHP server index entrypoint, parsing queries and compiling index.html page.
 *
 * TODO: unify naming, now CORE gets sent to app.js where it is called ENV
 * (server view: CORE is parsed EMV, app view: ENV is the default config)
 */


if (!defined( 'ABSPATH' )) {
    exit;
}
define('HTML_TEMPLATE_REGEX', "/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/");

function throwFatalErrorIfFallback($condition, $title, $description, $details) {

    if (!file_exists(ABSPATH . "error.html")) {
        //try to reach the file externally
        header("Location error.html");
        exit;
    }
    //try to add additional info to the file

    echo preg_replace_callback(HTML_TEMPLATE_REGEX, function ($match) use ($title, $description, $details) {
        switch ($match[1]) {
            case "error":
                return <<<EOF
<div class="collapsible" onclick="toggleContent()">Detailed Information</div>
<div class="content">
  <p>$description</p>
  <code>$details</code>
</div>
EOF;
            default:
                break;
        }
        return "";
    }, file_get_contents(ABSPATH . "error.html"));
    exit;
}

set_exception_handler(function (Throwable $exception) {
    throwFatalErrorIfFallback(true, "Unknown Error", "",$exception->getMessage() .
        " in " . $exception->getFile() . " line " . $exception->getLine() .
        "<br>" . $exception->getTraceAsString());
});

function getAppParam($key, $default=false) {
    return hasKey($_POST, $key) ? $_POST[$key] : (hasKey($_GET, $key) ? $_GET[$key] : $default);
}

/**
 * Parse queries and decide on what to do
 */
$visualization = getAppParam("visualization");
//old key (deprecated)
if (!$visualization) {
    //Old name
    $visualization = getAppParam("visualisation");
}

/**
 * Try to parse GET: slide & masks params
 */
if (!$visualization) {
    if (hasKey($_GET, 'slide')) {
        //try building the object from scratch

        $slide = $_GET["slide"];
        $visualization = json_decode(<<<EOF
{
    "data": ["$slide"],
    "background": [{
        "dataReference": 0,
        "lossless": false
    }]
}
EOF);
        if (hasKey($_GET, 'masks')) {
            $masks = explode(',', $_GET["masks"]);
            $visualization->{"visualizations"} = [
                (object) array('name' => 'Masks', 'lossless' => true, 'shaders' => (object) array())
            ];

            $index = 1; $vis_config = $visualization->visualizations[0]->shaders;
            foreach ($masks as $mask) {
                $visualization->data[] = $mask;

                $vis_config->{$mask} = (object) array(
                    'type' => 'heatmap',
                    'fixed' => false,
                    'visible' => 1,
                    'dataReferences' => [$index++],
                    'params' => (object) array()
                );
            }
        }

    }
    if (!$_POST) {
        $_POST = json_decode(file_get_contents('php://input'));
    }
}

/**
 * Try to parse input manually
 */
if (!$visualization) {
    //for json-based POST requests
    $data = file_get_contents('php://input');
    if ($data) {
        $_POST = json_decode($data);
        $visualization = $_POST["visualization"];
        if (!$visualization) {
            //Old name
            $visualization = $_POST["visualisation"];
        }
    }
}
// Fallback - no configuration provided
if (!$visualization) {
    $visualization = [];
}

global $i18n;

set_exception_handler(function (Throwable $exception) {
    global $i18n;
    if (!isset($i18n)) {
        require_once __DIR__ . '/inc/i18m.class.php';
        $i18n = i18n_mock::default($_GET["lang"] ?? "en", LOCALES_ROOT);
    }
    throwFatalErrorIf(true, "error.unknown", "",$exception->getMessage() .
        " in " . $exception->getFile() . " line " . $exception->getLine() .
        "<br>" . $exception->getTraceAsString());
});

global $PLUGINS, $MODULES, $CORE;
require_once __DIR__ . "/inc/core.php";

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function isBoolFlagInObject($object, $key) {
    if (!isset($object->$key)) return false;
    $v = $object->$key;
    return (gettype($v) === "string" && $v !== "" && $v !== "false") || $v;
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        try {
            require_once(PHP_INCLUDES . "error.php");
            show_error($title, $description, $details, $_GET["lang"] ?? 'en');
            exit;
        } catch (Throwable $e) {
            throwFatalErrorIfFallback(true, $title, $description, $details);
        }
    }
}

function ensureDefined($object, $property, $default) {
    if (!isset($object->{$property})) {
        $object->{$property} = $default;
        return false;
    }
    return true;
}


/**
 * Parsing: verify valid parameters
 */

//params that come in might be associative arrays :/
$parsedParams = $visualization;
if (is_string($visualization)) $parsedParams = json_decode($parsedParams, false);
else if (is_array($visualization)) $parsedParams = (object)$parsedParams;
throwFatalErrorIf(!is_object($parsedParams), "messages.urlInvalid", "messages.postDataSyntaxErr",
    "JSON Error: " . json_last_error_msg() . "<br>" . print_r($visualization, true));

ensureDefined($parsedParams, "params", (object)array());
ensureDefined($parsedParams, "data", array());
$defined_rendering = ensureDefined($parsedParams, "background", array());
ensureDefined($parsedParams, "plugins", (object)array());

$is_debug = isBoolFlagInObject($parsedParams->params, "debugMode");
if ($is_debug) {
    error_reporting(E_ERROR);
    ini_set('display_errors', 1);
}
$bypassCookies = isBoolFlagInObject($parsedParams->params, "bypassCookies");
$locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");

//now we can translate - translation known
require_once PHP_INCLUDES . 'i18n.class.php';
i18n::$debug = $is_debug;
$i18n = i18n::default($locale, LOCALES_ROOT);

//load plugins
require_once PHP_INCLUDES . "plugins.php";

foreach ($parsedParams->background as $bg) {
    $bg = (object)$bg;
    throwFatalErrorIf(!isset($bg->dataReference), "messages.urlInvalid", "messages.bgReferenceMissing",
        print_r($parsedParams->background, true));

    throwFatalErrorIf(!is_numeric($bg->dataReference) || $bg->dataReference >= count($parsedParams->data),
        "messages.urlInvalid", "messages.bgReferenceMissing",
        "Invalid data reference value '$bg->dataReference'. Available data: " . print_r($parsedParams->data, true));
}

$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = count($_COOKIE) < 1 && !$bypassCookies;

if (isset($parsedParams->visualizations)) {
    //requires webgl module
    $defined_rendering = true;
    $MODULES["webgl"]["loaded"] = true;
}
//todo if secure mode remove all sensitive data from config and set it up in cache
/**
 * Detect required presence of plugins
 */
$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
if (is_array($parsedParams->plugins)) {
    $parsedParams->plugins = (object)$parsedParams->plugins;
}

foreach ($PLUGINS as $key => &$plugin) {
    $hasParams = isset($parsedParams->plugins->{$plugin["id"]});
    $plugin["loaded"] = $plugin["loaded"] || !isset($plugin["error"]) && ($hasParams || in_array($plugin["id"], $pluginsInCookies));

    //make sure all modules required by plugins are also loaded
    if ($plugin["loaded"]) {
        if (!$hasParams) {
            $parsedParams->plugins->{$plugin["id"]} = (object)array();
        }
        foreach ($plugin["modules"] as $modId) {
            $MODULES[$modId]["loaded"] = true;
        }
    }
}

$visualization = json_encode($parsedParams);

$replacer = function($match) use ($visualization, $i18n) {
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
            global $PLUGINS, $MODULES, $CORE;
?>
    <script type="text/javascript">
        initXopat(
            <?php echo json_encode((object)$PLUGINS) ?>,
            <?php echo json_encode((object)$MODULES) ?>,
            <?php echo json_encode((object)$CORE) ?>,
            <?php unset($_POST["visualisation"]); echo json_encode($_POST); ?>,
            <?php echo $visualization ?>,
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
