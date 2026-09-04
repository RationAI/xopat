/**
 * The flex-renderer control skin is held together by a name agreement nobody
 * can see at runtime.
 *
 * `src/libs/flex-renderer/flex-renderer.js` emits its own BEM markup and puts no
 * DaisyUI class on the actual <input>/<select>/<button>, and `renderControl`
 * offers no hook to add one (see UPSTREAM.md). xOpat therefore skins the
 * controls from `src/assets/tailwind-spec.css` by targeting `.er-control__*`
 * directly. Two things can quietly dissolve that:
 *
 *  - Tailwind tree-shakes custom `@layer components` CSS by class name, so a
 *    content-glob change (the `'!./src/libs/**'` TODO in tailwind.config.js) or
 *    a missing `safelist` entry purges the skin out of `tailwind.min.css`;
 *  - a library bump can rename a class, or route a control through the generic
 *    `renderInput()` helper whose class is a template literal.
 *
 * Either way the failure is silent: the panel just goes back to looking
 * half-styled, with no error anywhere. These two assertions pin both halves.
 *
 * Unit, not e2e, on purpose: asserting computed pixels would need a slide
 * carrying a colormap/advanced-slider shader and would pin geometry that is
 * meant to be tuned. A broken border-radius is visible the moment anyone opens
 * the panel; a purged stylesheet is not.
 */
import { test, expect } from "@xopat/test-harness";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

/**
 * Every class the skin uses as a SELECTOR. Classes it only `@apply`s
 * (`select`, `input`, `btn`, ...) are inlined at build time and are not part of
 * this contract.
 *
 * `er-control__body--colormap` is intentionally absent: `renderControl` builds
 * it from a template literal, so it exists in neither file as a literal string —
 * it survives via the `safelist` alone, which the third test covers.
 */
const SKINNED_CLASSES = [
    "er-control__title",
    "er-control__input--select",
    "er-control__input--colormap",
    "er-control__input--bool",
    "er-control__input--number",
    "er-control__input--image-number",
    "er-control__input--textarea",
    "er-control__input--color",
    "er-control__input--image-file",
    "er-control__display--colormap",
    "er-control__display--custom-colormap",
    "er-control__button--action",
    "er-control__button--image-upload",
    "er-control__hint--image",
    "er-control__row--image-number",
    "er-control__widget--image",
    "er-control__widget--advanced-slider",
];

test("the flex-renderer control skin survives the Tailwind purge @unit", () => {
    const css = read("src/libs/tailwind.min.css");
    const missing = SKINNED_CLASSES.filter(
        // .er-control__widget--advanced-slider is styled from style.css (noUi
        // rules), not from the Tailwind build - exclude it from this half.
        (cls) => cls !== "er-control__widget--advanced-slider" && !css.includes(cls)
    );
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
});

test("template-literal control classes are pinned in the safelist @unit", () => {
    const config = read("tailwind.config.js");
    // Built as `er-control__body--${type}` by renderControl, so the content scan
    // can never find it. If this drops out, the colormap select loses its caret.
    expect(config).toContain("er-control__body--colormap");
});
