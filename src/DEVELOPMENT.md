# Development Guidelines

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

### Bundling

Only core UI components are automatically bundled into ``ui/index.js`` file. This is the viewer UI component
system we encourage you to use across the viewer. Custom modules and plugins are not bundled in the development.
For production, ``npm run minify`` can be used to compile the viewer components into minified files.
Such files are then included instead of the sources defined in ``include.json``, which might be 
confusing if you try to develop after running ``npm run minify`` (your changes will not be reflected because
the system loads minified files).

### Predefined sessions
You can use ``/docs/example_sessions`` to open sessions for testing purposes, these sessions
explore various viewer modes.