/**
 * `TiledImage#getConfig` is a contract with a window in which it is not there yet.
 *
 * The method is stamped per world item by `configureOpenedItem`, which runs in
 * `addTiledImage`'s *success* callback — but OSD puts the item in the world and calls
 * `viewport.goHome(true)` before that, and `goHome` raises `zoom`/`pan` synchronously.
 * Anything reading the reference item off those events therefore meets an item that has
 * no `getConfig`, and a bare call throws. That is how `sessionName` killed the viewport
 * cache for a whole session inside the EMPAIA embedding: one TypeError, swallowed by the
 * cache's own try/catch, and "reopen where you left off" silently stopped working.
 *
 * Two defences, both pinned here because both are invisible at the call site:
 *   1. `loader.ts` defaults the method on the prototype, so the contract is total.
 *   2. Call sites that reach a world item still use `?.`, because items added outside the
 *      open pipeline (shader sources, renderer-managed slots) never get a real one.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname`: this repo lives under a percent-encoded path.
const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        // `libs` is vendored and `dist` is generated — neither is ours to hold to this rule.
        if (name === "libs" || name === "dist") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|js|mjs)$/.test(name)) out.push(full);
    }
    return out;
}

test("core defaults getConfig on the TiledImage prototype @unit", () => {
    const loader = readFileSync(join(SRC, "loader.ts"), "utf8");
    expect(/OpenSeadragon\.TiledImage\.prototype\.getConfig\s*=/.test(loader)).toBe(true);
});

test("world-item getConfig reads are optional calls @unit", () => {
    // Only lines that clearly resolve a WORLD ITEM: those are the ones that can run
    // inside the window above. `shader.getConfig()` (a different, unrelated duck type
    // owned by the renderer) is not in scope.
    const offenders = [];
    for (const file of walk(SRC)) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
            if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
            if (!/getItemAt\(|getReferencedTiledImage\(/.test(line)) return;
            if (!/\.getConfig\(/.test(line)) return;
            if (/\.getConfig\?\.\(/.test(line)) return;
            offenders.push(`${file.slice(SRC.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
});
