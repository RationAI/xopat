export const nowMs = () => Date.now();

export function sanitizeMetricKey(s) {
    return String(s).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 240);
}

export function ensureArray(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
}