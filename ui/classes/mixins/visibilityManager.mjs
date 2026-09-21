/**
 * @type {FlagManagerLike}
 */
export class VisibilityManager {

    /**
     * @param {BaseComponent|string} component or component id
     */
    constructor(component) {
        this.id = typeof component === "string" ? component : component.id;
        this._visible = undefined;
        this._changeHandlers = undefined;
    }

    /**
     * Subscribe to visibility flips (fires after each on()/off(), including the
     * initial state applied by init()/initOnRootNode()).
     * @param {(visible: boolean) => void} handler
     * @returns {() => void} unsubscribe
     */
    onChange(handler) {
        (this._changeHandlers ||= new Set()).add(handler);
        return () => this._changeHandlers?.delete(handler);
    }

    /** @private */
    _notifyChange() {
        if (!this._changeHandlers) return;
        for (const handler of this._changeHandlers) {
            try {
                handler(!!this._visible);
            } catch (e) {
                console.error("VisibilityManager change handler failed:", e);
            }
        }
    }

    on() {
        console.warn("show called prematurely!");
    }

    off() {
        console.warn("off called prematurely!");
    }

    /**
     * Instead of init(...), you can provide a Node object to implement visibility on [facade].
     * The visibility manager will toggle 'display-none' class on the node.
     *
     * Note that you need to call this method each time the underlying node changes.
     * @param {Node} node
     * @param {boolean} visibleNow true if the object is currently visible (or would be visible if it was added to DOM)
     */
    initOnRootNode(node, visibleNow = true) {
        this._nRef = new WeakRef(node);
        this.on = () => {
            this._visible = true;
            this._nRef.deref()?.classList.remove("display-none");
            this._notifyChange();
        };
        this.off = () => {
            this._visible = false;
            this._nRef.deref()?.classList.add("display-none");
            this._notifyChange();
        };
        this.defaultVisible = visibleNow === undefined ?
            !!APPLICATION_CONTEXT.AppCache.get(`v::${this.id}`, true) : !!visibleNow;
        this._visible = this.defaultVisible;

        if (this.defaultVisible) {
            this.on();
        } else {
            this.off();
        }
        return this;
    }

    /**
     * Init custom visibility logics.
     * @param {function} on function that ons the object
     * @param {function} off function that offs the object
     * @param {?boolean} visibleNow true if the object is currently visible (or would be visible if it was added to DOM),
     *   undefined if the visibility is not known and the manager should take care of it
     */
    init(on, off, visibleNow = undefined) {
        const userOn = on, userOff = off;
        this.on = () => { this._visible = true; userOn(); this._notifyChange(); };
        this.off = () => { this._visible = false; userOff(); this._notifyChange(); };
        this.defaultVisible = visibleNow === undefined ?
            !!APPLICATION_CONTEXT.AppCache.get(`v::${this.id}`, true) : !!visibleNow;
        this._visible = this.defaultVisible;

        if (this.defaultVisible) {
            this.on();
        } else {
            this.off();
        }
        return this;
    }

    set(visible) {
        if (visible) {
            this.on();
            APPLICATION_CONTEXT.AppCache.set(`v::${this.id}`, true);
        } else {
            this.off();
            APPLICATION_CONTEXT.AppCache.set(`v::${this.id}`, false);
        }
    }

    // Live state field — wrapped on()/off() keep it in sync, so toggles work
    // correctly even when AppCache writes are no-ops (bypassCache=true).
    is() {
        return !!this._visible;
    }

    /**
     * Opt the component out of bulk hide flows (e.g. the AppBar.Chrome
     * hide-UI sweep) while the provider reports it pinned. The provider is
     * consulted live on every {@link isPinned} call.
     * @param {() => boolean} provider
     * @returns {VisibilityManager} this
     */
    setPinnedProvider(provider) {
        this._pinnedProvider = provider;
        return this;
    }

    /**
     * @returns {boolean} true when a pinned provider is set and reports pinned
     */
    isPinned() {
        return !!this._pinnedProvider?.();
    }

    toggle() {
        if (this.is()) {
            this.off();
            APPLICATION_CONTEXT.AppCache.set(`v::${this.id}`, false);
        } else {
            this.on();
            APPLICATION_CONTEXT.AppCache.set(`v::${this.id}`, true);
        }
    }
}