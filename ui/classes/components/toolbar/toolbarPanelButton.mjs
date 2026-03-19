import { BaseSelectableComponent } from "../../baseComponent.mjs";
import { Button } from "../../elements/buttons.mjs";
import { FAIcon } from "../../elements/fa-icon.mjs";
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
 *   icon: "fa-sliders",
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
 * @param {string|FAIcon} options.icon  - FontAwesome icon name or FAIcon.
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

        /** @private */
        this._enabled = options.enabled !== false;   // default: true
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
     * @description Creates the toolbar button + attached panel.
     * @returns {HTMLElement}
     */
    create() {
        const iconComp = (this.options.icon instanceof FAIcon)
            ? this.options.icon
            : new FAIcon({ name: this.options.icon || "fa-ellipsis-vertical" });

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
                class: "relative inline-flex",
                ...this.extraProperties
            },
            this._button.create(),
            panelEl
        );

        this._rootEl = root;

        queueMicrotask(() => {
            const panelNode = document.getElementById(this._panelId);
            if (!panelNode) return;

            // 1) reactive show/hide
            van.derive(() => {
                const open = this._open.val;
                panelNode.classList.toggle("hidden", !open);
            });

            // 2) align panel according to toolbar orientation
            const toolbarRoot = root.closest("[data-toolbar-root]");
            if (toolbarRoot) {
                const applyDir = (dir) => {
                    panelNode.classList.remove(
                        "top-full", "mt-2", "left-1/2", "-translate-x-1/2",
                        "left-full", "ml-2", "top-1/2", "-translate-y-1/2"
                    );
                    if (dir === "vertical") {
                        // toolbar is vertical => panel opens to the right
                        panelNode.classList.add(
                            "left-full", "ml-2", "top-1/2", "-translate-y-1/2"
                        );
                    } else {
                        // toolbar is horizontal => panel opens below
                        panelNode.classList.add(
                            "top-full", "mt-2", "left-1/2", "-translate-x-1/2"
                        );
                    }
                };

                const handler = (e) => applyDir(e.detail.dir);
                toolbarRoot.addEventListener("toolbar:measure", handler);

                // initial orientation
                applyDir(toolbarRoot.classList.contains("flex-col") ? "vertical" : "horizontal");
            }

            // 3) close on outside click
            const onDocMouseDown = (evt) => {
                if (!this._open.val) return;
                if (!root.contains(evt.target)) {
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
    icon: "fa-ellipsis-vertical",
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
