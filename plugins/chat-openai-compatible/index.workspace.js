addPlugin("chat-openai-compatible", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        const contextId = this.getStaticMeta("authContext", null);
        const authType = this.getStaticMeta("authMode", "jwt");
        const requiresLogin = authType === "jwt";

        // Boot resilience: a cold/slow auth backend must not strand the chat with no
        // provider until a manual reload. The shared helper fails each attempt fast
        // (5s RPC timeout, not the 30s client backstop), retries with backoff, and
        // refreshes the catalog on success so the provider self-surfaces.
        await xmodules["vercel-ai-chat-sdk"]?.instance().registerManagedProvider(
            () => this.server().ensureChatProviderRegistered(
                { contextId, authType, requiresLogin },
                { timeoutMs: 5000 }
            ),
            { label: "OpenAI-compatible" }
        );
    }
});
