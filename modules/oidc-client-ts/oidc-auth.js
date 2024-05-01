oidc.xOpatUser = class extends XOpatModuleSingleton {

    //todo test when the user closed auth without signin
    constructor() {
        super("oidc-client-ts");

        this.configuration = this.getStaticMeta('oidc', {});
        this._connectionRetries = 0;
        this.maxRetryCount = this.getStaticMeta('errorLoginRetry', 2);
        this.retryTimeout = this.getStaticMeta('retryTimeout', 20) * 1000;

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
            // todo use cookies
            //stateStore: new oidc.WebStorageStateStore({ store: APPLICATION_CONTEXT.AppCookies.getStore() })
        });

        //Resolve once we know if we handle login
        let resolves = null;
        const returns = new Promise(async (resolve, reject) => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                resolves = () => {
                    resolve();
                    resolves = null;
                };

                //try if we can cache-load the user info...
                if (!await this.handleUserDataChanged()) {
                    if (urlParams.get('state') !== null) {
                        return (async () => {
                            await this.userManager.signinPopupCallback(window.location.href);
                            await this.handleUserDataChanged();
                        })();
                    } else {
                        await this.trySignIn(true);
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
            await this.trySignIn();
        };
        this.userManager.events.addSilentRenewError(renewError);
        this.userManager.events.addAccessTokenExpiring(() => this.trySignIn(false, true));
        this.userManager.events.addAccessTokenExpired(() => this.trySignIn(false, true));
        // TODO: this makes infinite reload :/
        // window.addEventListener("focus", e =>
        //     this._signInUserInteractive(this.getRefreshTokenExpiration(), false), false);
        return returns;
    }

    sleep(time) {
        return new Promise(_ => setTimeout(_, time));
    }

    async trySignIn(allowUserPrompt = false, preventRecurse = false, firedManually = false) {
        this._connectionRetries++;
        try {
            const refreshTokenExpiration = this.getRefreshTokenExpiration();
            // attempt login automatically if refresh token expiration set but outdated
            allowUserPrompt = allowUserPrompt || refreshTokenExpiration;
            if (allowUserPrompt) {
                await this._signInUserInteractive(refreshTokenExpiration);
            } else {
                console.log("OIDC: Signing silently..");
                await this.userManager.signinSilent();
            }
            await this.handleUserDataChanged();
            this._connectionRetries = 0;
        } catch (error) {
            if (firedManually) {
                console.error("OIDC: ", error);
                Dialogs.show('Login failed due to unknown reasons. Please, notify us about the issue.',
                    this.retryTimeout + 2000, Dialogs.MSG_ERR);
                return;
            }
            if (typeof error === "string") error = {message: error};
            error.message = error.message || "";
            if (error.message.includes('Failed to fetch')) {
                console.log('OIDC: Signin failed due to connection issues. Retrying in 20 seconds.');
                Dialogs.show('Failed to login, retrying in 20 seconds. <a onclick="oidc.xOpatUser.instance().trySignIn(true, true, true); Dialogs.hide();">Retry now</a>.',
                    this.retryTimeout + 2000, Dialogs.MSG_WARN);
                if (!preventRecurse) {
                    await this.sleep(this.retryTimeout);
                    await this.trySignIn(false, this._connectionRetries >= this.maxRetryCount);
                } else {
                    console.error("OIDC: MAX retry exceeded");
                }
            } else if (error.message.includes('disposed window')) {
                console.log('OIDC: Signin failed due to popup window blocking.');
                Dialogs.show('Login requires opening a popup window. Please, allow popup window in your browser. <a onclick="oidc.xOpatUser.instance().trySignIn(true, true, true); Dialogs.hide();">Retry now</a>.',
                    this.retryTimeout + 2000, Dialogs.MSG_WARN);
                if (!preventRecurse) {
                    await this.sleep(this.retryTimeout);
                    await this.trySignIn(false, this._connectionRetries > this.maxRetryCount);
                } else {
                    console.error("OIDC: MAX retry exceeded");
                }
            } else if (error.message.includes('closed by user')) {
                console.log('OIDC: Signin failed due to user cancel.');
                Dialogs.show('You need to login to access the viewer. <a onclick="oidc.xOpatUser.instance().trySignIn(true, true, true); Dialogs.hide();">Retry now</a>.',
                    300000, Dialogs.MSG_WARN);
            } else {
                Dialogs.show('Login failed due to unknown reasons. Please, notify us about the issue.',
                    this.retryTimeout + 2000, Dialogs.MSG_ERR);
            }
            console.error("OIDC auth attempt: ", error);
        }
    };

    //returns true if no user interaction required
    async _signInUserInteractive(refreshTokenExpiration, alwaysSignIn=true) {
        if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
            // window.open(this.configuration.redirect_uri, 'xopat-auth');
            console.log("OIDC: Try to sign in via popup.");
            // await this.sleep(100);
            await this.userManager.signinPopup({
                popupWindowFeatures: {
                    popupWindowTarget: "xopat-auth",
                    popup: "no"
                }
            });
            return false;
        }
        if (alwaysSignIn) {
            console.log("OIDC: Signing silently: refresh token available.");
            await this.userManager.signinSilent();
        }
        return true;
    }

    getSessionData() {
        return sessionStorage.getItem(`oidc.user:${this.configuration.authority}:${this.clientId}`);
    }

    getRefreshTokenExpiration() {
        // Key used:
        //oidc.user:<authority>:<client>
        try {
            const token = this.getSessionData();
            // const token = APPLICATION_CONTEXT.AppCookies
            //     .get(`oidc.user:${this.configuration.authority}:${this.clientId}`);
            let refreshToken = '';
            if (token) {
                const values = JSON.parse(token);
                if ('refresh_token' in values) {
                    refreshToken = values.refresh_token;
                }
            } else {
                //todo consume refresh token from cookies if available
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

    async handleUserDataChanged() {
        const user = XOpatUser.instance();

        const oidcUser = await this.userManager.getUser();
        if (oidcUser && oidcUser.access_token) {
            if (!user.isLogged) {
                const decodedToken = jwtDecode(oidcUser.access_token);
                //todo: try to check more props to get the best username
                const username = decodedToken.given_name + ' ' + decodedToken.family_name;
                const userid = decodedToken.sub;
                user.login(userid, username, "");
                user.addOnceHandler('logout', () => {
                    //todo should also notify user about leaving page :/
                    this.userManager.signoutRedirect();
                });
                user.addHandler('secret-needs-update', async event => {
                    if (event.type === "jwt") {
                        await this.trySignIn(false, true);
                    }
                });
            }
            user.setSecret(oidcUser.access_token, "jwt");
            return true;
        }
        if (user.isLogged) {
            user.logout();
            return true;
        }
        return false;
    }
}
oidc.xOpatUser.instance(); //todo consider just executing private code...
