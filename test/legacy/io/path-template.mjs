/**
 * `src/classes/io/io-pipeline.ts` — context templating + sink support matching.
 *
 * Why this exists: sink storage paths are built by interpolating `IOContext`
 * fields into an operator-supplied template, and several of those fields are
 * attacker-influenceable. `viewerId` and `backgroundId` derive from the
 * session config (`background[].virtualOf` was read verbatim), and `itemId`
 * comes from the CRUD caller, which in live collaboration is a remote peer.
 * The github sink joins the result into a GitHub Contents API path whose
 * `encodePath` preserves `/` and leaves `..` intact, and the API normalizes
 * `..` server-side — so an unsanitized value is an arbitrary write inside the
 * configured repository.
 *
 * The guarantee under test: a substituted value can never introduce a path
 * segment, escape upward, inject a URL query/fragment, or produce an empty
 * segment. The template itself is trusted and may contain `/`.
 *
 * Also covers the two other pieces the pipeline routes on: `capabilityGroup`
 * (the round-trip-safe capability token — `{capabilityId}` differs between
 * export and import) and `IOSinkSupport` matching, which decides at boot
 * whether a binding is valid at all.
 *
 * TypeScript source, transpiled with the esbuild already used elsewhere in
 * this suite. No new dependency.
 *
 * Run: npm run test:io
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
function eq(name, actual, expected) {
    ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── transpile the TS source into a temp ESM bundle ──────────────────────────
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-io-"));
let io;
try {
    const esbuild = require("esbuild");
    const outfile = path.join(tmp, "io-pipeline.mjs");
    await esbuild.build({
        entryPoints: [path.join(repoRoot, "src", "classes", "io", "io-pipeline.ts")],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    io = await import(pathToFileURL(outfile).href);
} catch (e) {
    ok("io-pipeline.ts transpiles and imports", false, String(e?.message || e));
    console.log(`\n# ${failed} of ${n} FAILED`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
}

const { formatContextTemplate, capabilityGroupOf, matchesPattern, sinkSupportOf } = io;
ok("the module exports the sink-authoring helpers",
    [formatContextTemplate, capabilityGroupOf, matchesPattern, sinkSupportOf].every(f => typeof f === "function"));

/** A realistic bundle-export context; individual cases override one field. */
const baseCtx = {
    direction: "export",
    capabilityId: "bundle-export",
    xoType: "module",
    ownerUid: "module.annotations",
    ownerId: "annotations",
    key: "viewer-1::slide-a",
    viewerId: "viewer-1",
    backgroundId: "slide-a",
    meta: {},
};
const ctx = (over = {}) => ({ ...baseCtx, ...over });

// ── the shipped default resolves as documented ──────────────────────────────
eq("the shipped github default template resolves",
    formatContextTemplate("xopat/{ownerId}/{viewerId}.json", ctx()),
    "xopat/annotations/viewer-1.json");

eq("every dimension is addressable in one template",
    formatContextTemplate("x/{ownerId}/{capabilityGroup}/{backgroundId}/{viewerId}.json", ctx()),
    "x/annotations/bundle/slide-a/viewer-1.json");

// ── traversal: the live finding this suite exists for ───────────────────────
const TRAVERSAL = [
    ["../../.github/workflows/pwn", "the virtualOf traversal chain"],
    ["..", "a bare parent reference"],
    [".", "a bare current-dir reference"],
    ["a/b", "an embedded separator"],
    ["a\\b", "a Windows separator"],
    ["%2e%2e%2f", "a percent-encoded traversal"],
    ["a?x=1", "a query-string injection"],
    ["a#frag", "a fragment injection"],
    ["a:b", "a scheme-ish colon"],
];
for (const [value, why] of TRAVERSAL) {
    const out = formatContextTemplate("xopat/{ownerId}/{viewerId}.json", ctx({ viewerId: value }));
    const segments = out.split("/");
    ok(`traversal blocked — ${why}`,
        segments.length === 3
        && !segments.includes("..") && !segments.includes(".")
        && /^[A-Za-z0-9._-]+$/.test(segments[2].replace(/\.json$/, "") || "_"),
        `got ${JSON.stringify(out)}`);
}

// `..` must not survive even when it is the WHOLE value — the naive fix
// (charset filter alone) leaves it intact, because `.` is in the charset.
eq("a value of exactly `..` becomes the empty-substitute, not `..`",
    formatContextTemplate("{viewerId}", ctx({ viewerId: ".." })), "_");
eq("a value of exactly `.` becomes the empty-substitute",
    formatContextTemplate("{viewerId}", ctx({ viewerId: "." })), "_");

// ── other hostile shapes ────────────────────────────────────────────────────
eq("control characters are stripped, not substituted",
    formatContextTemplate("{viewerId}", ctx({ viewerId: "a\u0000b\u001Fc\u007Fd" })), "abcd");

eq("bidi/RTL overrides cannot survive into a name",
    formatContextTemplate("{viewerId}", ctx({ viewerId: "a\u202Egnp.exe" })), "a_gnp.exe");

ok("an over-long value is capped at 128 chars",
    formatContextTemplate("{viewerId}", ctx({ viewerId: "x".repeat(300) })).length === 128);

eq("an empty value yields the empty-substitute, never an empty segment",
    formatContextTemplate("a/{itemId}/b", ctx({ itemId: "" })), "a/_/b");

eq("a missing field yields the empty-substitute",
    formatContextTemplate("a/{itemId}/b", ctx({ itemId: undefined })), "a/_/b");

eq("an unknown placeholder yields the empty-substitute (and warns once)",
    formatContextTemplate("a/{nope}/b", ctx()), "a/_/b");

eq("`empty` is configurable — mlflow relies on \"\" for absent crud fields",
    formatContextTemplate("run-{resourceName}{itemId}", ctx({ resourceName: undefined, itemId: undefined }),
        { mode: "name", empty: "" }),
    "run-");

// The template is trusted: its own slashes are separators, not values.
eq("slashes in the TEMPLATE are preserved",
    formatContextTemplate("a/b/c/{ownerId}", ctx()), "a/b/c/annotations");

// ── raw mode (commit messages) ──────────────────────────────────────────────
eq("raw mode keeps spaces and punctuation",
    formatContextTemplate("xopat: sync {ownerId} {viewerId}", ctx({ viewerId: "viewer 1 (main)" }), { mode: "raw" }),
    "xopat: sync annotations viewer 1 (main)");

eq("raw mode still strips CR/LF — a commit message is one header block",
    formatContextTemplate("{viewerId}", ctx({ viewerId: "a\r\nb" }), { mode: "raw" }), "ab");

// ── capability group: the round-trip token ──────────────────────────────────
eq("bundle-export collapses to bundle", capabilityGroupOf("bundle-export"), "bundle");
eq("bundle-import collapses to bundle", capabilityGroupOf("bundle-import"), "bundle");
eq("crud:<name> collapses to crud", capabilityGroupOf("crud:annotation"), "crud");
eq("kv:<ns> collapses to kv", capabilityGroupOf("kv:cache"), "kv");
eq("a custom capability keeps its stem", capabilityGroupOf("scores-export"), "scores");

ok("{capabilityGroup} round-trips across export/import",
    formatContextTemplate("p/{capabilityGroup}.json", ctx({ direction: "export", capabilityId: "bundle-export" }))
    === formatContextTemplate("p/{capabilityGroup}.json", ctx({ direction: "import", capabilityId: "bundle-import" })));

ok("{capabilityId} does NOT round-trip — the documented trap",
    formatContextTemplate("p/{capabilityId}.json", ctx({ capabilityId: "bundle-export" }))
    !== formatContextTemplate("p/{capabilityId}.json", ctx({ capabilityId: "bundle-import" })));

// ── sink support declarations ───────────────────────────────────────────────
eq("the legacy kind array normalizes to a descriptor",
    JSON.stringify(sinkSupportOf({ id: "x", supports: ["bundle"] })), JSON.stringify({ kinds: ["bundle"] }));

ok("a descriptor passes through with its restrictions",
    sinkSupportOf({ id: "x", supports: { kinds: ["bundle"], owners: ["annotations"] } }).owners?.[0] === "annotations");

ok("an absent pattern list means unrestricted", matchesPattern("anything", undefined)
    && matchesPattern("anything", null) && matchesPattern("anything", []));
ok("patterns are anchored — no partial matches", !matchesPattern("annotations-extra", ["annotations"]));
ok("`*` matches a run of characters", matchesPattern("bundle-import", ["*import*"]));
ok("a non-matching owner is rejected", !matchesPattern("recorder", ["annotations"]));
ok("regex metacharacters in a pattern are literal", !matchesPattern("axc", ["a.c"]) && matchesPattern("a.c", ["a.c"]));

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
