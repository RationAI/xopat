/**
 * The `dicom` plugin is a protocol: it renders what a session declares and
 * decides nothing on its own. That property is the entire point of splitting
 * `dicom-browser` out of it, and it is exactly the kind of property that rots —
 * one `before-app-init` handler or one `integrateWithPlugin('slide-info', …)`
 * added back "just for this case" and a deployment that chose the protocol-only
 * layout silently starts opening slides nobody asked for.
 *
 * Nothing at runtime enforces it, so it is asserted here against the source. The
 * companion check is the cross-plugin API surface: the two plugins may not
 * import each other (AGENTS.md §0.5), so every call the browser makes has to
 * exist on the protocol, and a rename that breaks one of them fails at runtime
 * in a UI callback rather than at load.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginsDir = path.resolve(here, "../../..");

const read = (rel) => fs.readFileSync(path.join(pluginsDir, rel), "utf8");

/**
 * Source with comments removed.
 *
 * Both files *document* what moved where, so the prose is full of the very
 * tokens these tests assert are absent. Only the code counts. Crude by design:
 * a `//` inside a string literal gets clipped too, which cannot produce a false
 * positive for any token asserted below.
 */
const code = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const protocol = code(read("dicom/index.workspace.mjs"));
const browser = code(read("dicom-browser/index.workspace.mjs"));

/** Public + private method names declared on a plugin class body. */
const methodsOf = (src) =>
    new Set([...src.matchAll(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+)?([A-Za-z_][\w]*)\s*\(/gm)].map(m => m[1]));

/* ------------------------------------------------------------------ */
/* The protocol has no opinions                                        */
/* ------------------------------------------------------------------ */

test("the protocol plugin drives nothing at boot", { tag: ["@unit"] }, () => {
    // `before-app-init` is where a plugin rewrites `evt.background` and decides
    // what the viewer opens. A protocol must not be in that business.
    expect(protocol).not.toContain("before-app-init");
    // Nor may it read a "default study" of its own.
    expect(protocol).not.toMatch(/getOptionOrConfiguration\(\s*['"](studyUID|seriesUID|patientUID)['"]/);
});

test("the protocol plugin installs no UI", { tag: ["@unit"] }, () => {
    expect(protocol).not.toContain("slide-info");
    expect(protocol).not.toContain("setCustomBrowser");
    expect(protocol).not.toContain("Dialogs.show");
    // Van.js is the UI layer; a protocol importing it is the smell that a panel
    // is being built where none belongs.
    expect(protocol).not.toContain("ui/vanjs.mjs");
});

test("expansion happens only when a dataID asks for it", { tag: ["@unit"] }, () => {
    const methods = methodsOf(protocol);

    // The one before-open handler, and the three things it can be asked to do.
    expect(methods.has("_registerSessionDrivenExpansion")).toBe(true);
    expect(methods.has("_expandCaseForEvent")).toBe(true);
    expect(methods.has("_attachRequestedOverlays")).toBe(true);
    expect(methods.has("_fillRadiologyShaderParams")).toBe(true);

    // Each is gated on the session having said so.
    expect(protocol).toContain('id.expand === "case"');
    expect(protocol).toContain('id.role === "radiology"');
    expect(protocol).toContain("id.derived === undefined");

    // The autonomy flag is gone with the behaviour it gated: the browser plugin
    // owns automatic discovery now, and its presence IS the switch.
    expect(protocol).not.toContain("renderDerivedObjects");
});

test("the case-expansion primitive returns config rather than applying it", { tag: ["@unit"] }, () => {
    const start = protocol.indexOf("async buildCaseSession(");
    expect(start, "buildCaseSession must exist").toBeGreaterThan(-1);
    const fn = protocol.slice(start, start + 1600);

    // It builds `{data, background}` and hands them back. The single
    // `openViewerWith` in this plugin lives in the handler that the session
    // explicitly triggered, not in here.
    expect(fn).toContain("return { data, background }");
    expect(fn).not.toContain("openViewerWith");
    expect(protocol.match(/openViewerWith/g) ?? []).toHaveLength(1);
});

/* ------------------------------------------------------------------ */
/* The browser has them, and reaches the protocol legitimately         */
/* ------------------------------------------------------------------ */

test("the browser plugin owns the boot seeding and the explorer", { tag: ["@unit"] }, () => {
    expect(browser).toContain("before-app-init");
    expect(browser).toContain("setWillInitCustomBrowser");
    expect(browser).toContain("setCustomBrowser");
    expect(browser).toContain("renderDerivedObjects");
});

test("neither plugin imports the other", { tag: ["@unit"] }, () => {
    // Cross-plugin ES imports break dynamic loading and create hidden coupling.
    // The seam is `plugin('dicom')` and its read-only query API.
    expect(browser).not.toMatch(/from\s+['"][^'"]*\/dicom\/[^'"]*['"]/);
    expect(protocol).not.toMatch(/from\s+['"][^'"]*dicom-browser[^'"]*['"]/);
    expect(browser).toContain("plugin('dicom')");
});

test("every protocol method the browser calls exists", { tag: ["@unit"] }, () => {
    const calls = [...new Set([...browser.matchAll(/\bapi\.([A-Za-z_][\w]*)/g)].map(m => m[1]))].sort();
    const declared = methodsOf(protocol);

    // Sanity: the extraction found the real call sites, not zero of them.
    expect(calls.length).toBeGreaterThan(10);
    expect(calls).toContain("buildCaseSession");
    expect(calls).toContain("makeDataReference");

    expect(calls.filter(name => !declared.has(name))).toEqual([]);
});

test("the browser reads the pre-split config location for one release", { tag: ["@unit"] }, () => {
    // A default that silently stops opening anything is the worst possible
    // migration failure, so the old `plugins.dicom.*` keys are still honoured —
    // loudly, and named in the warning.
    expect(browser).toContain("PLUGINS?.dicom?.[key]");
    expect(browser).toContain("plugins.dicom-browser.");
});

/* ------------------------------------------------------------------ */
/* Manifests agree with the code                                       */
/* ------------------------------------------------------------------ */

test("the manifests carry no stale defaults and the new plugin is git-visible", { tag: ["@unit"] }, () => {
    // include.json permits comments and the trailing comma they leave behind
    // when the last entry is commented out — strip both before parsing.
    const strip = (s) => s
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/,(\s*[}\]])/g, "$1");
    const dicom = JSON.parse(strip(read("dicom/include.json")));
    const dicomBrowser = JSON.parse(strip(read("dicom-browser/include.json")));

    expect(dicom.id).toBe("dicom");
    expect(dicom.requiredConfig).toEqual(["serviceUrl"]);
    // These moved; leaving them here would have them silently ignored.
    expect(dicom.renderDerivedObjects).toBe(undefined);
    expect(dicom.studyUID).toBe(undefined);

    expect(dicomBrowser.id).toBe("dicom-browser");
    expect(dicomBrowser.renderDerivedObjects).toBe(true);

    // Without a `.gitignore` allowlist entry the whole directory is invisible to
    // git, and the plugin ships to nobody.
    const ignore = fs.readFileSync(path.resolve(pluginsDir, "../.gitignore"), "utf8");
    expect(ignore).toContain("!/plugins/dicom-browser");
});
