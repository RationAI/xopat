import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import van from "../../vanjs.mjs";

const { div, span, i } = van.tags;

/**
 * @class Toolbar
 * @extends BaseComponent
 * @description Floating/Draggable toolbar that auto-switches orientation based on its proximity to screen edges.
 *              Internally wraps content in a [data-toolbar-root] so groups/measuring work in both modes.
 *
 * Public API unchanged:
 *   - addToToolbar({ id, icon, title, body, onClick? })
 *   - focus(id)
 *   - unfocusAll()
 */
class Toolbar extends BaseComponent {
    /**
     * @param {BaseUIOptions} options
     * @param {string} [options.design]
     * @param {boolean} [options.horizontalOnly] force horizontal (disables auto orientation)
     * @param {number}  [options.edgeThreshold] px distance to screen edge to switch vertical (default 96)
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        args = this._children;

        this.tabs = {};

        // visual nodes
        this.header = new Div({
            id: this.id + "-header",
            extraClasses: { tabs: "tabs", style: "tabs-boxed", events: "pointer-events-auto" }
        });

        this.body = new Div({
            id: this.id + "-body",
            extraClasses: {
                height: "h-full",
                width: "w-full",
                style: "boxed2",
                margin: "m-0",
                events: "pointer-events-auto"
            }
        });

        // state
        this.display = (args.length === 0) ? "none" : "";
        this._dir = "horizontal"; // "horizontal" | "vertical"
        this._edgeThreshold = Number.isFinite(options.edgeThreshold) ? Number(options.edgeThreshold) : 96;
        this._horizontalOnly = !!options.horizontalOnly;

        // buffer children into tabs
        for (let i of args) this.addToToolbar(i);
        this._children = [];

        // refs (DOM)
        this._outerEl = null;        // fixed & draggable outer
        this._rootWrap = null;       // [data-toolbar-root]
        this._observer = null;
        this._lastBox = null;        // last measured rect for cheap change detection
    }

    /**
     * Add a new toolbar tab
     * @param {{id:string, icon:string|BaseComponent, title:string, body?:Node[], onClick?:Function}} item
     */
    addToToolbar(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }

        this.header.setClass("display", "");
        this.body.setClass("display", "");

        const tab = this._createTab(item);
        this.tabs[item.id] = tab;

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) tab.contentDiv.attachTo(this.body);

        this.display = "";

        if (Object.keys(this.tabs).length === 1) {
            this.focus(item.id);
            this.header.setClass("display", "hidden");
        } else {
            this.header.setClass("display", "");
        }
    }

    /** @private */
    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        const b = new Button({
            id: this.id + "-b-" + item.id,
            base: "tab",
            type: Button.TYPE.NONE,
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus(item.id);
            },
        }, inIcon, span(inText));

        let c = undefined;
        if (content) {
            c = new Div({ id: this.id + "-c-" + item.id, extraClasses: { display: "display-none", height: "h-full" } }, ...content);
        }

        return { headerButton: b, contentDiv: c };
    }

    /** Build DOM */
    create() {
        const left = Number(APPLICATION_CONTEXT.AppCache.get(`${this.id}-PositionLeft`, 50));
        const top  = Number(APPLICATION_CONTEXT.AppCache.get(`${this.id}-PositionTop`, 50));
        const wMin = this.options.horizontalOnly ? "min-w-max" : "";

        // OUTER fixed/draggable container (same as before)
        this._outerEl = div({
                id: `${this.id}`,
                class: `draggable flex flex-col bg-transparent pointer-events-none ${wMin} ${this.options.pluginRootClass || ""}`,
                style: `
        position: fixed;
        left: ${left}px;
        top: ${top}px;
        display: ${this.display};
        z-index: 100;
      `
            },
            // drag handle
            div({ class: "spacer flex-grow" },

                div({ class: "toolbar-hide badge badge-soft badge-primary pointer-events-auto self-center text-xs mb-1", 
                    style: "width: min(45px, 90%);",
                    onclick: () => this._switchDisplay()
                    },  
                    i({ class: "fa-auto fa-eye-slash" }),
                ),
                div({ class: "handle badge badge-soft badge-primary pointer-events-auto self-center text-xs mb-1", style: "width: min(180px, 90%);" },  
                    i({ class: "fa-auto fa-grip-horizontal" }),
                ),
                div({ class: "toolbar-hide badge badge-soft badge-primary pointer-events-auto self-center text-xs mb-1", 
                    style: "width: min(45px, 90%);",
                    onclick: () => this._hide()
                    },  
                    i({ class: "fa-auto fa-xmark" }),
                ),

            ),

            // INTERNAL MEASUREMENT WRAPPER (this is new)
            // Exposes [data-toolbar-root] so child groups can measure available space.
            div({
                    "data-toolbar-root": "",
                    // mode class will be toggled in _applyOrientation
                    class: "pointer-events-auto"
                },
                // You can choose to show tabs header if you need it:
                // this.header.create(),
                this.body.create()
            )
        );

        // keep ref to wrapper for sizing/orientation
        this._rootWrap = this._outerEl.querySelector("[data-toolbar-root]");

        // first pass orientation + wrapper sizing
        queueMicrotask(() => {
            this._updateOrientationFromPosition(/*force*/true);
            this._setupObservers();
        });

        return this._outerEl;
    }

    _hide() {
        if (this._outerEl.parentElement.id === "toolbars-container") {
            document.getElementById("toolbars-container-hidden")?.appendChild(this._outerEl);
            this._outerEl.classList.add("toolbar-hidden");
        }
        else {
            document.getElementById("toolbars-container")?.appendChild(this._outerEl);
            this._outerEl.classList.remove("toolbar-hidden");
        }
    }

    _switchDisplay() {
        if (this.body.classMap.display === "display-none") {
            this.body.setClass("display", "");
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-Visible`, "true");
            return;
        }
        this.body.setClass("display", "display-none");
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-Visible`, "false");
    }

    /** When attached to DOM: start observers (resize + position) */
    _setupObservers() {
        const root = this._outerEl;
        const wrap = this._rootWrap;
        if (!root || !wrap) return;

        // Observe size changes to recheck collapsing logic down the tree
        const notifyMeasure = () => {
            wrap.dispatchEvent(new CustomEvent("toolbar:measure", {
                bubbles: true,
                detail: { dir: this._dir, size: 32, gap: "gap-1" }
            }));
        };

        // Orientation may need to update on resize/scroll
        const onViewportChange = () => {
            this._updateOrientationFromPosition();
            notifyMeasure();
        };

        // Make a cheap rect-change checker
        const checkRect = () => {
            const r = root.getBoundingClientRect();
            const key = `${Math.round(r.left)}:${Math.round(r.top)}`;
            if (this._lastBox !== key) {
                this._lastBox = key;
                this._updateOrientationFromPosition();
                notifyMeasure();
            }
        };

        // ResizeObserver on the wrap area (content size change)
        this._observer?.disconnect?.();
        this._observer = new ResizeObserver(() => notifyMeasure());
        this._observer.observe(wrap);

        // Listen to global changes
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, { passive: true });

        // If you have your own drag system, hook here:
        // After the user releases the drag, recalc orientation once
        root.addEventListener("mouseup", checkRect);
        root.addEventListener("touchend", checkRect);
        // Also poll a microtask after any click on the handle (cheap & robust)
        root.querySelector(".handle")?.addEventListener("pointerup", () => {
            setTimeout(checkRect, 0);
        });

        // initial notify
        notifyMeasure();
    }

    /** Compute orientation from the toolbar’s current screen position */
    _updateOrientationFromPosition(force=false) {
        if (!this._outerEl || !this._rootWrap) return;
        if (this._horizontalOnly) {
            this._setOrientation("horizontal", force);
            return;
        }

        const rect = this._outerEl.getBoundingClientRect();
        const vw = window.innerWidth;

        // distance to left & right edges
        const distL = rect.left;
        const distR = Math.max(0, vw - (rect.left + rect.width));
        const nearEdge = (distL <= this._edgeThreshold) || (distR <= this._edgeThreshold);

        this._setOrientation(nearEdge ? "vertical" : "horizontal", force);
    }

    /** Apply orientation to wrapper + descendants */
    _setOrientation(dir, force=false) {
        if (!force && this._dir === dir) return;
        this._dir = dir;

        // Size the internal measurement wrapper to behave as a bar in the given mode.
        // Horizontal: fixed height bar; Vertical: fixed width bar.
        const wrap = this._rootWrap;
        if (!wrap) return;

        // reset classes
        wrap.classList.remove("w-10", "h-10", "w-full", "h-full", "flex", "flex-row", "flex-col", "items-center");
        // baseline
        wrap.classList.add("flex", "items-center");

        if (dir === "horizontal") {
            // horizontal bar
            wrap.classList.add("flex-row", "w-full");
            // set an explicit bar height via style so descendants know the square size (~40px)
            // wrap.style.height = "40px";
            // wrap.style.width = "auto";
        } else {
            // vertical bar
            wrap.classList.add("flex-col", "h-full");
            // wrap.style.width = "40px";
            // wrap.style.height = "auto";
        }

        // Hint children (groups) about the current direction
        wrap.dispatchEvent(new CustomEvent("toolbar:measure", {
            bubbles: true,
            detail: { dir: this._dir, size: 32, gap: "gap-1" }
        }));
    }

    /** Focus a tab by id */
    focus(id) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            if (this.tabs[id].contentDiv) {
                this.tabs[id].contentDiv.setClass("display", "");
            }
            this._focused = id;
            return true;
        }
        return false;
    }

    /** Unfocus all */
    unfocusAll() {
        for (let tab of Object.values(this.tabs)) {
            tab.headerButton.setClass("tab-active", "");
            if (tab.contentDiv) {
                tab.contentDiv.setClass("display", "display-none");
            }
        }
        this._focused = undefined;
    }

    /** Clean up */
    beforeDestroy() {
        this._observer?.disconnect?.();
        window.removeEventListener("resize", this._updateOrientationFromPosition);
        window.removeEventListener("scroll", this._updateOrientationFromPosition);
    }
}

export { Toolbar };
