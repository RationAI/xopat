/**
 * The flex-renderer control skin is held together by a name agreement nobody
 * can see at runtime.
 *
 * `src/libs/flex-renderer/flex-renderer.js` puts DaisyUI classes on its inputs
 * from a per-role map xOpat sets in `src/app.ts` (`setInputClassDefaults`), and
 * leaves two things for the host to paint: the colormap palette (published as
 * the `--er-colormap` custom property) and the advanced-slider mask state
 * (`er-slider__connect--active`). The remaining layout lives in
 * `src/assets/tailwind-spec.css`, the two host-painted states in
 * `src/assets/style.css`. Things that can quietly dissolve that:
 *
 *  - Tailwind tree-shakes custom `@layer components` CSS by class name, so a
 *    content-glob change or a missing `safelist` entry purges the layout out of
 *    `tailwind.min.css`;
 *  - a library bump can rename a class or drop one of the two hooks;
 *  - the class-default wiring in `src/app.ts` can drift from what the library
 *    reads, leaving the inputs bare.
 *
 * Either way the failure is silent: the panel just goes back to looking
 * half-styled, or the palette disappears, with no error anywhere.
 *
 * Unit, not e2e, on purpose: asserting computed pixels would need a slide
 * carrying a colormap/advanced-slider shader and would pin geometry that is
 * meant to be tuned.
 */
import { test, expect } from "@xopat/test-harness";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

/** Classes tailwind-spec.css uses as SELECTORS, each pinned in the safelist. */
const SKINNED_CLASSES = [
    "er-control__title",
    "er-control__display--colormap",
    "er-control__display--custom-colormap",
    "er-control__hint--image",
    "er-control__row--image-number",
    "er-control__widget--image",
];

/** Selector classes built from a template literal by the library. */
const TEMPLATE_BUILT = [
    ["er-control--bool", "renderControl", /`er-control--\$\{type\}`/],
    ["er-control__input--bool", "renderInput", /`er-control__input--\$\{type\}`/],
    ["er-control__input--color", "renderInput", /`er-control__input--\$\{type\}`/],
];

test("the flex-renderer control skin survives the Tailwind purge @unit", () => {
    const css = read("src/libs/tailwind.min.css");
    const missing = [...SKINNED_CLASSES, ...TEMPLATE_BUILT.map(([cls]) => cls)]
        .filter((cls) => !css.includes(cls));
    expect(
        missing,
        `purged from src/libs/tailwind.min.css - check tailwind.config.js safelist: ${missing.join(", ")}`
    ).toEqual([]);
});

test("flex-renderer still emits the class names the skin targets @unit", () => {
    const lib = read("src/libs/flex-renderer/flex-renderer.js");
    const missing = SKINNED_CLASSES.filter((cls) => !lib.includes(cls));
    expect(
        missing,
        `no longer emitted by src/libs/flex-renderer - the skin is now dead CSS: ${missing.join(", ")}`
    ).toEqual([]);
    for (const [cls, helper, pattern] of TEMPLATE_BUILT) {
        expect(lib, `${cls} is built by ${helper}`).toMatch(pattern);
    }
});

test("template-built selector classes are pinned in the safelist @unit", () => {
    const config = read("tailwind.config.js");
    for (const [cls] of TEMPLATE_BUILT) {
        expect(config).toContain(`'${cls}'`);
    }
});

test("flex-renderer exposes the host hooks xOpat wires @unit", () => {
    const lib = read("src/libs/flex-renderer/flex-renderer.js");
    expect(lib).toMatch(/static setInputClassDefaults\(/);
    expect(lib).toMatch(/static setTranslator\(/);
    expect(lib).toContain('setProperty("--er-colormap"');
    expect(lib).toContain("er-control__colormap-preview");
    expect(lib).toContain("er-slider__connect--active");

    const app = read("src/app.ts");
    expect(app).toMatch(/setInputClassDefaults\(\{/);
    expect(app).toMatch(/setTranslator\(/);
});

test("host-painted control states use DaisyUI colour tokens @unit", () => {
    // DaisyUI 4 theme variables hold raw oklch COMPONENTS ("48.6% 0.286 281"),
    // not colours. A bare `var(--p)` is invalid at computed-value time and the
    // declaration is dropped - the mask state would vanish without an error.
    const style = read("src/assets/style.css");
    const rule = (selector) => {
        const at = style.indexOf(selector);
        expect(at, `${selector} is styled in src/assets/style.css`).toBeGreaterThan(-1);
        const body = style.slice(at);
        return body.slice(0, body.indexOf("}"));
    };

    const active = rule(".noUi-connect.er-slider__connect--active");
    expect(active).toMatch(/oklch\(var\(--p\)/);
    expect(active).not.toMatch(/:\s*var\(--p\)\s*;/);

    expect(rule(".er-control__colormap-preview")).toMatch(/background-image:\s*var\(--er-colormap/);
});
