addPlugin('profiler', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.page = new AdvancedMenuPages(this.id);
        // Per-viewer tile-load timings (ms), keyed by viewer unique id. Each
        // viewer is profiled independently so multi-viewport playback (the
        // recorder fans `play`/`stop` out per viewer) yields one boxplot each.
        this._records = new Map();
        // Viewers whose imageLoader is currently wrapped, so we can restore them.
        this._profiledViewers = new Set();
        // `_armed`: the profiler initiated this session (we never measure stray
        // recorder playbacks the user starts elsewhere). `_manual`: free-form
        // session driven by the Tools toggle rather than recorder events.
        this._armed = false;
        this._manual = false;
        this._profiling = false;
        this._waitDialogShown = false;

        this._RECORDING_ITEM = 'profiler.recording';
        this._MANUAL_ITEM = 'profiler.manual';
    }

    pluginReady() {
        this.recorder = OpenSeadragon.Recorder.instance();

        // The recorder raises `play`/`stop` once per playing viewer (parallel
        // multi-viewport playback), each carrying its own `viewerId`. We only
        // act on them while armed by `_profileRecording()`.
        this.recorder.addHandler('play', e => this._onPlay(e));
        this.recorder.addHandler('stop', e => this._onStop(e));

        // Discoverable entry point: a "Profile" section in the app-bar Tools
        // category (the category appears only because we register here).
        const Tools = USER_INTERFACE.AppBar.Tools;
        Tools.register(this._RECORDING_ITEM, {
            section: 'profile', sectionTitle: 'Profile',
            label: 'Profile a recording', icon: 'ph-film-strip',
            hint: 'Play the active recording and measure tile loading time',
            onClick: () => this._profileRecording(),
        });
        Tools.register(this._MANUAL_ITEM, {
            section: 'profile',
            label: 'Manual profiling', icon: 'ph-record',
            hint: 'Start measuring, interact with the viewer(s), then stop',
            onClick: () => this._toggleManual(),
        });

        // JSON-built result buttons cannot carry an onClick (see menu-pages
        // README), so export buttons tag themselves with a data attribute and
        // we handle clicks via delegation (survives FullscreenMenus lazy mount).
        document.addEventListener('click', e => {
            const target = e.target instanceof Element ? e.target.closest('[data-profiler-export]') : null;
            if (target) this.exportFile(target.getAttribute('data-profiler-export'));
        });
    }

    // ---------------------------------------------------------------------
    // Tools entry points
    // ---------------------------------------------------------------------

    _profileRecording() {
        if (this._profiling) {
            return void Dialogs.show("A profiling session is already running.", 2500, Dialogs.MSG_WARN);
        }

        const viewers = this._viewers();
        const hasSteps = viewers.some(v => this.recorder.getSteps(v.uniqueId).length > 0);
        if (hasSteps) {
            // Arm, then fan playback out to every viewer's active recording.
            // The play/stop handlers do the measuring and rendering.
            this._armed = true;
            this.recorder.play();
            return;
        }

        // Nothing to play — guide the user toward producing a recording.
        if (UTILITIES.isLoaded('recorder', true)) {
            this._actionModal(
                "No recording captured yet",
                "No recording with steps was found. Open the Recorder timeline, capture frames or a path, then run “Profile a recording” again.",
                "Open Recorder",
                () => USER_INTERFACE.Tools.open()
            );
        } else if (pluginMeta('recorder', 'name')) {
            this._actionModal(
                "Enable the Recorder",
                "Profiling plays back a recording, but the Recorder plugin (timeline) is not loaded. Load it now to capture a recording, then run “Profile a recording” again.",
                "Load Recorder",
                () => UTILITIES.loadPlugin('recorder', () => {
                    USER_INTERFACE.Tools.open();
                    Dialogs.show("Recorder loaded — capture frames or a path on its timeline, then profile.", 6000, Dialogs.MSG_INFO);
                })
            );
        } else {
            Dialogs.show("No recordings are available and the Recorder plugin is not installed. Use “Manual profiling” instead.",
                6000, Dialogs.MSG_WARN);
        }
    }

    _toggleManual() {
        if (this._manual) return void this._stopManual();
        if (this._profiling) {
            return void Dialogs.show("A profiling session is already running.", 2500, Dialogs.MSG_WARN);
        }
        this._startManual();
    }

    _startManual() {
        const viewers = this._viewers();
        if (!viewers.length) {
            return void Dialogs.show("No viewer is available to profile.", 2500, Dialogs.MSG_WARN);
        }
        this._armed = true;
        this._manual = true;
        this._startSession();
        viewers.forEach(v => this._beginViewer(v));

        USER_INTERFACE.AppBar.Tools.setLabel(this._MANUAL_ITEM, 'Stop manual profiling');
        USER_INTERFACE.AppBar.Tools.setDisabled(this._RECORDING_ITEM, true);
        Dialogs.show("Manual profiling started — interact with the viewer(s), then choose “Stop manual profiling”.",
            5000, Dialogs.MSG_INFO);
    }

    async _stopManual() {
        // Snapshot the wrapped viewers before draining (the set mutates as we
        // restore each one).
        const viewers = [...this._profiledViewers]
            .map(id => VIEWER_MANAGER.getViewer(id, false))
            .filter(Boolean);
        USER_INTERFACE.AppBar.Tools.setLabel(this._MANUAL_ITEM, 'Manual profiling');
        USER_INTERFACE.AppBar.Tools.setDisabled(this._RECORDING_ITEM, false);
        for (const v of viewers) await this._finishViewer(v);
        this._endSession();
    }

    // ---------------------------------------------------------------------
    // Recorder-driven measurement
    // ---------------------------------------------------------------------

    _onPlay(e) {
        if (!this._armed || this._manual) return;
        const viewer = VIEWER_MANAGER.getViewer(e?.viewerId, false);
        if (!viewer) return;
        if (!this._profiling) this._startSession();
        this._beginViewer(viewer);
    }

    async _onStop(e) {
        if (!this._armed || this._manual) return;
        const viewer = VIEWER_MANAGER.getViewer(e?.viewerId, false);
        if (viewer) await this._finishViewer(viewer);

        // Render once the last playing viewer has stopped (no-arg isPlaying()
        // is true while ANY viewer is still playing). The flag clear is
        // synchronous after the check, so concurrent stops render only once.
        if (this._profiling && !this.recorder.isPlaying()) {
            this._endSession();
        }
    }

    // ---------------------------------------------------------------------
    // Session + per-viewer hooks
    // ---------------------------------------------------------------------

    _startSession() {
        this._profiling = true;
        this._records.clear();
        this._profiledViewers.clear();
        this._waitDialogShown = false;
        try { console.profile("profiler"); } catch (_) { /* devtools profiling optional */ }
    }

    _endSession() {
        try { console.profileEnd("profiler"); } catch (_) { /* paired with console.profile */ }
        this._renderResults();
        this._armed = false;
        this._manual = false;
        this._profiling = false;
    }

    /** Wrap one viewer's imageLoader to time every tile request it issues. */
    _beginViewer(viewer) {
        const loader = viewer.imageLoader;
        if (!loader || loader.__profilerRestore) return; // missing or already wrapped

        const records = [];
        this._records.set(viewer.uniqueId, records);
        this._profiledViewers.add(viewer.uniqueId);

        // Instance-level wrap (no patching of src/libs): time from enqueue to
        // completion. addJob threads `options.callback` to completeJob, so
        // wrapping it captures the finish for both success and error.
        const original = loader.addJob.bind(loader);
        loader.__profilerRestore = () => {
            loader.addJob = original;
            delete loader.__profilerRestore;
        };
        loader.addJob = (options) => {
            const start = Date.now();
            const callback = options.callback;
            options.callback = (...args) => {
                records.push(Date.now() - start);
                if (callback) callback(...args);
            };
            return original(options);
        };
    }

    /** Drain a viewer's outstanding tile jobs, then restore its imageLoader. */
    async _finishViewer(viewer) {
        const loader = viewer.imageLoader;
        if (!loader?.__profilerRestore) return;

        if (!this._waitDialogShown) {
            this._waitDialogShown = true;
            Dialogs.show("Profiling has finished. Waiting for pending tile requests to settle before rendering the results…",
                8000, Dialogs.MSG_INFO);
        }
        await this._waitForJobs(loader);
        loader.__profilerRestore();
        this._profiledViewers.delete(viewer.uniqueId);
    }

    _waitForJobs(loader, timeout = 30000) {
        return new Promise(resolve => {
            const startedAt = Date.now();
            const tick = () => {
                if (loader.jobsInProgress <= 0 || Date.now() - startedAt > timeout) return resolve();
                setTimeout(tick, 250);
            };
            tick();
        });
    }

    // ---------------------------------------------------------------------
    // Results
    // ---------------------------------------------------------------------

    _renderResults() {
        const page = [];
        let viewerCount = 0;

        for (const [viewerId, records] of this._records) {
            if (!records.length) continue;
            viewerCount++;
            const viewer = VIEWER_MANAGER.getViewer(viewerId, false);
            const label = this._viewerLabel(viewer, viewerId);
            const min = Math.min(...records);
            const max = Math.max(...records);
            const mean = (records.reduce((sum, ms) => sum + ms, 0) / records.length).toFixed(1);

            page.push(
                { type: "title", text: label, level: 3, separator: true },
                { type: "div", extraClasses: "text-sm opacity-80 my-2", children: [
                    `Measured ${records.length} tile request(s) — min ${min} ms, max ${max} ms, mean ${mean} ms. ` +
                    `The box plot below summarises the distribution.`
                ]},
                { type: "vega", classes: "bg-white rounded p-2 my-2", vega: this.getVegaBoxPlot(records.map(ms => ({ ms }))) },
                { type: "button", base: "btn btn-sm btn-primary my-2",
                    extraProperties: { "data-profiler-export": viewerId },
                    children: ["Download raw data (JSON)"] },
                { type: "newline" }
            );
        }

        if (!viewerCount) {
            page.push({ type: "div", extraClasses: "text-sm opacity-80 my-2",
                children: ["No tile requests were recorded during this session."] });
        }

        this.page.buildMetaDataMenu([{
            title: 'Profiler output',
            id: 'profiler-output',
            icon: 'fa-gauge',
            page
        }], false);

        this.page.openMenu('profiler-output');
    }

    /** Human-friendly label for a viewer, used in headings and filenames. */
    _viewerLabel(viewer, viewerId) {
        const ctx = UTILITIES.getViewerIOContext?.(viewer || viewerId, true);
        return ctx?.title || ctx?.fileName || viewer?.uniqueId || String(viewerId ?? "viewer");
    }

    _viewers() {
        return ((VIEWER_MANAGER.viewers) || []).filter(Boolean);
    }

    exportFile(viewerId) {
        const records = this._records.get(viewerId);
        if (!records || !records.length) {
            return void Dialogs.show("No profiling data available to export for this viewer.", 2500, Dialogs.MSG_WARN);
        }
        const viewer = VIEWER_MANAGER.getViewer(viewerId, false);
        const safe = this._viewerLabel(viewer, viewerId).replace(/[^\w.-]+/g, "_");
        UTILITIES.downloadAsFile(`tile-request-times-${safe}.json`, JSON.stringify(records));
    }

    /** Small confirm-style modal with a single primary action. */
    _actionModal(header, message, actionLabel, action) {
        const body = document.createElement('div');
        body.className = 'flex flex-col gap-3';
        const text = document.createElement('div');
        text.className = 'text-sm';
        text.textContent = message;
        body.appendChild(text);

        let modal;
        modal = new UI.Modal({
            id: `${this.id}-profiler-action-modal`,
            header,
            body,
            footer: (() => {
                const footer = document.createElement('div');
                footer.className = 'flex w-full justify-end gap-2';
                const cancel = document.createElement('button');
                cancel.type = 'button'; cancel.className = 'btn btn-ghost btn-sm';
                cancel.textContent = 'Cancel'; cancel.onclick = () => modal.close();
                const ok = document.createElement('button');
                ok.type = 'button'; ok.className = 'btn btn-primary btn-sm';
                ok.textContent = actionLabel;
                ok.onclick = () => { modal.close(); action(); };
                footer.append(cancel, ok);
                return footer;
            })()
        }).mount();
        modal.open();
    }

    getVegaBoxPlot(data) {
        return {
            "$schema": "https://vega.github.io/schema/vega/v5.json",
            "description": "A tile fetching duration box plot.",
            "width": 450,
            "padding": 5,
            "signals": [
                { "name": "plotWidth", "value": 60 },
                { "name": "height", "update": "plotWidth + 10"}
            ],
            "data": [
                {
                    "name": "frames",
                    "values": data
                }
            ],
            "scales":[{"name":"xscale","type":"linear","range":"width","round":true,"domain":
                {"data":"frames","field":"ms"},"zero":false,"nice":true}],
            "axes":[{"orient":"bottom","scale":"xscale","zindex":1}],
            "marks":[{"type":"group","data":[{"name":"summary","source":"frames","transform":[{"type":
                "aggregate","fields":["ms","ms","ms","ms","ms"],"ops":["min","q1","median","q3","max"],
            "as":["min","q1","median","q3","max"]}]}],"marks":[{"type":"rect","from":{"data":"summary"},
                "encode":{"enter":{"fill":{"value":"black"},"height":{"value":1}},"update":{"yc":{"signal":
                "plotWidth/2","offset":-0.5},"x":{"scale":"xscale","field":"min"},"x2":{"scale":"xscale",
                    "field":"max"}}}},{"type":"rect","from":{"data":"summary"},"encode":{"enter":{"fill":{"value":
                "steelblue"},"cornerRadius":{"value":4}},"update":{"yc":{"signal":"plotWidth/2"},"height":
                {"signal":"plotWidth/2"},"x":{"scale":"xscale","field":"q1"},"x2":{"scale":"xscale","field":
                "q3"}}}},{"type":"rect","from":{"data":"summary"},"encode":{"enter":{"fill":{"value":
                "aliceblue"},"width":{"value":2}},"update":{"yc":{"signal":"plotWidth/2"},"height":{"signal":
                "plotWidth/2"},"x":{"scale":"xscale","field":"median"}}}}]}
            ]
        };
    }
});
