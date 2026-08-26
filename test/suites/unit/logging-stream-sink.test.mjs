/**
 * The sink that takes records OFF the box.
 *
 * Everything a log record could reach before this — stdout, the in-process ring,
 * a file under the storage root — needs someone already on the machine to read
 * it. `sinks.stream` is the destination knob, and its whole value depends on
 * three properties that are easy to write and easy to lose:
 *
 *   1. it never applies backpressure (a hung collector must not stall a request),
 *   2. it never loses records silently (drops are counted and reported), and
 *   3. a `sensitive` payload record does not leave the deployment unless an
 *      operator said so explicitly — on real data that is PHI crossing a network.
 *
 * Every test here is one of those three.
 */
import { test, expect } from "@xopat/test-harness";

const logging = await import("../../../server/node/logging.js");
const { LogStreamDestination, normalizeStreamConfigs, createLogging, LEVELS } = logging.default ?? logging;

/** A destination with injected transports — no sockets, no filesystem. */
function makeDestination(overrides = {}, deps = {}) {
    const [config] = normalizeStreamConfigs({ url: "https://collector.test/in", ...overrides });
    const sent = [];
    const destination = new LogStreamDestination(config, {
        http: (url, body) => { sent.push({ url, body }); return Promise.resolve(200); },
        ...deps,
    });
    return { destination, sent, config };
}

const record = (over = {}) => ({
    ts: "2026-08-25T10:00:00.000Z", level: "info", channel: "test", message: "m", pid: 1, ...over,
});

// ---- config ------------------------------------------------------------------

test("a destination naming neither a url nor a file is dropped @unit", () => {
    // It would otherwise queue records forever against nothing, which looks
    // exactly like a working stream until someone goes looking for the records.
    expect(normalizeStreamConfigs({ minLevel: "info" })).toEqual([]);
    expect(normalizeStreamConfigs(null)).toEqual([]);
});

test("one object or an array — shipping to a collector AND a file is the normal shape @unit", () => {
    const list = normalizeStreamConfigs([
        { url: "https://collector.test/in" },
        { file: "/var/log/xopat.ndjson" },
    ]);
    expect(list.length).toBe(2);
    expect(list[0].url).toBe("https://collector.test/in");
    expect(list[1].file).toBe("/var/log/xopat.ndjson");
});

test("includeSensitive is false unless it is literally true @unit", () => {
    // The gate that decides whether patient-bearing payloads leave the box must
    // not be reachable by a truthy value someone passed by accident.
    for (const value of [undefined, null, false, 0, "", "true", 1]) {
        expect(normalizeStreamConfigs({ url: "https://c.test", includeSensitive: value })[0].includeSensitive).toBe(false);
    }
    expect(normalizeStreamConfigs({ url: "https://c.test", includeSensitive: true })[0].includeSensitive).toBe(true);
});

// ---- what leaves ---------------------------------------------------------------

test("a record below minLevel never enters the queue @unit", () => {
    const { destination } = makeDestination({ minLevel: "warn" });
    destination.write(record({ level: "info" }));
    expect(destination.queue.length).toBe(0);
    destination.write(record({ level: "error" }));
    expect(destination.queue.length).toBe(1);
});

test("a sensitive record stays home unless the destination opted in @unit", () => {
    const closed = makeDestination({ minLevel: "trace" });
    closed.destination.write(record({ level: "trace", sensitive: true }));
    expect(closed.destination.queue.length, "PHI does not leave by default").toBe(0);

    const open = makeDestination({ minLevel: "trace", includeSensitive: true });
    open.destination.write(record({ level: "trace", sensitive: true }));
    expect(open.destination.queue.length).toBe(1);
});

// ---- batching ------------------------------------------------------------------

test("a full batch flushes as NDJSON, one record per line @unit", async () => {
    const { destination, sent } = makeDestination({ batchSize: 3 });
    destination.write(record({ message: "one" }));
    destination.write(record({ message: "two" }));
    expect(sent.length, "nothing goes out before the batch is full").toBe(0);

    destination.write(record({ message: "three" }));
    await destination.flush();

    expect(sent.length).toBe(1);
    const lines = sent[0].body.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).message).toBe("one");
    expect(JSON.parse(lines[2]).message).toBe("three");
    expect(destination.stats.sent).toBe(3);
});

test("write() returns immediately — a hung collector costs a queue, not a stalled caller @unit", () => {
    // The transport never settles. `write` must still be synchronous and cheap;
    // this is the property the whole design exists for.
    const { destination } = makeDestination({ batchSize: 1 }, { http: () => new Promise(() => {}) });
    const started = Date.now();
    for (let i = 0; i < 100; i++) destination.write(record());
    expect(Date.now() - started).toBeLessThan(200);
});

test("an over-full queue drops the OLDEST and counts it @unit", () => {
    // Dropping is not optional under a bound; dropping SILENTLY is the bug. When
    // a destination is behind, the recent records describe why it is behind.
    const { destination } = makeDestination({ batchSize: 1000, queueLimit: 10 },
        { http: () => new Promise(() => {}) });
    for (let i = 0; i < 15; i++) destination.write(record({ message: `m${i}` }));

    expect(destination.queue.length).toBe(10);
    expect(destination.stats.dropped).toBe(5);
    expect(destination.queue[0].message, "the oldest went, not the newest").toBe("m5");
});

test("a failing destination counts failures instead of throwing @unit", async () => {
    const { destination } = makeDestination({ batchSize: 1 },
        { http: () => Promise.reject(new Error("collector answered 503")) });
    destination.write(record());
    await destination.pending;

    expect(destination.stats.failures).toBe(1);
    expect(destination.stats.dropped, "a batch that could not be delivered is lost, and said so").toBe(1);
    expect(destination.stats.lastError).toContain("503");
    expect(destination.stats.sent).toBe(0);
});

test("an unserializable record does not take its batch down @unit", async () => {
    const { destination, sent } = makeDestination({ batchSize: 2 });
    const cyclic = record({ message: "cyclic" });
    cyclic.fields = {};
    cyclic.fields.self = cyclic.fields;

    destination.write(cyclic);
    destination.write(record({ message: "fine" }));
    await destination.flush();

    const lines = sent[0].body.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).message).toContain("unserializable");
    expect(JSON.parse(lines[1]).message, "the healthy record still went out").toBe("fine");
});

// ---- the channel filter ---------------------------------------------------------

test("no filter means every channel, as it always did @unit", () => {
    const { destination } = makeDestination();
    destination.write(record({ channel: "anything:at:all" }));
    expect(destination.queue.length).toBe(1);
});

test("a filtered destination takes its channel and everything under it @unit", () => {
    // This is what makes a purpose-built file possible: the chat transcript in
    // one file, the rest of the server in another.
    const { destination } = makeDestination({ channels: ["module.vercel-ai-chat-sdk:transcript"] });

    destination.write(record({ channel: "module.vercel-ai-chat-sdk:transcript" }));
    destination.write(record({ channel: "module.vercel-ai-chat-sdk:transcript:sub" }));
    expect(destination.queue.length).toBe(2);

    destination.write(record({ channel: "module.vercel-ai-chat-sdk:llm" }));
    destination.write(record({ channel: "core" }));
    expect(destination.queue.length, "a sibling channel is not 'under' it").toBe(2);
});

test("the filter matches on whole segments, not on string prefixes @unit", () => {
    // `module.chat` must not swallow `module.chatter`.
    const { destination } = makeDestination({ channels: ["module.chat"] });
    destination.write(record({ channel: "module.chatter" }));
    expect(destination.queue.length).toBe(0);
    destination.write(record({ channel: "module.chat:llm" }));
    expect(destination.queue.length).toBe(1);
});

// ---- attachments ----------------------------------------------------------------

/** A destination with an injected attachment writer. */
function withAttachments(overrides = {}) {
    const [config] = normalizeStreamConfigs({
        file: "/var/log/chat-transcript.ndjson", rotate: "none", batchSize: 1,
        minLevel: "trace", includeSensitive: true, attachments: true, ...overrides,
    });
    const written = [];
    const lines = [];
    const destination = new LogStreamDestination(config, {
        // The line as it actually reaches disk — a stronger assertion than the
        // queued object, and the only one available at batchSize 1.
        file: (_path, body) => {
            for (const line of body.trim().split("\n")) lines.push(JSON.parse(line));
            return Promise.resolve();
        },
        attachment: (dir, relative, bytes) => { written.push({ dir, relative, bytes }); return Promise.resolve(); },
    });
    return { destination, written, lines };
}

const attachmentRecord = (file = "sess_1/att_1.png") => ({
    record: record({ level: "trace", sensitive: true, fields: { attachment: { file, size: 4 } } }),
    payload: { file, bytes: Buffer.from("abcd") },
});

test("bytes become a file beside the transcript, never a line @unit", async () => {
    const { destination, written } = withAttachments();
    const { record: line, payload } = attachmentRecord();

    destination.write(line, payload);
    await destination.flush();

    expect(written.length).toBe(1);
    expect(written[0].dir, "sidecar dir derived from the transcript's own name")
        .toBe("/var/log/chat-transcript.files");
    expect(written[0].relative).toBe("sess_1/att_1.png");
    expect(destination.stats.attachmentsStored).toBe(1);
});

test("the line records that it was stored, and never carries the bytes @unit", async () => {
    const { destination, lines } = withAttachments();
    const { record: line, payload } = attachmentRecord();
    destination.write(line, payload);
    await destination.flush();

    expect(lines[0].fields.attachment.stored).toBe(true);
    expect(JSON.stringify(lines[0]), "the payload is on disk, not in the line").not.toContain("abcd");
});

test("one destination's verdict is not written onto another's copy @unit", async () => {
    // The same record object reaches every destination and sits in the ring.
    // "stored" is a fact about ONE destination.
    const keeps = withAttachments();
    const refuses = withAttachments({ attachments: false });
    const { record: line, payload } = attachmentRecord();

    keeps.destination.write(line, payload);
    refuses.destination.write(line, payload);
    await Promise.all([keeps.destination.flush(), refuses.destination.flush()]);

    expect(keeps.lines[0].fields.attachment.stored).toBe(true);
    expect(refuses.lines[0].fields.attachment.stored).toBe(false);
    expect(line.fields.attachment.stored, "the original is untouched").toBeUndefined();
});

test("a destination that opted out refuses them, and says so @unit", async () => {
    const { destination, written, lines } = withAttachments({ attachments: false });
    const { record: line, payload } = attachmentRecord();
    destination.write(line, payload);
    await destination.flush();

    expect(written.length).toBe(0);
    expect(destination.stats.attachmentsRefused).toBe(1);
    // The record still goes out — a transcript that quietly lost its images is
    // worse than one that says it did.
    expect(lines[0].fields.attachment.reason).toBe("destination-opted-out");
});

test("an http destination always refuses — it has no sidecar @unit", () => {
    const [config] = normalizeStreamConfigs({
        url: "https://collector.test/in", minLevel: "trace", includeSensitive: true, attachments: true, batchSize: 100,
    });
    const destination = new LogStreamDestination(config, { http: () => Promise.resolve(200) });
    const { record: line, payload } = attachmentRecord();

    destination.write(line, payload);

    expect(destination.stats.attachmentsRefused).toBe(1);
    expect(destination.queue[0].fields.attachment.reason).toBe("no-file-destination");
});

test("an over-cap attachment is skipped and the line says why @unit", async () => {
    const { destination, written, lines } = withAttachments({ maxAttachmentBytes: 1024 });
    const line = record({ level: "trace", sensitive: true, fields: { attachment: { file: "s/a.bin", size: 4096 } } });
    destination.write(line, { file: "s/a.bin", bytes: Buffer.alloc(4096) });
    await destination.flush();

    expect(written.length).toBe(0);
    expect(destination.stats.attachmentsSkipped).toBe(1);
    expect(lines[0].fields.attachment.reason).toBe("too-large");
});

test("a traversing path never escapes the sidecar directory @unit", () => {
    // The ids that build these paths are server-generated today. That is exactly
    // the argument that stops being true the first time one is not.
    const { destination, written } = withAttachments();
    for (const bad of ["../../etc/passwd", "/etc/passwd", "C:/windows/system32/x.dll", "..", ""]) {
        const { record: line, payload } = attachmentRecord(bad);
        destination.write(line, payload);
    }
    expect(written.length).toBe(0);
    expect(destination.stats.attachmentsRefused).toBe(5);
});

test("a nested path is kept, sanitized @unit", async () => {
    const { destination, written } = withAttachments();
    const { record: line, payload } = attachmentRecord("sess 1/att:1.png");
    destination.write(line, payload);
    await destination.flush();

    expect(written[0].relative, "unsafe characters become underscores, structure survives")
        .toBe("sess_1/att_1.png");
});

// ---- the file target -----------------------------------------------------------

test("daily rotation puts the date before the extension @unit", () => {
    const [config] = normalizeStreamConfigs({ file: "/var/log/xopat/app.ndjson" });
    const destination = new LogStreamDestination(config, { file: async () => {} });
    expect(destination.filePath()).toMatch(/^\/var\/log\/xopat\/app\.\d{4}-\d{2}-\d{2}\.ndjson$/);
});

test("rotate:none writes the path it was given @unit", () => {
    const [config] = normalizeStreamConfigs({ file: "/var/log/xopat/app.ndjson", rotate: "none" });
    expect(new LogStreamDestination(config, {}).filePath()).toBe("/var/log/xopat/app.ndjson");
});

test("perProcess suffixes the pid — the cluster answer for big payload dumps @unit", () => {
    // Several workers appending large `sensitive` records to one file cannot
    // promise a record stays on one line; a file per process can.
    const [config] = normalizeStreamConfigs({ file: "/var/log/app.ndjson", rotate: "none", perProcess: true });
    expect(new LogStreamDestination(config, {}).filePath()).toBe(`/var/log/app.${process.pid}.ndjson`);
});

test("a file batch is ONE append, so records never interleave mid-line @unit", async () => {
    const writes = [];
    const [config] = normalizeStreamConfigs({ file: "/tmp/x.ndjson", batchSize: 3 });
    const destination = new LogStreamDestination(config, { file: (path, body) => { writes.push(body); return Promise.resolve(); } });
    destination.write(record({ message: "a" }));
    destination.write(record({ message: "b" }));
    destination.write(record({ message: "c" }));
    await destination.flush();

    expect(writes.length).toBe(1);
    expect(writes[0].trim().split("\n").length).toBe(3);
});

// ---- wiring into the broker -----------------------------------------------------

test("the broker routes emitted records into every configured destination @unit", async () => {
    const sent = [];
    let config = {
        level: "trace",
        sinks: { console: false, buffer: 50, stream: { url: "https://collector.test/in", minLevel: "debug", batchSize: 2 } },
    };
    const broker = createLogging({
        getConfig: () => config,
        devMode: true,
        baseConsole: { warn() {}, error() {}, log() {}, debug() {}, info() {} },
        streamTransports: { http: (url, body) => { sent.push(body); return Promise.resolve(200); } },
    });

    const log = broker.log("module.test");
    log.trace("too quiet for the stream");
    log.info("first");
    log.info("second");
    await broker.flushStreams();

    expect(sent.length).toBe(1);
    expect(sent[0].trim().split("\n").length, "the trace record was filtered by minLevel").toBe(2);

    const stats = broker.stats().sinks.stream;
    expect(stats.length).toBe(1);
    expect(stats[0].sent).toBe(2);
    expect(stats[0].url).toBe("https://collector.test/in");
});

test("a config reload keeps an unchanged destination instead of restarting it @unit", async () => {
    // A reload that touched an unrelated block must not tear down a working
    // stream and lose what it had queued.
    let config = {
        level: "info",
        sinks: { console: false, buffer: 10, stream: { url: "https://collector.test/in", batchSize: 100 } },
    };
    const broker = createLogging({
        getConfig: () => config,
        devMode: true,
        baseConsole: { warn() {}, error() {}, log() {}, debug() {}, info() {} },
        streamTransports: { http: () => Promise.resolve(200) },
    });
    broker.log("test").info("queued");
    expect(broker.stats().sinks.stream[0].queued).toBe(1);

    // Same stream block, different object identity + an unrelated change.
    config = {
        level: "info",
        channels: { other: "debug" },
        sinks: { console: false, buffer: 10, stream: { url: "https://collector.test/in", batchSize: 100 } },
    };
    broker.log("test").info("still queued");
    expect(broker.stats().sinks.stream[0].queued, "the queued record survived the reload").toBe(2);
});

test("removing a destination from config flushes what it still held @unit", async () => {
    const sent = [];
    let config = {
        level: "info",
        sinks: { console: false, buffer: 10, stream: { url: "https://collector.test/in", batchSize: 100 } },
    };
    const broker = createLogging({
        getConfig: () => config,
        devMode: true,
        baseConsole: { warn() {}, error() {}, log() {}, debug() {}, info() {} },
        streamTransports: { http: (url, body) => { sent.push(body); return Promise.resolve(200); } },
    });
    broker.log("test").info("in flight when the config changed");

    config = { level: "info", sinks: { console: false, buffer: 10 } };
    broker.log("test").info("after");           // triggers resolveConfig -> sync
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(sent.length, "the closed destination pushed its queue rather than dropping it").toBe(1);
    expect(broker.stats().sinks.stream).toBe(false);
});
