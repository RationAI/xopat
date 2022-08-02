# Plugins

It is easy to create and plug-in a plugin. 
 
Each plugin must be in its own folder placed here (`./plugins/`). 
Inside, one file must exist (otherwise the plugin won't load):
 
### `include.json`
A `JSON` file is required that defines the plugin and it's inclusion:

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
- `id` is a required value that defines plugin's ID as well as it's variable name (everything is set-up automatically)
- `name` is the plugin name 
- `description` is a text displayed to the user to let them know what the plugin does: it should be short and concise
- `includes` is a list of JavaScript files relative to the plugin folder to include 
- `modules` array of id's of required modules (libraries)
    - note that in case a new library you need is probably not useful to the whole system, include it internally via the plugin's `"includes"` list 
    instead of creating a module for it

> Everything you define in this file is accessible through `PLUGINS` object interface, so it is a good place to also define your own
>proprietary configuration options.

You can than find the plugin instance stored in `PLUGINS["plugin_id"].instance`. `PLUGINS["plugin_id"]` mirrors
the plugin `include.json` content with additional data (such as `loaded` flag).

### Must do's
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object/class, then call `addPlugin('myPluginId', MyAwesomePlugin);` on a global level
- Any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
- A plugin must have its id in a member variable named after `id` from `includes.json`. This is done automatically after the plugin instantiation, just make sure you
don't use `id` for anything else
- The plugin main class should be visible from the global scope. However, try not to pollute the global namespace 
and define other classes in closures or as a properties of the parent class.
- The plugin main class should not define two functions `getOption()` and `setOption()` - these are
set up automatically and available when `YourPLuginClass::pluginReady()` gets called

### Interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `addPlugin(id, PluginRootClass)`
This (global) function will register the plugin and initialize it. It will make sure that
- an instance of `PluginRootClass` is created
- `id` member variable is set
- global space contains the plugin instance in a variable named after `plugin.id`
    - this is mainly for the plugin itself, in case you want to use `on...=""` HTML attributes where you need to access the plugin from the global scope
    - you can do things like 
      > let html = \`\<tag onclick="${this.id}.callMyPluginFunction(...)"\>\`;
- `PLUGINS[plugin.id].instance` contains the plugin instance
- in case `pluginReady` is defined, it will be invoked when the visualisation is ready

#### `YourPLuginClass::constructor(id, params)`
The plugin main class is given it's `id` and `params` object, use them as you wish. `params` object
is integrated within the system and gets exported - such information is available when sharing the plugin
exports. Note that the object should not be used to store big amounts of data, for that `YourPLuginClass::setData()` 
together with `YourPLuginClass::getData()` should be used.

#### `YourPLuginClass::pluginReady()`
Because of dynamic loading and behaviour, it is necessary that you do most initialization
in this function instead of the constructor, especially if
 - you access **the global API**
 - you access any **API of other plugins/modules**
 - you access global scope **of your own plugin's _other files_**!

Yup, that's right. It might not be safe to access even your own plugin auxiliary classes from the main class constructor.
There is a deadlock (unless you break it somehow, e.g. by splitting the main class definition and implementation):
 - your plugin inner classes should be registered within one (main) class namespace
 - your main class script (often) calls `addPlugin(...)`
 - which invokes the Main class constructor that instantiate auxiliary classes
 - but Main class must have been included (and executed) first since auxiliary classes extend it's namespace
 
#### \[EXISTS\] `YourPLuginClass::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it.

#### \[EXISTS\] `YourPLuginClass::setOption(key, value, cookies=true)`
Stores value under arbitrary `key`, caches it if allowed within cookies. The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor.

#### \[EXISTS\] `YourPLuginClass::getData(key)`
Return data exported with the viewer if available.

#### \[EXISTS\] `YourPLuginClass::setData(key, dataExportHandler)`
Registers `dataExportHandler` under arbitrary `key`. `dataExportHandler` is a function callback that
will get called once a viewer export event is invoked. Should return a string that encodes the data to store.
The data should not contain `` ` `` character.

### Global API
Avoid touching directly any properties, attaching custom content to the DOM or inventing your own
approaches - first, get familiar with:
 - `window.VIEWER` 
    - OpenSeadragon and `OpenSeadragon.Tools` (accessible as `VIEWER.tools`) API
    - WebGL API of the layers group (accessible through `VIEWER.bridge`)
    - events invoked on the VIEWER
 - `window.APPLICATION_CONTEXT`
    - note that this interface is meant for inner logic and you probably do not need to access it
    - to access the configuration, should be used in read-only manner: `APPLICATION_CONTEXT.setup`
    - to access the viewer parameters, use `[set|get]Option(...)` method
 - `window.USER_INTERFACE`
    - API for dealing with application UI - menus, tutorials, inserting custom HTML to DOM...
 - `window.UIComponents`
    - building blocks for HTML structures, does not have to be used but contains ready-to-use building blocks
 - `window.UTILITIES`
    - functional API - exporting, downloading files, refreshing page and many other useful utilities
  
And also available modules. Each module provides it's own way of enriching the environment, 
such as pre-defined color maps, webgl processing, fabricJS canvas, annotation logic or snapshots.   

### Third-party (hard-wired modules)
You can use
 - [jQuery](https://jquery.com/), 
 - [Material design icons](https://fonts.google.com/icons?selected=Material+Icons)
 for icons (use `<span>`) and 
 - [Primer CSS bootstrap](https://primer.style/css).
 - other libraries included in `/external`, the Monaco editor is available only in a child window
   context via the `Dialogs` interface
 
### `includes` property
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
            "integrity": "hashofthefilesothatitsintegrityisverified",
            "crossorigin": "anonymous"
        }
    ]
}
```` 
  
 
### Hints
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
let html = `<button class="btn" onclick="${this.id}.myPluginRootClassMethod();">Click me</button>`;
````
to call your plugin's methods from the UI. Alternatively, fetch your element by it's ID and add
the event programmatically. `this.id` should be set (automatically) to your plugin ID, as called
with: `addPlugin(...)`.

### Styling with CSS
If you want to use CSS, please, first rely on _Primer CSS_ bootstrap (https://primer.style/css) using class styling
and `assets/custom.css` pre-defined classes. 

If you need your own CSS file anyway, you can create in your plugin root directory file `style.css` - it will be
automatically included.
