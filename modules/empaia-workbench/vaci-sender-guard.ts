/**
 * Sender check for the Workbench handshake, in front of the VACI library.
 *
 * `@empaia/vendor-app-communication-interface` accepts any `message` event whose
 * `data.type` is `scope` / `token` / `wbsUrl`: it checks neither `e.source` nor
 * `e.origin`, adopts the sender's origin as its reply target, and hands its
 * callbacks only the payload — so nothing downstream of it can tell who spoke.
 * Any frame holding a handle to this window (a sibling on the Workbench page,
 * through `window.top.frames[i]`) could therefore swap the session's scope or
 * token, or have later `tokenRequest` posts addressed to its own origin.
 *
 * The library is not patched (see UPSTREAM.md). Instead a capture-phase listener
 * sits on the same `window` and stops a handshake message that did not come from
 * `window.top` — the frame the library itself posts to, and so the only one it
 * can legitimately hear from — before the library's listener is reached.
 *
 * The check is on `source`, not `origin`: the app UI runs in a sandboxed frame,
 * comparing window references works across origins and on an opaque one, and it
 * needs no configuration that could be wrong. The `wbsOrigins` allowlist in
 * `index.ts` stays as the second wall for the one value that leaves the page.
 *
 * Import this module BEFORE the library: capture listeners run first at the
 * target in current engines, and registration order covers the ones where they
 * do not.
 */

/** `data.type` values the library dispatches on. */
const HANDSHAKE_TYPES = new Set(["scope", "token", "wbsUrl"]);

/** Whether `data` is something the VACI library would accept. */
export function isHandshakeMessage(data: unknown): boolean {
    return typeof data === "object" && data !== null
        && HANDSHAKE_TYPES.has((data as { type?: unknown }).type as string);
}

/**
 * Whether a message must be kept from the library: a handshake message whose
 * sender is not the Workbench client.
 */
export function isForgedHandshake(
    event: { data: unknown; source: unknown },
    workbench: unknown,
): boolean {
    return isHandshakeMessage(event.data) && event.source !== workbench;
}

const installed = new WeakSet<object>();

/** Install the guard once per window. Safe to call when the page is not framed at all. */
export function installHandshakeSenderGuard(target: Window = window): void {
    if (installed.has(target)) return;
    installed.add(target);
    let reported = false;
    target.addEventListener("message", (event: MessageEvent) => {
        if (!isForgedHandshake(event, target.top)) return;
        // Dropped, not fatal: a forged message must not abort the handshake the
        // genuine workbench is still completing.
        event.stopImmediatePropagation();
        if (reported) return;
        reported = true;
        // Once, and without the payload — it may be a token.
        console.warn("[empaia-workbench] ignored a workbench handshake message that did not come from the embedding frame.");
    }, true);
}

installHandshakeSenderGuard();
