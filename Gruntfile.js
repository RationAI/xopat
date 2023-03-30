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

    grunt.registerTask('docs', 'Generate CLEAN theme API Documentation', function (file) {
        const config = require(file || './docs/openseadragon.conf');
        grunt.file.write('./docs/build/docs.conf.json', JSON.stringify(config));
        grunt.file.copy('./docs/assets/xopat-banner.png', './docs/build/docs/assets/xopat-banner.png')
        const result = execAtPath('./node_modules/.bin/jsdoc', '-c ./docs/build/docs.conf.json');
        grunt.log.writeln(result);
    });

    // grunt.registerTask('docs-clean', 'Generate CLEAN theme API Documentation', function () {
    //     const file = 'jsdoc-clean.config.js';
    //     grunt.log.write(`Using theme ${file}...\n`);
    //     const exec = require('child_process').execSync;
    //     const result = exec(`jsdoc --configure ${file} --verbose`, { encoding: 'utf8' });
    //     grunt.log.writeln(result);
    // });
    //
    // grunt.registerTask('docs-ink', 'Generate INK theme API Documentation', function () {
    //     let fileName = 'jsdoc-ink.config';
    //     const conf = require(`./${fileName}`);
    //     const file = fileName + '.json';
    //     grunt.file.write('./docs-ink/' + file, JSON.stringify(conf));
    //     grunt.log.write(`Using theme ${file}...\n`);
    //     const result = exec(`jsdoc -c ./docs-ink/${file} -t ./node_modules/ink-docstrap/template -R README.md -r --verbose`, { encoding: 'utf8' });
    //     grunt.log.writeln(result);
    // });

    // grunt.registerTask('docs', 'Generate API Documentation', function (file) {
    //     if (arguments.length === 0) {
    //         file = 'jsdoc-clean.config.js';
    //         grunt.log.write(`Generating docs with the default clean theme configuration ${file}...\n`);
    //     } else {
    //         if (grunt.file.exists(file)) {
    //             grunt.log.write(`Generating docs with custom configuration ${file}...\n`);
    //         } else {
    //             grunt.log.write(`Using theme ${file}...\n`);
    //             switch (file) {
    //                 case 'clean': file='jsdoc-clean.config.js';break;
    //                 case 'ink': file='jsdoc-ink.config.js';break;
    //                 default: throw `Invalid theme '${file}': use one of supported aliases or a path to the configuration file!`;
    //             }
    //         }
    //     }
    //
    //     var exec = require('child_process').execSync;
    //     var result = exec(`jsdoc --configure ${file} --verbose`, { encoding: 'utf8' });
    //     grunt.log.writeln(result);
    // });

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
            //todo remove all development configuration data
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
            //todo remove all development configuration data
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
