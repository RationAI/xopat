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
            this.configuration.userStore = new oidc.WebStorageStateStore({store: store});
            this.configuration.stateStore = new oidc.WebStorageStateStore({store: store});
        }
    }

    async init() {
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
                    if (urlParams.get('state') !== null) {
                        const url = window.location.href;
                        if (this.authMethod === "popup") {
                            await this.userManager.signinPopupCallback(url);
                        } else {
                            urlParams.delete("state");
                            urlParams.delete("session_state");
                            urlParams.delete("iss");
                            urlParams.delete("code");
                            window.history.replaceState({}, window.document.title, window.location.origin + window.location.pathname + urlParams.toString());
                            await this.userManager.signinRedirectCallback(url);
                        }
                        resolves && resolves();
                        return;
                    }
                    await this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY);
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
            if (this.updateXOpatUser && this.userContextId === undefined && user.isLogged) {
                user.logout();
            }
            return false;
        };

        oidcUser = oidcUser || await this.userManager.getUser();
        if (oidcUser && oidcUser.access_token) {
            if (withLogout) {
                const refreshTokenExpiration = await this.getRefreshTokenExpiration();
                if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
                    return returnNeedsRefresh();
                }
            }

            if (!user.getIsLogged(this.userContextId)) {
                const profile = oidcUser.profile || {};
                let username = [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.name || 'Unknown User';
                const userid = profile.sub || 'anonymous';

                user.login(userid, username, "", this.userContextId);

                // Register refresh handler only once
                if (!this._handlerRegistered) {
                    user.addHandler(user.getEventName('secret-needs-update', this.userContextId), async event => {
                        if (event.type === "jwt") {
                            await this._trySignIn(OIDCAuthClient.SignInUserInteraction.NEVER, true);
                        }
                    });
                    this._handlerRegistered = true;
                }
            }

            user.setSecret(oidcUser.access_token, "jwt", this.userContextId);
            return true;
        } else {
            this.disableEvents();
            if (this.updateXOpatUser) USER_INTERFACE.Loading.text("");
        }
        return returnNeedsRefresh();
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
        if (!user.isLogged || this._connectionRetries > this.maxRetryCount) {
            this.disableEvents();
            return;
        }
        console.debug('Silent renew failed. Retrying with signin.');
        // Note: we must set popup in order to not to lose the current workspace
        this.authMethod = 'popup';
        this._connectionRetries++;
        await this._trySignIn(OIDCAuthClient.SignInUserInteraction.IF_NECESSARY);
    }
}