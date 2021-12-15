<?php

//application data
define('VERSION', "1.0");
define('IIPIMAGE_SERVER', "/iipsrv-martin/iipsrv.fcgi");
define('AUTH_HEADERS', isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : false);

//relative path system in the application
define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME'])); //todo this is invalid, it will be different if included from different sources
define('EXTERNAL_SOURCES', 'external');
define('MODULES', 'modules');
define('PLUGINS', 'plugins');
define('OPEN_SEADRAGON', 'osd');

//absolute path system
define('PROTOCOL', "https://");
define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
define('VISUALISATION_ROOT_ABS_PATH', SERVER . VISUALISATION_ROOT);
define('EXTERNAL_SOURCES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . EXTERNAL_SOURCES);
define('MODULES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . MODULES);
define('PLUGINS_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . PLUGINS);


define('GATEWAY', '../list-experiments.php');
