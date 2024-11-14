const { parse, stringify } = require("comment-json");
const { execSync: exec } = require("child_process");
const path = require("path");
//if command contains path to the bin file
const execAtPath = (binPath, cmd, options = undefined) => {
    return exec(`${path.relative("", binPath)} ${cmd}`, options);
};
const { registerStaticServerTask } = require("./server/static/build.grunt");

module.exports = function (grunt) {
    // Project configuration.

    //todo more fancy way of doing this?
    registerStaticServerTask(grunt);

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-contrib-watch");
    // grunt.loadNpmTasks("grunt-contrib-clean");
    // grunt.loadNpmTasks('grunt-jsdoc');

    const uglification = {
        options: {
            sourceMap: true,
            beautify: false,
            banner: '/*! <%= pkg.name %> - v<%= pkg.version %> - ' +
                '<%= grunt.template.today("yyyy-mm-dd") %> */'
        },
        plugins: {
            files: {},
        },
        modules: {
            files: {},
        }
    };

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        connect: {
            server: {
                options: {
                    port: 9000,
                    base: "."
                }
            }
        },
        watch: {
            files: ["ui/*"],
            tasks: "watchTask"
        },
        uglify: {

            ...reduceModules((acc, module, folder) => {
                //we cannot minify items that have third-party network deps, object describes source URL
                if (module.includes.some(i => typeof i === "object")) {
                    grunt.log.write(" (non-minifiable)");
                    return acc;
                }

                acc.modules.files[`modules/${folder}/index.min.js`] =
                    module.includes.map(i => `modules/${folder}/${i}`);
                return acc;
            }, uglification, true, true),

            ...reducePlugins((acc, plugin, folder) => {
                //we cannot minify items that have third-party network deps, object describes source URL
                if (plugin.includes.some(i => typeof i === "object")) {
                    grunt.log.write(" (non-minifiable)");
                    return acc;
                }

                acc.plugins.files[`plugins/${folder}/index.min.js`] =
                    plugin.includes.map(i => `plugins/${folder}/${i}`);
                return acc;
            }, uglification, true, true),

        }
    });

    grunt.registerTask('default', []);
    grunt.registerTask('all', ["uglify"]);
    grunt.registerTask('plugins', ["uglify:plugins"]);
    grunt.registerTask('modules', ["uglify:modules"]);

    grunt.registerTask('docs', 'Generate JSDoc documentation using theme configuration file', function (file) {
        const config = require(file || './docs/openseadragon.conf');
        grunt.file.write('./docs/build/docs.conf.json', JSON.stringify(config));
        grunt.file.copy('./docs/assets/xopat-banner.png', './docs/build/docs/assets/xopat-banner.png');
        const result = execAtPath('./node_modules/.bin/jsdoc', '-c ./docs/build/docs.conf.json --verbose');
        grunt.log.writeln(result);
    });

    grunt.registerTask('env', 'Generate Env Configuration Example.', function () {
        let shortReport = grunt.option('minimal');
        const fullReport = !(shortReport);

        grunt.log.write("Core configuration...\n");
        const output = [`
{
    /*********************************************************************************
     *        Core viewer configuration, defaults located at 'src/config.json'       *
     *                                                                               *
     *              To build example configuration file, run 'grunt env'             *
     *        Values unchanged are better to left commented/removed (=defaults)      *
     *           Configuration is written in JSON with comments (JS style)           *
     ********************************************************************************/        
    "core": 
    `];
        const core = grunt.file.read("src/config.json");
        const coreData = parse(core);
        delete coreData.version;
        if (!fullReport) {
            delete coreData.monaco;
            delete coreData.openSeadragonPrefix;
            delete coreData.openSeadragon;
            delete coreData.js;
            delete coreData.css;
        }
        output.push(stringify(coreData, null, '\t').replaceAll(/\n/g, '\n    '));
        grunt.log.write("Plugins configuration...\n");
        output.push(`,
    /*********************************************************************************
     * Plugins configuration, defaults located at 'plugins/[directory]/include.json' *
     *              To build example configuration file, run 'grunt env'             *
     *           Configuration is written in JSON with comments (JS style)           *
     ********************************************************************************/ 
    "plugins": {
        `);
        let pushed = reducePlugins((acc, plugin) => {
            let id = plugin.id;
            delete plugin.id;
            delete plugin.includes;
            delete plugin.requires;
            delete plugin.modules;
            delete plugin.version;
            delete plugin.author;
            delete plugin.icon;
            if (fullReport) {
                if (plugin.enabled === undefined) plugin.enabled = true;
            } else {
                delete plugin.name;
                delete plugin.description;
                delete plugin.permaLoad;
            }
            output.push('"', id, '": ', stringify(plugin, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            return true; //at least one plugin was parsed
        }, false, true);
        grunt.log.write("\n");
        if (pushed) output.pop();
        grunt.log.write("Modules configuration...\n");
        output.push(`
    },
    /*********************************************************************************
     * Modules configuration, defaults located at 'modules/[directory]/include.json' *
     *              To build example configuration file, run 'grunt env'             *
     *           Configuration is written in JSON with comments (JS style)           *    
     ********************************************************************************/ 
    "modules": {
        `);
        pushed = reduceModules((acc, module) => {
            let id = module.id;
            delete module.id;
            delete module.name;
            delete module.includes;
            delete module.version;
            delete module.requires;
            delete module.description;
            if (fullReport) {
                if (module.enabled === undefined) module.enabled = true;
            } else {
                if (Object.values(module).length < 1) return false;
            }
            output.push('"', id, '": ', stringify(module, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            return true; //at least one module was parsed
        }, false, true);
        grunt.log.write("\n");
        if (pushed) output.pop();
        output.push(`
    }
}`);
        grunt.file.write("env/env.example.json", output.join(""));
        grunt.log.write("Saved: " + (fullReport ? 'full configuration' : 'minimal configuration') + " in 'env/env.example.json'.\n");
    });

    // Default task(s).
    grunt.registerTask('default', ['env']);

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param parseMeta
     * @param log
     * @return {*}
     */
    function reducePlugins(accumulator, initialValue, parseMeta = true, log = false) {
        return reduceFolder(accumulator, initialValue, parseMeta, "Plugin", "plugins", log);
    }

    /**
     *
     * @param accumulator function, accepts (accumulator, newValue, folderName)
     * @param initialValue
     * @param parseMeta
     * @param log
     * @return {*}
     */
    function reduceModules(accumulator, initialValue, parseMeta = true, log = false) {
        return reduceFolder(accumulator, initialValue, parseMeta, "Module", "modules", log);
    }

    function reduceFolder(accumulator, initialValue, parseMeta, contextName, directoryName, log) {
        const itemDirectory = grunt.file.expand({ filter: "isDirectory", cwd: directoryName }, ["*"]);
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
