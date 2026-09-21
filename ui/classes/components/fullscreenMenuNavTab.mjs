import { MenuTab } from "./menuTab.mjs";

/**
 * Single-active tab behavior for modal/fullscreen menus.
 * Unlike the base MenuTab, clicking the active item does not toggle it closed.
 *
 * Selection styling follows the "join" design: the selected nav button
 * shares the content area's background (base-200) so it reads as connected
 * to the opened page, while unselected buttons render as dimmed ghosts on
 * the sidebar's base-300 tone (see FullscreenMenuPanel). The base MenuTab's
 * btn-secondary highlight would show a detached color pill instead.
 */
class FullscreenMenuNavTab extends MenuTab {
    _setFocus() {
        super._setFocus();
        this.headerButton?.setClass("type", "");
        this.headerButton?.setClass("state", "bg-base-200");
        this._applyNavVisual();
    }

    _removeFocus() {
        super._removeFocus();
        this.headerButton?.setClass("type", "btn-ghost");
        this.headerButton?.setClass("state", "opacity-70 hover:opacity-100");
        this._applyNavVisual();
    }

    /**
     * Apply the per-state background inline. Classes alone are not reliable
     * here: the shipped tailwind build carries duplicated component sections,
     * so a later duplicate `.btn` background rule overrides `.btn-ghost` /
     * `bg-*` at equal specificity. Inline style always wins. Hover feedback
     * stays class-driven via the opacity dim (opacity is not set inline).
     * @param {HTMLElement} [el] the button element when the caller already
     *   holds it (pre-mount, the id lookup below would return null)
     */
    _applyNavVisual(el = undefined) {
        el = el || (this.headerButton?.id ? document.getElementById(this.headerButton.id) : null);
        if (!el) return;
        el.style.backgroundColor = this._focused
            ? "var(--fallback-b2, oklch(var(--b2)/1))"
            : "transparent";
        el.style.borderColor = "transparent";
        el.style.boxShadow = "none";
    }

    focus() {
        for (let tab of Object.values(this.parent.tabs)) {
            if (tab.headerButton && tab.headerButton.id !== this.headerButton?.id) {
                tab._removeFocus?.();
                APPLICATION_CONTEXT?.AppCache?.set?.(`${tab.id}-open`, false);
            }
        }

        APPLICATION_CONTEXT?.AppCache?.set?.(`${this.id}-open`, true);
        this._setFocus();
        this.parent._focused = this.id;
    }
}

export { FullscreenMenuNavTab };
