import { BaseComponent } from "./baseComponent.mjs";

class Toolbar extends BaseComponent{
    constructor(options, ...args) {
        super(options, ...args);
        this.id = options["id"] || "toolbar";
        this.orientation = options["orientation"] || "horizontal"; // horizontal or vertical
        this.join
    }

    create() {}
}

export { Toolbar };