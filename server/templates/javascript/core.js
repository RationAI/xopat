const {parse} = require("comment-json");

module.exports.getCore = function(absPath, projectRoot, fileExists, readFile, readEnv) {

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

        //Relative Paths For the Viewer
        PROJECT_ROOT: projectRoot,
        PROJECT_SOURCES: projectRoot + 'src/',
        EXTERNAL_SOURCES: projectRoot + 'src/external/',
        LIBS_ROOT: projectRoot + 'src/libs/',
        ASSETS_ROOT: projectRoot + 'src/assets/',
        LOCALES_ROOT: projectRoot + 'src/locales/',
        MODULES_FOLDER: projectRoot + 'modules/',
        PLUGINS_FOLDER: projectRoot + 'plugins/',

        ENV: {},
        CORE: {},
        MODULES: {},
        PLUGINS: {},

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
                return files.map(file => `    <script src="${path}${file}?v=${version}"></script>\n`).join("");
            }
            return `    <script src="${path}${files}?v=${version}"></script>\n`;
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
            return this._requireNested("src", type, this.PROJECT_SOURCES);
        },

        _require: function(namespace, path) {
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

    const envRegex = /<%\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*%>/;

    function parseEnvConfig(data, err) {
        try {
            let replacer = function(match, p1) {
                let env = readEnv(p1);
                //not specified returns false
                //todo correct?
                return env === false ? "" : env;
            };

            const result = data.replace(envRegex, replacer);

            return parse(result);
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

    core.VERSION = CORE["version"];
    core.GATEWAY = CORE["gateway"];
    core.CORE = CORE;
    core.ENV = ENV;

    return core;
}
