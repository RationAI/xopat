// 'oidc-auth' plugin
addPlugin('oidc-auth', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        try {
            const oidcConfig = this.getStaticMeta('oidc', {});

            const options = {
                maxRetryCount: this.getStaticMeta('errorLoginRetry', 2),
                extraSigninRequestArgs: this.getStaticMeta('extraSigninRequestArgs', undefined),
                usesStore: this.getStaticMeta('usesStore', 'default'),
                retryTimeout: this.getStaticMeta('retryTimeout', 20),
                authMethod: this.getStaticMeta('method', 'redirect'),
                updateXOpatUser: true // This is the main viewer auth, so it should update the global user context
            };

            const oAuthClient = new OIDCAuthClient(oidcConfig, options);
            const priority = this.getStaticMeta('eventBeforeOpenPriority', 0);
            VIEWER_MANAGER.addHandler('before-app-init', () => oAuthClient.init(), null, priority);
        } catch (e) {
            console.error(e);
        }
    }
});