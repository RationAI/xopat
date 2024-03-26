const path = require('node:path');

_ABSPATH = path.dirname(path.dirname(__dirname));
ABSPATH = _ABSPATH + "/";
PROJECT_ROOT = process.env.PROJECT_ROOT || "";

module.exports = Object.freeze({
    _ABSPATH_NO_SLASH: _ABSPATH,
    ABSPATH: ABSPATH,
    //Absolute Root Path to the php server
    PHP_INCLUDES: ABSPATH + 'server/php/inc/',
    VIEWER_SOURCES_ABS_ROOT: ABSPATH + 'src/',
    ABS_MODULES: ABSPATH + 'modules/',
    ABS_PLUGINS: ABSPATH + 'plugins/',

    //Relative Paths For the Viewer
    PROJECT_ROOT: PROJECT_ROOT,
    PROJECT_SOURCES: PROJECT_ROOT + 'src/',
    EXTERNAL_SOURCES: this.PROJECT_SOURCES + 'external/',
    LIBS_ROOT: this.PROJECT_SOURCES + 'libs/',
    ASSETS_ROOT: this.PROJECT_SOURCES + 'assets/',
    LOCALES_ROOT: this.PROJECT_SOURCES + 'locales/',
    MODULES_FOLDER: PROJECT_ROOT + 'modules/',
    PLUGINS_FOLDER: PROJECT_ROOT + 'plugins/',

    //Utiles
    TEMPLATE_PATTERN: /<template\s+id="template-([a-zA-Z0-9-_]+)">\s*<\/template>/g
});
