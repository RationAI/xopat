addPlugin("chat-chatgpt", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        // Read config from include.json
        const proxyAlias = this.getStaticMeta("proxyAlias", "openai");
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
            userContextId: "openai",
            serviceName: "ChatGPT",

            models: [],

            discovery: {
                path: modelsDiscoveryPath,
                authRequired: !!oidcConfig,
                labelPrefix: "ChatGPT ",
                providerIdPrefix: "openai-"
            },
            authMode
        });
    }
});