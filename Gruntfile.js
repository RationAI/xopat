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
    grunt.registerTask("npm-install",
        "Install a module from npm",
        require('./server/utils/grunt/tasks/generate-npm-module')(grunt)
    );
    grunt.registerTask("twinc",
        'Tailwind incremental build/watch by parts.',
        require('./server/utils/grunt/tasks/realtime-compile')(grunt)
    );

    // library tasks
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-contrib-watch");

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
        uglify: {
            options: {
                sourceMap: true,
                banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */'
            },
            modules: { files: {} },
            plugins: { files: {} },
            ui: { files: { 'ui/index.min.js': ['ui/index.js'] } }
        },
        // Configuration for realtime dev incremental build/watch
        twinc: {
            inputCSS:   './src/assets/tailwind-spec.css',
            configFile: './tailwind.config.js',
            outFile:    './src/libs/tailwind.min.css',   // single output
            cacheDir:   './.dev-cache',
            watch: [
                'ui/**/*.{html,js,mjs,ts}',
                'modules/**/*.{html,js,mjs,ts}',
                'plugins/**/*.{html,js,mjs,ts}',
                'src/**/*.{html,js,mjs,ts}'
            ],
            ignore: [
                'ui/index.js',
                'src/libs/**',
                '.dev-cache/**',
                '**/*.min.js',
                '**/*.workspace.js',
                '**/*.workspace.js.map',
                '**/*.workspace.mjs',
                '**/*.workspace.mjs.map',
                "src/dist/**",
            ],
            minify: true,
            debounceMs: 150,
            // todo make this more approachable
            // usePolling: true, interval: 250, // if needed on WSL/Docker/UNC
        },
    });

    grunt.registerTask('workspaceBuild', 'Compile all workspaces', async function() {
        const done = this.async();
        const build = async (acc, data) => {
            const pkgPath = `${data.directory}/package.json`;
            // Check if it's actually a workspace element
            if (!grunt.file.exists(pkgPath)) {
                return;
            }
            const pkg = grunt.file.readJSON(pkgPath);
            await grunt.util.buildWorkspaceItem(data.directory, pkg);
        };
        await grunt.util.reduceModules(build, []);
        await grunt.util.reducePlugins(build, []);
        done();
    });

    // DYNAMIC MINIFICATION CONFIG
    grunt.registerTask('prepMinify', function() {
        const moduleFiles = {};
        const pluginFiles = {};

        grunt.util.reduceModules((acc, mod, folder) => {
            moduleFiles[`modules/${folder}/index.min.js`] = mod.includes
                .filter(i => typeof i === "string" && !i.endsWith(".min.js"))
                .map(i => `${mod.directory}/${i}`);
        }, {});

        grunt.util.reducePlugins((acc, plug, folder) => {
            pluginFiles[`plugins/${folder}/index.min.js`] = plug.includes
                .filter(i => typeof i === "string" && !i.endsWith(".min.js"))
                .map(i => `${plug.directory}/${i}`);
        }, {});

        grunt.config.set('uglify.modules.files', moduleFiles);
        grunt.config.set('uglify.plugins.files', pluginFiles);
    });

    grunt.registerTask('minify', ['workspaceBuild', 'buildUI', 'prepMinify', 'uglify']);
    grunt.registerTask('default', ['minify']);

    grunt.registerTask('default', ['minify']);
    grunt.registerTask('all', ['minify']);

    grunt.registerTask('build', ['workspaceBuild', 'buildUI', 'buildCore']);
    grunt.registerTask('buildUI', async function() {
        const done = this.async();
        try {await BuildLogic.buildUI({
            log: (msg) => grunt.log.writeln(msg),
            warn: (msg) => grunt.log.warn(msg),
            error: (msg) => grunt.log.error(msg),
        });done();
        } catch (e) {grunt.fail.warn(e.message);}
    });
    grunt.registerTask('buildCore', async function() {
        const done = this.async();
        try {await BuildLogic.buildCore({
            log: (msg) => grunt.log.writeln(msg),
            warn: (msg) => grunt.log.warn(msg),
            error: (msg) => grunt.log.error(msg),
        });done();
        } catch (e) {grunt.fail.warn(e.message);}
    });
    grunt.registerTask('css', async function() {
        const done = this.async();
        await BuildLogic.spawnAsync("npx", ["tailwindcss", "-i", "./src/assets/tailwind-spec.css", "-o", "./src/libs/tailwind.min.css"]);
        done();
    });
    grunt.registerTask('clean', 'Clean all workspace artifacts', async function() {
        const done = this.async();
        const cleanItem = async (acc, data) => {
            const pkgPath = `${data.directory}/package.json`;

            if (!grunt.file.exists(pkgPath)) {
                return; // not a workspace
            }

            const pkg = grunt.file.readJSON(pkgPath);
            await grunt.util.cleanWorkspaceItem(data.directory, pkg);
        };
        await grunt.util.reduceModules(cleanItem, []);
        await grunt.util.reducePlugins(cleanItem, []);
        // todo consider also .dev-cache and core files
        done();
    });
};
