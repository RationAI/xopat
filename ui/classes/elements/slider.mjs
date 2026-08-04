import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { label, input, span, div } = van.tags

/**
 * @class Slider
 * @extends BaseComponent
 * @description A labelled range input for numeric preferences. The current value
 * is rendered next to the label and updates live while dragging; `onchange` is
 * invoked with the input as `this` (same contract as {@link Checkbox}), so
 * `this.value` reads the new value.
 * @example
 * const slider = new Slider({
 *                             id: "zoom-speed",
 *                             label: "Zoom speed",
 *                             value: 1, min: 0.25, max: 4, step: 0.25,
 *                             onchange: function () { console.log(this.value); }
 *                           });
 */
class Slider extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.label] - The label shown above the slider
     * @param {number} [options.value] - Initial value
     * @param {number} [options.min] - Lower bound, default 0
     * @param {number} [options.max] - Upper bound, default 1
     * @param {number} [options.step] - Step size, default 0.1
     * @param {Function} [options.onchange] - Called on commit (change), `this` is the input
     * @param {Function} [options.format] - Value formatter for the readout, default `String`
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this.label = options["label"] || "";
        this.min = options["min"] ?? 0;
        this.max = options["max"] ?? 1;
        this.step = options["step"] ?? 0.1;
        this.format = options["format"] || (v => String(v));
        this.onchangeFunction = options["onchange"] || (() => {});
        this.valueState = van.state(options["value"] ?? this.min);
        this.classMap["base"] = "flex flex-col gap-1 w-full";
    }

    create() {
        const self = this;
        return label({...this.commonProperties, ...this.extraProperties},
            div({ class: "flex items-center justify-between gap-2" },
                this.label && span({}, this.label),
                span({ class: "text-xs opacity-70 tabular-nums" }, () => self.format(self.valueState.val))
            ),
            input({
                type: "range",
                class: "range range-xs range-primary",
                min: this.min,
                max: this.max,
                step: this.step,
                value: this.valueState.val,
                oninput: function () { self.valueState.val = Number(this.value); },
                onchange: this.onchangeFunction
            })
        );
    }
}

export { Slider };
