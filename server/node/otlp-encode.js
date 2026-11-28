"use strict";

/**
 * Log records → OpenTelemetry OTLP/HTTP JSON.
 *
 * Used by a `sinks.stream` destination with `format: "otlp"` (server/node/logging.js).
 * Hand-written rather than the OpenTelemetry SDK on purpose: the packaged server
 * binary carries no runtime `node_modules`, the SDK is far larger than the
 * subset needed here, and OTLP/HTTP JSON is a small, versioned, stable schema
 * (opentelemetry-proto v1).
 *
 * Mapping:
 *  - a record whose `fields.kind === "metrics"` (emitted by modules/telemetry)
 *    becomes OTLP **metrics**: `sum` → monotonic delta Sum, `histogram` →
 *    explicit-bucket delta Histogram;
 *  - every other record becomes an OTLP **LogRecord** — severity from the level,
 *    channel / requestId / principal (already hashed) / pid / source as
 *    attributes, `fields` as a JSON string attribute.
 *
 * The encoder never throws for one bad record; it skips it and counts it.
 */

const SEVERITY = Object.freeze({
    trace: [1, "TRACE"],
    debug: [5, "DEBUG"],
    info: [9, "INFO"],
    warn: [13, "WARN"],
    error: [17, "ERROR"],
});

/** OTLP AggregationTemporality.DELTA */
const DELTA = 1;

let cachedVersion;
function serviceVersion() {
    if (cachedVersion !== undefined) return cachedVersion;
    try {
        cachedVersion = String(require("../../package.json").version || "");
    } catch (e) {
        cachedVersion = "";
    }
    return cachedVersion;
}

function anyValue(value) {
    if (value === null || value === undefined) return { stringValue: "" };
    if (typeof value === "boolean") return { boolValue: value };
    if (typeof value === "number") {
        return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === "string") return { stringValue: value };
    try {
        return { stringValue: JSON.stringify(value) };
    } catch (e) {
        return { stringValue: String(value) };
    }
}

function keyValues(obj) {
    const out = [];
    if (!obj || typeof obj !== "object") return out;
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;
        out.push({ key, value: anyValue(value) });
    }
    return out;
}

function nanos(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "0";
    // BigInt keeps the full precision a JS number loses at nanosecond scale.
    return (BigInt(Math.round(n)) * 1000000n).toString();
}

function recordMs(record) {
    const parsed = Date.parse(record?.ts);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function isMetricsRecord(record) {
    return record?.fields?.kind === "metrics" && Array.isArray(record.fields.metrics);
}

function resource(options = {}) {
    return {
        attributes: keyValues({
            "service.name": options.serviceName || "xopat",
            "service.version": options.serviceVersion ?? serviceVersion(),
            ...(options.deployment ? { "deployment.environment": options.deployment } : {}),
        }),
    };
}

/** Attributes common to everything a record produced: where it came from. */
function originAttributes(record) {
    return keyValues({
        "xopat.channel": record.channel,
        ...(record.source ? { "xopat.source": record.source } : {}),
        ...(record.deployment ? { "xopat.deployment": record.deployment } : {}),
        ...(record.principal ? { "xopat.principal": record.principal } : {}),
        ...(record.clientSession ? { "xopat.client_session": record.clientSession } : {}),
        ...(record.pid !== undefined ? { "process.pid": record.pid } : {}),
    });
}

function toDataPoint(metric, startNs, endNs, origin) {
    const attributes = [...keyValues(metric.attrs), ...origin];
    if (metric.type === "sum") {
        const value = Number(metric.value);
        if (!Number.isFinite(value)) return null;
        return {
            kind: "sum",
            point: {
                attributes,
                startTimeUnixNano: startNs,
                timeUnixNano: endNs,
                ...(Number.isInteger(value) ? { asInt: String(value) } : { asDouble: value }),
            },
        };
    }
    if (metric.type === "histogram") {
        const bounds = Array.isArray(metric.bounds) ? metric.bounds.map(Number) : [];
        const counts = Array.isArray(metric.counts) ? metric.counts.map(Number) : [];
        // OTLP requires exactly bounds+1 bucket counts.
        if (counts.length !== bounds.length + 1) return null;
        if (bounds.some(b => !Number.isFinite(b)) || counts.some(c => !Number.isInteger(c) || c < 0)) return null;
        const count = counts.reduce((a, b) => a + b, 0);
        const point = {
            attributes,
            startTimeUnixNano: startNs,
            timeUnixNano: endNs,
            count: String(count),
            bucketCounts: counts.map(String),
            explicitBounds: bounds,
        };
        if (Number.isFinite(Number(metric.sum))) point.sum = Number(metric.sum);
        if (Number.isFinite(Number(metric.min))) point.min = Number(metric.min);
        if (Number.isFinite(Number(metric.max))) point.max = Number(metric.max);
        return { kind: "histogram", point };
    }
    return null;
}

/**
 * Encode a batch. Returns `{ metrics, logs, skipped }`, where `metrics` /
 * `logs` are OTLP request bodies (or null when the batch had none of that kind).
 *
 * @param {object[]} records log records as the broker emits them
 * @param {{serviceName?: string, serviceVersion?: string, deployment?: string}} [options]
 */
function encodeOtlp(records, options = {}) {
    const metricsByKey = new Map(); // name|kind -> OTLP Metric
    const logRecords = [];
    let skipped = 0;

    for (const record of records || []) {
        try {
            if (isMetricsRecord(record)) {
                const fields = record.fields;
                const endMs = Number(fields.endMs) || recordMs(record);
                const startMs = Number(fields.startMs) || endMs;
                const startNs = nanos(startMs);
                const endNs = nanos(endMs);
                const origin = originAttributes(record);
                for (const metric of fields.metrics) {
                    if (!metric || typeof metric.name !== "string" || !metric.name) { skipped++; continue; }
                    const dp = toDataPoint(metric, startNs, endNs, origin);
                    if (!dp) { skipped++; continue; }
                    const key = `${metric.name}|${dp.kind}`;
                    let entry = metricsByKey.get(key);
                    if (!entry) {
                        entry = dp.kind === "sum"
                            ? { name: metric.name, sum: { aggregationTemporality: DELTA, isMonotonic: true, dataPoints: [] } }
                            : { name: metric.name, histogram: { aggregationTemporality: DELTA, dataPoints: [] } };
                        metricsByKey.set(key, entry);
                    }
                    (entry.sum || entry.histogram).dataPoints.push(dp.point);
                }
                continue;
            }

            const [severityNumber, severityText] = SEVERITY[record.level] || SEVERITY.info;
            const attributes = originAttributes(record);
            if (record.requestId) attributes.push({ key: "xopat.request_id", value: anyValue(record.requestId) });
            if (record.fields && typeof record.fields === "object") {
                attributes.push({ key: "xopat.fields", value: anyValue(record.fields) });
            }
            const ts = nanos(recordMs(record));
            logRecords.push({
                timeUnixNano: ts,
                observedTimeUnixNano: ts,
                severityNumber,
                severityText,
                body: { stringValue: String(record.message ?? "") },
                attributes,
            });
        } catch (e) {
            skipped++;
        }
    }

    const scope = { name: "xopat", version: options.serviceVersion ?? serviceVersion() };
    const res = resource(options);
    return {
        metrics: metricsByKey.size
            ? { resourceMetrics: [{ resource: res, scopeMetrics: [{ scope, metrics: [...metricsByKey.values()] }] }] }
            : null,
        logs: logRecords.length
            ? { resourceLogs: [{ resource: res, scopeLogs: [{ scope, logRecords }] }] }
            : null,
        skipped,
    };
}

/**
 * `https://collector:4318` → the two signal endpoints. A URL that already ends
 * in `/v1/logs` or `/v1/metrics` is treated as the base it belongs to, so either
 * spelling an operator copies from collector docs works.
 */
function otlpEndpoints(url) {
    const base = String(url || "").replace(/\/+$/, "").replace(/\/v1\/(logs|metrics|traces)$/, "");
    return { logs: `${base}/v1/logs`, metrics: `${base}/v1/metrics` };
}

module.exports = { encodeOtlp, otlpEndpoints, isMetricsRecord };
