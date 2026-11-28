import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span } = van.tags;

/**
 * @typedef {import('./baseComponent.mjs').BaseUIOptions} BaseUIOptions
 */

/**
 * @typedef {Object} StatusBarOptions
 * @property {string} [id="viewer-status-bar"] Root element id (kept for compatibility)
 * @property {string} [mountId="osd"] Element id to mount into (viewer bounding box)
 * @property {number} [bottomPx=10] Distance from bottom of the viewer area
 * @property {number} [edgePadPx=15] Padding from viewer edges
 * @property {boolean} [visible=true] Initial visibility
 * @property {string} [initialMessage=""] Initial message (plain text)
 * @property {BaseUIOptions["extraClasses"]} [extraClasses]
 * @property {BaseUIOptions["extraProperties"]} [extraProperties] String-only props
 */

/**
 * Status bar component positioned within the viewer area (no dock overlap).
 *
 * Usage:
 *   const status = new UI.StatusBar().attachTo("osd");
 *   status.show("Indexing…");
 */
export class StatusBar extends BaseComponent {
    /** @param {StatusBarOptions} [options] */
    constructor(options = undefined) {
        options = super(options).options;

        this.id = options.id || "viewer-status-bar";
        this.mountId = options.mountId || "osd";

        this.bottomPx = Number.isFinite(options.bottomPx) ? options.bottomPx : 10;
        this.edgePadPx = Number.isFinite(options.edgePadPx) ? options.edgePadPx : 15;

        this._message = van.state(options.initialMessage || "");
        this._style = van.state(this._buildStyle());

        this.classMap = {
            ...(this.classMap || {}),
            base:
                "absolute glass fixed-bg-opacity bg-opacity px-2 py-1 rounded-2 overflow-hidden pointer-events-none",
            text: "text-base-content",
        };

        const visible = options.visible !== false;
        this.toggleClass("hidden", "hidden", !visible);
        this.refreshClassState();
    }

    /** @private */
    _buildStyle() {
        const pad = this.edgePadPx;
        return [
            "color: var(--color-text-primary);",
            `bottom: ${this.bottomPx}px;`,
            `right: ${pad}px;`,
            `max-width: calc(100% - ${pad * 2}px);`, // stays inside viewer, never under dock
            "z-index: 50;",
        ].join(" ");
    }

    /** @returns {StatusBar} */
    setVisible(visible) {
        this.toggleClass("hidden", "hidden", !visible);
        if (this.context) this.context.className = String(this.classState.val || "");
        return this;
    }

    /** @param {string} text plain text; markup is shown literally @returns {StatusBar} */
    show(text) {
        this._message.val = String(text ?? "");
        this.setVisible(true);
        return this;
    }

    /** @returns {StatusBar} */
    clear() {
        this._message.val = "";
        return this;
    }

    /** @override */
    create() {
        // BaseComponent contract: commonProperties + custom props + extraProperties
        const root = div(
            {
                ...this.commonProperties,
                style: this._style,
                ...this.extraProperties,
            },
            // State as a child = reactive text node; the message is never parsed as HTML.
            span({ class: "one-liner" }, this._message)
        );
        return root;
    }
}