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
const {verifyProxyAuth, verifyRpcAuth} = require("./auth");
const { XopatServerRuntime } = require("./server-runtime");
const { DevLogBuffer, installDevConsoleCapture } = require("./dev-log-buffer");


const PROJECT_PATH = "";
const language = constants.SERVER.LANGUAGE;
const languageServerConf = getI18NData(language);
languageServerConf.fallbackLng = 'en';
i18n.init(languageServerConf);

function readStartupVersion(defaultVersion = "dev") {
    try {
        const pkgPath = path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "package.json");
        if (!fs.existsSync(pkgPath)) return defaultVersion;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, { encoding: "utf8", flag: "r" }));
        return pkg.version || defaultVersion;
    } catch (e) {
        console.warn(`Failed to read package.json version, falling back to '${defaultVersion}':`, e.message);
        return defaultVersion;
    }
}

const STARTUP_VERSION = readStartupVersion();
const DEV_MODE = constants.SERVER.DEV_MODE === true;
const devLogBuffer = DEV_MODE
    ? new DevLogBuffer({ maxEntries: constants.SERVER.DEV_LOG_MAX_ENTRIES })
    : null;
const logger = DEV_MODE
    ? installDevConsoleCapture(console, devLogBuffer, { source: "server" })
    : console;

if (DEV_MODE) {
    logger.info(`[dev-mode] enabled (log buffer size: ${constants.SERVER.DEV_LOG_MAX_ENTRIES})`);
    process.on('unhandledRejection', error => {
        logger.error('[process] unhandledRejection', error);
    });
    process.on('uncaughtException', error => {
        logger.error('[process] uncaughtException', error);
    });
}

const sessions = new Map();
const serverRuntime = new XopatServerRuntime({
    root: constants._ABSPATH_NO_SLASH || constants.ABSPATH,
    auth: { verifyRpcAuth },
    logger,
    devMode: DEV_MODE,
    devLogBuffer,
    version: STARTUP_VERSION,
    startedAt: new Date(),
});

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
        !serverOnly, // secure only when not on server
        { version: STARTUP_VERSION }
    );

    if (throwFatalErrorIf(core, res, core.exception, "Failed to parse the CORE initialization!", core.exception)) return null;
    core.CORE.server.name = "node";
    core.CORE.server.supportsPost = true;
    core.CORE.server.devMode = DEV_MODE;

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

function normalizeSchemePluginRecords(plugins) {
    const result = {};
    const manifestKeys = new Set([
        'id', 'name', 'author', 'version', 'description', 'icon',
        'includes', 'modules', 'requires', 'permaLoad', 'enabled',
        'loaded', 'error', 'directory', 'path', 'styleSheet'
    ]);

    for (const [id, plugin] of Object.entries(plugins || {})) {
        if (!plugin || typeof plugin !== "object") {
            continue;
        }

        const meta = {};
        for (const key of [
            'id', 'name', 'author', 'version', 'description', 'icon',
            'modules', 'requires', 'permaLoad', 'enabled', 'loaded',
            'directory'
        ]) {
            if (Object.prototype.hasOwnProperty.call(plugin, key)) {
                meta[key] = plugin[key];
            }
        }

        const defaults = {};
        for (const [key, value] of Object.entries(plugin)) {
            if (!manifestKeys.has(key)) {
                defaults[key] = value;
            }
        }

        result[id] = {
            meta,
            defaults
        };
    }

    return result;
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

async function responseStaticFile(req, res, targetPath, urlObj) {
    const contentType = utils.mimeOf(targetPath);
    const version = urlObj?.searchParams?.get("v") || urlObj?.searchParams?.get("version");

    fs.readFile(targetPath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end(`Sorry, check with the site admin for error: ${err.code}`);
            return;
        }

        const headers = {
            "Content-Type": contentType
        };

        if (version) {
            headers["Cache-Control"] = "public, max-age=31536000, immutable";
        } else {
            headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            headers["Pragma"] = "no-cache";
            headers["Expires"] = "0";
        }

        res.writeHead(200, headers);
        res.end(content);
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

    } catch (e) {
        logger.error(`Proxy error routing to ${alias}:`, e);
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
        logger.warn(e);
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
<script src="${constants.SERVER_ROOT}client-rpc.js"></script>
<script>
window.XOPAT_CSRF_TOKEN = '${session ? session.csrfToken : ''}';
window.XOPAT_DEV_MODE = ${JSON.stringify(DEV_MODE)};
window.xserver = window.xserver || XOpatServerRPC.createClient({
  getViewerId: () => window.VIEWER?.id || undefined
});
</script>
`;

            case "app":
                return `
    <script type="text/javascript">
    initXOpat(
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

async function responseScheme(req, res, templateName="scheme.html") {
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    const payload = {
        viewer: {
            name: core.CORE?.name || "xOpat",
            version: core.VERSION || STARTUP_VERSION,
        },
        paramsDefaults: core.CORE?.setup || {},
        clientDefaults: {
            image_group_server: core.CORE?.client?.image_group_server ?? null,
            image_group_protocol: core.CORE?.client?.image_group_protocol ?? null,
            data_group_server: core.CORE?.client?.data_group_server ?? null,
            data_group_protocol: core.CORE?.client?.data_group_protocol ?? null,
        },
        plugins: normalizeSchemePluginRecords(core.PLUGINS),
        typesSource: fs.readFileSync(
            path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "src/types/app.d.ts"),
            { encoding: "utf8", flag: "r" }
        ),
        configTypesSource: fs.readFileSync(
            path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "src/types/config.d.ts"),
            { encoding: "utf8", flag: "r" }
        )
    };

    const replacer = function (match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireCore("env")}`;
                case "page-init":
                    return `
    <script type="text/javascript">
    window.schemeInit = ${JSON.stringify(payload)};
    </script>`;
                case "shared-scheme-script":
                    return `
    <script type="text/javascript">
${fs.readFileSync(
    path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "server/static/scheme.js"),
    { encoding: "utf8", flag: "r" }
)}
    </script>`;
                default:
                    return "";
            }
        } catch (e) {
            throw e;
        }
    };

    const html = fs.readFileSync(
        path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, `server/templates/${templateName}`),
        { encoding: "utf8", flag: "r" }
    ).replace(constants.TEMPLATE_PATTERN, replacer);

    res.write(html);
    res.end();
}

const server = http.createServer(async (req, res) => {
    try {
        const protocol = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
        const urlObj = new URL(`${protocol}://${req.headers.host}${req.url}`);

        if (urlObj.pathname.startsWith("/health")) {
            res.writeHead(200);
            res.end();
            return;
        }

        if (urlObj.pathname === "/server/client-rpc.js") {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            res.end(serverRuntime.getClientRuntimeSource());
            return;
        }

        if (urlObj.pathname.startsWith("/__rpc/")) {
            const core = initViewerCoreAndPlugins(req, res, true);
            if (!core) return;
            const session = getSession(req);
            return serverRuntime.handleRpc(req, res, core, session, urlObj);
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
                return responseStaticFile(req, res, possibleFilePath, urlObj);
            }
            res.writeHead(404);
            res.end();
            return;
        }

        if (urlObj.pathname.startsWith("/dev_setup")) {
            return responseDeveloperSetup(req, res);
        }

        if (urlObj.pathname.startsWith("/scheme_raw_extended")) {
            return responseScheme(req, res, "scheme-raw-extended.html");
        }

        if (urlObj.pathname.startsWith("/scheme_raw")) {
            return responseScheme(req, res, "scheme-raw.html");
        }

        if (urlObj.pathname.startsWith("/scheme")) {
            return responseScheme(req, res);
        }

        let session = getSession(req);
        if (!session) {
            session = createSession(res);
        }

        return responseViewer(req, res, session);
    } catch (e) {
        logger.error(e);
        res.statusCode = 500;
        res.write(String(e));
        res.end();
    }
});
server.listen(constants.SERVER.PORT, constants.SERVER.HOST, () => {
    const ENV = process.env.XOPAT_ENV;
    const existsDefaultLocation = fs.existsSync(`${ABSPATH}env${path.sep}env.json`);
    if (!ENV && existsDefaultLocation) {
        logger.info("Using env/env.json..");
    } else if (ENV) {
        if (fs.existsSync(ENV)) logger.info("Using static ENV from ", ENV);
        else logger.info("Using configuration from XOPAT_ENV: ", ENV.substring(0, 31) + "...");
    } else {
        logger.info("Using default ENV (no overrides).");
    }

    const port = constants.SERVER.PORT;
    const scheme = port === 443 ? "https" : "http";
    const host = constants.SERVER.HOST === "0.0.0.0" ? "localhost" : constants.SERVER.HOST;
    const url = ["80", "443"].includes(port) ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
    logger.info(`The server is listening on ${url} ...`);
    logger.info(`  To manually create and run a session, open ${url}/dev_setup`);
    logger.info(`  To inspect the deployment-aware session schema, open ${url}/scheme`);
    logger.info(`  To inspect the raw machine-readable schema output, open ${url}/scheme_raw`);
    logger.info(`  To inspect the raw extended schema output, open ${url}/scheme_raw_extended`);
    logger.info(`  To open using GET, provide ${url}?slides=slide,list&masks=mask,list`);
    logger.info(`  To open using JSON session, provide ${url}#urlEncodedSessionJSONHere`);
    logger.info(`                                      or sent the data using HTTP POST`);
    logger.info(`  The session description is available in src/README.md`);
});
