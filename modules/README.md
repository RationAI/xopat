# Modules

Dynamic `PHP` scripting allows for painless module insertion. A module is just a wrapping flexibility over javascript
 libraries that are not necessarily loaded and on which some plugins or the visualization might be dependent (otherwise, 
 always-required JS files are manually added to the html `<head>`).
 Each module must be in its own folder placed here. Inside, one file must exist (otherwise the module won't load):

## Available modules

### - `webgl`
Module for WebGL-based post-processing of images. Supports arrays of images concatenated into one image vertically.
Multiple images can be post-processed using various strategies (which can be dynamically changed) and the result is
blended into one resulting image. Works both with WebGL2 and WebGL1 (fallback strategy). This module is
heavily used in the core visualisation in case `visualization` parameter is set.


## `include.json`
Since we're in `JavaScript`, a `JSON` file is required that defines the module and it's inclusion:

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
- `id` is a required value that defines module's ID
- `name` is the module name 
- `includes` is a list of JavaScript files relative to the module folder to include 
- `requries` array of id's of another modules that must be already loaded before this module 

