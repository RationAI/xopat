addPlugin("chat-anthropic", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        const contextId = this.getStaticMeta("authContext", "anthropic");
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
            { label: "Anthropic" }
        );

        // Declare how this provider's login context authenticates, so the core
        // auth broker can force + drive login before the chat is usable. Generic:
        // any vercel-SDK provider plugin opts in the same way (authMode "jwt" +
        // authContext + an `oidc` block). See src/AUTH.md.
        const oidc = this.getStaticMeta("oidc", null);
        if (requiresLogin && oidc && window.APPLICATION_CONTEXT?.auth) {
            try {
                await APPLICATION_CONTEXT.auth.configureContext({
                    contextId,
                    method: this.getStaticMeta("authBroker", "oidc"),
                    config: oidc,
                    serviceName: this.getStaticMeta("name", contextId),
                    authMethod: this.getStaticMeta("oidcFlow", "popup"),
                    tokenForServer: this.getStaticMeta("tokenForServer", "access_token")
                });
            } catch (e) {
                console.error("chat-anthropic: failed to configure auth context", e);
            }
        }
    }
});
