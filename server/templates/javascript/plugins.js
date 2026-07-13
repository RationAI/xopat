const {parse} = require("comment-json")
const {loadModules} = require("./modules");
const {
    safeScanDir,
    expandIncludeGlobs,
    resolvePluginSelectionMode,
    requiredConfigSatisfied,
    buildProdIncludes
} = require("./utils");

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

    const pluginSelectionMode = resolvePluginSelectionMode(core);

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
                let packageData = parse(readFile(workspace));

                // Check for main if defaults are missing
                let workspaceEntry = "index.workspace.js";
                const hasDefaultJs = fileExists(fullPath + "index.workspace.js");
                const hasDefaultMjs = fileExists(fullPath + "index.workspace.mjs");

                if (!hasDefaultJs && !hasDefaultMjs && packageData["main"]) {
                    workspaceEntry = packageData["main"];
                } else if (hasDefaultMjs) {
                    workspaceEntry = "index.workspace.mjs";
                }

                if (!fileExists(fullPath + workspaceEntry)) {
                    console.warn(`Plugin ${fullPath} missing workspace entry: ${workspaceEntry}`);
                }

                data = data || {};
                data["includes"] = data["includes"] || [];
                // Dedup: an item may already list its own workspace entry in
                // include.json. Without this guard the entry is emitted twice →
                // the module script evaluates twice (e.g. double sink
                // registration). Mirrors the PHP loader's in_array check.
                if (!data["includes"].includes(workspaceEntry)) {
                    data["includes"].unshift(workspaceEntry);
                }
                data["includes"] = expandIncludeGlobs(fullPath, data["includes"]);

                // Map package metadata
                data["id"] = data["id"] || packageData["name"];
                data["name"] = data["name"] || packageData["name"];
                data["author"] = data["author"] || packageData["author"];
                data["version"] = data["version"] || packageData["version"];
                data["description"] = data["description"] || packageData["description"];
            }

            // Author server manifest (server.json) — optional. Its
            // `requiredConfig` is unioned into the gate paths; its remaining
            // fields become the author tier of secure config (visible to
            // plugin server code via XS.getSecurePluginConfig, NOT counted
            // toward the `requiredConfig` gate).
            const serverManifestPath = fullPath + "server.json";
            if (fileExists(serverManifestPath)) {
                const serverManifest = parse(readFile(serverManifestPath));
                if (serverManifest && typeof serverManifest === "object") {
                    data = data || {};
                    if (Array.isArray(serverManifest.requiredConfig)) {
                        const existing = Array.isArray(data.requiredConfig) ? data.requiredConfig : [];
                        data.requiredConfig = [...new Set([...existing, ...serverManifest.requiredConfig])];
                    }
                    const { requiredConfig: _drop, ...authorSecure } = serverManifest;
                    if (Object.keys(authorSecure).length && data.id) {
                        if (!core.CORE_AUTHOR_SECURE) core.CORE_AUTHOR_SECURE = { plugins: {}, modules: {} };
                        core.CORE_AUTHOR_SECURE.plugins[data.id] = authorSecure;
                    }
                }
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

                // Pre-merge captures: deployment-ENV plugin block AND
                // preserved server-secure plugin block. Include.json defaults
                // must NOT count toward `requiredConfig`. The secure block is
                // read from the pre-strip backup `core.CORE_SECURE` (set by
                // core.js); `core.CORE.server.secure` is already gone here.
                let envBlock = {};
                let secBlock = {};
                let envEnabledOptIn = false;
                try {
                    if (isType(ENV, "object")) {
                        if (!isType(ENV["plugins"], "object")) ENV["plugins"] = {};
                        const ENV_PLUG = ENV["plugins"];

                        if (isType(ENV_PLUG[data["id"]], "object")) {
                            envBlock = ENV_PLUG[data["id"]];
                            // Capture deployment-ENV opt-in BEFORE the merge clobbers the
                            // origin of `enabled`. Only used by "whitelist" mode.
                            if (envBlock.enabled === true) {
                                envEnabledOptIn = true;
                            }
                            data = core.objectMergeRecursiveDistinct(data, envBlock);
                        }

                        const securePlugins = core?.CORE_SECURE?.plugins;
                        if (securePlugins && isType(securePlugins[data["id"]], "object")) {
                            secBlock = securePlugins[data["id"]];
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

                let shouldInclude = false;
                const enabledNotFalse = core.parseBool(data["enabled"]) !== false;
                switch (pluginSelectionMode) {
                    case "whitelist":
                        // Inverse default: nothing ships unless deployment ENV opted in.
                        // No secure-side fallback for the opt-in flag (deliberate).
                        shouldInclude = envEnabledOptIn && enabledNotFalse;
                        break;
                    case "available":
                        // Unified `requiredConfig` gate: each path must
                        // resolve in EITHER the ENV block OR the
                        // server-secure block.
                        shouldInclude = enabledNotFalse
                            && requiredConfigSatisfied(data["requiredConfig"], envBlock, secBlock);
                        break;
                    case "all":
                    default:
                        shouldInclude = enabledNotFalse;
                        break;
                }

                if (shouldInclude) {
                    // Precompute the production single-file overlay (leaves
                    // `includes` canonical); see buildProdIncludes.
                    buildProdIncludes(fullPath, data, core.parseBool(core.CORE?.client?.production) === true, fileExists);
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
