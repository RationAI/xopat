import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { i } = van.tags

/**
 * @class FAIcon
 * @extends BaseComponent
 * @description A icon component
 * @example
 * const settingsIcon = new FAIcon({
 *    name: "fa-gear"
 * });
 *
 * //then we need to add it as an child to the another component:
 * const settings = new Button({
 *   onClick: () => {
 *      USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);
 *  },
 * id: "settingsButton",
 * }, settingsIcon);
*/
class FAIcon extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.name] - The name of the icon
    **/
    constructor(options, ...args) {

        if (typeof options === "string") {
            options = { name: options };
        }

        super(options, ...args);
        this.classMap["base"] = "fa-solid";
        this.classMap["name"] = options && options["name"] || "";
    }

    create() {
        return i({ ...this.commonProperties, ...this.additionalProperties });
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.FAIcon({ name: "fa-gear" });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }
}

export { FAIcon };
