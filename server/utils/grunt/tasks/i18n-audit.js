/**
 * i18n-audit — localization guard for the xOpat core.
 *
 * Two checks over `src/` and `ui/`:
 *   1. Missing-key check (fatal): every `$.t('some.key')` reference must resolve
 *      to a leaf defined in `src/locales/en.json`. A missing key is a real bug —
 *      at runtime i18next (or the loader's dummy `$.t`) returns the last dot
 *      segment of the key, so the user sees `"cancel"` instead of `"Cancel"`.
 *   2. Hardcoded-string heuristic (advisory): flags English string literals
 *      passed to common UI sinks (Dialogs.show, USER_INTERFACE.Errors/Status,
 *      `.title =`, `title:`, `placeholder`, `aria-label`, alert/confirm) that
 *      are NOT already wrapped in `$.t(...)`. Advisory by default; pass
 *      `--strict` to make these fatal too.
 *
 * Usage:  grunt i18n-audit            (fails only on missing keys)
 *         grunt i18n-audit --strict   (also fails on heuristic hits)
 *         npm run i18n-audit
 *
 * Plugins/modules carry their own `locales/` namespaces and are intentionally
 * out of scope here — this guards the core (`src/`, `ui/`) only.
 */
module.exports = function (grunt) {
    return function () {
        const strict = !!grunt.option("strict");
        const localePath = "src/locales/en.json";

        if (!grunt.file.exists(localePath)) {
            grunt.fail.warn(`i18n-audit: locale file not found at ${localePath}`);
            return;
        }

        // 1. Flatten en.json into a set of dot-notation leaf keys. Keys in code
        //    omit the default "translation" namespace, so flatten its contents.
        const locale = grunt.file.readJSON(localePath);
        const root = locale && locale.translation ? locale.translation : locale;
        const keys = new Set();
        (function flatten(obj, prefix) {
            for (const k of Object.keys(obj || {})) {
                const val = obj[k];
                const path = prefix ? `${prefix}.${k}` : k;
                if (val && typeof val === "object" && !Array.isArray(val)) {
                    flatten(val, path);
                } else {
                    keys.add(path);
                }
            }
        })(root, "");

        // 2. Collect core source files, excluding vendored / generated / typings.
        const patterns = ["src/**/*.js", "src/**/*.ts", "src/**/*.mjs", "ui/**/*.mjs"];
        const ignore = [
            "src/libs/**", "src/dist/**", "src/external/**",
            "**/*.min.js", "**/*.workspace.js", "**/*.workspace.mjs",
            "**/*.workspace.js.map", "**/*.d.ts", "ui/index.js",
        ];
        const files = grunt.file
            .expand({ filter: "isFile" }, patterns)
            .filter((f) => !ignore.some((ig) => grunt.file.isMatch(ig, f)));

        // Match `$.t('key'`, `$.t("key"` — string-literal keys only. Dynamic keys
        // (variables / template literals) cannot be validated and are skipped.
        const keyRe = /\$\.t\(\s*['"]([^'"]+)['"]/g;
        // Heuristic: a string literal handed to a known user-facing sink.
        const sinkRe = /(?:Dialogs\.show|USER_INTERFACE\.(?:Errors|Status|Notifications)|\.title\s*=|title:|placeholder:|["']aria-label["']|aria-label:|\balert|\bconfirm)\s*\(?\s*['"]([^'"]{2,})['"]/g;

        const missing = [];
        const hardcoded = [];

        for (const file of files) {
            const lines = grunt.file.read(file).split(/\r?\n/);
            lines.forEach((line, idx) => {
                let m;

                keyRe.lastIndex = 0;
                while ((m = keyRe.exec(line)) !== null) {
                    if (!keys.has(m[1])) {
                        missing.push({ file, line: idx + 1, key: m[1] });
                    }
                }

                // Skip the heuristic on lines that already translate.
                if (line.indexOf("$.t(") !== -1) return;
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
            `i18n-audit: scanned ${files.length} files against ${keys.size} keys in ${localePath}.`
        );

        if (hardcoded.length) {
            grunt.log.subhead(`Possible hardcoded user-facing strings (${hardcoded.length}) [advisory]:`);
            for (const h of hardcoded) {
                grunt.log.warn(`${h.file}:${h.line}  "${h.text}"`);
            }
        }

        if (missing.length) {
            grunt.log.subhead(`Missing translation keys (${missing.length}):`);
            for (const mk of missing) {
                grunt.log.error(`${mk.file}:${mk.line}  $.t('${mk.key}') is not defined in ${localePath}`);
            }
            grunt.fail.warn(`i18n-audit failed: ${missing.length} missing translation key(s).`);
            return;
        }

        if (strict && hardcoded.length) {
            grunt.fail.warn(`i18n-audit (--strict): ${hardcoded.length} possible hardcoded string(s).`);
            return;
        }

        grunt.log.ok("i18n-audit passed: all $.t() keys resolve.");
    };
};
