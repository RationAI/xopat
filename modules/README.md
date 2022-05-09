# Modules

Are basically plugins for plugins - available extensions and libraries.
For the available API you can see README of plugins, but anything related to
MUST DO's or plugin ID does not apply.



## `include.json`
It's structure is similar, however, you have no access to the values of
this configuration at runtime and the set-up should be more or less static,
so that plugins can rely on the behaviour. Instead of `modules` here we can
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
