import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { div, input, details, summary } = van.tags

class Collapse extends BaseComponent {

    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "collapse bg-base-200 collapse-arrow";
        this.classMap["collapseTitle"] = "";
        this.classMap["textSize"] = "text-xl";
        this.classMap["font"] = "font-medium";
        this.classMap["summaryClassList"] = [];
        this.classMap["detailsClassList"] = [];
        this.input = "checkbox";
        this.summary = "Expand"; // TODO -> translation
        this.startOpen = !!options.startOpen;

        if (options) {
            if (options.size) this.classMap["textSize"] = options.size;
            if (options.font) this.classMap["font"] = options.font;
            if (options.summary) this.summary = options.summary;
            if (options.customSummary) this.classMap["customSummary"] = options.customSummary;
        }
    }

    create() {
        return details(
            { class: this.classMap["base"], open: this.startOpen },
            summary({ class: ["collapse-title select-none", this.classMap["textSize"], this.classMap["font"], ...this.classMap["summaryClassList"]].join(" ") }, this.summary),
            div({ class: "collapse-content" + " " + this.classMap["detailsClassList"].join(" ") },
                ...this.children
            )
        )
    }
}

export { Collapse };