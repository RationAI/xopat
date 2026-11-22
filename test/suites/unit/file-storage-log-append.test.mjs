/**
 * Concurrent writes to ONE key of the file storage driver.
 *
 * A log append (and a blob put) is a read-modify-write over two files — the data and its
 * `.meta.json`. Two overlapping chat turns of the same session used to run it unserialized:
 * both read `length: n`, both wrote `n + 1`, and on Windows the second rename onto the same
 * destination failed with EPERM, losing the turn. What these vectors pin:
 *  - concurrent appends to one key all succeed, every entry is kept, and `length` counts them;
 *  - a failing write does not wedge the key for the writers queued behind it;
 *  - different keys do not wait on each other's order (they still all complete).
 */
import { test, expect } from "@xopat/test-harness";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createFileDriver } = require("../../../server/node/storage/drivers/file.js");

const logNs = { id: "t/log:x", ownerUid: "t", namespace: "x", shape: "log", capabilityId: "log:x", policy: {} };

function withDriver() {
    const root = mkdtempSync(path.join(tmpdir(), "xopat-filedrv-"));
    return { root, driver: createFileDriver({ root, fsync: false }) };
}

test("concurrent appends to one key keep every entry and count them", async () => {
    const { root, driver } = withDriver();
    try {
        const N = 60;
        const lengths = await Promise.all(
            Array.from({ length: N }, (_, i) => driver.append(logNs, "session", [{ i }]))
        );
        // Serialized: each append saw the one before it.
        expect([...lengths].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
        expect(await driver.length(logNs, "session")).toBe(N);
        const entries = await driver.range(logNs, "session", {});
        expect(entries.map(e => e.i).sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("a failed append does not block the appends queued behind it", async () => {
    const { root, driver } = withDriver();
    try {
        const cyclic = {}; cyclic.self = cyclic;   // JSON.stringify throws
        const results = await Promise.allSettled([
            driver.append(logNs, "session", [{ ok: 1 }]),
            driver.append(logNs, "session", [cyclic]),
            driver.append(logNs, "session", [{ ok: 2 }]),
        ]);
        expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
        expect(await driver.length(logNs, "session")).toBe(2);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("appends to different keys all complete", async () => {
    const { root, driver } = withDriver();
    try {
        await Promise.all(Array.from({ length: 20 }, (_, i) => driver.append(logNs, `s${i % 4}`, [{ i }])));
        for (let k = 0; k < 4; k++) expect(await driver.length(logNs, `s${k}`)).toBe(5);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
