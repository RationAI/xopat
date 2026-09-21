// ui/classes/elements/collapse.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, details, summary } = van.tags;

/**
 * Collapse
 *
 * Rendered as a native `<details>`/`<summary>` (DaisyUI `details.collapse`) so it
 * toggles on click with zero JS and survives being re-serialized through
 * `innerHTML` (the menu-pages `renderUIFromJson` path). The older `<div tabindex>`
 * focus-method was unreliable — it needs the element to hold focus and auto-closed
 * on blur.
 *
 * options:
 *  - title | label: string | Node    // summary text (children[0] can override)
 *  - open | startOpen: boolean (default false)   // initial expanded state
 *  - icon: "arrow" | "plus" | "none" (default "arrow")
 *  - extraClasses: { base?, title?, content? }   // class overrides
 *
 * children:
 *  - [1..n]: content nodes
 */
export class Collapse extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        // Accept both the canonical (title/open) and the legacy guess-builder
        // (label/startOpen) option names.
        this._open = !!(options.open ?? options.startOpen);
        this._icon = options.icon ?? "arrow";        // "arrow" | "plus" | "none"
        this._title = options.title ?? options.label ?? null;

        // daisyUI base tokens; you can override via extraClasses
        this.classMap.base = "collapse bg-base-200";
        if (this._icon === "arrow") this.setClass("style", "collapse-arrow");
        if (this._icon === "plus")  this.setClass("style", "collapse-plus");
    }

    create() {
        const summaryEl = summary({ class: "collapse-title text-sm font-medium" }, this._title || "Details");
        const contentEl = div({ class: "collapse-content text-sm" }, ...this.children);

        const props = { ...this.commonProperties, ...this.extraProperties };
        if (this._open) props.open = true;
        return details(props, summaryEl, contentEl);
    }
}

// /**
//  * CollapseGroup — simple helper to build an accordion with shared radio name.
//  *
//  * options:
//  *  - name: string (required)     // radio group name
//  *  - items: Array<CollapseOptions | {title, content, open?, disabled?, icon?}>
//  *  - extraClasses: { base? }     // wrapper classes
//  *
//  * children:
//  *  - ignored (group renders from `items`)
//  */
// export class CollapseGroup extends BaseComponent {
//     constructor(options = undefined) {
//         options = super(options).options;
//         this.name = options.name || `accordion-${Math.random().toString(36).slice(2,7)}`;
//         this.items = Array.isArray(options.items) ? options.items : [];
//         this.classMap.base = options.extraClasses?.base || "flex flex-col gap-2";
//     }
//
//     create() {
//         const nodes = this.items.map((it, i) => {
//             const opts = { ...it, accordionName: this.name };
//             return new Collapse(opts).toNode();
//         });
//         return div({ ...this.commonProperties, class: this.classMap.base }, ...nodes);
//     }
// }
