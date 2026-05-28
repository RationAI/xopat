import { BaseComponent, BaseSelectableComponent } from "../../baseComponent.mjs";
import { Button } from "../../elements/buttons.mjs";
import { iconComponentFor } from "../../elements/ph-icon.mjs";

/**
 * @class ToolbarItem
 * @extends BaseComponent
 * @description A simple, square icon button intended for use inside a Toolbar.
 *
 * @param {object} options - Configuration options for the toolbar item.
 * @param {string} [options.id] - The ID for the component.
 * @param {string|BaseComponent} options.icon - Icon name string ("fa-…" or "ph-…") or a pre-built icon component instance (FAIcon / PhIcon).
 * @param {string} [options.label] - The text to display as a tooltip (title attribute).
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
            onClick: this.options.onClick,
            size: Button.SIZE.SMALL,
            extraClasses: {
                base: "btn join-item",
                ...(this.options.extraClasses || {})
            },
            extraProperties: {
                title: this.options.label || "",
                "data-toolbar-item": this.itemID
            }
        }, iconComp);

        return this._button.create();
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
