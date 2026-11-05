import van from "../vanjs.mjs";
import { BaseComponent } from "../classes/baseComponent.mjs";
import { componentIconNode } from "../classes/elements/ph-icon.mjs";

const { button, span } = van.tags;

/**
 * VIEWER CONTROLS — per-viewport icon buttons (e.g. slide-info's prev/next
 * slide arrows). The viewer-scoped counterpart of `AppBar.Tools`: one id-keyed,
 * multi-owner registry, rendered once per viewer into whatever slot that viewer's
 * chrome mounts (today the scalebar magnification strip). Every click receives
 * the viewer whose slot was clicked — never the focused one.
 *
 * Entries are declarative; the service owns the markup, so every control looks
 * the same and no owner DOM reaches the viewer chrome. `AppBar.Catalog` lists
 * them as `viewer-control:<id>` nodes.
 *
 * @example
 *   USER_INTERFACE.ViewerControls.register("my-plugin.next", {
 *       label: $.t("my-plugin:next"), icon: "ph-caret-right", order: 10,
 *       onClick: ({ viewer }) => goNext(viewer),
 *   });
 */
export class ViewerControls {
    constructor() {
        // Insertion order is preserved by Map and breaks `order` ties.
        this._entries = new Map();
        this._subs = new Set();
    }

    /**
     * Register (or replace) a control. Missing keys on replace are kept.
     * @param {string} id unique id, namespaced by owner (e.g. "slide-info.nextSlide")
     * @param {object} opts
     * @param {string} opts.label tooltip / accessible name
     * @param {string} opts.icon Phosphor class or image URL
     * @param {string} [opts.hint] longer description (Catalog only)
     * @param {string} [opts.kbd] key combo shown as "label (kbd)"
     * @param {number} [opts.order] ascending sort key, default 0
     * @param {function(OpenSeadragon.Viewer): boolean} [opts.visible] false hides it on that viewer
     * @param {function({viewer: OpenSeadragon.Viewer}): void} opts.onClick
     * @returns {string} the id
     */
    register(id, opts = {}) {
        if (!id || typeof id !== "string") throw new Error("ViewerControls.register: id required");
        const entry = { ...this._entries.get(id), ...opts };
        if (typeof entry.onClick !== "function") throw new Error("ViewerControls.register: onClick required");
        this._entries.set(id, entry);
        this._notify();
        return id;
    }

    /** Remove a control from every viewer. */
    unregister(id) {
        if (!this._entries.delete(id)) return false;
        this._notify();
        return true;
    }

    has(id) { return this._entries.has(id); }

    /**
     * Snapshot sorted by `order`, then registration order. Shallow copies — the
     * live entry objects are never handed out.
     * @returns {Array<object>} `[{id, label, icon, hint, kbd, order, visible, onClick}]`
     */
    list() {
        return [...this._entries]
            .map(([id, e], index) => ({ id, index, ...e }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.index - b.index)
            .map(({ index, ...e }) => e);
    }

    /**
     * Whether a control shows on the given viewer. A throwing `visible()` hides it.
     * @param {object} entry a {@link list} item
     * @param {OpenSeadragon.Viewer} viewer
     */
    isVisible(entry, viewer) {
        if (typeof entry.visible !== "function") return true;
        try {
            return entry.visible(viewer) !== false;
        } catch (e) {
            console.warn(`ViewerControls: visible() of '${entry.id}' failed`, e);
            return false;
        }
    }

    /**
     * Run a control for a viewer, as a click on that viewer's slot would.
     * @param {string} id
     * @param {OpenSeadragon.Viewer} viewer
     */
    invoke(id, viewer) {
        const entry = this._entries.get(id);
        if (!entry || !viewer) return false;
        try {
            entry.onClick({ viewer });
        } catch (e) {
            console.warn(`ViewerControls: '${id}' failed`, e);
        }
        return true;
    }

    /**
     * Re-render every mounted slot. For owners whose `visible()` inputs changed
     * without a register/unregister.
     */
    refresh() { this._notify(); }

    /**
     * @param {function} cb called after every registry change or {@link refresh}
     * @returns {function} unsubscribe
     */
    onChange(cb) {
        if (typeof cb !== "function") return () => {};
        this._subs.add(cb);
        return () => this._subs.delete(cb);
    }

    /**
     * Render the controls for `viewer` into `container` and keep them live.
     * The container is hidden while no control is visible, so an empty slot
     * costs no width in the host chrome.
     * @param {HTMLElement} container slot owned by the viewer chrome
     * @param {OpenSeadragon.Viewer} viewer the viewer every click targets
     * @returns {function} unmount — the host must call it when the slot goes away
     */
    mount(container, viewer) {
        if (!container || !viewer) return () => {};
        container.classList.add("join", "flex-nowrap");
        const render = () => {
            const nodes = this.list()
                .filter(entry => this.isVisible(entry, viewer))
                .map(entry => this._button(entry, viewer));
            container.replaceChildren(...nodes);
            container.style.display = nodes.length ? "" : "none";
        };
        render();
        const off = this.onChange(render);
        return () => {
            off();
            container.replaceChildren();
        };
    }

    /** @private */
    _button(entry, viewer) {
        const title = entry.kbd ? `${entry.label} (${entry.kbd})` : entry.label;
        const icon = componentIconNode(entry.icon);
        return button({
            type: "button",
            class: "btn btn-xs join-item border-none px-1",
            title,
            "aria-label": title,
            "data-viewer-control": entry.id,
            onclick: (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.invoke(entry.id, viewer);
            },
        }, span({ style: "font-size:12px;line-height:1" }, icon ? BaseComponent.toNode(icon) : null));
    }

    /** @private */
    _notify() {
        for (const cb of [...this._subs]) {
            try { cb(); } catch (e) { console.warn("ViewerControls: onChange handler failed", e); }
        }
    }
}
