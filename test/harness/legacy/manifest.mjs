/**
 * The not-yet-ported test suites — found, not listed.
 *
 * These are standalone `node <file>.mjs` suites that predate the runner. They
 * are executed **unmodified** by `adapter.mjs`, which parses their output back
 * into runner-visible assertions, so every assertion they contain counts with
 * no rewrite and no risk of silently losing coverage.
 *
 * ## Where they live
 *
 * With their owner, under a `test/legacy/` directory:
 *
 *   test/legacy/<area>/*.mjs                  core (server, core, io, ui)
 *   {plugins,modules}/<id>/test/legacy/*.mjs  the element they exercise
 *
 * The element case matters for more than tidiness: a plugin or module
 * developed in its own repository carries its own suites, and this is the same
 * `<element>/test/<kind>/` shape the runner already uses for ported tests — so
 * porting one is a move *within* its element (`test/legacy/` → `test/unit/`),
 * not a relocation across the tree.
 *
 * Directories are scanned rather than enumerated, which makes the list
 * self-maintaining in both directions: a suite added to one of them is picked
 * up with no registration, and a ported suite disappears the moment its file
 * moves. An empty scan means the port is finished.
 *
 * Only what cannot be derived is declared, below: which suites need more than
 * the default time budget, and which carry a tag.
 */
import { readdirSync, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fromRoot } from "../paths.mjs";

/** Core areas. Remove one when it empties. */
const CORE_ROOT = "test/legacy";

/** Elements keep theirs here, relative to the element directory. */
const ELEMENT_SUBPATH = path.join("test", "legacy");

/** Default budget. Suites that boot a server or decode fixtures need more. */
const DEFAULT_TIMEOUT = 120_000;

/**
 * Keyed by `<area-or-element>/<basename>`.
 *
 * `chat-stress` is the RAM soak and scripted-upstream suite: minutes, not
 * seconds, hence `@slow` (out of the default run; `npm run test:slow`).
 */
const OVERRIDES = {
    "vercel-ai-chat-sdk/chat-stress": { tags: ["@slow"], timeout: 1_800_000 },
    "server/http-surface": { timeout: 300_000 },
    "server/storage-persistence": { timeout: 300_000 },
    "dicom/derived-conformance": { timeout: 180_000 },
};

/**
 * @typedef {object} LegacyEntry
 * @property {string} name      `<area-or-element>/<basename>`, also the test title
 * @property {string} file      repo-relative path to the script
 * @property {string[]} tags    runner tags
 * @property {number} timeout   ms
 */

/** `.mjs` files directly inside `dir`, as repo-relative paths. */
function suitesIn(dir, groupName, out) {
    const absolute = fromRoot(dir);
    if (!existsSync(absolute)) return;

    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (!entry.name.endsWith(".mjs")) continue;
        try {
            if (!statSync(realpathSync(path.join(absolute, entry.name))).isFile()) continue;
        } catch {
            continue;
        }
        const name = `${groupName}/${path.basename(entry.name, ".mjs")}`;
        const override = OVERRIDES[name] ?? {};
        out.push({
            name,
            file: `${dir}/${entry.name}`,
            tags: override.tags ?? ["@legacy"],
            timeout: override.timeout ?? DEFAULT_TIMEOUT,
        });
    }
}

/** Directory entries that are directories, following links like the server does. */
function subdirectories(dir) {
    const absolute = fromRoot(dir);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith("."))
        .filter(entry => {
            try { return statSync(realpathSync(path.join(absolute, entry.name))).isDirectory(); }
            catch { return false; }
        })
        .map(entry => entry.name);
}

function scan() {
    /** @type {LegacyEntry[]} */
    const found = [];

    // Core: test/legacy/<area>/*.mjs — the area names the subsystem.
    for (const area of subdirectories(CORE_ROOT)) {
        suitesIn(`${CORE_ROOT}/${area}`, area, found);
    }

    // Elements: {plugins,modules}/<id>/test/legacy/*.mjs — the element names itself.
    for (const kind of ["plugins", "modules"]) {
        for (const id of subdirectories(kind)) {
            suitesIn(`${kind}/${id}/${ELEMENT_SUBPATH.replace(/\\/g, "/")}`, id, found);
        }
    }

    return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** @type {LegacyEntry[]} */
export const LEGACY_SCRIPTS = scan();
