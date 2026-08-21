/**
 * HTTP Basic authentication broker.
 *
 * `HttpClient` has always shipped a `"basic"` auth handler (it turns a
 * `{username, password}` secret into an `Authorization: Basic …` header), but
 * nothing ever produced such a secret — so the handler always returned `{}`.
 * This module is the missing credential source: it registers a broker with
 * `APPLICATION_CONTEXT.auth`, prompts the user, and stores the credential in
 * `XOpatUser` under the `"basic"` secret type.
 *
 * Prefer the OPERATOR-side path whenever the credential is per-deployment rather
 * than per-user: put `"Authorization": "Basic <% ENV_VAR %>"` in
 * `server.secure.proxies.<alias>.headers`. That credential never reaches the
 * browser at all. Use this module only when each user has their own login.
 *
 * Security properties, deliberate:
 *  - The credential lives in memory only (XOpatUser._secret). Basic sends a
 *    REPLAYABLE credential on every request — unlike a short-lived bearer token
 *    it cannot be revoked or expired — so it must not be written to AppCache,
 *    localStorage or sessionStorage, and it must not survive a reload.
 *  - Refused over plain HTTP unless the operator explicitly opts out for a dev
 *    box: `Authorization: Basic` is base64, not encryption.
 *  - Contexts come from STATIC config (include.json ⊕ ENV.modules), never from
 *    `getOption` — a session bundle must not be able to point an auth context at
 *    an endpoint of its choosing (AGENTS.md §7).
 *
 * Config shape (ENV `modules["basic-auth"]`):
 *   "contexts": {
 *     "<contextId>": {
 *        "serviceName": "Slide archive",   // shown in the prompt
 *        "autoLogin": false,               // prompt at boot; default false
 *        "allowInsecure": false            // permit plain HTTP; dev only
 *     }
 *   }
 */
(function () {
    const MODULE_ID = "basic-auth";
    const SECRET_TYPE = "basic";

    /** Per-context prompt de-duplication: one dialog, many awaiting callers. */
    const pending = new Map();
    const flags = new Map();
    const handlerBound = new Set();
    let configured = false;

    function t(key, args) {
        // Colon, not dot: i18next's namespace separator is ':'. A dotted key
        // resolves against the CORE bundle and renders as the last path segment.
        return $.t(`${MODULE_ID}:${key}`, args);
    }

    function meta(key) {
        return typeof window.moduleMeta === "function" ? window.moduleMeta(MODULE_ID, key) : undefined;
    }

    /**
     * Load this module's locale bundle before any string is read. This module is
     * a bare script (no XOpatModule instance), so there is no `this.loadLocale`;
     * the loader exposes the same thing globally. Memoized.
     */
    let localePromise = null;
    function ensureLocale() {
        if (!localePromise) {
            localePromise = typeof window.loadElementLocale === "function"
                ? Promise.resolve(window.loadElementLocale("modules", MODULE_ID)).catch(() => {})
                : Promise.resolve();
        }
        return localePromise;
    }

    function isSecureOrigin(cfg) {
        if (cfg && cfg.allowInsecure === true) return true;
        const loc = window.location;
        return loc.protocol === "https:" || loc.hostname === "localhost" || loc.hostname === "127.0.0.1";
    }

    /**
     * Ask for credentials. Resolves true once a secret has been stored, false if
     * the user dismissed the dialog.
     */
    function promptFor(contextId, cfg) {
        if (pending.has(contextId)) return pending.get(contextId);

        const promise = new Promise((resolve) => {
            const service = (cfg && cfg.serviceName) || contextId;
            let settled = false;
            const settle = (value) => { if (!settled) { settled = true; resolve(value); } };

            const modal = new UI.LoginModal({
                id: `basic-auth-${contextId}`,
                showSignup: false,               // Basic verifies existing credentials only
                labels: {
                    login: t("title", { service }),
                    email: t("username"),
                    submit: t("submit"),
                },
                onSubmit: ({ email, password }) => {
                    if (!email) {
                        modal.setError(t("error.usernameRequired"));
                        return;
                    }
                    const user = XOpatUser.instance();
                    // In-memory only — see the module header.
                    user.setSecret({ username: email, password }, SECRET_TYPE, contextId);
                    if (!user.getIsLogged(contextId) || user.getUserId(contextId) !== email) {
                        user.login(email, email, "", contextId);
                    }
                    modal.close();
                    settle(true);
                },
                onClose: () => settle(false),
            });
            modal.open();
        }).finally(() => pending.delete(contextId));

        pending.set(contextId, promise);
        return promise;
    }

    const broker = {
        async init(contextId, cfg) {
            flags.set(contextId, cfg || {});
            bindRefreshHandler(contextId);
            // No login here. `autoLogin` is acted on by core's automatic ladder
            // (XOpatAuth.runAutoLogin), which arbitrates it against every other
            // broker's contexts; prompting straight from init bypassed that
            // entirely. Lazy otherwise: a context only prompts when something
            // actually needs it (broker.login / a 401 refresh).
        },
        // The prompt is an in-page modal: it needs no user gesture (nothing is
        // blocked by a popup blocker) and it does NOT unload the document, so it
        // must not consume the single boot-navigation slot. Declaring both
        // explicitly is required — `navigatesOnLogin` otherwise defaults to the
        // `canLoginWithoutGesture` verdict, which is true here.
        canLoginWithoutGesture() { return true; },
        navigatesOnLogin() { return false; },
        // No `loginSilent`: Basic has no silent route by construction — the
        // credential only exists once the user types it. Core's ladder therefore
        // falls straight through to the interactive rung, which is what
        // `autoLogin: true` on a Basic context is asking for.
        async login(contextId, cfg) {
            await ensureLocale();
            const merged = { ...(flags.get(contextId) || {}), ...(cfg || {}) };
            if (!isSecureOrigin(merged)) {
                // Degrade closed: sending a reusable credential over cleartext is
                // worse than failing to authenticate.
                Dialogs.show(t("error.insecureOrigin"), 8000, Dialogs.MSG_ERR);
                // Permanent for the session — no retry can fix an insecure origin —
                // so say so through the gate rather than returning `false` into
                // silence, and let the UI show the context as needing attention.
                reportNeedsInteraction(contextId, "insecure-origin");
                return false;   // definitive: nothing is pending, do not make core wait
            }
            // `false` when the user closed the modal. Core uses that to stop waiting
            // for login events immediately instead of holding its caller (and the
            // recovery scrim) for the full interactive-login timeout.
            return await promptFor(contextId, merged);
        },
        async logout(contextId) {
            // XOpatUser.logout clears this context's secrets along with the identity.
            try { XOpatUser.instance().logout(contextId); } catch (e) { /* ignore */ }
        },
        // isAuthenticated / getToken intentionally omitted: XOpatAuth's defaults
        // follow the context's declared secretTypes, which is ["basic"] here.
    };

    /**
     * Declare contexts from STATIC config only. `moduleMeta` reads
     * include.json ⊕ ENV.modules["basic-auth"] — operator-controlled, unlike the
     * session-derived `getOption` surface.
     */
    function configureFromStaticConfig(auth) {
        if (configured) return;
        const contexts = meta("contexts");
        if (!contexts || typeof contexts !== "object") { configured = true; return; }

        for (const rawId of Object.keys(contexts)) {
            const cfg = contexts[rawId] || {};
            const contextId = rawId || "core";
            flags.set(contextId, cfg);
            try {
                auth.configureContext({
                    contextId,
                    method: SECRET_TYPE,
                    // Every consumer (HttpClient, XOpatAuth.isAuthenticated/getToken)
                    // follows this instead of assuming "jwt".
                    secretTypes: [SECRET_TYPE],
                    autoLogin: cfg.autoLogin === true,
                    isMain: contextId === "core",
                    serviceName: cfg.serviceName || contextId,
                    allowInsecure: cfg.allowInsecure === true,
                });
            } catch (e) {
                console.error(`${MODULE_ID}: configure context '${contextId}' failed`, e);
            }
        }
        configured = true;
    }

    /**
     * Report to the core recovery gate. Never `force`: this side holds no proof that
     * a stored credential is unusable — only that we did not obtain a new one.
     */
    function reportNeedsInteraction(contextId, reason) {
        window.APPLICATION_CONTEXT?.auth?.markNeedsInteraction?.(contextId, { reason });
    }

    /**
     * Re-prompt when a request 401s and HttpClient asks for a fresh credential, so
     * the refresh path has a provider even before the first successful login.
     *
     * Bound per CONTEXT from `init`, matching the other brokers' `handlerBound`
     * pattern. It used to be a one-shot sweep of `flags` at registration time, which
     * silently missed any context declared afterwards — notably one installed by a
     * `requireContext` fallback, which reaches `broker.init` and nothing else. Such a
     * context had NO `secret-needs-update` provider, so `requestSecretUpdate`
     * rejected for want of one, the 401 path gave up, and the user was never
     * prompted: a viewer that 401s forever and says nothing.
     */
    function bindRefreshHandler(contextId) {
        if (handlerBound.has(contextId)) return;
        const user = window.XOpatUser && XOpatUser.instance();
        if (!user) return;   // rebinds on the next init for this context
        handlerBound.add(contextId);
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e) => {
            if (e && e.type && e.type !== SECRET_TYPE) return;
            const ok = await broker.login(contextId, flags.get(contextId));
            // Dismissed, or refused as insecure. Without this the 401 simply went
            // unanswered — the gate, the appbar badge and the `awaitInteractive`
            // hold were all dead surface on a basic-auth deployment.
            if (ok !== true) reportNeedsInteraction(contextId, "login_required");
        });
    }

    // Resolves once context declaration is over — successfully or by giving up.
    // Core's boot barrier awaits it, so it must ALWAYS settle. Registration here can
    // be delayed twice over (for `APPLICATION_CONTEXT.auth` and for `UI.LoginModal`),
    // which is exactly the window in which the barrier would otherwise look at
    // `listAutoLoginContexts()`, find nothing, and let the first slide race the login.
    let discoveryAnnounced = false;
    const discoveryDone = (() => {
        let done = () => {};
        const promise = new Promise((resolve) => { done = resolve; });
        return { promise, done: () => done() };
    })();

    function tryRegister() {
        const auth = window.APPLICATION_CONTEXT && window.APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!discoveryAnnounced && typeof auth.registerContextDiscovery === "function") {
            discoveryAnnounced = true;
            auth.registerContextDiscovery(discoveryDone.promise);
        }
        if (!window.UI || !window.UI.LoginModal) return false;
        if (!auth.hasBroker(SECRET_TYPE)) auth.registerBroker(SECRET_TYPE, broker);
        configureFromStaticConfig(auth);
        // No refresh binding here: it is done per context from `broker.init`, which
        // core runs for EVERY context — including one installed later through a
        // requireContext fallback, which this one-shot pass could never have seen.
        discoveryDone.done();
        return true;
    }

    if (!tryRegister()) {
        const iv = setInterval(() => { if (tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => { clearInterval(iv); discoveryDone.done(); }, 15000);
    }
})();
