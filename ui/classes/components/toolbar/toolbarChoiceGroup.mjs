import { BaseSelectableComponent } from "../../baseComponent.mjs";
import { Dropdown } from "../../elements/dropdown.mjs";
import { FAIcon } from "../../elements/fa-icon.mjs";
import { ToolbarItem } from "./toolbarItem.mjs";
import van from "../../../vanjs.mjs";

/**
 * @class ToolbarChoiceGroup
 * @extends BaseSelectableComponent
 * @description A compact radio group implemented as a single Dropdown whose
 * header always shows the currently selected tool (icon + tooltip). Parents
 * treat it as a single selectable "slot" via setActiveInParent(active).
 *
 * Children must be ToolbarItem instances.
 */
class ToolbarChoiceGroup extends BaseSelectableComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        // logical ID of the selected item (uses child.itemID || child.id)
        this._selectedId = van.state(this.options.defaultSelected ?? null);
        this._dropdown = null;      // Dropdown instance
        this._items = [];           // [{id,itemID,label,icon,_childItem}]
    }

    create() {
        const childItems = this._children.filter(c => c instanceof ToolbarItem);

        const defaultKey = this.options.defaultSelected;
        const defaultItem =
            (defaultKey != null
                    ? (
                        childItems.find(c => (c.options.itemID ?? c.id) === defaultKey)
                        || childItems.find(c => c.id === defaultKey)
                    )
                    : null
            ) || childItems[0];

        if (!defaultItem) {
            console.warn(`ToolbarChoiceGroup (${this.id}) has no items.`);
            return document.createElement("div");
        }

        const defaultItemKey = defaultItem.options.itemID ?? defaultItem.id;
        this._selectedId.val = defaultItemKey;

        // icon name from child
        const defaultIconName = defaultItem.options.icon instanceof FAIcon
            ? defaultItem.options.icon.options.name
            : defaultItem.options.icon;

        // normalize items so we can map between logical IDs and ToolbarItems
        this._items = childItems.map(ci => {
            const key = ci.options.itemID ?? ci.id;
            const iconName = ci.options.icon instanceof FAIcon
                ? ci.options.icon.options.name
                : ci.options.icon;

            return {
                id: key,
                itemID: key,
                label: ci.options.label,
                icon: iconName,
                _childItem: ci
            };
        });

        // single dropdown; header icon will be driven by activeSelection
        this._dropdown = new Dropdown({
            id: this.id,
            icon: new FAIcon({ name: defaultIconName }),
            title: defaultItem.options.label,
            items: this._items.map(item => ({
                id: item.itemID,
                itemID: item.itemID,
                label: item.label,
                icon: item.icon,
                onClick: (e, data) => {
                    // user picked a new item from the menu
                    this.setSelected(data.itemID ?? data.id, true, true);
                }
            })),
            activeSelection: defaultItemKey, // header tracks selection
            closeOnItemClick: true,
            placement: "below"
        });

        const el = this._dropdown.create();

        // make the header look like a toolbar button
        this._dropdown.headerButton.setClass(
            "base",
            "btn btn-square btn-sm join-item"
        );
        this._dropdown.iconOnly(); // only show the icon; tooltip has the label

        const headerId = this._dropdown.headerButton.id;

        // adapt width to toolbar orientation:
        // horizontal -> square; vertical -> full width
        queueMicrotask(() => {
            const root = el.closest("[data-toolbar-root]");
            if (!root) return;

            const apply = (dir) => {
                const btnEl = document.getElementById(headerId);
                if (!btnEl) return;

                if (dir === "vertical") {
                    btnEl.classList.add("w-full");
                    btnEl.classList.remove("btn-square");
                } else {
                    btnEl.classList.remove("w-full");
                    btnEl.classList.add("btn-square");
                }
            };

            const handler = (e) => apply(e.detail.dir);

            root.addEventListener("toolbar:measure", handler);
            // initial orientation
            apply(root.classList.contains("flex-col") ? "vertical" : "horizontal");
        });

        return el;
    }

    /**
     * Programmatic selection of an internal item.
     * @param {string} id logical item ID (child.options.itemID or child.id)
     * @param {boolean} [fireOnChange=true] whether to call this.options.onChange
     * @param {boolean} [fireChildClick=false] whether to call underlying ToolbarItem.onClick
     */
    setSelected(id, fireOnChange = true, fireChildClick = false) {
        const item = this._items.find(i => i.itemID === id || i.id === id);
        if (!item) {
            return;
        }

        const key = item.itemID || item.id;
        this._selectedId.val = key;

        if (this._dropdown) {
            // Dropdown.setSelected handles header icon/title + list highlight
            this._dropdown.setSelected(key);
        }

        if (fireOnChange) {
            this.options.onChange?.(key);
        }
        if (fireChildClick && item._childItem?.options.onClick) {
            item._childItem.options.onClick();
        }
    }

    /**
     * Used by parent ToolbarGroup to show this slot as active.
     * Does NOT change which internal item is selected.
     */
    setActiveInParent(active) {
        if (!this._dropdown) return;
        const btnEl = document.getElementById(this._dropdown.headerButton.id);
        if (!btnEl) return;
        btnEl.classList.toggle("btn-active", !!active);
        btnEl.classList.toggle("btn-primary", !!active);
    }
}

export { ToolbarChoiceGroup };
