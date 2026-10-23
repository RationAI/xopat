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
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** An asset that exists in every deployment and is always version-stamped. */
const ASSET = "/src/config.json";

/**
 * GET without transparent decoding — `fetch` decompresses and hides what was
 * actually on the wire, which is the thing under test.
 */
function rawGet(xopatServer, urlPath, headers = {}) {
    const url = new URL(urlPath, xopatServer.baseURL);
    const lib = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.get(url, { headers }, (res) => {
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on("error", reject);
        });
        req.on("error", reject);
    });
}

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

test("an unversioned asset is reusable for a bounded time, then revalidated", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    // Unversioned assets are the dynamic `import()`s of element sub-modules,
    // fonts, logos and model weights. They used to be `no-store`: every load
    // re-downloaded them in full, a dozen serial round trips over a distant
    // link. Bounded `max-age` keeps an edit-on-deploy visible within the hour.
    const res = await fetch(`${xopatServer.baseURL}${ASSET}`);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).not.toMatch(/no-store|immutable/);
    expect(cc).toMatch(/max-age=\d+/);
    expect(res.headers.get("etag"), "revalidation needs a validator").toBeTruthy();
});

test("a text asset is compressed when the client accepts it", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    // Raw bundles were ~8 MB per cold load; over a thin link that was the
    // whole startup time.
    const original = await fsp.readFile(path.join(REPO, ASSET));
    for (const encoding of ["br", "gzip"]) {
        const raw = await rawGet(xopatServer, `${ASSET}?v=3.1.0`, { "Accept-Encoding": encoding });
        expect(raw.status).toBe(200);
        expect(raw.headers["content-encoding"]).toBe(encoding);
        expect(raw.headers["vary"] ?? "").toMatch(/accept-encoding/i);
        expect(raw.body.length).toBeLessThan(original.length);
        const decoded = encoding === "br" ? zlib.brotliDecompressSync(raw.body) : zlib.gunzipSync(raw.body);
        expect(decoded.equals(original), `${encoding} body decodes to the file`).toBe(true);

        // The ETag names the representation, so it must differ from the
        // identity one — and revalidating it must still be a 304.
        expect(raw.headers["etag"]).toMatch(new RegExp(`-${encoding}"$`));
        const again = await rawGet(xopatServer, `${ASSET}?v=3.1.0`, {
            "Accept-Encoding": encoding, "If-None-Match": raw.headers["etag"],
        });
        expect(again.status).toBe(304);
    }

    const identity = await rawGet(xopatServer, `${ASSET}?v=3.1.0`, { "Accept-Encoding": "identity" });
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.body.equals(original)).toBe(true);
});

test("binary assets are not recompressed", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const raw = await rawGet(xopatServer, "/src/assets/logos/xopat-logo.png", { "Accept-Encoding": "br, gzip" });
    expect(raw.status).toBe(200);
    expect(raw.headers["content-encoding"]).toBeUndefined();
});

test("the viewer page is compressed and never cached", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const raw = await rawGet(xopatServer, "/", { "Accept-Encoding": "br" });
    expect(raw.status).toBe(200);
    expect(raw.headers["content-encoding"]).toBe("br");
    expect(raw.headers["cache-control"]).toMatch(/no-store/);
    expect(zlib.brotliDecompressSync(raw.body).toString("utf8")).toMatch(/<html/i);
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
