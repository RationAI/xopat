'use strict';
// !! Specify paths against the repository root !!

//todo use custom plugin to add meta to plugins/modules etc: https://jsdoc.app/about-plugins.html

//requires taffydb
const {files, destination, allowedExtensions, pattern} = require("./include");
module.exports = {
    source: {
        include: files,
        includePattern: pattern,
    },
    options: {
        destination: './docs/build/',
        //created dynamically from JS
        configure: './docs/build/docs.conf.json',
        private: false
    },
    tags: {
        allowUnknownTags: true
    },
    plugins: [ "./docs/plugins/include-as-comments-only.js"],
    templates : {
        cleverLinks : true,
        monospaceLinks : false,
        default : {
            outputSourceFiles : true
        },
        openseadragon : {
            logMode : false,
            debugMode : false,
            useHighlightJs : true,
            useLongnameInNav: true
        }
    },
    opts: {
        "template": "./docs/doctemplates/openseadragon",
        "encoding": "utf8",
        "destination": destination,
        "recurse": true,
        "linenumber": true,
        // "tutorials": "path/to/tutorials",
        "include-as-comments-only": {
            "extensions": allowedExtensions.filter(ext => ext !== "js")
        }
    }
}
