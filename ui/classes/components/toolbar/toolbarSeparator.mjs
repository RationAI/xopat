import { BaseComponent } from "../../baseComponent.mjs";
import { Div } from "../../elements/div.mjs";
import { bindToolbarOrientation } from "./toolbarOrientation.mjs";
import van from "../../../vanjs.mjs";

/**
 * @class ToolbarSeparator
 * @extends BaseComponent
 * @description A visual divider for separating ToolbarGroups.
 * It automatically switches between horizontal and vertical orientation.
 *
 * @param {object} [options] - Configuration options.
 * @param {string} [options.id] - The ID for the component.
 */
class ToolbarSeparator extends BaseComponent {
    constructor(options = undefined, ...args) {
        super(options, ...args);
    }

    /**
     * @description Creates the separator element.
     * @returns {HTMLElement} The rendered divider element.
     */
    create() {
        // A thin rule on the toolbar's main axis, stretched across the cross
        // axis by the join's default align-items:stretch. Orientation decides
        // which axis is the 2px line vs the full-length stretch.
        const el = van.tags.div({
            class: "m-1 self-stretch shrink-0",
            style: "background-color: oklch(var(--color-secondary))"
        });
        bindToolbarOrientation(el, (dir) => {
            if (dir === "vertical") {
                el.style.width = "auto";
                el.style.height = "2px";
            } else {
                el.style.width = "2px";
                el.style.height = "auto";
            }
        });
        return el;
    }
}

export { ToolbarSeparator };