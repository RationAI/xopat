# Plugins

Dynamic `PHP` scripting allows for painless plugin creation and insertion. A plugin must be in its own folder placed
 here (`./plugins/`). Inside, one file must exist (otherwise the plugin won't load):
 
### `include.json`
Since we're in `JavaScript`, a `JSON` file is required that defines the plugin and it's inclusion:

````json
{
    "id": "plugin_id",
    "name": "Plugin Name",
    "includes" : [
        "dependency1.js",
        "dependency2.js",
        "implementation.js"
    ],
    "flag": null,
    "priority": 0,
    "requires": null
}
````
- `id` is a required value that defines plugin's ID as well as it's global variable name: the plugin is thereby commiting 
to define a global variable with the same name, e.g define in the global scope:
     > var plugin_id = new MyAwesomePlugin(...);
- `name` is a plugin name 
- `includes` is a list of files relative to the plugin folder to include 
- `flag` can be either `null` (the plugin is included implicitly) or a keyword, in that case the plugin is included only and only
if `GET` or `POST` data contains `keyword` with value `1`
- `priority` is a number that defines the load order among other plugins (greater number is loaded later and thus has more content available)
- `requries` can be either null or a string that describes an id of another plugin that must be already loaded before this plugin (we don't expect
multiple plugins dependency but in future, this could be also an array)

You can than find this data stored in `PLUGINS.each["plugin_id"]`.

### Must do's
- A plugin must have its id in a member variable named after `id` from `includes.json`.
    - e.g. `constructor() { this.id='myPluginId'; }'`
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object, then call `registerPlugin(MyAwesomePlugin);` on a global level
- Any attached HTML to the DOM must be attached by the provided functionality (see `PLUGINS` variable)


### Global interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `PLUGINS`
This global variable contains a lot of useful references, functions require you to pass `pluginId` parameter so that in case of failure, your plugin can be safely removed from the application:
- `osd` Instance of underlying OpenSeadragon
- `seaGL` Instance of underlying OpenSeadragon GL library
- `imageLayer` Instance of `TiledImage` - OSD Class, the tissue visualisation layer (0), use this layer for correct coordinates conversion (and other dimensionality-related tasks) if needed
- `dataLayer` Instance of `TiledImage` - OSD Class, the data visualisation layer (1)
- `addTutorial(pluginId, title, description, icon, steps)` - add tutorial series, icon is an identifier icon string from material design (google) icons, steps is an array of objects that define the tutorial, for more info see [how are steps defined](https://github.com/xbsoftware/enjoyhint).
- `appendToMainMenu(title, titleHtml, html, id, pluginId)` - both this and following two functions below allow for insertion of `HTML` into the Main Panel
- `appendToMainMenuRaw(html, id, pluginId)` - if you need more freedom, we recommend using one of the other two functions
- `appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId)`
    - `title`: plugin title to display
    - `titleHtml`: html to append after title
    - `html`: body of the plugin control panel, always visible
    - `hiddenHtml`: body of the plugin control panel, visible on hover onlyor when pinned
    - `id`: id that is given to the outer container, you can for example delete the panel later 
    - `pluginId`: id of your plugin (i.e `this.id` variable within your plugin)
- `addHtml(html, pluginId)` - append custom `html` to a global scope, providing an `pluginId` your plugin ID for safe removal
- `postData` - JSON variant of `PHP`'s `$_POST` variable, data sent inside a `POST` request
- `addPostExport(name, callback, pluginId)` - when the visualisation is being exported, append the output `string` value of `callback` (should not contain `'` character) into `POST` data with name `name` (should be unique)
    - e.g. if you want to find `myValue` in `postData`, register: `PLUGINS.addPostExport("myValue", this.valueCallback.bind(this));` where we bind this to the callback so that it can access our plugin instance using `this`
- `each` - object of **plugin id** to other **plugin data** mapping, contains all available plugins (even those not loaded)
    - if a plugin is loaded, you will find the plugin instance under `PLUGIN.each["pluginId"].instance`
    - there are all variables from plugin's `include.json` file
    - `loaded` and `permaLoaded` properties that indicate whether the plugin was loaded without or with `GET` respectively 

#### `registerPlugin(PluginRootClass)`
This function will register the plugin and initialize it. It will make sure that
- an instance of `PluginRootClass` is created
- `id` member variable is correctly set
- global space contains the plugin instance in a variable named after `plugin.id`
    - this is mainly for the plugin itself, in case you want to use `on...()` HTML properties where you need to access the plugin from the global scope
    - you can do things like 
      > let html = \`\<tag onclick="${this.id}.callSomePluginFunction(...)"\>\`;
- `PLUGINS.each[plugin.id].instance` contains the plugin instance
- in case `openSeadragonReady` is defined, it will be invoked when the visualisation is ready
    - especially **if you access any properties from the visualisation itself**, make sure you use this feature

#### `redraw()`
This function will trigger re-drawing of the whole data layer.

### Available functionality
You can use
 - [jQuery](https://jquery.com/), 
 - [OpenSeadragon](https://openseadragon.github.io/docs/) utilities (working with points etc.), 
 - [Material design icons](https://fonts.google.com/icons?selected=Material+Icons)
 for icons (use `<span>`) and 
 - [Primer CSS bootstrap](https://primer.style/css).

### CSS
If you want to use CSS, please, first rely on _Primer CSS_ bootstrap (https://primer.style/css) using class styling. 
If you need your own CSS file anyway, you can create in your plugin root directory `style.css` - this file will be
automatically included.
