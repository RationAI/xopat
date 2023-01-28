<?php
/**
 * Constants definition for static viewer configuration
 *  - basic API links, directories etc.
 *
 * Note: directory paths are expected to end with directory separator!
 * Note: also check config_meta.js for correct metadata configuration
 */

$localhost = false;

/**
 * Allow for dynamic setting, e.g. by running the viewer from different index script
 */
defined('PROJECT_ROOT') || define('PROJECT_ROOT', '');
defined('PROJECT_SOURCES') || define('PROJECT_SOURCES', PROJECT_ROOT . 'src/');
defined('VISUALISATION_ROOT') || define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME']) . '/'); //note that this works only if the files that includes config is in the same directory
defined('EXTERNAL_SOURCES') || define('EXTERNAL_SOURCES', PROJECT_SOURCES . 'external/');
defined('ASSETS_ROOT') || define('ASSETS_ROOT', PROJECT_SOURCES . 'assets/');
defined('LOCALES_ROOT') || define('LOCALES_ROOT', PROJECT_SOURCES . 'locales/');

/**
 * Static part
 */
define('OPENSEADRAGON_BUILD', './openseadragon/build/openseadragon/openseadragon.js');

define('MODULES_FOLDER', PROJECT_ROOT . 'modules/');
define('PLUGINS_FOLDER', PROJECT_ROOT . 'plugins/');

if ($localhost) {
    define('PROTOCOL', "http://");
    define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
    define('JS_COOKIE_EXPIRE', 365); //days
    define('JS_COOKIE_PATH', "/");
    define('JS_COOKIE_SAME_SITE', ""); //default
    define('JS_COOKIE_SECURE', ""); //default

    //note: you probably want to set up a reverse proxy for localhost rather than changing this (CORS)
    define('BG_TILE_SERVER', SERVER . "/iipsrv.fcgi");
    define('LAYERS_TILE_SERVER', SERVER . "/iipsrv.fcgi");

    define('METADATA_SERVER', ""); //server for metadata handling, see config_meta.js
} else {
    define('PROTOCOL', "https://");
    define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
    //auto domain: ($_SERVER['HTTP_HOST'] != 'localhost') ? $_SERVER['HTTP_HOST'] : false
    define('JS_COOKIE_EXPIRE', 365); //days
    define('JS_COOKIE_PATH', "/");
    define('JS_COOKIE_SAME_SITE', "None");
    define('JS_COOKIE_SECURE', "false");

    define('BG_TILE_SERVER', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle regular images
    define('LAYERS_TILE_SERVER', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle image arrays

    define('METADATA_SERVER', ""); //server for metadata handling, see config_meta.js
}

define('VISUALISATION_ROOT_ABS_PATH', SERVER . VISUALISATION_ROOT);
define('EXTERNAL_SOURCES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . EXTERNAL_SOURCES);
define('MODULES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . MODULES_FOLDER);
define('PLUGINS_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . PLUGINS_FOLDER);

/**
 * Version is attached to javascript
 * sources so that an update is enforced
 * with change
 */
define('VERSION', "1.0.1");

/**
 * Default protocol = DZI
 * one-liner javascript expression with two available variables:
 *  - path: server URL
 *  - data: requested images ids/paths (comma-separated if multiple)
 *  - do not use " symbol as this is used to convert the value to string (or escape, e.g. \\")
 *
 * preview is an url creator for whole image preview fetching
 */
define('BG_DEFAULT_PROTOCOL', '`${path}?Deepzoom=\${data}.dzi`');
define('BG_DEFAULT_PROTOCOL_PREVIEW', '`${path}?Deepzoom=\${data}_files/0/0_0.jpg`');
define('LAYERS_DEFAULT_PROTOCOL', '`${path}#DeepZoomExt=\${data.join(",")}.dzi`');

/**
 * Headers used to fetch data from image servers
 */
define('COMMON_HEADERS', array());

/**
 * Path/URL to a context page
 * (where user should be offered to go in case of failure)
 */
define('GATEWAY', '../list-experiments.php');
