#!/usr/bin/env node
/**
 * Fetch the fixture slides named by `test/fixtures/data/manifest.json`.
 *
 *     npm run fixtures:fetch
 *     npm run fixtures:fetch -- --only slide.tif,cancer-inference.tif
 *     npm run fixtures:fetch -- --list
 *     npm run fixtures:fetch -- --print-manifest       # after adding a file by hand
 *
 * ## Why a manifest and not a shell script
 *
 * This replaces `docs/data/slides/download.sh`, which was three commented-out
 * `curl` lines and a `#TODO`. A shell script rots because nothing ever checks
 * it; a manifest is data, so the fetcher, the docs catalogue page
 * (`docs/site/scripts/generate-fixtures.mjs`) and the session index all read the
 * same record, and a missing field is a visible hole rather than silence.
 *
 * Every item carries a `sha256`. Bytes that do not match are deleted, not
 * warned about: a half-downloaded 2 GB OME-TIFF decodes far enough to produce a
 * plausible-looking wrong demo, which is worse than no demo. An item whose
 * checksum is still `null` (not yet published) refuses to download at all and
 * says which file and what to do — the alternative is trusting unverified bytes
 * because someone forgot to fill a field in.
 *
 * ## Native `fetch` here is deliberate
 *
 * AGENTS.md §0.3/§4 route upstream HTTP through `window.HttpClient` (browser) or
 * `XOPAT_SERVER.safeRequest` (server). Neither exists in a standalone dev CLI,
 * and neither rule is about one: they exist because *runtime* code carries user
 * credentials and attacker-influenced hostnames. Here the hostname comes from a
 * tracked file the developer is reading anyway. Same exemption `derive.mjs`
 * takes for its cross-boundary import.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fromRoot } from "../paths.mjs";

export const DATA_DIR = fromRoot("test", "fixtures", "data");
export const SLIDES_DIR = path.join(DATA_DIR, "slides");
export const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

const log = (...args) => console.log("[fixtures]", ...args);

/** Read the manifest, resolving each item's absolute download URL. */
export function loadManifest() {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    // A mirror (or a local copy served over HTTP) needs no edit to a tracked file.
    const baseUrl = (process.env.XOPAT_FIXTURE_BASE || raw.baseUrl).replace(/\/+$/, "");
    const items = Object.entries(raw.items).map(([name, item]) => {
        const mirror = item.asset ? `${baseUrl}/${item.asset}` : null;
        // A third-party `url` is preferred so we do not re-host what upstream
        // already serves; `asset` is the fallback for when upstream moves or
        // silently republishes different bytes, which is exactly the case the
        // checksum turns from a mystery into a retry.
        const urls = [item.url, mirror].filter(Boolean);
        return {
            name,
            ...item,
            urls: urls.length ? urls : [`${baseUrl}/${name}`],
            file: path.join(SLIDES_DIR, name),
        };
    });
    return { ...raw, baseUrl, items };
}

async function sha256(file) {
    const hash = crypto.createHash("sha256");
    await pipeline(fs.createReadStream(file), hash);
    return hash.digest("hex");
}

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/**
 * Is this item already on disk and intact?
 *
 * Size is checked first because it is free and rules out the common failure
 * (an interrupted download), leaving the multi-second hash for the case where
 * the answer is genuinely unknown.
 */
async function verify(item, { quick = false } = {}) {
    if (!fs.existsSync(item.file)) return { ok: false, reason: "missing" };
    const { size } = await fsp.stat(item.file);
    if (item.bytes && size !== item.bytes) {
        return { ok: false, reason: `size ${size} != ${item.bytes}` };
    }
    if (quick || !item.sha256) return { ok: true, reason: "size" };
    const actual = await sha256(item.file);
    if (actual !== item.sha256) return { ok: false, reason: `sha256 ${actual.slice(0, 12)}… != ${item.sha256.slice(0, 12)}…` };
    return { ok: true, reason: "sha256" };
}

async function downloadFrom(item, url, partial) {
    log(`downloading ${item.name} (${item.bytes ? mib(item.bytes) : "size unknown"}) from ${url}`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));

    const actual = await sha256(partial);
    if (actual !== item.sha256) {
        throw new Error(`checksum mismatch — got ${actual}, manifest says ${item.sha256}`);
    }
}

async function download(item) {
    const partial = `${item.file}.part`;
    await fsp.mkdir(path.dirname(item.file), { recursive: true });

    const failures = [];
    for (const url of item.urls) {
        await fsp.rm(partial, { force: true });
        try {
            await downloadFrom(item, url, partial);
            await fsp.rename(partial, item.file);
            log(`${item.name} verified`);
            return;
        } catch (error) {
            // Discarded rather than kept: a truncated TIFF opens far enough to
            // render a plausible-looking wrong demo.
            await fsp.rm(partial, { force: true });
            failures.push(`  ${url}\n    ${error.message}`);
        }
    }
    throw new Error(
        `[fixtures] ${item.name}: every source failed.\n${failures.join("\n")}\n` +
        `If the upstream file legitimately changed, re-publish it and refresh the manifest with ` +
        `\`npm run fixtures:fetch -- --print-manifest\`.`
    );
}

/**
 * Ensure the named fixture items are present and intact. Returns the resolved
 * manifest records so a caller can read `file` without re-resolving paths.
 *
 * Mirrors `ensureSyntheticSlide()`: re-running is cheap, and the only side
 * effect is on a gitignored directory.
 *
 * @param {string[]|null} [only] item names; null means every item
 * @param {{force?: boolean, quick?: boolean}} [options]
 */
export async function ensureFixtureData(only = null, options = {}) {
    const { force = false, quick = false } = options;
    const manifest = loadManifest();
    const wanted = only
        ? manifest.items.filter(i => only.includes(i.name))
        : manifest.items;

    const unknown = (only || []).filter(n => !manifest.items.some(i => i.name === n));
    if (unknown.length) throw new Error(`[fixtures] not in manifest: ${unknown.join(", ")}`);

    for (const item of wanted) {
        if (!force) {
            const state = await verify(item, { quick });
            if (state.ok) { log(`${item.name} present (${state.reason})`); continue; }
            if (state.reason !== "missing") log(`${item.name} rejected: ${state.reason}`);
        }
        if (!item.sha256) {
            throw new Error(
                `[fixtures] ${item.name} has no sha256 in the manifest, so it cannot be verified and will not ` +
                `be downloaded. Publish the file, then run \`npm run fixtures:fetch -- --print-manifest\` ` +
                `with the file in ${SLIDES_DIR} to emit the checksum block. See ${path.relative(fromRoot(), path.join(DATA_DIR, "README.md"))}.`
            );
        }
        await download(item);
    }
    return wanted;
}

/** What is on disk right now — used by `--list` and by the docs catalogue. */
export async function fixtureStatus() {
    const manifest = loadManifest();
    const rows = [];
    for (const item of manifest.items) {
        rows.push({ ...item, state: await verify(item, { quick: true }) });
    }
    return rows;
}

/**
 * Emit the `sha256`/`bytes` pairs for whatever is currently in `slides/`, so
 * publishing a new fixture is copy-paste rather than a `sha256sum` incantation
 * that differs per platform.
 */
async function printManifest() {
    if (!fs.existsSync(SLIDES_DIR)) throw new Error(`[fixtures] no ${SLIDES_DIR}`);
    const out = {};
    for (const name of (await fsp.readdir(SLIDES_DIR)).sort()) {
        const file = path.join(SLIDES_DIR, name);
        const stat = await fsp.stat(file);
        if (!stat.isFile() || name.endsWith(".part")) continue;
        process.stderr.write(`hashing ${name}…\n`);
        out[name] = { sha256: await sha256(file), bytes: stat.size };
    }
    console.log(JSON.stringify(out, null, 4));
}

function parseArgs(argv) {
    const opts = { only: null, force: false, list: false, print: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--only") opts.only = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
        else if (argv[i] === "--force") opts.force = true;
        else if (argv[i] === "--list") opts.list = true;
        else if (argv[i] === "--print-manifest") opts.print = true;
        else throw new Error(`[fixtures] unknown argument "${argv[i]}"`);
    }
    return opts;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const opts = parseArgs(process.argv.slice(2));
    try {
        if (opts.print) {
            await printManifest();
        } else if (opts.list) {
            const rows = await fixtureStatus();
            const width = Math.max(...rows.map(r => r.name.length));
            for (const r of rows) {
                const mark = r.state.ok ? "present" : r.sha256 ? "MISSING" : "UNPUBLISHED";
                console.log(`${r.name.padEnd(width)}  ${mark.padEnd(11)}  ${r.bytes ? mib(r.bytes).padStart(10) : "".padStart(10)}  ${r.purpose || ""}`);
            }
        } else {
            await ensureFixtureData(opts.only, { force: opts.force });
            log("all requested fixture data present");
        }
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
