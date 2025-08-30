const http = require("node:http");
const url = require('url');
const fs = require("node:fs");
const path = require("node:path");
const querystring = require('querystring');
const i18n = require('../../src/libs/i18next.min');

const PROJECT_PATH = "";

const { getCore } = require("../templates/javascript/core");
const { loadPlugins } = require("../templates/javascript/plugins");
const { throwFatalErrorIf } = require("./error");
const constants = require("./constants");
const { ABSPATH } = require("./constants");


// TODO hardcoded language!
const language = 'en';
const languageServerConf = getI18NData(language);
languageServerConf.fallbackLng = 'en';
i18n.init(languageServerConf);

const rawReqToString = async (req) => {
    const buffers = [];
    for await (const chunk of req) {
        buffers.push(chunk);
    }
    return Buffer.concat(buffers).toString();
};

const initViewerCoreAndPlugins = (req, res) => {

    const core = getCore(ABSPATH, PROJECT_PATH,
        fs.existsSync,
        path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }),
        key => process.env[key]);

    if (throwFatalErrorIf(res, core.exception, "Failed to parse the CORE initialization!", core.exception)) return null;
    core.CORE.serverStatus.name = "node";
    core.CORE.serverStatus.supportsPost = true;

    //const locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");
    const requestUrl = url.parse(req.url, true);
    const language = requestUrl.query.lang;
    if (language) core.CORE.setup.locale = language;

    loadPlugins(core, fs.existsSync,
        path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }),
        dirName => fs.readdirSync(dirName).filter(f => fs.statSync(dirName + '/' + f).isDirectory()),
        i18n);
    if (throwFatalErrorIf(res, core.exception, "Failed to parse the MODULES or PLUGINS initialization!", core.exception)) return null;
    return core;
}

function getI18NData(language) {
    const localeFile = `${constants.ABSPATH}/src/locales/${language}.json`;
    if (!fs.existsSync(localeFile)) {
        console.error("File with locales for language does not exist, defaulting to 'en'!", language, localeFile);
        language = 'en';
    }
    const data = fs.readFileSync(localeFile, {encoding: 'utf8', flag: 'r'});
    return {
        resources: {
            [language]: JSON.parse(data),
        },
        lng: language,
    }
}

async function responseStaticFile(req, res, targetPath) {
    //taken from https://stackoverflow.com/questions/28061080/node-itself-can-serve-static-files-without-express-or-any-other-module
    const extname = String(path.extname(targetPath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm',
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    fs.readFile(targetPath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end(`Sorry, check with the site admin for error: ${err.code}`);
        } else {
            const head = { 'Content-Type': contentType };
            // Threading for WASM requires all resources to comply: this is not often doable due to external image servers
            // head['Cross-Origin-Opener-Policy'] = 'same-origin';
            // head['Cross-Origin-Embedder-Policy'] = 'require-corp';
            res.writeHead(200, head);
            res.end(content, 'utf-8');
        }
    });
}

async function responseViewer(req, res) {
    // Parse the request url
    let rawData = req.method === 'POST' ? await rawReqToString(req) : undefined;
    let postData;

    function readPostDataItem(item) {
        // The object can come in double-encoded, try encoding if necessary
        try {
            return JSON.parse(item);
        } catch {
            return item;
        }
    }

    function parsePostData(data) {
        const result = {};
        for (const key in data) {
            const topLevelKey = key.split('[')[0];
            const nestedKeyMatch = key.match(/\[([^\]]+)\]/);

            if (nestedKeyMatch) {
                const nestedKey = nestedKeyMatch[1];
                if (!result[topLevelKey]) {
                    result[topLevelKey] = {};
                }
                result[topLevelKey][nestedKey] = readPostDataItem(data[key]);
            } else {
                result[topLevelKey] = readPostDataItem(data[key]);
            }
        }
        return result;
    }

    try {
        switch (req.headers['content-type']) {
            case 'application/x-www-form-urlencoded':
                rawData = decodeURIComponent(rawData || "");
                postData = querystring.parse(rawData);
                break;

            case 'application/json':
            default:
                postData = rawData && JSON.parse(rawData) || {};
                break;
        }

        // Parse structure
        postData = parsePostData(postData);
    } catch (e) {
        //be silent for now
        //todo: maybe notify the user somehow through the session set error prop or something
        console.warn(e);
        postData = {};
    }
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    const replacer = function(match, p1) {
        try {
            switch (p1) {
            case "head":
                return `
${core.requireCore("env")}
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireUI()}
${core.requireExternal()}
${core.requireCore("loader")}
${core.requireCore("deps")}
${core.requireCore("app")}`;

            case "app":
                return `
    <script type="text/javascript">
    initXopat(
        ${JSON.stringify(core.PLUGINS)},
        ${JSON.stringify(core.MODULES)},
        ${JSON.stringify(core.CORE)},
        ${JSON.stringify(postData)},
        '${core.PLUGINS_FOLDER}',
        '${core.MODULES_FOLDER}',
        '${core.VERSION}',
        ${JSON.stringify(getI18NData(core.CORE.setup.locale))}
    );
    </script>`;

            case "modules":
                return core.requireModules(core.CORE.client.production);

            case "plugins":
                return core.requirePlugins(core.CORE.client.production);

            default:
                //todo warn
                return "";
            }
        } catch (e) {
            //todo err
            throw e;
        }
    };

    const html = fs.readFileSync(constants.ABSPATH + "server/templates/index.html", { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    res.write(html);
    res.end();
}

async function responseDeveloperSetup(req, res) {
    // Parse the request url
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    if (core.MODULES["webgl"]) {
        core.MODULES["webgl"].loaded = true;
    } else {
        console.warn("Could not find webgl module: visualizations will not work!");
    }
    const replacer = function (match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireOpenseadragon()}
${core.requireLib('primer')}
${core.requireLib('jquery')}
${core.requireLib('render')}
${core.requireUI()}
${core.requireCore("env")}
${core.requireCore("deps")}
${core.requireModules(true)}`;
                case "form-init":
                    return `
    <script type="text/javascript">
    window.formInit = {
        location: "${constants.PROJECT_ROOT}/",
        lang: {
            ready: "Ready!"
        }
    }
    </script>`;

                default:
                    return "";
            }
        } catch (e) {
            //todo err
            throw e;
        }
    };

    const html = fs.readFileSync(constants.ABSPATH + "server/templates/dev-setup.html", { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    res.write(html);
    res.end();
}

const server = http.createServer(async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const url = new URL(`${protocol}://${req.headers.host}${req.url}`);

        // Treat suffix paths as attempt to access existing files
        if (url.pathname.match(/.+\..{2,5}$/g)) {
            const possibleFilePath = constants._ABSPATH_NO_SLASH + url.pathname;
            if (fs.existsSync(possibleFilePath)) {
                return responseStaticFile(req, res, possibleFilePath);
            }
            res.writeHead(404);
            res.end();
            return
        }

        if (url.pathname.startsWith("/dev_setup")) {
            return responseDeveloperSetup(req, res);
        }

        return responseViewer(req, res);
    } catch (e) {
        console.error(e);
        res.statusCode = 500;
        //todo consider JSON structured response similar to fastapi
        res.write(String(e));
        res.end();
    }
});
server.listen(process.env.XOPAT_NODE_PORT || 9000, '0.0.0.0', () => {
    const ENV = process.env.XOPAT_ENV;
    const existsDefaultLocation = fs.existsSync(`${ABSPATH}env${path.sep}env.json`);
    if (!ENV && existsDefaultLocation) {
        console.log("Using env/env.json..");
    } else if (ENV) {
        if (fs.existsSync(ENV)) console.log("Using static ENV from ", ENV);
        else console.log("Using configuration from XOPAT_ENV: ", ENV.substring(0, 31) + "...");
    } else {
        console.log("Using default ENV (no overrides).");
    }
    console.log(`The server is listening on localhost:9000 ...`);
    console.log(`  To manually create and run a session, open http://localhost:9000/dev_setup`);
    console.log(`  To open using GET, provide http://localhost:9000?slides=slide,list&masks=mask,list`);
    console.log(`  To open using JSON session, provide http://localhost:9000#urlEncodedSessionJSONHere`);
    console.log(`                                      or sent the data using HTTP POST`);
    console.log(`  The session description is available in src/README.md`);
});
