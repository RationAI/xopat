addPlugin("chat-cerit-io", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        const baseUrl = this.getStaticMeta("baseUrl", "");
        const modelsPath = this.getStaticMeta("modelsDiscoveryPath", "/models");
        const defaultModelId = this.getStaticMeta("defaultModelId", "coder");
        const contextId = this.getStaticMeta("authContext", "cerit");
        const authType = this.getStaticMeta("authMode", "jwt");
        const requiresLogin = authType === "jwt";

        await this.server().ensureChatProviderRegistered({
            baseUrl,
            modelsPath,
            defaultModelId,
            contextId,
            authType,
            requiresLogin
        });

        try {
            await xmodules["vercel-ai-chat-sdk"]?.ChatModule.instance().refreshProviders();
        } catch (e) {
            console.error(e);
        }
    }
});
