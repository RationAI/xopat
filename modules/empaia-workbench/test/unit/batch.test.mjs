/**
 * Staging a multi-region run.
 *
 * An app that declares `"type": "collection"` for its regions does not analyse
 * one shape per job — it collects several into one. The backend models that as a
 * job sitting in `ASSEMBLY` with a collection bound to it, filled item by item
 * and run when the user says so. Getting that choreography wrong is invisible
 * until the run: a job created but never wired produces a validation error, and
 * a job run at staging time locks the regions permanently a step too early.
 */
import { test, expect } from "@xopat/test-harness";

const { JobRunner, batchMembers, batchSize, collectionInputKeys } =
    await import("../../job-runner.ts");

/** Tutorial App 02 v3 — one WSI, one rectangle collection. */
const T02 = {
    io: {
        my_wsi: { type: "wsi" },
        my_rectangles: {
            type: "collection",
            items: { type: "rectangle", reference: "io.my_wsi" },
        },
        tumor_cell_counts: {
            type: "collection",
            items: { type: "integer", reference: "io.my_rectangles.items" },
        },
    },
    modes: {
        standalone: { inputs: ["my_wsi", "my_rectangles"], outputs: ["tumor_cell_counts"] },
    },
};

function runnerWith({ ead = T02, collections = {}, sourceJob = undefined } = {}) {
    const calls = { jobs: [], inputs: [], collections: [], items: [], runs: [], deletes: [] };
    const client = {
        scopeId: "scope-1",
        async createJob(mode, containerized) {
            calls.jobs.push({ mode, containerized });
            return { id: "job-1", status: "ASSEMBLY", inputs: {} };
        },
        async setJobInput(jobId, key, id) { calls.inputs.push({ jobId, key, id }); },
        async postCollection(body) {
            calls.collections.push(body);
            return { id: `coll-${calls.collections.length}` };
        },
        async postCollectionItems(id, items) { calls.items.push({ id, items }); },
        async runJob(id) { calls.runs.push(id); return { id, status: "READY" }; },
        async deleteJob(id) { calls.deletes.push(id); },
        async listJobs() { return []; },
        async getCollection(id) { return collections[id]; },
        async queryCollectionItems(id) { return collections[id]?.queried ?? []; },
    };
    const runner = new JobRunner({
        getClient: () => client,
        getEad: () => ead,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        getSourceJob: () => sourceJob,
        pollMs: () => 100000,
        onJobsChanged: () => {},
    });
    return { runner, calls, client };
}

test("collectionInputKeys names only the collection-typed ROI inputs", () => {
    const keys = collectionInputKeys(T02, "standalone");
    expect(keys.length).toBe(1);
    expect(keys[0].inputKey).toBe("my_rectangles");
    expect(keys[0].type).toBe("rectangle");
    expect(keys[0].inCollection).toBe(1);
});

test("createBatch wires the job and does NOT run it", async () => {
    const { runner, calls } = runnerWith();
    const draft = await runner.createBatch({ mode: "standalone" });
    runner.stopPolling();

    expect(calls.jobs.length).toBe(1);
    // The WSI plus one collection per collection input key.
    expect(calls.inputs.map(i => i.key)).toEqual(["my_wsi", "my_rectangles"]);
    expect(calls.collections.length).toBe(1);
    expect(calls.collections[0].item_type).toBe("rectangle");
    expect(calls.collections[0].reference_id).toBe("slide-1");
    // Running is a separate, explicit act — that is the whole point of staging.
    expect(calls.runs).toEqual([]);

    expect(draft.jobId).toBe("job-1");
    expect(draft.slideId).toBe("slide-1");
    expect(batchSize(draft)).toBe(0);
    expect(draft.collections.my_rectangles.collectionId).toBe("coll-1");
});

test("addToBatch appends to the collection whose item type matches", async () => {
    const { runner, calls } = runnerWith();
    const draft = await runner.createBatch({ mode: "standalone" });
    runner.stopPolling();

    const one = await runner.addToBatch(draft, ["a", "b"], "rectangle");
    expect(batchMembers(one)).toEqual(["a", "b"]);
    expect(calls.items.length).toBe(1);
    expect(calls.items[0].items).toEqual([{ id: "a" }, { id: "b" }]);

    // Order is preserved: the app's per-item output is attributed positionally
    // whenever the wire carries no reference_id.
    const two = await runner.addToBatch(one, ["c"], "rectangle");
    expect(batchMembers(two)).toEqual(["a", "b", "c"]);

    // The draft is replaced, never mutated — a half-applied append after a failed
    // POST is how a staged count starts disagreeing with the server.
    expect(batchMembers(draft)).toEqual([]);
});

test("addToBatch never stages the same region twice", async () => {
    const { runner, calls } = runnerWith();
    const draft = await runner.createBatch({ mode: "standalone" });
    runner.stopPolling();

    const one = await runner.addToBatch(draft, ["a"], "rectangle");
    const two = await runner.addToBatch(one, ["a", "b"], "rectangle");
    expect(batchMembers(two)).toEqual(["a", "b"]);
    // Only the new id went on the wire: the same annotation twice is two
    // collection items, and the app would count that region twice.
    expect(calls.items.map(c => c.items)).toEqual([[{ id: "a" }], [{ id: "b" }]]);

    const same = await runner.addToBatch(two, ["a"], "rectangle");
    expect(calls.items.length).toBe(2);
    expect(batchMembers(same)).toEqual(["a", "b"]);
});

test("addToBatch refuses a type no collection input accepts", async () => {
    const { runner } = runnerWith();
    const draft = await runner.createBatch({ mode: "standalone" });
    runner.stopPolling();

    let error;
    try { await runner.addToBatch(draft, ["a"], "polygon"); } catch (e) { error = e; }
    expect(error?.message).toContain("polygon");
});

test("createBatch refuses an app with no collection input", async () => {
    const single = {
        io: { my_wsi: { type: "wsi" }, my_rect: { type: "rectangle", reference: "io.my_wsi" } },
        modes: { standalone: { inputs: ["my_wsi", "my_rect"], outputs: [] } },
    };
    const { runner } = runnerWith({ ead: single });
    let error;
    try { await runner.createBatch({ mode: "standalone" }); } catch (e) { error = e; }
    runner.stopPolling();
    expect(error?.message).toContain("collection input");
});

test("resolveBatch rebuilds a draft from an ASSEMBLY job on the server", async () => {
    const { runner } = runnerWith({
        collections: { "coll-9": { id: "coll-9", item_type: "rectangle", item_ids: ["a", "b"] } },
    });
    const job = {
        id: "job-7", status: "ASSEMBLY", created_at: 123,
        inputs: { my_wsi: "slide-1", my_rectangles: "coll-9" },
    };

    const draft = await runner.resolveBatch(job, "standalone");
    expect(draft.jobId).toBe("job-7");
    expect(draft.slideId).toBe("slide-1");
    expect(draft.collections.my_rectangles.collectionId).toBe("coll-9");
    // Members come off the record itself — this is what makes a staged run
    // survive a reload, the only persistence available on an opaque origin.
    expect(batchMembers(draft)).toEqual(["a", "b"]);
});

test("resolveBatch falls back to the item query when item_ids is absent", async () => {
    const { runner } = runnerWith({
        collections: { "coll-9": { id: "coll-9", item_type: "rectangle", queried: [{ id: "x" }, { id: "y" }] } },
    });
    const draft = await runner.resolveBatch(
        { id: "job-7", status: "ASSEMBLY", inputs: { my_wsi: "slide-1", my_rectangles: "coll-9" } },
        "standalone");
    expect(batchMembers(draft)).toEqual(["x", "y"]);
});

test("resolveBatch answers nothing for a job with no collection input bound", async () => {
    const { runner } = runnerWith();
    const draft = await runner.resolveBatch(
        { id: "job-7", status: "ASSEMBLY", inputs: { my_wsi: "slide-1" } }, "standalone");
    expect(draft).toBe(undefined);
});

test("runStandalone with autoRun still wires the collection and runs once", async () => {
    const { runner, calls } = runnerWith();
    await runner.runStandalone({ roiIds: ["a", "b"], roiType: "rectangle" }, { autoRun: true });
    runner.stopPolling();

    expect(calls.inputs.map(i => i.key)).toEqual(["my_wsi", "my_rectangles"]);
    expect(calls.items[0].items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(calls.runs).toEqual(["job-1"]);
});

// ── postprocessing: a step built on an earlier result ───────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = (id) => JSON.parse(readFileSync(
    fileURLToPath(new URL(`../fixtures/ead/${id}.json`, import.meta.url)), "utf8"));

test("postprocessing binds the preprocessing job's outputs as its inputs", async () => {
    // TA12: `my_cells` is not something the pathologist draws — it is the
    // collection preprocessing already found. The wire needs nothing new for it:
    // `PUT /jobs/{id}/inputs/{key}` takes an id, and `job.outputs[key]` is one.
    const preprocessing = {
        id: "job-pre", status: "COMPLETED", mode: "PREPROCESSING",
        outputs: { my_cells: "coll-cells" },
    };
    const { runner, calls } = runnerWith({ ead: fixture("ta12"), sourceJob: preprocessing });

    await runner.runStandalone(
        { roiIds: ["roi-1"], roiType: "rectangle", mode: "postprocessing" }, { autoRun: true });
    runner.stopPolling();

    expect(calls.jobs[0].mode).toBe("POSTPROCESSING");
    expect(calls.jobs[0].containerized).toBe(true);
    const bound = Object.fromEntries(calls.inputs.map(i => [i.key, i.id]));
    expect(bound).toEqual({
        my_wsi: "slide-1",
        my_rectangle: "roi-1",
        my_cells: "coll-cells",     // the preprocessing job's output
    });
    expect(calls.runs).toEqual(["job-1"]);
    // No collection is created: the app produced this one, we only name it.
    expect(calls.collections).toEqual([]);
});

test("a postprocessing run with no earlier result refuses instead of half-wiring", async () => {
    const { runner, calls } = runnerWith({ ead: fixture("ta12"), sourceJob: undefined });
    let error;
    try {
        await runner.runStandalone(
            { roiIds: ["roi-1"], roiType: "rectangle", mode: "postprocessing" }, { autoRun: true });
    } catch (e) { error = e; }
    runner.stopPolling();

    expect(error?.message).toContain("earlier result");
    // A job missing an input fails at the backend's input validation with a
    // message naming a key the user never heard of, so it must never run.
    expect(calls.runs).toEqual([]);
});

test("a source job that produced none of the needed keys is named in the refusal", async () => {
    const empty = { id: "job-pre", status: "COMPLETED", mode: "PREPROCESSING", outputs: {} };
    const { runner, calls } = runnerWith({ ead: fixture("ta12"), sourceJob: empty });
    let error;
    try {
        await runner.runStandalone(
            { roiIds: ["roi-1"], roiType: "rectangle", mode: "postprocessing" }, { autoRun: true });
    } catch (e) { error = e; }
    runner.stopPolling();

    expect(error?.message).toContain("my_cells");
    expect(error?.message).toContain("job-pre");
    expect(calls.runs).toEqual([]);
});

test("a mode with no from-job inputs never asks for a source", async () => {
    // TA01 is an ordinary standalone app; requiring a source there would break
    // every app that has no preprocessing step at all.
    const { runner, calls } = runnerWith({ ead: fixture("ta01"), sourceJob: undefined });
    await runner.runStandalone({ roiIds: ["roi-1"], roiType: "rectangle" }, { autoRun: true });
    runner.stopPolling();
    expect(calls.runs).toEqual(["job-1"]);
});
