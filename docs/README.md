# Documentation

Run ``grunt docs``. Running `jsdoc` task will not work with clean state.
Then watch the website on `localhost:9000`.

You can use custom themes, you can provide the path to the configuration file
as ``grunt docs:<path>``, e.g., ``grunt docs:./docs/jsdoc-ink.config.js``. 
Configuration files must be a javascript files that export the configuration
````js
const {files, destination} = require('./include');

module.exports = {
    source: {
        include: files
    },
    opts: {
        destination,
        ...
    },
    ...
};
````
You also need to install the theme by ``npm i <theme> (--save-dev)``.
