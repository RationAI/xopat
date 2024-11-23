const {parse} = require("comment-json");
const {execSync: exec} = require("child_process");
const path = require("path");
module.exports = function(grunt) {
    grunt.utils = grunt.utils || {};

    /**
     * Execute command at given path
     * @param binPath working directory relative to repository root
     * @param cmd command
     * @param options command options in exec()
     * @return {string}
     */
    grunt.util.execAtPath = function (binPath, cmd, options=undefined) {
        return exec(`${path.relative("", binPath)} ${cmd}`, options);
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
};
