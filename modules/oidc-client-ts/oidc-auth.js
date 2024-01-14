oidc.xOpatUser = class extends XOpatModuleSingleton {

    constructor() {
        super("oidc-client-ts");
        this.authority = this.getStaticMeta('authority');
        this.clientId = this.getStaticMeta('clientId');
        this.scope = this.getStaticMeta('scope');

        if (!this.authority || !this.clientId || !this.scope) {
            console.warn("OIDC Module not properly configured. Auth disabled.");
            return;
        }

        this.redirectUri = this.getStaticMeta('redirectUri');
        if (!this.redirectUri) {
            this.redirectUri = window.location.href.split('#')[0].split('?')[0];
        }

        this.logoutRedirectUri = this.getStaticMeta('logoutRedirectUri')
            || APPLICATION_CONTEXT.env.gateway || this.redirectUri;

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
            authority: this.authority,
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            post_logout_redirect_uri: this.logoutRedirectUri,
            accessTokenExpiringNotificationTimeInSeconds:
                this.getStaticMeta('accessTokenExpiringNotificationTimeInSeconds'),
            scope: this.scope,
            redirectMethod: "replace",
            redirectTarget: "top",
            // filterProtocolClaims: true,
            // loadUserInfo: true,
            // automaticSilentRenew: true,
            // includeIdTokenInSilentRenew: true,
            // silent_redirect_uri: 'http://localhost:4200/silent-refresh.html',
        });

        //Resolve once we know if we handle login
        let resolves = null;
        const returns = new Promise(async (resolve) => {
            const urlParams = new URLSearchParams(window.location.search);
            resolves = () => {
                resolve();
                resolves = null;
            };

            //todo prevent recurse...
            if (await this.handleUserDataChanged()) {
                resolves && resolves();
            } else if (urlParams.get('state') !== null) {
                return (async () => {
                    debugger;
                    await this.userManager.signinPopupCallback(window.location.href);
                    await this.handleUserDataChanged();
                    resolves && resolves();
                })();
            } else {
                const refreshTokenExpiration = this.getRefreshTokenExpiration();
                if (!refreshTokenExpiration || refreshTokenExpiration < Date.now() / 1000) {
                    await this.userManager.signinPopup({
                        popupWindowFeatures: {
                        }
                    });
                    await this.handleUserDataChanged();
                    resolves && resolves();
                } else {
                    await retrySignin(true);
                }
            }
        }).catch(e => {
            //Error not handled considered as login abort
            console.log("OIDC Aborted user login. Reason:", e);
        });

        //todo verify args if n
        const retrySignin = async (preventRecurse = false, firedManually = false) => {
            try {
                await this.userManager.signinSilent();
                await this.handleUserDataChanged();
                resolves && resolves();
            } catch (error) {
                if (firedManually) return;
                if (error.message.includes('Failed to fetch')) {
                    console.log('Silent signin failed due to connection issues. Retrying in 5 seconds.');
                    //todo translation
                    Dialogs.show('Failed to login, retrying in 5 seconds. <a onclick="oidc.xOpatUser.instance().retrySignin(true, true);">Retry now</a>.');
                    setTimeout(async () => {
                        const refreshTokenExpiration = this.getRefreshTokenExpiration()
                        if (refreshTokenExpiration < Date.now() / 1000) {
                            console.log('Refresh token expired.');
                            await this.handleUserDataChanged();
                            resolves && resolves();
                        } else {
                            console.log('Refresh token still valid for another',
                                Math.round(refreshTokenExpiration - Date.now() / 1000), 'seconds');
                            if (preventRecurse) {
                                await retrySignin(true)
                            } else {
                                resolves && resolves();
                            }
                        }
                    }, 5000);
                } else {
                    resolves && resolves();
                }
            }
        };

        const renewError = async () => {
            const user = XOpatUser.instance();
            if (!resolves && !user.isLogged) {
                this.userManager.events.removeSilentRenewError();
                return;
            }
            console.log('Silent renew failed. Retrying with silent signin.');
            await retrySignin();
        };
        this.userManager.events.addSilentRenewError(renewError);

        return returns;
    }

    getRefreshTokenExpiration() {
        let refreshToken = ''
        const clientId = this.clientId;

        //todo replace with storage api
        Object.keys(sessionStorage).forEach(function (key) {
            if (key.includes(clientId)) {
                const values = JSON.parse(sessionStorage.getItem(key))
                if ('refresh_token' in values) {
                    refreshToken = values.refresh_token;
                }
            }
        });
        if (refreshToken) {
            try {
                return jwtDecode(refreshToken).exp;
            } catch (e) {
                console.warn(e);
            }
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
            if (user.secret) {
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
