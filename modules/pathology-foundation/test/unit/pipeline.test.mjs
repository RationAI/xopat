/**
 * Overlapping the slow half of a walk with the serialized half.
 *
 * Renders cannot be parallelized — the core serializes every off-screen pass per viewer,
 * by design. Vision calls can, and the walk was making them one at a time, which is where
 * nearly all of a run's wall-clock went.
 *
 * Two limits, and they are not the same limit: the render window bounds resident PIXELS
 * (each raster is megabytes held until its analysis consumes it), while the vision
 * semaphore bounds concurrent REQUESTS to match the inference RPC's own ceiling. Letting
 * the wider one become the effective cap just moves the queue to the server.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { runFieldPipeline, collectPipeline, createSemaphore } = await loadLib("pipeline");

test.afterAll(() => cleanupLib());

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Records concurrency and ordering so the invariants can be asserted rather than timed. */
function tracker() {
    const state = { renderConcurrent: 0, maxRender: 0, visionConcurrent: 0, maxVision: 0, order: [] };
    return {
        state,
        async render(field) {
            state.renderConcurrent++;
            state.maxRender = Math.max(state.maxRender, state.renderConcurrent);
            await tick(1);
            state.renderConcurrent--;
            return { field, pixels: `raster:${field.id}` };
        },
        async analyze(field, raster) {
            state.visionConcurrent++;
            state.maxVision = Math.max(state.maxVision, state.visionConcurrent);
            await tick(field.cost ?? 2);
            state.visionConcurrent--;
            state.order.push(field.id);
            return { id: field.id, raster: raster.pixels };
        },
    };
}

const fields = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i}` }));

test("every field goes through both stages exactly once", { tag: ["@unit"] }, async () => {
    const t = tracker();

    const out = await collectPipeline(fields(7), { render: t.render, analyze: t.analyze });

    expect(out).toHaveLength(7);
    expect(out.map(r => r.id).sort()).toEqual(fields(7).map(f => f.id).sort());
    expect(out.every(r => r.raster === `raster:${r.id}`), "each analysis got its own raster").toBe(true);
});

test("vision concurrency is capped", { tag: ["@unit"] }, async () => {
    const t = tracker();

    await collectPipeline(fields(12), { render: t.render, analyze: t.analyze, visionConcurrency: 4 });

    expect(t.state.maxVision).toBeLessThanOrEqual(4);
});

test("the render window does not become the vision cap", { tag: ["@unit"] }, async () => {
    // A wide window with a narrow semaphore: pixels may queue, requests may not.
    const t = tracker();

    await collectPipeline(fields(12), {
        render: t.render, analyze: t.analyze, visionConcurrency: 2, renderWindow: 10,
    });

    expect(t.state.maxVision, "the semaphore, not the window, bounds requests").toBeLessThanOrEqual(2);
});

test("in-flight work is bounded by the render window", { tag: ["@unit"] }, async () => {
    // Thirty queued fields is a quarter of a gigabyte of RGBA waiting its turn.
    const t = tracker();

    await collectPipeline(fields(30), {
        render: t.render, analyze: t.analyze, visionConcurrency: 4, renderWindow: 5,
    });

    expect(t.state.maxRender).toBeLessThanOrEqual(5);
});

test("analyses actually overlap rather than running one at a time", { tag: ["@unit"] }, async () => {
    const t = tracker();

    await collectPipeline(fields(8), { render: t.render, analyze: t.analyze, visionConcurrency: 4 });

    expect(t.state.maxVision, "the whole point of the pipeline").toBeGreaterThan(1);
});

test("results arrive in completion order, not submission order", { tag: ["@unit"] }, async () => {
    // Imposing submission order would reintroduce head-of-line blocking — the thing the
    // pipeline exists to remove.
    const t = tracker();
    const slowFirst = [{ id: "slow", cost: 40 }, { id: "fast-a", cost: 1 }, { id: "fast-b", cost: 1 }];

    const out = await collectPipeline(slowFirst, {
        render: t.render, analyze: t.analyze, visionConcurrency: 3,
    });

    expect(out[0].id).not.toBe("slow");
    expect(out.at(-1).id).toBe("slow");
});

test("one failing field does not take the run down", { tag: ["@unit"] }, async () => {
    // A walk that loses its remaining budget because one region timed out is worse than
    // a walk with a gap in it.
    const t = tracker();
    const errors = [];

    const out = await collectPipeline(
        [{ id: "ok-a" }, { id: "boom" }, { id: "ok-b" }],
        {
            render: async (f) => { if (f.id === "boom") throw new Error("render timed out"); return t.render(f); },
            analyze: t.analyze,
            onError: (field, error) => { errors.push([field.id, String(error)]); return null; },
        }
    );

    expect(out.map(r => r.id).sort()).toEqual(["ok-a", "ok-b"]);
    expect(errors).toEqual([["boom", "Error: render timed out"]]);
});

test("a failing analysis is contained the same way", { tag: ["@unit"] }, async () => {
    const t = tracker();

    const out = await collectPipeline([{ id: "a" }, { id: "b" }], {
        render: t.render,
        analyze: async (f, r) => { if (f.id === "a") throw new Error("model refused"); return t.analyze(f, r); },
        onError: () => null,
    });

    expect(out.map(r => r.id)).toEqual(["b"]);
});

test("without onError a failure is dropped rather than thrown", { tag: ["@unit"] }, async () => {
    const t = tracker();

    const out = await collectPipeline([{ id: "a" }, { id: "b" }], {
        render: async (f) => { if (f.id === "a") throw new Error("nope"); return t.render(f); },
        analyze: t.analyze,
    });

    expect(out.map(r => r.id)).toEqual(["b"]);
});

test("abort stops admitting work", { tag: ["@unit"] }, async () => {
    const t = tracker();
    const controller = new AbortController();
    const seen = [];

    for await (const result of runFieldPipeline(fields(20), {
        render: t.render, analyze: t.analyze, visionConcurrency: 2, renderWindow: 3,
        signal: controller.signal,
    })) {
        seen.push(result.id);
        if (seen.length === 2) controller.abort();
    }

    expect(seen.length, "stops at the next boundary, not mid-request").toBeLessThan(20);
});

test("the raster is released once its analysis is done", { tag: ["@unit"] }, async () => {
    // The PNG the model needed is a few hundred kilobytes; the RGBA it came from is
    // megabytes, and holding it past the call is how peak memory grows with concurrency.
    const t = tracker();
    const released = [];

    await collectPipeline(fields(4), {
        render: t.render, analyze: t.analyze,
        onRasterConsumed: (raster) => released.push(raster.pixels),
    });

    expect(released.sort()).toEqual(fields(4).map(f => `raster:${f.id}`).sort());
});

test("the raster is released even when the analysis fails", { tag: ["@unit"] }, async () => {
    const t = tracker();
    const released = [];

    await collectPipeline([{ id: "a" }], {
        render: t.render,
        analyze: async () => { throw new Error("model refused"); },
        onError: () => null,
        onRasterConsumed: (raster) => released.push(raster.pixels),
    });

    expect(released, "a failed call must not leak its pixels").toEqual(["raster:a"]);
});

test("an empty field list completes immediately", { tag: ["@unit"] }, async () => {
    expect(await collectPipeline([], { render: async () => ({}), analyze: async () => ({}) })).toEqual([]);
});

test("the semaphore admits exactly its limit and queues the rest", { tag: ["@unit"] }, async () => {
    const sem = createSemaphore(2);
    const r1 = await sem.acquire();
    await sem.acquire();

    let third = false;
    sem.acquire().then(() => { third = true; });
    await tick(1);
    expect(third, "the third caller waits").toBe(false);

    r1();
    await tick(1);
    expect(third, "and is admitted when a permit is returned").toBe(true);
});

test("releasing twice does not hand out a permit that was never held", { tag: ["@unit"] }, async () => {
    const sem = createSemaphore(1);
    const release = await sem.acquire();
    release();
    release();

    await sem.acquire();
    let extra = false;
    sem.acquire().then(() => { extra = true; });
    await tick(1);

    expect(extra, "the limit still holds after a double release").toBe(false);
});
