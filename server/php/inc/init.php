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
define('UI_SOURCES', PROJECT_ROOT . 'ui/');
define('LIBS_ROOT', PROJECT_SOURCES . 'libs/');
define('ASSETS_ROOT', PROJECT_SOURCES . 'assets/');
define('LOCALES_ROOT', PROJECT_SOURCES . 'locales/');
define('MODULES_FOLDER', PROJECT_ROOT . 'modules/');
define('PLUGINS_FOLDER', PROJECT_ROOT . 'plugins/');

if (!defined('DISABLE_PERMA_LOAD')) {
    define('ENABLE_PERMA_LOAD', true);
}

define('HTML_TEMPLATE_REGEX', "/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/");

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
    $prop_type = gettype($object->{$property});
    $def_type = gettype($default);
    if ($def_type !== $prop_type) {
        if ($def_type === "object") {
            $object->{$property} = ((object)$object->{$property});
        } else if ($def_type === "array") {
            $object->{$property} = ((array)$object->{$property});
        } // todo else: incompatible type :/
    }
    return true;
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        require_once(PHP_INCLUDES . "error.php");
        try {
            show_error($title, $description, $details, $_GET["lang"] ?? 'en');
            exit;
        } catch (Throwable $e) {
            throwFatalErrorIfFallback(true, $title, $description, $details);
        }
    }
    return $condition;
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

if (! function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool
    {
        $needle_len = strlen($needle);
        return ($needle_len === 0 || 0 === substr_compare($haystack, $needle, - $needle_len));
    }
}
if (! function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle) {
        return (string)$needle !== '' && strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
