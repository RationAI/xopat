import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { div, input, details, summary } = van.tags

/**
 * @class Collapse
 * @extends BaseComponent
 * @description A collapse component
 * @example
 * const collapse = new Collapse({
 *    id: "myCollapse",
 *   summary: "Click me",
 * },
 * div("I am in the collapse"));
 * collapse.attachTo(document.body);
 */
class Collapse extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.summary] - The text of the summary
     * @param {boolean} [options.startOpen] - Whether the collapse should start open
     * @param {string} [options.textSize] - The text size of the summary
     * @param {string} [options.font] - The font of the summary
     * @param {string} [options.customSummary] - The custom summary
     */
    constructor(options, ...args) {
        if (typeof options === "string") {
            options = { summary: options };
        };
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
            if (options.summary) this.summary = options.summary;
            this._applyOptions(options, "textSize", "font", "customSummary");
        }
    }

    create() {
        return details(
            { ...this.commonProperties, ...this.additionalProperties, open: this.startOpen },
            summary({ class: ["collapse-title select-none", this.classMap["textSize"], this.classMap["font"], ...this.classMap["summaryClassList"]].join(" ") }, this.summary),
            div({ class: "collapse-content" + " " + this.classMap["detailsClassList"].join(" ") },
                ...this.children
            )
        );
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.Collapse({
    id: "myCollapse",
    summary: "Click me",
},"you clicked on collapse");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }

}

export { Collapse };
