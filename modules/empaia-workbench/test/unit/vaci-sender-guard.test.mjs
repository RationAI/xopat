/**
 * Who may speak the Workbench handshake.
 *
 * The VACI library dispatches on `data.type` alone, so a sibling frame on the Workbench page
 * could push a `scope` / `token` / `wbsUrl` of its own. The guard drops those before the
 * library's listener runs. What is pinned here is the rule itself and the two ways it could
 * go wrong: letting a forged message through, and swallowing traffic that is not the
 * handshake's — every other `postMessage` consumer on the page shares this window.
 */
import { test, expect } from "@xopat/test-harness";

/** A stand-in `window`: records listeners so a message can be dispatched in order. */
function fakeWindow() {
    const listeners = [];
    const win = {
        top: { name: "workbench" },
        addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: !!capture }),
        dispatch(event) {
            let stopped = false;
            event.stopImmediatePropagation = () => { stopped = true; };
            // Capture listeners first at the target, then registration order.
            const ordered = [...listeners.filter(l => l.capture), ...listeners.filter(l => !l.capture)];
            for (const l of ordered) {
                if (stopped) break;
                l.fn(event);
            }
        },
    };
    return win;
}

// The module installs itself on the real `window` at import; give it a harmless one.
const hadWindow = "window" in globalThis;
const inheritedWindow = globalThis.window;
globalThis.window = fakeWindow();
const { isForgedHandshake, isHandshakeMessage, installHandshakeSenderGuard } =
    await import("../../vaci-sender-guard.ts");
if (hadWindow) globalThis.window = inheritedWindow; else delete globalThis.window;

test("only the three handshake types are the guard's business", () => {
    expect(isHandshakeMessage({ type: "scope", id: "s" })).toBe(true);
    expect(isHandshakeMessage({ type: "token", value: "t" })).toBe(true);
    expect(isHandshakeMessage({ type: "wbsUrl", url: "https://wbs" })).toBe(true);
    expect(isHandshakeMessage({ type: "something-else" })).toBe(false);
    expect(isHandshakeMessage("token")).toBe(false);
    expect(isHandshakeMessage(null)).toBe(false);
    expect(isHandshakeMessage(undefined)).toBe(false);
});

test("a handshake message is forged unless the workbench frame sent it", () => {
    const workbench = { name: "top" };
    const sibling = { name: "sibling" };
    expect(isForgedHandshake({ data: { type: "token", value: "t" }, source: workbench }, workbench)).toBe(false);
    expect(isForgedHandshake({ data: { type: "token", value: "t" }, source: sibling }, workbench)).toBe(true);
    expect(isForgedHandshake({ data: { type: "wbsUrl", url: "https://evil" }, source: null }, workbench)).toBe(true);
    // Not the handshake: never touched, whoever sent it.
    expect(isForgedHandshake({ data: { type: "resize" }, source: sibling }, workbench)).toBe(false);
});

test("the installed guard stops a forged message before the library's listener, and nothing else", () => {
    const win = fakeWindow();
    const seen = [];
    // The library's listener: registered first, bubble phase — as VACI does.
    win.addEventListener("message", (e) => seen.push(e.data.type), false);

    const priorWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
        installHandshakeSenderGuard(win);
        installHandshakeSenderGuard(win);   // idempotent per window

        win.dispatch({ data: { type: "token", value: "forged-secret" }, source: { name: "sibling" } });
        win.dispatch({ data: { type: "scope", id: "forged" }, source: { name: "sibling" } });
        expect(seen, "a sibling frame's handshake never reaches the library").toEqual([]);

        win.dispatch({ data: { type: "token", value: "real" }, source: win.top });
        win.dispatch({ data: { type: "resize" }, source: { name: "sibling" } });
        expect(seen).toEqual(["token", "resize"]);
    } finally {
        console.warn = priorWarn;
    }
    expect(warnings.length, "reported once, not per message").toBe(1);
    expect(warnings[0], "the payload may be a token; it is never logged").not.toContain("forged-secret");
});
