/**
 * Anchored-popup placement helpers.
 *
 * Popovers attached to a toolbar (panel buttons, choice-group dropdowns) are
 * normally `position:absolute` inside the toolbar DOM, which is cheap and keeps
 * them glued to their button. That breaks the moment an ancestor becomes a
 * scroll port: the mobile bottom-bar toolbar host is capped (`max-height:15vh;
 * overflow-y:auto`, see `.xopat-mobile-toolbar-scroll` in `src/assets/custom.css`)
 * so the recorder's stacked toolbar cannot eat the phone viewport — and any
 * absolutely positioned child is then clipped to the ~40px bar row.
 *
 * The fix is not to remove the cap but to let the popup escape: portal it to
 * `document.body`, switch it to `position:fixed`, and place it against the
 * anchor in viewport coordinates with edge-aware flipping. Same pattern the
 * `ContextMenu` component already uses.
 *
 * These helpers deliberately do NOT touch the DOM ownership of the popup — the
 * caller decides when to portal and when to restore, so the un-clipped (desktop)
 * code paths stay exactly as they were.
 */

/**
 * Find the nearest ancestor that would clip an absolutely positioned child.
 *
 * `<body>` and `<html>` are excluded on purpose: the app shell sets
 * `body { overflow: hidden }`, which clips nothing a popup cares about (a
 * body-portaled fixed popup is placed inside the viewport anyway) — counting it
 * would report every element on the page as clipped.
 *
 * @param {Element|null} el element whose ancestors to inspect (el itself is skipped)
 * @returns {Element|null} the first clipping ancestor, or null when none clips
 */
export function findClippingAncestor(el) {
    let node = el?.parentElement || null;
    while (node && node !== document.body && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return node;
        node = node.parentElement;
    }
    return null;
}

/**
 * Place a popup against an anchor in viewport coordinates.
 *
 * The popup must already live in a stacking context where `position:fixed` is
 * viewport-relative (i.e. no transformed ancestor — in practice: a direct child
 * of `document.body`). This function sets `position/left/top` inline.
 *
 * @param {Element} anchorEl element the popup points at
 * @param {HTMLElement} popupEl the popup
 * @param {Object} [opts]
 * @param {"bottom"|"right"} [opts.placement="bottom"] preferred side; flips on overflow
 * @param {number} [opts.margin=6] gap to the anchor and padding from the viewport edge
 */
export function placeFixedAnchored(anchorEl, popupEl, opts = {}) {
    if (!anchorEl || !popupEl) return;
    const placement = opts.placement === "right" ? "right" : "bottom";
    const margin = Number.isFinite(opts.margin) ? opts.margin : 6;

    // Fixed + measurable before we know where it goes; the caller keeps it
    // visually hidden (or already visible — placement is idempotent).
    popupEl.style.position = "fixed";

    const anchor = anchorEl.getBoundingClientRect();
    const pw = popupEl.offsetWidth;
    const ph = popupEl.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;

    let left, top;

    if (placement === "right") {
        // Beside the anchor, vertically centred; flip to the left on overflow.
        left = anchor.right + margin;
        if (left + pw > vw - margin) {
            const alt = anchor.left - pw - margin;
            if (alt >= margin) left = alt;
        }
        top = anchor.top + (anchor.height - ph) / 2;
    } else {
        // Below the anchor, left-aligned; flip above on overflow (this is what
        // makes bottom-bar toolbars open upwards without any mobile special case).
        left = anchor.left;
        top = anchor.bottom + margin;
        if (top + ph > vh - margin) {
            const alt = anchor.top - ph - margin;
            if (alt >= margin) top = alt;
        }
    }

    // Clamp into the viewport. Math.max on the upper bound keeps the popup's top
    // left corner reachable even when the popup is larger than the viewport.
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - pw - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, vh - ph - margin));

    popupEl.style.left = `${Math.round(left)}px`;
    popupEl.style.top = `${Math.round(top)}px`;
}

/**
 * Keep a placed popup anchored while it is open: re-place on any scroll (the
 * bottom-bar toolbar scrolls horizontally under the popup) and on resize.
 *
 * @param {() => void} replace callback that re-runs the placement
 * @returns {() => void} detach function; call it when the popup closes
 */
export function trackAnchor(replace) {
    const onChange = () => replace();
    // Capture phase so scrolls of inner containers (not just window) are seen.
    window.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange);
    return () => {
        window.removeEventListener("scroll", onChange, { capture: true });
        window.removeEventListener("resize", onChange);
    };
}
