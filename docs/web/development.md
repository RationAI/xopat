
xOpat itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application.
However, testing and documentation uses ``npm``, `grunt` and `cypress`.

## Development

Run ``npm run s-node`` to run a node server. Follow instructions in the CLI - open
some session & start debugging :) Changes in the viewer code (except for the server logics)
is reflected with window reload.

### Developing modules & plugins
This feature is coming!

## Build

To minify (build) the viewer, you can run

   !!! tip
   `grunt all`

and for plugins only

   !!! tip
   grunt plugins

or modules only

   !!! tip
   grunt modoules

This will create ``index.min.js`` files in respective directories. The viewer core recognizes
existence of these files and loads them instead of all the source scripts.

!!! warning
    For development, you
    must set `production: false` static client configuration so that these files are ignored.

More documentation is coming. For more details on components, see README files in respective directories.
For details on integration, see ``INTEGRATION.md``.

