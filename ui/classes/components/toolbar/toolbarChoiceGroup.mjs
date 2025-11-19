import { BaseSelectableComponent } from "../../baseComponent.mjs";
import { Dropdown } from "../../elements/dropdown.mjs";
import { FAIcon } from "../../elements/fa-icon.mjs";
import { ToolbarItem } from "./toolbarItem.mjs";
import { Join } from "../../elements/join.mjs";
import van from "../../../vanjs.mjs";

/**
 * @class ToolbarChoiceGroup
 * @extends BaseComponent
 * @description A compact radio group: a main "fire" button that executes the
 * currently selected tool, plus a small expand arrow that opens a dropdown
 * with all available tools.
 *
 * Parent ToolbarGroups treat this as a single selectable slot via
 * setActiveInParent(active).
 */
class ToolbarChoiceGroup extends BaseSelectableComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        // defaultSelected is a logical ID (itemID). If not provided, we will pick it in create()
        this._selectedId = van.state(this.options.defaultSelected ?? null);
        this._headerIcon = null;   // FAIcon used by main fire button
        this._dropdown = null;     // Dropdown instance
        this._join = null;         // Join (fire + expand)
        this._items = [];          // [{id,label,icon,_childItem}]
        this._fireButton = null;   // ToolbarItem
    }

    create() {
        const childItems = this._children.filter(c => c instanceof ToolbarItem);
        const defaultKey = this.options.defaultSelected;
        const defaultItem =
            (defaultKey != null
                    ? (
                        childItems.find(c => c.itemID === defaultKey) ||
                        childItems.find(c => c.id === defaultKey)
                    )
                    : null
            ) || childItems[0];

        if (!defaultItem) {
            console.warn(`ToolbarChoiceGroup (${this.id}) has no items.`);
            return document.createElement("div");
        }

        this._selectedId.val = defaultItem.itemID || defaultItem.id;

        // icon name from child
        const defaultIconName = defaultItem.options.icon instanceof FAIcon
            ? defaultItem.options.icon.options.name
            : defaultItem.options.icon;

        this._headerIcon = new FAIcon({ name: defaultIconName });

        // normalize items
        this._items = childItems.map(ci => {
            const iconName = ci.options.icon instanceof FAIcon
                ? ci.options.icon.options.name
                : ci.options.icon;
            return {
                id: ci.id,
                itemID: ci.itemID || ci.id,
                label: ci.options.label,
                icon: iconName,
                _childItem: ci
            };
        });

        // dropdown with expand arrow
        this._dropdown = new Dropdown({
            id: this.id + "-dd",
            icon: new FAIcon({ name: "fa-angle-down" }),
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
            closeOnItemClick: true
        });

        // main fire button – fires currently selected item
        this._fireButton = new ToolbarItem({
            id: this.id + "-fire",
            icon: this._headerIcon,
            label: defaultItem.options.label,
            onClick: (e) => this._fireCurrent(e)
        });

        // join them together so they look like a single control
        this._join = new Join({
            id: this.id,
            style: Join.STYLE.HORIZONTAL
        }, this._fireButton, this._dropdown);

        const el = this._join.create();

        // Make dropdown trigger look like the right half of the same split button
        this._dropdown.headerButton.setClass(
            "base",
            "btn btn-square btn-sm join-item px-2"
        );
        this._dropdown.iconOnly();

        // follow toolbar orientation (vertical -> arrow under icon)
        queueMicrotask(() => {
            const root = el.closest("[data-toolbar-root]");
            if (!root) return;

            const handler = (e) => {
                const { dir } = e.detail;
                this._join.set(dir === "vertical" ? Join.STYLE.VERTICAL : Join.STYLE.HORIZONTAL);
            };

            root.addEventListener("toolbar:measure", handler);
            handler({ detail: { dir: root.classList.contains("flex-col") ? "vertical" : "horizontal" } });
        });

        // make menu selection match initial state
        this._dropdown.setSelected(this._selectedId.val);

        return el;
    }

    /**
     * Fire the currently selected child tool:
     *  - calls this.options.onChange(id)
     *  - calls the underlying ToolbarItem.onClick
     */
    _fireCurrent(e) {
        const id = this._selectedId.val;
        if (!id) return;

        const item = this._items.find(i => i.itemID === id || i.id === id);
        if (!item) return;

        const key = item.itemID || item.id;
        this.options.onChange?.(key);
        item._childItem?.options.onClick?.(e);
    }

    /**
     * Programmatic selection of an internal item.
     * @param {string} id
     * @param {boolean} [fireOnChange=true]
     * @param {boolean} [fireChildClick=false]
     */
    setSelected(id, fireOnChange = true, fireChildClick = false) {
        const item =this._items.find(i => i.itemID === id) ||
            this._items.find(i => i.id === id);
        if (!item) return;

        const key = item.itemID || item.id;
        this._selectedId.val = key;

        // update icon & tooltips
        if (this._headerIcon) {
            this._headerIcon.changeIcon(item.icon);
        }

        const fireBtnEl = document.getElementById(this.id + "-fire");
        if (fireBtnEl) fireBtnEl.title = item.label || "";

        if (this._dropdown) {
            this._dropdown.setSelected(key);
            const btn = document.getElementById(this._dropdown.headerButton.id);
            if (btn) btn.title = item.label || "";
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
        const el = document.getElementById(this.id + "-fire");
        if (!el) return;
        el.classList.toggle("btn-primary", !!active);
    }
}

export { ToolbarChoiceGroup };
