// Client glue for the server-side OIDC provider. Registers an "oidc-server"
// broker into the core auth broker (APPLICATION_CONTEXT.auth). It never sees the
// client_secret or refresh_token — it just pulls the current access/id token from
// the server (which refreshes it) and writes it into XOpatUser, so HttpClient
// works transparently. Interactive login is a full-page redirect to the server
// login route. Same config surface as oidc-client-ts. See src/AUTH.md.
(function () {
    const ROUTE = "/auth/oidc-server";
    const configured = new Map();       // contextId -> cfg
    const handlerBound = new Set();

    function serverScope() {
        const s = window.xserver && window.xserver.module && window.xserver.module["oidc-server-ts"];
        if (!s) throw new Error("Server RPC unavailable for oidc-server-ts.");
        return s;
    }
    function decodeJwtPayload(token) {
        try {
            const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            return JSON.parse(decodeURIComponent(escape(atob(p))));
        } catch (e) { return {}; }
    }
    function applyTokens(contextId, cfg, tok) {
        if (!tok) return false;
        const user = XOpatUser.instance();
        const which = cfg.tokenForServer || "access_token";
        const token = tok[which] || tok.access_token || tok.id_token;
        if (!token) return false;
        const p = decodeJwtPayload(tok.id_token || token);
        const subject = p.sub || "user";
        // Re-assert on a SUBJECT change, not only when logged out: after an account
        // switch at the IdP the old guard kept the previous identity on display
        // while attaching the new user's token. XOpatUser.login() is idempotent for
        // an unchanged subject and swaps identities for a changed one.
        if (!user.getIsLogged(contextId) || user.getUserId(contextId) !== subject) {
            const name = [p.given_name, p.family_name].filter(Boolean).join(" ") || p.name || p.email || "User";
            user.login(subject, name, "", contextId);
        }
        user.setSecret(token, "jwt", contextId);
        return true;
    }
    // The boot-attempt marker used to live here. It is core's now
    // (XOpatAuth._claimBootAttempt), which stamps the current URL before it
    // navigates — and since our return URL defaults to `window.location.href`, the
    // marker round-trips through the identity provider with no code on this side.
    function loginUrl(contextId, display, returnTo) {
        let u = `${window.location.origin}${ROUTE}/login/${encodeURIComponent(contextId)}?display=${display}`;
        if (display === "redirect") u += `&return=${encodeURIComponent(returnTo || window.location.href)}`;
        return u;
    }
    function startLoginRedirect(contextId, returnTo) {
        window.location.assign(loginUrl(contextId, "redirect", returnTo));
    }
    // Popup login keeps the viewer tab (and its unsaved workspace) intact. The
    // server-side callback closes the popup and postMessages the opener; we then
    // pull the freshly-minted token into XOpatUser.
    function startLoginPopup(contextId, cfg) {
        const w = 520, h = 640;
        const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
        const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2);
        const popup = window.open(loginUrl(contextId, "popup"), `xopat-oidc-${contextId}`,
            `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
        if (!popup) {
            startLoginRedirect(contextId);           // popup blocked → full-page redirect fallback
            return new Promise(() => {});            // navigating away
        }
        return new Promise((resolve) => {
            let done = false;
            const finish = async () => {
                if (done) return;
                done = true;
                window.removeEventListener("message", onMessage);
                clearInterval(poll);
                try { popup.close(); } catch (e) { /* ignore */ }
                // Pull the token on EITHER the message OR the popup closing — some
                // browsers sever window.opener across the IdP navigation, so the
                // message may not arrive; the server has the token if login worked.
                //
                // `force`: a login just happened, so the negative answer memoized
                // moments ago — by this very login's head sync — is exactly the one
                // that must NOT be reused; it would report a success as a failure.
                await adoptServerSession(contextId, cfg, { force: true });
                resolve();
            };
            const onMessage = (e) => {
                if (e.origin !== window.location.origin) return;   // same-origin only
                const d = e && e.data;
                if (d && d.type === "xopat-oidc-server:done" && d.contextId === contextId) finish();
            };
            // Completed, or the user closed it. `popup.closed` is UNREADABLE while the
            // popup sits on an identity provider that sets Cross-Origin-Opener-Policy
            // (Google does): the browser refuses the read and logs a warning. It
            // becomes readable again once the popup returns to our own origin, so this
            // still catches the ordinary close — it just cannot see a user who gives
            // up while still at the identity provider. The postMessage above is the
            // primary signal; this is the fallback for browsers that sever
            // `window.opener` across the navigation.
            const poll = setInterval(() => {
                let closed = false;
                try { closed = popup.closed; } catch (e) { return; }   // COOP-blocked
                if (closed) finish();
            }, 500);
            window.addEventListener("message", onMessage);
        });
    }
    // (`interactiveLogin` used to pick redirect-vs-popup from `cfg.flow` here. That
    // choice is core's now — it depends on whether the document may be unloaded at
    // all, which this side cannot see — and arrives as `options.mayNavigate`.)
    /**
     * Mirror the server-side session token into XOpatUser.
     *
     * Returns `{ ok, transportFailed }`. The distinction matters: a `getToken` RPC
     * that never reached the server (xserver still starting, a network blip) is NOT
     * evidence that the user has no session, and treating the two the same reported
     * "automatic login failed" — blocking the viewer with a sign-in scrim — on the
     * very page load that returned from a SUCCESSFUL authentication.
     */
    async function syncFromServer(contextId, cfg) {
        let tok = null;
        try {
            tok = await serverScope().getToken({ contextId });
        } catch (e) {
            return { ok: false, transportFailed: true };
        }
        return { ok: applyTokens(contextId, cfg, tok), transportFailed: false };
    }
    /** How long a negative `adoptServerSession` answer is reused — long enough to
     *  cover the boot burst (init + both silent rungs), short enough never to mask a
     *  session that appeared meanwhile. */
    const ADOPT_MEMO_MS = 2000;
    /**
     * Hard bound on a token RPC whose promise is SHARED (the boot/silent path). Short,
     * because every later caller coalesces onto it: one wedged request there would
     * freeze the sign-in click with no way back.
     */
    const ADOPT_TIMEOUT_MS = 8000;
    /**
     * Bound on an unshared (`force`) RPC — the sync after a popup closes, the 401
     * refresh. Nobody is waiting behind these, so the only job is to not hang
     * forever; they must NOT inherit the short bound, which turned a user who took
     * their time at the identity provider into "the server is unreachable".
     */
    const ADOPT_FORCED_TIMEOUT_MS = 120000;
    const adoptInFlight = new Map();
    const adoptMemo = new Map();

    function bindRefreshHandler(contextId, cfg) {
        if (handlerBound.has(contextId)) return;
        handlerBound.add(contextId);
        const user = XOpatUser.instance();
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e) => {
            if (e && e.type && e.type !== "jwt") return;
            // Server refreshes (using its stored refresh_token) and returns a token.
            // `force`: a 401 is fresh evidence that the answer changed, so the boot
            // memo must not be reused here. The retry-on-transport-failure lives in
            // adoptServerSession — the refresh path runs off a 401, and reporting a
            // dead session because the RPC itself did not get through would block the
            // user over a transient blip.
            const { ok, transportFailed } = await adoptServerSession(contextId, cfg, { force: true });
            if (ok) return;
            if (transportFailed) {
                console.warn(`oidc-server: could not reach the server to refresh context '${contextId}'; ` +
                    `leaving the session untouched.`);
                return;
            }
            // The server could not refresh — its refresh_token is gone or the IdP
            // revoked it — so only an interactive login helps. This handler runs
            // off an HTTP 401 with no user gesture, so a popup here would be
            // blocked; let the core recovery gate prompt on the next click.
            // (The `else if (cfg.autoLogin) interactiveLogin(...)` fallback that used
            // to sit here re-implemented the pre-refactor 401-driven redirect, with
            // no boot marker and no cross-broker arbitration. It was reachable only
            // if core had no `markNeedsInteraction` at all, which the ambient mirror
            // now makes structurally impossible.)
            window.APPLICATION_CONTEXT?.auth?.markNeedsInteraction?.(
                contextId, { reason: "session-expired" });
        });
    }

    /**
     * Adopt an existing server-side session, retrying once on a transport failure —
     * this runs at boot, when xserver may still be coming up, and a missed RPC must
     * not be read as "no session" — and coalescing concurrent callers onto one
     * attempt.
     *
     * Core runs the silent rung more than once per boot and `init` adopts too, but it
     * cannot dedupe those against each other: `init` returns `void`, so core never
     * learns what it concluded. That makes the coalescing ours. `force` skips the
     * memo for a caller that knows the answer just changed — a popup that has only
     * now closed.
     */
    async function adoptServerSession(contextId, cfg, opts) {
        const force = !!(opts && opts.force);
        // `force` bypasses the IN-FLIGHT attempt as well as the memo. A caller that
        // knows the answer just changed (a popup that only now closed, a 401) must
        // not be joined onto an older attempt that predates the change — and must
        // never be joined onto one that is wedged.
        if (force) {
            adoptMemo.delete(contextId);
        } else {
            const running = adoptInFlight.get(contextId);
            if (running) return running;
            const memo = adoptMemo.get(contextId);
            if (memo && Date.now() - memo.at < ADOPT_MEMO_MS) return memo.result;
        }

        const attempt = (async () => {
            let { ok, transportFailed } = await syncFromServer(contextId, cfg);
            if (!ok && transportFailed) {
                ({ ok, transportFailed } = await syncFromServer(contextId, cfg));
            }
            return { ok, transportFailed };
        })();
        // ALWAYS settles. An unbounded promise here is not just slow: every later
        // caller coalesces onto it, so one wedged RPC silently freezes the recovery
        // scrim's sign-in click with no way back. Timing out reports exactly what
        // happened — we did not reach the server.
        const boundMs = force ? ADOPT_FORCED_TIMEOUT_MS : ADOPT_TIMEOUT_MS;
        const bounded = Promise.race([
            attempt,
            new Promise((resolve) => setTimeout(
                () => resolve({ ok: false, transportFailed: true, timedOut: true }), boundMs)),
        ]);
        if (!force) {
            adoptInFlight.set(contextId, bounded);
            bounded.finally(() => {
                if (adoptInFlight.get(contextId) === bounded) adoptInFlight.delete(contextId);
            });
        }

        const result = await bounded;
        if (result.timedOut) {
            console.warn(`oidc-server: the token RPC for context '${contextId}' did not answer within ` +
                `${boundMs}ms; treating it as unreachable.`);
        }
        // Only a NEGATIVE answer is memoized: a success has written the secret, and
        // later callers short-circuit on `isAuthenticated` well before reaching here.
        if (!result.ok) adoptMemo.set(contextId, { at: Date.now(), result });
        return result;
    }

    const broker = {
        async init(contextId, cfg) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            // Pick up an existing server-side session token (e.g. right after a
            // login redirect returned) and mirror it into XOpatUser. NOTHING else:
            // the boot marker, the "only one context may navigate" rule and the
            // hand-off to the recovery gate are core's now (XOpatAuth.runAutoLogin),
            // which unlike this function can see every broker's contexts.
            await adoptServerSession(contextId, cfg);
        },
        // The server holds the refresh token and re-mints from its own session, so
        // adopting it is a genuine silent route: no IdP round trip, no window, no
        // navigation.
        async loginSilent(contextId, cfg) {
            const { ok, transportFailed } = await adoptServerSession(contextId, cfg);
            if (ok) return true;
            // `"unknown"`, not `false`. Being unable to ASK whether we have a session
            // is not evidence that we do not — and core must not answer a network
            // blip with a full-page redirect to an identity provider we just failed
            // to reach. This distinction previously lived inside `init` as the
            // `bootAlreadyTried && transportFailed` special case.
            if (transportFailed) {
                console.warn(`oidc-server: the token RPC for context '${contextId}' did not reach the ` +
                    `server; reporting "unknown" rather than a failed login.`);
                return "unknown";
            }
            return false;
        },
        // The gesture-free flow is a full-page redirect: permitted without a click,
        // and it unloads the document, so it claims core's one boot navigation.
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        async login(contextId, cfg, options) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            // Core decides whether we may unload the document; `cfg.flow` is only the
            // deployment's PREFERENCE for a click-driven login. A `flow` of "popup"
            // must not turn an automatic boot login into a popup — every browser
            // blocks one with no gesture behind it.
            const mayNavigate = options ? options.mayNavigate !== false : true;
            const navigating = mayNavigate
                && (options?.gesture === false || (cfg && cfg.flow) !== "popup");
            // The head sync answers "does the server already have a session?", which
            // saves a pointless IdP round trip. But it is an AWAITED RPC, so it may
            // only run when we are about to NAVIGATE — `location.assign` needs no
            // user activation, `window.open` does, and transient activation expires
            // about five seconds after the click. Awaiting here before opening a
            // popup either burned the gesture (blocked popup) or, when the RPC hung,
            // left the recovery scrim spinning on "Working…" forever.
            //
            // Skipped for a click-less call too: core has just run the silent rung,
            // which IS this sync.
            if (navigating && (options && options.gesture !== false)) {
                if ((await adoptServerSession(contextId, cfg)).ok) return true;
            }
            if (navigating) {
                // A redirect is the DEFAULT whenever core allows one: at boot there
                // is nothing to lose, and it is the only flow that works with no user
                // gesture behind it. `flow: "popup"` opts out, for a deployment that
                // would rather keep the tab even at boot.
                startLoginRedirect(contextId);
                await new Promise(() => {});   // navigating away; never resolves
            }
            // Cannot (or must not) navigate: framed, or the user has work a redirect
            // would discard. A popup keeps the page — and it can only open because a
            // click brought us here.
            await startLoginPopup(contextId, cfg || {});
            // The popup path resolves when the popup closes — whether it signed in or
            // the user dismissed it. Report the verdict so core stops waiting for
            // login events instead of holding its caller (and the recovery scrim) for
            // the full interactive-login timeout. The redirect path never gets here.
            // `force`: the popup may have signed in since the memo was written.
            return (await adoptServerSession(contextId, cfg, { force: true })).ok;
        },
        async logout(contextId) {
            try { XOpatUser.instance().logout(contextId); } catch (e) { /* ignore */ }
            try { await serverScope().logout({ contextId }); } catch (e) { /* ignore */ }
        },
        // isAuthenticated / getToken intentionally omitted: XOpatAuth's defaults
        // (getIsLogged + getSecret("jwt", ctx)) already do exactly this.
    };

    // Fetch the server-declared contexts (public flags only; config + secret live
    // server-side) and register each with the core broker so features that use
    // those HttpClient contexts get their token provisioned transparently.
    // `_configured` flips true ONLY after contexts are actually applied. `_inflight`
    // is the separate re-entrancy guard while the async run is pending — conflating
    // the two would let `tryRegister` report success (and clear the poll interval)
    // synchronously, before `listContexts()` settles, stranding the broker registered
    // but never configured if that first RPC fails.
    let _configured = false;
    let _inflight = false;
    // Resolves once discovery is over — successfully or by giving up. Core's boot
    // barrier awaits it, so it must ALWAYS settle (never reject, never hang).
    let _discoveryAnnounced = false;
    const discoveryDone = (() => {
        let done = () => {};
        const promise = new Promise((resolve) => { done = resolve; });
        return { promise, done: () => done() };
    })();
    async function configureFromServer(auth) {
        if (_configured || _inflight) return;
        _inflight = true;
        let list = [];
        try { list = (await serverScope().listContexts())?.contexts || []; }
        catch (e) { _inflight = false; return; } // xserver not ready yet — retry on next poll
        for (const c of list) {
            try {
                await auth.configureContext({
                    contextId: c.contextId,
                    method: "oidc-server",
                    serviceName: c.serviceName || c.contextId,
                    tokenForServer: c.tokenForServer || "access_token",
                    autoLogin: c.autoLogin === true,
                    // Redirect by default — see register.server.ts. Only an explicit
                    // "popup" keeps the tab at boot.
                    flow: c.flow === "popup" ? "popup" : "redirect",
                    // The broker declares what it stores, so consumers never
                    // hardcode HttpClient's auth.types (XOpatAuth.getSecretTypes).
                    secretTypes: ["jwt"],
                });
            } catch (e) { console.error(`oidc-server: configure context '${c.contextId}' failed`, e); }
        }
        _configured = true;
        _inflight = false;
        discoveryDone.done();
    }

    function tryRegister() {
        const auth = window.APPLICATION_CONTEXT && window.APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!auth.hasBroker("oidc-server")) auth.registerBroker("oidc-server", broker);
        // Our contexts come from a server RPC, so they are declared LATE — after the
        // boot barrier would otherwise have looked at `listAutoLoginContexts()` and
        // found nothing to wait for, opening the first slide before the token lands
        // (401 → recovery scrim on a perfectly good session). Tell core to wait.
        // Registered ONCE (tryRegister polls): what core must wait for is the whole
        // discovery, retries included, not each individual attempt.
        if (!_discoveryAnnounced && typeof auth.registerContextDiscovery === "function") {
            _discoveryAnnounced = true;
            auth.registerContextDiscovery(discoveryDone.promise);
        }
        void configureFromServer(auth);
        return _configured; // keep polling until contexts are actually configured (xserver ready)
    }
    if (!tryRegister()) {
        const iv = setInterval(() => { if (tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => {
            clearInterval(iv);
            // Gave up: unblock anyone waiting on discovery rather than making them
            // pay their own timeout (core bounds the wait too, this is just honest).
            discoveryDone.done();
        }, 15000);
    }
})();
