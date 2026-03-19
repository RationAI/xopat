
import { nowMs, sanitizeMetricKey, ensureArray } from "./utils.mjs";

/** Run management + logging */
export class RunsAPI {
    /** @param {HttpClient} http */
    constructor(http) { this.http = http; }

    create({ experiment_id, run_name, tags, start_time } = {}) {
        return this.http.request("/runs/create", {
            method: "POST",
            body: {
                experiment_id,
                ...(run_name ? { run_name } : {}),
                ...(Array.isArray(tags) ? { tags } : {}),
                start_time: start_time ?? nowMs(),
            },
        });
    }

    get(run_id) { return this.http.request("/runs/get", { method: "GET", query: { run_id } }); }

    /**
     * Flexible search.
     * @param {Object} opts
     * @param {string[]} [opts.experiment_ids]
     * @param {string}   [opts.filter]
     * @param {string[]} [opts.order_by]
     * @param {number}   [opts.max_results]
     * @param {string}   [opts.page_token]
     */
    search(opts = {}) {
        return this.http.request("/runs/search", { method: "POST", body: opts });
    }

    setTag(run_id, key, value) {
        return this.http.request("/runs/set-tag", { method: "POST", body: { run_id, key, value } });
    }

    deleteTag(run_id, key) {
        return this.http.request("/runs/delete-tag", { method: "POST", body: { run_id, key } });
    }

    logParam(run_id, key, value) {
        return this.http.request("/runs/log-parameter", { method: "POST", body: { run_id, key, value } });
    }

    logParams(run_id, paramsObj) {
        const params = Object.entries(paramsObj || {}).map(([k, v]) => ({ key: k, value: String(v) }));
        return this.http.request("/runs/log-batch", { method: "POST", body: { run_id, params } });
    }

    logMetric(run_id, key, value, { timestamp = nowMs(), step = 0 } = {}) {
        return this.http.request("/runs/log-metric", { method: "POST", body: { run_id, key: sanitizeMetricKey(key), value: Number(value), timestamp, step } });
    }

    logMetrics(run_id, metricsObj, { timestamp = nowMs(), step = 0 } = {}) {
        const metrics = Object.entries(metricsObj || {}).map(([k, v]) => ({ key: sanitizeMetricKey(k), value: Number(v), timestamp, step }));
        return this.http.request("/runs/log-batch", { method: "POST", body: { run_id, metrics } });
    }

    /**
     * Log many at once (metrics/params/tags).
     * @param {Object} payload - { metrics?: [], params?: [], tags?: [] }
     */
    logBatch(run_id, payload) {
        return this.http.request("/runs/log-batch", { method: "POST", body: { run_id, ...payload } });
    }

    /**
     * End a run with status ("FINISHED" | "FAILED" | "KILLED").
     */
    endRun(run_id, status = "FINISHED", end_time = nowMs()) {
        return this.http.request("/runs/update", { method: "POST", body: { run_id, status, end_time } });
    }

    /**
     * Create or reuse a run identified by a tag key/value (e.g., { key: 'data_id', value: '123' })
     */
    async getOrCreateRunByTag({ experiment_id, identifierTag, run_name, extra_tags = [] }) {
        if (!experiment_id) throw new Error("getOrCreateRunByTag: experiment_id is required");
        if (!identifierTag || !identifierTag.key) throw new Error("getOrCreateRunByTag: identifierTag {key,value} is required");

        const filter = `tags.${identifierTag.key} = "${String(identifierTag.value).replace(/"/g, '\\"')}"`;
        const found = await this.search({ experiment_ids: [experiment_id], filter, max_results: 1 });
        const run = found?.runs?.[0];
        if (run?.info?.run_id) return run.info.run_id;

        const created = await this.create({ experiment_id, run_name, tags: [identifierTag, ...ensureArray(extra_tags)] });
        return created?.run?.info?.run_id || created?.run_id;
    }
}