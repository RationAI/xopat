<?php

$production = false;

//relative path system in the application
define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME'])); //todo this is invalid, it will be different if included from different sources
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
define('VERSION', "1.2.0");


/**
 * Default protocol
 * one-liner javascript expression with two available variables:
 *  - path: server URL
 *  - data: requested images ids/paths (comma-separated if multiple)
 */
define('BG_DEFAULT_PROTOCOL', '`${path}?Deepzoom=\${data}.dzi`');
define('LAYERS_DEFAULT_PROTOCOL', '`${path}#DeepZoomExt=\${data.join(\',\')}.dzi`');

//temp solution for now...
//todo make this more sophisticated...
define('USER', 'rationai');
define('PASSWORD', 'rationai_demo');
//set to empty string if no authorization
define('AUTH_HEADER_CONTENT', "Basic " . base64_encode(USER.":".PASSWORD));

/**
 * Headers used to fetch data from image servers
 */
define('COMMON_HEADERS', array());

/**
 * Path/URL to a context page
 * (where user should be offered to go in case of failure)
 */
define('GATEWAY', '../list-experiments.php');
