const BuildLogic = require("./server/utils/mixins/build-logic");
const { classifyIncludeFoldable, classifyIncludeKind } = require("./server/templates/javascript/utils");

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
    grunt.registerTask("i18n-audit",
        'Audit core i18n: verify $.t() keys resolve in src/locales/en.json and flag hardcoded UI strings.',
        require('./server/utils/grunt/tasks/i18n-audit')(grunt)
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
    // Build the uglify file-map: one `index.min.js` per NON-workspace item,
    // concatenating only the *foldable* includes (plain local classic .js).
    // Workspace items already ship a minified bundle (index.workspace.min.js,
    // copied during workspaceBuild) so they are skipped here — re-uglifying an
    // already-minified bundle is wasteful and would double-wrap it. `.mjs`,
    // remote, already-`.min.js` and object-form (SRI / `bundle:false` worker)
    // includes are excluded by the shared classifyIncludeFoldable predicate and
    // keep loading as their own files. See server/templates/javascript/utils.js.
    grunt.registerTask('prepMinify', function() {
        const collect = (target, prefix) => (acc, item, folder) => {
            const isWorkspace = item["__workspace_item_entry__"]
                || (Array.isArray(item.includes) && item.includes[0] === "index.workspace.js");
            if (isWorkspace) return;
            const foldable = (item.includes || [])
                .filter(classifyIncludeFoldable)
                .map(i => `${item.directory}/${i}`);
            if (foldable.length) {
                target[`${prefix}/${folder}/index.min.js`] = foldable;
            }
        };

        const moduleFiles = {};
        const pluginFiles = {};
        grunt.util.reduceModules(collect(moduleFiles, "modules"), {});
        grunt.util.reducePlugins(collect(pluginFiles, "plugins"), {});

        grunt.config.set('uglify.modules.files', moduleFiles);
        grunt.config.set('uglify.plugins.files', pluginFiles);
    });

    // Bundle each NON-workspace item's `.mjs` includes into one minified ESM
    // file (index.min.mjs). Classic `.js` includes are handled by prepMinify +
    // uglify (index.min.js); this covers the module half so `.mjs`-only plugins
    // are minified in production too. Workspace items are skipped (they build
    // their own index.workspace.min.js).
    grunt.registerTask('bundleModules', 'Bundle .mjs includes into minified ESM per item', async function() {
        const done = this.async();
        const logger = {
            log: (m) => grunt.log.writeln(m),
            warn: (m) => grunt.log.warn(m),
            error: (m) => grunt.log.error(m),
        };
        const run = async (item) => {
            const isWorkspace = item["__workspace_item_entry__"]
                || (Array.isArray(item.includes) && item.includes[0] === "index.workspace.js");
            if (isWorkspace) return;
            const mjs = (item.includes || []).filter(e => classifyIncludeKind(e) === "module");
            if (!mjs.length) return;
            try {
                await BuildLogic.buildItemModuleBundle(item.directory, mjs, logger);
            } catch (e) {
                grunt.log.warn(`bundleModules ${item.directory}: ${e && e.message || e}`);
            }
        };
        // reduceFolder invokes its accumulator synchronously and does NOT await,
        // so collect items first, then await every esbuild build together.
        // Awaiting the reduce result only awaits the LAST item's promise and lets
        // grunt call done() while the rest are still building — those get killed
        // on process exit, leaving no index.min.mjs (race).
        const items = [];
        const collect = (acc, item) => { acc.push(item); return acc; };
        grunt.util.reduceModules(collect, items);
        grunt.util.reducePlugins(collect, items);
        await Promise.all(items.map(run));
        done();
    });

    // Production build: also compiles the core (per-file dist AND the single
    // minified src/dist/xopat-core.min.js bundle) so `client.production` has a
    // complete set of min artifacts to serve. `buildCore` was previously absent
    // here, so `minify` never produced the core dist at all. `bundleModules`
    // produces the per-item ESM bundles (index.min.mjs) for `.mjs` includes.
    grunt.registerTask('minify', ['workspaceBuild', 'buildUI', 'buildCore', 'prepMinify', 'uglify', 'bundleModules']);
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
