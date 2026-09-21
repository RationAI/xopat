/**
 * A popup portaled to <body> must not paint under the modal its control lives in.
 *
 * `FloatingManager` hands out z-index from a band (100–899). A DaisyUI `.modal`
 * is `z-index: 999`, so an Autocomplete inside a dialog opened its list, correctly
 * positioned, *behind* the dialog and its scrim — the class picker in "Derive
 * tissue mask into class…" looked like it did nothing. The fix is per popup, not
 * per band: an `anchor` raises that one element's floor to its anchor's stacking
 * context + 1, and the floor survives `bringToFront` and renormalisation.
 */
import { test, expect, installBrowserGlobals } from "@xopat/test-harness";

const noop = () => {};
installBrowserGlobals({
    extra: {
        document: { addEventListener: noop, removeEventListener: noop },
        VIEWER_MANAGER: { broadcastHandler: noop, addHandler: noop },
        addEventListener: noop,
        removeEventListener: noop,
        getComputedStyle: (el) => el.__cs || { position: "static", zIndex: "auto" },
        APPLICATION_CONTEXT: { AppCache: { get: () => undefined, set: noop } },
    },
});

const { FloatingManager, stackingFloor } = await import("../../../ui/services/floatingManager.mjs");

/** A positioned element with a computed z-index, optionally under a parent. */
function el(cs, parentElement = null) {
    return { nodeType: 1, style: {}, parentElement, __cs: cs };
}
const modal = () => el({ position: "fixed", zIndex: "999" });
const control = (parent) => el({ position: "relative", zIndex: "auto" }, parent);
const panel = () => ({ style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) });

test("stackingFloor is the anchor chain's highest positioned z-index plus one @unit", () => {
    expect(stackingFloor(control(modal()))).toBe(1000);
    // A non-positioned z-index does not create a stacking context.
    expect(stackingFloor(el({ position: "static", zIndex: "999" }))).toBe(0);
    expect(stackingFloor(control(null))).toBe(0);
    expect(stackingFloor(null)).toBe(0);
});

test("an anchored popup is lifted above its modal; an unanchored one stays in the band @unit", () => {
    const fm = new FloatingManager();
    const plain = panel();
    fm.register({ el: plain });
    expect(Number(plain.style.zIndex)).toBeGreaterThanOrEqual(100);
    expect(Number(plain.style.zIndex)).toBeLessThan(900);

    const lifted = panel();
    fm.register({ el: lifted, anchor: control(modal()) });
    expect(Number(lifted.style.zIndex)).toBe(1000);
});

test("the floor survives bringToFront and renormalisation @unit", () => {
    const fm = new FloatingManager();
    const lifted = panel();
    const token = fm.register({ el: lifted, anchor: control(modal()) });

    fm.bringToFront(token);
    expect(Number(lifted.style.zIndex)).toBe(1000);

    // Exhaust the band so the next raise compacts everything back to 100+.
    fm._zTop = 900;
    const other = panel();
    fm.register({ el: other });
    expect(Number(other.style.zIndex)).toBeLessThan(900);
    expect(Number(lifted.style.zIndex)).toBe(1000);
});
