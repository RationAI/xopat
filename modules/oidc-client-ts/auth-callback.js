/**
 * Dedicated OIDC callback document — the popup / silent-frame half of the flow.
 *
 * Loaded ONLY by `auth-callback.html`, which a deployment opts into by setting
 * `contexts.<ctx>.useCallbackPage: true` (see README). The viewer's own page stays
 * the `redirect_uri` for the full-page flow; this file exists so the popup and the
 * hidden renew frame do not have to boot the entire application just to forward one
 * URL back to the window that started the login.
 *
 * Everything here is the library's own API. The two callbacks perform NO token
 * exchange and touch NO storage — each only `postMessage`s the current URL to the
 * opener / parent, which owns the sign-in state and completes the exchange.
 *
 * Which one to call is answered by the browser, not by us:
 *   - an `opener`  => we are the sign-in popup;
 *   - a `parent`   => we are the hidden `prompt=none` renew frame.
 * That is the same rule `oidc-server-ts` and `saml-auth` use in their server-rendered
 * callbacks. It has to be a window fact: the sign-in state is written AFTER
 * `window.open()` returns, so no store this document can read is guaranteed to
 * contain it.
 */
(function () {
    // `stateStore` is REQUIRED even though we never use one. Omitted, the settings
    // store eagerly evaluates `window.localStorage` — which THROWS `SecurityError`
    // on an opaque origin (sandboxed frame), turning a working login into a blank
    // window. We hold no state, so an in-memory store is both correct and free.
    var manager = new oidc.UserManager({ stateStore: new oidc.InMemoryWebStorage() });

    var hasOpener = false, isFrame = false;
    try {
        hasOpener = !!window.opener && window.opener !== window;
        isFrame = window.self !== window.top;
    } catch (e) {
        // Opaque origin: we cannot see our own relationships, so there is nobody we
        // can prove is waiting. Fall through to the "nothing to do" branch below.
    }

    // An opener wins over being framed — a popup may itself be embedded, and only
    // the opener holds the `signinPopup` promise that is waiting on us.
    var done = hasOpener
        ? manager.signinPopupCallback(window.location.href)
        : isFrame
            ? manager.signinSilentCallback(window.location.href)
            : Promise.reject(new Error(
                "oidc-client-ts: auth-callback.html was opened as a top-level window. " +
                "It only forwards a result to the window that started the sign-in, so " +
                "there is nothing to do here. If you reached this page from an identity " +
                "provider, the login was started in a window that has since closed."));

    // The opener tears this window down as soon as the message lands, so the success
    // path usually never runs. The failure path must still say something: a silent
    // blank page is indistinguishable from a hung one.
    Promise.resolve(done).catch(function (e) {
        console.error("oidc-client-ts: auth callback could not be delivered.", e);
        var el = document.getElementById("xo-auth-callback-status");
        if (el) el.textContent = "Sign-in could not be completed in this window. You may close it.";
    });
})();
