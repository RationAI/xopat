// Registers the "oidc" auth broker into the core auth broker
// (APPLICATION_CONTEXT.auth), wrapping the browser OIDCAuthClient. Core
// (XOpatAuth) stays method-agnostic; this is the CLIENT-SIDE, PKCE-public
// provider. It updates XOpatUser with the obtained token so HttpClient just
// works. For IdPs that REQUIRE a client_secret, use the server-side
// `oidc-server-ts` module instead — a secret in a browser client is insecure
// (we warn, but still proceed PKCE-style). See src/AUTH.md.
//
// A feature declares a context with APPLICATION_CONTEXT.auth.configureContext({
//   contextId, method: "oidc", config: <oidc block>, serviceName, tokenForServer
// }) and then gates on isAuthenticated(ctx) / login(ctx).
(function () {
    // One OIDCAuthClient per context (its own authority/client_id/scope +
    // userContextId), created lazily from the declared config. updateXOpatUser
    // is false: these are SUB-contexts, not the main viewer identity.
    const clients = new Map();
    const _warned = new Set();

    function warnIfSecret(contextId, cfg) {
        const oidc = cfg.config || {};
        if (!oidc.client_secret || _warned.has(contextId)) return;
        _warned.add(contextId);
        const msg = `OIDC context '${contextId}' sets a client_secret in a browser client — ` +
            `this is insecure (the secret ships to the browser). Use the server-side ` +
            `<a data-action="docs">oidc-server-ts</a> module for confidential clients.`;
        try {
            if (window.Dialogs && typeof window.Dialogs.show === "function") {
                window.Dialogs.show(msg, 15000, window.Dialogs.MSG_WARN, {
                    actions: { docs: () => { try { window.open("https://github.com/RationAI/xopat/blob/master/src/AUTH.md", "_blank"); } catch (e) {} } }
                });
            } else {
                console.warn(`[oidc-client-ts] ${msg.replace(/<[^>]+>/g, "")}`);
            }
        } catch (e) { /* ignore UI errors */ }
    }

    // Convention (shared with oidc-server-ts + XOpatUser): the DEFAULT/main
    // context — written in JSON as an empty string, null, omitted, or the literal
    // "core" (all equivalent) — is the MAIN viewer identity: it updates the appbar
    // user and the default XOpatUser context that HttpClient reads, and fires the
    // bare `login`/`secret-updated` events. Every other id is a sub-identity
    // (updateXOpatUser stays false). XOpatAuth already canonicalizes to "core" and
    // sets cfg.isMain; the `!contextId` guard keeps this correct if called directly.
    function isMainContext(contextId, cfg) {
        return cfg?.isMain === true || !contextId || contextId === "core";
    }

    function clientFor(contextId, cfg) {
        let client = clients.get(contextId);
        if (!client) {
            warnIfSecret(contextId, cfg);
            const oidcConfig = { ...(cfg.config || {}) };
            delete oidcConfig.confidential; // not an oidc-client-ts setting
            client = new OIDCAuthClient(oidcConfig, {
                userContextId: contextId,
                updateXOpatUser: isMainContext(contextId, cfg),
                authMethod: cfg.authMethod || "popup",
                serviceName: cfg.serviceName || contextId,
                usesStore: cfg.usesStore || "default",
                tokenForServer: cfg.tokenForServer || "access_token",
                // Only auto-log-in at boot when the context opts in (e.g. the main
                // identity). On-demand contexts (chat) log in via broker.login().
                autoLogin: !!cfg.autoLogin,
            });
            clients.set(contextId, client);
        }
        return client;
    }


    const broker = {
        async init(contextId, cfg) {
            // Processes a returning redirect callback + silent renew, and (via
            // OIDCAuthClient's own _trySignIn(IF_NECESSARY)) auto-logs-in when
            // there is no valid session — this is what replaces the removed
            // oidc-auth plugin's before-app-init auto-login for the core context.
            await clientFor(contextId, cfg).init();
        },
        async login(contextId, cfg) {
            // Interactive login. Redirect flow unloads the page; completion is
            // detected by XOpatAuth via XOpatUser events (here and on reload).
            clientFor(contextId, cfg).signIn();
        },
        async logout(contextId) {
            try { XOpatUser.instance().logout(contextId); } catch (e) { /* ignore */ }
            const c = clients.get(contextId);
            if (c && c.clearSession) { try { await c.clearSession(); } catch (e) { /* ignore */ } }
        },
        // isAuthenticated / getToken intentionally omitted: XOpatAuth's defaults
        // (getIsLogged + getSecret("jwt", ctx)) already do exactly this.
    };

    // Auto-declare contexts from this module's PUBLIC static config (parallel to
    // oidc-server-ts's server-RPC listContexts, but client OIDC config has no
    // secret so it is read directly). Preferred shape:
    //   modules["oidc-client-ts"].contexts.<ctx> = {
    //     oidc: { authority, client_id, scope, ... }, authMethod?, tokenForServer?,
    //     usesStore?, autoLogin?, serviceName?, isMain?
    //   }
    // Legacy shape (a bare top-level `oidc` block + `method`) is accepted as the
    // "core" context. "core" → main viewer identity. Declaring a context here
    // activates it at boot (OIDCAuthClient.init auto-logs-in); set
    // `autoLogin:false` to declare it without the boot login. Replaces the old
    // oidc-auth plugin.
    function readStaticContexts() {
        const meta = (id, key) => (typeof window.moduleMeta === "function" ? window.moduleMeta(id, key) : undefined);
        const explicit = meta("oidc-client-ts", "contexts");
        if (explicit && typeof explicit === "object") return explicit;
        // Legacy: a top-level `oidc` block → treat as the core context.
        const legacyOidc = meta("oidc-client-ts", "oidc");
        if (legacyOidc && typeof legacyOidc === "object") {
            return { core: {
                oidc: legacyOidc,
                authMethod: meta("oidc-client-ts", "method"),
                usesStore: meta("oidc-client-ts", "usesStore"),
                tokenForServer: meta("oidc-client-ts", "tokenForServer"),
            } };
        }
        return null;
    }

    let _staticConfigured = false;
    function configureFromStaticConfig(auth) {
        if (_staticConfigured) return;
        _staticConfigured = true;
        const contexts = readStaticContexts();
        if (!contexts) return;
        for (const contextId of Object.keys(contexts)) {
            const c = contexts[contextId] || {};
            try {
                void auth.configureContext({
                    contextId,
                    method: "oidc",
                    config: c.oidc || c.config || {},
                    serviceName: c.serviceName || contextId,
                    authMethod: c.authMethod || c.method,
                    usesStore: c.usesStore,
                    tokenForServer: c.tokenForServer || "access_token",
                    // Default context may be keyed "" / null / "core" in JSON — all main.
                    isMain: c.isMain === true || !contextId || contextId === "core",
                    // A statically-declared context auto-logs-in at boot unless it
                    // explicitly opts out (autoLogin:false → declared but on-demand).
                    autoLogin: c.autoLogin !== false,
                });
            } catch (e) {
                console.error(`oidc-client-ts: configure context '${contextId}' failed`, e);
            }
        }
    }

    function tryRegister() {
        const auth = window.APPLICATION_CONTEXT && window.APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!auth.hasBroker("oidc")) auth.registerBroker("oidc", broker);
        configureFromStaticConfig(auth);
        return true;
    }

    // APPLICATION_CONTEXT.auth is created during app bootstrap; this module file
    // may evaluate before or after that. Register as soon as it exists (bounded
    // poll), then stop. Consumers call configureContext() at pluginReady — well
    // after this resolves — and registerBroker() back-fills any early contexts.
    if (!tryRegister()) {
        const iv = setInterval(() => { if (tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => clearInterval(iv), 15000);
    }
})();
