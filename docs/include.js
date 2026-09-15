/**
 * TODO - Move to utils
 *
 * Builds the list of source files the API reference is generated from.
 *
 * These are the **sources**, not the build output. xOpat's core is TypeScript and
 * `docs/plugins/typescript-support.js` teaches JSDoc to read it directly; pointing
 * the generator at `src/dist/*` instead (as this file used to) documents esbuild's
 * output, which keeps roughly half the doc comments and none of the file structure.
 *
 * Everything under `src/libs/` is vendored and deliberately not documented here.
 */


'use strict';
var fs = require("fs");
var path = require("path");

/**
 * Roots scanned for documentable sources, relative to the repository root.
 * Order decides nothing; the scan result is sorted.
 */
const ROOTS = ['src', 'ui'];

/** Directory names never descended into, at any depth of any root. */
const IGNORED_DIRS = new Set([
    'node_modules', '.git',
    'libs',          // vendored libraries — see AGENTS.md §0.6
    'dist', 'build', '.server-dist', '.dev-cache',   // build output
    'test', 'tests', '__image_snapshots__',
    'docs', 'locales', 'assets',
]);

/**
 * Files skipped by name: type declarations carry no implementation to document,
 * and the rest are generated bundles that happen to sit outside a `dist/`.
 */
const IGNORED_FILES = [
    /\.d\.ts$/,
    /\.min\.(js|mjs)$/,
    /\.workspace\.(js|mjs)$/,
    /(^|[\\/])ui[\\/]index\.js$/,      // the built UI bundle
    /(^|[\\/])src[\\/]dist[\\/]/,      // defensive: never document build output
];

/** Extensions parsed as code. Everything else is comment-extraction only. */
const CODE_EXTENSIONS = ['js', 'mjs', 'ts'];

/**
 * Extensions accepted at all. Non-`js` ones are stripped to their comments by
 * `docs/plugins/include-as-comments-only.js`, so a `@fileoverview` in a JSON or
 * CSS file still reaches the docs.
 */
const allowedExtensions = [...CODE_EXTENSIONS, 'json', 'css'];

function listFilesRecursive(rootDir, exts) {
    const out = [];
    const stack = [rootDir];
    const extSet = new Set(exts.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));

    while (stack.length) {
        const dir = stack.pop();
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            let stat;
            try {
                stat = fs.statSync(full);
            } catch (e) {
                continue; // broken symlink (elements linked in from their own repo)
            }
            if (stat.isDirectory()) {
                if (!IGNORED_DIRS.has(name) && !name.startsWith('.')) stack.push(full);
            } else if (extSet.has(path.extname(name).toLowerCase())) {
                if (!IGNORED_FILES.some(re => re.test(full))) out.push(full);
            }
        }
    }
    return out;
}

const sources = ROOTS
    .filter(root => fs.existsSync(root))
    .flatMap(root => listFilesRecursive(root, CODE_EXTENSIONS))
    .sort();

module.exports = {
    //source javascript files and README
    files: [
        ...sources,
        'README.md',
        //other things we want to keep in docs, need @fileoverview tag, input as opts: {include: X }
        // 'src/assets/style.css',
        'src/config.json',
    ],
    allowedExtensions: allowedExtensions,
    destination: './docs/build',
    pattern: `\.(${allowedExtensions.join('|')})$`
};
