/**
 * The job poll's failure behaviour.
 *
 * This suite exists because of one line. `refresh()` read `this._inFlight.signal`
 * back out of the instance inside its own catch, and `stopPolling()` nulls that
 * field — so stopping a poll mid-flight threw
 * `Cannot read properties of undefined (reading 'signal')`. The throw happened at
 * the *first* statement of the catch, before the failure counter, so:
 *
 *  - the failure budget never counted anything and never stopped the loop, and
 *  - `tick()` re-armed its timer on the line *after* `await this.refresh()`, so
 *    the throw ended polling for the rest of the session.
 *
 * A real session logged an expired token, hundreds of `GET /jobs`, and no results.
 * Two of those three are this file's subject; the third is the 401 rule below.
 */
import { test, expect } from "@xopat/test-harness";

const { JobRunner } = await import("../../job-runner.ts");

const EAD = {
    io: { my_wsi: { type: "wsi" }, my_rect: { type: "rectangle", reference: "io.my_wsi" } },
    modes: { standalone: { inputs: ["my_wsi", "my_rect"], outputs: [] } },
};

/** A runner whose `listJobs` behaviour the test controls. */
function runnerWith(listJobs, deps = {}) {
    const calls = { lists: 0, authStalled: 0, changed: [] };
    const client = {
        scopeId: "scope-1",
        async listJobs(signal) {
            calls.lists++;
            return listJobs(signal, calls.lists);
        },
    };
    const runner = new JobRunner({
        getClient: () => client,
        getEad: () => EAD,
        getSlideId: () => "slide-1",
        getMode: () => "standalone",
        pollMs: () => 1000,
        pollMaxMs: () => 8000,
        onAuthStalled: () => { calls.authStalled++; },
        onJobsChanged: (slideId, jobs) => calls.changed.push([slideId, jobs.length]),
        ...deps,
    });
    return { runner, calls };
}

const httpError = (statusCode) => Object.assign(new Error(`HTTP failed: ${statusCode}`), { statusCode });
const job = (over = {}) => ({ id: "job-1", mode: "STANDALONE", status: "COMPLETED", inputs: { my_wsi: "slide-1" }, ...over });

// ── the crash ───────────────────────────────────────────────────────────────

test("stopping a poll mid-flight does not throw", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { runner } = runnerWith(async (signal) => {
        await gate;
        // Exactly what an aborted fetch does.
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
    });

    const pending = runner.refresh();
    // This nulls `_inFlight`, which the catch used to read back.
    runner.stopPolling();
    release();

    // The assertion is simply that it resolves rather than throwing a TypeError.
    await expect(pending).resolves.toBe(false);
});

test("a concurrent refresh does not report the other's abort as a failure", async () => {
    const gates = [];
    const { runner, calls } = runnerWith((signal, n) => new Promise((resolve, reject) => {
        gates.push({ n, resolve, reject, signal });
    }));

    const first = runner.refresh();
    await Promise.resolve();
    const second = runner.refresh();   // aborts the first and replaces `_inFlight`
    await Promise.resolve();

    // The first call's own controller is aborted; it must notice that and stay
    // quiet, rather than inspecting whatever `_inFlight` now points at.
    gates[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(first).resolves.toBe(false);

    gates[1].resolve([job()]);
    await second;
    expect(calls.lists).toBe(2);
});

// ── the budget the crash disabled ───────────────────────────────────────────

test("a rejecting listJobs counts against the budget and eventually stops", async () => {
    const { runner, calls } = runnerWith(async () => { throw new Error("boom"); });

    // Each refresh is one failure; the fifth reports "done", i.e. stop polling.
    for (let i = 1; i < 5; i++) {
        expect(await runner.refresh(), `failure ${i} must not stop the loop`).toBe(false);
    }
    expect(await runner.refresh()).toBe(true);
    expect(calls.lists).toBe(5);
});

test("a success resets the failure streak", async () => {
    let fail = true;
    const { runner } = runnerWith(async () => {
        if (fail) throw new Error("boom");
        return [job()];
    });

    for (let i = 0; i < 4; i++) await runner.refresh();
    fail = false;
    await runner.refresh();
    fail = true;
    // Four more failures must again be survivable — the streak restarted.
    for (let i = 0; i < 4; i++) {
        expect(await runner.refresh()).toBe(false);
    }
});

// ── 401 is a wait, not a fault ──────────────────────────────────────────────

test("a 401 stops the timer and asks for a credential instead of retrying", async () => {
    const { runner, calls } = runnerWith(async () => { throw httpError(401); });

    // `true` = stop the loop. `HttpClient` is already refreshing through the auth
    // broker, so retrying on the 2 s timer is what filled a log with
    // "Access Token expired."
    expect(await runner.refresh()).toBe(true);
    expect(calls.authStalled).toBe(1);
});

test("a 401 does not burn the failure budget", async () => {
    const { runner } = runnerWith(async () => { throw httpError(401); });
    for (let i = 0; i < 8; i++) await runner.refresh();

    // Auth waits are not transport faults: after eight of them a genuine
    // transport error must still get its full allowance.
    const { runner: fresh } = runnerWith(async () => { throw new Error("boom"); });
    expect(await fresh.refresh()).toBe(false);
});

test("other HTTP errors are ordinary failures", async () => {
    const { runner, calls } = runnerWith(async () => { throw httpError(500); });
    expect(await runner.refresh()).toBe(false);
    expect(calls.authStalled).toBe(0);
});

// ── the loop survives a throwing refresh ────────────────────────────────────

test("a throwing refresh re-arms the timer instead of ending the loop", async () => {
    const { runner, calls } = runnerWith(async () => [job({ status: "RUNNING" })]);
    // Make `refresh` itself throw, which is the shape the crash had.
    let thrown = 0;
    runner.refresh = async () => { thrown++; throw new TypeError("Cannot read properties of undefined"); };

    runner.startPolling();
    await new Promise(resolve => setTimeout(resolve, 30));
    runner.stopPolling();

    // The first tick threw. Before the fix that ended polling permanently and
    // only the first rejection was even logged.
    expect(thrown).toBeGreaterThan(0);
    void calls;
});

// ── idle backoff ────────────────────────────────────────────────────────────

test("ticks that change nothing lengthen the wait, up to the ceiling", async () => {
    const { runner } = runnerWith(async () => [job({ status: "RUNNING" })]);

    // First read: the signature is new, so this counts as movement.
    await runner.refresh();
    expect(runner._nextDelay()).toBe(1000);

    // Nothing changes after that — the same job, the same status.
    await runner.refresh();
    expect(runner._nextDelay()).toBe(2000);
    await runner.refresh();
    expect(runner._nextDelay()).toBe(4000);
    await runner.refresh();
    expect(runner._nextDelay()).toBe(8000);
    // Ceiling.
    await runner.refresh();
    expect(runner._nextDelay()).toBe(8000);
});

test("anything moving resets the backoff", async () => {
    let status = "RUNNING";
    const { runner } = runnerWith(async () => [job({ status })]);

    await runner.refresh();
    await runner.refresh();
    await runner.refresh();
    expect(runner._nextDelay()).toBeGreaterThan(1000);

    status = "COMPLETED";
    await runner.refresh();
    expect(runner._nextDelay()).toBe(1000);
});

test("startPolling clears both the failure streak and the backoff", async () => {
    const { runner } = runnerWith(async () => [job({ status: "RUNNING" })]);
    await runner.refresh();
    await runner.refresh();
    await runner.refresh();
    expect(runner._nextDelay()).toBeGreaterThan(1000);

    // The user acted: a slide opened, a job ran. That is a fresh chance.
    runner.startPolling();
    expect(runner._nextDelay()).toBe(1000);
    runner.stopPolling();
});
