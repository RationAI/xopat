/**
 * Find NCI Imaging Data Commons slide-microscopy levels that are **sparse** or
 * split across several instances (**Concatenation**), and print what to paste to
 * open them.
 *
 * Runs against the IDC public proxy, which needs **no authentication**:
 *   node plugins/dicom/tools/find-idc-sparse.mjs [--pages 25] [--per-page 200]
 *                                                [--offset 0] [--concurrency 6]
 *                                                [--show-planes] [--refresh]
 *
 * Pages are cached on disk, so a re-run costs the remote store nothing — see the
 * page-cache section below.
 *
 * IDC holds on the order of 350k slide-microscopy instances, so
 * `--pages 2000 --per-page 200 --concurrency 8` sweeps the whole corpus in minutes
 * and turns the result from a sample into an answer.
 *
 * ## Why it works this way
 *
 * There is no targeted query for this. The backend is Google Healthcare, and
 * DimensionOrganizationType is not a searchable attribute there —
 * `/instances?00209311=TILED_SPARSE` answers **HTTP 400**. So the sweep pages
 * instances and filters client-side, and its cost is linear in rows scanned.
 *
 * What makes that affordable is that the QIDO row already carries everything
 * needed. `includefield` is honoured for TotalPixelMatrix and
 * DimensionOrganizationType, and the store returns NumberOfFrames and the tile
 * size unasked — so the grid can be computed per row:
 *
 *     expected = ceil(TotalPixelMatrixColumns / Columns) * ceil(TotalPixelMatrixRows / Rows)
 *
 * and `NumberOfFrames < expected` is exactly the condition that used to make a
 * level render nothing at all. No `/metadata` walk is needed, which matters: a
 * base level's metadata carries one functional-group item PER FRAME, and avoiding
 * that payload is the whole reason the pyramid scan is shaped the way it is.
 *
 * ## What counts as a hit
 *
 * - `frames < expected` — the level cannot be dense. Either a sparse level or one
 *   part of a concatenation.
 * - `ConcatenationUID` present — a concatenation part, stated outright.
 * - two or more instances of one series sharing TotalPixelMatrix dimensions — a
 *   concatenation the store did not label. Their frame counts are what tell it
 *   apart from the far more common case: parts SUM to the grid, whereas channels
 *   or focal planes each cover it on their own.
 *
 * That last grouping is the same rule `_injectLevelByDims` uses to collapse
 * instances onto one level, so anything reported here does reach the code under
 * test. The channel/plane case is counted and summarised rather than listed —
 * a t-CyCIF slide has 36 instances per level and would otherwise bury every real
 * hit. `--show-planes` lists them anyway.
 *
 * A miss means "nothing in the swept window" — which is only "IDC has none" when the
 * sweep actually reached the end of the collection, and the summary says which of the
 * two happened. Any page that failed is reported too: a silently skipped page would
 * turn a gap in coverage into a false negative.
 *
 * ## Validating the detector
 *
 * A sweep that reports nothing is only worth believing if the predicate can fire at
 * all. The page cache is the test seam: point `IDC_DICOMWEB` at a dummy URL, write a
 * page of hand-made reduced rows into the matching cache directory, and run — no
 * network is touched and both hit classes must be reported.
 *
 *   IDC_DICOMWEB=https://fake.test/dicomWeb node plugins/dicom/tools/find-idc-sparse.mjs --pages 1
 *
 * (The cache directory name is sha1(`CACHE_SCHEMA|BASE|INCLUDE|PER_PAGE`) truncated to
 * 12 chars, under `XOPAT_CACHE_DIR`/tmp — the script prints it on every run.)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const BASE = process.env.IDC_DICOMWEB ||
    "https://proxy.imaging.datacommons.cancer.gov/current/" +
    "viewer-only-no-downloads-see-tinyurl-dot-com-slash-3j3d9jyp/dicomWeb";

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const PAGES = arg("pages", 25);
const PER_PAGE = arg("per-page", 200);
const START = arg("offset", 0);
const CONCURRENCY = arg("concurrency", 6);
const SHOW_PLANES = process.argv.includes("--show-planes");

const v = (ds, tag) => {
    const x = ds?.[tag]?.Value;
    return Array.isArray(x) ? x[0] : (x ?? null);
};
const n = (ds, tag) => {
    const x = v(ds, tag);
    const num = typeof x === "string" ? Number(x) : x;
    return Number.isFinite(num) ? num : null;
};

async function qido(path) {
    const res = await fetch(BASE + path, { headers: { Accept: "application/dicom+json" } });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return await res.json();
}

/** Run `worker` over `items` with a bounded number in flight, results in order. */
async function mapLimit(items, limit, worker) {
    const out = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await worker(items[i], i);
        }
    }));
    return out;
}

/**
 * The attributes the classification needs and the store does not return by default.
 * `00120020` is IDC's collection accession — it does not classify anything, it is
 * what turns a negative result from "offsets 0…5000" into a statement about which
 * collections were actually looked at.
 */
const INCLUDE = ["00209311", "00480006", "00480007", "00209161", "00209162", "00209228", "00120020"]
    .map(t => `includefield=${t}`).join("&");

/* ------------------------------------------------------------------ */
/* Page cache                                                          */
/* ------------------------------------------------------------------ */

/**
 * A full sweep is ~1750 requests against somebody else's public server, and the
 * answer changes only when IDC publishes a new release. So each page is kept on
 * disk and a re-run — a wider window, a changed classifier, a run that was
 * interrupted — costs nothing upstream.
 *
 * What is stored is the REDUCED row, not the DICOM JSON: a tenth of the bytes,
 * and it is all the classification reads. The cache key covers the store URL, the
 * requested attributes and the page size, so asking for one more tag or a
 * different `--per-page` cannot silently serve rows that lack it. Bump
 * CACHE_SCHEMA when the reduced shape changes.
 *
 * Cache lives outside the repo: `XOPAT_CACHE_DIR` if the deployment sets one,
 * else the OS temp dir. `--refresh` bypasses and rewrites it.
 */
const CACHE_SCHEMA = 1;
const CACHE_KEY = createHash("sha1")
    .update(`${CACHE_SCHEMA}|${BASE}|${INCLUDE}|${PER_PAGE}`)
    .digest("hex").slice(0, 12);
const CACHE_DIR = join(process.env.XOPAT_CACHE_DIR || tmpdir(), "xopat-idc-sweep", CACHE_KEY);
const REFRESH = process.argv.includes("--refresh");

let fromCache = 0, fromNetwork = 0;

const cachePath = (offset) => join(CACHE_DIR, `${offset}.json`);

function readCachedPage(offset) {
    if (REFRESH) return null;
    try {
        return JSON.parse(readFileSync(cachePath(offset), "utf8"));
    } catch {
        return null;   // absent or unreadable is simply a miss
    }
}

function writeCachedPage(offset, entries) {
    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath(offset), JSON.stringify(entries));
    } catch (e) {
        // A cache that cannot be written is a performance problem, not a failure.
        if (!writeCachedPage.warned) {
            writeCachedPage.warned = true;
            console.warn(`  (page cache disabled: ${e.message})`);
        }
    }
}

/** The QIDO row reduced to what the classification reads. */
function reduceRow(ds) {
    const studyUID = v(ds, "0020000D");
    const seriesUID = v(ds, "0020000E");
    const frames = n(ds, "00280008");
    const tileH = n(ds, "00280010");     // Rows
    const tileW = n(ds, "00280011");     // Columns
    const matrixW = n(ds, "00480006");
    const matrixH = n(ds, "00480007");
    // Label / overview instances carry no matrix and are not pyramid levels.
    if (!studyUID || !seriesUID || !frames || !tileW || !tileH || !matrixW || !matrixH) return null;
    return {
        studyUID, seriesUID,
        instanceUID: v(ds, "00080018"),
        frames, matrixW, matrixH,
        expected: Math.ceil(matrixW / tileW) * Math.ceil(matrixH / tileH),
        dimOrg: v(ds, "00209311"),
        concatUID: v(ds, "00209161"),
        inConcat: n(ds, "00209162"),
        frameOffset: n(ds, "00209228"),
        collection: v(ds, "00120020") || "(no collection id)",
    };
}

console.log(`Scanning up to ${PAGES * PER_PAGE} slide-microscopy instances from:\n  ${BASE}`);
console.log(`Page cache: ${CACHE_DIR}${REFRESH ? "  (--refresh: bypassed)" : ""}\n`);

/** seriesKey -> { studyUID, seriesUID, levels: Map<"WxH", row[]> } */
const series = new Map();
const collections = new Map();
const livePrinted = new Set();
let scanned = 0, usable = 0;

let ended = false, failedPages = 0;
const offsets = Array.from({ length: PAGES }, (_, page) => START + page * PER_PAGE);

// Pages are independent, so they are fetched concurrently — a full sweep of IDC's
// slide-microscopy corpus is ~1750 pages, which is an hour serially and minutes at
// six in flight. `end of results` therefore cannot break a loop: later offsets may
// already be in flight, and only an EMPTY page proves the end.
await mapLimit(offsets, CONCURRENCY, async (offset, i) => {
    // `count` is carried alongside the reduced rows so an empty page and a page of
    // nothing-but-label-instances stay distinguishable — only the former is the end.
    let page = readCachedPage(offset);
    if (page) {
        fromCache++;
    } else {
        let rows;
        try {
            rows = await qido(`/instances?Modality=SM&${INCLUDE}&limit=${PER_PAGE}&offset=${offset}`);
        } catch (e) {
            failedPages++;
            console.warn(`  page at offset ${offset} failed: ${e.message}`);
            return;
        }
        fromNetwork++;
        page = { count: rows.length, entries: rows.map(reduceRow).filter(Boolean) };
        writeCachedPage(offset, page);
    }

    if (!page.count) {
        if (!ended) console.log(`  offset ${String(offset).padStart(7)}: end of results`);
        ended = true;
        return;
    }
    scanned += page.count;

    for (const entry of page.entries) {
        const { studyUID, seriesUID, frames, expected, matrixW, matrixH } = entry;
        usable++;
        collections.set(entry.collection, (collections.get(entry.collection) || 0) + 1);

        const key = `${studyUID}|${seriesUID}`;
        if (!series.has(key)) series.set(key, { studyUID, seriesUID, levels: new Map() });
        const levels = series.get(key).levels;
        const dims = `${matrixW}x${matrixH}`;
        if (!levels.has(dims)) levels.set(dims, []);
        levels.get(dims).push(entry);

        // Anything visible in a single row is reported the moment it is seen. A
        // full sweep takes minutes and may be interrupted; the grouped analysis at
        // the end would then never print, and the run would have found nothing to
        // show for itself.
        if (frames < expected || entry.concatUID || entry.dimOrg === "TILED_SPARSE") {
            const liveKey = `${seriesUID}|${dims}`;
            if (!livePrinted.has(liveKey)) {
                livePrinted.add(liveKey);
                console.log(`  >> ${entry.dimOrg || "no dimOrg"} ${frames}/${expected} frames` +
                    `${entry.concatUID ? " concat=" + entry.concatUID : ""}` +
                    `  study=${studyUID} series=${seriesUID} level=${dims}`);
            }
        }
    }

    // One line per 25 pages: a full sweep is far too many to narrate.
    if (i % 25 === 0) {
        console.log(`  offset ${String(offset).padStart(7)}: ${scanned} rows so far` +
            ` (${usable} pyramid levels, ${series.size} series)`);
    }
});

/* ------------------------------------------------------------------ */
/* Classify                                                            */
/* ------------------------------------------------------------------ */

const hits = [];
let planeLevels = 0, planeSeries = new Set();
for (const { studyUID, seriesUID, levels } of series.values()) {
    for (const [dims, parts] of levels) {
        const expected = parts[0].expected;
        const total = parts.reduce((s, p) => s + p.frames, 0);
        const declaredConcat = parts.some(p => p.concatUID);
        const declaredSparse = parts.some(p => p.dimOrg === "TILED_SPARSE");
        const why = [];

        if (parts.length > 1) {
            // Several instances of one series with identical TotalPixelMatrix land
            // on one level record. Concatenation parts SUM to the grid; channels
            // and focal planes each cover it alone.
            if (declaredConcat) why.push(`concatenation (${parts.length} parts, declared)`);
            else if (total <= expected) why.push(`concatenation candidate (${parts.length} same-dims instances, Σframes=${total}/${expected})`);
            else {
                planeLevels++;
                planeSeries.add(seriesUID);
                if (!SHOW_PLANES) continue;
                why.push(`channels / focal planes (${parts.length} same-dims instances, each ~${Math.round(total / parts.length)}/${expected})`);
            }
        } else if (parts[0].frames < expected) {
            why.push(`sparse level (${parts[0].frames}/${expected} frames)`);
        }

        if (declaredSparse) why.push("declares TILED_SPARSE");

        if (why.length) hits.push({ studyUID, seriesUID, dims, expected, total, parts, why });
    }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const offsetsCovered = `${START}…${START + PAGES * PER_PAGE}`;
console.log(`\nSwept ${scanned} instance row(s) (offsets ${offsetsCovered}` +
    `${ended ? ", which reached the end of the collection" : ""}), of which ` +
    `${usable} are pyramid levels across ${series.size} series.`);
console.log(`Pages: ${fromNetwork} fetched, ${fromCache} served from the local cache.`);
if (failedPages) console.log(`${failedPages} page(s) failed and were NOT scanned — coverage is incomplete.`);
if (planeLevels) {
    console.log(`Ignored ${planeLevels} level(s) in ${planeSeries.size} series where same-dims ` +
        `instances are channels or focal planes, not parts (--show-planes to list).`);
}
const byCount = [...collections.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Collections covered (${byCount.length}): ` +
    byCount.slice(0, 12).map(([id, c]) => `${id}×${c}`).join(", ") +
    (byCount.length > 12 ? `, +${byCount.length - 12} more` : ""));

if (!hits.length) {
    // No process.exit: undici keeps handles alive and tearing them down mid-flight
    // trips a libuv assertion on Windows. Falling off the end is enough.
    console.log(
        "\nNo sparse or concatenated level found.\n" +
        (ended && !failedPages
            ? "The sweep reached the end of the collection, so this covers every\n" +
              "slide-microscopy instance the store lists."
            : "This covers the swept window only — raise --pages (and --concurrency)\n" +
              "or move --offset to cover the rest. The predicate cannot be pushed\n" +
              "server-side: matching on 00209311 answers HTTP 400.")
    );
} else {
    console.log(`\n${hits.length} hit(s):\n`);
    for (const hit of hits.slice(0, 25)) {
        console.log(`  ${hit.why.join(" + ")}`);
        console.log(`      study  ${hit.studyUID}`);
        console.log(`      series ${hit.seriesUID}`);
        console.log(`      level  ${hit.dims}  grid=${hit.expected} tiles`);
        for (const p of hit.parts.slice(0, 6)) {
            const tags = [
                p.dimOrg || "no DimensionOrganizationType",
                p.concatUID ? `concat=${p.concatUID}` : null,
                p.inConcat != null ? `inConcat=${p.inConcat}` : null,
                p.frameOffset != null ? `frameOffset=${p.frameOffset}` : null,
            ].filter(Boolean).join(", ");
            console.log(`        ${p.instanceUID}  frames=${p.frames}  [${tags}]`);
        }
        if (hit.parts.length > 6) console.log(`        … and ${hit.parts.length - 6} more instance(s)`);
        console.log("");
    }
    if (hits.length > 25) console.log(`  … and ${hits.length - 25} more\n`);

    const best = hits[0];
    console.log("Open the first one — compose the IDC preset with a file carrying this block");
    console.log("(`npm run up:dev -- dicom-idc env/env.mine.json`):\n");
    console.log(JSON.stringify({
        plugins: {
            // The study/series to open belongs to `dicom-browser`, the application
            // half. `dicom` is the protocol half and opens nothing on its own.
            "dicom-browser": {
                studyUID: best.studyUID,
                seriesUID: best.seriesUID,
            },
        },
    }, null, 2));
    console.log(
        "\nThen read the console: the level should print `sparse=yes` (a sparse level) or\n" +
        "`parts=2` (a concatenation). `strategy=none reason=…` means the file defeated the\n" +
        "whole ladder — capture that line, it is the interesting case."
    );
}
