# JavaScript Server Template

This template has (like PHP implementation) three main components:
 - core
 - modules
 - plugins

Each component returns a function that will return an execution environment of the server.
The correct usage is given as such:

````js
const i18n = require('i18next');
//i18n must be initialized. Errors from core are not translated,
//other parts of the system are translated and require i18next
//note that

// Function interface definition
function fileExists(path) {
    return [/path is a valid file on this filesystem/];
}
function readFile(path) {
    return [/string contents of the file at given path, or undefined/];
}
function readEnv(name) {
    return [/contents of the environmental variable name, case sensitive/];
}
function scanDir(path) {
    return [/array of names of files and folders inside directory 'path'/];
}

const core = require('path/to/core.js')(
    //provide required arguments to the core callback
    absPath, //absolute path of the xopat directory
    projectRoot, 
    fileExists, 
    readFile, 
    readEnv
);
require('path/to/plugins.js')(
    //plugins will require modules automatically
    core, 
    fileExists,
    readFile,
    scanDir,
    i18n
);

//now core, modules and plugins are ready for usage
````

A ``core.exception`` property is available in case of serious error. You
can decide to respect this property and act accordingly, or just continue.
