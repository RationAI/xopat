/**
 * A namespace that no intent pattern matches stays in the prompt's compact tier — method
 * names only, description cut to 400 characters — until a call fails and expands it.
 *
 * `questionnaire`, `recorder` and `measurements` had no hint at all, so "create a
 * questionnaire + a recording narrative" documented neither of the two namespaces the
 * task was entirely about. The model read `bindPageTour` from the questionnaire's
 * name list and called it on `recorder`.
 *
 * The patterns live with each namespace (`ScriptApiMetadata.assistant.intentPatterns`);
 * the chat only compiles and matches them (`shared/namespace-assistant.ts`). These
 * vectors pin the routing, not the regexes: each phrase is one a user actually types
 * for that feature.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-intent-hints-"));

async function load(entry, name) {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(fromRoot(), ...entry.split("/"))],
        outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
}

const assistant = await load("modules/vercel-ai-chat-sdk/shared/namespace-assistant.ts", "namespace-assistant");
const { VISUALIZATION_ASSISTANT_HINTS } = await load("src/classes/scripting/visualization-api.assistant.ts", "viz");
const { UI_ASSISTANT_HINTS } = await load("src/classes/scripting/ui-api.assistant.ts", "ui");
const { PATHOLOGY_ASSISTANT_HINTS } = await load("modules/pathology-foundation/scripting/assistant.ts", "pathology");
rmSync(tmp, { recursive: true, force: true });

/**
 * Namespaces whose metadata is inline in a file with heavy globals: read the single-line
 * `intentPatterns: [/…/i]` literal out of the source rather than executing the file.
 */
function inlinePatterns(file) {
    const source = readFileSync(path.join(fromRoot(), ...file.split("/")), "utf8");
    const match = source.match(/intentPatterns:\s*\[\s*(\/.*\/[a-z]*)\s*\]/);
    if (!match) throw new Error(`no intentPatterns in ${file}`);
    // eslint-disable-next-line no-new-func
    return [new Function(`return ${match[1]}`)()];
}

const DECLARED = {
    visualization: VISUALIZATION_ASSISTANT_HINTS.intentPatterns,
    ui: UI_ASSISTANT_HINTS.intentPatterns,
    pathology: PATHOLOGY_ASSISTANT_HINTS.intentPatterns,
    annotationsRead: inlinePatterns("modules/annotations/scripting/read.scripts.js"),
    annotationsWrite: inlinePatterns("modules/annotations/scripting/write.scripts.js"),
    measurements: inlinePatterns("modules/annotation-measurements/scripting/measurements.scripts.js"),
    questionnaire: inlinePatterns("plugins/questionaire/scripting/api.ts"),
    recorder: inlinePatterns("modules/recorder/scripting/api.ts"),
    mlflowSink: inlinePatterns("modules/io-mlflow-sink/scripting/api.ts"),
};

/** The manifest core would build: patterns as `{source, flags}`. */
function manifestOf(declared, extra = []) {
    return {
        namespaces: [
            ...Object.entries(declared).map(([namespace, patterns]) => ({
                namespace, name: namespace, methods: [],
                assistant: { intentPatterns: patterns.map((re) => ({ source: re.source, flags: re.flags })) },
            })),
            ...extra,
        ],
    };
}

const compiled = assistant.compileIntentPatterns(manifestOf(DECLARED));
const hits = (text) => assistant.matchIntentNamespaces(compiled, text).sort();

test("the namespaces a task is about are hinted", () => {
    // The exact request from the session that failed.
    const asked = hits("create a questionnaire + recording narrative from the findings for a potential student");
    expect(asked).toContain("questionnaire");
    expect(asked).toContain("recorder");

    expect(hits("do it in screen recorder and the questionaire plugin")).toContain("recorder");
    expect(hits("build a short survey about this slide")).toContain("questionnaire");
    expect(hits("record a guided tour of the tumour regions")).toContain("recorder");
    expect(hits("add a narrated walkthrough")).toContain("recorder");
    expect(hits("how far apart are these nuclei in microns?")).toContain("measurements");
    expect(hits("measure the lesion diameter")).toContain("measurements");
});

test("hints that already existed still route", () => {
    expect(hits("outline the tumour and annotate it")).toContain("annotationsWrite");
    expect(hits("the overlay is too dark")).toContain("visualization");
    expect(hits("explore the slide for invasive carcinoma")).toContain("pathology");
    expect(hits("where is the keymap?")).toContain("ui");
});

test("every declared pattern is a case-insensitive, stateless regex", () => {
    for (const [ns, patterns] of Object.entries(DECLARED)) {
        expect(patterns.length, ns).toBeGreaterThan(0);
        for (const re of patterns) {
            expect(re, ns).toBeInstanceOf(RegExp);
            expect(re.flags, ns).toContain("i");
            // A global regex would carry lastIndex between turns and match every other call.
            expect(re.flags, ns).not.toContain("g");
        }
    }
});

test("compilation forces 'i', drops stateful flags and skips malformed patterns", () => {
    const [[, patterns]] = assistant.compileIntentPatterns({ namespaces: [{
        namespace: "x", name: "x", methods: [],
        assistant: { intentPatterns: [{ source: "abc", flags: "gy" }, { source: "(", flags: "" }] },
    }] });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].flags).toBe("i");
    expect(patterns[0].test("ABC")).toBe(true);
    expect(patterns[0].test("ABC")).toBe(true);
});

test("a sensitive namespace never hint-expands", () => {
    // `patient` docs enter the prompt only after a consent-gated call or an explicit
    // describe — a keyword must never pull them in, even if a pattern slipped through.
    const withSensitive = assistant.compileIntentPatterns(manifestOf({}, [{
        namespace: "patient", name: "patient", sensitive: true, methods: [],
        assistant: { intentPatterns: [{ source: "patient", flags: "i" }] },
    }]));
    expect(assistant.matchIntentNamespaces(withSensitive, "show the patient")).toEqual([]);
    const patientSource = readFileSync(path.join(fromRoot(), "src", "classes", "scripting", "patient-api.ts"), "utf8");
    expect(patientSource).not.toContain("intentPatterns");
});
