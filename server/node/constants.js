const path = require('node:path');

_ABSPATH = path.dirname(path.dirname(__dirname));
ABSPATH = _ABSPATH + path.sep;
PROJECT_ROOT = process.env.PROJECT_ROOT || "";

module.exports = Object.freeze({
    _ABSPATH_NO_SLASH: _ABSPATH,
    ABSPATH: ABSPATH,
    //Absolute Root Path for the node server
    VIEWER_SOURCES_ABS_ROOT: ABSPATH + 'src' + path.sep,
    ABS_MODULES: ABSPATH + 'modules' + path.sep,
    ABS_PLUGINS: ABSPATH + 'plugins' + path.sep,

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
