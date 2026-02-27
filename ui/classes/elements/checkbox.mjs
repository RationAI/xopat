import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { label, input, span } = van.tags

/**
 * @class Checkbox
 * @extends BaseComponent
 * @description A checkbox component that can be used in forms or settings.
 * @example
 * const checkbox = new Checkbox({
 *                                id: "myCheckbox",
 *                                label: "Accept Terms and Conditions",
 *                                checked: true,
 *                                onchange: () => console.log("Checkbox state changed")
 *                               });
 */
class Checkbox extends BaseComponent {

    /**
     * @param {*} options 
     * @param  {...any} args 
     * @param {string} [options.label] - The label for the checkbox
     * @param {boolean} [options.checked] - The initial checked state of the checkbox
     * @param {Function} [options.onchange] - The function to call when the checkbox state changes
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this.label = options["label"] || "";
        this.checked = options["checked"] || false;
        this.onchangeFunction = options["onchange"] || (() => {});
        this.classMap["base"] = "cursor-pointer";
    }

    create(){
        return  label({...this.commonProperties, style:"display: flex; align-items: center; gap: 8px;", onmousedown: function (e) {e.stopPropagation(); e.preventDefault();}, ...this.extraProperties},
            input({ type: "checkbox", class: "checkbox checkbox-sm", checked: this.checked ? "checked" : "", onchange: this.onchangeFunction }),
            this.label && span({class: ""}, this.label),
        );
    }
}

export { Checkbox };