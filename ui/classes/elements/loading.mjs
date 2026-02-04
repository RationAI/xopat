import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span } = van.tags;

/**
 * Loading Component
 * Provides a standardized spinner with optional title and description.
 * Can be used inline or as an absolute overlay.
 */
export class Loading extends BaseComponent {
    /**
     * @param {{
     * id?: string,
     * title?: string|Node,
     * description?: string|Node,
     * overlay?: boolean,     // If true, fills parent with semi-transparent backdrop
     * size?: "xs"|"sm"|"md"|"lg",
     * type?: "spinner"|"dots"|"ring"|"ball",
     * visible?: boolean
     * }} opts
     */
    constructor(opts = {}) {
        opts = super(opts).options;
        this.title = opts.title ?? "";
        this.description = opts.description ?? "";
        this.overlay = !!opts.overlay;
        this.size = opts.size ?? "md";
        this.type = opts.type ?? "spinner";
        this.visible = opts.visible ?? false;

        this._computeClasses();
    }

    _computeClasses() {
        const sizeClass = `loading-${this.size}`;
        const typeClass = `loading-${this.type}`;

        // Base spinner classes
        this.classMap.spinner = `loading ${typeClass} ${sizeClass}`;

        // Wrapper classes
        this.classMap.base = [
            this.overlay ? "absolute inset-0 z-[9999] bg-base-300/60 backdrop-blur-[1px]" : "relative p-4",
            "flex flex-col items-center justify-center gap-4 text-center",
            this.visible ? "" : "hidden"
        ].join(" ");
    }

    create() {
        const titleNode = div({
            id: `${this.id}-title`,
            class: "text-lg font-bold " + (this.title ? "" : "hidden")
        }, this.title);

        const descNode = div({
            id: `${this.id}-desc`,
            class: "text-sm opacity-70 max-w-[80%] " + (this.description ? "" : "hidden")
        }, this.description);

        const spinner = span({ class: this.classMap.spinner });

        return div(
            {
                ...this.commonProperties,
                id: this.id,
                class: this.classMap.base,
            },
            spinner,
            div({ class: "flex flex-col items-center gap-1" },
                titleNode,
                descNode
            )
        );
    }

    /* ------- API for runtime updates ------- */

    /**
     * Update the visibility and text of the loader
     * @param {boolean} visible
     * @param {string} title
     * @param {string} description
     */
    update(visible, title = null, description = null) {
        this.visible = visible;
        if (title !== null) this.title = title;
        if (description !== null) this.description = description;

        const el = document.getElementById(this.id);
        if (!el) return;

        // Toggle visibility
        el.classList.toggle("hidden", !this.visible);

        // Update Text
        const titleEl = document.getElementById(`${this.id}-title`);
        const descEl = document.getElementById(`${this.id}-desc`);

        if (titleEl) {
            titleEl.textContent = this.title;
            titleEl.classList.toggle("hidden", !this.title);
        }
        if (descEl) {
            descEl.textContent = this.description;
            descEl.classList.toggle("hidden", !this.description);
        }
    }

    show(title, desc) { this.update(true, title, desc); }
    hide() { this.update(false); }
}