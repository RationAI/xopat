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
        // A hairline rule on the toolbar's main axis, stretched across the cross
        // axis by the row's align-items. Orientation decides which axis is the
        // 1px line vs the full-length stretch. Each group already reads as its
        // own rounded pill, so the divider only has to hint at the boundary —
        // the previous 2px secondary-coloured bar competed with the groups and
        // cost width the toolbar does not have.
        const el = van.tags.div({
            // no cross-axis margin: the row's own gap already spaces the groups
            class: "m-1 self-stretch shrink-0 bg-base-300"
        });
        bindToolbarOrientation(el, (dir) => {
            if (dir === "vertical") {
                el.style.width = "auto";
                el.style.height = "1px";
            } else {
                el.style.width = "1px";
                el.style.height = "auto";
            }
        });
        return el;
    }
}

export { ToolbarSeparator };