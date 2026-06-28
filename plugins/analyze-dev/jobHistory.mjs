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
            return this._plugin.getOption('jobHistory') || [];
        } catch (_) {
            return [];
        }
    }

    recordJob(entry) {
        const history = this.getHistory();
        history.unshift(entry);
        if (history.length > 50) history.splice(50);
        this._plugin.setOption('jobHistory', history);
        this._refreshModal();
    }

    updateJob(jobId, patch) {
        const history = this.getHistory();
        const idx = history.findIndex(e => e.jobId === jobId);
        if (idx !== -1) {
            history[idx] = { ...history[idx], ...patch };
            this._plugin.setOption('jobHistory', history);
            this._refreshModal();
        }
    }

    showModal() {
        // implemented in Task 2
    }

    _refreshModal() {
        if (this._modal && this._modalBody) {
            this._renderList(this._modalBody);
        }
    }

    _renderList(_container) {
        // implemented in Task 2
    }

    _renderEntry(_entry) {
        // implemented in Task 2
        return document.createElement('div');
    }

    _showEntryError(_card, _message) {
        // implemented in Task 2
    }
}

window.JobHistory = JobHistory;
