const http = require("node:http");
const {URL} = require('url');
const fs = require("node:fs");
const path = require("node:path");
const querystring = require('querystring');
const crypto = require('node:crypto');
const i18n = require('../../src/libs/i18next.min');


const utils = require('./utils');
const { getCore } = require("../templates/javascript/core");
const { loadPlugins } = require("../templates/javascript/plugins");
const { throwFatalErrorIf } = require("./error");


const constants = require("./constants");
const {rawReqToString} = require("./utils");
const {verifyProxyAuth} = require("./auth");


const PROJECT_PATH = "";
const language = constants.SERVER.LANGUAGE;
const languageServerConf = getI18NData(language);
languageServerConf.fallbackLng = 'en';
i18n.init(languageServerConf);


const sessions = new Map();

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const [name, ...rest] = pair.split('=');
        cookies[name.trim()] = decodeURIComponent(rest.join('=') || '');
    });
    return cookies;
}

function getSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies['xopat_session'];
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    return session;
}

function createSession(res) {
    const id = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(16).toString('hex');

    const session = {
        id,
        csrfToken,
        createdAt: Date.now(),
        // you can attach extra flags here, e.g. which proxies are allowed
        allowedProxies: 'ALL'
    };

    sessions.set(id, session);

    // Set an HttpOnly cookie so front-end JS can’t steal it
    // (but browser will send it automatically with requests)
    const cookieParts = [
        `xopat_session=${encodeURIComponent(id)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax'
    ];
    if (process.env.NODE_ENV === 'production') {
        cookieParts.push('Secure');
    }
    const cookie = cookieParts.join('; ');

    // Preserve other Set-Cookie headers if any
    const existing = res.getHeader('Set-Cookie');
    if (existing) {
        res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(cookie) : [existing, cookie]);
    } else {
        res.setHeader('Set-Cookie', cookie);
    }

    return session;
}


const initViewerCoreAndPlugins = (req, res, serverOnly=false) => {
    const core = getCore(constants.ABSPATH, PROJECT_PATH,
        fs.existsSync,
        path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }),
        key => process.env[key],
        !serverOnly // secure only when not on server
    );

    if (throwFatalErrorIf(core, res, core.exception, "Failed to parse the CORE initialization!", core.exception)) return null;
    core.CORE.server.name = "node";
    core.CORE.server.supportsPost = true;

    if (serverOnly) {
        return core;
    }

    //const locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");
    let raw = req.url || "/";
    if (raw.startsWith("//")) raw = "/" + raw.replace(/^\/+/, ""); // prevent accidental issues with double slashes
    // use 'http', we don't care about the protocol
    const url = new URL(raw, `http://${req.headers.host}`);
    // TODO: support req.headers['accept-language'] - somma separated list, setup.locale should support multiple fallbacks
    const language = url.searchParams.get('lang');
    if (language) core.CORE.setup.locale = language;

    loadPlugins(core, fs.existsSync, path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }), i18n);
    if (throwFatalErrorIf(core, res, core.exception, "Failed to parse the MODULES or PLUGINS initialization!", core.exception)) return null;

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
    const contentType = utils.mimeOf(targetPath);
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

async function responseProxy(req, res, requestUrl) {
    // 1. todo parse just core for now, no need to load plugins
    const core = initViewerCoreAndPlugins(req, res, true);
    if (!core) return;

    // 2. Extract alias from /proxy/alias/v1/...
    const parts = requestUrl.pathname.split('/').filter(Boolean);
    const alias = parts[1];
    const targetPath = '/' + parts.slice(2).join('/') + (requestUrl.search || '');

    // 3. Match against the "secure.proxies" definition
    const serverConf = core.CORE.server || core.CORE.serverStatus || {};
    const proxyConfig = serverConf.secure?.proxies?.[alias];

    console.log(serverConf);

    if (!proxyConfig) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end(`Proxy target alias '${alias}' is not allowed or not configured.`);
    }

    const targetUrl = proxyConfig.baseUrl.replace(/\/$/, '') + targetPath;

    // 4. Read body
    let bodyContent = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        bodyContent = await rawReqToString(req);
    }

    // 5. Build headers to forward upstream (start from incoming)
    const headers = { ...req.headers };
    delete headers['host'];
    delete headers['connection'];
    delete headers['origin'];
    delete headers['referer'];

    // 5b. Let auth verifiers inspect/validate the request and *mutate* upstream headers
    const upstreamState = { headers, targetPath };
    const authOk = await verifyProxyAuth(req, res, core, alias, proxyConfig, upstreamState);
    if (!authOk) {
        // verifyProxyAuth already wrote the error response
        return;
    }

    // 5c. Safely merge the expanded secure headers (e.g. API keys)
    if (proxyConfig.headers) {
        Object.assign(headers, proxyConfig.headers);
    }

    // 6. Forward the request
    try {
        const fetchRes = await fetch(targetUrl, {
            method: req.method,
            headers: headers,
            body: bodyContent
        });

        const resHeaders = Object.fromEntries(fetchRes.headers.entries());
        delete resHeaders['content-encoding'];

        res.writeHead(fetchRes.status, resHeaders);
        const arrayBuffer = await fetchRes.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));
        console.log(`Proxy: ${req.method} ${targetUrl} -> ${fetchRes.status}`);

    } catch (e) {
        console.error(`Proxy error routing to ${alias}:`, e);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end("Bad Gateway: Error communicating with the proxied service.");
    }
}

async function responseViewer(req, res, session) {
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
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireExternal()}
${core.requireUI()}
${core.requireCore("loader")}
${core.requireCore("deps")}
${core.requireCore("app")}
${core.requireCore("env")}
<script>
window.XOPAT_CSRF_TOKEN = '${session ? session.csrfToken : ''}';
</script>
`;

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

            case "ui":
                return core.requireUI(core.CORE.client.production);

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

    const replacer = function (match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireUI()}
${core.requireCore("env")}
${core.requireCore("deps")}`;
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
        const urlObj = new URL(`${protocol}://${req.headers.host}${req.url}`);

        if (urlObj.pathname.startsWith("/health")) {
            res.writeHead(200);
            res.end();
            return;
        }

        // --- New: proxy endpoint with session check ---
        if (urlObj.pathname.startsWith("/proxy/")) {
            const session = getSession(req);
            if (!session) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                return res.end('Unauthorized: missing or invalid session');
            }

            // optional: CSRF header check
            const clientToken = req.headers['x-xopat-csrf'];
            if (!clientToken || clientToken !== session.csrfToken) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Forbidden: invalid CSRF token');
            }

            return responseProxy(req, res, urlObj, session);
        }
        // --- end new proxy route ---

        // Treat suffix paths as attempt to access existing files
        if (urlObj.pathname.match(/.+\..{2,5}$/g)) {
            const possibleFilePath = constants._ABSPATH_NO_SLASH + urlObj.pathname;
            if (fs.existsSync(possibleFilePath)) {
                return responseStaticFile(req, res, possibleFilePath);
            }
            res.writeHead(404);
            res.end();
            return;
        }

        if (urlObj.pathname.startsWith("/dev_setup")) {
            return responseDeveloperSetup(req, res);
        }

        let session = getSession(req);
        if (!session) {
            session = createSession(res);
        }

        return responseViewer(req, res, session);
    } catch (e) {
        console.error(e);
        res.statusCode = 500;
        res.write(String(e));
        res.end();
    }
});
server.listen(constants.SERVER.PORT, constants.SERVER.HOST, () => {
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

    const port = constants.SERVER.PORT;
    const scheme = port === 443 ? "https" : "http";
    const host = constants.SERVER.HOST === "0.0.0.0" ? "localhost" : constants.SERVER.HOST;
    const url = ["80", "443"].includes(port) ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
    console.log(`The server is listening on ${url} ...`);
    console.log(`  To manually create and run a session, open ${url}/dev_setup`);
    console.log(`  To open using GET, provide ${url}?slides=slide,list&masks=mask,list`);
    console.log(`  To open using JSON session, provide ${url}#urlEncodedSessionJSONHere`);
    console.log(`                                      or sent the data using HTTP POST`);
    console.log(`  The session description is available in src/README.md`);
});
