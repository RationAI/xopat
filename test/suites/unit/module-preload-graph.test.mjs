/**
 * The page preloads an element's static ES-module import graph.
 *
 * A browser discovers a module's imports only after fetching and parsing it, so
 * a plugin entry that imports a chain of sub-modules pays one round trip per
 * level. The DICOM plugin paid four (~2 s over a distant link) before any slide
 * request could start. `collectStaticModuleImports` finds the graph so the page
 * can emit `<link rel="modulepreload">` for all of it at once.
 */
import { test, expect } from "@xopat/test-harness";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { collectStaticModuleImports } = require("../../../server/templates/javascript/utils.js");

const read = (p) => readFileSync(p, "utf8");

function fixture(files) {
    const root = mkdtempSync(path.join(tmpdir(), "xopat-preload-"));
    const written = [];
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        written.push(abs);
    }
    return {
        root: root.replace(/\\/g, "/") + "/",
        cleanup() {
            // fs.rmSync silently no-ops on some synced NTFS folders; unlink explicitly.
            for (const f of written) unlinkSync(f);
            for (const d of [path.join(root, "sub"), root]) { try { rmdirSync(d); } catch { /* absent */ } }
        },
    };
}

test("walks static imports transitively, skipping dynamic and commented ones", {
    tag: ["@unit"],
}, async () => {
    const fx = fixture({
        "index.mjs": [
            `import { A } from "./a.mjs";`,
            `import "./side.mjs";`,
            `export { B } from './sub/b.mjs';`,
            `// import { X } from "./commented.mjs";`,
            `/* import { Y } from "./block.mjs"; */`,
            `const lazy = () => import("./lazy.mjs");`,
            `import { Z } from "../outside.mjs";`,
            `import { M } from "./missing.mjs";`,
        ].join("\n"),
        "a.mjs": `import { B } from "./sub/b.mjs";\nexport const A = 1;`,
        "side.mjs": ``,
        "sub/b.mjs": `import { C } from "../a.mjs";\nexport const B = 2;`,
        "commented.mjs": ``,
        "block.mjs": ``,
        "lazy.mjs": ``,
    });
    try {
        const deps = collectStaticModuleImports(fx.root, "index.mjs", existsSync, read);
        expect(deps.sort()).toEqual(["a.mjs", "side.mjs", "sub/b.mjs"]);
    } finally {
        fx.cleanup();
    }
});

test("finds the DICOM plugin's sub-module chain", { tag: ["@unit"] }, async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../plugins/dicom")
        .replace(/\\/g, "/") + "/";
    const deps = collectStaticModuleImports(root, "index.workspace.mjs", existsSync, read);
    // The deepest level of the chain the HAR showed loading last.
    expect(deps).toContain("tile-source.mjs");
    expect(deps).toContain("shaders/voi-controls.mjs");
    // Dynamically imported on purpose — preloading it would defeat the laziness.
    expect(deps).not.toContain("annotation-convertor.mjs");
});
