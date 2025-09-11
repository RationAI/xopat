import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";

const { select, option, div} = van.tags

class Select extends BaseComponent{
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this.title = options["title"] || "";
        this.selected = options["selected"] || null;
        this.onChange = options["onchange"] || (() => {});
    }

    create() {
        return div({},
            this.title,
            select({ 
                    class: "select select-bordered select-xs max-w-xs",
                    onchange: this.onChange,
                    id: this.id,
                    style: "margin: 0.2rem;",
                },
                ...this._children.map(o => {
                    return option({
                        value: o.value || "",
                        selected: o.value === this.selected ? "selected" : "",
                        hidden: o.hidden || "",
                        text: o.text || ""
                    });
                })
            )
        )
    }
}

export { Select };