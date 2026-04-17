addPlugin('mlflow-annotations-slide', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        // ---- PLUGIN CONFIG ----
        // Required
        this.mlflowURL = this.getStaticMeta('mlflowURL'); // e.g. https://host/api/2.0/mlflow
        this.experimentName = this.getStaticMeta('experimentName');

        // Optional auth routing (let HttpClient + XOpatUser handle it)
        // Provide, for example: { contextId: 'mlflow', types: ['jwt','basic'], refreshOn401: true }
        this.auth = this.getStaticMeta('auth') || { contextId: 'mlflow', types: ['jwt', 'basic'], refreshOn401: true };

        this.integrateWithPlugin('slide-info', info => {
            info.addCustomViewerButtons(`<button class="btn btn-ghost" onClick="${this.THIS}.labelSlide('positive');">POSITIVE</button>`, `<button class="btn btn-ghost" onClick="${this.THIS}.labelSlide('negative');">NEGATIVE</button>`);
        });
    }

    pluginReady() {
        // HTTP + MLflow APIs (use our HttpClient so external auth can be configured centrally)
        if (!HttpClient) throw new Error('HttpClient is required on ');
        const http = new HttpClient({ baseURL: this.mlflowURL, auth: this.auth, timeoutMs: 30000, maxRetries: 3 });

        // Use the exported APIs directly so we control the HttpClient instance
        const { ExperimentsAPI, RunsAPI } = MlFlow || {};
        if (!ExperimentsAPI || !RunsAPI) throw new Error('MlFlow ExperimentsAPI/RunsAPI not found on ');

        this.experiments = new ExperimentsAPI(http);
        this.runs = new RunsAPI(http);

        // ---- STATE ----
        this._expId = null;
        this._runsMap = new Map();
        APPLICATION_CONTEXT.setOption('activeBackgroundIndex', 0);

        // Label map exposed for runtime edits (numbers only)
        this._labelMap = { negative: 0, positive: 1, uncertain: 0.5 };
    }

    // ---------------- Labeling flow ----------------
    async labelSlide(label) {
        try {
            USER_INTERFACE.Loading.show(true, 'Storing slide label in MLflow...');

            const currentIndex = Number.parseInt(APPLICATION_CONTEXT.getOption('activeBackgroundIndex', undefined));
            if (!Number.isInteger(currentIndex)) { Dialogs.show('No slide is currently open.', 4000, Dialogs.MSG_OK); return; }

            const bg = APPLICATION_CONTEXT.config.background[currentIndex];
            if (!bg) { Dialogs.show('No background slide at current index.', 4000, Dialogs.MSG_OK); return; }

            const dataIndex = bg.dataReference;
            const dataID = APPLICATION_CONTEXT.config.data?.[dataIndex];
            if (!dataID) { Dialogs.show('No data is currently open.', 4000, Dialogs.MSG_OK); return; }

            await this._setLabelForSlide(String(dataID), String(label));
            Dialogs.show(`Labeled ${dataID} as "${label}" in MLflow.`, 3000, Dialogs.MSG_OK);
        } catch (err) {
            console.error('MLflow label error:', err);
            Dialogs.show(`Failed to store label: ${err?.message || err}`, 6000, Dialogs.MSG_ERR);
        } finally {
            USER_INTERFACE.Loading.show(false);
        }
    }

    /** Public helpers: set/delete slide labels as tags */
    async setSlideLabel(run_id, slideId, label) {
        const key = `slide_label.${String(slideId)}`;
        await this.runs.setTag(run_id, key, String(label));
    }

    async setSlideLabels(run_id, labels) {
        let tags;
        if (Array.isArray(labels)) {
            tags = labels.map(({ slideId, label }) => ({ key: `slide_label.${String(slideId)}`, value: String(label) }));
        } else {
            tags = Object.entries(labels).map(([slideId, label]) => ({ key: `slide_label.${String(slideId)}`, value: String(label) }));
        }
        await this.runs.logBatch(run_id, { tags });
    }

    async deleteSlideLabel(run_id, slideId) {
        const key = `slide_label.${String(slideId)}`;
        await this.runs.deleteTag(run_id, key);
    }

    // ---------------- Internals ----------------
    async _setLabelForSlide(slideId, label) {
        const run_id = await this.getOrCreateBaseRun();
        await this.ensureLabelMapTag(run_id); // one-time helper
        await this.setSlideMetric(run_id, slideId, label);
        await this.setSlideLabel(run_id, slideId, label); // keep both metric + tag for discoverability
    }

    labelToNumber(label) {
        const k = String(label).toLowerCase();
        if (k in this._labelMap) return this._labelMap[k];
        const n = Number(label);
        if (!Number.isNaN(n)) return n;
        throw new Error(`Unknown label "${label}" and not numeric.`);
    }

    _sanitizeKey(s) { return String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 240); }

    async getOrCreateBaseRun() {
        return await this._getOrCreateRunById('base');
    }

    async _getOrCreateRunById(id) {
        if (this._runsMap.has(id)) return this._runsMap.get(id);
        const experiment_id = await this._ensureExperimentId();
        const filter = `tags.data_id = "${String(id).replace(/"/g, '\\"')}"`;
        try {
            const search = await this.runs.search({ experiment_ids: [experiment_id], filter, max_results: 1 });
            const run = search?.runs?.[0];
            if (run?.info?.run_id) {
                this._runsMap.set(id, run.info.run_id);
                return run.info.run_id;
            }
        } catch (_) { /* ignore */ }
        const created = await this.runs.create({ experiment_id, run_name: `xopat-${id}`, tags: [ { key: 'data_id', value: String(id) }, { key: 'source', value: 'xopat-slide-annotations' } ] });
        const run_id = created?.run?.info?.run_id || created?.run_id;
        if (!run_id) throw new Error('Failed to create MLflow run.');
        this._runsMap.set(id, run_id);
        return run_id;
    }

    async _ensureExperimentId() {
        if (this._expId) return this._expId;
        const id = await this.experiments.ensure(this.experimentName);
        this._expId = id;
        return id;
    }

    // ----- Metrics (numeric labels) -----
    async setSlideMetric(run_id, slideId, label, { step = 0 } = {}) {
        const key = `slide_${this._sanitizeKey(slideId)}`;
        const value = this.labelToNumber(label);
        await this.runs.logMetric(run_id, key, value, { step });
    }

    async setSlideMetrics(run_id, entries, { step = 0 } = {}) {
        const ts = Date.now();
        const metrics = [];
        if (Array.isArray(entries)) {
            for (const { slideId, label } of entries) {
                metrics.push({ key: `slide_${this._sanitizeKey(slideId)}`, value: this.labelToNumber(label), timestamp: ts, step });
            }
        } else {
            for (const [slideId, label] of Object.entries(entries)) {
                metrics.push({ key: `slide_${this._sanitizeKey(slideId)}`, value: this.labelToNumber(label), timestamp: ts, step });
            }
        }
        await this.runs.logBatch(run_id, { metrics });
    }

    async getAllSlideMetrics(run_id) {
        const res = await this.runs.get(run_id);
        const out = {};
        for (const m of (res?.run?.data?.metrics || [])) {
            if (!m?.key?.startsWith?.('slide_')) continue;
            const slideId = m.key.replace(/^slide_/, '');
            out[slideId] = m.value;
        }
        return out; // { sanitizedSlideId: number }
    }

    async ensureLabelMapTag(run_id) {
        await this.runs.setTag(run_id, 'label_map', JSON.stringify(this._labelMap));
    }
});
