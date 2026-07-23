const {parse} = require("comment-json");

// secure mode removes all 'secure' options from the config - leave to true when using the config for FE response
module.exports.getCore = function(absPath, projectRoot, fileExists, readFile, readEnv, secure=true, defaults={}) {

    function parseBool(x) {
        const type = typeof x;
        if (type === "boolean") {
            return x;
        }
        if (type === "string") {
            x = x.toLowerCase();
            if (x === "false") return false;
            if (x === "true") return true;
        }
        if (type === "number") {
            return !!x;
        }
        return undefined;
    }

    function isType(x, type) {
        if (type === "boolean") {
            x = parseBool(x);
            return x === true || x === false;
        }
        if (type === "array") return Array.isArray(x);
        return x && typeof x === type;
    }

    const core = {
        VIEWER_SOURCES_ABS_ROOT: absPath + 'src/',
        ABS_MODULES: absPath + 'modules/',
        ABS_PLUGINS: absPath + 'plugins/',
        ABS_UI: absPath + 'ui/',

        //Relative Paths For the Viewer
        PROJECT_ROOT: projectRoot,
        PROJECT_SOURCES: projectRoot + 'src/',
        EXTERNAL_SOURCES: projectRoot + 'src/external/',
        UI_SOURCES: projectRoot + 'ui/',
        LIBS_ROOT: projectRoot + 'src/libs/',
        ASSETS_ROOT: projectRoot + 'src/assets/',
        LOCALES_ROOT: projectRoot + 'src/locales/',
        MODULES_FOLDER: projectRoot + 'modules/',
        PLUGINS_FOLDER: projectRoot + 'plugins/',

        ENV: {},
        CORE: {},
        MODULES: {},
        PLUGINS: {},
        UI: {},

        isType: isType,
        parseBool: parseBool,

        /**
         * Merge distinct values of objB to objA
         */
        objectMergeRecursiveDistinct: function (objA, objB) {
            let merged = objA;

            for (let key in objB) {
                const value = objB[key],
                    mergeTarget = merged[key];

                if (typeof value === "object" && value !== null && typeof mergeTarget === "object" && mergeTarget !== null) {
                    if (Array.isArray(merged[key])) {
                        merged[key] = value;
                    } else {
                        merged[key] = this.objectMergeRecursiveDistinct(mergeTarget, value);
                    }
                } else {
                    merged[key] = value;
                }
            }
            return merged;
        },

        exception: undefined,
        getError() {
            return this.exception;
        },

        /*
         * Printing Functions - dependencies from the config
         */

        printJs: function(conf, path) {
            if (isType(conf, "string")) return this.printJsSingle(conf, path);
            if (!isType(conf, "object")) return "";
            return Object.values(conf).map(files => this.printJsSingle(files, path)).join("");
        },

        printJsSingle: function(files, path) {
            const version = this.VERSION;

            if (Array.isArray(files)) {
                return files.map(file => file.endsWith(".mjs") ?
                    `    <script type="module" src="${path}${file}?v=${version}"></script>\n` :
                    `    <script src="${path}${file}?v=${version}"></script>\n`)
                    .join("");
            }
            return files.endsWith(".mjs") ?
                `    <script type="module" src="${path}${files}?v=${version}"></script>\n` :
                `    <script src="${path}${files}?v=${version}"></script>\n`;
        },

        printCss: function(conf, path) {
            if (isType(conf, "string")) return this.printCssSingle(conf, path);
            if (!isType(conf, "object")) return "";
            return Object.values(conf).map(files => this.printCssSingle(files, path)).join("");
        },

        printCssSingle: function(files, path) {
            const version = this.VERSION;

            if (Array.isArray(files)) {
                return files.map(file => `    <link rel="stylesheet" href="${path}${file}?v=${version}">\n`).join("");
            }
            return `    <link rel="stylesheet" href="${path}${files}?v=${version}">\n`;
        },

        requireOpenseadragon: function() {
            const version = this.VERSION;
            return `    <script src="${this.CORE["openSeadragonPrefix"]}${this.CORE["openSeadragon"]}?v=${version}"></script>\n`;
        },

        // Render the <title> + favicon <link>s from ENV core.setup.branding
        // (operator-controlled = trusted, per AGENTS.md §7). Values are still
        // HTML-escaped so a stray quote/angle bracket in config can't break the
        // head or inject markup. Anything unset falls back to the stock xOpat
        // assets, so existing deployments render identically without config.
        requireBrandingHead: function () {
            const b = (this.CORE && this.CORE["setup"] && this.CORE["setup"]["branding"]) || {};
            const escHtml = (s) => String(s)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");
            const val = (key, dflt) => (b[key] != null && b[key] !== "" ? b[key] : dflt);

            const title = escHtml(val("title", "Visualization"));
            const apple = escAttr(val("appleTouchIcon", "src/assets/apple-touch-icon.png"));
            const icon32 = escAttr(val("icon32", "src/assets/favicon-32x32.png"));
            const icon16 = escAttr(val("icon16", "src/assets/favicon-16x16.png"));
            const mask = escAttr(val("maskIcon", "src/assets/safari-pinned-tab.svg"));
            const maskColor = escAttr(val("maskIconColor", "#5bbad5"));

            return `    <title>${title}</title>
    <link rel="apple-touch-icon" sizes="180x180" href="${apple}">
    <link rel="icon" type="image/png" sizes="32x32" href="${icon32}">
    <link rel="icon" type="image/png" sizes="16x16" href="${icon16}">
    <link rel="mask-icon" href="${mask}" color="${maskColor}">
`;
        },

        requireLib: function (name) {
            return this._requireNested("libs", name, this.LIBS_ROOT);
        },

        requireLibs: function () {
            return this._require("libs", this.LIBS_ROOT);
        },

        requireExternal: function () {
            return this._require("external", this.EXTERNAL_SOURCES);
        },

        requireCore(type) {
            // In production, serve the whole core JS (loader + deps + app groups)
            // as one minified bundle (src/dist/xopat-core.min.js, produced by
            // buildCore). Emitted once, on the first core JS group requested;
            // per-group CSS is preserved. `env` (CSS) always goes per-file. Falls
            // back to per-file dev serving when the bundle isn't built.
            const production = parseBool(this.CORE?.client?.production) === true;
            if (production && (type === "loader" || type === "deps" || type === "app")
                && fileExists(this.VIEWER_SOURCES_ABS_ROOT + "dist/xopat-core.min.js")) {
                let result = "";
                if (this.CORE["css"] && this.CORE["css"]["src"] && this.CORE["css"]["src"][type] !== undefined) {
                    result += this.printCss(this.CORE["css"]["src"][type], this.PROJECT_SOURCES);
                }
                if (!this._coreBundleEmitted) {
                    this._coreBundleEmitted = true;
                    result += `    <script src="${this.PROJECT_SOURCES}dist/xopat-core.min.js?v=${this.VERSION}"></script>\n`;
                }
                return result;
            }
            return this._requireNested("src", type, this.PROJECT_SOURCES);
        },

        requireUI: function () {
            // In production, serve the prebuilt single UI bundle (ui/index.min.js,
            // produced by `grunt minify`), preserving any UI CSS. Falls back to
            // the ESM index.js in dev / when the min bundle isn't built.
            const production = parseBool(this.CORE?.client?.production) === true;
            if (production && fileExists(this.ABS_UI + "index.min.js")) {
                let result = "";
                if (this.CORE["css"] && this.CORE["css"]["ui"] !== undefined) {
                    result += this.printCss(this.CORE["css"]["ui"], this.UI_SOURCES);
                }
                result += `    <script src="${this.UI_SOURCES}index.min.js?v=${this.VERSION}"></script>\n`;
                return result;
            }
            return this._require("ui", this.UI_SOURCES);
        },

        _require: function (namespace, path) {
            let result = "";
            if (this.CORE["css"][namespace] !== undefined) {
                result += this.printCss(this.CORE["css"][namespace], path);
            }
            if (this.CORE["js"][namespace] !== undefined) {
                result += this.printJs(this.CORE["js"][namespace], path);
            }
            return result;
        },

        _requireNested: function (namespace, element, path) {
            let result = "";
            if (this.CORE["css"][namespace][element] !== undefined) {
                result += this.printCss(this.CORE["css"][namespace][element], path);
            }
            if (this.CORE["js"][namespace][element] !== undefined) {
                result += this.printJs(this.CORE["js"][namespace][element], path);
            }
            return result;
        }
    }

    /*
    * Parse CORE Env
    */

    // Supports bash-style default values:
    //   <% VAR %>            — empty string if unset
    //   <% VAR:-default %>   — default if unset OR empty (matches bash ${VAR:-...})
    //   <% VAR-default %>    — default only if unset (matches bash ${VAR-...})
    // The walker tracks JSON string + comment state so values substituted inside a
    // string literal are JSON-escaped (env values containing ", \, or control chars
    // can no longer break JSON structure or inject sibling keys).
    const envPlaceholderRegex = /<%\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*(:?-)\s*((?:(?!%>).)*?))?\s*%>/y;

    function resolveEnvPlaceholder(name, op, fallback) {
        const val = readEnv(name);
        const unset = val === false || val === undefined || val === null;
        const empty = val === "";
        let useDefault = false;
        if (op === ":-") useDefault = unset || empty;
        else if (op === "-") useDefault = unset;
        if (useDefault) return fallback !== undefined ? fallback : "";
        return unset ? "" : String(val);
    }

    function jsonEscapeStringContent(s) {
        const j = JSON.stringify(s);
        return j.slice(1, -1);
    }

    function parseEnvConfig(data, err) {
        try {
            let out = "";
            let i = 0;
            let inStr = false;
            let inLine = false;
            let inBlock = false;
            const len = data.length;

            const tryPlaceholder = () => {
                envPlaceholderRegex.lastIndex = i;
                const m = envPlaceholderRegex.exec(data);
                if (!m) return null;
                const value = resolveEnvPlaceholder(m[1], m[2], m[3]);
                return { value, length: m[0].length };
            };

            while (i < len) {
                const ch = data[i];
                const next = i + 1 < len ? data[i + 1] : "";

                if (inLine) {
                    out += ch;
                    if (ch === "\n") inLine = false;
                    i++;
                    continue;
                }
                if (inBlock) {
                    out += ch;
                    if (ch === "*" && next === "/") {
                        out += next;
                        inBlock = false;
                        i += 2;
                        continue;
                    }
                    i++;
                    continue;
                }
                if (inStr) {
                    if (ch === "\\" && i + 1 < len) {
                        out += ch + next;
                        i += 2;
                        continue;
                    }
                    if (ch === '"') {
                        out += ch;
                        inStr = false;
                        i++;
                        continue;
                    }
                    if (ch === "<" && next === "%") {
                        const p = tryPlaceholder();
                        if (p) {
                            out += jsonEscapeStringContent(p.value);
                            i += p.length;
                            continue;
                        }
                    }
                    out += ch;
                    i++;
                    continue;
                }

                if (ch === "/" && next === "/") {
                    out += "//";
                    inLine = true;
                    i += 2;
                    continue;
                }
                if (ch === "/" && next === "*") {
                    out += "/*";
                    inBlock = true;
                    i += 2;
                    continue;
                }
                if (ch === '"') {
                    out += ch;
                    inStr = true;
                    i++;
                    continue;
                }
                if (ch === "<" && next === "%") {
                    const p = tryPlaceholder();
                    if (p) {
                        out += p.value;
                        i += p.length;
                        continue;
                    }
                }
                out += ch;
                i++;
            }

            return parse(out);
        } catch (e) {
            throw err;
        }
    }

    let CORE, ENV = {};
    try {

        CORE = parse(readFile(core.VIEWER_SOURCES_ABS_ROOT + "config.json"));
        let envPath = readEnv('XOPAT_ENV');

        if (envPath && fileExists(envPath)) {
            ENV = parseEnvConfig(readFile(envPath),
                `File ${envPath} is not a valid ENV configuration!`);
        } else if (envPath && typeof envPath == "string") {
            ENV = parseEnvConfig(envPath,
                "Variable XOPAT_ENV is not a readable file or a valid ENV configuration!");
        } else if (fileExists(absPath + "env/env.json")) {
            ENV = parseEnvConfig(readFile(absPath + "env/env.json"),
                "Configuration 'env/env.json' contains a syntactic error!");
        }

        let envCore = ENV["core"];
        if (!isType(envCore, "object")) {
            ENV["core"] = {};
        }

        CORE = core.objectMergeRecursiveDistinct(CORE, ENV["core"]);

    } catch (e) {
        core.exception = e;
        console.error(e);  // todo better handling
        //core uses default values
    }

    let C = [];
    let client = CORE["active_client"];
    if (!client || !isType(CORE["client"][client], "object")) {
        for (let key in CORE["client"]) {
            let value = CORE["client"][key];
            if (!isType(value, "object")) continue;
            C = value; break;
        }
    } else {
        C = CORE["client"][client];
    }
    CORE["client"] = C;

    // Coerce the production flag to a strict boolean at the client-flatten
    // boundary, so every downstream check is correct even if it arrived as a
    // string (e.g. "false" from an env var, which is truthy in JS).
    if (C && typeof C === "object") {
        CORE["client"]["production"] = parseBool(CORE["client"]["production"]) === true;
    }

    /*
     * Auto detect path and domain if null
     */

    if (!isType(C["path"], "string")) {
        CORE["client"]["path"] = core.PROJECT_ROOT;
    }
    if (!isType(C["domain"], "string")) {
        //todo try deduction of the domain
        core.exception = "JavaScript cannot deduce the domain: configuration must specify the viewer domain and protocol!";
    }

    if (secure) {
        // Server-only backup of the secure block, preserved past the strip
        // so server-side filtering (plugins.js / modules.js) can read it.
        // MUST NEVER end up in any structure that is JSON.stringify'd into
        // the browser-bound page payload — mirror of PHP's $GLOBALS['CORE_SECURE'].
        core.CORE_SECURE = CORE.server.secure;
        // Security: strip server configuration secret from the CORE that
        // gets shipped to the client.
        delete CORE.server.secure;
    }

    // Author-tier server-only config: per-plugin / per-module `server.json`
    // contents (minus `requiredConfig`) are stashed here by the loaders so
    // `getSecurePluginConfig` can fall back on author-shipped defaults. Does
    // NOT count toward the `requiredConfig` gate — only deployer ENV +
    // deployer secure satisfy that. Same hygiene as CORE_SECURE: never ships
    // to the client.
    core.CORE_AUTHOR_SECURE = { plugins: {}, modules: {} };

    core.VERSION = CORE["version"] || defaults.version || "dev";
    core["version"] = CORE.VERSION;
    core.GATEWAY = CORE["gateway"];
    core.CORE = CORE;
    core.ENV = ENV;

    return core;
}
