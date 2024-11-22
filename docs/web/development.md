
xOpat itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application.
However, testing and documentation uses ``npm``, `grunt` and `cypress`.

## Development

Run ``npm run s-node`` to run a node server. Follow instructions in the CLI - open
some session & start debugging :) Changes in the viewer code (except for the server logics)
is reflected with window reload.

New features _shall_ be added to ``CHANGELOG.md``. There, always a new chapter `Unreleased` should be
present, where current modification summary should be maintained.

### Developing modules & plugins
You can create new plugin or module simply by running ``grunt generate:plugin``
or ``grunt generate:module``.

Documentation on plugins/modules can be for now found in READMEs in plugins or modules folders,
or by search utility in the documentation page. More tutorials are coming!

## Build

To minify (build) the viewer, you can run

`grunt all`

and for plugins only

``grunt plugins``

or modules only

``grunt modules``

This will create ``index.min.js`` files in respective directories. The viewer core recognizes
existence of these files and loads them instead of all the source scripts.

!!! warning
    For development, you
    must set `production: false` static client configuration so that these files are ignored.

More documentation is coming. For more details on components, see README files in respective directories.
For details on integration, see ``INTEGRATION.md``.

