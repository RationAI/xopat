function _fmtTs(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

class JobHistory {
    constructor({ plugin, overlay, onShow, onRerun }) {
        this._plugin = plugin;
        this._overlay = overlay;
        this._onShow = onShow;
        this._onRerun = onRerun;
        this._modal = null;
        this._modalBody = null;
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
        this._plugin.setOption('jobHistory', JSON.stringify(history));
        this._refreshModal();
    }

    updateJob(jobId, patch) {
        const history = this.getHistory();
        const idx = history.findIndex(e => e.jobId === jobId);
        if (idx !== -1) {
            history[idx] = { ...history[idx], ...patch };
            this._plugin.setOption('jobHistory', JSON.stringify(history));
            this._refreshModal();
        }
    }

    showModal() {
        const { FloatingWindow } = globalThis.UI;
        if (this._modal) {
            this._modal.focus();
            return;
        }
        const width = 480, height = 500;
        this._modal = new FloatingWindow({
            id: 'analyze-dev-job-history',
            title: 'Job History',
            width,
            height,
            startLeft: Math.round((window.innerWidth - width) / 2),
            startTop: Math.round((window.innerHeight - height) / 2),
            onClose: () => { this._modal = null; this._modalBody = null; },
        });
        this._modal.attachTo(document.body);
        this._modalBody = document.createElement('div');
        this._modalBody.className = 'flex flex-col h-full overflow-hidden';
        this._renderList(this._modalBody);
        this._modal.setBody(this._modalBody);
        this._modal.focus();
    }

    _refreshModal() {
        if (this._modal && this._modalBody) {
            this._renderList(this._modalBody);
        }
    }

    _renderList(container) {
        container.innerHTML = '';
        const history = this.getHistory();

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between px-3 py-2 border-b border-base-300 flex-shrink-0';
        const count = document.createElement('span');
        count.className = 'text-xs opacity-60';
        count.textContent = history.length
            ? `${history.length} job${history.length === 1 ? '' : 's'} run`
            : 'No jobs run yet.';
        header.appendChild(count);
        if (history.length) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'btn btn-xs btn-ghost';
            clearBtn.textContent = 'Clear all';
            clearBtn.addEventListener('click', () => {
                this._plugin.setOption('jobHistory', '[]');
                this._renderList(container);
            });
            header.appendChild(clearBtn);
        }
        container.appendChild(header);

        if (!history.length) {
            const empty = document.createElement('div');
            empty.className = 'flex-1 flex items-center justify-center text-sm opacity-50';
            empty.textContent = 'No jobs run yet.';
            container.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'flex-1 overflow-auto p-2';
        for (const entry of history) {
            list.appendChild(this._renderEntry(entry));
        }
        container.appendChild(list);
    }

    _renderEntry(entry) {
        const isVisible = this._overlay._jobStore?.has(entry.jobId) ?? false;

        const card = document.createElement('div');
        card.className = 'p-2 rounded-box bg-base-200 mb-1' + (isVisible ? ' ring ring-primary ring-offset-1' : '');

        const meta = document.createElement('div');
        meta.className = 'flex items-center gap-1 text-xs flex-wrap';

        const dot = document.createElement('span');
        dot.className = 'w-2 h-2 rounded-full flex-shrink-0 ' +
            (entry.status === 'COMPLETED' ? 'bg-success' : 'bg-error');
        meta.appendChild(dot);

        const name = document.createElement('span');
        name.className = 'font-medium';
        name.textContent = entry.name;
        meta.appendChild(name);

        const appSpan = document.createElement('span');
        appSpan.className = 'opacity-50';
        appSpan.textContent = `· ${entry.appName || entry.appId?.slice(0, 8) || '?'}`;
        meta.appendChild(appSpan);

        const tsSpan = document.createElement('span');
        tsSpan.className = 'opacity-50';
        tsSpan.textContent = `· ${_fmtTs(entry.timestamp)}`;
        meta.appendChild(tsSpan);

        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'flex gap-1 mt-1';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-xs ' + (isVisible ? 'btn-primary' : 'btn-ghost');
        toggleBtn.textContent = isVisible ? 'Hide' : 'Show';
        toggleBtn.addEventListener('click', async () => {
            if (isVisible) {
                await this._overlay.clearJob(entry.jobId);
                this._renderList(this._modalBody);
            } else {
                toggleBtn.disabled = true;
                toggleBtn.textContent = '…';
                let errorShown = false;
                try {
                    await this._onShow(entry);
                } catch (e) {
                    console.error('[job-history] show failed', e);
                    this._showEntryError(card, e?.message || 'Failed to load annotations');
                    errorShown = true;
                } finally {
                    toggleBtn.disabled = false;
                    toggleBtn.textContent = 'Show';
                    if (!errorShown) this._renderList(this._modalBody);
                }
            }
        });
        actions.appendChild(toggleBtn);

        const rerunBtn = document.createElement('button');
        rerunBtn.type = 'button';
        rerunBtn.className = 'btn btn-xs btn-ghost';
        rerunBtn.textContent = 'Rerun';
        rerunBtn.addEventListener('click', async () => {
            rerunBtn.disabled = true;
            rerunBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
            let errorShown = false;
            try {
                await this._onRerun(entry);
            } catch (e) {
                if (e?.message !== 'cancelled') {
                    console.error('[job-history] rerun failed', e);
                    this._showEntryError(card, e?.message || 'Rerun failed');
                    errorShown = true;
                }
            } finally {
                rerunBtn.disabled = false;
                rerunBtn.textContent = 'Rerun';
                if (!errorShown) this._renderList(this._modalBody);
            }
        });
        actions.appendChild(rerunBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-xs btn-ghost text-error';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', () => {
            this._plugin.setOption('jobHistory', this.getHistory().filter(e => e.jobId !== entry.jobId));
            this._renderList(this._modalBody);
        });
        actions.appendChild(deleteBtn);

        card.appendChild(actions);
        return card;
    }

    _showEntryError(card, message) {
        const existing = card.querySelector('.entry-error');
        if (existing) existing.remove();
        const err = document.createElement('div');
        err.className = 'entry-error text-xs text-error mt-1';
        err.textContent = message;
        card.appendChild(err);
        setTimeout(() => { err.remove(); this._refreshModal(); }, 4000);
    }
}

window.JobHistory = JobHistory;
