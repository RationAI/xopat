/**
 * The pyramid scan is the slide open: nothing renders until it finishes, and
 * every request in it is on the critical path. Two things it must not do are
 * easy to reintroduce and invisible once done.
 *
 * It must not ask QIDO for attributes it reads from `/metadata` anyway — most
 * of all the Per-Frame Functional Groups Sequence, which on a conformant store
 * is one item per frame per instance in a single response.
 *
 * And it must not walk the metadata of WSI groups it is about to discard.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

const STUDY = "1.2.study";
const SERIES = "1.2.series";

/** A pyramid-level instance row as QIDO returns it. */
const levelRow = (uid, width, { container = "SPEC-1", path = "PATH-1", type = "ORIGINAL" } = {}) => ({
    "00080018": { Value: [uid] },
    // A real WSI pyramid level says ORIGINAL\PRIMARY\VOLUME — no "WSI" keyword —
    // so `isWSIInstance` has to classify it on Modality / SOP Class. Those are
    // exactly the two attributes the projection has to ask for.
    "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] },
    "00080060": { Value: ["SM"] },
    "00080008": { Value: [type, "PRIMARY", "VOLUME"] },
    "00280008": { Value: [16] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00400512": { Value: [container] },
    "00480106": { Value: [path] },
});

/** Instance `/metadata`, which is where the geometry actually comes from. */
const levelMeta = (uid, width) => [{
    "00080018": { Value: [uid] },
    "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
    "00200052": { Value: ["1.2.for"] },
    "00280008": { Value: [16] },
    "00280010": { Value: [256] },
    "00280011": { Value: [256] },
    "00480006": { Value: [width] },
    "00480007": { Value: [width] },
    "00209311": { Value: ["TILED_FULL"] },
    "00280030": { Value: [0.00025, 0.00025] },
    "00280002": { Value: [3] },
    "00280004": { Value: ["RGB"] },
    "00280100": { Value: [8] },
    "00280101": { Value: [8] },
}];

function stubClient(routes) {
    const calls = [];
    return {
        calls,
        async fetchRaw(path) {
            calls.push(path);
            for (const [match, body] of routes) {
                if (typeof match === "function" ? match(path) : path.includes(match)) {
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

test("the instance query asks for no sequence attributes", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        [p => p.includes("/instances?"), [levelRow("uid.1", 4096), levelRow("uid.2", 2048)]],
        ["/metadata", p => levelMeta(p.includes("uid.1") ? "uid.1" : "uid.2", p.includes("uid.1") ? 4096 : 2048)],
    ]);

    await DicomTools.findWSIItems(client, STUDY, SERIES);

    const query = client.calls.find(p => p.includes("/instances?"));
    // 52009230 (Per-Frame FG) is the expensive one: on a store that honours
    // sequence includefield it returns one item PER FRAME PER INSTANCE.
    expect(query).not.toContain("52009230");
    expect(query).not.toContain("52009229");
    expect(query).not.toContain("00209157");
    expect(query).not.toContain("00209113");
});

test("the instance query does ask for what the grouping reads", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        [p => p.includes("/instances?"), [levelRow("uid.1", 4096)]],
        ["/metadata", () => levelMeta("uid.1", 4096)],
    ]);

    await DicomTools.findWSIItems(client, STUDY, SERIES);

    const query = decodeURIComponent(client.calls.find(p => p.includes("/instances?")));
    for (const tag of ["00080018", "00080016", "00080060", "00080008", "00280008",
                       "00280010", "00280011", "00480006", "00480007",
                       "00400512", "00480106"]) {
        expect(query).toContain(tag);
    }
});

test("a level is still classified as WSI without a WSI keyword in ImageType", { tag: ["@unit"] }, async () => {
    // ORIGINAL\PRIMARY\VOLUME is what real pyramid levels carry. Classification
    // therefore falls to Modality / SOP Class, and a store that returns only the
    // attributes it was asked for would otherwise yield "No pyramid levels
    // discovered in series" for a perfectly good slide.
    const client = stubClient([
        [p => p.includes("/instances?"), [levelRow("uid.1", 4096)]],
        ["/metadata", () => levelMeta("uid.1", 4096)],
    ]);

    const groups = await DicomTools.findWSIItems(client, STUDY, SERIES);
    expect(groups.length).toBe(1);
    expect(groups[0].pyramidInstances.length).toBe(1);
});

test("separate specimens stay separate groups", { tag: ["@unit"] }, async () => {
    // ContainerIdentifier and OpticalPathIdentifier were missing from the
    // projection, so every instance read as UNKNOWN_CONTAINER/DEFAULT_PATH and
    // two specimens in one series collapsed into a single bogus pyramid.
    const client = stubClient([
        [p => p.includes("/instances?"), [
            levelRow("a.1", 4096, { container: "SPEC-A" }),
            levelRow("b.1", 4096, { container: "SPEC-B" }),
        ]],
        ["/metadata", p => levelMeta(p.includes("a.1") ? "a.1" : "b.1", 4096)],
    ]);

    const groups = await DicomTools.findWSIItems(client, STUDY, SERIES);
    expect(groups.length).toBe(2);
});

test("only the winning group's metadata is fetched", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        [p => p.includes("/instances?"), [
            // Group A: a real 3-level pyramid.
            levelRow("a.1", 8192, { container: "SPEC-A" }),
            levelRow("a.2", 4096, { container: "SPEC-A" }),
            levelRow("a.3", 2048, { container: "SPEC-A" }),
            // Group B: a single small image the tile source would discard.
            levelRow("b.1", 512, { container: "SPEC-B" }),
        ]],
        ["/metadata", p => {
            const uid = p.match(/instances\/([^/]+)\/metadata/)[1];
            return levelMeta(uid, uid.startsWith("a") ? 8192 : 512);
        }],
    ]);

    const groups = await DicomTools.findWSIItems(client, STUDY, SERIES, { only: "best" });

    expect(groups.length).toBe(1);
    // 1 QIDO + 3 metadata for the winner. The discarded group costs nothing.
    expect(client.calls.length).toBe(4);
    expect(client.calls.some(p => p.includes("b.1"))).toBe(false);
});

test("without `only`, every group is still walked", { tag: ["@unit"] }, async () => {
    const client = stubClient([
        [p => p.includes("/instances?"), [
            levelRow("a.1", 8192, { container: "SPEC-A" }),
            levelRow("b.1", 512, { container: "SPEC-B" }),
        ]],
        ["/metadata", p => {
            const uid = p.match(/instances\/([^/]+)\/metadata/)[1];
            return levelMeta(uid, uid.startsWith("a") ? 8192 : 512);
        }],
    ]);

    const groups = await DicomTools.findWSIItems(client, STUDY, SERIES);

    // The listing callers want them all; only the tile source opts into "best".
    expect(groups.length).toBe(2);
    expect(client.calls.some(p => p.includes("b.1"))).toBe(true);
});

test("the pre-metadata ranking matches the tile source's own", { tag: ["@unit"] }, () => {
    // The tile source ranks by level count, then width, AFTER ingest. This has
    // to reach the same verdict from the QIDO rows, or `only: "best"` fetches
    // the metadata of a group the caller then discards — the exact waste it
    // exists to prevent.
    const deep = { pyramidInstances: [levelRow("d.1", 2048), levelRow("d.2", 1024), levelRow("d.3", 512)] };
    const wide = { pyramidInstances: [levelRow("w.1", 65536)] };
    expect(DicomTools._bestWsiGroup([wide, deep])[0]).toBe(deep);

    const wideA = { pyramidInstances: [levelRow("a.1", 4096), levelRow("a.2", 2048)] };
    const wideB = { pyramidInstances: [levelRow("b.1", 8192), levelRow("b.2", 4096)] };
    expect(DicomTools._bestWsiGroup([wideA, wideB])[0]).toBe(wideB);

    expect(DicomTools._bestWsiGroup([])).toEqual([]);
});
