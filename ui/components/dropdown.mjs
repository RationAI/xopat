import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { Button } from "./buttons.mjs";
import { FAIcon } from "./fa-icon.mjs";

const { div, ul, span } = van.tags

/**
 * @class Dropdown
 * @extends BaseComponent
 * @description A dropdown component, after clicking on button, it will show a list of children
 * @example
 *  const tab = new Dropdown({
 *      id: item.id,
 *      parentId: this.id,
 *      icon: item.icon,
 *      title: item.title,
 *      onClick: item.onClick || (() => {}),
 *      },
 *      ...children) 
 */
class Dropdown extends BaseComponent {

    /**
     * 
     * @param {*} options 
     * @param {string} options.title - The title of the dropdown
     * @param {string} options.icon - The icon of the dropdown, can be a string or a FAIcon instance
     * @param {string} options.parentId - The ID of the parent element to which this dropdown belongs
     * @param {function} options.onClick - The function to be called when the dropdown is clicked
     * @param  {...any} children 
     */
    constructor(options, ...children) {
        super(options, ...children);
        this.title = options["title"] || "";
        this.icon = options["icon"] || "";
        this.parentId = options["parentId"] || "";
        this.onClick = options["onClick"] || (() => {});
        this.headerButton = this.createButton(options);
    }

    /**
     * 
     * @returns {Button} - A button component that serves as the header for the dropdown
     */
    createButton() {
        let inIcon = (this.icon instanceof BaseComponent) ? this.icon : new FAIcon({ name: this.icon });        


        const b = new Button({
            id: this.parentId + "-b-" + this.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: this.title },
        }, inIcon, span(this.title));

        return b;
    }

    create() {
        return div({ class: "dropdown join-item", onclick: this.onClick},
            // IDK if this will work in safari -> https://bugs.webkit.org/show_bug.cgi?id=22261
                div({ tabindex: "0", class: ""}, 
                    this.headerButton.create(),
                ),
                ul({ id: this.parentId + "-ul-" + this.id, class: "dropdown-content bg-base-100 menu rounded-box z-[1] w-52", style: "row-gap: 0.2vh",
                    onclick: (event) => {event.stopPropagation();}},
                    ...this.children,
                )
            );
    }
    iconOnly() {
        this.headerButton.iconOnly();
    }
    titleIcon() {
        this.headerButton.titleIcon();
    }
    titleOnly() {
        this.headerButton.titleOnly();
    }
    iconRotate() {
        this.headerButton.iconRotate();
    }
    close() {}
    _removeFocus() {}
}
export { Dropdown };
