# Development Guidelines

If you haven't already, install dependencies using ``npm install``.

Npm or grunt tasks can be used to develop the viewer. Furthermore, new modules and plugins can be
created by using

``npm run create-module`` and `npm run create-plugin`.

Directives for developing modules and plugins are in README files in respective directories. 

General development can furthermore use the ``npm run dev`` task. The tasks starts a node server
(you need to provide `./env/.env` file or `XO_ENV` variable with configuration of the viewer), and
also tun a tailwind watcher. This is necessary to register new styles automatically using tailwind.
You can specify watched entities by providing ``WATCH_PATTERN`` variable, the task will 
watch your chosen files.

``WATCH_PATTERN=plugins/my_plugin/**/*.{js,mjs,css} npm run dev``

You can of course use all things independently:

``npm run s-node`` to start a server, and `npm run watch-ui` to watch UI components, `npm run watch-plugins`
to further watch all plugins, and even ``WATCH_PATTERN=[your pattern] grunt twinc``.

UI elements can be furthermore tested and developed using the ``npm run dev-ui`` task.
Instead of coding in a live viewer session, you can use the viewer sandbox playground for
developing the UI components in an isolated environment.

### Using NPM for modules or plugins.
The core uses no NPM, except for development purposes and documentation deployment.
If you develop an external item and need to use NPM packages, there is a way to do this directly:
 - mount a plugin or module as you would do normally
 - create ``package.json`` file in the plugin or module directory
   - define ``main`` file, the entrypoint that will be later compiled for browser
 - you can (but don't have to) crete ``include.json``, this file now only overrides values otherwise
 defined in ``package.json``, or allow you to provide custom static default properties - all fields are
 however from now on optional
 - run ``npm i`` to install your new dependencies
 - you now also need to run a watcher task on the plugin files as well, so that changes are re-compiled


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