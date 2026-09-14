/**
 * A DICOM server's response body may not travel inside an `Error.message`.
 *
 * Two reasons, and they are independent. The body can carry PHI — a patient
 * name or study description echoed back in a validation message — and a plugin
 * `Error` has a way of reaching a dialog eventually, which is not where PHI
 * belongs. And the body is authored by the *upstream*, not by us: a multi-tenant
 * PACS, a compromised host, or an intermediary answering with its own error
 * page all produce bytes this plugin did not write, which then get interpolated
 * into a string some generic handler may render.
 *
 * `upstreamExcerpt()` is the seam: the full body goes to the `plugin.dicom` log
 * channel behind the operator's `sensitive` gate (see `src/LOGGING.md`), and
 * only a short single-line excerpt reaches the message, for triage.
 *
 * Asserted against the source, like `protocol-autonomy.test.mjs` — nothing at
 * runtime enforces it, and the shape that regresses is a new call site written
 * the old way.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const queryFile = path.resolve(here, "../../dicom-query.mjs");

/** Source with comments removed — the prose names the very tokens asserted absent. */
const code = fs.readFileSync(queryFile, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

test("no raw upstream body is interpolated into a thrown Error", { tag: ["@unit", "@security"] }, () => {
    // Line-based on purpose: these messages nest a template literal inside
    // `${…}` (`` `QIDO ${path}` `` handed to the excerpt helper), so a regex
    // that tries to balance backticks stops early and silently checks less.
    const thrown = code.split("\n").filter(line => line.includes("new Error(`"));
    expect(thrown.length, "the error sites this guards should still exist").toBeGreaterThan(3);

    for (const site of thrown) {
        // `e.textData` is the raw upstream body off an HTTPError; `${text}` /
        // `${body}` / `${msg}` are the locals it is read into. All must go
        // through the excerpt helper before reaching a message.
        expect(site, `raw upstream body interpolated: ${site}`)
            .not.toMatch(/\$\{\s*(?:e\.textData|text|body|msg)\b[^}]*\}/);
    }
});

test("the excerpt helper both caps and logs", { tag: ["@unit", "@security"] }, () => {
    expect(code).toContain("function upstreamExcerpt(");
    // Capped: an unbounded excerpt is the same finding with extra steps.
    expect(code).toMatch(/UPSTREAM_EXCERPT_CHARS\s*=\s*\d+/);
    expect(code).toContain("slice(0, UPSTREAM_EXCERPT_CHARS)");
    // And the full body is not simply discarded — it is still reachable to a
    // developer, through the gate that exists for payloads.
    expect(code).toMatch(/APPLICATION_CONTEXT\.log\("plugin\.dicom"\)\s*\.sensitive\(/);
});

test("upstream bodies are still read for control flow, just not for messages", { tag: ["@unit"] }, () => {
    // The 404 / `includefield` retries branch on the body text. Removing those
    // reads would turn a recoverable query into a hard failure, so the guard
    // above must not be "satisfied" by deleting them.
    expect(code).toMatch(/Unknown resource/);
    expect(code).toContain("includefield");
});
