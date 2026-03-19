import { BaseComponent } from "../../baseComponent.mjs";
import { Join } from "../../elements/join.mjs";
import { ToolbarItem } from "./toolbarItem.mjs";
import { ToolbarChoiceGroup } from "./toolbarChoiceGroup.mjs";
import van from "../../../vanjs.mjs";

/**
 * @class ToolbarGroup
 * @extends BaseComponent
 * @description A group of ToolbarItems / sub-groups / choice groups that
 * automatically adjusts orientation based on the parent Toolbar.
 *
 * When `selectable` is true it behaves as a "slot" selector:
 *   - each direct child (item / nested group / choice group) is a slot
 *   - exactly one slot is visually selected
 *   - nested groups / choice groups keep their own internal selection;
 *     the parent only toggles their *parent* highlight.
 */
class ToolbarGroup extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this._selectedId = van.state(this.options.defaultSelected ?? null);
        this._joinComp = null;
        this._rootEl = null;
    }

    create() {
        // Wire child callbacks so that a change inside a child selects its slot
        if (this.options.selectable) {
            this._children.forEach(child => {
                const slotKey = child.itemID || child.id;

                // Simple item -> click selects this slot
                if (child instanceof ToolbarItem && child._children.length === 0) {
                    const orig = child.options.onClick;
                    child.options.onClick = (e) => {
                        this._selectedId.val = slotKey;
                        this.options.onChange?.(slotKey);
                        orig?.(e);
                    };
                }

                // Nested group -> any internal change selects this slot
                if (child instanceof ToolbarGroup && child !== this) {
                    const orig = child.options.onChange;
                    child.options.onChange = (innerId) => {
                        this._selectedId.val = slotKey;
                        this.options.onChange?.(slotKey);
                        orig?.(innerId);
                    };
                }

                // Choice group -> internal selection selects this slot
                if (child instanceof ToolbarChoiceGroup) {
                    const orig = child.options.onChange;
                    child.options.onChange = (innerId) => {
                        this._selectedId.val = slotKey;
                        this.options.onChange?.(slotKey);
                        orig?.(innerId);
                    };
                }
            });
        }

        this._joinComp = new Join({
            id: this.id,
            style: Join.STYLE.HORIZONTAL
        }, ...this.children);

        const el = this._joinComp.create();
        this._rootEl = el;

        // Reactively update visual state when selection changes
        if (this.options.selectable) {
            van.derive(() => {
                const current = this._selectedId.val;
                this._children.forEach(child => {
                    const slotKey = child.itemID || child.id;
                    const isActive = !!current && slotKey === current;

                    if (typeof child.setActiveInParent === "function") {
                        child.setActiveInParent(isActive);
                    }
                });
            });
        }

        // Follow toolbar orientation via toolbar:measure
        queueMicrotask(() => {
            const root = el.closest("[data-toolbar-root]");
            if (!root) return;

            const handler = (e) => {
                const { dir } = e.detail;
                this._joinComp.set(dir === "vertical" ? Join.STYLE.VERTICAL : Join.STYLE.HORIZONTAL);
            };

            root.addEventListener("toolbar:measure", handler);
            handler({ detail: { dir: root.classList.contains("flex-col") ? "vertical" : "horizontal" } });
        });

        return el;
    }

    /**
     * Select a child inside this group by itemID.
     * Pass `null` to clear selection.
     */
    setSelected(id) {
        const item = this._children.find(i => i.itemID === id || i.id === id);
        if (!item) {
            this._selectedId.val = id;
            return;
        }

        // External API: `id` is the logical itemID. For backwards compatibility
        // callers can still use the child's DOM id when no custom itemID is used.
        this._selectedId.val = id;
        if (id != null) {
            this.options.onChange?.(id);
        }
    }

    /**
     * Visual hint that this whole group is active in a parent group.
     * We use DaisyUI-ish border/rounded styling instead of a ring.
     */
    setActiveInParent(active) {
        const current = this._selectedId.val;
        this._children.forEach(child => {
            const slotKey = child.itemID || child.id;
            const isActive = active && !!current && slotKey === current;

            if (typeof child.setActiveInParent === "function") {
                child.setActiveInParent(isActive);
            }
        });
    }

    static generateCode() {
        return `
ui = globalThis.UI;

// A basic horizontal toolbar group
const toolGroup = new ui.ToolbarGroup({
    id: "my-toolbar-group",
    selectable: true,
    defaultSelected: "select-tool"
},
    new ui.ToolbarItem({
        id: "select-tool",
        icon: "fa-mouse-pointer",
        label: "Select"
    }),
    new ui.ToolbarItem({
        id: "draw-rect",
        icon: "fa-square",
        label: "Draw Rectangle"
    })
);

// Assumes a Toolbar with id 'my-toolbar' already exists
// and has a tab with id 'tools'
const toolbar = window.VANCOMPONENTS['my-toolbar'];
const toolsTab = toolbar.tabs['tools'];
if (toolsTab) {
    toolGroup.attachTo(toolsTab.contentDiv);
}
`;
    }
}

export { ToolbarGroup };
