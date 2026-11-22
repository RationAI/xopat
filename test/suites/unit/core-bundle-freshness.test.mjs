/**
 * `inspectCoreBundle` decides whether `src/dist` is older than `src/**\/*.ts`.
 *
 * Three callers trust the answer: the dev watcher rebuilds core at startup on it,
 * the dev server tells the page about it (the boot-failure screen), and the
 * browser fixture refuses to run against a stale bundle. A core left behind by an
 * edit made while the watcher was down is what crashed the viewer at boot with
 * `APPLICATION_CONTEXT.adjustments` undefined, so the rule is pinned here.
 *
 * Static only — a throwaway directory tree, no server, no browser.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { inspectCoreBundle, describeStaleCoreBundle } = require(fromRoot("server", "utils", "mixins", "build-logic.js"));

const BUILT = new Date("2026-01-01T12:00:00Z");
const EARLIER = new Date("2026-01-01T11:00:00Z");
const LATER = new Date("2026-01-01T13:00:00Z");

/** @param {Record<string, Date>} files repo-relative path -> mtime */
function tree(files) {
    const root = mkdtempSync(path.join(os.tmpdir(), "xopat-core-freshness-"));
    for (const [rel, mtime] of Object.entries(files)) {
        const full = path.join(root, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, "");
        utimesSync(full, mtime, mtime);
    }
    return root;
}

const withTree = (files, body) => {
    const root = tree(files);
    try {
        return body(root);
    } finally {
        try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    }
};

test.describe("core bundle freshness", () => {
    test("a bundle newer than every source is current", () => {
        withTree({
            "src/app.ts": EARLIER,
            "src/classes/app/adjustments.ts": EARLIER,
            "src/dist/app.js": BUILT,
            "src/dist/loader.js": BUILT,
        }, (root) => {
            const verdict = inspectCoreBundle(root);
            expect(verdict.stale).toBe(false);
            expect(describeStaleCoreBundle(verdict)).toBe("");
        });
    });

    test("a source edited after the build makes it stale and is named", () => {
        withTree({
            "src/app.ts": EARLIER,
            "src/classes/app/adjustments.ts": LATER,
            "src/dist/app.js": BUILT,
            "src/dist/loader.js": BUILT,
        }, (root) => {
            const verdict = inspectCoreBundle(root);
            expect(verdict.stale).toBe(true);
            expect(verdict.newestSource).toBe("src/classes/app/adjustments.ts");
            expect(describeStaleCoreBundle(verdict)).toContain("src/classes/app/adjustments.ts");
        });
    });

    test("the OLDEST output dates the build", () => {
        // app.js rebuilt, loader.js left behind: half a build is not a build.
        withTree({
            "src/loader.ts": BUILT,
            "src/dist/app.js": LATER,
            "src/dist/loader.js": EARLIER,
        }, (root) => {
            expect(inspectCoreBundle(root).stale).toBe(true);
        });
    });

    test("a missing output is stale", () => {
        withTree({
            "src/app.ts": EARLIER,
            "src/dist/app.js": BUILT,
        }, (root) => {
            const verdict = inspectCoreBundle(root);
            expect(verdict.stale).toBe(true);
            expect(verdict.missing).toEqual(["src/dist/loader.js"]);
            expect(describeStaleCoreBundle(verdict)).toContain("missing src/dist/loader.js");
        });
    });

    test("what the bundle is not compiled from cannot make it stale", () => {
        withTree({
            "src/app.ts": EARLIER,
            "src/types/app.d.ts": LATER,          // declarations
            "src/classes/thing.d.ts": LATER,      // declarations outside types/
            "src/libs/vendored.ts": LATER,        // vendored
            "src/locales/en.json": LATER,         // not TypeScript
            "src/user-interface.js": LATER,       // served as written, not bundled
            "src/dist/classes/old.ts": LATER,     // build output
            "src/dist/app.js": BUILT,
            "src/dist/loader.js": BUILT,
        }, (root) => {
            expect(inspectCoreBundle(root).stale).toBe(false);
        });
    });
});
