/**
 * Find NCI Imaging Data Commons studies that carry a slide-microscopy image
 * together with a derived overlay (Segmentation / Parametric Map), and print a
 * ready-to-paste `plugins.dicom` env block for each hit.
 *
 * Runs against the IDC public proxy, which needs **no authentication**:
 *   node test/dicom/find-idc-overlays.mjs [--pages 5] [--per-page 40] [--offset 0]
 *
 * ## Why it works this way
 *
 * The obvious query — `/studies?ModalitiesInStudy=SEG` — is almost useless here:
 * the overwhelming majority of IDC segmentations are CT/MR, so the first pages
 * contain nothing this viewer can open. And while the proxy honours
 * `ModalitiesInStudy=SM` as a *filter*, it returns the attribute itself empty,
 * so the response cannot be used to tell which of those studies also hold a
 * derived series. Hence: filter to SM server-side, then list each study's series
 * to see what else is in it.
 */

const BASE = process.env.IDC_DICOMWEB ||
    "https://proxy.imaging.datacommons.cancer.gov/current/" +
    "viewer-only-no-downloads-see-tinyurl-dot-com-slash-3j3d9jyp/dicomWeb";

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const PAGES = arg("pages", 5);
const PER_PAGE = arg("per-page", 40);
const START = arg("offset", 0);

const v = (ds, tag) => {
    const x = ds?.[tag]?.Value;
    return Array.isArray(x) ? x[0] : (x ?? null);
};

async function qido(path) {
    const res = await fetch(BASE + path, { headers: { Accept: "application/dicom+json" } });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return await res.json();
}

/** Run `worker` over `items` with a bounded number in flight. */
async function mapLimit(items, limit, worker) {
    const out = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            try { out.push(await worker(items[i])); } catch (e) { /* skip unreadable study */ }
        }
    }));
    return out.filter(Boolean);
}

const OVERLAY_MODALITIES = new Set(["SEG", "OT"]);

console.log(`Scanning ${PAGES} page(s) of ${PER_PAGE} slide-microscopy studies from:\n  ${BASE}\n`);

const hits = [];
for (let page = 0; page < PAGES; page++) {
    const offset = START + page * PER_PAGE;
    let studies;
    try {
        studies = await qido(`/studies?ModalitiesInStudy=SM&limit=${PER_PAGE}&offset=${offset}`);
    } catch (e) {
        console.warn(`  page at offset ${offset} failed: ${e.message}`);
        continue;
    }
    if (!studies.length) break;

    const found = await mapLimit(studies, 6, async (study) => {
        const studyUID = v(study, "0020000D");
        if (!studyUID) return null;
        const series = await qido(`/studies/${studyUID}/series`);

        const overlays = [];
        let slide = null;
        for (const s of series) {
            const modality = v(s, "00080060");
            const seriesUID = v(s, "0020000E");
            if (modality === "SM" && !slide) slide = seriesUID;
            if (OVERLAY_MODALITIES.has(modality)) {
                overlays.push({ modality, seriesUID, description: v(s, "0008103E") || "" });
            }
        }
        return overlays.length && slide ? { studyUID, slide, overlays } : null;
    });

    hits.push(...found);
    console.log(`  offset ${String(offset).padStart(5)}: ${found.length} of ${studies.length} studies carry an overlay`);
}

if (!hits.length) {
    console.log("\nNo SM study with a SEG/OT series in the scanned range. Try --offset to scan elsewhere.");
    process.exit(0);
}

console.log(`\n${hits.length} usable stud${hits.length === 1 ? "y" : "ies"}:\n`);
for (const hit of hits.slice(0, 15)) {
    console.log(`  ${hit.studyUID}`);
    for (const o of hit.overlays) {
        console.log(`      [${o.modality}] ${o.seriesUID}  ${o.description}`);
    }
}

const best = hits[0];
console.log(`\nPaste into env/env.json to open the first one:\n`);
console.log(JSON.stringify({
    plugins: {
        dicom: {
            serviceUrl: BASE,
            permaLoad: true,
            // The proxy does not implement QIDO /patients; probing it produces a
            // loud CORS error even though the plugin recovers.
            supportsPatients: false,
            studyUID: best.studyUID,
        },
    },
}, null, 2));
