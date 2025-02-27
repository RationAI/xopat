import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

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
class Div extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options, ...args);

        if (options) {
            for (const [key, val] of Object.entries(options)) {
                this.classMap[key] = val;
            }
        }

    }

    create() {
        return div(
            { ...this.commonProperties },
            ...this.children
        );
    }
}

export { Div };