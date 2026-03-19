import van from "../../vanjs.mjs";
import { BaseSelectableComponent } from "../baseComponent.mjs";

const { button } = van.tags

/**
 * @class Button
 * @extends BaseSelectableComponent
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
class Button extends BaseSelectableComponent {

    /**
     * @param {BaseUIOptions} options
     * @param  {...any} args
     * @param {Function} [options.onClick] - The click event handler
     * @param {keyof typeof Button.SIZE} [options.size] - The size of the button
     * @param {keyof typeof Button.OUTLINE} [options.outline] - The outline style of the button
     * @param {keyof typeof Button.TYPE} [options.type] - The button type
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this.classMap["base"] = options["base"] || "btn";
        this.classMap["type"] = options["type"] || "btn-neutral";
        this.classMap["size"] = "";
        this.classMap["outline"] = "";
        this.classMap["orientation"] = "";
        this.style = "ICONTITLE";

        this.onClick = options.onClick;
        this._applyOptions(options, "size", "outline", "type", "orientation", "style");
    }

    create() {
        return button(
            { ...this.commonProperties, onclick: this.onClick, ...this.extraProperties },
            ...this.children
        );
    }

    /**
     * @description Sets button to show only icon
     **/
    iconOnly(){
        this.style = "ICONONLY";
        const nodes = this.children;
        for (let n of nodes){
            if (n.nodeName === "SPAN"){
                n.classList.add("hidden");
            } else if (n.nodeName === "I") {
                n.classList.remove("hidden");
            }
        }
    }

    /**
     * @description Sets button to show only title
     **/
    titleOnly(){
        this.style = "TITLEONLY";
        const nodes = this.children;
        for (let n of nodes){
            if (n.nodeName === "I"){
                n.classList.add("hidden");
            }
            else if(n.nodeName === "SPAN"){
                n.classList.remove("hidden");
            }
        }
    }

    /**
     * @description Sets button to show title and icon
     **/
    titleIcon(){
        this.style = "TITLEICON";
        const nodes = this.children;
        for (let n of nodes){
            n.classList.remove("hidden");
        }
    }

    /**
     * @description Rotates icon based on orientation
     * TODO WE SHOULD DEFINE ROTABLE COMPONENT AND MENU ONLY ACCEPTS SUCH COMPONENT...
     **/
    iconRotate(){
        const nodes = this.children;
        for (let n of nodes){
            if (n.nodeName === "I"){
                if(this._orientation==="b-vertical-right"){
                    n.classList.add("rotate-90");

                } else if(this._orientation==="b-vertical-left"){
                    n.classList.add("-rotate-90");
                }
            }
        }
    }

    /**
     * Set the selected state of the button.
     * Applies the 'btn-active' DaisyUI class if selected.
     * @param {string|boolean} itemID - The ID of the selected item, or false/null to deselect
     */
    setSelected(itemID) {
        this.toggleClass("selected", "btn-active", this.itemID === itemID);
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

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
    TERNARY: function () { this.setClass("type", "btn-accent") },
    NEUTRAL: function () { this.setClass("type", "btn-neutral") },
    NONE: function () { this.setClass("type", "") }
};

Button.ORIENTATION = {
    HORIZONTAL: function () {
        this.setClass("orientation", "");
        this.iconRotate();
    },
    VERTICAL_LEFT: function () {
        this.setClass("orientation", "b-vertical-left");
        this.iconRotate();
    },
    VERTICAL_RIGHT: function () {
        this.setClass("orientation", "b-vertical-right");
        this.iconRotate();
    }
};

Button.STYLE = {
    ICONONLY: function () {
        this.iconOnly();
    },
    TITLEONLY: function () {
        this.titleOnly();
    },
    TITLEICON: function () {
        this.titleIcon();
    }
};

export { Button };