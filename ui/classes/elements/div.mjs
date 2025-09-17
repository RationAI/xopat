import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags

/**
 * @class Div
 * @extends BaseComponent
 * @description A div component
 * @example
 * const div = new Div({
 *                      id: "myDiv",
 *                      base: "flex gap-1 bg-base-200",
 *                      flex: "flex-col"
 *                      }, myButton, MyDiv
 *                     );
 * div.attachTo(document.body);
 */
export class Div extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options, ...args);
    }

    create() {
        return div(
            { ...this.commonProperties, onclick: this.options.onClick, ...this.extraProperties },
            ...this.children
        );
    }
}
