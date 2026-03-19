// ui/classes/elements/collapse.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags;

/**
 * Collapse
 *
 * options:
 *  - title: string | Node | (children[0] can override)
 *  - open: boolean (default false)   // initial state (checkbox/radio checked)
 *  - icon: "arrow" | "plus" | "none" (default "arrow")
 *  - accordionName: string | null    // when set, uses <input type="radio" name=...> (accordion)
 *  - extraClasses: { base?, title?, content? }   // class overrides
 *  - on: { toggle?: (open:boolean)=>void }       // callback on open/close
 *
 * children:
 *  - [0]: custom title node (optional)
 *  - [1..n]: custom content nodes (optional, overrides `content`)
 */
export class Collapse extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this._open = !!options.open;
        this._icon = options.icon ?? "arrow";        // "arrow" | "plus" | "none"

        // content sources
        this._title = options.title ?? null;

        // class maps
        // daisyUI base tokens; you can override via extraClasses
        this.classMap.base = "collapse bg-base-200";
        if (this._icon === "arrow") this.setClass("style", "collapse-arrow");
        if (this._icon === "plus")  this.setClass("style", "collapse-plus");
    }

    create() {
        // Title & content
        const titleEl = div({ class: "collapse-title text-sm font-medium" }, this._title || "Details");
        const contentEl = div({ class: "collapse-content text-sm" }, ...this.children);

        return div({ ...this.commonProperties, ...this.extraProperties, tabindex: "0" }, titleEl, contentEl);
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
