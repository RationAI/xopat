/**
 * Keeps file-local implementation details out of the API reference.
 *
 * JSDoc has no model of ES module scope: every documented module-scope symbol
 * becomes a *global*. xOpat's sources are heavily commented for code readers, so
 * documenting them wholesale buries the 100-odd real classes under several
 * hundred file-local helpers, timeouts and z-index constants.
 *
 * The rule applied here: in a file that is an ES module (it has a top-level
 * `import` or `export`), a module-scope symbol is part of the API only if it is
 * exported, or if the file publishes it on `window` / `globalThis` — which is how
 * most of xOpat's API is actually reachable. Everything else is marked
 * undocumented and dropped by `helper.prune`.
 *
 * Classic scripts (no import/export anywhere — `src/user-interface.js`,
 * `src/layers.js`, …) are left alone: there, a global really is a global.
 *
 * Members of a class or namespace are untouched; only top-level symbols are
 * judged, so a documented method never disappears because its class is local.
 */
'use strict';

const IS_MODULE = /^[ \t]*(?:import|export)[\s{*]/m;

const DECLARED_EXPORT = /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s*(?:type\s*)?\{([^}]*)\}/g;
const EXPORT_DEFAULT_IDENT = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*[;\n]/g;
/** `window.X = y`, `globalThis.X = y`, `(window as any).X = y`. */
const GLOBAL_ASSIGN = /(?:window|globalThis)[^.\n]{0,24}\.\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)?/g;

/** filename -> Set of names that count as public, or null for a classic script. */
const publicNames = new Map();

function collect(source) {
    if (!IS_MODULE.test(source)) return null;

    const names = new Set();
    let m;
    while ((m = DECLARED_EXPORT.exec(source))) names.add(m[1]);
    while ((m = EXPORT_DEFAULT_IDENT.exec(source))) names.add(m[1]);
    while ((m = EXPORT_LIST.exec(source))) {
        for (const entry of m[1].split(",")) {
            const parts = entry.trim().split(/\s+as\s+/);
            for (const part of parts) {
                const name = part.trim().replace(/^type\s+/, "");
                if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
            }
        }
    }
    while ((m = GLOBAL_ASSIGN.exec(source))) {
        names.add(m[1]);
        if (m[2]) names.add(m[2]);
    }
    return names;
}

exports.handlers = {
    beforeParse(e) {
        publicNames.set(e.filename, collect(e.source));
    },

    newDoclet({ doclet }) {
        if (doclet.undocumented || doclet.scope !== "global") return;

        const filename = doclet.meta && doclet.meta.path
            ? require("path").join(doclet.meta.path, doclet.meta.filename)
            : null;
        if (!filename || !publicNames.has(filename)) return;

        const names = publicNames.get(filename);
        if (names === null) return;   // classic script: every global is real

        if (!doclet.name || !names.has(doclet.name)) {
            doclet.undocumented = true;
        }
    }
};
