const {parse} = require("comment-json");
const {execSync: exec} = require("child_process");
const path = require("path");
module.exports = function(grunt) {
    grunt.utils = grunt.utils || {};

    let root = grunt.option && grunt.option('root');
    if (!root) root = process.env.XO_REPO_ROOT;

    if (!root) {
        try {
            grunt.log.writeln('Detecting repository root using git: this might fail if using e.g. a docker - you might want to set XO_REPO_ROOT to the root of the repository manually...');
            root = exec('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
        } catch (error) {
            root = process.cwd();
            if (grunt && grunt.log && grunt.log.writeln) {
                grunt.log.writeln('Warning: Not a Git repository. Using "' + root + '" as project root.');
            }
        }
    }

    /**
     * Get absolute path from relative wrt repository root
     * @param relativePath
     * @return {string}
     */
    grunt.util.getPath = function (relativePath) {
        return path.resolve(root, relativePath);
    };

    /**
     * Execute command at given path
     * @param binPath working directory relative to repository root
     * @param cmd command
     * @param options command options in exec()
     * @return {string}
     */
    grunt.util.execAtPath = function (binPath, cmd, options=undefined) {
        options = options || {};
        options.stdio = "inherit";
        options.shell = process.platform === "win32"
        return exec(`${grunt.util.getPath(binPath)} ${cmd}`, options);
    };

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param log
     * @return {*}
     */
    grunt.util.reducePlugins = function (accumulator, initialValue, log=false) {
        return reduceFolder(accumulator, initialValue, "Plugin", "plugins", log);
    };

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param log
     * @return {*}
     */
    grunt.util.reduceModules = function (accumulator, initialValue, log=false) {
        return reduceFolder(accumulator, initialValue, "Module", "modules", log);
    };

    function reduceFolder(accumulator, initialValue, contextName, directoryName, log) {
        const directoryContents = grunt.file.expand({filter: "isDirectory", cwd: directoryName}, ["*"]);
        for (let item of directoryContents) {
            const itemDirectory = `${directoryName}/${item}`;
            const file = `${itemDirectory}/include.json`;

            let data = null;
            if (grunt.file.isFile(file)) {
                if (log) grunt.log.write(`${contextName} found: ${item}`);
                const content = grunt.file.read(file).toString().trim();
                data = parse(content);
            }

            let workspaceFile = `${itemDirectory}/package.json`;
            if (grunt.file.isFile(workspaceFile)) {
                const content = grunt.file.read(workspaceFile).toString().trim();
                const packageData = parse(content);

                if (!packageData["main"]) {
                    grunt.log.errorlns(`${contextName} ${item} has no main entry! package.json must define main file to compile!`);
                    data = null;
                } else {
                    data = data || {};
                    data["includes"] = data["includes"] || [];
                    data["includes"].unshift("index.workspace.js");

                    data["id"] = data["id"] || packageData["name"];
                    data["name"] = data["name"] || packageData["name"];
                    data["author"] = data["author"] || packageData["author"];
                    data["version"] = data["version"] || packageData["version"];
                    data["description"] = data["description"] || packageData["description"];

                    data["__workspace_item_entry__"] = `${itemDirectory}/${packageData["main"]}`;
                }
                if (log) grunt.log.write(`${data["id"] || packageData["name"] || contextName} is a workspace: ${workspaceFile}`);
            }

            if (data) {
                data["directory"] = itemDirectory;
                initialValue = accumulator(initialValue, data, item);
                if (log) grunt.log.write("\n");
            } else {
                if (log) grunt.log.write(`${contextName} shipped - invalid: ${item}\n`);
            }
        }
        return initialValue;
    }

    grunt.util.reduceUI = function (accumulator, initialValue, parseMeta=true, log=false) {
        const item = "ui/index.mjs";
        if (grunt.file.isFile(item)) {
            if (log) grunt.log.write(`UI found: ${item}`);
            initialValue = accumulator(initialValue, item, "ui");
            if (log) grunt.log.write("\n");
        } else {
            if (log) grunt.log.write(`UI invalid: missing ${item}\n`);
        }
        return initialValue;
    };
};
