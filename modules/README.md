# Modules

Are basically plugins for plugins - available feature extensions, libraries.
Basically, there are two types of modules: 'extensions' and 'xOpat modules'.
Modules are defined in ``include.json`` in this folder.
#### `include.json`
It's structure is similar to plugin's, but instead of `modules` key we 
define a dependency on other modules with `requires` key - also accepts a list of modules. Circular
dependencies are detected and result in error.
````json
{
    "id": "module_id",
    "name": "Module Name",
    "includes" : [
        "dependency1.js",
        "dependency2.js",
        "implementation.js"
    ],
    "requires": []
}
````
Using third party hosted scripts: an include array item should (instead of a string) look like this:
````json
{
    "src": "https://host.xy/file.js",
    "integrity": "hashalgo-hashofthefilesothatitsintegrityisverified",
    "crossOrigin": "anonymous"
}
````
Note that this is meant mainly for a module/deployment maintainer to set-up the plugin default, static configuration.
Moreover, it is advised to use ENV setup (see `/env/README.md`) to override necessary configurations. 
- `id` is a required value that defines module ID as well as it's variable name (everything is set-up automatically)
- `name` is the module name
- `description` is a text displayed to the user to let them know what the module does: it should be short and concise
- `author` is the module author
- `includes` is a list of JavaScript files relative to the module folder to include
- `requires` array of id's of required modules (libraries)
- `enabled` is an option to allow or disallow the module to be loaded into the system, default `true`
- `permaLoad` always loads the module within the system if set to `true`, default `false`

#### Basic DO's
The integration to the global scope, application etc. is left to the module itself.
You should not pollute the global scope (`window`...) and follow the following:
 - attach itself to a hierarchy of existing dependencies if you depend on them logically
    - OSD snapshots and OSD plugins usually attach themselves to ``window.OpenSeadragon`` 'namespace'
 - otherwise, add only few new elements to the ``window`` object (especially make sure these are visible, later 
 modules and plugins will be included in `<script>` mode `module`)
    - prefer the use of XOpat API where possible
    - extend with helper classes your main class namespace
    - expose only what's needed, possibly instantiate as singleton if the module should exist just once, such as annotations canvas
 - any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
    - avoid working with HTML in modules where possible - modules should implement logics, not UI
    - if you need to add HTML to DOM, think rather about splitting your implementation to the module (logics) and
    a plugin (UI)
 - do not add HTML to DOM directly (unless you operate a new window instance), use ``window.USER_INTERFACE`` API instead

> **IMPORTANT.** Please respect the viewer API and behavior. Specifically, 
> respect the ``APPLICATION_CONTEXT.secure`` flag parameter
> and provide necessary steps to ensure secure execution if applicable.
    
## Modules: Extensions
Extensions are unconstrained code libraries with no (or little) constrains; but without features. Only basic rules 
above apply; the module is self-organizing. Note that many features (translation, data IO, access to metadata) is
not supported. Example are `colormaps`, adding only a dictionary of static data definition, or `webgl` module that
is implemented in a way not relying on xOpat core which makes it use-able with any OpenSeadragon library. 

The text 
below describes ``xOpat Modules`` features only.

## Modules: xOpat Modules
More advanced modules extend one of ``XOpatModule`` or `XOpatModuleSingleton` classes that provide numerous features 
(localization, metadata and options data access, IO support and more). Should the plugin create and export data,
the ``XOpatElement`` API should be used so that IO is handled flawlessly.


### Interface XOpatModule
Modules that inherit from `XOpatModule` support following features:
````js
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
 * Root to the modules folder
 */
static ROOT;
````

### Interface XOpatModuleSingleton extends XOpatModule
Modules that inherit from `XOpatModuleSingleton` should instantiate the module as `ModuleClass.instance()`.
````js
/**
 * Get instance of the annotations manger, a singleton
 * (only one instance can run since it captures mouse events)
 * @static
 * @return {XOpatModuleSingleton} manager instance
 */
static instance();
/**
 * Check if instantiated
 * @return {boolean}
 */
static instantiated();
````

### Selected global API functions todo consider getOption shift to classes
#### `APPLICATION_CONTEXT::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. Default value can be ommited
for build-in defaults, defined in the viewer core.

#### `APPLICATION_CONTEXT::setOption(key, value, cache=true)`
Stores value under arbitrary `key`, caches it if allowed. The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor.

#### `APPLICATION_CONTEXT::getData(key)`
Return data exported with the viewer if available. Exporting the data is done through events.


### Events
Modules (and plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events require OpenSeadragon.EventSource implementation (which it is based on).

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

> Modules must not wait with initialization after locales had been loaded: modules define dependency trees that
>are not explicitly synchronized. For delayed translations, ``$.localize([selector])`` of `jqueryI18next` might be useful.
>However, most modules should act only when needed: instantiate your module after it had been used, then you are
>guaranteed your locales had been loaded if you did so at the module inclusion time.


### IO Handling with global modules
``bindIO`` method is available that explicitly enables IO within a module. The module should have
explicit impact on the viewer and load data only when requested, so leave this method call to the
code using your module if possible.
todo docs
The example below shows how to implement IO within a module with proper function overrides.
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

## Dynamic Loading
As workers and js modules (recommended usage), the viewer does not offer advanced tools for
loading these scripts dynamically. You need to use **relative** file names and instantiate
your worker or import a module. Relative paths must begin in the repository root. With plugins and
modules, the easiest way is to extend appropriate interface and retrieve ``this.PLUGIN_ROOT`` or
``this.MODULE_ROOT`` respectively, against which you can import local files.

## Caveats
Modules should support IO, otherwise the user will have to re-create
the state on each reload - which might be fatal wrt. user experience. Also, you can set dirty state
using ``APPLICATION_CONTEXT.setDirty()`` so that the user gets notified if they want to leave.

Furthermore, the layout canvas setup can vary - if you work with canvas in any way relying on dimensions
or certain tile sources, make sure you subscribe to events related to modification of the canvas and update
the functionality appropriately. This includes:
 - tissue image swapping
 - visualization swapping
 
Also, **do not store reference** to any tiled images or sources you do not control.
Instead, use ``VIEWER.scalebar.getReferencedTiledImage();`` to get to the _reference_ of a Tiled Image: an image wrt. which
all measures should be done.

## Gotchas
Check plugin's README in case you did not. The available API is described there to greater detail.

#### Default IO
A plugin or a module can export data either with custom logics based on events, or by built-in
export system. This system is handy since it will automatically integrate file-like IO behavior
within your application via HTTP POST.

All you need to do is to override ``exportData`` and `importData` methods in the element root class
and call ``this.initPostIO()`` at the startup. If you want to have a custom logics with the IO initialization,
you can override the initialization like this:
````js
async initPostIO() {
    const postStore = await super.initPostIO();
    if (postStore) {
        //... do something
        // e.g. read key 'key'
        const data = await postStore.get('key');
    }
    return postStore;
}
````
This might come in handy if you for example want to do additional IO initialization logics.

> **Note**: plugin & module data are namespaced in POST. If you want to send post data manually, use:
> ``module[<module_id>.key] = value;``. Nested keys are up to the module to manage for itself,
> e.g. ``module[<module_id>.parentKey.subKey] = value;``.
