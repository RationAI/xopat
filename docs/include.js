/**
 * Generates list of source files for documentation out of the ENV configuration.
 * For now, static only.
 */


'use strict';
var fs =require("fs");
const { parse } = require('comment-json');
const parseJsonFile = (file, ...args) => {
    try {
        return parse(fs.readFileSync(file).toString(), ...args);
    } catch (e) {
        throw `Error in '${file}'! ${e}`;
    }
}
const flatten = (obj) => typeof obj === "object" ? [].concat(...Object.values(obj).map(flatten)) : obj;

//include only webGL for now
const webglConfig = parseJsonFile('modules/webgl/include.json');

//prepare source files, parse config
const config = parseJsonFile('src/config.json');
module.exports = {
    files: [
        ...flatten(config.js.external).map(x => `src/external/${x}`),
        ...flatten(config.js.src).map(x => `src/${x}`),
        ...flatten(webglConfig.includes).map(x => `modules/webgl/${x}`),
        'config_meta.js',
        'README.md'
    ],
    destination: './docs/build'
};
