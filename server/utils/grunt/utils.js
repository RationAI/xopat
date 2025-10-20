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
        return exec(`${grunt.util.getPath(binPath)} ${cmd}`, options);
    };

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param parseMeta
     * @param log
     * @return {*}
     */
    grunt.util.reducePlugins = function (accumulator, initialValue, parseMeta=true, log=false) {
        return reduceFolder(accumulator, initialValue, parseMeta, "Plugin", "plugins", log);
    };

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param parseMeta
     * @param log
     * @return {*}
     */
    grunt.util.reduceModules = function (accumulator, initialValue, parseMeta=true, log=false) {
        return reduceFolder(accumulator, initialValue, parseMeta, "Module", "modules", log);
    };

    function reduceFolder(accumulator, initialValue, parseMeta, contextName, directoryName, log) {
        const itemDirectory = grunt.file.expand({filter: "isDirectory", cwd: directoryName}, ["*"]);
        for (let item of itemDirectory) {
            const file = `${directoryName}/${item}/include.json`;

            if (grunt.file.isFile(file)) {
                if (log) grunt.log.write(`${contextName} found: ${item}`);
                const content = grunt.file.read(file).toString().trim();
                const data = parseMeta ? parse(content) : content;
                initialValue = accumulator(initialValue, data, item);
                if (log) grunt.log.write("\n");
            } else {
                if (log) grunt.log.write(`${contextName} shipped - invalid: ${item}\n`);
            }
        }
        return initialValue;
    }

    grunt.util.reduceUI = function (accumulator, initialValue, parseMeta=true, log=false) {
        item = "ui/index.js"
        if (log) grunt.log.write(`UI found: ${item}`);
        initialValue=accumulator(initialValue, item, item);
        if (log) grunt.log.write("\n");

        return initialValue;
    };
};
