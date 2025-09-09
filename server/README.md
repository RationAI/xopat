# xOpat Servers

xOpat is a standalone web-browser application. Server-side execution is necessary only
due to certain capabilities browsers cannot provide:
 - parse HTTP POST data
 - scan filesystem
 - dynamically compile from configurations

There are different server implementations to provide different means of deployment.
Notable is the '_static server_' which is simply a server-less variation that does not 
support certain features and also behaves statically: needs to be compiled, and
then provides an HTML static page.

## Available Servers / Entrypoints
 - [x] PHP Server
 - [x] Node.js Server
   - cornercases might be not handled well yet (e.g. supplying POST data in different ways) 
 - [x] HTML static index page

## Implementation

There are no implementation constraints, and so the server implementations might behave
slightly differently depending on what is possible in the given environment, and
how the server was implemented. But the server should be able to:

### Provide basic entrypoints
 - ``/`` location that opens up the viewer
 - ``/dev_setup`` that opens the developer session manual editor

All such entrypoints should be implemented using the prepared HTML templates.
See ``templates/README.md``. 

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
 - pass POST data to the JS app initialization function
 - use only single URL endpoint to multiple functionalities if applicable:
   - ``directive=user_setup`` shows page that documents statically available visualizations and allows
   users to build sessions using JSON
   - ``directive=user_setup`` shows page with user-friendly setup of shaders (TODO: in progress of design)

It should include all necessary dependencies respecting their inclusion order and requirements (e.g.
support for WASM - see below, or JS modules). It should also ensure that new file versions are being labeled
correctly so that the browser does not cache them across viewer versions.

An existing server implementation demonstrates these requirements,
which should new implementations adhere to.

### Support types of access:
The server should accept POST and GET parameters, as the viewer description states
what opening ways are possible. Additionally, it should parse POST data:

### Support default IO pipeline
To support IO pipeline, the server must parse POST data and embed it in the HTML index file.
The data comes in the following structure:

````json
{
   "visualization": { ... the viewer session ... },
   "modules[moduleId.property]": "\"serialized-data\"",
   "plugins[pluginId.prop.propx]": "\"serialized-data\"",
}
````
The viewer session comes in un-serialized, or serialized once. You have to respect the session and configure the viewer accordingly.
You have to also respect the module and plugin data that optionally comes with the session, and provide it to plugins / modules
in the index file as the following structure:

````json
{
   "modules": {
      "moduleId.property": "serialized-data"
   },
   "plugins": {
      "pluginId.prop.propx": "serialized-data"
   }
}
````

The data might (and usually do) come double-encoded, this is to avoid problems with inputs: 
we could receive encoded JSON, literal string, a number, and all of them must be a valid JS in the exported index file:
````javascript
`<script>
let encoded = ${"{\"a\":1, \"b\":2}"};
let plain_string = ${"hi!"};
let number = ${3};
</script>`
````
results in 
````html
<script>
   let encoded = {a:1, b:2};
   let plain_string = hi!;
   let number = 3;
</script>
````
which is invalid. But how do we know whether a string is in fact an object encoded by JSON.stringify, 
or a dom node by XMLSerializer().serializeToString(...) .. etc?
We don't. Here comes in double-encoding, we encode each input once more. However, servers **must** attempt to encode
these values before the viewer accepts them. Although the encoding could happen also on the
viewer setup, this approach gives servers freedom to potentially modify parts of the session, etc.

To do so, each server must attempt to process POST data by:
 - figuring out whether the server receives the POST data as a unprocessed string, or whether it is pre-processed;
 PHP servers can for example natively read the submitted POST data and expand the above described syntax to already nested
 array, e.g. ``$_POST["modules"]["moduleId.property"]`` is a valid reference
 - each '`"\"serialized-data\""`' object must be safely attempted to be decoded as a JSON, e.g.

````javascript
 function readPostDataItem(item) {
     // The object can come in double-encoded, try encoding if necessary
     try {
         return JSON.parse(item);
     } catch {
         return item;
     }
 }
````

### WASM Support
WASM Files need all content to be served with the correct MIME type and headers, required by threading.
This is often not doable, therefore the following is not used (and threading not supported).
````
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
````
