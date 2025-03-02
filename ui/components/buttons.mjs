import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { button } = van.tags

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
     * @param {keyof typeof Button.SIZE} [options.size] - The size of the button
     * @param {keyof typeof Button.OUTLINE} [options.outline] - The outline style of the button
     * @param {keyof typeof Button.TYPE} [options.type] - The button type
     */
    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "btn";
        this.classMap["type"] = "btn-primary";
        this.classMap["size"] = "";
        this.classMap["outline"] = "";

        this.additionalProperties = options["additionalProperties"] || {};

        if (options) {
            if (options.onClick) this.onClick = options.onClick;
            this._applyOptions(options, "size", "outline", "type");
        }
    }

    create() {
        return button(
            { ...this.commonProperties, onclick: this.onClick, ...this.additionalProperties },
            ...this.children
        );
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.Button({
    id: "myButton",
    size: ui.Button.SIZE.NORMAL,
    outline: ui.Button.OUTLINE.DISABLE,
    TYPE: ui.Button.TYPE.PRIMARY,
    onClick: function () {
        console.log("Button clicked");
    }
},"Click me");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;

    }
}

Button.SIZE = {
    LARGE: function () { this.setClass("size", "btn-lg"); },
    NORMAL: function () { this.setClass("size", ""); },
    SMALL: function () { this.setClass("size", "btn-sm"); },
    TINY: function () { this.setClass("size", "btn-xs"); }
};

Button.OUTLINE = {
    ENABLE: function () { this.setClass("outline", "btn-outline"); },
    DISABLE: function () { this.setClass("outline", ""); }
};

Button.TYPE = {
    PRIMARY: function () { this.setClass("type", "btn-primary") },
    SECONDARY: function () { this.setClass("type", "btn-secondary") },
    TERNARY: function () { this.setClass("type", "btn-accent") }
}

export { Button };
