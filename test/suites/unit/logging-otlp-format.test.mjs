/**
 * `sinks.stream[].format: "otlp"` — log records as OpenTelemetry OTLP/HTTP JSON.
 *
 * What must hold:
 *   1. metric records emitted by modules/telemetry (`fields.kind: "metrics"`)
 *      become valid OTLP metrics (delta Sum / explicit-bucket Histogram, with
 *      bucketCounts = bounds + 1), everything else becomes OTLP LogRecords;
 *   2. one bad metric never takes the batch down;
 *   3. the destination posts to the collector's `/v1/metrics` and `/v1/logs`
 *      with a JSON content type, and keeps every existing guarantee (queue,
 *      counters) — default `ndjson` behaviour is untouched.
 */
import { test, expect } from "@xopat/test-harness";

const logging = await import("../../../server/node/logging.js");
const { LogStreamDestination, normalizeStreamConfigs } = logging.default ?? logging;
const otlp = await import("../../../server/node/otlp-encode.js");
const { encodeOtlp, otlpEndpoints } = otlp.default ?? otlp;

const metricsRecord = (metrics, over = {}) => ({
    ts: "2026-11-26T10:00:00.000Z",
    level: "info",
    channel: "client:telemetry",
    message: "telemetry metrics",
    pid: 7,
    source: "client",
    principal: "p_abc123",
    fields: { kind: "metrics", startMs: 1_790_000_000_000, endMs: 1_790_000_060_000, metrics },
    ...over,
});

const histogram = {
    type: "histogram", name: "xopat.client.tile.latency_ms", attrs: { source: "DziTileSource" },
    bounds: [50, 100, 200], counts: [1, 2, 0, 1], count: 4, sum: 512.5, min: 10, max: 300,
};
const counter = { type: "sum", name: "xopat.client.tile.loaded", attrs: { source: "DziTileSource" }, value: 42 };

test("metric records become OTLP delta sums and histograms @unit", () => {
    const { metrics, logs, skipped } = encodeOtlp([metricsRecord([counter, histogram])]);
    expect(logs).toBeNull();
    expect(skipped).toBe(0);
    const [rm] = metrics.resourceMetrics;
    const names = rm.resource.attributes.map(a => a.key);
    expect(names).toContain("service.name");
    const list = rm.scopeMetrics[0].metrics;

    const sum = list.find(m => m.name === "xopat.client.tile.loaded").sum;
    expect(sum.aggregationTemporality).toBe(1);
    expect(sum.isMonotonic).toBe(true);
    expect(sum.dataPoints[0].asInt).toBe("42");
    expect(sum.dataPoints[0].startTimeUnixNano).toBe("1790000000000000000");
    expect(sum.dataPoints[0].timeUnixNano).toBe("1790000060000000000");
    const attrKeys = sum.dataPoints[0].attributes.map(a => a.key);
    expect(attrKeys).toEqual(expect.arrayContaining(["source", "xopat.channel", "xopat.principal"]));

    const hist = list.find(m => m.name === "xopat.client.tile.latency_ms").histogram;
    const point = hist.dataPoints[0];
    expect(point.explicitBounds).toEqual([50, 100, 200]);
    expect(point.bucketCounts).toEqual(["1", "2", "0", "1"]);
    expect(point.count).toBe("4");
    expect(point.sum).toBe(512.5);
});

test("data points of one metric from several records share one OTLP metric @unit", () => {
    const { metrics } = encodeOtlp([metricsRecord([counter]), metricsRecord([{ ...counter, value: 3 }])]);
    const list = metrics.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(list.length).toBe(1);
    expect(list[0].sum.dataPoints.map(p => p.asInt)).toEqual(["42", "3"]);
});

test("malformed metrics are skipped, not fatal @unit", () => {
    const broken = [
        { type: "histogram", name: "h", bounds: [1, 2], counts: [1, 1] },       // counts != bounds + 1
        { type: "sum", name: "s", value: "NaN-ish" },
        { type: "gauge", name: "g", value: 1 },
        { name: "", type: "sum", value: 1 },
        null,
    ];
    const { metrics, skipped } = encodeOtlp([metricsRecord([...broken, counter])]);
    expect(skipped).toBe(broken.length);
    expect(metrics.resourceMetrics[0].scopeMetrics[0].metrics.map(m => m.name)).toEqual(["xopat.client.tile.loaded"]);
});

test("ordinary records become LogRecords with mapped severity @unit", () => {
    const { metrics, logs } = encodeOtlp([
        { ts: "2026-11-26T10:00:00.000Z", level: "error", channel: "rpc", message: "boom", pid: 1,
            requestId: "r1", fields: { code: "X" } },
        { ts: "2026-11-26T10:00:01.000Z", level: "weird", channel: "core", message: "m" },
    ]);
    expect(metrics).toBeNull();
    const records = logs.resourceLogs[0].scopeLogs[0].logRecords;
    expect(records[0].severityNumber).toBe(17);
    expect(records[0].severityText).toBe("ERROR");
    expect(records[0].body.stringValue).toBe("boom");
    const attrs = Object.fromEntries(records[0].attributes.map(a => [a.key, a.value]));
    expect(attrs["xopat.request_id"].stringValue).toBe("r1");
    expect(JSON.parse(attrs["xopat.fields"].stringValue)).toEqual({ code: "X" });
    expect(records[1].severityText).toBe("INFO"); // unknown level falls back to info
});

test("endpoint URLs accept the base or a signal path @unit", () => {
    expect(otlpEndpoints("http://otel:4318")).toEqual({
        logs: "http://otel:4318/v1/logs", metrics: "http://otel:4318/v1/metrics",
    });
    expect(otlpEndpoints("http://otel:4318/v1/logs/")).toEqual({
        logs: "http://otel:4318/v1/logs", metrics: "http://otel:4318/v1/metrics",
    });
});

test("an otlp destination posts JSON to /v1/metrics and /v1/logs @unit", async () => {
    const [config] = normalizeStreamConfigs({ url: "https://otel.test:4318", format: "otlp", batchSize: 10 });
    expect(config.format).toBe("otlp");
    const sent = [];
    const destination = new LogStreamDestination(config, {
        http: (url, body, opts) => { sent.push({ url, body, type: opts.contentType }); return Promise.resolve(200); },
    });
    destination.write(metricsRecord([counter]));
    destination.write({ ts: "2026-11-26T10:00:00.000Z", level: "warn", channel: "core", message: "w", pid: 1 });
    await destination.flush();
    expect(sent.map(s => s.url).sort()).toEqual(["https://otel.test:4318/v1/logs", "https://otel.test:4318/v1/metrics"]);
    for (const s of sent) {
        expect(s.type).toBe("application/json");
        expect(() => JSON.parse(s.body)).not.toThrow();
    }
    expect(destination.snapshot().sent).toBe(2);
    expect(destination.snapshot().format).toBe("otlp");
});

test("an otlp file destination writes one ExportRequest per line @unit", async () => {
    const [config] = normalizeStreamConfigs({ file: "/tmp/x.otlp.jsonl", format: "otlp", rotate: "none" });
    const written = [];
    const destination = new LogStreamDestination(config, {
        file: (path, body) => { written.push(body); return Promise.resolve(); },
    });
    destination.write(metricsRecord([counter]));
    await destination.flush();
    const lines = written.join("").trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).resourceMetrics).toBeTruthy();
});

test("default format stays ndjson @unit", () => {
    expect(normalizeStreamConfigs({ url: "https://c.test" })[0].format).toBe("ndjson");
    expect(normalizeStreamConfigs({ url: "https://c.test", format: "bogus" })[0].format).toBe("ndjson");
});
