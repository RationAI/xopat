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

test("an adopted console.log still prints, verbatim, at the default level @unit", () => {
    // The default root level is `warn`. Gating the PRINT on that made every
    // `console.log` in the app — and every one typed into devtools — vanish.
    // Printing is not a level decision; the level decides ring/forwarder only.
    const seen = [];
    const fake = { appTrace: [], log: (...a) => seen.push(a), info() {}, debug() {}, warn() {}, error() {} };
    const { broker } = makeBroker({});          // no config at all = level "warn"
    broker.adoptConsole(fake);

    const payload = { a: 1 };
    fake.log("HI", payload);
    expect(seen.length, "printed once").toBe(1);
    expect(seen[0][0], "no channel prefix, no reformatting").toBe("HI");
    expect(seen[0][1], "objects reach devtools unstringified").toBe(payload);
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

// ---- attachments ---------------------------------------------------------------

/** A broker with forwarding on, so the attachment path is reachable. */
function forwardingBroker(over = {}) {
    const sink = [];
    const { forward, ...rest } = over;
    const broker = new ClientLogging({
        level: "trace",
        allowSensitive: true,
        ...rest,
        forward: { enabled: true, minLevel: "trace", includeSensitive: true, ...(forward || {}) },
    }, { transport: async (records) => { sink.push(records); } });
    return { broker, sink };
}

const BYTES = () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

test("an attachment is a sensitive record carrying a descriptor, never the bytes @unit", async () => {
    // The ring is the crash export and it lives for the page. A ring that held the
    // bytes would pin every recorded window's audio in the tab — which is exactly
    // what putting the payload out-of-band exists to avoid.
    const { broker } = forwardingBroker({ forward: { attachments: true } });
    const record = broker.log("test").attachment({ file: "a/b.webm", bytes: BYTES(), mediaType: "audio/webm" });

    expect(record.sensitive).toBe(true);
    expect(record.fields.attachment.file).toBe("a/b.webm");
    expect(record.fields.attachment.size).toBe(8);
    expect(record.fields.attachment.mediaType).toBe("audio/webm");
    expect(record.attachmentBytes, "the ring's copy carries no bytes").toBe(undefined);
    await broker.flushAttachments();
});

test("attachment bytes need their own opt-in, and the line says when they were refused @unit", async () => {
    // A descriptor pointing at a file nobody kept is the answer to "why is there no
    // recording for this window". Dropping the record too would delete the question.
    const { broker, sink } = forwardingBroker();          // forward.attachments not set
    const record = broker.log("test").attachment({ file: "a/b.webm", bytes: BYTES() });
    await broker.flushAttachments();

    expect(record.fields.attachment.stored).toBe(false);
    expect(record.fields.attachment.reason).toBe("not-forwarded");
    expect(sink.length, "nothing was sent").toBe(0);
    expect(broker.stats().counters.attachmentsDropped).toBe(1);
});

test("an over-cap attachment is refused by size, not truncated @unit", async () => {
    const { broker, sink } = forwardingBroker({ forward: { attachments: true, maxAttachmentBytes: 1024 } });
    const record = broker.log("test").attachment({ file: "big.bin", bytes: new Uint8Array(4096) });
    await broker.flushAttachments();

    expect(record.fields.attachment.reason).toBe("too-large");
    expect(sink.length).toBe(0);
    expect(broker.stats().counters.attachmentsOversized).toBe(1);
});

test("attachments ship one file per request, base64 beside the record @unit", async () => {
    // One per request on purpose: an attachment dwarfs a log line, so batching them
    // only makes the body limit a moving target and turns one rejected file into a
    // rejected batch.
    const { broker, sink } = forwardingBroker({ forward: { attachments: true } });
    broker.log("test").attachment({ file: "one.bin", bytes: BYTES() });
    broker.log("test").attachment({ file: "two.bin", bytes: BYTES() });
    await broker.flushAttachments();

    expect(sink.length).toBe(2);
    expect(sink[0].length, "one record per request").toBe(1);
    expect(sink[0][0].fields.attachment.file).toBe("one.bin");
    expect(typeof sink[0][0].attachmentBytes).toBe("string");
    expect(atob(sink[0][0].attachmentBytes).length, "the bytes survive the encoding").toBe(8);
    expect(broker.stats().counters.attachmentsForwarded).toBe(2);
});

test("attachments do not ride the record queue @unit", async () => {
    // Records and files are bounded by different units — a shared queue would either
    // evict every record or be bounded by the wrong one.
    const { broker, sink } = forwardingBroker({ forward: { attachments: true } });
    broker.log("test").info("a line");
    broker.log("test").attachment({ file: "one.bin", bytes: BYTES() });
    await broker.flush();

    expect(sink.some(batch => batch.length === 1 && batch[0].message === "a line")).toBe(true);
    const shipped = sink.flat();
    expect(shipped.filter(r => r.attachmentBytes).length).toBe(1);
});

test("an attachment obeys the sensitive gates before its own @unit", () => {
    const noPayloads = new ClientLogging({ level: "trace" });
    expect(noPayloads.log("t").attachment({ file: "x.bin", bytes: BYTES() }), "no allowSensitive").toBe(null);

    const notTrace = new ClientLogging({ level: "debug", allowSensitive: true });
    expect(notTrace.log("t").attachment({ file: "x.bin", bytes: BYTES() }), "channel below trace").toBe(null);
});

test("a forward minLevel above trace does not silently swallow attachments @unit", async () => {
    // The regression this pins: an attachment always emits at `trace`, so a
    // deployment forwarding lines from `info` up used to drop every file before the
    // attachment branch was ever reached -- no `stored:false`, no reason, no bytes.
    // `forward.attachments` is an explicit opt-in; a level meant for log LINES must
    // not be able to override it, least of all without saying so.
    const { broker, sink } = forwardingBroker({ forward: { minLevel: "info", attachments: true } });
    broker.log("test").attachment({ file: "window-0001.webm", bytes: BYTES() });
    await broker.flushAttachments();

    expect(sink.length, "the file was shipped despite minLevel info").toBe(1);
    expect(sink[0][0].fields.attachment.file).toBe("window-0001.webm");
    expect(typeof sink[0][0].attachmentBytes).toBe("string");
    expect(broker.stats().counters.attachmentsForwarded).toBe(1);
});

test("a refused attachment still reports the refusal under a raised minLevel @unit", async () => {
    // The descriptor is the answer to "why is there no audio for this window", and
    // the level gate must not delete the question along with the answer.
    const { broker, sink } = forwardingBroker({ forward: { minLevel: "info" } });  // attachments off
    const record = broker.log("test").attachment({ file: "window-0001.webm", bytes: BYTES() });
    await broker.flushAttachments();

    expect(record.fields.attachment.stored).toBe(false);
    expect(record.fields.attachment.reason).toBe("not-forwarded");
    expect(sink.length, "nothing was sent").toBe(0);
});

test("the level bypass covers payloads, and is never a hole in the gates @unit", async () => {
    // `minLevel` gates ordinary LINES. Payload records carry their own opt-ins, so
    // applying the line level to them made `includeSensitive` unreachable above
    // trace. Two things this must NOT have become: a hole that forwards ordinary
    // trace lines, and a hole that ships patient audio out of a deployment that said
    // payloads stay in the browser.
    const { broker, sink } = forwardingBroker({ forward: { minLevel: "info", attachments: true } });
    broker.log("test").trace("a trace line");
    broker.log("test").sensitive({ text: "dictation" }, "content");
    await broker.flush();

    const shipped = sink.flat();
    expect(shipped.map(r => r.message), "the line stays gated, the payload goes").toEqual(["content"]);

    const refusing = forwardingBroker({
        forward: { minLevel: "info", attachments: true, includeSensitive: false },
    });
    refusing.broker.log("test").attachment({ file: "window-0001.webm", bytes: BYTES() });
    refusing.broker.log("test").sensitive({ text: "dictation" }, "content");
    await refusing.broker.flushAttachments();
    await refusing.broker.flush();
    expect(refusing.sink.length, "includeSensitive:false still refuses both").toBe(0);
});

// ---- the wire budget -----------------------------------------------------------

/**
 * These pin the failure that reached a real deployment: the forwarder batched by
 * RECORD COUNT only, a deployment raised `maxStringLength` so one record could be
 * hundreds of kB, and `ingestClientLogs` answered the resulting POST with a 413.
 * Because a failed batch is dropped and never retried, the richest records were
 * exactly the ones that never arrived — and the counter said "transport failure".
 */
function wireBroker(over = {}, transport) {
    const sent = [];
    const { forward, ...rest } = over;
    const broker = new ClientLogging({
        level: "trace",
        maxStringLength: 200_000,
        // These records are deliberately enormous; mirroring them into the runner's
        // console makes the output unreadable and says nothing about the budget.
        console: false,
        ...rest,
        forward: { enabled: true, minLevel: "trace", batchSize: 50, ...(forward || {}) },
    }, {
        transport: transport || (async (records) => { sent.push(records); }),
    });
    return { broker, sent };
}

/** A record whose fields are `chars` long — the shape a raw HTTP body takes. */
const fat = (broker, chars, channel = "test") =>
    broker.log(channel).info({ body: "x".repeat(chars) }, "http-body");

test("a batch is filled by bytes, not only by record count @unit", async () => {
    const { broker, sent } = wireBroker({ forward: { maxBatchBytes: 40_000, maxRecordBytes: 20_000 } });
    for (let i = 0; i < 6; i++) fat(broker, 15_000);
    await broker.flush();
    while (broker.stats().forward.queued) await broker.flush();

    expect(sent.length, "six large records cannot be one POST").toBeGreaterThan(1);
    for (const batch of sent) {
        expect(JSON.stringify(batch).length).toBeLessThanOrEqual(40_000 + 4_096);
    }
});

test("a record over the per-record cap is trimmed, not shipped to be refused @unit", async () => {
    // The server drops an over-cap record WHOLE, so sending it spends uplink and
    // yields nothing. Trimming keeps its identity and admits what was lost.
    const { broker, sent } = wireBroker({ forward: { maxRecordBytes: 4_000 } });
    fat(broker, 100_000);
    await broker.flush();

    const [record] = sent[0];
    expect(JSON.stringify(record).length).toBeLessThanOrEqual(4_000);
    expect(record.truncatedForForward.originalBytes, "and says it was cut").toBeGreaterThan(100_000);
    expect(record.channel, "identity survives").toBe("test");
    expect(broker.stats().counters.forwardTrimmed).toBe(1);
});

test("one over-cap record cannot stall the queue @unit", async () => {
    // The batch fill must always take at least one record: a record larger than the
    // whole batch budget would otherwise be skipped forever and block everything
    // behind it.
    const { broker, sent } = wireBroker({ forward: { maxBatchBytes: 2_000, maxRecordBytes: 8_000 } });
    fat(broker, 50_000);
    broker.log("test").info("after the big one");
    await broker.flush();
    while (broker.stats().forward.queued) await broker.flush();

    expect(sent.flat().length).toBe(2);
    expect(broker.stats().forward.queued).toBe(0);
});

test("a 413 is counted as a refusal and tightens the budget @unit", async () => {
    // Distinct from a transport failure: one is a budget we got wrong and can fix,
    // the other is the network. Reporting both as `forwardFailures` is what let this
    // run for a whole session looking like flaky connectivity.
    let thrown = 0;
    const { broker } = wireBroker({ forward: { maxBatchBytes: 100_000 } }, async () => {
        thrown++;
        const error = new Error("body over the 262144 byte limit");
        error.status = 413;
        throw error;
    });
    const before = broker.stats().forward.maxBatchBytes;
    fat(broker, 30_000);
    await broker.flush();

    expect(thrown).toBe(1);
    const counters = broker.stats().counters;
    expect(counters.forwardRefused).toBe(1);
    expect(counters.forwardFailures, "not counted as a transport error").toBe(0);
    expect(broker.stats().forward.maxBatchBytes, "the next batch is smaller").toBeLessThan(before);
});

test("an ordinary transport failure is still a failure, not a refusal @unit", () => {
    const { broker } = wireBroker({}, async () => { throw new Error("offline"); });
    broker.log("test").info("x");
    return broker.flush().then(() => {
        expect(broker.stats().counters.forwardFailures).toBe(1);
        expect(broker.stats().counters.forwardRefused).toBe(0);
    });
});

test("the client adopts the server's caps instead of guessing them @unit", async () => {
    // The two ends had independent numbers and the client's were the optimistic
    // ones. It tightens only — a larger cap from the server is not a licence to grow
    // mid-session.
    const { broker } = wireBroker({ forward: { batchSize: 50, maxRecordBytes: 100_000 } },
        async () => ({ accepted: 1, maxRecordsPerBatch: 10, maxRecordBytes: 16_384 }));
    broker.log("test").info("x");
    await broker.flush();

    expect(broker.stats().forward.batchSize).toBe(10);
    expect(broker.stats().forward.maxRecordBytes).toBe(16_384);

    const wider = wireBroker({ forward: { batchSize: 5, maxRecordBytes: 8_000 } },
        async () => ({ maxRecordsPerBatch: 500, maxRecordBytes: 999_999 })).broker;
    wider.log("test").info("x");
    await wider.flush();
    expect(wider.stats().forward.batchSize, "never widened").toBe(5);
    expect(wider.stats().forward.maxRecordBytes).toBe(8_000);
});

test("includeSensitive is reachable at any minLevel @unit", async () => {
    // `sensitive()` always emits at trace, so gating it on `minLevel` made the
    // opt-in unreachable at every setting above trace — including the default
    // `warn`. A remote deployment ran with `minLevel: "info"`, recorded dictation
    // in the browser and forwarded none of it, with nothing saying why.
    const sink = [];
    const broker = new ClientLogging({
        level: "trace", allowSensitive: true, console: false,
        forward: { enabled: true, minLevel: "info", includeSensitive: true },
    }, { transport: async (records) => { sink.push(records); } });

    broker.log("t").sensitive({ text: "left upper lobe" }, "TRANSCRIPT");
    broker.log("t").debug("an ordinary line below minLevel");
    await broker.flush();

    const shipped = sink.flat();
    expect(shipped.length, "the payload goes, the debug line does not").toBe(1);
    expect(shipped[0].sensitive).toBe(true);
    expect(shipped[0].message).toBe("TRANSCRIPT");
});

test("includeSensitive false still refuses payloads at any level @unit", async () => {
    // The level gate moving must not weaken the gate that actually decides.
    const sink = [];
    const broker = new ClientLogging({
        level: "trace", allowSensitive: true, console: false,
        forward: { enabled: true, minLevel: "trace", includeSensitive: false },
    }, { transport: async (records) => { sink.push(records); } });

    broker.log("t").sensitive({ text: "left upper lobe" }, "TRANSCRIPT");
    broker.log("t").info("an ordinary line");
    await broker.flush();

    const shipped = sink.flat();
    expect(shipped.map(r => r.message)).toEqual(["an ordinary line"]);
});

// ---- the attachment budget -----------------------------------------------------

/** A forwarding broker whose transport is under the test's control. */
function attachmentBroker(over = {}, transport) {
    const sent = [];
    const { forward, ...rest } = over;
    const broker = new ClientLogging({
        level: "trace",
        allowSensitive: true,
        console: false,
        ...rest,
        forward: {
            enabled: true, minLevel: "trace", includeSensitive: true, attachments: true,
            ...(forward || {}),
        },
    }, { transport: transport || (async (records) => { sent.push(records); }) });
    return { broker, sent };
}

test("a 413 on an attachment tightens the cap instead of re-uploading forever @unit", async () => {
    // The hole this closes: `_adoptServerLimits` only runs on SUCCESS, and a body
    // the reader refuses never reaches the handler that answers
    // `attachments.accepted`. A deployment whose body limit sits under the client's
    // attachment cap therefore re-encoded and re-uploaded every sealed dictation
    // window for the whole session — raw patient audio on the wire, repeatedly, for
    // guaranteed nothing.
    let attempts = 0;
    const { broker } = attachmentBroker({ forward: { maxAttachmentBytes: 1 << 20 } }, async () => {
        attempts++;
        const error = new Error("body over the 262144 byte limit");
        error.status = 413;
        throw error;
    });
    const first = broker.log("test").attachment({ file: "window-0001.webm", bytes: new Uint8Array(4096) });
    const second = broker.log("test").attachment({ file: "window-0002.webm", bytes: new Uint8Array(4096) });
    await broker.flushAttachments();

    expect(attempts, "the sibling is refused locally, not uploaded to be refused").toBe(1);
    expect(broker.stats().forward.maxAttachmentBytes).toBeLessThan(1 << 20);
    expect(broker.stats().counters.forwardRefused, "a refusal, not flaky connectivity").toBe(1);
    expect(broker.stats().counters.forwardFailures).toBe(0);
    expect(first.fields.attachment.reason).toBe("too-large");
    expect(second.fields.attachment.reason, "and the queue says so on its own line").toBe("too-large");
    expect(broker.stats().forward.attachmentsQueued).toBe(0);

    // The next window is now refused before it is even encoded.
    const third = broker.log("test").attachment({ file: "window-0003.webm", bytes: new Uint8Array(4096) });
    await broker.flushAttachments();
    expect(attempts).toBe(1);
    expect(third.fields.attachment.reason).toBe("too-large");
});

test("delivered is not kept: the per-record verdict decides, not the transport @unit", async () => {
    // The request succeeds while the file is thrown away — attachments off, or the
    // line dropped over `maxRecordBytes`. Counting `attachmentsForwarded` on the
    // transport alone is what made a lost recording invisible at both ends.
    const refused = attachmentBroker({}, async () => ({
        accepted: 1, attachments: { stored: 0, refused: 1, accepted: false },
    }));
    const a = refused.broker.log("test").attachment({ file: "w1.webm", bytes: BYTES() });
    await refused.broker.flushAttachments();
    expect(refused.broker.stats().counters.attachmentsForwarded).toBe(0);
    expect(refused.broker.stats().counters.attachmentsDropped).toBe(1);
    expect(a.fields.attachment.reason).toBe("refused");

    const oversized = attachmentBroker({}, async () => ({
        accepted: 0, oversized: 1, attachments: { stored: 0, refused: 1, accepted: true },
    }));
    const b = oversized.broker.log("test").attachment({ file: "w2.webm", bytes: BYTES() });
    await oversized.broker.flushAttachments();
    expect(b.fields.attachment.reason, "and which of the two it was").toBe("record-oversized");

    const kept = attachmentBroker({}, async () => ({
        accepted: 1, attachments: { stored: 1, refused: 0, accepted: true },
    }));
    kept.broker.log("test").attachment({ file: "w3.webm", bytes: BYTES() });
    await kept.broker.flushAttachments();
    expect(kept.broker.stats().counters.attachmentsForwarded).toBe(1);
    expect(kept.broker.stats().counters.attachmentsDropped).toBe(0);
});

test("an attachment's own LINE obeys maxRecordBytes, and keeps its pointer @unit", async () => {
    // The bytes are exempt from the line cap; the descriptor around them is not.
    // This path used to skip `_fitRecord` entirely, so a window record carrying
    // per-segment metadata shipped over the cap and the server dropped it WHOLE
    // after accepting the payload — the file went nowhere and the line that pointed
    // at it was gone too.
    const { broker, sent } = attachmentBroker({ forward: { maxRecordBytes: 2_000 } });
    broker.log("test").attachment({
        file: "mixture/sess-1/audio/window-0001.webm",
        bytes: BYTES(),
        mediaType: "audio/webm",
        segments: "s".repeat(50_000),
    });
    await broker.flushAttachments();

    expect(sent.length).toBe(1);
    const line = { ...sent[0][0] };
    delete line.attachmentBytes;              // the file is not bound by the line cap
    expect(JSON.stringify(line).length).toBeLessThanOrEqual(2_000);
    expect(line.fields.attachment.file, "the pointer survives the trim verbatim")
        .toBe("mixture/sess-1/audio/window-0001.webm");
    expect(line.fields.attachment.size).toBe(8);
    expect(line.fields.attachment.mediaType).toBe("audio/webm");
    expect(
        JSON.stringify(line).includes("s".repeat(5_000)),
        "the metadata around the pointer is trimmed, or dropped, to make room",
    ).toBe(false);
    expect(
        JSON.stringify(sent[0][0]).includes("_ringAttachment"),
        "the ring back-reference is non-enumerable, so it never goes on the wire",
    ).toBe(false);
    expect(
        sent[0][0]._ringAttachment?.segments?.length,
        "...and the ring still holds the untrimmed descriptor the crash export reads",
    ).toBeGreaterThan(2_000);
});
