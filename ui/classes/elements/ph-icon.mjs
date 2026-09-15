import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { ImageIcon } from "./image-icon.mjs";

const { i } = van.tags;

/**
 * @class PhIcon
 * @extends BaseComponent
 * @description Phosphor (Light) icon component — the only icon font xOpat ships.
 * @example
 * const settingsIcon = new PhIcon({ name: "ph-gear" });
 *
 * // Browse names at
 * // https://phosphoricons.com (Light weight) or src/libs/phoshor-icons/style.css.
 */
class PhIcon extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.name] - Phosphor class, e.g. "ph-magnifying-glass"
     */
    constructor(options = undefined, ...args) {
        if (typeof options === "string") {
            options = { name: options };
        }

        options = super(options, ...args).options;
        this.classMap["base"] = "ph-light";
        this.classMap["name"] = options["name"] || "";
    }

    /**
     * @param {string} name new Phosphor icon class, e.g. "ph-gear"
     */
    changeIcon(name) {
        this.setClass("name", name);
    }

    create() {
        return i({ ...this.commonProperties, ...this.extraProperties });
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.PhIcon({ name: "ph-gear" });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
    }
}

/**
 * Wrap a string icon name in its component. Kept as a named helper so
 * pass-through components do not have to know which class to instantiate;
 * callers that already hold a BaseComponent instance should bypass it.
 */
function iconComponentFor(name) {
    return new PhIcon({ name });
}

/**
 * The `icon` value of a plugin/module `include.json` record, as a component.
 * Accepts a Phosphor class (`ph-*`) or an image URL - the two forms that
 * survive everywhere an icon can be mounted; markup strings are not supported
 * (they would render as literal text through the string path of `toNode`).
 * @param {string|BaseComponent} value icon class, image URL, or a ready component
 * @param {object} [options] extra options merged into the created component
 * @return {BaseComponent|undefined} undefined for an empty value
 */
function componentIconNode(value, options = {}) {
    if (value instanceof BaseComponent) return value;

    const name = typeof value === "string" ? value.trim() : "";
    if (!name) return undefined;
    // an icon font value is a class name: anything else is a picture URL
    if (!/^ph[-\s]/.test(name)) return new ImageIcon({ name, ...options });
    return new PhIcon({ name, ...options });
}

export { PhIcon, ImageIcon, iconComponentFor, componentIconNode };
