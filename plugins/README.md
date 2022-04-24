# Plugins

Dynamic `PHP` scripting allows for painless plugin creation, insertion and dependency deduction. A plugin must be in its own folder placed
 here (`./plugins/`). Inside, one file must exist (otherwise the plugin won't load):
 
### `include.json`
Since we're in `JavaScript`, a `JSON` file is required that defines the plugin and it's inclusion:

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
    "flag": null,
    "requires": [],
    "modules": []
}
````
- `id` is a required value that defines plugin's ID as well as it's variable name (everything is set-up automatically)
- `name` is the plugin name 
- `description` is a text displayed to the user to let them know what the plugin does: it should be short and concise
- `includes` is a list of JavaScript files relative to the plugin folder to include 
- `flag` can be either `null` (the plugin is included implicitly) or a keyword, in that case the plugin is included only and only
if `GET` or `POST` data contains `keyword` with value `1`
- `requries` array of id's of all plugins that must be already loaded before this plugin, because this plugin uses them
    - note that these plugins might not be loaded at all, the plugin must be able to handle it
- `modules` array of id's of required modules (libraries)
    - note that in case the library is probably not useful to the whole system, include it internally via the plugin's `"includes"` list

> Everything you define in this file is accessible through `PLUGINS` object interface, so it is a good place to also define your own
>proprietary static configuration for example.

You can than find the plugin instance stored in `PLUGINS["plugin_id"]`.

### Must do's
- A plugin must have its id in a member variable named after `id` from `includes.json`.
    - e.g. `constructor() { this.id='myPluginId'; }'`
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object, then call `addPlugin('myPluginId', MyAwesomePlugin);` on a global level
- Any attached HTML to the DOM must be attached by the provided functionality (see `PLUGINS` variable)


### Global interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `addPlugin(id, PluginRootClass)`
This function will register the plugin and initialize it. It will make sure that
- an instance of `PluginRootClass` is created
- `id` member variable is correctly set
- global space contains the plugin instance in a variable named after `plugin.id`
    - this is mainly for the plugin itself, in case you want to use `on...()` HTML properties where you need to access the plugin from the global scope
    - you can do things like 
      > let html = \`\<tag onclick="${this.id}.callMyPluginFunction(...)"\>\`;
- `PLUGINS[plugin.id].instance` contains the plugin instance
- in case `pluginReady` is defined, it will be invoked when the visualisation is ready

#### `YourPLuginClass::pluginReady()`
Because of dynamic loading and behaviour, it is necessary that you do most initialization
in this function instead of the constructor, especially if
 - you access any **properties from the visualisation API**
 - you access any **properties of other plugins**
 - you access global scope **of your own plugin's _other files_**!

Yup, that's right. It is not safe to access even your own plugin auxiliary classes from constructor.
There is a deadlock (unless they are in the same file):
 - your plugin inner classes should be registered within one (main) class namespace
 - your main class script (often) calls `addPlugin(...)`
 - which invokes the Main class constructor that instantiate auxiliary classes
 - but Main class must have been included (and executed) first since auxiliary classes extend it's namespace


#### `PLUGINS`
This global variable contains a lot of useful references, functions require you to pass `pluginId` parameter so that in case of failure, your plugin can be safely removed from the application:
- `osd` Instance of underlying OpenSeadragon
- `seaGL` Instance of underlying OpenSeadragon GL library
- `addTutorial(pluginId, title, description, icon, steps)` - add tutorial series, icon is an identifier icon string from material design (google) icons, steps is an array of objects that define the tutorial, for more info see [how are steps defined](https://github.com/xbsoftware/enjoyhint).
- `appendToMainMenu(title, titleHtml, html, id, pluginId)` - both this and following two functions below allow for insertion of `HTML` into the Main Panel
- `appendToMainMenuRaw(html, id, pluginId)` - if you need more freedom, we recommend using one of the other two functions
- `appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId)`
    - `title`: plugin title to display
    - `titleHtml`: html to append after title
    - `html`: body of the plugin control panel, always visible
    - `hiddenHtml`: body of the plugin control panel, visible on hover onlyor when pinned
    - `id`: id that is given to the outer container, see *Hints* below for example 
    - `pluginId`: id of your plugin (i.e `this.id` variable within your plugin)
- `addHtml(html, pluginId, selector="body")` - append custom `html` to a jQuery `selector`, providing an `pluginId` your plugin ID for safe removal, the html must have `containerId` id container, common root for all the provided html 

- `postData` - JSON variant of `PHP`'s `$_POST` variable, data sent inside a `POST` request
- `addPostExport(name, callback, pluginId)` - when the visualisation is being exported, append the output `string` value of `callback` (should not contain `'` character) into `POST` data with name `name` (should be unique)
    - e.g. if you want to find `myValue` in `postData`, register: `UTILITIES.addPostExport("myValue", this.valueCallback.bind(this));` where we bind this to the callback so that it can access our plugin instance using `this`
- `each` - object of **plugin id** to other **plugin data** mapping, contains all available plugins (even those not loaded)
    - if a plugin is loaded, you will find the plugin instance under `PLUGIN.each["pluginId"].instance`
    - there are all variables from plugin's `include.json` file
    - `loaded` indicate whether the plugin was loaded
- `setDirty()` that makes the application to prevent from accidental closing, unless it ahs been exported

### Available functionality (hard-wired modules)
You can use
 - [jQuery](https://jquery.com/), 
 - [OpenSeadragon](https://openseadragon.github.io/docs/) utilities (working with points etc.), 
 - [Material design icons](https://fonts.google.com/icons?selected=Material+Icons)
 for icons (use `<span>`) and 
 - [Primer CSS bootstrap](https://primer.style/css).
 
### Hints
If you have a panel registered under your ID, you can use `loading` class to show a loading spinner
````JavaScript
appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
$(`#${id}`).addClass("loading");
````
---
It is a good idea to perform most of the initialization bussiness logic in `pluginReady()` function, rather than constructor.
Use the constructor to initialize your objects, add your UI to the main panel etc.
---
Use 
````JavaScript
let html = `<button class="btn" onclick="${this.id}.myPluginRootClassMethod();">Click me</button>`;
````
to call your plugin's methods from the UI. Alternatively, fetch your element by it's ID and add
the event programmatically. `this.id` should be set (by the API design) to your plugin ID, as registered in
the `include.json` file.

### Styling with CSS
If you want to use CSS, please, first rely on _Primer CSS_ bootstrap (https://primer.style/css) using class styling. 
If you need your own CSS file anyway, you can create in your plugin root directory `style.css` - this file will be
automatically included.
