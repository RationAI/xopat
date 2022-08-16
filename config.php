<?php

$production = false;

//relative path system in the application
define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME'])); //note that this works only if the files that includes config is in the same directory
define('EXTERNAL_SOURCES', 'external');
define('MODULES_FOLDER', 'modules');
define('PLUGINS_FOLDER', 'plugins');
define('OPEN_SEADRAGON', 'osd');

if ($production) {
    define('PROTOCOL', "https://");
    define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
    //auto domain: ($_SERVER['HTTP_HOST'] != 'localhost') ? $_SERVER['HTTP_HOST'] : false
    define('JS_COOKIE_SETUP', "expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=None; Secure=false; path=/");

    define('BG_TILE_SERVER', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle regular images
    define('LAYERS_TILE_SERVER', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle image arrays
} else {
    define('PROTOCOL', "http://");
    define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
    define('JS_COOKIE_SETUP', "expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/");
    define('BG_TILE_SERVER', SERVER . "/iipsrv.fcgi");
    define('LAYERS_TILE_SERVER', SERVER . "/iipsrv.fcgi");
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
