const {execSync: exec} = require("child_process");
const esbuildArgs = require("./server/utils/esbuild-args");
module.exports = function(grunt) {
    // import utils first to initialize them
    require('./server/utils/grunt/utils')(grunt);

    // task to compile static server
    require("./server/static/build.grunt")(grunt);
    // utility tasks from separated files
    grunt.registerTask('env',
        'Generate Env Configuration Example.',
        require('./server/utils/grunt/tasks/env')(grunt)
    );
    grunt.registerTask('jsdoc', '' +
        'Generate JSDoc documentation using theme configuration file',
        require('./server/utils/grunt/tasks/jsodc')(grunt)
    );
    grunt.registerTask("generate",
        "Generate a plugin or module",
        require('./server/utils/grunt/tasks/generate-plugin-module')(grunt)
    );
    grunt.registerTask("twinc",
        'Tailwind incremental build/watch by parts.',
        require('./server/utils/grunt/tasks/realtime-compile')(grunt)
    );

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
        },
        ui: {
            files: {},
        }
    };

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        connect: {
            server: {
                options: {
                    port: 9000,
                    base: '.',
                    open: {
                        target: 'http://localhost:9000/ui/test_ui.html'
                    }
                }
            }
        },
        watch: {
            options: {
                livereload: true
            },
            CSS: {
                files: ["ui/*", "ui/components/*", "./tailwind.config.js", "Gruntfile.js", "src/assets/custom.css"],
                tasks: "css"
            },
            buildUI: {
                files: ["ui/*.mjs", "ui/components/*.mjs"],
                task: "buildUI"
            }
        },
        uglify: {
            ...grunt.util.reduceModules( (acc, module, folder) => {
                //we cannot minify items that have third-party network deps, object describes source URL
                if (module.includes.some(i => typeof i === "object")) {
                    grunt.log.write(" (non-minifiable)");
                    return acc;
                }

                acc.modules.files[`modules/${folder}/index.min.js`] =
                    module.includes.map(i => `modules/${folder}/${i}`);
                if (module.__workspace_item_entry__) {
                    const mainFile = module.__workspace_item_entry__;
                    exec(`npx esbuild ${esbuildArgs.join(" ")} --outfile=modules/${folder}/index.workspace.js ${mainFile}`);
                    acc.modules.files[`modules/${folder}/index.min.js`].unshift(`modules/${folder}/index.workspace.js`);
                }
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
                if (plugin.__workspace_item_entry__) {
                    const mainFile = plugin.__workspace_item_entry__;
                    exec(`npx esbuild ${esbuildArgs.join(" ")} --outfile=plugins/${folder}/index.workspace.js ${mainFile}`);
                    acc.plugins.files[`plugins/${folder}/index.min.js`].unshift(`plugins/${folder}/index.workspace.js`);
                }
                return acc;
            }, uglification, true, true),

            ...grunt.util.reduceUI((acc, ui, folder) => {
                exec("npx esbuild --bundle --sourcemap --format=esm --outfile=ui/index.js ui/index.mjs");
                acc.ui.files[`ui/index.min.js`] = ["ui/index.js"];
                return acc;
            }, uglification, true, true),
        },
        // Custom twinc task
        twinc: {
            inputCSS:   './src/assets/tailwind-spec.css',
            configFile: './tailwind.config.js',
            outFile:    './src/libs/tailwind.min.css',   // single output
            cacheDir:   './.dev-cache',
            watch: [
                'ui/**/*.{html,js,mjs}',
                'modules/**/*.{html,js,mjs}',
                'plugins/**/*.{html,js}',
                'src/**/*.{html,js}'
            ],
            ignore: [
                'ui/index.js',
                'src/libs/**',
                '.dev-cache/**',
                '**/*.min.js',
                '**/*.workspace.js',
                '**/*.workspace.js.map'
            ],
            minify: true,
            debounceMs: 150,
            // usePolling: true, interval: 250, // if needed on WSL/Docker/UNC
        },
    });

    grunt.registerTask('default', []);
    grunt.registerTask('build', ["uglify"]);  // for now uglification only, which also includes dynamic build steps if necessary
    grunt.registerTask('minify', ["uglify"]);
    grunt.registerTask('plugins', ["uglify:plugins"]);
    grunt.registerTask('modules', ["uglify:modules"]);
    grunt.registerTask('ui', ["uglify:ui"]);
    grunt.registerTask('buildUI', function (){
        grunt.log.writeln('esbuild');
        const result = exec("npx esbuild --bundle --sourcemap --format=esm --outfile=ui/index.js ui/index.mjs");
        grunt.log.writeln(result);
    })
    grunt.registerTask('css', 'Generate Tailwind CSS files for usage.', function (file) {
        grunt.log.writeln('Tailwind');
        //TODO change back to minify
        const result = exec('npx tailwindcss -i ./src/assets/tailwind-spec.css -o ./src/libs/tailwind.min.css --no-minify');
        grunt.log.writeln(result);
    });
    // Default task(s).
};
