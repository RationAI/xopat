/**
 * Lets JSDoc read the TypeScript sources directly.
 *
 * xOpat's core, and a growing share of modules/plugins, are `.ts`. JSDoc 4 has
 * no TypeScript support, so the documented sources used to be the *build output*
 * under `src/dist/` — esbuild keeps only about half the doc comments and none of
 * the file structure, which is why the generated API reference listed a handful
 * of globals instead of the actual API.
 *
 * Two things are needed, and both are small enough to do here rather than adding
 * a toolchain:
 *
 * 1. JSDoc parses with `@babel/parser` and exports its options object
 *    (`jsdoc/src/astbuilder`). Pushing the `typescript` plugin onto it makes the
 *    parser accept `.ts` as-is — comments, names and structure intact.
 *
 * 2. JSDoc's AST walker assumes every function node has a body. TypeScript has
 *    body-less function nodes that plain JS does not: overload signatures
 *    (`async count(): Promise<number>;` ahead of the implementation),
 *    `declare function`, `declare class`. The walker calls `cb(node.body)`
 *    unconditionally and dies with `Cannot set properties of undefined
 *    (setting 'parent')`. Rather than guess at every such node type, the walk
 *    callback is wrapped once to ignore absent children — which also covers
 *    array-destructuring holes (`const [, x] = y`), a plain-JS crash of the same
 *    shape.
 *
 * TypeScript-only declarations (interfaces, type aliases, enums) are simply not
 * documented: JSDoc logs an unrecognized node type at debug level and skips it.
 * Document those with a `@typedef` where they matter.
 */
'use strict';

const astbuilder = require('jsdoc/src/astbuilder');
const { Walker } = require('jsdoc/src/walker');

if (!astbuilder.parserOptions.plugins.includes('typescript')) {
    astbuilder.parserOptions.plugins.push('typescript');
}

// `new Walker()` defaults to the module-level walker table, and the parser's own
// walker holds a reference to that same object — so patching it here, before any
// file is parsed, patches the walk that actually runs.
const walkers = new Walker()._walkers;
for (const type of Object.keys(walkers)) {
    const walk = walkers[type];
    walkers[type] = (node, parent, state, cb) =>
        walk(node, parent, state, (child, childParent, childState) => {
            if (child) {
                cb(child, childParent, childState);
            }
        });
}
