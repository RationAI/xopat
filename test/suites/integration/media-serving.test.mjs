/**
 * `core.server.media` — streamed, `Range`-aware serving of bulk data.
 *
 * The viewer's static handler answers every request with one buffered `readFile`
 * and a `200`, which is correct for a 40 kB bundle and useless for a slide: a
 * client-side decoder reads a pyramid by byte range, and a `200` carrying the
 * whole file is not an answer to `Range: bytes=…`. That is why the TIFF
 * deployments needed a second process (`npm run fixtures:serve`) that the setup
 * instructions did not mention.
 *
 * Serving media is genuinely more capability than serving assets — long-lived
 * open handles, concurrent partial reads, an amplification lever a directory of
 * bundles does not have — so it is a SEPARATE opt-in with its own allowlist,
 * and these tests pin both halves of that: what a deployment gets when it
 * declares nothing (exactly what it had before), and what the bounds are when it
 * does.
 *
 * The probe root is written by the test rather than pointed at
 * `test/fixtures/data`, so this asserts the mechanism on any checkout — the
 * fixture slides are a 3.4 GB optional download.
 */
import { test, expect } from "@xopat/test-harness";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROBE_REL = "test/fixtures/media-probe";
const PROBE_DIR = path.join(REPO, PROBE_REL);

/** 4 KiB of position-encoded bytes, so a wrong offset is visible, not plausible. */
const PROBE_BYTES = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

async function writeProbe() {
    await fsp.mkdir(PROBE_DIR, { recursive: true });
    await fsp.writeFile(path.join(PROBE_DIR, "probe.tif"), PROBE_BYTES);
    await fsp.writeFile(path.join(PROBE_DIR, "notes.md"), "must not be served");
}

async function removeProbe() {
    await fsp.rm(PROBE_DIR, { recursive: true, force: true });
}

/** Declare the media block and restart — `core.server.media` is read once at boot. */
async function withMedia(xopatServer, media, body) {
    const original = xopatServer.scratch.read();
    await xopatServer.setEnv({ core: { server: { media } } });
    await xopatServer.restart();
    try {
        await body();
    } finally {
        await xopatServer.replaceEnv(original);
        await xopatServer.restart();
    }
}

test("a deployment that declares no media block is unchanged", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    await writeProbe();
    try {
        // Nothing new is reachable...
        const probe = await fetch(`${xopatServer.baseURL}/${PROBE_REL}/probe.tif`);
        expect(probe.status, "an undeclared directory is not served").toBe(404);

        // ...and nothing about the asset path changed. A `Range` header on a
        // served asset still gets the whole file and no range advertisement,
        // which is what every existing deployment already relies on.
        const asset = await fetch(`${xopatServer.baseURL}/src/config.json`, {
            headers: { Range: "bytes=0-9" },
        });
        expect(asset.status, "assets never answer 206").toBe(200);
        expect(asset.headers.get("accept-ranges"), "and never advertise ranges").toBeNull();
    } finally {
        await removeProbe();
    }
});

test("a declared media root serves ranges, and only what it declared", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    await writeProbe();
    try {
        await withMedia(xopatServer, {
            roots: [PROBE_REL],
            extensions: [".tif"],
        }, async () => {
            const base = `${xopatServer.baseURL}/${PROBE_REL}`;

            const ranged = await fetch(`${base}/probe.tif`, { headers: { Range: "bytes=10-19" } });
            expect(ranged.status).toBe(206);
            expect(ranged.headers.get("content-range")).toBe(`bytes 10-19/${PROBE_BYTES.length}`);
            expect(ranged.headers.get("accept-ranges")).toBe("bytes");
            const body = Buffer.from(await ranged.arrayBuffer());
            expect(body.equals(PROBE_BYTES.subarray(10, 20)), "the bytes asked for").toBe(true);

            // RFC 7233 requires a STRONG validator for If-Range; a weak one would
            // silently downgrade every resumed read to a full transfer.
            expect(ranged.headers.get("etag"), "strong validator").not.toMatch(/^W\//);

            const suffix = await fetch(`${base}/probe.tif`, { headers: { Range: "bytes=-16" } });
            expect(suffix.status, "a suffix range is a range").toBe(206);
            expect(suffix.headers.get("content-range"))
                .toBe(`bytes ${PROBE_BYTES.length - 16}-${PROBE_BYTES.length - 1}/${PROBE_BYTES.length}`);

            const past = await fetch(`${base}/probe.tif`, { headers: { Range: "bytes=99999-" } });
            expect(past.status, "past the end is 416, not an empty 206").toBe(416);
            expect(past.headers.get("content-range")).toBe(`bytes */${PROBE_BYTES.length}`);

            // Multi-range is legal to answer whole; it is not legal to answer wrong.
            const multi = await fetch(`${base}/probe.tif`, { headers: { Range: "bytes=0-9,20-29" } });
            expect(multi.status, "multi-range falls back to the full body").toBe(200);

            // The extension list is a REACHABILITY rule. If it only chose the
            // delivery mode, declaring a root for `.tif` would still publish
            // every README, key and note sitting beside the slides.
            const denied = await fetch(`${base}/notes.md`);
            expect(denied.status, "an undeclared extension inside a media root").toBe(404);

            // The containment gates are the static ones, unchanged.
            const escape = await fetch(`${base}/../../../package.json`);
            expect(escape.status, "traversal out of a media root").toBe(404);
        });
    } finally {
        await removeProbe();
    }
});

test("If-Range and conditional reads behave", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    await writeProbe();
    try {
        await withMedia(xopatServer, { roots: [PROBE_REL] }, async () => {
            const url = `${xopatServer.baseURL}/${PROBE_REL}/probe.tif`;

            const head = await fetch(url, { method: "HEAD" });
            expect(head.status).toBe(200);
            expect(head.headers.get("content-length")).toBe(String(PROBE_BYTES.length));
            const etag = head.headers.get("etag");

            const matched = await fetch(url, { headers: { Range: "bytes=0-9", "If-Range": etag } });
            expect(matched.status, "a matching validator keeps the range").toBe(206);

            const stale = await fetch(url, {
                headers: { Range: "bytes=0-9", "If-Range": '"0-0"' },
            });
            expect(stale.status, "a stale validator means send the whole entity").toBe(200);

            const cached = await fetch(url, { headers: { "If-None-Match": etag } });
            expect(cached.status, "unchanged entity").toBe(304);
        });
    } finally {
        await removeProbe();
    }
});

test("the operator's bounds are enforced, not advisory", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    await writeProbe();
    try {
        await withMedia(xopatServer, { roots: [PROBE_REL], maxRangeBytes: 64 }, async () => {
            const url = `${xopatServer.baseURL}/${PROBE_REL}/probe.tif`;

            // Clamped rather than refused: a decoder asking for more than the
            // deployment allows gets a short read it can continue from, not a
            // failure it has no way to interpret.
            const big = await fetch(url, { headers: { Range: "bytes=0-4095" } });
            expect(big.status).toBe(206);
            expect(big.headers.get("content-range")).toBe(`bytes 0-63/${PROBE_BYTES.length}`);
            expect(Number(big.headers.get("content-length"))).toBe(64);
        });
    } finally {
        await removeProbe();
    }
});

test("a media root outside the application root is refused", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // Honouring it would turn an ENV typo into a filesystem read primitive. This
    // is also why slides living elsewhere still go through
    // `npm run fixtures:serve` instead of being declared here.
    await withMedia(xopatServer, { roots: ["../", "/etc"] }, async () => {
        const res = await fetch(`${xopatServer.baseURL}/package.json`);
        expect(res.status, "the repo root does not become servable").toBe(404);
    });
});
