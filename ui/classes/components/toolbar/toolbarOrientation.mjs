/**
 * Bind a callback to the toolbar's orientation for a given element.
 *
 * The Toolbar dispatches a `toolbar:measure` CustomEvent (detail.dir =
 * "vertical" | "horizontal") on its `[data-toolbar-root]` wrapper whenever it
 * flips between edge-docked (vertical) and floating/embedded (horizontal)
 * layouts. Leaf toolbar components (items, panel buttons, groups, separators)
 * use this to resize themselves, since a vertical column must stretch every
 * control to one uniform width while a horizontal bar keeps them intrinsic.
 *
 * @param {HTMLElement} anchorEl any element already inside the toolbar root
 * @param {(dir: "vertical"|"horizontal", root: HTMLElement) => void} apply
 *   invoked once with the current orientation and again on every change
 */
export function bindToolbarOrientation(anchorEl, apply) {
    queueMicrotask(() => {
        const root = anchorEl.closest?.("[data-toolbar-root]");
        if (!root) return;
        root.addEventListener("toolbar:measure", (e) => apply(e.detail?.dir, root));
        apply(root.classList.contains("flex-col") ? "vertical" : "horizontal", root);
    });
}
