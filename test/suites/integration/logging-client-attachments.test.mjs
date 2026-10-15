/**
 * Bytes the BROWSER sends with a log record — a dictation recording, a session
 * snapshot, a screenshot.
 *
 * `ingestClientLogs` is the only inbound path into the server's logs, and this is
 * the part of it that accepts files rather than text. The caps that make text
 * safe do not transfer: `maxRecordBytes` bounds a log LINE, and an attachment is
 * three orders of magnitude larger, so the bytes are separated before the record
 * is measured and judged against a cap and an opt-in of their own.
 *
 * Everything asserted here lives in `#ingestClientLogs` and `#clientLogBodyLimit`
 * (`server/node/server-runtime.js`), which are private — so this drives the real
 * RPC against a real server rather than reaching into them. What it pins:
 *
 *   - accepting files is a SECOND opt-in beyond accepting lines;
 *   - a refused attachment never deletes the record that describes it, because a
 *     descriptor saying `stored: false` is the answer to "why is there no
 *     recording here", and a silent drop removes the question too;
 *   - the separation did not quietly widen the line cap;
 *   - the body limit follows the operator's cap, so an oversized upload is a 413
 *     naming the limit instead of a Bad Gateway.
 */
import { test, expect } from "@xopat/test-harness";
import { mkdtempSync } from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHANNEL = "plugin.mixture-report-assist:trace";
const AUDIO = "mixture/sess-1/audio/window-0001.webm";
/** Recognisable bytes: enough to prove the file is the one that was sent. */
const BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);

/** One attachment-bearing client record, shaped exactly as the browser sends it. */
function audioRecord(over = {}) {
    return {
        id: 1,
        ts: new Date().toISOString(),
        level: "trace",
        channel: CHANNEL,
        sensitive: true,
        message: "MIXTURE_DICTATION_AUDIO",
        fields: { attachment: { file: AUDIO, size: BYTES.length, mediaType: "audio/webm" } },
        attachmentBytes: BYTES.toString("base64"),
        ...over,
    };
}

/**
 * Point the server's logging at a scratch NDJSON file and apply it.
 *
 * No restart: `setLoggingConfig` is re-published on every core build, so one page
 * request is enough — and a restart per assertion would make this suite cost
 * minutes to say very little.
 */
async function withLogging(xopatServer, logging, body) {
    const dir = mkdtempSync(path.join(tmpdir(), "xopat-logsink-"));
    const file = path.join(dir, "client.ndjson");
    const original = xopatServer.scratch.read();
    await xopatServer.setEnv({
        core: {
            server: {
                logging: {
                    level: "info",
                    channels: { client: "trace" },
                    allowSensitive: true,
                    sinks: {
                        buffer: 200,
                        stream: [{
                            file,
                            channels: ["client"],
                            minLevel: "trace",
                            includeSensitive: true,
                            rotate: "none",
                            batchSize: 1,
                            ...(logging.stream || {}),
                        }],
                    },
                    client: { ingest: true, ...(logging.client || {}) },
                },
            },
        },
    });
    // Force a core build so the edit is published to the broker.
    await fetch(`${xopatServer.baseURL}/`, { redirect: "manual" });
    try {
        await body({ file, dir });
    } finally {
        await xopatServer.replaceEnv(original);
        await fetch(`${xopatServer.baseURL}/`, { redirect: "manual" }).catch(() => {});
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

/** Both writes are fire-and-forget by design, so reads poll rather than assume. */
async function eventually(read, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
        try {
            last = await read();
            if (last !== undefined && last !== null) return last;
        } catch (e) { last = undefined; }
        if (Date.now() >= deadline) return last;
        await new Promise(r => setTimeout(r, 100));
    }
}

// A successful RPC answers `{ok: true, result}` (`#writeJson` in
// server-runtime.js), so every assertion below reads `res.body.result`. An
// ERROR payload is top-level — hence `res.body.code` in the 413 case.

/** The NDJSON lines written so far, parsed. */
async function lines(file) {
    const text = await fsp.readFile(file, "utf8");
    return text.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

/** Every file under `dir`, as posix-style paths relative to it. */
async function filesUnder(dir, prefix = "", acc = []) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
    for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await filesUnder(path.join(dir, entry.name), rel, acc);
        else acc.push(rel);
    }
    return acc;
}

/** The first line carrying an attachment descriptor. */
async function attachmentLine(file) {
    const found = await eventually(async () => {
        const parsed = await lines(file);
        return parsed.find(line => line.fields?.attachment) ?? undefined;
    });
    return found;
}

test("accepting client attachments is a second opt-in beyond accepting records", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // Turning on `ingest` accepts TEXT the caps already bound. Accepting files is
    // accepting whatever a caller decides to upload, so it must not ride along.
    await withLogging(xopatServer, { stream: { attachments: true } }, async ({ file }) => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord()], sessionId: "cs_testsession01",
        });

        expect(res.status).toBe(200);
        expect(res.body.result.attachments.accepted, "off unless asked for separately").toBe(false);
        expect(res.body.result.attachments.stored).toBe(0);
        expect(res.body.result.attachments.refused).toBe(1);
        expect(res.body.result.accepted, "the record itself still lands").toBe(1);

        const line = await attachmentLine(file);
        expect(line, "a refusal does not delete the record").toBeTruthy();
        expect(line.fields.attachment.stored).toBe(false);
        expect(line.fields.attachment.reason).toBe("not-accepted");
        expect(line.fields.attachment.file, "and it still names what was not kept").toBe(AUDIO);
    });
});

test("an accepted attachment becomes a real file beside the transcript", {
    tag: ["@integration"],
}, async ({ xopatServer }) => {
    await withLogging(xopatServer, {
        client: { attachments: true },
        stream: { attachments: true },
    }, async ({ file }) => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord()], sessionId: "cs_testsession01",
        });

        expect(res.status).toBe(200);
        expect(res.body.result.attachments.stored).toBe(1);
        expect(res.body.result.attachments.refused).toBe(0);

        // `…/client.ndjson` → `…/client.files/<principal>/<session>/<name>`.
        //
        // THE SERVER OWNS THE PATH, and that is the assertion — not a convenience.
        // The sidecar directory is shared by every caller and the transport writes
        // with `wx`, treating EEXIST as success, so a client-chosen path is a
        // cross-caller write primitive: post `mixture/sess-1/audio/window-0001.webm`
        // first and the real owner's window is silently never written while its line
        // still reads `stored: true`. Names like that are predictable, so it needs
        // no guessing. Hence the prefix, and hence the client's name surviving as
        // the leaf only.
        const sidecarDir = file.replace(/\.ndjson$/, ".files");
        const stored = await eventually(async () => {
            const found = await filesUnder(sidecarDir);
            return found.length ? found : undefined;
        });
        expect(stored, `expected a file under ${sidecarDir}`).toHaveLength(1);

        const [relative] = stored;
        const segments = relative.split("/");
        expect(segments, "principal / session / name").toHaveLength(3);
        expect(segments[0], "the hashed principal, never the raw identity")
            .toMatch(/^(p_[0-9a-f]{12}|anonymous)$/);
        expect(segments[1], "the session token the batch declared").toBe("cs_testsession01");
        expect(segments[2], "the client's name, flattened to one segment")
            .toBe(AUDIO.replaceAll("/", "_"));
        expect(relative, "the client does not choose where its bytes land").not.toBe(AUDIO);

        const written = await eventually(() => fsp.readFile(path.join(sidecarDir, ...segments)));
        expect(Buffer.isBuffer(written), `expected ${relative} to exist`).toBe(true);
        expect(written.equals(BYTES), "the bytes survive base64 and the sidecar write").toBe(true);

        const line = await attachmentLine(file);
        expect(line.fields.attachment.file, "the line still names what the client called it")
            .toBe(AUDIO);
        expect(line.fields.attachment.stored, "and is not marked as refused").not.toBe(false);
        expect(line.sensitive, "an attachment is user content").toBe(true);
        expect(line.channel).toBe(`client:${CHANNEL}`);
    });
});

test("an over-cap attachment is refused by size, and the line survives", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    await withLogging(xopatServer, {
        client: { attachments: true, maxAttachmentBytes: 1024 },
        stream: { attachments: true },
    }, async ({ file }) => {
        const big = Buffer.alloc(8192, 7);
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord({
                fields: { attachment: { file: AUDIO, size: big.length } },
                attachmentBytes: big.toString("base64"),
            })],
        });

        expect(res.body.result.attachments.stored).toBe(0);
        expect(res.body.result.attachments.refused).toBe(1);
        expect(res.body.result.attachments.maxBytes, "the cap is reported back").toBe(1024);

        const line = await attachmentLine(file);
        expect(line.fields.attachment.reason).toBe("too-large");
    });
});

test("undecodable attachment bytes are refused rather than guessed at", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    await withLogging(xopatServer, {
        client: { attachments: true },
        stream: { attachments: true },
    }, async ({ file }) => {
        // A number where base64 was expected. The body is attacker-controlled, so
        // "whatever Buffer.from makes of it" is not an acceptable answer.
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord({ attachmentBytes: 12345 })],
        });

        expect(res.body.result.attachments.refused).toBe(1);
        const line = await attachmentLine(file);
        expect(line.fields.attachment.reason).toBe("bad-encoding");
    });
});

test("the attachment cap is not a line cap — an oversized record is still dropped", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // Separating the bytes before measuring must not turn `maxRecordBytes` into a
    // suggestion: a record whose own FIELDS are oversized is dropped whole, as it
    // always was, even while attachments are accepted.
    await withLogging(xopatServer, {
        client: { attachments: true, maxRecordBytes: 2048 },
        stream: { attachments: true },
    }, async () => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord({ fields: { attachment: { file: AUDIO, size: BYTES.length }, blah: "x".repeat(8192) } })],
        });

        expect(res.body.result.oversized).toBe(1);
        expect(res.body.result.accepted).toBe(0);
    });
});

test("an oversized line takes its payload with it — and reports a refusal, not a store", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // The accounting order used to lie: `attachmentsStored` was incremented where
    // the payload was accepted, and the line was measured and dropped AFTER. So a
    // window record carrying per-segment metadata answered `attachments.stored: 1`
    // alongside `oversized: 1`, the client's `attachmentsForwarded` counter ticked,
    // and the file was never written anywhere.
    await withLogging(xopatServer, {
        client: { attachments: true, maxRecordBytes: 2048 },
        stream: { attachments: true },
    }, async () => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", {
            records: [audioRecord({
                fields: {
                    attachment: { file: AUDIO, size: BYTES.length, mediaType: "audio/webm" },
                    segments: "x".repeat(8192),
                },
            })],
        });

        expect(res.body.result.oversized).toBe(1);
        expect(res.body.result.accepted).toBe(0);
        expect(res.body.result.attachments.stored, "nothing was kept").toBe(0);
        expect(res.body.result.attachments.refused, "and the client is told so").toBe(1);
    });
});

test("the RPC body limit follows the operator's attachment cap", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    // A log batch is text and fits the 256 kB default; an attachment does not.
    // The limit therefore has to move with the cap — and an upload past it must
    // be a 413 naming the limit, not the unexplainable 502 an unread body gives.
    const payload = audioRecord({
        fields: { attachment: { file: AUDIO, size: 400_000 } },
        attachmentBytes: Buffer.alloc(400_000, 3).toString("base64"),
    });

    await withLogging(xopatServer, { stream: { attachments: true } }, async () => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", { records: [payload] });
        expect(res.status, "attachments off — the plain 256 kB default applies").toBe(413);
        expect(res.body?.code).toBe("RPC_BODY_TOO_LARGE");
    });

    await withLogging(xopatServer, {
        client: { attachments: true },
        stream: { attachments: true },
    }, async () => {
        const res = await xopatServer.rpc("server", "core", "ingestClientLogs", { records: [payload] });
        expect(res.status, "attachments on — the same body is read").toBe(200);
        expect(res.body.result.attachments.stored).toBe(1);
    });
});
