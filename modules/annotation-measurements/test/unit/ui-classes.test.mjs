/**
 * The shipped `src/libs/tailwind.min.css` is the production-PURGED build, so a class
 * that is perfectly valid Tailwind can simply not exist at runtime — and it fails
 * silently, as a layout that looks subtly (or catastrophically) wrong.
 *
 * That is not hypothetical: this panel's compare row used `w-28` on a `<select>`.
 * The class was purged, `.select`/`.select-xs` declare no width of their own, so the
 * select sized to its widest option plus a 2.5rem arrow gutter and — with `shrink-0`
 * on it — squeezed both operand chips to zero width.
 *
 * The surviving numeric `w-*` scale is only `w-1`…`w-4` (plus `w-2.5`). Anything
 * bigger must be an inline style. This test is the guard: every class this module's
 * UI writes must resolve in a stylesheet that actually ships.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const UI_DIR = path.join(REPO, "modules", "annotation-measurements", "ui");

const STYLESHEETS = [
    path.join(REPO, "src", "libs", "tailwind.min.css"),
    path.join(REPO, "src", "libs", "phoshor-icons", "style.css"),
].map((p) => fs.readFileSync(p, "utf8"));

/**
 * Classes that are not selectors in either sheet: markers read by our own JS, or
 * DaisyUI/base element hooks applied without a dedicated rule.
 */
const NOT_STYLESHEET_CLASSES = new Set([
    "ph-light",   // phosphor family class, applied together with a `ph-<name>` glyph
]);

/** A CSS class is "present" if any selector in any sheet mentions it. */
function isStyled(cls) {
    // Escape the characters Tailwind escapes in generated selectors: `.` `:` `/` `[` `]`.
    const selector = "." + cls.replace(/([.:/[\]])/g, "\\$1");
    return STYLESHEETS.some((css) =>
        css.includes(selector + "{") ||     // .flex-1{
        css.includes(selector + ",") ||     // .a,.b{
        css.includes(selector + ">") ||     // .space-y-2>:not(...)
        css.includes(selector + " ") ||     // .card .title
        css.includes(selector + ":")        // .hover\:bg-x:hover, .last\:border-0:last-child
    );
}

function collectClasses() {
    const found = new Map();
    for (const file of fs.readdirSync(UI_DIR)) {
        if (!file.endsWith(".js")) continue;
        const src = fs.readFileSync(path.join(UI_DIR, file), "utf8");
        for (const m of src.matchAll(/class:\s*(['"`])([^'"`]*)\1/g)) {
            const literal = m[2];
            // Skip template literals carrying an interpolation - not statically known.
            if (literal.includes("${")) continue;
            for (const cls of literal.split(/\s+/)) {
                if (!cls) continue;
                if (!found.has(cls)) found.set(cls, new Set());
                found.get(cls).add(file);
            }
        }
    }
    return found;
}

test("every UI class this module writes exists in a shipped stylesheet @unit", () => {
    const found = collectClasses();

    // Guard the guard: if the scan stops finding classes the assertion below passes
    // vacuously and the whole file becomes decoration.
    expect(found.size).toBeGreaterThan(30);

    const missing = [...found.entries()]
        .filter(([cls]) => !NOT_STYLESHEET_CLASSES.has(cls) && !isStyled(cls))
        .map(([cls, files]) => `${cls} (in ${[...files].sort().join(", ")})`)
        .sort();

    expect(missing).toEqual([]);
});

test("the purge really does drop the widths that broke the layout @unit", () => {
    // Pins the premise. If a future Tailwind rebuild ships these again, this test
    // fails and the inline styles in the UI can be reconsidered — rather than the
    // guard above quietly protecting against nothing.
    for (const cls of ["w-28", "w-20", "w-8", "max-h-56"]) {
        expect(isStyled(cls)).toBe(false);
    }
    // ...while the small scale and the variants the UI does rely on are present.
    for (const cls of ["w-2", "w-2.5", "h-2.5", "flex-1", "min-w-0", "truncate",
        "hover:bg-base-200", "last:border-0", "space-y-0.5"]) {
        expect(isStyled(cls)).toBe(true);
    }
});
