/**
 * Helpers for single-row strips that scroll on the X axis only (tab strips, the
 * toolbar docked in the app bar). Such strips usually hide or minimise their
 * scrollbar, so they need another way to be scrolled and to show that something
 * is clipped.
 */

/**
 * A mouse wheel emits deltaY, which an X-only strip ignores — without this the
 * strip is unreachable by wheel. Maps the dominant wheel axis onto scrollLeft
 * and only swallows the event while the strip can actually move, so a wheel
 * over a fully-visible strip still scrolls whatever is underneath.
 *
 * @param {HTMLElement} el the scroll container
 * @param {{when?: () => boolean}} [options] `when` disables the mapping while it returns false
 * @returns {() => void} unbind
 */
export function bindHorizontalWheel(el, options = {}) {
    if (!el) return () => {};
    const onWheel = (e) => {
        if (e.ctrlKey) return;   // browser zoom
        if (options.when && !options.when()) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) return;
        const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
        if (next === el.scrollLeft) return;
        el.scrollLeft = next;
        e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
}

/**
 * Keep `data-clipped-start` / `data-clipped-end` on the strip in step with
 * whether content is scrolled out of view on that side, so CSS can fade the
 * clipped edge. Scrolling updates it automatically; call the returned function
 * after anything else that changes the strip's size or content.
 *
 * @param {HTMLElement} el the scroll container
 * @returns {() => void} refresh
 */
export function trackScrollEdges(el) {
    if (!el) return () => {};
    const refresh = () => {
        const max = el.scrollWidth - el.clientWidth;
        el.toggleAttribute("data-clipped-start", el.scrollLeft > 1);
        el.toggleAttribute("data-clipped-end", max - el.scrollLeft > 1);
    };
    el.addEventListener("scroll", refresh, { passive: true });
    refresh();
    return refresh;
}
