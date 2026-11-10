export const nowMs = () => Date.now();

export function sanitizeMetricKey(s) {
    return String(s).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 240);
}

export function ensureArray(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
}

/**
 * Build an MLflow search filter matching runs by one tag.
 *
 * Both halves are often untrusted (record fields, session-chosen run names), so
 * neither is spliced raw: the key is reduced to the metric-key charset and
 * backtick-quoted (dotted keys such as `mlflow.runName` need the quoting), and
 * the value is escaped backslash first, then quote — the only order in which a
 * trailing `\` cannot swallow the closing quote and append filter clauses.
 */
export function buildTagFilter(key, value) {
    const k = sanitizeMetricKey(key);
    const v = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `tags.\`${k}\` = "${v}"`;
}
