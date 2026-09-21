/**
 * A refresh must ask the same question the expand asked.
 *
 * With the job RECORD in hand the workbench reads what the app's EAD declared
 * as outputs. Without it, it re-finds the job by id — and that search only
 * covers the *active mode's* bucket, so a job belonging to another mode
 * resolves no declared outputs at all and the pane reports "declared N results,
 * none could be read back".
 *
 * `_expand` always had the record; `refreshExpandedOutputs` did not, because it
 * runs off a job event that carries an id only. So opening a postprocessing
 * analysis showed its results, and the next job event replaced them with
 * nothing. The record is therefore retained next to the expanded id.
 */
import { test, expect } from "@xopat/test-harness";

// `jobs-window.mjs` destructures `van.tags` at module scope, so the stub has to
// exist before the import. Only `state` carries behaviour these tests observe.
globalThis.window = globalThis.window ?? globalThis;
globalThis.van = globalThis.van ?? {
    state: (val) => ({ val }),
    derive: (fn) => ({ get val() { return fn(); } }),
    add: () => {},
    tags: new Proxy({}, { get: () => (...args) => ({ args }) }),
    tagsNS: () => new Proxy({}, { get: () => (...args) => ({ args }) }),
};
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };
globalThis.UI = globalThis.UI ?? {};

const { JobsWindow } = await import("../../jobs-window.mjs");

const JOB = { id: "job-1", app_id: "app-1", status: "COMPLETED", mode: "POSTPROCESSING" };
const OUTPUTS = { primitives: [{ id: "p1" }], pixelmaps: [], annotations: [], lockedInputs: [] };

/** A plugin that records how it was asked, and answers immediately. */
function windowWithSpy() {
    const calls = [];
    const plugin = {
        loadJobOutputs(jobId, job) {
            calls.push({ jobId, job });
            return Promise.resolve(OUTPUTS);
        },
    };
    return { win: new JobsWindow(plugin), calls };
}

test("expanding a row retains the job record beside its id", () => {
    const { win, calls } = windowWithSpy();

    win._expand(JOB.id, JOB);

    expect(win.view.expandedJobId.val).toBe(JOB.id);
    expect(win.view.expandedJob.val, "the record the refresh will need").toBe(JOB);
    expect(calls[0].job, "the expand itself always had it").toBe(JOB);
});

test("a refresh forwards the retained record, not just the id", async () => {
    const { win, calls } = windowWithSpy();
    win._expand(JOB.id, JOB);
    calls.length = 0;

    win.refreshExpandedOutputs(JOB.id);
    await Promise.resolve();

    expect(calls.length, "the open row is re-read").toBe(1);
    // The regression: this used to be `undefined`, so the refresh resolved fewer
    // outputs than the expand that preceded it.
    expect(calls[0].job).toBe(JOB);
});

test("collapsing clears the record, so a later refresh cannot resurrect it", () => {
    const { win, calls } = windowWithSpy();
    win._expand(JOB.id, JOB);
    win._expand(JOB.id, JOB);            // same id again = collapse

    expect(win.view.expandedJobId.val).toBe(undefined);
    expect(win.view.expandedJob.val).toBe(undefined);

    calls.length = 0;
    win.refreshExpandedOutputs(JOB.id);
    expect(calls.length, "nothing is open, so nothing is fetched").toBe(0);
});

test("a refresh for a row that is not the open one is ignored", () => {
    const { win, calls } = windowWithSpy();
    win._expand(JOB.id, JOB);
    calls.length = 0;

    win.refreshExpandedOutputs("some-other-job");
    win.refreshExpandedOutputs("");

    expect(calls.length).toBe(0);
});

test("switching rows replaces the record rather than keeping the old one", async () => {
    const { win, calls } = windowWithSpy();
    const other = { id: "job-2", app_id: "app-2", status: "COMPLETED", mode: "PREPROCESSING" };

    win._expand(JOB.id, JOB);
    win._expand(other.id, other);
    calls.length = 0;

    win.refreshExpandedOutputs(other.id);
    await Promise.resolve();

    expect(calls[0].job, "the record must follow the open row").toBe(other);
});
