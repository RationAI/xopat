const {parseArgs} = require('node:util');
const args = process.argv;
const options = {
    language: {
        type: 'string',
        short: 'l'
    },
    port: {
        type: 'string',
        short: 'p'
    },
    host: {
        type: 'string',
        short: 'h'
    },
    root: {
        type: 'string',
        short: 'r'
    },
    dev: {
        type: 'boolean'
    }
};
const {
    values,
    positionals
} = parseArgs({ args, options, allowPositionals: true });

const path = require('node:path');

_ABSPATH = values.root || path.dirname(path.dirname(__dirname));
ABSPATH = _ABSPATH + path.sep;
PROJECT_ROOT = process.env.PROJECT_ROOT || "";

function readBooleanEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

const DEV_MODE = values.dev === true || readBooleanEnv('XOPAT_DEV_MODE', false);
const DEV_LOG_MAX_ENTRIES = Math.max(100, Number(process.env.XOPAT_DEV_LOG_MAX_ENTRIES) || 10000);

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
    EXTERNAL_SOURCES: PROJECT_ROOT + 'src/external/',
    LIBS_ROOT: PROJECT_ROOT + 'src/libs/',
    ASSETS_ROOT: PROJECT_ROOT + 'src/assets/',
    LOCALES_ROOT: PROJECT_ROOT + 'src/locales/',
    SERVER_ROOT: PROJECT_ROOT + 'server/',
    MODULES_FOLDER: PROJECT_ROOT + 'modules/',
    PLUGINS_FOLDER: PROJECT_ROOT + 'plugins/',

    //Utils
    TEMPLATE_PATTERN: /<template\s+id="template-([a-zA-Z0-9-_]+)">\s*<\/template>/g,

    //Server
    SERVER: {
        HOST: values.host || process.env.XOPAT_NODE_HOST || '0.0.0.0',
        PORT: values.port || process.env.XOPAT_NODE_PORT || 9000,
        LANGUAGE: values.language || 'en',
        DEV_MODE: DEV_MODE,
        DEV_LOG_MAX_ENTRIES: DEV_LOG_MAX_ENTRIES,
    }
});
