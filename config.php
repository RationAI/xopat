<?php

define('PROTOCOL', "https://");
define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
define('AUTH_HEADERS', "Basic cmF0aW9uYWk6cmF0aW9uYWlfZGVtbw==");
define('VISUALISATION_ROOT_ABS_PATH', SERVER . dirname($_SERVER['SCRIPT_NAME']));
define('VERSION', "0.0.1");