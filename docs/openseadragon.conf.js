'use strict';
// !! Specify paths against the repository root !!

//requires taffydb
const {files, destination} = require("./include");
module.exports = {
    source: {
        include: files
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
    plugins : [],
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
    }
}
