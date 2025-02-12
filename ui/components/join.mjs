import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

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
class Join extends BaseComponent {

    /**
     * @param {*} options
     * @param {keyof typeof Join.STYLE} [options.style=undefined]
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options, ...args);

        //Todo add support for tracking the selected button if the join is a list of buttons (possibly define component buttongroup that inherits from a join)
        this.classMap["base"] = "join";
        if (!options) options = {};
        options.style = options.style || Join.STYLE.VERTICAL;
        this._applyOptions(options, "style");

        // Todo we might support also string children, detect type and convert to DOM objects if found to attach to classList manually...
        for (let child in this._children) {
            if (child instanceof BaseComponent) {
                child.setClass("join", "join-item");
            }
        }
    }

    create() {
        return div(this.commonProperties, ...this.children);
    }
}

Join.STYLE = {
    VERTICAL: function () { this.setClass("direction", "join-vertical"); },
    HORIZONTAL: function () { this.setClass("direction", "join-horizontal"); },
};

export { Join };
