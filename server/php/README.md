TODO: describe the server usage

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
