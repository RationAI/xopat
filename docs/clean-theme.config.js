'use strict';
//used from root context
//need to instal the jsdoc clean theme for using this
const {files, destination} = require('./include');
module.exports = {
  "tags": {
    "allowUnknownTags": true
  },
  "source": {
    "include": files
  },
  "plugins": ["plugins/markdown"],
  "opts": {
    "encoding": "utf8",
    "destination": destination,
    "recurse": true,
    "template": "./node_modules/clean-jsdoc-theme",
    //"tutorials": "./demo/src/tutorials",
    "theme_opts": {
      "includeFilesListInHomepage": true,
      "search": true,
      "homepageTitle": "Clean JSDoc Theme",
      "default_theme": "dark",
      // "include_css": ["./demo/src/assets/style.css"],
      // "include_js": ["./demo/src/assets/script.js"],
      // "static_dir": ["./demo/src/assets/png", "./example"],
      // "add_scripts": "function foo(){console.log('foo')} function bar() {console.log('bar')} bar(); foo();",
      // "create_style": ".test-create-style{ background: red}",
      "displayModuleHeader": true,
      "title": "clean-jsdoc-theme",
      "footer": "<div style='margin-bottom: 0.5rem;'>clean-jsdoc-theme</div> Fork: <a href='https://github.com/ankitskvmdam/clean-jsdoc-theme'>https://github.com/ankitskvmdam/clean-jsdoc-theme</a>",
      "meta": [
        {
          "name": "Author",
          "content": "Ankit Kumar"
        },
        {
          "name": "Description",
          "content": "A beautifully crafted theme for jsdoc"
        }
      ],
      "menu": [
        {
          "title": "Github",
          "id": "github",
          "link": "https://github.com/RationAI/xopat"
        }
      ],
      "codepen": {
        "enable_for": ["examples"],
        "options": {
          "js_external": "https://code.jquery.com/jquery-3.6.0.min.js",
          "js_pre_processor": "babel"
        }
      }
    }
  },
  // "templates": {
  //   "default": {
  //     "staticFiles": {
  //       "include": ["./example"]
  //     }
  //   }
  // },
  "markdown": {
    "hardwrap": false,
    "idInHeadings": true
  }
};
