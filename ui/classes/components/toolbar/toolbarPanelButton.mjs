import { BaseComponent, BaseSelectableComponent } from "../../baseComponent.mjs";
import { Button } from "../../elements/buttons.mjs";
import { iconComponentFor } from "../../elements/ph-icon.mjs";
import { bindToolbarOrientation } from "./toolbarOrientation.mjs";
import { findClippingAncestor, placeFixedAnchored, trackAnchor } from "../../elements/popupPlacement.mjs";
import van from "../../../vanjs.mjs";

const { div } = van.tags;

/**
 * @class ToolbarPanelButton
 * @extends BaseSelectableComponent
 *
 * @description
 * A toolbar button that opens a small “panel” (popover) attached to the
 * toolbar instead of a separate draggable window. The panel can host
 * arbitrary content: sliders, dropdowns, checkboxes, etc.
 *
 * Typical usage:
 *
 * ```js
 * const panelBtn = new UI.ToolbarPanelButton({
 *   id: "mode-options",
 *   itemID: "mode-options",
 *   icon: "ph-sliders",
 *   label: "Mode options",
 *   panelClass: "w-80 max-h-[60vh]", // optional extra Tailwind classes
 *   onToggle: (open) => console.log("panel open?", open)
 * }, new UI.RawHtml({ id: "mode-options-html" }, "<div>...</div>"));
 *
 * panelBtn.attachTo(gModes); // inside a ToolbarGroup
 * ```
 *
 * The panel automatically:
 *  - Aligns **below** the button for horizontal toolbars.
 *  - Aligns **to the right** of the button for vertical toolbars.
 *  - Closes on outside click or when the button is clicked again.
 *
 * @param {object} options
 * @param {string} [options.id]         - Component ID.
 * @param {string} [options.itemID]     - Logical item ID used by ToolbarGroup.
 * @param {string|FAIcon|BaseComponent|Node} options.icon - Icon name string,
 *   a BaseComponent, or a raw DOM/Van.js node used verbatim as the button face.
 * @param {string} [options.label]      - Tooltip text for the button.
 * @param {object} [options.extraClasses] - Extra classes for the button.
 * @param {string} [options.panelClass] - Extra classes for the panel container.
 * @param {Function} [options.onOpen]   - Callback when panel opens.
 * @param {Function} [options.onClose]  - Callback when panel closes.
 * @param {Function} [options.onToggle] - Callback `onToggle(isOpen)`.
 */
class ToolbarPanelButton extends BaseSelectableComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this._open    = van.state(false);
        this._button  = null;
        this._panelId = options.panelId || `${this.id}-panel`;
        this._rootEl  = null;
        /** @private true while the panel is portaled to <body> to escape a clipping ancestor */
        this._portaled = false;
        /** @private FloatingManager token, only while portaled */
        this._fmToken = null;

        /** @private */
        this._enabled = options.enabled !== false;   // default: true
        /** @private */
        this._visible = options.visible !== false;   // default: true
    }

    isOpen() { return !!this._open.val; }

    open() {
        if (!this._enabled || this._open.val) return;
        this._open.val = true;
        this.options.onOpen?.();
        this.options.onToggle?.(true);
    }

    close() {
        if (!this._open.val) return;
        this._open.val = false;
        this.options.onClose?.();
        this.options.onToggle?.(false);
    }

    toggle() {
        if (!this._enabled) return;
        this.isOpen() ? this.close() : this.open();
    }

    /**
     * Enable / disable the button and close panel when disabled.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this._enabled = !!enabled;
        if (!this._button) return;

        // if Button has its own API, prefer that
        if (typeof this._button.setEnabled === "function") {
            this._button.setEnabled(this._enabled);
        } else {
            const btnEl = document.getElementById(this.id);
            if (btnEl) {
                if (this._enabled) {
                    btnEl.removeAttribute("disabled");
                } else {
                    btnEl.setAttribute("disabled", "disabled");
                }
            }
        }

        if (!this._enabled) this.close();
    }

    /**
     * Show / hide the entire button + panel slot. When hidden, also closes
     * the panel so re-showing doesn't restore a stale open state.
     * @param {boolean} visible
     */
    setVisible(visible) {
        this._visible = visible !== false;
        if (this._rootEl) {
            this._rootEl.classList.toggle("hidden", !this._visible);
        }
        if (!this._visible) this.close();
    }

    /**
     * @description Creates the toolbar button + attached panel.
     * @returns {HTMLElement}
     */
    create() {
        // Accept a BaseComponent, a raw DOM Node (e.g. a Van.js node), or an
        // icon name string. Nodes and components pass straight to Button, which
        // renders them via toNode; only bare names go through iconComponentFor.
        const rawIcon = this.options.icon;
        const iconComp = (rawIcon instanceof BaseComponent || rawIcon instanceof Node)
            ? rawIcon
            : iconComponentFor(rawIcon || "ph-dots-three-vertical");

        this._button = new Button({
            id: this.id,
            onClick: () => this.toggle(),
            size: Button.SIZE.SMALL,
            extraClasses: {
                base: "btn join-item",
                ...(this.options.extraClasses || {})
            },
            // make disabled state reflect initial enabled flag
            extraProperties: {
                title: this.options.label || "",
                "data-toolbar-item": this.itemID,
                ...(this._enabled ? {} : { disabled: "disabled" })
            }
        }, iconComp);
        // --- panel content ---
        const bodyChildren = this._children.map(child =>
            // allow both BaseComponent children and raw nodes / strings
            (child && typeof child.create === "function") ? child.create() : child
        );

        const panelClasses =
            "absolute z-[60] hidden glass rounded-lg shadow-lg " +
            "border bg-base-100 p-2 text-sm " +
            (this.options.panelClass || "");

        const panelEl = div(
            {
                id: this._panelId,
                class: panelClasses
            },
            ...bodyChildren
        );

        // wrapper that Join() will treat as the "slot"
        const root = div(
            {
                ...this.commonProperties,
                class: "relative inline-flex" + (this._visible ? "" : " hidden"),
                ...this.extraProperties
            },
            this._button.create(),
            panelEl
        );

        this._rootEl = root;

        // Vertical toolbar: stretch the (inline-flex) root and its button to the
        // column width so the panel button lines up with the other controls;
        // horizontal keeps the intrinsic size.
        bindToolbarOrientation(root, (dir) => {
            const vertical = dir === "vertical";
            root.classList.toggle("w-full", vertical);
            // The root div and its face button share this.id, so query the
            // button directly (getElementById would return the root).
            root.querySelector("button")?.classList.toggle("w-full", vertical);
        });

        queueMicrotask(() => {
            const panelNode = document.getElementById(this._panelId);
            if (!panelNode) return;

            const toolbarRoot = root.closest("[data-toolbar-root]");
            let dir = toolbarRoot?.classList.contains("flex-col") ? "vertical" : "horizontal";

            // Offset utilities used while the panel is a positioned child of the
            // toolbar. They are meaningless once the panel is portaled out (it is
            // then placed in viewport coordinates), so they get stripped there.
            const OFFSETS = [
                "top-full", "mt-2", "left-1/2", "-translate-x-1/2",
                "left-full", "ml-2", "top-1/2", "-translate-y-1/2"
            ];

            // 1) align panel according to toolbar orientation (in-toolbar mode)
            const applyDir = () => {
                panelNode.classList.remove(...OFFSETS);
                if (!toolbarRoot || this._portaled) return;
                if (dir === "vertical") {
                    // toolbar is vertical => panel opens to the right
                    panelNode.classList.add("left-full", "ml-2", "top-1/2", "-translate-y-1/2");
                } else {
                    // toolbar is horizontal => panel opens below
                    panelNode.classList.add("top-full", "mt-2", "left-1/2", "-translate-x-1/2");
                }
            };

            // 2) escape hatch for clipping ancestors. A docked mobile-bottom-bar
            // toolbar lives in a capped scroll port (.xopat-mobile-toolbar-scroll),
            // which clips an absolutely positioned panel to the bar row. When that
            // is the case, portal the panel to <body> and place it in viewport
            // coordinates instead — the generic flip then opens it upwards.
            let untrack = null;
            const anchorEl = () => root.querySelector("button") || root;
            const place = () => placeFixedAnchored(anchorEl(), panelNode, {
                placement: dir === "vertical" ? "right" : "bottom"
            });

            const portal = () => {
                if (this._portaled) return;
                this._portaled = true;
                panelNode.classList.remove("absolute", ...OFFSETS);
                document.body.appendChild(panelNode);
                place();
                untrack = trackAnchor(place);
                this._fmToken = UI.Services.FloatingManager.register({
                    el: panelNode, owner: this, onEscape: "close"
                });
                UI.Services.FloatingManager.bringToFront(this._fmToken);
            };

            const unportal = () => {
                if (!this._portaled) return;
                this._portaled = false;
                untrack?.();
                untrack = null;
                if (this._fmToken) {
                    UI.Services.FloatingManager.unregister(this._fmToken);
                    this._fmToken = null;
                }
                panelNode.style.position = "";
                panelNode.style.left = "";
                panelNode.style.top = "";
                panelNode.style.zIndex = "";
                panelNode.classList.add("absolute");
                root.appendChild(panelNode);
                applyDir();
            };

            // 3) reactive show/hide. The clipping test runs per open: a toolbar can
            // move between the app bar, the bottom bar and floating at any time.
            van.derive(() => {
                const open = this._open.val;
                panelNode.classList.toggle("hidden", !open);
                if (!open) {
                    unportal();
                } else if (findClippingAncestor(root)) {
                    portal();
                } else {
                    unportal();
                }
            });

            if (toolbarRoot) {
                toolbarRoot.addEventListener("toolbar:measure", (e) => {
                    dir = e.detail.dir;
                    applyDir();
                    if (this._portaled) place();
                });
            }
            applyDir();

            // 4) close on outside click. The panel is not inside `root` while
            // portaled, so it must be tested separately or interacting with the
            // panel content would dismiss it.
            const onDocMouseDown = (evt) => {
                if (!this._open.val) return;
                if (!root.contains(evt.target) && !panelNode.contains(evt.target)) {
                    this.close();
                }
            };
            document.addEventListener("mousedown", onDocMouseDown);
        });

        return root;
    }

    /**
     * Programmatically mark this item as selected or not.
     * Used by parent ToolbarGroup.
     * @param {boolean} selected
     */
    setSelected(selected) {
        if (!this._button) return;
        this._button.toggleClass("selection", "btn-primary", selected);
    }

    /**
     * Visual hint that this item is inside a selected parent group.
     * For this component it reuses setSelected.
     * @param {boolean} active
     */
    setActiveInParent(active) {
        this.setSelected(active);
    }

    static generateCode() {
        return `
ui = globalThis.UI;

// Example: toolbar button with an inline panel
const panelBtn = new ui.ToolbarPanelButton({
    id: "example-more",
    itemID: "example-more",
    icon: "ph-dots-three-vertical",
    label: "More settings",
    panelClass: "w-72 max-h-[50vh] overflow-y-auto",
}, new ui.RawHtml({}, "<div class='p-2'>Hello from panel</div>"));

// Attach to an existing ToolbarGroup
const toolbar = window.VANCOMPONENTS['my-toolbar'];
const group = toolbar?.tabs?.tools?.contentDiv;
if (group) {
    panelBtn.attachTo(group);
}
`;
    }
}

export { ToolbarPanelButton };
