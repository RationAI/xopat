/**
 * @type {FlagManagerLike}
 */
export class VisibilityManager {

    /**
     * @param {BaseComponent|string} component or component id
     */
    constructor(component) {
        this.id = typeof component === "string" ? component : component.id;
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
        this.on = () => this._nRef.deref()?.classList.remove("display-none");
        this.off = () => this._nRef.deref()?.classList.add("display-none");
        this.defaultVisible = visibleNow === undefined ?
            APPLICATION_CONTEXT.AppCache.get(`v::${this.id}`, true): visibleNow;

        // todo caching tricky, for now just force
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
        this.on = on;
        this.off = off;
        this.defaultVisible = visibleNow === undefined ?
            APPLICATION_CONTEXT.AppCache.get(`v::${this.id}`, true) : visibleNow;

        // todo caching tricky, for now just force
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

    is() {
        return APPLICATION_CONTEXT.AppCache.get(`v::${this.id}`, this.defaultVisible);
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