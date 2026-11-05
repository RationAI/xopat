/**
 * Deployment theming: element Tailwind presets and the head override slot.
 *
 * Presets may only ADD DaisyUI themes - a preset that redefines `xOpat-light`
 * would restyle every deployment that has the element checked out. And the
 * `branding.css` slot renders operator config into the page head, so anything
 * that is not a plain path or http(s) URL must not reach an `href`.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(import.meta.url);
const { findPresetFiles, loadPresets, mergeDaisyThemes } =
    require_(path.join(REPO, "server/utils/node/tailwind-presets.js"));
const { getCore } = require_(path.join(REPO, "server/templates/javascript/core.js"));

function tempRepo(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xopat-theme-"));
    for (const [rel, body] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
    }
    return root;
}

test("element presets are discovered in modules/ and plugins/ @unit", () => {
    const root = tempRepo({
        "modules/brand/tailwind.preset.js": "module.exports = {};",
        "plugins/other/tailwind.preset.js": "module.exports = {};",
        "modules/plain/include.json": "{}",
    });
    const found = findPresetFiles(root, {}).map(f => path.relative(root, f).replace(/\\/g, "/"));
    expect(found).toEqual(["modules/brand/tailwind.preset.js", "plugins/other/tailwind.preset.js"]);
});

test("XOPAT_TW_PRESET adds presets outside the element folders @unit", () => {
    const root = tempRepo({ "ext/p.js": "module.exports = {};" });
    const found = findPresetFiles(root, { XOPAT_TW_PRESET: "ext/p.js" + path.delimiter + "missing.js" });
    expect(found).toEqual([path.join(root, "ext/p.js")]);
});

test("preset themes are appended, core names are never replaced @unit", () => {
    const root = tempRepo({
        "modules/brand/tailwind.preset.js": `module.exports = { daisyui: { themes: [
            { "brand-light": { primary: "#111" }, "xOpat-light": { primary: "#f00" } },
            "cupcake"
        ] } };`,
    });
    const core = [{ "xOpat-light": { primary: "#570df8" }, "xOpat-dark": { primary: "#793ef9" } }];
    const merged = mergeDaisyThemes(core, loadPresets(findPresetFiles(root, {})));
    expect(merged[0]["xOpat-light"].primary).toBe("#570df8");
    expect(merged[1]).toEqual({ "brand-light": { primary: "#111" } });
    expect(merged[2]).toBe("cupcake");
    expect(merged).toHaveLength(3);
});

test("the core tailwind config keys dark mode on data-theme-mode @unit", () => {
    const config = require_(path.join(REPO, "tailwind.config.js"));
    expect(config.darkMode).toEqual(["selector", '[data-theme-mode="dark"]']);
    expect(Object.keys(config.daisyui.themes[0])).toContain("xOpat-light");
});

test("branding.css renders after-core links and drops unsafe entries @unit", () => {
    const core = getCore(REPO + path.sep, "", fs.existsSync,
        p => fs.readFileSync(p, "utf8"), () => undefined, true, { version: "9" });
    core.CORE.setup.branding = { css: [
        "modules/brand/theme.css",
        "https://cdn.example/x.css?a=1",
        "javascript:alert(1)",
        "//evil.example/x.css",
        "data:text/css,body{}",
        "a b.css",
        "a\\b.css",
        42,
    ] };
    const html = core.requireBrandingCss();
    expect(html.match(/<link /g)).toHaveLength(2);
    expect(html).toContain('href="modules/brand/theme.css?v=9"');
    expect(html).toContain('href="https://cdn.example/x.css?a=1&amp;v=9"');

    core.CORE.setup.branding = { css: ['x.css"><script>alert(1)</script>'] };
    expect(core.requireBrandingCss()).not.toContain("<script>");

    core.CORE.setup.branding = undefined;
    expect(core.requireBrandingCss()).toBe("");
});
