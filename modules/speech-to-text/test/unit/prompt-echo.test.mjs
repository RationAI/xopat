/**
 * What the prompt-echo stripper may remove from a dictated transcript.
 *
 * The biasing prompt is a pathology glossary — the exact words a pathologist dictates.
 * The stripper exists for one failure: Whisper regurgitating that prompt over near-silent
 * audio. It used to treat "two glossary pieces and nothing else" as an echo, and
 * `"fibrosis, necrosis."` — a finding — was blanked before any consumer saw it, with no
 * event. The rule now requires an echoed LABEL, something nobody dictates.
 *
 * The source is TypeScript; transpiled with the esbuild the repo already depends on.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-prompt-echo-"));
const esbuild = require("esbuild");
const outfile = path.join(tmp, "promptEcho.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "promptEcho.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { stripPromptEcho, isPurePromptEcho } = await import(pathToFileURL(outfile).href);
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// The shipped base glossary (src/locales/en.json, chat.voice.transcriptionPrompt) plus a
// report-term tail like the one mixture-report-assist appends.
const GLOSSARY = "Histology and pathology dictation. Common terms: histology, histopathology, " +
    "immunohistochemistry, hematoxylin and eosin, H&E stain, mitosis, mitotic figures, stroma, " +
    "stromal, carcinoma, adenocarcinoma, squamous cell, epithelium, epithelial, dysplasia, " +
    "metaplasia, necrosis, nuclei, nuclear atypia, pleomorphism, lymphocyte, lymphocytic " +
    "infiltrate, fibrosis, glandular, in situ, invasive, benign, malignant, biopsy, tumor, " +
    "tumor grade, Gleason score, Ki-67, cytology, immunostain, margin, lesion. " +
    "honeycomb, fibroblastic foci, granuloma, bronchiolitis, organizing pneumonia";

test("@unit two dictated glossary terms are a finding, not an echo", () => {
    expect(stripPromptEcho("Fibrosis, necrosis.", GLOSSARY)).toBe("Fibrosis, necrosis.");
    expect(stripPromptEcho("honeycomb, lymphocytic infiltrate", GLOSSARY)).toBe("honeycomb, lymphocytic infiltrate");
    expect(stripPromptEcho("Granuloma. Fibroblastic foci.", GLOSSARY)).toBe("Granuloma. Fibroblastic foci.");
});

test("@unit a single glossary word is kept", () => {
    expect(stripPromptEcho("metaplasia", GLOSSARY)).toBe("metaplasia");
    expect(stripPromptEcho("Benign.", GLOSSARY)).toBe("Benign.");
});

test("@unit the label-led echo observed in real transcripts is blanked", () => {
    expect(stripPromptEcho(". Common terms: . histology, histopathology", GLOSSARY)).toBe("");
    expect(isPurePromptEcho("Common terms: histology", GLOSSARY)).toBe(true);
});

test("@unit a verbatim run of the prompt is removed and real speech around it kept", () => {
    const echo = "Histology and pathology dictation. Common terms: histology, histopathology, immunohistochemistry";
    // Only ≥25-character runs are removed; what matters is that the speech survives.
    expect(stripPromptEcho(`No dense fibrosis. ${echo}`, GLOSSARY)).toContain("No dense fibrosis");
    expect(stripPromptEcho(echo, GLOSSARY)).toBe("");
});

test("@unit pieces match whole words only", () => {
    // "lesion" must not be found inside "lesional"; "margin" not inside "marginal".
    expect(isPurePromptEcho("Common terms: marginal lesional", GLOSSARY)).toBe(false);
});

test("@unit no prompt, nothing stripped", () => {
    expect(stripPromptEcho("fibrosis, necrosis.", undefined)).toBe("fibrosis, necrosis.");
    expect(stripPromptEcho("", GLOSSARY)).toBe("");
});
