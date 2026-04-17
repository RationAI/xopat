/**
 * History provider is logics that can stub history steps without actually
 * explicitly putting anything inside history state. For example, user is creating
 * a polygon. 'undo' step can undo individual points, but only changes the internal
 * creation logics state, not pushing anything to the history. Providers override
 * the history API and only IF no provider handles the step, the original history logics fires.
 * @type {Window.XOpatHistory.XOpatHistoryProvider}
 */
abstract class XOpatHistoryProvider implements HistoryProvider {
    get importance(): number { return 0; }

    async undo(): Promise<boolean> {
        throw new Error("Not implemented");
    }

    async redo(): Promise<boolean> {
        throw new Error("Not implemented");
    }

    canUndo(): boolean {
        throw new Error("Not implemented");
    }

    canRedo(): boolean {
        throw new Error("Not implemented");
    }

    /**
     * Reset transient provider state without unregistering the provider.
     * Default noop.
     */
    async reset(): Promise<void> {
    }
}

/**
 * XOpatHistory is a history manager that can be used to track user actions.
 * @type {Window.XOpatHistory}
 */
const XOpatHistory = class XOpatHistory extends OpenSeadragon.EventSource {
    static XOpatHistoryProvider: typeof XOpatHistoryProvider = XOpatHistoryProvider;

    _buffer: Array<{ forward: () => any; backward: () => any; meta?: HistoryEntryMeta } | null>;
    _buffidx: number;
    _lastValidIndex: number;
    _providers: XOpatHistoryProvider[];
    BUFFER_LENGTH: number;
    _recordingDepth: number;
    _queue: Promise<any>;
    _busyCount: number;
    _queuedCount: number;

    constructor(size = 99) {
        super();
        this._buffer = [];
        // points to the current state in the redo/undo index in circular buffer
        this._buffidx = -1;
        // points to the most recent object in cache, when undo action comes full loop to _lastValidIndex
        // it means the redo action went full circle on the buffer, and we cannot further undo,
        // if we set this index to buffindex, we throw away ability to redo (diverging future)
        this._lastValidIndex = -1;
        this._providers = [];
        this.BUFFER_LENGTH = size;
        this._recordingDepth = 0;
        this._queue = Promise.resolve();
        this._busyCount = 0;
        this._queuedCount = 0;
    }

    /**
     * Outsource history logics to external API.
     * Returns an unregister callback so providers can clean themselves up.
     * @param {HistoryProvider} provider history api provider
     */
    registerProvider(provider: HistoryProvider) {
        const typed = provider as XOpatHistoryProvider;
        if (this._providers.includes(typed)) {
            return () => this.unregisterProvider(typed);
        }

        this._providers.push(typed);
        this._providers.sort((a, b) => (b.importance || 0) - (a.importance || 0));
        this.raiseEvent('register-provider', { provider: typed });

        return () => this.unregisterProvider(typed);
    }

    unregisterProvider(provider: HistoryProvider) {
        const typed = provider as XOpatHistoryProvider;
        const index = this._providers.indexOf(typed);
        if (index < 0) return false;

        this._providers.splice(index, 1);
        this.raiseEvent('unregister-provider', { provider: typed });
        return true;
    }

    /**
     * True only for committed stack history, not transient provider state.
     */
    hasStackUndo() {
        return !!this._buffer[this._buffidx];
    }

    /**
     * Check if history is not fully empty.
     */
    hasAnyStackHistory() {
        return this.hasStackUndo() || this.hasStackRedo();
    }

    /**
     * True only for committed stack redo, not transient provider state.
     */
    hasStackRedo() {
        return this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex;
    }

    /**
     * Returns the metadata of the history entry that would be undone next, or undefined.
     * Useful for showing contextual undo labels like "Undo {{action}}".
     */
    currentUndoMeta(): HistoryEntryMeta | undefined {
        return this._buffer[this._buffidx]?.meta;
    }

    /**
     * Returns the metadata of the history entry that would be redone next, or undefined.
     * Useful for showing contextual redo labels like "Redo {{action}}".
     */
    currentRedoMeta(): HistoryEntryMeta | undefined {
        const nextIndex = (this._buffidx + 1) % this.BUFFER_LENGTH;
        if (!this.hasStackRedo()) return undefined;
        return this._buffer[nextIndex]?.meta;
    }

    clear(options: { resetProviders?: boolean, reason?: string } = {}): Promise<void> {
        return this._enqueue('clear', async () => {
            this._buffer = [];
            this._buffidx = -1;
            this._lastValidIndex = -1;

            if (options.resetProviders) {
                for (const provider of [...this._providers]) {
                    if (typeof provider.reset === "function") {
                        await this._runAction(() => provider.reset(), 'provider.reset');
                    }
                }
            }

            try {
                this.raiseEvent('clear', options);
            } catch (e) {
                console.error("Failed handler clear history!", e);
            }
        });
    }

    /**
     * Check if undo is possible
     * @return {boolean}
     */
    canUndo() {
        for (let historyProvider of this._providers) {
            if (historyProvider.canUndo()) return true;
        }
        return this.hasStackUndo();
    }

    /**
     * Check if redo is possible
     * @return {boolean}
     */
    canRedo() {
        for (let historyProvider of this._providers) {
            if (historyProvider.canRedo()) return true;
        }
        return this.hasStackRedo();
    }


    /**
     * Set the number of steps possible to go in the past
     * @param {number} value size of the history
     */
    set size(value: number) {
        this.BUFFER_LENGTH = Math.max(2, value);
        this.raiseEvent('change-size', { size: value });
    }

    /**
     * Push a new action to the history buffer. The function forward is executed immediately -
     * you must not call this method/logics manually.
     * @param {*} forward function to execute the forward (redo) operation, it is executed once upon call
     * @param {*} backward function to execute the backward (undo) operation
     * @param {HistoryEntryMeta} [meta] optional metadata stored with the entry.
     *   Include a `name` string so the UI can show e.g. "Undo {{action}}".
     * @return {any} return value of the forward function executed
     */
    push(forward: () => any, backward: () => any, meta?: HistoryEntryMeta): Promise<any> {
        if (typeof forward !== 'function' || typeof backward !== 'function') {
            throw new Error("Both forward and backward must be functions.");
        }

        return this._enqueue('push', async () => {
            if (!this.isRecordingEnabled) return;

            const result = await this._runAction(() => forward(), 'push');

            // Commit only after forward() succeeds.
            this._commitEntry(forward, backward, meta);
            return result;
        });
    }

    /**
     * Push action without executing forward. Use this carefully, prefer using push() if possible.
     * @param {HistoryEntryMeta} [meta] optional metadata stored with the entry.
     *   Include a `name` string so the UI can show e.g. "Undo {{action}}".
     */
    pushExecuted(forward: () => any, backward: () => any, meta?: HistoryEntryMeta): Promise<void> {
        if (typeof forward !== 'function' || typeof backward !== 'function') {
            throw new Error("Both forward and backward must be functions.");
        }

        return this._enqueue('pushExecuted', async () => {
            if (!this.isRecordingEnabled) return;
            this._commitEntry(forward, backward, meta);
        });
    }

    get isRecordingEnabled() {
        return this._recordingDepth < 1;
    }

    async withoutRecording<T>(operation: () => Promise<T> | T): Promise<T> {
        this._recordingDepth++;
        try {
            return await operation();
        } finally {
            this._recordingDepth = Math.max(0, this._recordingDepth - 1);
        }
    }

    /**
     * Go step back in the history.
     */
    undo(): Promise<boolean> {
        return this._enqueue('undo', async () => {
            if (!this.canUndo()) return false;

            for (let historyProvider of this._providers) {
                if (await this._runAction(() => historyProvider.undo(), 'provider.undo')) {
                    try {
                        this.raiseEvent('undo', { provider: historyProvider });
                    } catch (e) {
                        console.error("Failed handler on execute undo action", e);
                    }
                    return true;
                }
            }

            const currentIndex = this._buffidx;
            const entry = this._buffer[currentIndex];
            if (!entry) return false;

            await this._runAction(() => entry.backward(), 'undo');

            // Commit only after backward() succeeds.
            this._buffidx = (currentIndex - 1 + this.BUFFER_LENGTH) % this.BUFFER_LENGTH;

            try {
                this.raiseEvent('undo', { step: entry.meta });
            } catch (e) {
                console.error("Failed handler on execute undo action", e);
            }
            return true;
        });
    }

    /**
     * Go step forward in the history.
     */
    redo(): Promise<boolean> {
        return this._enqueue('redo', async () => {
            if (!this.canRedo()) return false;

            for (let historyProvider of this._providers) {
                if (await this._runAction(() => historyProvider.redo(), 'provider.redo')) {
                    try {
                        this.raiseEvent('redo', { provider: historyProvider });
                    } catch (e) {
                        console.error("Failed handler on execute redo action", e);
                    }
                    return true;
                }
            }

            const nextIndex = (this._buffidx + 1) % this.BUFFER_LENGTH;
            const entry = this._buffer[nextIndex];
            if (!entry) return false;

            await this._runAction(() => entry.forward(), 'redo');

            // Commit only after forward() succeeds.
            this._buffidx = nextIndex;

            try {
                this.raiseEvent('redo', { step: entry.meta });
            } catch (e) {
                console.error("Failed handler on execute redo action", e);
            }
            return true;
        });
    }

    _emitBusyChange() {
        try {
            this.raiseEvent('history-busy-change', {
                busy: this.isBusy(),
                queued: this._queuedCount,
                running: this._busyCount,
                pending: this.pendingCount(),
            });
        } catch (e) {
            console.error("Failed history busy event", e);
        }
    }

    _enqueue<T>(actionName: string, operation: () => MaybePromise<T>): Promise<T> {
        this._queuedCount++;
        this._emitBusyChange();

        const run = async () => {
            this._queuedCount = Math.max(0, this._queuedCount - 1);
            this._busyCount++;
            this._emitBusyChange();

            try {
                return await operation();
            } finally {
                this._busyCount = Math.max(0, this._busyCount - 1);
                this._emitBusyChange();
            }
        };

        const next = this._queue.then(run, run);
        this._queue = next.then(() => undefined, () => undefined);
        return next;
    }

    async _runAction<T>(action: () => MaybePromise<T>, actionName: string): Promise<T> {
        try {
            return await action();
        } catch (error) {
            console.error(`History ${actionName} failed.`, error);
            this.raiseEvent('error', { action: actionName, error });
            throw error;
        }
    }

    _commitEntry(forward: () => any, backward: () => any, meta?: HistoryEntryMeta) {
        this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
        this._buffer[this._buffidx] = { forward, backward, meta };
        this._lastValidIndex = this._buffidx;
        try {
            this.raiseEvent('push', { meta });
        } catch (e) {
            console.error("Failed history push event", e);
        }
    }

    isBusy(): boolean {
        return this._busyCount > 0;
    }

    pendingCount(): number {
        return this._busyCount + this._queuedCount;
    }

    whenIdle(): Promise<void> {
        return this._queue.then(() => undefined);
    }
};

export {
    XOpatHistory,
    XOpatHistoryProvider
};
(window as any).XOpatHistory = XOpatHistory;
