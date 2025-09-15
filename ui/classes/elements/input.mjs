import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { legend, fieldset, input, label } = van.tags

/**
 * @class Input
 * @extends BaseComponent
 * @description A icon component
 * @example
*/
class Input extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {Function} [options.onChange] - The change handler
     * @param {UIElement} [options.legend] - The input legend
     * @param {UIElement} [options.prefix] - The input prefix
     * @param {UIElement} [options.suffix] - The input suffix
     * @param {Input.STYLE} [options.style] - The style
     * @param {Input.SIZE} [options.size] - The size
    **/
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        if (!options["style"]) options["style"] = Input.STYLE.NEUTRAL;
        if (!options["size"]) options["size"] = Input.SIZE.MEDIUM;
        this.classMap["base"] = "input";
        this._applyOptions(options, "size", "style");
    }

    /**
     *
     * @param {*} name name of the new icon from FontAwesome
     * @description Changes the icon of the component
     */
    changeIcon(name) {
        this.setClass("name", name);
    }

    create() {
        const legendContent = this.options["legend"];
        const prefix = this.options["prefix"];
        const suffix = this.options["suffix"];

        let result = input({ ...this.extraProperties });
        if (this.options["onChange"]) {
            result.onchange = this.options["onChange"];
        }
        if (prefix || suffix) {
            result = label(this.commonProperties,
                this.toNode(prefix),
                input(this.extraProperties),
                this.toNode(suffix));
        } else {
            result = input({ ...this.commonProperties, ...this.extraProperties });
        }
        if (legendContent) {
            result = fieldset({class: "fieldset "},
                legend({class: "fieldset-legend text-xs"}, this.toNode(legendContent)),
                result
            );
        }

        return result;
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.Input({ legend: "Legend", prefix: "Prefix", suffix: "Suffix", style: ui.Input.STYLE.PRIMARY, size: ui.Input.SIZE.MEDIUM }); });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }
}

Input.SIZE = {
    SMALL: function () { this.setClass("size", "input-xs"); },
    MEDIUM: function () { this.setClass("size", "input-sm"); },
    BIG: function () { this.setClass("size", "input-md"); },
    LARGE: function () { this.setClass("size", "input-lg"); },
};

Input.STYLE = {
    GHOST: function () { this.setClass("style", "input-ghost"); },
    NEUTRAL: function () { this.setClass("style", "input-neutral"); },
    PRIMARY: function () { this.setClass("style", "input-primary"); },
    SECONDARY: function () { this.setClass("style", "input-secondary"); },
    ACCENT: function () { this.setClass("style", "input-accent"); },
    SUCCESS: function () { this.setClass("style", "input-success"); },
    INFO: function () { this.setClass("style", "input-info"); },
    WARNING: function () { this.setClass("style", "input-warning"); },
    ERROR: function () { this.setClass("style", "input-error"); },
};

export { Input };
