
xOpat itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application.
However, testing and documentation uses ``npm``, `grunt` and `cypress`.

## Development

Run ``npm run s-node`` to run a node server. Follow instructions in the CLI - open
some session & start debugging :) Changes in the viewer code (except for the server logics)
is reflected with window reload.

## Environment, Build & Test

> The build and test framework is still in development - for now, the viewer can be used AS-IS just add the OSD library and run from a PHP server.

    To minify (build) the viewer, you can run

> grunt all

and for plugins only

> grunt plugins

or modules only

> grunt modules

This will create ``index.min.js`` files in respective directories. The viewer core recognizes
existence of these files and loads them instead of all the source scripts. **These files
for now block development, since the system will start ignoring non-minified files.**

For more details on components, see README files in respective directories.
For details on integration, see ``INTEGRATION.md``.
For documentation, you can run ``npm install && grunt docs && grunt connect watch``
and open ``localhost:9000/``
