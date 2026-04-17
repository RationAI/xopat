import { MenuTab } from "./menuTab.mjs";

/**
 * Single-active tab behavior for modal/fullscreen menus.
 * Unlike the base MenuTab, clicking the active item does not toggle it closed.
 */
class FullscreenMenuNavTab extends MenuTab {
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
