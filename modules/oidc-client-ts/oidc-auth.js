oidc.xOpatUser = class extends XOpatModuleSingleton {

    //todo test when the user closed auth without signin
    constructor() {
        super("oidc-client-ts");

        this.configuration = this.getStaticMeta('oidc', {});
        this.forceToken = this.getStaticMeta('forceUseToken', false);
        this._connectionRetries = 0;
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
        return returns;
    }

    sleep(time) {
        return new Promise(_ => setTimeout(_, time));
    }

    //todo verify args if n
    async trySignIn(allowUserPrompt = false, preventRecurse = false, firedManually = false) {
        this._connectionRetries++;
        try {
            if (allowUserPrompt) {
                const refreshTokenExpiration = this.getRefreshTokenExpiration();
                if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
                    console.log("OIDC: Try to sign in via popup.");
                    await this.userManager.signinPopup({
                        popupWindowFeatures: {
                        }
                    });
                } else {
                    console.log("OIDC: Signing silently: refresh token available.");
                    await this.userManager.signinSilent();
                }
            } else {
                console.log("OIDC: Signing silently..");
                await this.userManager.signinSilent();
            }

            await this.handleUserDataChanged();
            this._connectionRetries = 0;
        } catch (error) {
            if (firedManually) {
                console.error("OIDC: ", error);
                return;
            }
            if (error.message.includes('Failed to fetch')) {
                console.log('OIDC: Signin failed due to connection issues. Retrying in 20 seconds.');
                if (!preventRecurse) {
                    Dialogs.show('Failed to login, retrying in 20 seconds. <a onclick="oidc.xOpatUser.instance().trySignIn(true, true, true);">Retry now</a>.',
                        20000, Dialogs.MSG_WARN);
                    await this.sleep(20000);
                    await this.trySignIn(false, this._connectionRetries > 5);
                } else {
                    //todo redirect to page
                    console.error("OIDC: MAX retry exceeded");
                }
            }
            console.error("OIDC auth attempt: ", error);
        }
    };

    getRefreshTokenExpiration() {
        // Key used:
        //oidc.user:<authority>:<client>
        let refreshToken = '';
        // const token = APPLICATION_CONTEXT.AppCookies
        //     .get(`oidc.user:${this.configuration.authority}:${this.clientId}`);
        const token = sessionStorage.getItem(`oidc.user:${this.configuration.authority}:${this.clientId}`);
        try {
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

    setupTrafficInterception() {
        if (this.server) return;

        this.server = new pollyjs.Polly('xopat', {
            adapters: [pollyjs.XHRAdapter, pollyjs.FetchAdapter],
            persister: pollyjs.NoPersister
        }).server;
        const user = XOpatUser.instance();
        const interceptor = (req, res) => {
            if (user.secret && (this.forceToken || !req.headers['Authorization'])) {
                req.headers['Authorization'] = user.secret;
            }
        };
        this.server.any().on('request', interceptor);
    }

    async handleUserDataChanged() {
        const user = XOpatUser.instance();

        const oidcUser = await this.userManager.getUser();
        if (oidcUser && oidcUser.access_token) {
            user.secret = oidcUser.access_token;
            if (!user.isLogged) {
                const decodedToken = jwtDecode(oidcUser.access_token);
                const username = decodedToken.given_name + ' ' + decodedToken.family_name;
                const userid = decodedToken.sub;
                user.login(userid, username, "");
                this.setupTrafficInterception();
                user.addOnceHandler('logout', () => {

                    //todo should also notify user about leaving page :/
                    this.userManager.signoutRedirect();
                });
            }
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
