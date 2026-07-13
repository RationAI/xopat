const {parse} = require("comment-json");
const {
    safeScanDir,
    expandIncludeGlobs,
    resolvePluginSelectionMode,
    requiredConfigSatisfied,
    buildProdIncludes
} = require("./utils");

module.exports.loadModules = function(core, fileExists, readFile, i18n) {

    const isType = core.isType;
    const MODULES = core.MODULES,
        ENV = core.ENV;

    // Modules only participate in the "available" config-gate. The "whitelist"
    // mode is a plugin concept (modules are infrastructure dependencies pulled
    // in by plugins; dropping a required module surfaces as a plugin-level
    // missing-dep error via the existing dependency check).
    const pluginSelectionMode = resolvePluginSelectionMode(core);

    let modulePaths = safeScanDir(core.ABS_MODULES);

    for (let dir of modulePaths) {
        if (dir == "." || dir == "..") continue;

        let fullPath = `${core.ABS_MODULES}${dir}/`;
        let modConfig = fullPath + "include.json";

        let data = null;

        try {
            if (fileExists(modConfig)) {
                data = parse(readFile(modConfig));
            }

            let workspace = fullPath + "package.json";
            if (fileExists(workspace)) {
                let packageData = parse(readFile(workspace));

                let workspaceEntry = "index.workspace.js";
                let hasDefaultJs = fileExists(fullPath + "index.workspace.js");
                let hasDefaultMjs = fileExists(fullPath + "index.workspace.mjs");

                if (!hasDefaultJs && !hasDefaultMjs && packageData["main"]) {
                    workspaceEntry = packageData["main"];
                } else if (hasDefaultMjs && !hasDefaultJs) {
                    workspaceEntry = "index.workspace.mjs";
                }

                // 2. Validate that the file actually exists
                if (!fileExists(fullPath + workspaceEntry)) {
                    console.warn(`Module ${fullPath} defines workspace but ${workspaceEntry} is missing! Compile it first.`);
                }

                data = data || {};
                data["includes"] = data["includes"] || [];
                data["includes"].unshift(workspaceEntry);
                data["includes"] = expandIncludeGlobs(fullPath, data["includes"]);

                data["id"] = data["id"] || packageData["name"];
                data["name"] = data["name"] || packageData["description"];
                data["author"] = data["author"] || packageData["author"];
                data["version"] = data["version"] || packageData["version"];
                data["description"] = data["description"] || packageData["description"];
            }

            // Author server manifest (server.json) — see plugins.js for
            // semantics. Mirrors `requiredConfig` hoist + author-secure stash
            // for modules.
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
                        core.CORE_AUTHOR_SECURE.modules[data.id] = authorSecure;
                    }
                }
            }

            if (data) {
                data["directory"] = dir;
                data["path"] = `${core.MODULES_FOLDER}${dir}/`;
                data["loaded"] = false;
                data["requires"] = data["requires"] || [];

                if (fileExists(fullPath + "style.css")) {
                    data["styleSheet"] = data["path"] + "style.css";
                }

                // Pre-merge ENV + preserved server-secure module blocks feed
                // the "available" gate. The secure block is read from the
                // pre-strip backup `core.CORE_SECURE` (set by core.js).
                let envBlock = {};
                let secBlock = {};
                try {
                    if (isType(ENV, "object")) {
                        if (!isType(ENV["modules"], "object")) ENV["modules"] = {};
                        const ENV_MOD = ENV["modules"];

                        if (isType(ENV_MOD[data["id"]], "object")) {
                            envBlock = ENV_MOD[data["id"]];
                            data = core.objectMergeRecursiveDistinct(data, envBlock);
                        }

                        const secureModules = core?.CORE_SECURE?.modules;
                        if (secureModules && isType(secureModules[data["id"]], "object")) {
                            secBlock = secureModules[data["id"]];
                        }

                        if (core.parseBool(data["permaLoad"]) === true) {
                            data["loaded"] = true;
                        }
                    } else {
                        core.exception = "Env setup for module failed: invalid ENV! Was CORE included?";
                        console.error(core.exception);
                    }
                } catch (e) {
                    //todo php uses trigger_error, core could define function that remembers all issues
                    core.exception = e;
                    console.error(e);
                }

                const enabledNotFalse = core.parseBool(data["enabled"]) !== false;
                const configSatisfied = pluginSelectionMode !== "available"
                    || requiredConfigSatisfied(data["requiredConfig"], envBlock, secBlock);
                if (enabledNotFalse && configSatisfied) {
                    // Precompute the production single-file overlay (leaves
                    // `includes` canonical); consumed by printDependencies and
                    // the client dynamic loader alike.
                    buildProdIncludes(fullPath, data, core.parseBool(core.CORE?.client?.production) === true, fileExists);
                    MODULES[data["id"]] = data;
                }
            }
        } catch (e) {
            // todo only log error, do not shut down everything
            core.exception = `Module ${fullPath} has invalid configuration file and cannot be loaded!`;
            console.error(core.exception, e);
        }
    }

    let order = 0;

    //DFS assigns smaller numbers to children -> loaded earlier
    function scanDependencies(itemList, id, contextName) {
        let item = itemList[id];
        if (Number.isInteger(item["_xoi"])) return item["_xoi"] > 0;
        item["_xoi"] = -1;

        let valid = true;
        for (let dependency of item["requires"]) {
            let dep = itemList[dependency];
            if (!dep) {
                item["error"] = i18n.t('php.invalidDeps', {context: contextName, dependency: dependency});
                return false;
            }

            if (dep["error"]) {
                item["error"] = i18n.t('php.transitiveInvalidDeps',
                    {context: contextName, dependency: dependency, transitive: dependency});
                return false;
            }

            if (!dep["_xoi"]) {
                valid &= scanDependencies(itemList, dependency, contextName);
            } else if (dep["_xoi"] === -1) {
                item["error"] = i18n.t('php.cyclicDeps', {context: contextName, dependency: dependency});
                return false;
            }
        }
        item["_xoi"] = order++;

        if (!valid) {
            item["error"] = i18n.t('php.removedInvalidDeps', {dependencies: item["requires"].join(", ")});
        }
        return valid;
    }

    /**
     * Load all modules
     * @param {boolean} production if true, prefer minified file over sources
     */
    core.requireModules = function (production) {
        core.resolveDependencies(core._MODULE_ORDER, core.MODULES);
        return core._MODULE_ORDER.map(mid => {
            let module = core.MODULES[mid];
            if (core.parseBool(module["loaded"])) {
                return core.printDependencies(core.MODULES_FOLDER, module, production);
            }
            return "";
        }).join("");
    }

    /**
     * Go in ascending order by sorted list itemKeyOrder (which was prepared by the framework)
     *
     * make sure all modules required by other modules are loaded, goes in acyclic deps list - everything gets loaded
     * PHP can have sorted named arrays, here we pass for example resolveDependencies(_MODULES_ORDER and MODULES)
     * @param itemKeyOrder
     * @param objectList
     */
    core.resolveDependencies = function (itemKeyOrder, objectList) {
        //has to be in reverse order! (avoid param modification)
        itemKeyOrder = [...itemKeyOrder].reverse();
        for (let modId of itemKeyOrder) {
            const mod = objectList[modId];
            if (mod["loaded"]) {
                for (let requirement of mod["requires"]) {
                    if (objectList[requirement]) {
                        objectList[requirement]["loaded"] = true;
                    }
                    // todo if error then support bubbling up & invalidation (maybe it happens in later stage)
                }
            }
        }
    }

    function getAttributes(source, properties) {
        let html = "";
        for (let property in properties) {
            let propScriptName = properties[property];
            let sourceValue = source[property];
            if (sourceValue) {
                html += ` ${propScriptName}="${sourceValue}"`;
                if (property === "src" && sourceValue && sourceValue.endsWith(".mjs")) {
                    html += " type='module'";
                }
            }
        }
        return html;
    }

    /**
     * Print module or plugin dependency based on its parsed configuration
     * @param directory string parent context directory full path, ending with slash
     * @param item object item to load
     * @param {boolean} production if true, prefer minified file over sources
     */
    core.printDependencies = function (directory, item, production) {
        const version = core.VERSION;
        //add module style sheet if exists
        let result = "";
        if (item["styleSheet"]) {
            result = `<link rel="stylesheet" href="${item["styleSheet"]}?v=${version}" type='text/css'>\n`;
        }

        // In production the item may carry a precomputed `prodIncludes` overlay
        // (foldable files collapsed into index.min.js / index.workspace.min.js,
        // non-foldable entries kept in place). Fall back to the canonical
        // `includes` in dev or when no min artifact exists. See buildProdIncludes.
        const includesList = ((core.parseBool(production) === true) && Array.isArray(item["prodIncludes"]))
            ? item["prodIncludes"] : item["includes"];

        for (let file of includesList) {
            if (isType(file, "string")) {
                result += file.endsWith(".mjs") ?
                    `    <script src="${directory}${item["directory"]}/${file}?v=${version}" type="module"></script>\n` :
                    `    <script src="${directory}${item["directory"]}/${file}?v=${version}"></script>\n`;
            } else if (isType(file, "object")) {
                if (!/^https?:\/\//.test(file.src)) {
                    // normalize relative paths
                    if (file.src.startsWith('.')) {
                        file.src = file.src.substring(1);
                    }
                    if (file.src.startsWith("/")) {
                        file.src = file.src.substring(1);
                    }
                    if (file.src.endsWith(".mjs")) {
                        file.type = "module";
                    }
                    file.src = `${directory}${item["directory"]}/${file.src}?v=${version}`;
                }

                result += `    <script ${getAttributes(file, {
                    async: 'async', crossOrigin: 'crossorigin', type: 'type',
                    defer: 'defer', integrity: 'integrity', referrerPolicy: 'referrerpolicy', src: 'src'
                })}></script>\n`;
            } else {
                result += `    <script>console.warn('Invalid include:', '${item["id"]}', '${file}');</script>\n`;
            }
        }

        // todo consider testing name pattern and pre-loading workers and wasm
        //   or in general support preloading on assets (needs to be implemented in loader.js too!)
        // <link rel="modulepreload" href="/x.worker.mjs">
        // <link rel="modulepreload" href="/x_wasm.mjs">
        // <link rel="preload" href="/x_wasm.wasm" as="fetch" type="application/wasm" crossorigin>
        return result;
    }

    //resolve dependencies
    for (let id in MODULES) {
        let mod = MODULES[id];
        //scan only if priority not set (not visited yet)

        if (mod["_xoi"] === undefined) {
            scanDependencies(MODULES, id, 'modules');
        }
    }

    let moduleList = Object.values(MODULES);
    //ascending
    moduleList.sort((a, b) => a["_priority"] - b["_priority"]);
    core._MODULE_ORDER = moduleList.map(mod => mod.id);
}
