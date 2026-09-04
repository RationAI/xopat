/**
 * `persistOutbox: true` without a `serialize` is a silent loss of crash-recovery.
 *
 * The outbox mirrors every queued op into IndexedDB before dispatch so pending
 * writes survive a reload. That write is a structured clone, and
 * `_persistEntry` (`src/classes/io/io-resource.ts`) falls back to the RAW item
 * when the resource declares no `serialize`. Anything the clone algorithm
 * refuses — a DOM node, a canvas, a `File`, a function — then fails on *every*
 * operation, and the resource has no crash-recovery at all. Nothing looks
 * broken: the dispatch still succeeds.
 *
 * Two owners shipped exactly this. `modules/annotations` stored raw fabric
 * objects; `modules/recorder` stored a live `<img>` and produced one console
 * warning per recorded step. Both were found by reading the console, months
 * apart, which is not a detection strategy.
 *
 * So this is a SOURCE-level check rather than a behavioural one: it fails at
 * authoring time, for every owner at once, including the ones nobody has run
 * yet. It is deliberately not enforced at runtime — an owner may have a good
 * reason, and the type system already documents the requirement — but it may
 * not be missed by accident.
 */
import { test, expect } from "@xopat/test-harness";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `fileURLToPath`, not `.pathname`: on Windows the latter yields `/C:/…`, which
// resolves to nothing and would have turned the scan below into a silent no-op.
const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Every `.ts`/`.js`/`.mjs` under the element roots, skipping build output. */
async function sourceFiles(dir, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch { return out; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", ".server-dist", "test", "locales", "dist"].includes(entry.name)) continue;
            await sourceFiles(full, out);
            continue;
        }
        if (!/\.(ts|js|mjs)$/.test(entry.name)) continue;
        // Bundles and minified output re-state the same call sites; `.bak.`
        // files are a developer's local scratch, not shipped code.
        if (/\.(min|workspace|bak)\.|\.d\.ts$/.test(entry.name)) continue;
        out.push(full);
    }
    return out;
}

/**
 * The argument object of each `defineResource(` call, by brace matching.
 *
 * A regex cannot do this — resource definitions nest objects and arrow
 * functions several levels deep — and pulling in a parser for one assertion is
 * worse than counting braces.
 */
function defineResourceCalls(source) {
    const calls = [];
    const needle = "defineResource(";
    let from = 0;
    for (;;) {
        const at = source.indexOf(needle, from);
        if (at < 0) break;
        from = at + needle.length;
        const open = source.indexOf("{", at);
        if (open < 0) continue;
        let depth = 0;
        for (let i = open; i < source.length; i += 1) {
            const ch = source[i];
            if (ch === "{") depth += 1;
            else if (ch === "}") {
                depth -= 1;
                if (depth === 0) { calls.push(source.slice(open, i + 1)); from = i; break; }
            }
        }
    }
    return calls;
}

const files = [
    ...await sourceFiles(path.join(ROOT, "modules")),
    ...await sourceFiles(path.join(ROOT, "plugins")),
    ...await sourceFiles(path.join(ROOT, "src")),
];

test("every persistOutbox resource declares a serialize @unit", async () => {
    const offenders = [];
    for (const file of files) {
        const source = await readFile(file, "utf8");
        if (!source.includes("defineResource(")) continue;
        for (const body of defineResourceCalls(source)) {
            if (!/\bpersistOutbox\s*:\s*true/.test(body)) continue;
            if (/\bserialize\s*[:(]/.test(body)) continue;
            const name = body.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "(unnamed)";
            offenders.push(`${path.relative(ROOT, file)} → resource "${name}"`);
        }
    }

    expect(
        offenders,
        "a resource with a persistent outbox must declare serialize() returning JSON-safe data "
        + "— without it the raw item is structured-cloned into IndexedDB, and one non-cloneable "
        + "field silently disables crash-recovery for the whole resource "
        + '(see src/types/io.d.ts, "persistOutbox")',
    ).toEqual([]);
});

test("the scan actually found the resources it is guarding @unit", () => {
    // Guards the guard: a path change or a rename that makes `sourceFiles`
    // return nothing would turn the assertion above into a green no-op.
    expect(files.length).toBeGreaterThan(50);
});
