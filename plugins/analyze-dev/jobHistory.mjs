const { div, span, button, input, select, option, pre, i } = globalThis.van.tags;

function _fmtTs(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

function _appLabel(entry) {
    return entry.appName || entry.appId?.slice(0, 8) || '?';
}

const spinner = () => span({ class: 'loading loading-spinner loading-xs' });

class JobHistory {
    constructor({ plugin, overlay, onShow, onRerun, onFetchResults }) {
        this._plugin = plugin;
        this._overlay = overlay;
        this._onShow = onShow;
        this._onRerun = onRerun;
        this._onFetchResults = onFetchResults;
        this._modal = null;
        this._resultsCache = new Map();
        // Bumped on every history or overlay visibility change; the panel re-renders from it.
        this.revision = van.state(0);
        this.searchQuery = van.state('');
        this.appFilter = van.state('');
        // jobId -> message, kept outside the cards so it survives a re-render
        this.entryErrors = van.state({});
    }

    getHistory() {
        try {
            const raw = this._plugin.getOption('jobHistory');
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    recordJob(entry) {
        const history = this.getHistory();
        history.unshift(entry);
        if (history.length > 50) history.splice(50);
        this._saveHistory(history);
    }

    updateJob(jobId, patch) {
        const history = this.getHistory();
        const idx = history.findIndex(e => e.jobId === jobId);
        if (idx !== -1) {
            history[idx] = { ...history[idx], ...patch };
            this._saveHistory(history);
        }
    }

    deleteJob(jobId) {
        this._saveHistory(this.getHistory().filter(e => e.jobId !== jobId));
    }

    clearHistory() {
        this._saveHistory([]);
    }

    _saveHistory(history) {
        this._plugin.setOption('jobHistory', JSON.stringify(history));
        this.refresh();
    }

    refresh() {
        this.revision.val++;
    }

    getAppOptions(history) {
        const names = new Set(history.map(_appLabel));
        return [...names].sort((a, b) => a.localeCompare(b));
    }

    getFilteredHistory(history) {
        const query = this.searchQuery.val.trim().toLowerCase();
        const appFilter = this.appFilter.val;
        return history.filter(entry => {
            if (query && !entry.name?.toLowerCase().includes(query)) return false;
            if (appFilter && _appLabel(entry) !== appFilter) return false;
            return true;
        });
    }

    isJobVisible(jobId) {
        const storeEntry = this._overlay._jobStore?.get(jobId);
        return storeEntry ? storeEntry.visible !== false : false;
    }

    isJobLoaded(jobId) {
        return !!this._overlay._jobStore?.get(jobId);
    }

    setJobVisible(jobId, visible) {
        this._overlay.setJobVisible(jobId, visible);
        this.refresh();
    }

    showEntryError(jobId, message) {
        this.entryErrors.val = { ...this.entryErrors.val, [jobId]: message };
        setTimeout(() => {
            if (this.entryErrors.val[jobId] !== message) return;
            const { [jobId]: _, ...rest } = this.entryErrors.val;
            this.entryErrors.val = rest;
        }, 4000);
    }

    showModal() {
        const { FloatingWindow } = globalThis.UI;
        if (this._modal) {
            this._modal.focus();
            return;
        }
        this.searchQuery.val = '';
        this.appFilter.val = '';
        this._resultsCache = new Map();
        const width = 480, height = 500;
        this._modal = new FloatingWindow({
            id: 'analyze-dev-job-history',
            title: 'Job History',
            width,
            height,
            startLeft: Math.round((window.innerWidth - width) / 2),
            startTop: Math.round((window.innerHeight - height) / 2),
            onClose: () => { this._modal = null; },
        });
        this._modal.attachTo(document.body);
        this._modal.setBody(new JobHistoryPanel({ history: this }));
        this._modal.focus();
    }
}

/**
 * Body of the job history window: header with count, search/app filter, and the card list.
 * The search input is rendered once so typing does not lose focus; only the count, the app
 * options and the list are reactive.
 */
class JobHistoryPanel extends UI.BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this.history = options.history;
        this.classMap.base = 'flex flex-col h-full overflow-hidden';
        this.refreshClassState();
    }

    create() {
        const history = this.history;
        const entries = () => {
            history.revision.val;
            return history.getHistory();
        };

        return div({ ...this.commonProperties },
            div({ class: 'flex items-center justify-between px-3 py-2 border-b border-base-300 flex-shrink-0' },
                () => span({ class: 'text-xs opacity-60' }, this._countLabel(entries())),
                () => entries().length
                    ? button({ type: 'button', class: 'btn btn-xs btn-ghost', onclick: () => history.clearHistory() }, 'Clear all')
                    : span(),
            ),
            () => entries().length ? this._renderFilterBar() : span({ class: 'hidden' }),
            () => this._renderList(entries()),
        );
    }

    _countLabel(all) {
        const history = this.history;
        const total = all.length;
        if (!total) return 'No jobs run yet.';
        if (history.searchQuery.val || history.appFilter.val) {
            return `${history.getFilteredHistory(all).length} of ${total} job${total === 1 ? '' : 's'}`;
        }
        return `${total} job${total === 1 ? '' : 's'} run`;
    }

    _renderFilterBar() {
        const history = this.history;
        const appOptions = history.getAppOptions(history.getHistory());
        if (history.appFilter.rawVal && !appOptions.includes(history.appFilter.rawVal)) {
            history.appFilter.val = '';
        }
        const appSelect = select({
                class: 'select select-xs w-24',
                onchange: e => { history.appFilter.val = e.target.value; },
            },
            option({ value: '' }, 'All apps'),
            ...appOptions.map(name => option({ value: name }, name)),
        );
        appSelect.value = history.appFilter.rawVal;

        return div({ class: 'flex items-center gap-2 px-3 py-2 border-b border-base-300 flex-shrink-0' },
            input({
                type: 'text',
                class: 'input input-xs w-32',
                placeholder: 'Search by job name...',
                value: history.searchQuery.rawVal,
                oninput: e => { history.searchQuery.val = e.target.value; },
            }),
            appSelect,
        );
    }

    _renderList(all) {
        if (!all.length) {
            return div({ class: 'flex-1 flex items-center justify-center text-sm opacity-50' }, 'No jobs run yet.');
        }
        const filtered = this.history.getFilteredHistory(all);
        return div({ class: 'flex-1 overflow-auto p-2' },
            filtered.length
                ? filtered.map(entry => new JobHistoryCard({ history: this.history, entry }).create())
                : div({ class: 'flex items-center justify-center text-sm opacity-50 py-4' }, 'No jobs match your search/filter.'),
        );
    }
}

/** One history entry: status, name, show/hide toggle and the collapsible action row. */
class JobHistoryCard extends UI.BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this.history = options.history;
        this.entry = options.entry;
        this.moreOpen = van.state(false);
        this.resultsOpen = van.state(false);
        this.busy = van.state('');
        const visible = this.history.isJobVisible(this.entry.jobId);
        this.classMap.base = 'p-2 rounded-box bg-base-200 mb-1';
        this.classMap.ring = visible ? 'ring ring-primary ring-offset-1' : '';
        this.refreshClassState();
    }

    create() {
        const { entry, history } = this;
        return div({ ...this.commonProperties },
            div({ class: 'flex items-center gap-1 text-xs flex-wrap' },
                span({ class: 'w-2 h-2 rounded-full flex-shrink-0 ' + (entry.status === 'COMPLETED' ? 'bg-success' : 'bg-error') }),
                span({ class: 'font-medium' }, entry.name),
                span({ class: 'opacity-50' }, `· ${_appLabel(entry)}`),
                span({ class: 'opacity-50' }, `· ${_fmtTs(entry.timestamp)}`),
            ),
            div({ class: 'flex gap-1 mt-1 items-center' },
                this._renderToggleButton(),
                button({
                    type: 'button',
                    class: 'btn btn-xs btn-square btn-ghost',
                    title: 'More actions',
                    onclick: () => { this.moreOpen.val = !this.moreOpen.val; },
                }, i({ class: 'ph-light ph-dots-three' })),
            ),
            div({ class: () => this.moreOpen.val ? '' : 'hidden' },
                div({ class: 'flex gap-1 mt-1' },
                    this._renderActionButton('rerun', 'Rerun', () => this._rerun()),
                    entry.status === 'COMPLETED'
                        ? this._renderActionButton('results', 'Results', () => this._toggleResults())
                        : null,
                    button({
                        type: 'button',
                        class: 'btn btn-xs btn-ghost text-error',
                        onclick: () => history.deleteJob(entry.jobId),
                    }, '×'),
                ),
                () => this.resultsOpen.val
                    ? this._renderResults(history._resultsCache.get(entry.jobId) || [])
                    : span({ class: 'hidden' }),
            ),
            () => {
                const message = history.entryErrors.val[entry.jobId];
                return message ? div({ class: 'text-xs text-error mt-1' }, message) : span({ class: 'hidden' });
            },
        );
    }

    _renderToggleButton() {
        const visible = this.history.isJobVisible(this.entry.jobId);
        return button({
            type: 'button',
            class: 'btn btn-xs btn-square ' + (visible ? 'btn-primary' : 'btn-ghost'),
            title: visible ? 'Hide annotations' : 'Show annotations',
            disabled: () => this.busy.val === 'toggle',
            onclick: () => this._toggleVisibility(visible),
        }, () => this.busy.val === 'toggle'
            ? spinner()
            : i({ class: `ph-light ${visible ? 'ph-eye' : 'ph-eye-slash'}` }));
    }

    _renderActionButton(key, label, onclick) {
        return button({
            type: 'button',
            class: 'btn btn-xs btn-ghost',
            disabled: () => this.busy.val === key,
            onclick,
        }, () => this.busy.val === key ? spinner() : span(label));
    }

    async _toggleVisibility(visible) {
        const { entry, history } = this;
        if (visible || history.isJobLoaded(entry.jobId)) {
            history.setJobVisible(entry.jobId, !visible);
            return;
        }
        this.busy.val = 'toggle';
        try {
            await history._onShow(entry);
            history.refresh();
        } catch (e) {
            console.error('[job-history] show failed', e);
            history.showEntryError(entry.jobId, e?.message || 'Failed to load annotations');
        } finally {
            this.busy.val = '';
        }
    }

    async _rerun() {
        const { entry, history } = this;
        this.busy.val = 'rerun';
        try {
            await history._onRerun(entry);
            history.refresh();
        } catch (e) {
            if (e?.message !== 'cancelled') {
                console.error('[job-history] rerun failed', e);
                history.showEntryError(entry.jobId, e?.message || 'Rerun failed');
            }
        } finally {
            this.busy.val = '';
        }
    }

    async _toggleResults() {
        const { entry, history } = this;
        if (history._resultsCache.has(entry.jobId)) {
            this.resultsOpen.val = !this.resultsOpen.val;
            return;
        }
        this.busy.val = 'results';
        try {
            history._resultsCache.set(entry.jobId, await history._onFetchResults(entry));
            this.resultsOpen.val = true;
        } catch (e) {
            console.error('[job-history] fetch results failed', e);
            history.showEntryError(entry.jobId, e?.message || 'Failed to fetch results');
        } finally {
            this.busy.val = '';
        }
    }

    _renderResults(valueOutputs) {
        if (!valueOutputs.length) {
            return div({ class: 'mt-1 text-xs opacity-50 py-1' }, 'No output values for this job.');
        }
        return div({ class: 'mt-1' }, valueOutputs.map(output => renderOutputValues(output, 'text-xs')));
    }
}

/** One output collection as a heading and an index: value list. */
function renderOutputValues({ key, items }, headingSize = 'text-sm') {
    return div({ class: 'mb-2' },
        div({ class: `${headingSize} font-medium mb-1` }, key),
        pre({ class: 'text-xs font-mono opacity-80 whitespace-pre-wrap' },
            items.map((item, idx) => `${idx}: ${Number(item.value).toFixed(4)}`).join('\n')),
    );
}

window.JobHistory = JobHistory;
window.renderJobOutputValues = renderOutputValues;
