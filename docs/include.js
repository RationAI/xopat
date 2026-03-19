/**
 * TODO - Move to utils
 * 
 * Generates list of source files for documentation out of the ENV configuration.
 * For now, static only.
 */


'use strict';
var fs = require("fs");
var path = require("path");
const { parse } = require('comment-json');
const parseJsonFile = (file, ...args) => {
    try {
        return parse(fs.readFileSync(file).toString(), ...args);
    } catch (e) {
        throw `Error in '${file}'! ${e}`;
    }
}
const flatten = (obj) => typeof obj === "object" ? [].concat(...Object.values(obj).map(flatten)) : obj;
//prepare source files, parse config
const config = parseJsonFile('src/config.json');

function listFilesRecursive(rootDir, exts, ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'docs']) {
    const out = [];
    const stack = [rootDir];
    const extSet = new Set(exts.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));
    const ignoreSet = new Set(ignoreDirs);

    while (stack.length) {
        const dir = stack.pop();
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                if (!ignoreSet.has(name)) stack.push(full);
            } else {
                const ext = path.extname(name).toLowerCase();
                if (extSet.has(ext)) out.push(full);
            }
        }
    }
    return out;
}

// todo UI
// const uiSources = listFilesRecursive('ui', ['mjs', 'ts']);

// add your extensions if necessary, by default all except 'js' have only extracted comments
const allowedExtensions = ['js', 'json', 'css', 'mjs'];
module.exports = {
    //source javascript files and README
    files: [
        ...flatten(config.js.external).map(x => `src/external/${x}`),
        ...flatten(config.js.src).map(x => `src/${x}`),
        // todo: fix UI comments and add to docs ...uiSources,
        'README.md',
        //other things we want to keep in docs, need @fileoverview tag, input as opts: {include: X }
        // 'src/assets/style.css',
        'src/config.json',
    ],
    allowedExtensions: allowedExtensions,
    destination: './docs/build',
    pattern: `\\.(${allowedExtensions.join('|')})$`
};
