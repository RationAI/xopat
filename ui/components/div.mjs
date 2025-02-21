import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { div } = van.tags

class Div extends BaseComponent {
    constructor(options, ...args) {
        super(options, ...args);

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