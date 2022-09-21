# Modules

Are basically plugins for plugins - available extensions and libraries.
For the available API you can see README of plugins, but anything related to
MUST DO's or plugin ID does not apply.



## `include.json`
It's structure is similar but instead of `modules` here we can
define a dependency on other modules with `requires` list.
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
The access to this file is **not enabled implicitly**, you have to explicitly
define optional key `attach` with a value of a global object: it will make the core to attach 
this file enriched by additional data (see `modules.php`) as a *`metadata`* variable.

> Note: to ensure attached metadata, make sure the provided name of an object is accessible
> via ``window`` variable: use `MyClass = class extends ...` instead of `class MyClass extends ...`

### Interface
Unlike plugins, options and data is stored on global API level, since we cannot nor want to enforce instantiation 
or other life cycle behaviour on modules. This means that modules have to care about used keys - these are on global 
level and must be unique.

#### `APPLICATION_CONTEXT::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. Default value can be ommited
for build-in defaults, defined in the viewer core.

#### `APPLICATION_CONTEXT::setOption(key, value, cookies=true)`
Stores value under arbitrary `key`, caches it if allowed within cookies. The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor.

#### `APPLICATION_CONTEXT::getData(key)`
Return data exported with the viewer if available.

#### `APPLICATION_CONTEXT::setData(key, dataExportHandler)`
Registers `dataExportHandler` under arbitrary `key`. `dataExportHandler` is a function callback that
will get called once a viewer export event is invoked. Should return a string that encodes the data to store.
The data should not contain `` ` `` character.

## Events
Modules (and possibly plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events should be invoked on the parent instance of the 'module' and
use the OpenSeadragon Event System.
