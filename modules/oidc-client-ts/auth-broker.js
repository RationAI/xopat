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
        const msg = $.t("oidc.clientSecretWarning", { contextId });
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
                // A boot login has NO user gesture, and `window.open` without one is
                // blocked by every browser — an auto-login context defaulting to
                // "popup" therefore silently never signs in. Default it to "redirect"
                // and keep "popup" for on-demand contexts (chat), which log in from a
                // real click. An explicit authMethod always wins.
                authMethod: cfg.authMethod || (cfg.autoLogin ? "redirect" : "popup"),
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
        // Legacy: a top-level `oidc` block → treat as the core context. The sibling
        // top-level keys mirror the per-context ones, `autoLogin` included — without
        // it a legacy deployment could not opt out of the boot login at all.
        const legacyOidc = meta("oidc-client-ts", "oidc");
        if (legacyOidc && typeof legacyOidc === "object") {
            return { core: {
                oidc: legacyOidc,
                authMethod: meta("oidc-client-ts", "method"),
                usesStore: meta("oidc-client-ts", "usesStore"),
                tokenForServer: meta("oidc-client-ts", "tokenForServer"),
                autoLogin: meta("oidc-client-ts", "autoLogin"),
                serviceName: meta("oidc-client-ts", "serviceName"),
            } };
        }
        return null;
    }

    let _staticConfigured = false;
    async function configureFromStaticConfig(auth) {
        if (_staticConfigured) return;
        _staticConfigured = true;
        const contexts = readStaticContexts();
        if (!contexts) return;

        // Resolve every context first, so the boot-redirect conflict below can be
        // judged across the whole set rather than per entry.
        const declared = Object.keys(contexts).map((contextId) => {
            const c = contexts[contextId] || {};
            const isMain = c.isMain === true || !contextId || contextId === "core";
            // The MAIN identity keeps the historical implicit boot login. A
            // SUB-context must opt in — matching oidc-server-ts and saml-auth, which
            // both use `=== true`. Opt-out defaults are wrong here because only ONE
            // context can complete a page-unloading redirect per load, so a second
            // declared context silently broke both logins.
            const autoLogin = isMain ? c.autoLogin !== false : c.autoLogin === true;
            const authMethod = c.authMethod || c.method || (autoLogin ? "redirect" : "popup");
            return { contextId, c, isMain, autoLogin, authMethod };
        });

        // At most one context may start a boot redirect: the flow unloads the page,
        // so a second navigation in the same tick just cancels the first and leaves
        // a stale state entry behind. Keep the main context (else the first
        // declared) and demote the rest to on-demand instead of letting them fight.
        const bootRedirects = declared.filter(d => d.autoLogin && d.authMethod === "redirect");
        if (bootRedirects.length > 1) {
            const keep = bootRedirects.find(d => d.isMain) || bootRedirects[0];
            const demoted = bootRedirects.filter(d => d !== keep);
            for (const d of demoted) d.autoLogin = false;
            console.error(
                `oidc-client-ts: contexts ${bootRedirects.map(d => `'${d.contextId}'`).join(", ")} ` +
                `all request a boot redirect login, but only one can complete per page load. ` +
                `Keeping '${keep.contextId}'; ${demoted.map(d => `'${d.contextId}'`).join(", ")} ` +
                `stay configured but log in on demand. Set "autoLogin": false on them and trigger ` +
                `APPLICATION_CONTEXT.auth.login("<ctx>") from a user click to silence this.`
            );
        }

        for (const { contextId, c, isMain, autoLogin } of declared) {
            try {
                // Awaited: configureContext is async and throws, so a bare `void`
                // left the rejection unhandled and this catch never fired.
                await auth.configureContext({
                    contextId,
                    method: "oidc",
                    config: c.oidc || c.config || {},
                    serviceName: c.serviceName || contextId,
                    authMethod: c.authMethod || c.method,
                    usesStore: c.usesStore,
                    tokenForServer: c.tokenForServer || "access_token",
                    // The broker declares what it stores, so consumers never
                    // hardcode HttpClient's auth.types (see XOpatAuth.getSecretTypes).
                    secretTypes: ["jwt"],
                    // Default context may be keyed "" / null / "core" in JSON — all main.
                    isMain,
                    autoLogin,
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
        // Fire-and-forget by design (the poll below needs a synchronous verdict),
        // but with a real rejection handler — configureFromStaticConfig awaits each
        // configureContext internally and reports per-context failures itself.
        configureFromStaticConfig(auth).catch(
            (e) => console.error("oidc-client-ts: static context configuration failed", e));
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
