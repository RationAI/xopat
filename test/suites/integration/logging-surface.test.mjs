/**
 * The logging surface as a deployment actually meets it.
 *
 * The unit suites pin the sink and broker mechanics; these pin the two things
 * only a running server and a real page can answer: that the browser-facing
 * write path is CLOSED on a deployment that never configured it, and that the
 * client broker is actually installed rather than merely compiling.
 */
import { test, expect } from "@xopat/test-harness";

test("client log ingest is refused on a deployment that never enabled it", { tag: ["@integration", "@security"] }, async ({ xopatServer }) => {
    // This is the only inbound path into the server's logs. Doing nothing must
    // leave it shut — an operator has to opt in with logging.client.ingest.
    const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
        records: [{ channel: "app", level: "error", message: "should not be accepted" }],
    });

    expect(res.status, "closed by default").toBe(403);
    expect(res.body?.code).toBe("RPC_FORBIDDEN");
    expect(String(res.body?.error), "and says which knob opens it").toMatch(/logging\.client\.ingest/);
});

test("a refusal answers 4xx, not 500", { tag: ["@integration", "@security"] }, async ({ xopatServer }) => {
    // Every RPC failure used to leave as 500, including the ones that declared
    // otherwise — `#assertLogReadAllowed` has set `error.status = 403` since it
    // was written and the dispatcher dropped it. Two costs: the caller cannot
    // tell "you may not" from "we broke", and the client's retry heuristic reads
    // 5xx as possibly-transient, so it replays an authorization refusal that will
    // answer identically forever.
    const read = await xopatServer.rpc("server", "core", "getLogs");
    if (read.body?.code === "RPC_FORBIDDEN") {
        expect(read.status, "a log-read refusal is a 403").toBe(403);
    } else {
        // Dev-mode deployment: reads are open, and then the answer is a result.
        expect(read.status).toBe(200);
    }
});

test("the client broker replaces the unbounded console trace", { tag: ["@integration"] }, async ({ xopat }) => {
    await xopat.launch();
    await xopat.waitForViewer();

    const probe = await xopat.page.evaluate(() => {
        const api = window.APPLICATION_CONTEXT;
        const before = window.console.appTrace.length;
        api.log("test:integration").warn({ marker: 1 }, "hello from the page");
        const entries = api.logging.getEntries({ channel: "test", limit: 10 });
        return {
            hasLog: typeof api.log === "function",
            adopted: window.console.__appTraceOwned === true,
            appTraceIsArray: Array.isArray(window.console.appTrace),
            grew: window.console.appTrace.length > before,
            recorded: entries.map(e => ({ channel: e.channel, level: e.level, message: e.message, fields: e.fields })),
            forwardEnabled: api.logging.stats().forward.enabled,
        };
    });

    expect(probe.hasLog, "APPLICATION_CONTEXT.log is installed").toBe(true);
    expect(probe.adopted, "the pre-boot console hook handed over").toBe(true);
    // The crash-export page joins this array into a <pre>; that contract survives.
    expect(probe.appTraceIsArray).toBe(true);
    expect(probe.grew).toBe(true);
    expect(probe.recorded.length).toBe(1);
    expect(probe.recorded[0].channel).toBe("test:integration");
    expect(probe.recorded[0].fields).toEqual({ marker: 1 });
    expect(probe.forwardEnabled, "nothing is forwarded unless the deployment says so").toBe(false);
});

test("a session records its own timeline: boot, and which slides opened", { tag: ["@integration"] }, async ({ xopat }) => {
    // What makes a pilot session reconstructible. The channel is at `info`, which
    // the default root level already admits, so this is what an operator gets by
    // pointing a destination at it — no extra configuration.
    await xopat.launch();
    await xopat.waitForViewer();

    const probe = await xopat.page.evaluate(() => {
        const api = window.APPLICATION_CONTEXT;
        return {
            sessionId: api.logging.sessionId,
            records: api.logging.getEntries({ channel: "session", limit: 50 })
                .map(e => ({ message: e.message, fields: e.fields })),
        };
    });

    // One token per page load — the thing that groups a sitting together.
    expect(probe.sessionId).toMatch(/^cs_/);

    const boot = probe.records.find(r => r.message.includes("session started"));
    expect(boot, "the frame of reference for every later line").toBeTruthy();
    expect(typeof boot.fields.production).toBe("boolean");
    expect(boot.fields.viewport.width).toBeGreaterThan(0);

    const slides = probe.records.find(r => r.message.includes("slides opened"));
    expect(slides, "which slide the participant was working on").toBeTruthy();
    expect(slides.fields.viewerCount).toBeGreaterThan(0);
    // Keyed by tileSourceId, never a URL — DICOMweb shares one baseUrl.
    expect(slides.fields.viewers[0]).toHaveProperty("tileSourceId");
});
