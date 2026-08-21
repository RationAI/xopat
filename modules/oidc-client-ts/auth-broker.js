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
            // TEMPORARY [oidc-flow] — the client is built ONCE per context and its
            // `authMethod` is fixed from here on, so a surprising flow at login time
            // is decided at this line. Remove with the sibling log in _promptLogin.
            console.debug('[oidc-flow] client built', {
                contextId,
                cfgAuthMethod: cfg.authMethod,
                cfgAutoLogin: cfg.autoLogin,
                resolved: cfg.authMethod === "popup" ? "popup"
                    : cfg.authMethod === "redirect" ? "redirect"
                        : (cfg.autoLogin ? "redirect" : "popup"),
            });
            client = new OIDCAuthClient(oidcConfig, {
                userContextId: contextId,
                updateXOpatUser: isMainContext(contextId, cfg),
                // Which INTERACTIVE flow this context uses. A boot login has no user
                // gesture, so an auto-login context defaults to "redirect", the only
                // flow that can run without one. "popup" is still valid there — core
                // then attempts the silent route at boot and, if that does not
                // authenticate, hands the user to the interaction gate rather than
                // opening a window the browser blocks (see `canLoginWithoutGesture`
                // below and src/AUTH.md). An explicit authMethod always wins.
                // Normalized here too: a context configured in CODE (a feature's
                // inline fallback, `configureContext` from a plugin) does not pass
                // through `declareStaticContexts`, and an unrecognized value must
                // never read as "cannot navigate".
                authMethod: cfg.authMethod === "popup" ? "popup"
                    : cfg.authMethod === "redirect" ? "redirect"
                    : (cfg.autoLogin ? "redirect" : "popup"),
                serviceName: cfg.serviceName || contextId,
                // Opt-in: point the popup + silent frame at the module's bare
                // callback document instead of the viewer page. Requires the URL to
                // be registered at the IdP first — see OIDCAuthClient.callbackPageUrl.
                useCallbackPage: cfg.useCallbackPage === true,
                usesStore: cfg.usesStore || "default",
                tokenForServer: cfg.tokenForServer || "access_token",
                // Only auto-log-in at boot when the context opts in (e.g. the main
                // identity). On-demand contexts (chat) log in via broker.login().
                autoLogin: !!cfg.autoLogin,
                // Accepted by OIDCAuthClient but previously unreachable from static
                // config — a deployment could not tune its own retry behaviour or add
                // IdP-specific signin args (acr_values, login_hint, …) at all.
                maxRetryCount: cfg.maxRetryCount,
                retryTimeout: cfg.retryTimeout,
                extraSigninRequestArgs: cfg.extraSigninRequestArgs,
            });
            clients.set(contextId, client);
        }
        return client;
    }


    const broker = {
        async init(contextId, cfg) {
            // Processes a returning redirect callback and arms the silent renew
            // loop. It does NOT log in: acting on `autoLogin` is core's job now
            // (XOpatAuth.runAutoLogin), which arbitrates the single page-unloading
            // navigation across every broker rather than just ours.
            //
            // The return value is what init OBSERVED — notably an
            // `interaction-required` callback, which core escalates into a real
            // interactive sign-in instead of a blocking scrim.
            return await clientFor(contextId, cfg).init();
        },
        async login(contextId, cfg, options) {
            // Interactive login. Redirect flow unloads the page; completion is
            // detected by XOpatAuth via XOpatUser events (here and on reload).
            //
            // Core only routes a gesture-less call here when `canLoginWithoutGesture`
            // said yes (redirect), but the flag travels anyway: the client refuses to
            // open a window without it, so a caller that gets this wrong degrades to
            // the interaction gate instead of a blocked popup.
            const outcome = await clientFor(contextId, cfg).signIn({
                gesture: options?.gesture !== false,
                // Core's call, not `authMethod`'s: a redirect is impossible when the
                // viewer is framed or the user has work that unloading would discard.
                mayNavigate: options?.mayNavigate !== false,
            });
            // No verdict when we did not actually run — another attempt owns the
            // client and core must keep waiting for ITS events.
            if (outcome === "skipped") return undefined;
            // The credential is the verdict. Reporting `false` for a closed popup or
            // a refused exchange is what lets core stop holding its caller — and the
            // recovery scrim — instead of waiting out LOGIN_TIMEOUT_MS. A redirect
            // never reaches this line (the page is unloading), which is correct:
            // there is no verdict to give.
            const user = XOpatUser.instance();
            return !!(user.getIsLogged(contextId) && user.getSecret("jwt", contextId));
        },
        async loginSilent(contextId, cfg) {
            // No UI, no navigation: a refresh grant when we hold a refresh token,
            // otherwise a `prompt=none` probe of an IdP session someone else already
            // established (the embedding page, another tab, an earlier visit). This is
            // the ONLY way a login can happen without a click.
            return clientFor(contextId, cfg).signInSilent();
        },
        canLoginWithoutGesture(contextId, cfg) {
            // `window.open` is blocked without a user gesture; a full-page redirect
            // is not. Anything else must wait for a click.
            return clientFor(contextId, cfg).authMethod === "redirect";
        },
        navigatesOnLogin(contextId, cfg) {
            // Same predicate, different question — and here they coincide, because
            // the only gesture-free flow this broker has IS the redirect. Declared
            // explicitly rather than left to the default so the two stay legible
            // when `authMethod` grows a third value.
            return clientFor(contextId, cfg).authMethod === "redirect";
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
    // Resolves once context declaration is over — successfully or by giving up.
    // Core's boot barrier awaits it, so it must ALWAYS settle (never reject, never
    // hang). Same contract as oidc-server-ts / saml-auth.
    let _discoveryAnnounced = false;
    const discoveryDone = (() => {
        let done = () => {};
        const promise = new Promise((resolve) => { done = resolve; });
        return { promise, done: () => done() };
    })();

    async function configureFromStaticConfig(auth) {
        if (_staticConfigured) return;
        _staticConfigured = true;
        try {
            await declareStaticContexts(auth);
        } finally {
            // Declaration is what the barrier waits for. `configureContext` no
            // longer awaits the broker's init, so reaching here genuinely means
            // "every context is visible to listAutoLoginContexts()".
            discoveryDone.done();
        }
    }

    async function declareStaticContexts(auth) {
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
            // Normalized to exactly "popup" | "redirect". `c.method` is the LEGACY
            // flow key, and a deployment that used it for the broker name instead
            // (`"method": "oidc"`) used to leave `authMethod` as a value that is
            // neither — harmless while the only test was `=== "popup"`, but once core
            // began asking `navigatesOnLogin` (`=== "redirect"`) it silently meant
            // "this context cannot navigate", turning every boot login into a popup
            // the browser then blocked. Anything unrecognized means redirect: it is
            // the only flow that works with no user gesture.
            const rawFlow = c.authMethod || c.method;
            const authMethod = rawFlow === "popup" ? "popup"
                : rawFlow === "redirect" ? "redirect"
                : (autoLogin ? "redirect" : "popup");
            if (rawFlow && rawFlow !== authMethod) {
                console.warn(`oidc-client-ts: context '${contextId}' declares an unknown login flow ` +
                    `'${rawFlow}'; using '${authMethod}'. Valid values are "popup" and "redirect".`);
            }
            return { contextId, c, isMain, autoLogin, authMethod };
        });

        // The "at most one boot redirect" arbitration used to live here. It is core's
        // now (XOpatAuth.runAutoLogin), and it has to be: this loop could only ever
        // see OUR contexts, so a deployment running this module alongside saml-auth
        // or oidc-server-ts had two brokers each politely guarding half the set and
        // nothing guarding the whole. Core sees every context via
        // `listAutoLoginContexts()` and decides once.
        for (const { contextId, c, isMain, autoLogin, authMethod } of declared) {
            try {
                // Awaited: configureContext is async and throws, so a bare `void`
                // left the rejection unhandled and this catch never fired.
                await auth.configureContext({
                    contextId,
                    method: "oidc",
                    config: c.oidc || c.config || {},
                    serviceName: c.serviceName || contextId,
                    // The RESOLVED flow, not the raw key: `clientFor` and
                    // `canLoginWithoutGesture` both branch on it, and an undefined
                    // value there silently meant "popup" in one place and "redirect"
                    // in another.
                    authMethod,
                    usesStore: c.usesStore,
                    useCallbackPage: c.useCallbackPage,
                    tokenForServer: c.tokenForServer || "access_token",
                    maxRetryCount: c.maxRetryCount,
                    retryTimeout: c.retryTimeout,
                    extraSigninRequestArgs: c.extraSigninRequestArgs,
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
        // Our contexts are static, but they are still declared LATE relative to the
        // boot barrier whenever this file evaluates before `APPLICATION_CONTEXT.auth`
        // exists and has to wait for the 50 ms poll below. The barrier then reads
        // `listAutoLoginContexts()`, finds nothing, waits for nothing, and the first
        // slide burst goes out unauthenticated (401 → recovery scrim on a perfectly
        // good session). Announcing the declaration closes that window — the same
        // mechanism oidc-server-ts and saml-auth already use for their RPC-declared
        // contexts. Registered ONCE: the barrier must wait for the whole declaration.
        if (!_discoveryAnnounced && typeof auth.registerContextDiscovery === "function") {
            _discoveryAnnounced = true;
            auth.registerContextDiscovery(discoveryDone.promise);
        }
        // Fire-and-forget by design (the poll below needs a synchronous verdict),
        // but with a real rejection handler — configureFromStaticConfig reports
        // per-context failures itself and always settles `discoveryDone`.
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
        setTimeout(() => {
            clearInterval(iv);
            // Gave up: unblock anyone waiting on discovery rather than making them
            // pay their own timeout.
            discoveryDone.done();
        }, 15000);
    }
})();
