/**
 * storage-audit — direct browser-storage guard.
 *
 * xOpat can be embedded in a sandboxed iframe without `allow-same-origin`
 * (the EMPAIA Workbench). In that context the document has an OPAQUE ORIGIN
 * and reading the `window.localStorage` / `window.sessionStorage` PROPERTY
 * throws `SecurityError` — `if (window.localStorage)` is a throw site, not a
 * feature detection. `document.cookie` throws on write, and the bare
 * `indexedDB` identifier throws on read. A single unguarded access anywhere
 * on the boot path takes the whole viewer down.
 *
 * Everything therefore routes through the IO pipeline:
 *   this.cache / this.cookies / this.data        (plugins and modules)
 *   IO_PIPELINE.kv(uid, "kv:<ns>")               (direct)
 *   XOpatStorage.Cache / .Cookies / .Session     (core façades)
 * which substitute in-memory drivers when the real backend is unusable.
 * See src/IO_PIPELINE.md → "Sandboxed / opaque-origin operation".
 *
 * The few files that legitimately touch the raw APIs — the probe itself and
 * the documented bootstrap exceptions that run before the pipeline exists —
 * are allowlisted below WITH a justification, which is printed on failure so
 * a reviewer can judge a new entry.
 *
 * Fatal by default: unlike i18n-audit's heuristics there is no legacy backlog
 * here, so any new hit is a real regression.
 *
 * Usage:  grunt storage-audit
 *         npm run storage-audit
 */

module.exports = function (grunt) {
    return function () {
        const patterns = [
            "src/**/*.js", "src/**/*.ts", "src/**/*.mjs",
            "ui/**/*.mjs", "ui/**/*.js",
            "plugins/**/*.js", "plugins/**/*.mjs", "plugins/**/*.ts",
            "modules/**/*.js", "modules/**/*.mjs", "modules/**/*.ts",
        ];
        const ignore = [
            // Vendored / generated payloads we do not own.
            "src/libs/**", "src/dist/**",
            "**/dist/**", "**/node_modules/**", "**/.config/**",
            "**/*.min.js", "**/*.workspace.js", "**/*.workspace.mjs",
            "**/*.map", "**/*.d.ts", "**/*.bak.js",
            "ui/index.js",
            "modules/icc_profile/**",
            "modules/oidc-client-ts/oidc-client-ts.js",
        ];

        /**
         * Files permitted to touch the raw APIs. Every entry needs a reason:
         * the whole point is that a reviewer can tell a bootstrap exception
         * from someone who did not know about the pipeline.
         */
        const allowlist = [
            { file: "src/store.ts",
                why: "owns XOpatStorageAvailability — the probe must touch the raw APIs" },
            { file: "src/classes/io/kv-drivers.ts",
                why: "the Storage-shaped driver adapters" },
            { file: "src/classes/io/index.ts",
                why: "driver registration; every access is probe-gated" },
            { file: "src/classes/io/outbox-store.ts",
                why: "IndexedDB outbox; probe-gated inside the try" },
            { file: "src/parse-input.js",
                why: "bootstrap exception (xoSessionCache): the pipeline captures POST_DATA by "
                    + "reference and this function may REPLACE it, so bootstrapIOPipeline must run "
                    + "after the parse — probe-gated, try/catch'd, deployment-key scoped" },
            { file: "src/classes/app/application-lifecycle-controller.ts",
                why: "bootstrap exception (__xopat_session__ read): this payload CARRIES the ENV "
                    + "that configures the pipeline, so it can never be one of its consumers — probe-gated" },
            { file: "src/app.ts",
                why: "bootstrap exception (__xopat_session__ write) — the counterpart of the read "
                    + "above, same reason; probe-gated" },
            { file: "src/classes/scripting-manager.ts",
                why: "worker sandbox deny-list — string literals that BLOCK these APIs" },
            { file: "modules/speech-to-text/audioCapture.ts",
                why: "opt-in debug flag, already wrapped in try/catch" },
        ];
        const allowed = new Set(allowlist.map((a) => a.file));

        const files = grunt.file
            .expand({ filter: "isFile" }, patterns)
            .map((f) => f.replace(/\\/g, "/"))
            .filter((f) => !ignore.some((ig) => grunt.file.isMatch(ig, f)))
            .filter((f) => !allowed.has(f));

        /**
         * Strip comments so prose does not trip the detector — most current
         * mentions of "localStorage" in the tree are documentation, not code.
         * Line-oriented and deliberately simple: a false negative inside a
         * block comment is harmless, a false positive is not.
         */
        const stripComments = (source) => {
            const out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
            return out.split(/\r?\n/).map((line) => {
                const idx = line.indexOf("//");
                if (idx < 0) return line;
                // Keep `https://…` and friends out of it: only treat `//` as a
                // comment when it is not preceded by a `:`.
                if (idx > 0 && line[idx - 1] === ":") return line;
                return line.slice(0, idx);
            }).join("\n");
        };

        // `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB`,
        // bare or `window.`-prefixed. The negative lookbehind keeps property
        // names on unrelated objects (`opts.localStorage`) from matching.
        const detector = /(?<![.\w])(?:window\s*\.\s*)?(localStorage|sessionStorage)\b|document\s*\.\s*cookie\b|(?<![.\w])(indexedDB)\b/;

        const findings = [];
        for (const file of files) {
            const lines = stripComments(grunt.file.read(file)).split(/\r?\n/);
            lines.forEach((line, idx) => {
                const m = detector.exec(line);
                if (m) findings.push({ file, line: idx + 1, api: m[0].trim(), text: line.trim() });
            });
        }

        grunt.log.writeln(
            `storage-audit: scanned ${files.length} files (${allowlist.length} allowlisted).`);

        if (findings.length) {
            grunt.log.writeln("");
            grunt.log.error("Direct browser-storage access (throws in a sandboxed iframe):");
            for (const f of findings) {
                grunt.log.error(`  ${f.file}:${f.line}  ${f.api}`);
                grunt.log.writeln(`      ${f.text.slice(0, 120)}`);
            }
            grunt.log.writeln("");
            grunt.log.writeln(
                "Route it through the IO pipeline: this.cache / this.cookies / this.data,");
            grunt.log.writeln(
                "IO_PIPELINE.kv(uid, 'kv:<ns>'), or the XOpatStorage façades. If this really");
            grunt.log.writeln(
                "is a bootstrap exception, add an allowlist entry in this task WITH a reason.");
            grunt.log.writeln("Current allowlist:");
            for (const a of allowlist) grunt.log.writeln(`  ${a.file} — ${a.why}`);
            grunt.fail.warn(`storage-audit failed: ${findings.length} direct storage access(es).`);
            return;
        }

        grunt.log.ok("storage-audit passed: no direct browser-storage access.");
    };
};
