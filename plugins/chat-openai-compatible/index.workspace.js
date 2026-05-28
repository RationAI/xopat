addPlugin("chat-openai-compatible", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        const contextId = this.getStaticMeta("authContext", null);
        const authType = this.getStaticMeta("authMode", "jwt");
        const requiresLogin = authType === "jwt";

        await this.server().ensureChatProviderRegistered({
            contextId,
            authType,
            requiresLogin
        });

        try {
            await xmodules["vercel-ai-chat-sdk"]?.instance().refreshProviders();
        } catch (e) {
            console.error(e);
        }
    }
});
