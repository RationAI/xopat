# Plugins

It is easy to create and plug-in a plugin. Each plugin must be in its own folder placed here (`./plugins/`). 
Recommeded way of creating a new plugin is a command ``grunt generate:plugin``.

## Plugin Directory Structure
 
#### `include.json`
Inside a plugin, at least this file must exist (otherwise the directory is not treated as a plugin directory):

````json
{
    "id": "plugin_id",
    "name": "Plugin Name",
    "description": "My awesome plugin for this and that.",
    "includes" : [
        "dependency1.js",
        "dependency2.js",
        "implementation.js"
    ],
    "modules": []
}
````

##### Built-in keys

  - `id` is a required value that defines plugin's ID as well as it's variable name (everything is set-up automatically)
  - `name` is the plugin name 
  - `description` is a text displayed to the user to let them know what the plugin does: it should be short and concise
  - `author` is the plugin author
  - `icon` is the plugin icon
  - `version` is the plugin version
  - `includes` is a list of JavaScript files relative to the plugin folder to include 
  - `modules` array of id's of required modules (libraries)
      - note that in case a new library you need is probably not useful to the whole system, include it internally via the plugin's `"includes"` list 
      instead of creating a module for it
  - `permaLoad` is an option to include the plugin permanently without asking; such plugin is not shown in Plugins Menu and is always present
  - `enabled` is an option to allow or disallow the plugin in the system, default `true`
  - `hidden` is an option to hide plugin from the user-available selection

##### Custom keys
A developer can provide custom parameters to `include.json` and retrieve them later in the code.
A deployment maintainer then uses ENV setup (see `/env/README.md`) to override necessary values.
These are called **Static Configurations**.


## Must do's
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object/class, then call `addPlugin('myPluginId', MyAwesomePlugin);` on a global level
    - `'myPluginId'` must be the same as `id` from `includes.json`
- Any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
- A plugin must inherit from ``XOpatPlugin`` class
    - your plugin constructor is given ``id`` and ``params`` arguments, call `super(id)` and use params (from the **Dynamic session**) at your will
- Get familiar with both global and ``XOpatPlugin`` API - use it where possible
    - especially, do not add HTML to DOM directly (unless you operate a new window instance), use ``window.USER_INTERFACE`` API instead
    - cache meaningful values
    - interact with static & dynamic configuration values
    - provide built-in IO logics
    - ...

> **IMPORTANT.** Please respect the viewer API and behavior. Specifically,
> respect the ``APPLICATION_CONTEXT.secure`` parameter
> and provide necessary steps to ensure secure execution if applicable.

### Interface XOpatPlugin
Basic functions that are available to plugins atop what ``XOpatElement`` provides.
````js
/**
 * Function called once a viewer is fully loaded
 */
async pluginReady();

/**
 * Load localization data
 * @param locale the current locale if undefined
 * @param data possibly custom locale data if not fetched from a file
 */
async loadLocale(locale=undefined, data=undefined);

/**
 * Read static metadata - include.json contents and additional meta attached at runtime
 * @param metaKey key to read
 * @param defaultValue
 * @return {undefined|*}
 */
getStaticMeta(metaKey, defaultValue);
/**
 * Store the plugin configuration parameters
 * @param {string} key
 * @param {*} value
 * @param {boolean} cookies
 */
setOption(key, value, cookies=true);

/**
 * Read the plugin configuration parameters
 * @param {string} key
 * @param {*} defaultValue
 * @return {*}
 */
getOption(key, defaultValue=undefined);

/**
 * Code for global-scope access to this instance
 * @return {string}
 */
get THIS();

/**
 * Plugins CANNOT BE DIRECTLY DEPENDENT on each other. Only loosely.
 * To simplify plugin interaction, you can register a callback executed
 * when a certain plugin gets loaded into the system.
 * @param {string} pluginId
 * @param {function} callback that receives the plugin instance
 * @return {boolean} true if finished immediatelly, false if registered handler for the
 *   future possibility of plugin being loaded
 */
integrateWithPlugin(pluginId, callback);

/**
 * Absolute url (path part only) to plugins folder
 */
static ROOT;
````

#### `XOpatPlugin::constructor(id, params)`
The plugin main class is given it's `id` and `params` object (dynamic metadata), make sure to call `super(id);`. `params` object
is integrated within the system and gets exported in the viewer configuration - such information is available when 
sharing the plugin
exports.

#### `XOpatPlugin::pluginReady()`
You can override this function - it will get invoked once the plugin is fully ready.
Because of dynamic loading and behaviour, it is necessary that you do most initialization
in this function instead of the constructor, especially if
 - you access **the global API**
 - you access any **API of other plugins/modules**
 - you access global scope **of your own plugin's _other files_**!
 TODO: rewrite
#### `XOpatPlugin::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets automatically exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. For cookie support, prefer this method.

#### `XOpatPlugin::setOption(key, value, cookies=true)`
Stores value under arbitrary `key`, caches it, if allowed within cookies The value must be already serialized as a string
(constants are OK since they can be converted naturally). The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor. For cookie support, prefer this method.

### Selected global API functions
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `plugin(id)`
Retrieve an instantiated plugin by its id.

#### `addPlugin(id, PluginMainClass)`
This (global) function will register the plugin and initialize it. It will make sure that
- an instance of `PluginMainClass` is created
- `id` member variable is set
- the API is correctly configured
    - this is mainly for the plugin itself, in case you want to use `on...=""` HTML attributes where you need to access the plugin from the global scope
    - you can do things like 
      ``let html = `<tag onclick="${this.THIS}.callMyPluginFunction(...)"\>`;``
    - note that ``this.THIS`` uses in fact (memoized string) `plugin('${this.id}')`

>
> You can register the plugin anonymously if you do not need the class namespace:
> ``` 
> addPlugin("user-session", class extends XOpatPlugin {
>      ...
> });
> ```
>


### IO Handling
``bindIO`` method is available that explicitly enables IO support. You probably want to
call (somewhere in the initialization phase, usually in `pluginReady()`) function `initPostIO`
on itself as well as any other module that does not call it explicitly.

> **Note**: plugin & module data are namespaced in POST. If you want to send post data manually, use:
> ``plugin[<plugin_id>.key] = value;``. Nested keys are up to the plugin to manage for itself,
> e.g. ``plugin[<plugin_id>.parentKey.subKey] = value;``.

TODO docs
The example below shows how to implement IO within with proper function overrides.
````js
async exportData() {
    return await this.export(); //our internal function returns a string promise
}

async importData(data) {
    await this.import(data); //our import function expects data as a serialized string
}
````

As you might've noticed, there are no options to export _multiple items_ - and it is intended.
The module should export (for simplicity) all its data in one serialized object, e.g. annotations would
export something like:
````
{
  "version": 1.2.0
  "objects": [...]
  "presets": [...]
}
````
When the viewer is exported as a file, it will mark the flag `isStaticPreview` to `true`.
In this case, plugins should **not fetch** any data that is included in the export, to avoid duplicity.

```js
if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
    // skip data fetching
}
```

### Data Management Options  TODO: rewrite
There are generally **five** different options how to manage data. For metadata (e.g. configurations, settings), 
three different options are available:

TODO docs
 1. ``getOption``, `setOption` suitable for small configuration metadata, present in the configuration present in _viewer URL and file exports_
 2. ``getStaticMeta``, ``-nothing-`` suitable for static (hardcoded) configuration metadata, reading from your `include.json`
 3. `async getCache`, `async setCache` suitable for session-independent data (cookies or user data), always available
    - use for user configurations caching to avoid re-setting in each session

And one global meta store meant for reading only, global viewer metadata    
 4. ``APPLICATION_CONTEXT.metadata`` as an instance of `MetaStore` class  
todo docs
For data IO, you ahve two options
 1. ``async importData``, `async exportData` suitable for data in general, present in _viewer file exports_
 2. custom service storing data at server
    - this is not supported as of now in any way, implement your own logic on how to access a third party storage service
    - prefer use of ``sendJSON`` method to communicate, the user info metadata is automatically included
    


### Events
Modules (and plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events require OpenSeadragon.EventSource implementation (which it is based on) and it
should be invoked on the ``XOpatModule`` or `XOpatModuleSingleton` instance. 

> Events are available only after `this.registerAsEventSource()` has been called.

### Localization
Can be done using ``this.loadLocale(locale, data)`` which behaves like plugin's `loadLocale` function
(both ``locale`` and `data` can be undefined). 
````javascript
//load default locale
this.loadLocale() 
//load raw data for 'cs'
this.loadLocale('cs', {"x":"y"}) 
````
Override ``getLocaleFile`` function to describe module-relative path to the locale file for given `locale` string.


## Global API
> !!! Avoid touching directly any properties, attaching custom content to the DOM or inventing your own
approaches when API is available !!!
 
First, get familiar with (sorted in importance order):
 - `window.VIEWER` 
    - OpenSeadragon 
      - `TileSource` API, ``EventSource`` API for managing the rendering and events (e.g. user input)
      - `OpenSeadragon.Tools` (accessible as `VIEWER.tools`) API for viewing and navigation functionality
        - focusing certain area, taking screenshots, opening viewer clone and more
      - `OpenSeadragon.Scalebar` (accessible as `VIEWER.scalebar`) API for measurements
        - `imagePixelSizeOnScreen` for **cached, optimized** way of converting between image coordinates and window coordinates  
        - getting reference to _main_ tiled image, getting pixel size on screen,
    - WebGL module API of the layers group (accessible through `VIEWER.bridge`) for image data post-processing
    - events invoked on the VIEWER (always check `EVENTS.md` in appropriate folder)
 - `window.USER_INTERFACE`
    - API for dealing with application UI - menus, tutorials, inserting custom HTML to DOM...
 - `window.UTILITIES`
    - functional API - exporting, downloading files, refreshing page and many other useful utilities
    - especially fetching is encouraged to use through ``UTILITIES.fetchJSON(...)``  todo docs is this still true?
 - Third party code (see below)    
 - `window.UIComponents`
    - building blocks for HTML structures, does not have to be used but contains ready-to-use building blocks - menus...
 - `window.APPLICATION_CONTEXT`
    - note that this interface is meant for inner logic and you probably do not need to access it
    - to access the configuration, should be used in read-only manner: `APPLICATION_CONTEXT.config`
    - to access the viewer parameters, use `[set|get]Option(...)` method
  
And also other available modules. Each module provides it's own way of enriching the environment, 
such as pre-defined color maps, (already mentioned) webgl processing, fabricJS canvas, JSON to HTML parser, 
annotation logic, HTML sanitization, vega graphs, threading worker or keyframe snapshots.   

### Available Third-party Code and UI
- You should use new UI components, see [this](../../../../../Repos/xopat-shadowaya/ui/README.md)

You can use
 - [jQuery](https://jquery.com/), 
 - [Material Design icons](https://fonts.google.com/icons?selected=Material+Icons)
 - [Font Awesome 6 Free icons](https://fontawesome.com/)
 for icons (prefer using `<span>`) and 
 - [Primer CSS bootstrap](https://primer.style/css).
 - Pre-defined, documented CSS in the core ``src/assets/style.css``
 - other libraries included in `/external`, the Monaco editor is available only in a child window
   context via the `Dialogs` interface
 
#### `includes` property
In fact, the plugin can either specify a string value to indicate local file, 
or an object to specify a file on the web. The object properties (almost) map to
 supported attributes of `<script>` element. In case you will attach a file, 
 make sure you also set `integrity` property.
````json
{
    "id": "plugin_id",
    "includes" : [
        {
            "src": "https://host.xy/file.js",
            "integrity": "hashalgo-hashofthefilesothatitsintegrityisverified",
            "crossOrigin": "anonymous"
        }
    ]
}
```` 

## Dynamic Loading
As workers and js modules (recommended usage), the viewer does not offer advanced tools for
loading these scripts dynamically. You need to use **relative** file names and instantiate
your worker or import a module. Relative paths must begin in the repository root. With plugins and
modules, the easiest way is to extend appropriate interface and retrieve ``this.PLUGIN_ROOT`` or
``this.MODULE_ROOT`` respectively, against which you can import local files.

## Caveats
The plugins should integrate into exporting/importing events, otherwise the user will have to re-create
the state on each reload - which might be fatal wrt. user experience. Also, you can set dirty state
using ``APPLICATION_CONTEXT.setDirty()`` so that the user gets notified if they want to leave.

Furthermore, the layout canvas setup can vary - if you work with canvas in any way relying on dimensions
or certain tile sources, make sure you subscribe to events related to modification of the canvas and update
the functionality appropriately. Also, **do not store reference** to any tiled images or sources you do not control.
Instead, use ``VIEWER.scalebar.getReferencedTiledImage();`` to get to the _reference_ Tiled Image: an image wrt. which
all measures should be done.

 
## Hints
If you have a panel registered under your ID, you can use `loading` class to show a loading spinner
````JavaScript
appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
$(`#${id}`).addClass("loading");
````
And remove it after you are done. In fact, do not be shy and open `assets/custom.css`
file to see pre-defined classes for uniform UI (button hovering, error message containers and more).  

---
Use 
````JavaScript
let html = `<button class="btn" onclick="${this.THIS}.myPluginRootClassMethod();">Click me</button>`;
````
to call your plugin's methods from the UI. Alternatively, fetch your element by it's ID and add
the event programmatically. `this.id` should be set (automatically) to your plugin ID, as called
with: `addPlugin(...)`.

### Styling with CSS
If you want to use CSS, please, first rely on _Primer CSS_ bootstrap (https://primer.style/css) using class styling
and `assets/custom.css` pre-defined classes. 

If you need your own CSS file anyway, you can create in your plugin root directory file `style.css` - it will be
automatically included.
