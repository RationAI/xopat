import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";

const { select, option, div} = van.tags

export class Select extends BaseComponent{
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this.title = options["title"] || "";
        this.selected = options["selected"] || null;
        this.onChange = options["onchange"] || (() => {});
        this.classMap["base"] = "select select-bordered select-xs max-w-xs";
    }

    create() {
        return div({},
            this.title,
            select(
                {
                    ...this.commonProperties,
                    onchange: this.onChange,
                    style: "margin: 0.2rem;",
                    ...this.extraProperties,
                },
                ...this._children.map(o => {
                    return option({
                        value: o.value || "",
                        selected: o.value === this.selected ? "selected" : "",
                        hidden: o.hidden || "",
                    });
                })
            )
        )
    }
}