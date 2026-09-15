/**
 * A module's `includes` order is a dependency order, and nothing enforced it.
 *
 * `chainLoad` evaluates the list strictly in order, one network round-trip per file,
 * so anything a file touches *at evaluation time* must already be on the page. Two
 * ways that breaks, both of which have happened:
 *
 *  - `OSDAnnotations.Rect = class extends OSDAnnotations.AnnotationObjectFactory` is
 *    evaluated when the file loads. If the base class's file comes later, the class
 *    declaration throws outright.
 *  - A file whose top level calls `requireViewerSingletonPresence(...)` can cause the
 *    module singleton to be constructed *right there*, mid-chain — the loader now
 *    defers that sweep, but the ordering is still the thing that makes the module
 *    constructible at all. `annotations-canvas.js` used to sit at entry 10 of 23 while
 *    the `OSDAnnotations` constructor needed `presets.js` (19) and `freeFormTool.js`
 *    (23), which is what produced "OSDAnnotations.PresetManager is not a constructor"
 *    on every mid-session load of the plugin.
 *
 * These checks read the real `include.json` and the real sources, so they keep holding
 * as the module grows — no boot, no DOM, no loader instance.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "comment-json";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MODULE_DIR = path.join(REPO, "modules", "annotations");

/** `include.json` carries `//` comments — the same parser the ENV composer uses. */
function readIncludes(moduleDir) {
    const meta = parse(readFileSync(path.join(moduleDir, "include.json"), "utf8"));
    return meta.includes.filter((entry) => typeof entry === "string");
}

/** Only the module's own JS: `ext/` is vendored and defines nothing on the namespace. */
function readSources(moduleDir, includes) {
    const out = new Map();
    for (const rel of includes) {
        const abs = path.join(moduleDir, rel);
        if (!existsSync(abs)) continue;
        out.set(rel, readFileSync(abs, "utf8"));
    }
    return out;
}

const includes = readIncludes(MODULE_DIR);
const sources = readSources(MODULE_DIR, includes);
const indexOf = (rel) => includes.indexOf(rel);

/** Where each `OSDAnnotations.<Symbol> = class|function|{` is declared, at top level. */
function symbolDefinitions() {
    const defs = new Map();
    for (const [rel, src] of sources) {
        for (const m of src.matchAll(/^OSDAnnotations\.(\w+)\s*=/gm)) {
            if (!defs.has(m[1])) defs.set(m[1], rel);
        }
    }
    return defs;
}

test("every top-level `extends OSDAnnotations.X` follows the file defining X @unit", () => {
    const defs = symbolDefinitions();
    const violations = [];

    for (const [rel, src] of sources) {
        for (const m of src.matchAll(/^OSDAnnotations\.(\w+)\s*=\s*class\s+extends\s+OSDAnnotations\.(\w+)/gm)) {
            const [, derived, base] = m;
            const baseFile = defs.get(base);
            // A base from outside this module (or from the namespace root in
            // `annotations.js`) is not ours to order.
            if (!baseFile) continue;
            if (indexOf(baseFile) > indexOf(rel)) {
                violations.push(`${rel} declares ${derived} extends ${base}, but ${base} is defined later in ${baseFile}`);
            }
        }
    }

    expect(violations).toEqual([]);
});

test("the module singleton's constructor dependencies load before the singleton trigger @unit", () => {
    const defs = symbolDefinitions();

    // The file whose top level asks the loader to instantiate a viewer singleton.
    const triggers = [...sources]
        .filter(([, src]) => /^requireViewerSingletonPresence\(/m.test(src))
        .map(([rel]) => rel);
    // If this ever becomes empty the module stopped declaring a viewer singleton and
    // the check below would silently pass, so assert the premise.
    expect(triggers.length).toBeGreaterThan(0);
    const firstTrigger = Math.min(...triggers.map(indexOf));

    // Everything `OSDAnnotations` constructs. Restricted to symbols this module
    // defines in another file — same-file and external ones cannot be misordered here.
    const entry = "annotations.js";
    const needed = new Set(
        [...sources.get(entry).matchAll(/new OSDAnnotations\.(\w+)\s*\(/g)].map((m) => m[1])
    );

    const violations = [];
    for (const symbol of needed) {
        const file = defs.get(symbol);
        if (!file || file === entry) continue;
        if (indexOf(file) > firstTrigger) {
            violations.push(`${entry} constructs OSDAnnotations.${symbol}, defined in ${file} (entry ${indexOf(file)}), after the singleton trigger ${includes[firstTrigger]} (entry ${firstTrigger})`);
        }
    }

    expect(violations).toEqual([]);
});

test("the two symbols that actually broke are ordered @unit", () => {
    // A named guard for the reported bug, so a future reshuffle names the cause.
    const canvas = indexOf("annotations-canvas.js");
    expect(indexOf("presets.js")).toBeLessThan(canvas);
    expect(indexOf("freeFormTool.js")).toBeLessThan(canvas);
});
