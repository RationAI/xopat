/**
 * Translations are rendered through sanitizers (toast allowlist, `toNode`) that
 * strip inline event handlers and `javascript:` URLs. A string that ships
 * `<a onclick="...">` therefore renders a link that looks live and does
 * nothing — which is how "Reload now." in the unsaved-work warning became
 * unclickable. Links in translations must use `data-action="key"` with the
 * handler bound at the call site (`Dialogs.show(..., { actions })`).
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const INLINE_HANDLER = /<[^>]*\son[a-z]+\s*=|javascript:/i;

function localeFiles() {
    const dirs = [path.join(ROOT, "src", "locales")];
    for (const kind of ["plugins", "modules"]) {
        const base = path.join(ROOT, kind);
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
            // Follow symlinks: elements can be linked in from their own repository.
            const dir = path.join(base, entry.name, "locales");
            if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) dirs.push(dir);
        }
    }
    return dirs.flatMap(dir => fs.readdirSync(dir)
        .filter(name => name.endsWith(".json"))
        .map(name => path.join(dir, name)));
}

function offenders(value, trail, out) {
    if (typeof value === "string") {
        if (INLINE_HANDLER.test(value)) out.push(trail.join("."));
    } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) offenders(child, [...trail, key], out);
    }
    return out;
}

test("locales carry no inline-handlers or javascript: URLs", () => {
    const files = localeFiles();
    expect(files.length).toBeGreaterThan(0);
    const found = [];
    for (const file of files) {
        const keys = offenders(JSON.parse(fs.readFileSync(file, "utf8")), [], []);
        for (const key of keys) found.push(`${path.relative(ROOT, file)}: ${key}`);
    }
    expect(found).toEqual([]);
});
