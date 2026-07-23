import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { img } = van.tags;

/**
 * @class ImageIcon
 * @extends BaseComponent
 * @description An icon backed by an image URL instead of an icon font, so that
 * components taking an `icon` option (menus, plugin rows) accept both an icon
 * class and a picture. Mirrors the PhIcon/FAIcon interface - notably
 * `options.name`, which pass-through components read back.
 * @example
 * const logo = new ImageIcon({ name: "plugins/my-plugin/logo.png", alt: "My plugin" });
 */
class ImageIcon extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.name] - image URL, absolute or relative to the app
     * @param {string} [options.alt] - alternative text, empty by default (icons are decorative)
     * @param {string} [options.sizeClass] - sizing utilities, "w-5 h-5" by default (icon-font size)
     */
    constructor(options = undefined, ...args) {
        if (typeof options === "string") {
            options = { name: options };
        }

        options = super(options, ...args).options;
        this.classMap["base"] = "inline-block object-cover";
        this.classMap["size"] = options["sizeClass"] || "w-5 h-5";
        this._srcState = van.state(options["name"] || "");
    }

    /**
     * @param {string} name new image URL
     */
    changeIcon(name) {
        this.options.name = name;
        this._srcState.val = name || "";
    }

    create() {
        return img({
            src: this._srcState,
            alt: this.options.alt || "",
            ...this.commonProperties,
            ...this.extraProperties
        });
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.ImageIcon({ name: "src/assets/image.png" });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
    }
}

export { ImageIcon };
