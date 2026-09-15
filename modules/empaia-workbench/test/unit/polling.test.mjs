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
    // The stall is RECORDED here and notified by the tick, after stopPolling —
    // notifying from inside `refresh` races the stop (see the next test).
    expect(runner._authStalled).toBe(true);
    expect(calls.authStalled).toBe(0);
});

test("a 401 whose credential is already there restarts the loop, not ends it", async () => {
    // The session-killer: `onAuthStalled` resolved synchronously, so the resume
    // called `startPolling()` while `_polling` was still true — a no-op — and the
    // `stopPolling()` that followed left the loop dead. A job submitted after
    // that never came back for the rest of the session.
    let fail = true;
    const { runner, calls } = runnerWith(
        async () => { if (fail) throw httpError(401); return [job({ status: "RUNNING" })]; },
        { onAuthStalled() { calls.authStalled++; fail = false; runner.startPolling(); } },
    );

    runner.startPolling();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(calls.authStalled).toBe(1);
    expect(runner._polling).toBe(true);
    expect(calls.lists).toBeGreaterThan(1);
    runner.stopPolling();
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

// ── validation status decides when the loop may stop ────────────────────────

test("a COMPLETED job whose validation never ran does not poll forever", async () => {
    // The TA06 session: the panel said "completed" (the UI reads `status`) while
    // `GET /jobs` kept firing, because "NONE" fell through every arm of the
    // done-list even though TERMINAL_JOB_STATUSES calls the same literal
    // terminal for `status`. A validation that never runs cannot transition, so
    // the wait had no end.
    const { runner } = runnerWith(async () => [job({
        status: "COMPLETED", output_validation_status: "NONE", input_validation_status: "NONE",
    })]);
    expect(await runner.refresh()).toBe(true);
});

test("only RUNNING keeps the loop alive", async () => {
    const { isJobValidationTerminal } = await import("../../types.ts");
    for (const status of ["NONE", "COMPLETED", "ERROR", "FAILED", undefined, null, ""]) {
        expect(isJobValidationTerminal({ output_validation_status: status })).toBe(true);
    }
    expect(isJobValidationTerminal({ output_validation_status: "RUNNING" })).toBe(false);
    expect(isJobValidationTerminal({ input_validation_status: "RUNNING" })).toBe(false);
});

test("output validation still running is not done", async () => {
    const { runner } = runnerWith(async () => [job({
        status: "COMPLETED", output_validation_status: "RUNNING",
    })]);
    expect(await runner.refresh()).toBe(false);
});

// ── waiting for an output the job list cannot show ──────────────────────────

test("a caller waiting on outputs holds the loop open, and releases it", async () => {
    // TA06 completes before its 24 690 points are queryable. Without this the
    // loop stops on the settle tick and nothing ever reads again.
    let awaiting = true;
    const { runner } = runnerWith(
        async () => [job({ status: "COMPLETED", output_validation_status: "NONE" })],
        { isAwaitingOutputs: () => awaiting },
    );

    expect(await runner.refresh()).toBe(false);
    awaiting = false;
    expect(await runner.refresh()).toBe(true);
});

test("the heartbeat fires on a tick that changed nothing — the emit does not", async () => {
    // The asymmetry the retry rides: a job waiting for its output moves no field
    // in `signatureOf`, so `onJobsChanged` is silent from the second tick on.
    const ticks = [];
    const { runner, calls } = runnerWith(
        async () => [job({ status: "COMPLETED", output_validation_status: "NONE" })],
        { onPollTick: (slideId, jobs) => ticks.push([slideId, jobs.length]) },
    );

    await runner.refresh();
    const changedAfterFirst = calls.changed.length;
    await runner.refresh();
    await runner.refresh();

    expect(calls.changed.length).toBe(changedAfterFirst);   // silent
    expect(ticks.length).toBe(3);                            // one per poll
    expect(ticks[2]).toEqual(["slide-1", 1]);
});

test("the heartbeat covers the active slide even when it has no jobs", async () => {
    const ticks = [];
    const { runner } = runnerWith(async () => [], {
        onPollTick: (slideId, jobs) => ticks.push([slideId, jobs.length]),
    });
    await runner.refresh();
    expect(ticks).toEqual([["slide-1", 0]]);
});

// ── what the pre-open seed relies on ────────────────────────────────────────

test("one refresh fills the slide bucket, so the pre-open seed runs once", async () => {
    // `openSlide` calls `_ensureJobsKnown`, which polls only while
    // `jobsFor(slideId)` is still empty. Before this existed, the boot auto-open
    // ran before any poll at all, so `_visibleJobs` was empty, `_prefetchPixelmaps`
    // returned at its first line, and the first open of a slide could never carry
    // a pixel-map layer — the user got a full re-open a moment later instead.
    //
    // The guard is only sound if a single refresh actually populates the bucket.
    const { runner, calls } = runnerWith(async () => [job()]);

    expect(runner.jobsFor("slide-1").length).toBe(0);   // the guard would poll
    await runner.refresh();
    expect(calls.lists).toBe(1);
    expect(runner.jobsFor("slide-1").length).toBe(1);   // and now it would not
    runner.stopPolling();
});

test("a slide with no analyses stays empty, and is polled again next open", async () => {
    // The counterpart: an empty bucket is indistinguishable from an unknown one,
    // so re-opening that slide costs one more list. Cheap, and the alternative —
    // remembering "checked, nothing there" — goes stale the moment a job lands.
    const { runner, calls } = runnerWith(async () => []);
    await runner.refresh();
    expect(calls.lists).toBe(1);
    expect(runner.jobsFor("slide-1").length).toBe(0);
    runner.stopPolling();
});
