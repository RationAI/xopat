/**
 * i18n-audit — localization guard.
 *
 * Two checks:
 *   1. Missing-key check: every `$.t('some.key')` / `this.t('key')` reference must
 *      resolve to a leaf in the owning locale bundle. A missing key is a real bug —
 *      at runtime i18next returns the key (or, under the loader's dummy `$.t`, its
 *      last dot segment), so the user sees `"cancel"` or `"common.cancel"` instead
 *      of `"Cancel"`. **Fatal for the core**, advisory for plugins/modules.
 *   2. Hardcoded-string heuristic (advisory): flags English string literals
 *      passed to common UI sinks (Dialogs.show, USER_INTERFACE.Errors/Status,
 *      `.title =`, `title:`, `placeholder`, `aria-label`, alert/confirm) that
 *      are NOT already wrapped in `$.t(...)`. Pass `--strict` to make fatal.
 *
 * Scope:
 *   - core: `src/`, `ui/` → keys resolve against `src/locales/en.json`.
 *   - elements: `plugins/<id>/`, `modules/<id>/` → keys resolve against that
 *     element's own `locales/en.json`, which i18next registers under the
 *     namespace `<id>`.
 *
 * Element strings reach i18next two ways, and both are checked:
 *   - `this.t('key')` — `XOpatElement.t` injects `{ns: <id>}` (src/loader.ts).
 *   - `$.t('key', {ns: '<id>'})` — the explicit form, used where no element
 *     instance is in scope (e.g. shader-layer modules).
 * A bare `$.t('key')` inside an element resolves against the CORE bundle, which
 * is legitimate for shared atoms (`common.*`), so it is validated against core.
 *
 * Element findings are advisory: this scope was added after the fact and the
 * pre-existing backlog must not block unrelated work. Promote to fatal once it
 * is clear.
 *
 * Usage:  grunt i18n-audit            (fails only on missing CORE keys)
 *         grunt i18n-audit --strict   (also fails on element keys + heuristics)
 *         npm run i18n-audit
 */
module.exports = function (grunt) {
    return function () {
        const strict = !!grunt.option("strict");
        const corePath = "src/locales/en.json";

        if (!grunt.file.exists(corePath)) {
            grunt.fail.warn(`i18n-audit: locale file not found at ${corePath}`);
            return;
        }

        /** Flatten a locale bundle into dot-notation leaf keys. */
        const flattenBundle = (bundle) => {
            const out = new Set();
            // Keys in code omit the default "translation" namespace.
            const root = bundle && bundle.translation ? bundle.translation : bundle;
            (function flatten(obj, prefix) {
                for (const k of Object.keys(obj || {})) {
                    const val = obj[k];
                    const path = prefix ? `${prefix}.${k}` : k;
                    if (val && typeof val === "object" && !Array.isArray(val)) flatten(val, path);
                    else out.add(path);
                }
            })(root, "");
            return out;
        };

        const coreKeys = flattenBundle(grunt.file.readJSON(corePath));

        // Per-element bundles, loaded lazily and memoized. A missing bundle is
        // recorded as an empty set so every key in that element is reported once
        // rather than crashing the task.
        // The i18next namespace is the element's DECLARED id, which need not
        // match its directory (`plugins/questionaire-new` declares id
        // `questionaire`). Build the id -> directory map from include.json,
        // falling back to the directory name when the file is unreadable.
        const dirIndex = { plugins: new Map(), modules: new Map() };
        for (const kind of ["plugins", "modules"]) {
            for (const inc of grunt.file.expand({ filter: "isFile" }, `${kind}/*/include.json`)) {
                const dir = inc.replace(/\\/g, "/").split("/")[1];
                let id = dir;
                try {
                    // include.json is JSONC in this repo — strip comments and
                    // trailing commas before parsing.
                    const raw = grunt.file.read(inc)
                        .replace(/^\s*\/\/.*$/gm, "")
                        .replace(/,(\s*[}\]])/g, "$1");
                    id = JSON.parse(raw).id || dir;
                } catch (e) { /* keep the directory name */ }
                if (!dirIndex[kind].has(id)) dirIndex[kind].set(id, dir);
            }
        }

        const elementKeys = new Map();
        const keysForDir = (kind, dir) => {
            const cacheKey = `${kind}/${dir}`;
            if (elementKeys.has(cacheKey)) return elementKeys.get(cacheKey);
            const p = `${kind}/${dir}/locales/en.json`;
            const set = grunt.file.exists(p) ? flattenBundle(grunt.file.readJSON(p)) : new Set();
            elementKeys.set(cacheKey, set);
            return set;
        };

        /**
         * Resolve a namespace to its bundle. A plugin and a module may share an
         * id (e.g. `annotations`), so a reference from inside one of them is
         * resolved against its own kind first.
         */
        const bundleFor = (ns, preferKind) => {
            const order = preferKind === "modules" ? ["modules", "plugins"] : ["plugins", "modules"];
            for (const kind of order) {
                const dir = dirIndex[kind].get(ns);
                if (dir && grunt.file.exists(`${kind}/${dir}/locales/en.json`)) {
                    return { kind, path: `${kind}/${dir}/locales/en.json`, keys: keysForDir(kind, dir) };
                }
            }
            return { kind: null, path: `<${ns}>/locales/en.json (no bundle found)`, keys: new Set() };
        };

        const patterns = [
            "src/**/*.js", "src/**/*.ts", "src/**/*.mjs", "ui/**/*.mjs",
            "plugins/**/*.js", "plugins/**/*.mjs", "plugins/**/*.ts",
            "modules/**/*.js", "modules/**/*.mjs", "modules/**/*.ts",
        ];
        const ignore = [
            "src/libs/**", "src/dist/**",
            "**/*.min.js", "**/*.workspace.js", "**/*.workspace.mjs",
            "**/*.workspace.js.map", "**/*.d.ts", "ui/index.js",
            // Element build output and vendored payloads.
            "**/dist/**", "**/node_modules/**", "**/*.map", "**/.config/**",
        ];
        const files = grunt.file
            .expand({ filter: "isFile" }, patterns)
            .filter((f) => !ignore.some((ig) => grunt.file.isMatch(ig, f)));

        /** `plugins/dicom/shaders/x.mjs` → `{kind: "plugins", dir: "dicom"}` */
        const elementOf = (file) => {
            const m = /^(plugins|modules)\/([^/]+)\//.exec(file.replace(/\\/g, "/"));
            return m ? { kind: m[1], dir: m[2] } : null;
        };

        // `$.t('key'` / `$.t("key"` — string-literal keys only. Dynamic keys
        // (variables / template literals) cannot be validated and are skipped.
        const globalKeyRe = /\$\.t\(\s*['"]([^'"]+)['"]([^)]*)/g;
        // `this.t('key'` / `_t('key'` — the element-scoped forms.
        const scopedKeyRe = /(?:this|self)\.t\(\s*['"]([^'"]+)['"]|(?<![\w.])_t\(\s*['"]([^'"]+)['"]/g;
        const sinkRe = /(?:Dialogs\.show|USER_INTERFACE\.(?:Errors|Status|Notifications)|\.title\s*=|title:|placeholder:|["']aria-label["']|aria-label:|\balert|\bconfirm)\s*\(?\s*['"]([^'"]{2,})['"]/g;
        // Explicit namespace on a global call: `$.t('key', {ns: 'dicom'})`.
        const nsRe = /ns\s*:\s*['"]([^'"]+)['"]/;

        const missingCore = [];
        const missingElement = [];
        const hardcoded = [];

        for (const file of files) {
            const element = elementOf(file);
            const lines = grunt.file.read(file).split(/\r?\n/);

            lines.forEach((line, idx) => {
                let m;

                globalKeyRe.lastIndex = 0;
                while ((m = globalKeyRe.exec(line)) !== null) {
                    let key = m[1];
                    let ns = null;

                    // i18next's default nsSeparator is ':' — `$.t('dicom:a.b')`
                    // is a namespaced reference, not a core key.
                    const colon = key.indexOf(":");
                    if (colon > 0) {
                        ns = key.slice(0, colon);
                        key = key.slice(colon + 1);
                    } else {
                        const nsMatch = nsRe.exec(m[2] || "");
                        if (nsMatch) ns = nsMatch[1];
                    }

                    if (ns) {
                        const bundle = bundleFor(ns, element?.kind);
                        if (!bundle.keys.has(key)) {
                            missingElement.push({ file, line: idx + 1, key: `${ns}:${key}`, bundle: bundle.path });
                        }
                    } else if (!coreKeys.has(key)) {
                        // A bare `$.t` always hits the core bundle, wherever it lives.
                        (element ? missingElement : missingCore)
                            .push({ file, line: idx + 1, key, bundle: corePath });
                    }
                }

                if (element) {
                    // `this.t` / `_t` resolve against the element's OWN bundle,
                    // which is addressed by directory here (we are inside it).
                    const ownKeys = keysForDir(element.kind, element.dir);
                    scopedKeyRe.lastIndex = 0;
                    while ((m = scopedKeyRe.exec(line)) !== null) {
                        const key = m[1] || m[2];
                        if (!ownKeys.has(key)) {
                            missingElement.push({
                                file, line: idx + 1, key,
                                bundle: `${element.kind}/${element.dir}/locales/en.json`,
                            });
                        }
                    }
                }

                // Skip the heuristic on lines that already translate.
                if (line.indexOf("$.t(") !== -1 || /(?:this|self)\.t\(|(?<![\w.])_t\(/.test(line)) return;
                sinkRe.lastIndex = 0;
                while ((m = sinkRe.exec(line)) !== null) {
                    const text = m[1];
                    if (!/[a-zA-Z]/.test(text)) continue;   // no letters -> not language
                    if (!/\s/.test(text)) continue;         // single token -> likely id/class/icon
                    if (/^[\w.\-:#/]+$/.test(text)) continue; // path/id-like
                    hardcoded.push({ file, line: idx + 1, text });
                }
            });
        }

        grunt.log.writeln(
            `i18n-audit: scanned ${files.length} files — ${coreKeys.size} core keys, ` +
            `${elementKeys.size} element bundle(s).`
        );

        if (hardcoded.length) {
            grunt.log.subhead(`Possible hardcoded user-facing strings (${hardcoded.length}) [advisory]:`);
            for (const h of hardcoded) grunt.log.warn(`${h.file}:${h.line}  "${h.text}"`);
        }

        if (missingElement.length) {
            grunt.log.subhead(`Missing plugin/module translation keys (${missingElement.length}) [advisory]:`);
            for (const mk of missingElement) {
                grunt.log.warn(`${mk.file}:${mk.line}  '${mk.key}' is not defined in ${mk.bundle}`);
            }
        }

        if (missingCore.length) {
            grunt.log.subhead(`Missing core translation keys (${missingCore.length}):`);
            for (const mk of missingCore) {
                grunt.log.error(`${mk.file}:${mk.line}  $.t('${mk.key}') is not defined in ${corePath}`);
            }
            grunt.fail.warn(`i18n-audit failed: ${missingCore.length} missing core translation key(s).`);
            return;
        }

        if (strict && (hardcoded.length || missingElement.length)) {
            grunt.fail.warn(
                `i18n-audit (--strict): ${missingElement.length} element key(s), ` +
                `${hardcoded.length} possible hardcoded string(s).`);
            return;
        }

        grunt.log.ok("i18n-audit passed: all core $.t() keys resolve.");
    };
};
