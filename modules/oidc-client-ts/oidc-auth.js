oidc.xOpatUser = class extends XOpatModuleSingleton {;

    //todo test when the user closed auth without signin
    constructor() {
        super("oidc-client-ts");

        this._signinProgress = false;
        this.configuration = this.getStaticMeta('oidc', {});
        this._connectionRetries = 0;
        this.maxRetryCount = this.getStaticMeta('errorLoginRetry', 2);
        this.extraSigninRequestArgs = this.getStaticMeta('extraSigninRequestArgs', undefined);
        this.usesStore = this.getStaticMeta('usesStore', true);
        this.retryTimeout = this.getStaticMeta('retryTimeout', 20) * 1000;
        this.authMethod = this.getStaticMeta('method', 'redirect');

        if (!this.configuration.authority || !this.configuration.client_id || !this.configuration.scope) {
            console.warn("OIDC Module not properly configured. Auth disabled.");
            return;
        }

        // Overwrite some properties we don't want to allow for modification
        this.configuration.redirect_uri = this.configuration.redirect_uri
            || window.location.href.split('#')[0].split('?')[0];

        this.configuration.post_logout_redirect_uri = this.configuration.post_logout_redirect_uri
            || APPLICATION_CONTEXT.env.gateway || this.configuration.redirect_uri;

        this.configuration.automaticSilentRenew = false;
        this.configuration.storeState = this.configuration.userStore = undefined;

        VIEWER_MANAGER.addHandler('before-first-open', this.init.bind(this),
            null, this.getStaticMeta('eventBeforeOpenPriority', 0));
    }

    // Returns promise resolved when login either handled or dismissed
    init() {
        //prevents from firing & executing if login handled elsewhere
        const user = XOpatUser.instance();
        if (user.isLogged) {
            console.info("OIDC Module not executed: User already logged in.", user);
            return;
        }

        // NOTE! Cookies storage limits size to 4096B, which is easily exceeded here!
        let store;
        switch (this.usesStore) {
            case "cookie":
                store = APPLICATION_CONTEXT.AppCookies.getStore();
                break;
            case "cache":
                store = APPLICATION_CONTEXT.AppCache.getStore();
                break;
            case "local":
                // Not very safe, but in case the session is too big the cookie store fails to store it
                store = localStorage;
                break;
            case "default":
                store = sessionStorage;
                break;
            default:
                console.warn("OIDC: Invalid usesStore!");
                store = sessionStorage;
                break;
        }
        if (store) {
            this.configuration.userStore = new oidc.WebStorageStateStore({store: store});
            this.configuration.stateStore = new oidc.WebStorageStateStore({store: store});
        }

        //Create OIDC User Manager
        this.userManager = new oidc.UserManager(this.configuration);
        this.userManager.events.addUserLoaded((user) => {
            return this.handleUserDataChanged(false, user);
        });

        //Resolve once we know if we handle login
        let resolves = null;
        return new Promise(async (resolve, reject) => {
            try {
                resolves = () => {
                    resolve();
                    resolves = null;
                };
                //try if we can cache-load the user info...
                if (!await this.handleUserDataChanged()) {
                    const urlParams = new URLSearchParams(window.location.search);
                    if (urlParams.get('state') !== null) {

                        const url = window.location.href;
                        if (this.authMethod === "popup") {
                            await this.userManager.signinPopupCallback(url);
                        } else {
                            // In redirection, clean up URL to not to contain auth data -> might cause invalid auth loop
                            // but preserve other possible query args
                            urlParams.delete("state");
                            urlParams.delete("session_state");
                            urlParams.delete("iss");
                            urlParams.delete("code");
                            window.history.replaceState({},
                                window.document.title, window.location.origin + window.location.pathname + urlParams.toString());
                            await this.userManager.signinRedirectCallback(url);
                        }
                        resolves && resolves();
                        return;
                    }
                    await this._trySignIn(oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY);
                }
                resolves && resolves();
            } catch (e) {
                console.warn(e);
                reject(e);
            }
        }).catch(e => {
            //Error not handled considered as login abort
            //todo consider user-login-fail handler (dialog / action redirect...)
            console.warn("OIDC Aborted user login. Reason:", e);
        });
    }

    /**
     * Method meant for manual sign-in. Can interact with automated sign-in routine & retries.
     */
    signIn() {
        this._manualCoroutine = new Promise(async (resolve) => {
            await this._trySignIn(oidc.xOpatUser.SignInUserInteraction.ALWAYS, true);
            this._manualCoroutine = null;
            resolve();
        });
    }

    async _trySignIn(allowUserPrompt = oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY, preventRecurse = false) {
        if (this._signinProgress) return false;

        // Do not perform renew if we try manually for any reason (e.g. user action)
        this.userManager.stopSilentRenew();

        this._connectionRetries++;
        try {
            this._signinProgress = true;
            const { ALWAYS, IF_NECESSARY } = oidc.xOpatUser.SignInUserInteraction;

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
            error.message = error.message || "";
            if (error.message.includes('Failed to fetch')) {
                console.debug('OIDC: Signin failed due to connection issues. Retrying in 20 seconds.');
                return await this._safeRetrySignIn('Failed to login, retrying in 20 seconds.',
                    'Retry now.', preventRecurse);
            }
            if (error.message.includes('disposed window')) {
                console.debug('OIDC: Signin failed due to popup window blocking.');
                return await this._safeRetrySignIn('Login requires opening a popup window. Please, allow popup window in your browser.',
                    'Retry now.', true);
            }
            if (error.message.includes('closed by user')) {
                console.debug('OIDC: Signin failed due to user cancel.');
                Dialogs.show('You need to login to access the viewer. <a onclick="oidc.xOpatUser.instance()._trySignIn(oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY, true, true); Dialogs.hide();">Retry now</a>.',
                    300000, Dialogs.MSG_WARN);
                await this.handleUserDataChanged(true);
                return;
            }
            if (error.message.includes('Invalid refresh token')) {
                await this.clearSession();
                return this._trySignIn(oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY, this._connectionRetries > this.maxRetryCount);
            }

            Dialogs.show('Login failed due to unknown reasons. Please, <a onclick="oidc.xOpatUser.instance()._trySignIn(oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY, true, true); Dialogs.hide();">try again</a> or notify us about the issue.',
                this.retryTimeout + 2000, Dialogs.MSG_ERR);
            console.error("OIDC auth attempt: ", error);
            await this.handleUserDataChanged(true);
            return;
        }
    };

    async _safeRetrySignIn(message, retryMessage, preventRecurse) {
        let resolved, dialogWait = new Promise((resolve) => resolved = resolve);
        Dialogs.show(`${message} <a onclick="oidc.xOpatUser.instance().signIn(); Dialogs.hide();">${retryMessage}</a>`,
            this.retryTimeout, Dialogs.MSG_WARN, {onHide: resolved});
        await dialogWait;

        if (!this._manualCoroutine) {
            if (!preventRecurse) {
                return await this._trySignIn(oidc.xOpatUser.SignInUserInteraction.NEVER, this._connectionRetries >= this.maxRetryCount);
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
                const refresh = jwtDecode(refreshToken);
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
            if (user.isLogged) {
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

            if (!user.isLogged) {
                USER_INTERFACE.Loading.text("Logged in.");
                const decodedToken = jwtDecode(oidcUser.access_token);

                if (!decodedToken?.exp || decodedToken.exp < Date.now() / 1000) {
                    return returnNeedsRefresh();
                }

                const endpoint = this.getStaticMeta('oidcUserInfo');

                if (endpoint && (!decodedToken.family_name || !decodedToken.given_name)) {
                    try {
                        const data = await (await fetch(endpoint, {
                            headers: {
                                'Authorization': `Bearer ${oidcUser.access_token}`,
                                'Content-Type': 'application/json'
                            }
                        })).json();

                        decodedToken.given_name = decodedToken.given_name || data.given_name;
                        decodedToken.family_name = decodedToken.family_name || data.family_name;
                    } catch (e) {
                        console.error("OIDC: Could not fetch user info!", e);
                    }
                }

                const username = decodedToken.given_name + ' ' + decodedToken.family_name;
                const userid = decodedToken.sub;
                user.login(userid, username, "");

                user.addHandler('secret-needs-update', async event => {
                    if (event.type === "jwt") {
                        await this._trySignIn(oidc.xOpatUser.SignInUserInteraction.NEVER, true);
                    }
                });
                this.enableEvents();
            }
            user.setSecret(oidcUser.access_token, "jwt");
            return true;
        } else {
            this.disableEvents();
            USER_INTERFACE.Loading.text("");
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
        console.debug("RENEW ERROR HANDLER");
        if (!user.isLogged || this._connectionRetries > this.maxRetryCount) {
            this.disableEvents();
            return;
        }
        console.debug('Silent renew failed. Retrying with signin.');
        // Note: we must set popup in order to not to lose the current workspace
        this.authMethod = 'popup';
        this._connectionRetries++;
        await this._trySignIn(oidc.xOpatUser.SignInUserInteraction.IF_NECESSARY);
    }
}
oidc.xOpatUser.SignInUserInteraction = {
    NEVER: 'NEVER',
    IF_NECESSARY: 'IF_NECESSARY',
    ALWAYS: 'ALWAYS'
}
oidc.xOpatUser.instance(); //todo consider just executing private code...
