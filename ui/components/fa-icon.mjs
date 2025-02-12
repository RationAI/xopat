import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { i } = van.tags

/**
 * TODO
 */
class FAIcon extends BaseComponent {

    /**
     * TODO
     */
    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "fa-solid";
        this.classMap["name"] = "";

        if (options) {
            if (options.name) this.classMap["name"] = options.name;
        }
    }

    create() {
        return i(
            { ...this.commonProperties},
        )
    }
}

export { FAIcon };
