const {parse} = require("comment-json")
const {loadModules} = require("./modules");
const {safeScanDir} = require("./utils");

module.exports.loadPlugins = function(core, fileExists, readFile, i18n) {

    if (!Object.keys(core.MODULES).length) {
        //require modules
        loadModules(
            core,
            fileExists,
            readFile,
            i18n
        );
    }

    const isType = core.isType;
    const PLUGINS = core.PLUGINS,
        MODULES = core.MODULES,
        ENV = core.ENV;

    let pluginPaths = safeScanDir(core.ABS_PLUGINS);
    for (let dir of pluginPaths) {
        if (dir == "." || dir == "..") continue;

        let fullPath = `${core.ABS_PLUGINS}${dir}/`;
        let pluginConfig = fullPath + "include.json";

        let data = null;

        try {
            if (fileExists(pluginConfig)) {
                data = parse(readFile(pluginConfig));
            }

            let workspace = fullPath + "package.json";
            if (fileExists(workspace)) {
                if (!fileExists(fullPath + "index.workspace.js")) {
                    console.warn(`Plugin ${fullPath} has package.json but no index.workspace.js! The plugin needs to be compiled first!`);
                }

                let packageData = parse(readFile(workspace));
                data = data || {};
                data["includes"] = data["includes"] || [];
                data["includes"].unshift("index.workspace.js");
                data["id"] = data["id"] || packageData["name"];
                data["name"] = data["name"] || packageData["name"];
                data["author"] = data["author"] || packageData["author"];
                data["version"] = data["version"] || packageData["version"];
                data["description"] = data["description"] || packageData["description"];
            }

            if (data) {
                if (!data["id"]) {
                    data["id"] = "__generated_id_" + dir;
                    data["error"] = `Plugin (dir ${dir}) removed: probably include.json misconfiguration.`;
                }

                data["directory"] = dir;
                data["path"] = `${core.PLUGINS_FOLDER}${dir}/`;
                data["loaded"] = false;

                if (fileExists(fullPath + "style.css")) {
                    data["styleSheet"] = data["path"] + "style.css";
                }
                data["modules"] = data["modules"] || [];

                for (let modId of data["modules"]) {
                    if (!MODULES[modId]) {
                        data["error"] = i18n.t('php.pluginUnknownDeps') + ": " + modId + ". Was it disabled?";
                    } else if (MODULES[modId].error) {
                        data["error"] = i18n.t('php.pluginInvalidDeps', {error: MODULES[modId].error});
                    }
                }

                try {
                    if (isType(ENV, "object")) {
                        if (!isType(ENV["plugins"], "object")) ENV["plugins"] = {};
                        const ENV_PLUG = ENV["plugins"];

                        if (isType(ENV_PLUG[data["id"]], "object")) {
                            data = core.objectMergeRecursiveDistinct(data, ENV_PLUG[data["id"]]);
                        }

                        if (core.parseBool(data["permaLoad"]) === true) {
                            data["loaded"] = true;
                        }
                    } else {
                        core.exception = "Env setup for plugin failed: invalid ENV! Was CORE included?";
                        console.error(core.exception);
                    }
                } catch (e) {
                    //todo php uses trigger_error, core could define function that remembers all issues
                    core.exception = e;
                    console.error(e);
                }

                if (core.parseBool(data["enabled"]) !== false) {
                    PLUGINS[data["id"]] = data;
                }
            }
        } catch (e) {
            PLUGINS[dir] = {
                "id": dir,
                "name": dir,
                "error": i18n.t('php.pluginInvalid', {error: typeof e === "string" ? e : e.message}),
                "author": "-",
                "version": "-",
                "icon": "",
                "includes": [],
                "modules": [],
            };
        }
    }

    for (let pid in PLUGINS) {
        const plugin = PLUGINS[pid];
        plugin.loaded &= !plugin.error;
        if (plugin.loaded) {
            for (let mid of plugin.modules) {
                const module = MODULES[mid];
                if (module) module.loaded = true;
            }
        }
    }

    /**
     * Load all plugins
     * @param {boolean} production if true, prefer minified file over sources
     */
    core.requirePlugins = function (production) {
        return Object.keys(PLUGINS).map(pid => {
            let plugin = PLUGINS[pid];
            if (core.parseBool(plugin["loaded"])) {
                return `<div id='script-section-${plugin["id"]}'>` +
                    core.printDependencies(core.PLUGINS_FOLDER, plugin, production)
                + "</div>";
            }
            return "";
        }).join("");
    }
}
