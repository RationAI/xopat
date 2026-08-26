/**
 * The client half of the logging model.
 *
 * What it replaces: a bootstrap hook that pushed every `console.error`/`warn`
 * argument into an UNBOUNDED `console.appTrace` array of interleaved strings,
 * read once by the crash-export page. No levels, no channels, no configuration,
 * no bound, and nothing the browser saw ever reached the monitoring an operator
 * watches.
 *
 * The properties worth pinning are the ones that make it a broker rather than a
 * nicer `console.log`: levels resolve down the channel hierarchy, the buffer is
 * bounded, forwarding is off until a deployment turns it on, and `sensitive()`
 * needs the operator's word — the same gate as the server, because on real data
 * those records are PHI.
 */
import { test, expect } from "@xopat/test-harness";

const { ClientLogging } = await import("../../../src/classes/app/logging.ts");

/** A broker with an injected transport — no RPC client, no server. */
function makeBroker(config = {}, sink = []) {
    const broker = new ClientLogging(config, {
        transport: async (records) => { sink.push(records); },
    });
    return { broker, sink };
}

// ---- levels --------------------------------------------------------------------

test("a channel inherits the nearest configured ancestor @unit", () => {
    const { broker } = makeBroker({
        level: "warn",
        channels: { "module.chat": "debug", "module.chat:llm": "trace" },
    });

    expect(broker.log("module.chat:llm").level()).toBe("trace");
    expect(broker.log("module.chat:ui").level(), "inherits module.chat").toBe("debug");
    expect(broker.log("module.chat:ui:sub").level(), "and keeps inheriting downward").toBe("debug");
    expect(broker.log("module.other").level(), "falls back to the root level").toBe("warn");
});

test("the default is quiet but useful — warnings and errors, nothing forwarded @unit", () => {
    // A deployment that never heard of this config block must behave as before.
    const { broker, sink } = makeBroker();
    const log = broker.log("test");
    expect(log.info("ignored")).toBe(null);
    expect(log.warn("kept")).not.toBe(null);
    expect(broker.getEntries().length).toBe(1);
    expect(sink.length, "forwarding is opt-in").toBe(0);
});

test("channel identity does not depend on casing or spacing @unit", () => {
    const { broker } = makeBroker({ level: "info", channels: { "module.thing": "trace" } });
    expect(broker.log("Module.Thing ").channel).toBe("module.thing");
    expect(broker.log("Module.Thing").level()).toBe("trace");
});

// ---- records -------------------------------------------------------------------

test("a leading plain object is fields, the rest is the message @unit", () => {
    // Same call convention as the server logger, so a snippet moves between them.
    const { broker } = makeBroker({ level: "trace" });
    const record = broker.log("test").info({ tiles: 12 }, "decoded", "ok");
    expect(record.fields).toEqual({ tiles: 12 });
    expect(record.message).toBe("decoded ok");
});

test("an Error is a message, not an unreadable object @unit", () => {
    const { broker } = makeBroker({ level: "trace" });
    const record = broker.log("test").error(new Error("boom"));
    expect(record.message).toBe("Error: boom");
});

test("a long string is cut, and says how much it lost @unit", () => {
    const { broker } = makeBroker({ level: "trace", maxStringLength: 200 });
    const record = broker.log("test").info("x".repeat(5000));
    expect(record.message.length).toBeLessThan(300);
    expect(record.message).toContain("[+");
});

test("a cyclic field is kept rather than throwing @unit", () => {
    // A logging call that throws turns a diagnostic into an outage.
    const { broker } = makeBroker({ level: "trace" });
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => broker.log("test").info({ cyclic }, "hi")).not.toThrow();
});

test("time() reports a duration on the record @unit", () => {
    const { broker } = makeBroker({ level: "trace" });
    const done = broker.log("test").time("work");
    const record = done({ items: 3 });
    expect(record.fields.items).toBe(3);
    expect(typeof record.fields.durationMs).toBe("number");
});

// ---- the bound -----------------------------------------------------------------

test("the ring is bounded and counts what it dropped @unit", () => {
    // The unbounded array is the thing this replaces; a bound that loses records
    // silently would only trade one problem for another.
    const { broker } = makeBroker({ level: "trace", ring: 50 });
    for (let i = 0; i < 120; i++) broker.log("test").info(`m${i}`);

    const entries = broker.getEntries({ limit: 1000 });
    expect(entries.length).toBe(50);
    expect(entries[0].message, "the oldest went").toBe("m70");
    expect(broker.stats().ring.dropped).toBe(70);
});

test("getEntries filters by level, channel and text @unit", () => {
    const { broker } = makeBroker({ level: "trace" });
    broker.log("a").info("apple");
    broker.log("a:sub").error("banana");
    broker.log("b").info("cherry");

    expect(broker.getEntries({ minLevel: "error" }).map(e => e.message)).toEqual(["banana"]);
    expect(broker.getEntries({ channel: "a" }).length, "a channel includes its children").toBe(2);
    expect(broker.getEntries({ search: "cher" }).map(e => e.message)).toEqual(["cherry"]);
});

// ---- sensitive -----------------------------------------------------------------

test("sensitive() needs the operator's word AND a trace channel @unit", () => {
    const off = makeBroker({ level: "trace" }).broker;
    expect(off.log("test").sensitive("PAYLOAD", { body: "x" }), "no allowSensitive").toBe(null);

    const wrongLevel = makeBroker({ level: "debug", allowSensitive: true }).broker;
    expect(wrongLevel.log("test").sensitive("PAYLOAD"), "channel is not at trace").toBe(null);

    const on = makeBroker({ level: "trace", allowSensitive: true }).broker;
    const record = on.log("test").sensitive("PAYLOAD");
    expect(record.sensitive).toBe(true);
});

test("allowSensitive is only ever the literal true @unit", () => {
    for (const value of ["true", 1, {}, "yes"]) {
        const broker = new ClientLogging({ level: "trace", allowSensitive: value });
        expect(broker.log("t").sensitive("PAYLOAD")).toBe(null);
    }
});

// ---- forwarding ----------------------------------------------------------------

test("forwarding batches, and only what it was told to send @unit", async () => {
    const { broker, sink } = makeBroker({
        level: "trace",
        forward: { enabled: true, minLevel: "warn", batchSize: 2 },
    });

    broker.log("test").info("below minLevel");
    broker.log("test").warn("one");
    expect(sink.length, "waits for the batch").toBe(0);

    broker.log("test").error("two");
    await broker.flush();

    expect(sink.length).toBe(1);
    expect(sink[0].map(r => r.message)).toEqual(["one", "two"]);
    expect(broker.stats().counters.forwarded).toBe(2);
});

test("a sensitive record is not forwarded unless forwarding opted in separately @unit", async () => {
    // Recording a payload locally and shipping it to the server are two
    // decisions, exactly as they are server-side.
    const closed = makeBroker({ level: "trace", allowSensitive: true, forward: { enabled: true, minLevel: "trace", batchSize: 1 } });
    closed.broker.log("test").sensitive("PAYLOAD");
    await closed.broker.flush();
    expect(closed.sink.length).toBe(0);

    const open = makeBroker({
        level: "trace", allowSensitive: true,
        forward: { enabled: true, minLevel: "trace", batchSize: 1, includeSensitive: true },
    });
    open.broker.log("test").sensitive("PAYLOAD");
    await open.broker.flush();
    expect(open.sink.length).toBe(1);
});

test("the forward queue is bounded, dropping the oldest and counting it @unit", () => {
    const { broker } = makeBroker({
        level: "trace",
        forward: { enabled: true, minLevel: "trace", batchSize: 10_000, queueLimit: 10 },
    });
    for (let i = 0; i < 25; i++) broker.log("test").info(`m${i}`);

    const stats = broker.stats();
    expect(stats.forward.queued).toBe(10);
    expect(stats.counters.forwardDropped).toBe(15);
});

test("every batch carries the sitting's id, so records can be grouped @unit", async () => {
    // The whole reconstruction story rests on this: one page load, one token, no
    // identity. Sent per batch rather than per record because it never changes.
    const seen = [];
    const broker = new ClientLogging(
        { level: "trace", forward: { enabled: true, minLevel: "trace", batchSize: 1 } },
        { transport: async (records, sessionId) => { seen.push({ count: records.length, sessionId }); } },
    );

    expect(broker.sessionId).toMatch(/^cs_[A-Za-z0-9]{8,}$/);
    broker.log("test").info("one");
    await broker.flush();

    expect(seen[0].sessionId).toBe(broker.sessionId);
});

test("two brokers are two sittings @unit", { tag: ["@unit"] }, () => {
    // A new page load IS a new sitting — that is what the token means.
    expect(new ClientLogging().sessionId).not.toBe(new ClientLogging().sessionId);
});

test("a failed batch is dropped, not retried @unit", async () => {
    // A forwarder that retries turns a server hiccup into a growing client queue,
    // and the records that matter are usually the ones still arriving.
    const broker = new ClientLogging(
        { level: "trace", forward: { enabled: true, minLevel: "trace", batchSize: 1 } },
        { transport: async () => { throw new Error("offline"); } },
    );
    broker.log("test").info("lost");
    await broker.flush();

    const stats = broker.stats();
    expect(stats.counters.forwardFailures).toBe(1);
    expect(stats.counters.forwardDropped).toBe(1);
    expect(stats.forward.queued, "nothing was put back").toBe(0);
});

test("a logging failure never reaches the caller @unit", () => {
    const broker = new ClientLogging(
        { level: "trace", forward: { enabled: true, minLevel: "trace", batchSize: 1 } },
        { transport: async () => { throw new Error("offline"); } },
    );
    expect(() => broker.log("test").error("still fine")).not.toThrow();
});

// ---- console adoption ------------------------------------------------------------

test("adopting the console keeps appTrace readable — and bounded @unit", () => {
    // `src/loader.ts` joins `console.appTrace` into the crash-export page. That
    // contract has to survive, or this is a breaking change rather than a fix.
    const fake = {
        appTrace: ["ERROR ", "pre-boot failure", "\n"],
        log() {}, info() {}, debug() {}, warn() {}, error() {},
    };
    const { broker } = makeBroker({ level: "trace", ring: 50 });   // 50 is the floor
    broker.adoptConsole(fake);

    expect(fake.__appTraceOwned, "the pre-boot hook is told to stand down").toBe(true);
    expect(Array.isArray(fake.appTrace)).toBe(true);
    expect(fake.appTrace.join("")).toContain("pre-boot failure");

    fake.warn("later problem");
    const text = fake.appTrace.join("");
    expect(text).toContain("later problem");
    expect(text).toContain("[console]");

    for (let i = 0; i < 200; i++) fake.error(`e${i}`);
    expect(fake.appTrace.length, "bounded by the ring, not by the session length").toBe(50);
});

test("adoption is idempotent — a second call does not stack wrappers @unit", () => {
    const seen = [];
    const fake = { appTrace: [], log() {}, info() {}, debug() {}, warn: (...a) => seen.push(a), error() {} };
    const { broker } = makeBroker({ level: "trace" });
    broker.adoptConsole(fake);
    broker.adoptConsole(fake);

    fake.warn("once");
    expect(seen.length, "the underlying console was written exactly once").toBe(1);
});
