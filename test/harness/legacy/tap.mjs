/**
 * Parser for the output dialects the pre-runner test scripts emit.
 *
 * This is a **shim, not a format**. New suites use the runner's own assertions;
 * this exists only so the legacy scripts can be executed unmodified until they
 * are ported. Three dialects grew independently in the repo:
 *
 *  1. TAP-ish — `ok N - name` / `not ok N - name`, optionally with a detail on
 *     an indented continuation line or a `  # <json>` suffix. Used by 11 of the
 *     13 scripts (`test/server/*`, `test/io/*`, `test/ui/*`, `test/mixture/*`).
 *  2. Summary-only — `test/dicom/derived-conformance.mjs` counts internally and
 *     prints `DICOM conformance: N checks passed.`, or on failure a stderr block
 *     of `  ✗ name` followed by indented `expected`/`actual` lines.
 *  3. Trailer counts — `# all N passed` / `# N of M FAILED` / `# N FAILED`,
 *     emitted alongside dialect 1 by some scripts.
 *
 * The parser accepts the union and degrades to "exit code is the verdict" when
 * it recognises nothing, so a script that changes its output does not silently
 * report zero assertions.
 */

/**
 * @typedef {object} Assertion
 * @property {number} index
 * @property {string} name
 * @property {boolean} ok
 * @property {string} [detail]
 */

/**
 * @typedef {object} ParsedOutput
 * @property {Assertion[]} assertions  every assertion the script named
 * @property {number} passed
 * @property {number} failed
 * @property {number|null} declared    count the script itself reported, if any
 * @property {"tap"|"summary"|"none"} dialect
 */

const TAP_LINE = /^(not )?ok\s+(\d+)\s*(?:-\s*)?(.*)$/;

/** `DICOM conformance: 128 checks passed.` / `...: 3 passed, 2 FAILED` */
const SUMMARY_PASSED = /:\s*(\d+)\s+checks?\s+passed/i;
const SUMMARY_MIXED = /:\s*(\d+)\s+passed,\s*(\d+)\s+FAILED/i;

/** `# all 42 passed` / `# 3 of 42 FAILED` / `# 3 FAILED` / `1..42` */
const TRAILER_ALL = /^#\s*all\s+(\d+)\s+passed/i;
const TRAILER_SOME = /^#\s*(\d+)\s+of\s+(\d+)\s+FAILED/i;
const TRAILER_FAILED = /^#\s*(\d+)\s+FAILED/i;
const TRAILER_PLAN = /^1\.\.(\d+)\s*$/;

/** `  ✗ name` — dialect 2's failure block. */
const CROSS_LINE = /^\s*[✗x]\s+(.*)$/;

/**
 * @param {string} text combined stdout + stderr, in emission order
 * @returns {ParsedOutput}
 */
export function parseLegacyOutput(text) {
    const lines = text.split(/\r?\n/);
    /** @type {Assertion[]} */
    const assertions = [];
    let declared = null;
    let dialect = /** @type {"tap"|"summary"|"none"} */ ("none");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const tap = TAP_LINE.exec(line);
        if (tap) {
            dialect = "tap";
            const failedLine = Boolean(tap[1]);
            let name = tap[3].trim();
            let detail;

            // `name  # {"json":"detail"}` — the inline-detail variant.
            const hash = name.indexOf(" # ");
            if (hash >= 0) {
                detail = name.slice(hash + 3).trim();
                name = name.slice(0, hash).trim();
            }

            // Indented continuation lines carry the detail in the other variant.
            const continuation = [];
            while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !TAP_LINE.test(lines[i + 1])) {
                continuation.push(lines[++i].trim());
            }
            if (continuation.length) {
                detail = [detail, ...continuation].filter(Boolean).join("\n");
            }

            assertions.push({ index: assertions.length + 1, name: name || `assertion ${tap[2]}`, ok: !failedLine, detail });
            continue;
        }

        const cross = CROSS_LINE.exec(line);
        if (cross && dialect !== "tap") {
            dialect = "summary";
            const continuation = [];
            while (i + 1 < lines.length && /^\s{4,}\S/.test(lines[i + 1])) {
                continuation.push(lines[++i].trim());
            }
            assertions.push({
                index: assertions.length + 1,
                name: cross[1].trim(),
                ok: false,
                detail: continuation.join("\n") || undefined,
            });
            continue;
        }

        const trailerAll = TRAILER_ALL.exec(line);
        if (trailerAll) { declared = Number(trailerAll[1]); continue; }
        const trailerSome = TRAILER_SOME.exec(line);
        if (trailerSome) { declared = Number(trailerSome[2]); continue; }
        const trailerFailed = TRAILER_FAILED.exec(line);
        if (trailerFailed) { continue; }
        const plan = TRAILER_PLAN.exec(line);
        if (plan) { declared ??= Number(plan[1]); continue; }

        const mixed = SUMMARY_MIXED.exec(line);
        if (mixed) {
            if (dialect === "none") dialect = "summary";
            declared = Number(mixed[1]) + Number(mixed[2]);
            continue;
        }
        const passedOnly = SUMMARY_PASSED.exec(line);
        if (passedOnly) {
            if (dialect === "none") dialect = "summary";
            declared = Number(passedOnly[1]);
        }
    }

    const failed = assertions.filter(a => !a.ok).length;
    // Dialect 2 only names its failures; the passes exist but are never printed,
    // so trust the script's own count for the total.
    const passed = dialect === "summary" && declared !== null
        ? Math.max(0, declared - failed)
        : assertions.length - failed;

    return { assertions, passed, failed, declared, dialect };
}
