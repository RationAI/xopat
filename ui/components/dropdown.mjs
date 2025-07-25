import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { Button } from "./buttons.mjs";
import { FAIcon } from "./fa-icon.mjs";

const { div, ul, span } = van.tags

class Dropdown extends BaseComponent {

    constructor(options, ...children) {
        super(options, ...children);
        this.title = options["title"] || "";
        this.icon = options["icon"] || "";
        this.id = options["id"] || Math.random().toString(36).substring(2, 15);
        this.parentId = options["parentId"] || "";

        this.headerButton = this.createButton(options);

    }

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
        return div({ class: "dropdown join-item"},
            // IDK if this will work in safari -> https://bugs.webkit.org/show_bug.cgi?id=22261
                div({ tabindex: "0", class: ""}, 
                    this.headerButton.create(),
                ),
                ul({ class: "dropdown-content bg-base-100 menu rounded-box z-[1] w-52", style: "row-gap: 0.2vh" },
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
}
export { Dropdown };
