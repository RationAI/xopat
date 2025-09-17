import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags

/**
 * @class Badge
 * @extends BaseComponent
 * @description A Badge component
 * @example
 */
class Badge extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {Badge.STYLE} [options.style] - The style
     * @param {Badge.SIZE} [options.size] - The size
     * @param {Badge.COLOR} [options.color] - The color
     **/
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        if (!options["style"]) options["style"] = Badge.STYLE.NONE;
        if (!options["size"]) options["size"] = Badge.SIZE.MEDIUM;
        if (!options["color"]) options["color"] = Badge.COLOR.PRIMARY;
        this.classMap["base"] = "badge";
        this._applyOptions(options, "size", "style", "color");
    }

    create() {
        return div({...this.commonProperties, ...this.extraProperties}, ...this.children);
    }

    /**
     * TODO component together with button is used in menu header, it needs a common interface so that menu can know its 'rotable-able'
     */
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

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.Badge("Hello!");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }
}

Badge.SIZE = {
    SMALL: function () { this.setClass("size", "badge-xs"); },
    MEDIUM: function () { this.setClass("size", "badge-sm"); },
    BIG: function () { this.setClass("size", "badge-md"); },
    LARGE: function () { this.setClass("size", "badge-lg"); },
};

Badge.COLOR = {
    NEUTRAL: function () { this.setClass("color", "badge-neutral"); },
    PRIMARY: function () { this.setClass("color", "badge-primary"); },
    SECONDARY: function () { this.setClass("color", "badge-secondary"); },
    ACCENT: function () { this.setClass("color", "badge-accent"); },
    SUCCESS: function () { this.setClass("color", "badge-success"); },
    INFO: function () { this.setClass("color", "badge-info"); },
    WARNING: function () { this.setClass("color", "badge-warning"); },
    ERROR: function () { this.setClass("color", "badge-error"); },
};

Badge.STYLE = {
    NONE: function() { this.setClass("style", "") },
    SOFT: function() { this.setClass("style", "badge-soft") },
    OUTLINE:  function() { this.setClass("style", "badge-outline") },
    GHOST: function() { this.setClass("style", "badge-ghos") },
}

export { Badge };
