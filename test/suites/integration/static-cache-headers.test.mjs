/**
 * `?v=` is the APP version, not the file's.
 *
 * Every module and plugin asset is served with `?v=<app version>`
 * (`server/templates/javascript/modules.js`), and a versioned request used to be
 * answered `immutable, max-age=31536000` unconditionally. The version only
 * changes on release, so editing a module source never changed the URL and a
 * warm browser kept running last week's code for a year — while the server
 * happily served the new file. That cost a debugging session: a fix was verified
 * on the wire, and the browser went on printing the warning the fix removed.
 *
 * So the freeze is release-scoped and correct in production, and a trap in
 * development. These pin both halves.
 */
import { test, expect } from "@xopat/test-harness";

/** An asset that exists in every deployment and is always version-stamped. */
const ASSET = "/src/config.json";

test("a versioned asset is frozen when the server is not in dev mode", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    expect(await isDevMode(xopatServer), "matrix projects do not run --dev").toBe(false);

    const res = await fetch(`${xopatServer.baseURL}${ASSET}?v=3.1.0`);
    expect(res.status).toBe(200);
    // The whole point of stamping the version: across releases the URL changes,
    // so within one release the file cannot.
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
});

test("a conditional re-request is cheap either way", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    // Revalidating must not mean re-sending: without this, dev mode would trade
    // a correctness bug for a bandwidth one.
    const first = await fetch(`${xopatServer.baseURL}${ASSET}?v=3.1.0`);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(`${xopatServer.baseURL}${ASSET}?v=3.1.0`, {
        headers: { "If-None-Match": etag },
    });
    expect(second.status).toBe(304);
});

test("an unversioned asset is never cached", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const res = await fetch(`${xopatServer.baseURL}${ASSET}`);
    expect(res.headers.get("cache-control")).toMatch(/no-store|no-cache/);
});

test("a long file extension still reaches the static handler", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    // The static route is gated on "this path looks like a file", and that gate
    // used to stop at a five-character suffix. `.geojson` is seven, so the
    // request fell through to the page renderer and was answered `200
    // text/html` — the application's own HTML, for a URL asking for map data.
    //
    // Asserting the status is not enough to catch it, and that is the point of
    // this test: the failure *is* a 200. What it broke was three demo sessions
    // reporting `Unexpected token '<'` from a JSON parser, which names neither
    // the file nor the server.
    const res = await fetch(`${xopatServer.baseURL}/src/config.json`);
    expect(res.status).toBe(200);

    for (const suffix of ["geojson", "webmanifest"]) {
        const missing = await fetch(`${xopatServer.baseURL}/src/no-such-asset.${suffix}`);
        // 404 means the static handler judged it and found nothing. An HTML body
        // means the router never handed it over at all.
        expect(missing.status, `.${suffix} is routed to the static handler`).toBe(404);
        expect(missing.headers.get("content-type") ?? "", `.${suffix} is not the app page`)
            .not.toMatch(/text\/html/);
    }
});

/** The server publishes its own dev flag into the page it renders. */
async function isDevMode(xopatServer) {
    const page = await (await fetch(`${xopatServer.baseURL}/`)).text();
    return /window\.XOPAT_DEV_MODE\s*=\s*true/.test(page);
}
