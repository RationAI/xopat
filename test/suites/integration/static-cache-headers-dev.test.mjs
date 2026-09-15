/**
 * The dev-mode half of the `?v=` caching contract.
 *
 * Separate file because `xopatDevMode` is a worker-scoped option and cannot be
 * scoped to a describe block — and because it genuinely needs its own server:
 * one process is either `--dev` or not. `static-cache-headers.test.mjs` pins
 * what every non-dev deployment does; this pins the one thing dev mode changes.
 *
 * Why it matters: `?v=` carries the APP version, so it does not change when a
 * file does. Freezing on it meant a developer's browser ran stale module code
 * until a hard reload while the server served the new file — which is how a
 * verified fix went on producing the warning it had removed.
 */
import { test, expect } from "@xopat/test-harness";

test.use({ xopatDevMode: true });

const ASSET = "/src/config.json";

test("a versioned asset revalidates in dev mode instead of freezing", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    const page = await (await fetch(`${xopatServer.baseURL}/`)).text();
    expect(/window\.XOPAT_DEV_MODE\s*=\s*true/.test(page), "the fixture started --dev").toBe(true);

    const res = await fetch(`${xopatServer.baseURL}${ASSET}?v=3.1.0`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control"), "the edit you just made must be reachable")
        .not.toMatch(/immutable/);
    expect(res.headers.get("etag"), "revalidation still needs a validator").toBeTruthy();

    // Revalidating must not mean re-sending; otherwise dev mode trades a
    // correctness bug for a bandwidth one.
    const cached = await fetch(`${xopatServer.baseURL}${ASSET}?v=3.1.0`, {
        headers: { "If-None-Match": res.headers.get("etag") },
    });
    expect(cached.status).toBe(304);
});
