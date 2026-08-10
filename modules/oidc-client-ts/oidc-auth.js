window.OIDCAuthClient = class OIDCAuthClient {

    static SignInUserInteraction = {
        NEVER: 'NEVER',
        IF_NECESSARY: 'IF_NECESSARY',
        ALWAYS: 'ALWAYS'
    };

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
        let store;
        switch (this.usesStore) {
            case "cookie": store = APPLICATION_CONTEXT.AppCookies.getStore(); break;
            case "cache": store = APPLICATION_CONTEXT.AppCache.getStore(); break;
            case "local": store = localStorage; break;
            case "default": store = sessionStorage; break;
            default: store = sessionStorage; break;
        }
        if (store) {
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
        }
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
     * Idempotent: XOpatAuth drops its own init memo when a real broker supersedes
     * a fallback, so broker.init() can run twice against this same cached client.
     * A second pass would re-enter signinRedirectCallback on an already-consumed
     * `state` and fail the login.
     */
    async init() {
        return this._initPromise ??= this._doInit();
    }

    async _doInit() {
        if (this.updateXOpatUser) {
            const user = XOpatUser.instance();
            if (user.isLogged) {
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
                    const returningState = urlParams.get('state');
                    // Only OUR callback. Every context sees the same returning URL
                    // (redirect_uri defaults to the bare page URL), so without this
                    // probe a sibling context would consume the state entry — and
                    // the library's lookup deletes before it validates ownership,
                    // which fails BOTH logins. Skipping here lets the context that
                    // did not start the flow fall through to its normal lazy path.
                    if (returningState !== null && await this._ownsSigninState(returningState)) {
                        const url = window.location.href;
                        if (this.authMethod === "popup") {
                            await this.userManager.signinPopupCallback(url);
                        } else {
                            urlParams.delete("state");
                            urlParams.delete("session_state");
                            urlParams.delete("iss");
                            urlParams.delete("code");
                            const rest = urlParams.toString();
                            window.history.replaceState({}, window.document.title,
                                window.location.origin + window.location.pathname + (rest ? `?${rest}` : ""));
                            await this.userManager.signinRedirectCallback(url);
                        }
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

    signIn() {
        this._manualCoroutine = new Promise(async (resolve) => {
            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.ALWAYS, true);
            this._manualCoroutine = null;
            resolve();
        });
    }

    async _trySignIn(allowUserPrompt = OIDCAuthClient.SignInUserInteraction.IF_NECESSARY, preventRecurse = false) {
        if (this._signinProgress) return false;

        // Do not perform renew if we try manually for any reason (e.g. user action)
        this.userManager.stopSilentRenew();

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
                const refresh = jwtDecode(refreshToken) || {};
                //if exp not specified, act as if did not expire
                return refresh.exp || refresh.profile?.exp || Infinity;
            }
        } catch (e) {
            console.warn(e);
        }
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
            if (this.updateXOpatUser && this._isCoreContext && user.isLogged) {
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
                    return returnNeedsRefresh();
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

    renewErrorHandler = async () => {
        const user = XOpatUser.instance();
        // Gate on THIS context: a sub-context renew must not depend on core login state.
        if (!user.getIsLogged(this.userContextId) || this._connectionRetries > this.maxRetryCount) {
            this.disableEvents();
            return;
        }
        this._connectionRetries++;

        // Retry silently first. Escalating straight to an interactive flow is wrong
        // here: a renew has no user gesture behind it, so window.open is blocked
        // ('disposed window') — and the old code left authMethod = 'popup' set
        // permanently, breaking every later login (see AUTH.md, boot must redirect).
        if (this._connectionRetries <= this.maxRetryCount) {
            console.debug('Silent renew failed. Retrying silently.');
            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.NEVER, true);
            return;
        }

        console.debug('Silent renew failed. Retrying with interactive signin.');
        // Popup, not redirect, so the current workspace is not lost — scoped to
        // this attempt only.
        const previousAuthMethod = this.authMethod;
        this.authMethod = 'popup';
        try {
            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY);
        } finally {
            this.authMethod = previousAuthMethod;
        }
    }
}