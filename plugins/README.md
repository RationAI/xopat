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

### Must do's
- A plugin must define on global scope its instance in a variable named after `id` from `includes.json`.
    - e.g. `var myAwesomePluginId = new MyAwesomePlugin(...);`
- A plugin must attach it's instance into `PLUGINS.each[plugin id]` object as a key `instance`.
    - e.g. `PLUGINS.each['myAwesomePluginId'].instance = this;` in constructor
- A plugin must attach HTML elements only using functions from `PLUGINS` global variable described below, or append directly to a global `body` tag.

### Global interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `PLUGINS`
This global variable contains a lot of useful references:
- `osd` Instance of underlying OpenSeadragon
- `seaGL` Instance of underlying OpenSeadragon GL library
- `imageLayer` Instance of `TiledImage` - OSD Class, a root for the tissue visualisation layer (0)
- `dataLayer` Instance of `TiledImage` - OSD Class, a root for the data visualisation layer (1)
- `appendToMainMenu(title, titleHtml, html, id)` - both this and functions below allow for insertion of `HTML` into the Main Panel
- `appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id)`
    - `title`: plugin title to display
    - `titleHtml`: html to append after title
    - `html`: body of the plugin control panel, always visible
    - `hiddenHtml`: body of the plugin control panel, visible on hover onlyor when pinned
    - `id`: id that is given to the outer container, you can for example delete the panel later 
- `appendToMainMenuRaw(html, id)` - if you need more freedom, we recommend to use functions above if possible
- `postData` - JSON variant of `PHP`'s `$_POST` variable, data sent inside a `POST` request
- `addPostExport(name, callback)` - when the visualisation is being exported, append the output `string` value of `callback` (should not contain `'` character) into `POST` data with name `name` (should be unique)
    - e.g. if you want to find `myValue` in `postData`, register: `PLUGINS.addPostExport("myValue", this.valueCallback.bind(this));` where we bind this to the callback so that it can access our plugin instance using `this`
- `each` - object of **plugin id** to other **plugin `includes` data** mapping

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

### Good to know
Some variables exist only after the full initialization of OpenSeadragon. For safe initialization, create the instance
at the end of script and use a custom initialization function that is called when OSD is ready:
````
PLUGINS.osd.addHandler('open', function() {
	...
});
````