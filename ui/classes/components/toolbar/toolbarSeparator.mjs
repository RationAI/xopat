import { BaseComponent } from "../../baseComponent.mjs";
import { Div } from "../../elements/div.mjs";
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
        return van.tags.div({class: "m-1", style: "width: max(100%, 5px); height: max(100%, 5px); background-color: oklch(var(--color-secondary))"});
    }
}

export { ToolbarSeparator };