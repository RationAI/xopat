/**
 * What may be trimmed at the seam between two consecutive segment transcripts.
 *
 * Segment recorders overlap by up to a timeslice (the successor starts before the
 * predecessor is stopped), so the recognizer hears the shared second twice:
 * `…mild peribronchiolar metaplasia,` + `metaplasia, no dense fibrosis…`. Observed in every
 * field round as a stutter (`no honeycomb, no honeycomb`). The rule must cut exactly that and
 * never a genuinely repeated finding.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleDir = path.join(fromRoot(), "modules", "speech-to-text");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-join-segments-"));
const esbuild = require("esbuild");
const outfile = path.join(tmp, "joinSegments.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "joinSegments.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { trimOverlap } = await import(pathToFileURL(outfile).href);
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("@unit a one-word seam is trimmed when the recordings overlapped", () => {
    const r = trimOverlap("Foci of organizing pneumonia. Mild peribronchiolar metaplasia,",
        "metaplasia, no dense fibrosis, no honeycombing", 900);
    expect(r.trimmedWords).toBe(1);
    expect(r.text).toBe("no dense fibrosis, no honeycombing");
});

test("@unit a multi-word seam is trimmed on its own evidence", () => {
    const r = trimOverlap("No dense fibrosis, no honeycomb,", "no honeycomb, no fibroblastic foci", 0);
    expect(r.trimmedWords).toBe(2);
    expect(r.text).toBe("no fibroblastic foci");
});

test("@unit a one-word coincidence without overlap is kept", () => {
    // Two separate findings that happen to share a word at the boundary.
    expect(trimOverlap("no dense fibrosis, no", "no honeycombing", 0).trimmedWords).toBe(0);
    // A function word never counts as a seam, overlap or not.
    expect(trimOverlap("interstitial infiltrate of the", "the giant cells", 900).trimmedWords).toBe(0);
});

test("@unit punctuation and case do not hide a seam", () => {
    const r = trimOverlap("…granulomas and scattered interstitial Multinucleated Giant Cells.",
        "giant cells, some with cholesterol clefts.", 700);
    expect(r.trimmedWords).toBe(2);
    expect(r.text).toBe("some with cholesterol clefts.");
});

test("@unit a piece that was nothing but seam empties", () => {
    const r = trimOverlap("findings are typical for chronic hypersensitivity pneumonitis",
        "hypersensitivity pneumonitis", 800);
    expect(r.trimmedWords).toBe(2);
    expect(r.text).toBe("");
});

test("@unit no previous piece, nothing trimmed", () => {
    expect(trimOverlap("", "Transbronchial biopsies, adequate.", 900)).toEqual({ text: "Transbronchial biopsies, adequate.", trimmedWords: 0 });
});
