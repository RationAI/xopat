import { BaseComponent, BaseSelectableComponent } from "../../baseComponent.mjs";
import { Button } from "../../elements/buttons.mjs";
import { iconComponentFor } from "../../elements/ph-icon.mjs";
import { bindToolbarOrientation } from "./toolbarOrientation.mjs";

/**
 * @class ToolbarItem
 * @extends BaseComponent
 * @description A simple, square icon button intended for use inside a Toolbar.
 *
 * @param {object} options - Configuration options for the toolbar item.
 * @param {string} [options.id] - The ID for the component.
 * @param {string|BaseComponent} options.icon - Phosphor icon name string ("ph-…") or a pre-built icon component instance (PhIcon / ImageIcon).
 * @param {string} [options.label] - Visible text for the button (used by parents like ToolbarChoiceGroup to render dropdown rows). When `tooltip` is not provided, also used as the title attribute.
 * @param {string} [options.tooltip] - Hover tooltip (title attribute). Falls back to `label`.
 * @param {Function} [options.onClick] - The function to execute when the button is clicked.
 * @param {object} [options.extraClasses] - Additional classes to apply to the button.
 */
class ToolbarItem extends BaseSelectableComponent {
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this._button = null;
    }

    /**
     * @description Creates the toolbar item element.
     * @returns {HTMLElement} The rendered button element.
     */
    create() {
        const raw = this.options.icon;
        const iconComp = (raw instanceof BaseComponent) ? raw : iconComponentFor(raw);

        this._button = new Button({
            id: this.id,
            // `base` is read off the top-level options by Button's constructor
            // (`classMap.base = options.base || "btn"`), so passing it inside
            // `extraClasses` silently loses `join-item` and breaks the group pill.
            base: "btn join-item",
            onClick: this.options.onClick,
            size: Button.SIZE.SMALL,
            extraClasses: {
                ...(this.options.extraClasses || {})
            },
            extraProperties: {
                title: this.options.tooltip ?? this.options.label ?? "",
                "data-toolbar-item": this.itemID
            }
        }, iconComp);

        const el = this._button.create();
        // Vertical toolbar: every control collapses to the same 32px square, so
        // the column is one icon wide. (Stretching items to `w-full` instead
        // only lines them up with whatever the widest member happens to be —
        // which used to be a 58px choice-group header.) Horizontal keeps the
        // intrinsic, roomier button.
        bindToolbarOrientation(el, (dir) => {
            const vertical = dir === "vertical";
            el.classList.toggle("toolbar-btn-vertical", vertical);
            el.classList.remove("w-full");
        });
        return el;
    }

    /**
     * Programmatically mark this item as selected or not.
     * (Used by parent ToolbarGroup.)
     * @param {boolean} selected
     */
    setSelected(selected) {
        this._button.toggleClass("selection", "btn-primary", selected);
    }

    /**
     * Visual hint that this item is inside a selected parent group.
     * For a plain item it's the same as setSelected.
     * @param {boolean} active
     */
    setActiveInParent(active) {
        this.setSelected(active);
    }

    static generateCode() {
        return `
ui = globalThis.UI;

// A simple toolbar item
const item = new ui.ToolbarItem({
    id: "my-item",
    icon: "ph-cursor",
    label: "Select Tool",
    onClick: () => console.log("Select clicked")
});

// Assumes a Toolbar with id 'my-toolbar' already exists
// and has a tab with id 'tools'
const toolbar = window.VANCOMPONENTS['my-toolbar'];
const toolsTab = toolbar.tabs['tools'];
if (toolsTab) {
    item.attachTo(toolsTab.contentDiv);
}
`;
    }
}

export { ToolbarItem };
