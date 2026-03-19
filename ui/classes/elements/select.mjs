import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";

const { select, option, div} = van.tags

export class Select extends BaseComponent{
    /**
     *
     * @param options
     * @param {Array<{text: string, value: string, hidden: ?Boolean}>} children
     */
    constructor(options = undefined, ...children) {
        options = super(options).options;

        this.title = options["title"] || "";
        this.selected = options["selected"] || null;
        this.onChange = options["onchange"] || (() => {});
        this.classMap["base"] = "select select-bordered select-xs max-w-xs";
        this._options = children;
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
                ...this._options.map(o => {
                    return option({
                        value: o.value || "",
                        selected: o.value === this.selected ? "selected" : "",
                        hidden: o.hidden || "",
                    }, o.text || "");
                })
            )
        )
    }
}