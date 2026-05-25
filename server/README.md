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
 - [x] Node.js Server
 - [x] PHP Server
   - no RPC support
 - [x] HTML static index page
   - no dynamic loading of modules and plugins, no server support

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
 - environmental variables: being able to replace ``<% ENV_VAR_NAME %>`` with relevant variable contents.
   Bash-style default values are also supported:
   - ``<% VAR:-default %>`` — use ``default`` if ``VAR`` is unset OR empty (matches bash ``${VAR:-...}``)
   - ``<% VAR-default %>`` — use ``default`` only if ``VAR`` is unset (matches bash ``${VAR-...}``)
   - example: ``http://localhost:<% XOPAT_NODE_PORT:-8080 %>``
   Substitutions that land inside a JSON string literal are JSON-escaped automatically,
   so env values containing ``"``, ``\``, or control characters cannot break JSON
   structure or inject sibling keys. Substitutions outside string context (e.g. a numeric
   port placeholder like ``"port": <% XOPAT_PORT:-8080 %>``) are inserted raw.

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

#### Plugin selection mode

Servers honor the deployment-level field ``CORE.client.pluginSelectionMode``
(default ``"all"``) when building the page-level ``PLUGINS`` map shipped to
the client. The same three modes are implemented identically by every
server backend, so the emitted ``PLUGINS`` keys must agree byte-for-byte
between PHP and Node under the same ENV.

 - ``"all"`` *(default, current behavior)* — every discovered plugin
   without ``enabled: false`` is shipped to the client.
 - ``"whitelist"`` — inverse default. A plugin is shipped only if the
   deployment ENV sets ``plugins.<id>.enabled = true``. A plugin's own
   ``enabled: true`` in include.json does NOT whitelist it. ``enabled:
   false`` in include.json is still an absolute opt-out. Plugins filtered
   out by the whitelist are dropped *silently* — they don't exist as far
   as the client is concerned (no manifest, no UI entry, not dynamically
   loadable). The intended use is per-deployment access control where
   leaking plugin identifiers is undesirable.
 - ``"available"`` — like ``"all"``, plus a per-element config-gate
   driven by a single optional ``requiredConfig: string[]`` array on each
   plugin's *or* module's ``include.json``. Each path is resolved against
   TWO deployment-controlled sources; a path is satisfied when EITHER
   source carries a non-``undefined``/non-``null``/non-empty value:
     1. **Deployment ENV block** — ``ENV.plugins[id]`` /
        ``ENV.modules[id]``, supplied via env.json's top-level
        ``plugins``/``modules`` arrays. The natural home for non-secret
        values (URLs, aliases, flags).
     2. **Server-secure block** — ``CORE.server.secure.plugins[id]`` /
        ``CORE.server.secure.modules[id]``, supplied via env.json's
        ``core.server.secure``. Never shipped to the browser. The natural
        home for secret-adjacent values (API key bindings, proxy aliases
        referencing a secret).
   The plugin author declares *what* keys are needed; the deployment
   admin decides *where* each value lives. Booleans ``false`` and the
   number ``0`` count as configured. **Include.json defaults are NOT
   consulted** — a plugin that ships
   ``serviceUrl: "http://localhost:8042"`` in its own include.json AND
   declares ``requiredConfig: ["serviceUrl"]`` is still dropped on
   deployments that don't supply ``serviceUrl`` in either bucket. The
   include.json default is treated purely as documentation / dev
   convenience for the (default) ``"all"`` mode. Elements that don't
   declare ``requiredConfig`` are always considered configured (so this
   mode degrades to ``"all"`` for them). The gate applies to modules as
   well — dropping a required module surfaces as a plugin-level
   missing-dep error via the existing dependency check, which is the
   desired UX when the module's upstream isn't available.

Capture of the deployment-ENV ``enabled`` value for ``"whitelist"``
happens *before* the per-plugin ENV merge, so a plugin's own
``enabled: true`` cannot masquerade as a whitelist opt-in. ``permaLoad``
is honored after mode filtering — plugins dropped by the mode cannot
permaLoad. Plugins that fail to even parse their ``include.json`` are
still surfaced as error records in every mode (server-side
misconfiguration is an admin-visible concern).

The ``"whitelist"`` mode only filters plugins. Modules are dependencies
pulled in by plugins, so they are not user-facing items to whitelist;
they behave as in ``"all"`` mode. The ``"available"`` config-gate, in
contrast, applies to both modules and plugins.

Implementation note: the server preserves a pre-strip backup of the
secure block for its own use during plugin filtering (PHP
``$GLOBALS['CORE_SECURE']`` set in ``core.php``; Node ``core.CORE_SECURE``
set in ``core.js``). The browser-bound CORE still has
``server.secure`` deleted before emission — the backup is server-only and
must never be ``JSON.stringify``'d into the page payload.

It should also reason about what items should be loaded at the beginning (e.g. load the `annotations` plugin
if the viewer is going to be used with annotations, etc. Server should parse correctly the
configuration input and act relevantly on errors, providing translated interface where possible.
Servers should also allow to
 - pass POST data to the JS app initialization function
 - use only single URL endpoint to multiple functionalities if applicable:
   - ``directive=user_setup`` shows page that documents statically available visualizations and allows
   users to build sessions using JSON
   - ``directive=user_setup`` shows page with user-friendly setup of shaders (in progress of design)

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

### Proxy support
Support proxying to services:
 - parse ``config.json`` (usually referred to as CORE config in servers) and read the `server` -> `secure` -> `proxies` object
 - adhering to the proxy configuration, proxy requests to the services
 - a plugin can issue ``proxy/[key]/...`` and the key is the key to `proxies` object in `config.json`
 - the session must be secured: use CSRF protection - you must set ``window.XOPAT_CSRF_TOKEN`` when user visits the viewer page
 - the resource must be secured: if configured, the server must verify a desired authentication method (so called verifier) - see ``config.json`` for more details

> !IMPORTANT!: The server, when delivering CORE configuration to the front-end *MUST DELETE* the secure object 
> of the server configuration, which MUST NOT be available on the client - it can contain secrets that are explicitly left
> hidden on the server.

### WASM Support
WASM Files need all content to be served with the correct MIME type and headers, required by threading.
This is often not doable, therefore the following is not used (and threading not supported).
````
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
````
