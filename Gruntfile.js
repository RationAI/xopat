const {parse} = require("comment-json");
const {execSync: exec} = require("child_process");
const path = require("path");
//if command contains path to the bin file
const execAtPath = (binPath, cmd, options=undefined) => {
    return exec(`${path.relative("", binPath)} ${cmd}`, options);
};
module.exports = function(grunt) {
    // Project configuration.

    //grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-contrib-watch");
    // grunt.loadNpmTasks("grunt-contrib-clean");
    // grunt.loadNpmTasks('grunt-jsdoc');
    // const files = require('./docs/include');

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        // Todo implement uglification

        connect: {
            server: {
                options: {
                    port: 9000,
                    base: 'docs/build/'
                }
            }
        },
        watch: {
            files: [],
            tasks: ["docs"]
        },
    });

    grunt.registerTask('docs', 'Generate JSDoc documentation using theme configuration file', function (file) {
        const config = require(file || './docs/openseadragon.conf');
        grunt.file.write('./docs/build/docs.conf.json', JSON.stringify(config));
        grunt.file.copy('./docs/assets/xopat-banner.png', './docs/build/docs/assets/xopat-banner.png');
        const result = execAtPath('./node_modules/.bin/jsdoc', '-c ./docs/build/docs.conf.json --verbose');
        grunt.log.writeln(result);
    });

    grunt.registerTask('env', 'Generate Env Configuration Example.', function() {
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
    "core": `];
        const core = grunt.file.read("src/config.json");
        delete core.version;
        output.push(core.toString().trim().replaceAll(/\n/g, '\n    '));
        grunt.log.write("Plugins configuration...\n");
        output.push(`,
    /*********************************************************************************
     * Plugins configuration, defaults located at 'plugins/[directory]/include.json' *
     *              To build example configuration file, run 'grunt env'             *
     *           Configuration is written in JSON with comments (JS style)           *
     ********************************************************************************/ 
    "plugins": {
        `);
        const plugins = grunt.file.expand({filter: "isDirectory", cwd: "plugins"}, ["*"]);
        let pushed = false;
        for (let pluginFolder of plugins) {
            const file = `plugins/${pluginFolder}/include.json`;
            grunt.log.write(pluginFolder+"/include.json  ");

            if (grunt.file.isFile(file)) {
                pushed = true;
                const content = grunt.file.read(file).toString().trim();
                const data = parse(content), id = data.id;
                delete data.id;
                delete data.includes;
                delete data.requires;
                delete data.modules;
                delete data.version;
                delete data.author;
                delete data.icon;
                output.push('"', id, '": ', stringify(data, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            }
        }
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
        const modules = grunt.file.expand({filter: "isDirectory", cwd: "modules"}, ["*"]);
        pushed = false;
        for (let moduleFolder of modules) {
            const file = `modules/${moduleFolder}/include.json`;
            if (grunt.file.isFile(file)) {
                pushed = true;
                grunt.log.write(moduleFolder+"/include.json  ");
                const content = grunt.file.read(file).toString().trim();
                const data = parse(content), id = data.id;
                delete data.id;
                delete data.name;
                delete data.includes;
                delete data.requires;
                delete data.description;
                output.push('"', id, '": ', stringify(data, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            }
        }
        grunt.log.write("\n");
        if (pushed) output.pop();
        output.push(`
    }
}`);
        grunt.file.write("env/env.example.json", output.join(""));
        grunt.log.write("Saved.\n");
    });

    // Default task(s).
    grunt.registerTask('default', ['env']);
};
