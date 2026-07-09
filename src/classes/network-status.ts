/**
 * NetworkStatus — the single core source of truth for browser network
 * connectivity. It seeds its state from `navigator.onLine`, attaches the
 * `window` `online`/`offline` listeners exactly once, and re-emits genuine
 * transitions as a `network-status-changed` event.
 *
 * UI (an app-bar pill + toasts, wired in `app.ts`) and subsystems (the IO
 * pipeline, see `classes/io/io-resource.ts`) subscribe here instead of each
 * re-implementing `navigator.onLine` handling, so everything agrees on one
 * connectivity state.
 *
 * Exposed as `APPLICATION_CONTEXT.networkStatus` (constructed by the
 * application-context factory alongside `history` / `httpClient`).
 *
 * @extends OpenSeadragon.EventSource
 * @fires NetworkStatus#network-status-changed
 */
class NetworkStatus extends OpenSeadragon.EventSource {
    private static _instance: NetworkStatus | null = null;

    /** Current connectivity, `true` when the browser reports online. */
    private _online: boolean;

    private constructor() {
        super();
        // Optimistic default when navigator is unavailable (SSR/headless).
        this._online = typeof navigator === "undefined"
            ? true
            : navigator.onLine !== false;

        if (typeof window !== "undefined") {
            window.addEventListener("online", () => this._set(true));
            window.addEventListener("offline", () => this._set(false));
        }
    }

    /**
     * Lazy singleton accessor.
     * @returns {NetworkStatus}
     */
    static instance(): NetworkStatus {
        if (!NetworkStatus._instance) {
            NetworkStatus._instance = new NetworkStatus();
        }
        return NetworkStatus._instance;
    }

    /** @returns {boolean} true when the browser reports being online. */
    get isOnline(): boolean {
        return this._online;
    }

    /** @returns {boolean} true when the browser reports being offline. */
    get isOffline(): boolean {
        return !this._online;
    }

    /**
     * Apply a new connectivity state, emitting only on an actual change so
     * repeated `online`→`online` browser events don't spam subscribers.
     * @private
     */
    private _set(online: boolean): void {
        if (this._online === online) return;
        this._online = online;
        /**
         * Raised when connectivity flips. Not raised on redundant events.
         * @event NetworkStatus#network-status-changed
         * @property {boolean} online current connectivity
         */
        this.raiseEvent("network-status-changed", { online });
    }
}

export { NetworkStatus };
