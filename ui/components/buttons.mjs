import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { button, span } = van.tags

/**
 * @class Button
 * @extends BaseComponent
 * @description A button component
 * @example
 * const button = new Button({ 
 *                            id: "myButton",
 *                            size: Button.SIZE.LARGE, 
 *                            outline: Button.OUTLINE.ENABLE 
 *                           }, 
 *                           "Click me");
 * button.attachTo(document.body);
 */
class Button extends BaseComponent {

    /**
     * @param {*} options 
     * @param  {...any} args 
     * @param {Function} [options.onClick] - The click event handler
     * @param {Button.SIZE} [options.size] - The size of the button
     * @param {Button.OUTLINE} [options.outline] - The outline style of the button
     */
    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "btn";
        this.classMap["size"] = "";
        this.classMap["outline"] = "";

        if (options) {
            if (options.onClick) this.onClick = options.onClick;
            if (options.size) this.classMap["size"] = options.size;
            if (options.outline) this.classMap["outline"] = "btn-outline";
        }
    }

    create() {
        return button(
            { id: this.id, class: Object.values(this.classMap).join(" "), onclick: this.onClick },
            ...this.children)
    }
}

Button.SIZE = {
    LARGE: function () { this.setClass("size", "btn-lg"); },
    NORMAL: function () { this.setClass("size", ""); },
    SMALL: function () { this.setClass("size", "btn-sm"); },
    TINY: function () { this.setClass("size", "btn-xs"); }
};

Button.OUTLINE = {
    ENABLE: function () { this.classMap["outline"] = "btn-outline"; this.refreshState(); },
    DISABLE: function () { this.classMap["outline"] = ""; this.refreshState(); }
};

/**
 * @class PrimaryButton
 * @extends Button
 * @description Button with primary style
 * @example
 * const button = new PrimaryButton({ 
 *                            id: "myButton",
 *                            size: Button.SIZE.LARGE, 
 *                            outline: Button.OUTLINE.ENABLE 
 *                           }, 
 *                           "Click me");
 * button.attachTo(document.body);
 */
class PrimaryButton extends Button {

    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "btn btn-primary";
    }
}

export { Button, PrimaryButton };