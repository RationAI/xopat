/**
 * What a job's result query actually answers.
 *
 * `PUT /annotations/query {jobs:[id]}` selects every record *locked in* that
 * job — the ROIs it consumed as well as the shapes it produced. Treating the
 * whole response as output is what made the analyses panel report "1
 * annotations" for a run that produced none, while clicking that count
 * answered "no annotations on the slide to navigate to": the count came from
 * the wire, the navigation from `empaiaJobId` on the canvas, and only produced
 * records carry one. The same conflation made the eye a no-op, because
 * eviction (correctly) refuses to remove the user's own regions.
 *
 * Primitives are queried WITHOUT a reference filter on purpose: a job's scalar
 * output is stored with `reference_id = NULL`, so filtering on the slide drops
 * every value the app computed.
 */
import { test, expect } from "@xopat/test-harness";

const { JobRunner } = await import("../../job-runner.ts");

/** Records a job produced, plus the region it consumed. */
const OUTPUT = { id: "ann-out", type: "polygon", creator_id: "job-1", creator_type: "job" };
const INPUT = { id: "ann-roi", type: "rectangle", creator_id: "scope-1", creator_type: "scope" };

function runnerWith(annotations, spy = {}) {
    const client = {
        queryPrimitives: async (body) => { spy.primitives = body; return [{ type: "integer", name: "n", value: 42 }]; },
        queryPixelmaps: async (body) => { spy.pixelmaps = body; return []; },
        queryAnnotations: async (body) => { spy.annotations = body; return { items: annotations }; },
    };
    return new JobRunner({
        getClient: () => client,
        getEad: () => undefined,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        pollMs: () => 3000,
        onJobsChanged: () => {},
    });
}

test("a job's own products and the regions it consumed are separated", async () => {
    const results = await runnerWith([OUTPUT, INPUT]).loadResults(["job-1"], "slide-1");

    expect(results.annotations.map(a => a.id)).toEqual(["ann-out"]);
    expect(results.lockedInputs).toEqual([{ id: "ann-roi", jobId: "job-1" }]);
});

test("a run that produced nothing reports no annotations, not its input", async () => {
    const results = await runnerWith([INPUT]).loadResults(["job-1"], "slide-1");

    // The exact defect: this used to be length 1, so the panel promised a
    // shape the canvas could never show.
    expect(results.annotations).toEqual([]);
    expect(results.lockedInputs.map(i => i.id)).toEqual(["ann-roi"]);
});

test("attribution is by creator_id, so a wrong creator_type casing cannot hide output", async () => {
    const odd = { ...OUTPUT, creator_type: "JOB" };
    const results = await runnerWith([odd]).loadResults(["job-1"], "slide-1");
    expect(results.annotations.map(a => a.id)).toEqual(["ann-out"]);

    // ...and a record claiming creator_type "job" for a DIFFERENT job is not
    // this job's output either.
    const foreign = { ...OUTPUT, id: "ann-other", creator_id: "job-2" };
    const other = await runnerWith([foreign]).loadResults(["job-1"], "slide-1");
    expect(other.annotations).toEqual([]);
});

test("primitives are not reference-filtered — the app's values have no reference", async () => {
    const spy = {};
    const results = await runnerWith([], spy).loadResults(["job-1"], "slide-1");

    expect(spy.primitives).toEqual({ jobs: ["job-1"] });
    expect(results.primitives.length).toBe(1);
    // Annotations and pixel maps DO carry a reference, so theirs stays.
    expect(spy.annotations.references).toEqual(["slide-1"]);
    expect(spy.pixelmaps.references).toEqual(["slide-1"]);
});

test("no jobs means no query at all, never 'everything'", async () => {
    const spy = {};
    const results = await runnerWith([OUTPUT], spy).loadResults([], "slide-1");
    expect(results).toEqual({ primitives: [], pixelmaps: [], annotations: [], lockedInputs: [] });
    expect(spy.annotations).toBe(undefined);
});

// ── a failed query is not an empty result ───────────────────────────────────

/** A runner whose three result queries can be made to reject individually. */
function failingRunner({ primitives, pixelmaps, annotations } = {}) {
    const client = {
        queryPrimitives: async () => { if (primitives) throw primitives; return []; },
        queryPixelmaps: async () => { if (pixelmaps) throw pixelmaps; return []; },
        queryAnnotations: async () => {
            if (annotations) throw annotations;
            return { items: [], item_count: 0 };
        },
        countAnnotations: async () => { throw new Error("countAnnotations must not be called"); },
    };
    return new JobRunner({
        getClient: () => client,
        getEad: () => undefined,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        pollMs: () => 3000,
        onJobsChanged: () => {},
    });
}

test("a rejected query is named in `failed`, not silently emptied", async () => {
    const runner = failingRunner({ annotations: Object.assign(new Error("nope"), { statusCode: 422 }) });
    const results = await runner.loadResults(["job-1"], "slide-1");

    // Before this, a 4xx produced `annotations: []` — byte-identical to a
    // finished, empty analysis — and the caller then recorded the job as
    // permanently empty, so a reload was the only way to see the result.
    expect(results.failed).toEqual(["annotations"]);
    expect(results.annotations).toEqual([]);
});

test("each query is named independently", async () => {
    const runner = failingRunner({
        primitives: new Error("a"),
        pixelmaps: new Error("b"),
    });
    const results = await runner.loadResults(["job-1"], "slide-1");
    expect(results.failed.sort()).toEqual(["pixelmaps", "primitives"]);
});

test("a successful read carries no `failed` key at all", async () => {
    const runner = failingRunner();
    const results = await runner.loadResults(["job-1"], "slide-1");
    expect("failed" in results).toBe(false);
});

// ── the size gate rides the first page ──────────────────────────────────────

test("the budget is decided from the first page, with no separate count call", async () => {
    const seen = [];
    const client = {
        queryPrimitives: async () => [],
        queryPixelmaps: async () => [],
        queryAnnotations: async (body, opts) => {
            seen.push(opts);
            // The server says there are far more than the budget allows.
            return { items: [{ id: "a", creator_id: "job-1" }], item_count: 10_000 };
        },
        countAnnotations: async () => { throw new Error("countAnnotations must not be called"); },
    };
    const runner = new JobRunner({
        getClient: () => client,
        getEad: () => undefined,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        pollMs: () => 3000,
        onJobsChanged: () => {},
    });

    const results = await runner.loadResults(["job-1"], "slide-1", { budget: 100 });
    expect(results.annotationsWithheld).toBe(true);
    expect(results.annotationCount).toBe(10_000);
    expect(results.annotations).toEqual([]);
    // Exactly one annotation request: `item_count` came back on it, so asking a
    // separate count route first was a whole extra round trip per result read.
    expect(seen.length).toBe(1);
    // And `skip: 0` is omitted, keeping the first request's wire shape unchanged.
    expect(seen[0].skip).toBe(undefined);
    expect(seen[0].limit).toBe(500);
});

test("`force` bypasses the budget and fetches anyway", async () => {
    const client = {
        queryPrimitives: async () => [],
        queryPixelmaps: async () => [],
        queryAnnotations: async () => ({
            items: [{ id: "a", creator_id: "job-1" }], item_count: 1,
        }),
        countAnnotations: async () => { throw new Error("must not be called"); },
    };
    const runner = new JobRunner({
        getClient: () => client,
        getEad: () => undefined,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        pollMs: () => 3000,
        onJobsChanged: () => {},
    });

    const results = await runner.loadResults(["job-1"], "slide-1", { budget: 0, force: true });
    expect(results.annotationsWithheld).toBe(undefined);
    expect(results.annotations.length).toBe(1);
});
