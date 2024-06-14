oidc.xOpatUser = class extends XOpatModuleSingleton {

    //todo test when the user closed auth without signin
    constructor() {
        super("oidc-client-ts");

        this._signinProgress = false;
        this.configuration = this.getStaticMeta('oidc', {});
        this._connectionRetries = 0;
        this.maxRetryCount = this.getStaticMeta('errorLoginRetry', 2);
        this.retryTimeout = this.getStaticMeta('retryTimeout', 20) * 1000;
        this.authMethod = this.getStaticMeta('method', 'popup');
        this.cookieRefreshTokenName = this.getStaticMeta('cookieRefreshTokenName');

        if (!this.configuration.authority || !this.configuration.client_id || !this.configuration.scope) {
            console.warn("OIDC Module not properly configured. Auth disabled.");
            return;
        }

        this.configuration.redirect_uri = this.configuration.redirect_uri
            || window.location.href.split('#')[0].split('?')[0];

        this.configuration.post_logout_redirect_uri = this.configuration.post_logout_redirect_uri
            || APPLICATION_CONTEXT.env.gateway || this.configuration.redirect_uri;

        VIEWER.addHandler('before-first-open', this.init.bind(this),
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

        //Create OIDC User Manager
        this.userManager = new oidc.UserManager({
            ...this.configuration,
            userStore: new oidc.WebStorageStateStore({ store: APPLICATION_CONTEXT.AppCookies.getStore() }),
        });

        //Resolve once we know if we handle login
        let resolves = null;
        const returns = new Promise(async (resolve, reject) => {
            try {
                resolves = () => {
                    resolve();
                    resolves = null;
                };
                //try if we can cache-load the user info...
                if (!await this.handleUserDataChanged()) {
                    const urlParams = new URLSearchParams(window.location.search);
                    if (urlParams.get('state') !== null) {

                        if (this.authMethod === "popup") {
                            await this.userManager.signinPopupCallback(window.location.href);
                        } else {
                            await this.userManager.signinRedirectCallback(window.location.href);
                            await this.handleUserDataChanged(false);
                        }
                        resolves && resolves();
                        return;
                    }

                    if (! await this.tryManualSignInCookie()) {
                        this.userManager.events.addAccessTokenExpiring(() => this._trySignIn(false, true));
                        this.userManager.events.addAccessTokenExpiring(() => this._trySignIn(false, true));
                        this.userManager.events.addAccessTokenExpired(() => this._trySignIn(false, true));
                        await this._trySignIn(true);
                    }
                }
                resolves && resolves();
            } catch (e) {
                reject(e);
            }
        }).catch(e => {
            //Error not handled considered as login abort
            //todo consider user-login-fail handler (dialog / action redirect...)
            console.log("OIDC Aborted user login. Reason:", e);
        });

        const renewError = async () => {
            const user = XOpatUser.instance();
            if (!resolves && !user.isLogged) {
                this.userManager.events.removeSilentRenewError();
                return;
            }
            console.log('Silent renew failed. Retrying with signin.');
            await this._trySignIn();
        };
        this.userManager.events.addSilentRenewError(renewError);
        // TODO: this makes infinite reload :/
        // window.addEventListener("focus", e =>
        //     this._signInUserInteractive(this.getRefreshTokenExpiration(), false), false);
        return returns;
    }

    async tryManualSignInCookie() {
        const cookie = this.cookieRefreshTokenName &&
            APPLICATION_CONTEXT.AppCookies.get(this.cookieRefreshTokenName, false);
        if (cookie) {
            const metadataService = this.userManager.metadataService;
            const tokenEndpoint = await metadataService.getTokenEndpoint();

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: cookie,
                    client_id: this.configuration.client_id,
                    client_secret: this.configuration.client_secret
                })
            });
            // Used token is invalidated
            APPLICATION_CONTEXT.AppCookies.delete(this.cookieRefreshTokenName);

            const data = await response.json();
            if (data.access_token) {
                await this.userManager.storeUser(new oidc.User({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_in: data.expires_in,
                    token_type: 'Bearer'
                }));
                APPLICATION_CONTEXT.AppCookies.set(this.cookieRefreshTokenName, data.refresh_token);
                return await this.handleUserDataChanged(false);
            }
            console.warn('OIDC: Failed to log in user via cookie refresh token', data);
            return false;
        }
    }

    /**
     * Method meant for manual sign-in. Can interact with automated sign-in routine & retries.
     */
    signIn() {
        this._manualCoroutine = new Promise(async (resolve) => {
            await this._trySignIn(true, true);
            this._manualCoroutine = null;
            resolve();
        });
    }

    async _trySignIn(allowUserPrompt = false, preventRecurse = false) {
        if (this._signinProgress) return;

        this._connectionRetries++;
        try {
            this._signinProgress = true;
            const refreshTokenExpiration = this.getRefreshTokenExpiration();
            // attempt login automatically if refresh token expiration set but outdated
            allowUserPrompt = allowUserPrompt || refreshTokenExpiration;
            if (allowUserPrompt) {
                await this._signInUserInteractive(refreshTokenExpiration);
            } else {
                USER_INTERFACE.Loading.text("Attempting to log in...");
                console.log("OIDC: Signing silently..");
                await this.userManager.signinSilent();
            }
            // TODO singing might fail here, e.g. refresh token not issued... maybe do not log out user
            await this.handleUserDataChanged(false);
            this._connectionRetries = 0;
            this._signinProgress = false;

        } catch (error) {
            this._signinProgress = false;
            USER_INTERFACE.Loading.text("Login not successful! Waiting...");
            if (typeof error === "string") error = {message: error};
            error.message = error.message || "";
            if (error.message.includes('Failed to fetch')) {
                console.log('OIDC: Signin failed due to connection issues. Retrying in 20 seconds.');
                await this._safeRetrySignIn('Failed to login, retrying in 20 seconds.',
                    'Retry now.', preventRecurse);
            } else if (error.message.includes('disposed window')) {
                console.log('OIDC: Signin failed due to popup window blocking.');
                await this._safeRetrySignIn('Login requires opening a popup window. Please, allow popup window in your browser.',
                    'Retry now.', preventRecurse);
            } else if (error.message.includes('Popup closed by user')) {
                Dialogs.show('You need to login to access the viewer. <a onclick="oidc.xOpatUser.instance()._trySignIn(true, true, true); Dialogs.hide();">Log-in in a new window</a>.',
                    300000, Dialogs.MSG_WARN);
            } else if (error.message.includes('closed by user')) {
                console.log('OIDC: Signin failed due to user cancel.');
                Dialogs.show('You need to login to access the viewer. <a onclick="oidc.xOpatUser.instance()._trySignIn(true, true, true); Dialogs.hide();">Retry now</a>.',
                    300000, Dialogs.MSG_WARN);
            } else if (error.message.includes('Invalid refresh token')) {
                return await this._trySignIn(false, this._connectionRetries > this.maxRetryCount);
            } else {
                Dialogs.show('Login failed due to unknown reasons. Please, <a onclick="oidc.xOpatUser.instance()._trySignIn(true, true, true); Dialogs.hide();">try again</a> or notify us about the issue.',
                    this.retryTimeout + 2000, Dialogs.MSG_ERR);
            }
            console.error("OIDC auth attempt: ", error);
        }
    };

    async _safeRetrySignIn(message, retryMessage, preventRecurse) {
        let resolved, dialogWait = new Promise((resolve) => resolved = resolve);
        Dialogs.show(`${message} <a onclick="oidc.xOpatUser.instance().signIn(); Dialogs.hide();">${retryMessage}</a>`,
            this.retryTimeout, Dialogs.MSG_WARN, {onHide: resolved});
        await dialogWait;
        if (this._manualCoroutine) await this._manualCoroutine;
        if (!preventRecurse) {
            await this._trySignIn(false, this._connectionRetries >= this.maxRetryCount);
        } else {
            console.error("OIDC: MAX retry exceeded");
        }
    }

    //returns true if no user interaction required
    async _signInUserInteractive(refreshTokenExpiration, alwaysSignIn=true) {
        if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
            USER_INTERFACE.Loading.text("Login required: waiting for login...");
            // window.open(this.configuration.redirect_uri, 'xopat-auth');
            const signIn = this.authMethod === "popup" ? "signinPopup" : "signinRedirect";
            const configuration = this.authMethod === "popup" ? {
                popupWindowFeatures: {
                    popup: "no", //open new tab instead of popup window
                    closePopupWindowAfterInSeconds: -1
                },
                popupWindowTarget: "xopat-auth",
            } : undefined;
            console.log(`OIDC: Try to sign in via ${this.authMethod}.`);
            await this.userManager[signIn](configuration);
            return false;
        }
        if (alwaysSignIn) {
            console.log("OIDC: Signing silently: refresh token available.");
            await this.userManager.signinSilent();
        }
        return true;
    }

    getSessionData() {
        // Key used:  oidc.user:<authority>:<client>
        return APPLICATION_CONTEXT.AppCookies
             .get(`oidc.user:${this.configuration.authority}:${this.configuration.client_id}`);
        //return sessionStorage.getItem(`oidc.user:${this.configuration.authority}:${this.configuration.client_id}`);
    }

    getRefreshTokenExpiration() {
        try {
            const token = this.getSessionData();

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

    async handleUserDataChanged(withLogout = true) {
        const user = XOpatUser.instance();
        function returnNeedsRefresh() {
            if (user.isLogged) {
                user.logout();
            }
            return false;
        }

        const oidcUser = await this.userManager.getUser();
        if (oidcUser && oidcUser.access_token) {

            if (withLogout){
                const refreshTokenExpiration = this.getRefreshTokenExpiration();
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

                if (endpoint && (!decodedToken.family_name) || (!!decodedToken.given_name)) {
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
                user.addOnceHandler('logout', () => {
                    Dialogs.show('You have been logged out. Please, <a onclick="UTILITIES.refreshPage()">log-in</a> again.',
                        50000, Dialogs.MSG_ERR);
                });
                user.addHandler('secret-needs-update', async event => {
                    if (event.type === "jwt") {
                        await this._trySignIn(false, true);
                    }
                });
            }
            user.setSecret(oidcUser.access_token, "jwt");
            return true;
        } else {
            USER_INTERFACE.Loading.text("Failed to log in.");
        }
        return returnNeedsRefresh();
    }
}
oidc.xOpatUser.instance(); //todo consider just executing private code...
