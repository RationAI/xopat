# xOpat Servers

xOpat is a standalone web-browser application. Server-side execution is necessary only
due to certain capabilities browsers cannot provide:
 - parse HTTP GET/POST requests
 - scan filesystem
 - dynamically compile from configurations

There are different server implementations to provide different means of deployment.
Notable is the '_static server_' which is simply a server-less variation that does not 
support certain features and also behaves statically: needs to be compiled, and
then provides an HTML static page.

## Available Servers / Entrypoints
 - [x] PHP Server
 - [ ] Node.js Server [in development]
 - [x] HTML static index page [in development]

## Implementation

There are no implementation constraints, and so the server implementations might behave
slightly differently depending on what is possible in the given environment, and
how the server was implemented. But the server should be able to:

### Provide Static Configuration

Static configuration comes from the deployment, and must:
 - read default values from ``/path/to/xopat/src/config.json``
 - override these values with custom static configuration that might exist (see below)

The user-defined configuration files that are available support the following:
 - JSON with comments: being able to strip comments and parse the JSON configuration file
 - environmental variables: being able to replace ``<% ENV_VAR_NAME %>`` with relevant variable contents

The user-defined overrides must respect ``env.json`` configuration and ``XOPAT_ENV`` variable:
 - if ``XOPAT_ENV`` points to a file, load that file to parse static configuration
 - if ``XOPAT_ENV`` contains a string, use this data to set up the static configuration
 - otherwise try to load ``/path/to/xopat/env/env.json`` configuration file

### Parse Modules and Plugins

Scanning existing modules and plugins folder and parsing the available items:
 - scan module dependency, ensure these are acyclic and sort them in _DFS exit time descending order_
   - if we load modules in this order, we load their dependencies first
 - remove items that define ``enabled=false``
 - translate error messages if possible
 - provide for each instance these properties (atop of what is defined in the item's `include.json`):
   - set ``directory`` to path relative to `...modules/` or `...plugins/` respectively that points 
   to the location of the instance root folder
   - set ``path`` to the full relative path wrt. the domain (e.g. so that the path is a valid relative path
   the user's browser can access the item root folder and download its contents - scripts, ...)
   - set ``styleSheet`` to the path of `style.css` file if it exists in the item root folder (e.g. `path` + `style.css`)
   - set ``loaded`` to `true` if ``permaLoad=true``, otherwise `false`
   - in case of error, set ``error="description"`` property that describes the issue
 - override this plugins default configuration with relevant values from the global 
static configuration available (the environment-based config) 

It should also reason about what items should be loaded at the beginning (e.g. load the `webgl` module
if the viewer is going to render visualizations, etc. Server should parse correctly the
configuration input and act relevantly on errors, providing translated interface where possible.
Servers should also allow to
 - parse GET:
   - `lang`, optional preferred language
   - `visualization`, the full session configuration (here URL-encoded)
   - `slide` & `masks` - slide identification and mask coma-separated list of identifications to show
     - identification being either file path or ID the server understands, with default configuration applied 
 - parse and prefer using POST if possible:
   - support ``visualization`` attribute
   - pass all the POST data except the keys specified above to the viewer initialization
 - use only single URL endpoint to multiple functionalities if applicable:
   - ``directive=user_setup`` shows page that documents statically available visualizations and allows
   users to build sessions using JSON
   - ``directive=user_setup`` shows page with user-friendly setup of shaders (TODO: in progress of design)

The baseline is an existing server implementation which should new implementations adhere to.
