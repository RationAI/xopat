# Plugins

Dynamic `PHP` scripting allows for painless plugin creation and insertion. A plugin must be in its own folder placed
 here (`./plugins/`). Inside, one file must exist (otherwise the plugin won't load):
 
### `includes.json`
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
if `GET` or `POST` variable contains `keyword` with value `1`
- `priority` is a number that defines the load order among other plugins (greater number is loaded later and thus has more content available)
- `requries` can be either null or a string that describes an id of another plugin that must be already loaded before this plugin (we don't expect
multiple plugins dependency but in future, this could be also an array)

### Must do's
- A plugin must define on global scope its instance in a variable named after `id` from `includes.json`.
- A plugin must attach it's instance into `PLUGINS.each.[plugin id]` object as a key `instance`
- A pluing must attach HTML elements only using.... or append to a global `body` tag.

### Global interface
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `PLUGINS`
This global variable contains a lot of useful references:
- `osd` Instance of underlying OpenSeadragon
- `seaGL` Instance of underlying OpenSeadragon GL library
- `imageLayer` Instance of `TiledImage` - OSD Class, a root for the tissue visualisation layer (0)
- `dataLayer` Instance of `TiledImage` - OSD Class, a root for the data visualisation layer (1)
- `controlPanelId` - `HTML` id for the Main Panel
- `postData` - JSON variant of `PHP`'s `$_POST` variable
- `each` - object of **plugin id** to other **plugin `includes` data** mapping

#### `redraw()`
This function will trigger re-drawing of the whole data layer.

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