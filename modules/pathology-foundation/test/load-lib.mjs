/**
 * Load a module from `pathology-foundation/lib/` into a test.
 *
 * The engine's pure layer is TypeScript, so it is transpiled with the esbuild the
 * repo already depends on — the same approach as
 * `modules/vercel-ai-chat-sdk/test/unit/payload-slimming.test.mjs`.
 *
 * `platform: "neutral"` is deliberate: it is what proves these modules carry no
 * viewer, DOM or Node dependency. A helper that reaches for `window` or `document`
 * at import time fails here rather than silently making the "pure" layer impure.
 * (DOM-typed *bodies* are fine — `pixelsToPngBlob` is never called from a test.)
 *
 * Not named `*.test.mjs`, so the runner's discovery glob skips it.
 */
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const libDir = path.join(fromRoot(), "modules", "pathology-foundation", "lib");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-pathology-lib-"));

const cache = new Map();

/** Transpile + import `lib/<name>.ts`, memoized per process. */
export async function loadLib(name) {
    if (!cache.has(name)) {
        const outfile = path.join(tmp, `${name}.mjs`);
        await esbuild.build({
            entryPoints: [path.join(libDir, `${name}.ts`)],
            outfile,
            bundle: true,
            platform: "neutral",
            format: "esm",
            logLevel: "silent",
        });
        cache.set(name, await import(pathToFileURL(outfile).href));
    }
    return cache.get(name);
}

/** Drop the transpile scratch directory. Call from `test.afterAll`. */
export function cleanupLib() {
    rmSync(tmp, { recursive: true, force: true });
}

/** A binary mask from an ASCII picture — `#` is tissue, anything else is glass. */
export function maskFromRows(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const binaryMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rows[y][x] === "#") binaryMask[y * width + x] = 1;
        }
    }
    return { binaryMask, width, height };
}
