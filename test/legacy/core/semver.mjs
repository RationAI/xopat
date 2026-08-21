/**
 * `src/classes/app/semver.ts` — regression suite.
 *
 * Was the second item on `test/TEST_COVERAGE_GAPS.md` §1. This gates plugin/module
 * loading through `include.json` `engines.xopat`, and a wrong verdict silently
 * REFUSES to load an element — a failure mode that reads to the user as "the
 * plugin is broken", not "the range is wrong". 88 lines, no I/O, so there is no
 * excuse for it being untested.
 *
 * The vectors are the ones recorded in the gap doc. Two carry specific history:
 *
 *  - `^0.5.0` — the caret rule changes meaning below 1.0.0 (it pins the MINOR,
 *    not the major) and is the classic place to break this.
 *  - the prerelease pair — an app version of `3.0.0-beta.1` must satisfy
 *    `>=3.0.0`, because xOpat tags its own prereleases and would otherwise
 *    refuse every plugin the moment a beta shipped.
 *
 * TypeScript source, so it is transpiled with the esbuild already used by
 * `server/node/server-module-loader.js`. No new dependency.
 *
 * Run: npm run test:semver
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = fromRoot();

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}

// ── transpile the TS source into a temp ESM bundle ──────────────────────────
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-semver-"));
let semver;
try {
    const esbuild = require("esbuild");
    const outfile = path.join(tmp, "semver.mjs");
    await esbuild.build({
        entryPoints: [path.join(repoRoot, "src", "classes", "app", "semver.ts")],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    semver = await import(pathToFileURL(outfile).href);
} catch (e) {
    ok("semver.ts transpiles and imports", false, String(e?.message || e));
    console.log(failed ? `\n# ${failed} of ${n} FAILED` : "");
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
}

const { satisfies, parseVersion, compareVersions } = semver;
ok("the module exports satisfies/parseVersion/compareVersions",
    [satisfies, parseVersion, compareVersions].every(f => typeof f === "function"));

/** `[version, range, expected]` — the range-resolution table. */
const CASES = [
    // prerelease tags of the APP version are ignored
    ["3.0.0-beta.1", ">=3.0.0", true, "a prerelease app version satisfies its own release range"],
    ["3.0.0-beta.1", "*", true, "a prerelease satisfies the wildcard"],

    // x-ranges
    ["3.2.1", "3.x", true, "x-range matches within the major"],
    ["4.0.0", "3.x", false, "x-range excludes the next major"],
    ["2.9.9", "3.x", false, "x-range excludes the previous major"],
    ["3.1.5", "3.1.x", true, "x-range matches within the minor"],
    ["3.2.0", "3.1.x", false, "x-range excludes the next minor"],
    ["3.1.5", "3.1.X", true, "uppercase X behaves as x"],
    ["3.1.5", "3.1.*", true, "* behaves as x"],
    ["3.4.0", "3.X", true, "uppercase X at the minor position"],

    // compound ranges
    ["3.5.0", ">=3.0.0 <4.0.0", true, "compound range, inside"],
    ["4.0.0", ">=3.0.0 <4.0.0", false, "compound range, above"],

    // caret / tilde
    ["3.1.0", "^3", true, "caret on a bare major"],
    ["3.1.9", "~3.1", true, "tilde pins the minor"],
    ["3.2.0", "~3.1", false, "tilde excludes the next minor"],
    ["0.5.1", "^0.5.0", true, "caret below 1.0.0 allows a patch bump"],
    ["0.6.0", "^0.5.0", false, "caret below 1.0.0 pins the MINOR, not the major"],

    // exact and spacing
    ["1.2.3", "1.2.3", true, "an exact match"],
    ["1.2.4", "1.2.3", false, "a non-match"],
    ["1.2.3", ">= 1.0.0", true, "a space after the operator is tolerated"],

    // degrade closed / open, deliberately asymmetric
    ["1.2.3", "abc", false, "an unparsable range refuses (degrade closed)"],
    ["3.0.0", "", true, "an EMPTY range means unconstrained (degrade open)"],
];

console.log("# satisfies");
for (const [version, range, expected, name] of CASES) {
    const actual = satisfies(version, range);
    ok(`${name}  [${version} vs ${JSON.stringify(range)} → ${expected}]`,
        actual === expected,
        `got ${JSON.stringify(actual)}`);
}

// The gate must always answer with a boolean: `engines.xopat` is operator- and
// author-supplied, and a thrown error there would take down element loading
// rather than refusing one element.
console.log("# total function");
for (const bad of [undefined, null, 123, {}, [], "", "not.a.version"]) {
    let threw = false, result;
    try { result = satisfies(bad, ">=1.0.0"); } catch { threw = true; }
    ok(`satisfies(${JSON.stringify(bad)}, …) returns a boolean rather than throwing`,
        !threw && typeof result === "boolean", threw ? "it threw" : `got ${JSON.stringify(result)}`);
}
for (const badRange of [undefined, null, 123, {}, []]) {
    let threw = false, result;
    try { result = satisfies("1.2.3", badRange); } catch { threw = true; }
    ok(`satisfies(…, ${JSON.stringify(badRange)}) returns a boolean rather than throwing`,
        !threw && typeof result === "boolean", threw ? "it threw" : `got ${JSON.stringify(result)}`);
}

console.log("# parseVersion");
{
    // Shape is a [major, minor, patch] tuple, not an object.
    const v = parseVersion("3.1.4");
    ok("parses a plain version into a [major, minor, patch] tuple",
        Array.isArray(v) && v[0] === 3 && v[1] === 1 && v[2] === 4, JSON.stringify(v));
    const p = parseVersion("3.0.0-beta.1");
    ok("parses a prerelease and keeps the numeric core",
        Array.isArray(p) && p[0] === 3 && p[1] === 0 && p[2] === 0, JSON.stringify(p));
    ok("refuses junk with undefined rather than a throw", parseVersion("nope") === undefined);
    ok("refuses a non-string with undefined", parseVersion(42) === undefined);
}

console.log("# compareVersions");
{
    ok("orders by major", compareVersions("2.0.0", "1.9.9") > 0);
    ok("orders by minor", compareVersions("1.2.0", "1.1.9") > 0);
    ok("orders by patch", compareVersions("1.1.2", "1.1.1") > 0);
    ok("reports equality as 0", compareVersions("1.2.3", "1.2.3") === 0);
    ok("is antisymmetric", compareVersions("1.0.0", "2.0.0") < 0);
    ok("ignores a prerelease tag on the app version",
        compareVersions("3.0.0-beta.1", "3.0.0") === 0);
}

// ── done ────────────────────────────────────────────────────────────────────
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
