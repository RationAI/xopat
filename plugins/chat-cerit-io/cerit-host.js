addPlugin("chat-cerit-io", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        // Read config from include.json
        const proxyAlias = this.getStaticMeta("proxyAlias", "cerit");
        const chatApiUrl = this.getStaticMeta("chatApiUrl", "/v1/chat/completions");
        const modelsDiscoveryPath = this.getStaticMeta("modelsDiscoveryPath", "/v1/models");

        // NEW: configurable auth mode: "jwt" or "none"
        const authMode = this.getStaticMeta("authMode", "jwt");

        // OIDC config is only relevant when we actually want viewer auth
        const oidcConfig = authMode === "jwt"
            ? this.getStaticMeta("oidc", {})
            : {};

        await ChatModule.Providers.registerOpenAIChatProviders({
            proxyAlias,
            apiUrl: chatApiUrl,
            oidcConfig,
            userContextId: "cerit-io",
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