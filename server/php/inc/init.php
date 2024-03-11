<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

//Absolute Root Path to the php server
define('PHP_INCLUDES', ABSPATH . 'server/php/inc/');
define('VIEWER_SOURCES_ABS_ROOT', ABSPATH . 'src/');
define('ABS_MODULES', ABSPATH . 'modules/');
define('ABS_PLUGINS', ABSPATH . 'plugins/');

//Relative Paths For the Viewer
defined('PROJECT_ROOT') || define('PROJECT_ROOT', "");
define('PROJECT_SOURCES', PROJECT_ROOT . 'src/');
define('EXTERNAL_SOURCES', PROJECT_SOURCES . 'external/');
define('LIBS_ROOT', PROJECT_SOURCES . 'libs/');
define('ASSETS_ROOT', PROJECT_SOURCES . 'assets/');
define('LOCALES_ROOT', PROJECT_SOURCES . 'locales/');
define('MODULES_FOLDER', PROJECT_ROOT . 'modules/');
define('PLUGINS_FOLDER', PROJECT_ROOT . 'plugins/');

if (!defined('DISABLE_PERMA_LOAD')) {
    define('ENABLE_PERMA_LOAD', true);
}

//fallback for php 7.1
if (!function_exists("array_is_list")) {
    function array_is_list(array $array): bool
    {
        $i = -1;
        foreach ($array as $k => $v) {
            ++$i;
            if ($k !== $i) {
                return false;
            }
        }
        return true;
    }
}

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function getAppParam($key, $default=false) {
    return hasKey($_POST, $key) ? $_POST[$key] : (hasKey($_GET, $key) ? $_GET[$key] : $default);
}


function isBoolFlagInObject($object, $key) {
    if (!isset($object->$key)) return false;
    $v = $object->$key;
    return (gettype($v) === "string" && $v !== "" && $v !== "false") || $v;
}

function ensureDefined($object, $property, $default) {
    if (!isset($object->{$property})) {
        $object->{$property} = $default;
        return false;
    }
    return true;
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
    global $i18n;
   try {
       if (!isset($i18n)) {
           require_once ABSPATH . "server/php/inc/i18m.class.php";
           $i18n = i18n_mock::default($_GET["lang"] ?? "en", LOCALES_ROOT);
       }
       throwFatalErrorIf(true, "error.unknown", "",$exception->getMessage() .
           " in " . $exception->getFile() . " line " . $exception->getLine() .
           "<br>" . $exception->getTraceAsString());
   } catch (Throwable $e) {
       print_r($e);
   }
});

function setupI18n($debugMode, $fallbackLocale) {
    global $i18n;
    $locale = $_GET["lang"] ?? ($fallbackLocale ?? "en");
    //now we can translate - translation known
    require_once PHP_INCLUDES . 'i18n.class.php';
    i18n::$debug = $debugMode;
    $i18n = i18n::default($locale, LOCALES_ROOT);
    return $locale;
}