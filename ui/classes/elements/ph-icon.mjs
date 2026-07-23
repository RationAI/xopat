import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { ImageIcon } from "./image-icon.mjs";

const { i } = van.tags;

/**
 * @class PhIcon
 * @extends BaseComponent
 * @description Phosphor (Light) icon component. Prefer this for new code; FAIcon
 * remains for legacy Font Awesome call sites.
 * @example
 * const settingsIcon = new PhIcon({ name: "ph-gear" });
 *
 * // Use the native Phosphor name (no "fa-" prefix). Browse names at
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
 * Pick the right icon component for a string name: PhIcon for `ph-*`,
 * FAIcon otherwise. Use this in pass-through components so callers can pass
 * either family without the component caring which one. Callers that already
 * hold a BaseComponent instance should bypass this helper.
 */
function iconComponentFor(name) {
    return String(name ?? '').trim().startsWith('ph-')
        ? new PhIcon({ name })
        : new FAIcon({ name });
}

/**
 * The `icon` value of a plugin/module `include.json` record, as a component.
 * Accepts an icon class (`ph-*`, `fa-*`) or an image URL - the two forms that
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
    if (!/^(ph|fa)[-\s]/.test(name)) return new ImageIcon({ name, ...options });
    return name.startsWith("ph-") ? new PhIcon({ name, ...options }) : new FAIcon({ name, ...options });
}

export { PhIcon, ImageIcon, iconComponentFor, componentIconNode };
