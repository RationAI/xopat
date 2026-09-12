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
        const node = select(
            {
                ...this.commonProperties,
                onchange: this.onChange,
                // Without this the browser restores the value this control held in the
                // previous page-life on a soft reload — and reports it as a user change.
                // A select bound to app state must reflect the state, not the history.
                autocomplete: "off",
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
        );

        // Van assigns properties before appending children, so a `value` passed through
        // extraProperties lands on a select that has no options yet and is discarded. The
        // browser then displays the *first* option, which is a different item than the
        // caller asked for. Re-apply once the options exist; when none matches, show nothing
        // rather than something wrong.
        const desired = this.propertiesMap?.value ?? this.selected;
        if (desired !== undefined && desired !== null) {
            if (this._options.some(o => (o.value || "") === desired)) node.value = desired;
            else node.selectedIndex = -1;
        }

        return div({}, this.title, node);
    }
}