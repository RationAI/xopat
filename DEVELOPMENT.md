# Development Guidelines

If you haven't already, install dependencies using ``npm install``.

Npm or grunt tasks can be used to develop the viewer. Furthermore, new modules and plugins can be
created by using

``npm run create-module`` and `npm run create-plugin`.

Directives for developing modules and plugins are in README files in respective directories. 

General development can furthermore use the ``npm run dev`` task. The tasks starts a node server
(you need to provide `./env/.env` file or `XOPAT_ENV` variable with configuration of the viewer), and
also tun a tailwind watcher. This is necessary to register new styles automatically using tailwind.
You can specify watched entities by providing ``WATCH_PATTERN`` variable, the task will 
watch your chosen files.

``WATCH_PATTERN=plugins/my_plugin/**/*.{js,mjs,css,ts} npm run dev``

You can of course use all things independently:

``npm run s-node`` to start a server, and `npm run watch-ui` to watch UI components, `npm run watch-plugins`
to further watch all plugins, and even ``WATCH_PATTERN=[your pattern] grunt twinc``.

UI elements can be furthermore tested and developed using the ``npm run dev-ui`` task.
Instead of coding in a live viewer session, you can use the viewer sandbox playground for
developing the UI components in an isolated environment.

### Using NPM and TypeScript for modules or plugins.
The core uses no NPM, except for development purposes and documentation deployment.
If you develop an external item and need to use NPM or TypeScript, there is high chance you need to
build your element before using it in the browser. Note that in order to re-use code between plugins,
you must expose your API to `window` object, since there is no compulsory structure and you never
know what other elements expose, or where they store distribution files.

> - mount a plugin or module as you would do normally
> - create ``package.json`` file in the plugin or module directory, by defining this file you create a `Workspace`
>   - **[Default build]**
>     - define ``buildEntry`` file, the entrypoint that will be later compiled for browser
>     - the browser exposes the workspace API as ``window[namespace][package.name]`` (e.g., ``window.xmodules.mymodule``)
>   - **[Custom build]**
>     - optionally, you can define ``build`` command in scripts `package.json`, this command will be executed to build the plugin or module
>     - you _must_ define ``index.workspace.(m)js`` or override `main` field to point to your compiled file entrypoint
>     - think about exposing your API to `window` object
>   - **[No build]**
>     - if you need the package file to install NPM dependencies, you can omit ``buildEntry`` and ``build``
>     - you _must_ define ``index.workspace.(m)js`` file or override `main` field , which will be later imported (otherwise this file is compiled by above approaches)
>     - think about exposing your API to `window` object
>     - you might want to use `copy` directive on `package.json` which copies files, e.g., from npm modules
> - you can (but don't have to) crete ``include.json``, this file now only overrides values otherwise
> defined in ``package.json``, or allow you to provide custom static default properties - all fields are
> however from now on optional
> - run ``npm i`` to install your new dependencies
> - you now also need to run a watcher task on the plugin files as well, so that changes are re-compiled
> - for more information, see ``src/NPM_MODULES_PLUGINS.md``

### Publishing NPM modules in the viewer
If you want to publish a NPM module as a viewer module, you can run ``npm run publish-npm``
and follow the instructions. The module will be automatically exposed as ``window.module[module_name]``.

### Bundling
Only core UI components are automatically bundled into ``ui/index.js`` file. This is the viewer UI component
system we encourage you to use across the viewer. Custom modules and plugins are not bundled in the development.
For production, ``npm run minify`` can be used to compile the viewer components into minified files.
Such files are then included instead of the sources defined in ``include.json`` (or `package.json` for workspaces), 
which might be confusing if you try to develop after running ``npm run minify`` (your changes will not be reflected because
the system loads minified files). This behavior is only active in **production mode**. See [the default configuration](./src/config.json).
### Predefined sessions
You can use ``/docs/example_sessions`` to open sessions for testing purposes, these sessions
explore various viewer modes.