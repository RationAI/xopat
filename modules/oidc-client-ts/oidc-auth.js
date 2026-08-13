window.OIDCAuthClient = class OIDCAuthClient {

    static SignInUserInteraction = {
        NEVER: 'NEVER',
        IF_NECESSARY: 'IF_NECESSARY',
        ALWAYS: 'ALWAYS'
    };

    /**
     * How long a claimed interactive-login retry stays claimed. The guard exists to
     * stop an IdP bounce loop within ONE login attempt; the store backing it is
     * tab-scoped and survives reloads, so without an expiry a single abandoned
     * attempt disabled interactive login for the rest of the tab's life.
     */
    static INTERACTIVE_RETRY_TTL_MS = 2 * 60 * 1000;

    /**
     * OAuth error codes meaning "the IdP will not answer without a human".
     * These are RECOVERABLE — one user gesture fixes them — but never in the
     * background: `window.open` without a gesture is blocked by every browser.
     */
    static INTERACTION_ERRORS = new Set([
        "interaction_required",
        "login_required",
        "consent_required",
        "account_selection_required",
    ]);

    /**
     * Classify a silent-renew / sign-in failure as an IdP VERDICT that a human is
     * needed.
     *
     * `err.error` is the structured OAuth code (oidc-client-ts wraps the IdP
     * response in `ErrorResponse`, whose `message` is only `error_description ||
     * error` — so matching on the message alone is unreliable).
     *
     * Timeouts are deliberately NOT here (see {@link isTransientFailure}): they say
     * the answer never arrived, not that the IdP refused. Treating them as a verdict
     * turned a slow network — or a hidden frame that took too long — into a wiped
     * credential and a blocked viewer.
     */
    static needsUserInteraction(error) {
        if (!error) return false;
        if (OIDCAuthClient.INTERACTION_ERRORS.has(error.error)) return true;
        const message = typeof error.message === "string" ? error.message : "";
        return OIDCAuthClient.INTERACTION_ERRORS.has(message);
    }

    /**
     * Delivery failures: the request never completed. `ErrorTimeout` covers both
     * the hidden-frame watchdog ("IFrame timed out") and the plain fetch timeout on
     * the refresh-token grant ("Network timed out") — the latter involving no frame
     * at all. These are retryable, and the credential in hand is unaffected.
     */
    static isTransientFailure(error) {
        if (!error) return false;
        if (error.name === "ErrorTimeout") return true;
        const message = typeof error.message === "string" ? error.message : "";
        return message.includes("IFrame timed out")
            || message.includes("Network timed out")
            || message.includes("Failed to fetch");
    }

    /**
     * @param {Object} configuration OIDC configuration (authority, client_id, etc.)
     * @param {Object} options xOpat specific options
     */
    constructor(configuration, options = {}) {
        this.configuration = configuration;
        this._signinProgress = false;
        this._connectionRetries = 0;

        // User context - whether we act as the main user context (undefined) or some sub-auth session
        this.userContextId = options.userContextId || undefined;
        // Service name - users might log-in for a particular sub-service
        this.serviceName = options.serviceName || 'the viewer';
        this.maxRetryCount = options.maxRetryCount || 2;
        this.extraSigninRequestArgs = options.extraSigninRequestArgs;
        this.usesStore = options.usesStore || 'default';
        this.retryTimeout = (options.retryTimeout || 20) * 1000;
        this.authMethod = options.authMethod || 'redirect';
        this.updateXOpatUser = !!options.updateXOpatUser;
        // Which OIDC token becomes the XOpatUser "jwt" secret for this context.
        // Default "access_token" (unchanged legacy behaviour + used upstream by
        // JWT-access-token IdPs like Keycloak). Set "id_token" for IdPs whose
        // access token is opaque (e.g. Google) so our server can RS256-verify it.
        this.serverTokenType = options.tokenForServer || 'access_token';
        // When false (default), init() sets the context up + processes a returning
        // redirect and any existing session, but does NOT interactively sign in —
        // login is deferred to an explicit signIn() (e.g. a chat provider's Login
        // button), so a popup/redirect never fires on page load. Set true for a
        // context that should auto-log-in at boot (e.g. the main viewer identity).
        this.autoLogin = !!options.autoLogin;

        if (!this.configuration.authority || !this.configuration.client_id || !this.configuration.scope) {
            throw new Error("OIDC Client not properly configured. Auth disabled.");
        }

        this.configuration.redirect_uri = this.configuration.redirect_uri
            || window.location.href.split('#')[0].split('?')[0];

        this.configuration.post_logout_redirect_uri = this.configuration.post_logout_redirect_uri
            || window.APPLICATION_CONTEXT?.env?.gateway || this.configuration.redirect_uri;

        this.configuration.automaticSilentRenew = false;
        this.configuration.storeState = this.configuration.userStore = undefined;

        this._setupStore();

        this.userManager = new oidc.UserManager(this.configuration);
        this.userManager.events.addUserLoaded((user) => {
            return this.handleUserDataChanged(false, user);
        });

        // Registered here, NOT on first successful login: HttpClient's
        // refresh-on-401 path raises `secret-needs-update` and gives up when
        // nobody listens, so a context that has never logged in could never be
        // provisioned by it. NEVER = signinSilent, which needs no user gesture.
        const user = XOpatUser.instance();
        user.addHandler(user.getEventName('secret-needs-update', this.userContextId), async event => {
            if (event.type === "jwt") {
                await this._trySignIn(OIDCAuthClient.SignInUserInteraction.NEVER, true);
            }
        });
    }

    /**
     * Whether this client owns the MAIN viewer identity. XOpatAuth canonicalizes
     * the main context to the literal "core", so `userContextId === undefined`
     * is never true for a broker-created client — mirrors isMainContext() in
     * auth-broker.js.
     */
    get _isCoreContext() {
        return !this.userContextId || this.userContextId === 'core';
    }

    _setupStore() {
        // Every branch routes through the IO pipeline. Raw `localStorage` /
        // `sessionStorage` are not an option here: the property read itself
        // throws `SecurityError` in a sandboxed iframe (opaque origin), and the
        // pipeline substitutes in-memory drivers there instead.
        let store;
        switch (this.usesStore) {
            case "cookie": store = APPLICATION_CONTEXT.AppCookies.getStore(); break;
            case "cache":
            case "local": store = APPLICATION_CONTEXT.AppCache.getStore(); break;
            case "session":
            case "default":
            // Owner uid is the module's, not a per-context one: contexts are
            // already separated by the `prefix` below, and this keeps the
            // namespace admin-rebindable through the usual bindings block.
            default: store = new XOpatStorage.Session({id: "module.oidc-client-ts"}).getStore(); break;
        }
        // Never leave `store` falsy: oidc-client-ts then falls back to raw
        // window.localStorage / window.sessionStorage internally, which is the
        // exact throw we are avoiding.
        if (!store) store = new oidc.InMemoryWebStorage();

        // Namespace per context. Without a prefix the library defaults to a
        // bare "oidc." (WebStorageStateStore), so EVERY context shares one
        // namespace in the same storage — and signin state is keyed by the
        // random state UUID alone. readSigninResponseState() removes the entry
        // BEFORE it checks authority/client_id ownership, so with two contexts
        // the wrong client consumes the other's state: one throws "authority
        // mismatch", the other then throws "No matching state found in
        // storage", and neither logs in. It also makes clearStaleState() sweep
        // the sibling's entries.
        //
        // Changing the prefix invalidates any session stored under the old bare
        // "oidc." namespace — users re-login once, after which this is stable.
        const prefix = `oidc.${this.userContextId || 'core'}.`;
        this.configuration.userStore = new oidc.WebStorageStateStore({store, prefix});
        this.configuration.stateStore = new oidc.WebStorageStateStore({store, prefix});
        // Kept for our own cross-redirect bookkeeping (the interactive-retry guard).
        // It must not live in the URL: `redirect_uri` is registered at the IdP
        // verbatim, so an extra query parameter there is a redirect_uri_mismatch.
        this._flagStore = store;
    }

    /**
     * Whether a returning `state` belongs to THIS context.
     *
     * Read-only on purpose: the library's own lookup is destructive, so a context
     * that did not start the flow must never be the one to ask. The returning URL
     * carries no context marker (`redirect_uri` defaults to the bare page URL for
     * every context), so this store probe is the only way to attribute a callback
     * before consuming it.
     */
    async _ownsSigninState(state) {
        try {
            const store = this.configuration.stateStore;
            if (!store || typeof store.get !== "function") return true;   // no store: legacy behaviour
            return !!(await store.get(state));
        } catch (e) {
            return false;
        }
    }

    /**
     * Which flow started the returning `state`: `"si:r"` redirect, `"si:p"` popup,
     * `"si:s"` silent (hidden frame). Read-only, like {@link _ownsSigninState} —
     * the library's own lookup consumes the entry.
     */
    async _signinStateRequestType(state) {
        try {
            const store = this.configuration.stateStore;
            const raw = store && typeof store.get === "function" ? await store.get(state) : null;
            return raw ? (JSON.parse(raw) || {}).request_type || null : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Answer a silent-renew callback and stop, instead of booting the application.
     *
     * `silent_redirect_uri` defaults to `redirect_uri`, which defaults to the bare
     * page URL — so the `prompt=none` frame loads the WHOLE viewer: plugins, tile
     * sources, everything. That routinely outruns the library's 10 s watchdog, and
     * the resulting `ErrorTimeout` used to be reported as "your session expired"
     * while the real token was fine. Detected by the stored `request_type`, which is
     * exact: no frame heuristics, and a legitimately embedded viewer (whose own
     * login returns `si:r`/`si:p`) is never mistaken for one.
     *
     * @return {Promise<boolean>} true when this document was the silent callback
     */
    async _handleSilentRenewCallback() {
        if (typeof window === "undefined") return false;
        // Only ever short-circuit a FRAME. If a silent response somehow lands
        // top-level (the frame was blocked and the IdP navigated the tab), the
        // normal callback path below must handle it — stalling the top document
        // would leave the user staring at a viewer that never boots.
        if (window.self === window.top) return false;
        const state = new URLSearchParams(window.location.search).get("state");
        if (state === null) return false;
        if (await this._signinStateRequestType(state) !== "si:s") return false;

        const ctx = this.userContextId || 'core';
        console.debug(`OIDC[${ctx}]: this document is a silent-renew callback frame; answering without booting.`);
        try {
            await this.userManager.signinSilentCallback(window.location.href);
        } catch (e) {
            // The opener still times out on its own; nothing else to do here.
            console.warn(`OIDC[${ctx}]: silent-renew callback failed.`, e);
        }
        return true;
    }

    /**
     * Idempotent: XOpatAuth drops its own init memo when a real broker supersedes
     * a fallback, so broker.init() can run twice against this same cached client.
     * A second pass would re-enter signinRedirectCallback on an already-consumed
     * `state` and fail the login.
     */
    async init() {
        return this._initPromise ??= this._doInit();
    }

    async _doInit() {
        // Before anything else: this document may BE the hidden silent-renew frame.
        // Answer the callback and never resolve — the library removes the frame as
        // soon as the message lands, which is also what stops the rest of the boot.
        if (await this._handleSilentRenewCallback()) {
            await new Promise(() => {});
        }

        const returningState = new URLSearchParams(window.location.search).get("state");

        // Skip the whole init only when there is a WORKING credential already —
        // identity alone is not one. `XOpatUser.getIsLogged()` stays true across an
        // expired/dropped secret (markNeedsInteraction deliberately keeps the
        // identity), so testing `isLogged` alone made init a no-op for exactly the
        // sessions that needed it most: the callback was never consumed, no token
        // was ever written, `isAuthenticated()` stayed false forever, and every
        // request went out bare until something 401'd.
        //
        // And never skip when a `state` is in the URL: THIS page load is the identity
        // provider's answer, and dropping it strands the login (the state entry is
        // then swept as stale and the next attempt starts from zero).
        if (this.updateXOpatUser && returningState === null) {
            const user = XOpatUser.instance();
            if (user.isLogged && user.getSecret("jwt", this.userContextId)) {
                console.info("OIDC Client: Main user already logged in.");
                return;
            }
        }

        let resolves = null;
        return new Promise(async (resolve, reject) => {
            try {
                resolves = () => { resolve(); resolves = null; };

                if (!await this.handleUserDataChanged()) {
                    const urlParams = new URLSearchParams(window.location.search);
                    // Only OUR callback. Every context sees the same returning URL
                    // (redirect_uri defaults to the bare page URL), so without this
                    // probe a sibling context would consume the state entry — and
                    // the library's lookup deletes before it validates ownership,
                    // which fails BOTH logins. Skipping here lets the context that
                    // did not start the flow fall through to its normal lazy path.
                    if (returningState !== null && await this._ownsSigninState(returningState)) {
                        const url = window.location.href;
                        try {
                            if (this.authMethod === "popup") {
                                await this.userManager.signinPopupCallback(url);
                            } else {
                                urlParams.delete("state");
                                urlParams.delete("session_state");
                                urlParams.delete("iss");
                                urlParams.delete("code");
                                // The IdP's refusal is answered below; leaving these in
                                // the address bar only made the failure permanent-looking
                                // and got copy-pasted into bug reports as if it were the
                                // app's own URL.
                                urlParams.delete("error");
                                urlParams.delete("error_description");
                                urlParams.delete("error_subtype");
                                urlParams.delete("error_uri");
                                const rest = urlParams.toString();
                                window.history.replaceState({}, window.document.title,
                                    window.location.origin + window.location.pathname + (rest ? `?${rest}` : ""));
                                await this.userManager.signinRedirectCallback(url);
                            }
                        } catch (e) {
                            // The callback carried an error response (`?error=…`) or
                            // could not be processed. Classify it instead of dying in a
                            // console.warn — this is the page load the user is looking at.
                            await this._handleCallbackFailure(e);
                        }
                        resolves && resolves();
                        return;
                    }
                    // A returning `state` means THIS page load is the IdP's answer.
                    // If we could not consume it, starting another login cannot
                    // help — it redirects straight back here and loops forever.
                    // Stop, and say why: the cause is always that the OIDC store
                    // did not survive the redirect.
                    if (returningState !== null) {
                        console.error(`OIDC[${this.userContextId || 'core'}]: returned from the identity ` +
                            `provider but the sign-in state is missing from storage — the OIDC store is not ` +
                            `persisting across the redirect. Refusing to start another login (that would loop).`);
                        // Console-only left the user staring at a viewer that had
                        // silently given up mid-login and would 401 on everything.
                        // The cause is environmental (blocked storage / opaque
                        // origin), so say so rather than offering a retry that
                        // cannot work.
                        this._notifyStorageBroken();
                        resolves && resolves();
                        return;
                    }
                    // Lazy by default: only auto-sign-in at init when explicitly
                    // requested (main identity). Sub-contexts (e.g. chat providers)
                    // stay logged-out until an explicit signIn() — no boot popup.
                    if (this.autoLogin) {
                        await this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY);
                    }
                }
                resolves && resolves();
            } catch (e) {
                console.warn(e);
                reject(e);
            }
        }).catch(e => {
            console.warn("OIDC Aborted user login. Reason:", e);
        });
    }

    /** Storage key of the "we already tried one interactive login" guard. */
    get _retryFlagKey() {
        return `xopat.interactive-retry.${this.userContextId || 'core'}`;
    }

    /** Tell the user the OIDC store did not survive the redirect. */
    _notifyStorageBroken() {
        try {
            const service = this.serviceName || (this.userContextId || 'core');
            Dialogs.show($.t("oidc.storageNotPersisting", { service }), 20000, Dialogs.MSG_ERR);
        } catch (e) { /* UI may not be up yet; the console error above stands */ }
    }

    /**
     * Claim the single interactive retry allowed per session. Returns false when it
     * was already spent — the caller must then stop and let the user decide, or the
     * viewer bounces to the IdP and back forever.
     *
     * The claim EXPIRES. It used to be a bare `"1"` released only when a credential
     * finally landed, in a tab-scoped store that survives reloads — so any attempt
     * that died in between (a closed tab mid-redirect, a network drop, an IdP error)
     * left the flag set forever. From then on every `interaction_required` skipped
     * the one interactive login it was allowed to start and went straight to the
     * recovery scrim, on a session that could have signed in perfectly well. A login
     * round trip takes seconds; anything older is not "an attempt in progress".
     */
    _claimInteractiveRetry() {
        try {
            // `Storage`-shaped (getItem/setItem/removeItem) — that is what
            // oidc-client-ts' WebStorageStateStore requires, so it is what
            // `_setupStore` builds.
            const store = this._flagStore;
            if (!store) return false;                  // cannot guard → do not retry
            const raw = store.getItem(this._retryFlagKey);
            if (raw && Date.now() - (Number(raw) || 0) < OIDCAuthClient.INTERACTIVE_RETRY_TTL_MS) {
                return false;
            }
            store.setItem(this._retryFlagKey, String(Date.now()));
            return true;
        } catch (e) {
            return false;
        }
    }

    _releaseInteractiveRetry() {
        try { this._flagStore?.removeItem?.(this._retryFlagKey); } catch (e) { /* best effort */ }
    }

    /**
     * A returning redirect that carried an error, or a callback we could not
     * process.
     *
     * `interaction_required` here is the *expected* answer to an automatic
     * `prompt=none` attempt — it means "ask the user properly", not "the session is
     * gone". For an `autoLogin` context that is exactly what we do, once: a real
     * interactive redirect. The guard is a store flag rather than a URL marker,
     * because `redirect_uri` must match the IdP registration verbatim.
     */
    async _handleCallbackFailure(error) {
        const ctx = this.userContextId || 'core';
        if (OIDCAuthClient.needsUserInteraction(error)) {
            if (this.autoLogin && this._claimInteractiveRetry()) {
                console.debug(`OIDC[${ctx}]: the identity provider needs the user (${error?.error}); ` +
                    `starting one interactive login.`);
                await this._trySignIn(OIDCAuthClient.SignInUserInteraction.ALWAYS, true);
                return;
            }
            console.warn(`OIDC[${ctx}]: the identity provider requires user interaction and an automatic ` +
                `login was already attempted — leaving it to the user.`);
            this._reportNeedsInteraction(error);
            return;
        }
        if (OIDCAuthClient.isTransientFailure(error)) {
            console.warn(`OIDC[${ctx}]: sign-in callback did not complete in time; the session is unchanged.`, error);
            return;
        }
        console.warn(`OIDC[${ctx}]: sign-in callback failed.`, error);
    }

    signIn() {
        // An explicit user gesture is not an automatic retry: it must never be
        // refused by the loop guard, and it re-arms the guard for whatever comes
        // after. Without this, a user who clicked "Sign in" on the recovery scrim
        // could be silently denied by a leftover claim from an earlier attempt.
        this._releaseInteractiveRetry();
        this._manualCoroutine = new Promise(async (resolve) => {
            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.ALWAYS, true);
            this._manualCoroutine = null;
            resolve();
        });
    }

    async _trySignIn(allowUserPrompt = OIDCAuthClient.SignInUserInteraction.IF_NECESSARY, preventRecurse = false) {
        if (this._signinProgress) return false;

        // Do not perform renew if we try manually for any reason (e.g. user action).
        // Clearing the flag too is what lets handleUserDataChanged re-arm the loop
        // afterwards: it only calls enableEvents() when `!_silentRenewEnabled`, so
        // stopping without clearing left the renew loop dead for the rest of the
        // session — even when the manual attempt SUCCEEDED.
        this.userManager.stopSilentRenew();
        this._silentRenewEnabled = false;

        this._connectionRetries++;
        try {
            // ... (keep the existing try block exactly as it is) ...
            this._signinProgress = true;
            const { ALWAYS, IF_NECESSARY } = OIDCAuthClient.SignInUserInteraction;

            if (allowUserPrompt === ALWAYS) {
                await this._promptLogin();
            } else if (allowUserPrompt === IF_NECESSARY) {
                const refreshTokenExpiration = await this.getRefreshTokenExpiration();
                if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
                    USER_INTERFACE.Loading.text("Log-in required...");
                    await this._promptLogin();
                } else {
                    console.debug("OIDC: login[IF_NECESSARY] silently...");
                    await this.userManager.signinSilent();
                }
            } else {
                // SignInUserInteraction.NEVER
                USER_INTERFACE.Loading.text("Attempting to log in...");
                console.debug("OIDC: login[NEVER] silently...");
                await this.userManager.signinSilent();
            }

            this._connectionRetries = 0;
            this._signinProgress = false;
            return;
        } catch (error) {
            this._signinProgress = false;
            USER_INTERFACE.Loading.text("Login not successful! Waiting...");
            if (typeof error === "string") error = {message: error};
            if (!error.message) {
                error.message = "";
            }

            if (error.message.includes('Failed to fetch')) {
                console.debug('OIDC: Signin failed due to connection issues. Retrying in 20 seconds.');
                return await this._safeRetrySignIn(`Failed ${this.serviceName} login, retrying in 20 seconds.`,
                    'Retry now.', preventRecurse);
            }

            if (error.message.includes('disposed window')) {
                console.debug('OIDC: Signin failed due to popup window blocking.');
                return await this._safeRetrySignIn(`Login to ${this.serviceName} requires opening a popup window. Please, allow popup window in your browser.`,
                    'Retry now.', true);
            }

            if (error.message.includes('closed by user')) {
                console.debug('OIDC: Signin failed due to user cancel.');
                Dialogs.show(
                    `You need to login to access ${this.serviceName}. <a data-action="retry">Retry now</a>.`,
                    300000,
                    Dialogs.MSG_WARN,
                    {
                        actions: {
                            retry: (ev, dialogInstance) => {
                                this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY, true);
                                dialogInstance.hide();
                            }
                        }
                    }
                );
                await this.handleUserDataChanged(true);
                return;
            }

            if (error.message.includes('Invalid refresh token')) {
                await this.clearSession();
                return this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY, this._connectionRetries > this.maxRetryCount);
            }

            // The IdP told us a human is needed. Not an error to report as
            // "unknown reasons" and not something a retry can fix: hand it to the
            // core recovery gate, which prompts on the user's next click.
            if (OIDCAuthClient.needsUserInteraction(error)) {
                this._reportNeedsInteraction(error);
                return;
            }

            // No answer arrived (frame watchdog, network timeout). Says nothing
            // about the IdP's willingness, nor about the token we already hold.
            if (OIDCAuthClient.isTransientFailure(error)) {
                console.debug(`OIDC: sign-in attempt did not answer in time (${error.name || error.message}).`);
                const user = XOpatUser.instance();
                if (user.getIsLogged(this.userContextId) && user.getSecret("jwt", this.userContextId)) {
                    // The session is still usable — say nothing to the user. The renew
                    // loop (or the next 401) will try again.
                    return;
                }
                return await this._safeRetrySignIn(`Failed ${this.serviceName} login, retrying in 20 seconds.`,
                    'Retry now.', preventRecurse);
            }

            Dialogs.show(
                `Login to ${this.serviceName} failed due to unknown reasons. Please, <a data-action="retry">try again</a> or notify us about the issue.`,
                this.retryTimeout + 2000,
                Dialogs.MSG_ERR,
                {
                    actions: {
                        retry: (ev, dialogInstance) => {
                            this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY, true);
                            dialogInstance.hide();
                        }
                    }
                }
            );
            console.error("OIDC auth attempt: ", error);
            await this.handleUserDataChanged(true);
        }
    }

    async _safeRetrySignIn(message, retryMessage, preventRecurse) {
        let resolved, dialogWait = new Promise((resolve) => resolved = resolve);
        Dialogs.show(`${message} <a data-action="retry">${retryMessage}</a>`,
            this.retryTimeout, Dialogs.MSG_WARN, {
                onHide: resolved,
                actions: {
                    retry: (ev, dialogInstance) => {
                        this.signIn();
                        dialogInstance.hide();
                    }
                }
            });
        await dialogWait;

        if (!this._manualCoroutine) {
            if (!preventRecurse) {
                return await this._trySignIn(OIDCAuthClient.SignInUserInteraction.NEVER, this._connectionRetries >= this.maxRetryCount);
            }
            console.error("OIDC: No longer attempting to log in: user action needed.");
        } else {
            return this._manualCoroutine;
        }
    }

    async _promptLogin() {
        USER_INTERFACE.Loading.text("Login required: logging in...");
        if (this.authMethod === "popup") {
            // Direct sign-in does not refresh page
            console.debug('OIDC: Try to sign in via popup.');
            await this.userManager.signinPopup({
                ...this.extraSigninRequestArgs,
                ...{
                    popupWindowFeatures: {
                        popup: "no", //open new tab instead of popup window
                        closePopupWindowAfterInSeconds: -1
                    },
                    popupWindowTarget: "xopat-auth",
                }
            });
            return;
        }

        console.debug('OIDC: Try to sign in via redirect.');
        if (!UTILITIES.storePageState()) {
            // failed to preserve the login state, we need to redirect using popup
            const originalMethod = this.authMethod;
            this.authMethod = 'popup';
            await this._promptLogin();
            this.authMethod = originalMethod;
        } else {
            await this.userManager.signinRedirect(this.extraSigninRequestArgs);
            await new Promise(() => {});  // never resolve, we are being redirected
        }
    }

    async getSessionData() {
        // Key used:  oidc.user:<authority>:<client>
        return await this.configuration.userStore.get(this.userManager._userStoreKey);
    }

    /**
     * Current OIDC tokens for this client, or nulls if not logged in.
     * @return {Promise<{access_token: string|null, id_token: string|null}>}
     */
    async getTokens() {
        const user = await this.userManager.getUser();
        return {
            access_token: user?.access_token || null,
            id_token: user?.id_token || null,
        };
    }

    async clearSession() {
        return await this.configuration.userStore.set(this.userManager._userStoreKey, "{}");
    }

    async getRefreshTokenExpiration() {
        try {
            const token = await this.getSessionData();

            let refreshToken = '';
            if (token) {
                const values = JSON.parse(token);
                if ('refresh_token' in values) {
                    refreshToken = values.refresh_token;
                }
            }
            if (refreshToken) {
                try {
                    const refresh = jwtDecode(refreshToken) || {};
                    //if exp not specified, act as if did not expire
                    return refresh.exp || refresh.profile?.exp || Infinity;
                } catch (e) {
                    // Opaque refresh token — Google's are random strings, and
                    // nothing in OAuth2 requires a JWT here. "Not decodable" is
                    // not "expired": treat it as usable and let signinSilent ask
                    // the token endpoint, which is the only real authority. The
                    // old behaviour fell through to 0 and forced a full redirect
                    // on every renew, so such an IdP never renewed silently.
                    return Infinity;
                }
            }
        } catch (e) {
            console.warn(e);
        }
        // No refresh token at all — an interactive login is genuinely required.
        return 0;
    }

    /**
     * @param withLogout set false when just logged in
     * @param oidcUser userManager.getUser() instance (fetched dynamically if not provided),
     *    sometimes userManager.getUser() can be null if this method reacts on an event that logs in new user,
     *    in that case it is safer to send the reference directly from the event
     * @return {Promise<boolean>}
     */
    async handleUserDataChanged(withLogout = false, oidcUser = null) {
        const user = XOpatUser.instance();
        const returnNeedsRefresh = () => {
            this.userManager.stopSilentRenew();
            this._silentRenewEnabled = false;
            // NOT a logout: the identity is still known, only the credential is
            // stale. logout() wipes every secret and raises "you have been logged
            // out", which misreports a recoverable expiry as a deliberate sign-out
            // and leaves the user with no way back except a reload. The gate drops
            // the dead secrets itself and prompts on the next click.
            const auth = window.APPLICATION_CONTEXT?.auth;
            if (auth?.markNeedsInteraction && user.getIsLogged(this.userContextId)) {
                auth.markNeedsInteraction(this.userContextId || 'core', { reason: "expired" });
            } else if (this.updateXOpatUser && this._isCoreContext && user.isLogged) {
                user.logout();
            }
            return false;
        };

        oidcUser = oidcUser || await this.userManager.getUser();

        // Cached sessions can carry a still-valid refresh_token alongside an expired
        // access_token. Pushing the dead access_token to XOpatUser causes upstream APIs
        // (e.g. Google Healthcare) to reject requests. Refresh silently before use —
        // but only when (a) we're not mid-callback (init() handles those via
        // signinRedirectCallback) and (b) we actually have a refresh_token, otherwise
        // signinSilent falls back to iframe/top-redirect renewal which loops on
        // `prompt=none` → interaction_required bounces.
        const urlHasCallback = typeof window !== "undefined"
            && new URLSearchParams(window.location.search).get('state') !== null;
        const canRefreshSilently = oidcUser && oidcUser.access_token && oidcUser.expired
            && !withLogout && !this._signinProgress && !urlHasCallback
            && !!oidcUser.refresh_token;

        if (canRefreshSilently) {
            try {
                this._signinProgress = true;
                const refreshed = await this.userManager.signinSilent();
                oidcUser = refreshed || await this.userManager.getUser();
            } catch (e) {
                console.warn("OIDC: silent refresh of expired access token failed.", e);
                oidcUser = null;
            } finally {
                this._signinProgress = false;
            }
        }

        if (oidcUser && oidcUser.access_token && !oidcUser.expired) {
            if (withLogout) {
                const refreshTokenExpiration = await this.getRefreshTokenExpiration();
                if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
                    // No usable refresh token, but the ACCESS token is not expired —
                    // the normal state for an IdP that issues none at all (Google's
                    // browser PKCE flow). Declaring the session dead here threw away a
                    // working credential; it only means the next renew is interactive.
                    console.debug(`OIDC[${this.userContextId || 'core'}]: no usable refresh token; ` +
                        `the current access token stays in use until it expires.`);
                }
            }

            // This method runs as the library's awaited `userLoaded` handler, so a
            // throw from here rejects signinSilent() and is reported as a silent-renew
            // failure. Identity bookkeeping must never be able to do that.
            try {
                if (!user.getIsLogged(this.userContextId)) {
                    const profile = oidcUser.profile || {};
                    let username = [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.name || 'Unknown User';
                    const userid = profile.sub || 'anonymous';

                    user.login(userid, username, "", this.userContextId);
                }

                user.setSecret(oidcUser[this.serverTokenType] || oidcUser.access_token, "jwt", this.userContextId);
                // A credential landed: the one-shot interactive retry is available
                // again for the next time this session goes stale.
                this._releaseInteractiveRetry();
            } catch (e) {
                console.warn("OIDC: failed to sync the signed-in identity to XOpatUser.", e);
            }

            // Kick off the in-session silent-renew loop once — but only when a
            // refresh_token is available. Without one, startSilentRenew falls back
            // to iframe/redirect renewal which loops on interaction_required.
            if (!this._silentRenewEnabled && oidcUser.refresh_token) {
                this._silentRenewEnabled = true;
                this._tuneRenewWindow(oidcUser);
                this.enableEvents();
            }
            return true;
        } else {
            this.disableEvents();
            this._silentRenewEnabled = false;
            if (this.updateXOpatUser) USER_INTERFACE.Loading.text("");
        }
        return returnNeedsRefresh();
    }

    /**
     * Report the silent-renew lead time against the token's real lifetime.
     *
     * oidc-client-ts snapshots `accessTokenExpiringNotificationTimeInSeconds` when
     * UserManager is constructed (UserManagerEvents -> AccessTokenEvents), so it
     * cannot be retuned per token without writing a library-private field. When the
     * lead time is >= the lifetime, AccessTokenEvents.load() clamps the expiring
     * timer to 1s, i.e. a renew fires a second after every token load — a renewal
     * storm that looks like a login bug. Surface it with the exact knob to change.
     */
    _tuneRenewWindow(oidcUser) {
        const lifetime = Number(oidcUser && oidcUser.expires_in);
        if (!Number.isFinite(lifetime) || lifetime <= 0) return;

        const ctx = this.userContextId || 'core';
        // 60 is oidc-client-ts's DefaultAccessTokenExpiringNotificationTimeInSeconds.
        const lead = this.configuration.accessTokenExpiringNotificationTimeInSeconds ?? 60;
        console.debug(`OIDC[${ctx}]: access token lifetime ${lifetime}s, silent-renew lead ${lead}s`);

        if (lead >= lifetime) {
            console.warn(`OIDC[${ctx}]: access token lifetime (${lifetime}s) <= silent-renew lead time (${lead}s), ` +
                `so every issued token is already inside the renew window and a renew fires ~1s after each load. ` +
                `Raise the IdP access-token lifespan, or set ` +
                `modules["oidc-client-ts"].contexts.${ctx}.oidc.accessTokenExpiringNotificationTimeInSeconds ` +
                `to at most ${Math.max(1, Math.floor(lifetime / 2))}.`);
        }
    }

    disableEvents() {
        this.userManager.events.removeAccessTokenExpired(this.renewErrorHandler);
        this.userManager.events.removeSilentRenewError(this.renewErrorHandler);
        this.userManager.stopSilentRenew();
    }

    enableEvents() {
        // Preventive removal & set
        this.disableEvents();
        this.userManager.events.addAccessTokenExpired(this.renewErrorHandler);
        this.userManager.events.addSilentRenewError(this.renewErrorHandler);
        this.userManager.startSilentRenew();
    }

    /**
     * Hand an expired context to the core recovery gate, which prompts the user
     * on their next click (the only moment a popup is allowed to open).
     *
     * A failed RENEW is not evidence about the token in hand. While the current
     * credential still works we report it — core remembers it and promotes it the
     * moment the credential dies — but we do NOT tear down the renew loop or claim
     * the session expired: a later attempt may well succeed, and blocking the user
     * over a working session is the worse error. Only a credential that is actually
     * gone stops the loop.
     */
    _reportNeedsInteraction(error) {
        const ctx = this.userContextId || 'core';
        const reason = error?.error || error?.name || "expired";
        const user = XOpatUser.instance();
        const credentialAlive = !!(user.getIsLogged(this.userContextId) && user.getSecret("jwt", this.userContextId));

        if (credentialAlive) {
            console.debug(`OIDC[${ctx}]: renewal needs an interactive login (${reason}), but the current ` +
                `credential still works — reporting without interrupting the session.`);
        } else {
            console.debug(`OIDC[${ctx}]: session needs an interactive login (${reason}).`);
            this.disableEvents();
            this._silentRenewEnabled = false;
        }

        const auth = window.APPLICATION_CONTEXT?.auth;
        if (auth?.markNeedsInteraction) {
            // Never `force`: this side has no proof the credential is unusable — a
            // 401 from the protected resource is what carries that proof.
            auth.markNeedsInteraction(ctx, { reason });
        } else if (!credentialAlive) {
            // No core gate (older core): fall back to the old visible failure
            // rather than expiring silently.
            Dialogs.show(`Your ${this.serviceName} session expired. Please reload to sign in again.`,
                20000, Dialogs.MSG_WARN);
        }
    }

    /**
     * `err` is what the library raises (`_raiseSilentRenewError(e)`); the
     * `accessTokenExpired` timer raises nothing, hence the undefined case.
     */
    renewErrorHandler = async (err) => {
        const user = XOpatUser.instance();
        // Gate on THIS context: a sub-context renew must not depend on core login state.
        if (!user.getIsLogged(this.userContextId) || this._connectionRetries > this.maxRetryCount) {
            this.disableEvents();
            return;
        }

        // An IdP that wants a human will keep wanting one — retrying silently
        // just burns 10 s per iframe timeout and ends in a bogus "unknown
        // reasons" error. Go straight to the gate.
        if (OIDCAuthClient.needsUserInteraction(err)) {
            this._reportNeedsInteraction(err);
            return;
        }

        this._connectionRetries++;

        // Otherwise it looks transient. Retry silently: a renew has no user
        // gesture behind it, so window.open would be blocked ('disposed window').
        if (this._connectionRetries <= this.maxRetryCount) {
            console.debug('Silent renew failed. Retrying silently.');
            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.NEVER, true);
            return;
        }

        // Retries exhausted — treat it as expired and let the user fix it with a
        // click, instead of a gesture-less popup that the browser will block.
        this._reportNeedsInteraction(err);
    }
}