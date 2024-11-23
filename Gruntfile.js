module.exports = function (grunt) {
    // import utils first to initialize them
    require('./server/utils/grunt/utils')(grunt);

    // task to compile static server
    require("./server/static/build.grunt")(grunt);
    // utility tasks from separated files
    grunt.registerTask('env', 'Generate Env Configuration Example.',
        require('./server/utils/grunt/tasks/env')(grunt));
    grunt.registerTask('docs', 'Generate JSDoc documentation using theme configuration file',
        require('./server/utils/grunt/tasks/jsodc')(grunt));
    grunt.registerTask("generate", "Generate a plugin or module",
        require('./server/utils/grunt/tasks/generate-plugin-module')(grunt));

    // library tasks
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-contrib-watch");
    // grunt.loadNpmTasks("grunt-contrib-clean");

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

            ...grunt.util.reduceModules((acc, module, folder) => {
                //we cannot minify items that have third-party network deps, object describes source URL
                if (module.includes.some(i => typeof i === "object")) {
                    grunt.log.write(" (non-minifiable)");
                    return acc;
                }

                acc.modules.files[`modules/${folder}/index.min.js`] =
                    module.includes.map(i => `modules/${folder}/${i}`);
                return acc;
            }, uglification, true, true),

            ...grunt.util.reducePlugins((acc, plugin, folder) => {
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
    // Default task(s).
    grunt.registerTask('default', ['env']);
};
