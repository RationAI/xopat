addPlugin("chat-anthropic", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        const baseUrl = this.getStaticMeta("baseUrl", "https://api.anthropic.com/v1");
const defaultModelId = this.getStaticMeta("defaultModelId", "");
        const contextId = this.getStaticMeta("authContext", "anthropic");
        const authType = this.getStaticMeta("authMode", "jwt");
        const requiresLogin = authType === "jwt";
        const anthropicVersion = this.getStaticMeta("anthropicVersion", "2023-06-01");
const modelsPath = this.getStaticMeta("modelsDiscoveryPath", "/models");

        await this.server().ensureChatProviderRegistered({
            baseUrl,
            defaultModelId,
            contextId,
            authType,
            requiresLogin,
anthropicVersion,
modelsPath,
        });

        try {
            await xmodules["vercel-ai-chat-sdk"]?.instance().refreshProviders();
        } catch (e) {
            console.error(e);
        }
    }
});
