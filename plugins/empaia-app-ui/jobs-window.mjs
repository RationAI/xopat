import {
    DAY_GROUPS, dayGroupOf, FILTERS, jobTime, latestCompletedJob,
    MODE_FILTERS, modeOf, selectJobs, statusGroup,
} from "./sections/job-status.mjs";
import { jobActions, jobMessages, jobRow } from "./sections/jobs.mjs";
import { createRegionResultsSection, createResultsSection, outputChips } from "./sections/results.mjs";
import { createPixelmapsSection } from "./sections/pixelmaps.mjs";

const van = globalThis.van;
const { div, span, p, button, i, input } = van.tags;

/** Rendered-row cap. Past this the search box is the right tool, not scrolling. */
const MAX_ROWS = 200;

/**
 * The analyses workspace.
 *
 * A dockable window (floats over the slide, or docks as a MainLayout tab) that
 * owns everything about *analyses*: their history, what is running, and which
 * runs' output is currently painted on the slide. It is reached from
 * `AppBar → Tools`, because watching a run and comparing two results are things
 * done while looking at the slide — not things worth leaving it for, which is
 * what the fullscreen plugin menu made them.
 *
 * Visibility is not decided here. The window renders `workbench.getVisibleJobIds`
 * and calls the module to change it, so the canvas, the pixel-map layers and
 * this list cannot disagree.
 *
 * Plain van.js rather than a `BaseComponent` subclass, for the same reason the
 * plugin's panel is: every part is a reactive read of plugin state, with no
 * per-component state or styling API of its own to justify the extra layer.
 */
export class JobsWindow {
    constructor(plugin) {
        this.plugin = plugin;
        this.windowId = "empaia-analyses-workspace";
        this.window = null;

        const s = van.state;
        /** View-only state: what the *list* shows, never what the slide shows. */
        this.view = {
            search: s(""),
            filter: s("all"),
            mode: s("all"),
            expandedJobId: s(undefined),
            /** Outputs of the expanded analysis, once fetched. */
            expandedOutputs: s(undefined),
        };
        this._searchDebounce = undefined;
    }

    t(key, args) { return this.plugin.t(key, args); }

    open() {
        if (!this.window) this._build();
        this.window.open();
    }

    destroy() {
        clearTimeout(this._searchDebounce);
        try {
            // `close()` hides it and unregisters the floating handle; `remove()`
            // is what actually takes the node out of the document.
            this.window?.close?.();
            this.window?.remove?.();
        } catch (e) { /* already gone */ }
        this.window = null;
    }

    _build() {
        const UI = globalThis.UI;
        const body = div({ class: "flex flex-col h-full text-sm", style: "min-height:0;" },
            this._header(),
            div({ class: "flex-1 overflow-y-auto px-2 pb-2", style: "min-height:0;" },
                this._list()),
        );

        this.window = new UI.DockableWindow({
            id: this.windowId,
            title: this.t("jobs.windowTitle"),
            icon: "ph-flask",
            defaultMode: "floating",
            floating: { width: 480, height: 620, resizable: true, closable: true },
        }, body);
        USER_INTERFACE.addHtml(this.window, this.plugin.id);
    }

    // ── header ──────────────────────────────────────────────────────────────

    _header() {
        const s = this.plugin.state;

        return div({ class: "flex flex-col gap-2 p-2 border-b border-base-300 bg-base-100 sticky top-0 z-10" },
            // Which slide this list belongs to. Without it the window is a list
            // of UUIDs with no anchor — and in a grid the user genuinely cannot
            // tell which viewport it describes.
            () => div({ class: "flex items-center gap-2 text-xs opacity-60" },
                i({ class: "ph-light ph-image" }),
                span({ class: "truncate" }, this._slideLabel()),
                span({ class: "ml-auto truncate" },
                    this.plugin.workbench.getAppName() ?? ""),
            ),

            input({
                type: "search",
                class: "input input-bordered input-xs w-full",
                placeholder: this.t("jobs.searchPlaceholder"),
                oninput: (e) => this._searchInput(e.target.value),
            }),

            div({ class: "flex items-center gap-1 flex-wrap" },
                ...FILTERS.map(id => this._filterChip(id)),
            ),

            // Which step, not just which state. The list holds every mode's jobs
            // for the slide — a postprocessing run is built on a preprocessing
            // result, so both have to be reachable at once — and without this row
            // the two were indistinguishable.
            () => {
                const present = new Set(s.jobs.val.map(modeOf).filter(Boolean));
                if (present.size <= 1) return div();
                return div({ class: "flex items-center gap-1 flex-wrap" },
                    ...MODE_FILTERS
                        .filter(id => id === "all" || present.has(id))
                        .map(id => this._modeChip(id)));
            },

            () => {
                const jobs = s.jobs.val;
                const shown = this.plugin.visibleJobIds().length;
                return div({ class: "flex items-center gap-2" },
                    span({ class: "text-xs opacity-60 flex-1 truncate" },
                        this.t("jobs.shownCount", { shown, total: jobs.length })),
                    button({
                        type: "button",
                        class: "btn btn-ghost btn-xs",
                        title: this.t("jobs.soloLatestHint"),
                        onclick: () => this.plugin.showLatestOnly(),
                    }, i({ class: "ph-light ph-eye mr-1" }), this.t("jobs.soloLatest")),
                    button({
                        type: "button",
                        class: "btn btn-ghost btn-xs",
                        title: this.t("jobs.showAllHint"),
                        onclick: () => this.plugin.showAllOutputs(this._matchedJobs()),
                    }, i({ class: "ph-light ph-eye mr-1" }), this.t("jobs.showAll")),
                    button({
                        type: "button",
                        class: "btn btn-ghost btn-xs",
                        disabled: shown ? undefined : "disabled",
                        onclick: () => this.plugin.hideAllOutputs(),
                    }, i({ class: "ph-light ph-eye-slash mr-1" }), this.t("jobs.hideAll")),
                );
            },
        );
    }

    _filterChip(id) {
        return () => {
            const active = this.view.filter.val === id;
            const count = id === "all"
                ? this.plugin.state.jobs.val.length
                : this.plugin.state.jobs.val.filter(job => statusGroup(job.status) === id).length;
            return button({
                type: "button",
                class: `btn btn-xs ${active ? "btn-primary" : "btn-ghost"}`,
                onclick: () => { this.view.filter.val = id; },
            }, this.t(`jobs.filter.${id}`), span({ class: "ml-1 opacity-60" }, String(count)));
        };
    }

    _modeChip(id) {
        return () => {
            const active = this.view.mode.val === id;
            const count = id === "all"
                ? this.plugin.state.jobs.val.length
                : this.plugin.state.jobs.val.filter(job => modeOf(job) === id).length;
            return button({
                type: "button",
                class: `btn btn-xs ${active ? "btn-secondary" : "btn-ghost"}`,
                onclick: () => { this.view.mode.val = id; },
            }, this.t(`jobs.mode.${id}`), span({ class: "ml-1 opacity-60" }, String(count)));
        };
    }

    /**
     * The rows the current search and chips select.
     *
     * "Show all" means what is on screen, not every analysis on the slide —
     * filtering to today's failures and then showing 200 unrelated runs is not
     * what the button reads as.
     */
    _matchedJobs() {
        return selectJobs(this.plugin.state.jobs.val, {
            filter: this.view.filter.val,
            mode: this.view.mode.val,
            search: this.view.search.val,
            appName: this.plugin.workbench.getAppName(),
            statusLabel: (status) => this.t(`jobs.status.${status}`),
        });
    }

    /**
     * Debounced so typing does not re-render the whole list per keystroke; the
     * list is rebuilt wholesale, which is cheap for hundreds of rows but not for
     * one render per character.
     */
    _searchInput(value) {
        clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => { this.view.search.val = value; }, 200);
    }

    _slideLabel() {
        const slideId = this.plugin.state.activeSlideId.val;
        if (!slideId) return this.t("jobs.noSlide");
        const slide = this.plugin.state.slides.val.find(entry => entry.id === slideId);
        return slide?.local_id || slideId;
    }

    // ── list ────────────────────────────────────────────────────────────────

    _list() {
        const s = this.plugin.state;

        return () => {
            if (s.status.val !== "ready") {
                return p({ class: "text-xs opacity-60 p-2" }, this.t("status.connecting"));
            }

            const all = s.jobs.val;
            if (!all.length) return p({ class: "text-xs opacity-60 p-2" }, this.t("jobs.empty"));

            const matched = selectJobs(all, {
                filter: this.view.filter.val,
                mode: this.view.mode.val,
                search: this.view.search.val,
                appName: this.plugin.workbench.getAppName(),
                statusLabel: (status) => this.t(`jobs.status.${status}`),
            });
            if (!matched.length) return p({ class: "text-xs opacity-60 p-2" }, this.t("jobs.noMatches"));

            const shown = matched.slice(0, MAX_ROWS);
            // Read-only follows the ROW's mode now, not the panel's: with every
            // mode in one list, a preprocessing row has no Run button even while
            // the user is preparing a standalone job.
            const latestId = latestCompletedJob(all)?.id;
            const showMode = new Set(all.map(modeOf).filter(Boolean)).size > 1;
            const visible = new Set(this.plugin.visibleJobIds());

            const groups = [];
            for (const group of DAY_GROUPS) {
                const rows = shown.filter(job => dayGroupOf(jobTime(job)) === group);
                if (!rows.length) continue;
                groups.push(div({ class: "text-[10px] uppercase tracking-wide opacity-50 mt-2 mb-1" },
                    this.t(`jobs.group.${group}`)));
                for (const job of rows) groups.push(this._row(job, { latestId, visible, showMode }));
            }

            if (matched.length > shown.length) {
                groups.push(p({ class: "text-xs opacity-60 mt-2" },
                    this.t("jobs.capped", { shown: shown.length, total: matched.length })));
            }
            return div({ class: "flex flex-col gap-1" }, ...groups);
        };
    }

    _row(job, { latestId, visible, showMode }) {
        const expanded = this.view.expandedJobId.val === job.id;
        const readOnly = modeOf(job) === "preprocessing";
        const row = jobRow(this.plugin, job, {
            visible: visible.has(job.id),
            latest: job.id === latestId,
            expanded,
            showMode,
            onToggleVisible: () => this.plugin.toggleJobOutput(job.id),
            onSolo: () => this.plugin.showOnlyJobOutput(job.id),
            onExpand: () => this._expand(job.id),
        });
        return expanded ? div({ class: "flex flex-col" }, row, this._detail(job, readOnly)) : row;
    }

    /**
     * The primitives that are NOT members of a per-region output collection.
     *
     * `queryPrimitives({jobs})` answers everything the job wrote, so a
     * five-rectangle run puts five nameless integers in the value table next to
     * the one average that actually belongs there. Those five are the per-region
     * table's rows; here they would be five blank lines.
     */
    _scalarPrimitives(outputs) {
        const all = outputs?.primitives ?? [];
        const collected = new Set();
        for (const output of outputs?.outputs ?? []) {
            if (output?.spec?.perItem && output.items?.length) {
                for (const item of output.items) {
                    if (item?.reference_id) collected.add(String(item.reference_id));
                }
            }
        }
        // Keyed by what the value describes, because a collection member carries
        // no id of its own in the resolved form. A primitive naming no reference
        // is slide- or run-level and always belongs in the table.
        if (!collected.size) return all;
        return all.filter(p => !p?.reference_id || !collected.has(String(p.reference_id)));
    }

    /** Fetch an output the budget withheld, because the user asked for it. */
    _loadAnyway(jobId) {
        this.view.expandedOutputs.val = undefined;
        this.plugin.loadJobOutputsForced(jobId).then(outputs => {
            if (this.view.expandedJobId.val === jobId) this.view.expandedOutputs.val = outputs;
        }).catch(e => console.warn("empaia-app-ui: forced output load failed", e));
    }

    /** One detail pane at a time: several open at once is a wall, not a comparison. */
    _expand(jobId) {
        if (this.view.expandedJobId.val === jobId) {
            this.view.expandedJobId.val = undefined;
            this.view.expandedOutputs.val = undefined;
            return;
        }
        this.view.expandedJobId.val = jobId;
        this.view.expandedOutputs.val = undefined;
        // Fetched on demand: pre-loading every run's results would put one query
        // per analysis on the wire for rows nobody opened.
        this.plugin.loadJobOutputs(jobId).then(outputs => {
            if (this.view.expandedJobId.val === jobId) this.view.expandedOutputs.val = outputs;
        }).catch(e => {
            console.warn("empaia-app-ui: analysis outputs failed to load", e);
            if (this.view.expandedJobId.val === jobId) {
                this.view.expandedOutputs.val =
                    { primitives: [], pixelmaps: [], annotations: [], lockedInputs: [] };
            }
        });
    }

    /**
     * The expanded analysis.
     *
     * Laid out as *one meta row* — what it produced on the left, what you can do
     * to it on the right — followed only by sections that have something to say.
     * Every part used to get its own full-width line, including a heading above
     * an "there are none" sentence and a lone trash button, which is how a run
     * with a single annotation filled half the window with whitespace.
     */
    _detail(job, readOnly) {
        const shell = (...children) => div(
            { class: "rounded-b bg-base-100 border border-base-200 px-2 py-1.5 flex flex-col gap-1.5" },
            ...children.filter(Boolean),
        );

        return () => {
            const outputs = this.view.expandedOutputs.val;
            const visible = this.plugin.visibleJobIds().includes(job.id);

            // What the click can actually honour. While the analysis is shown
            // that is the canvas, not the query — a count the focus button
            // cannot frame is what made the panel promise "1 annotations" and
            // then answer "nothing to navigate to". The wire count still shows
            // (as a plain chip) in the gap between "shown" and "imported", so a
            // reconcile in flight does not read as "produced nothing".
            const resident = visible ? this.plugin.countJobOutput(job.id) : 0;
            const framable = visible && resident > 0;

            const summary = outputs
                ? outputChips(this.plugin, outputs, {
                    annotationCount: framable ? resident : (outputs.annotations ?? []).length,
                    visible: framable,
                    declaredCount: Object.keys(job.outputs ?? {}).length,
                    inputsVisible: visible,
                    onFocus: () => this.plugin.focusJobOutput(job.id),
                    onFocusInputs: (ids) => this.plugin.focusAnnotations(ids),
                    onLoadAnyway: () => this._loadAnyway(job.id),
                })
                : div({ class: "text-xs opacity-60" },
                    span({ class: "loading loading-spinner loading-xs mr-1" }),
                    this.t("jobs.loadingOutputs"));

            return shell(
                // Messages first: a failure is the reason the row was opened.
                jobMessages(this.plugin, job),
                div({ class: "flex items-start gap-2" },
                    div({ class: "flex-1 min-w-0" }, summary),
                    jobActions(this.plugin, job, { readOnly }),
                ),
                // Per-region first: for an app that computes one value per region
                // this IS the result, and the slide-wide scalars below it are the
                // summary of it.
                outputs && createRegionResultsSection(this.plugin, outputs, {
                    onFocusRegion: (regionId) => this.plugin.focusAnnotations([regionId]),
                }),
                outputs && createResultsSection(this.plugin, this._scalarPrimitives(outputs)),
                outputs && createPixelmapsSection(this.plugin, outputs.pixelmaps),
                span({ class: "text-[10px] opacity-40 font-mono break-all select-all" }, job.id),
            );
        };
    }

}
