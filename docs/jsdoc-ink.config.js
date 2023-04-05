'use strict';
//used from root context
//need to instal the jsdoc ink theme for using this
const {files, destination} = require('./include');
module.exports = {
  "tags": {
    "allowUnknownTags": true,
    "dictionaries": ["jsdoc"]
  },
  "source": {
    "include": files
  },
  "plugins": [
    "plugins/markdown"
  ],
  "templates": {
    "logoFile": "",
    "cleverLinks": false,
    "monospaceLinks": false,
    "dateFormat": "ddd MMM Do YYYY",
    "outputSourceFiles": true,
    "outputSourcePath": true,
    "systemName": "DocStrap",
    "footer": "",
    "copyright": "DocStrap Copyright © 2012-2015 The contributors to the JSDoc3 and DocStrap projects.",
    "navType": "vertical",
    "theme": "cyborg",
    "linenums": true,
    "collapseSymbols": false,
    "inverseNav": true,
    "protocol": "html://",
    "methodHeadingReturns": false
  },
  "opts": {
    "destination": destination,
    "encoding": "utf8",
    "private": true,
    "recurse": true,
    "template": "./node_modules/docs-ink"
  }
};
