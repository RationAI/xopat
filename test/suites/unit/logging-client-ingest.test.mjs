/**
 * `server/core/ingestClientLogs` — the one INBOUND path into the server's logs.
 *
 * Everything else in the logging broker is the server describing itself. This
 * accepts records a BROWSER produced, which changes the threat model completely:
 * the payload is attacker-controlled, so it can lie about who it is, flood the
 * disk, or try to smuggle a payload record past the operator's gate.
 *
 * The rules under test are the ones that make accepting it safe at all:
 * off unless an operator turned it on, identity re-stamped from the verified
 * context, and the same `sensitive` gate applied where a client cannot reach it.
 */
import { test, expect } from "@xopat/test-harness";

const logging = await import("../../../server/node/logging.js");
const { createLogging } = logging.default ?? logging;

const QUIET = { warn() {}, error() {}, log() {}, debug() {}, info() {} };

function makeBroker(config) {
    return createLogging({ getConfig: () => config, devMode: false, baseConsole: QUIET });
}

const base = (over = {}) => ({
    level: "trace",
    allowSensitive: false,
    sinks: { console: false, buffer: 100 },
    client: { ingest: true },
    ...over,
});

test("ingest is refused until an operator turns it on @unit", () => {
    // Doing nothing must leave the write path closed: a deployment that never
    // configured client ingest should not accept writes into its logs.
    const broker = makeBroker(base({ client: {} }));
    expect(broker.clientIngestPolicy().ingest).toBe(false);
    expect(broker.ingestClientRecord({ channel: "app", level: "warn", message: "hi" })).toBe(null);
    expect(broker.getEntries().entries.length).toBe(0);
});

test("an accepted record is filed under a client: channel @unit", () => {
    // The prefix is not decoration: it is what keeps "the browser says so" from
    // being indistinguishable from the server's own record on the same channel.
    const broker = makeBroker(base());
    broker.ingestClientRecord({ channel: "module.chat", level: "warn", message: "ui broke" });

    const [entry] = broker.getEntries().entries;
    expect(entry.channel).toBe("client:module.chat");
    expect(entry.message).toBe("ui broke");
    expect(entry.source, "and it is marked as coming from a client").toBe("client");
});

test("the client's channel level still applies — it cannot force its way in @unit", () => {
    // Ingest is not a bypass of the level config. A client spraying trace records
    // at a channel configured to `warn` is dropped like anything else.
    const broker = makeBroker(base({ level: "warn", channels: { "client:noisy": "error" } }));
    expect(broker.ingestClientRecord({ channel: "noisy", level: "warn", message: "below" })).toBe(null);
    expect(broker.ingestClientRecord({ channel: "noisy", level: "error", message: "kept" })).not.toBe(null);
    expect(broker.getEntries().entries.length).toBe(1);
});

test("a client-declared sensitive record needs the server's allowSensitive @unit", () => {
    // The gate lives where the client cannot reach it. Otherwise `sensitive:true`
    // in a request body is a switch for logging patient payloads.
    const closed = makeBroker(base());
    expect(closed.ingestClientRecord({ channel: "chat", level: "trace", message: "PROMPT", sensitive: true })).toBe(null);

    const open = makeBroker(base({ allowSensitive: true }));
    const entry = open.ingestClientRecord({ channel: "chat", level: "trace", message: "PROMPT", sensitive: true });
    expect(entry.sensitive).toBe(true);
});

test("fields are redacted by the same formatter as any other record @unit", () => {
    // The client is not asked to scrub anything, and is not trusted to have.
    const broker = makeBroker(base());
    broker.ingestClientRecord({
        channel: "chat", level: "warn", message: "auth failed",
        fields: { api_key: "sk-live-123", note: "fine" },
    });

    const [entry] = broker.getEntries().entries;
    expect(entry.fields.api_key).toBe("[redacted]");
    expect(entry.fields.note).toBe("fine");
});

test("identity comes from the caller's context, never from the record @unit", () => {
    // The most important line in the whole path: a body that names a principal
    // must not be believed, or one caller can forge another's records.
    const broker = makeBroker(base());
    broker.ingestClientRecord(
        { channel: "app", level: "warn", message: "x", principal: "p_someone_else", pid: 999, source: "server" },
        { principal: "p_verified", requestId: "req-1" },
    );

    const [entry] = broker.getEntries().entries;
    expect(entry.principal).toBe("p_verified");
    expect(entry.requestId).toBe("req-1");
    expect(entry.source).toBe("client");
    expect(entry.pid, "the receiving worker's pid, not a claimed one").toBe(process.pid);
});

test("the sitting id rides along as a field the server wrote @unit", () => {
    // It is a correlation token, not identity — but it still arrives from the
    // browser, so it is written by the server onto the record rather than being
    // taken from the record body.
    const broker = makeBroker(base());
    const entry = broker.ingestClientRecord(
        { channel: "session", level: "info", message: "session started", clientSession: "cs_forged" },
        { principal: "p_verified", clientSession: "cs_real" },
    );
    expect(entry.clientSession).toBe("cs_real");
});

test("a malformed level degrades to info rather than being trusted @unit", () => {
    const broker = makeBroker(base({ level: "trace" }));
    const entry = broker.ingestClientRecord({ channel: "app", level: "URGENT!!", message: "x" });
    expect(entry.level).toBe("info");
});

test("the caps are policy, readable by the RPC handler @unit", () => {
    // The handler enforces them; they live with the rest of the config so an
    // operator can see and change them in one place.
    const broker = makeBroker(base({
        client: { ingest: true, maxRecordsPerBatch: 10, maxRecordBytes: 1024, maxRecordsPerMinute: 100 },
    }));
    expect(broker.clientIngestPolicy()).toEqual({
        ingest: true, maxRecordsPerBatch: 10, maxRecordBytes: 1024, maxRecordsPerMinute: 100,
    });
});

test("a client record reaches the stream sink like any other @unit", async () => {
    // The point of ingest: what the browser saw ends up in the same destination
    // as what the server saw, instead of dying in the tab.
    const sent = [];
    const broker = createLogging({
        getConfig: () => base({
            sinks: { console: false, buffer: 10, stream: { url: "https://collector.test/in", minLevel: "trace", batchSize: 1 } },
        }),
        devMode: false,
        baseConsole: QUIET,
        streamTransports: { http: (url, body) => { sent.push(body); return Promise.resolve(200); } },
    });

    broker.ingestClientRecord({ channel: "app", level: "error", message: "client-side crash" }, { principal: "p_1" });
    await broker.flushStreams();

    expect(sent.length).toBe(1);
    const record = JSON.parse(sent[0].trim());
    expect(record.channel).toBe("client:app");
    expect(record.message).toBe("client-side crash");
});
