const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const querystring = require('querystring');

//todo https:
// const https = require('node:https');
//
// const options = {
//     key: fs.readFileSync('key.pem'),
//     cert: fs.readFileSync('cert.pem')
// };
//
// https.createServer(options, (req, res) => {
//     res.writeHead(200);
//     res.end("hello world\n");
// }).listen(8000);

const PROJECT_PATH = "";

const {getCore} = require("../templates/javascript/core");
const {loadPlugins} = require("../templates/javascript/plugins");
const {throwFatalErrorIf} = require("./error");
const constants = require("./constants");
const {files} = require("../../docs/include");
const {ABSPATH} = require("./constants");

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

    if (throwFatalErrorIf(res, core.exception, "Failed to parse the CORE initialization!")) return null;
    core.CORE.serverStatus.name = "node";
    core.CORE.serverStatus.supportsPost = true;

    //todo o18n and locale
    //const locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");
    loadPlugins(core, fs.existsSync,
        path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }),
        dirName => fs.readdirSync(dirName).filter(f => fs.statSync(dirName + '/' + f).isDirectory()),
        {t: function () {return "Unknown Error (e-translate).";}});
    if (throwFatalErrorIf(res, core.exception, "Failed to parse the MODULES or PLUGINS initialization!")) return null;
    return core;
}


async function responseStaticFile(req, res, targetPath) {
    //taken from https://stackoverflow.com/questions/28061080/node-itself-can-serve-static-files-without-express-or-any-other-module
    const extname = String(path.extname(targetPath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
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
            res.writeHead(200, { 'Content-Type': contentType }); // indicate the request was successful
            res.end(content, 'utf-8');
        }
    });
}

async function responseViewer(req, res) {
    // Parse the request url
    let rawData = req.method === 'POST' ? await rawReqToString(req) : undefined;
    let postData;
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
${core.requireLibs()}
${core.requireOpenseadragon()}
${core.requireExternal()}
${core.requireCore("loader")}
${core.requireCore("deps")}
${core.requireCore("app")}`;

                case "app":
                    return `
    <script type="text/javascript">
    //todo better handling of translation data and the data uploading, now hardcoded
    const lang = 'en';
    initXopat(
        ${JSON.stringify(core.PLUGINS)},
        ${JSON.stringify(core.MODULES)},
        ${JSON.stringify(core.CORE)},
        ${JSON.stringify(postData)},
        '${core.PLUGINS_FOLDER}',
        '${core.MODULES_FOLDER}',
        '${core.VERSION}',
        //i18next init config
        {
            resources: {
                [lang] : ${fs.readFileSync(constants.ABSPATH + "src/locales/en.json", { encoding: 'utf8', flag: 'r' })}
            },
            lng: lang,
        }
    );
    </script>`;

                case "modules":
                    return core.requireModules();

                case "plugins":
                    return core.requirePlugins();

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

    core.MODULES["webgl"].loaded = true;
    const replacer = function(match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireLib('primer')}
${core.requireLib('jquery')}
${core.requireCore("env")}
${core.requireCore("deps")}
${core.requireModules()}`;
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
server.listen(9000, 'localhost', () => {
    const ENV = process.env.XOPAT_ENV;
    const existsDefaultLocation = fs.existsSync(`${ABSPATH}env${path.sep}env.json`);
    if (!ENV && existsDefaultLocation) {
        console.log("Using env/env.json..");
    } else if (ENV) {
        if (fs.existsSync(ENV)) console.log("Using static ENV from ", ENV);
        else console.log("Using static ENV directly from the variable data: ", ENV.substring(0, 31) + "...");
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