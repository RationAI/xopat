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
 * neither may end its literal early and append clauses. MLflow's parser
 * (`SearchUtils._strip_quotes`) only slices off the surrounding quotes — it
 * decodes no escapes — so escaping would make the filter disagree with the tag
 * `getOrCreateRunByTag` writes, and every lookup would miss and create a
 * duplicate run. The only encoding that is both exact and closed is a delimiter
 * the text does not contain: the key is backtick-quoted (dotted keys such as
 * `mlflow.runName` need it), the value takes `"` or else `'`. Text containing
 * every candidate delimiter cannot be matched exactly and throws.
 */
export function buildTagFilter(key, value) {
    const k = String(key ?? "");
    if (!k || k.includes("`")) {
        throw new Error("buildTagFilter: tag key must be non-empty and contain no backtick");
    }
    const v = String(value ?? "");
    const q = !v.includes('"') ? '"' : !v.includes("'") ? "'" : null;
    if (!q) {
        throw new Error("buildTagFilter: tag value containing both ' and \" cannot be matched by MLflow search");
    }
    return `tags.\`${k}\` = ${q}${v}${q}`;
}
