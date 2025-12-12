// ui/classes/elements/title.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { h1, h2, h3, h4, div } = van.tags;

/**
 * Title element
 *
 * options:
 *  - text: string (title text)
 *  - level: 1|2|3|4 (default: 2)
 *  - separator: boolean (default: false) → adds horizontal divider after title
 *  - extraClasses: { base?: string, text?: string, separator?: string }
 */
export class Title extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this.text = options.text ?? "";
        this.level = options.level ?? 2;
        this.separator = !!options.separator;

        this.classMap.base = "x-title flex flex-col";
        this.classMap.text = this._classForLevel(this.level);

        if (options.extraClasses) {
            Object.entries(options.extraClasses).forEach(([k, v]) => {
                this.classMap[k] = v;
            });
        }
    }

    _classForLevel(level) {
        switch (level) {
            case 1: return "text-3xl font-bold";
            case 2: return "text-2xl font-semibold";
            case 3: return "text-xl font-semibold";
            case 4: return "text-lg font-medium";
            default: return "text-2xl font-semibold";
        }
    }

    create() {
        const Tag = [h1, h2, h3, h4][(this.level - 1).clamp?.(0, 3) ?? 1] || h2;

        const titleEl = Tag({
            ...this.commonProperties, //distributes common classes to all children
            class: this.classMap.text,
            ...this.extraProperties,
        }, this.text);

        if (this.separator) {
            return div({ class: this.classMap.base },
                titleEl,
                div({ class: "divider " + (this.classMap.separator || "") })
            );
        } else {
            return div({ class: this.classMap.base }, titleEl);
        }
    }
}
