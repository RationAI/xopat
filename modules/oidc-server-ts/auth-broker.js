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
    // Marks the URL we come back to after an AUTOMATIC (boot) redirect login, so the
    // next boot can tell "nobody tried yet" from "the attempt already ran and failed".
    // A query marker rather than sessionStorage on purpose: a sandboxed/opaque-origin
    // frame throws on the storage property itself (AGENTS.md §8).
    const BOOT_MARKER = "xo-auth-boot";

    function loginUrl(contextId, display, returnTo) {
        let u = `${window.location.origin}${ROUTE}/login/${encodeURIComponent(contextId)}?display=${display}`;
        if (display === "redirect") u += `&return=${encodeURIComponent(returnTo || window.location.href)}`;
        return u;
    }
    function startLoginRedirect(contextId, returnTo) {
        window.location.assign(loginUrl(contextId, "redirect", returnTo));
    }
    /** The current URL with the boot marker for `contextId` appended. */
    function markedReturnUrl(contextId) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set(BOOT_MARKER, contextId);
            return url.href;
        } catch (e) { return window.location.href; }
    }
    /** True when THIS load is the return of an automatic login for `contextId`. */
    function consumeBootMarker(contextId) {
        let url;
        try { url = new URL(window.location.href); } catch (e) { return false; }
        if (url.searchParams.get(BOOT_MARKER) !== contextId) return false;
        // Strip it so a later manual reload is a fresh attempt, not a permanent veto.
        url.searchParams.delete(BOOT_MARKER);
        try { window.history.replaceState(null, "", url.href); } catch (e) { /* best effort */ }
        return true;
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
                await syncFromServer(contextId, cfg);
                resolve();
            };
            const onMessage = (e) => {
                if (e.origin !== window.location.origin) return;   // same-origin only
                const d = e && e.data;
                if (d && d.type === "xopat-oidc-server:done" && d.contextId === contextId) finish();
            };
            const poll = setInterval(() => { if (popup.closed) finish(); }, 500); // completed or user-closed
            window.addEventListener("message", onMessage);
        });
    }
    // Default to popup (preserves workspace); a context can force flow "redirect".
    async function interactiveLogin(contextId, cfg) {
        if ((cfg && cfg.flow) === "redirect") {
            startLoginRedirect(contextId);
            await new Promise(() => {}); // navigating away
        } else {
            await startLoginPopup(contextId, cfg || {});
        }
    }
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
    function bindRefreshHandler(contextId, cfg) {
        if (handlerBound.has(contextId)) return;
        handlerBound.add(contextId);
        const user = XOpatUser.instance();
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e) => {
            if (e && e.type && e.type !== "jwt") return;
            // Server refreshes (using its stored refresh_token) and returns a token.
            let { ok, transportFailed } = await syncFromServer(contextId, cfg);
            if (!ok && transportFailed) {
                // One retry: the refresh path runs off a 401, and reporting a dead
                // session because the RPC itself did not get through would block the
                // user over a transient blip.
                ({ ok, transportFailed } = await syncFromServer(contextId, cfg));
            }
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
            const auth = window.APPLICATION_CONTEXT?.auth;
            if (auth?.markNeedsInteraction) {
                auth.markNeedsInteraction(contextId, { reason: "session-expired" });
            } else if (cfg.autoLogin) {
                await interactiveLogin(contextId, cfg);
            }
        });
    }

    // At most ONE context may start a boot redirect: a redirect unloads the page, so a
    // second navigation in the same tick cancels the first and strands its state entry
    // (src/AUTH.md → "At most one context may log in at boot").
    let bootRedirectContext = null;

    const broker = {
        async init(contextId, cfg) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            // Read (and strip) the marker BEFORE the sync: on the success path it must
            // leave the address bar too, or it sticks around for the whole session and
            // vetoes the next boot's automatic attempt.
            const bootAlreadyTried = consumeBootMarker(contextId);
            // Pick up an existing server-side session token (e.g. right after a
            // login redirect returned) and mirror it into XOpatUser. Retry once on a
            // transport failure — this runs at boot, when the server may still be
            // coming up, and a missed RPC must not be read as "no session".
            let { ok, transportFailed } = await syncFromServer(contextId, cfg);
            if (!ok && transportFailed) {
                ({ ok, transportFailed } = await syncFromServer(contextId, cfg));
            }
            if (ok) return;
            if (!cfg || cfg.autoLogin !== true) return;   // on-demand context: a feature triggers login

            const auth = window.APPLICATION_CONTEXT && window.APPLICATION_CONTEXT.auth;
            if (bootAlreadyTried) {
                if (transportFailed) {
                    // We came back from the IdP and could not ASK whether we have a
                    // session. Claiming "automatic login failed" here put a blocking
                    // sign-in scrim on the page load that returned from a successful
                    // authentication. Say what actually happened and let the normal
                    // 401-driven paths report if the session really is missing.
                    console.warn(`oidc-server: returned from the identity provider but the token RPC for ` +
                        `context '${contextId}' did not reach the server; not reporting a failed login.`);
                    return;
                }
                // We already redirected once for this context and came back with no
                // token: the automatic path cannot fix itself, and looping would trap
                // the user at the IdP. Hand over to the core recovery gate, whose
                // click IS the gesture an interactive login needs.
                console.warn(`oidc-server: automatic login for context '${contextId}' returned no token.`);
                if (auth && auth.markNeedsInteraction) {
                    auth.markNeedsInteraction(contextId, { reason: "auto-login-failed" });
                }
                return;
            }
            if (bootRedirectContext && bootRedirectContext !== contextId) {
                console.error(`oidc-server: context '${contextId}' also requests a boot login, but ` +
                    `'${bootRedirectContext}' already started one — demoting '${contextId}' to on-demand. ` +
                    `Only one context per deployment may log in at boot (see src/AUTH.md).`);
                return;
            }
            bootRedirectContext = contextId;
            // Redirect, NOT the configured `flow`: a boot login has no user gesture, so
            // every browser blocks the popup and the viewer would silently stay signed
            // out. `cfg.flow` still governs the click-driven `broker.login` below.
            startLoginRedirect(contextId, markedReturnUrl(contextId));
            await new Promise(() => {});   // navigating away; never resolve init
        },
        async login(contextId, cfg) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            if ((await syncFromServer(contextId, cfg)).ok) return true;
            await interactiveLogin(contextId, cfg);   // popup by default; keeps the workspace
            // The popup path resolves when the popup closes — whether it signed in or
            // the user dismissed it. Report the verdict so core stops waiting for
            // login events instead of holding its caller (and the recovery scrim) for
            // the full interactive-login timeout. The redirect path never gets here.
            return (await syncFromServer(contextId, cfg)).ok;
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
                    flow: c.flow === "redirect" ? "redirect" : "popup",
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
