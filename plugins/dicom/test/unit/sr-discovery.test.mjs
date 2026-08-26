/**
 * Finding the latest SR used to cost one QIDO per SR series, issued from a
 * strictly serial loop. In a measured Google Healthcare session that was 48
 * queries of 1-4 s each, spread across the whole 80 s the slide took to fill and
 * competing with tiles the entire time.
 *
 * The request budget is the point of these tests. So is the refusal to trust a
 * server-side filter: a store that silently drops `Modality=SR` answers the
 * study-level query with every instance it has, and treating those as reports
 * would hydrate an image as an annotation.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

const STUDY = "1.2.3.study";

/** A QIDO instance row. `modality` omitted = the store did not return the tag. */
const srRow = (sop, seriesUID, { date = "20240101", time = "120000", modality = "SR" } = {}) => ({
    "00080018": { Value: [sop] },
    "0020000E": { Value: [seriesUID] },
    "00080023": { Value: [date] },
    "00080033": { Value: [time] },
    ...(modality === null ? {} : { "00080060": { Value: [modality] } }),
});

const seriesRow = (uid, modality) => ({
    "0020000E": { Value: [uid] },
    "00080060": { Value: [modality] },
});

/**
 * A client that records every path. `fetchRaw` is the only surface DicomTools
 * uses. Routes are matched in order; `null` body means "this resource 404s".
 */
function stubClient(routes) {
    const calls = [];
    return {
        calls,
        async fetchRaw(path) {
            calls.push(path);
            for (const [match, body] of routes) {
                if (typeof match === "function" ? match(path) : path.includes(match)) {
                    if (body === null) {
                        const e = new globalThis.HTTPError("not found");
                        e.statusCode = 404;
                        e.textData = "Unknown resource";
                        throw e;
                    }
                    return {
                        status: 200,
                        headers: { get: () => null },
                        text: async () => JSON.stringify(typeof body === "function" ? body(path) : body),
                    };
                }
            }
            return { status: 204, headers: { get: () => null }, text: async () => "" };
        },
    };
}

test("finds every SR in a study with ONE query, not one per series", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        ["/instances?Modality=SR", [
            srRow("sop.a", "series.1", { date: "20240101" }),
            srRow("sop.b", "series.2", { date: "20240505" }),
            srRow("sop.c", "series.2", { date: "20240303" }),
        ]],
    ]);

    const found = await DicomTools._srCandidates(client, STUDY);

    expect(client.calls.length).toBe(1);
    expect(found.length).toBe(3);
    // The parent series is carried per row, so the ranking step can address the
    // instance without a second lookup.
    expect(found.map(r => r._parentSeriesUID)).toEqual(["series.1", "series.2", "series.2"]);
});

test("tagging copies the row instead of scribbling on the QIDO cache", { tag: ["@unit"] }, async () => {
    const row = srRow("sop.a", "series.1");
    const client = stubClient([["/instances?Modality=SR", [row]]]);

    const found = await DicomTools._srCandidates(client, STUDY);

    expect(found[0]._parentSeriesUID).toBe("series.1");
    // QIDO answers are memoized now; the row handed back by the cache must be
    // untouched or the next reader inherits another caller's annotations.
    expect(row._parentSeriesUID).toBe(undefined);
});

test("falls back to a per-series walk when the study-level resource is absent", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        [p => p.includes("/instances?Modality=SR"), null],   // endpoint 404s
        ["/series?", [seriesRow("series.1", "SR"), seriesRow("series.2", "SM"), seriesRow("series.3", "SR")]],
        ["/series/series.1/instances", [srRow("sop.a", "series.1")]],
        ["/series/series.3/instances", [srRow("sop.c", "series.3")]],
    ]);

    const found = await DicomTools._srCandidates(client, STUDY);

    expect(found.map(r => r._parentSeriesUID).sort()).toEqual(["series.1", "series.3"]);
    // Only the SR series are queried — the SM series is never touched.
    expect(client.calls.some(p => p.includes("series.2/instances"))).toBe(false);
});

test("does not trust a store that ignored Modality=SR", { tag: ["@unit"] }, async () => {
    // The study-level query answers with the study's images, filter unapplied.
    const client = stubClient([
        ["/instances?Modality=SR", [
            srRow("img.1", "series.9", { modality: "SM" }),
            srRow("img.2", "series.9", { modality: "SM" }),
        ]],
        ["/series?", [seriesRow("series.1", "SR")]],
        ["/series/series.1/instances", [srRow("sop.a", "series.1")]],
    ]);

    const found = await DicomTools._srCandidates(client, STUDY);

    // The images are refused and the per-series walk supplies the real answer.
    expect(found.length).toBe(1);
    expect(found[0]._parentSeriesUID).toBe("series.1");
});

test("an empty honoured answer means no SR, and costs exactly one query", { tag: ["@unit"] }, async () => {
    const client = stubClient([["/instances?Modality=SR", []]]);

    const found = await DicomTools._srCandidates(client, STUDY);

    expect(found).toEqual([]);
    expect(client.calls.length).toBe(1);
});

test("newest SR wins, and the study is queried once for it", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        ["/instances?Modality=SR", [
            srRow("sop.old", "series.1", { date: "20240101", time: "090000" }),
            srRow("sop.new", "series.2", { date: "20240101", time: "173000" }),
        ]],
    ]);

    const latest = await DicomTools.findLatestAnnotation(client, STUDY);

    expect(latest).toEqual({ seriesUID: "series.2", sopUID: "sop.new" });
    expect(client.calls.length).toBe(1);
});

/* ------------------------------------------------------------------ */
/* QIDO memoization                                                    */
/* ------------------------------------------------------------------ */

test("identical QIDO queries collapse to one request per client", { tag: ["@unit"] }, async () => {
    const client = stubClient([["/series?", [seriesRow("series.1", "SR")]]]);

    const a = await DicomTools.qidoSafe(client, `/studies/${STUDY}/series`, "00080060");
    const b = await DicomTools.qidoSafe(client, `/studies/${STUDY}/series`, "00080060");

    expect(a).toEqual(b);
    expect(client.calls.length).toBe(1);
});

test("a different client never reads another client's answers", { tag: ["@unit"] }, async () => {
    const one = stubClient([["/series?", [seriesRow("series.1", "SR")]]]);
    const two = stubClient([["/series?", [seriesRow("series.2", "SR")]]]);

    const a = await DicomTools.qidoSafe(one, `/studies/${STUDY}/series`, "00080060");
    const b = await DicomTools.qidoSafe(two, `/studies/${STUDY}/series`, "00080060");

    expect(DicomTools.v(a[0], "0020000E")).toBe("series.1");
    expect(DicomTools.v(b[0], "0020000E")).toBe("series.2");
    // Auth contexts differ per client; a shared cache would be a data leak.
    expect(two.calls.length).toBe(1);
});

test("a failed query is not remembered", { tag: ["@unit"] }, async () => {
    let attempts = 0;
    const client = {
        calls: [],
        async fetchRaw(path) {
            this.calls.push(path);
            if (++attempts === 1) throw new Error("network down");
            return { status: 200, headers: { get: () => null }, text: async () => "[]" };
        },
    };

    await expect(DicomTools.qido(client, "/studies/x/series")).rejects.toThrow();
    // Caching the rejection would make one flaky request permanent.
    expect(await DicomTools.qido(client, "/studies/x/series")).toEqual([]);
    expect(client.calls.length).toBe(2);
});

test("a write invalidates the query window", { tag: ["@unit"] }, async () => {
    const client = stubClient([["/series?", [seriesRow("series.1", "SR")]]]);

    await DicomTools.qidoSafe(client, `/studies/${STUDY}/series`, "00080060");
    expect(client.calls.length).toBe(1);

    DicomTools.clearQueryCache(client);

    await DicomTools.qidoSafe(client, `/studies/${STUDY}/series`, "00080060");
    // A freshly STOW-ed SR must be visible to the read-back that follows it.
    expect(client.calls.length).toBe(2);
});

/* ------------------------------------------------------------------ */
/* Connection-pool lanes                                               */
/* ------------------------------------------------------------------ */

/** Records the `priority` each request was issued with. */
function laneClient(routes) {
    const lanes = [];
    const base = stubClient(routes);
    return {
        lanes,
        calls: base.calls,
        async fetchRaw(path, init) {
            lanes.push(init?.priority ?? "normal");
            return base.fetchRaw(path, init);
        },
    };
}

test("annotation discovery yields to tiles", { tag: ["@unit"] }, async () => {
    const client = laneClient([["/instances?Modality=SR", [srRow("sop.a", "series.1")]]]);

    await DicomTools._srCandidates(client, STUDY);

    // Nobody waits on annotation hydration; tiles are what the user is looking
    // at. The scheduler admits zero background while tiles are in flight.
    expect(client.lanes).toEqual(["background"]);
});

test("browser thumbnails yield to tiles", { tag: ["@unit"] }, async () => {
    const client = laneClient([["/rendered", []]]);
    client.fetchRaw = ((orig) => async (path, init) => {
        client.lanes.push(init?.priority ?? "normal");
        return { status: 200, headers: { get: () => "image/jpeg" }, blob: async () => "blob" };
    })(client.fetchRaw);

    await DicomTools.fetchRenderedInstance(client, STUDY, "series.1", "inst.1");

    expect(client.lanes).toEqual(["background"]);
});

test("the pyramid scan is NEVER backgrounded — it IS the slide open", { tag: ["@unit"] }, async () => {
    const client = laneClient([
        ["/instances", [{
            "00080018": { Value: ["inst.1"] },
            "00080060": { Value: ["SM"] },
            "00480006": { Value: [1024] },
            "00480007": { Value: [1024] },
            "00280010": { Value: [256] },
            "00280011": { Value: [256] },
            "00280008": { Value: [16] },
        }]],
        ["/metadata", [{ "00080018": { Value: ["inst.1"] } }]],
    ]);

    await DicomTools.findWSIItems(client, STUDY, "series.1").catch(() => {});

    // Backgrounding this would deadlock the very thing it feeds: the scheduler
    // yields to tile loading, and there are no tiles until this resolves.
    expect(client.lanes.length).toBeGreaterThan(0);
    expect(client.lanes.every(l => l === "normal")).toBe(true);
});

test("the shallow listing variant defaults to the background lane", { tag: ["@unit"] }, async () => {
    const client = laneClient([["/instances", []]]);

    await DicomTools.findWSIItemsShallow(client, STUDY, "series.9");
    expect(client.lanes).toEqual(["background"]);

    // …but a caller that genuinely needs it foreground can say so.
    const fg = laneClient([["/instances", []]]);
    await DicomTools.findWSIItemsShallow(fg, STUDY, "series.9", { priority: "normal" });
    expect(fg.lanes).toEqual(["normal"]);
});

test("the /patients probe is answered once per client, negative included", { tag: ["@unit"] }, async () => {
    const client = {
        calls: [],
        async fetchRaw(path) {
            this.calls.push(path);
            const e = new globalThis.HTTPError("no such resource");
            e.statusCode = 404;
            throw e;
        },
    };

    expect(await DicomTools.supportsPatients(client)).toBe(false);
    expect(await DicomTools.supportsPatients(client)).toBe(false);
    expect(await DicomTools.supportsPatients(client)).toBe(false);
    // On a store without /patients the CORS preflight itself fails, so every
    // re-probe is two dead requests and a console error that reads like a bug.
    expect(client.calls.length).toBe(1);
});
