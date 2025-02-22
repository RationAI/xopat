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

        // feel free to add your custom classMap properties here
        this.classMap["base"] = options["base"] || "";
        this.classMap["flex"] = options["flex"] || "";
        this.classMap["gap"] = options["gap"] || "";
        this.classMap["background"] = options["background"] || "";
        this.classMap["display"] = options["display"] || "";

    }

    create() {
        return div(
            { ...this.commonProperties },
            ...this.children
        );
    }

    generateCode() {
        return super.generateCode("Div");
    }
}

export { Div };