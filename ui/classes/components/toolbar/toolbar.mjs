// (unchanged imports)
import { ToolbarGroup } from "./toolbarGroup.mjs";
import { BaseComponent } from "../../baseComponent.mjs";
import { Div } from "../../elements/div.mjs";
import { FAIcon } from "../../elements/fa-icon.mjs";
import { Button } from "../../elements/buttons.mjs";
import van from "../../../vanjs.mjs";

import {VisibilityManager} from "../../mixins/visibilityManager.mjs";

const { div, span, i } = van.tags;

/**
 * @class Toolbar
 * @extends BaseComponent
 * @description Floating/Draggable toolbar that auto-switches orientation
 * and tells children (groups/separators) how to align via a `toolbar:measure`
 * event fired on the internal [data-toolbar-root] wrapper.
 *
 * @param {object}  options
 * @param {boolean} [options.horizontalOnly=false] Lock to horizontal mode.
 * @param {number}  [options.edgeThreshold=96] Distance in px to a screen edge
 *                                             where the bar flips vertical.
 */
class Toolbar extends BaseComponent {
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        args = this._children;

        this.tabs = {};

        this.header = new Div({
            id: this.id + "-header",
            extraClasses: { tabs: "tabs", style: "tabs-boxed", events: "pointer-events-auto" }
        });

        this.body = new ToolbarGroup(
            {
                id: this.id + "-body",
                extraClasses: {
                    height: "h-full",
                    width: "w-full",
                    style: "boxed2",
                    margin: "m-0",
                    events: "pointer-events-auto"
                }
            },
        );

        // group to replace div
        // new Div({
        //     id: this.id + "-body",
        //     extraClasses: {
        //         height: "h-full",
        //         width: "w-full",
        //         style: "boxed2",
        //         margin: "m-0",
        //         events: "pointer-events-auto"
        //     }
        // });

        if (APPLICATION_CONTEXT.AppCache.get(`${this.id}-body-visible`, true)) {
            this.body.setClass("display", "");
        } else {
            this.body.setClass("display", "display-none");
        }

        // state
        this.display = APPLICATION_CONTEXT.AppCache.get(`${this.id}-visible`, true) ? "" : "none";
        this._dir = "horizontal";
        this._edgeThreshold = Number.isFinite(options.edgeThreshold) ? Number(options.edgeThreshold) : 96;
        this._horizontalOnly = !!options.horizontalOnly;

        const wMin = this.options.horizontalOnly ? "min-w-max" : "";
        this.classMap["base"] = `draggable flex flex-col bg-transparent pointer-events-none ${wMin} ${this.options.pluginRootClass || ""}`;

        // buffer children into tabs
        for (let i of args) this.addToToolbar(i);
        this._children = [];

        // refs
        this._outerEl = null;
        this._rootWrap = null;
        this._observer = null;
        this._lastBox = null;

        this.visibility = new VisibilityManager(this);
        USER_INTERFACE.AppBar.View.registerViewComponent('toolbarMenu',
            {
                id: this.id,
                icon: "fa-gear",
                title: this.id, // todo name!!!!
                visibilityManager: this.visibility
            }
        );
    }

    addToToolbar(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }
        const tab = this._createTab(item);
        this.tabs[item.id] = tab;
        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) tab.contentDiv.attachTo(this.body);

        // hide header if there's only one tab
        if (Object.keys(this.tabs).length === 1) {
            this.focus(item.id);
            this.header.setClass("display", "hidden");
        } else {
            this.header.setClass("display", "");
        }
        this.display = "";
    }

    _createTab(item) {
        const rawBody = item.body;
        const inText  = item.title;
        const inIcon  = item.icon instanceof BaseComponent
            ? item.icon
            : new FAIcon({ name: item.icon });

        const action = item.onClick || (() => {});

        const b = new Button({
            id: this.id + "-b-" + item.id,
            base: "tab",
            type: Button.TYPE.NONE,
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus(item.id);
            }
        }, inIcon, span(inText));

        // --- normalize body ---
        let content = [];
        if (rawBody != null) {
            if (Array.isArray(rawBody)) content = rawBody.slice();
            else content = [rawBody];
        }

        // Only wrap if there are multiple *components* (keep old HTML/string usage working)
        const allComponents = content.every(c => c instanceof BaseComponent);
        if (allComponents && content.length > 1) {
            const rootGroup = new ToolbarGroup(
                { id: `${this.id}-rootgroup-${item.id}` },
                ...content
            );
            content = [rootGroup];
        }

        let c;
        if (content.length) {
            c = new Div({
                id: this.id + "-c-" + item.id,
                extraClasses: { display: "display-none", height: "h-full" }
            }, ...content);
        }

        return { headerButton: b, contentDiv: c };
    }

    create() {
        const left = Number(APPLICATION_CONTEXT.AppCache.get(`${this.id}-PositionLeft`, 50));
        const top  = Number(APPLICATION_CONTEXT.AppCache.get(`${this.id}-PositionTop`, 50));

        this._outerEl = div(
            {
                ...this.commonProperties,
                class: ((this.commonProperties?.class ?? "") + " flex items-center").trim(),
                style: `
        position: fixed;
        left: ${left}px;
        top: ${top}px;
        display: ${this.display};
            `,
                ...this.extraProperties,
            },
            // MODIFIED: Removed 'width-full' and 'flex-grow' to prevent it from taking up space in horizontal mode
            div({ class: "spacer flex place-content-center" },

                // --- Hide Button (Commented Out) ---
                /*
                div({
                    class: "toolbar-hide badge badge-soft badge-secondary pointer-events-auto self-center text-xs mb-1",
                    style: "width: min(45px, 90%);",
                    onclick: () => this._toggle_body()
                }, i({ class: "fa-auto fa-eye-slash" })),
                */

                // --- Handle (Simplified) ---
                // Removed fixed width styles and large badge classes for a cleaner look
                div({
                        // DaisyUI-themed drag handle (visible across themes)
                        class: "handle pointer-events-auto self-center px-2 my-1 rounded-md bg-base-200/80 text-base-content border border-base-300 shadow cursor-grab active:cursor-grabbing hover:bg-base-300/80",
                        style: "touch-action: none;"
                    },
                    i({ class: "fa-solid fa-grip-lines text-base-content" })
                ),

                // --- Close Button (Commented Out) ---
                /*
                div({
                    class: "toolbar-hide badge badge-soft badge-secondary pointer-events-auto self-center text-xs mb-1",
                    style: "width: min(45px, 90%);",
                    onclick: () => this.visibility.set(false)
                }, i({ class: "fa-auto fa-xmark" }))
                */
            ),
            div({ "data-toolbar-root": "", class: "pointer-events-auto glass p-1 rounded-md" }, this.body.create())
        );

        this._rootWrap = this._outerEl.querySelector("[data-toolbar-root]");
        this.visibility.initOnRootNode(this._outerEl);

        queueMicrotask(() => {
            this._updateOrientationFromPosition(true);

            this._fmToken = UI.Services.FloatingManager.register({
                el: this._outerEl,
                owner: this,
                clamp: {
                    margin: 6,
                    topBarId: "top-side",
                    cache: {
                        leftKey: `${this.id}-PositionLeft`,
                        topKey:  `${this.id}-PositionTop`
                    }
                }
            });

            // Enable dragging from handle
            const handle = this._outerEl.querySelector(".handle");
            if (handle) {
                UI.Services.FloatingManager.enableDrag(this._fmToken, {
                    handle,
                    persist: {
                        leftKey: `${this.id}-PositionLeft`,
                        topKey:  `${this.id}-PositionTop`
                    },
                    // 💡 live orientation update while dragging
                    onMove: () => {
                        this._updateOrientationFromPosition(/*force*/false, { dragging: true });
                        // also tell children to re-measure if they care (choice groups, etc.)
                        if (this._rootWrap) {
                            this._rootWrap.dispatchEvent(new CustomEvent("toolbar:measure", {
                                bubbles: true,
                                detail: { dir: this._dir, size: 32, gap: "gap-1" }
                            }));
                        }
                    }
                });
            }
            this._setupObservers();
        });

        return this._outerEl;
    }

    _setOrientation(dir, force = false) {
        if (!force && this._dir === dir) return;
        this._dir = dir;

        const wrap = this._rootWrap;
        if (!wrap) return;

        // Reset inner wrapper classes
        wrap.classList.remove("w-10", "h-10", "w-full", "h-full", "flex", "flex-row", "flex-col", "items-center");
        wrap.classList.add("flex", "items-center");

        // --- NEW LOGIC: Manipulate _outerEl to switch handle position ---
        // Horizontal Mode: outerEl = Row (Handle Left), wrap = Row (Items horizontal)
        // Vertical Mode:   outerEl = Col (Handle Top),  wrap = Col (Items vertical)

        if (this._outerEl) {
            this._outerEl.classList.remove("flex-row", "flex-col", "flex-col-reverse");
            if (dir === "horizontal") {
                this._outerEl.classList.add("flex-row");
            } else {
                // If the toolbar is touching the top of the screen, put the handle *below*
                // the toolbar to avoid a weird gap above the first row of tools.
                const top = this._outerEl.getBoundingClientRect().top;
                if (top <= 1) {
                    this._outerEl.classList.add("flex-col-reverse");
                } else {
                    this._outerEl.classList.add("flex-col");
                }
            }
        }

        if (dir === "horizontal") {
            wrap.classList.add("flex-row", "w-full");
        } else {
            wrap.classList.add("flex-col", "h-full");
        }

        wrap.dispatchEvent(new CustomEvent("toolbar:measure", {
            bubbles: true,
            detail: { dir: this._dir, size: 32, gap: "gap-1" }
        }));

        // (Optional) Logic for hiding buttons is technically unused now since they are commented out,
        // but safe to keep in case you uncomment them later.
        const header = this._outerEl?.querySelector(".toolbar-header") || this._outerEl;
        if (header) {
            const sideButtons = header.querySelectorAll(".toolbar-hide");
            sideButtons.forEach(btn => {
                if (dir === "horizontal") {
                    btn.classList.remove("hidden");
                } else {
                    btn.classList.add("hidden");
                }
            });
        }
    }

    
    isVisible() { return !this._outerEl.classList.contains("display-none"); }
    
    // _toggle_body() {
    //     if (this.body.classMap.display === "display-none") {
    //         this.body.setClass("display", "");
    //         APPLICATION_CONTEXT.AppCache.get(`${this.id}-body-visible`, "true");
    //     } else {
    //         this.body.setClass("display", "display-none");
    //         APPLICATION_CONTEXT.AppCache.set(`${this.id}-body-visible`, "false");
    //     }
    // }

    // ----- observers & orientation -----
    _setupObservers() {
        const root = this._outerEl;
        const wrap = this._rootWrap;
        if (!root || !wrap) return;

        const notifyMeasure = () => {
            wrap.dispatchEvent(new CustomEvent("toolbar:measure", {
                bubbles: true,
                detail: { dir: this._dir, size: 32, gap: "gap-1" }
            }));
        };

        const onViewportChange = () => {
            this._updateOrientationFromPosition();
            notifyMeasure();
        };

        const checkRect = () => {
            const r = root.getBoundingClientRect();
            const key = `${Math.round(r.left)}:${Math.round(r.top)}`;
            if (this._lastBox !== key) {
                this._lastBox = key;
                this._updateOrientationFromPosition();
                notifyMeasure();
            }
        };

        this._observer?.disconnect?.();
        this._observer = new ResizeObserver(() => notifyMeasure());
        this._observer.observe(wrap);

        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, { passive: true });

        root.addEventListener("mouseup", checkRect);
        root.addEventListener("touchend", checkRect);
        root.querySelector(".handle")?.addEventListener("pointerup", () => setTimeout(checkRect, 0));

        notifyMeasure();
    }

    _updateOrientationFromPosition(force = false, opts = {}) {
        if (!this._outerEl || !this._rootWrap) return;

        const rect = this._outerEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const snapDist = this._edgeThreshold;
        const dragging = !!opts.dragging;

        // When dragging near corners, width/height changes after an orientation flip can cause
        // edge-distance calculations to oscillate. Capture a stable "drag size" for the whole drag.
        if (dragging) {
            if (!this._dragSize) {
                this._dragSize = { w: rect.width, h: rect.height, max: Math.max(rect.width, rect.height) };
            }
        } else {
            this._dragSize = null;
        }
        // Add a little hysteresis to prevent rapid flip-flopping when the toolbar size changes
        // between horizontal/vertical near an edge (common in corners).
        const enterEdge = this._edgeThreshold;
        const leaveEdge = this._edgeThreshold + 24;

        // current position
        let left = rect.left;
        let top  = rect.top;
        let snapped = false;

        // distances to edges
        const distL = rect.left;
        const distR = vw - (rect.left + rect.width);
        const distT = rect.top;
        const distB = vh - (rect.top + rect.height);

        if (!dragging) {
            // --- snap to left/right ---
            if (distL <= snapDist) {
                left = 0;
                snapped = true;
            } else if (distR <= snapDist) {
                left = vw - rect.width;
                snapped = true;
            }

            // --- snap to top/bottom ---
            if (distT <= snapDist) {
                top = 0;
                snapped = true;
            } else if (distB <= snapDist) {
                top = vh - rect.height;
                snapped = true;
            }

            if (snapped) {
                const l = Math.round(left);
                const t = Math.round(top);
                this._outerEl.style.left = `${l}px`;
                this._outerEl.style.top  = `${t}px`;

                // remember snapped pos
                APPLICATION_CONTEXT.AppCache.set(`${this.id}-PositionLeft`, l);
                APPLICATION_CONTEXT.AppCache.set(`${this.id}-PositionTop`,  t);

                // let FloatingManager re-clamp if needed (top bar, margins, etc.)
                if (this._fmToken && UI.Services.FloatingManager.clampNow) {
                    UI.Services.FloatingManager.clampNow(this._fmToken);
                }
            }

        }

        // --- orientation: vertical near a side edge, else horizontal ---
        if (this._horizontalOnly || window.innerWidth < 600) {
            this._setOrientation("horizontal", force);
            return;
        }

        const curLeft = parseFloat(this._outerEl.style.left) || rect.left;
        const distL2 = curLeft;
        const effW = (dragging && this._dragSize) ? this._dragSize.max : rect.width;
        const distR2 = vw - (curLeft + effW);

        // Hysteresis:
        // - If we're currently horizontal, only enter vertical when we're clearly near a side edge.
        // - If we're currently vertical, only return to horizontal once we've moved away from the edge.
        const nearSideEnter = (distL2 <= enterEdge) || (distR2 <= enterEdge);
        const awayFromSideLeave = (distL2 > leaveEdge) && (distR2 > leaveEdge);

        let nextDir;
        if (this._dir === "vertical") {
            nextDir = awayFromSideLeave ? "horizontal" : "vertical";
        } else {
            nextDir = nearSideEnter ? "vertical" : "horizontal";
        }

        this._setOrientation(nextDir, force);
    }

    focus(id) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            this.tabs[id].contentDiv?.setClass("display", "");
            this._focused = id;
            return true;
        }
        return false;
    }
    unfocusAll() {
        for (let tab of Object.values(this.tabs)) {
            tab.headerButton.setClass("tab-active", "");
            tab.contentDiv?.setClass("display", "display-none");
        }
        this._focused = undefined;
    }

    onLayoutChange(details) {
        const root = this._outerEl;
        if (details.width < 600) {
            this.setClass("mobile", "mobile");
            root.querySelector(".handle")?.classList.add("hidden")
            this._setOrientation("horizontal", true);
        } else {
            this.setClass("mobile", "");
            root.querySelector(".handle")?.classList.remove("hidden")
            this._setOrientation("horizontal", false);
        }
    }
}

export { Toolbar };