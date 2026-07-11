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
        if (!user.getIsLogged(contextId)) {
            const p = decodeJwtPayload(tok.id_token || token);
            const name = [p.given_name, p.family_name].filter(Boolean).join(" ") || p.name || p.email || "User";
            user.login(p.sub || "user", name, "", contextId);
        }
        user.setSecret(token, "jwt", contextId);
        return true;
    }
    function loginUrl(contextId, display) {
        let u = `${window.location.origin}${ROUTE}/login/${encodeURIComponent(contextId)}?display=${display}`;
        if (display === "redirect") u += `&return=${encodeURIComponent(window.location.href)}`;
        return u;
    }
    function startLoginRedirect(contextId) {
        window.location.assign(loginUrl(contextId, "redirect"));
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
    async function syncFromServer(contextId, cfg) {
        let tok = null;
        try { tok = await serverScope().getToken({ contextId }); } catch (e) { tok = null; }
        return applyTokens(contextId, cfg, tok);
    }
    function bindRefreshHandler(contextId, cfg) {
        if (handlerBound.has(contextId)) return;
        handlerBound.add(contextId);
        const user = XOpatUser.instance();
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e) => {
            if (e && e.type && e.type !== "jwt") return;
            // Server refreshes (using its stored refresh_token) and returns a token.
            const ok = await syncFromServer(contextId, cfg);
            // Not logged in server-side: optionally kick interactive login (popup).
            if (!ok && cfg.autoLogin) await interactiveLogin(contextId, cfg);
        });
    }

    const broker = {
        async init(contextId, cfg) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            // Pick up an existing server-side session token (e.g. right after a
            // login redirect returned) and mirror it into XOpatUser.
            await syncFromServer(contextId, cfg);
        },
        async login(contextId, cfg) {
            configured.set(contextId, cfg);
            bindRefreshHandler(contextId, cfg);
            if (!(await syncFromServer(contextId, cfg))) {
                await interactiveLogin(contextId, cfg);   // popup by default; keeps the workspace
            }
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
    let _configured = false;
    async function configureFromServer(auth) {
        if (_configured) return;
        _configured = true;
        let list = [];
        try { list = (await serverScope().listContexts())?.contexts || []; }
        catch (e) { _configured = false; return; } // xserver not ready yet — retry on next poll
        for (const c of list) {
            try {
                await auth.configureContext({
                    contextId: c.contextId,
                    method: "oidc-server",
                    serviceName: c.serviceName || c.contextId,
                    tokenForServer: c.tokenForServer || "access_token",
                    autoLogin: c.autoLogin === true,
                    flow: c.flow === "redirect" ? "redirect" : "popup",
                });
            } catch (e) { console.error(`oidc-server: configure context '${c.contextId}' failed`, e); }
        }
    }

    function tryRegister() {
        const auth = window.APPLICATION_CONTEXT && window.APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!auth.hasBroker("oidc-server")) auth.registerBroker("oidc-server", broker);
        void configureFromServer(auth);
        return _configured; // keep polling until contexts are configured (xserver ready)
    }
    if (!tryRegister()) {
        const iv = setInterval(() => { if (tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => clearInterval(iv), 15000);
    }
})();
