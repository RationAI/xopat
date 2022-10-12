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

Note that this is meant mainly for a viewer maintainer to set-up the plugin default, static configuration. 
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

### Must do's
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object/class, then call `addPlugin('myPluginId', MyAwesomePlugin);` on a global level
- Any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
- A plugin must have its id in a member variable named after `id` from `includes.json`. This is done automatically after the plugin instantiation, just make sure you
don't use `id` for anything else
- The plugin main class should not define any automatically-defined API functions. See **Interface ``[EXISTS] YourPLuginClass::``** below.

### Interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `plugin(id)`
Retrieve an instantiated plugin by its id.

#### `addPlugin(id, PluginRootClass)`
This (global) function will register the plugin and initialize it. It will make sure that
- an instance of `PluginRootClass` is created
- `id` member variable is set
- the API is correctly configured
    - this is mainly for the plugin itself, in case you want to use `on...=""` HTML attributes where you need to access the plugin from the global scope
    - you can do things like 
      > let html = \`\<tag onclick="plugin('${this.id}').callMyPluginFunction(...)"\>\`;
- in case `pluginReady` function within the plugin main class is defined, it will be invoked when the visualisation is ready

>
> You can register the plugin anonymously if you do not need the class namespace:
> ``` 
> addPlugin("user-session", class {
>      ...
> });
> ```
>

#### `YourPLuginClass::constructor(id, params)`
The plugin main class is given it's `id` and `params` object, use them as you wish. `params` object
is integrated within the system and gets exported - such information is available when sharing the plugin
exports. Note that the object should not be used to store big amounts of data, for that use general viewer 
event `export-data` together with `APPLICATION_CONTEXT::getData()` should be used.

#### `YourPLuginClass::pluginReady()`
You can define this function, and it will get invoked once the plugin is fully ready.
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
Returns stored value if available, supports cookie caching and the value gets automatically exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. For cookie support, prefer this method.
Available _after_ constructor.

#### \[EXISTS\] `YourPLuginClass::setOption(key, value, cookies=true)`
Stores value under arbitrary `key`, caches it, if allowed within cookies The value must be already serialized as a string
(constants are OK since they can be converted naturally). The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor. For cookie support, prefer this method.
Available _after_ constructor.

#### \[EXISTS\] `YourPLuginClass::staticData(key)`
Return data from ``include.json`` together with other data such as the folder the plugin lives in. It is mainly
meant to retrieve the JSON values. Available _before_ constructor.

### Global API
Avoid touching directly any properties, attaching custom content to the DOM or inventing your own
approaches - first, get familiar with:
 - `window.VIEWER` 
    - OpenSeadragon and `OpenSeadragon.Tools` (accessible as `VIEWER.tools`) API
    - WebGL API of the layers group (accessible through `VIEWER.bridge`)
    - events invoked on the VIEWER
 - `window.APPLICATION_CONTEXT`
    - note that this interface is meant for inner logic and you probably do not need to access it
    - to access the configuration, should be used in read-only manner: `APPLICATION_CONTEXT.config`
    - to access the viewer parameters, use `[set|get]Option(...)` method
 - `window.USER_INTERFACE`
    - API for dealing with application UI - menus, tutorials, inserting custom HTML to DOM...
 - `window.UIComponents`
    - building blocks for HTML structures, does not have to be used but contains ready-to-use building blocks
 - `window.UTILITIES`
    - functional API - exporting, downloading files, refreshing page and many other useful utilities
    - especially fetching is encouraged to use through ``UTILITIES.fetchJSON(...)``
  
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
### Caveats
The plugins should integrate into exporting/importing events, otherwise the user will have to re-create
the state on each reload - which might be fatal wrt. user experience. Also, you can set dirty state
using ``APPLICATION_CONTEXT.setDirty()`` so that the user gets notified if they want to leave.

Furthermore, the layout canvas setup can vary - if you work with canvas in any way relying on dimensions
or certain tile sources, make sure you subscribe to events related to modification of the canvas and update
the functionality appropriately. Also, **do not store reference** to any tiled images or sources you do not control.
Instead, use ``VIEWER.tools.referencedImage()`` to get to the _reference_ Tiled Image: an image wrt. which
all measures should be done.

 
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
