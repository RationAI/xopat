<?php
if (!defined( 'ABSPATH' )) {
    exit;
}
/**
 * Using the APP files require "core.php" for constants and core files definition.
 * Inclusion of "plugins.php" loads modules and plugins metadata into the system as well.
 */

use Ahc\Json\Comment;

/**
 * array_merge_recursive merge second argument to the first, only
 *   allows overriding existing values
 * @param array $array1
 * @param array $array2
 * @return array
 * @author Daniel <daniel (at) danielsmedegaardbuus (dot) dk>
 * @author Gabriel Sobrinho <gabriel (dot) sobrinho (at) gmail (dot) com>
 */
function array_merge_recursive_distinct(array &$array1, array &$array2)
{
    $merged = $array1;

    foreach ($array2 as $key => &$value) {
        if (is_array($value) && isset($merged[$key]) && is_array($merged[$key])) {
            if (array_is_list($merged[$key])) {
                $merged[$key] = $value;
            } else {
                $merged[$key] = array_merge_recursive_distinct($merged[$key], $value);
            }
        } else {
            $merged[$key] = $value;
        }
    }

    return $merged;
}

/*
 * Parse CORE Env
 */

require_once PHP_INCLUDES . "comments.class.php";
$CORE = (new Comment)->decode(file_get_contents(VIEWER_SOURCES_ABS_ROOT . "config.json"), true);

function parse_env_config($data, $err) {
    try {
        $read_env = function($match) {
            $env = getenv($match[1]);
            //not specified returns false
            return $env === false ? "" : $env;
        };
        $result = preg_replace_callback("/<%\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*%>/", $read_env, $data);
        return (new Comment)->decode($result, true);
    } catch (Exception $e) {
        throw new Exception($err);
    }
}

global $ENV;

$parse_exception = null;
try {
    $ENV = [];
    $env = getenv('XOPAT_ENV');
    if (is_readable($env)) {
        $ENV = parse_env_config(file_get_contents($env),
            "File $env is not a valid ENV configuration!");
    } else if (is_string($env)) {
        $ENV = parse_env_config($env,
            "Variable XOPAT_ENV is not a readable file or a valid ENV configuration!");
    } else if (file_exists(ABSPATH . "env/env.json")) {
        $ENV = parse_env_config(file_get_contents(ABSPATH . "env/env.json"),
            "Configuration 'env/env.json' contains a syntactic error!");
    }

    if (!is_array($ENV["core"])) $ENV["core"] = [];
    $CORE = array_merge_recursive_distinct($CORE, $ENV["core"]);

} catch (Exception $e) {
    $parse_exception = $e;
    //core uses default values
}

$C = [];
$client = $CORE["active_client"];
if (!$client || !isset($CORE["client"][$client])) {
    foreach ($CORE["client"] as &$c) {
        $C = $c; break;
    }
} else {
    $C = &$CORE["client"][$client];
}
$CORE["client"] = $C;

define('VERSION', $CORE["version"]);
define('GATEWAY', $CORE["gateway"]);

/*
 * Auto detect path and domain if null
 */

if ($C["path"] == null) {
    $CORE["client"]["path"] = PROJECT_ROOT;
}
if ($C["domain"] == null) {
    //https://stackoverflow.com/questions/4503135/php-get-site-url-protocol-http-vs-https
    if (isset($_SERVER['HTTPS']) &&
        ($_SERVER['HTTPS'] == 'on' || $_SERVER['HTTPS'] == 1) ||
        isset($_SERVER['HTTP_X_FORWARDED_PROTO']) &&
        $_SERVER['HTTP_X_FORWARDED_PROTO'] == 'https') {
        $protocol = 'https://';
    }
    else {
        $protocol = 'http://';
    }
    $CORE["client"]["domain"] = $protocol . $_SERVER['HTTP_HOST'];
}

/*
 * Printing Functions - dependencies from the config
 */

function print_js($conf, $path) {
    if (!is_array($conf)) return;
    foreach ($conf as $lib=>$files) {
        print_js_single($files, $path);
    }
}

function print_js_single($files, $path) {
    $version = VERSION;
    if (is_array($files)) {
        foreach ($files as $file) {
            echo str_ends_with($file, ".mjs") ? 
            "    <script type=\"module\" src=\"$path$file?v=$version\"></script>\n" : 
            "    <script src=\"$path$file?v=$version\"></script>\n";
        }
    } else {
        echo str_ends_with($files, ".mjs") ? 
        "    <script type=\"module\" src=\"$path$files?v=$version\"></script>\n" : 
        "    <script src=\"$path$files?v=$version\"></script>\n";
    }
}

function print_css($conf, $path) {
    if (!is_array($conf)) return;
    foreach ($conf as $lib=>$files) {
        print_css_single($files, $path);
    }
}

function print_css_single($files, $path) {
    $version = VERSION;
    if (is_array($files)) {
        foreach ($files as $file) {
            echo "    <link rel=\"stylesheet\" href=\"$path$file?v=$version\">\n";
        }
    } else {
        echo "    <link rel=\"stylesheet\" href=\"$path$files?v=$version\">\n";
    }
}

function require_openseadragon() {
    global $CORE;
    $version = VERSION;
    echo "    <script src=\"{$CORE["openSeadragonPrefix"]}{$CORE["openSeadragon"]}?v=$version\"></script>\n";
}

function require_lib($name) {
    global $CORE;
    if (isset($CORE["css"]["libs"][$name])) print_css_single($CORE["css"]["libs"][$name], LIBS_ROOT);
    if (isset($CORE["js"]["libs"][$name])) print_js_single($CORE["js"]["libs"][$name], LIBS_ROOT);
}

function require_libs() {
    global $CORE;
    print_css($CORE["css"]["libs"], LIBS_ROOT);
    print_js($CORE["js"]["libs"], LIBS_ROOT);
}

function require_external() {
    global $CORE;
    print_css($CORE["css"]["external"], EXTERNAL_SOURCES);
    print_js($CORE["js"]["external"], EXTERNAL_SOURCES);
}

function require_core($type) {
    global $CORE;
    if (isset($CORE["css"]["src"][$type])) print_css_single($CORE["css"]["src"][$type], PROJECT_SOURCES);
    if (isset($CORE["js"]["src"][$type])) print_js_single($CORE["js"]["src"][$type], PROJECT_SOURCES);
}

function require_ui() {
    global $CORE;
    print_js($CORE["js"]["ui"], UI_SOURCES);
}

if ($parse_exception !== null) {
    throw new Exception("Unable to parse ENV configuration file: is it a valid JSON?");
}
