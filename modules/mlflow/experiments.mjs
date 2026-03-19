/** Experiment management wrappers */
export class ExperimentsAPI {
    /** @param {HttpClient} http */
    constructor(http) { this.http = http; }

    getByName(experiment_name) {
        return this.http.request("/experiments/get-by-name", {
            method: "GET",
            query: { experiment_name },
        });
    }

    async ensure(name) {
        try {
            const r = await this.getByName(name);
            const id = r?.experiment?.experiment_id;
            if (id) return id;
        } catch (_) {/* fallthrough */}
        const created = await this.create({ name });
        const id = created?.experiment_id;
        if (!id) throw new Error("Failed to ensure experiment");
        return id;
    }

    create({ name, artifact_location, tags } = {}) {
        return this.http.request("/experiments/create", {
            method: "POST",
            body: {
                name,
                ...(artifact_location ? { artifact_location } : {}),
                ...(tags ? { tags } : {}),
            },
        });
    }

    get(experiment_id) {
        return this.http.request("/experiments/get", { method: "GET", query: { experiment_id } });
    }

    setTag(experiment_id, key, value) {
        return this.http.request("/experiments/set-experiment-tag", {
            method: "POST",
            body: { experiment_id, key, value },
        });
    }

    /**
     * @param {Object} opts
     * @param {"ACTIVE_ONLY"|"DELETED_ONLY"|"ALL"} [opts.view_type]
     * @param {number} [opts.max_results]
     * @param {string} [opts.page_token]
     */
    list(opts = {}) {
        return this.http.request("/experiments/list", { method: "GET", query: opts });
    }

    delete(experiment_id) {
        return this.http.request("/experiments/delete", { method: "POST", body: { experiment_id } });
    }

    restore(experiment_id) {
        return this.http.request("/experiments/restore", { method: "POST", body: { experiment_id } });
    }
}
