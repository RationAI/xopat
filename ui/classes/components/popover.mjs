import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { placeFixedAnchored, trackAnchor } from "../elements/popupPlacement.mjs";

const { div } = van.tags;

/**
 * Anchored floating panel for arbitrary content (sliders, inputs, a small
 * form) — the thing to reach for when a control needs room without resizing
 * what it lives in.
 *
 * `Dropdown` and `ContextMenu` hold menu rows that close on click; this holds
 * content the user keeps interacting with. It is always portaled to
 * `document.body`, so no scroll container or stacking context around the
 * anchor can clip it, and it follows the anchor on scroll and resize.
 *
 * It owns no trigger: the caller toggles it from whatever button it has and
 * passes that button as `trigger` so a press on it is not also an outside
 * press. Closes on Escape and on a press outside the panel.
 *
 * @example
 * const pop = new Popover({ anchor: () => panelEl, trigger: buttonEl, width: 260 }, controlsNode);
 * button.onclick = () => pop.toggle();
 *
 * @param {object} options
 * @param {Element|(() => Element|null)} options.anchor element the panel is placed against
 * @param {Element|(() => Element|null)} [options.trigger] element that toggles the panel;
 *   presses on it never count as outside presses
 * @param {"bottom"|"right"} [options.placement="bottom"] preferred side, flips on overflow
 * @param {number|(() => number)} [options.width] panel width in px; content-sized when omitted
 * @param {(target: EventTarget|null) => boolean} [options.keepOpenOn] outside presses that
 *   must not close the panel (e.g. the slide the panel's controls act on)
 * @param {() => void} [options.onOpen]
 * @param {() => void} [options.onClose]
 * @param {...any} children panel content
 */
export class Popover extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this._anchor = options.anchor;
        this._trigger = options.trigger;
        this._placement = options.placement;
        this._width = options.width;
        this._keepOpenOn = options.keepOpenOn;
        this._onOpen = options.onOpen;
        this._onClose = options.onClose;
        this._panel = null;
        this._open = false;
        this._fmToken = null;
        this._untrack = null;
    }

    create() {
        if (this._panel) return this._panel;
        this._panel = div(
            {
                ...this.commonProperties,
                class: "glass rounded-lg shadow-lg border border-base-300 bg-base-100 p-2 text-sm",
                style: "box-sizing:border-box; pointer-events:auto;",
            },
            ...this._children.map(child => this.toNode(child)),
        );
        return this._panel;
    }

    isOpen() {
        return this._open;
    }

    toggle() {
        return this._open ? this.close() : this.open();
    }

    /** @returns {boolean} true when the panel is open afterwards */
    open() {
        if (this._open) return true;
        const anchor = this._resolve(this._anchor);
        // Nothing to hang on (anchor not rendered, or hidden with its menu).
        if (!anchor || !anchor.isConnected) return false;
        const panel = this.create();
        this._open = true;
        document.body.appendChild(panel);
        this.reposition();
        this._untrack = trackAnchor(() => this.reposition());
        this._fmToken = UI.Services.FloatingManager.register({
            el: panel,
            owner: this,
            // Never paint below the stacking context the anchor lives in.
            anchor,
            onEscape: "close",
            onOutsideClick: (e) => this._onOutsidePress(e),
        });
        UI.Services.FloatingManager.bringToFront(this._fmToken);
        this._onOpen?.();
        return true;
    }

    close() {
        if (!this._open) return false;
        this._open = false;
        this._untrack?.();
        this._untrack = null;
        if (this._fmToken) {
            UI.Services.FloatingManager.unregister(this._fmToken);
            this._fmToken = null;
        }
        this._panel?.remove();
        this._onClose?.();
        return false;
    }

    /** Re-apply width and placement; a no-op while closed. */
    reposition() {
        if (!this._open || !this._panel) return;
        const anchor = this._resolve(this._anchor);
        // The anchor went away under us (its menu was hidden or destroyed):
        // an orphan panel pinned to nothing is worse than a closed one.
        if (!anchor || !anchor.isConnected || !anchor.getClientRects().length) {
            this.close();
            return;
        }
        const width = typeof this._width === "function" ? this._width() : this._width;
        if (Number.isFinite(width) && width > 0) this._panel.style.width = `${width}px`;
        placeFixedAnchored(anchor, this._panel, { placement: this._placement });
    }

    /** @private */
    _onOutsidePress(e) {
        const target = e?.target ?? null;
        const trigger = this._resolve(this._trigger);
        // The trigger's own click handler toggles; closing here as well would
        // reopen the panel on the same press.
        if (trigger && target instanceof Node && trigger.contains(target)) return;
        if (this._keepOpenOn?.(target)) return;
        this.close();
    }

    /** @private */
    _resolve(ref) {
        return typeof ref === "function" ? ref() : (ref || null);
    }

    destroy() {
        this.close();
        this._panel = null;
        this._onOpen = this._onClose = null;
    }
}
