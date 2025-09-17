import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags

/**
 * @class Join
 * @extends BaseComponent
 * @description A join component to group e.g. buttons, inputs..
 * @example
 * const join = new Join({
 *                          id: "myJoin",
 *                          style: Join.STYLE.VERTICAL
 *                       }, button1, button2, button3);
 * join.attachTo(document.body);
 */
export class Join extends BaseComponent {

    /**
     * @param {*} options
     * @param {keyof typeof Join.STYLE} [options.style=undefined]
     * @param  {...any} args
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        //Todo add support for tracking the selected button if the join is a list of buttons (possibly define component buttongroup that inherits from a join)
        this.classMap["base"] = "join bg-join";
        // this.classMap["rotation"];
        // this.classMap["flex"];
        options.style = options.style || Join.STYLE.VERTICAL;
        this._applyOptions(options, "style", "rounded", "rotation");
    }

    create() {
        // Todo we might support also string children, detect type and convert to DOM objects if found to attach to classList manually...
        for (let child of this._children) {
            if (child instanceof BaseComponent) {
                child.setClass("join", "join-item");
            }
        }
        return div({ ...this.commonProperties, ...this.extraProperties }, ...this.children);
    }
}

Join.STYLE = {
    VERTICAL: function () { this.setClass("direction", "join-vertical"); },
    HORIZONTAL: function () { this.setClass("direction", "join-horizontal"); },
};

Join.ROUNDED = {
    ENABLE: function () { this.setClass("rounded", ""); },
    DISABLE: function () { this.setClass("rounded", "join-unrounded"); },
};

