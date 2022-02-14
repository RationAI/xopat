<?php

//relative path system in the application
define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME'])); //todo this is invalid, it will be different if included from different sources
define('EXTERNAL_SOURCES', 'external');
define('MODULES', 'modules');
define('PLUGINS', 'plugins');
define('OPEN_SEADRAGON', 'osd');

//absolute path system
//PRODUCTION
define('PROTOCOL', "https://");
//LOCALHOST
//define('PROTOCOL', "http://");
define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
define('VISUALISATION_ROOT_ABS_PATH', SERVER . VISUALISATION_ROOT);
define('EXTERNAL_SOURCES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . EXTERNAL_SOURCES);
define('MODULES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . MODULES);
define('PLUGINS_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . PLUGINS);

//application data
define('VERSION', "1.0.1");

//PRODUCTION
define('SERVED_IMAGES', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle regular images
define('SERVED_LAYERS', SERVER . "/iipsrv-martin/iipsrv.fcgi"); //server that can handle image arrays
//LOCALHOST
//define('SERVED_IMAGES', "https://rationai-vis.ics.muni.cz/iipsrv-martin/iipsrv.fcgi");
//define('SERVED_LAYERS', "https://rationai-vis.ics.muni.cz/iipsrv-martin/iipsrv.fcgi");

define('COMMON_HEADERS', array());
define('AUTH_HEADERS', isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : false);
define('GATEWAY', '../list-experiments.php');
