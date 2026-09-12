import { BaseComponent } from "../../baseComponent.mjs";
import { Join } from "../../elements/join.mjs";
import { ToolbarItem } from "./toolbarItem.mjs";
import { ToolbarChoiceGroup } from "./toolbarChoiceGroup.mjs";
import { bindToolbarOrientation } from "./toolbarOrientation.mjs";
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

        // A group nested inside another group is a *sub-range* of the parent's
        // pill, not a pill of its own: DaisyUI would otherwise round its own
        // first/last member (`.join.join-horizontal .join-item:first-child`)
        // and leave a rounded seam in the middle of the parent. `join-unrounded`
        // zeroes `--rounded-btn` for that subtree, so the inherit chain resolves
        // to 0 and the members stay flush.
        this._children.forEach(child => {
            if (child instanceof ToolbarGroup && child !== this) child.options.nested = true;
        });

        // `join: false` renders a plain row instead of a DaisyUI `.join`.
        // Nesting a join inside a join makes DaisyUI's first/last-child radius
        // rules reach through the wrapper and flatten every descendant into one
        // pill, so the Toolbar's *root* group (which only exists to hold the
        // real groups + separators) must not be one.
        const joined = this.options.join !== false;
        let el;
        if (joined) {
            this._joinComp = new Join({
                id: this.id,
                style: Join.STYLE.HORIZONTAL,
                rounded: this.options.nested ? Join.ROUNDED.DISABLE : Join.ROUNDED.ENABLE,
                extraClasses: { ...(this.options.extraClasses || {}) }
            }, ...this.children);
            el = this._joinComp.create();
        } else {
            this.setClass("base", "flex flex-row items-center");
            el = van.tags.div({
                ...this.commonProperties,
                ...this.extraProperties
            }, ...this.children);
        }
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

        // Follow toolbar orientation via toolbar:measure.
        //
        // Horizontal groups are DaisyUI joins — one seamless pill per group.
        // Vertical groups are NOT: `join-vertical`'s radius rules are resolved
        // per direct child through `border-radius: inherit`, and this toolbar's
        // children are a mix of bare buttons, `.dropdown` wrappers and nested
        // groups, so the corners come out inconsistent (a mid-column button
        // ending up fully rounded, a group edge staying square). A vertical
        // column has room to breathe, so it drops the join and renders plain
        // rounded buttons with a small gap instead.
        bindToolbarOrientation(el, (dir) => {
            const vertical = dir === "vertical";
            if (this._joinComp) {
                // A nested group is a tight sub-pair (brush add/remove) and joins
                // cleanly in either orientation — its children are plain buttons,
                // not the wrapper zoo that breaks `join-vertical` at top level.
                const keepJoin = !vertical || this.options.nested;
                this._joinComp.setClass("base",
                    keepJoin ? "join bg-join" : "flex flex-col items-center");
                this._joinComp.setClass("direction",
                    !keepJoin ? "" : (vertical ? "join-vertical" : "join-horizontal"));
                // join-unrounded zeroes --rounded-btn for the subtree so a nested
                // pill stays flush inside its parent's. Only meaningful while the
                // parent is itself a join — vertically the parent is a plain
                // column, so the pair rounds normally as its own little pill.
                this._joinComp.setClass("rounded",
                    !vertical && this.options.nested ? "join-unrounded" : "");
            } else {
                el.classList.toggle("flex-col", vertical);
                el.classList.toggle("flex-row", !vertical);
                el.classList.toggle("items-stretch", vertical);
                el.classList.toggle("items-center", !vertical);
            }
            el.classList.toggle("w-full", vertical);
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
        icon: "ph-cursor",
        label: "Select"
    }),
    new ui.ToolbarItem({
        id: "draw-rect",
        icon: "ph-rectangle",
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
