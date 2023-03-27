module.exports = function(grunt) {

    // Project configuration.
    // Todo implement uglification

    //conf: grunt.file.readJSON('src/config.json'), //needs to strip comments first
    //generate uglify task object based on paths from config, probably copy over
    //all files of the project, delete minified ones and replace with unminified,
    //override root as build?

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),


        // uglify: {
        //     core: {
        //         files: [
        //             {
        //                 expand: true,
        //                 cwd: 'root/src/ui/',
        //                 src: [
        //                     'src/*.js',
        //                     'src/external/*.js',
        //                     //skip minified
        //                     'src/external/!*.min.js',
        //                 ],
        //                 dest: 'build/',
        //                 rename: function (dest, src) {
        //                     return dest + src.substring(0, src.indexOf('/') + 1) + 'ui.min.js';
        //                 }
        //             }
        //         ]
        //     },
        //     coreDeps: {
        //         files: [
        //             {
        //                 expand: true,
        //                 cwd: 'root/src/ui/',
        //                 src: [
        //                     'src/*.js',
        //                     'src/external/*.js',
        //                     //skip minified
        //                     'src/external/!*.min.js',
        //                 ],
        //                 dest: 'build/',
        //                 rename: function (dest, src) {
        //                     return dest + src.substring(0, src.indexOf('/') + 1) + 'ui.min.js';
        //                 }
        //             }
        //         ]
        //     }
        // }

        // uglify: {
        //     options: {
        //         banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
        //     },
        //     build: {
        //         src: 'src/<%= pkg.name %>.js',
        //         dest: 'build/<%= pkg.name %>.min.js'
        //     }
        // }
    });

    grunt.registerTask('env', 'Create Env Files.', function() {
        grunt.log.write("Core configuration...\n");
        const {
            parse, //parse, also can keep comments
            stringify, //stringify, can re-add comments
            assign //can carry over comments
        } = require('comment-json')
        const output = [`
{
    /*********************************************************************************
     *        Core viewer configuration, defaults located at 'src/config.json'       *
     *              To build example configuration file, run 'grunt env'             *
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

    // Load the plugin that provides the "uglify" task.
    grunt.loadNpmTasks('grunt-contrib-uglify');

    // Default task(s).
    grunt.registerTask('default', ['env']);
};
