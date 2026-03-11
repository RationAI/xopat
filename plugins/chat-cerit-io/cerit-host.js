addPlugin("chat-cerit-io", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        // Read config from include.json
        const proxyAlias = this.getStaticMeta("proxyAlias", "cerit");
        const chatApiUrl = this.getStaticMeta("chatApiUrl", "/v1/chat/completions");
        const modelsDiscoveryPath = this.getStaticMeta("modelsDiscoveryPath", "/v1/models");
        const authContext = this.getStaticMeta("authContext", "jwt");
        const authMode = this.getStaticMeta("authMode", "jwt");

        // OIDC config is only relevant when we actually want viewer auth
        const oidcConfig = authMode === "jwt"
            ? this.getStaticMeta("oidc", {})
            : {};

        await xmodules.chat.Providers.openAI({
            proxyAlias,
            apiUrl: chatApiUrl,
            oidcConfig,
            userContextId: authContext,
            serviceName: "CERIT Hosted Chat",

            models: [],

            discovery: {
                path: modelsDiscoveryPath,
                authRequired: !!oidcConfig,
                labelPrefix: "CERIT ",
                providerIdPrefix: "cerit-io-"
            },
            authMode
        });
    }
});