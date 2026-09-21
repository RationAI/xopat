/**
 * Every tracked session fixture must satisfy the renderer's own schema.
 *
 * `test/fixtures/sessions/` is the published catalogue — the startup banner, the
 * docs generator and `MANUAL_TESTING.md` all point at it — so a fixture is
 * example code, and example code that trips the validator teaches the wrong
 * shape. `all-shaders` did: it raised 46 findings on open while rendering fine,
 * because the renderer honours some settings the schema refuses.
 *
 * Two distinct checks, because they catch different mistakes:
 *
 *  - **schema advisories** — the config says something the shader's schema does
 *    not declare. Advisory by design (nothing is dropped, nothing is defaulted),
 *    which is why nobody notices, which is why it needs a gate.
 *  - **the type actually exists** — `all-shaders.json` named `edge_isoline`,
 *    which no shader registers. That yields no clear schema finding, renders
 *    nothing, and looks like a broken shader class rather than a typo.
 *
 * Validation runs through `APPLICATION_CONTEXT.visualizationRuntime`, the object
 * the open pipeline itself validates with. Re-implementing the check here would
 * pin a second opinion that drifts from the one that decides.
 *
 * A browser is required and unavoidable: the schema is *generated* at runtime by
 * `FlexRenderer.ShaderConfigurator`, which is an OpenSeadragon-dependent browser
 * IIFE. No slide is opened — this validates configuration only.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SESSIONS = path.join(REPO, "test/fixtures/sessions");

const INDEX = JSON.parse(fs.readFileSync(path.join(SESSIONS, "index.json"), "utf8"));

/**
 * Shader types are not all registered by the renderer: a plugin may add its own
 * at runtime (`dicom-seg`, from the dicom plugin). Those sessions are validated
 * in the deployment that ships the plugin, not here — judging them against a
 * registry that never loaded it would report a typo that is not one.
 */
const PLUGIN_SHADER_DEPLOYMENTS = new Set(["googledicom"]);

/** Every tracked session this deployment can actually judge, `index.json` aside. */
function sessionFiles() {
    return fs.readdirSync(SESSIONS)
        .filter(f => f.endsWith(".json") && f !== "index.json")
        .filter(f => !PLUGIN_SHADER_DEPLOYMENTS.has(INDEX.sessions?.[f.replace(/\.json$/, "")]?.deployment))
        .sort();
}

/**
 * Shaders live in two places and a check that knows only one is silently
 * partial: `visualizations[].shaders` (a map) and `background[].shaders` (an
 * array, used by the fluorescence and multichannel fixtures).
 */
function visualizationsOf(session) {
    const out = [...(Array.isArray(session.visualizations) ? session.visualizations : [])];
    for (const background of session.background ?? []) {
        if (!background || typeof background !== "object") continue;
        const shaders = background.shaders;
        if (!shaders) continue;
        // Normalize the array form into the map form the validator expects, so
        // background-side shaders are held to the same schema.
        out.push({
            name: `background:${background.name ?? ""}`,
            shaders: Array.isArray(shaders)
                ? Object.fromEntries(shaders.map((s, i) => [`layer_${i}`, s]))
                : shaders,
        });
    }
    return out;
}

test("every session fixture validates against the renderer's schema", {
    tag: ["@integration"],
}, async ({ xopat }) => {
    await xopat.launch();
    await xopat.waitForApp();

    const failures = [];
    for (const file of sessionFiles()) {
        const session = JSON.parse(fs.readFileSync(path.join(SESSIONS, file), "utf8"));
        const visualizations = visualizationsOf(session);
        if (!visualizations.length) continue;

        const report = await xopat.page.evaluate(([vizs, data]) => {
            const runtime = window.APPLICATION_CONTEXT?.visualizationRuntime;
            if (!runtime) return { unavailable: true };
            const result = runtime.validateVisualizationCollection(vizs, data);
            return { issues: result.issues ?? [], advisories: result.advisories ?? [] };
        }, [visualizations, session.data ?? []]);

        expect(report.unavailable, "APPLICATION_CONTEXT.visualizationRuntime is published")
            .toBeFalsy();

        for (const advisory of report.advisories) failures.push(`${file}: ${advisory}`);
        for (const issue of report.issues) failures.push(`${file}: [structural] ${issue}`);
    }

    // Listed in full rather than counted: the point of the gate is that the next
    // person reads what is wrong without opening a browser.
    //
    // Unknown shader types arrive here too — the runtime reports them on the
    // structural channel ("uses unknown shader type 'edge_isoline'"), which is
    // what a typo in a fixture looks like. No separate registry check is needed,
    // and one written against the registry's internals would only pin an
    // accessor the renderer is free to rename.
    expect(failures).toEqual([]);
});
