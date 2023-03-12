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
        const output = [`
{
    /********************************************************************
     * Core viewer configuration, defaults located at 'src/config.json' *
     *******************************************************************/        
    "core": `];
        const core = grunt.file.read("src/config.json");
        output.push(core.toString().trim().replaceAll(/\n/g, '\n    '));
        grunt.log.write("Plugins configuration...\n");
        output.push(`,
    /*********************************************************************************
     * Plugins configuration, defaults located at 'plugins/[plugin_id]/include.json' *
     *********************************************************************************/ 
    "plugins": {
        `);
        const plugins = grunt.file.expand({filter: "isDirectory", cwd: "plugins"}, ["*"]);
        let pushed = false;
        for (let pluginFolder of plugins) {
            //todo remove all development configuration data
            const file = `plugins/${pluginFolder}/include.json`;

            if (grunt.file.isFile(file)) {
                pushed = true;
                const content = grunt.file.read(file).toString().trim();
                const data = JSON.parse(content), id = data.id;
                delete data.id;
                delete data.includes;
                delete data.requires;
                delete data.modules;
                delete data.version;
                delete data.author;
                delete data.icon;
                output.push('"', id, '": ', JSON.stringify(data, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            }
        }
        if (pushed) output.pop();
        grunt.log.write("Modules configuration...\n");
        output.push(`
    },
    /*********************************************************************************
     * Modules configuration, defaults located at 'modules/[module_id]/include.json' *
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
                const content = grunt.file.read(file).toString().trim();
                const data = JSON.parse(content), id = data.id;
                delete data.id;
                delete data.name;
                delete data.includes;
                delete data.requires;
                delete data.description;
                output.push('"', id, '": ', JSON.stringify(data, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            }
        }
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
