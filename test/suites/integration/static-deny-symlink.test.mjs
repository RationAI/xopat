/**
 * The static deny-list has to judge the file that is served, not the URL asked for.
 *
 * Resolution runs two gates: a deny-list (dotfiles, `*.server.*`, `server.json`)
 * and containment against the allowlist of roots. Containment was checked on the
 * realpath, correctly — but the deny-list was applied only to the request-relative
 * path. A symlink INSIDE an allowed root pointing at a denied file in the same
 * root therefore satisfied containment and never met the deny gate again, so the
 * caller chose which rule applied by choosing the name they asked for.
 *
 * What that reaches is not hypothetical: `.git/config` (credentials in a remote
 * URL), a plugin's `server.json`, or a `*.server.ts` source sitting next to the
 * client bundle it ships with.
 *
 * Symlink creation is unprivileged on POSIX and privileged on Windows, so the
 * tests skip with a reason rather than failing on a machine that cannot make one.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Make `src/<name>` point at `target`, or return null when the platform refuses.
 * Returns a disposer; the link lives inside a served root, so it must not survive
 * the test.
 */
async function linkInSrc(name, target) {
    const link = path.join(REPO, "src", name);
    await fsp.rm(link, { force: true });
    try {
        await fsp.symlink(target, link);
    } catch (e) {
        return null;                       // EPERM on Windows without privilege
    }
    return async () => { await fsp.rm(link, { force: true }); };
}

/** A file that exists and that the deny-list refuses by name. */
function deniedTarget() {
    for (const rel of [".git/config", ".gitignore", "src/.gitignore"]) {
        const abs = path.join(REPO, rel);
        if (fs.existsSync(abs)) return abs;
    }
    return null;
}

test("a symlink to a dotfile inside an allowed root is not served", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    const target = deniedTarget();
    test.skip(!target, "no dotfile target present in this checkout");

    const dispose = await linkInSrc("denied-link.js", target);
    test.skip(!dispose, "this platform does not allow creating symlinks unprivileged");

    try {
        const res = await fetch(`${xopatServer.baseURL}/src/denied-link.js`);
        // 404, not 403: the resolver reports "no such asset" for everything it
        // refuses, so a probe cannot tell a denied file from a missing one.
        expect(res.status, "a link to a denied file must not resolve").toBe(404);

        const body = await res.text();
        expect(body, "no part of the target may come back").not.toContain("[core]");
    } finally {
        await dispose();
    }
});

test("a symlink to a server manifest is not served", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // Written rather than found: `server.json` is exactly the shape the gate
    // names, and this asserts the gate rather than the checkout's contents.
    const secret = path.join(REPO, "src", "__test-server.json");
    await fsp.writeFile(secret, JSON.stringify({ secret: "must-not-be-served" }), "utf8");

    const dispose = await linkInSrc("manifest-link.js", secret);
    if (!dispose) await fsp.rm(secret, { force: true });
    test.skip(!dispose, "this platform does not allow creating symlinks unprivileged");

    try {
        // The link's own name passes the deny-list; only the target's name fails
        // it, which is the whole point.
        const res = await fetch(`${xopatServer.baseURL}/src/manifest-link.js`);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("must-not-be-served");
    } finally {
        await dispose();
        await fsp.rm(secret, { force: true });
    }
});

test("an ordinary file in an allowed root still resolves", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    // The bound must not have been bought by refusing everything.
    const res = await fetch(`${xopatServer.baseURL}/src/config.json`);
    expect(res.status, "a normal served asset is unaffected").toBe(200);
});

test("a denied path asked for directly is still denied", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // Real files, inside served roots, that the deny-list refuses by name. Both
    // carry an extension, which is what routes them to the static resolver at
    // all — an extensionless path never reaches it.
    for (const denied of [
        "/modules/oidc-client-ts/register.server.ts",
        "/modules/vercel-ai-chat-sdk/server.json",
    ]) {
        const res = await fetch(`${xopatServer.baseURL}${denied}`);
        expect(res.status, `${denied} must not be served`).toBe(404);
    }
});
